# Big Money Workstreams

This is the product roadmap for the Big Money fork of Actual Budget. Use it to
scope implementation and identify dependencies. Workstream milestones below are
planning targets, not claims of completed features or assigned agent tasks.

## Direction and Decisions

- Personal use comes first: one local deployment and one primary user initially.
- Preserve a path to independent users and selectively shared financial data.
- Reuse Actual's financial engine while building our own interface and features.
- Target banks, credit cards, Fidelity, Venmo, and PayPal as financial sources.
- Prefer Gmail ingestion for Venmo; investigate scheduled authenticated scraping
  as a supplement. CSV is a reconciliation/backfill fallback.
- Categorization may use a local model that runs intermittently. The application
  must work when inference is unavailable.
- Portfolio management, subscriptions, profiles, and visual redesign are separate
  workstreams, with shared data contracts rather than one large feature branch.
- Portfolio work starts with visibility, analysis, and proposed allocation changes.
  Trade execution needs a separate user decision and scope.

## Current Baseline

The fork began at Actual stable `v26.11.0`. The first Plaid infrastructure commit
is `e0a19afb2`: server authentication routes, encrypted provider storage, account
and product records, incremental transaction retrieval, investment/liability
retrieval, and signed webhook intake. See [PLAID.md](PLAID.md) for implementation,
setup, and limitations; inspect source before changing its behavior.

Live Sandbox/Production linking is not yet verified. A connection UI, automatic
refresh worker, and projection into Actual's budget ledger remain unfinished.
Verified webhooks are stored, but do not yet trigger background refresh jobs.
Inherited Actual features are a starting point; confirm their behavior before
rebuilding functionality that already exists.

## Workstreams and Milestones

### W1. Connectors and Ingestion

**Owns:** provider authorization, source collection, scheduling, reconnect flows,
source identifiers, capability discovery, and connection health.

- **W1.1 — Working bank/card connection:** complete live Sandbox validation, then
  a user-authorized real connection; expose account selection and reconnection;
  add durable refresh jobs with retries, idempotency, and visible freshness/errors.
- **W1.2 — Fidelity:** validate the specific Fidelity accounts, Plaid Investments
  access, holdings, activity, and available history; provide explicit backfill
  and unsupported-account behavior.
- **W1.3 — Venmo:** authorize Gmail, ingest relevant Venmo emails, retain message
  provenance, and distinguish payments, requests, fees, refunds, and transfers.
  Test historical coverage. Investigate a scheduled scraper for missing details,
  with credential/session storage, expired-login/MFA handling, retry limits, and
  a visible last-success state. Mark the scraper experimental until validated.
- **W1.4 — PayPal:** validate aggregation or eligible read access for the user's
  account; implement the chosen connector and statement backfill. Merchant payment
  acceptance is not evidence of personal transaction-history access.

**Done when:** each target source has a tested ingestion route or a documented
coverage blocker/fallback; repeated runs do not duplicate source records; failures
are actionable; each account shows the source and last successful collection.
A fallback does not count as automatic connectivity.

**Dependencies:** W2 defines the ingestion contract; W8 provides job operations
and credential recovery. Independent connector work can proceed in parallel.

**W1.1 kickoff delivered:** `bin/setup-plaid-sandbox.sh` guides developer-account
and key setup; `plaid:check` validates Link creation and synthetic bank/account/
transaction access with cleanup. Automated tests cover success, Production refusal,
and failure cleanup. Live execution awaits the user's Sandbox keys. Connection UI,
background refresh, and the other W1 milestones remain open; this is not a claim
that W1.1 or W1 is complete.

### W2. Financial Data and Reconciliation

**Progress (2026-11-12):** W2.1's internal model/storage contract is implemented
in `packages/sync-server/src/financial/`. See [FINANCIAL_DATA.md](FINANCIAL_DATA.md)
for the connector sequence, exact money/identity rules, and ledger projection
contract. Synthetic tests verify replay and pending/posting/removal behavior.
Client-side ledger application and the W2.2/W2.3 workflows remain open; the
workstream's full acceptance gate is not complete.

**Owns:** provider-to-application mapping, canonical transactions/accounts,
provenance, reconciliation, and Actual ledger projection.

- **W2.1 — Common model:** define stable account/transaction identities, ownership,
  amounts, currencies, timestamps, pending/posted transitions, source revisions,
  and mappings from provider records to Actual accounts. Keep investment quantities
  and security data in their own models. Preserve raw source data for replay.
- **W2.2 — Correct movement of money:** reconcile bank transfers, card settlements,
  wallet funding/withdrawals, refunds, split purchases, and reimbursements. Record
  match evidence and support undo/manual correction. Cross-source matching must
  distinguish two observations of one payment from two independent payments.
- **W2.3 — Reliable history:** import/backfill previews, source replacement,
  deduplication, balance checks, replayable migrations, and discrepancy review.

**Done when:** fixtures covering a bank, card, Venmo, and PayPal can be imported
and replayed without duplicated spending; pending-to-posted updates and removals
work; balances reconcile or explain their differences. Financial calculations
have explicit currency/precision rules and exclude incomplete/unverified data.

**Dependencies:** W1 source samples. W3, W4, W5, and W9 consume these contracts.

### W3. Categorization and Local AI

**Delivery evidence (2026-11-12):** the first CLI slice provides the review queue,
correction-based suggestions, optional local inference, approval/rejection/undo,
and journal recovery. See [CATEGORIZATION.md](CATEGORIZATION.md) for the interface,
validation commands, and remaining integration work. Real-model accuracy testing,
the W7 interface, and profile/shared-feedback integration remain open; W3 is not
fully complete.

**Owns:** category suggestions, merchant cleanup, deterministic rules, feedback,
and optional local inference.

- **W3.1 — Useful without AI:** inspect and extend Actual's existing category/rule
  features; add an uncategorized review queue, bulk editing, splits, and saved
  corrections. Explicit user decisions take precedence over provider guesses.
- **W3.2 — Optional local inference:** define a configurable local-model interface;
  use bounded inputs and structured, validated suggestions; record confidence,
  explanation, model/version, and provenance. Queue/retry when the model is off.
- **W3.3 — Learning and quality:** reuse approved examples, evaluate against a
  fixed fixture set, and support accepting/rejecting suggestions and undoing
  changes. Preserve decisions when transactions are refreshed.

**Done when:** rules and review work with the model stopped; suggestions cannot
silently override approved categories; malformed model output is rejected;
corrections survive sync/reimport; evaluation results and limitations are recorded.
Treat email/merchant text as untrusted input. Keep inference local by default;
cloud inference requires an explicit user choice. Models receive no credentials
and cannot initiate financial actions.

**Dependencies:** W2; W6 supplies ownership and privacy rules before sharing.

### W4. Subscriptions, Bills, and Recurring Activity

**Progress (2026-11-12):** discovery/review first slice implemented on
`codex/w4-recurring-discovery`: quarterly and annual candidates, merchant/account
matching fixes, supporting transaction counts/dates, persistent dismissal/restore,
and creation error handling. Ledger tests and browser acceptance cover these
behaviors. This is partial W4.1 and review groundwork for W4.2; variable bills
outside the existing amount tolerance, subscription classification, renewal/price
alerts, and recurring totals remain planned. The current input is Actual's ledger;
provider-to-ledger integration and cross-source transfer reconciliation remain W2.

**Owns:** recurring detection, confirmed subscriptions, bill schedules, and alerts.

- **W4.1 — Recurrence:** inspect Actual schedules and detect candidate merchants,
  frequency, amount ranges, annual/quarterly billing, and irregular recurring bills.
  Distinguish subscriptions from rent, utilities, income, and loan payments.
- **W4.2 — Review and tracking:** confirm/dismiss candidates, track renewal/next
  expected charge, changes in price, missing charges, and monthly/annual totals.

**Done when:** a user can correct detections and see why a recurring series was
suggested; annual subscriptions work; duplicate sources and transfers do not
inflate totals; stale inputs produce qualified alerts. Automated cancellation
is a separate feature requiring its own integration and authorization.

**Dependencies:** W2 and W3. Available email evidence may enrich detections.

### W5. Portfolio Management

**Owns:** investment accounts, securities, holdings, activity, valuation, allocation,
and performance analysis.

- **W5.1 — Portfolio overview:** show Fidelity/other holdings, cash, prices and
  timestamps, security identity, account type, cost basis/tax lots where available,
  and missing-data indicators. Reconcile holdings and handle activity corrections.
- **W5.2 — Analysis:** aggregate exposure, target allocation, drift, dividends/fees,
  realized/unrealized results where supported, benchmark comparisons, and separate
  external cash flows from investment returns. Define return methodology.
- **W5.3 — Planning:** portfolio groups, proposed rebalancing, scenarios, and
  tax-aware estimates only where data supports them. Keep proposals read-only.

**Done when:** a supplied brokerage snapshot reconciles to the application;
contributions are not reported as gains; corporate actions and missing price/cost
basis histories are handled or explicitly flagged. Price history, tax lots, and
security-reference data need validated coverage and licensing, beyond merely
having a Plaid connection.

**Dependencies:** W1 Fidelity coverage, W2; W6 for owner/household portfolio views.

### W6. Profiles, Ownership, and Sharing

**Owns:** user identity, independent financial profiles, membership, permission
checks, credential ownership, and selectively shared views.

- **W6.1 — Personal foundation:** distinguish the signed-in person, financial
  profile/household, budget, account, and portfolio group. Attach every connector,
  record, rule, model input, recurring series, and saved view to its owner/scope.
- **W6.2 — Additional users:** define invitation/login/recovery, profile switching,
  isolated credentials/data, and explicit sharing roles. Test server routes,
  queries, jobs, exports, caches, and AI context for cross-profile access.

**Done when:** two test users can use independent profiles with no data/credential
leakage, and intentional sharing follows documented permissions. A display-name
selector is not sufficient. Audit inherited Actual administrator access before
claiming isolation between mutually untrusted users; choose the deployment
isolation model before offering a hosted multi-customer service.

**Dependencies:** scope/ownership decisions precede further persistent models;
full multi-user onboarding can follow the personal-use release.

### W7. Visual Redesign and Product Experience

**Owns:** our design direction, navigation, components, responsive layouts, and
cohesive user journeys across all workstreams.

- **W7.1 — Design foundation:** inspect current screens, define primary journeys,
  information architecture, design tokens, typography, and accessible components.
- **W7.2 — Complete workflows:** redesign account connection/health, transaction
  review, subscriptions, portfolio overview, and profiles as vertical slices.
  Include loading, empty, partial-data, offline, and error states.

**Done when:** implemented workflows are inspected in the current rendered app
using separate fixture/demo data, keyboard and responsive behavior work, and
financial values/status remain legible and traceable. Use the applicable design
skill. Preserve existing financial behavior while changing presentation.

**Dependencies:** design exploration can begin immediately; implementation follows
stable contracts and working feature slices from the relevant workstream.

### W8. Local Operations, Security, and Recovery

**Owns:** dependable startup, scheduled jobs, backups, credential lifecycle, upgrades,
observability, and personal-data handling.

- **W8.1 — Dependable local runtime:** documented startup/shutdown, persistent job
  execution without an open browser, locking/retries, health checks, schema/version
  tracking, and actionable failures without secret-bearing logs.
- **W8.2 — Recovery and lifecycle:** tested backup/restore of financial storage plus
  separately protected keys; credential revocation/rotation, data export/deletion,
  retention, and upgrade/rollback procedures. Use separate test and personal data.

**Done when:** a fresh local setup and restore exercise work, jobs recover after
restart, duplicate workers do not duplicate imports, and deleting/disconnecting
an integration accounts for both local records and provider access/billing.

**Dependencies:** begins alongside W1/W2; required before relying on real data.

### W9. Cash Flow, Debt, Goals, and Unified Reporting

**Status:** proposed follow-on scope, pending prioritization by the user.

**Owns:** a coherent personal financial picture beyond individual accounts.

- **W9.1 — Financial overview:** reuse/extend Actual reports for net worth,
  income/spending, upcoming obligations, card/loan balances and due dates, and
  cash-flow projections with visible data freshness and forecast assumptions.
- **W9.2 — Planning:** savings goals, debt-paydown scenarios, expected income,
  reimbursement follow-up, and an actionable review inbox.

**Done when:** reports reconcile to underlying transactions/holdings without
counting wallet transfers or brokerage cash twice, and distinguish historical
facts from forecasts. Unavailable data is shown as unknown rather than zero.

**Dependencies:** W2/W4/W5; prioritize after the first personal-use workflow.

## Delivery Gates and Sequencing

| Gate                           | Required outcome                                                                                                            | Workstreams                                   |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| G1 — Trustworthy personal core | One bank/card works end to end, correct ledger/reconciliation, manual review, recoverable local storage                     | W1.1, W2.1–2.2, W3.1, W8.1–8.2                |
| G2 — Complete personal picture | Fidelity, Venmo/Gmail, and PayPal coverage validated; portfolio overview; recurring tracking; coherent redesigned workflows | W1.2–1.4, W2.3, W4, W5.1, W7                  |
| G3 — Assisted insight          | Optional local AI with evaluated corrections, allocation/performance analysis, selected planning reports                    | W3.2–3.3, W5.2–5.3, prioritized W9            |
| G4 — Safe sharing              | Additional-user onboarding and verified isolation/sharing across connectors, jobs, AI, exports, and views                   | W6.2 and a cross-workstream permissions audit |

Make W6.1 ownership decisions during G1. W7 design discovery can run alongside
G1; avoid blocking the data contracts on the full redesign. Gates are proposed
ordering, not fixed dates or blanket authorization to implement every workstream.

## Agent Handoff

When assigned implementation work:

1. Identify its workstream/milestone and inspect the current code and referenced
   setup docs. Report any discrepancy between this baseline and the implementation.
2. Establish the relevant input/output and ownership contracts before changing
   shared models. Keep source collection in W1 and ledger semantics in W2.
3. Implement the assigned slice and its acceptance criteria. Record prerequisite
   blockers and coverage gaps explicitly; maintain working behavior when optional
   providers or local inference are unavailable.
4. Run checks appropriate to the change; inspect rendered UI for interface work.
   Update milestone evidence in this document when the completion criteria pass.
5. Follow the user's publication instructions and repository commit rules. Preserve
   unrelated work and concurrent branches. Keep credentials and personal data local.

Workstream descriptions do not authorize agent spawning, account connections,
scraping personal sessions, or financial transactions. Follow the user's assigned
scope and the tools' authorization requirements for those actions.

## Connector Evidence and Open Questions

Checked against primary documentation on 2026-11-12; validate again before
implementation or making a coverage promise.

- Fidelity: [Plaid Investments](https://plaid.com/docs/investments/) and
  [Plaid's Fidelity access update](https://plaid.com/blog/product-updates-august-2026/)
  describe access requirements. Validate the user's plan/approval and account types.
- Venmo: [official transaction-history help](https://help.venmo.com/cs/articles/transaction-history-vhel281)
  documents CSV statements. Gmail-based coverage and authenticated scraping remain
  untested; email availability is not proof of complete financial history.
- PayPal: [Transaction Search](https://developer.paypal.com/api/transaction-search/v1)
  documents reporting endpoints. Personal-account eligibility, authorization,
  history coverage, and aggregation support still need validation.
- Plaid: [product initialization](https://plaid.com/docs/link/initializing-products/)
  affects institution eligibility, consent, and billing. Enable products deliberately.
- Portfolio scope: confirm the desired allocation/performance features before G3;
  trade execution, automated transfers, and authoritative tax reporting are unscoped.
- Profiles: confirm household sharing versus independent users before W6.2.
