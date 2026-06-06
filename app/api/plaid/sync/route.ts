import { NextResponse } from "next/server";
import { safeErrorMessage } from "@/lib/data-safety";
import { syncPlaidItem } from "@/lib/plaid-sync";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({})) as { itemId?: string };
    const sync = await syncPlaidItem(body.itemId);
    return NextResponse.json({ ok: true, sync });
  } catch (error) {
    return NextResponse.json({ error: safeErrorMessage(error, "Unable to sync Plaid data") }, { status: 500 });
  }
}
