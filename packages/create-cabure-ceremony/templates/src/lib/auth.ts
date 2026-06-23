import type { NextAuthOptions } from "next-auth";
import GitHubProvider from "next-auth/providers/github";

import { env } from "./env";

export const authOptions: NextAuthOptions = {
  providers: [
    GitHubProvider({
      clientId: env.GITHUB_CLIENT_ID,
      clientSecret: env.GITHUB_CLIENT_SECRET,
      // `gist` lets a contributor publish their own attestation Gist with one
      // click (see utils/attestation, CompleteScreen). It is the only write
      // scope. The token reaches the client session below — the cost of letting
      // the contributor, not the operator, own the published record. Publishing
      // is opt-in; the scope is unused for anyone who never publishes.
      authorization: { params: { scope: "read:user gist" } },
    }),
  ],
  session: { strategy: "jwt" },
  callbacks: {
    jwt({ token, account, profile }) {
      if (profile) {
        const gh = profile as { id?: number; login?: string };
        token.participantId = `github:${gh.id}`;
        token.participantName = gh.login ?? profile.name ?? "";
      }
      // `account` is set only on the initial sign-in. Keep the GitHub access
      // token in the JWT (encrypted, httpOnly cookie) so the server-side
      // attestation route can publish the Gist. It is deliberately NOT exposed
      // on the session below: the client never sees it, so an XSS cannot read a
      // write-scoped token. See api/ceremony/attestation.
      if (account?.access_token) {
        token.accessToken = account.access_token;
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
