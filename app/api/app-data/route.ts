import { NextResponse } from "next/server";
import { INCOME_CATEGORY_ID, INCOME_GROUP_ID } from "@/lib/finance";
import { prisma } from "@/lib/prisma";
import { seedState } from "@/lib/seed-data";
import type { FinanceState, Recurrence } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET() {
  await ensureSeeded();
  return NextResponse.json(await readFinanceState());
}

export async function PUT(request: Request) {
  const state = (await request.json()) as FinanceState;
  await writeFinanceState(state);
  return NextResponse.json({ ok: true });
}

async function ensureSeeded() {
  const categoryCount = await prisma.budgetCategory.count();
  if (categoryCount === 0) {
    await writeFinanceState(seedState);
  }
  await ensureIncomeCategory();
}

async function readFinanceState(): Promise<FinanceState> {
  const [groups, categories, accounts, investmentHoldings, transactions, recurrences, goals, rules] = await Promise.all([
    prisma.budgetGroup.findMany({ orderBy: { order: "asc" } }),
    prisma.budgetCategory.findMany({ orderBy: [{ groupId: "asc" }, { order: "asc" }] }),
    prisma.account.findMany({ orderBy: { name: "asc" } }),
    prisma.investmentHolding.findMany({
      include: { security: true },
      orderBy: { marketValue: "desc" }
    }),
    prisma.transaction.findMany({ orderBy: { date: "desc" }, include: { splits: true } }),
    prisma.recurringCharge.findMany({ orderBy: { nextDate: "asc" } }),
    prisma.savingsGoal.findMany({ orderBy: { createdAt: "asc" } }),
    prisma.merchantRule.findMany({ orderBy: { createdAt: "asc" } })
  ]);
  const transactionIds = new Set(transactions.map((transaction) => transaction.id));

  return {
    ...seedState,
    groups: groups.map((group) => ({
      id: group.id,
      name: group.name,
      color: group.color,
      order: group.order,
      expanded: group.expanded
    })),
    categories: categories.map((category) => ({
      id: category.id,
      groupId: category.groupId,
      name: category.name,
      icon: category.icon,
      budget: category.monthlyLimit,
      order: category.order
    })),
    accounts: accounts.map((account) => ({
      id: account.id,
      group: account.type as FinanceState["accounts"][number]["group"],
      name: account.name,
      officialName: account.officialName || "",
      subtype: account.subtype || "Account",
      last4: account.mask || "",
      balance: account.currentBalance,
      available: account.availableBalance ?? account.currentBalance,
      change: 0
    })),
    investmentHoldings: investmentHoldings.map((holding) => ({
      id: holding.id,
      accountId: holding.accountId,
      securityId: holding.securityId,
      name: holding.security.name,
      ticker: holding.security.tickerSymbol || "",
      type: holding.security.type || "",
      quantity: holding.quantity,
      value: holding.marketValue,
      costBasis: holding.costBasis,
      price: holding.institutionPrice ?? holding.security.closePrice,
      currency: holding.isoCurrencyCode || holding.security.isoCurrencyCode || "USD"
    })),
    transactions: transactions.map((transaction) => ({
      id: transaction.id,
      date: transaction.date.toISOString().slice(0, 10),
      name: transaction.name,
      merchant: transaction.merchantName || transaction.name,
      amount: transaction.amount,
      accountId: transaction.accountId,
      categoryId: transaction.categoryId,
      reviewed: transaction.reviewed,
      excluded: transaction.excluded,
      internal: transaction.internalTransfer,
      note: transaction.note || "",
      splits: transaction.splits.map((split) => ({ categoryId: split.categoryId, amount: split.amount }))
    })),
    recurrences: recurrences.map((recurrence) => ({
      id: recurrence.id,
      date: formatShortDate(recurrence.nextDate),
      nextDate: recurrence.nextDate.toISOString().slice(0, 10),
      merchant: recurrence.merchant,
      cadence: recurrence.cadence,
      amount: recurrence.amount,
      categoryId: recurrence.categoryId || ""
    })),
    goals: goals.map((goal) => ({
      id: goal.id,
      name: goal.name,
      icon: goal.icon,
      targetAmount: goal.targetAmount,
      currentAmount: goal.currentAmount,
      targetDate: goal.targetDate.toISOString().slice(0, 10),
      accountId: goal.accountId || "",
      priority: goal.priority as FinanceState["goals"][number]["priority"],
      notes: goal.notes || "",
      status: goal.status as FinanceState["goals"][number]["status"]
    })),
    rules: rules.map((rule) => ({
      id: rule.id,
      pattern: rule.pattern,
      matchType: rule.matchType as FinanceState["rules"][number]["matchType"],
      categoryId: rule.categoryId || null,
      internal: rule.internalTransfer,
      enabled: rule.enabled
    })),
    aiInbox: seedState.aiInbox.filter((item) => transactionIds.has(item.transactionId))
  };
}

async function writeFinanceState(state: FinanceState) {
  const writableState = withIncomeDefaults(state);
  await prisma.$transaction(async (tx) => {
    const [accounts, transactions, investmentSecurities, investmentHoldings] = await Promise.all([
      tx.account.findMany(),
      tx.transaction.findMany(),
      tx.investmentSecurity.findMany(),
      tx.investmentHolding.findMany()
    ]);
    const existingAccounts = new Map(accounts.map((account) => [account.id, account]));
    const existingTransactions = new Map(transactions.map((transaction) => [transaction.id, transaction]));

    await tx.transactionSplit.deleteMany();
    await tx.transaction.deleteMany();
    await tx.merchantRule.deleteMany();
    await tx.recurringCharge.deleteMany();
    await tx.savingsGoal.deleteMany();
    await tx.investmentHolding.deleteMany();
    await tx.investmentSecurity.deleteMany();
    await tx.budgetCategory.deleteMany();
    await tx.budgetGroup.deleteMany();
    await tx.account.deleteMany();

    await tx.budgetGroup.createMany({
      data: writableState.groups.map((group) => ({
        id: group.id,
        name: group.name,
        color: group.color,
        order: group.order,
        expanded: group.expanded
      }))
    });

    await tx.account.createMany({
      data: writableState.accounts.map((account) => ({
        plaidAccountId: existingAccounts.get(account.id)?.plaidAccountId || null,
        plaidItemId: existingAccounts.get(account.id)?.plaidItemId || null,
        id: account.id,
        name: account.name,
        officialName: account.officialName || existingAccounts.get(account.id)?.officialName || null,
        type: account.group,
        subtype: account.subtype,
        mask: account.last4,
        currentBalance: account.balance,
        availableBalance: account.available,
        isoCurrencyCode: existingAccounts.get(account.id)?.isoCurrencyCode || "USD"
      }))
    });

    if (investmentSecurities.length > 0) {
      await tx.investmentSecurity.createMany({
        data: investmentSecurities.map((security) => ({
          id: security.id,
          plaidSecurityId: security.plaidSecurityId,
          name: security.name,
          tickerSymbol: security.tickerSymbol,
          type: security.type,
          closePrice: security.closePrice,
          closePriceAsOf: security.closePriceAsOf,
          isoCurrencyCode: security.isoCurrencyCode
        }))
      });
    }

    const nextAccountIds = new Set(writableState.accounts.map((account) => account.id));
    const preservedSecurityIds = new Set(investmentSecurities.map((security) => security.id));
    const preservedHoldings = investmentHoldings.filter((holding) => nextAccountIds.has(holding.accountId) && preservedSecurityIds.has(holding.securityId));
    if (preservedHoldings.length > 0) {
      await tx.investmentHolding.createMany({
        data: preservedHoldings.map((holding) => ({
          id: holding.id,
          accountId: holding.accountId,
          securityId: holding.securityId,
          plaidItemId: holding.plaidItemId,
          quantity: holding.quantity,
          marketValue: holding.marketValue,
          costBasis: holding.costBasis,
          institutionPrice: holding.institutionPrice,
          institutionPriceAsOf: holding.institutionPriceAsOf,
          isoCurrencyCode: holding.isoCurrencyCode
        }))
      });
    }

    await tx.budgetCategory.createMany({
      data: writableState.categories.map((category) => ({
        id: category.id,
        groupId: category.groupId,
        name: category.name,
        icon: category.icon,
        monthlyLimit: category.budget,
        order: category.order
      }))
    });

    await tx.transaction.createMany({
      data: writableState.transactions.map((transaction) => ({
        id: transaction.id,
        plaidTransactionId: existingTransactions.get(transaction.id)?.plaidTransactionId || null,
        accountId: transaction.accountId,
        categoryId: transaction.categoryId,
        date: parseDate(transaction.date),
        name: transaction.name,
        merchantName: transaction.merchant,
        amount: transaction.amount,
        isoCurrencyCode: existingTransactions.get(transaction.id)?.isoCurrencyCode || "USD",
        reviewed: transaction.reviewed,
        excluded: transaction.excluded,
        internalTransfer: transaction.internal,
        pending: existingTransactions.get(transaction.id)?.pending || false,
        note: transaction.note
      }))
    });

    const transactionSplits = writableState.transactions.flatMap((transaction) =>
      (transaction.splits || []).map((split, index) => ({
        id: `split-${transaction.id}-${index}`,
        transactionId: transaction.id,
        categoryId: split.categoryId,
        amount: split.amount
      }))
    );
    if (transactionSplits.length > 0) {
      await tx.transactionSplit.createMany({ data: transactionSplits });
    }

    await tx.recurringCharge.createMany({
      data: writableState.recurrences.map((recurrence) => ({
        id: recurrence.id,
        merchant: recurrence.merchant,
        cadence: recurrence.cadence,
        nextDate: parseRecurringDate(recurrence),
        amount: recurrence.amount,
        categoryId: recurrence.categoryId || null
      }))
    });

    await tx.savingsGoal.createMany({
      data: writableState.goals.map((goal) => ({
        id: goal.id,
        name: goal.name,
        icon: goal.icon,
        targetAmount: goal.targetAmount,
        currentAmount: goal.currentAmount,
        targetDate: parseDate(goal.targetDate),
        accountId: goal.accountId || null,
        priority: goal.priority,
        status: goal.status,
        notes: goal.notes
      }))
    });

    await tx.merchantRule.createMany({
      data: writableState.rules.map((rule) => ({
        id: rule.id,
        pattern: rule.pattern,
        matchType: rule.matchType,
        categoryId: rule.internal ? null : rule.categoryId || null,
        internalTransfer: Boolean(rule.internal),
        enabled: rule.enabled
      }))
    });
  });
}

async function ensureIncomeCategory() {
  await prisma.budgetGroup.upsert({
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

  await prisma.budgetCategory.upsert({
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

  await prisma.transaction.updateMany({
    where: {
      amount: { gt: 0 },
      account: { is: { type: { not: "Investment" } } },
      internalTransfer: false,
      excluded: false,
      categoryId: null
    },
    data: {
      categoryId: INCOME_CATEGORY_ID,
      reviewed: true
    }
  });
}

function withIncomeDefaults(state: FinanceState): FinanceState {
  const investmentAccountIds = new Set(state.accounts.filter((account) => account.group === "Investment").map((account) => account.id));
  const groups = state.groups.some((group) => group.id === INCOME_GROUP_ID)
    ? state.groups
    : [...state.groups, { id: INCOME_GROUP_ID, name: "Income", color: "#16dc72", order: 99, expanded: false }];
  const categories = state.categories.some((category) => category.id === INCOME_CATEGORY_ID)
    ? state.categories
    : [...state.categories, { id: INCOME_CATEGORY_ID, groupId: INCOME_GROUP_ID, name: "Income", icon: "$", budget: 0, order: 1 }];
  const transactions = state.transactions.map((transaction) => {
    if (investmentAccountIds.has(transaction.accountId)) {
      return { ...transaction, categoryId: null, internal: true, excluded: true, reviewed: true };
    }
    if (transaction.internal) {
      return { ...transaction, categoryId: null, excluded: true, reviewed: true };
    }
    if (transaction.amount > 0 && !transaction.excluded && !transaction.categoryId) {
      return { ...transaction, categoryId: INCOME_CATEGORY_ID, reviewed: true };
    }
    return transaction;
  });

  return { ...state, groups, categories, transactions };
}

function parseDate(value: string) {
  return new Date(`${value.slice(0, 10)}T00:00:00`);
}

function parseRecurringDate(recurrence: Recurrence) {
  if (recurrence.nextDate) return parseDate(recurrence.nextDate);

  const date = parseFriendlyRecurringDate(recurrence.date);
  if (date) return date;

  return new Date("2026-06-01T00:00:00");
}

function parseFriendlyRecurringDate(value: string) {
  const match = value.match(/^([A-Za-z]{3,9})\s+(\d{1,2})(?:st|nd|rd|th)?(?:,\s*(\d{4}))?$/);
  if (!match) return null;

  const month = new Date(`${match[1]} 1, 2026`).getMonth();
  const day = Number(match[2]);
  const year = match[3] ? Number(match[3]) : new Date().getFullYear();
  const date = new Date(year, month, day);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatShortDate(date: Date) {
  const month = date.toLocaleDateString("en-US", { month: "short" });
  const day = date.getDate();
  const suffix = day % 10 === 1 && day !== 11 ? "st" : day % 10 === 2 && day !== 12 ? "nd" : day % 10 === 3 && day !== 13 ? "rd" : "th";
  return `${month} ${day}${suffix}`;
}
