# Categorization and Local AI (W3)

The first W3 delivery is an Actual CLI review workflow. It uses the existing
financial engine and category/rule system, leaving the W2 data models and W7 web
redesign independent. The app's existing transaction table still provides bulk
category editing and split editing. This delivery adds review, suggestions,
feedback, guarded approval/undo, and recovery through `actual categorize`.

## Run the Workflow

From the repository root, install dependencies and build the CLI and API:

```sh
node .yarn/releases/yarn-4.17.1.cjs install --immutable
node .yarn/releases/yarn-4.17.1.cjs build --scope=@actual-app/cli
```

Use the CLI's existing Actual connection configuration: `ACTUAL_SERVER_URL`,
`ACTUAL_SYNC_ID`, and either `ACTUAL_SESSION_TOKEN` or `ACTUAL_PASSWORD_FILE`.
Encrypted budgets also need `ACTUAL_ENCRYPTION_PASSWORD_FILE`. Use a dedicated
CLI data directory via `--data-dir`; do not point it at an open desktop budget or
the sync server's own storage. See `actual --help` for current connection options.

```sh
node packages/cli/dist/cli.js categorize queue
node packages/cli/dist/cli.js categorize suggest --limit 20
node packages/cli/dist/cli.js categorize approve TRANSACTION_ID --category CATEGORY_ID
node packages/cli/dist/cli.js categorize approve TRANSACTION_ID
node packages/cli/dist/cli.js categorize reject TRANSACTION_ID
node packages/cli/dist/cli.js categorize history
node packages/cli/dist/cli.js categorize undo DECISION_ID
node packages/cli/dist/cli.js categorize recover
```

Global options such as `--data-dir` and `--format table` go before `categorize`.
The default JSON output retains the full suggestion/provenance fields. Every
command uses the existing exclusive budget lock and refreshes through the CLI
connection flow. This initial version requires the Actual server connection;
it is not a standalone offline editing interface. A model is entirely optional.

`queue` lists uncategorized transactions from open, on-budget accounts. It includes
split children but excludes split parents, transfers, starting balances, and
zero-amount entries. Category choices include visible income and expense categories:
a positive refund can legitimately belong to an expense category.

`suggest` never changes financial transactions. It first looks for two consistent,
still-valid approved corrections for the same payee, account, and direction of
money movement. Conflicting or subsequently changed examples cause abstention.
Otherwise it may ask the configured local model. Existing Actual rules continue
to operate normally; this module does not create automatic rules from model output.

`approve` applies one current suggestion or an explicitly chosen category. It
refuses to replace an existing category. A transaction fingerprint invalidates
suggestions when amount, date, payee, merchant, account, or import identity changes.
Approval records source, confidence, explanation, configured model, and prompt
version where applicable. Model confidence is uncalibrated; approved-example
confidence represents an exact heuristic match, not a statistical guarantee.

`reject` persists dismissal for the current transaction version. `undo` restores
the prior category only if the approved transaction still matches. `recover`
resumes journaled approval/undo after interruption, preserving conflicting manual
changes. Conflicts are recorded as terminal journal decisions so a fresh review
can proceed; recovery never retries those writes. Inspect conflicts before changing the ledger; API synchronization errors
may require another CLI invocation to finish pushing local ledger changes.

## Optional Local Model

Set the name of an already installed model and an OpenAI-compatible local chat
completion endpoint:

```sh
export ACTUAL_LOCAL_MODEL='YOUR_INSTALLED_MODEL_WITH_VERSION_TAG'
export ACTUAL_LOCAL_MODEL_URL='http://127.0.0.1:11434/v1/chat/completions'
node packages/cli/dist/cli.js categorize suggest --limit 10
node packages/cli/dist/cli.js categorize suggest --limit 10 --retry
```

Only literal loopback HTTP addresses (`127.0.0.1` or `[::1]`) are accepted, with
the exact `/v1/chat/completions` path. Credentials, redirects, query strings, and
cloud endpoints are rejected. There is no cloud fallback or model download.

Inputs contain a bounded merchant label, direction, and up to 200 visible
categories; notes, email bodies, credentials, account IDs, transaction IDs, and
exact amounts are not sent. Merchant/category text is data, not instructions.
Responses must contain exactly `category_id`, `confidence` in [0,1], and a short
`reason`; unknown categories, extra keys, malformed JSON, and tool calls are
rejected. Null category means abstention. Requests time out after 15 seconds and
responses are capped at 32 KiB. Large taxonomies are deferred rather than truncated.

Unavailable or invalid inference becomes a persisted `retry` entry, with bounded
exponential backoff and a five-attempt automatic limit. Running `suggest` again
processes eligible work; `--retry` overrides the delay/exhaustion and retries model
abstentions. Explicitly rejected suggestions stay rejected. There is no background
inference daemon in this slice; it can be invoked periodically by W8's future job
runner. Rules, queue inspection, manual corrections, and undo work with no model.

## Persistence and Integration Contract

Code lives in `packages/cli/src/categorization/`:

- `types.ts`: transaction/category inputs, suggestion provenance, journal, and
  the small ledger/persistence/model interfaces.
- `actual-ledger.ts`: adapter to existing Actual API reads/category updates.
- `review.ts`: queue, learning, suggestions, approval/rejection/undo, and recovery.
- `storage.ts`: versioned atomic feedback sidecar, scoped to server URL + sync ID.
- `model.ts`: loopback-only structured local inference.

The sidecar lives below the CLI cache metadata directory, uses owner-only file
permissions, and is replaced atomically under the existing CLI lock. It holds
IDs, decisions, fingerprints, suggestions, and retry state, not raw email bodies
or bank credentials. Its contents and the CLI budget cache are **not encrypted**
by Actual's budget E2EE. Protect the local filesystem and include feedback in
backups. It is local to this CLI cache and does not yet synchronize across devices.
Corrupt/unsupported state fails closed rather than silently forgetting decisions.

W2 should retain stable transaction IDs and respect user-assigned categories on
refresh. The existing Actual importer is smoke-tested to preserve approvals and
avoid duplicates for matching imported IDs. Identity-changing imports and new
provider projection paths need their own integration coverage before claiming the
same guarantee. W6 must supply profile-scoped storage before multi-user deployment.

W7 can expose these review operations in the redesigned interface. Browser UI
must call an authenticated engine/server adapter; this Node CLI module should not
be bundled directly into the browser. A future wrapper must preserve budget scope,
locking, fingerprint checks, structured-output validation, and explicit approval.

## Validation and Remaining Work

```sh
node .yarn/releases/yarn-4.17.1.cjs workspace @actual-app/cli test
node .yarn/releases/yarn-4.17.1.cjs typecheck
# Typecheck emits workspace files; rebuild runtime bundles before the smoke test.
node .yarn/releases/yarn-4.17.1.cjs build --scope=@actual-app/cli
node --experimental-strip-types packages/cli/scripts/verify-categorization.mjs
```

The smoke script uses a disposable copy of the committed synthetic budget and
cleans it after the engine process exits. It verifies real category approval,
clearing on undo, correction-based suggestions, and idempotent reimport with
approved categories retained. It never connects to the personal server or a model.

Unit fixtures exercise explicit-decision precedence, refunds, conflicting examples,
restarts, rejected/stale suggestions, interrupted writes, recovery, scope isolation,
malformed model output, payload limits, loopback enforcement, and offline retry.
These are behavior/safety fixtures, **not a measured accuracy benchmark for a real
local model**. Model-specific accuracy/abstention evaluation remains open until a
model and representative labeled dataset are selected. Keep such data separate
from personal budgets and report coverage as well as accuracy.

Remaining integration work: W7 review UI, W8 periodic inference dispatch, W6
profile-scoped persistence, shared/synchronized feedback, and evaluation against
the user's selected local model. W3 is not marked fully complete by this CLI slice.
