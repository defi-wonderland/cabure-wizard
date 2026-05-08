/**
 * Web Worker entry point for contribute(). Runs snarkjs contribution in a
 * dedicated thread to avoid blocking the UI. Message protocol is defined by
 * `WorkerRequest` and `WorkerResponse` in `./protocol.ts`.
 *
 * Toxic-waste hygiene: entropy passes through immutable JS strings on its
 * way into snarkjs and cannot be fully erased. The handler zeros the input
 * buffer after the result is posted, but for full hygiene the consumer
 * should terminate the worker as soon as the result has been transferred.
 */

import {
  RequestType,
  ResponseType,
  type WorkerRequest,
  type WorkerResponse,
} from "./protocol.js";
import { browserContribute } from "./browser-contribute.js";

/**
 * Minimal structural type for the worker scope, so the handler is testable
 * with a plain object instead of mutating `globalThis.self`.
 */
export interface WorkerScope {
  postMessage(
    msg: WorkerResponse,
    options?: { transfer?: Transferable[] },
  ): void;
  onmessage:
    | ((event: MessageEvent<WorkerRequest>) => unknown)
    | null;
}

/**
 * Bind the contribute-worker message handler to a worker-like scope. The real
 * worker entry below calls this once with the global `self`; tests call it
 * with a mock object.
 */
export function attachWorker(target: WorkerScope): void {
  const post = (msg: WorkerResponse, transfer?: Transferable[]) => {
    target.postMessage(msg, { transfer: transfer ?? [] });
  };

  target.onmessage = async (event: MessageEvent<WorkerRequest>) => {
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

          post(
            {
              type: ResponseType.Result,
              newZkey: result.zkey,
              hash: result.hash,
            },
            [result.zkey.buffer],
          );

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
}

// Real worker entry. In Node (tests importing this module), `self` is
// undefined and this is a no-op — tests call `attachWorker(mock)` directly.
if (typeof self !== "undefined") {
  attachWorker(self as unknown as WorkerScope);
}
