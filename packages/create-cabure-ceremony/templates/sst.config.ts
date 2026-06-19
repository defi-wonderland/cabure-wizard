/// <reference path="./.sst/platform/config.d.ts" />

// Deploys the ceremony to AWS: the Next.js app runs as a Lambda behind
// CloudFront (via OpenNext), zkeys/ptau live in S3, and a CloudFront router
// serves those files publicly. Run `sst deploy`. State (queue, locks, receipts)
// stays in Upstash Redis, reached over its REST API — no VPC needed.
export default $config({
  app(input) {
    return {
      name: "__PROJECT_SLUG__",
      // production keeps the bucket on `sst remove`; other stages tear down
      // fully so a dev stack leaves nothing behind.
      removal: input?.stage === "production" ? "retain" : "remove",
      protect: input?.stage === "production",
      home: "aws",
    };
  },
  async run() {
    // zkeys (genesis, current) and the ptau live here. Client pending uploads
    // land under contributions/ via presigned PUT. access:cloudfront keeps the
    // bucket private and lets only the CloudFront distribution read it.
    const bucket = new sst.aws.Bucket("CeremonyBucket", {
      access: "cloudfront",
    });

    // Public, stable download URLs for genesis/current zkeys and the ptau. The
    // ceremony persists these URLs in KV, so they must not expire — a CloudFront
    // origin, not presigned GETs.
    const cdn = new sst.aws.Router("CeremonyCdn");
    cdn.routeBucket("/", bucket);

    const web = new sst.aws.Nextjs("Web", {
      // The contribute route downloads the ptau (hundreds of MB) and the zkeys
      // and runs snarkjs verifyChain. Give it CPU (memory), /tmp headroom
      // (storage), and time.
      //
      // CAVEAT: requests reach this function through CloudFront, which caps an
      // origin response at 60s by default (180s max, via an AWS Support limit
      // increase). The 900s Lambda ceiling is NOT reachable on the synchronous
      // request path. For a circuit whose verifyChain exceeds ~180s, move
      // verification to an async worker instead of doing it inline here.
      server: {
        memory: "10240 MB",
        storage: "10 GB",
        timeout: "180 seconds",
      },
      // Grants the server function IAM access to the bucket (get/put/delete/list).
      link: [bucket],
      environment: {
        CEREMONY_BUCKET: bucket.name,
        CLOUDFRONT_DOMAIN: cdn.url,
        KV_REST_API_URL: process.env.KV_REST_API_URL ?? "",
        KV_REST_API_TOKEN: process.env.KV_REST_API_TOKEN ?? "",
        GITHUB_CLIENT_ID: process.env.GITHUB_CLIENT_ID ?? "",
        GITHUB_CLIENT_SECRET: process.env.GITHUB_CLIENT_SECRET ?? "",
        NEXTAUTH_SECRET: process.env.NEXTAUTH_SECRET ?? "",
        // Must equal the deployed app URL for GitHub OAuth callbacks. It is not
        // known until the first deploy prints `web.url`. After the first deploy,
        // set NEXTAUTH_URL to that value (or configure a custom domain) and
        // deploy again.
        NEXTAUTH_URL: process.env.NEXTAUTH_URL ?? "",
      },
    });

    return {
      url: web.url,
      cdn: cdn.url,
      bucket: bucket.name,
    };
  },
});
