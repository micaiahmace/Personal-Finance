# Data safety model

This app is being built local-first. Real financial data should stay on this machine unless a feature explicitly needs a third-party API.

## Local data

- App data is stored in local SQLite.
- `.env` and `prisma/dev.db` are ignored by Git.
- Plaid access tokens must be stored server-side only.
- Plaid access tokens are encrypted before being written to SQLite.
- The app requires `APP_DATA_KEY` before it will save a real Plaid access token.

## AI data boundary

OpenAI should not receive:

- Plaid access tokens
- Plaid item IDs
- Account numbers or full masks
- Account balances
- Notes
- Full local database payloads

The AI categorization route sends sanitized merchant/category context by default:

- category ids and names
- merchant rule patterns
- transaction id
- date
- merchant/name
- inflow/outflow direction

Exact transaction amounts are not shared unless `AI_SHARE_TRANSACTION_AMOUNTS=true` is set in `.env`.

## Before connecting real accounts

Confirm these are true:

- `APP_DATA_KEY` is set in `.env`.
- `PLAID_ENV` is set intentionally.
- `.env` is not committed.
- Plaid exchange stores encrypted tokens and does not return access tokens to the browser.
- AI categorization uses the sanitized payload boundary.
