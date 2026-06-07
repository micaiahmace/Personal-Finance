import type { Prisma } from "@prisma/client";
import { decryptSensitiveString } from "@/lib/data-safety";
import { INCOME_CATEGORY_ID, INCOME_GROUP_ID, ruleMatches } from "@/lib/finance";
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
  payment_channel?: string | null;
  personal_finance_category?: {
    primary?: string | null;
    detailed?: string | null;
  } | null;
  transaction_id: string;
};

type PlaidHoldingShape = {
  account_id: string;
  cost_basis?: number | null;
  institution_price?: number | null;
  institution_price_as_of?: string | null;
  institution_value?: number | null;
  iso_currency_code?: string | null;
  quantity: number;
  security_id: string;
};

type PlaidSecurityShape = {
  close_price?: number | null;
  close_price_as_of?: string | null;
  iso_currency_code?: string | null;
  name?: string | null;
  security_id: string;
  ticker_symbol?: string | null;
  type?: string | null;
};

type LocalAccountShape = {
  id: string;
  plaidAccountId?: string | null;
  type: string;
  currentBalance: number;
};

type LocalTransactionShape = Prisma.TransactionGetPayload<{ include: { splits: true } }>;
type RuleShape = { id: string; pattern: string; matchType: string; categoryId: string | null; enabled: boolean; internalTransfer: boolean };
type CategoryShape = { id: string; name: string };

type SyncLookups = {
  accountsByPlaidId: Map<string, LocalAccountShape>;
  existingByPlaidId: Map<string, LocalTransactionShape>;
  rules: RuleShape[];
  categories: CategoryShape[];
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

  const holdingsSync = await syncInvestmentHoldings(item.itemId, accessToken);

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

      const pageTransactions = [...added, ...modified];

      if (removed.length > 0) {
        await tx.transaction.deleteMany({
          where: { plaidTransactionId: { in: removed.map((transaction) => transaction.transaction_id) } }
        });
      }

      await ensureIncomeCategory(tx);
      const lookups = await getSyncLookups(tx, pageTransactions);
      for (const transaction of pageTransactions) {
        await upsertPlaidTransaction(tx, transaction, lookups);
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

  const protectedInvestmentTransactions = await prisma.$transaction(async (tx) => {
    if (addedCount > 0 || modifiedCount > 0 || removedCount > 0) {
      await detectInternalTransfers(tx);
      await inferRecurringCharges(tx);
    }
    return protectInvestmentTransactions(tx);
  });

  return {
    itemId: item.itemId,
    accounts: accounts.length,
    holdings: holdingsSync,
    protectedInvestmentTransactions,
    added: addedCount,
    modified: modifiedCount,
    removed: removedCount
  };
}

async function getSyncLookups(tx: Prisma.TransactionClient, transactions: PlaidTransactionShape[]): Promise<SyncLookups> {
  const accountIds = [...new Set(transactions.map((transaction) => transaction.account_id))];
  const plaidTransactionIds = [...new Set(transactions.map((transaction) => transaction.transaction_id))];
  const [accounts, existingTransactions, rules, categories] = await Promise.all([
    accountIds.length
      ? tx.account.findMany({
          where: { plaidAccountId: { in: accountIds } },
          select: { id: true, plaidAccountId: true, type: true, currentBalance: true }
        })
      : [],
    plaidTransactionIds.length
      ? tx.transaction.findMany({
          where: { plaidTransactionId: { in: plaidTransactionIds } },
          include: { splits: true }
        })
      : [],
    tx.merchantRule.findMany({
      where: { enabled: true },
      orderBy: { createdAt: "asc" }
    }),
    tx.budgetCategory.findMany({
      select: { id: true, name: true },
      orderBy: { order: "asc" }
    })
  ]);

  const accountsByPlaidId = new Map<string, LocalAccountShape>();
  for (const account of accounts) {
    if (account.plaidAccountId) accountsByPlaidId.set(account.plaidAccountId, account);
  }

  const existingByPlaidId = new Map<string, LocalTransactionShape>();
  for (const transaction of existingTransactions) {
    if (transaction.plaidTransactionId) existingByPlaidId.set(transaction.plaidTransactionId, transaction);
  }

  return {
    accountsByPlaidId,
    existingByPlaidId,
    rules,
    categories
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

async function syncInvestmentHoldings(itemId: string, accessToken: string) {
  const plaid = getPlaidClient();

  try {
    const response = await plaid.investmentsHoldingsGet({ access_token: accessToken });
    const holdings = response.data.holdings as PlaidHoldingShape[];
    const securities = response.data.securities as PlaidSecurityShape[];

    await prisma.$transaction(async (tx) => {
      const investmentAccounts = await tx.account.findMany({
        where: {
          plaidItemId: itemId,
          type: "Investment",
          plaidAccountId: { not: null }
        },
        select: { id: true, plaidAccountId: true }
      });
      const accountsByPlaidId = new Map(investmentAccounts.map((account) => [account.plaidAccountId, account.id]));
      const securitiesByPlaidId = new Map(securities.map((security) => [security.security_id, security]));

      await tx.investmentHolding.deleteMany({ where: { plaidItemId: itemId } });

      for (const security of securities) {
        await upsertInvestmentSecurity(tx, security);
      }

      const rows = holdings.flatMap((holding) => {
        const accountId = accountsByPlaidId.get(holding.account_id);
        if (!accountId) return [];

        const security = securitiesByPlaidId.get(holding.security_id);
        if (!security) return [];

        return [{
          accountId,
          securityId: localSecurityId(holding.security_id),
          plaidItemId: itemId,
          quantity: holding.quantity,
          marketValue: holding.institution_value ?? Number(((holding.institution_price ?? 0) * holding.quantity).toFixed(2)),
          costBasis: holding.cost_basis ?? null,
          institutionPrice: holding.institution_price ?? null,
          institutionPriceAsOf: parseOptionalPlaidDate(holding.institution_price_as_of),
          isoCurrencyCode: holding.iso_currency_code || security.iso_currency_code || "USD"
        }];
      });

      if (rows.length > 0) {
        await tx.investmentHolding.createMany({ data: rows });
      }
    });

    return {
      synced: true,
      holdingCount: holdings.length,
      securityCount: securities.length
    };
  } catch (error) {
    return {
      synced: false,
      skipped: true,
      reason: plaidErrorSummary(error)
    };
  }
}

async function upsertInvestmentSecurity(tx: Prisma.TransactionClient, security: PlaidSecurityShape) {
  const name = security.name || security.ticker_symbol || "Unknown security";

  await tx.investmentSecurity.upsert({
    where: { id: localSecurityId(security.security_id) },
    create: {
      id: localSecurityId(security.security_id),
      plaidSecurityId: security.security_id,
      name,
      tickerSymbol: security.ticker_symbol || null,
      type: security.type || null,
      closePrice: security.close_price ?? null,
      closePriceAsOf: parseOptionalPlaidDate(security.close_price_as_of),
      isoCurrencyCode: security.iso_currency_code || "USD"
    },
    update: {
      plaidSecurityId: security.security_id,
      name,
      tickerSymbol: security.ticker_symbol || null,
      type: security.type || null,
      closePrice: security.close_price ?? null,
      closePriceAsOf: parseOptionalPlaidDate(security.close_price_as_of),
      isoCurrencyCode: security.iso_currency_code || "USD"
    }
  });
}

async function upsertPlaidTransaction(tx: Prisma.TransactionClient, transaction: PlaidTransactionShape, lookups: SyncLookups) {
  const localAccount = lookups.accountsByPlaidId.get(transaction.account_id);
  if (!localAccount) return;

  const merchant = transaction.merchant_name || transaction.name;
  const existing = lookups.existingByPlaidId.get(transaction.transaction_id);
  const matchingRule = ruleForMerchant(lookups.rules, merchant);
  const ruleInternalTransfer = Boolean(matchingRule?.internalTransfer);
  const investmentActivity = localAccount.type === "Investment";
  const normalizedAmount = normalizePlaidAmount(transaction.amount);
  const importedCategoryId = investmentActivity || ruleInternalTransfer ? null : matchingRule?.categoryId || categoryForPlaidTransaction(lookups, transaction, merchant, normalizedAmount);
  const categoryId = investmentActivity ? null : existing?.categoryId || importedCategoryId;
  const likelyTransfer = investmentActivity || ruleInternalTransfer || isTransferLike(merchant) || isTransferLike(transaction.name);
  const keepManualFlags = !investmentActivity && Boolean(existing?.reviewed || existing?.splits.length || existing?.excluded || existing?.internalTransfer || existing?.note);
  const nextCategoryId = investmentActivity ? null : keepManualFlags ? existing?.categoryId ?? null : categoryId;
  const nextReviewed = investmentActivity ? true : keepManualFlags ? existing?.reviewed ?? false : Boolean(categoryId || likelyTransfer);
  const nextExcluded = investmentActivity ? true : keepManualFlags ? existing?.excluded ?? false : ruleInternalTransfer;
  const nextInternalTransfer = investmentActivity ? true : keepManualFlags ? existing?.internalTransfer ?? false : ruleInternalTransfer;
  const nextNote =
    investmentActivity
      ? "Investment account activity is excluded from spending."
      : keepManualFlags
      ? existing?.note ?? null
      : ruleInternalTransfer
        ? "Marked internal transfer by merchant rule."
        : likelyTransfer
          ? categoryId ? null : "Transfer-like Plaid transaction. Pair detection will exclude matched internal transfers."
          : null;

  await tx.transaction.upsert({
    where: { plaidTransactionId: transaction.transaction_id },
    create: {
      id: localTransactionId(transaction.transaction_id),
      plaidTransactionId: transaction.transaction_id,
      accountId: localAccount.id,
      categoryId: nextCategoryId,
      date: parsePlaidDate(transaction.date),
      name: transaction.name,
      merchantName: merchant,
      amount: normalizedAmount,
      isoCurrencyCode: transaction.iso_currency_code || "USD",
      reviewed: nextReviewed,
      pending: Boolean(transaction.pending),
      excluded: nextExcluded,
      internalTransfer: nextInternalTransfer,
      note: nextNote
    },
    update: {
      accountId: localAccount.id,
      categoryId: nextCategoryId,
      date: parsePlaidDate(transaction.date),
      name: transaction.name,
      merchantName: merchant,
      amount: normalizedAmount,
      isoCurrencyCode: transaction.iso_currency_code || "USD",
      pending: Boolean(transaction.pending),
      reviewed: nextReviewed,
      excluded: nextExcluded,
      internalTransfer: nextInternalTransfer,
      note: nextNote
    }
  });
}

function ruleForMerchant(rules: RuleShape[], merchant: string) {
  return rules.find((rule) =>
    ruleMatches({
      id: rule.id,
      pattern: rule.pattern,
      matchType: rule.matchType as "exact" | "contains",
      categoryId: rule.categoryId,
      internal: rule.internalTransfer,
      enabled: rule.enabled
    }, merchant)
  ) || null;
}

function categoryForPlaidTransaction(lookups: SyncLookups, transaction: PlaidTransactionShape, merchant: string, normalizedAmount: number) {
  if (normalizedAmount > 0) return INCOME_CATEGORY_ID;

  const plaidCategoryText = [
    transaction.personal_finance_category?.primary,
    transaction.personal_finance_category?.detailed,
    transaction.name,
    merchant
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return fallbackCategoryId(lookups.categories, plaidCategoryText);
}

async function ensureIncomeCategory(tx: Prisma.TransactionClient) {
  await tx.budgetGroup.upsert({
    where: { id: INCOME_GROUP_ID },
    create: {
      id: INCOME_GROUP_ID,
      name: "Income",
      color: "#16dc72",
      order: 99,
      expanded: false
    },
    update: {
      name: "Income",
      color: "#16dc72"
    }
  });

  await tx.budgetCategory.upsert({
    where: { id: INCOME_CATEGORY_ID },
    create: {
      id: INCOME_CATEGORY_ID,
      groupId: INCOME_GROUP_ID,
      name: "Income",
      icon: "$",
      monthlyLimit: 0,
      order: 1
    },
    update: {
      groupId: INCOME_GROUP_ID,
      name: "Income",
      icon: "$",
      monthlyLimit: 0,
      order: 1
    }
  });
}

function fallbackCategoryId(categories: CategoryShape[], text: string) {
  return (
    categoryByKeywords(categories, text, "Groceries", ["grocery", "groceries", "supermarket", "supermarkets", "wholesale", "wholefoods", "walmart"]) ||
    categoryByKeywords(categories, text, "Eating out", ["restaurant", "restaurants", "coffee", "fast food", "dining", "chick-fil-a", "mcdonald", "dunkin"]) ||
    categoryByKeywords(categories, text, "Gas", ["gas", "fuel", "service station", "sheetz"]) ||
    categoryByKeywords(categories, text, "Rent", ["rent", "rental"]) ||
    categoryByKeywords(categories, text, "Home Internet", ["internet", "telecom", "verizon", "comcast", "xfinity"]) ||
    categoryByKeywords(categories, text, "Loans", ["loan", "student loan", "education", "debt"]) ||
    categoryByKeywords(categories, text, "Shopping", ["shopping", "merchandise", "retail", "amazon", "target"]) ||
    categoryByKeywords(categories, text, "Car Insurance", ["insurance", "auto insurance"]) ||
    categoryByKeywords(categories, text, "Pets", ["pet", "pets", "veterinary", "vet"]) ||
    categoryByKeywords(categories, text, "Hobbies", ["hobby", "hobbies", "sporting", "recreation"]) ||
    null
  );
}

function categoryByKeywords(categories: Array<{ id: string; name: string }>, text: string, categoryName: string, keywords: string[]) {
  if (!keywords.some((keyword) => text.includes(keyword))) return null;
  return categories.find((category) => category.name.toLowerCase() === categoryName.toLowerCase())?.id || null;
}

function localAccountId(plaidAccountId: string) {
  return `plaid-account-${plaidAccountId}`;
}

function localTransactionId(plaidTransactionId: string) {
  return `plaid-transaction-${plaidTransactionId}`;
}

function localSecurityId(plaidSecurityId: string) {
  return `plaid-security-${plaidSecurityId}`;
}

function accountGroup(type: string, subtype?: string | null) {
  const normalizedSubtype = subtype?.toLowerCase() || "";
  if (type === "credit") return "Credit card";
  if (type === "depository") return "Depository";
  if (type === "investment" || normalizedSubtype.includes("ira") || normalizedSubtype.includes("401") || normalizedSubtype.includes("hsa")) return "Investment";
  return "Other";
}

function normalizePlaidAmount(amount: number) {
  return Number((-amount).toFixed(2));
}

function parsePlaidDate(value: string) {
  return new Date(`${value.slice(0, 10)}T00:00:00`);
}

function parseOptionalPlaidDate(value?: string | null) {
  return value ? parsePlaidDate(value) : null;
}

function plaidErrorSummary(error: unknown) {
  const plaidError = error as { response?: { data?: { error_code?: string; error_message?: string } } };
  const code = plaidError.response?.data?.error_code;
  const message = plaidError.response?.data?.error_message || (error instanceof Error ? error.message : "Investment holdings are not available for this item.");
  return code ? `${code}: ${message}` : message;
}

async function protectInvestmentTransactions(tx: Prisma.TransactionClient) {
  const result = await tx.transaction.updateMany({
    where: {
      account: { is: { type: "Investment" } },
      OR: [
        { categoryId: { not: null } },
        { reviewed: false },
        { excluded: false },
        { internalTransfer: false }
      ]
    },
    data: {
      categoryId: null,
      reviewed: true,
      excluded: true,
      internalTransfer: true,
      note: "Investment account activity is excluded from spending."
    }
  });

  return result.count;
}

async function detectInternalTransfers(tx: Prisma.TransactionClient) {
  const transactions = await tx.transaction.findMany({
    where: { pending: false },
    include: { account: true }
  });

  const outflows = transactions.filter((transaction) => transaction.amount < 0);
  const inflows = transactions.filter((transaction) => transaction.amount > 0);
  const inflowsByAmount = new Map<string, typeof inflows>();
  const matchedIds = new Set<string>();

  for (const inflow of inflows) {
    const key = amountKey(inflow.amount);
    const amountMatches = inflowsByAmount.get(key) || [];
    amountMatches.push(inflow);
    inflowsByAmount.set(key, amountMatches);
  }

  for (const outflow of outflows) {
    for (const inflow of inflowsByAmount.get(amountKey(outflow.amount)) || []) {
      if (matchedIds.has(outflow.id) || matchedIds.has(inflow.id)) continue;
      if (outflow.accountId === inflow.accountId) continue;
      if (Math.abs(dayDiff(outflow.date, inflow.date)) > 4) continue;
      if (!isLikelyTransferPair(outflow.name, inflow.name, outflow.account, inflow.account)) continue;

      matchedIds.add(outflow.id);
      matchedIds.add(inflow.id);
    }
  }

  if (matchedIds.size === 0) return;

  await tx.transaction.updateMany({
    where: { id: { in: [...matchedIds] } },
    data: {
      internalTransfer: true,
      excluded: true,
      reviewed: true,
      categoryId: null,
      note: "Likely internal transfer detected from Plaid sync."
    }
  });
}

async function inferRecurringCharges(tx: Prisma.TransactionClient) {
  const transactions = await tx.transaction.findMany({
    where: {
      amount: { lt: 0 },
      excluded: false,
      internalTransfer: false,
      pending: false
    },
    orderBy: { date: "desc" }
  });

  const groups = new Map<string, typeof transactions>();
  for (const transaction of transactions) {
    const key = `${merchantKey(transaction.merchantName || transaction.name)}:${Math.round(Math.abs(transaction.amount))}`;
    const items = groups.get(key) || [];
    items.push(transaction);
    groups.set(key, items);
  }

  for (const [key, items] of groups) {
    if (items.length < 2) continue;

    const sorted = [...items].sort((a, b) => a.date.getTime() - b.date.getTime());
    const gaps = sorted.slice(1).map((item, index) => dayDiff(sorted[index].date, item.date));
    const monthly = gaps.some((gap) => gap >= 25 && gap <= 40);
    if (!monthly) continue;

    const latest = sorted.at(-1);
    if (!latest) continue;

    const nextDate = new Date(latest.date);
    nextDate.setMonth(nextDate.getMonth() + 1);

    await tx.recurringCharge.upsert({
      where: { id: recurringId(key) },
      create: {
        id: recurringId(key),
        merchant: latest.merchantName || latest.name,
        cadence: "Monthly",
        nextDate,
        amount: Math.abs(latest.amount),
        categoryId: latest.categoryId
      },
      update: {
        merchant: latest.merchantName || latest.name,
        cadence: "Monthly",
        nextDate,
        amount: Math.abs(latest.amount),
        categoryId: latest.categoryId
      }
    });
  }
}

function dayDiff(a: Date, b: Date) {
  return (b.getTime() - a.getTime()) / 86400000;
}

function amountKey(amount: number) {
  return Math.round(Math.abs(amount) * 100).toString();
}

function isLikelyTransferPair(outflowName: string, inflowName: string, outflowAccount: LocalAccountShape, inflowAccount: LocalAccountShape) {
  const combined = `${outflowName} ${inflowName}`.toLowerCase();
  if (isTransferLike(combined)) return true;
  if (outflowAccount.type === "Depository" && inflowAccount.type === "Depository") return true;
  if (outflowAccount.type === "Depository" && inflowAccount.type === "Investment") return true;
  return false;
}

function isTransferLike(value: string) {
  return /\b(transfer|xfer|withdrawal|deposit|payment to|payment from|ach|online transfer|external transfer|robinhood|schwab|fidelity)\b/i.test(value);
}

function merchantKey(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48) || "merchant";
}

function recurringId(value: string) {
  return `plaid-recurring-${merchantKey(value)}`;
}
