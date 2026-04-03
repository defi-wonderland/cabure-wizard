/**
 * Web Worker entry point for contribute().
 *
 * Runs snarkjs contribution in a dedicated thread to avoid blocking the UI.
 * This module calls snarkjs directly (without temp files) for browser compatibility.
 *
 * Message protocol:
 *   Request:  { type: 'contribute', prevZkey: Uint8Array, entropy: Uint8Array, name?: string }
 *   Response: { type: 'result', newZkey: Uint8Array, hash: string }
 *           | { type: 'error', message: string }
 *           | { type: 'progress', stage: string, percent: number }
 */

import {
  RequestType,
  ResponseType,
  type WorkerRequest,
  type WorkerResponse,
} from "./protocol.js";

function post(msg: WorkerResponse, transfer?: Transferable[]) {
  self.postMessage(msg, { transfer: transfer ?? [] });
}

/**
 * Browser-compatible contribute using snarkjs directly.
 * snarkjs.zKey.contribute accepts file paths or objects for I/O.
 * We write the prevZkey to a temp path and read back the result.
 *
 * In browser environments, snarkjs uses memFS via ffjavascript.
 * We leverage {type: "mem"} for the output zkey.
 */
async function browserContribute(
  prevZkey: Uint8Array,
  entropy: Uint8Array,
  name: string,
): Promise<{ zkey: Uint8Array; hash: string }> {
  // Dynamic import so the consumer's bundler resolves snarkjs browser build
  const snarkjs = await import("snarkjs");

  // Write prevZkey to a virtual file for snarkjs
  // snarkjs expects file paths; use the memFS-based approach
  const prevFile = { type: "mem" as const, data: prevZkey };
  const newFile = { type: "mem" as const };

  // snarkjs expects entropy as a string (passes it through TextEncoder).
  // Convert Uint8Array to hex so the full entropy is preserved.
  const entropyHex = Array.from(entropy)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  const hashBytes: Uint8Array = await snarkjs.zKey.contribute(
    prevFile,
    newFile,
    name,
    entropyHex,
  );

  // Extract the result from the mem output
  const zkey = (newFile as { type: "mem"; data?: Uint8Array }).data;
  if (!zkey) {
    throw new Error("snarkjs contribute produced no output data");
  }
  const hex = Array.from(hashBytes)
    .map((b: number) => b.toString(16).padStart(2, "0"))
    .join("");

  return { zkey, hash: `0x${hex}` };
}

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const msg = event.data;

  try {
    switch (msg.type) {
      case RequestType.Contribute: {
        post({ type: ResponseType.Progress, stage: "computing", percent: 0 });

        const result = await browserContribute(
          msg.prevZkey,
          msg.entropy,
          msg.name ?? "contributor",
        );

        post({ type: ResponseType.Progress, stage: "done", percent: 100 });

        // Transfer the zkey buffer to avoid copying
        post(
          {
            type: ResponseType.Result,
            newZkey: result.zkey,
            hash: result.hash,
          },
          [result.zkey.buffer],
        );

        // Zero the entropy input (toxic waste)
        msg.entropy.fill(0);
        break;
      }

      case RequestType.GenerateEntropy: {
        const data = new Uint8Array(64);
        crypto.getRandomValues(data);
        post({ type: ResponseType.Entropy, data }, [data.buffer]);
        break;
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    post({ type: ResponseType.Error, message });
  }
};
