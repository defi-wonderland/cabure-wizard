"use client";

import { useEffect, useState } from "react";

import type { ReceiptResponse } from "@/lib/api";
import { useCeremonyConfig } from "@/hooks/useCeremonyConfig";
import { cn } from "@/utils/cn";
import { Button } from "@/app/components/Button";
import { ScreenWrapper } from "@/app/components/ScreenWrapper";
import { useReceiptActions } from "@/hooks/useReceiptActions";
import styles from "./CompleteScreen.module.css";

export function CompleteScreen({
  receipts,
  onRestart,
  onVerify,
}: {
  receipts: ReceiptResponse[];
  onRestart: () => void;
  onVerify: () => void;
}) {
  const config = useCeremonyConfig();
  const { copy } = config;
  const ceremonyName = config.name;
  const {
    receiptPayload,
    latestReceipt,
    copied,
    handleCopy,
    handleCopyItem,
    handleDownload,
    handleShare,
  } = useReceiptActions({
    receipts,
    ceremonyName,
    receiptFilename: copy.complete.receiptFilename,
    shareTemplate: copy.complete.shareTemplate,
  });

  const [showDetails, setShowDetails] = useState(false);
  const [checkmarkVisible, setCheckmarkVisible] = useState(false);

  useEffect(() => {
    const checkTimer = setTimeout(() => setCheckmarkVisible(true), 400);
    const detailsTimer = setTimeout(() => setShowDetails(true), 3000);
    return () => {
      clearTimeout(checkTimer);
      clearTimeout(detailsTimer);
    };
  }, []);

  return (
    <ScreenWrapper className="screenLayout">
      <div className={styles.heroArea}>
        <div
          className={cn(
            styles.checkmarkCircle,
            checkmarkVisible && styles.checkmarkVisible,
            !checkmarkVisible && styles.checkmarkHidden,
          )}
        >
          <div className={styles.checkmarkInner}>
            <svg
              className={styles.checkmarkSvg}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2.5}
              style={{
                strokeDasharray: 100,
                strokeDashoffset: checkmarkVisible ? 0 : 100,
                transition: "stroke-dashoffset 1.2s ease-out 0.6s",
              }}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M5 13l4 4L19 7"
              />
            </svg>
          </div>
        </div>

        <div
          className={cn(
            styles.successText,
            checkmarkVisible && styles.successVisible,
            !checkmarkVisible && styles.successHidden,
          )}
          style={{
            animation: checkmarkVisible
              ? "fadeUp 0.8s ease-out 0.8s both"
              : undefined,
          }}
        >
          <h2 className="sectionTitle">{copy.complete.title}</h2>
          <p className="sectionSubtitle">{copy.complete.subtitle}</p>
        </div>
      </div>

      <div
        className={cn(
          styles.detailsWrapper,
          showDetails && styles.detailsVisible,
          !showDetails && styles.detailsHidden,
        )}
      >
        <div className={styles.section}>
          <div className="label">{copy.complete.contributionsTitle}</div>

          {receipts.length === 0 && (
            <div className="card">{copy.complete.emptyContributions}</div>
          )}

          {receipts.map((receipt) => (
            <div
              key={`${receipt.circuitId}-${receipt.contributionIndex}`}
              className={styles.receiptItem}
            >
              <div className={styles.receiptLeft}>
                <div className="accentDot" />
                <span className={styles.receiptCircuit}>
                  {receipt.circuitId}
                </span>
              </div>

              <div className={styles.receiptRight}>
                <span className={styles.receiptIndex}>
                  #{receipt.contributionIndex.toLocaleString()}
                </span>
                <span className={styles.receiptHash}>
                  {receipt.contributionHash.slice(0, 10)}...
                </span>
                <button
                  type="button"
                  onClick={() => handleCopyItem(receipt.contributionHash)}
                  title={copy.complete.copyItemCta}
                  className={styles.copyButton}
                >
                  <svg
                    className={styles.copySvg}
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={1.8}
                  >
                    <rect x="9" y="9" width="10" height="10" rx="2" />
                    <rect x="5" y="5" width="10" height="10" rx="2" />
                  </svg>
                </button>
              </div>
            </div>
          ))}
        </div>

        <div className={styles.actionsGrid}>
          <button
            onClick={handleDownload}
            disabled={!receiptPayload}
            className={styles.actionButton}
          >
            {copy.complete.downloadCta}
          </button>

          <button onClick={onVerify} className={styles.actionButton}>
            {copy.complete.verifyCta}
          </button>

          <button
            onClick={handleCopy}
            disabled={!receiptPayload}
            className={cn(
              styles.actionButton,
              copied && styles.actionButtonCopied,
            )}
          >
            {copied && copy.complete.copiedCta}
            {!copied && copy.complete.copyCta}
          </button>
        </div>

        <div className={styles.shareSection}>
          <Button
            variant="secondary"
            size="small"
            onClick={handleShare}
            disabled={!latestReceipt}
          >
            {copy.complete.shareCta}
          </Button>
        </div>

        <div className={cn("card-padded", styles.toxicSection)}>
          <div className={styles.toxicCard}>
            <div className={styles.toxicIcon}>
              <svg
                className={styles.toxicIconSvg}
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={3}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M5 13l4 4L19 7"
                />
              </svg>
            </div>
            <div className={styles.toxicContent}>
              <p className={styles.toxicTitle}>{copy.complete.toxicTitle}</p>
              <p className={styles.toxicBody}>{copy.complete.toxicBody}</p>
              <div className={styles.toxicTags}>
                {copy.complete.toxicTags.map((tag) => (
                  <span key={tag} className={styles.toxicTag}>
                    {tag}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className={styles.thankYouCard}>
          <p className={styles.thankYouTitle}>{copy.complete.thankYouTitle}</p>
          <p className={styles.thankYouBody}>{copy.complete.thankYouBody}</p>
        </div>

        <Button variant="secondary" size="small" onClick={onRestart}>
          {copy.complete.restartCta}
        </Button>
      </div>
    </ScreenWrapper>
  );
}
