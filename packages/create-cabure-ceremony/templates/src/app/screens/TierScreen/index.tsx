"use client";

import type {
  ClientCircuitConfig,
  CeremonyTierConfig,
  TierId,
} from "@/lib/ceremony-config";
import type { ParticipantEligibilityResponse, StatusResponse } from "@/lib/api";
import { useCeremonyConfig } from "@/hooks/useCeremonyConfig";
import { useCeremonyStatus } from "@/hooks/useCeremonyStatus";
import { cn } from "@/utils/cn";
import { Button } from "@/app/components/Button";
import { ScreenWrapper } from "@/app/components/ScreenWrapper";
import styles from "./TierScreen.module.css";

function circuitProgress(
  circuitId: string,
  status: StatusResponse | null,
): { total: number; target: number; complete: boolean } | null {
  if (!status) return null;
  const circuit = status.circuits.find((c) => c.circuitId === circuitId);
  if (!circuit) return null;
  return {
    total: circuit.totalContributions,
    target: circuit.targetContributions,
    complete: circuit.isComplete,
  };
}

type PreviewState =
  | "willRun"
  | "alreadyContributed"
  | "targetReached"
  | "fallback";

type CircuitPreview = {
  circuitId: string;
  state: PreviewState;
  progress: { total: number; target: number; complete: boolean } | null;
};

function resolveTierCircuitIds(
  tier: CeremonyTierConfig,
  circuits: ClientCircuitConfig[],
  status: StatusResponse | null,
): string[] {
  const maxCount = tier.circuitIds.length;
  const needed = tier.circuitIds.filter((id) => {
    const circuitConfig = circuits.find((circuit) => circuit.id === id);
    const progress = circuitProgress(id, status);
    if (!circuitConfig || !progress) return true;
    return !progress.complete;
  });

  if (needed.length >= maxCount) return needed;

  const alreadyIncluded = new Set(needed);
  const candidates = circuits
    .filter((circuit) => !alreadyIncluded.has(circuit.id))
    .map((circuit) => {
      const progress = circuitProgress(circuit.id, status);
      const remaining = circuit.targetContributions - (progress?.total ?? 0);
      return { id: circuit.id, remaining };
    })
    .filter((circuit) => circuit.remaining > 0)
    .sort((a, b) => b.remaining - a.remaining);

  return [
    ...needed,
    ...candidates
      .slice(0, maxCount - needed.length)
      .map((circuit) => circuit.id),
  ];
}

function createTierPreview(options: {
  tier: CeremonyTierConfig;
  circuits: ClientCircuitConfig[];
  status: StatusResponse | null;
  eligibility: ParticipantEligibilityResponse | null;
}): CircuitPreview[] {
  const { tier, circuits, status, eligibility } = options;
  const contributedCircuitIds = new Set(
    eligibility?.contributedCircuitIds ?? [],
  );
  const eligibleCircuitIds = new Set(eligibility?.eligibleCircuitIds ?? []);
  const hasEligibility = eligibility !== null;
  const isEligible = (circuitId: string): boolean => {
    if (!hasEligibility) {
      return !(circuitProgress(circuitId, status)?.complete ?? false);
    }
    return eligibleCircuitIds.has(circuitId);
  };

  const resolvedCircuitIds = resolveTierCircuitIds(tier, circuits, status);
  const executableResolvedIds = resolvedCircuitIds.filter(isEligible);
  const fallbackCircuitId =
    executableResolvedIds[0] ??
    circuits.find((circuit) => isEligible(circuit.id))?.id ??
    null;
  const willRunCircuitIds = new Set(
    executableResolvedIds.length > 0
      ? executableResolvedIds
      : fallbackCircuitId
        ? [fallbackCircuitId]
        : [],
  );
  const tierCircuitIds = new Set(tier.circuitIds);

  const previews = tier.circuitIds.map((circuitId): CircuitPreview => {
    const progress = circuitProgress(circuitId, status);
    if (willRunCircuitIds.has(circuitId)) {
      return { circuitId, state: "willRun", progress };
    }
    if (contributedCircuitIds.has(circuitId)) {
      return { circuitId, state: "alreadyContributed", progress };
    }
    if (progress?.complete) {
      return { circuitId, state: "targetReached", progress };
    }
    return { circuitId, state: "targetReached", progress };
  });

  for (const circuitId of willRunCircuitIds) {
    if (!tierCircuitIds.has(circuitId)) {
      previews.push({
        circuitId,
        state: "fallback",
        progress: circuitProgress(circuitId, status),
      });
    }
  }

  return previews;
}

export function TierScreen({
  selectedTier,
  onSelectTier,
  onNext,
  eligibility,
}: {
  selectedTier: TierId;
  onSelectTier: (tier: TierId) => void;
  onNext: () => void;
  eligibility: ParticipantEligibilityResponse | null;
}) {
  const config = useCeremonyConfig();
  const { status } = useCeremonyStatus();

  const { copy } = config;
  const tiers = config.tiers ?? [];
  return (
    <ScreenWrapper className="screenLayout">
      <div className={styles.header}>
        <h2 className="sectionTitle">{copy.tier.title}</h2>
        <p className="sectionSubtitle">{copy.tier.description}</p>
      </div>

      <div className={styles.tierList}>
        {tiers.map((tier, index) => {
          const selected = selectedTier === tier.id;
          const circuitPreviews = createTierPreview({
            tier,
            circuits: config.circuits,
            status,
            eligibility,
          });
          return (
            <button
              key={tier.id}
              onClick={() => onSelectTier(tier.id)}
              className={cn(
                styles.tierCard,
                selected && styles.tierCardSelected,
              )}
            >
              <div className={styles.tierTop}>
                <div className={styles.tierInfo}>
                  <div
                    className={cn(
                      styles.radio,
                      selected && styles.radioSelected,
                    )}
                  >
                    {selected && <div className={styles.radioDot} />}
                  </div>

                  <div>
                    <span className={styles.tierLabel}>
                      {copy.tier.tierLabelPrefix} {index + 1}:{" "}
                      {tier.id.toUpperCase()}
                    </span>
                    <span
                      className={cn(
                        styles.badge,
                        selected && styles.badgeSelected,
                        !selected && styles.badgeDefault,
                      )}
                    >
                      {tier.label}
                    </span>
                  </div>
                </div>
                <span className={styles.estimate}>
                  ~{tier.estimatedMinutes} {copy.tier.timeSuffix}
                </span>
              </div>

              <p className={styles.tierDescription}>{tier.description}</p>

              <div className={styles.chipList}>
                {circuitPreviews.map((preview) => {
                  const isSkipped =
                    preview.state === "alreadyContributed" ||
                    preview.state === "targetReached";
                  return (
                    <span
                      key={`${tier.id}:${preview.circuitId}:${preview.state}`}
                      className={cn(
                        styles.chip,
                        preview.state === "willRun" && styles.chipWillRun,
                        preview.state === "fallback" && styles.chipFallback,
                        isSkipped && styles.chipSkipped,
                      )}
                    >
                      {preview.circuitId}
                      {preview.progress && (
                        <span className={styles.chipProgress}>
                          {` ${preview.progress.total}/${preview.progress.target}`}
                        </span>
                      )}
                      <span className={styles.chipStatus}>
                        {preview.state === "willRun" && copy.tier.pillWillRun}
                        {preview.state === "fallback" &&
                          copy.tier.pillNextAvailable}
                        {preview.state === "alreadyContributed" &&
                          copy.tier.pillAlreadyContributed}
                        {preview.state === "targetReached" &&
                          copy.tier.pillTargetReached}
                      </span>
                    </span>
                  );
                })}
              </div>
            </button>
          );
        })}
      </div>

      <Button onClick={onNext}>{copy.tier.cta}</Button>
    </ScreenWrapper>
  );
}
