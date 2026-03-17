export interface WizardAnswers {
  projectName: string;
  targetContributions: number;
  endDate: string | null;
  circuitArtifactsPath: string | null;
}

export interface CircuitTierConfig {
  core: string[];
  popular: string[];
  all: string[];
}

export interface GeneratedCircuitConfig {
  id: string;
  r1csFilename: string;
  wasmFilename: string;
  initialZkeyBlobPath: string;
  initialZkeyBlobUrl: string;
}

export interface ScaffoldContext {
  outputDirectory: string;
  projectName: string;
  projectSlug: string;
  targetContributions: number;
  endDate: string | null;
  circuits: GeneratedCircuitConfig[];
  tiers: CircuitTierConfig;
  stateManifestBlobUrl: string;
}
