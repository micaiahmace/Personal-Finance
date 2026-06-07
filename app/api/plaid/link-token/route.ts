import { CountryCode, Products } from "plaid";
import { NextResponse } from "next/server";
import { decryptSensitiveString } from "@/lib/data-safety";
import { getPlaidClient } from "@/lib/plaid";
import { prisma } from "@/lib/prisma";

export async function POST(request: Request) {
  try {
    const plaid = getPlaidClient();
    const webhook = process.env.PLAID_WEBHOOK_URL;
    const body = (await request.json().catch(() => ({}))) as { itemId?: string };

    if (body.itemId) {
      const item = await prisma.plaidItem.findUnique({ where: { itemId: body.itemId } });
      if (!item) {
        return NextResponse.json({ error: "Connected Plaid item was not found." }, { status: 404 });
      }

      const investmentAccountCount = await prisma.account.count({
        where: {
          plaidItemId: item.itemId,
          type: "Investment"
        }
      });
      if (investmentAccountCount === 0) {
        return NextResponse.json({ error: "This connection does not have investment accounts to update." }, { status: 400 });
      }

      const response = await plaid.linkTokenCreate({
        user: { client_user_id: "local-user" },
        client_name: "Personal Finance",
        access_token: decryptSensitiveString(item.accessToken),
        additional_consented_products: [Products.Investments],
        country_codes: [CountryCode.Us],
        language: "en",
        webhook: webhook || undefined
      });

      return NextResponse.json({ ...response.data, mode: "update", itemId: item.itemId });
    }

    const response = await plaid.linkTokenCreate({
      user: { client_user_id: "local-user" },
      client_name: "Personal Finance",
      products: [Products.Transactions],
      optional_products: [Products.Investments],
      transactions: { days_requested: 180 },
      country_codes: [CountryCode.Us],
      language: "en",
      webhook: webhook || undefined
    });

    return NextResponse.json(response.data);
  } catch (error) {
    return NextResponse.json({ error: plaidLinkErrorMessage(error) }, { status: 500 });
  }
}

function plaidLinkErrorMessage(error: unknown) {
  const plaidError = error as { response?: { data?: { error_code?: string; error_message?: string } } };
  const code = plaidError.response?.data?.error_code;
  const message = plaidError.response?.data?.error_message;
  if (code && message) return `${code}: ${message}`;
  if (message) return message;
  return error instanceof Error ? error.message : "Unable to create Plaid link token";
}
