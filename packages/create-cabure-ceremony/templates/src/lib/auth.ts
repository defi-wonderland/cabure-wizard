import type { NextAuthOptions } from "next-auth";
import GitHubProvider from "next-auth/providers/github";

import { env } from "./env";

export const authOptions: NextAuthOptions = {
  providers: [
    GitHubProvider({
      clientId: env.GITHUB_CLIENT_ID,
      clientSecret: env.GITHUB_CLIENT_SECRET,
    }),
  ],
  session: { strategy: "jwt" },
  callbacks: {
    jwt({ token, profile }) {
      if (profile) {
        const gh = profile as { id?: number; login?: string };
        token.participantId = `github:${gh.id}`;
        token.participantName = gh.login ?? profile.name ?? "";
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
