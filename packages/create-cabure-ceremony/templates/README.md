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

This reads each circuit's constraint count, downloads the correct [PPoT](https://github.com/privacy-ethereum/perpetualpowersoftau) `.ptau` file, verifies it with snarkjs, and updates `ceremony.config.ts` with the actual constraint values.

### 3. Configure environment variables

Copy `.env.example` to `.env` and fill in the values:

```bash
cp .env.example .env
```

| Variable                | Source              | Purpose                           |
| ----------------------- | ------------------- | --------------------------------- |
| `BLOB_READ_WRITE_TOKEN` | Vercel Blob         | Read/write zkey files             |
| `KV_REST_API_URL`       | Vercel KV (Upstash) | Redis endpoint for ceremony state |
| `KV_REST_API_TOKEN`     | Vercel KV (Upstash) | Redis auth token                  |
| `GITHUB_CLIENT_ID`      | GitHub OAuth App    | OAuth client ID                   |
| `GITHUB_CLIENT_SECRET`  | GitHub OAuth App    | OAuth client secret               |
| `NEXTAUTH_SECRET`       | Generated locally   | JWT session encryption secret     |
| `NEXTAUTH_URL`          | Deployment URL      | Canonical app URL                 |

### 4. Provision Vercel storage

1. Link to a Vercel project: `vercel link`
2. Create a **Blob** store in the Vercel dashboard (Storage tab).
3. Create a **KV (Upstash)** store in the same tab.
4. Pull the generated env vars: `vercel env pull`

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

```bash
vercel --prod
```

Add all environment variables in the Vercel dashboard under **Settings > Environment Variables**. Set `NEXTAUTH_URL` to your production domain.

The init script only needs to run once. After deploying, the API routes handle ceremony state automatically.

## Scripts

| Script                      | Description                                                              |
| --------------------------- | ------------------------------------------------------------------------ |
| `npm run setup:ptau`        | Detect circuit constraints, download the correct PPoT ptau, and verify   |
| `npm run init:ceremony`     | Generate genesis zkey, upload to Blob, write manifest to KV. Outputs to `output/genesis/` |
| `npm run reset:ceremony`    | Wipe all KV keys and Blob zkeys for a fresh start |
| `npm run finalize:ceremony` | Apply beacon (Ethereum RANDAO by default), verify zkeys. Outputs to `output/finalize/` |

### Setup ptau

```bash
npm run setup:ptau                  # download, verify, and update config
npm run setup:ptau -- --force       # re-download even if ptau exists
npm run setup:ptau -- --skip-verify # skip snarkjs verification (faster for large files)
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

Running `init:ceremony` generates `output/genesis/`:

- `init-transcript.json` — full initialization record (ceremony config, circuit hashes, storage paths)
- `{circuitId}.genesis.zkey` — local copy of each genesis zkey

### Finalization output

Running `finalize:ceremony` generates `output/finalize/`:

- `transcript.json` — full ceremony record (includes beacon source and slot)
- `{circuitId}.vkey.json` — Groth16 verification key
- `{circuitId}.final.zkey` — finalized proving key

## Configuration

Edit `ceremony.config.ts` to customize the ceremony name, circuits, tiers, contribution targets, and UI copy.
