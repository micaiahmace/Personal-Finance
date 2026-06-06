import { NextResponse } from "next/server";
import { dataEncryptionConfigured } from "@/lib/data-safety";

export function GET() {
  const localEncryptionReady = dataEncryptionConfigured();

  return NextResponse.json({
    ok: true,
    mode: "local-first",
    plaidConfigured: Boolean(process.env.PLAID_CLIENT_ID && process.env.PLAID_SECRET),
    openaiConfigured: Boolean(process.env.OPENAI_API_KEY),
    localDataStorage: "sqlite",
    localEncryptionReady,
    plaidTokenStorage: localEncryptionReady ? "encrypted-at-rest-ready" : "blocked-until-app-data-key-is-set",
    aiDataBoundary: "sanitized-merchant-category-context"
  });
}
