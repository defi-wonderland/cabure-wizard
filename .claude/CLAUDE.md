# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What is Caburé

Caburé is an open-source CLI wizard and toolkit for running Groth16 Phase 2 trusted setup ceremonies. It replaces p0tion + DefinitelySetup with a single-command scaffolding experience, a reusable crypto package, and a headless contributor CLI.

## Repository Workflow

This repository is a pnpm workspace. Application source lives under `packages/`; the root orchestrates scripts and shared TypeScript settings.

Prerequisites:
- Node.js >= 20
- pnpm >= 9 (`packageManager` pins `pnpm@9.15.4`)

Common commands from the repository root:

```bash
pnpm install
pnpm format
pnpm build
pnpm test
pnpm test:e2e
pnpm clean
```

Useful filtered commands:

```bash
pnpm --filter @wonderland/create-cabure-ceremony build
pnpm --filter @wonderland/create-cabure-ceremony test
pnpm --filter @wonderland/create-cabure-ceremony test:e2e
pnpm --filter @wonderland/cabure-crypto build
pnpm --filter @wonderland/cabure-crypto test
pnpm --filter @wonderland/cabure-cli build
pnpm --filter @wonderland/cabure-cli test
```

Quality gate for changes: run format, build, then tests. `pnpm format` currently delegates to package format scripts and only `@wonderland/create-cabure-ceremony` defines one.

## Packages

| Package | Path | Purpose |
|---------|------|---------|
| `@wonderland/create-cabure-ceremony` | `packages/create-cabure-ceremony` | CLI wizard that scaffolds a fully deployable ceremony project |
| `@wonderland/cabure-crypto` | `packages/crypto` | Published npm package with typed exports for Groth16 Phase 2 ceremony operations |
| `@wonderland/cabure-cli` | `packages/cli` | CLI contributor tool for headless/VM environments |

Always use these exact names. Never use `elixir-wizard`, `elixir-ceremony`, `@wonderland/elixir-wizard`, `@cabure/crypto`, or `@cabure/cli`; those are outdated.

Package implementation map:
- `packages/create-cabure-ceremony/src/index.ts` orchestrates the wizard.
- `packages/create-cabure-ceremony/src/prompts.ts` owns the four interactive prompts.
- `packages/create-cabure-ceremony/src/validate.ts` owns input validation and slug generation.
- `packages/create-cabure-ceremony/src/circuits.ts` owns recursive `.r1cs` discovery/copying and filename de-duplication.
- `packages/create-cabure-ceremony/src/scaffold.ts` copies templates and renders `ceremony.config.ts`.
- `packages/create-cabure-ceremony/templates` is the generated Next.js app.
- `packages/crypto/src` contains the crypto API, worker entrypoint, and shared protocol types.
- `packages/cli/src` contains the `cabure` CLI commands, auth, HTTP client, and shared types.

## Architecture Constraints

1. `@wonderland/cabure-crypto` is a published dependency shared by generated apps and `@wonderland/cabure-cli`. Do not embed or vendor it into templates.
2. Generated projects are a single Next.js app containing both participant UI and API routes.
3. Storage is Vercel-first: zkey files in Vercel Blob, ceremony state/queues/receipts in Upstash Redis (Vercel KV). No IPFS.
4. Browser entropy requires user interaction. Passive CSPRNG alone is insufficient.
5. The headless CLI uses GitHub OAuth device flow through the ceremony server.
6. Target contribution options are 100 (default), 500, 1,000, or custom.
7. `ceremony.config.ts` is the primary generated config surface.

## Wizard Contract

`npx @wonderland/create-cabure-ceremony` asks exactly four questions:

1. Project name
2. Target contributions: 100 (default), 500, 1,000, or custom
3. Optional end date in `YYYY-MM-DD`
4. Optional circuit artifacts path

The target contributions step defaults to 100 when the user presses Enter. Do not add prompts for ptau. The wizard always creates a `circuits/` folder; if a circuit artifacts path is provided, discovered `.r1cs` files are copied into it, otherwise it remains ready for manual setup later.

When `.r1cs` files are discovered, the wizard auto-generates circuit config entries and three tiers:
- `core`: the first circuit after sorting
- `popular`: the first half of sorted circuits
- `all`: all circuits

If no circuits are present at scaffold time, `tiersEnabled` is `false` and `tiers` is empty.

## Generated Project Structure

`npx @wonderland/create-cabure-ceremony` outputs a single Next.js 15 app:

```text
my-ceremony/
├── ceremony.config.ts
├── circuits/
├── package.json
├── next.config.ts
├── .env.example
├── README.md
├── public/
│   ├── genesis/
│   └── finalize/
├── scripts/
│   ├── setup-ptau.ts
│   ├── init-ceremony.ts
│   ├── finalize-ceremony.ts
│   └── reset-ceremony.ts
└── src/
    ├── app/
    │   ├── api/
    │   │   ├── auth/[...nextauth]/
    │   │   └── ceremony/
    │   ├── components/
    │   ├── screens/
    │   ├── globals.css
    │   ├── layout.tsx
    │   └── page.tsx
    ├── hooks/
    ├── lib/
    ├── types/
    ├── utils/
    ├── copy.ts
    └── middleware.ts
```

The generated app uses CSS modules plus design tokens in `globals.css`; it does not use Tailwind.

## Ceremony API Endpoints

API routes live in the generated project under `src/app/api/`.

| Route | Method | Purpose |
|-------|--------|---------|
| `/api/auth/[...nextauth]` | GET/POST | NextAuth GitHub OAuth |
| `/api/ceremony/status` | GET | Public ceremony progress, circuit states, queue lengths |
| `/api/ceremony/queue` | POST | Join the contribution queue |
| `/api/ceremony/queue` | GET | Get authenticated participant queue position |
| `/api/ceremony/circuits/[id]/zkey` | GET | Download current zkey or return JSON info with `?format=json` |
| `/api/ceremony/circuits/[id]/upload` | POST | Create a Vercel Blob client upload token for the queue head |
| `/api/ceremony/circuits/[id]/contribute` | POST | Promote uploaded contribution, verify if enabled, write receipt, advance state |
| `/api/ceremony/receipt` | GET | Public receipt lookup |
| `/api/ceremony/participant/eligibility` | GET | Authenticated tier/circuit eligibility preview |
| `/api/ceremony/participant/receipts` | GET | Authenticated participant receipts |
| `/api/ceremony/auth/cli` | POST/GET | CLI GitHub device-flow initiation and polling |

`src/middleware.ts` protects queue, participant, contribute, and upload routes. Public routes include status, receipt lookup, and zkey download.

## Ceremony Scripts

Generated projects include four operator scripts:

| Script | npm command | Purpose |
|--------|-------------|---------|
| `setup-ptau.ts` | `npm run setup:ptau` | Download matching Powers of Tau file for the configured circuits |
| `init-ceremony.ts` | `npm run init:ceremony` | Generate genesis zkeys, upload to Blob, write manifest to KV, save local transcript under `public/genesis/` |
| `finalize-ceremony.ts` | `npm run finalize:ceremony` | Verify the chain, apply Ethereum RANDAO beacon, export verification keys, save outputs under `public/finalize/` |
| `reset-ceremony.ts` | `npm run reset:ceremony` | Clear configured KV state and Blob zkeys for a fresh start |

Generated projects use npm scripts, not pnpm scripts.

## Ceremony Flow

Operator scaffolds the app, adds or confirms `.r1cs` circuits, runs `setup:ptau`, runs `init:ceremony`, deploys to Vercel, then contributors use the browser UI or `cabure contribute <url>`. Each contribution downloads the current zkey, collects entropy, computes in a Web Worker or CLI process, uploads to Blob, and asks the server to promote the contribution. When the target is reached, the operator runs `finalize:ceremony` to apply an Ethereum RANDAO beacon and produce final parameters.

## Verification and Integrity

- Public crypto APIs use `Uint8Array` inputs/outputs. Avoid `Buffer` in public APIs.
- Per-contribution BN254 pairing checks are optional via `verifyContributions` in `ceremony.config.ts` and default to `false` because serverless timeouts are likely on larger circuits.
- The finalize script verifies the full chain before applying the beacon.
- Prefer `verifyChainForCircuit` when circuit binding matters; it validates that the initial zkey belongs to the expected `(r1cs, ptau)` pair before checking the transcript.
- The server computes zkey SHA-256 hashes from uploaded bytes and treats client-provided hashes as untrusted.
- Chain hash input format is `${previousChainHash}:${contributionHash}:${participantId}:${timestamp}`.
- Genesis previous hash is `0x` followed by 64 zeros.
- Toxic waste and entropy buffers should be zeroed in `finally` blocks where practical.

## CI and Publishing

CI runs on pushes and pull requests to `dev` and `main`. It builds and tests `@wonderland/cabure-crypto` first, then builds/tests `@wonderland/create-cabure-ceremony` and `@wonderland/cabure-cli`. The crypto job also runs a high-severity production audit.

Publishing workflows release packages in dependency order: crypto, create-cabure-ceremony, then CLI. `dev` publishes snapshot versions; `main` and release tags publish stable versions.

## Source Documents

- Root overview: `README.md`
- Wizard docs: `packages/create-cabure-ceremony/README.md`
- Generated app docs: `packages/create-cabure-ceremony/templates/README.md`
- Crypto docs: `packages/crypto/README.md`
- CLI docs: `packages/cli/README.md`

## Linear Project

- Team: Internal / Public Goods (key: BES)
- Project: Caburé
- Use Linear MCP for live status. Do not duplicate stale issue state in onboarding answers.

## Brebaje Alignment

Nico Serrano's Brebaje (github.com/p0tion-tools/brebaje) is a complementary p0tion rebuild. Caburé focuses on wizard + CLI contributor; future merge is possible but not decided.

## Commits

- Use Conventional Commits style for commit messages.
- Never add coauthors.
