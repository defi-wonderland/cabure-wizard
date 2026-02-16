/** Messages sent TO the worker */
export type WorkerRequest =
  | {
      type: "contribute";
      prevZkey: Uint8Array;
      entropy: Uint8Array;
      name?: string;
    }
  | {
      type: "generateEntropy";
    };

/** Messages sent FROM the worker */
export type WorkerResponse =
  | {
      type: "result";
      newZkey: Uint8Array;
      hash: string;
    }
  | {
      type: "entropy";
      data: Uint8Array;
    }
  | {
      type: "error";
      message: string;
    }
  | {
      type: "progress";
      stage: string;
      percent: number;
    };
