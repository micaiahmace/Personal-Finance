import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

type TransactionPatch = {
  categoryId?: string | null;
  reviewed?: boolean;
  excluded?: boolean;
  internal?: boolean;
  note?: string | null;
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
    ...(patch.categoryId !== undefined ? { categoryId: patch.categoryId } : {}),
    ...(patch.reviewed !== undefined ? { reviewed: patch.reviewed } : {}),
    ...(patch.excluded !== undefined ? { excluded: patch.excluded } : {}),
    ...(patch.internal !== undefined ? { internalTransfer: patch.internal } : {}),
    ...(patch.note !== undefined ? { note: patch.note } : {})
  };
}
