export enum RequestType {
  Contribute = "contribute",
  GenerateEntropy = "generateEntropy",
}

export enum ResponseType {
  Result = "result",
  Entropy = "entropy",
  Error = "error",
  Progress = "progress",
}

/** Messages sent TO the worker */
export type WorkerRequest =
  | {
      type: RequestType.Contribute;
      prevZkey: Uint8Array;
      entropy: Uint8Array;
      name?: string;
    }
  | {
      type: RequestType.GenerateEntropy;
    };

/** Messages sent FROM the worker */
export type WorkerResponse =
  | {
      type: ResponseType.Result;
      newZkey: Uint8Array;
      hash: string;
    }
  | {
      type: ResponseType.Entropy;
      data: Uint8Array;
    }
  | {
      type: ResponseType.Error;
      message: string;
    }
  | {
      type: ResponseType.Progress;
      stage: string;
      percent: number;
    };
