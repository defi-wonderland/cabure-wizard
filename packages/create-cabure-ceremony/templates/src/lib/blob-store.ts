import {
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

// How long a presigned upload URL stays valid. It must outlive a slow client
// upload but stay short enough that a leaked URL is not useful for long.
const PRESIGNED_PUT_TTL_SECONDS = 600;

// Mirrors the shape the old Vercel Blob `put()` returned, so the contribute
// route and init script keep using `.url` and `.pathname` unchanged. `url` is a
// stable public URL (served by CloudFront) safe to persist in KV/the manifest.
// `pathname` is the S3 object key.
export interface PutResult {
  url: string;
  pathname: string;
}

let _client: S3Client | null = null;

// The region and credentials come from the ambient environment: the Lambda
// execution role in production, the operator's AWS profile/env for the local
// scripts. No explicit token, unlike Vercel Blob.
//
// S3_ENDPOINT points the client at a local S3-compatible server (LocalStack,
// MinIO) for offline testing. Unset in production. forcePathStyle is required
// there because those servers do not serve virtual-host bucket subdomains.
function client(): S3Client {
  if (!_client) {
    const endpoint = process.env.S3_ENDPOINT?.trim();
    _client = new S3Client(endpoint ? { endpoint, forcePathStyle: true } : {});
  }
  return _client;
}

function bucket(): string {
  const name = process.env.CEREMONY_BUCKET?.trim();
  if (!name) {
    throw new Error("CEREMONY_BUCKET must be set in the environment.");
  }
  return name;
}

// CloudFront origin in front of the bucket. Accepts a bare host
// (d123.cloudfront.net) or a full origin (https://...); normalizes to an https
// origin with no trailing slash.
function publicBaseUrl(): string {
  const domain = process.env.CLOUDFRONT_DOMAIN?.trim();
  if (!domain) {
    throw new Error("CLOUDFRONT_DOMAIN must be set in the environment.");
  }
  const origin = domain.startsWith("http") ? domain : `https://${domain}`;
  return origin.replace(/\/+$/, "");
}

export function publicUrlForKey(key: string): string {
  return `${publicBaseUrl()}/${key}`;
}

// Inverse of publicUrlForKey. Stored URLs are CloudFront URLs whose path is the
// S3 key, so deleteBinary can recover the key from a persisted url.
function keyFromPublicUrl(url: string): string {
  return new URL(url).pathname.replace(/^\/+/, "");
}

export async function putBinary(
  pathname: string,
  data: Uint8Array,
  options?: { overwrite?: boolean },
): Promise<PutResult> {
  await client().send(
    new PutObjectCommand({
      Bucket: bucket(),
      Key: pathname,
      Body: data,
      ContentType: "application/octet-stream",
      // overwrite:false maps to S3's conditional create. The put fails with 412
      // if the key already exists. init-ceremony uses this to refuse silently
      // replacing the pinned genesis on a plain re-run. A single conditional put
      // either creates the object or fails with the old one intact — no
      // delete-first window where the genesis pin could vanish.
      ...(options?.overwrite === false ? { IfNoneMatch: "*" } : {}),
    }),
  );
  return { url: publicUrlForKey(pathname), pathname };
}

export async function getBinary(key: string): Promise<Uint8Array> {
  const result = await client().send(
    new GetObjectCommand({ Bucket: bucket(), Key: key }),
  );
  if (!result.Body) {
    throw new Error(`Empty body for ${key}`);
  }
  return new Uint8Array(await result.Body.transformToByteArray());
}

export async function deleteBinary(url: string): Promise<void> {
  await deleteByKey(keyFromPublicUrl(url));
}

export async function deleteByKey(key: string): Promise<void> {
  await client().send(new DeleteObjectCommand({ Bucket: bucket(), Key: key }));
}

// Mint a presigned PUT URL the client uploads to directly, bypassing the
// function. The upload route gates eligibility before calling this. We sign only
// the host, so the client may send any (or no) Content-Type header.
export async function presignPut(key: string): Promise<string> {
  return await getSignedUrl(
    client(),
    new PutObjectCommand({ Bucket: bucket(), Key: key }),
    { expiresIn: PRESIGNED_PUT_TTL_SECONDS },
  );
}

// Delete every object under a prefix. Used by reset:ceremony. ListObjectsV2
// returns at most 1000 keys per page, which is also the DeleteObjects per-call
// limit, so one delete per page stays within bounds.
export async function deletePrefix(prefix: string): Promise<number> {
  const b = bucket();
  let deleted = 0;
  let token: string | undefined;
  do {
    const listed = await client().send(
      new ListObjectsV2Command({
        Bucket: b,
        Prefix: prefix,
        ContinuationToken: token,
      }),
    );
    const objects = (listed.Contents ?? [])
      .map((o) => o.Key)
      .filter((k): k is string => Boolean(k))
      .map((Key) => ({ Key }));
    if (objects.length > 0) {
      await client().send(
        new DeleteObjectsCommand({ Bucket: b, Delete: { Objects: objects } }),
      );
      deleted += objects.length;
    }
    token = listed.IsTruncated ? listed.NextContinuationToken : undefined;
  } while (token);
  return deleted;
}
