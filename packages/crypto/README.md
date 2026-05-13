# @wonderland/cabure-crypto

Typed Groth16 Phase 2 ceremony primitives for [Caburé](https://github.com/defi-wonderland/cabure-wizard). Wraps [snarkjs](https://github.com/iden3/snarkjs) with `Uint8Array` in / `Uint8Array` out APIs and a browser-friendly Web Worker entry point.

This package is consumed by the Caburé wizard, the generated ceremony app, and `@wonderland/cabure-cli`. It is published to npm and can be used directly by any Groth16 Phase 2 tool.

## Install

```bash
npm install @wonderland/cabure-crypto
```

## API

The functions below accept the input types shown in the table and return either `Uint8Array`, `boolean`, or a verification-key object. snarkjs's file-based I/O is handled internally via temp directories (Node) or memFS (browser worker).

```ts
import {
  generateInitialZkey,
  contribute,
  verify,
  verifyChain,
  verifyChainForCircuit,
  generateEntropy,
  applyBeacon,
  exportVerificationKey,
} from "@wonderland/cabure-crypto";
```

| Function | Purpose |
| --- | --- |
| `generateInitialZkey(ptau, r1cs)` | Generate the genesis zkey from Powers of Tau + R1CS |
| `contribute(prevZkey, entropy, name?)` | Apply a contribution; returns `{ zkey, contributionHash, zkeyHash }` |
| `verify(r1cs, ptau, zkey)` | Verify a zkey extends a chain rooted in (r1cs, ptau) |
| `verifyChain(ptau, initialZkey, latestZkey)` | Verify the chain embedded in `latestZkey` reaches `initialZkey` (taken as trusted) |
| `verifyChainForCircuit(r1cs, ptau, initialZkey, latestZkey)` | Same as `verifyChain` but first checks `initialZkey` is a valid genesis for `(r1cs, ptau)` |
| `generateEntropy(sources?)` | Combine WebCrypto CSPRNG with optional additional sources |
| `applyBeacon(zkey, beaconHash, numIterationsExp?)` | Apply a public randomness beacon to finalize; returns `{ zkey, contributionHash, zkeyHash }` |
| `exportVerificationKey(zkey)` | Extract the Groth16 verification key |

### Browser worker

The package ships a self-contained Web Worker bundle for browser callers:

```ts
import {
  RequestType,
  ResponseType,
  type WorkerRequest,
  type WorkerResponse,
} from "@wonderland/cabure-crypto/protocol";

const worker = new Worker(
  new URL("@wonderland/cabure-crypto/worker", import.meta.url),
  { type: "module" },
);
```

Use the typed `WorkerRequest` / `WorkerResponse` discriminated unions when posting messages. The worker implements `contribute()` and a CSPRNG `generateEntropy` request.

## Determinism across Node and browser

Identical entropy bytes produce identical snarkjs contribution hashes whether `contribute()` is called via the Node API or via the browser worker. Both code paths encode entropy as lowercase hex without a `0x` prefix. snarkjs encodes that string via `TextEncoder` and mixes the bytes into its RNG, so any divergence in the encoding would change the contribution; the shared `bytesToHexRaw` helper guards against this drift.

## Toxic waste and zeroization

A Phase 2 contribution involves a fresh trapdoor τ derived from your entropy. If τ leaks, an attacker can forge proofs for the resulting circuit; correctly destroying it is essential.

This library makes a **best-effort** attempt to zero the input entropy buffer after each contribution. **It is not a guarantee.** Be honest with yourself about the limits:

- snarkjs (as of 0.7.x) accepts entropy only as a string. `contribute()` therefore converts the input `Uint8Array` to a hex string before handing it off. JavaScript strings are immutable and live in V8's heap until the garbage collector runs (and even then, freed string buffers are not reliably wiped). The library cannot zero those copies.
- snarkjs internally re-encodes the entropy string via `TextEncoder` into its own `Uint8Array`, then mixes it via Blake2b with 64 bytes from `getRandomBytes`. Those internal buffers are not zeroed by snarkjs either.
- The `entropy.fill(0)` call in `contribute()` zeros only the caller's original buffer. It is a defense-in-depth measure, not a complete erasure.

What this means in practice:

1. The buffer you pass in is still useful to zero — it prevents accidental persistence in long-running callers (e.g. CLI processes that don't exit immediately).
2. The most reliable defense is **process isolation**: run `contribute()` in a short-lived Node process or a Web Worker, and exit / terminate it as soon as the result is consumed. The OS will reclaim the memory pages and reuse them for unrelated workloads.
3. snarkjs mixes its own `getRandomBytes(64)` into the trapdoor before you ever see it, so leaking only the user-supplied entropy does not by itself reconstruct τ — but do not rely on this as a primary defense.

If your threat model includes a memory-scraping attacker on the same host while the contributor is online, do not contribute from that host.

### Recommended caller patterns

**CLI / Node:**

```ts
// In a child process or a one-shot script:
const result = await contribute(prevZkey, entropy, name);
// Persist result, then exit immediately.
process.exit(0);
```

**Browser:**

```ts
// In the main thread:
const worker = new Worker(/* ... */);
worker.postMessage(/* ... */, [entropy.buffer, prevZkey.buffer]);
// On receiving the result:
worker.terminate();
```

Transferring the buffers (rather than copying) means the main thread no longer holds the entropy after `postMessage`. Terminating the worker after the result kills the only context that still holds the snarkjs internals.

## License

MIT
