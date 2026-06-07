import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET() {
  const [items, plaidAccounts, transactionCount, holdingCount, investmentHoldings, latestTransaction] = await Promise.all([
    prisma.plaidItem.findMany({
      select: {
        itemId: true,
        institution: true,
        cursor: true,
        createdAt: true,
        updatedAt: true
      },
      orderBy: { createdAt: "asc" }
    }),
    prisma.account.findMany({
      where: { plaidAccountId: { not: null } },
      select: { plaidItemId: true, type: true }
    }),
    prisma.transaction.count({ where: { plaidTransactionId: { not: null } } }),
    prisma.investmentHolding.count(),
    prisma.investmentHolding.findMany({
      select: { plaidItemId: true }
    }),
    prisma.transaction.findFirst({
      where: { plaidTransactionId: { not: null } },
      select: { date: true },
      orderBy: { date: "desc" }
    })
  ]);

  const accountsByItemId = countByItem(plaidAccounts.map((account) => account.plaidItemId));
  const investmentAccountsByItemId = countByItem(plaidAccounts.filter((account) => account.type === "Investment").map((account) => account.plaidItemId));
  const holdingsByItemId = countByItem(investmentHoldings.map((holding) => holding.plaidItemId));

  return NextResponse.json({
    configured: Boolean(process.env.PLAID_CLIENT_ID && process.env.PLAID_SECRET),
    env: process.env.PLAID_ENV || "sandbox",
    connectedItemCount: items.length,
    accountCount: plaidAccounts.length,
    transactionCount,
    holdingCount,
    latestTransactionDate: latestTransaction?.date.toISOString().slice(0, 10) || null,
    items: items.map((item) => ({
      itemId: item.itemId,
      institution: item.institution || "Connected institution",
      cursorReady: Boolean(item.cursor),
      accountCount: accountsByItemId.get(item.itemId) || 0,
      investmentAccountCount: investmentAccountsByItemId.get(item.itemId) || 0,
      holdingCount: holdingsByItemId.get(item.itemId) || 0,
      createdAt: item.createdAt.toISOString(),
      updatedAt: item.updatedAt.toISOString()
    }))
  });
}

function countByItem(values: Array<string | null>) {
  const counts = new Map<string, number>();
  for (const value of values) {
    if (!value) continue;
    counts.set(value, (counts.get(value) || 0) + 1);
  }
  return counts;
}
