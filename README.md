# Cabure

Open-source CLI wizard and toolkit for running Groth16 Phase 2 trusted setup ceremonies. Replaces p0tion + DefinitelySetup with a single-command scaffolding experience.

## Packages

| Package | Description |
|---------|-------------|
| `@wonderland/cabure-crypto` | Typed exports for all Groth16 Phase 2 ceremony operations (snarkjs 0.7.5 wrapper with in-memory I/O) |
| `@wonderland/create-cabure-ceremony` | CLI wizard that scaffolds a fully deployable ceremony project |
| `@wonderland/cabure-cli` | CLI contributor tool for headless/VM environments (GitHub OAuth device flow) |

## Architecture

Generated projects are **single Next.js applications** containing both the participant UI and the ceremony API routes:

- **API routes** (`src/app/api/ceremony/`) — Manage queue, verify contributions, track ceremony state via Vercel KV (Upstash Redis).
- **Frontend** (`src/app/`, `src/app/screens/`) — Contributors interact through the browser, providing entropy via mouse movement and clicks.
- **Crypto** — All cryptographic operations imported from `@wonderland/cabure-crypto`. Runs in a Web Worker (browser) or natively (CLI).

**Storage is Vercel-first**: zkey files are stored in Vercel Blob, ceremony state and receipts in Upstash Redis (Vercel KV).

## Ceremony Flow

1. **Scaffold** — Operator runs `npx @wonderland/create-cabure-ceremony` and answers 4 prompts (project name, target contributions, optional end date, optional circuit artifacts path)
2. **Configure artifacts** — If a circuit path was provided, `.r1cs` files are copied automatically. Otherwise, copy your `.r1cs` files into `circuits/` and run `npm run setup:ptau`
3. **Initialize** — Run `npm run init:ceremony` to generate genesis zkeys, upload to Vercel Blob, and write the manifest to KV. Local copies and an init transcript are saved to `public/genesis/`
4. **Deploy** — Import the generated app into Vercel (or deploy manually)
5. **Contribute** — Contributors visit the UI or use `@wonderland/cabure-cli`. Each contribution: download current zkey, collect entropy (mouse/click required in browser), compute in Web Worker or CLI, upload result
6. **Verify** — Contributions can optionally be verified per-submission via BN254 pairing checks (`verifyContributions` in config, off by default due to serverless timeouts). A SHA-256 hash chain links all contributions from genesis. The finalize script always verifies the full chain before applying the beacon
7. **Finalize** — When target is reached, operator runs `npm run finalize:ceremony`. By default this uses the RANDAO reveal from the latest finalized Ethereum beacon chain slot as the beacon source. Outputs are saved to `public/finalize/`

## `@wonderland/cabure-crypto` API

All functions accept `Uint8Array` inputs. snarkjs file I/O is handled internally via temp directories.

```typescript
// Generate the genesis zkey from a Powers of Tau ceremony and an R1CS circuit
generateInitialZkey(ptau: Uint8Array, r1cs: Uint8Array): Promise<Uint8Array>

// Apply a contribution to a zkey using provided entropy
contribute(prevZkey: Uint8Array, entropy: Uint8Array, name?: string): Promise<ContributionResult>
// ContributionResult = { zkey: Uint8Array; hash: string }

// Verify a zkey against the original circuit and Powers of Tau
verify(r1cs: Uint8Array, ptau: Uint8Array, zkey: Uint8Array): Promise<boolean>

// Verify the full contribution chain from genesis (snarkjs walks the
// transcript embedded in latestZkey; intermediates are not needed)
verifyChain(r1cs: Uint8Array, ptau: Uint8Array, initialZkey: Uint8Array, latestZkey: Uint8Array): Promise<boolean>

// Generate entropy from available sources (CSPRNG + optional mouse/click data)
generateEntropy(sources?: EntropySource[]): Promise<Uint8Array>

// Apply a beacon to finalize the ceremony (2^N rounds of SHA-256)
applyBeacon(zkey: Uint8Array, beaconHash: string, numIterationsExp?: number): Promise<Uint8Array>

// Extract the Groth16 verification key from a finalized zkey
exportVerificationKey(zkey: Uint8Array): Promise<object>
```

## @wonderland/create-cabure-ceremony docs

Package-specific usage and local `npx` testing guide:

- [`packages/create-cabure-ceremony/README.md`](./packages/create-cabure-ceremony/README.md)

## Generated Project Structure

Running `npx @wonderland/create-cabure-ceremony` produces:

```text
my-ceremony/
├── src/
│   ├── app/                # Next.js pages, screens, and API routes
│   │   ├── api/ceremony/   # Queue, contribute, status, receipt endpoints
│   │   ├── screens/        # Landing, Entropy, Tier, Progress, Complete, Verify
│   │   └── components/     # Header, Button, ScreenWrapper, ErrorBoundary
│   ├── hooks/              # useContributionFlow, useEntropyCollector, etc.
│   ├── lib/                # api, auth, blob-store, kv-store, ceremony-state
│   ├── types/              # ceremony types, next-auth extensions
│   └── utils/              # entropy, formatting helpers
├── scripts/                # setup-ptau, init-ceremony, finalize-ceremony, reset-ceremony
├── circuits/               # .r1cs files and downloaded .ptau
├── ceremony.config.ts      # Ceremony name, circuits, tiers, storage keys, UI copy
├── package.json
└── README.md
```

## Development

### Prerequisites

- Node.js >= 20
- pnpm >= 9

### Setup

```bash
git clone https://github.com/defi-wonderland/cabure-wizard.git
cd cabure-wizard
pnpm install
```

### Build

```bash
# Build all packages
pnpm build

# Build a specific package
pnpm --filter @wonderland/cabure-crypto build
```

### Test

```bash
# Run all tests
pnpm test

# Run tests for a specific package
pnpm --filter @wonderland/cabure-crypto test
```

## Contributing

Contributions are welcome. Please open an issue or pull request on GitHub.

Before submitting a PR:
1. Ensure `pnpm build` succeeds
2. Ensure `pnpm test` passes
3. Follow the existing code style

## License

[MIT](./LICENSE)
