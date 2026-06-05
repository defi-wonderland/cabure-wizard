Walk a new contributor through Caburé onboarding. This is for anyone joining the project who needs the full picture across crypto, wizard, generated app, CLI, QA, or operations.

Read `.claude/CLAUDE.md` first, then guide them through these steps:

## 1. What is Caburé?

Explain in plain terms:
- Groth16 is a zero-knowledge proof system. Before a Groth16 circuit can be used in production, it needs a trusted setup ceremony where many people contribute randomness.
- Caburé makes these ceremonies easier to run. An operator runs `npx @wonderland/create-cabure-ceremony` and gets a deployable ceremony app.
- Contributors participate through the website or with the headless `cabure` CLI. The ceremony is secure as long as one participant honestly contributed and destroyed their secret randomness.

## 2. The Three Packages

Walk through each package:

**`@wonderland/create-cabure-ceremony`**
- The primary operator entrypoint.
- Asks 4 questions: project name, target contributions, optional end date, optional circuit artifacts path.
- Scaffolds a single Next.js app from `packages/create-cabure-ceremony/templates`.
- Always creates `circuits/`; copies discovered `.r1cs` files when a circuit artifacts path is provided.

**`@wonderland/cabure-crypto`**
- The cryptographic engine.
- Typed exports for generating initial zkeys, contributing, verifying, verifying chains, generating entropy, applying beacons, and exporting verification keys.
- Used by the generated app and the CLI. Browser contributions run in a Web Worker.

**`@wonderland/cabure-cli`**
- Headless contributor tool for VMs, servers, and terminal-first contributors.
- Actual bin name is `cabure`, with commands such as `cabure status <url>` and `cabure contribute <url>`.
- Uses GitHub OAuth device flow through the ceremony app.

## 3. Architecture at a Glance

Present the generated app structure:

```text
my-ceremony/
├── ceremony.config.ts
├── circuits/
├── package.json
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
    │   ├── screens/
    │   └── components/
    ├── hooks/
    ├── lib/
    ├── types/
    ├── utils/
    ├── copy.ts
    └── middleware.ts
```

Key points:
- Generated projects are single Next.js 15 apps, not separate coordinator/frontend deployments.
- Vercel Blob stores zkey binaries.
- Upstash Redis/Vercel KV stores manifest, circuit state, queues, receipts, participant contribution sets, and locks.
- `ceremony.config.ts` is the primary config surface.
- Tiers are auto-generated from discovered circuits; contributors choose a tier in the UI.
- Entropy requires mouse/click interaction in the browser.

## 4. How a Ceremony Works

Walk through the lifecycle:
1. Operator runs `npx @wonderland/create-cabure-ceremony` and answers the 4 prompts.
2. Operator adds or confirms `.r1cs` files in `circuits/`.
3. Operator provisions Vercel Blob and KV, then runs `npm run setup:ptau` and `npm run init:ceremony`.
4. Contributors authenticate, join the queue, collect entropy, compute the contribution in a Web Worker or CLI, upload the result, and receive a receipt.
5. The server stores promoted zkeys in Blob, updates KV state, and maintains a SHA-256 chain hash.
6. When ready, the operator runs `npm run finalize:ceremony` to verify the chain and apply an Ethereum RANDAO beacon.

## 5. Development Workflow

For repository work, use pnpm from the monorepo root:

```bash
pnpm install
pnpm format
pnpm build
pnpm test
pnpm test:e2e
```

For generated app work, use npm inside the generated project:

```bash
npm install
npm run setup:ptau
npm run init:ceremony
npm run dev
```

## 6. Useful Commands

Point them to the other Claude Code commands available:
- `/cabure-status` — check live Linear milestones and issues.
- `/cabure-context` — quick orientation for a dev session.
- `/dev-onboarding` — deep dive for TypeScript developers.
- `/qa-onboarding` — deep dive for QA engineers.

## 7. Key Resources

- `.claude/CLAUDE.md` — canonical agent/dev brief.
- `README.md` — public repository overview.
- `packages/create-cabure-ceremony/README.md` — wizard usage and local testing.
- `packages/create-cabure-ceremony/templates/README.md` — generated app operator workflow.
- `packages/crypto/README.md` — crypto API and security notes.
- `packages/cli/README.md` — headless CLI usage.
- Linear project — live issue tracking.
- Brebaje (github.com/p0tion-tools/brebaje) — complementary p0tion rebuild and possible future alignment.

## 8. Questions

Ask:
1. What is your role on the project?
2. Are you familiar with Groth16 trusted setup ceremonies, or would you like a deeper explanation?
3. What would you like to start with?

If $ARGUMENTS contains a role such as "dev", "qa", "crypto", "operator", or "cli", suggest the specialized onboarding path for that role.
