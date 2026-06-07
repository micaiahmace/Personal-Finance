import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET() {
  const [items, accountCount, transactionCount, holdingCount, latestTransaction] = await Promise.all([
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
    prisma.account.count({ where: { plaidAccountId: { not: null } } }),
    prisma.transaction.count({ where: { plaidTransactionId: { not: null } } }),
    prisma.investmentHolding.count(),
    prisma.transaction.findFirst({
      where: { plaidTransactionId: { not: null } },
      select: { date: true },
      orderBy: { date: "desc" }
    })
  ]);

  return NextResponse.json({
    configured: Boolean(process.env.PLAID_CLIENT_ID && process.env.PLAID_SECRET),
    env: process.env.PLAID_ENV || "sandbox",
    connectedItemCount: items.length,
    accountCount,
    transactionCount,
    holdingCount,
    latestTransactionDate: latestTransaction?.date.toISOString().slice(0, 10) || null,
    items: items.map((item) => ({
      itemId: item.itemId,
      institution: item.institution || "Connected institution",
      cursorReady: Boolean(item.cursor),
      createdAt: item.createdAt.toISOString(),
      updatedAt: item.updatedAt.toISOString()
    }))
  });
}
