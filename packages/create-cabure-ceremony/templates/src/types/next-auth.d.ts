import "next-auth";
import "next-auth/jwt";

declare module "next-auth" {
  interface Session {
    participantId: string;
    participantName: string;
    // GitHub access token (gist scope) for publishing the attestation Gist.
    accessToken?: string;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    participantId?: string;
    participantName?: string;
    accessToken?: string;
  }
}
