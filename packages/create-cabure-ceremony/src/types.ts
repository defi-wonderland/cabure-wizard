/**
 * Collected answers from the interactive wizard prompts.
 *
 * @property projectName - Display name for the ceremony UI
 * @property targetContributions - Desired number of contributions before finalization
 * @property endDate - Optional ceremony deadline in YYYY-MM-DD format, or null if open-ended
 * @property circuitArtifactsPath - Resolved absolute path to circuit artifacts directory, or null if skipped
 */
export interface WizardAnswers {
  projectName: string;
  targetContributions: number;
  endDate: string | null;
  circuitArtifactsPath: string | null;
}

/**
 * Grouping of circuit IDs into performance/security tiers.
 *
 * @property core - Circuit IDs always included in contributions
 * @property popular - Circuit IDs included in the standard contribution flow
 * @property all - Complete list of circuit IDs in the ceremony
 */
export interface CircuitTierConfig {
  core: string[];
  popular: string[];
  all: string[];
}

/**
 * Configuration for a single circuit in the generated ceremony project.
 *
 * @property id - Unique circuit identifier (derived from filename stem)
 * @property r1csFilename - Filename of the R1CS constraint file in circuits/
 * @property initialZkeyBlobPath - Storage path for the genesis zkey blob
 * @property initialZkeyBlobUrl - Public URL for downloading the genesis zkey
 */
export interface GeneratedCircuitConfig {
  id: string;
  r1csFilename: string;
  initialZkeyBlobPath: string;
  initialZkeyBlobUrl: string;
}

/**
 * Full context passed to the project scaffolder.
 *
 * @property outputDirectory - Absolute path where the project will be generated
 * @property projectName - Human-readable project name
 * @property projectSlug - URL-safe kebab-case project identifier
 * @property targetContributions - Target number of contributions
 * @property endDate - Optional deadline (YYYY-MM-DD) or null
 * @property circuits - List of circuit configurations to embed in ceremony.config.ts
 * @property tiers - Circuit tier groupings
 * @property stateManifestBlobUrl - URL for the ceremony state manifest blob
 */
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
