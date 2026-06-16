import { useRef, useState, useCallback } from "react";

import { buildEntropySeed, clamp16, clamp16Signed } from "@/utils/entropy";

// Interaction score required before the contribute step unlocks. This is a
// readiness gauge to confirm the user actually interacted — NOT a measure of
// bits of entropy. Security does not depend on this number (see buildSeed).
const READINESS_TARGET = 2048;
const MAX_ENTROPY_BYTES = 4096;

// Arbitrary readiness weights per interaction type. A larger weight just fills
// the meter faster; these are not bits of randomness.
const MOVE_WEIGHT = 2;
const TAP_WEIGHT = 45;
const KEY_WEIGHT = 10;

/**
 * Collects user-interaction input for ceremony contributions and gates the UI
 * on it.
 *
 * Pointer moves, taps, and key presses are each packed into a 16-byte sample
 * (coordinates, deltas, timing, a monotonic counter) and appended to a ring
 * buffer capped at {@link MAX_ENTROPY_BYTES}. Uses Pointer Events so touch,
 * pen, and mouse all contribute equally.
 *
 * `readinessPercent` / `isReady` are a progress gauge driven by an arbitrary
 * per-interaction score (see the *_WEIGHT constants). They confirm the user
 * interacted; they do NOT measure unpredictability. The actual randomness comes
 * from {@link buildSeed}, which mixes the collected bytes with the OS CSPRNG via
 * SHA-256 — so the contribution is unpredictable even if the interaction input
 * is weak.
 */
export function useEntropyCollector() {
  const interactionScoreRef = useRef(0);
  const entropyBytesRef = useRef<number[]>([]);
  const eventCountRef = useRef(0);
  const lastPointerRef = useRef({ x: 0, y: 0, time: 0 });
  const areaRef = useRef<HTMLDivElement>(null);

  const [readinessPercent, setReadinessPercent] = useState(0);
  const [isReady, setIsReady] = useState(false);

  const appendEntropyBytes = useCallback((bytes: Uint8Array) => {
    const bucket = entropyBytesRef.current;
    if (bucket.length + bytes.length > MAX_ENTROPY_BYTES) {
      bucket.splice(0, bytes.length);
    }
    for (const value of bytes) {
      bucket.push(value);
    }
  }, []);

  const recordSample = useCallback(
    (event: {
      x: number;
      y: number;
      dx: number;
      dy: number;
      typeCode: number;
    }) => {
      const time = Date.now();
      const buffer = new Uint8Array(16);
      const view = new DataView(buffer.buffer);
      const timeLow = time >>> 0;
      const timeHigh = Math.floor(time / 2 ** 32) >>> 0;

      view.setUint32(0, timeLow);
      view.setUint16(4, clamp16(event.x));
      view.setUint16(6, clamp16(event.y));
      view.setInt16(8, clamp16Signed(event.dx));
      view.setInt16(10, clamp16Signed(event.dy));

      buffer[12] = event.typeCode & 0xff;
      buffer[13] = eventCountRef.current & 0xff;
      buffer[14] = (eventCountRef.current >> 8) & 0xff;
      buffer[15] = (timeHigh ^ timeLow) & 0xff;

      eventCountRef.current += 1;
      appendEntropyBytes(buffer);
    },
    [appendEntropyBytes],
  );

  const addReadiness = useCallback(
    (weight: number) => {
      interactionScoreRef.current += weight;
      const pct = Math.min(
        (interactionScoreRef.current / READINESS_TARGET) * 100,
        100,
      );
      setReadinessPercent(Math.floor(pct));
      if (pct >= 100 && !isReady) {
        setIsReady(true);
      }
    },
    [isReady],
  );

  /** Records a pointer-move sample and advances the readiness gauge. */
  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const el = areaRef.current;
      if (!el || isReady) return;

      const rect = el.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const now = Date.now();

      el.style.setProperty("--mx", `${e.clientX}px`);
      el.style.setProperty("--my", `${e.clientY}px`);

      const dx = x - lastPointerRef.current.x;
      const dy = y - lastPointerRef.current.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const dt = now - lastPointerRef.current.time;

      if (dt > 0 && dist > 3) {
        recordSample({ x, y, dx, dy, typeCode: 1 });
        addReadiness(MOVE_WEIGHT);
      }

      lastPointerRef.current = { x, y, time: now };
    },
    [isReady, recordSample, addReadiness],
  );

  /** Records a tap/click sample and advances the readiness gauge. */
  const recordTap = useCallback(
    (x: number, y: number) => {
      if (isReady) return;
      recordSample({ x, y, dx: 0, dy: 0, typeCode: 2 });
      addReadiness(TAP_WEIGHT);
    },
    [isReady, recordSample, addReadiness],
  );

  /** Records a key-press sample and advances the readiness gauge. */
  const recordKeyPress = useCallback(
    (keyCode: number) => {
      if (isReady) return;
      recordSample({ x: keyCode, y: 0, dx: 0, dy: 0, typeCode: 3 });
      addReadiness(KEY_WEIGHT);
    },
    [isReady, recordSample, addReadiness],
  );

  /** Mixes collected bytes with CSPRNG output via SHA-256 into a 64-byte seed. */
  const buildSeed = useCallback(async (): Promise<Uint8Array> => {
    const seed = await buildEntropySeed(entropyBytesRef.current);
    entropyBytesRef.current = [];
    return seed;
  }, []);

  return {
    readinessPercent,
    isReady,
    areaRef,
    handlePointerMove,
    recordTap,
    recordKeyPress,
    buildSeed,
  };
}
