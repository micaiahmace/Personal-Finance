# Personal Finance

A local-first personal finance app inspired by Copilot Money's clean budgeting workflow, with stronger savings goals and foundations for Plaid + OpenAI.

## Stack

- Next.js
- TypeScript
- Tailwind CSS
- Prisma
- SQLite for local-first storage
- Plaid SDK for account and transaction sync
- OpenAI SDK for AI categorization

## Run Locally

Use the installed Node.js/npm path if your normal shell still points at the Codex app shim:

```powershell
& "C:\Program Files\nodejs\npm.cmd" install
& "C:\Program Files\nodejs\npm.cmd" run dev
```

Then open:

```text
http://127.0.0.1:3000
```

## Environment

Keep real secrets in `.env`. That file is ignored by Git.

```env
DATABASE_URL="file:./dev.db"
OPENAI_API_KEY=
OPENAI_MODEL=gpt-4o-mini
PLAID_CLIENT_ID=
PLAID_SECRET=
PLAID_ENV=production
```

## Current Scope

- Local seeded accounts, categories, transactions, recurrences, goals, AI review items, and merchant rules.
- Copilot-style dashboard, category budget screen, transactions, accounts, recurring charges, goals, AI Review, and rules.
- Category add/edit/delete/reorder.
- Transaction edit, category changes, split support, excluded flag, and internal transfer flag.
- Goal create/edit/pause/complete and account-linked progress.
- Plaid route skeletons for Link token and public token exchange.
- OpenAI categorization route skeleton for the AI Review flow.
- Prisma schema for the local database layer.

## Next Implementation Step

Run Prisma migration, then replace the browser-local seeded data with SQLite-backed data. After that, wire Plaid Link on the frontend and store Plaid accounts/transactions through Prisma.
