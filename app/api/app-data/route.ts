import { NextResponse } from "next/server";
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
  return NextResponse.json(await readFinanceState());
}

async function ensureSeeded() {
  const accountCount = await prisma.account.count();
  if (accountCount === 0) {
    await writeFinanceState(seedState);
  }
}

async function readFinanceState(): Promise<FinanceState> {
  const [groups, categories, accounts, transactions, splits, recurrences, goals, rules] = await Promise.all([
    prisma.budgetGroup.findMany({ orderBy: { order: "asc" } }),
    prisma.budgetCategory.findMany({ orderBy: [{ groupId: "asc" }, { order: "asc" }] }),
    prisma.account.findMany({ orderBy: { name: "asc" } }),
    prisma.transaction.findMany({ orderBy: { date: "desc" } }),
    prisma.transactionSplit.findMany(),
    prisma.recurringCharge.findMany({ orderBy: { nextDate: "asc" } }),
    prisma.savingsGoal.findMany({ orderBy: { createdAt: "asc" } }),
    prisma.merchantRule.findMany({ orderBy: { createdAt: "asc" } })
  ]);

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
      subtype: account.subtype || "Account",
      last4: account.mask || "",
      balance: account.currentBalance,
      available: account.availableBalance ?? account.currentBalance,
      change: 0
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
      splits: splits
        .filter((split) => split.transactionId === transaction.id)
        .map((split) => ({ categoryId: split.categoryId, amount: split.amount }))
    })),
    recurrences: recurrences.map((recurrence) => ({
      id: recurrence.id,
      date: formatShortDate(recurrence.nextDate),
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
      categoryId: rule.categoryId,
      enabled: rule.enabled
    })),
    aiInbox: seedState.aiInbox
  };
}

async function writeFinanceState(state: FinanceState) {
  await prisma.$transaction(async (tx) => {
    await tx.transactionSplit.deleteMany();
    await tx.transaction.deleteMany();
    await tx.merchantRule.deleteMany();
    await tx.recurringCharge.deleteMany();
    await tx.savingsGoal.deleteMany();
    await tx.budgetCategory.deleteMany();
    await tx.budgetGroup.deleteMany();
    await tx.account.deleteMany();

    await tx.budgetGroup.createMany({
      data: state.groups.map((group) => ({
        id: group.id,
        name: group.name,
        color: group.color,
        order: group.order,
        expanded: group.expanded
      }))
    });

    await tx.account.createMany({
      data: state.accounts.map((account) => ({
        id: account.id,
        name: account.name,
        type: account.group,
        subtype: account.subtype,
        mask: account.last4,
        currentBalance: account.balance,
        availableBalance: account.available
      }))
    });

    await tx.budgetCategory.createMany({
      data: state.categories.map((category) => ({
        id: category.id,
        groupId: category.groupId,
        name: category.name,
        icon: category.icon,
        monthlyLimit: category.budget,
        order: category.order
      }))
    });

    await tx.transaction.createMany({
      data: state.transactions.map((transaction) => ({
        id: transaction.id,
        accountId: transaction.accountId,
        categoryId: transaction.categoryId,
        date: parseDate(transaction.date),
        name: transaction.name,
        merchantName: transaction.merchant,
        amount: transaction.amount,
        reviewed: transaction.reviewed,
        excluded: transaction.excluded,
        internalTransfer: transaction.internal,
        note: transaction.note
      }))
    });

    const transactionSplits = state.transactions.flatMap((transaction) =>
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
      data: state.recurrences.map((recurrence) => ({
        id: recurrence.id,
        merchant: recurrence.merchant,
        cadence: recurrence.cadence,
        nextDate: parseRecurringDate(recurrence),
        amount: recurrence.amount,
        categoryId: recurrence.categoryId || null
      }))
    });

    await tx.savingsGoal.createMany({
      data: state.goals.map((goal) => ({
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
      data: state.rules.map((rule) => ({
        id: rule.id,
        pattern: rule.pattern,
        matchType: rule.matchType,
        categoryId: rule.categoryId,
        enabled: rule.enabled
      }))
    });
  });
}

function parseDate(value: string) {
  return new Date(`${value.slice(0, 10)}T00:00:00`);
}

function parseRecurringDate(recurrence: Recurrence) {
  const date = Date.parse(recurrence.date.replace(/(st|nd|rd|th)/, ""));
  if (!Number.isNaN(date)) return new Date(date);
  return new Date("2026-06-01T00:00:00");
}

function formatShortDate(date: Date) {
  const month = date.toLocaleDateString("en-US", { month: "short" });
  const day = date.getDate();
  const suffix = day % 10 === 1 && day !== 11 ? "st" : day % 10 === 2 && day !== 12 ? "nd" : day % 10 === 3 && day !== 13 ? "rd" : "th";
  return `${month} ${day}${suffix}`;
}
