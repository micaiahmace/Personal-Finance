import type { FinanceState } from "@/lib/types";

export const seedState: FinanceState = {
  theme: "dark",
  view: "dashboard",
  selectedAccountId: "checking",
  search: "",
  categoryFilter: "",
  accountGroupsOpen: {
    "Credit card": false,
    Depository: true,
    Investment: false,
    Other: false
  },
  groups: [
    { id: "living", name: "Living Costs", color: "#d93532", order: 1, expanded: true },
    { id: "monthly", name: "Monthly's", color: "#398ff0", order: 2, expanded: true },
    { id: "lifestyle", name: "Lifestyle & Fun", color: "#a7dca8", order: 3, expanded: true }
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
    { id: "gifts", groupId: "lifestyle", name: "Gifts", icon: "🎁", budget: 0, order: 1 }
  ],
  accounts: [
    { id: "checking", group: "Depository", name: "PNC Virtual Wallet", subtype: "Checking", last4: "1032", balance: 5260.44, available: 5112.18, change: 2.6 },
    { id: "emergency", group: "Depository", name: "Emergency Savings", subtype: "Savings", last4: "8821", balance: 3450, available: 3450, change: 5.8 },
    { id: "apple-card", group: "Credit card", name: "Apple Card", subtype: "Credit card", last4: "9441", balance: -842.2, available: 4157.8, change: -1.2 },
    { id: "ey-retirement", group: "Investment", name: "Ernst & Young Retirement Savings Plan", subtype: "401k", last4: "6964", balance: 2972.96, available: 2972.96, change: 15.96 },
    { id: "roth-ira", group: "Investment", name: "Roth Contributory IRA", subtype: "IRA", last4: "4032", balance: 2735.17, available: 2735.17, change: -2.5 },
    { id: "individual", group: "Investment", name: "Individual", subtype: "Brokerage", last4: "6717", balance: 4265.76, available: 4265.76, change: -1.36 }
  ],
  transactions: [
    { id: "t1", date: "2026-06-01", name: "Rent", merchant: "Rent", amount: -1817, accountId: "checking", categoryId: "rent", reviewed: true, excluded: false, internal: false, note: "" },
    { id: "t2", date: "2026-06-02", name: "Tithe", merchant: "Church Giving", amount: -200, accountId: "checking", categoryId: "tithe", reviewed: true, excluded: false, internal: false, note: "" },
    { id: "t3", date: "2026-06-03", name: "Pnc Bank, National Association", merchant: "PNC Auto Loan", amount: -200, accountId: "checking", categoryId: "car-payment", reviewed: true, excluded: false, internal: false, note: "" },
    { id: "t4", date: "2026-06-05", name: "Dept Education", merchant: "Dept Education", amount: -182.4, accountId: "checking", categoryId: "loans", reviewed: true, excluded: false, internal: false, note: "" },
    { id: "t5", date: "2026-06-05", name: "Verizon", merchant: "Verizon", amount: -89.99, accountId: "checking", categoryId: "home-internet", reviewed: true, excluded: false, internal: false, note: "" },
    { id: "t6", date: "2026-06-04", name: "YouTube TV", merchant: "YouTube TV", amount: -87.99, accountId: "apple-card", categoryId: "youtube-tv", reviewed: true, excluded: false, internal: false, note: "" },
    { id: "t7", date: "2026-06-06", name: "Chick-fil-A", merchant: "Chick-fil-A", amount: -21.42, accountId: "apple-card", categoryId: "eating-out", reviewed: false, excluded: false, internal: false, note: "" },
    { id: "t8", date: "2026-06-06", name: "Walmart Supercenter", merchant: "Walmart", amount: -10.15, accountId: "checking", categoryId: "groceries", reviewed: false, excluded: false, internal: false, note: "" },
    { id: "t9", date: "2026-06-07", name: "Transfer to Emergency Savings", merchant: "PNC Transfer", amount: -500, accountId: "checking", categoryId: null, reviewed: false, excluded: true, internal: true, note: "Likely internal transfer" },
    { id: "t10", date: "2026-06-07", name: "Transfer from Checking", merchant: "PNC Transfer", amount: 500, accountId: "emergency", categoryId: null, reviewed: false, excluded: true, internal: true, note: "Likely internal transfer" },
    { id: "t11", date: "2026-06-08", name: "Payroll Deposit", merchant: "Payroll", amount: 2450, accountId: "checking", categoryId: null, reviewed: true, excluded: false, internal: false, note: "" },
    { id: "t12", date: "2026-06-09", name: "ChatGPT Subscription", merchant: "OpenAI", amount: -20, accountId: "apple-card", categoryId: "chatgpt-subs", reviewed: false, excluded: false, internal: false, note: "" }
  ],
  recurrences: [
    { id: "r1", date: "Jun 11th", merchant: "Dept Education", cadence: "Monthly", amount: 182.4, categoryId: "loans" },
    { id: "r2", date: "Jun 11th", merchant: "Verizon", cadence: "Monthly", amount: 89.99, categoryId: "home-internet" },
    { id: "r3", date: "Jun 18th", merchant: "Pnc Bank, National Association", cadence: "Monthly", amount: 200, categoryId: "car-payment" },
    { id: "r4", date: "Jun 28th", merchant: "YouTube TV", cadence: "Monthly", amount: 87.99, categoryId: "youtube-tv" }
  ],
  goals: [
    { id: "goal-emergency", name: "Emergency Fund", icon: "🛟", targetAmount: 10000, currentAmount: 3450, targetDate: "2026-12-31", accountId: "emergency", priority: "High", notes: "Synced to Emergency Savings.", status: "Active" },
    { id: "goal-trip", name: "Vacation Buffer", icon: "✈️", targetAmount: 2500, currentAmount: 640, targetDate: "2026-10-15", accountId: "checking", priority: "Medium", notes: "Keep flexible until real goal account is assigned.", status: "Paused" }
  ],
  rules: [
    { id: "rule-walmart", pattern: "Walmart", matchType: "contains", categoryId: "groceries", enabled: true },
    { id: "rule-chickfila", pattern: "Chick-fil-A", matchType: "exact", categoryId: "eating-out", enabled: true },
    { id: "rule-youtube", pattern: "YouTube TV", matchType: "contains", categoryId: "youtube-tv", enabled: true }
  ],
  aiInbox: [
    { id: "ai1", transactionId: "t8", categoryId: "groceries", confidence: 0.91, reason: "Walmart usually maps to Groceries." },
    { id: "ai2", transactionId: "t12", categoryId: "chatgpt-subs", confidence: 0.88, reason: "OpenAI looks like ChatGPT Subs." },
    { id: "ai3", transactionId: "t9", internal: true, confidence: 0.97, reason: "Matching transfer pair found between connected accounts." }
  ]
};
