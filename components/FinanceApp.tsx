"use client";

import {
  ArrowDownUp,
  BarChart3,
  Bot,
  Check,
  ChevronDown,
  ChevronRight,
  CircleDollarSign,
  CreditCard,
  Database,
  Download,
  Edit3,
  Flag,
  Info,
  Landmark,
  Layers3,
  Moon,
  PiggyBank,
  Plus,
  Repeat2,
  Search,
  Settings,
  Sparkles,
  Sun,
  Target,
  Trash2,
  UserCircle,
  WalletCards,
  X
} from "lucide-react";
import { type CSSProperties, type FormEvent, useEffect, useMemo, useState } from "react";
import { INCOME_CATEGORY_ID, categorySpendMap, categorySpentFromMap, expenseEntries, goalCurrent, groupTotalsFromMap, incomeTotal, isBudgetCategory, isBudgetGroup, monthsUntil, netWorth, percent, projectedDate, ruleMatches, totalBudget, totalSpent, usd, usdExact } from "@/lib/finance";
import { seedState } from "@/lib/seed-data";
import type { Account, AccountGroup, AiSuggestion, BudgetCategory, BudgetGroup, FinanceState, Goal, InvestmentHolding, MerchantRule, Recurrence, Transaction, View } from "@/lib/types";

const UI_PREFS_KEY = "personal-finance-ui-v1";
const accountGroups: AccountGroup[] = ["Credit card", "Depository", "Investment", "Other"];
type SettingsTab = "general" | "connections" | "rules" | "account" | "subscription" | "about";
type TimeRange = "1W" | "1M" | "3M" | "YTD" | "1Y" | "ALL";
type SeriesKind = "netPrimary" | "netSecondary" | "investment";

const timeRanges: TimeRange[] = ["1W", "1M", "3M", "YTD", "1Y", "ALL"];
const percentFormatter = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 1
});
const quantityFormatter = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 4
});

const nav = [
  { id: "dashboard", label: "Dashboard", icon: BarChart3 },
  { id: "transactions", label: "Transactions", icon: Layers3 },
  { id: "accounts", label: "Accounts", icon: WalletCards },
  { id: "investments", label: "Investments", icon: PiggyBank },
  { id: "categories", label: "Categories", icon: CircleDollarSign },
  { id: "recurrings", label: "Recurrings", icon: Repeat2 },
  { id: "goals", label: "Goals", icon: Target }
] satisfies { id: View; label: string; icon: React.ComponentType<{ size?: number }> }[];

const settingsTabs = [
  { id: "general", label: "General", icon: Settings },
  { id: "connections", label: "Connections", icon: Landmark },
  { id: "rules", label: "Rules", icon: Flag },
  { id: "account", label: "Account", icon: UserCircle },
  { id: "subscription", label: "Subscription", icon: CreditCard },
  { id: "about", label: "About", icon: Info }
] satisfies { id: SettingsTab; label: string; icon: React.ComponentType<{ size?: number }> }[];

type RuleDraft = {
  id?: string;
  pattern: string;
  matchType: MerchantRule["matchType"];
  categoryId: string | null;
  internal: boolean;
  enabled: boolean;
};

type CategoryDraft = {
  id?: string;
  name: string;
  icon: string;
  budget: number;
  groupId: string;
};

type GroupDraft = {
  id?: string;
  name: string;
  color: string;
};

type GoalDraft = Goal;

type SplitDraft = {
  transaction: Transaction;
  firstCategoryId: string;
  firstAmount: number;
  secondCategoryId: string;
};

type AiStatus = {
  ok: boolean;
  label: string;
};

type Notice = {
  title: string;
  message: string;
};

type BulkMenu = "category" | "type" | null;
type PlaidStatus = {
  configured: boolean;
  env: string;
  connectedItemCount: number;
  accountCount: number;
  transactionCount: number;
  holdingCount: number;
  latestTransactionDate: string | null;
  items: Array<{
    itemId: string;
    institution: string;
    cursorReady: boolean;
    accountCount: number;
    investmentAccountCount: number;
    holdingCount: number;
    updatedAt: string;
  }>;
};
type BackupItem = {
  fileName: string;
  createdAt: string;
  modifiedAt: string;
  size: number;
};
type PersistHandler = (nextState: FinanceState, currentState: FinanceState) => void | Promise<void>;
type TransactionPatch = Partial<Pick<Transaction, "categoryId" | "reviewed" | "excluded" | "internal" | "note" | "splits">>;
type BulkTransactionUpdate = TransactionPatch & { id: string };

type PlaidLinkHandler = {
  open: () => void;
};

type PlaidLinkMetadata = {
  institution?: {
    name?: string;
  };
};

type PlaidLinkConfig = {
  token: string;
  onSuccess: (publicToken: string, metadata: PlaidLinkMetadata) => void;
  onExit: (error?: { display_message?: string; error_message?: string } | null) => void;
};

type PendingPlaidExchange = {
  publicToken: string;
  institution?: string;
  savedAt: number;
};

const INTERNAL_TRANSFER_ACTION = "__internal_transfer__";

declare global {
  interface Window {
    Plaid?: {
      create: (config: PlaidLinkConfig) => PlaidLinkHandler;
    };
  }
}

const PENDING_PLAID_EXCHANGE_KEY = "personal-finance.pending-plaid-exchange";
const PENDING_PLAID_EXCHANGE_MAX_AGE_MS = 25 * 60 * 1000;

function uid(prefix: string) {
  return `${prefix}-${crypto.randomUUID().slice(0, 8)}`;
}

function savePendingPlaidExchange(publicToken: string, institution?: string) {
  if (typeof window === "undefined") return;
  const pending: PendingPlaidExchange = { publicToken, institution, savedAt: Date.now() };
  window.sessionStorage.setItem(PENDING_PLAID_EXCHANGE_KEY, JSON.stringify(pending));
}

function loadPendingPlaidExchange() {
  if (typeof window === "undefined") return null;

  try {
    const raw = window.sessionStorage.getItem(PENDING_PLAID_EXCHANGE_KEY);
    if (!raw) return null;

    const pending = JSON.parse(raw) as PendingPlaidExchange;
    if (!pending.publicToken || Date.now() - pending.savedAt > PENDING_PLAID_EXCHANGE_MAX_AGE_MS) {
      window.sessionStorage.removeItem(PENDING_PLAID_EXCHANGE_KEY);
      return null;
    }

    return pending;
  } catch {
    window.sessionStorage.removeItem(PENDING_PLAID_EXCHANGE_KEY);
    return null;
  }
}

function clearPendingPlaidExchange() {
  if (typeof window === "undefined") return;
  window.sessionStorage.removeItem(PENDING_PLAID_EXCHANGE_KEY);
}

function formatRate(value: number) {
  return `${percentFormatter.format(value)}%`;
}

function sortedGroups(groups: BudgetGroup[]) {
  return [...groups].sort((a, b) => a.order - b.order);
}

function sortedCategories(categories: BudgetCategory[], groupId?: string) {
  return categories.filter((category) => !groupId || category.groupId === groupId).sort((a, b) => a.order - b.order);
}

function visibleView(view?: FinanceState["view"]): FinanceState["view"] {
  if (!view || view === "rules" || view === "ai") return "dashboard";
  return view;
}

function progressStyle(value: number, color: string, recurring = 0, recurringPaid = 0) {
  return { "--progress": `${value}%`, "--bar": color, "--recurring": `${recurring}%`, "--recurring-paid": `${recurringPaid}%` } as CSSProperties;
}

function recurringAmountMap(recurrences: FinanceState["recurrences"]) {
  const map = new Map<string, number>();

  for (const recurrence of recurrences) {
    if (!recurrence.categoryId) continue;
    map.set(recurrence.categoryId, (map.get(recurrence.categoryId) || 0) + Math.abs(Number(recurrence.amount) || 0));
  }

  return map;
}

function recurringAmountFromMap(recurringByCategory: Map<string, number>, categoryId: string) {
  return recurringByCategory.get(categoryId) || 0;
}

function groupRecurringAmountFromMap(categories: BudgetCategory[], recurringByCategory: Map<string, number>, groupId: string) {
  return categories
    .filter((category) => category.groupId === groupId)
    .reduce((sum, category) => sum + recurringAmountFromMap(recurringByCategory, category.id), 0);
}

function categoryLabel(category?: BudgetCategory) {
  return (category?.name || "Uncategorized").toUpperCase();
}

function categoryTone(category?: BudgetCategory) {
  const name = category?.name.toLowerCase() || "";
  if (name.includes("income")) return "border-emerald-400/30 bg-emerald-500/20 text-emerald-100";
  if (name.includes("gas")) return "border-red-400/30 bg-red-500/20 text-red-200";
  if (name.includes("eating")) return "border-blue-400/30 bg-blue-500/20 text-blue-200";
  if (name.includes("groceries")) return "border-emerald-400/30 bg-emerald-500/20 text-emerald-100";
  if (name.includes("rent") || name.includes("loan") || name.includes("car")) return "border-rose-400/30 bg-rose-500/20 text-rose-100";
  return "border-blue-400/25 bg-blue-500/15 text-blue-100";
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function accountDisplayName(account: Account) {
  const plaidName = account.name.trim();
  const officialName = account.officialName?.trim() || "";
  const name = account.group === "Investment" && plaidName ? plaidName : officialName || plaidName;
  const last4 = account.last4.trim();
  if (!last4) return name;

  const maskedAtEnd = new RegExp(`(?:\\s|[-#*()])*${escapeRegExp(last4)}\\s*$`, "i");
  const cleanName = name.replace(maskedAtEnd, "").replace(/\s{2,}/g, " ").trim();
  return cleanName || name;
}

function accountSource(account?: Account) {
  return account ? `${accountDisplayName(account).split(" ")[0]} ${account.last4}` : "Unknown";
}

function formatTransactionGroupDate(value: string) {
  const date = parseLocalDate(value);
  const today = new Date();
  const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const dateStart = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const diffDays = Math.round((todayStart.getTime() - dateStart.getTime()) / 86400000);

  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";

  return date.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
}

function formatTransactionMonth(value: string) {
  return parseLocalDate(`${value.slice(0, 7)}-01`).toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

function currentMonthKey() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function defaultGoalTargetDate() {
  const date = new Date();
  date.setFullYear(date.getFullYear() + 1);
  return date.toISOString().slice(0, 10);
}

function transactionMonthKey(transaction: Transaction) {
  return transaction.date.slice(0, 7);
}

function transactionsInMonth(transactions: Transaction[], monthKey: string) {
  return transactions.filter((transaction) => transactionMonthKey(transaction) === monthKey);
}

function formatMonthKey(value: string) {
  return formatTransactionMonth(`${value}-01`);
}

function transactionHasCategory(transaction: Transaction, categoryId: string) {
  return expenseEntries(transaction).some((entry) => entry.categoryId === categoryId);
}

function categorySpendForTransactions(transactions: Transaction[], categoryId: string) {
  return transactions
    .flatMap(expenseEntries)
    .filter((entry) => entry.categoryId === categoryId)
    .reduce((sum, entry) => sum + entry.amount, 0);
}

function defaultCategoryIdForTransaction(transaction: Transaction) {
  if (transaction.internal) return null;
  if (transaction.amount > 0 && !transaction.excluded && !transaction.categoryId) return INCOME_CATEGORY_ID;
  return transaction.categoryId;
}

function groupTransactionsByMonth(transactions: Transaction[]) {
  const monthIndexes = new Map<string, number>();
  const dayIndexesByMonth = new Map<string, Map<string, number>>();
  const months: Array<{
    key: string;
    label: string;
    total: number;
    days: Array<{ date: string; transactions: Transaction[] }>;
  }> = [];

  for (const transaction of transactions) {
    const monthKey = transaction.date.slice(0, 7);
    let monthIndex = monthIndexes.get(monthKey);

    if (monthIndex === undefined) {
      monthIndex = months.length;
      monthIndexes.set(monthKey, monthIndex);
      dayIndexesByMonth.set(monthKey, new Map());
      months.push({
        key: monthKey,
        label: formatTransactionMonth(transaction.date),
        total: 0,
        days: []
      });
    }

    const month = months[monthIndex];
    if (!transaction.excluded && !transaction.internal && transaction.amount < 0) {
      month.total += Math.abs(transaction.amount);
    }

    const dayIndexes = dayIndexesByMonth.get(monthKey);
    let dayIndex = dayIndexes?.get(transaction.date);

    if (dayIndex === undefined) {
      dayIndex = month.days.length;
      dayIndexes?.set(transaction.date, dayIndex);
      month.days.push({ date: transaction.date, transactions: [] });
    }

    month.days[dayIndex].transactions.push(transaction);
  }

  return months;
}

function parseLocalDate(value: string) {
  return new Date(`${value.slice(0, 10)}T00:00:00`);
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

function baseRecurrenceDate(recurrence: Recurrence) {
  if (recurrence.nextDate) {
    const date = parseLocalDate(recurrence.nextDate);
    if (!Number.isNaN(date.getTime())) return date;
  }

  return parseFriendlyRecurringDate(recurrence.date) || new Date();
}

function recurrenceNextHitDate(recurrence: Recurrence) {
  const next = baseRecurrenceDate(recurrence);
  const today = new Date();
  const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const cadence = recurrence.cadence.toLowerCase();

  while (next < todayStart) {
    if (cadence.includes("annual") || cadence.includes("year")) {
      next.setFullYear(next.getFullYear() + 1);
    } else if (cadence.includes("biweekly") || cadence.includes("every 2")) {
      next.setDate(next.getDate() + 14);
    } else if (cadence.includes("week")) {
      next.setDate(next.getDate() + 7);
    } else {
      next.setMonth(next.getMonth() + 1);
    }
  }

  return next;
}

function formatRecurrenceHitDate(recurrence: Recurrence) {
  const date = recurrenceNextHitDate(recurrence);
  const month = date.toLocaleDateString("en-US", { month: "short" });
  const day = date.getDate();
  const suffix = day % 10 === 1 && day !== 11 ? "st" : day % 10 === 2 && day !== 12 ? "nd" : day % 10 === 3 && day !== 13 ? "rd" : "th";
  const year = date.getFullYear();
  const currentYear = new Date().getFullYear();
  return `${month} ${day}${suffix}${year === currentYear ? "" : `, ${year}`}`;
}

function formatStatusDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not synced";
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function transactionMatchesRule(rule: MerchantRule, transaction: Transaction) {
  return ruleMatches(rule, transaction.name) || ruleMatches(rule, transaction.merchant);
}

function transactionMatchesRuleDraft(draft: RuleDraft, transaction: Transaction) {
  const pattern = draft.pattern.trim();
  if (!pattern) return false;
  return transactionMatchesRule({
    id: draft.id || "rule-preview",
    pattern,
    matchType: draft.matchType,
    categoryId: draft.categoryId,
    internal: draft.internal,
    enabled: draft.enabled
  }, transaction);
}

function ruleActionLabel(rule: Pick<RuleDraft | MerchantRule, "categoryId" | "internal">, categoriesById: Map<string, BudgetCategory>) {
  if (rule.internal) return "Internal transfer";
  const category = rule.categoryId ? categoriesById.get(rule.categoryId) : undefined;
  return category ? `${category.icon} ${category.name}` : "Uncategorized";
}

function loadPlaidLinkScript() {
  return new Promise<void>((resolve, reject) => {
    if (typeof window === "undefined") return reject(new Error("Plaid Link can only open in the browser."));
    if (window.Plaid) return resolve();

    const existing = document.querySelector<HTMLScriptElement>("script[data-plaid-link]");
    if (existing) {
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener("error", () => reject(new Error("Plaid Link failed to load.")), { once: true });
      return;
    }

    const script = document.createElement("script");
    script.src = "https://cdn.plaid.com/link/v2/stable/link-initialize.js";
    script.async = true;
    script.dataset.plaidLink = "true";
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Plaid Link failed to load."));
    document.head.appendChild(script);
  });
}

async function persistData(nextState: FinanceState) {
  try {
    await fetch("/api/app-data", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(nextState)
    });
  } catch {
    // Keep the UI usable even if the local database route is unavailable.
  }
}

async function patchTransaction(transactionId: string, patch: TransactionPatch) {
  try {
    await fetch(`/api/transactions/${encodeURIComponent(transactionId)}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch)
    });
  } catch {
    // The local UI stays responsive; the next full refresh will reveal any failed local write.
  }
}

async function bulkPatchTransactions(body: { updates?: BulkTransactionUpdate[]; deleteIds?: string[] }) {
  try {
    await fetch("/api/transactions/bulk", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body)
    });
  } catch {
    // The local UI stays responsive; the next full refresh will reveal any failed local write.
  }
}

export function FinanceApp() {
  const [state, setState] = useState<FinanceState>(seedState);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<SettingsTab>("general");
  const [ruleDraft, setRuleDraft] = useState<RuleDraft | null>(null);
  const [transactionDraft, setTransactionDraft] = useState<Transaction | null>(null);
  const [categoryDraft, setCategoryDraft] = useState<CategoryDraft | null>(null);
  const [groupDraft, setGroupDraft] = useState<GroupDraft | null>(null);
  const [goalDraft, setGoalDraft] = useState<GoalDraft | null>(null);
  const [splitDraft, setSplitDraft] = useState<SplitDraft | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null);
  const [selectedTransactionIds, setSelectedTransactionIds] = useState<string[]>([]);
  const [bulkMenu, setBulkMenu] = useState<BulkMenu>(null);
  const [plaidBusy, setPlaidBusy] = useState(false);
  const [aiStatus, setAiStatus] = useState<AiStatus>({ ok: false, label: "AI checking" });
  const [plaidStatus, setPlaidStatus] = useState<PlaidStatus | null>(null);
  const [netWorthRange, setNetWorthRange] = useState<TimeRange>("1W");

  const categoriesById = useMemo(() => new Map(state.categories.map((category) => [category.id, category])), [state.categories]);
  const selectedCategory = selectedCategoryId ? categoriesById.get(selectedCategoryId) : undefined;
  const accountsById = useMemo(() => new Map(state.accounts.map((account) => [account.id, account])), [state.accounts]);
  const allSortedCategories = useMemo(() => sortedCategories(state.categories), [state.categories]);
  const sortedBudgetGroups = useMemo(() => sortedGroups(state.groups).filter(isBudgetGroup), [state.groups]);
  const sortedBudgetCategories = useMemo(() => allSortedCategories.filter(isBudgetCategory), [allSortedCategories]);
  const categoriesByGroup = useMemo(() => {
    const grouped = new Map<string, BudgetCategory[]>();
    for (const category of sortedBudgetCategories) {
      grouped.set(category.groupId, [...(grouped.get(category.groupId) || []), category]);
    }
    return grouped;
  }, [sortedBudgetCategories]);
  const budgetMonthKey = currentMonthKey();
  const budgetMonthTransactions = useMemo(() => transactionsInMonth(state.transactions, budgetMonthKey), [budgetMonthKey, state.transactions]);
  const spendByCategory = useMemo(() => categorySpendMap(budgetMonthTransactions), [budgetMonthTransactions]);
  const recurringByCategory = useMemo(() => recurringAmountMap(state.recurrences), [state.recurrences]);
  const sortedRecurrences = useMemo(() => (
    [...state.recurrences].sort((a, b) => (
      recurrenceNextHitDate(a).getTime() - recurrenceNextHitDate(b).getTime() ||
      a.merchant.localeCompare(b.merchant)
    ))
  ), [state.recurrences]);
  const totalBudgetAmount = useMemo(() => totalBudget(sortedBudgetCategories), [sortedBudgetCategories]);
  const totalSpentAmount = useMemo(() => totalSpent(budgetMonthTransactions), [budgetMonthTransactions]);
  const netWorthAmount = useMemo(() => netWorth(state.accounts), [state.accounts]);
  const reviewSuggestionIds = useMemo(() => new Set(state.aiInbox.map((item) => item.transactionId)), [state.aiInbox]);
  const lowConfidenceReviewByTransaction = useMemo(
    () => new Map(state.aiInbox.filter((item) => item.confidence < 0.9).map((item) => [item.transactionId, item])),
    [state.aiInbox]
  );
  const selectedTransactionIdSet = useMemo(() => new Set(selectedTransactionIds), [selectedTransactionIds]);
  const filteredTransactions = useMemo(() => {
    const search = state.search.toLowerCase();
    return [...state.transactions]
      .filter((transaction) => !state.categoryFilter || transaction.categoryId === state.categoryFilter || transaction.splits?.some((split) => split.categoryId === state.categoryFilter))
      .filter((transaction) => !search || `${transaction.name} ${transaction.merchant} ${transaction.note}`.toLowerCase().includes(search))
      .sort((a, b) => b.date.localeCompare(a.date));
  }, [state.categoryFilter, state.search, state.transactions]);
  const selectedCategoryRegisterTransactions = useMemo(() => {
    if (!selectedCategory) return [];

    const search = state.search.toLowerCase();
    return [...state.transactions]
      .filter((transaction) => transactionHasCategory(transaction, selectedCategory.id))
      .filter((transaction) => transactionMonthKey(transaction) === budgetMonthKey)
      .filter((transaction) => !search || `${transaction.name} ${transaction.merchant} ${transaction.note}`.toLowerCase().includes(search))
      .sort((a, b) => b.date.localeCompare(a.date));
  }, [budgetMonthKey, selectedCategory, state.search, state.transactions]);
  const bulkVisibleTransactionIds = useMemo(() => {
    if (state.view === "transactions") return filteredTransactions.map((transaction) => transaction.id);
    if (state.view === "categories" && selectedCategory) return selectedCategoryRegisterTransactions.map((transaction) => transaction.id);
    return [];
  }, [filteredTransactions, selectedCategory, selectedCategoryRegisterTransactions, state.view]);
  const bulkVisibleTransactionIdSet = useMemo(() => new Set(bulkVisibleTransactionIds), [bulkVisibleTransactionIds]);
  const selectedVisibleTransactionIds = useMemo(
    () => selectedTransactionIds.filter((id) => bulkVisibleTransactionIdSet.has(id)),
    [bulkVisibleTransactionIdSet, selectedTransactionIds]
  );

  useEffect(() => {
    let alive = true;
    const prefs = readUiPrefs();

    fetch("/api/app-data")
      .then((response) => response.json())
      .then((data: FinanceState) => {
        if (!alive) return;
        setState({
          ...data,
          theme: prefs.theme || data.theme || seedState.theme,
          view: visibleView(prefs.view || data.view || seedState.view),
          selectedAccountId: prefs.selectedAccountId || data.selectedAccountId || seedState.selectedAccountId
        });
      })
      .catch(() => {
        if (!alive) return;
        setState({ ...seedState, ...prefs, view: visibleView(prefs.view || seedState.view) });
      });

    fetch("/api/health")
      .then((response) => response.json())
      .then((health: { openaiConfigured?: boolean }) => {
        setAiStatus(health.openaiConfigured ? { ok: true, label: "AI ready" } : { ok: false, label: "AI offline" });
      })
      .catch(() => setAiStatus({ ok: false, label: "AI offline" }));

    void refreshPlaidStatus();

    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle("light", state.theme === "light");
  }, [state.theme]);

  function readUiPrefs() {
    try {
      return JSON.parse(localStorage.getItem(UI_PREFS_KEY) || "{}") as Partial<FinanceState>;
    } catch {
      return {};
    }
  }

  function writeUiPrefs(next: Pick<FinanceState, "theme" | "view" | "selectedAccountId">) {
    localStorage.setItem(UI_PREFS_KEY, JSON.stringify(next));
  }

  function setUi(next: Partial<Pick<FinanceState, "theme" | "view" | "selectedAccountId">>) {
    setState((current) => {
      const updated = { ...current, ...next };
      writeUiPrefs({ theme: updated.theme, view: updated.view, selectedAccountId: updated.selectedAccountId });
      return updated;
    });
  }

  async function refreshPlaidStatus() {
    try {
      const response = await fetch("/api/plaid/status", { cache: "no-store" });
      if (!response.ok) return;
      setPlaidStatus((await response.json()) as PlaidStatus);
    } catch {
      setPlaidStatus(null);
    }
  }

  function commit(mutator: (draft: FinanceState) => void, persist: PersistHandler = persistData) {
    setState((current) => {
      const draft = structuredClone(current);
      mutator(draft);
      void persist(draft, current);
      return draft;
    });
  }

  function toggleAccountGroup(group: AccountGroup) {
    setState((current) => ({
      ...current,
      accountGroupsOpen: {
        ...current.accountGroupsOpen,
        [group]: !current.accountGroupsOpen[group]
      }
    }));
  }

  function applyRules() {
    const updates: BulkTransactionUpdate[] = [];

    for (const transaction of state.transactions) {
      let categoryId = defaultCategoryIdForTransaction(transaction);
      let internal = transaction.internal;
      let excluded = transaction.excluded;
      let matched = false;

      for (const rule of state.rules) {
        if (!rule.enabled || !transactionMatchesRule(rule, transaction)) continue;
        matched = true;
        categoryId = rule.internal ? null : rule.categoryId;
        if (rule.internal) {
          internal = true;
          excluded = true;
        }
      }

      if ((matched || categoryId !== transaction.categoryId) && (categoryId !== transaction.categoryId || internal !== transaction.internal || excluded !== transaction.excluded || !transaction.reviewed)) {
        updates.push({
          id: transaction.id,
          categoryId,
          ...(internal !== transaction.internal ? { internal } : {}),
          ...(excluded !== transaction.excluded ? { excluded } : {}),
          reviewed: true
        });
      }
    }

    commit((draft) => {
      draft.transactions.forEach((transaction) => {
        transaction.categoryId = defaultCategoryIdForTransaction(transaction);
        draft.rules.forEach((rule) => {
          if (rule.enabled && transactionMatchesRule(rule, transaction)) {
            transaction.categoryId = rule.internal ? null : rule.categoryId;
            if (rule.internal) {
              transaction.internal = true;
              transaction.excluded = true;
            }
            transaction.reviewed = true;
          }
        });
      });
    }, () => bulkPatchTransactions({ updates }));
  }

  function approveHighConfidenceAi() {
    const updates = state.aiInbox
      .filter((item) => item.confidence >= 0.9)
      .map((item) => ({
        id: item.transactionId,
        ...(item.internal ? { categoryId: null, internal: true, excluded: true } : item.categoryId ? { categoryId: item.categoryId } : {}),
        reviewed: true
      }));

    commit((draft) => {
      draft.aiInbox
        .filter((item) => item.confidence >= 0.9)
        .forEach((item) => {
          const transaction = draft.transactions.find((txn) => txn.id === item.transactionId);
          if (!transaction) return;
          if (item.internal) {
            transaction.internal = true;
            transaction.excluded = true;
            transaction.categoryId = null;
          } else if (item.categoryId) {
            transaction.categoryId = item.categoryId;
          }
          transaction.reviewed = true;
        });
      draft.aiInbox = draft.aiInbox.filter((item) => item.confidence < 0.9);
    }, () => bulkPatchTransactions({ updates }));
  }

  function detectTransfers() {
    const expenses = state.transactions.filter((transaction) => transaction.amount < 0);
    const deposits = state.transactions.filter((transaction) => transaction.amount > 0);
    const matchedIds = new Set<string>();

    expenses.forEach((expense) => {
      deposits.forEach((deposit) => {
        if (matchedIds.has(expense.id) || matchedIds.has(deposit.id)) return;
        const sameAmount = Math.abs(Math.abs(expense.amount) - deposit.amount) < 0.01;
        const differentAccount = expense.accountId !== deposit.accountId;
        const closeDate = Math.abs((new Date(expense.date).getTime() - new Date(deposit.date).getTime()) / 86400000) <= 3;
        if (sameAmount && differentAccount && closeDate) {
          matchedIds.add(expense.id);
          matchedIds.add(deposit.id);
        }
      });
    });

    const updates = [...matchedIds].map((id) => ({ id, categoryId: null, internal: true, excluded: true, reviewed: true }));

    commit((draft) => {
      draft.transactions.forEach((transaction) => {
        if (matchedIds.has(transaction.id)) {
          transaction.categoryId = null;
          transaction.internal = true;
          transaction.excluded = true;
          transaction.reviewed = true;
        }
      });
    }, () => bulkPatchTransactions({ updates }));
    setNotice({
      title: "Transfer scan complete",
      message: `${updates.length} transactions were marked as likely internal transfers.`
    });
  }

  function openRule(rule?: MerchantRule, pattern = "", options: Partial<RuleDraft> = {}) {
    setRuleDraft({
      id: rule?.id,
      pattern: rule?.pattern || pattern,
      matchType: rule?.matchType || options.matchType || "contains",
      categoryId: rule?.internal ? null : rule?.categoryId ?? options.categoryId ?? state.categories[0]?.id ?? "",
      internal: rule?.internal ?? options.internal ?? false,
      enabled: rule?.enabled ?? options.enabled ?? true
    });
  }

  function saveRule(event: FormEvent) {
    event.preventDefault();
    if (!ruleDraft) return;

    const savedRule: MerchantRule = {
      id: ruleDraft.id || uid("rule"),
      pattern: ruleDraft.pattern.trim(),
      matchType: ruleDraft.matchType,
      categoryId: ruleDraft.internal ? null : ruleDraft.categoryId,
      internal: ruleDraft.internal,
      enabled: ruleDraft.enabled
    };

    if (!savedRule.pattern || (!savedRule.internal && !savedRule.categoryId)) return;

    commit((draft) => {
      if (ruleDraft.id) {
        const target = draft.rules.find((rule) => rule.id === ruleDraft.id);
        if (target) Object.assign(target, savedRule);
      } else {
        draft.rules.push(savedRule);
      }

      if (savedRule.enabled) {
        draft.transactions.forEach((transaction) => {
          if (!transactionMatchesRule(savedRule, transaction)) return;
          transaction.categoryId = savedRule.internal ? null : savedRule.categoryId;
          transaction.internal = savedRule.internal;
          transaction.excluded = savedRule.internal ? true : false;
          transaction.reviewed = true;
        });
      }
    });
    setRuleDraft(null);
  }

  function editTransactionCategory(transaction: Transaction) {
    setTransactionDraft(transaction);
  }

  function splitTransaction(transaction: Transaction) {
    const category = sortedBudgetCategories[0];
    if (!category || transaction.amount >= 0) return;
    const amount = Math.abs(transaction.amount);
    setSplitDraft({
      transaction,
      firstCategoryId: transaction.categoryId || category.id,
      firstAmount: Number((amount / 2).toFixed(2)),
      secondCategoryId: category.id
    });
  }

  async function exchangePlaidPublicToken(publicToken: string, institution?: string) {
    let exchangeResponse: Response;
    try {
      exchangeResponse = await fetch("/api/plaid/exchange", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ publicToken, institution })
      });
    } catch {
      throw new Error("Could not reach the local Plaid exchange route. The Plaid token was saved in this browser; click Connect again within a few minutes to retry without signing in again.");
    }

    const exchangeData = await exchangeResponse.json().catch(() => ({}));
    if (!exchangeResponse.ok) {
      throw new Error(exchangeData.error || "Unable to exchange Plaid token.");
    }

    await refreshFinanceState();
    clearPendingPlaidExchange();
    setNotice({
      title: exchangeData.sync?.deferred ? "Account connected" : "Account synced",
      message: exchangeData.sync?.deferred
        ? "Plaid connected successfully. Transaction history may take a little longer, so use Sync again in a minute if accounts do not appear yet."
        : "Plaid connected successfully and synced the first batch of accounts and transactions."
    });
    void refreshPlaidStatus();
  }

  async function syncExistingPlaidItem(itemId: string, institution: string) {
    const syncResponse = await fetch("/api/plaid/sync", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ itemId })
    });
    const syncData = await syncResponse.json().catch(() => ({}));
    if (!syncResponse.ok) {
      throw new Error(syncData.error || "Plaid consent was updated, but the follow-up sync did not finish.");
    }

    await refreshFinanceState();
    void refreshPlaidStatus();

    const result = syncData.sync?.results?.[0];
    const holdings = result?.holdings;
    setNotice({
      title: holdings?.synced ? "Investment access updated" : "Connection updated",
      message: holdings?.synced
        ? `${institution} synced ${holdings.holdingCount || 0} holdings.`
        : `${institution} was updated. If holdings still do not appear, Plaid may need a few minutes before the Investments product is ready.`
    });
  }

  async function refreshFinanceState() {
    const dataResponse = await fetch("/api/app-data", { cache: "no-store" });
    const nextData = (await dataResponse.json()) as FinanceState;
    setState((current) => ({
      ...nextData,
      theme: current.theme,
      view: current.view,
      selectedAccountId: current.selectedAccountId || nextData.accounts[0]?.id || ""
    }));
  }

  async function connectModal(item?: { itemId: string; institution: string }) {
    if (plaidBusy) return;
    setPlaidBusy(true);
    const updateMode = Boolean(item?.itemId);

    try {
      const pendingExchange = loadPendingPlaidExchange();
      if (!updateMode && pendingExchange) {
        await exchangePlaidPublicToken(pendingExchange.publicToken, pendingExchange.institution);
        setPlaidBusy(false);
        return;
      }

      let linkResponse: Response;
      try {
        linkResponse = await fetch("/api/plaid/link-token", {
          method: "POST",
          cache: "no-store",
          headers: { "content-type": "application/json" },
          body: updateMode ? JSON.stringify({ itemId: item?.itemId }) : JSON.stringify({})
        });
      } catch {
        throw new Error("Could not reach the local Plaid setup route. Refresh the app and make sure the dev server is running on port 3000.");
      }
      const linkData = await linkResponse.json();
      if (!linkResponse.ok || !linkData.link_token) {
        throw new Error(linkData.error || "Unable to create Plaid link token.");
      }

      await loadPlaidLinkScript();
      if (!window.Plaid) throw new Error("Plaid Link is unavailable.");

      const handler = window.Plaid.create({
        token: linkData.link_token,
        onSuccess: async (publicToken, metadata) => {
          try {
            if (updateMode && item) {
              await syncExistingPlaidItem(item.itemId, item.institution);
            } else {
              savePendingPlaidExchange(publicToken, metadata.institution?.name);
              await exchangePlaidPublicToken(publicToken, metadata.institution?.name);
            }
          } catch (error) {
            setNotice({
              title: updateMode ? "Plaid update needs attention" : "Plaid sync needs attention",
              message: error instanceof Error ? error.message : updateMode ? "Plaid updated, but the follow-up sync did not finish." : "Plaid connected, but the first sync did not finish. Click Connect again soon to retry without signing in again."
            });
          } finally {
            setPlaidBusy(false);
          }
        },
        onExit: (error) => {
          setPlaidBusy(false);
          if (error) {
            setNotice({
              title: "Plaid connection stopped",
              message: error.display_message || error.error_message || (updateMode ? "Plaid exited before the connection was updated." : "Plaid exited before the account was connected.")
            });
          }
        }
      });

      handler.open();
    } catch (error) {
      setPlaidBusy(false);
      setSettingsTab("connections");
      setSettingsOpen(true);
      setNotice({
        title: "Plaid is not ready yet",
        message: error instanceof Error ? error.message : "Check your Plaid keys and try again."
      });
    }
  }

  function openCategoryModal(category?: BudgetCategory) {
    setCategoryDraft({
      id: category?.id,
      name: category?.name || "",
      icon: category?.icon || "\u2022",
      budget: category?.budget || 0,
      groupId: category?.groupId || state.groups[0]?.id || ""
    });
  }

  function openGroupModal(group?: BudgetGroup) {
    setGroupDraft({
      id: group?.id,
      name: group?.name || "",
      color: group?.color || "#398ff0"
    });
  }

  function openGoalModal(goal?: Goal) {
    setGoalDraft(goal ? { ...goal } : {
      id: "",
      name: "House fund",
      icon: "H",
      targetAmount: 0,
      currentAmount: 0,
      targetDate: defaultGoalTargetDate(),
      accountId: "",
      priority: "Medium",
      notes: "",
      status: "Active"
    });
  }

  function saveCategory(draft: CategoryDraft) {
    commit((stateDraft) => {
      if (draft.id) {
        const target = stateDraft.categories.find((category) => category.id === draft.id);
        if (target) Object.assign(target, draft);
      } else {
        const order = Math.max(0, ...stateDraft.categories.filter((category) => category.groupId === draft.groupId).map((category) => category.order)) + 1;
        stateDraft.categories.push({ id: uid("cat"), ...draft, order });
      }
    });
    setCategoryDraft(null);
  }

  function saveGroup(draft: GroupDraft) {
    const name = draft.name.trim();
    if (!name) return;

    commit((stateDraft) => {
      if (draft.id) {
        const target = stateDraft.groups.find((group) => group.id === draft.id);
        if (target) {
          target.name = name;
          target.color = draft.color;
        }
      } else {
        const order = Math.max(0, ...stateDraft.groups.map((group) => group.order)) + 1;
        stateDraft.groups.push({
          id: uid("group"),
          name,
          color: draft.color,
          order,
          expanded: true
        });
      }
    });
    setGroupDraft(null);
  }

  function saveGoal(draft: GoalDraft) {
    const savedGoal: Goal = {
      id: draft.id || uid("goal"),
      name: draft.name.trim(),
      icon: draft.icon.trim() || "G",
      targetAmount: Math.max(Number(draft.targetAmount) || 0, 0),
      currentAmount: Math.max(Number(draft.currentAmount) || 0, 0),
      targetDate: draft.targetDate || defaultGoalTargetDate(),
      accountId: draft.accountId || "",
      priority: draft.priority,
      notes: draft.notes.trim(),
      status: draft.status
    };

    if (!savedGoal.name || savedGoal.targetAmount <= 0) return;

    commit((stateDraft) => {
      const target = stateDraft.goals.find((goal) => goal.id === savedGoal.id);
      if (target) {
        Object.assign(target, savedGoal);
      } else {
        stateDraft.goals.push(savedGoal);
      }
    });
    setGoalDraft(null);
  }

  function deleteGoal(goalId: string) {
    commit((stateDraft) => {
      stateDraft.goals = stateDraft.goals.filter((goal) => goal.id !== goalId);
    });
  }

  function saveTransaction(transaction: Transaction) {
    const saved = transaction.internal
      ? { ...transaction, categoryId: null, excluded: true, reviewed: true }
      : { ...transaction, categoryId: defaultCategoryIdForTransaction(transaction), reviewed: true };
    commit((draft) => {
      const target = draft.transactions.find((item) => item.id === transaction.id);
      if (target) Object.assign(target, saved);
    }, () => patchTransaction(saved.id, saved));
    setTransactionDraft(null);
  }

  function saveSplit(draft: SplitDraft) {
    const amount = Math.abs(draft.transaction.amount);
    if (draft.firstAmount <= 0 || draft.firstAmount >= amount) return;
    const splits = [
      { categoryId: draft.firstCategoryId, amount: draft.firstAmount },
      { categoryId: draft.secondCategoryId, amount: Number((amount - draft.firstAmount).toFixed(2)) }
    ];
    commit((stateDraft) => {
      const target = stateDraft.transactions.find((item) => item.id === draft.transaction.id);
      if (target) {
        target.splits = splits;
        target.reviewed = true;
      }
    }, () => patchTransaction(draft.transaction.id, { splits, reviewed: true }));
    setSplitDraft(null);
  }

  function toggleTransactionSelection(transactionId: string) {
    setSelectedTransactionIds((current) =>
      current.includes(transactionId)
        ? current.filter((id) => id !== transactionId)
        : [...current, transactionId]
    );
  }

  function clearTransactionSelection() {
    setSelectedTransactionIds([]);
    setBulkMenu(null);
  }

  function openCategoryTransactions(category: BudgetCategory) {
    setSelectedCategoryId(category.id);
    setState((current) => current.search ? { ...current, search: "" } : current);
    clearTransactionSelection();
  }

  function closeCategoryTransactions() {
    setSelectedCategoryId(null);
    clearTransactionSelection();
  }

  function assignSelectedCategory(categoryId: string | null, transactionIds = selectedTransactionIds) {
    const selected = new Set(transactionIds);
    const updates = transactionIds.map((id) => ({ id, categoryId, ...(categoryId ? { internal: false, excluded: false } : {}), reviewed: true }));
    commit((draft) => {
      draft.transactions.forEach((transaction) => {
        if (selected.has(transaction.id)) {
          transaction.categoryId = categoryId;
          if (categoryId) {
            transaction.internal = false;
            transaction.excluded = false;
          }
          transaction.reviewed = true;
        }
      });
    }, () => bulkPatchTransactions({ updates }));
    clearTransactionSelection();
  }

  function assignSelectedType(type: "transaction" | "transfer", transactionIds = selectedTransactionIds) {
    const selected = new Set(transactionIds);
    const updates = state.transactions
      .filter((transaction) => selected.has(transaction.id))
      .map((transaction) => {
        const nextCategoryId = type === "transfer"
          ? null
          : defaultCategoryIdForTransaction({ ...transaction, internal: false, excluded: false });
        return {
          id: transaction.id,
          categoryId: nextCategoryId,
          internal: type === "transfer",
          excluded: type === "transfer",
          reviewed: true
        };
      });
    commit((draft) => {
      draft.transactions.forEach((transaction) => {
        if (selected.has(transaction.id)) {
          transaction.categoryId = type === "transfer"
            ? null
            : defaultCategoryIdForTransaction({ ...transaction, internal: false, excluded: false });
          transaction.internal = type === "transfer";
          transaction.excluded = type === "transfer" ? true : false;
          transaction.reviewed = true;
        }
      });
    }, () => bulkPatchTransactions({ updates }));
    clearTransactionSelection();
  }

  function excludeSelectedTransactions(transactionIds = selectedTransactionIds) {
    const selected = new Set(transactionIds);
    const updates = transactionIds.map((id) => ({ id, excluded: true, reviewed: true }));
    commit((draft) => {
      draft.transactions.forEach((transaction) => {
        if (selected.has(transaction.id)) {
          transaction.excluded = true;
          transaction.reviewed = true;
        }
      });
    }, () => bulkPatchTransactions({ updates }));
    clearTransactionSelection();
  }

  function reviewSelectedTransactions(transactionIds = selectedTransactionIds) {
    const selected = new Set(transactionIds);
    const updates = transactionIds.map((id) => ({ id, reviewed: true }));
    commit((draft) => {
      draft.transactions.forEach((transaction) => {
        if (selected.has(transaction.id)) {
          transaction.reviewed = true;
        }
      });
    }, () => bulkPatchTransactions({ updates }));
    clearTransactionSelection();
  }

  function deleteSelectedTransactions(transactionIds = selectedTransactionIds) {
    const selected = new Set(transactionIds);
    const deleteIds = [...transactionIds];
    commit((draft) => {
      draft.transactions = draft.transactions.filter((transaction) => !selected.has(transaction.id));
      draft.aiInbox = draft.aiInbox.filter((item) => !selected.has(item.transactionId));
    }, () => bulkPatchTransactions({ deleteIds }));
    clearTransactionSelection();
  }

  const pageTitle = state.view === "categories" && selectedCategory ? `${selectedCategory.icon} ${selectedCategory.name}` : nav.find((item) => item.id === state.view)?.label || "Dashboard";
  const pageKicker = {
    dashboard: `${usd.format(totalBudgetAmount - totalSpentAmount)} left this month`,
    transactions: `${state.transactions.filter((transaction) => !transaction.reviewed).length} need review`,
    accounts: `${state.accounts.length} account shells`,
    investments: `${usd.format(state.accounts.filter((account) => account.group === "Investment").reduce((sum, account) => sum + account.balance, 0))} invested`,
    categories: selectedCategory ? `${formatMonthKey(budgetMonthKey)} transactions` : `${sortedBudgetCategories.length} spend categories`,
    recurrings: `${state.recurrences.length} recurring charges`,
    goals: `${usd.format(state.goals.reduce((sum, goal) => sum + goalCurrent(goal, accountsById.get(goal.accountId)), 0))} saved toward goals`,
    rules: `${state.rules.filter((rule) => rule.enabled).length} active merchant rules`,
    ai: `${state.aiInbox.length} AI suggestions`
  }[state.view];

  const pages: Record<View, () => React.ReactNode> = {
    dashboard: renderDashboard,
    transactions: renderTransactions,
    accounts: renderAccounts,
    investments: renderInvestments,
    categories: renderCategories,
    recurrings: renderRecurrings,
    goals: renderGoals,
    rules: renderRules,
    ai: renderDashboard
  };
  const compactCategoryList = state.view === "categories" && !selectedCategory;

  return (
    <div className={`${state.theme === "light" ? "light" : ""} min-h-screen bg-[var(--bg)] text-[var(--text)]`}>
      <div className="grid min-h-screen sm:grid-cols-[272px_minmax(0,1fr)]">
        <aside className="hidden border-r border-[var(--line)] bg-[color:color-mix(in_srgb,var(--surface)_88%,transparent)] sm:flex sm:h-screen sm:sticky sm:top-0 sm:flex-col">
          <div className="flex items-center gap-3 px-4 py-5">
            <div className="grid h-10 w-10 place-items-center rounded-2xl bg-gradient-to-br from-blue-500 to-emerald-400 font-black text-white shadow-soft">PF</div>
            <div>
              <div className="font-black">Personal Finance</div>
              <div className="text-xs font-bold text-[var(--muted)]">Local-first money studio</div>
            </div>
          </div>

          <div className="border-t border-[var(--line)] px-3 py-4">
            {accountGroups.map((group) => {
              const accounts = state.accounts.filter((account) => account.group === group);
              const open = state.accountGroupsOpen[group];
              return (
                <div key={group} className="mb-2">
                  <button
                    className="flex w-full items-center justify-between rounded-xl px-3 py-3 text-left font-black text-blue-200 hover:bg-[var(--surface-2)]"
                    onClick={() => toggleAccountGroup(group)}
                  >
                    <span className="flex items-center gap-2">{open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}{group}</span>
                    <span>{accounts.length}</span>
                  </button>
                  {open ? (
                    <div className="grid gap-1 pl-7">
                      {accounts.map((account) => (
                        <button key={account.id} className="rounded-lg px-2 py-2 text-left text-sm font-bold text-[var(--muted)] hover:bg-[var(--surface-2)] hover:text-[var(--text)]" onClick={() => setUi({ view: "accounts", selectedAccountId: account.id })}>
                          <span className="truncate">{accountDisplayName(account)}{account.last4 ? <span className="ml-1 text-blue-300/70">{account.last4}</span> : null}</span>
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>

          <div className="mt-auto grid gap-2 border-t border-[var(--line)] p-3">
            <button className="rounded-xl px-3 py-3 text-left font-black text-[var(--orange)] hover:bg-[var(--surface-2)]" onClick={() => setUi({ view: "goals" })}>Start here</button>
            <button className="flex items-center gap-2 rounded-xl px-3 py-3 text-left font-black text-[var(--muted)] hover:bg-[var(--surface-2)] hover:text-[var(--text)]" onClick={() => setSettingsOpen(true)}><Settings size={16} /> Settings</button>
          </div>
        </aside>

        <main className="min-w-0">
          <header className="sticky top-0 z-20 flex min-h-20 flex-wrap items-center justify-between gap-3 border-b border-[var(--line)] bg-[color:color-mix(in_srgb,var(--bg)_78%,transparent)] px-4 py-3 backdrop-blur-xl md:px-7">
            <div>
              <h1 className="text-lg font-black">{pageTitle}</h1>
              <div className="text-xs font-bold text-[var(--muted)]">{pageKicker}</div>
            </div>
            <nav className="order-3 flex w-full gap-2 overflow-x-auto rounded-full border border-[var(--line)] bg-[var(--surface)] p-1.5 md:order-none md:w-auto">
              {nav.map((item) => (
                <button key={item.id} className={`whitespace-nowrap rounded-full px-4 py-2 text-sm font-black transition ${state.view === item.id ? "bg-gradient-to-r from-blue-500 to-sky-400 text-white shadow-soft" : "text-[var(--muted)] hover:bg-[var(--surface-2)]"}`} onClick={() => {
                  if (item.id === "categories") setSelectedCategoryId(null);
                  clearTransactionSelection();
                  setUi({ view: item.id });
                }}>
                  {item.label}
                </button>
              ))}
            </nav>
            <div className="flex items-center gap-2">
              <AiStatusPill status={aiStatus} />
              <Button variant="secondary" onClick={() => connectModal()}><Database size={16} /> {plaidBusy ? "Connecting" : "Connect"}</Button>
              <IconButton label="Toggle theme" onClick={() => setUi({ theme: state.theme === "dark" ? "light" : "dark" })}>
                {state.theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
              </IconButton>
            </div>
          </header>
          <section className={`px-4 pb-24 md:px-7 ${compactCategoryList ? "py-3" : "py-6"}`}>{pages[state.view]()}</section>
        </main>
      </div>

      {settingsOpen ? (
        <SettingsModal
          activeTab={settingsTab}
          state={state}
          plaidStatus={plaidStatus}
          plaidBusy={plaidBusy}
          categories={allSortedCategories}
          setActiveTab={setSettingsTab}
          setState={setState}
          onClose={() => setSettingsOpen(false)}
          onConnect={() => connectModal()}
          onUpdateConsent={connectModal}
          onApplyRules={applyRules}
          onOpenRule={openRule}
          onDeleteRule={(ruleId) => commit((draft) => {
            draft.rules = draft.rules.filter((rule) => rule.id !== ruleId);
          })}
          onToggleRule={(ruleId) => commit((draft) => {
            const rule = draft.rules.find((item) => item.id === ruleId);
            if (rule) rule.enabled = !rule.enabled;
          })}
        />
      ) : null}
      {selectedVisibleTransactionIds.length ? (
        <BulkTransactionBar
          selectedCount={selectedVisibleTransactionIds.length}
          categories={allSortedCategories}
          openMenu={bulkMenu}
          setOpenMenu={setBulkMenu}
          onClear={clearTransactionSelection}
          onCategory={(categoryId) => assignSelectedCategory(categoryId, selectedVisibleTransactionIds)}
          onType={(type) => assignSelectedType(type, selectedVisibleTransactionIds)}
          onExclude={() => excludeSelectedTransactions(selectedVisibleTransactionIds)}
          onReview={() => reviewSelectedTransactions(selectedVisibleTransactionIds)}
          onDelete={() => deleteSelectedTransactions(selectedVisibleTransactionIds)}
        />
      ) : null}
      {ruleDraft ? <RuleModal draft={ruleDraft} categories={allSortedCategories} accounts={state.accounts} transactions={state.transactions} setDraft={setRuleDraft} onClose={() => setRuleDraft(null)} onSave={saveRule} /> : null}
      {transactionDraft ? <TransactionModal transaction={transactionDraft} accounts={state.accounts} categories={allSortedCategories} onClose={() => setTransactionDraft(null)} onSave={saveTransaction} /> : null}
      {categoryDraft ? <CategoryModal draft={categoryDraft} groups={sortedBudgetGroups} setDraft={setCategoryDraft} onClose={() => setCategoryDraft(null)} onSave={saveCategory} /> : null}
      {groupDraft ? <GroupModal draft={groupDraft} setDraft={setGroupDraft} onClose={() => setGroupDraft(null)} onSave={saveGroup} /> : null}
      {goalDraft ? <GoalModal draft={goalDraft} accounts={state.accounts} setDraft={setGoalDraft} onClose={() => setGoalDraft(null)} onSave={saveGoal} /> : null}
      {splitDraft ? <SplitModal draft={splitDraft} categories={sortedBudgetCategories} setDraft={setSplitDraft} onClose={() => setSplitDraft(null)} onSave={saveSplit} /> : null}
      {notice ? <NoticeModal notice={notice} onClose={() => setNotice(null)} /> : null}
    </div>
  );

  function renderDashboard() {
    const budget = totalBudgetAmount;
    const spent = totalSpentAmount;
    const remainingBudget = budget - spent;
    const overBudget = remainingBudget < 0;
    const monthlyIncome = incomeTotal(budgetMonthTransactions);
    const monthlySavings = monthlyIncome - spent;
    const savingsRate = monthlyIncome > 0 ? (monthlySavings / monthlyIncome) * 100 : 0;
    const savingsRateLabel = monthlyIncome > 0 ? formatRate(savingsRate) : "--";
    const savingsTone = monthlySavings < 0 ? "red" : savingsRate >= 20 ? "green" : "orange";
    const reviewTransactions = [...state.transactions]
      .filter((transaction) => !transaction.reviewed || reviewSuggestionIds.has(transaction.id))
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, 5);

    return (
      <div className="fade-in space-y-6">
        <div className="grid gap-6 xl:grid-cols-2">
          <Panel title="Monthly spending" action="Transactions" onAction={() => setUi({ view: "transactions" })}>
            <div className="flex min-h-[clamp(18rem,32vw,24rem)] items-center text-center">
              <div className="w-full">
                <p className={`text-4xl font-black ${overBudget ? "text-red-200" : ""}`}>{usd.format(Math.abs(remainingBudget))} {overBudget ? "over" : "left"}</p>
                <p className="mt-2 font-bold text-[var(--muted)]">{usd.format(budget)} budgeted</p>
                <SpendingDashboardChart className="mt-8 h-[clamp(9rem,16vw,13rem)] w-full" transactions={state.transactions} spent={spent} budget={budget} />
              </div>
            </div>
          </Panel>
          <Panel title="Net worth" action="Accounts" onAction={() => setUi({ view: "accounts" })}>
            <div className="flex min-h-[clamp(18rem,32vw,24rem)] items-center text-center">
              <div className="w-full">
                <p className="font-bold text-[var(--muted)]">Net worth</p>
                <div className="mt-3"><Chip tone="red">Down 10.59%</Chip></div>
                <p className="mt-3 text-4xl font-black">{usd.format(netWorthAmount)}</p>
                <NetWorthDashboardChart className="mt-8 h-[clamp(9rem,16vw,13rem)] w-full" range={netWorthRange} />
                <RangeTabs value={netWorthRange} onChange={setNetWorthRange} />
              </div>
            </div>
          </Panel>
        </div>
        <div className="grid gap-6 xl:grid-cols-2">
          <Panel title="Savings snapshot" action="Goals" onAction={() => setUi({ view: "goals" })}>
            <div className="flex min-h-[17.5rem] flex-col justify-between gap-5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-sm font-black text-blue-300">{formatMonthKey(budgetMonthKey)}</p>
                  <p className={`mt-1 text-4xl font-black ${savingsTone === "red" ? "text-red-200" : savingsTone === "green" ? "text-[var(--green)]" : "text-[var(--orange)]"}`}>
                    {savingsRateLabel}
                  </p>
                  <p className="mt-2 font-bold text-[var(--muted)]">{usdExact.format(monthlySavings)} saved this month</p>
                </div>
                <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl border border-emerald-400/20 bg-emerald-400/10 text-emerald-100">
                  <PiggyBank size={22} />
                </span>
              </div>
              <div>
                <Progress spent={Math.max(monthlySavings, 0)} budget={monthlyIncome} color="var(--green)" mode="solid" />
                <div className="mt-4 grid gap-3 sm:grid-cols-3">
                  <Metric label="Income" value={usdExact.format(monthlyIncome)} tone="green" />
                  <Metric label="Spending" value={usdExact.format(spent)} tone={spent > monthlyIncome && monthlyIncome > 0 ? "red" : "orange"} />
                  <Metric label="Saved" value={usdExact.format(monthlySavings)} tone={savingsTone} />
                </div>
              </div>
            </div>
          </Panel>
          <Panel title="Top categories" action="View all" onAction={() => {
            setSelectedCategoryId(null);
            setUi({ view: "categories" });
          }}>{renderTopCategories()}</Panel>
          <Panel title="Transactions to review" action="View all" onAction={() => setUi({ view: "transactions" })}>
            <DashboardReviewList
              transactions={reviewTransactions}
              accountsById={accountsById}
              categoriesById={categoriesById}
              onMarkReviewed={() => commit((draft) => {
                const ids = new Set(reviewTransactions.map((transaction) => transaction.id));
                draft.transactions.forEach((transaction) => {
                  if (ids.has(transaction.id)) transaction.reviewed = true;
                });
              }, () => bulkPatchTransactions({ updates: reviewTransactions.map((transaction) => ({ id: transaction.id, reviewed: true })) }))}
            />
          </Panel>
          <Panel title="Next up" action="Recurrings" onAction={() => setUi({ view: "recurrings" })}>
            <div className="space-y-3">{sortedRecurrences.slice(0, 3).map(renderRecurrenceRow)}</div>
          </Panel>
        </div>
      </div>
    );
  }

  function renderTransactions() {
    return (
      <div className="fade-in space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-xl font-black">Transactions</h2>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={detectTransfers}><ArrowDownUp size={16} /> Detect transfers</Button>
            <Button variant="secondary" onClick={applyRules}><Flag size={16} /> Apply rules</Button>
            <Button variant="secondary" onClick={approveHighConfidenceAi}><Sparkles size={16} /> Apply AI</Button>
          </div>
        </div>
        <div className="grid gap-3 md:grid-cols-[1fr_260px]">
          <label className="flex items-center gap-2 rounded-full border border-[var(--line)] bg-[var(--surface-2)] px-4">
            <Search size={16} className="text-[var(--muted)]" />
            <input className="w-full bg-transparent py-3 outline-none" placeholder="Search merchants or notes" value={state.search} onChange={(event) => setState({ ...state, search: event.target.value })} />
          </label>
          <select className="rounded-full border border-[var(--line)] bg-[var(--surface-2)] px-4 py-3 outline-none" value={state.categoryFilter} onChange={(event) => setState({ ...state, categoryFilter: event.target.value })}>
            <option value="">All categories</option>
            {allSortedCategories.map((category) => <option key={category.id} value={category.id}>{category.icon} {category.name}</option>)}
          </select>
        </div>
        {renderTransactionRegister(filteredTransactions)}
      </div>
    );
  }

  function renderTransactionRegister(transactions: Transaction[], options: { emptyText?: string; showFirstMonthHeader?: boolean } = {}) {
    const groupedTransactions = groupTransactionsByMonth(transactions);

    return (
      <>
        {groupedTransactions.length ? (
          <div className="space-y-7">
            {groupedTransactions.map((month, monthIndex) => (
              <section key={month.key} className="space-y-3">
                {options.showFirstMonthHeader || monthIndex > 0 ? (
                  <div className="flex items-center justify-between pt-2">
                    <h3 className="text-2xl font-black tracking-tight">{month.label}</h3>
                    <span className="text-2xl font-black">{usdExact.format(month.total)}</span>
                  </div>
                ) : null}
                <div className="space-y-5">
                  {month.days.map((day) => (
                    <section key={day.date} className="space-y-2">
                      <div className="px-1 text-sm font-black text-blue-300">{formatTransactionGroupDate(day.date)}</div>
                      <div className="overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--surface)]">
                        {day.transactions.map(renderTransactionRow)}
                      </div>
                    </section>
                  ))}
                </div>
              </section>
            ))}
          </div>
        ) : (
          <div className="rounded-2xl border border-dashed border-[var(--line)] bg-[var(--surface)] p-8 text-center font-bold text-[var(--muted)]">
            {options.emptyText || "No transactions match this view."}
          </div>
        )}
      </>
    );
  }

  function renderTransactionRow(transaction: Transaction) {
    const category = !transaction.internal && transaction.categoryId ? categoriesById.get(transaction.categoryId) : undefined;
    const account = accountsById.get(transaction.accountId);
    const review = lowConfidenceReviewByTransaction.get(transaction.id);
    const selected = selectedTransactionIdSet.has(transaction.id);
    const categoryPillClass = transaction.internal ? "border-blue-400/30 bg-blue-500/15 text-blue-100" : categoryTone(category);
    return (
      <div key={transaction.id} className={`transaction-row group grid grid-cols-[22px_minmax(0,1fr)_auto_auto] items-center gap-3 border-b border-[var(--line)] px-4 py-2.5 last:border-b-0 hover:bg-[var(--surface-2)] ${selected ? "bg-blue-500/18" : ""}`}>
        <input
          aria-label={`Select ${transaction.name}`}
          type="checkbox"
          className="h-3.5 w-3.5 rounded border-[var(--line)] bg-transparent"
          checked={selected}
          onChange={() => toggleTransactionSelection(transaction.id)}
        />
        <button className="min-w-0 text-left" onClick={() => editTransactionCategory(transaction)}>
          <span className="transaction-name">{transaction.name}</span>
          <span className="transaction-account ml-2 text-blue-300/70">{accountSource(account)}</span>
          {transaction.internal ? <span className="ml-2 rounded-full bg-blue-500/15 px-2 py-0.5 text-xs font-black text-blue-200">INTERNAL</span> : null}
          {transaction.excluded ? <span className="ml-2 rounded-full bg-red-500/15 px-2 py-0.5 text-xs font-black text-red-200">EXCLUDED</span> : null}
          {review ? <span className="ml-2 rounded-full bg-amber-500/15 px-2 py-0.5 text-xs font-black text-amber-200">AI REVIEW</span> : null}
        </button>
        <button className={`category-pill inline-flex items-center rounded-full border px-3 py-1 ${categoryPillClass}`} onClick={() => editTransactionCategory(transaction)}>
          {transaction.internal ? <><ArrowDownUp size={12} className="mr-1" /> Internal transfer</> : <>{category?.icon ? <span className="mr-1">{category.icon}</span> : null}{categoryLabel(category)}</>}
        </button>
        <div className="flex items-center justify-end gap-3">
          <span className={`transaction-amount min-w-20 text-right ${transaction.amount > 0 ? "text-[var(--green)]" : ""}`}>{usdExact.format(Math.abs(transaction.amount))}</span>
          <div className="hidden items-center gap-1 opacity-0 transition group-hover:flex group-hover:opacity-100">
            <IconButton label="Split" onClick={() => splitTransaction(transaction)}>S</IconButton>
            <IconButton label="Create rule" onClick={() => openRule(undefined, transaction.merchant || transaction.name, {
              categoryId: transaction.internal ? null : transaction.categoryId || state.categories[0]?.id || "",
              internal: transaction.internal
            })}><Flag size={14} /></IconButton>
            <IconButton label="Exclude" onClick={() => {
              const excluded = !transaction.excluded;
              commit((draft) => {
                const target = draft.transactions.find((item) => item.id === transaction.id);
                if (target) target.excluded = excluded;
              }, () => patchTransaction(transaction.id, { excluded }));
            }}>X</IconButton>
            <IconButton label="Internal transfer" onClick={() => {
              const internal = !transaction.internal;
              const excluded = internal ? true : transaction.excluded;
              const categoryId = internal ? null : defaultCategoryIdForTransaction({ ...transaction, internal: false, excluded });
              commit((draft) => {
                const target = draft.transactions.find((item) => item.id === transaction.id);
                if (target) {
                  target.internal = internal;
                  target.categoryId = categoryId;
                  if (target.internal) target.excluded = true;
                }
              }, () => patchTransaction(transaction.id, { internal, excluded, ...(internal ? { categoryId } : {}) }));
            }}><ArrowDownUp size={14} /></IconButton>
          </div>
        </div>
      </div>
    );
  }

  function renderCategories() {
    if (selectedCategory) return renderCategoryTransactions(selectedCategory);

    return (
      <div className="fade-in space-y-2">
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button onClick={() => openGroupModal()}><Plus size={16} /> Group</Button>
          <Button onClick={() => openCategoryModal()}><Plus size={16} /> Category</Button>
        </div>
        <div className="hidden px-3 text-[11px] font-black uppercase text-blue-300/80 md:grid md:grid-cols-[minmax(220px,1.3fr)_90px_minmax(180px,1fr)_90px_92px] md:items-center">
          <div />
          <div className="text-right">Spent</div>
          <div />
          <div className="text-right">Budget</div>
          <div />
        </div>
        <div className="space-y-1">{sortedBudgetGroups.map(renderBudgetGroup)}</div>
      </div>
    );
  }

  function renderCategoryTransactions(category: BudgetCategory) {
    const categoryTransactions = [...state.transactions]
      .filter((transaction) => transactionHasCategory(transaction, category.id))
      .sort((a, b) => b.date.localeCompare(a.date));
    const activeMonth = budgetMonthKey;
    const monthTransactions = categoryTransactions.filter((transaction) => transactionMonthKey(transaction) === activeMonth);
    const monthSpent = categorySpendForTransactions(monthTransactions, category.id);
    const recurring = recurringAmountFromMap(recurringByCategory, category.id);
    const remaining = category.budget - monthSpent;

    return (
      <div className="fade-in space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <button type="button" className="mb-3 inline-flex items-center gap-2 text-sm font-black text-blue-300 hover:text-blue-100" onClick={closeCategoryTransactions}>
              <ChevronRight size={14} className="rotate-180" /> Categories
            </button>
            <div className="flex items-center gap-3">
              <span className="grid h-11 w-11 place-items-center rounded-xl bg-[var(--surface-2)] text-xl">{category.icon}</span>
              <div>
                <h2 className="text-2xl font-black tracking-tight">{category.name}</h2>
                <div className="text-sm font-bold text-[var(--muted)]">{formatMonthKey(activeMonth)}</div>
              </div>
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <span className="rounded-full border border-[var(--line)] bg-[var(--surface-2)] px-4 py-2.5 text-sm font-black">{formatMonthKey(activeMonth)}</span>
            <Button variant="secondary" onClick={() => openCategoryModal(category)}><Edit3 size={16} /> Edit</Button>
          </div>
        </div>

        <section className="premium-panel p-5">
          <div className="grid gap-4 md:grid-cols-[1fr_1fr_1fr]">
            <Metric label="Spent" value={usdExact.format(monthSpent)} tone={monthSpent > category.budget && category.budget > 0 ? "red" : "green"} />
            <Metric label="Budget" value={usdExact.format(category.budget)} />
            <Metric label={remaining >= 0 ? "Remaining" : "Over"} value={usdExact.format(Math.abs(remaining))} tone={remaining >= 0 ? "green" : "red"} />
          </div>
          <div className="mt-5"><Progress spent={monthSpent} budget={category.budget} recurring={recurring} /></div>
        </section>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-xl font-black">Transactions</h3>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={detectTransfers}><ArrowDownUp size={16} /> Detect transfers</Button>
            <Button variant="secondary" onClick={applyRules}><Flag size={16} /> Apply rules</Button>
            <Button variant="secondary" onClick={approveHighConfidenceAi}><Sparkles size={16} /> Apply AI</Button>
          </div>
        </div>

        <label className="flex items-center gap-2 rounded-full border border-[var(--line)] bg-[var(--surface-2)] px-4">
          <Search size={16} className="text-[var(--muted)]" />
          <input className="w-full bg-transparent py-3 outline-none" placeholder="Search merchants or notes" value={state.search} onChange={(event) => setState({ ...state, search: event.target.value })} />
        </label>

        {renderTransactionRegister(selectedCategoryRegisterTransactions, { emptyText: "No transactions in this category for this month.", showFirstMonthHeader: false })}
      </div>
    );
  }

  function renderBudgetGroup(group: BudgetGroup) {
    const totals = groupTotalsFromMap(state.categories, spendByCategory, group.id);
    const groupCategories = categoriesByGroup.get(group.id) || [];
    const groupRecurring = groupRecurringAmountFromMap(state.categories, recurringByCategory, group.id);
    return (
      <section key={group.id} className="space-y-0.5">
        <div className="grid gap-2 rounded-lg px-3 py-1.5 text-sm md:grid-cols-[minmax(220px,1.3fr)_90px_minmax(180px,1fr)_90px_92px] md:items-center">
          <button className="flex items-center gap-2 text-left font-black" onClick={() => commit((draft) => {
            const target = draft.groups.find((item) => item.id === group.id);
            if (target) target.expanded = !target.expanded;
          })}>
            {group.expanded ? <ChevronDown size={16} style={{ color: group.color }} /> : <ChevronRight size={16} style={{ color: group.color }} />}
            <span className="grid min-w-5 place-items-center rounded-md px-1.5 py-0.5 text-xs text-white" style={{ background: group.color }}>{groupCategories.length}</span>
            {group.name}
          </button>
          <div className="text-right font-black">{usd.format(totals.spent)}</div>
          <Progress spent={totals.spent} budget={totals.budget} recurring={groupRecurring} />
          <div className="text-right font-black">{usd.format(totals.budget)}</div>
          <div />
        </div>
        {group.expanded ? (
          <div className="ml-4 space-y-0.5 border-l pl-2" style={{ borderColor: group.color }}>
            {groupCategories.map((category) => {
              const spent = categorySpentFromMap(spendByCategory, category.id);
              const recurring = recurringAmountFromMap(recurringByCategory, category.id);
              return (
                <div
                  key={category.id}
                  role="button"
                  tabIndex={0}
                  className="group/category grid cursor-pointer gap-2 rounded-md px-2 py-1 text-sm transition hover:bg-[var(--selected-soft)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-400 md:grid-cols-[minmax(190px,1.3fr)_90px_minmax(180px,1fr)_90px_92px] md:items-center"
                  onClick={() => openCategoryTransactions(category)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      openCategoryTransactions(category);
                    }
                  }}
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-[var(--surface-2)] text-sm">{category.icon}</span>
                    <span className="truncate font-bold">{category.name}</span>
                  </div>
                  <div className="text-right font-black">{usd.format(spent)}</div>
                  <Progress spent={spent} budget={category.budget} recurring={recurring} />
                  <div className="text-right font-black">{usd.format(category.budget)}</div>
                  <div className="flex justify-end gap-2 opacity-0 transition group-hover/category:opacity-100">
                    <IconButton label="Edit" onClick={() => openCategoryModal(category)}><Edit3 size={14} /></IconButton>
                    <IconButton label="Delete" onClick={() => commit((draft) => {
                      draft.categories = draft.categories.filter((item) => item.id !== category.id);
                    })}><Trash2 size={14} /></IconButton>
                  </div>
                </div>
              );
            })}
          </div>
        ) : null}
      </section>
    );
  }

  function renderAccounts() {
    const worth = netWorthAmount;
    return (
      <div className="fade-in space-y-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-xl font-black">Accounts</h2>
          <button className="grid h-9 w-9 place-items-center rounded-full text-xl font-black text-blue-300 transition hover:bg-[var(--surface-2)]" onClick={() => connectModal()} aria-label="Connect account">
            +
          </button>
        </div>
        <section className="premium-panel p-5">
          <div className="flex min-h-[clamp(18rem,30vw,23rem)] items-center text-center">
            <div className="w-full">
              <div className="text-sm font-black text-blue-300">Net worth</div>
              <div className="mt-3"><Chip tone="red">Down 10.59%</Chip></div>
              <div className="mt-3 text-3xl font-black tracking-tight">{usdExact.format(worth)}</div>
              <LineChart className="mt-8 h-[clamp(10rem,18vw,15rem)] w-full" values={rangeSeries(netWorthRange, "netPrimary")} color="#5ea7ff" secondValues={rangeSeries(netWorthRange, "netSecondary")} secondColor="#ff8558" />
              <RangeTabs value={netWorthRange} onChange={setNetWorthRange} />
            </div>
          </div>
        </section>
        <div className="space-y-8">{accountGroups.map((group) => renderAccountCardGroup(group))}</div>
      </div>
    );
  }

  function renderAccountCardGroup(group: AccountGroup) {
    const accounts = state.accounts.filter((account) => account.group === group);
    if (!accounts.length) return null;
    const total = accounts.reduce((sum, account) => sum + account.balance, 0);
    const averageChange = accounts.reduce((sum, account) => sum + account.change, 0) / accounts.length;
    const groupLabel = group === "Credit card" ? "Credit cards" : group;
    return (
      <section key={group} className="space-y-3">
        <button className="flex items-center gap-2 text-left text-base font-black" onClick={() => toggleAccountGroup(group)}>
          {state.accountGroupsOpen[group] ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
          {groupLabel}
        </button>
        <div className="overflow-hidden border-b border-[var(--line)] pb-3">
          {state.accountGroupsOpen[group] ? accounts.map((account, index) => renderAccountListRow(account, index)) : null}
          <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2 px-1 py-4 md:grid-cols-[minmax(0,1fr)_minmax(96px,14vw)_90px_120px] md:gap-6">
            <div />
            <div />
            <Chip tone={averageChange >= 0 ? "green" : "red"}>{averageChange >= 0 ? "Up" : "Down"} {Math.abs(averageChange).toFixed(2)}%</Chip>
            <div className="text-right font-black">{usdExact.format(total)}</div>
          </div>
        </div>
      </section>
    );
  }

  function renderAccountListRow(account: Account, index: number) {
    const positive = account.change >= 0;
    return (
      <button key={account.id} className={`grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2 rounded-xl px-1 py-3 text-left transition hover:bg-[var(--surface-2)] md:grid-cols-[minmax(0,1fr)_minmax(96px,14vw)_90px_120px] md:gap-6 ${state.selectedAccountId === account.id ? "bg-[var(--selected-soft)]" : ""}`} onClick={() => setUi({ selectedAccountId: account.id })}>
        <div className="flex min-w-0 items-center gap-3">
          <AccountLogo account={account} />
          <div className="min-w-0">
            <div className="truncate font-black">{accountDisplayName(account)}{account.last4 ? <span className="ml-2 font-bold text-blue-300/70">{account.last4}</span> : null}</div>
            <div className="text-sm font-bold text-blue-300/75">11 hours ago</div>
          </div>
        </div>
        <AccountSparkline className="order-3 col-span-2 h-10 w-full md:order-none md:col-span-1 md:w-full" values={accountSparkValues(account, index)} color={positive ? "var(--green)" : "var(--red)"} />
        <Chip tone={positive ? "green" : "red"}>{positive ? "Up" : "Down"} {Math.abs(account.change).toFixed(2)}%</Chip>
        <div className="text-right font-black">{usdExact.format(account.balance)}</div>
      </button>
    );
  }
  function renderInvestments() {
    const investments = state.accounts.filter((account) => account.group === "Investment");
    const total = investments.reduce((sum, account) => sum + account.balance, 0);
    const holdings = [...state.investmentHoldings].sort((a, b) => b.value - a.value);
    const holdingsTotal = holdings.reduce((sum, holding) => sum + holding.value, 0);
    const accountsWithHoldings = new Set(holdings.map((holding) => holding.accountId)).size;
    return (
      <div className="fade-in space-y-6">
        <Panel title="Investment snapshot" action="Settings" onAction={() => {
          setSettingsTab("connections");
          setSettingsOpen(true);
        }}>
          <div className="space-y-6">
            <div className="text-center">
              <div className="mb-3 flex justify-center">
                <Chip tone={holdings.length ? "green" : "blue"}>{holdings.length ? `${holdings.length} holdings` : `${investments.length} accounts`}</Chip>
              </div>
              <p className="text-4xl font-black leading-tight">{usdExact.format(total)}</p>
            </div>
            <div className="grid gap-3 md:grid-cols-3">
              <Metric label="Accounts" value={investments.length.toString()} tone="green" />
              <Metric label="Holdings value" value={usdExact.format(holdingsTotal || total)} />
              <Metric label="Holding accounts" value={accountsWithHoldings ? accountsWithHoldings.toString() : "Pending"} tone={accountsWithHoldings ? "green" : "orange"} />
            </div>
          </div>
        </Panel>
        <Panel title="Accounts" action={investments.length ? undefined : "Connect"} onAction={connectModal}>
          {investments.length ? (
            <div className="space-y-3">{investments.map((account) => {
              const accountHoldingCount = holdings.filter((holding) => holding.accountId === account.id).length;
              return (
                <div key={account.id} className="compact-panel grid gap-3 p-4 md:grid-cols-[1fr_auto_auto] md:items-center">
                  <div className="min-w-0">
                    <div className="truncate font-black">{accountDisplayName(account)}{account.last4 ? <span className="ml-2 text-blue-300/70">{account.last4}</span> : null}</div>
                    <div className="text-sm font-bold text-blue-300/75">{account.subtype || "Investment account"}</div>
                  </div>
                  <Chip tone="blue">{accountHoldingCount ? `${accountHoldingCount} holdings` : "Balance only"}</Chip>
                  <div className="text-right font-black">{usdExact.format(account.balance)}</div>
                </div>
              );
            })}</div>
          ) : (
            <div className="rounded-2xl border border-dashed border-[var(--line)] bg-[var(--surface-2)] p-6 text-center">
              <div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-blue-500/15 text-blue-100"><PiggyBank size={22} /></div>
              <h3 className="mt-4 text-lg font-black">No investment accounts yet</h3>
              <div className="mt-5 flex justify-center">
                <Button variant="secondary" onClick={() => connectModal()}><Landmark size={16} /> Connect account</Button>
              </div>
            </div>
          )}
        </Panel>
        <Panel title="Holdings">
          {holdings.length ? (
            <div className="space-y-3">{holdings.slice(0, 12).map(renderInvestmentHoldingRow)}</div>
          ) : (
            <div className="rounded-2xl border border-dashed border-[var(--line)] bg-[var(--surface-2)] p-6 text-sm font-bold text-[var(--muted)]">
              Holdings will appear after Plaid sends investment data.
            </div>
          )}
        </Panel>
      </div>
    );
  }

  function renderInvestmentHoldingRow(holding: InvestmentHolding) {
    const account = accountsById.get(holding.accountId);
    const ticker = holding.ticker || holding.name.slice(0, 4).toUpperCase();
    return (
      <div key={holding.id} className="compact-panel grid gap-3 p-4 md:grid-cols-[minmax(0,1fr)_auto_auto] md:items-center">
        <div className="flex min-w-0 items-center gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-[var(--surface-2)] text-xs font-black text-blue-100">{ticker.slice(0, 4)}</span>
          <div className="min-w-0">
            <div className="truncate font-black">{holding.name}</div>
            <div className="text-sm font-bold text-blue-300/75">{account ? accountDisplayName(account) : "Investment account"} {"\u2022"} {quantityFormatter.format(holding.quantity)} shares</div>
          </div>
        </div>
        <Chip tone="blue">{holding.type || ticker}</Chip>
        <div className="text-right font-black">{usdExact.format(holding.value)}</div>
      </div>
    );
  }

  function renderRecurrings() {
    return (
      <div className="fade-in grid gap-6 xl:grid-cols-2">
        <Panel title="Recurring charges">
          <div className="space-y-3">{sortedRecurrences.map(renderRecurrenceRow)}</div>
        </Panel>
        <Panel title="Monthly impact">
          <Metric label="Recurring total" value={usdExact.format(state.recurrences.reduce((sum, recurrence) => sum + recurrence.amount, 0))} tone="orange" />
          <div className="mt-5">{renderTopCategories()}</div>
        </Panel>
      </div>
    );
  }

  function renderRecurrenceRow(recurrence: Recurrence) {
    const category = categoriesById.get(recurrence.categoryId);
    return (
      <div key={recurrence.id} className="compact-panel grid gap-3 p-4 md:grid-cols-[1fr_auto] md:items-center">
        <div className="flex items-center gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-2xl bg-[var(--surface-2)]">{category?.icon || "\u25c7"}</span>
          <div>
            <div className="font-black">{recurrence.merchant} <span className="font-bold text-[var(--muted)]">{recurrence.cadence}</span></div>
            <div className="text-sm text-[var(--muted)]">{formatRecurrenceHitDate(recurrence)} {"\u2022"} {category?.name || "Uncategorized"}</div>
          </div>
        </div>
        <strong>{usdExact.format(recurrence.amount)}</strong>
      </div>
    );
  }

  function renderGoals() {
    const totalSaved = state.goals.reduce((sum, goal) => sum + goalCurrent(goal, accountsById.get(goal.accountId)), 0);
    const target = state.goals.reduce((sum, goal) => sum + goal.targetAmount, 0);
    return (
      <div className="fade-in space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-xl font-black">Goals dashboard</h2>
          <Button onClick={() => openGoalModal()}><Plus size={16} /> Goal</Button>
        </div>
        <div className="grid gap-3 md:grid-cols-3">
          <Metric label="Total saved" value={usdExact.format(totalSaved)} tone="green" />
          <Metric label="Total target" value={usdExact.format(target)} />
          <Metric label="Remaining" value={usdExact.format(Math.max(target - totalSaved, 0))} tone="orange" />
        </div>
        {state.goals.length ? (
          <div className="grid gap-6 xl:grid-cols-2">{state.goals.map(renderGoalCard)}</div>
        ) : (
          <section className="premium-panel grid min-h-72 place-items-center p-6 text-center">
            <div>
              <div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-[var(--surface-2)] text-blue-200"><Target size={22} /></div>
              <h3 className="mt-4 text-xl font-black">No goals yet</h3>
              <div className="mt-5 flex flex-wrap justify-center gap-2">
                <Button onClick={() => openGoalModal()}><Plus size={16} /> Create goal</Button>
                <Button variant="secondary" onClick={() => connectModal()}><Landmark size={16} /> Connect account</Button>
              </div>
            </div>
          </section>
        )}
      </div>
    );
  }

  function renderGoalCard(goal: Goal) {
    const account = accountsById.get(goal.accountId);
    const current = goalCurrent(goal, account);
    const remaining = Math.max(goal.targetAmount - current, 0);
    const monthlyNeeded = remaining / monthsUntil(goal.targetDate);
    return (
      <article key={goal.id} className="premium-panel p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-3 text-lg font-black"><span className="grid h-10 w-10 place-items-center rounded-2xl bg-[var(--surface-2)]">{goal.icon}</span>{goal.name}</div>
            <div className="mt-2 text-sm font-bold text-[var(--muted)]">
              {account ? `${accountDisplayName(account)} ${account.last4}` : "Manual balance"} {"\u2022"} {goal.status} {"\u2022"} {goal.priority}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Chip tone={goal.status === "Active" ? "green" : "blue"}>{account ? "Synced" : goal.status}</Chip>
            <IconButton label="Edit goal" onClick={() => openGoalModal(goal)}><Edit3 size={14} /></IconButton>
            <IconButton label="Delete goal" onClick={() => deleteGoal(goal.id)}><Trash2 size={14} /></IconButton>
          </div>
        </div>
        <div className="mt-5"><Progress spent={current} budget={goal.targetAmount} color="var(--green)" mode="solid" /></div>
        <div className="mt-4 grid gap-3 md:grid-cols-3">
          <Metric label="Complete" value={`${Math.round(percent(current, goal.targetAmount))}%`} />
          <Metric label="Remaining" value={usdExact.format(remaining)} tone="orange" />
          <Metric label="Needed monthly" value={usdExact.format(monthlyNeeded)} />
          <Metric label="Projected" value={projectedDate(goal, current)} />
          <Metric label="Target date" value={goal.targetDate} />
          <Metric label="Saved" value={usdExact.format(current)} tone="green" />
        </div>
      </article>
    );
  }

  function renderRules() {
    return (
      <div className="fade-in space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-xl font-black">Merchant rules</h2>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={applyRules}><Flag size={16} /> Apply rules</Button>
            <Button onClick={() => openRule()}><Plus size={16} /> Rule</Button>
          </div>
        </div>
        <div className="space-y-3">{state.rules.map((rule) => {
          const category = rule.categoryId ? categoriesById.get(rule.categoryId) : undefined;
          return (
            <div key={rule.id} className="compact-panel grid gap-3 p-4 md:grid-cols-[1fr_auto] md:items-center">
              <div>
                <div className="font-black">If transaction {rule.matchType === "exact" ? "exactly matches" : "contains"} &quot;{rule.pattern}&quot;</div>
                <div className="text-sm text-[var(--muted)]">
                  {rule.internal ? "Mark as Internal transfer" : `Set category to ${category ? `${category.icon} ${category.name}` : "Uncategorized"}`}
                </div>
              </div>
              <div className="flex items-center justify-end gap-2">
                {rule.internal ? <Chip tone="blue">Internal</Chip> : null}
                <Chip tone={rule.enabled ? "green" : "red"}>{rule.enabled ? "Enabled" : "Paused"}</Chip>
                <IconButton label="Edit rule" onClick={() => openRule(rule)}><Edit3 size={14} /></IconButton>
                <IconButton label="Delete rule" onClick={() => commit((draft) => {
                  draft.rules = draft.rules.filter((item) => item.id !== rule.id);
                })}><Trash2 size={14} /></IconButton>
              </div>
            </div>
          );
        })}</div>
      </div>
    );
  }

  function renderTopCategories() {
    const topCategories = sortedBudgetCategories
      .map((category) => ({
        category,
        spent: categorySpentFromMap(spendByCategory, category.id),
        recurring: recurringAmountFromMap(recurringByCategory, category.id),
        group: state.groups.find((item) => item.id === category.groupId)
      }))
      .sort((a, b) => (
        b.spent - a.spent ||
        b.category.budget - a.category.budget ||
        a.category.order - b.category.order
      ))
      .slice(0, 5);

    return (
      <div className="space-y-2">
        {topCategories.map(({ category, spent, recurring, group }) => (
          <button
            key={category.id}
            type="button"
            className="grid w-full gap-3 rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-3 text-left transition hover:bg-[var(--surface-2)] md:grid-cols-[minmax(150px,1fr)_90px_minmax(160px,1fr)_90px] md:items-center"
            onClick={() => openCategoryTransactions(category)}
          >
            <div className="flex min-w-0 items-center gap-2 font-black">
              <span className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-[var(--surface-2)]">{category.icon}</span>
              <span className="truncate">{category.name}</span>
              {group ? <ChevronRight size={14} className="ml-auto shrink-0" style={{ color: group.color }} /> : null}
            </div>
            <div className="text-right font-black">{usd.format(spent)}</div>
            <Progress spent={spent} budget={category.budget} recurring={recurring} />
            <div className="text-right font-black">{usd.format(category.budget)}</div>
          </button>
        ))}
      </div>
    );
  }
}

function LineChart({
  values,
  color,
  secondValues,
  secondColor,
  className = "mt-7 h-28 w-full"
}: {
  values: number[];
  color: string;
  secondValues?: number[];
  secondColor?: string;
  className?: string;
}) {
  const all = [...values, ...(secondValues ?? [])];
  const max = Math.max(...all);
  const min = Math.min(...all);
  const range = max - min || 1;
  const xFor = (index: number, length: number) => 4 + (index / Math.max(1, length - 1)) * 92;
  const yFor = (value: number) => 86 - ((value - min) / range) * 68;
  const points = values.map((value, index) => `${xFor(index, values.length)},${yFor(value)}`).join(" ");
  const second = secondValues?.map((value, index) => `${xFor(index, secondValues.length)},${yFor(value)}`).join(" ");
  const endX = xFor(values.length - 1, values.length);
  const endY = points.split(" ").at(-1)?.split(",")[1] ?? "50";

  return (
    <div className={`relative ${className}`}>
      <svg className="h-full w-full overflow-visible" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        <polyline points={points} fill="none" stroke={color} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
        {second ? <polyline points={second} fill="none" stroke={secondColor} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" /> : null}
      </svg>
      <span
        className="pointer-events-none absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2"
        style={{ left: `${endX}%`, top: `${endY}%`, borderColor: color, backgroundColor: "var(--surface)" }}
        aria-hidden="true"
      />
    </div>
  );
}

function SpendingDashboardChart({
  className,
  transactions,
  spent,
  budget
}: {
  className?: string;
  transactions: Transaction[];
  spent: number;
  budget: number;
}) {
  const today = new Date();
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
  const daysInMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
  const todayDay = Math.min(today.getDate(), daysInMonth);
  const dailySpend = Array.from({ length: todayDay }, () => 0);

  transactions.forEach((transaction) => {
    const transactionDate = parseLocalDate(transaction.date);
    const sameMonth = transactionDate.getFullYear() === monthStart.getFullYear() && transactionDate.getMonth() === monthStart.getMonth();
    if (!sameMonth || transactionDate.getDate() > todayDay || transaction.amount >= 0 || transaction.excluded || transaction.internal) return;
    dailySpend[transactionDate.getDate() - 1] += Math.abs(transaction.amount);
  });

  const actualValues = dailySpend.reduce<number[]>((values, amount, index) => {
    values.push((values[index - 1] ?? 0) + amount);
    return values;
  }, []);

  if (actualValues.length === 0) {
    actualValues.push(0);
  }

  const maxChartValue = Math.max(budget, spent, ...actualValues, 1) * 1.08;
  const budgetLine = { x1: 4, y1: valueY(0, maxChartValue), x2: 96, y2: valueY(budget, maxChartValue) };
  const actualPoints = actualValues.map((value, index) => {
    const day = index + 1;
    return {
      day,
      value,
      x: 4 + ((day - 1) / Math.max(1, daysInMonth - 1)) * 92,
      y: valueY(value, maxChartValue)
    };
  });

  const lastPoint = actualPoints.at(-1) ?? { x: 4, y: valueY(0, maxChartValue), value: 0 };
  const over = spent > budget;
  const label = over ? `${usdExact.format(spent - budget)} over` : `${usd.format(budget - spent)} left`;
  const actualPath = actualPoints.map(pointPair).join(" ");
  const badgeColor = over ? HEALTH_PALETTE.red : progressHealthColor(lastPoint.value, budget);
  const firstActualX = actualPoints[0]?.x ?? 4;
  const actualWidth = Math.max(1, lastPoint.x - firstActualX);
  const actualGradientStops = actualPoints.length > 1
    ? actualPoints.map((point) => ({
      offset: `${Math.max(0, Math.min(100, ((point.x - firstActualX) / actualWidth) * 100))}%`,
      color: over ? HEALTH_PALETTE.red : progressHealthColor(point.value, budget)
    }))
    : [
      { offset: "0%", color: badgeColor },
      { offset: "100%", color: badgeColor }
    ];

  return (
    <div className={`relative ${className ?? "h-44 w-full"}`}>
      <svg className="h-full w-full overflow-visible" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        <defs>
          <linearGradient id="spending-actual-flow" x1="0%" x2="100%" y1="0%" y2="0%">
            {actualGradientStops.map((stop, index) => (
              <stop key={`${stop.offset}-${index}`} offset={stop.offset} stopColor={stop.color} />
            ))}
          </linearGradient>
        </defs>
        {budget > 0 ? (
          <line x1={budgetLine.x1} x2={budgetLine.x2} y1={budgetLine.y1} y2={budgetLine.y2} stroke="#12365d" strokeWidth="2" strokeDasharray="3 5" vectorEffect="non-scaling-stroke" />
        ) : null}
        <polyline points={actualPath} fill="none" stroke={over ? HEALTH_PALETTE.red : "url(#spending-actual-flow)"} strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" strokeOpacity="0.16" vectorEffect="non-scaling-stroke" />
        <polyline points={actualPath} fill="none" stroke={over ? HEALTH_PALETTE.red : "url(#spending-actual-flow)"} strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
      </svg>
      <span
        className="pointer-events-none absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2"
        style={{ left: `${lastPoint.x}%`, top: `${lastPoint.y}%`, borderColor: badgeColor, backgroundColor: "var(--surface)" }}
        aria-hidden="true"
      />
      <span
        className="absolute -translate-y-full rounded-md px-2 py-1 text-xs font-black text-white"
        style={{ left: `${Math.min(86, lastPoint.x + 1)}%`, top: `${Math.max(16, lastPoint.y - 7)}%`, backgroundColor: badgeColor }}
      >
        {label}
      </span>
    </div>
  );
}

function valueY(value: number, maxValue: number) {
  return 86 - (value / maxValue) * 62;
}

const HEALTH_PALETTE = {
  green: "#18d978",
  lime: "#86d85d",
  yellow: "#f2ca52",
  orange: "#f49643",
  red: "#ef5a50"
};

const HEALTH_STOPS = [
  { ratio: 0, color: HEALTH_PALETTE.green },
  { ratio: 0.58, color: HEALTH_PALETTE.green },
  { ratio: 0.74, color: HEALTH_PALETTE.lime },
  { ratio: 0.88, color: HEALTH_PALETTE.yellow },
  { ratio: 1, color: HEALTH_PALETTE.orange }
];

function NetWorthDashboardChart({ className, range }: { className?: string; range: TimeRange }) {
  const primary = chartPoints(rangeSeries(range, "netPrimary"), 34, 20);
  const secondary = chartPoints(rangeSeries(range, "netSecondary"), 64, 9);
  const lastPrimary = primary.at(-1) ?? { x: 96, y: 36 };
  const lastSecondary = secondary.at(-1) ?? { x: 96, y: 63 };

  return (
    <div className={`relative ${className ?? "h-44 w-full"}`}>
      <svg className="h-full w-full overflow-visible" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        <polyline points={primary.slice(0, -2).map(pointPair).join(" ")} fill="none" stroke="#65aefc" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
        <polyline points={primary.slice(-3).map(pointPair).join(" ")} fill="none" stroke="#65aefc" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" strokeDasharray="1 6" vectorEffect="non-scaling-stroke" />
        <polyline points={secondary.slice(0, -2).map(pointPair).join(" ")} fill="none" stroke="#ff8b54" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
        <polyline points={secondary.slice(-3).map(pointPair).join(" ")} fill="none" stroke="#ff8b54" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" strokeDasharray="1 6" vectorEffect="non-scaling-stroke" />
      </svg>
      <span className="pointer-events-none absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-[#65aefc] bg-[var(--surface)]" style={{ left: `${lastPrimary.x}%`, top: `${lastPrimary.y}%` }} aria-hidden="true" />
      <span className="pointer-events-none absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-[#ff8b54] bg-[var(--surface)]" style={{ left: `${lastSecondary.x}%`, top: `${lastSecondary.y}%` }} aria-hidden="true" />
    </div>
  );
}

function DashboardReviewList({
  transactions,
  accountsById,
  categoriesById,
  onMarkReviewed
}: {
  transactions: Transaction[];
  accountsById: Map<string, Account>;
  categoriesById: Map<string, BudgetCategory>;
  onMarkReviewed: () => void;
}) {
  const grouped = transactions.reduce<Array<{ label: string; transactions: Transaction[] }>>((groups, transaction) => {
    const label = formatTransactionGroupDate(transaction.date);
    let group = groups.find((item) => item.label === label);

    if (!group) {
      group = { label, transactions: [] };
      groups.push(group);
    }

    group.transactions.push(transaction);
    return groups;
  }, []);

  return (
    <div className="flex min-h-[17.5rem] flex-col">
      <div className="flex-1 space-y-4">
        {grouped.length ? grouped.map((group) => (
          <div key={group.label} className="space-y-2">
            <div className="text-sm font-black text-blue-300">{group.label}</div>
            <div className="space-y-1">
              {group.transactions.map((transaction) => {
                const account = accountsById.get(transaction.accountId);
                const category = transaction.categoryId ? categoriesById.get(transaction.categoryId) : undefined;
                const positive = transaction.amount > 0;

                return (
                  <div key={transaction.id} className="grid grid-cols-[18px_18px_minmax(0,1fr)_auto_auto_8px] items-center gap-2 rounded-lg py-1.5 text-sm">
                    <input className="h-3.5 w-3.5 rounded border-[var(--line)] bg-transparent" type="checkbox" readOnly />
                    <span className="grid h-3.5 w-3.5 place-items-center rounded border border-blue-300/45 text-[9px] font-black text-blue-300">T</span>
                    <div className="min-w-0">
                      <span className="truncate font-black text-[var(--text)]">{transaction.name}</span>
                      <span className="ml-2 truncate font-bold text-blue-300/70">{accountSource(account)}</span>
                    </div>
                    {category ? (
                      <span className={`category-pill hidden rounded-full border px-2.5 py-1 md:inline-flex ${categoryTone(category)}`}>
                        {category.icon} {categoryLabel(category)}
                      </span>
                    ) : <span />}
                    <span className={`text-right font-black ${positive ? "text-[var(--green)]" : "text-[var(--text)]"}`}>
                      {usdExact.format(Math.abs(transaction.amount))}
                    </span>
                    <span className="h-1 w-1 rounded-full bg-blue-300" />
                  </div>
                );
              })}
            </div>
          </div>
        )) : (
          <div className="grid min-h-44 place-items-center rounded-2xl border border-dashed border-[var(--line)] text-sm font-bold text-[var(--muted)]">
            Nothing to review right now.
          </div>
        )}
      </div>
      <div className="mt-4 flex items-center justify-between border-t border-[var(--line)] pt-4 text-sm font-bold text-blue-300">
        <span>1 - {Math.max(1, transactions.length)} of {Math.max(1, transactions.length)}</span>
        <button className="inline-flex items-center gap-2 rounded-xl border border-[var(--line)] bg-[var(--surface-2)] px-4 py-2 font-black text-[var(--text)]" onClick={onMarkReviewed}>
          <Check size={15} /> Mark {transactions.length || 0} as reviewed
        </button>
      </div>
    </div>
  );
}

function RangeTabs({ value, onChange }: { value: TimeRange; onChange: (range: TimeRange) => void }) {
  return (
    <div className="mt-4 flex flex-wrap justify-center gap-5 text-sm font-black text-blue-300">
      {timeRanges.map((range) => (
        <button
          key={range}
          type="button"
          className={`rounded-full px-3 py-1.5 transition ${value === range ? "bg-[var(--surface-2)] text-[var(--text)]" : "hover:bg-[var(--surface-2)] hover:text-[var(--text)]"}`}
          onClick={() => onChange(range)}
        >
          {range}
        </button>
      ))}
    </div>
  );
}

function rangeSeries(range: TimeRange, kind: SeriesKind) {
  const pointsByRange: Record<TimeRange, Record<SeriesKind, number[]>> = {
    "1W": {
      netPrimary: [58, 58, 58, 55, 55, 56, 56, 56],
      netSecondary: [42, 41, 41, 41, 42, 42, 42, 42],
      investment: [32, 32, 33, 33, 31, 55, 47, 41]
    },
    "1M": {
      netPrimary: [61, 60, 60, 58, 57, 57, 58, 58, 59, 59],
      netSecondary: [43, 42, 42, 42, 43, 43, 43, 44, 44, 44],
      investment: [31, 33, 34, 32, 36, 41, 48, 46, 50, 54]
    },
    "3M": {
      netPrimary: [64, 63, 61, 60, 58, 57, 57, 58, 59, 60, 60],
      netSecondary: [44, 43, 43, 42, 42, 42, 43, 43, 44, 44, 45],
      investment: [28, 31, 35, 33, 37, 44, 48, 51, 49, 56, 62]
    },
    YTD: {
      netPrimary: [67, 65, 63, 61, 60, 58, 57, 58, 60, 61, 62, 63],
      netSecondary: [45, 44, 44, 43, 42, 42, 42, 43, 44, 44, 45, 45],
      investment: [24, 28, 31, 35, 37, 42, 48, 46, 52, 57, 61, 66]
    },
    "1Y": {
      netPrimary: [70, 69, 66, 63, 60, 57, 55, 56, 58, 60, 62, 64],
      netSecondary: [47, 46, 45, 44, 43, 42, 42, 43, 44, 45, 45, 46],
      investment: [21, 25, 31, 29, 35, 39, 43, 51, 48, 57, 63, 70]
    },
    ALL: {
      netPrimary: [55, 58, 63, 68, 66, 62, 58, 55, 57, 60, 63, 66],
      netSecondary: [38, 40, 43, 45, 44, 42, 41, 42, 43, 44, 45, 47],
      investment: [18, 23, 28, 35, 31, 40, 46, 54, 50, 61, 68, 76]
    }
  };

  return pointsByRange[range][kind];
}

function chartPoints(values: number[], baseline: number, height: number) {
  const max = Math.max(...values);
  const min = Math.min(...values);
  const range = max - min || 1;

  return values.map((value, index) => ({
    x: 4 + (index / Math.max(1, values.length - 1)) * 92,
    y: baseline - ((value - min) / range) * height
  }));
}

function pointPair(point: { x: number; y: number }) {
  return `${point.x},${point.y}`;
}

function progressHealthColor(spent: number, budget: number) {
  if (budget <= 0 && spent > 0) return HEALTH_PALETTE.red;
  if (budget <= 0) return HEALTH_PALETTE.green;

  const ratio = spent / budget;
  if (ratio > 1) return HEALTH_PALETTE.red;
  return blendedHealthColor(ratio);
}

function blendedHealthColor(ratio: number) {
  const normalizedRatio = Math.max(0, Math.min(1, ratio));

  for (let index = 1; index < HEALTH_STOPS.length; index += 1) {
    const previous = HEALTH_STOPS[index - 1];
    const current = HEALTH_STOPS[index];
    if (normalizedRatio <= current.ratio) {
      const span = current.ratio - previous.ratio || 1;
      return mixHexColor(previous.color, current.color, (normalizedRatio - previous.ratio) / span);
    }
  }

  return HEALTH_PALETTE.orange;
}

function mixHexColor(from: string, to: string, amount: number) {
  const start = hexToRgb(from);
  const end = hexToRgb(to);
  const mix = start.map((channel, index) => Math.round(channel + (end[index] - channel) * amount));
  return `rgb(${mix[0]}, ${mix[1]}, ${mix[2]})`;
}

function hexToRgb(hex: string) {
  const value = hex.replace("#", "");
  return [0, 2, 4].map((offset) => Number.parseInt(value.slice(offset, offset + 2), 16));
}

function Progress({
  spent,
  budget,
  color,
  recurring = 0,
  mode = "health"
}: {
  spent: number;
  budget: number;
  color?: string;
  recurring?: number;
  mode?: "health" | "solid";
}) {
  const value = percent(spent, budget);
  const recurringValue = percent(recurring, budget);
  const recurringPaidValue = percent(Math.min(spent, recurring), budget);
  const showRecurring = recurring > 0 && budget > 0;
  const barColor = mode === "health" ? progressHealthColor(spent, budget) : color || "var(--green)";
  return (
    <div className={`progress-track ${showRecurring ? "has-recurring" : ""}`} style={progressStyle(value, barColor, recurringValue, recurringPaidValue)}>
      <span className={`progress-fill ${value > 100 ? "over" : ""}`} />
      {showRecurring ? (
        <>
          <span className="progress-recurring-paid" />
          <span className="progress-recurring-outline" />
        </>
      ) : null}
    </div>
  );
}

function AiStatusPill({ status }: { status: AiStatus }) {
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-[var(--line)] bg-[var(--surface-2)] px-3 py-2 text-sm font-black">
      <span className={`h-2.5 w-2.5 rounded-full ${status.ok ? "bg-[var(--green)]" : "bg-[var(--red)]"}`} />
      {status.label}
    </span>
  );
}

function Panel({ title, action, onAction, children }: { title: string; action?: string; onAction?: () => void; children: React.ReactNode }) {
  return (
    <article className="premium-panel overflow-hidden">
      <div className="flex items-center justify-between gap-3 px-5 pt-5">
        <h2 className="font-black">{title}</h2>
        {action ? <button className="font-black text-blue-300" onClick={onAction}>{action} &gt;</button> : null}
      </div>
      <div className="p-5">{children}</div>
    </article>
  );
}

function Metric({ label, value, tone }: { label: string; value: string; tone?: "green" | "orange" | "red" }) {
  const color = tone === "green" ? "text-[var(--green)]" : tone === "orange" ? "text-[var(--orange)]" : tone === "red" ? "text-[var(--red)]" : "";
  return (
    <div className="compact-panel p-4">
      <div className="text-xs font-black text-[var(--muted)]">{label}</div>
      <div className={`mt-2 text-2xl font-black ${color}`}>{value}</div>
    </div>
  );
}

function Chip({ tone, children }: { tone?: "green" | "blue" | "red"; children: React.ReactNode }) {
  const style = tone === "green"
    ? "border-emerald-400/30 bg-emerald-400/15 text-emerald-100"
    : tone === "red"
      ? "border-red-400/30 bg-red-400/15 text-red-100"
      : tone === "blue"
        ? "border-blue-400/30 bg-blue-400/15 text-blue-100"
        : "border-[var(--line)] bg-[var(--surface-2)] text-[var(--text)]";
  return <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-black ${style}`}>{children}</span>;
}

function AccountLogo({ account }: { account: Account }) {
  const label = accountDisplayName(account).slice(0, 1).toUpperCase();
  return (
    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-gradient-to-br from-sky-500 to-blue-950 text-sm font-black text-white shadow-soft">
      {label}
    </span>
  );
}

function AccountSparkline({ values, color, className = "h-10 w-28" }: { values: number[]; color: string; className?: string }) {
  const max = Math.max(...values);
  const min = Math.min(...values);
  const range = max - min || 1;
  const points = values.map((value, index) => `${3 + (index / Math.max(1, values.length - 1)) * 94},${34 - ((value - min) / range) * 28}`).join(" ");
  const gradientId = `spark-${color.replace(/[^a-z0-9]/gi, "")}`;

  return (
    <svg className={className} viewBox="0 0 100 40" preserveAspectRatio="none" aria-hidden="true">
      <defs>
        <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.22" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polyline points={`0,40 ${points} 100,40`} fill={`url(#${gradientId})`} stroke="none" />
      <polyline points={points} fill="none" stroke={color} strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function accountSparkValues(account: Account, index: number) {
  if (account.change >= 0) {
    return [20, 22 + index, 24, 25 + index, 31, 33 + index, 33 + index];
  }

  return [34, 34 - index, 30, 30 - index, 22, 20 + index, 19];
}

function Button({ children, variant = "primary", onClick }: { children: React.ReactNode; variant?: "primary" | "secondary"; onClick: () => void }) {
  return (
    <button type="button" className={`inline-flex items-center gap-2 rounded-full px-4 py-2.5 text-sm font-black transition hover:-translate-y-0.5 ${variant === "primary" ? "bg-[var(--pill)] text-white shadow-soft" : "border border-[var(--line)] bg-[var(--surface-2)] text-[var(--text)]"}`} onClick={onClick}>
      {children}
    </button>
  );
}

function IconButton({ label, children, onClick }: { label: string; children: React.ReactNode; onClick: () => void }) {
  return (
    <button title={label} aria-label={label} className="grid min-h-8 min-w-8 place-items-center rounded-full border border-[var(--line)] bg-[var(--surface-2)] px-2 text-xs font-black transition hover:-translate-y-0.5 hover:bg-[var(--surface-3)]" onClick={(event) => {
      event.stopPropagation();
      onClick();
    }}>
      {children}
    </button>
  );
}

function BulkTransactionBar({
  selectedCount,
  categories,
  openMenu,
  setOpenMenu,
  onClear,
  onCategory,
  onType,
  onExclude,
  onReview,
  onDelete
}: {
  selectedCount: number;
  categories: BudgetCategory[];
  openMenu: BulkMenu;
  setOpenMenu: (menu: BulkMenu) => void;
  onClear: () => void;
  onCategory: (categoryId: string | null) => void;
  onType: (type: "transaction" | "transfer") => void;
  onExclude: () => void;
  onReview: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="fixed inset-x-0 bottom-5 z-40 flex justify-center px-4">
      <div className="relative grid max-w-[calc(100vw-2rem)] gap-2 rounded-2xl border border-[var(--line)] bg-[color:color-mix(in_srgb,var(--surface)_94%,black_6%)] p-2 shadow-soft backdrop-blur-xl">
        <div className="flex flex-wrap items-center justify-center gap-2">
          <button type="button" className="grid h-9 w-9 place-items-center rounded-xl border border-[var(--line)] bg-[var(--surface-2)] text-[var(--muted)] hover:text-[var(--text)]" onClick={onClear} aria-label="Clear selection">
            <X size={16} />
          </button>
          <div className="min-w-24 px-2 text-sm font-black">{selectedCount} selected</div>

          <div className="relative">
            <button type="button" className="flex items-center gap-2 rounded-xl border border-[var(--line)] bg-[var(--surface-2)] px-3 py-2 text-sm font-black hover:bg-[var(--surface-3)]" onClick={() => setOpenMenu(openMenu === "category" ? null : "category")}>
              <CircleDollarSign size={16} /> Category
            </button>
            {openMenu === "category" ? (
              <div className="absolute bottom-12 left-0 max-h-80 w-64 overflow-y-auto rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-2 shadow-soft">
                <button type="button" className="w-full rounded-xl px-3 py-2 text-left text-sm font-black text-blue-200 hover:bg-[var(--surface-2)]" onClick={() => onCategory(null)}>
                  Uncategorized
                </button>
                {categories.map((category) => (
                  <button key={category.id} type="button" className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm font-black hover:bg-[var(--surface-2)]" onClick={() => onCategory(category.id)}>
                    <span>{category.icon}</span>
                    <span>{category.name}</span>
                  </button>
                ))}
              </div>
            ) : null}
          </div>

          <div className="relative">
            <button type="button" className="flex items-center gap-2 rounded-xl border border-[var(--line)] bg-[var(--surface-2)] px-3 py-2 text-sm font-black hover:bg-[var(--surface-3)]" onClick={() => setOpenMenu(openMenu === "type" ? null : "type")}>
              <ArrowDownUp size={16} /> Type
            </button>
            {openMenu === "type" ? (
              <div className="absolute bottom-12 left-0 w-56 rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-2 shadow-soft">
                <button type="button" className="w-full rounded-xl px-3 py-2 text-left text-sm font-black hover:bg-[var(--surface-2)]" onClick={() => onType("transaction")}>
                  Transaction
                </button>
                <button type="button" className="w-full rounded-xl px-3 py-2 text-left text-sm font-black text-blue-200 hover:bg-[var(--surface-2)]" onClick={() => onType("transfer")}>
                  Internal transfer
                </button>
              </div>
            ) : null}
          </div>
        </div>

        <div className="flex flex-wrap justify-center gap-2 border-t border-[var(--line)] pt-2">
          <button type="button" className="rounded-xl px-3 py-2 text-sm font-black hover:bg-[var(--surface-2)]" onClick={onClear}>
            Unselect all
          </button>
          <button type="button" className="flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-black text-emerald-200 hover:bg-emerald-500/10" onClick={onReview}>
            <Check size={15} /> Mark reviewed
          </button>
          <button type="button" className="flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-black text-amber-200 hover:bg-amber-500/10" onClick={onExclude}>
            <X size={15} /> Exclude from spending
          </button>
          <button type="button" className="flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-black text-red-300 hover:bg-red-500/10" onClick={onDelete}>
            <Trash2 size={15} /> Delete
          </button>
        </div>
      </div>
    </div>
  );
}

function RuleModal({
  draft,
  categories,
  accounts,
  transactions,
  setDraft,
  onClose,
  onSave
}: {
  draft: RuleDraft;
  categories: BudgetCategory[];
  accounts: Account[];
  transactions: Transaction[];
  setDraft: (draft: RuleDraft | null) => void;
  onClose: () => void;
  onSave: (event: FormEvent) => void;
}) {
  const categoriesById = useMemo(() => new Map(categories.map((category) => [category.id, category])), [categories]);
  const accountsById = useMemo(() => new Map(accounts.map((account) => [account.id, account])), [accounts]);
  const matchingTransactions = useMemo(() => (
    transactions
      .filter((transaction) => transactionMatchesRuleDraft(draft, transaction))
      .sort((a, b) => b.date.localeCompare(a.date))
  ), [draft, transactions]);
  const actionLabel = ruleActionLabel(draft, categoriesById);
  const canSave = Boolean(draft.pattern.trim() && (draft.internal || draft.categoryId));

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4 backdrop-blur-sm" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <form className="max-h-[calc(100vh-2rem)] w-[min(760px,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--surface)] shadow-soft" onSubmit={onSave}>
        <div className="mb-5 flex items-center justify-between">
          <div className="px-5 pt-5">
            <p className="text-xs font-black uppercase tracking-normal text-blue-300/80">{draft.id ? "Edit rule" : `New rule for ${actionLabel}`}</p>
            <h2 className="mt-1 text-xl font-black">Apply this rule to matching transactions</h2>
          </div>
          <button className="mr-5 mt-5 grid h-9 w-9 place-items-center rounded-full border border-[var(--line)] bg-[var(--surface-2)] text-[var(--muted)] hover:text-[var(--text)]" type="button" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="grid max-h-[calc(100vh-12rem)] gap-5 overflow-y-auto px-5 pb-5 soft-scrollbar">
          <div className="grid gap-4 rounded-2xl border border-[var(--line)] bg-[var(--surface-2)] p-4">
            <div className="grid gap-4 md:grid-cols-[1fr_220px]">
              <Label title="Merchant text">
                <input className="w-full rounded-xl border border-[var(--line)] bg-[var(--surface)] px-3 py-2 text-base font-black text-[var(--text)] outline-none" value={draft.pattern} onChange={(event) => setDraft({ ...draft, pattern: event.target.value })} />
              </Label>
              <Label title="Action">
                <select
                  className="w-full rounded-xl border border-[var(--line)] bg-[var(--surface)] px-3 py-2 outline-none"
                  value={draft.internal ? INTERNAL_TRANSFER_ACTION : draft.categoryId || ""}
                  onChange={(event) => {
                    const value = event.target.value;
                    setDraft(value === INTERNAL_TRANSFER_ACTION ? { ...draft, categoryId: null, internal: true } : { ...draft, categoryId: value, internal: false });
                  }}
                >
                  <option value={INTERNAL_TRANSFER_ACTION}>Internal transfer</option>
                  {!categories.length ? <option value="">No categories yet</option> : null}
                  {categories.map((category) => <option key={category.id} value={category.id}>{category.icon} {category.name}</option>)}
                </select>
              </Label>
            </div>
            <div className="grid gap-3 md:grid-cols-[1fr_auto] md:items-center">
              <div className="grid grid-cols-2 rounded-full border border-[var(--line)] bg-[var(--surface)] p-1">
                {[
                  { value: "exact", label: "Exact match" },
                  { value: "contains", label: "Partial match" }
                ].map((item) => (
                  <button
                    key={item.value}
                    type="button"
                    className={`rounded-full px-4 py-2 text-sm font-black transition ${draft.matchType === item.value ? "bg-[var(--pill)] text-white shadow-soft" : "text-[var(--muted)] hover:text-[var(--text)]"}`}
                    onClick={() => setDraft({ ...draft, matchType: item.value as MerchantRule["matchType"] })}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
              <label className="flex items-center gap-3 rounded-full border border-[var(--line)] bg-[var(--surface)] px-4 py-2 font-black">
                <input type="checkbox" checked={draft.enabled} onChange={(event) => setDraft({ ...draft, enabled: event.target.checked })} />
                Enabled
              </label>
            </div>
          </div>

          <div className="grid gap-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-sm font-black text-blue-300">{matchingTransactions.length} matching transaction{matchingTransactions.length === 1 ? "" : "s"}</div>
                <div className="text-xs font-bold text-[var(--muted)]">{draft.enabled ? "These will be updated when you create the rule." : "Preview only while this rule is paused."}</div>
              </div>
              <RuleActionChip draft={draft} categoriesById={categoriesById} />
            </div>
            <div className="overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--surface-2)]">
              {matchingTransactions.length ? matchingTransactions.map((transaction) => (
                <RulePreviewTransaction key={transaction.id} transaction={transaction} category={transaction.categoryId ? categoriesById.get(transaction.categoryId) : undefined} account={accountsById.get(transaction.accountId)} />
              )) : (
                <div className="p-5 text-center text-sm font-bold text-[var(--muted)]">
                  No past transactions match this rule yet.
                </div>
              )}
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-3 border-t border-[var(--line)] bg-[var(--surface)] p-5">
          <Button variant="secondary" onClick={onClose}>{draft.id ? "Cancel" : "No thanks"}</Button>
          <button className={`rounded-full px-5 py-2.5 text-sm font-black text-white transition ${canSave ? "bg-[var(--pill)] shadow-soft hover:-translate-y-0.5" : "cursor-not-allowed bg-slate-600/60"}`} type="submit" disabled={!canSave}>
            {draft.id ? "Save rule" : "Create rule"}
          </button>
        </div>
      </form>
    </div>
  );
}

function RuleActionChip({ draft, categoriesById }: { draft: RuleDraft; categoriesById: Map<string, BudgetCategory> }) {
  const category = draft.categoryId ? categoriesById.get(draft.categoryId) : undefined;
  if (draft.internal) {
    return (
      <span className="inline-flex items-center gap-2 rounded-full border border-blue-400/25 bg-blue-500/15 px-3 py-1.5 text-xs font-black text-blue-100">
        <ArrowDownUp size={13} /> Internal transfer
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-blue-400/25 bg-blue-500/15 px-3 py-1.5 text-xs font-black text-blue-100">
      {category?.icon ? <span>{category.icon}</span> : null}{category?.name || "Uncategorized"}
    </span>
  );
}

function RulePreviewTransaction({ transaction, category, account }: { transaction: Transaction; category?: BudgetCategory; account?: Account }) {
  const transactionCategory = transaction.internal ? undefined : category;
  const tone = transaction.internal ? "border-blue-400/25 bg-blue-500/15 text-blue-100" : categoryTone(transactionCategory);
  return (
    <div className="grid gap-3 border-b border-[var(--line)] px-4 py-3 last:border-b-0 md:grid-cols-[76px_minmax(0,1fr)_auto_96px] md:items-center">
      <div className="text-sm font-black text-[var(--muted)]">{formatRulePreviewDate(transaction.date)}</div>
      <div className="min-w-0">
        <div className="truncate font-black">{transaction.name}</div>
        <div className="truncate text-xs font-bold text-blue-300/70">{accountSource(account)}</div>
      </div>
      <span className={`inline-flex max-w-full items-center justify-self-start rounded-full border px-3 py-1 text-xs font-black md:justify-self-end ${tone}`}>
        {transaction.internal ? <><ArrowDownUp size={12} className="mr-1" /> Internal</> : <>{transactionCategory?.icon ? <span className="mr-1">{transactionCategory.icon}</span> : null}{categoryLabel(transactionCategory)}</>}
      </span>
      <div className="text-right font-black">{usdExact.format(Math.abs(transaction.amount))}</div>
    </div>
  );
}

function formatRulePreviewDate(value: string) {
  return parseLocalDate(value).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function TransactionModal({ transaction, accounts, categories, onClose, onSave }: { transaction: Transaction; accounts: Account[]; categories: BudgetCategory[]; onClose: () => void; onSave: (transaction: Transaction) => void }) {
  const [draft, setDraft] = useState<Transaction>(transaction);

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4 backdrop-blur-sm" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <form className="w-[min(560px,calc(100vw-2rem))] rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-5 shadow-soft" onSubmit={(event) => {
        event.preventDefault();
        onSave(draft);
      }}>
        <ModalHeader title="Edit transaction" onClose={onClose} />
        <div className="grid gap-4">
          <Label title="Name">
            <input className="w-full rounded-xl border border-[var(--line)] bg-[var(--surface-2)] px-3 py-2 outline-none" value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value, merchant: event.target.value })} />
          </Label>
          <div className="grid gap-4 md:grid-cols-2">
            <Label title="Amount">
              <input className="w-full rounded-xl border border-[var(--line)] bg-[var(--surface-2)] px-3 py-2 outline-none" type="number" step="0.01" value={draft.amount} onChange={(event) => setDraft({ ...draft, amount: Number(event.target.value) })} />
            </Label>
            <Label title="Date">
              <input className="w-full rounded-xl border border-[var(--line)] bg-[var(--surface-2)] px-3 py-2 outline-none" type="date" value={draft.date} onChange={(event) => setDraft({ ...draft, date: event.target.value })} />
            </Label>
          </div>
          <Label title="Account">
            <select className="w-full rounded-xl border border-[var(--line)] bg-[var(--surface-2)] px-3 py-2 outline-none" value={draft.accountId} onChange={(event) => setDraft({ ...draft, accountId: event.target.value })}>
              {accounts.map((account) => <option key={account.id} value={account.id}>{accountDisplayName(account)} {account.last4}</option>)}
            </select>
          </Label>
          <Label title="Category">
            <select
              className="w-full rounded-xl border border-[var(--line)] bg-[var(--surface-2)] px-3 py-2 outline-none"
              value={draft.internal ? INTERNAL_TRANSFER_ACTION : draft.categoryId || ""}
              onChange={(event) => {
                const value = event.target.value;
                setDraft(value === INTERNAL_TRANSFER_ACTION ? { ...draft, categoryId: null, internal: true, excluded: true } : { ...draft, categoryId: value || null, internal: false });
              }}
            >
              <option value="">Uncategorized</option>
              <option value={INTERNAL_TRANSFER_ACTION}>Internal transfer</option>
              {categories.map((category) => <option key={category.id} value={category.id}>{category.icon} {category.name}</option>)}
            </select>
          </Label>
          <div className="grid gap-3 rounded-xl border border-[var(--line)] bg-[var(--surface-2)] p-3">
            <label className="flex items-center gap-3 font-black"><input type="checkbox" checked={draft.excluded} onChange={(event) => setDraft({ ...draft, excluded: event.target.checked })} /> Exclude from spending</label>
            <label className="flex items-center gap-3 font-black"><input type="checkbox" checked={draft.internal} onChange={(event) => setDraft({ ...draft, internal: event.target.checked, categoryId: event.target.checked ? null : draft.categoryId, excluded: event.target.checked ? true : draft.excluded })} /> Internal transfer</label>
          </div>
        </div>
        <ModalFooter onClose={onClose} submitLabel="Save transaction" />
      </form>
    </div>
  );
}

function CategoryModal({ draft, groups, setDraft, onClose, onSave }: { draft: CategoryDraft; groups: BudgetGroup[]; setDraft: (draft: CategoryDraft | null) => void; onClose: () => void; onSave: (draft: CategoryDraft) => void }) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4 backdrop-blur-sm" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <form className="w-[min(520px,calc(100vw-2rem))] rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-5 shadow-soft" onSubmit={(event) => {
        event.preventDefault();
        onSave(draft);
      }}>
        <ModalHeader title={draft.id ? "Edit category" : "New category"} onClose={onClose} />
        <div className="grid gap-4">
          <Label title="Name">
            <input className="w-full rounded-xl border border-[var(--line)] bg-[var(--surface-2)] px-3 py-2 outline-none" value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
          </Label>
          <div className="grid gap-4 md:grid-cols-2">
            <Label title="Icon">
              <input className="w-full rounded-xl border border-[var(--line)] bg-[var(--surface-2)] px-3 py-2 outline-none" value={draft.icon} onChange={(event) => setDraft({ ...draft, icon: event.target.value })} />
            </Label>
            <Label title="Monthly limit">
              <input className="w-full rounded-xl border border-[var(--line)] bg-[var(--surface-2)] px-3 py-2 outline-none" type="number" min="0" step="1" value={draft.budget} onChange={(event) => setDraft({ ...draft, budget: Number(event.target.value) })} />
            </Label>
          </div>
          <Label title="Group">
            <select className="w-full rounded-xl border border-[var(--line)] bg-[var(--surface-2)] px-3 py-2 outline-none" value={draft.groupId} onChange={(event) => setDraft({ ...draft, groupId: event.target.value })}>
              {groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}
            </select>
          </Label>
        </div>
        <ModalFooter onClose={onClose} submitLabel="Save category" />
      </form>
    </div>
  );
}

function GroupModal({ draft, setDraft, onClose, onSave }: { draft: GroupDraft; setDraft: (draft: GroupDraft | null) => void; onClose: () => void; onSave: (draft: GroupDraft) => void }) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4 backdrop-blur-sm" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <form className="w-[min(480px,calc(100vw-2rem))] rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-5 shadow-soft" onSubmit={(event) => {
        event.preventDefault();
        onSave(draft);
      }}>
        <ModalHeader title={draft.id ? "Edit group" : "New group"} onClose={onClose} />
        <div className="grid gap-4">
          <Label title="Name">
            <input className="w-full rounded-xl border border-[var(--line)] bg-[var(--surface-2)] px-3 py-2 outline-none" value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
          </Label>
          <Label title="Color">
            <div className="flex items-center gap-3 rounded-xl border border-[var(--line)] bg-[var(--surface-2)] px-3 py-2">
              <input className="h-9 w-12 rounded-lg border border-[var(--line)] bg-transparent" type="color" value={draft.color} onChange={(event) => setDraft({ ...draft, color: event.target.value })} />
              <input className="min-w-0 flex-1 bg-transparent font-black outline-none" value={draft.color} onChange={(event) => setDraft({ ...draft, color: event.target.value })} />
            </div>
          </Label>
        </div>
        <ModalFooter onClose={onClose} submitLabel="Save group" />
      </form>
    </div>
  );
}

function GoalModal({ draft, accounts, setDraft, onClose, onSave }: { draft: GoalDraft; accounts: Account[]; setDraft: (draft: GoalDraft | null) => void; onClose: () => void; onSave: (draft: GoalDraft) => void }) {
  const goalAccounts = accounts.filter((account) => account.group !== "Credit card" || account.id === draft.accountId);
  const linkedAccount = accounts.find((account) => account.id === draft.accountId);
  const displayedSaved = linkedAccount ? Math.max(linkedAccount.balance, 0) : draft.currentAmount;

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4 backdrop-blur-sm" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <form className="max-h-[calc(100vh-2rem)] w-[min(640px,calc(100vw-2rem))] overflow-y-auto rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-5 shadow-soft soft-scrollbar" onSubmit={(event) => {
        event.preventDefault();
        onSave(draft);
      }}>
        <ModalHeader title={draft.id ? "Edit goal" : "New goal"} onClose={onClose} />
        <div className="grid gap-4">
          <div className="grid gap-4 md:grid-cols-[1fr_96px]">
            <Label title="Goal name">
              <input className="w-full rounded-xl border border-[var(--line)] bg-[var(--surface-2)] px-3 py-2 outline-none" value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
            </Label>
            <Label title="Icon">
              <input className="w-full rounded-xl border border-[var(--line)] bg-[var(--surface-2)] px-3 py-2 outline-none" value={draft.icon} onChange={(event) => setDraft({ ...draft, icon: event.target.value })} />
            </Label>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <Label title="Target amount">
              <input className="w-full rounded-xl border border-[var(--line)] bg-[var(--surface-2)] px-3 py-2 outline-none" type="number" min="0" step="100" value={draft.targetAmount} onChange={(event) => setDraft({ ...draft, targetAmount: Number(event.target.value) })} />
            </Label>
            <Label title="Target date">
              <input className="w-full rounded-xl border border-[var(--line)] bg-[var(--surface-2)] px-3 py-2 outline-none" type="date" value={draft.targetDate} onChange={(event) => setDraft({ ...draft, targetDate: event.target.value })} />
            </Label>
          </div>
          <Label title="Linked account">
            <select className="w-full rounded-xl border border-[var(--line)] bg-[var(--surface-2)] px-3 py-2 outline-none" value={draft.accountId} onChange={(event) => setDraft({ ...draft, accountId: event.target.value })}>
              <option value="">Manual balance</option>
              {!goalAccounts.length ? <option value="" disabled>No Plaid accounts connected</option> : null}
              {goalAccounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {accountDisplayName(account)}{account.last4 ? ` ${account.last4}` : ""} - {account.group} - {usdExact.format(Math.max(account.balance, 0))}
                </option>
              ))}
            </select>
          </Label>
          <div className="grid gap-4 md:grid-cols-3">
            <Label title={linkedAccount ? "Synced saved" : "Saved so far"}>
              <input className="w-full rounded-xl border border-[var(--line)] bg-[var(--surface-2)] px-3 py-2 outline-none disabled:text-[var(--muted)]" type="number" min="0" step="100" value={Number(displayedSaved.toFixed(2))} disabled={Boolean(linkedAccount)} onChange={(event) => setDraft({ ...draft, currentAmount: Number(event.target.value) })} />
            </Label>
            <Label title="Priority">
              <select className="w-full rounded-xl border border-[var(--line)] bg-[var(--surface-2)] px-3 py-2 outline-none" value={draft.priority} onChange={(event) => setDraft({ ...draft, priority: event.target.value as Goal["priority"] })}>
                <option value="High">High</option>
                <option value="Medium">Medium</option>
                <option value="Low">Low</option>
              </select>
            </Label>
            <Label title="Status">
              <select className="w-full rounded-xl border border-[var(--line)] bg-[var(--surface-2)] px-3 py-2 outline-none" value={draft.status} onChange={(event) => setDraft({ ...draft, status: event.target.value as Goal["status"] })}>
                <option value="Active">Active</option>
                <option value="Paused">Paused</option>
                <option value="Completed">Completed</option>
                <option value="Archived">Archived</option>
              </select>
            </Label>
          </div>
          <Label title="Notes">
            <textarea className="min-h-24 w-full resize-y rounded-xl border border-[var(--line)] bg-[var(--surface-2)] px-3 py-2 outline-none" value={draft.notes} onChange={(event) => setDraft({ ...draft, notes: event.target.value })} />
          </Label>
        </div>
        <ModalFooter onClose={onClose} submitLabel="Save goal" />
      </form>
    </div>
  );
}

function SplitModal({ draft, categories, setDraft, onClose, onSave }: { draft: SplitDraft; categories: BudgetCategory[]; setDraft: (draft: SplitDraft | null) => void; onClose: () => void; onSave: (draft: SplitDraft) => void }) {
  const total = Math.abs(draft.transaction.amount);
  const secondAmount = Number((total - draft.firstAmount).toFixed(2));

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4 backdrop-blur-sm" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <form className="w-[min(560px,calc(100vw-2rem))] rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-5 shadow-soft" onSubmit={(event) => {
        event.preventDefault();
        onSave(draft);
      }}>
        <ModalHeader title="Split transaction" onClose={onClose} />
        <div className="mb-4 rounded-xl border border-[var(--line)] bg-[var(--surface-2)] p-3 text-sm font-bold text-[var(--muted)]">
          {draft.transaction.name} total: {usdExact.format(total)}
        </div>
        <div className="grid gap-4">
          <SplitLine title="First split" categoryId={draft.firstCategoryId} amount={draft.firstAmount} categories={categories} onCategory={(categoryId) => setDraft({ ...draft, firstCategoryId: categoryId })} onAmount={(amount) => setDraft({ ...draft, firstAmount: amount })} />
          <SplitLine title="Remaining split" categoryId={draft.secondCategoryId} amount={secondAmount} categories={categories} onCategory={(categoryId) => setDraft({ ...draft, secondCategoryId: categoryId })} />
        </div>
        <ModalFooter onClose={onClose} submitLabel="Save split" />
      </form>
    </div>
  );
}

function NoticeModal({ notice, onClose }: { notice: Notice; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/55 p-4 backdrop-blur-sm" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <section className="w-[min(440px,calc(100vw-2rem))] rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-5 shadow-soft">
        <ModalHeader title={notice.title} onClose={onClose} />
        <p className="text-sm font-bold leading-6 text-[var(--muted)]">{notice.message}</p>
        <div className="mt-6 flex justify-end">
          <Button onClick={onClose}>Got it</Button>
        </div>
      </section>
    </div>
  );
}

function SplitLine({ title, categoryId, amount, categories, onCategory, onAmount }: { title: string; categoryId: string; amount: number; categories: BudgetCategory[]; onCategory: (categoryId: string) => void; onAmount?: (amount: number) => void }) {
  return (
    <div className="grid gap-3 rounded-xl border border-[var(--line)] bg-[var(--surface-2)] p-3 md:grid-cols-[1fr_130px]">
      <Label title={title}>
        <select className="w-full rounded-xl border border-[var(--line)] bg-[var(--surface)] px-3 py-2 outline-none" value={categoryId} onChange={(event) => onCategory(event.target.value)}>
          {categories.map((category) => <option key={category.id} value={category.id}>{category.icon} {category.name}</option>)}
        </select>
      </Label>
      <Label title="Amount">
        <input className="w-full rounded-xl border border-[var(--line)] bg-[var(--surface)] px-3 py-2 outline-none" type="number" step="0.01" value={amount} readOnly={!onAmount} onChange={(event) => onAmount?.(Number(event.target.value))} />
      </Label>
    </div>
  );
}

function ModalHeader({ title, onClose }: { title: string; onClose: () => void }) {
  return (
    <div className="mb-5 flex items-center justify-between">
      <h2 className="text-lg font-black">{title}</h2>
      <button type="button" onClick={onClose}><X size={18} /></button>
    </div>
  );
}

function ModalFooter({ onClose, submitLabel }: { onClose: () => void; submitLabel: string }) {
  return (
    <div className="mt-6 flex justify-end gap-2">
      <Button variant="secondary" onClick={onClose}>Cancel</Button>
      <button className="rounded-full bg-[var(--pill)] px-4 py-2.5 text-sm font-black text-white" type="submit">{submitLabel}</button>
    </div>
  );
}

function Label({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <label className="grid gap-2 text-sm font-black text-[var(--muted)]">
      {title}
      {children}
    </label>
  );
}

function SettingsModal({
  activeTab,
  state,
  plaidStatus,
  plaidBusy,
  categories,
  setActiveTab,
  setState,
  onClose,
  onConnect,
  onUpdateConsent,
  onApplyRules,
  onOpenRule,
  onDeleteRule,
  onToggleRule
}: {
  activeTab: SettingsTab;
  state: FinanceState;
  plaidStatus: PlaidStatus | null;
  plaidBusy: boolean;
  categories: BudgetCategory[];
  setActiveTab: (tab: SettingsTab) => void;
  setState: (updater: (current: FinanceState) => FinanceState) => void;
  onClose: () => void;
  onConnect: () => void;
  onUpdateConsent: (item: { itemId: string; institution: string }) => void;
  onApplyRules: () => void;
  onOpenRule: (rule?: MerchantRule, pattern?: string) => void;
  onDeleteRule: (ruleId: string) => void;
  onToggleRule: (ruleId: string) => void;
}) {
  const [backups, setBackups] = useState<BackupItem[]>([]);
  const [backupBusy, setBackupBusy] = useState(false);
  const [backupMessage, setBackupMessage] = useState("");
  const latestBackup = backups[0];

  useEffect(() => {
    if (activeTab === "account") void refreshBackups();
  }, [activeTab]);

  async function refreshBackups() {
    try {
      const response = await fetch("/api/backups", { cache: "no-store" });
      if (!response.ok) return;
      const data = (await response.json()) as { backups?: BackupItem[] };
      setBackups(data.backups || []);
    } catch {
      setBackups([]);
    }
  }

  async function createLocalBackup() {
    setBackupBusy(true);
    setBackupMessage("");
    try {
      const response = await fetch("/api/backups", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "backup" })
      });
      if (!response.ok) throw new Error("Backup failed.");
      await refreshBackups();
      setBackupMessage("Backup saved locally.");
    } catch (error) {
      setBackupMessage(error instanceof Error ? error.message : "Backup failed.");
    } finally {
      setBackupBusy(false);
    }
  }

  async function restoreLatestBackup() {
    if (!latestBackup) {
      setBackupMessage("No backup is available yet.");
      return;
    }
    if (!window.confirm("Restore the latest local backup? This replaces the current local database.")) return;

    setBackupBusy(true);
    setBackupMessage("");
    try {
      const response = await fetch("/api/backups", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "restore-latest" })
      });
      if (!response.ok) throw new Error("Restore failed.");
      const dataResponse = await fetch("/api/app-data", { cache: "no-store" });
      if (dataResponse.ok) {
        const restoredState = (await dataResponse.json()) as FinanceState;
        setState((current) => ({
          ...restoredState,
          theme: current.theme,
          view: current.view,
          selectedAccountId: current.selectedAccountId
        }));
      }
      await refreshBackups();
      setBackupMessage("Latest backup restored.");
    } catch (error) {
      setBackupMessage(error instanceof Error ? error.message : "Restore failed.");
    } finally {
      setBackupBusy(false);
    }
  }

  const content = {
    general: (
      <div className="space-y-9">
        <SettingsSection title="Appearance">
          <SettingsRow title="Theme" description="Customize how Personal Finance looks">
            <div className="inline-flex rounded-xl bg-[var(--surface-2)] p-1">
              {(["light", "dark"] as const).map((theme) => (
                <button key={theme} className={`rounded-lg px-3 py-1.5 text-sm font-black ${state.theme === theme ? "bg-[var(--surface-3)] text-[var(--text)]" : "text-blue-300/80"}`} onClick={() => setState((current) => ({ ...current, theme }))}>
                  {theme === "light" ? "Light" : "Dark"}
                </button>
              ))}
            </div>
          </SettingsRow>
        </SettingsSection>
        <SettingsSection title="Budgeting">
          <SettingsRow title="Enable budgeting" description="Set monthly budgets for your categories"><Toggle enabled /></SettingsRow>
          <SettingsRow title="Enable rollover" description="Allow budgets to be spent across months"><Toggle enabled={false} /></SettingsRow>
        </SettingsSection>
        <SettingsSection title="Tags">
          <SettingsRow title="Manage tags" description="Use tags to group together any transactions">
            <button className="rounded-xl border border-[var(--line)] bg-[var(--surface-2)] px-3 py-2 text-sm font-black">0 tags</button>
          </SettingsRow>
        </SettingsSection>
      </div>
    ),
    connections: (
      <SettingsSection title="Connections" action={<button className="flex items-center gap-2 font-black text-blue-300" onClick={onConnect}><Plus size={16} /> New</button>}>
        <div className="space-y-3">
          <div className="grid gap-3 rounded-2xl border border-[var(--line)] bg-[var(--surface-2)] p-4 text-sm font-bold text-blue-200 md:grid-cols-4">
            <span>Plaid {plaidStatus?.configured ? "configured" : "not configured"}</span>
            <span>{plaidStatus?.env || "sandbox"}</span>
            <span>{plaidStatus?.transactionCount ?? 0} synced transactions</span>
            <span>{plaidStatus?.holdingCount ?? 0} holdings</span>
          </div>
          {plaidStatus?.items.length ? plaidStatus.items.map((institution) => (
            <div key={institution.itemId} className="flex w-full flex-wrap items-center justify-between gap-4 rounded-2xl p-2">
              <span className="flex min-w-0 items-center gap-3">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-blue-500/25 text-xs font-black text-blue-100">{institution.institution.slice(0, 2).toUpperCase()}</span>
                <span className="min-w-0">
                  <span className="block truncate font-black">{institution.institution}</span>
                  <span className="block text-sm font-bold text-blue-300/80">
                    {institution.accountCount} accounts {"\u2022"} {institution.investmentAccountCount} investment {"\u2022"} {institution.holdingCount} holdings
                  </span>
                </span>
              </span>
              <span className="flex flex-wrap items-center gap-2">
                <span className="shrink-0 text-sm font-bold text-blue-300">{formatStatusDate(institution.updatedAt)}</span>
                <button
                  type="button"
                  className="rounded-xl border border-blue-400/30 bg-blue-500/15 px-3 py-2 text-sm font-black text-blue-100 disabled:opacity-60"
                  disabled={plaidBusy}
                  onClick={() => onUpdateConsent({ itemId: institution.itemId, institution: institution.institution })}
                >
                  Update consent
                </button>
              </span>
            </div>
          )) : (
            <div className="rounded-2xl border border-dashed border-[var(--line)] bg-[var(--surface-2)] p-6 text-sm font-bold text-[var(--muted)]">
              No connected institutions yet.
            </div>
          )}
        </div>
      </SettingsSection>
    ),
    rules: (
      <SettingsSection
        title="Rules"
        action={(
          <div className="flex items-center gap-2">
            <button type="button" className="rounded-xl border border-[var(--line)] bg-[var(--surface-2)] px-3 py-2 text-sm font-black text-blue-200" onClick={onApplyRules}>
              Apply rules
            </button>
            <button type="button" className="flex items-center gap-2 rounded-xl border border-blue-400/30 bg-blue-500/15 px-3 py-2 text-sm font-black text-blue-100" onClick={() => onOpenRule()}>
              <Plus size={15} /> New rule
            </button>
          </div>
        )}
      >
        <div className="space-y-3">
          {state.rules.length ? state.rules.map((rule) => {
            const category = rule.categoryId ? categories.find((item) => item.id === rule.categoryId) : undefined;
            return (
              <div key={rule.id} className="rounded-2xl border border-[var(--line)] bg-[var(--surface-2)] p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate font-black">{rule.pattern}</div>
                    <div className="mt-1 text-sm font-bold text-blue-300/75">
                      If merchant {rule.matchType === "exact" ? "exactly matches" : "contains"} this text
                    </div>
                  </div>
                  <span className={`rounded-full border px-3 py-1 text-xs font-black ${rule.enabled ? "border-emerald-400/25 bg-emerald-500/15 text-emerald-100" : "border-slate-400/20 bg-slate-500/15 text-slate-300"}`}>
                    {rule.enabled ? "Enabled" : "Paused"}
                  </span>
                </div>
                <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                  <div className="flex flex-wrap items-center gap-2">
                    {rule.internal ? (
                      <span className="rounded-full border border-sky-400/25 bg-sky-500/15 px-3 py-1.5 text-xs font-black text-sky-100">
                        Internal transfer
                      </span>
                    ) : (
                      <span className="rounded-full border border-blue-400/25 bg-blue-500/15 px-3 py-1.5 text-xs font-black text-blue-100">
                        {category ? `${category.icon} ${category.name}` : "Uncategorized"}
                      </span>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <button type="button" className="rounded-full border border-[var(--line)] px-3 py-1.5 text-xs font-black text-[var(--muted)] hover:text-[var(--text)]" onClick={() => onToggleRule(rule.id)}>
                      {rule.enabled ? "Pause" : "Enable"}
                    </button>
                    <button type="button" className="rounded-full border border-[var(--line)] px-3 py-1.5 text-xs font-black text-[var(--muted)] hover:text-[var(--text)]" onClick={() => onOpenRule(rule)}>
                      Edit
                    </button>
                    <button type="button" className="rounded-full border border-red-400/25 px-3 py-1.5 text-xs font-black text-red-200" onClick={() => onDeleteRule(rule.id)}>
                      Delete
                    </button>
                  </div>
                </div>
              </div>
            );
          }) : (
            <div className="rounded-2xl border border-dashed border-[var(--line)] bg-[var(--surface-2)] p-6 text-sm font-bold text-[var(--muted)]">
              No merchant rules yet. Create one to automatically categorize repeat merchants like Walmart, Sheetz, or Chick-fil-A.
            </div>
          )}
        </div>
      </SettingsSection>
    ),
    account: (
      <div className="space-y-9">
        <SettingsSection title="Information">
          <SettingsRow title="Email"><span className="rounded-xl border border-[var(--line)] bg-[var(--surface-2)] px-3 py-2 text-sm font-black">micaiahm13@gmail.com</span></SettingsRow>
          <SettingsRow title="Export all transactions" description="Download a CSV file of your data">
            <button className="rounded-xl border border-[var(--line)] bg-[var(--surface-2)] px-3 py-2 text-sm font-black"><Download className="inline" size={14} /> Download</button>
          </SettingsRow>
        </SettingsSection>
        <SettingsSection title="Local backups">
          <SettingsRow title="Database backup" description={latestBackup ? `Latest ${formatStatusDate(latestBackup.modifiedAt)}` : "No backups yet"}>
            <div className="flex flex-wrap justify-start gap-2 md:justify-end">
              <button className="inline-flex items-center gap-2 rounded-xl border border-[var(--line)] bg-[var(--surface-2)] px-3 py-2 text-sm font-black disabled:opacity-60" disabled={backupBusy} onClick={createLocalBackup}>
                <Database size={14} /> Backup now
              </button>
              <button className="inline-flex items-center gap-2 rounded-xl border border-[var(--line)] bg-[var(--surface-2)] px-3 py-2 text-sm font-black disabled:opacity-60" disabled={backupBusy || !latestBackup} onClick={restoreLatestBackup}>
                <ArrowDownUp size={14} /> Restore latest
              </button>
            </div>
          </SettingsRow>
          {backupMessage ? (
            <div className="rounded-2xl border border-[var(--line)] bg-[var(--surface-2)] px-4 py-3 text-sm font-bold text-blue-200">{backupMessage}</div>
          ) : null}
        </SettingsSection>
      </div>
    ),
    subscription: (
      <SettingsSection title="Subscription">
        <SettingsRow title="Monthly" description="$13/month \u00b7 Renews Jul 1, 2026"><button className="rounded-xl border border-[var(--line)] bg-[var(--surface-2)] px-3 py-2 text-sm font-black">Change plan</button></SettingsRow>
        <SettingsRow title="Payment method" description="Subscribed through Apple App Store"><button className="rounded-xl border border-[var(--line)] bg-[var(--surface-2)] px-3 py-2 text-sm font-black">Manage payment</button></SettingsRow>
      </SettingsSection>
    ),
    about: (
      <SettingsSection title="About">
        <SettingsRow title="Personal Finance" description="Local-first Copilot-style money workspace"><span className="rounded-xl border border-[var(--line)] bg-[var(--surface-2)] px-3 py-2 text-sm font-black">v0.1.0</span></SettingsRow>
        <SettingsRow title="Plaid and OpenAI"><span className="rounded-xl border border-emerald-400/30 bg-emerald-400/10 px-3 py-2 text-sm font-black text-emerald-200">Configured</span></SettingsRow>
      </SettingsSection>
    )
  }[activeTab];

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/58 p-4 backdrop-blur-sm" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <section className="grid h-[min(680px,calc(100vh-2rem))] w-[min(880px,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--surface)] shadow-soft md:grid-cols-[250px_minmax(0,1fr)]">
        <aside className="border-b border-[var(--line)] bg-[color:color-mix(in_srgb,var(--surface)_94%,black_6%)] p-3 md:border-b-0 md:border-r">
          <div className="grid gap-1">
            {settingsTabs.map((tab) => {
              const Icon = tab.icon;
              return (
                <button key={tab.id} className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-left font-black transition ${activeTab === tab.id ? "bg-blue-400/22 text-blue-200" : "text-blue-300/75 hover:bg-[var(--surface-2)] hover:text-blue-200"}`} onClick={() => setActiveTab(tab.id)}>
                  <Icon size={17} />
                  {tab.label}
                </button>
              );
            })}
          </div>
        </aside>
        <main className="soft-scrollbar overflow-y-auto p-5 md:p-7">{content}</main>
      </section>
    </div>
  );
}

function SettingsSection({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section>
      <div className="mb-3 flex items-center justify-between gap-3 border-b border-[var(--line)] pb-3">
        <h2 className="font-black">{title}</h2>
        {action}
      </div>
      <div className="space-y-4">{children}</div>
    </section>
  );
}

function SettingsRow({ title, description, children }: { title: string; description?: string; children?: React.ReactNode }) {
  return (
    <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
      <div className="min-w-0">
        <div className="font-black">{title}</div>
        {description ? <div className="mt-1 text-sm font-bold text-blue-300/75">{description}</div> : null}
      </div>
      {children ? <div className="flex justify-start md:justify-end">{children}</div> : null}
    </div>
  );
}

function Toggle({ enabled }: { enabled: boolean }) {
  return (
    <span className={`flex h-5 w-9 items-center rounded-full p-0.5 ${enabled ? "justify-end bg-blue-500" : "justify-start bg-[var(--surface-2)]"}`}>
      <span className="h-4 w-4 rounded-full bg-white shadow-sm" />
    </span>
  );
}






