import { NextResponse } from "next/server";
import { dataEncryptionConfigured, encryptSensitiveString, safeErrorMessage } from "@/lib/data-safety";
import { getPlaidClient } from "@/lib/plaid";
import { syncPlaidItem } from "@/lib/plaid-sync";
import { prisma } from "@/lib/prisma";

export async function POST(request: Request) {
  try {
    const { publicToken, institution } = (await request.json()) as { publicToken?: string; institution?: string };

    if (!publicToken) {
      return NextResponse.json({ error: "Missing publicToken" }, { status: 400 });
    }

    if (!dataEncryptionConfigured()) {
      return NextResponse.json({ error: "Missing APP_DATA_KEY in .env. Add a long random value before connecting real accounts." }, { status: 500 });
    }

    const plaid = getPlaidClient();
    const response = await plaid.itemPublicTokenExchange({ public_token: publicToken });
    const encryptedAccessToken = encryptSensitiveString(response.data.access_token);

    await prisma.plaidItem.upsert({
      where: { itemId: response.data.item_id },
      create: {
        itemId: response.data.item_id,
        accessToken: encryptedAccessToken,
        institution: institution || null
      },
      update: {
        accessToken: encryptedAccessToken,
        institution: institution || null
      }
    });

    const sync = await syncPlaidItem(response.data.item_id).catch((error: unknown) => ({
      deferred: true,
      error: safeErrorMessage(error, "Plaid connected, but transactions are not ready to sync yet.")
    }));

    return NextResponse.json({
      itemId: response.data.item_id,
      accessTokenStored: true,
      sync
    });
  } catch (error) {
    return NextResponse.json({ error: safeErrorMessage(error, "Unable to exchange Plaid token") }, { status: 500 });
  }
}
