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
