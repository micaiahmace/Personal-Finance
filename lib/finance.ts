import type { Account, BudgetCategory, FinanceState, Goal, MerchantRule, Transaction } from "@/lib/types";

export const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0
});

export const usdExact = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD"
});

export function categorySpent(state: FinanceState, categoryId: string) {
  return state.transactions.flatMap(expenseEntries).filter((entry) => entry.categoryId === categoryId).reduce((sum, entry) => sum + entry.amount, 0);
}

export function expenseEntries(transaction: Transaction) {
  if (transaction.amount >= 0 || transaction.excluded || transaction.internal) return [];
  if (transaction.splits?.length) {
    return transaction.splits.filter((split) => split.categoryId).map((split) => ({ categoryId: split.categoryId, amount: Math.abs(Number(split.amount) || 0) }));
  }
  return transaction.categoryId ? [{ categoryId: transaction.categoryId, amount: Math.abs(transaction.amount) }] : [];
}

export function groupTotals(state: FinanceState, groupId: string) {
  const categories = state.categories.filter((category) => category.groupId === groupId);
  return {
    spent: categories.reduce((sum, category) => sum + categorySpent(state, category.id), 0),
    budget: categories.reduce((sum, category) => sum + Number(category.budget || 0), 0)
  };
}

export function totalBudget(categories: BudgetCategory[]) {
  return categories.reduce((sum, category) => sum + Number(category.budget || 0), 0);
}

export function totalSpent(transactions: Transaction[]) {
  return transactions.flatMap(expenseEntries).reduce((sum, entry) => sum + entry.amount, 0);
}

export function incomeTotal(transactions: Transaction[]) {
  return transactions.filter((transaction) => transaction.amount > 0 && !transaction.internal).reduce((sum, transaction) => sum + transaction.amount, 0);
}

export function netWorth(accounts: Account[]) {
  return accounts.reduce((sum, account) => sum + account.balance, 0);
}

export function percent(spent: number, budget: number) {
  if (!budget) return 0;
  return Math.max(0, (spent / budget) * 100);
}

export function goalCurrent(goal: Goal, account?: Account) {
  return account && goal.status !== "Archived" ? Math.max(account.balance, 0) : Number(goal.currentAmount || 0);
}

export function monthsUntil(date: string) {
  const target = new Date(`${date}T00:00:00`);
  const now = new Date();
  const months = (target.getFullYear() - now.getFullYear()) * 12 + (target.getMonth() - now.getMonth()) + 1;
  return Math.max(months, 1);
}

export function projectedDate(goal: Goal, current: number) {
  const remaining = Math.max(Number(goal.targetAmount) - current, 0);
  const monthly = { High: 750, Medium: 450, Low: 250 }[goal.priority] || 350;
  const months = Math.ceil(remaining / monthly);
  const date = new Date();
  date.setMonth(date.getMonth() + months);
  return date.toLocaleDateString("en-US", { month: "short", year: "numeric" });
}

export function ruleMatches(rule: MerchantRule, transactionName: string) {
  const pattern = rule.pattern.trim().toLowerCase();
  const text = transactionName.trim().toLowerCase();
  return rule.matchType === "exact" ? text === pattern : text.includes(pattern);
}
