"use client";

import { useCeremonyConfig } from "@/hooks/useCeremonyConfig";
import type { StatusResponse } from "@/lib/api";
import { cn } from "@/utils/cn";
import { Button } from "@/app/components/Button";
import { ScreenWrapper } from "@/app/components/ScreenWrapper";
import styles from "./LandingScreen.module.css";

export function LandingScreen({
  status,
  isAuthenticated,
  walletAuthLoading,
  walletAuthError,
  onAuth,
  onBegin,
  onVerify,
}: {
  status: StatusResponse;
  isAuthenticated: boolean;
  walletAuthLoading: boolean;
  walletAuthError: string | null;
  onAuth: (method: "github" | "wallet") => void;
  onBegin: () => void;
  onVerify: () => void;
}) {
  const config = useCeremonyConfig();

  const { copy } = config;
  const totalContributions = status.totalContributions;
  const targetContributions = status.targetContributions;
  const progress = targetContributions
    ? Math.min(
        100,
        Math.round((totalContributions / targetContributions) * 100),
      )
    : 0;
  const isActive = status.isActive;
  const footerLines = copy.landing.footer.split("\n");

  const statsData = [
    {
      label: copy.landing.stats.contributionsLabel,
      value: totalContributions.toLocaleString(),
    },
    {
      label: copy.landing.stats.circuitsLabel,
      value: String(config.circuits.length),
    },
    { label: copy.landing.stats.progressLabel, value: `${progress}%` },
  ];

  if (!isActive) {
    return (
      <ScreenWrapper className="screenLayout">
        <div className={styles.hero}>
          <h1 className={styles.title}>{copy.landing.title}</h1>
          <h2 className={styles.subtitleEnded}>{copy.landing.endedSubtitle}</h2>
        </div>

        <StatsBar stats={statsData} />

        <div className={cn("card", styles.endedCard)}>
          <p className={styles.endedText}>{copy.landing.endedDescription}</p>
        </div>

        <Button onClick={onVerify}>{copy.landing.verifyCta}</Button>
      </ScreenWrapper>
    );
  }

  return (
    <ScreenWrapper className="screenLayout">
      <div className={styles.hero}>
        <h1 className={styles.title}>{copy.landing.title}</h1>
        <h2 className={styles.subtitle}>{copy.landing.subtitle}</h2>
        <p className={styles.description}>{copy.landing.description}</p>
      </div>

      <StatsBar stats={statsData} />

      {!isAuthenticated && (
        <>
          <div className="card">{copy.landing.authNote}</div>

          <div className={styles.authButtons}>
            <Button
              onClick={() => onAuth("github")}
              disabled={walletAuthLoading}
            >
              {copy.landing.githubCta}
            </Button>
            <Button
              variant="secondary"
              onClick={() => onAuth("wallet")}
              disabled={walletAuthLoading}
              aria-busy={walletAuthLoading}
            >
              <span className={styles.walletButtonContent}>
                {walletAuthLoading && (
                  <span
                    className={styles.walletSpinner}
                    aria-hidden="true"
                  />
                )}
                <span>
                  {walletAuthLoading
                    ? copy.landing.walletPendingCta
                    : copy.landing.walletCta}
                </span>
              </span>
            </Button>
            {walletAuthError && (
              <p className={styles.authError}>{walletAuthError}</p>
            )}
          </div>
        </>
      )}

      {isAuthenticated && (
        <Button onClick={onBegin}>{copy.landing.beginCta}</Button>
      )}

      <Button variant="secondary" size="small" onClick={onVerify}>
        {copy.landing.verifyCta}
      </Button>

      <p className={styles.footer}>
        {footerLines.map((line, index) => (
          <span key={line}>
            {line}
            {index < footerLines.length - 1 && <br />}
          </span>
        ))}
      </p>
    </ScreenWrapper>
  );
}

function StatsBar({
  stats,
}: {
  stats: Array<{ label: string; value: string }>;
}) {
  return (
    <div className={styles.statsBar}>
      {stats.map((stat, index) => (
        <div
          key={stat.label}
          className={cn(styles.statCell, index > 0 && styles.statCellBorder)}
        >
          <div className={styles.statValue}>{stat.value}</div>
          <div className={styles.statLabel}>{stat.label}</div>
        </div>
      ))}
    </div>
  );
}
