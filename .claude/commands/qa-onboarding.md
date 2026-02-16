Walk the QA engineer through the Caburé project onboarding. This is designed for Laruku but works for any QA person joining the project.

Read `CLAUDE.md` at the project root first, then guide the QA engineer through these steps:

## 1. What You're Testing

Caburé is a Groth16 Phase 2 trusted setup ceremony toolkit. Your job is to make sure the full ceremony flow works end-to-end — from `npx create-cabure-ceremony` all the way to a finalized zkey with a drand beacon applied.

Three packages to test:
- `@cabure/crypto` — the cryptographic primitives (Lumi built this)
- `create-cabure-ceremony` — the CLI wizard + generated project (Ardy built this)
- `@cabure/cli` — the headless CLI contributor tool (Ardy built this)

## 2. Architecture You Need to Know

Walk through the separated architecture at a testing level:
- **coordinator/** — stateless serverless function. Test: queue management, contribution verification, IPFS state consistency, auth flows, timeout handling
- **frontend/** — static site with 6 screens. Test: entropy collection, Web Worker computation, browser compatibility, screen flow, error states
- **`@cabure/cli`** — headless contributor. Test: device flow auth, streaming for large circuits, progress reporting, error recovery

Key things to watch for:
- Coordinator is stateless — every request reads/writes IPFS. Race conditions are possible.
- Entropy requires user interaction (mouse/clicks). The frontend should NOT let you proceed without enough entropy.
- IPFS-first storage — test what happens when IPFS is slow, down, or returns stale data.
- Chain hash integrity — verify the SHA-256 chain is tamper-evident across contributions.

## 3. Your Test Plan

Check Linear for QA issues. Use the Linear MCP to list issues in the Caburé project assigned to the QA engineer. Present them with priorities:

- **BES-1356** (Urgent) — End-to-end ceremony test + failure scenarios
  - Full ceremony with toy circuit and 3+ contributors
  - Contributor drops mid-contribution
  - Queue timeout scenarios
  - IPFS unavailable during contribution
  - Duplicate contribution attempts

- **BES-1357** (High) — Browser compatibility + CLI tools testing
  - WASM in Chrome, Firefox, Safari (Web Worker must not block main thread)
  - CLI wizard: prompts, scaffolding, deploy scripts
  - CLI contributor: device flow auth, large file streaming, receipt generation

- **BES-1358** (High) — Security review + performance testing
  - Auth bypass attempts (skip queue, fake contribution hash, replay attacks)
  - State tampering (modified IPFS state, corrupted zkeys)
  - Entropy quality (is the frontend actually enforcing the mouse/click threshold?)
  - Large circuits (>100 MB zkeys) — memory, timing, streaming
  - Many contributors (simulate 50+ concurrent queue entries)

- **BES-1359** (Urgent, due Mar 27) — Final sign-off
  - Complete ceremony from `npx create-cabure-ceremony` to finalized zkey
  - Every screen works, every API route works, chain hash is valid, beacon is applied
  - This is the gate — nothing ships without your sign-off

## 4. Test Environment Setup

Guide them through getting a local test environment running:
```bash
# 1. Scaffold a test ceremony
npx create-cabure-ceremony
# Use: "QA Test Ceremony", 10 contributions, IPFS, no tiers

# 2. Start locally
cd my-ceremony
npm install
npm run dev
# Frontend: localhost:3000, Coordinator: localhost:3001

# 3. Test CLI contributor against local coordinator
npx @cabure/cli contribute http://localhost:3001
```

For the toy circuit, use the smallest possible r1cs file to keep iteration fast. Save the production-size circuits for BES-1358 performance testing.

## 5. What to Prioritize

Testing window is Mar 16 – Mar 27 (2 weeks). Suggested order:
1. **Week 1 (Mar 16–20):** BES-1356 (e2e) + BES-1357 (browser/CLI) — get the happy path solid first
2. **Week 2 (Mar 23–27):** BES-1358 (security/perf) + BES-1359 (final sign-off) — break things, then certify

## 6. Questions

Ask the QA engineer:
1. Do you have a toy circuit (.r1cs + .wasm) available for testing? If not, Lumi can provide one.
2. Are you set up with IPFS locally (e.g. Pinata account or local IPFS node)?
3. Any specific areas you're concerned about?

If $ARGUMENTS contains a specific focus (e.g. "security", "browser", "e2e"), dive deeper into that area.
