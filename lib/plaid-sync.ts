import type { Prisma } from "@prisma/client";
import { decryptSensitiveString } from "@/lib/data-safety";
import { ruleMatches } from "@/lib/finance";
import { getPlaidClient } from "@/lib/plaid";
import { prisma } from "@/lib/prisma";

type PlaidAccountShape = {
  account_id: string;
  balances: {
    available?: number | null;
    current?: number | null;
    iso_currency_code?: string | null;
  };
  mask?: string | null;
  name: string;
  official_name?: string | null;
  subtype?: string | null;
  type: string;
};

type PlaidTransactionShape = {
  account_id: string;
  amount: number;
  authorized_date?: string | null;
  date: string;
  iso_currency_code?: string | null;
  merchant_name?: string | null;
  name: string;
  pending?: boolean | null;
  transaction_id: string;
};

export async function syncPlaidItem(itemId?: string) {
  const items = itemId
    ? await prisma.plaidItem.findMany({ where: { itemId } })
    : await prisma.plaidItem.findMany();

  const results = [];
  for (const item of items) {
    results.push(await syncOnePlaidItem(item));
  }

  return {
    itemCount: items.length,
    results
  };
}

async function syncOnePlaidItem(item: { id: string; itemId: string; accessToken: string; cursor: string | null }) {
  const plaid = getPlaidClient();
  const accessToken = decryptSensitiveString(item.accessToken);
  const accountsResponse = await plaid.accountsGet({ access_token: accessToken });
  const accounts = accountsResponse.data.accounts as PlaidAccountShape[];

  await prisma.$transaction(async (tx) => {
    for (const account of accounts) {
      await upsertPlaidAccount(tx, item.itemId, account);
    }
  });

  let cursor = item.cursor || undefined;
  let hasMore = true;
  let addedCount = 0;
  let modifiedCount = 0;
  let removedCount = 0;

  while (hasMore) {
    const response = await plaid.transactionsSync({
      access_token: accessToken,
      cursor,
      count: 500
    });

    const added = response.data.added as PlaidTransactionShape[];
    const modified = response.data.modified as PlaidTransactionShape[];
    const removed = response.data.removed;

    await prisma.$transaction(async (tx) => {
      for (const account of response.data.accounts as PlaidAccountShape[]) {
        await upsertPlaidAccount(tx, item.itemId, account);
      }

      for (const transaction of [...added, ...modified]) {
        await upsertPlaidTransaction(tx, transaction);
      }

      if (removed.length > 0) {
        await tx.transaction.deleteMany({
          where: { plaidTransactionId: { in: removed.map((transaction) => transaction.transaction_id) } }
        });
      }

      await tx.plaidItem.update({
        where: { id: item.id },
        data: { cursor: response.data.next_cursor }
      });
    });

    addedCount += added.length;
    modifiedCount += modified.length;
    removedCount += removed.length;
    cursor = response.data.next_cursor;
    hasMore = response.data.has_more;
  }

  return {
    itemId: item.itemId,
    accounts: accounts.length,
    added: addedCount,
    modified: modifiedCount,
    removed: removedCount
  };
}

async function upsertPlaidAccount(tx: Prisma.TransactionClient, itemId: string, account: PlaidAccountShape) {
  await tx.account.upsert({
    where: { plaidAccountId: account.account_id },
    create: {
      id: localAccountId(account.account_id),
      plaidAccountId: account.account_id,
      plaidItemId: itemId,
      name: account.name,
      officialName: account.official_name || null,
      type: accountGroup(account.type, account.subtype),
      subtype: account.subtype || "Account",
      mask: account.mask || null,
      currentBalance: account.balances.current ?? 0,
      availableBalance: account.balances.available ?? account.balances.current ?? 0,
      isoCurrencyCode: account.balances.iso_currency_code || "USD"
    },
    update: {
      plaidItemId: itemId,
      name: account.name,
      officialName: account.official_name || null,
      type: accountGroup(account.type, account.subtype),
      subtype: account.subtype || "Account",
      mask: account.mask || null,
      currentBalance: account.balances.current ?? 0,
      availableBalance: account.balances.available ?? account.balances.current ?? 0,
      isoCurrencyCode: account.balances.iso_currency_code || "USD"
    }
  });
}

async function upsertPlaidTransaction(tx: Prisma.TransactionClient, transaction: PlaidTransactionShape) {
  const localAccount = await tx.account.findUnique({
    where: { plaidAccountId: transaction.account_id }
  });

  if (!localAccount) return;

  const merchant = transaction.merchant_name || transaction.name;
  const categoryId = await categoryForMerchant(tx, merchant);

  await tx.transaction.upsert({
    where: { plaidTransactionId: transaction.transaction_id },
    create: {
      id: localTransactionId(transaction.transaction_id),
      plaidTransactionId: transaction.transaction_id,
      accountId: localAccount.id,
      categoryId,
      date: parsePlaidDate(transaction.date),
      name: transaction.name,
      merchantName: merchant,
      amount: normalizePlaidAmount(transaction.amount),
      isoCurrencyCode: transaction.iso_currency_code || "USD",
      reviewed: Boolean(categoryId),
      pending: Boolean(transaction.pending),
      excluded: false,
      internalTransfer: false
    },
    update: {
      accountId: localAccount.id,
      categoryId,
      date: parsePlaidDate(transaction.date),
      name: transaction.name,
      merchantName: merchant,
      amount: normalizePlaidAmount(transaction.amount),
      isoCurrencyCode: transaction.iso_currency_code || "USD",
      pending: Boolean(transaction.pending)
    }
  });
}

async function categoryForMerchant(tx: Prisma.TransactionClient, merchant: string) {
  const rules = await tx.merchantRule.findMany({
    where: { enabled: true },
    orderBy: { createdAt: "asc" }
  });

  return rules.find((rule) => ruleMatches({ id: rule.id, pattern: rule.pattern, matchType: rule.matchType as "exact" | "contains", categoryId: rule.categoryId, enabled: rule.enabled }, merchant))?.categoryId || null;
}

function localAccountId(plaidAccountId: string) {
  return `plaid-account-${plaidAccountId}`;
}

function localTransactionId(plaidTransactionId: string) {
  return `plaid-transaction-${plaidTransactionId}`;
}

function accountGroup(type: string, subtype?: string | null) {
  if (type === "credit") return "Credit card";
  if (type === "depository") return "Depository";
  if (type === "investment" || subtype?.includes("ira") || subtype?.includes("401")) return "Investment";
  return "Other";
}

function normalizePlaidAmount(amount: number) {
  return Number((-amount).toFixed(2));
}

function parsePlaidDate(value: string) {
  return new Date(`${value.slice(0, 10)}T00:00:00`);
}
