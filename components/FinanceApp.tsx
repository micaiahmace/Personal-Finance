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
import { categorySpent, goalCurrent, groupTotals, incomeTotal, monthsUntil, netWorth, percent, projectedDate, ruleMatches, totalBudget, totalSpent, usd, usdExact } from "@/lib/finance";
import { seedState } from "@/lib/seed-data";
import type { Account, AccountGroup, AiSuggestion, BudgetCategory, BudgetGroup, FinanceState, Goal, MerchantRule, Transaction, View } from "@/lib/types";

const UI_PREFS_KEY = "personal-finance-ui-v1";
const accountGroups: AccountGroup[] = ["Credit card", "Depository", "Investment", "Other"];
type SettingsTab = "general" | "connections" | "rules" | "account" | "subscription" | "about";

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
  categoryId: string;
  enabled: boolean;
};

type CategoryDraft = {
  id?: string;
  name: string;
  icon: string;
  budget: number;
  groupId: string;
};

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

type BulkMenu = "category" | "type" | "more" | null;

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

declare global {
  interface Window {
    Plaid?: {
      create: (config: PlaidLinkConfig) => PlaidLinkHandler;
    };
  }
}

function uid(prefix: string) {
  return `${prefix}-${crypto.randomUUID().slice(0, 8)}`;
}

function sortedGroups(state: FinanceState) {
  return [...state.groups].sort((a, b) => a.order - b.order);
}

function sortedCategories(state: FinanceState, groupId?: string) {
  return state.categories.filter((category) => !groupId || category.groupId === groupId).sort((a, b) => a.order - b.order);
}

function visibleView(view?: FinanceState["view"]): FinanceState["view"] {
  if (!view || view === "rules" || view === "ai") return "dashboard";
  return view;
}

function progressStyle(value: number, color: string) {
  return { "--progress": `${value}%`, "--bar": color } as CSSProperties;
}

function categoryLabel(category?: BudgetCategory) {
  return (category?.name || "Uncategorized").toUpperCase();
}

function categoryTone(category?: BudgetCategory) {
  const name = category?.name.toLowerCase() || "";
  if (name.includes("gas")) return "border-red-400/30 bg-red-500/20 text-red-200";
  if (name.includes("eating")) return "border-blue-400/30 bg-blue-500/20 text-blue-200";
  if (name.includes("groceries")) return "border-emerald-400/30 bg-emerald-500/20 text-emerald-100";
  if (name.includes("rent") || name.includes("loan") || name.includes("car")) return "border-rose-400/30 bg-rose-500/20 text-rose-100";
  return "border-blue-400/25 bg-blue-500/15 text-blue-100";
}

function accountSource(account?: Account) {
  return account ? `${account.name.split(" ")[0]} ${account.last4}` : "Unknown";
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

function groupTransactionsByMonth(transactions: Transaction[]) {
  return transactions.reduce<Array<{
    key: string;
    label: string;
    total: number;
    days: Array<{ date: string; transactions: Transaction[] }>;
  }>>((months, transaction) => {
    const monthKey = transaction.date.slice(0, 7);
    let month = months.find((item) => item.key === monthKey);

    if (!month) {
      month = {
        key: monthKey,
        label: formatTransactionMonth(transaction.date),
        total: 0,
        days: []
      };
      months.push(month);
    }

    if (!transaction.excluded && !transaction.internal && transaction.amount < 0) {
      month.total += Math.abs(transaction.amount);
    }

    let day = month.days.find((item) => item.date === transaction.date);
    if (!day) {
      day = { date: transaction.date, transactions: [] };
      month.days.push(day);
    }

    day.transactions.push(transaction);
    return months;
  }, []);
}

function parseLocalDate(value: string) {
  return new Date(`${value.slice(0, 10)}T00:00:00`);
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

export function FinanceApp() {
  const [state, setState] = useState<FinanceState>(seedState);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<SettingsTab>("general");
  const [ruleDraft, setRuleDraft] = useState<RuleDraft | null>(null);
  const [transactionDraft, setTransactionDraft] = useState<Transaction | null>(null);
  const [categoryDraft, setCategoryDraft] = useState<CategoryDraft | null>(null);
  const [splitDraft, setSplitDraft] = useState<SplitDraft | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [selectedTransactionIds, setSelectedTransactionIds] = useState<string[]>([]);
  const [bulkMenu, setBulkMenu] = useState<BulkMenu>(null);
  const [plaidBusy, setPlaidBusy] = useState(false);
  const [aiStatus, setAiStatus] = useState<AiStatus>({ ok: false, label: "AI checking" });

  const categoriesById = useMemo(() => new Map(state.categories.map((category) => [category.id, category])), [state.categories]);
  const accountsById = useMemo(() => new Map(state.accounts.map((account) => [account.id, account])), [state.accounts]);

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

  function commit(mutator: (draft: FinanceState) => void) {
    setState((current) => {
      const draft = structuredClone(current);
      mutator(draft);
      persistData(draft);
      return draft;
    });
  }

  function applyRules() {
    commit((draft) => {
      draft.transactions.forEach((transaction) => {
        draft.rules.forEach((rule) => {
          if (rule.enabled && ruleMatches(rule, transaction.name)) {
            transaction.categoryId = rule.categoryId;
            transaction.reviewed = true;
          }
        });
      });
    });
  }

  function approveHighConfidenceAi() {
    commit((draft) => {
      draft.aiInbox
        .filter((item) => item.confidence >= 0.9)
        .forEach((item) => {
          const transaction = draft.transactions.find((txn) => txn.id === item.transactionId);
          if (!transaction) return;
          if (item.internal) {
            transaction.internal = true;
            transaction.excluded = true;
          }
          if (item.categoryId) transaction.categoryId = item.categoryId;
          transaction.reviewed = true;
        });
      draft.aiInbox = draft.aiInbox.filter((item) => item.confidence < 0.9);
    });
  }

  function detectTransfers() {
    let count = 0;
    commit((draft) => {
      const expenses = draft.transactions.filter((transaction) => transaction.amount < 0);
      const deposits = draft.transactions.filter((transaction) => transaction.amount > 0);
      expenses.forEach((expense) => {
        deposits.forEach((deposit) => {
          const sameAmount = Math.abs(Math.abs(expense.amount) - deposit.amount) < 0.01;
          const differentAccount = expense.accountId !== deposit.accountId;
          const closeDate = Math.abs((new Date(expense.date).getTime() - new Date(deposit.date).getTime()) / 86400000) <= 3;
          if (sameAmount && differentAccount && closeDate) {
            expense.internal = true;
            deposit.internal = true;
            expense.excluded = true;
            deposit.excluded = true;
            count += 2;
          }
        });
      });
    });
    setNotice({
      title: "Transfer scan complete",
      message: `${count} transactions were marked as likely internal transfers.`
    });
  }

  function openRule(rule?: MerchantRule, pattern = "") {
    setRuleDraft({
      id: rule?.id,
      pattern: rule?.pattern || pattern,
      matchType: rule?.matchType || "contains",
      categoryId: rule?.categoryId || state.categories[0]?.id || "",
      enabled: rule?.enabled ?? true
    });
  }

  function saveRule(event: FormEvent) {
    event.preventDefault();
    if (!ruleDraft?.pattern || !ruleDraft.categoryId) return;
    commit((draft) => {
      if (ruleDraft.id) {
        const target = draft.rules.find((rule) => rule.id === ruleDraft.id);
        if (target) Object.assign(target, ruleDraft);
      } else {
        draft.rules.push({ id: uid("rule"), ...ruleDraft });
      }
    });
    setRuleDraft(null);
  }

  function editTransactionCategory(transaction: Transaction) {
    setTransactionDraft(transaction);
  }

  function splitTransaction(transaction: Transaction) {
    const category = sortedCategories(state)[0];
    if (!category || transaction.amount >= 0) return;
    const amount = Math.abs(transaction.amount);
    setSplitDraft({
      transaction,
      firstCategoryId: transaction.categoryId || category.id,
      firstAmount: Number((amount / 2).toFixed(2)),
      secondCategoryId: category.id
    });
  }

  async function connectModal() {
    if (plaidBusy) return;
    setPlaidBusy(true);

    try {
      const linkResponse = await fetch("/api/plaid/link-token", { method: "POST" });
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
            const exchangeResponse = await fetch("/api/plaid/exchange", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                publicToken,
                institution: metadata.institution?.name
              })
            });
            const exchangeData = await exchangeResponse.json();
            if (!exchangeResponse.ok) {
              throw new Error(exchangeData.error || "Unable to exchange Plaid token.");
            }

            const dataResponse = await fetch("/api/app-data");
            const nextData = (await dataResponse.json()) as FinanceState;
            setState((current) => ({
              ...nextData,
              theme: current.theme,
              view: current.view,
              selectedAccountId: current.selectedAccountId || nextData.accounts[0]?.id || ""
            }));
            setNotice({
              title: exchangeData.sync?.deferred ? "Account connected" : "Account synced",
              message: exchangeData.sync?.deferred
                ? "Plaid connected successfully. Transaction history may take a little longer, so use Sync again in a minute if accounts do not appear yet."
                : "Plaid connected successfully and synced the first batch of accounts and transactions."
            });
          } catch (error) {
            setNotice({
              title: "Plaid sync needs attention",
              message: error instanceof Error ? error.message : "Plaid connected, but the first sync did not finish."
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
              message: error.display_message || error.error_message || "Plaid exited before the account was connected."
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
      icon: category?.icon || "â€¢",
      budget: category?.budget || 0,
      groupId: category?.groupId || state.groups[0]?.id || ""
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

  function saveTransaction(transaction: Transaction) {
    commit((draft) => {
      const target = draft.transactions.find((item) => item.id === transaction.id);
      if (target) Object.assign(target, { ...transaction, reviewed: true });
    });
    setTransactionDraft(null);
  }

  function saveSplit(draft: SplitDraft) {
    const amount = Math.abs(draft.transaction.amount);
    if (draft.firstAmount <= 0 || draft.firstAmount >= amount) return;
    commit((stateDraft) => {
      const target = stateDraft.transactions.find((item) => item.id === draft.transaction.id);
      if (target) {
        target.splits = [
          { categoryId: draft.firstCategoryId, amount: draft.firstAmount },
          { categoryId: draft.secondCategoryId, amount: Number((amount - draft.firstAmount).toFixed(2)) }
        ];
        target.reviewed = true;
      }
    });
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

  function assignSelectedCategory(categoryId: string | null) {
    const selected = new Set(selectedTransactionIds);
    commit((draft) => {
      draft.transactions.forEach((transaction) => {
        if (selected.has(transaction.id)) {
          transaction.categoryId = categoryId;
          transaction.reviewed = true;
        }
      });
    });
    clearTransactionSelection();
  }

  function assignSelectedType(type: "transaction" | "transfer") {
    const selected = new Set(selectedTransactionIds);
    commit((draft) => {
      draft.transactions.forEach((transaction) => {
        if (selected.has(transaction.id)) {
          transaction.internal = type === "transfer";
          transaction.excluded = type === "transfer" ? true : false;
          transaction.reviewed = true;
        }
      });
    });
    clearTransactionSelection();
  }

  function deleteSelectedTransactions() {
    const selected = new Set(selectedTransactionIds);
    commit((draft) => {
      draft.transactions = draft.transactions.filter((transaction) => !selected.has(transaction.id));
      draft.aiInbox = draft.aiInbox.filter((item) => !selected.has(item.transactionId));
    });
    clearTransactionSelection();
  }

  const pageTitle = nav.find((item) => item.id === state.view)?.label || "Dashboard";
  const pageKicker = {
    dashboard: `${usd.format(totalBudget(state.categories) - totalSpent(state.transactions))} left this month`,
    transactions: `${state.transactions.filter((transaction) => !transaction.reviewed).length} need review`,
    accounts: `${state.accounts.length} account shells`,
    investments: `${usd.format(state.accounts.filter((account) => account.group === "Investment").reduce((sum, account) => sum + account.balance, 0))} invested`,
    categories: `${state.categories.length} spend categories`,
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
                    onClick={() => commit((draft) => {
                      draft.accountGroupsOpen[group] = !draft.accountGroupsOpen[group];
                    })}
                  >
                    <span className="flex items-center gap-2">{open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}{group}</span>
                    <span>{accounts.length}</span>
                  </button>
                  {open ? (
                    <div className="grid gap-1 pl-7">
                      {accounts.map((account) => (
                        <button key={account.id} className="rounded-lg px-2 py-2 text-left text-sm font-bold text-[var(--muted)] hover:bg-[var(--surface-2)] hover:text-[var(--text)]" onClick={() => setUi({ view: "accounts", selectedAccountId: account.id })}>
                          {account.name} {account.last4}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>

          <div className="mt-auto grid gap-2 border-t border-[var(--line)] p-3">
            <button className="rounded-xl px-3 py-3 text-left font-black text-[var(--orange)] hover:bg-[var(--surface-2)]" onClick={() => setUi({ view: "goals" })}>â–£ Start here</button>
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
                <button key={item.id} className={`whitespace-nowrap rounded-full px-4 py-2 text-sm font-black transition ${state.view === item.id ? "bg-gradient-to-r from-blue-500 to-sky-400 text-white shadow-soft" : "text-[var(--muted)] hover:bg-[var(--surface-2)]"}`} onClick={() => setUi({ view: item.id })}>
                  {item.label}
                </button>
              ))}
            </nav>
            <div className="flex items-center gap-2">
              <AiStatusPill status={aiStatus} />
              <Button variant="secondary" onClick={connectModal}><Database size={16} /> {plaidBusy ? "Connecting" : "Connect"}</Button>
              <IconButton label="Toggle theme" onClick={() => setUi({ theme: state.theme === "dark" ? "light" : "dark" })}>
                {state.theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
              </IconButton>
            </div>
          </header>
          <section className="px-4 py-6 pb-24 md:px-7">{pages[state.view]()}</section>
        </main>
      </div>

      {settingsOpen ? (
        <SettingsModal
          activeTab={settingsTab}
          state={state}
          categories={sortedCategories(state)}
          setActiveTab={setSettingsTab}
          setState={setState}
          onClose={() => setSettingsOpen(false)}
          onConnect={connectModal}
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
      {ruleDraft ? <RuleModal draft={ruleDraft} categories={sortedCategories(state)} setDraft={setRuleDraft} onClose={() => setRuleDraft(null)} onSave={saveRule} /> : null}
      {transactionDraft ? <TransactionModal transaction={transactionDraft} accounts={state.accounts} categories={sortedCategories(state)} onClose={() => setTransactionDraft(null)} onSave={saveTransaction} /> : null}
      {categoryDraft ? <CategoryModal draft={categoryDraft} groups={sortedGroups(state)} setDraft={setCategoryDraft} onClose={() => setCategoryDraft(null)} onSave={saveCategory} /> : null}
      {splitDraft ? <SplitModal draft={splitDraft} categories={sortedCategories(state)} setDraft={setSplitDraft} onClose={() => setSplitDraft(null)} onSave={saveSplit} /> : null}
      {notice ? <NoticeModal notice={notice} onClose={() => setNotice(null)} /> : null}
    </div>
  );

  function renderDashboard() {
    const budget = totalBudget(state.categories);
    const spent = totalSpent(state.transactions);
    const recurring = state.recurrences.reduce((sum, recurrence) => sum + recurrence.amount, 0);
    const monthlyIncome = incomeTotal(state.transactions);
    const monthlySaved = monthlyIncome - spent;
    const savingsRate = monthlyIncome > 0 ? Math.max(0, (monthlySaved / monthlyIncome) * 100) : 0;
    const savingsGrowth = monthlySaved;
    return (
      <div className="fade-in space-y-6">
        <div className="grid gap-6 xl:grid-cols-2">
          <Panel title="Monthly spending" action="Transactions" onAction={() => setUi({ view: "transactions" })}>
            <div className="grid min-h-72 place-items-center text-center">
              <div>
                <p className="text-4xl font-black">{usd.format(budget - spent)} left</p>
                <p className="mt-2 font-bold text-[var(--muted)]">{usd.format(budget)} budgeted</p>
                <LineChart values={[14, 14, 20, 22, 24, 29, 31, 34, 37]} color="var(--green)" />
              </div>
            </div>
          </Panel>
          <Panel title="Net worth" action="Accounts" onAction={() => setUi({ view: "accounts" })}>
            <div className="grid min-h-72 place-items-center text-center">
              <div>
                <p className="font-bold text-[var(--muted)]">Net worth</p>
                <p className="mt-1 text-4xl font-black">{usd.format(netWorth(state.accounts))}</p>
                <Chip tone="red">Down 10.59%</Chip>
                <LineChart values={[58, 58, 58, 55, 55, 55, 56, 56, 56]} color="#65aefc" secondValues={[42, 41, 41, 41, 42, 42, 42, 42]} secondColor="#ff8b54" />
              </div>
            </div>
          </Panel>
          <Panel title="Savings pulse" action="Goals" onAction={() => setUi({ view: "goals" })}>
            <div className="grid min-h-72 gap-4 md:grid-cols-2">
              <div className="rounded-3xl border border-emerald-400/20 bg-emerald-500/10 p-5">
                <div className="text-sm font-black text-emerald-200">Savings rate</div>
                <div className="mt-5 text-5xl font-black tracking-tight">{savingsRate.toFixed(1)}%</div>
                <div className="mt-2 text-sm font-bold text-[var(--muted)]">{usd.format(Math.max(0, monthlySaved))} saved from {usd.format(monthlyIncome)} income</div>
                <div className="mt-8 h-2 overflow-hidden rounded-full bg-[var(--surface-3)]">
                  <div className="h-full rounded-full bg-gradient-to-r from-emerald-400 to-cyan-300" style={{ width: `${Math.min(100, savingsRate)}%` }} />
                </div>
              </div>
              <div className="rounded-3xl border border-blue-400/20 bg-blue-500/10 p-5">
                <div className="text-sm font-black text-blue-200">Savings growth</div>
                <div className={`mt-5 text-5xl font-black tracking-tight ${savingsGrowth >= 0 ? "text-emerald-200" : "text-red-200"}`}>{savingsGrowth >= 0 ? "+" : ""}{usd.format(savingsGrowth)}</div>
                <div className="mt-2 text-sm font-bold text-[var(--muted)]">Net saved in the last month</div>
                <div className="mt-7 flex h-20 items-end gap-2 rounded-2xl bg-[var(--surface-2)] p-3">
                  {[34, 42, 38, 56, 62, 75, 84, 92].map((height, index) => (
                    <span key={height + index} className="flex-1 rounded-full bg-gradient-to-t from-blue-500 to-emerald-300 opacity-90" style={{ height: `${height}%` }} />
                  ))}
                </div>
              </div>
            </div>
          </Panel>
          <div className="space-y-6">
            <Panel title="Top categories" action="View all" onAction={() => setUi({ view: "categories" })}>{renderTopCategories()}</Panel>
            <Panel title="Next two weeks" action="Recurrings" onAction={() => setUi({ view: "recurrings" })}>
              <div className="space-y-3">{state.recurrences.slice(0, 3).map(renderRecurrenceRow)}</div>
            </Panel>
          </div>
        </div>
        <div className="grid gap-3 md:grid-cols-3">
          <Metric label="Cash flow" value={usd.format(incomeTotal(state.transactions) - spent)} tone="green" />
          <Metric label="Income" value={usd.format(incomeTotal(state.transactions))} tone="green" />
          <Metric label="Recurring expenses" value={usd.format(recurring)} tone="orange" />
        </div>
      </div>
    );
  }

  function renderTransactions() {
    const filtered = state.transactions
      .filter((transaction) => !state.categoryFilter || transaction.categoryId === state.categoryFilter || transaction.splits?.some((split) => split.categoryId === state.categoryFilter))
      .filter((transaction) => !state.search || `${transaction.name} ${transaction.merchant} ${transaction.note}`.toLowerCase().includes(state.search.toLowerCase()))
      .sort((a, b) => b.date.localeCompare(a.date));
    const grouped = groupTransactionsByMonth(filtered);
    const visibleTransactionIds = filtered.map((transaction) => transaction.id);

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
            {sortedCategories(state).map((category) => <option key={category.id} value={category.id}>{category.icon} {category.name}</option>)}
          </select>
        </div>
        {grouped.length ? (
          <div className="space-y-7">
            {grouped.map((month, monthIndex) => (
              <section key={month.key} className="space-y-3">
                {monthIndex > 0 ? (
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
            No transactions match this view.
          </div>
        )}
        {selectedTransactionIds.length ? (
          <BulkTransactionBar
            selectedCount={selectedTransactionIds.length}
            categories={sortedCategories(state)}
            openMenu={bulkMenu}
            setOpenMenu={setBulkMenu}
            onClear={clearTransactionSelection}
            onSelectAll={() => setSelectedTransactionIds(visibleTransactionIds)}
            onCategory={assignSelectedCategory}
            onType={assignSelectedType}
            onDelete={deleteSelectedTransactions}
          />
        ) : null}
      </div>
    );
  }

  function renderTransactionRow(transaction: Transaction) {
    const category = transaction.categoryId ? categoriesById.get(transaction.categoryId) : undefined;
    const account = accountsById.get(transaction.accountId);
    const review = state.aiInbox.find((item) => item.transactionId === transaction.id && item.confidence < 0.9);
    const selected = selectedTransactionIds.includes(transaction.id);
    return (
      <div key={transaction.id} className={`group grid grid-cols-[22px_minmax(0,1fr)_auto_auto] items-center gap-3 border-b border-[var(--line)] px-4 py-2.5 last:border-b-0 hover:bg-[var(--surface-2)] ${selected ? "bg-blue-500/18" : ""}`}>
        <input
          aria-label={`Select ${transaction.name}`}
          type="checkbox"
          className="h-3.5 w-3.5 rounded border-[var(--line)] bg-transparent"
          checked={selected}
          onChange={() => toggleTransactionSelection(transaction.id)}
        />
        <button className="min-w-0 text-left" onClick={() => editTransactionCategory(transaction)}>
          <span className="font-black">{transaction.name}</span>
          <span className="ml-2 font-bold text-blue-300/70">{accountSource(account)}</span>
          {transaction.internal ? <span className="ml-2 rounded-full bg-blue-500/15 px-2 py-0.5 text-xs font-black text-blue-200">INTERNAL</span> : null}
          {transaction.excluded ? <span className="ml-2 rounded-full bg-red-500/15 px-2 py-0.5 text-xs font-black text-red-200">EXCLUDED</span> : null}
          {review ? <span className="ml-2 rounded-full bg-amber-500/15 px-2 py-0.5 text-xs font-black text-amber-200">AI REVIEW</span> : null}
        </button>
        <button className={`rounded-full border px-3 py-1 text-xs font-black ${categoryTone(category)}`} onClick={() => editTransactionCategory(transaction)}>
          {category?.icon ? <span className="mr-1">{category.icon}</span> : null}{categoryLabel(category)}
        </button>
        <div className="flex items-center justify-end gap-3">
          <span className={`min-w-20 text-right font-black ${transaction.amount > 0 ? "text-[var(--green)]" : ""}`}>{usdExact.format(Math.abs(transaction.amount))}</span>
          <div className="hidden items-center gap-1 opacity-0 transition group-hover:flex group-hover:opacity-100">
            <IconButton label="Split" onClick={() => splitTransaction(transaction)}>â‘‚</IconButton>
            <IconButton label="Create rule" onClick={() => openRule(undefined, transaction.name)}><Flag size={14} /></IconButton>
            <IconButton label="Exclude" onClick={() => commit((draft) => {
              const target = draft.transactions.find((item) => item.id === transaction.id);
              if (target) target.excluded = !target.excluded;
            })}>âŠ˜</IconButton>
            <IconButton label="Internal transfer" onClick={() => commit((draft) => {
              const target = draft.transactions.find((item) => item.id === transaction.id);
              if (target) {
                target.internal = !target.internal;
                if (target.internal) target.excluded = true;
              }
            })}><ArrowDownUp size={14} /></IconButton>
          </div>
        </div>
      </div>
    );
  }

  function renderCategories() {
    return (
      <div className="fade-in">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-xl font-black">Budgets</h2>
          <Button onClick={() => openCategoryModal()}><Plus size={16} /> Category</Button>
        </div>
        <div className="space-y-4">{sortedGroups(state).map(renderBudgetGroup)}</div>
      </div>
    );
  }

  function renderBudgetGroup(group: BudgetGroup) {
    const totals = groupTotals(state, group.id);
    return (
      <section key={group.id} className="space-y-1">
        <div className="compact-panel grid gap-3 p-4 md:grid-cols-[minmax(220px,1.3fr)_90px_minmax(170px,.9fr)_90px_120px] md:items-center">
          <button className="flex items-center gap-2 text-left font-black" onClick={() => commit((draft) => {
            const target = draft.groups.find((item) => item.id === group.id);
            if (target) target.expanded = !target.expanded;
          })}>
            {group.expanded ? <ChevronDown size={16} style={{ color: group.color }} /> : <ChevronRight size={16} style={{ color: group.color }} />}
            {group.name}
          </button>
          <div className="text-right font-black">{usd.format(totals.spent)}</div>
          <Progress spent={totals.spent} budget={totals.budget} color={group.color} />
          <div className="text-right font-black">{usd.format(totals.budget)}</div>
          <div />
        </div>
        {group.expanded ? sortedCategories(state, group.id).map((category) => {
          const spent = categorySpent(state, category.id);
          return (
            <div key={category.id} className="grid gap-3 border-b border-[color:var(--line)] px-4 py-3 md:grid-cols-[minmax(220px,1.3fr)_90px_minmax(170px,.9fr)_90px_120px] md:items-center">
              <div className="flex min-w-0 items-center gap-3">
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: group.color }} />
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[var(--surface-2)]">{category.icon}</span>
                <span className="truncate font-bold">{category.name}</span>
              </div>
              <div className="text-right font-black">{usd.format(spent)}</div>
              <Progress spent={spent} budget={category.budget} color={spent > category.budget && category.budget > 0 ? "var(--red)" : "var(--lime)"} />
              <div className="text-right font-black">{usd.format(category.budget)}</div>
              <div className="flex justify-end gap-2">
                <IconButton label="Edit" onClick={() => openCategoryModal(category)}><Edit3 size={14} /></IconButton>
                <IconButton label="Delete" onClick={() => commit((draft) => {
                  draft.categories = draft.categories.filter((item) => item.id !== category.id);
                })}><Trash2 size={14} /></IconButton>
              </div>
            </div>
          );
        }) : null}
      </section>
    );
  }

  function renderAccounts() {
    const worth = netWorth(state.accounts);
    return (
      <div className="fade-in space-y-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-xl font-black">Accounts</h2>
          <button className="grid h-9 w-9 place-items-center rounded-full text-xl font-black text-blue-300 transition hover:bg-[var(--surface-2)]" onClick={connectModal} aria-label="Connect account">
            +
          </button>
        </div>
        <section className="premium-panel p-5">
          <div className="grid min-h-64 place-items-center text-center">
            <div className="w-full">
              <div className="text-sm font-black text-blue-300">Net worth</div>
              <div className="mt-1 text-3xl font-black tracking-tight">{usdExact.format(worth)}</div>
              <div className="mt-3"><Chip tone="red">Down 10.59%</Chip></div>
              <LineChart values={[42, 42, 42, 41, 40, 40, 40, 40, 41, 41]} color="#5ea7ff" secondValues={[28, 27, 27, 27, 27, 27, 28, 28, 28, 28]} secondColor="#ff8558" />
              <div className="mt-1 flex justify-center gap-8 text-sm font-black text-blue-300">
                {["1W", "1M", "3M", "YTD", "1Y", "ALL"].map((range, index) => (
                  <button key={range} className={`rounded-full px-3 py-1.5 ${index === 0 ? "bg-[var(--surface-2)] text-[var(--text)]" : ""}`}>{range}</button>
                ))}
              </div>
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
        <button className="flex items-center gap-2 text-left text-base font-black" onClick={() => commit((draft) => {
          draft.accountGroupsOpen[group] = !draft.accountGroupsOpen[group];
        })}>
          {state.accountGroupsOpen[group] ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
          {groupLabel}
        </button>
        <div className="overflow-hidden border-b border-[var(--line)] pb-3">
          {state.accountGroupsOpen[group] ? accounts.map((account, index) => renderAccountListRow(account, index)) : null}
          <div className="grid grid-cols-[minmax(0,1fr)_120px_90px_130px] items-center gap-6 px-1 py-4">
            <div />
            <div />
            <Chip tone={averageChange >= 0 ? "green" : "red"}>{averageChange >= 0 ? "•" : "?"} {Math.abs(averageChange).toFixed(2)}%</Chip>
            <div className="text-right font-black">{usdExact.format(total)}</div>
          </div>
        </div>
      </section>
    );
  }

  function renderAccountListRow(account: Account, index: number) {
    const positive = account.change >= 0;
    return (
      <button key={account.id} className={`grid w-full grid-cols-[minmax(0,1fr)_120px_90px_130px] items-center gap-6 rounded-xl px-1 py-3 text-left transition hover:bg-[var(--surface-2)] ${state.selectedAccountId === account.id ? "bg-[var(--selected-soft)]" : ""}`} onClick={() => setUi({ selectedAccountId: account.id })}>
        <div className="flex min-w-0 items-center gap-3">
          <AccountLogo account={account} />
          <div className="min-w-0">
            <div className="truncate font-black">{account.name} <span className="ml-2 font-bold text-blue-300/70">{account.last4}</span></div>
            <div className="text-sm font-bold text-blue-300/75">11 hours ago</div>
          </div>
        </div>
        <AccountSparkline values={accountSparkValues(account, index)} color={positive ? "var(--green)" : "var(--red)"} />
        <Chip tone={positive ? "green" : "red"}>{positive ? "•" : "?"} {Math.abs(account.change).toFixed(2)}%</Chip>
        <div className="text-right font-black">{usdExact.format(account.balance)}</div>
      </button>
    );
  }
  function renderInvestments() {
    const investments = state.accounts.filter((account) => account.group === "Investment");
    const total = investments.reduce((sum, account) => sum + account.balance, 0);
    return (
      <div className="fade-in space-y-6">
        <Panel title="Live balance estimate" action="Settings">
          <div className="grid min-h-72 place-items-center text-center">
            <div>
              <p className="text-4xl font-black">{usdExact.format(total)}</p>
              <Chip tone="green">Up 2.88%</Chip>
              <LineChart values={[32, 32, 32, 33, 33, 31, 55, 47, 41]} color="var(--green)" />
            </div>
          </div>
        </Panel>
        <div className="space-y-3">{investments.map((account) => (
          <div key={account.id} className="compact-panel grid gap-3 p-4 md:grid-cols-[1fr_auto_auto] md:items-center">
            <div className="font-black">{account.name} <span className="text-[var(--muted)]">{account.last4}</span></div>
            <Chip tone={account.change >= 0 ? "green" : "red"}>{account.change >= 0 ? "Up" : "Down"} {Math.abs(account.change)}%</Chip>
            <div className="font-black">{usdExact.format(account.balance)}</div>
          </div>
        ))}</div>
      </div>
    );
  }

  function renderRecurrings() {
    return (
      <div className="fade-in grid gap-6 xl:grid-cols-2">
        <Panel title="Recurring charges" action="Scan local">
          <div className="space-y-3">{state.recurrences.map(renderRecurrenceRow)}</div>
        </Panel>
        <Panel title="Monthly impact">
          <Metric label="Recurring total" value={usdExact.format(state.recurrences.reduce((sum, recurrence) => sum + recurrence.amount, 0))} tone="orange" />
          <div className="mt-5">{renderTopCategories()}</div>
        </Panel>
      </div>
    );
  }

  function renderRecurrenceRow(recurrence: { id: string; date: string; merchant: string; cadence: string; amount: number; categoryId: string }) {
    const category = categoriesById.get(recurrence.categoryId);
    return (
      <div key={recurrence.id} className="compact-panel grid gap-3 p-4 md:grid-cols-[1fr_auto] md:items-center">
        <div className="flex items-center gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-2xl bg-[var(--surface-2)]">{category?.icon || "â—·"}</span>
          <div>
            <div className="font-black">{recurrence.merchant} <span className="font-bold text-[var(--muted)]">{recurrence.cadence}</span></div>
            <div className="text-sm text-[var(--muted)]">{recurrence.date} â€¢ {category?.name || "Uncategorized"}</div>
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
          <Button onClick={() => setNotice({ title: "Heads up", message: "Goal form is next after live account sync." })}><Plus size={16} /> Goal</Button>
        </div>
        <div className="grid gap-3 md:grid-cols-3">
          <Metric label="Total saved" value={usdExact.format(totalSaved)} tone="green" />
          <Metric label="Total target" value={usdExact.format(target)} />
          <Metric label="Remaining" value={usdExact.format(Math.max(target - totalSaved, 0))} tone="orange" />
        </div>
        <div className="grid gap-6 xl:grid-cols-2">{state.goals.map(renderGoalCard)}</div>
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
            <div className="mt-2 text-sm font-bold text-[var(--muted)]">{account?.name || "No account assigned"} â€¢ {goal.status} â€¢ {goal.priority}</div>
          </div>
          <Chip tone={goal.status === "Active" ? "green" : "blue"}>{goal.status}</Chip>
        </div>
        <div className="mt-5"><Progress spent={current} budget={goal.targetAmount} color="var(--green)" /></div>
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
          const category = categoriesById.get(rule.categoryId);
          return (
            <div key={rule.id} className="compact-panel grid gap-3 p-4 md:grid-cols-[1fr_auto] md:items-center">
              <div>
                <div className="font-black">If transaction {rule.matchType === "exact" ? "exactly matches" : "contains"} &quot;{rule.pattern}&quot;</div>
                <div className="text-sm text-[var(--muted)]">Set category to {category ? `${category.icon} ${category.name}` : "Uncategorized"}</div>
              </div>
              <div className="flex items-center justify-end gap-2">
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
    return (
      <div className="space-y-2">
        {sortedGroups(state).map((group) => {
          const totals = groupTotals(state, group.id);
          return (
            <div key={group.id} className="grid gap-3 rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-3 md:grid-cols-[minmax(150px,1fr)_90px_minmax(160px,1fr)_90px] md:items-center">
              <div className="flex items-center gap-2 font-black"><ChevronRight size={14} style={{ color: group.color }} />{group.name}</div>
              <div className="text-right font-black">{usd.format(totals.spent)}</div>
              <Progress spent={totals.spent} budget={totals.budget} color={group.color} />
              <div className="text-right font-black">{usd.format(totals.budget)}</div>
            </div>
          );
        })}
      </div>
    );
  }
}

function LineChart({ values, color, secondValues, secondColor }: { values: number[]; color: string; secondValues?: number[]; secondColor?: string }) {
  const all = [...values, ...(secondValues ?? [])];
  const max = Math.max(...all);
  const min = Math.min(...all);
  const points = values.map((value, index) => `${(index / (values.length - 1)) * 100},${88 - ((value - min) / (max - min || 1)) * 72}`).join(" ");
  const second = secondValues?.map((value, index) => `${(index / (secondValues.length - 1)) * 100},${88 - ((value - min) / (max - min || 1)) * 72}`).join(" ");
  const endY = points.split(" ").at(-1)?.split(",")[1] ?? "50";

  return (
    <svg className="mt-7 h-28 w-full" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
      <polyline points={points} fill="none" stroke={color} strokeWidth="3" strokeLinecap="round" />
      {second ? <polyline points={second} fill="none" stroke={secondColor} strokeWidth="3" strokeLinecap="round" /> : null}
      <circle cx="100" cy={endY} r="2.1" fill="var(--surface)" stroke={color} strokeWidth="2" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function Progress({ spent, budget, color }: { spent: number; budget: number; color: string }) {
  const value = percent(spent, budget);
  return (
    <div className="progress-track" style={progressStyle(value, color)}>
      <span className={`progress-fill ${value > 100 ? "over" : ""}`} />
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
        {action ? <button className="font-black text-blue-300" onClick={onAction}>{action} â€º</button> : null}
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
  const label = account.name.slice(0, 1).toUpperCase();
  return (
    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-gradient-to-br from-sky-500 to-blue-950 text-sm font-black text-white shadow-soft">
      {label}
    </span>
  );
}

function AccountSparkline({ values, color }: { values: number[]; color: string }) {
  const max = Math.max(...values);
  const min = Math.min(...values);
  const points = values.map((value, index) => `${(index / (values.length - 1)) * 100},${34 - ((value - min) / (max - min || 1)) * 28}`).join(" ");
  const gradientId = `spark-${color.replace(/[^a-z0-9]/gi, "")}`;

  return (
    <svg className="h-10 w-28" viewBox="0 0 100 40" preserveAspectRatio="none" aria-hidden="true">
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
    <button title={label} aria-label={label} className="grid min-h-8 min-w-8 place-items-center rounded-full border border-[var(--line)] bg-[var(--surface-2)] px-2 text-xs font-black transition hover:-translate-y-0.5 hover:bg-[var(--surface-3)]" onClick={onClick}>
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
  onSelectAll,
  onCategory,
  onType,
  onDelete
}: {
  selectedCount: number;
  categories: BudgetCategory[];
  openMenu: BulkMenu;
  setOpenMenu: (menu: BulkMenu) => void;
  onClear: () => void;
  onSelectAll: () => void;
  onCategory: (categoryId: string | null) => void;
  onType: (type: "transaction" | "transfer") => void;
  onDelete: () => void;
}) {
  return (
    <div className="fixed inset-x-0 bottom-5 z-40 flex justify-center px-4">
      <div className="relative flex max-w-[calc(100vw-2rem)] items-center gap-2 rounded-2xl border border-[var(--line)] bg-[color:color-mix(in_srgb,var(--surface)_94%,black_6%)] p-2 shadow-soft backdrop-blur-xl">
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

        <div className="relative">
          <button type="button" className="grid h-9 min-w-10 place-items-center rounded-xl border border-[var(--line)] bg-[var(--surface-2)] px-3 text-sm font-black hover:bg-[var(--surface-3)]" onClick={() => setOpenMenu(openMenu === "more" ? null : "more")} aria-label="More bulk actions">
            ...
          </button>
          {openMenu === "more" ? (
            <div className="absolute bottom-12 right-0 w-44 rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-2 shadow-soft">
              <button type="button" className="w-full rounded-xl px-3 py-2 text-left text-sm font-black hover:bg-[var(--surface-2)]" onClick={onSelectAll}>
                Select all
              </button>
              <button type="button" className="w-full rounded-xl px-3 py-2 text-left text-sm font-black hover:bg-[var(--surface-2)]" onClick={onClear}>
                Unselect all
              </button>
              <button type="button" className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm font-black text-red-300 hover:bg-red-500/10" onClick={onDelete}>
                <Trash2 size={15} /> Delete
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function RuleModal({ draft, categories, setDraft, onClose, onSave }: { draft: RuleDraft; categories: BudgetCategory[]; setDraft: (draft: RuleDraft | null) => void; onClose: () => void; onSave: (event: FormEvent) => void }) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4 backdrop-blur-sm" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <form className="w-[min(520px,calc(100vw-2rem))] rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-5 shadow-soft" onSubmit={onSave}>
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-lg font-black">{draft.id ? "Edit rule" : "New rule"}</h2>
          <button type="button" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="grid gap-4">
          <Label title="Merchant text">
            <input className="w-full rounded-xl border border-[var(--line)] bg-[var(--surface-2)] px-3 py-2 outline-none" value={draft.pattern} onChange={(event) => setDraft({ ...draft, pattern: event.target.value })} />
          </Label>
          <Label title="Match type">
            <select className="w-full rounded-xl border border-[var(--line)] bg-[var(--surface-2)] px-3 py-2 outline-none" value={draft.matchType} onChange={(event) => setDraft({ ...draft, matchType: event.target.value as MerchantRule["matchType"] })}>
              <option value="exact">Exactly matches</option>
              <option value="contains">Contains</option>
            </select>
          </Label>
          <Label title="Category">
            <select className="w-full rounded-xl border border-[var(--line)] bg-[var(--surface-2)] px-3 py-2 outline-none" value={draft.categoryId} onChange={(event) => setDraft({ ...draft, categoryId: event.target.value })}>
              {categories.map((category) => <option key={category.id} value={category.id}>{category.icon} {category.name}</option>)}
            </select>
          </Label>
          <label className="flex items-center gap-3 font-black">
            <input type="checkbox" checked={draft.enabled} onChange={(event) => setDraft({ ...draft, enabled: event.target.checked })} />
            Enabled
          </label>
        </div>
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <button className="rounded-full bg-[var(--pill)] px-4 py-2.5 text-sm font-black text-white" type="submit">Save rule</button>
        </div>
      </form>
    </div>
  );
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
              {accounts.map((account) => <option key={account.id} value={account.id}>{account.name} {account.last4}</option>)}
            </select>
          </Label>
          <Label title="Category">
            <select className="w-full rounded-xl border border-[var(--line)] bg-[var(--surface-2)] px-3 py-2 outline-none" value={draft.categoryId || ""} onChange={(event) => setDraft({ ...draft, categoryId: event.target.value || null })}>
              <option value="">Uncategorized</option>
              {categories.map((category) => <option key={category.id} value={category.id}>{category.icon} {category.name}</option>)}
            </select>
          </Label>
          <div className="grid gap-3 rounded-xl border border-[var(--line)] bg-[var(--surface-2)] p-3">
            <label className="flex items-center gap-3 font-black"><input type="checkbox" checked={draft.excluded} onChange={(event) => setDraft({ ...draft, excluded: event.target.checked })} /> Exclude from spending</label>
            <label className="flex items-center gap-3 font-black"><input type="checkbox" checked={draft.internal} onChange={(event) => setDraft({ ...draft, internal: event.target.checked, excluded: event.target.checked ? true : draft.excluded })} /> Internal transfer</label>
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
  categories,
  setActiveTab,
  setState,
  onClose,
  onConnect,
  onApplyRules,
  onOpenRule,
  onDeleteRule,
  onToggleRule
}: {
  activeTab: SettingsTab;
  state: FinanceState;
  categories: BudgetCategory[];
  setActiveTab: (tab: SettingsTab) => void;
  setState: (updater: (current: FinanceState) => FinanceState) => void;
  onClose: () => void;
  onConnect: () => void;
  onApplyRules: () => void;
  onOpenRule: (rule?: MerchantRule, pattern?: string) => void;
  onDeleteRule: (ruleId: string) => void;
  onToggleRule: (ruleId: string) => void;
}) {
  const connectedInstitutions = [
    { name: "Capital One", linked: "Linked Apr 30, 2025", count: "12 accounts", icon: "CO" },
    { name: "Charles Schwab", linked: "Linked Apr 30, 2025", count: "2 accounts", icon: "CS" },
    { name: "Fidelity", linked: "Linked Jan 18, 2026", count: "2 accounts", icon: "FI" }
  ];

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
          {connectedInstitutions.map((institution) => (
            <button key={institution.name} className="flex w-full items-center justify-between gap-4 rounded-2xl p-2 text-left transition hover:bg-[var(--surface-2)]">
              <span className="flex min-w-0 items-center gap-3">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-blue-500/25 text-xs font-black text-blue-100">{institution.icon}</span>
                <span className="min-w-0">
                  <span className="block truncate font-black">{institution.name}</span>
                  <span className="block text-sm font-bold text-blue-300/80">{institution.linked}</span>
                </span>
              </span>
              <span className="shrink-0 text-sm font-bold text-blue-300">{institution.count} â€º</span>
            </button>
          ))}
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
            const category = categories.find((item) => item.id === rule.categoryId);
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
                  <span className="rounded-full border border-blue-400/25 bg-blue-500/15 px-3 py-1.5 text-xs font-black text-blue-100">
                    {category ? `${category.icon} ${category.name}` : "Uncategorized"}
                  </span>
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
      </div>
    ),
    subscription: (
      <SettingsSection title="Subscription">
        <SettingsRow title="Monthly" description="$13/month Â· Renews Jul 1, 2026"><button className="rounded-xl border border-[var(--line)] bg-[var(--surface-2)] px-3 py-2 text-sm font-black">Change plan</button></SettingsRow>
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





