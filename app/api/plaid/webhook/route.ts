import { NextRequest, NextResponse } from "next/server";
import { syncPlaidItem } from "@/lib/plaid-sync";

export async function POST(request: NextRequest) {
  const payload = await request.json().catch(() => null);
  const itemId = typeof payload?.item_id === "string" ? payload.item_id : null;
  const webhookType = typeof payload?.webhook_type === "string" ? payload.webhook_type : "unknown";
  const webhookCode = typeof payload?.webhook_code === "string" ? payload.webhook_code : "unknown";

  if (!itemId) {
    return NextResponse.json({
      ok: true,
      ignored: true,
      reason: "Plaid webhook did not include an item_id."
    });
  }

  if (webhookType !== "TRANSACTIONS") {
    return NextResponse.json({
      ok: true,
      ignored: true,
      itemId,
      webhookType,
      webhookCode
    });
  }

  const sync = await syncPlaidItem(itemId);

  return NextResponse.json({
    ok: true,
    itemId,
    webhookType,
    webhookCode,
    sync
  });
}
