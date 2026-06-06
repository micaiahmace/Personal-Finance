import { CountryCode, Products } from "plaid";
import { NextResponse } from "next/server";
import { getPlaidClient } from "@/lib/plaid";

export async function POST() {
  try {
    const plaid = getPlaidClient();
    const webhook = process.env.PLAID_WEBHOOK_URL;
    const response = await plaid.linkTokenCreate({
      user: { client_user_id: "local-user" },
      client_name: "Personal Finance",
      products: [Products.Transactions],
      transactions: { days_requested: 180 },
      country_codes: [CountryCode.Us],
      language: "en",
      webhook: webhook || undefined
    });

    return NextResponse.json(response.data);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to create Plaid link token" }, { status: 500 });
  }
}
