import { NextResponse } from "next/server";

import { issueNonce } from "@/lib/siwe";

export async function POST(): Promise<NextResponse> {
  try {
    const nonce = await issueNonce();
    return NextResponse.json({ nonce });
  } catch {
    return NextResponse.json(
      { error: "Failed to issue SIWE nonce" },
      { status: 500 },
    );
  }
}
