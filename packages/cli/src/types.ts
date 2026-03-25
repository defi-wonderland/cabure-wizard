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
  beaconHash: string | null;
  finalizedAt: number | null;
  circuits: CircuitStatus[];
}

export interface QueuePosition {
  participantId: string;
  circuitId: string;
  position: number;
  estimatedWaitSeconds: number;
}

export interface ZkeyInfo {
  url: string;
  contributionIndex: number;
  hash: string | null;
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

export interface CliAuthInitResponse {
  userCode: string;
  verificationUri: string;
  loginCode: string;
  interval: number;
  expiresIn: number;
}

export interface CliAuthTokenResponse {
  token: string;
  participantId: string;
  participantName: string;
  expiresAt: number;
}

export interface StoredAuth {
  ceremonyUrl: string;
  token: string;
  participantId: string;
  participantName: string;
  expiresAt: number;
}
