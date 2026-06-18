// snarkjs (through fastfile) does not always close file handles explicitly —
// the handle is closed later by the garbage collector. On recent Node a
// GC-closed FileHandle surfaces as an uncaught `ERR_INVALID_STATE` that fires
// asynchronously, outside any try/catch around the snarkjs call, and would
// otherwise crash the process mid-request (the client sees an empty response).
//
// The ceremony scripts (init, setup-ptau, finalize) guard the same error.
// Importing this module registers a process-level handler that suppresses only
// that specific benign error and re-raises everything else, so real bugs still
// crash as normal. Registration is idempotent so dev hot-reloads do not stack
// duplicate listeners.
//
// Import it for its side effect from any route that runs snarkjs:
//   import "@/lib/snarkjs-gc-guard";

const guarded = globalThis as typeof globalThis & {
  __cabureSnarkjsGcGuard?: boolean;
};

if (!guarded.__cabureSnarkjsGcGuard) {
  guarded.__cabureSnarkjsGcGuard = true;

  process.on("uncaughtException", (error: NodeJS.ErrnoException) => {
    if (
      error?.code === "ERR_INVALID_STATE" &&
      String(error?.message).includes("FileHandle")
    ) {
      console.warn(
        `[cabure] suppressed snarkjs/fastfile GC handle error: ${error.message}`,
      );
      return;
    }
    // Not ours: re-raise so Node applies its default fatal handling.
    throw error;
  });
}

export {};
