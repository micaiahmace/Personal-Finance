import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

type TransactionPatch = {
  accountId?: string;
  amount?: number;
  categoryId?: string | null;
  date?: string;
  excluded?: boolean;
  internal?: boolean;
  merchant?: string;
  name?: string;
  note?: string | null;
  reviewed?: boolean;
  splits?: Array<{ categoryId: string; amount: number }>;
};

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const patch = (await request.json()) as TransactionPatch;

  await prisma.$transaction(async (tx) => {
    await tx.transaction.update({
      where: { id },
      data: transactionPatchData(patch)
    });

    if (Array.isArray(patch.splits)) {
      await tx.transactionSplit.deleteMany({ where: { transactionId: id } });

      const splits = patch.splits
        .filter((split) => split.categoryId && Number.isFinite(split.amount))
        .map((split, index) => ({
          id: `split-${id}-${index}`,
          transactionId: id,
          categoryId: split.categoryId,
          amount: split.amount
        }));

      if (splits.length > 0) {
        await tx.transactionSplit.createMany({ data: splits });
      }
    }
  });

  return NextResponse.json({ ok: true });
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  await prisma.transaction.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}

function transactionPatchData(patch: TransactionPatch) {
  return {
    ...(patch.accountId !== undefined ? { accountId: patch.accountId } : {}),
    ...(patch.amount !== undefined && Number.isFinite(patch.amount) ? { amount: patch.amount } : {}),
    ...(patch.categoryId !== undefined ? { categoryId: patch.categoryId } : {}),
    ...(patch.date !== undefined ? { date: parseTransactionDate(patch.date) } : {}),
    ...(patch.excluded !== undefined ? { excluded: patch.excluded } : {}),
    ...(patch.internal !== undefined ? { internalTransfer: patch.internal } : {}),
    ...(patch.merchant !== undefined ? { merchantName: patch.merchant || null } : {}),
    ...(patch.name !== undefined ? { name: patch.name } : {}),
    ...(patch.note !== undefined ? { note: patch.note } : {}),
    ...(patch.reviewed !== undefined ? { reviewed: patch.reviewed } : {})
  };
}

function parseTransactionDate(value: string) {
  return new Date(`${value.slice(0, 10)}T00:00:00`);
}
