# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What is Caburé

Caburé is an open-source CLI wizard and toolkit for running Groth16 Phase 2 trusted setup ceremonies, replacing p0tion + DefinitelySetup.

## Packages

| Package | Purpose |
|---------|---------|
| `@wonderland/cabure-crypto` | Published npm package — typed exports for all Groth16 Phase 2 ceremony operations |
| `@wonderland/create-cabure-ceremony` | CLI wizard that scaffolds a fully deployable ceremony project |
| `@wonderland/cabure-cli` | CLI contributor tool for headless/VM environments |

**Naming**: Always use these exact names. Never use `elixir-wizard`, `elixir-ceremony`, `@wonderland/elixir-wizard`, `@cabure/crypto`, or `@cabure/cli` — those are outdated.

## Architecture Constraints (non-negotiable)

1. **`@wonderland/cabure-crypto` is a published dependency** — shared across wizard, frontend, CLI. Never embed or vendor it.
2. **Separated architecture** — Generated projects have three independent parts:
   - `coordinator/` — Next.js API routes (Vercel) or standalone serverless function
   - `frontend/` — Static site, zero server dependencies
   - `crypto/` — Imports from `@wonderland/cabure-crypto`
3. **IPFS-first storage** — Ceremony state as content-addressed JSON, zkeys pinned to IPFS. S3 is an alternative, not the default.
4. **Interactive tier assignment** — Wizard asks "Do you want contribution tiers? (Y/n)", operator configures interactively. Not automatic by count.
5. **User interaction required for entropy** — Minimum threshold of mouse movement/click entropy. Passive CSPRNG alone is insufficient.
6. **GitHub OAuth device flow** for CLI — Enables headless/VM auth without browser redirect.
7. **Target contribution options**: 100 / 500 / 1,000 / custom.

## @wonderland/cabure-crypto API

Uses snarkjs 0.7.5 in-memory I/O pattern: `Uint8Array` in, `{ type: "mem" }` output ref. Includes a WASM build of `contribute()` for browser Web Workers.

```typescript
generateInitialZkey(r1csPath: string): Promise
contribute(zkeyIn: Uint8Array, entropy: Uint8Array): Promise
verify(zkeyIn: Uint8Array, contribution: Contribution): Promise
verifyChain(zkeys: Uint8Array[]): Promise
generateEntropy(sources: EntropySource[]): Promise
applyBeacon(zkeyIn: Uint8Array, beaconHash: string): Promise
```

## Generated Project Structure

`npx @wonderland/create-cabure-ceremony` outputs:

```
my-ceremony/
├── coordinator/     # Stateless serverless function
├── frontend/        # Static site
├── crypto/          # Imports from @wonderland/cabure-crypto
├── ceremony.config.json
├── circuits/
├── deploy/
└── README.md
```

## Coordinator API

Stateless serverless function with IPFS-backed state (content-addressed JSON, new pin per mutation).

| Endpoint | Purpose |
|----------|---------|
| `POST /join` | Enter queue (GitHub OAuth required) |
| `GET /status` | Ceremony progress, current contributor, queue |
| `GET /contribute/:id` | Download current zkey |
| `POST /contribute/:id` | Upload contribution + proof |
| `GET /verify/:id` | Verify a specific contribution |
| `GET /chain` | Full contribution chain with SHA-256 hashes |
| `POST /finalize` | Apply beacon (operator only) |

## Wizard Prompts (7 questions)

1. Ceremony name
2. Circuit files (.r1cs) — multiple allowed
3. Target contributions (100 / 500 / 1,000 / custom)
4. Contribution tiers? (Y/n) — if yes, configure interactively
5. Storage backend (IPFS recommended / S3)
6. Branding (logo, colors, ceremony description)
7. Deploy targets (Vercel / AWS / Docker / manual)

## Ceremony Flow

Operator scaffolds → deploys coordinator + frontend separately → contributors visit frontend or use CLI → each contribution: download zkey → collect entropy → compute in Web Worker/CLI → upload → verify → when target reached, operator applies Ethereum RANDAO beacon to finalize.

## Verification

- BN254 pairing checks per contribution
- SHA-256 hash chain from genesis to latest
- Public audit endpoint for any contribution
- Ethereum RANDAO beacon for finalization randomness (drand Quicknet also supported)

## Linear Project

- Team: **Internal / Public Goods** (key: BES)
- Project: **Caburé** (target: Mar 27, 2026)
- 6 milestones: Idea Draft, Tech Design, @wonderland/cabure-crypto Development, @wonderland/create-cabure-ceremony Development, CLI Contributor Development, QA

## Brebaje Alignment

Nico Serrano's Brebaje (github.com/p0tion-tools/brebaje) is a complementary p0tion rebuild. Caburé focuses on wizard + CLI contributor; future merge is possible but not decided.

## Commits
- Always use commitlint convention.
- NEVER add coauthors.
