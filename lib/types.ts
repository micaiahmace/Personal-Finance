export type Theme = "dark" | "light";

export type View =
  | "dashboard"
  | "transactions"
  | "accounts"
  | "investments"
  | "categories"
  | "recurrings"
  | "goals"
  | "ai"
  | "rules";

export type BudgetGroup = {
  id: string;
  name: string;
  color: string;
  order: number;
  expanded: boolean;
};

export type BudgetCategory = {
  id: string;
  groupId: string;
  name: string;
  icon: string;
  budget: number;
  order: number;
};

export type AccountGroup = "Credit card" | "Depository" | "Investment" | "Other";

export type Account = {
  id: string;
  group: AccountGroup;
  name: string;
  officialName?: string;
  subtype: string;
  last4: string;
  balance: number;
  available: number;
  change: number;
};

export type Split = {
  categoryId: string;
  amount: number;
};

export type Transaction = {
  id: string;
  date: string;
  name: string;
  merchant: string;
  amount: number;
  accountId: string;
  categoryId: string | null;
  reviewed: boolean;
  excluded: boolean;
  internal: boolean;
  note: string;
  splits?: Split[];
};

export type Recurrence = {
  id: string;
  date: string;
  nextDate?: string;
  merchant: string;
  cadence: string;
  amount: number;
  categoryId: string;
};

export type GoalStatus = "Active" | "Paused" | "Completed" | "Archived";
export type GoalPriority = "High" | "Medium" | "Low";

export type Goal = {
  id: string;
  name: string;
  icon: string;
  targetAmount: number;
  currentAmount: number;
  targetDate: string;
  accountId: string;
  priority: GoalPriority;
  notes: string;
  status: GoalStatus;
};

export type MerchantRule = {
  id: string;
  pattern: string;
  matchType: "exact" | "contains";
  categoryId: string | null;
  internal: boolean;
  enabled: boolean;
};

export type AiSuggestion = {
  id: string;
  transactionId: string;
  categoryId?: string;
  internal?: boolean;
  confidence: number;
  reason: string;
};

export type FinanceState = {
  theme: Theme;
  view: View;
  selectedAccountId: string;
  search: string;
  categoryFilter: string;
  accountGroupsOpen: Record<AccountGroup, boolean>;
  groups: BudgetGroup[];
  categories: BudgetCategory[];
  accounts: Account[];
  transactions: Transaction[];
  recurrences: Recurrence[];
  goals: Goal[];
  rules: MerchantRule[];
  aiInbox: AiSuggestion[];
};
