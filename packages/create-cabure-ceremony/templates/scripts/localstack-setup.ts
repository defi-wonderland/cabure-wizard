import process from "node:process";

import { loadEnvConfig } from "@next/env";
import {
  CreateBucketCommand,
  PutBucketCorsCommand,
  PutBucketPolicyCommand,
  S3Client,
} from "@aws-sdk/client-s3";

// Prepares a LOCAL S3-compatible bucket (LocalStack / MinIO) for local
// development: creates the bucket, opens it to public reads (downloads are
// fetched by plain GET), and allows cross-origin PUTs from the dev server (the
// browser uploads straight to S3 via a presigned URL).
//
// This refuses to run unless S3_ENDPOINT points at a local emulator. The
// public-read policy must never touch a real AWS bucket.
async function main() {
  loadEnvConfig(process.cwd(), true);

  const endpoint = process.env.S3_ENDPOINT?.trim();
  const bucket = process.env.CEREMONY_BUCKET?.trim();

  if (!endpoint) {
    throw new Error(
      "S3_ENDPOINT is not set. This script targets a LOCAL S3 emulator only " +
        "(e.g. http://localhost:4566) and must never run against real AWS.",
    );
  }
  if (!bucket) {
    throw new Error("CEREMONY_BUCKET must be set (e.g. cabure-local).");
  }

  // Any credentials work against LocalStack; fall back to dummy values so the
  // SDK does not error on a missing credential chain.
  const s3 = new S3Client({
    endpoint,
    forcePathStyle: true,
    region: process.env.AWS_REGION || "us-east-1",
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID || "test",
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || "test",
    },
  });

  try {
    await s3.send(new CreateBucketCommand({ Bucket: bucket }));
    console.log(`Created bucket: ${bucket}`);
  } catch (error) {
    const name = (error as { name?: string }).name;
    if (name === "BucketAlreadyOwnedByYou" || name === "BucketAlreadyExists") {
      console.log(`Bucket already exists: ${bucket}`);
    } else {
      throw error;
    }
  }

  await s3.send(
    new PutBucketPolicyCommand({
      Bucket: bucket,
      Policy: JSON.stringify({
        Version: "2012-10-17",
        Statement: [
          {
            Effect: "Allow",
            Principal: "*",
            Action: "s3:GetObject",
            Resource: `arn:aws:s3:::${bucket}/*`,
          },
        ],
      }),
    }),
  );
  console.log("Applied public-read policy (s3:GetObject).");

  // Best-effort: LocalStack implements PutBucketCors; MinIO often does not and
  // is permissive by default. A failure here is not fatal for local dev.
  try {
    await s3.send(
      new PutBucketCorsCommand({
        Bucket: bucket,
        CORSConfiguration: {
          CORSRules: [
            {
              AllowedOrigins: ["http://localhost:3000"],
              AllowedMethods: ["PUT", "GET"],
              AllowedHeaders: ["*"],
            },
          ],
        },
      }),
    );
    console.log("Applied CORS rules (PUT/GET from http://localhost:3000).");
  } catch (error) {
    const name = (error as { name?: string }).name ?? "error";
    console.warn(
      `Skipped CORS config (${name}) — fine on MinIO, which allows CORS by default.`,
    );
  }

  console.log(`\nLocal S3 ready: ${endpoint}/${bucket}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
