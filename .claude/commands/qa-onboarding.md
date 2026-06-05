Walk the QA engineer through the Caburé project onboarding. This is designed for Laruku but works for any QA person joining the project.

Read `.claude/CLAUDE.md` first, then guide the QA engineer through these steps:

## 1. What You're Testing

Caburé is a Groth16 Phase 2 trusted setup ceremony toolkit. Your job is to make sure the full ceremony flow works end-to-end — from `npx @wonderland/create-cabure-ceremony` all the way to a finalized zkey with an Ethereum RANDAO beacon applied.

Three packages to test:
- `@wonderland/cabure-crypto` — the cryptographic primitives (Lumi built this)
- `@wonderland/create-cabure-ceremony` — the CLI wizard + generated project (Ardy built this)
- `@wonderland/cabure-cli` — the headless CLI contributor tool (Ardy built this)

## 2. Architecture You Need to Know

The generated project is a **single Next.js app** — UI screens and API routes live together:

- **`src/app/screens/`** — participant-facing screens (Landing, Entropy, Tier, Progress, Complete, Verify). Test: entropy collection, Web Worker computation, browser compatibility, screen flow, error states.
- **`src/app/api/ceremony/`** — API routes managing queue, contributions, verification, receipts. Test: queue management, contribution verification, auth flows, timeout handling, race conditions.
- **`src/app/api/auth/[...nextauth]/`** — GitHub OAuth via NextAuth. Test: sign-in, session expiration, protected routes, callback failures.
- **`src/app/api/ceremony/auth/cli`** — CLI device-flow auth. Test: device code polling, expiration, denial, token usage.
- **`@wonderland/cabure-cli`** — headless contributor. Test: GitHub device flow auth, large circuit streaming, progress reporting, error recovery.

Storage is Vercel-first:
- **Vercel Blob** holds zkey files (genesis, intermediate, final).
- **Upstash Redis (Vercel KV)** holds ceremony state (manifest, queue, receipts, chain hashes).

Key things to watch for:
- API routes read/write KV on every request; race conditions on queue/state are possible.
- Entropy requires user interaction (mouse/clicks). The UI should NOT let you proceed without enough entropy.
- Test what happens when KV or Blob is slow, rate-limited, or returns stale data.
- Chain hash integrity — verify the SHA-256 chain is tamper-evident across contributions.
- Per-contribution BN254 pairing verification is optional (`verifyContributions` in `ceremony.config.ts`, default `false`). The finalize script always verifies the full chain before applying the beacon.
- Participant routes include `/api/ceremony/participant/eligibility` and `/api/ceremony/participant/receipts`; test both browser session auth and CLI bearer-token behavior where applicable.

## 3. Your Test Plan

Check Linear for QA issues. Use the Linear MCP to list current issues in the Caburé project assigned to the QA engineer or matching the requested $ARGUMENTS focus. Treat Linear as the live source of truth and do not rely on old hard-coded issue IDs or dates.

Present the current QA plan grouped by priority/status and cover these areas:

- End-to-end ceremony with a toy circuit and multiple contributors.
- Contributor drop-off, queue timeout, duplicate contribution, and replay attempts.
- Browser compatibility in Chrome, Firefox, and Safari.
- Web Worker behavior and main-thread responsiveness during contribution computation.
- CLI wizard prompts, scaffolding, circuit copy, and generated scripts.
- CLI contributor status/contribute flows, device-flow auth, receipts, and recovery paths.
- Storage failures: unavailable KV, unavailable Blob, stale state, corrupted zkeys, swapped Blob URLs.
- Security checks: protected route access, fake contribution hashes, participant receipt access, auth bypass attempts.
- Performance checks with larger zkeys and many queued contributors.
- Final sign-off: finalized zkey, exported verification key, full chain verification, and Ethereum RANDAO beacon application.

For each live Linear issue, show the identifier, title, priority, assignee, status, and any blocker.

## 4. Test Environment Setup

Guide them through repository checks first:

```bash
pnpm install
pnpm format
pnpm build
pnpm test
pnpm test:e2e
```

Then guide them through getting a local generated app running:

```bash
# 1. Scaffold a test ceremony
npx @wonderland/create-cabure-ceremony
# Use: "QA Test Ceremony", small custom target (e.g. 10), optional end date, and a toy .r1cs artifacts path when available

# 2. Provision Vercel storage
cd my-ceremony
vercel link                         # link the project
# In the Vercel dashboard → Storage tab:
#   - create a Blob store
#   - create a KV (Upstash) store
vercel env pull .env.local          # pull the generated BLOB/KV env vars

# 3. Start locally
npm install
npm run setup:ptau
npm run init:ceremony
npm run dev
# App: http://localhost:3000

# 4. Test the CLI contributor against the local app
npx @wonderland/cabure-cli status http://localhost:3000
npx @wonderland/cabure-cli contribute http://localhost:3000
# Or, after installation, use the actual bin:
cabure contribute http://localhost:3000
```

For the toy circuit, use the smallest possible `.r1cs` file to keep iteration fast. Save production-size circuits and large zkeys for performance testing. If no circuit path is provided during scaffolding, `circuits/` is still created and can be populated manually before running `npm run setup:ptau`.

## 5. What to Prioritize

Use current Linear status and release timing to prioritize. A sensible order is:
1. Happy-path e2e ceremony with toy circuits.
2. Browser and CLI compatibility.
3. Queue, auth, storage, and contribution failure scenarios.
4. Security and tamper checks.
5. Larger circuit performance and final sign-off.

## 6. Questions

Ask the QA engineer:
1. Do you have a toy circuit (.r1cs) available for testing? If not, Lumi can provide one.
2. Do you have a Vercel account with permission to create Blob and KV (Upstash) stores in the target project?
3. Any specific areas you're concerned about?

If $ARGUMENTS contains a specific focus (e.g. "security", "browser", "e2e"), dive deeper into that area.
