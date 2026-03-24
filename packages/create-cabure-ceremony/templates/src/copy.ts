import type { CeremonyCopy } from "./types/ceremony";

export const defaultCopy: CeremonyCopy = {
  header: {
    title: "TRUSTED SETUP CEREMONY",
    contributionsLabel: "contributions",
    steps: {
      landing: "Welcome",
      entropy: "Entropy",
      tier: "Select Tier",
      progress: "Progress",
      complete: "Complete",
      verify: "Verify",
    },
  },
  landing: {
    title: "Trusted Setup Ceremony",
    subtitle: "Contribute your randomness",
    description:
      "Your contribution strengthens the ceremony. Only one honest participant is needed.",
    stats: {
      contributionsLabel: "Contributors",
      circuitsLabel: "Circuits",
      progressLabel: "Progress",
    },
    authNote:
      "Sign in with GitHub to verify your identity and join the queue.",
    githubCta: "CONTINUE WITH GITHUB",
    beginCta: "BEGIN CONTRIBUTION",
    endedSubtitle: "This ceremony has concluded",
    endedDescription:
      "Thank you to everyone who contributed. The ceremony has reached its target. You can still verify existing receipts below.",
    verifyCta: "VERIFY A RECEIPT",
    footer:
      "No sign-up required. Your contribution is anonymous by default.\nTakes ~1 minute for core circuits.",
  },
  entropy: {
    topBarTitle: "ENTROPY COLLECTION",
    topBarHint: "Move your mouse & click for bursts",
    strengthLabel: "Entropy strength",
    readyCta: "CONTINUE",
    collectingCta: "COLLECTING ENTROPY...",
    helper:
      "Your movements are being mixed into cryptographic randomness that will help secure the ceremony.",
    overlayTitle: "Entropy collected",
    overlaySubtitle: "Your unique randomness is ready",
  },
  tier: {
    title: "Select contribution level",
    description:
      "Choose how many circuits to contribute to. More circuits = stronger ceremony.",
    cta: "JOIN QUEUE",
    tierLabelPrefix: "Tier",
    timeSuffix: "min",
  },
  progress: {
    title: "Contribution in progress",
    subtitle: "We will run each circuit in sequence. Keep this tab open.",
    listTitle: "Your circuits",
    activeTitle: "Active circuit",
    constraintsLabel: "constraints",
    queuePositionLabel: "Queue position",
    etaLabel: "ETA",
    statusLabels: {
      waiting: "Waiting",
      active: "Active",
      done: "Done",
      error: "Error",
    },
    phaseLabels: {
      downloading: "Download",
      computing: "Compute",
      uploading: "Upload",
    },
    phaseStatus: {
      downloading: "Downloading zkey...",
      computing: "Computing contribution...",
      uploading: "Uploading result...",
    },
    finalizeCta: "FINALIZE CONTRIBUTION",
    retryCta: "Retry",
    cancelCta: "Cancel",
    errorTitle: "Contribution failed",
    completeTitle: "All circuits complete",
    completeSubtitle: "Review your receipts and finalize.",
  },
  complete: {
    title: "Contribution Complete",
    subtitle: "Your randomness is now permanently woven into the ceremony.",
    contributionsTitle: "Your contributions",
    emptyContributions: "No receipts recorded yet.",
    downloadCta: "Download",
    verifyCta: "Verify",
    copyCta: "Copy Receipt",
    copiedCta: "Copied!",
    copyItemCta: "Copy hash",
    shareCta: "Share on X",
    receiptFilename: "ceremony-receipt.json",
    shareTemplate:
      "I just contributed to {{ceremonyName}}: {{circuitId}} #{{contributionIndex}}",
    toxicTitle: "Toxic waste destroyed",
    toxicBody:
      "Your secret randomness was generated in memory, used to transform the circuit keys, and immediately zeroed. No entropy was written to disk or transmitted to the coordinator.",
    toxicTags: [
      "WASM memory zeroed",
      "Entropy buffers cleared",
      "No disk writes",
    ],
    thankYouTitle: "Thank you for strengthening the ceremony.",
    thankYouBody:
      "Only one honest participant is needed. You might be that one.",
    restartCta: "CONTRIBUTE AGAIN (DIFFERENT TIER)",
  },
  verify: {
    title: "Verify a receipt",
    subtitle:
      "Paste a receipt JSON to confirm it exists in the coordinator state.",
    label: "Receipt JSON",
    placeholder:
      '{"circuitId":"multiplier","participantId":"...","contributionIndex":1}',
    cta: "VERIFY RECEIPT",
    verifyingCta: "VERIFYING...",
    note: "This PoC verifies receipt presence in the coordinator state. Full cryptographic verification is not implemented yet.",
    successTitle: "Receipt verified",
    invalidReceipt: "Receipt JSON is missing required fields.",
    backCta: "BACK TO LANDING",
  },
};
