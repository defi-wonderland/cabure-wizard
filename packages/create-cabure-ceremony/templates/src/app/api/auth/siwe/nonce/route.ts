import { NextResponse } from "next/server";

import { issueNonce } from "@/lib/siwe";

export async function POST(): Promise<NextResponse> {
  try {
    const nonce = await issueNonce();
    return NextResponse.json({ nonce });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to issue SIWE nonce";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
