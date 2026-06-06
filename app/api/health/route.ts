import { NextResponse } from "next/server";
import { dataEncryptionConfigured } from "@/lib/data-safety";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const localEncryptionReady = dataEncryptionConfigured();
  const connectedPlaidItems = await prisma.plaidItem.count().catch(() => 0);

  return NextResponse.json({
    ok: true,
    mode: "local-first",
    plaidConfigured: Boolean(process.env.PLAID_CLIENT_ID && process.env.PLAID_SECRET),
    connectedPlaidItems,
    openaiConfigured: Boolean(process.env.OPENAI_API_KEY),
    localDataStorage: "sqlite",
    localEncryptionReady,
    plaidTokenStorage: localEncryptionReady ? "encrypted-at-rest-ready" : "blocked-until-app-data-key-is-set",
    aiDataBoundary: "sanitized-merchant-category-context"
  });
}
