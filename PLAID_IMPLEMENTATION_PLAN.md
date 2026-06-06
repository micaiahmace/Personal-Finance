# Plaid implementation plan

This app now has the server-side foundation for Plaid: Link token creation, public token exchange, encrypted access token storage, manual sync, webhook sync, and a safe status endpoint.

## Connection flow

1. The frontend asks `POST /api/plaid/link-token` for a Link token.
2. Plaid Link opens in the browser and returns a short-lived `public_token`.
3. The app sends that token to `POST /api/plaid/exchange`.
4. The server exchanges it for a Plaid access token, encrypts it with `APP_DATA_KEY`, and saves it in `PlaidItem`.
5. The server immediately tries an initial sync with `syncPlaidItem`.
6. The browser refreshes `/api/plaid/status` and `/api/app-data` so the new institution, accounts, and transactions show up.

Access tokens stay server-side. `/api/plaid/status` reports counts and institution names only.

## Plaid data mapping

Plaid account records become app `Account` rows:

- `account_id` -> `plaidAccountId`
- Plaid item id -> `plaidItemId`
- `name` and `official_name` -> app display names
- `type` and `subtype` -> app account group/subtype
- `balances.current` and `balances.available` -> app balances
- `mask` -> last-digits display only

Plaid transaction records become app `Transaction` rows:

- `transaction_id` -> `plaidTransactionId`
- `account_id` -> matching local `Account`
- `date` -> local transaction date
- `name` and `merchant_name` -> display/search fields
- `amount` -> app amount using app convention
- `pending` -> pending flag
- Plaid personal finance category -> category fallback signal

Plaid treats card/debit spending as a positive number. The app stores money out as negative and money in as positive, so sync normalizes amounts with `normalizePlaidAmount`.

## Categorization strategy

Imported transactions are categorized in this order:

1. Existing manual edits win. If the user already reviewed, split, excluded, marked transfer, or noted a transaction, sync keeps that choice.
2. Merchant rules run next. These are the most reliable way to make repeated merchants land in the right category.
3. Plaid personal finance category and merchant keywords are used as a fallback.
4. Anything still uncertain remains available for AI Review/manual review.

This keeps automatic sync useful without trampling user edits.

## Transfers and recurring charges

After sync finishes for an item, the app runs cleanup passes:

- Internal transfers are matched by opposite amounts, nearby dates, different accounts, and transfer-like merchant names. Matched transfers are marked reviewed, internal, and excluded from budget spending.
- Recurring charges are inferred from repeated merchant and amount patterns with roughly monthly spacing.

These passes run once after the full Plaid sync instead of once per transaction page, which keeps large imports from bogging down.

## Sync paths

The app can sync Plaid data from three places:

- Initial connect: `POST /api/plaid/exchange`
- Manual refresh: `POST /api/plaid/sync`
- Plaid webhook: `POST /api/plaid/webhook`

Plaid's transaction cursor is saved on `PlaidItem.cursor`, so future syncs ask Plaid only for added, modified, and removed transactions instead of downloading everything again.

## Before connecting real accounts

Confirm `.env` has:

```env
APP_DATA_KEY=
PLAID_CLIENT_ID=
PLAID_SECRET=
PLAID_ENV=production
```

`APP_DATA_KEY` should be a long random value. If it is missing, the app refuses to store a real Plaid access token.

## Next build steps

1. Connect one institution and inspect the first imported accounts.
2. Review the first transaction batch and create merchant rules for common merchants.
3. Add a visible sync progress/error surface so Plaid failures are obvious in the UI.
4. Add transaction pagination or virtualized rows before importing years of history.
5. Add background sync scheduling once the local manual sync path is proven.
