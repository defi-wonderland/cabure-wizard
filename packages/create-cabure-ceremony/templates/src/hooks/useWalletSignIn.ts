"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { signIn } from "next-auth/react";
import { useAccount, useChainId, useSignMessage } from "wagmi";
import { useConnectModal } from "@rainbow-me/rainbowkit";
import { SiweMessage } from "siwe";

const SIWE_STATEMENT = "Sign in to the Trusted Setup Ceremony.";

interface UseWalletSignInResult {
  start: () => Promise<void>;
  isLoading: boolean;
  error: string | null;
  clearError: () => void;
}

export function useWalletSignIn(): UseWalletSignInResult {
  const account = useAccount();
  const chainId = useChainId();
  const { signMessageAsync, isPending: signaturePending } = useSignMessage();
  const { openConnectModal, connectModalOpen } = useConnectModal();
  const [shouldSignInAfterConnect, setShouldSignInAfterConnect] =
    useState(false);
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const connectModalWasOpenRef = useRef(false);
  const signInInFlightRef = useRef(false);

  const runSignIn = useCallback(
    async (address: `0x${string}`, connectedChainId: number): Promise<void> => {
      if (signInInFlightRef.current) {
        return;
      }

      signInInFlightRef.current = true;
      setIsSigningIn(true);
      try {
        const nonce = await fetchNonce();
        const message = new SiweMessage({
          domain: window.location.host,
          address,
          statement: SIWE_STATEMENT,
          uri: window.location.origin,
          version: "1",
          chainId: connectedChainId,
          nonce,
          issuedAt: new Date().toISOString(),
        }).prepareMessage();

        const signature = await signMessageAsync({ message });

        const result = await signIn("siwe", {
          message,
          signature,
          redirect: false,
        });

        if (!result || result.error) {
          throw new Error(result?.error ?? "Wallet sign-in failed");
        }
      } catch (cause) {
        const message =
          cause instanceof Error ? cause.message : "Wallet sign-in failed";
        setError(message);
      } finally {
        signInInFlightRef.current = false;
        connectModalWasOpenRef.current = false;
        setShouldSignInAfterConnect(false);
        setIsSigningIn(false);
      }
    },
    [signMessageAsync],
  );

  const start = async (): Promise<void> => {
    setError(null);

    if (account.isConnected && account.address) {
      await runSignIn(account.address, chainId);
      return;
    }

    if (!openConnectModal) {
      setError("Wallet connection is not available right now.");
      return;
    }

    setShouldSignInAfterConnect(true);
    openConnectModal();
  };

  useEffect(() => {
    if (!shouldSignInAfterConnect) {
      connectModalWasOpenRef.current = false;
      return;
    }

    if (connectModalOpen) {
      connectModalWasOpenRef.current = true;
    }

    if (account.isConnected && account.address) {
      void runSignIn(account.address, chainId);
      return;
    }

    if (
      connectModalWasOpenRef.current &&
      !connectModalOpen &&
      !account.isConnecting
    ) {
      connectModalWasOpenRef.current = false;
      setShouldSignInAfterConnect(false);
    }
  }, [
    shouldSignInAfterConnect,
    connectModalOpen,
    account.isConnected,
    account.isConnecting,
    account.address,
    chainId,
    runSignIn,
  ]);

  return {
    start,
    isLoading:
      shouldSignInAfterConnect ||
      connectModalOpen ||
      account.isConnecting ||
      signaturePending ||
      isSigningIn,
    error,
    clearError: () => setError(null),
  };
}

async function fetchNonce(): Promise<string> {
  const response = await fetch("/api/auth/siwe/nonce", { method: "POST" });
  if (!response.ok) {
    throw new Error(`Failed to fetch SIWE nonce: ${response.status}`);
  }
  const data = (await response.json()) as { nonce?: string; error?: string };
  if (!data.nonce) {
    throw new Error(data.error ?? "Missing nonce in response");
  }
  return data.nonce;
}
