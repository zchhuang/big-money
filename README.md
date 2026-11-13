# Know Thy Wealth

Your money, in view. A local-first personal finance app for bringing accounts,
spending, recurring expenses, and investments into one place.

## Plaid Sandbox Setup

For this fork's bank-connector setup, run `bash bin/setup-plaid-sandbox.sh` from
the repository root. It guides you through Plaid account/key setup, keeps secrets
local, and validates a disposable Sandbox connection before enabling Plaid.
See [PLAID.md](PLAID.md) for prerequisites and the remaining connection workflow,
and [ROADMAP.md](ROADMAP.md) for workstreams and milestones.

Know Thy Wealth is an independent, customized fork of Actual Budget. It is under active
construction: account connectors, optional local-model categorization, portfolio
features, profiles, and a new interface are separate workstreams. See
[ROADMAP.md](ROADMAP.md) for scope and completion criteria.

## Run Locally

Use Node.js and the repository-pinned Yarn version. From the repository root:

```sh
node .yarn/releases/yarn-4.17.1.cjs install --immutable
node bin/setup-plaid.mjs
node --env-file=.env.plaid .yarn/releases/yarn-4.17.1.cjs start:server-dev
```

Open `http://127.0.0.1:5006`. Set up your server password or use the demo with
sample data. Plaid is optional and disabled until configured; see
[PLAID.md](PLAID.md) for credentials, supported data products, and current gaps.

## Development

- [Agent guidance](AGENTS.md)
- [Workstreams and milestones](ROADMAP.md)
- [Plaid setup and storage](PLAID.md)
- [Product context](PRODUCT.md)
- [Brand identity and compatibility](BRAND.md)

Run Yarn commands from the repository root. Use `typecheck`, `lint`, and the
relevant workspace tests before publishing changes. Keep credentials, personal
budgets, and test/demo data separate.

## Support

Use the [Know Thy Wealth repository](https://github.com/zchhuang/big-money) for this
fork's code and support. Know Thy Wealth releases and feature status are independent
of Actual Budget. Historical engine documentation remains in `packages/docs/`;
its upstream links describe inherited functionality rather than this fork's
hosting or product guarantees.

## Credits and License

Built on [Actual Budget](https://github.com/actualbudget/actual), originally by
James Long and its contributors. The original [MIT license](LICENSE.txt) and
package/dependency notices remain in effect. Know Thy Wealth is an independent project
and is not an official Actual Budget release.
