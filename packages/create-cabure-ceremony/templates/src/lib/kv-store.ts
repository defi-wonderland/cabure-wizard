import { Redis } from "@upstash/redis";

const LOCK_TTL_SECONDS = 60;

let _redis: Redis | null = null;

function redis(): Redis {
  if (!_redis) {
    const url = process.env.KV_REST_API_URL?.trim();
    const token = process.env.KV_REST_API_TOKEN?.trim();
    if (!url || !token) {
      throw new Error(
        "KV_REST_API_URL and KV_REST_API_TOKEN must be set in the environment.",
      );
    }
    _redis = new Redis({ url, token });
  }
  return _redis;
}

export async function getJson<T>(key: string): Promise<T | null> {
  return (await redis().get<T>(key)) ?? null;
}

export async function setJson<T>(
  key: string,
  value: T,
  ttlSeconds?: number,
): Promise<void> {
  if (ttlSeconds !== undefined) {
    await redis().set(key, value, { ex: ttlSeconds });
  } else {
    await redis().set(key, value);
  }
}

export async function listPush<T>(key: string, value: T): Promise<void> {
  await redis().rpush(key, value);
}

export async function listRange<T>(key: string): Promise<T[]> {
  return await redis().lrange<T>(key, 0, -1);
}

export async function setIsMember(
  key: string,
  member: string,
): Promise<boolean> {
  const result = await redis().sismember(key, member);
  return Boolean(result);
}

export async function setMembers(key: string): Promise<string[]> {
  return await redis().smembers(key);
}

export async function listClear(key: string): Promise<number> {
  return redis().del(key);
}

// Optimistic concurrency for the contribution chain: commit only if the chain
// head has not moved since this request read it. No lock, no TTL, no lease to
// expire under a slow upload. KEYS[1] is the circuit state key; ARGV[1] is the
// currentZkeyUrl this contribution was built on. Each contribution stores to a
// unique blob path, so currentZkeyUrl doubles as a version stamp. If another
// contribution committed first, the head differs and the script returns 0; the
// caller rejects and the client retries from fresh state. The four writes then
// run in one atomic server-side step, so two racers can never both advance the
// chain from the same head.
const COMMIT_CONTRIBUTION_SCRIPT = `
  local state = redis.call("get", KEYS[1])
  if not state then return 0 end
  if cjson.decode(state)["currentZkeyUrl"] ~= ARGV[1] then return 0 end
  redis.call("set", KEYS[1], ARGV[2])
  redis.call("rpush", KEYS[2], ARGV[3])
  redis.call("sadd", KEYS[3], ARGV[4])
  redis.call("sadd", KEYS[4], ARGV[5])
  return 1
`;

/**
 * Commit a contribution, but only if the chain head still matches
 * expectedHeadUrl. Returns false when another contribution committed first, so
 * the caller can reject and the client can retry against fresh state.
 *
 * This is the only invariant the chain needs serialized: a new zkey must extend
 * the current head. The compare-and-set on currentZkeyUrl enforces it without a
 * lock. It also serializes same-participant double submits: the first commit
 * shifts the participant off the queue and moves the head, so the second fails
 * the head check.
 *
 * The ARGV values must serialize the way the client's defaultSerializer does,
 * or the readers (getJson, listRange, sismember, smembers) will not parse them.
 * Objects go in as JSON strings; plain string set members go in raw. The script
 * only reads a string field from the state, so cjson number handling does not
 * matter here.
 */
export async function writeContribution<TCircuit, TReceipt>(options: {
  expectedHeadUrl: string;
  circuitStateKey: string;
  circuitState: TCircuit;
  receiptsKey: string;
  receipt: TReceipt;
  participantContributionsKey: string;
  circuitId: string;
  participantsIndexKey: string;
  participantId: string;
}): Promise<boolean> {
  const result = await redis().eval(
    COMMIT_CONTRIBUTION_SCRIPT,
    [
      options.circuitStateKey,
      options.receiptsKey,
      options.participantContributionsKey,
      options.participantsIndexKey,
    ],
    [
      options.expectedHeadUrl,
      JSON.stringify(options.circuitState),
      JSON.stringify(options.receipt),
      options.circuitId,
      options.participantId,
    ],
  );
  return Number(result) === 1;
}

export async function clearParticipantContributions(options: {
  participantsIndexKey: string;
  participantContributionsPrefix: string;
}): Promise<number> {
  const client = redis();
  const participants = await client.smembers(options.participantsIndexKey);
  if (participants.length > 0) {
    const keys = participants.map(
      (participantId) =>
        `${options.participantContributionsPrefix}:${participantId}`,
    );
    await client.del(...keys);
  }
  await client.del(options.participantsIndexKey);
  return participants.length;
}

export async function acquireLock(
  key: string,
  token: string,
): Promise<boolean> {
  const result = await redis().set(key, token, {
    nx: true,
    ex: LOCK_TTL_SECONDS,
  });
  return result === "OK";
}

export async function releaseLock(key: string, token: string): Promise<void> {
  const script = `
    if redis.call("get", KEYS[1]) == ARGV[1] then
      return redis.call("del", KEYS[1])
    else
      return 0
    end
  `;
  await redis().eval(script, [key], [token]);
}
