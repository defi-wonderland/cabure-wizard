export interface CircuitStatus {
  circuitId: string;
  targetContributions: number;
  totalContributions: number;
  currentParticipant: string | null;
  queueLength: number;
  latestContributionHash: string | null;
  chainHash: string;
  isComplete: boolean;
}

export interface StatusResponse {
  isActive: boolean;
  totalContributions: number;
  targetContributions: number;
  endDate: string | null;
  startedAt: number;
  beaconApplied: boolean;
  circuits: CircuitStatus[];
}

export type CircuitPreviewState =
  | "willRun"
  | "alreadyContributed"
  | "targetReached"
  | "fallback";

export interface TierPreview {
  tierId: string;
  items: Array<{ circuitId: string; state: CircuitPreviewState }>;
}

export interface ParticipantEligibilityResponse {
  participantId: string;
  contributedCircuitIds: string[];
  eligibleCircuitIds: string[];
  hasEligibleCircuits: boolean;
  tierPreviews: TierPreview[];
}

export interface QueuePosition {
  participantId: string;
  circuitId: string;
  position: number;
  estimatedWaitSeconds: number;
}

export interface ReceiptResponse {
  success: boolean;
  circuitId: string;
  participantId: string;
  contributionIndex: number;
  contributionHash: string;
  clientContributionHash: string | null;
  chainHash: string;
  timestamp: number;
}

export interface ZkeyInfo {
  url: string;
  contributionIndex: number;
  hash: string | null;
}

async function apiFetch<T>(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(input, init);
  const contentType = response.headers.get("content-type") ?? "";

  if (!response.ok) {
    const body = contentType.includes("application/json")
      ? ((await response.json()) as { error?: string })
      : { error: await response.text() };
    const message =
      body.error || `Request failed with status ${response.status}.`;
    throw new Error(message);
  }

  if (contentType.includes("application/json")) {
    return (await response.json()) as T;
  }

  return (await response.text()) as T;
}

export async function getStatus(signal?: AbortSignal): Promise<StatusResponse> {
  return await apiFetch<StatusResponse>("/api/ceremony/status", { signal });
}

export async function getParticipantEligibility(
  signal?: AbortSignal,
): Promise<ParticipantEligibilityResponse> {
  return await apiFetch<ParticipantEligibilityResponse>(
    "/api/ceremony/participant/eligibility",
    { signal },
  );
}

export interface ParticipantReceiptsResponse {
  participantId: string;
  receipts: ReceiptResponse[];
}

export async function getMyReceipts(
  signal?: AbortSignal,
): Promise<ParticipantReceiptsResponse> {
  return await apiFetch<ParticipantReceiptsResponse>(
    "/api/ceremony/participant/receipts",
    { signal },
  );
}

export async function joinQueue(options: {
  tierId?: string;
  circuitIds?: string[];
  signal?: AbortSignal;
}): Promise<{ positions: QueuePosition[] }> {
  const payload: Record<string, unknown> = {};
  if (options.tierId) {
    payload.tierId = options.tierId;
  } else if (options.circuitIds) {
    payload.circuitIds = options.circuitIds;
  }
  return await apiFetch<{ positions: QueuePosition[] }>("/api/ceremony/queue", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal: options.signal,
  });
}

export async function getQueuePosition(options: {
  circuitId: string;
  signal?: AbortSignal;
}): Promise<QueuePosition> {
  const params = new URLSearchParams({
    circuitId: options.circuitId,
  });
  return await apiFetch<QueuePosition>(
    `/api/ceremony/queue?${params.toString()}`,
    { signal: options.signal },
  );
}

export async function getZkeyInfo(
  circuitId: string,
  signal?: AbortSignal,
): Promise<ZkeyInfo> {
  return await apiFetch<ZkeyInfo>(
    `/api/ceremony/circuits/${circuitId}/zkey?format=json`,
    { signal },
  );
}

// Ask the server for a presigned S3 PUT URL (it runs the eligibility checks and
// chooses the object key), upload the zkey straight to S3, then return the key
// for submitContribution to hand to the contribute route.
export async function uploadZkey(options: {
  circuitId: string;
  payload: Uint8Array;
  signal?: AbortSignal;
}): Promise<string> {
  const { uploadUrl, key } = await apiFetch<{ uploadUrl: string; key: string }>(
    `/api/ceremony/circuits/${options.circuitId}/upload`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
      signal: options.signal,
    },
  );

  const response = await fetch(uploadUrl, {
    method: "PUT",
    body: new Blob([options.payload as BlobPart]),
    signal: options.signal,
  });
  if (!response.ok) {
    throw new Error(
      `Failed to upload contribution to storage (status ${response.status}).`,
    );
  }

  return key;
}

export async function submitContribution(options: {
  circuitId: string;
  contributionHash: string;
  objectKey: string;
  signal?: AbortSignal;
}): Promise<ReceiptResponse> {
  return await apiFetch<ReceiptResponse>(
    `/api/ceremony/circuits/${options.circuitId}/contribute`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        objectKey: options.objectKey,
        contributionHash: options.contributionHash,
      }),
      signal: options.signal,
    },
  );
}

export async function getReceipt(options: {
  circuitId: string;
  participantId: string;
  contributionIndex: number;
  contributionHash?: string;
  signal?: AbortSignal;
}): Promise<ReceiptResponse> {
  const params = new URLSearchParams({
    circuitId: options.circuitId,
    participantId: options.participantId,
    contributionIndex: String(options.contributionIndex),
  });
  if (options.contributionHash) {
    params.set("contributionHash", options.contributionHash);
  }
  return await apiFetch<ReceiptResponse>(
    `/api/ceremony/receipt?${params.toString()}`,
    { signal: options.signal },
  );
}
