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

  async submitContribution(
    circuitId: string,
    blobUrl: string,
    contributionHash: string,
  ): Promise<ReceiptResponse> {
    return this.request<ReceiptResponse>(
      `/api/ceremony/circuits/${encodeURIComponent(circuitId)}/contribute`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ blobUrl, contributionHash }),
      },
    );
  }

  get uploadHeaders(): Record<string, string> {
    if (!this.token) return {};
    return { Authorization: `Bearer ${this.token}` };
  }

  get url(): string {
    return this.baseUrl;
  }
}
