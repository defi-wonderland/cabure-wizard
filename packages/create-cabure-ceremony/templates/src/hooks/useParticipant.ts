"use client";

import { useSession, signIn } from "next-auth/react";

import { useWalletSignIn } from "./useWalletSignIn";

export type AuthMethod = "github" | "wallet";

export function useParticipant() {
  const { data: session, status } = useSession();
  const wallet = useWalletSignIn();

  const participantId = session?.participantId ?? null;
  const participantName = session?.participantName ?? "";
  const isAuthenticated = status === "authenticated";
  const participantDisplayName =
    participantId?.startsWith("wallet:") || !participantName
      ? participantName
      : `@${participantName}`;

  const authenticate = (method: AuthMethod) => {
    if (method === "wallet") {
      void wallet.start();
      return;
    }
    void signIn("github");
  };

  return {
    participantId,
    participantName,
    participantDisplayName,
    isAuthenticated,
    authenticate,
    walletAuthLoading: wallet.isLoading,
    walletAuthError: wallet.error,
    clearWalletAuthError: wallet.clearError,
  };
}
