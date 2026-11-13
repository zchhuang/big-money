# Big Money Architecture Ledger

This ledger records how Big Money is built, why its boundaries exist, and what
remains incomplete. Entries below were recorded on 2026-11-12 against the current
working branch. Implementation evidence is branch-specific until merged.

## Current system map

| Boundary                            | Responsibility                                                                                          | Detailed reference                                               |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Actual engine and clients           | Local budget ledger, budgeting, UI, and synchronization inherited from Actual                           | [Agent package guide](AGENTS.md#architecture--package-structure) |
| Plaid module in the sync server     | Authenticated connection lifecycle, provider requests, encrypted provider records, webhook verification | [Plaid infrastructure](PLAID.md)                                 |
| Financial module in the sync server | Connector-neutral accounts, transaction observations, durable ingestion, and pure ledger projection     | [Financial data contract](FINANCIAL_DATA.md)                     |
| Future product work                 | Additional connectors, categorization, subscriptions, portfolios, profiles, and redesign                | [Workstreams and acceptance criteria](ROADMAP.md)                |

The server's provider and canonical financial stores are separate from Actual's
budget ledger. The current financial module returns a projection; applying it to
the client ledger still needs an integration coordinator.

## Recorded architecture

### L001 — Preserve the local-first Actual foundation

**Status:** Implemented foundation; product extensions are in progress.

Big Money forks stable Actual v26.11.0 to retain its budgeting engine, local
storage, and synchronization while developing its own interface and financial
features. The starting point is commit
`1766241e3f4b3c578e424c4fa15f1eb83c0da17d` (tag `big-money-base-v26.11.0`).
Keeping that foundation avoids rebuilding ledger and sync behavior, but new work
must respect the existing client/server boundaries and account for upstream
compatibility. Visual redesign remains a separate roadmap workstream.

### L002 — Run provider integrations through the local sync server

**Status:** Plaid infrastructure implemented; live connectivity unverified.

Plaid uses the existing server's authenticated sessions, budget access checks,
and SQLite storage. Hosted Link supplies initial consent without requiring new
client UI. Provider tokens and payloads use authenticated encryption with a
server-held key; the server can decrypt them, so this storage is not end-to-end
encrypted. Plaid requests leave the local machine for Plaid's external service.

This keeps credentials outside browser code and shares connection infrastructure
across supported products. Product access still depends on configuration,
consent, and provider availability. Initial operation assumes one server process;
automated refresh jobs and broader deployment coordination remain future work.
See [PLAID.md](PLAID.md) for supported flows and limitations. Implementation:
[e0a19afb2](https://github.com/zchhuang/big-money/commit/e0a19afb2ef69fd60b42a0efe3aee243355742d5).

### L003 — Separate source observations, canonical records, and ledger output

**Status:** W2.1 implemented internally; ledger application and reconciliation remain open.

Connectors normalize into a shared financial model rather than writing directly
to Actual transactions. Durable source identities and observations preserve
provenance and replay behavior; mappings associate canonical accounts and
transactions with Actual IDs. Money uses exact integer minor units with explicit
currency and scale. Conversion to Actual's amount representation must be exact.

This boundary lets bank, card, and wallet ingestion share financial rules while
retaining provider evidence. It adds a separate store and mapping lifecycle that
must be maintained. Projection excludes records that cannot safely enter the
ledger, including pending, unverified, unmapped, and incompatible amounts.
It preserves user-owned categorization fields. No automatic client-ledger writes
or public financial HTTP endpoints exist yet. See
[FINANCIAL_DATA.md](FINANCIAL_DATA.md) for the contract and test evidence.
Implementation:
[dde7015ed](https://github.com/zchhuang/big-money/commit/dde7015edf18dc959cf8f0ebf97168780e634e53).

### L004 — Separate module responsibilities within each feature

**Status:** Adopted convention; financial module refactored to demonstrate it.

Models define contracts, repositories own scoped persistence, services own
business decisions and orchestration, and projections perform pure conversion.
Transport owns authentication/authorization and HTTP concerns. Composition keeps
the public interface small; a module adds only the layers its behavior needs.

This makes business rules usable and testable independently of HTTP and SQL while
keeping atomicity and authorization explicit. The financial module retains its
existing `createFinancialStore` interface through a small composition wrapper.
The authoritative rules are in
[AGENTS.md](AGENTS.md#module-responsibilities), with enforcement in
[review guidance](CODE_REVIEW_GUIDELINES.md#module-responsibilities) and the
[commit skill](.claude/skills/committing-actual-changes/SKILL.md).
Implementation:
[80aabb531](https://github.com/zchhuang/big-money/commit/80aabb5313ea16df01178c56dc582c557ae819f8).

## Boundaries still to decide

These are planned work, not implemented architecture:

- Profile identity, household sharing, and isolation beyond current budget scopes.
- Gmail authorization and Venmo email ingestion, with any scraping job designed
  separately; PayPal and Fidelity connection paths still need validation.
- Local-model execution and data access for assisted categorization.
- Portfolio ownership, valuation/history, and investment transaction semantics.
- Refresh scheduling, reconciliation previews, and application of canonical data
  to the Actual ledger.

Use [ROADMAP.md](ROADMAP.md) for priorities, dependencies, and completion gates.

## Maintaining this ledger

When a change alters storage ownership, a shared contract, an integration or trust
boundary, or module responsibilities, update this ledger in the same task.
Record the choice, reason, consequences, implementation status, and a source or
commit reference. Update detailed contracts in their existing documents and link
them here. Keep planned choices explicitly marked until acceptance evidence exists.

Retain historical rationale when replacing a decision: mark its entry superseded
and link to the replacement entry with the next `L` number. Routine implementation
changes belong in Git history. Review is complete when affected ledger entries
match the implemented code and remaining limitations are explicit.
