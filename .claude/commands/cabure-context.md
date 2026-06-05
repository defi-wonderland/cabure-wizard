Load the Caburé project context for the current development session.

1. Read `.claude/CLAUDE.md` to load architecture decisions, naming conventions, workflow commands, and project knowledge.

2. Present a brief orientation:

**You're working on Caburé** — a Groth16 Phase 2 trusted setup ceremony toolkit.

Three packages:
- `@wonderland/cabure-crypto` — ceremony primitives (Lumi)
- `@wonderland/create-cabure-ceremony` — CLI wizard (Ardy)
- `@wonderland/cabure-cli` — headless contributor tool (Ardy)

Key conventions:
- pnpm workspace in this repo; use `pnpm install`, `pnpm format`, `pnpm build`, `pnpm test`, and `pnpm test:e2e` from the root.
- Generated ceremonies are single Next.js apps with UI screens and API routes together.
- Vercel Blob stores zkeys; Upstash Redis/Vercel KV stores manifest, queues, receipts, state, and locks.
- The wizard asks 4 prompts: project name, target contributions, optional end date, optional circuit artifacts path.
- Target contributions default to 100; there is no ptau prompt.
- Tiers are auto-generated from discovered `.r1cs` circuits.
- Browser crypto runs in a Web Worker and requires user interaction for entropy.
- The CLI uses GitHub OAuth device flow through the ceremony app.
- Chain hash format is `${previousChainHash}:${contributionHash}:${participantId}:${timestamp}`.

3. If $ARGUMENTS mentions a specific package or area (e.g. "wizard", "templates", "api", "storage", "auth", "crypto", "cli", "qa"), focus the context on that area and list relevant details from `.claude/CLAUDE.md`.

4. Ask what the developer wants to work on today.
