# Avera

Avera helps you manage household transactions, bills, budgets, goals and financial plans.
Use the hosted website or run your own copy on macOS, Windows or Linux.

## Choose how to use Avera

| Option | Start here | Where your records live |
| --- | --- | --- |
| Online | [Open avera.run](https://avera.run) and create an account | Hosted PostgreSQL database |
| Desktop download | [Download and launch guide](docs/DESKTOP.md) | SQLite in your private desktop data folder |
| Run from source | [Local setup](docs/LOCAL_SETUP.md), or the commands below | SQLite on your computer by default |
| Host your own website | [Render hosting guide](docs/HOSTED_APP_SETUP.md) | Your PostgreSQL database and private persistent disk |

Online accounts work across browsers. Each local installation has its own accounts
and records; **local and online data do not automatically synchronize**. Use a
[portable encrypted backup](docs/BACKUP_RECOVERY.md) to transfer records explicitly.
Sample data is available from the welcome page and stays separate from personal data.

## Run locally from source

Install [Node.js](https://nodejs.org/) 24 LTS (minimum 22.18) and Git, then run:

```sh
git clone https://github.com/cgj5027/avera-independent.git
cd avera-independent
npm ci --ignore-scripts
npm run build
npm run start:local
```

Open the URL printed in Terminal, normally http://127.0.0.1:4175, and create a local
account. Keep Terminal open while using Avera; press Ctrl+C to stop it. Commands
work in macOS/Linux terminals and Windows PowerShell. Repository access is required
to clone or download artifacts if the repository is private.

Manual finances and samples work without provider credentials. AI, bank connections,
job search and account email require [connected services](docs/CONNECTED_SERVICES.md).
Without email configured, a local account does not have email password recovery.

Source installations default to `data/avera.sqlite`. Desktop downloads use a separate
OS-specific data folder. Follow the relevant guide when configuring either; keep
credentials and original encryption keys private. Browser localStorage holds
preferences, not financial records.

## Host your own website

Follow [the Render guide](docs/HOSTED_APP_SETUP.md) to deploy `render.yaml`, configure
private credentials, test the temporary HTTPS address and connect a domain. The
financial website and provider gateway are separate services with separate databases.
The explicit `start:hosted` command enables public HTTPS hosting; `start:local`
remains loopback-only. Review the Blueprint's current paid plans before applying it.

## Documentation

- [All guides](docs/README.md): desktop, local, hosted, integrations and operations.
- [Backup and recovery](docs/BACKUP_RECOVERY.md): export, preview, restore and transfer.
- [Gateway setup](docs/GATEWAY_SETUP.md): operate connected services for installations.
- [Optional MCP connections](docs/MCP.md): read-only, separately authorized access.
- [Contributing](CONTRIBUTING.md): architecture, development and validation.
- [Security policy](SECURITY.md): report vulnerabilities privately.

The interface uses React and Tailwind, with a TypeScript/Node.js backend. SQLite
supports local use and PostgreSQL supports hosting. Downloaded packages require
Node.js; they are not self-contained signed installers. Plaid integration currently
uses Sandbox. Provider usage and hosting may incur charges.
