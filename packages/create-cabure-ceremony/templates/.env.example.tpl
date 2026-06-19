# AWS deployment (SST). Credentials come from your AWS CLI profile / environment;
# do not put AWS keys here. CEREMONY_BUCKET and CLOUDFRONT_DOMAIN are printed by
# `sst deploy` — copy them here for the local operator scripts (init/reset/finalize).
AWS_REGION=us-east-1
CEREMONY_BUCKET=
CLOUDFRONT_DOMAIN=

# Local testing only: point the S3 client at a local S3-compatible server
# (LocalStack / MinIO). Leave unset in real deployments.
# S3_ENDPOINT=http://localhost:4566

KV_REST_API_URL=
KV_REST_API_TOKEN=

GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=
NEXTAUTH_SECRET=
NEXTAUTH_URL=http://localhost:3000
