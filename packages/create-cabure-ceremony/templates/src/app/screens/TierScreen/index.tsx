"use client";

import type { TierId } from "@/lib/ceremony-config";
import type { StatusResponse } from "@/lib/api";
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

export function TierScreen({
  selectedTier,
  onSelectTier,
  onNext,
}: {
  selectedTier: TierId;
  onSelectTier: (tier: TierId) => void;
  onNext: () => void;
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
          return (
            <button
              key={tier.id}
              onClick={() => onSelectTier(tier.id)}
              className={cn(styles.tierCard, selected && styles.tierCardSelected)}
            >
              <div className={styles.tierTop}>
                <div className={styles.tierInfo}>
                  <div className={cn(styles.radio, selected && styles.radioSelected)}>
                    {selected && <div className={styles.radioDot} />}
                  </div>

                  <div>
                    <span className={styles.tierLabel}>
                      {copy.tier.tierLabelPrefix} {index + 1}: {tier.id.toUpperCase()}
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
                {tier.circuitIds.map((c) => {
                  const progress = circuitProgress(c, status);
                  const isComplete = progress?.complete ?? false;
                  return (
                    <span
                      key={c}
                      className={cn(styles.chip, isComplete && styles.chipComplete)}
                    >
                      {c}
                      {progress && (
                        <span className={styles.chipProgress}>
                          {isComplete && " ✓"}
                          {!isComplete && ` ${progress.total}/${progress.target}`}
                        </span>
                      )}
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
