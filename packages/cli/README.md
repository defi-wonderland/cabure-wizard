# @wonderland/cabure-cli

CLI contributor tool for Groth16 Phase 2 trusted setup ceremonies. Lets power users contribute from VMs, servers, or headless environments where a browser UI is unavailable or memory is a bottleneck.

## Usage

```bash
npx @wonderland/cabure-cli status https://ceremony.example.com
npx @wonderland/cabure-cli contribute https://ceremony.example.com
```

### `status`

Show ceremony status and circuit information.

```bash
cabure status <url>
```

### `contribute`

Authenticate, join the queue, download the current zkey, compute a contribution, upload, and submit — for every circuit (or a specific one).

```bash
cabure contribute <url>
cabure contribute <url> --circuit deposit
cabure contribute <url> --tier core
cabure contribute <url> --token <jwt>
```

| Flag | Description | Default |
| --- | --- | --- |
| `--circuit <id>` | Contribute to a single circuit only | all incomplete circuits |
| `--tier <id>` | Contribute to a specific tier | all incomplete circuits |
| `--token <jwt>` | Skip authentication, use a pre-existing CLI JWT | interactive device flow |

## Authentication

Uses the GitHub OAuth **device flow** (RFC 8628). The ceremony server proxies the flow so the CLI never needs the OAuth client ID or secret.

```
  Visit https://github.com/login/device and enter code: ABCD-1234
```

1. The CLI asks the ceremony server to initiate the device flow.
2. The server returns a user code and verification URI.
3. The CLI opens the browser (best-effort) and displays the code.
4. The user enters the code on GitHub and authorizes.
5. The CLI polls the server until authorization completes, then receives a signed JWT.
6. The JWT is stored in `~/.cabure/auth.json` (owner-only permissions) and reused for subsequent runs.

Tokens expire after 7 days. If a stored token is expired, the CLI re-initiates the device flow automatically.

## Operator requirements

For the device flow to work, the ceremony operator must check **Enable Device Flow** in their GitHub OAuth App settings.

## Contribution flow

For each circuit:

1. **Queue** — join the contribution queue and poll until at the front.
2. **Download** — fetch the current zkey from Vercel Blob, verify its SHA-256 hash.
3. **Entropy** — generate 64 bytes from the system CSPRNG (`node:crypto.randomBytes`).
4. **Compute** — run `zKey.contribute()` via `@wonderland/cabure-crypto`.
5. **Upload** — upload the contributed zkey to Vercel Blob via `@vercel/blob/client`.
6. **Submit** — POST the blob URL and contribution hash to the ceremony server for validation.

## Development

```bash
pnpm install          # from monorepo root
pnpm --filter @wonderland/cabure-cli build
pnpm --filter @wonderland/cabure-cli test
```

The build uses esbuild to bundle `src/index.ts` into `dist/index.js` (ESM, Node platform).

## Dependencies

- `@wonderland/cabure-crypto` — snarkjs contribute/verify/entropy
- `@vercel/blob` — client upload to Vercel Blob
- `commander` — argument parsing
