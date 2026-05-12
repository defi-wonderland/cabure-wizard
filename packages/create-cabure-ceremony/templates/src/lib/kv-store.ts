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

export async function writeContribution<TCircuit, TReceipt>(options: {
  circuitStateKey: string;
  circuitState: TCircuit;
  receiptsKey: string;
  receipt: TReceipt;
  participantContributionsKey: string;
  circuitId: string;
  participantsIndexKey: string;
  participantId: string;
}): Promise<void> {
  await redis()
    .multi()
    .set(options.circuitStateKey, options.circuitState)
    .rpush(options.receiptsKey, options.receipt)
    .sadd(options.participantContributionsKey, options.circuitId)
    .sadd(options.participantsIndexKey, options.participantId)
    .exec();
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
