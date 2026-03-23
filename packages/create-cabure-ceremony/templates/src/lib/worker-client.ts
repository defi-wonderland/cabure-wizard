import {
  RequestType,
  ResponseType,
  type WorkerResponse,
} from "@defi-wonderland/cabure-crypto/protocol";

export interface ContributionResult {
  zkey: Uint8Array;
  hash: string;
}

export async function runContribution(options: {
  prevZkey: Uint8Array;
  entropy: Uint8Array;
  name?: string;
  onProgress?: (percent: number) => void;
  signal?: AbortSignal;
}): Promise<ContributionResult> {
  return await new Promise((resolve, reject) => {
    const worker = new Worker(
      new URL("@defi-wonderland/cabure-crypto/worker", import.meta.url),
      { type: "module" },
    );

    const cleanup = () => {
      worker.terminate();
      options.signal?.removeEventListener("abort", onAbort);
    };

    const onAbort = () => {
      cleanup();
      reject(new Error("Contribution cancelled."));
    };

    if (options.signal?.aborted) {
      onAbort();
      return;
    }

    options.signal?.addEventListener("abort", onAbort, { once: true });

    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const msg = event.data;
      if (msg.type === ResponseType.Progress) {
        options.onProgress?.(msg.percent);
      }

      if (msg.type === ResponseType.Result) {
        cleanup();
        resolve({ zkey: msg.newZkey, hash: msg.hash });
      }

      if (msg.type === ResponseType.Error) {
        cleanup();
        reject(new Error(msg.message));
      }
    };

    worker.onerror = (event) => {
      cleanup();
      reject(new Error(event.message));
    };

    worker.postMessage(
      {
        type: RequestType.Contribute,
        prevZkey: options.prevZkey,
        entropy: options.entropy,
        name: options.name,
      },
      [options.prevZkey.buffer, options.entropy.buffer],
    );
  });
}
