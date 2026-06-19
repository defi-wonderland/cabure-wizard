# __PROJECT_NAME__

Interactive UI for a Groth16 Phase 2 trusted setup ceremony. Participants contribute randomness through the browser while the app manages queue coordination, zkey storage, and receipt generation.

## Setup

### 1. Install

```bash
npm install
```

### 2. Add circuit files and download the ptau

Place your compiled `.r1cs` files in the `circuits/` folder, then run:

```bash
npm run setup:ptau
```

This reads each circuit's constraint count, downloads the correct [PPoT](https://github.com/privacy-ethereum/perpetualpowersoftau) `.ptau` file, and updates `ceremony.config.ts` with the actual constraint values.

> **Note:** If the circuit artifacts path was skipped in the wizard and circuits are being added now, `ceremony.config.ts` will have empty `circuits` and `tiers` arrays. These must be populated manually — see the [Configuration](#configuration) section below for the expected shape and examples.

### 3. Configure environment variables

Copy `.env.example` to `.env` and fill in the values:

```bash
cp .env.example .env
```

| Variable               | Source                | Purpose                              |
| ---------------------- | --------------------- | ------------------------------------ |
| `AWS_REGION`           | Your AWS account      | Region to deploy into                |
| `CEREMONY_BUCKET`      | `sst deploy` output   | S3 bucket holding zkeys + ptau       |
| `CLOUDFRONT_DOMAIN`    | `sst deploy` output   | CloudFront origin for zkey downloads |
| `KV_REST_API_URL`      | Upstash Redis         | Redis endpoint for ceremony state    |
| `KV_REST_API_TOKEN`    | Upstash Redis         | Redis auth token                     |
| `GITHUB_CLIENT_ID`     | GitHub OAuth App      | OAuth client ID                      |
| `GITHUB_CLIENT_SECRET` | GitHub OAuth App      | OAuth client secret                  |
| `NEXTAUTH_SECRET`      | Generated locally     | JWT session encryption secret        |
| `NEXTAUTH_URL`         | Deployed app URL      | Canonical app URL                    |

AWS credentials are not env vars here — they come from your AWS CLI profile or
environment (e.g. `aws configure` / `AWS_PROFILE`). `CEREMONY_BUCKET` and
`CLOUDFRONT_DOMAIN` do not exist until your first `sst deploy`; copy them from
its output into `.env` before running the operator scripts.

### 4. Provision storage

1. Configure AWS credentials (`aws configure`, or set `AWS_PROFILE`). The S3
   bucket and CloudFront distribution are created for you by `sst deploy`
   (see [Deploy](#deploy)).
2. Create an **Upstash Redis** database (console.upstash.com) and copy its REST
   URL and token into `KV_REST_API_URL` / `KV_REST_API_TOKEN`.

### 5. GitHub OAuth

1. Create an OAuth App at [github.com/settings/developers](https://github.com/settings/developers).
2. Set the callback URL to `<your-url>/api/auth/callback/github`.
3. Check **Enable Device Flow** to support CLI contributions (`@wonderland/cabure-cli`).
4. Copy the Client ID and Client Secret into your `.env`.
5. Generate `NEXTAUTH_SECRET`:

```bash
openssl rand -base64 32
```

### 6. Initialize and run

```bash
npm run init:ceremony
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Deploy

Deploys to AWS with [SST](https://sst.dev): the app runs as a Lambda behind
CloudFront, zkeys/ptau live in S3.

```bash
npm run deploy   # sst deploy --stage production
```

First deploy:

1. Run `npm run deploy`. SST creates the S3 bucket, CloudFront distribution, and
   the app Lambda, then prints `url`, `cdn`, and `bucket`.
2. Copy `bucket` → `CEREMONY_BUCKET` and `cdn` → `CLOUDFRONT_DOMAIN` in `.env`
   (the operator scripts need them).
3. Set `NEXTAUTH_URL` to the printed `url` and point your GitHub OAuth App
   callback at `<url>/api/auth/callback/github`, then run `npm run deploy` again
   so the Lambda picks up `NEXTAUTH_URL`.
4. Run `npm run init:ceremony` once. After that the API routes handle ceremony
   state automatically.

`sst remove` tears the whole stack down (the bucket is retained on the
`production` stage).

> Heavy-circuit note: the contribute route runs `verifyChain` inline. Requests
> reach the Lambda through CloudFront, which caps an origin response at 60s
> (180s max via an AWS Support limit increase). A circuit whose verify exceeds
> that needs verification moved to an async worker — the Lambda itself is sized
> for memory and `/tmp` headroom in `sst.config.ts`, but the synchronous request
> path is bounded by CloudFront.

## Scripts

| Script                      | Description                                                                               |
| --------------------------- | ----------------------------------------------------------------------------------------- |
| `npm run setup:ptau`        | Detect circuit constraints, download the correct PPoT ptau, and update config             |
| `npm run init:ceremony`     | Generate genesis zkey, upload to S3, write manifest to KV. Outputs to `public/genesis/`   |
| `npm run reset:ceremony`    | Wipe all KV keys and S3 zkeys for a fresh start                                            |
| `npm run finalize:ceremony` | Apply beacon (Ethereum RANDAO by default), verify zkeys. Outputs to `public/finalize/`    |

### Setup ptau

```bash
npm run setup:ptau             # download and update constraints
npm run setup:ptau -- --force  # re-download even if ptau exists
npm run setup:ptau -- --verify # also run snarkjs ptau verification
```

### Finalization

By default, finalization uses the RANDAO reveal from the latest finalized Ethereum beacon chain slot as the beacon source. This makes the beacon publicly verifiable.

```bash
npm run finalize:ceremony                              # latest finalized slot RANDAO (default)
npm run finalize:ceremony -- --beacon-slot 7325000     # specific pre-announced slot
npm run finalize:ceremony -- --beacon 0xabc123         # explicit hex beacon value
npm run finalize:ceremony -- --random-beacon           # random beacon (local testing only)
npm run finalize:ceremony -- --force                   # finalize before target is reached
```

For maximum verifiability, announce a future beacon chain slot number publicly before running with `--beacon-slot`. The RANDAO reveal is fetched from the Ethereum Beacon API (`BEACON_API_URL` env var overrides the default public endpoint).

### Initialization output

Running `init:ceremony` generates `public/genesis/`:

- `init-transcript.json` — full initialization record (ceremony config, circuit hashes, storage paths)
- `{circuitId}.genesis.zkey` — local copy of each genesis zkey

### Pin the genesis hash externally

`init:ceremony` records each circuit's genesis hash — as `genesisZkeyHash` in
`init-transcript.json` and as `initialZkeyHash` in KV. `finalize:ceremony` checks
the genesis blob against that hash before
verifying the chain, which catches a swapped or corrupted genesis blob while KV
is intact.

It does NOT defend against an attacker who can write both the blob and KV: they
rewrite the pinned hash to match the swapped genesis. To close that gap, publish
each `genesisZkeyHash` somewhere outside this deployment's control at the start
of the ceremony — commit it to a public Git repo, post it where contributors can
read it. Contributors and auditors can then confirm the finalized parameters
were built on the genesis announced at the start, not one substituted later.

### Finalization output

Running `finalize:ceremony` generates `public/finalize/`:

- `transcript.json` — full ceremony record (includes beacon source and slot)
- `{circuitId}.vkey.json` — Groth16 verification key
- `{circuitId}.final.zkey` — finalized proving key

## Configuration

Edit `ceremony.config.ts` to customize the ceremony name, circuits, tiers, contribution targets, and UI copy. The full shape is defined by `CeremonyConfig` in `src/types/ceremony.ts`.

### Circuits

Each entry in `circuits` describes one zkey chain that contributors will extend. `setup:ptau` populates `constraints` automatically once the `.r1cs` files are in place.

```ts
circuits: [
  {
    id: "multiplier",                       // unique, stable ID used in receipts and storage paths
    label: "Multiplier",                    // display name in the UI
    description: "2-input multiplier proof",
    constraints: "1024",                    // filled in by `npm run setup:ptau`
    targetContributions: 100,               // per-circuit target; overrides the top-level value
    artifacts: {
      r1csPath: "circuits/multiplier.r1cs", // path relative to the project root
      ptauPath: PTAU_PATH,                  // points to circuits/pot_final.ptau, downloaded by `setup:ptau`
    },
  },
],
```

### Tiers

Tiers group circuits so contributors can pick a smaller commitment on the tier selection screen. Set `tiersEnabled: false` and omit `tiers` to skip the tier screen entirely and contribute to every circuit. `circuitIds` must reference IDs defined in `circuits`.

```ts
tiersEnabled: true,
tiers: [
  {
    id: "core",                                     // must be one of: "core" | "popular" | "all"
    label: "Core circuits",
    description: "Fast contribution — essential circuits only",
    estimatedMinutes: 5,
    circuitIds: ["multiplier"],
  },
  {
    id: "all",
    label: "Full ceremony",
    description: "Contribute to every circuit",
    estimatedMinutes: 30,
    circuitIds: ["multiplier"],             // add more IDs here after defining matching circuits above
  },
],
```
