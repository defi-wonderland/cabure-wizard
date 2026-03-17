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
   - Copy matching `.wasm` files manually into `circuits/`
   - If skipped, `circuits/` remains empty

## Usage

```bash
npx create-cabure-ceremony
```

After generation:

```bash
cd <generated-project-slug>
# optional: copy your .r1cs and .wasm files into ./circuits if you skipped prompt #4
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
