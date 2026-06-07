import type { FinanceState } from "@/lib/types";

export const seedState: FinanceState = {
  theme: "dark",
  view: "dashboard",
  selectedAccountId: "",
  search: "",
  categoryFilter: "",
  accountGroupsOpen: {
    "Credit card": false,
    Depository: false,
    Investment: false,
    Other: false
  },
  groups: [
    { id: "living", name: "Living Costs", color: "#d93532", order: 1, expanded: true },
    { id: "monthly", name: "Monthly's", color: "#398ff0", order: 2, expanded: true },
    { id: "lifestyle", name: "Lifestyle & Fun", color: "#a7dca8", order: 3, expanded: true },
    { id: "income", name: "Income", color: "#16dc72", order: 99, expanded: false }
  ],
  categories: [
    { id: "rent", groupId: "living", name: "Rent", icon: "🔑", budget: 1800, order: 1 },
    { id: "tithe", groupId: "living", name: "Tithe", icon: "⛪", budget: 200, order: 2 },
    { id: "car-payment", groupId: "living", name: "Car Payment", icon: "🚙", budget: 200, order: 3 },
    { id: "loans", groupId: "living", name: "Loans", icon: "💰", budget: 182, order: 4 },
    { id: "home-internet", groupId: "living", name: "Home Internet", icon: "📶", budget: 90, order: 5 },
    { id: "youtube-tv", groupId: "living", name: "YouTube TV", icon: "📺", budget: 88, order: 6 },
    { id: "gas", groupId: "living", name: "Gas", icon: "⛽", budget: 80, order: 7 },
    { id: "car-insurance", groupId: "living", name: "Car Insurance", icon: "🚗", budget: 0, order: 8 },
    { id: "renters-insurance", groupId: "living", name: "Renters Insurance", icon: "💸", budget: 0, order: 9 },
    { id: "eating-out", groupId: "monthly", name: "Eating out", icon: "🌮", budget: 275, order: 1 },
    { id: "groceries", groupId: "monthly", name: "Groceries", icon: "🛒", budget: 200, order: 2 },
    { id: "shopping", groupId: "monthly", name: "Shopping", icon: "🛍️", budget: 150, order: 3 },
    { id: "chatgpt-subs", groupId: "monthly", name: "ChatGPT Subs.", icon: "💸", budget: 100, order: 4 },
    { id: "hobbies", groupId: "monthly", name: "Hobbies", icon: "⛳", budget: 100, order: 5 },
    { id: "irregular", groupId: "monthly", name: "Irregular", icon: "🤷", budget: 100, order: 6 },
    { id: "pets", groupId: "monthly", name: "Pets", icon: "🦴", budget: 75, order: 7 },
    { id: "gifts", groupId: "lifestyle", name: "Gifts", icon: "🎁", budget: 0, order: 1 },
    { id: "income", groupId: "income", name: "Income", icon: "$", budget: 0, order: 1 }
  ],
  accounts: [],
  investmentHoldings: [],
  transactions: [],
  recurrences: [],
  goals: [],
  rules: [],
  aiInbox: []
};
