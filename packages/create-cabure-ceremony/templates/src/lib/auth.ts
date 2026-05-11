import type { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import GitHubProvider from "next-auth/providers/github";

import { env } from "./env";
import { verifySiwe } from "./siwe";

const WALLET_ID_PREFIX = "wallet:";

export const authOptions: NextAuthOptions = {
  providers: [
    GitHubProvider({
      clientId: env.GITHUB_CLIENT_ID,
      clientSecret: env.GITHUB_CLIENT_SECRET,
    }),
    CredentialsProvider({
      id: "siwe",
      name: "Ethereum",
      credentials: {
        message: { label: "Message", type: "text" },
        signature: { label: "Signature", type: "text" },
      },
      async authorize(credentials) {
        const message = credentials?.message;
        const signature = credentials?.signature;
        if (typeof message !== "string" || typeof signature !== "string") {
          return null;
        }

        try {
          const verified = await verifySiwe(message, signature);
          return {
            id: `${WALLET_ID_PREFIX}${verified.address}`,
            name: verified.participantName,
          };
        } catch {
          return null;
        }
      },
    }),
  ],
  session: { strategy: "jwt" },
  callbacks: {
    jwt({ token, profile, user }) {
      if (profile) {
        const gh = profile as { id?: number; login?: string };
        token.participantId = `github:${gh.id}`;
        token.participantName = gh.login ?? profile.name ?? "";
        return token;
      }

      if (user?.id?.startsWith(WALLET_ID_PREFIX)) {
        token.participantId = user.id;
        token.participantName = user.name ?? "";
      }

      return token;
    },
    session({ session, token }) {
      session.participantId = token.participantId as string;
      session.participantName = token.participantName as string;
      return session;
    },
  },
};
