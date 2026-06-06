import { DatabaseSync } from "node:sqlite";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const db = new DatabaseSync(join(root, "prisma", "dev.db"));

db.exec(`
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS "Account" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "plaidAccountId" TEXT,
  "plaidItemId" TEXT,
  "name" TEXT NOT NULL,
  "officialName" TEXT,
  "type" TEXT NOT NULL,
  "subtype" TEXT,
  "mask" TEXT,
  "currentBalance" REAL NOT NULL DEFAULT 0,
  "availableBalance" REAL,
  "isoCurrencyCode" TEXT,
  "isGoalAccount" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS "Account_plaidAccountId_key" ON "Account"("plaidAccountId");
CREATE INDEX IF NOT EXISTS "Account_plaidItemId_idx" ON "Account"("plaidItemId");
CREATE INDEX IF NOT EXISTS "Account_type_idx" ON "Account"("type");

CREATE TABLE IF NOT EXISTS "BudgetGroup" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "name" TEXT NOT NULL,
  "color" TEXT NOT NULL,
  "order" INTEGER NOT NULL DEFAULT 0,
  "expanded" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "BudgetCategory_groupId_idx" ON "BudgetCategory"("groupId");

CREATE TABLE IF NOT EXISTS "BudgetCategory" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "groupId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "icon" TEXT NOT NULL,
  "monthlyLimit" REAL NOT NULL DEFAULT 0,
  "order" INTEGER NOT NULL DEFAULT 0,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "BudgetCategory_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "BudgetGroup" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "Transaction" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "plaidTransactionId" TEXT,
  "accountId" TEXT NOT NULL,
  "categoryId" TEXT,
  "date" DATETIME NOT NULL,
  "name" TEXT NOT NULL,
  "merchantName" TEXT,
  "amount" REAL NOT NULL,
  "isoCurrencyCode" TEXT,
  "reviewed" BOOLEAN NOT NULL DEFAULT false,
  "excluded" BOOLEAN NOT NULL DEFAULT false,
  "internalTransfer" BOOLEAN NOT NULL DEFAULT false,
  "pending" BOOLEAN NOT NULL DEFAULT false,
  "note" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Transaction_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "Transaction_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "BudgetCategory" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "Transaction_plaidTransactionId_key" ON "Transaction"("plaidTransactionId");
CREATE INDEX IF NOT EXISTS "Transaction_accountId_date_idx" ON "Transaction"("accountId", "date");
CREATE INDEX IF NOT EXISTS "Transaction_categoryId_date_idx" ON "Transaction"("categoryId", "date");
CREATE INDEX IF NOT EXISTS "Transaction_date_idx" ON "Transaction"("date");
CREATE INDEX IF NOT EXISTS "Transaction_review_scan_idx" ON "Transaction"("pending", "excluded", "internalTransfer", "date");

CREATE TABLE IF NOT EXISTS "TransactionSplit" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "transactionId" TEXT NOT NULL,
  "categoryId" TEXT NOT NULL,
  "amount" REAL NOT NULL,
  CONSTRAINT "TransactionSplit_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "Transaction" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "TransactionSplit_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "BudgetCategory" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "TransactionSplit_transactionId_idx" ON "TransactionSplit"("transactionId");
CREATE INDEX IF NOT EXISTS "TransactionSplit_categoryId_idx" ON "TransactionSplit"("categoryId");

CREATE TABLE IF NOT EXISTS "MerchantRule" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "pattern" TEXT NOT NULL,
  "matchType" TEXT NOT NULL,
  "categoryId" TEXT,
  "internalTransfer" BOOLEAN NOT NULL DEFAULT false,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MerchantRule_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "BudgetCategory" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "MerchantRule_categoryId_idx" ON "MerchantRule"("categoryId");
CREATE INDEX IF NOT EXISTS "MerchantRule_enabled_createdAt_idx" ON "MerchantRule"("enabled", "createdAt");

CREATE TABLE IF NOT EXISTS "RecurringCharge" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "merchant" TEXT NOT NULL,
  "cadence" TEXT NOT NULL,
  "nextDate" DATETIME NOT NULL,
  "amount" REAL NOT NULL,
  "categoryId" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RecurringCharge_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "BudgetCategory" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "RecurringCharge_categoryId_idx" ON "RecurringCharge"("categoryId");
CREATE INDEX IF NOT EXISTS "RecurringCharge_nextDate_idx" ON "RecurringCharge"("nextDate");

CREATE TABLE IF NOT EXISTS "SavingsGoal" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "name" TEXT NOT NULL,
  "icon" TEXT NOT NULL,
  "targetAmount" REAL NOT NULL,
  "currentAmount" REAL NOT NULL DEFAULT 0,
  "targetDate" DATETIME NOT NULL,
  "accountId" TEXT,
  "priority" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'Active',
  "notes" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SavingsGoal_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "SavingsGoal_accountId_idx" ON "SavingsGoal"("accountId");
CREATE INDEX IF NOT EXISTS "SavingsGoal_status_idx" ON "SavingsGoal"("status");

CREATE TABLE IF NOT EXISTS "PlaidItem" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "itemId" TEXT NOT NULL,
  "accessToken" TEXT NOT NULL,
  "institution" TEXT,
  "cursor" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS "PlaidItem_itemId_key" ON "PlaidItem"("itemId");
`);

addColumnIfMissing(
  "MerchantRule",
  "internalTransfer",
  `ALTER TABLE "MerchantRule" ADD COLUMN "internalTransfer" BOOLEAN NOT NULL DEFAULT false`
);

relaxMerchantRuleCategory();

db.close();
console.log("SQLite tables are ready at prisma/dev.db");

function addColumnIfMissing(table, column, sql) {
  const columns = db.prepare(`PRAGMA table_info("${table}")`).all();
  if (columns.some((item) => item.name === column)) return;
  db.exec(sql);
}

function relaxMerchantRuleCategory() {
  const columns = db.prepare(`PRAGMA table_info("MerchantRule")`).all();
  const categoryColumn = columns.find((item) => item.name === "categoryId");
  const foreignKeys = db.prepare(`PRAGMA foreign_key_list("MerchantRule")`).all();
  const categoryKey = foreignKeys.find((item) => item.from === "categoryId");

  if (categoryColumn?.notnull === 0 && categoryKey?.on_delete === "SET NULL") return;

  db.exec(`
PRAGMA foreign_keys = OFF;

ALTER TABLE "MerchantRule" RENAME TO "MerchantRule_old";

CREATE TABLE "MerchantRule" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "pattern" TEXT NOT NULL,
  "matchType" TEXT NOT NULL,
  "categoryId" TEXT,
  "internalTransfer" BOOLEAN NOT NULL DEFAULT false,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MerchantRule_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "BudgetCategory" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

INSERT INTO "MerchantRule" ("id", "pattern", "matchType", "categoryId", "internalTransfer", "enabled", "createdAt", "updatedAt")
SELECT
  "id",
  "pattern",
  "matchType",
  CASE WHEN "categoryId" IN (SELECT "id" FROM "BudgetCategory") THEN "categoryId" ELSE NULL END,
  COALESCE("internalTransfer", false),
  "enabled",
  "createdAt",
  "updatedAt"
FROM "MerchantRule_old";

DROP TABLE "MerchantRule_old";

CREATE INDEX IF NOT EXISTS "MerchantRule_categoryId_idx" ON "MerchantRule"("categoryId");
CREATE INDEX IF NOT EXISTS "MerchantRule_enabled_createdAt_idx" ON "MerchantRule"("enabled", "createdAt");

PRAGMA foreign_keys = ON;
`);
}
