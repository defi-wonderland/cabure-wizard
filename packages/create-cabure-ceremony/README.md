# create-cabure-ceremony

CLI wizard that scaffolds a deploy-ready ceremony app in one command.

## What it generates today

- A single Next.js app scaffold
- `ceremony.config.ts` with initial ceremony settings
- Empty `circuits/` directory (you copy `.r1cs` and `.wasm` files manually)
- API route stubs under `app/api/ceremony/*`
- Minimal `vercel.json`

Current wizard prompts:

1. Project name
2. Target contributions (`100`, `500`, `1000`, or custom)
3. End date (optional `YYYY-MM-DD`)
4. Circuit artifacts path (optional)
   - If provided, `.r1cs` files are discovered and copied into generated `circuits/`
   - If skipped, `circuits/` remains empty

## Usage

```bash
npx create-cabure-ceremony
```

After generation:

```bash
cd <generated-project-slug>
# optional: copy your .r1cs files into ./circuits if you skipped prompt #4
# update ceremony.config.ts with your circuit IDs and filenames
npm install
npm run dev
```

## Local development (inside this monorepo)

From repository root:

```bash
pnpm --filter create-cabure-ceremony build
pnpm --filter create-cabure-ceremony test
```

## Local `npx` test guide (smoke test)

This simulates how users run the package with `npx`, but uses your local package folder.

1) Build the package:

```bash
cd /Users/leo/defi/cabure/cabure-wizard
pnpm --filter create-cabure-ceremony build
```

2) Run from a temp folder (recommended):

```bash
mkdir -p /tmp/cabure-wizard-smoke
cd /tmp/cabure-wizard-smoke
npx --yes --package /Users/leo/defi/cabure/cabure-wizard/packages/create-cabure-ceremony create-cabure-ceremony
```

3) Validate output:

- A new folder with your project slug exists
- `ceremony.config.ts` exists
- `circuits/` exists (contains copied `.r1cs` files if you provided a path)
- `app/` and `vercel.json` exist

## Troubleshooting local `npx` resolution

If you see errors similar to:

- `Cannot find package ... ffjavascript/index.js`

your local pnpm store may be corrupted. From repo root:

```bash
pnpm store prune
pnpm install --force --no-frozen-lockfile
```
