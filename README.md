# Cabure

Open-source CLI wizard and toolkit for running Groth16 Phase 2 trusted setup ceremonies. Replaces p0tion + DefinitelySetup with a modern, separated architecture.

## Packages

| Package | Description |
|---------|-------------|
| `@wonderland/cabure-crypto` | Typed exports for all Groth16 Phase 2 ceremony operations (snarkjs 0.7.5 wrapper with in-memory I/O) |
| `create-cabure-ceremony` | CLI wizard that scaffolds a fully deployable ceremony project |
| `@wonderland/cabure-cli` | CLI contributor tool for headless/VM environments (GitHub OAuth device flow) |

## Architecture

Cabure uses a **separated architecture** where generated projects have three independent parts:

- **Coordinator** - Stateless serverless function (not coupled to any framework). Manages queue, verifies contributions, tracks ceremony state.
- **Frontend** - Static site with zero server dependencies. Contributors interact through the browser, providing entropy via mouse movement/clicks.
- **Crypto** - All cryptographic operations imported from `@wonderland/cabure-crypto`. Runs in a Web Worker (browser) or natively (CLI).

**Storage is IPFS-first**: ceremony state is stored as content-addressed JSON, zkeys are pinned to IPFS. S3 is supported as an alternative.

## Ceremony Flow

1. **Scaffold** - Operator runs `npx create-cabure-ceremony` and answers prompts (project name, target contributions, optional end date, optional circuit path)
2. **Configure artifacts** - If a circuit path was provided, `.r1cs` files are copied automatically. Otherwise, copy your `.r1cs` files into `circuits/` and update `ceremony.config.ts`
3. **Deploy** - Import the generated app into Vercel (or deploy manually)
4. **Contribute** - Contributors visit the frontend or use `@wonderland/cabure-cli`. Each contribution: download current zkey, collect entropy (mouse/click required in browser), compute in Web Worker or CLI, upload result
5. **Verify** - Each contribution is verified with BN254 pairing checks. A SHA-256 hash chain links all contributions from genesis
6. **Finalize** - When target is reached, operator applies a drand Quicknet beacon to produce the final parameters

## `@wonderland/cabure-crypto` API

All functions use the snarkjs in-memory I/O pattern: `Uint8Array` in, `{ type: "mem" }` output.

```typescript
// Generate the genesis zkey from a Powers of Tau ceremony and an R1CS circuit
generateInitialZkey(ptau: Uint8Array, r1cs: Uint8Array): Promise<Uint8Array>

// Apply a contribution to a zkey using provided entropy
contribute(prevZkey: Uint8Array, entropy: Uint8Array, name?: string): Promise<{ zkey: Uint8Array; hash: string }>

// Verify a single contribution against the previous zkey
verify(prevZkey: Uint8Array, newZkey: Uint8Array): Promise<boolean>

// Verify the full contribution chain from genesis
verifyChain(initialZkey: Uint8Array, contributions: Uint8Array[]): Promise<boolean>

// Generate entropy from available sources (CSPRNG + optional mouse/click data)
generateEntropy(sources?: EntropySource[]): Promise<Uint8Array>

// Apply a drand beacon to finalize the ceremony
applyBeacon(zkey: Uint8Array, beaconHash: string): Promise<Uint8Array>

// Extract the verification key from a finalized zkey
exportVerificationKey(zkey: Uint8Array): Promise<object>
```

## create-cabure-ceremony docs

Package-specific usage and local `npx` testing guide:

- [`packages/create-cabure-ceremony/README.md`](./packages/create-cabure-ceremony/README.md)

## Generated Project Structure

Running `npx create-cabure-ceremony` produces:

```
my-ceremony/
├── app/                  # Next.js app routes and UI
├── lib/
├── ceremony.config.ts
├── circuits/
├── vercel.json
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
