import type {
  QueuePosition,
  ReceiptResponse,
  StatusResponse,
  ZkeyInfo,
} from "./types.js";

export class CeremonyClient {
  constructor(
    private readonly baseUrl: string,
    private readonly token: string | null = null,
  ) {}

  private headers(): Record<string, string> {
    const h: Record<string, string> = { Accept: "application/json" };
    if (this.token) {
      h["Authorization"] = `Bearer ${this.token}`;
    }
    return h;
  }

  private async request<T>(
    path: string,
    init?: RequestInit,
  ): Promise<T> {
    const url = new URL(path, this.baseUrl);
    const response = await fetch(url, {
      ...init,
      headers: { ...this.headers(), ...init?.headers },
    });

    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as {
        error?: string;
      };
      throw new Error(
        body.error ?? `API request failed: ${response.status} ${response.statusText}`,
      );
    }

    return (await response.json()) as T;
  }

  async getStatus(): Promise<StatusResponse> {
    return this.request<StatusResponse>("/api/ceremony/status");
  }

  async joinQueue(options: {
    tierId?: string;
    circuitIds?: string[];
  }): Promise<{ positions: QueuePosition[] }> {
    return this.request<{ positions: QueuePosition[] }>(
      "/api/ceremony/queue",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(options),
      },
    );
  }

  async getQueuePosition(circuitId: string): Promise<QueuePosition> {
    return this.request<QueuePosition>(
      `/api/ceremony/queue?circuitId=${encodeURIComponent(circuitId)}`,
    );
  }

  async getZkeyInfo(circuitId: string): Promise<ZkeyInfo> {
    return this.request<ZkeyInfo>(
      `/api/ceremony/circuits/${encodeURIComponent(circuitId)}/zkey?format=json`,
    );
  }

  async downloadZkey(url: string): Promise<Uint8Array> {
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`Failed to download zkey: ${response.status}`);
    }
    return new Uint8Array(await response.arrayBuffer());
  }

  // Ask the server for a presigned S3 PUT URL. It runs the eligibility checks
  // and picks the object key the contribute step then submits.
  async requestUpload(
    circuitId: string,
  ): Promise<{ uploadUrl: string; key: string }> {
    return this.request<{ uploadUrl: string; key: string }>(
      `/api/ceremony/circuits/${encodeURIComponent(circuitId)}/upload`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      },
    );
  }

  async submitContribution(
    circuitId: string,
    objectKey: string,
    contributionHash: string,
  ): Promise<ReceiptResponse> {
    return this.request<ReceiptResponse>(
      `/api/ceremony/circuits/${encodeURIComponent(circuitId)}/contribute`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ objectKey, contributionHash }),
      },
    );
  }

  get url(): string {
    return this.baseUrl;
  }
}
