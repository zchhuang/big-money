# Agent Change Ledger

Project memory for completed agent work and consequential decisions. This records
software/project changes; financial transactions belong in the application.
Read the latest entries and entries relevant to an assigned workstream before
implementation. [ROADMAP.md](ROADMAP.md) defines scope and milestones; this ledger
records what actually changed and how it was checked.

## How to Maintain This Ledger

Append one dated entry for each completed task, including review-only tasks that
produce findings or decisions. Record:

- Workstream/task and branch; known implementation/review commit references.
- Changes and the reason for consequential decisions.
- Checks actually performed and their results, including skipped/blocked checks.
- Remaining work, limitations, blockers, and useful handoff paths.

Keep entries concise and factual. Distinguish plans from completed work. Preserve
past entries; make corrections in a new entry. Include this update in the task's
commit. The commit containing an entry is available through `git log -- AGENT_LEDGER.md`;
there is no need to amend an entry to insert its own commit hash after publishing.
Keep credentials, personal financial data, email contents, and private session
information out of this file. Link implementation/docs rather than duplicating them.

## History

The initial historical entries below were backfilled on 2026-11-12 from Git history
and completed-task reports. Their checks are historical results, not new reruns.

### 2026-11-12 — Plaid Infrastructure Baseline (Backfill)

- **Workstream/branch:** W1/W2 foundation, `main`; implementation `e0a19afb2`.
- **Changes:** opt-in local Plaid module, encrypted credentials/provider records,
  Link lifecycle, account/transaction/investment/liability retrieval, verified
  webhook intake, local setup script and configuration. See [PLAID.md](PLAID.md).
- **Decision:** personal use first; retain full provider schemas separately from
  Actual's ledger. Optional products and inference must not become prerequisites.
- **Reported checks:** 786 sync-server tests (including 21 Plaid tests), repository
  typecheck, lint/formatting, production build, local health/auth smoke checks.
- **Remaining:** live Plaid Sandbox/Production validation with user credentials,
  ledger projection, automatic refresh workers, connection UI, additional product
  consent flows. Local tests do not establish real institution coverage.

### 2026-11-12 — Workstream Roadmap (Backfill)

- **Workstream/branch:** project planning, `main`; implementation `1642f57f0`.
- **Changes:** [ROADMAP.md](ROADMAP.md) defines nine workstreams, milestones,
  dependencies, completion criteria, and delivery gates; `AGENTS.md` points to it.
- **Decisions:** Venmo should prefer Gmail ingestion, with scheduled authenticated
  scraping investigated as a supplement; local AI remains optional; additional
  users come after the personal-use core.
- **Reported checks:** Markdown formatting, repository typecheck, commit hooks,
  and remote commit verification.
- **Remaining:** roadmap milestones are plans; completing a document does not
  complete the described features or establish external connector coverage.

### 2026-11-12 — W4 Discovery and Review First Slice (Backfill)

- **Workstream/branch:** W4, `codex/w4-recurring-discovery`; implementation `dcc8dadfe`.
- **Changes:** quarterly/annual candidates, per-account/payee/direction matching,
  visible evidence counts/dates, persistent dismissal/restore, and schedule-creation
  error handling. The user chose discovery/review before a subscription dashboard.
- **Reported checks:** 68 schedule/ledger tests, browser dismiss/restore/create
  workflow, rebuilt desktop/narrow-window inspection, typecheck, lint, and build.
- **Remaining:** subscription classification, variable bills beyond the existing
  amount tolerance, renewal/price alerts, totals, and W2 cross-source reconciliation.
  The subsequent review below found correctness gaps despite these passing checks.

### 2026-11-12 — W4 Review Fixes and Agent Memory

- **Workstream/branch:** W4 and project guidance, `codex/w4-recurring-discovery`;
  reviewed base `1642f57f0`, initial W4 commit `dcc8dadfe`.
- **Review:** standards axis found no actionable violations; spec axis found
  monthly charges could be suggested as quarterly, and quarterly month-end rules
  could skip short months.
- **Changes:** reject long-period subsets when matching charges occur between
  expected dates; derive evidence dates from the actual recurrence engine and use
  month-end quarterly patterns. Added regressions for monthly/quarterly ambiguity,
  short months, and leap-year annual evidence. Added this ledger and general
  `AGENTS.md` guidance to maintain it after future tasks. Tightened the existing
  recurrence helper return type so strict callers receive valid rule arrays.
- **Validation:** 72 schedule/ledger tests passed; both original spec findings were
  re-reviewed and the reviewer found no introduced blocker. The browser
  dismiss/restore/create workflow, production build, full typecheck, and scoped
  type-aware lint passed.
- **Handoff:** continue W4 from its remaining roadmap milestones; unrelated
  workstreams and `main` remain untouched by this task branch.

### 2026-11-12 — W4 Publication Review

- **Workstream/branch:** W4, `codex/w4-recurring-discovery`; implementation and
  prior fixes through `c2d3c3ec3`, publishing against `origin/main`.
- **Architecture:** recurrence matching stays in core schedule helpers; the
  schedule service reads ledger history and produces candidates. The review UI
  consumes candidate evidence and existing schedule-creation APIs. Dismissals use
  synced budget preferences; this slice adds no database schema or provider API.
- **Agent guidance:** checked `AGENTS.md` and roadmap pointers; the ledger guidance
  remains accurate. This entry records module ownership and storage for handoff.
- **Validation:** prior implementation checks passed (72 tests, browser workflow,
  production build, typecheck, lint). Exact-head CLI review and remote PR checks
  are publication gates; their results are reported with the final PR outcome.
- **Remaining:** the unimplemented W4 milestones above remain deferred. Publishing
  this slice does not establish subscription classification or provider coverage.

### 2026-11-12 — W4 Exact-Head Review Corrections

- **Workstream/branch:** W4 publication, `codex/w4-recurring-discovery`.
- **Review findings:** long-period discovery used only the newest merchant
  transaction as an anchor; automatic refetches replaced candidate IDs during
  review and could break selection or partial-creation retries.
- **Changes:** evaluate historical anchors so unrelated newer purchases do not
  hide recurring activity; hold the discovery snapshot stable until the modal
  closes or the user explicitly retries. Added annual-plus-one-off regression.
- **Architecture:** existing core matching, schedule service, and UI ownership
  remain unchanged; no storage or integration contract changes.
- **Validation:** 73 schedule tests, full typecheck, scoped lint, production
  build, and rebuilt browser workflow passed; rendered review screen inspected.
  CLI re-review of the resulting head remains the final publication gate.
- **Handoff:** the PR stayed open while these findings were resolved; remaining
  W4 milestone scope is unchanged.

### 2026-11-12 — Current Cadence Tie-Breaking

- **Workstream/branch:** W4, `codex/w4-recurring-discovery`.
- **Review/change:** historical anchors exposed an equal-score tie between old
  quarterly and current monthly billing. Discovery now prefers newer evidence
  when scores tie, with a real-ledger cadence-transition regression.
- **Architecture:** ranking remains in the existing discovery service; no new
  persistence or interface contracts.
- **Validation:** 74 schedule tests, full typecheck, and scoped lint passed.
  Exact-head CLI re-review remains the final gate before merging the PR.

### 2026-11-12 — Bounded Historical Matching

- **Workstream/branch:** W4, `codex/w4-recurring-discovery`.
- **Review/change:** indexed merchant transactions by date, deduplicated identical
  date/amount anchors, and bounded intervening-charge checks to each cadence's
  date range. Evidence matching reads five date buckets per occurrence instead
  of repeatedly parsing and scanning the full merchant history.
- **Architecture:** transient in-memory index inside core discovery; persisted
  models and service/UI boundaries are unchanged.
- **Validation:** 74 tests, full typecheck, and scoped lint passed. Exact-head
  CLI review remains the final publication gate; no new feature scope.

### 2026-11-12 — Current Evidence Before Precision

- **Workstream/branch:** W4, `codex/w4-recurring-discovery`.
- **Review/change:** a follow-up identified that date-shifted current billing can
  score below exact historical billing. Rank evidence recency first, then date
  precision, and cover both exact and shifted monthly transitions in ledger tests.
- **Architecture:** discovery-service ranking only; existing storage and module
  ownership remain accurate.
- **Validation:** 75 schedule tests, full typecheck, and scoped lint passed.
  Exact-head re-review remains the final publication gate.

### 2026-11-12 — Anchor Amount Consistency

- **Workstream/branch:** W4, `codex/w4-recurring-discovery`.
- **Review/change:** same-day purchases of a different amount could emit another
  series using the wrong intervening-charge threshold. Match each anchor's own
  transaction in the final evidence window; other transactions receive their own
  anchors and amount checks. Added monthly-plus-same-day-purchase regression.
- **Architecture:** core discovery correction; no storage or interface changes.
- **Validation:** 76 schedule tests, full typecheck, and scoped lint passed.
  Exact-head CLI review remains the final gate.

### 2026-11-13 — W2 Publication Integration and Validation

- **Workstream/branch:** W2, `codex/w2-financial-data`; implementation
  `dde7015ed`, separation `80aabb531`, architecture ledger `8a2b95b7c`.
- **Changes/decisions:** integrated current main (`43764d978`) while preserving
  connector, categorization, and recurring-discovery work. Retained both agent
  ledger pointers and removed duplicate Plaid package-import keys introduced by
  the merge. Reconciled the architecture ledger with the implemented CLI work.
- **Validation:** 812 sync-server tests passed across 68 files using a fresh
  temporary data directory; full typecheck, server build, and commit hooks passed.
  The first test invocation encountered stale test-database fixture IDs; the
  isolated rerun passed without modifying existing user or test data.
- **Remaining:** exact-head Codex review and PR checks gate publication. W2.1 is
  internal infrastructure; automatic ledger application and broader reconciliation
  remain planned as described in FINANCIAL_DATA.md and ROADMAP.md.

### 2026-11-13 — Know Thy Wealth Rebrand

- **Workstream/branch:** identity and W7 groundwork, `codex/big-money-rebrand`.
- **Changes/decisions:** adopted the user's chosen name, Know Thy Wealth; replaced
  visible app branding, onboarding, app icons, native display/install metadata,
  support/news endpoints, and current product context. Preserved upstream license
  attribution, package/protocol/config identifiers, mobile bundle IDs, and existing
  budget paths. `BRAND.md` records compatibility and asset-generation conventions.
- **Architecture:** presentation and packaging changes only; Plaid Link client names
  changed in existing service/adapter paths. No storage, financial rules, provider
  requests, authorization, or transaction boundaries changed. Integrated current main
  through `24471590a`, retaining other workstreams and their ledger entries.
- **Validation:** full typecheck and browser/server builds passed after integration;
  27 Plaid tests passed. Earlier web run passed 1,385 tests with one skipped. Scoped
  lint and rendered onboarding checks completed; native installers/signing not built.
- **Remaining:** broader visual redesign and planned financial features remain
  separate workstreams; this change establishes the identity and reusable assets.
