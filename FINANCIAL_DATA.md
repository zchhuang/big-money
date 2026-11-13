# W2 Financial Data Contract

W2.1 supplies the connector-neutral model and durable ingestion module in
`packages/sync-server/src/financial/index.ts`. It is internal infrastructure;
there are no new public HTTP routes or automatic writes to Actual's ledger.
W1 callers can use this contract without implementing their own identity, source
revision, money conversion, or pending/posted logic.

## Module Structure

`models.ts` contains data contracts; `schema.ts` and the migration define storage.
`repository.ts` owns scoped SQL, encryption, and atomic persistence primitives.
`service.ts` owns validation, account mappings, revision/pending decisions, and the
atomic ingestion operation. `projection.ts` converts domain records to an Actual
ledger plan using only supplied records/accounts. `plaid.ts` normalizes provider
data; `money.ts` performs exact calculations. `store.ts` preserves the original
`createFinancialStore` entry point by composing repository and service.

There is no HTTP router until an authenticated endpoint is actually needed.
Connector/job callers continue using the existing public interface in `index.ts`.

## Scope and Storage

Construct `createFinancialStore(database, vault, authorizedFileId)` with the
server's SQLite database and a vault implementing authenticated `seal/open`.
The existing AES-256-GCM vault can be supplied by the caller. The module does not
read Plaid credentials or require Plaid to be enabled. Its migration adds separate
financial tables to Actual's server account database.

The caller must authenticate/authorize a person or job for the budget before
constructing the handle. The module checks that the budget is active and scopes
every query, mapping, and encryption context to that file ID. Budget ownership
currently follows Actual's files; W6 will define independent profiles and sharing.
Do not expose the module through an endpoint accepting an unchecked file ID.

Financial payloads, names, descriptions, and original source documents are
encrypted with context binding. Source IDs, file/account/transaction IDs, versions,
content digests, and ledger mappings are indexed metadata and remain plaintext.
This is server-side encryption, separate from end-to-end budget synchronization.
Data stays on the server until a client explicitly requests/applies a projection.
Existing budget exports do not include these new server records; full backup
must include the server database and the separately protected encryption key.

## Connector Sequence

1. Define a `Source` with stable `provider` and `connectionId`. Include the
   environment in a connector's connection identity when IDs can overlap across
   Sandbox/Production. A display label or transient access token is not an ID.
2. Register each source account using `registerAccount(source, externalId,
   definition)`. Definitions carry account type and explicit currency precision.
   Repeated registration preserves identity. Use the optional canonical ID only
   after confirming that another source represents the same physical account.
3. Resolve the source account with `resolveAccount(source, sourceAccountId)`.
   Normalize observations using that canonical account's ID and the original
   source account ID. The store validates both against the registered mapping.
4. Assign a stable, nonnegative safe-integer `version` from a monotonically
   increasing source batch sequence. Persist that sequence with W1's checkpoints;
   use the same version on retries. Use `observedAt` for receipt time and retain
   source dates/timezones separately. Cursor strings and wall-clock arrival order
   are not interchangeable with a monotonic source revision.
5. Call `ingest(source, observations)` for the complete batch. Every observation,
   alias, and source-history write commits together or the entire batch rolls back.
   W1 may wrap ingestion and its own source checkpoint in an outer SQLite
   transaction. The module performs no network calls inside the transaction.
6. Review the result and ledger plan before applying it to the local budget.

An observation carries stable external and account identities, version, receipt
time, financial date, optional source datetime, money, description, status,
verification, optional pending predecessor, and original JSON source data.
Adapters remain responsible for preserving pagination, source deletion events,
and authoritative source versions. Removed observations retain the original
account/date/money context and use status `removed`; an unknown deletion requires
backfill/review rather than inventing account or amount data.

`plaidAccount` and `plaidTransaction` normalize Plaid account metadata and cash
transactions. The latter reverses Plaid's expense-positive sign and retains the
pending predecessor ID. Supply an explicit currency scale. Other connectors use
this same model; Gmail/Venmo and PayPal fixtures do not imply working connectors.
Investment account definitions are supported, but securities activity is excluded
from the cash transaction model and remains in the portfolio product models.

## Identity, Versions, and Financial Meaning

Each source account/transaction alias is scoped by budget, provider, connection,
and external ID. Exact replay has no effect even if the receipt timestamp changes.
A conflicting payload for an existing source version fails the whole batch.
Older source observations remain in encrypted history without replacing current
state. Equal amount/date/description alone never merge two purchases.

A posted transaction with an explicit pending predecessor keeps the canonical
transaction ID and any acknowledged Actual transaction ID. Both source IDs remain
aliases. Late removal of the old pending ID cannot delete the posted transaction.
Posting also works when it arrives before pending history, or after pending
removal in the same source batch. Ambiguous links to independently existing
transactions fail for review.

Money uses a signed integer string plus currency code and decimal scale. Inflows
are positive, outflows negative. Parse decimal strings with `decimalToMoney`;
extra nonzero precision, exponent notation, unsafe integer conversions, and
incompatible currencies fail explicitly. Adapters supply validated precision for
ISO or unofficial currencies. Provider floating-point values must be converted
without manufacturing extra precision. No implicit FX conversion is performed.

`verification` describes usable financial evidence, not a model confidence score.
Use `unverified` for ambiguous emails/requests or incomplete financial evidence.
Pending and unverified observations remain available for review, but cannot become
settled ledger writes or destructive deletion instructions.

## Actual Ledger Projection

After the user/client verifies the target account exists in the selected local
budget, persist its ID with `mapAccount`. Account/transaction mappings are unique
within a budget and refuse reassignment. Corrections/merge/undo need the explicit
reconciliation workflow planned in W2.2.

`projection(budgetCurrency)` returns an explicit plan:

- `upserts`: Actual-compatible account, financial date, signed amount in Actual's
  hundredths, stable imported ID, original description, and cleared state, plus
  canonical and previously acknowledged Actual IDs.
- `deletions`: verified source tombstones with an acknowledged Actual transaction.
- `excluded`: pending, unverified, unmapped-account, currency-mismatch, and
  precision/overflow cases, with reasons.

Canonical integer units are converted to Actual's fixed hundredths only when
exact and safely representable. The caller supplies the budget currency; Actual
transactions do not carry their own FX context.

A client-side coordinator still needs to apply this plan using Actual's existing
mutation/import machinery. It must verify account/transaction membership, use the
stable imported ID to recover from a crash before acknowledgment, apply removals,
and call `acknowledgeProjection` with the resulting Actual transaction ID. Existing
rows use explicit IDs; do not rerun fuzzy import matching on every update.
The plan deliberately omits category, user payee, notes, and transfer fields so
provider refreshes do not overwrite user categorization and reconciliation.
Reimporting raw records without this coordinator is not a completed ledger import.

## Verification and Remaining Milestones

Automated tests cover bank/card/Venmo/PayPal-shaped observations, exact replay,
raw revision retention, encryption and persistence, budget/source/account isolation,
pending/posting/removal ordering, atomic rollback, stale versions, currency and
precision failures, unique ledger mappings, and schema reversal/cascade.
These are synthetic fixtures, isolated from real user data.

W2.1's internal model/storage contract is implemented. W2.2 remains responsible
for cross-source payment matching, linked transfers/card settlements, wallet
funding, refunds/reimbursements, splits, evidence, and undo. W2.3 remains responsible
for import/backfill previews, reconciliation balances, source replacement, and
history discrepancy review. The full W2 acceptance gate remains open until the
client ledger coordinator and those workflows are exercised end to end.
