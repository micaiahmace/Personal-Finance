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

Use the installed Node.js/npm path if your normal shell still points at the Codex app shim.
The normal dev command now keeps the existing Next cache so everyday startup is faster:

```powershell
& "C:\Program Files\nodejs\npm.cmd" install
& "C:\Program Files\nodejs\npm.cmd" run dev
```

Then open:

```text
http://127.0.0.1:3000
```

If the app ever looks unstyled or frozen, keep the dev server running and check the Next assets from a second terminal:

```powershell
& "C:\Program Files\nodejs\npm.cmd" run doctor
```

If `doctor` fails, stop the dev server and restart with a clean cache:

```powershell
& "C:\Program Files\nodejs\npm.cmd" run dev:clean
```

Use `npm run repair` only when you want to clear `.next` without starting the app. Avoid running `npm run build` while the dev server is already running, because both commands write to `.next`.

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
- Plaid Link token, public token exchange, encrypted token storage, sync, webhook, and status routes.
- OpenAI categorization route skeleton for the AI Review flow.
- Prisma schema for the local database layer.

## Next Implementation Step

Connect the first real Plaid institution, confirm imported accounts and transactions, then tune merchant rules/category mapping with the live transaction set.

See [PLAID_IMPLEMENTATION_PLAN.md](./PLAID_IMPLEMENTATION_PLAN.md) for how Plaid data flows into the app.
