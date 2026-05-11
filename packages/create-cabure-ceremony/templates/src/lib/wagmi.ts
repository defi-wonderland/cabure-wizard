import { getDefaultConfig } from "@rainbow-me/rainbowkit";
import { http } from "viem";
import { mainnet, sepolia } from "wagmi/chains";

const walletConnectProjectId =
  process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID?.trim() ?? "";

if (!walletConnectProjectId && typeof window !== "undefined") {
  console.warn(
    "NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID is not set. WalletConnect-based wallets are disabled; only injected wallets (MetaMask, Brave, etc.) will be available.",
  );
}

export const wagmiConfig = getDefaultConfig({
  appName: "Trusted Setup Ceremony",
  // RainbowKit requires a non-empty string. When the env var is missing we
  // still construct a config so injected wallets keep working; WalletConnect
  // requests will fail silently for those connectors with the placeholder.
  projectId: walletConnectProjectId || "cabure-ceremony-no-walletconnect",
  chains: [mainnet, sepolia],
  transports: {
    [mainnet.id]: http(),
    [sepolia.id]: http(),
  },
  ssr: true,
});
