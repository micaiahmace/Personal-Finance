import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

type BulkTransactionPatch = {
  deleteIds?: string[];
  updates?: Array<{
    id: string;
    categoryId?: string | null;
    reviewed?: boolean;
    excluded?: boolean;
    internal?: boolean;
    note?: string | null;
  }>;
};

export async function POST(request: Request) {
  const body = (await request.json()) as BulkTransactionPatch;
  const deleteIds = cleanIds(body.deleteIds);
  const updates = Array.isArray(body.updates) ? body.updates.filter((update) => update.id) : [];

  await prisma.$transaction(async (tx) => {
    if (deleteIds.length > 0) {
      await tx.transaction.deleteMany({ where: { id: { in: deleteIds } } });
    }

    for (const update of updates) {
      await tx.transaction.updateMany({
        where: { id: update.id },
        data: {
          ...(update.categoryId !== undefined ? { categoryId: update.categoryId } : {}),
          ...(update.reviewed !== undefined ? { reviewed: update.reviewed } : {}),
          ...(update.excluded !== undefined ? { excluded: update.excluded } : {}),
          ...(update.internal !== undefined ? { internalTransfer: update.internal } : {}),
          ...(update.note !== undefined ? { note: update.note } : {})
        }
      });
    }
  });

  return NextResponse.json({ ok: true });
}

function cleanIds(ids?: string[]) {
  return Array.isArray(ids) ? [...new Set(ids.filter(Boolean))] : [];
}
