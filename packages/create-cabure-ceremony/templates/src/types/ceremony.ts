export type CeremonyStep =
  | "landing"
  | "entropy"
  | "tier"
  | "progress"
  | "complete"
  | "verify";

export type TierId = "core" | "popular" | "all";

export interface CircuitArtifactsConfig {
  r1csPath: string;
  ptauPath: string;
  wasmPath?: string;
}

export interface CeremonyCircuitConfig {
  id: string;
  label: string;
  description: string;
  constraints: string;
  targetContributions: number;
  artifacts: CircuitArtifactsConfig;
}

export interface CeremonyTierConfig {
  id: TierId;
  label: string;
  description: string;
  estimatedMinutes: number;
  circuitIds: string[];
}

export interface CeremonyCopy {
  header: {
    title: string;
    contributionsLabel: string;
    steps: {
      landing: string;
      entropy: string;
      tier: string;
      progress: string;
      complete: string;
      verify: string;
    };
  };
  landing: {
    title: string;
    subtitle: string;
    description: string;
    stats: {
      contributionsLabel: string;
      circuitsLabel: string;
      progressLabel: string;
    };
    authNote: string;
    githubCta: string;
    beginCta: string;
    endedSubtitle: string;
    endedDescription: string;
    verifyCta: string;
    footer: string;
  };
  entropy: {
    topBarTitle: string;
    topBarHint: string;
    strengthLabel: string;
    readyCta: string;
    collectingCta: string;
    helper: string;
    overlayTitle: string;
    overlaySubtitle: string;
  };
  tier: {
    title: string;
    description: string;
    cta: string;
    tierLabelPrefix: string;
    timeSuffix: string;
  };
  progress: {
    title: string;
    subtitle: string;
    listTitle: string;
    activeTitle: string;
    constraintsLabel: string;
    queuePositionLabel: string;
    etaLabel: string;
    statusLabels: {
      waiting: string;
      active: string;
      done: string;
      error: string;
    };
    phaseLabels: {
      downloading: string;
      computing: string;
      uploading: string;
    };
    phaseStatus: {
      downloading: string;
      computing: string;
      uploading: string;
    };
    finalizeCta: string;
    retryCta: string;
    cancelCta: string;
    errorTitle: string;
    completeTitle: string;
    completeSubtitle: string;
  };
  complete: {
    title: string;
    subtitle: string;
    contributionsTitle: string;
    emptyContributions: string;
    downloadCta: string;
    verifyCta: string;
    copyCta: string;
    copiedCta: string;
    copyItemCta: string;
    shareCta: string;
    receiptFilename: string;
    shareTemplate: string;
    toxicTitle: string;
    toxicBody: string;
    toxicTags: string[];
    thankYouTitle: string;
    thankYouBody: string;
    restartCta: string;
  };
  verify: {
    title: string;
    subtitle: string;
    label: string;
    placeholder: string;
    cta: string;
    verifyingCta: string;
    note: string;
    successTitle: string;
    invalidReceipt: string;
    backCta: string;
  };
}

export interface CeremonyConfig {
  name: string;
  slug: string;
  description: string;
  targetContributions: number;
  endDate: string | null;
  queueTimeoutSeconds: number;
  verifyContributions?: boolean;
  tiersEnabled?: boolean;
  tiers?: CeremonyTierConfig[];
  circuits: CeremonyCircuitConfig[];
  branding: {
    shortName: string;
    accentColor: string;
  };
  storage: {
    manifestPath: string;
    circuitStatePrefix: string;
    receiptsPath: string;
    zkeyPrefix: string;
  };
  copy: CeremonyCopy;
}

export type ClientCircuitConfig = Omit<CeremonyCircuitConfig, "artifacts">;

export type ClientCeremonyConfig = Omit<CeremonyConfig, "circuits"> & {
  circuits: ClientCircuitConfig[];
};
