# Run Avera locally from source

For a prebuilt download, use [the desktop guide](DESKTOP.md) instead.
Source setup requires Git and Node.js 24 LTS (minimum 22.18); CI exercises Node 22 and 24.

```sh
git clone https://github.com/cgj5027/avera-independent.git
cd avera-independent
npm ci --ignore-scripts
npm run build
npm run start:local
```

On macOS, open Terminal and use `cd` to enter your checkout. The same commands work
in Windows PowerShell and Linux terminals. Open the printed loopback URL, usually
http://127.0.0.1:4175. Create a local account with a 12–128 character password.
Keep the terminal running; Ctrl+C stops the server. Without configured email,
email verification/reset is unavailable. Manual records and sample data work offline.

## Configure your installation

Copy `config/server.example.env` to `.env.local` and edit it privately, or supply
backend environment variables. `start:local` loads this file automatically.
Do not commit it or use `VITE_` variables for credentials.

| Setting | Default / purpose |
| --- | --- |
| `AVERA_PORT` | `4175`; `0` chooses an available loopback port |
| `AVERA_DATA_STORE` | `sqlite` |
| `AVERA_SQLITE_PATH` | `data/avera.sqlite` |
| `AVERA_FILES_PATH` | `data/files` |
| `AVERA_INTEGRATION_MODE` | `gateway` |
| `AVERA_GATEWAY_URL` | Your operator's HTTPS gateway |
| `AVERA_GATEWAY_TOKEN` | A private installation-specific grant |
| `AVERA_SYNC_ENABLED` | `false`; synchronization is unavailable in V1 |

See [connected services](CONNECTED_SERVICES.md) for email, AI and bank setup.
Missing provider configuration does not prevent manual financial use.
Advanced PostgreSQL installations require `AVERA_DATABASE_URL` and a dedicated
`AVERA_VAULT_KEY`. Public hosting uses [the hosted guide](HOSTED_APP_SETUP.md),
not a public bind on the desktop/local command.

## Protect and upgrade your data

Source data defaults to `data/` in your checkout. Use absolute private paths outside
the checkout if you will replace or delete that folder. Retain your database,
private files, vault key, recovery key and configuration. Changing a path selects
a different destination; it does not migrate records. SQLite is not encrypted at
rest by Avera; protect your computer with OS encryption and access controls.

Use [encrypted portable backups](BACKUP_RECOVERY.md), not a copy of a live SQLite
file. Preview a downloaded export to check its counts/totals without restoring.
To upgrade: back up, stop Avera, update the source, run `npm ci --ignore-scripts`
and `npm run build`, then start with the same data paths and keys. Do not downgrade
an upgraded database without the matching backup and application version.

Local accounts and the hosted website are separate. Transfer records explicitly
with encrypted export/import; provider authorizations and passwords are not copied.

## Troubleshooting

- Port in use: stop the existing instance or change `AVERA_PORT`.
- Missing build: run `npm run build` before starting.
- AI/email/jobs unavailable: check gateway URL, installation grant and operator provider status.
- Missing or changed encryption key: restore the original key; do not generate a replacement over existing data.
- Development UI: see [contributing](../CONTRIBUTING.md).
