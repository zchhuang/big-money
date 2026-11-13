# Plaid Infrastructure

This fork adds an opt-in Plaid module to Actual's existing local sync server.
It uses the official `plaid` Node SDK (the supported `plaid/legacy` interface),
the existing authenticated sessions, and SQLite migrations. No additional cloud
application or database is required. Plaid itself remains an external service.

## Local Setup

Run from the repository root with Node 24+:

```sh
node .yarn/releases/yarn-4.17.1.cjs install --immutable
node bin/setup-plaid.mjs
```

The setup command creates `.env.plaid` with an independent random 256-bit
storage key and owner-only permissions. It preserves existing configuration.
Add your Sandbox client ID and secret from the [Plaid Dashboard](https://dashboard.plaid.com/),
and set `PLAID_ENABLED=true`. Do not paste credentials into chat, frontend code,
or Git. Sandbox uses simulated accounts; Production requires Plaid product access.

Start both the local web app and sync server:

```sh
node --env-file=.env.plaid .yarn/releases/yarn-4.17.1.cjs start:server-dev
```

Open `http://127.0.0.1:5006`, set an Actual server password, and create/upload a
budget to the server. The initial local-only budget mode is not sufficient for
these server routes. Server storage lives in `.local-data/`. The frontend dev
server also runs on port 3001; use port 5006 for the same-origin server endpoints.

## Guided Sandbox Kickoff

For first-time credential setup, run this repeatable wizard from the repository root:

```sh
bash bin/setup-plaid-sandbox.sh
```

Sign in or create a developer account in the Plaid Dashboard, then open its
API Keys section and copy `client_id` and the **Sandbox** secret into the hidden
terminal prompts. The wizard initializes this checkout's local storage and
preserves any existing encryption key. It keeps the integration disabled until
validation succeeds. It refuses to overwrite a Production environment.

The check creates a Hosted Link token and a disposable synthetic bank Item,
exchanges its public token, reads accounts and an initial transaction page,
and removes the Item. Its output contains counts and safe error codes, not
credentials. An initially empty transaction page can mean history is preparing.
This does not test browser completion, institution-specific OAuth, Fidelity
access, or Production permissions, and it does not import into your budget.

Run the check again independently:

```sh
node --env-file=.env.plaid .yarn/releases/yarn-4.17.1.cjs workspace @actual-app/sync-server plaid:check
```

The command rejects Production before contacting it and attempts cleanup if
retrieval fails after exchange. If cleanup itself fails, inspect temporary Items
in your Plaid Dashboard. After the wizard succeeds, start or restart the server
with the configured environment; an already-running server does not reload keys.
Each worktree has its own ignored `.env.plaid` and local storage. Coordinate the
server port when running more than one checkout.

Use `user_good` / `pass_good` when the Sandbox Link flow asks for test bank
credentials. Sandbox does not require your real bank login. Sources:
[Plaid Quickstart](https://plaid.com/docs/quickstart/) and
[Sandbox overview](https://plaid.com/docs/sandbox/).

## Connection Flow

All routes below are under `/plaid`. Supply `X-Actual-Token` with an existing
Actual session token and `X-Actual-File-Id` with a server budget file ID. This
is the file ID, not the budget's sync/group ID. Every operation checks access to
an active file; Items are scoped to that file and environment. Link sessions are
also bound to the initiating user. This initial implementation targets one local
server process, not a replicated deployment.

1. `GET /status` reports configuration and enabled product lists (session required;
   this route alone does not require a file ID).
2. `POST /link` with `{}` creates a Link token, a persisted session, and a Hosted
   Link URL. Open the returned `data.url` in your browser. We use Hosted Link so
   no new app UI or iframe/CSP changes are required for initial setup.
3. After success, `POST /sessions/<sessionId>/complete` with `{}`. The server
   obtains the one-time public token directly from Plaid for this session,
   exchanges it, encrypts the access token, and retrieves Item/account data.
   HTTP 409 means Link is still pending; retry after the session completes.
4. `GET /items` lists connection metadata, consented/available products, and status.
5. Reconnect with `POST /link` and `{"itemId":"..."}`, then complete that session.
   Update mode keeps the existing access token. Adding new product permissions
   to an existing Item is a separate future consent flow.
6. `DELETE /items/<itemId>` revokes the Item at Plaid before deleting its local
   credentials and records. Disconnect before deleting an entire budget; deleting
   local data alone does not cancel Plaid product billing.

The client never receives long-lived Plaid access tokens. Link tokens and Hosted
Link URLs are short-lived credentials and must not be logged or shared.

### Connecting Different Financial Institutions

The default Link flow requires Transactions and makes Investments/Liabilities
optional. This avoids requiring every institution to support every product.
For investment-only brokerages, use `POST /link` with `{"product":"investments"}`.
For a debt-specific connection, use `{"product":"liabilities"}`. A selected
product must be in the configured required or optional product lists.
There are no checking-only account filters: account types/subtypes, currencies,
and nullable/unknown fields are preserved from Plaid.

`PLAID_COUNTRY_CODES` selects permitted countries. Availability still depends on
institution, country, account, consent, and your Plaid agreement. Configure a
registered HTTPS `PLAID_REDIRECT_URI` for institutions that require OAuth. The
Hosted Link URL is not a substitute for registering required OAuth redirects.

## Data Retrieval and Models

| Route                                             | Persisted data                                                            |
| ------------------------------------------------- | ------------------------------------------------------------------------- |
| `POST /items/:id/accounts`                        | Full account/balance snapshot (cached Plaid balances)                     |
| `POST /items/:id/transactions`                    | Incremental additions, modifications, removals, and cursor                |
| `POST /items/:id/snapshot/investments`            | Holdings and securities snapshot                                          |
| `POST /items/:id/investment-transactions`         | Investment activity for body `{startDate,endDate}` in `YYYY-MM-DD` format |
| `POST /items/:id/snapshot/liabilities`            | Credit, mortgage, and student loan detail                                 |
| `POST /items/:id/snapshot/auth`                   | Bank account/routing-number data, only if configured/consented            |
| `POST /items/:id/snapshot/identity`               | Account-owner identity data, only if configured/consented                 |
| `GET /items/:id/records/:kind?limit=100&offset=0` | Stored records (maximum page size 500)                                    |

Record kinds are `account`, `transaction`, `security`, `holding`,
`investment_transaction`, `liability`, `auth`, and `identity`. TypeScript models
use Plaid's full product schemas. Auth and Identity are disabled by the default
product allowlist; explicitly configure them before using those endpoints.
Plaid **Auth** means bank account verification; **Link** handles bank login.

`plaid_items` stores encrypted credentials and metadata, environment, state,
transaction cursor, and a concurrency revision. `plaid_records` indexes Item,
record kind, provider record ID, and optional account ID, with encrypted typed
payloads. `plaid_link_sessions` tracks authentication handshakes;
`plaid_webhook_events` retains verified events durably and deduplicates redelivery.

Transactions commit the entire paginated batch and cursor together. Mutation
errors restart at the original cursor; failures leave persisted data unchanged.
Snapshots replace holdings, securities, liabilities, Auth, or Identity records.
Investment transaction history currently upserts the requested window; it does
not detect historical deletions. No amounts are rounded or converted into Actual
ledger units here. Plaid's amount signs and investment quantities differ from
Actual's cash ledger, so ledger projection/import is a separate next step.

Cached account balances do not imply a paid real-time Balance request. All fetches
are explicit; automatic refresh scheduling and a webhook worker are not built yet.
Requesting or fetching additional products can initialize billable products.

## Webhooks and Security

`POST /plaid/webhook` is mounted before JSON parsing so verification hashes the
exact request bytes. It validates ES256 signature, Plaid's verification key,
five-minute JWT age, and body hash. It then persists the event and flags Item
attention states; it does not perform provider fetches inline. To receive events,
set `PLAID_WEBHOOK_URL` to a publicly reachable HTTPS endpoint/tunnel. Local
manual retrieval works without exposing a webhook.

Access tokens, Link tokens, Item metadata, webhook payloads, and financial record
payloads use AES-256-GCM with per-value nonces and context binding. This is
server-side encryption at rest, separate from Actual's end-to-end budget encryption.
Identifiers, cursors, state, timestamps, and record indexes remain plaintext.
The server process can decrypt data. Back up SQLite and `.env.plaid` separately;
losing the encryption key makes these encrypted records unreadable. Key rotation
requires a future re-encryption migration; do not replace the key in place.

The new endpoints sanitize SDK failures rather than returning request configs
(which contain secrets). Do not turn on HTTP body/header logging for Plaid routes.

## Scope and Next Steps

This is a foundation for the primary account-based financial data products,
not a claim that all Plaid products are already implemented. Payments, Transfer,
Signal, Assets reports, Income, Statements, Identity Verification, Monitor,
and other product families have distinct workflows, consent, and entitlements.
They should add their own models and operations through the existing authenticated
module rather than forcing their data into budget transactions.

Still needed: live Sandbox validation with your credentials, a connection UI,
ledger/account mapping, automatic refresh jobs, historical investment deletion
handling, further product consent flows, and product-specific integrations.

Validation commands:

```sh
node .yarn/releases/yarn-4.17.1.cjs workspace @actual-app/sync-server test src/plaid/plaid.test.ts
node .yarn/releases/yarn-4.17.1.cjs typecheck
```

Primary references: [Link products](https://plaid.com/docs/link/initializing-products/),
[Hosted Link](https://plaid.com/docs/link/hosted-link/),
[Item lifecycle](https://plaid.com/docs/api/items/),
[accounts](https://plaid.com/docs/api/accounts/),
[transaction sync](https://plaid.com/docs/api/products/transactions/),
[investments](https://plaid.com/docs/api/products/investments/),
[liabilities](https://plaid.com/docs/api/products/liabilities/),
[webhook verification](https://plaid.com/docs/api/webhooks/webhook-verification/).
