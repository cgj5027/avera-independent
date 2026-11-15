# Desktop downloads and upgrades

Run Avera on macOS, Windows or Linux with a prebuilt package and a supported
Node.js LTS installation. Desktop records are separate from online accounts.
For source setup, see [local setup](LOCAL_SETUP.md).

## What is distributed

`npm run build` and `npm run build:local` both build the independent website.
`npm run package:desktop` assembles `release/avera-desktop` from an explicit allowlist:
backend, shared finance/sample schemas and logic, built website, launch/verification
scripts and the locked JavaScript runtime dependency closure for `pg` and `parse5`.
The independent entry uses explicit public configuration, and a build canary
rejects accidental inclusion of the full public build environment.
It copies their license files and emits notices for modules actually bundled into
the frontend. No installation files, `.env.local`, account data, database, keys,
frontend source tree, development server or npm install
is needed in the resulting package. Its manifest records file hashes, runtime
library versions and their registry integrity metadata.

This candidate **requires an existing supported Node.js LTS installation**, at least
22.18. CI targets Node 22 and 24. It does not include a Node binary, installer,
code signing, automatic updater or background service. Being platform-neutral
JavaScript does not establish that an arbitrary OS/architecture is supported.
Candidate acceptance targets are Windows 11 x64, macOS 14+ on Apple Silicon/Intel,
and Ubuntu 22.04+ x64; other desktops/architectures need a compatible Node runtime
and their own acceptance. The CI runner matrix records automation on its actual
runner OS/architecture; it is not evidence of physical-device or every-version
coverage. Self-contained signed installers are a later packaging decision.

## Obtain and start the candidate

1. Choose a trusted commit and wait for its checks, including all desktop matrix jobs, to pass.
2. Download a desktop artifact from that commit's **Security and validation** run.
   It contains a `.tar.gz` and `.sha256`. Compare its SHA-256 using `Get-FileHash`
   on PowerShell, `shasum -a 256` on macOS, or `sha256sum` on Linux. Obtain both
   from the trusted repository run; hashes alone do not authenticate a publisher.
3. Extract into a **new app folder**. Install supported Node.js LTS from nodejs.org
   if it is not already installed. This package needs no npm install/build.
4. Windows: open `Start Avera.cmd`. macOS: open `Start Avera.command` (OS download
   restrictions may require explicit approval). Linux: run `sh start-avera.sh`.
   All systems can run `node scripts/desktop-launcher.mjs` in the extracted folder.
5. Avera opens its `http://127.0.0.1:PORT` browser page. Keep the terminal open;
   Ctrl+C stops the server. Use `--no-browser` to open the printed URL yourself.
   `--check` verifies the package/runtime without creating a data folder.

Package startup verifies the manifest and binds only to loopback. Startup from a
folder with spaces or an unrelated working directory works. A missing/changed
file fails before the database is opened. Do not edit files inside the package;
private configuration belongs in the separate data folder.

## Data and private configuration

Default locations:

| Desktop | Private data home |
| --- | --- |
| Windows | `%APPDATA%\Avera` |
| macOS | `~/Library/Application Support/Avera` |
| Linux | `$XDG_DATA_HOME/avera`, or `~/.local/share/avera` |

Set `AVERA_HOME` to an absolute writable private folder to override this. The
launcher creates a private `installation.env` there; edit it while Avera is stopped.
Existing process environment values take precedence over this file. Database,
files, vault key, backups and recovery key default to this home, **outside the
replaceable app folder**. Explicit path overrides must be absolute and outside the
package. POSIX creation permissions restrict files/directories; on Windows also
use your private user profile and appropriate OS access controls.

Gateway integrations remain the default. Add your own `AVERA_GATEWAY_URL` and
unique `AVERA_GATEWAY_TOKEN` to `installation.env` to retain connected services.
Preserve your existing email verification settings if used. Never package a
shared provider key or grant. An empty configuration runs manual finances and
samples; online AI, bank refresh, email and current jobs require configuration and
connectivity. Deterministic suggestions can run without their optional AI input.
Local data is not local AI processing. No multi-device sync is enabled.

One launcher holds `desktop.lock` per data home. A second refuses to start. Normal
shutdown releases it and gives the backend time to close SQLite/backup work,
including on Windows through IPC. After a crash/power failure, **confirm every
Avera process using that home is stopped** before deleting a stale `desktop.lock`.
The launcher deliberately does not guess whether an old lock is safe to remove.
Do not run the source server separately against the same database.

## Existing installations and upgrades

A repository-based installation previously used `data/` and `.env.local` beside
the checkout. The desktop launcher does not automatically move or import them.
A new profile/default path is a separate installation; do not mistake its empty
records for data loss. Choose one explicit approach:

- Restore an encrypted portable account backup into a new desktop account. Verify
  counts, totals and samples; follow the restored-bank-history/reconnection flow.
  Preserve your existing credential and recovery material separately.
- For an in-place database connection, stop the old app, retain its full backup
  and original keys, then set absolute `AVERA_SQLITE_PATH`, `AVERA_FILES_PATH`,
  `AVERA_VAULT_KEY_PATH`, `AVERA_BACKUP_DIR` and `AVERA_BACKUP_KEY_PATH` to that
  existing installation's files in the new home's `installation.env`. Transfer
  your private gateway/auth settings securely as well. A vault/recovery key must
  match its encrypted data; a newly generated key is not a replacement.

For subsequent desktop upgrades: stop Avera, keep a verified portable backup,
extract a new app folder and use the **same data home/configuration**. Start the
new app and reconcile your records before removing the older app folder. App
folders and data folders must remain separate. Schema upgrades still use the
encrypted pre-upgrade safety mechanisms; a downgrade needs the matching older database snapshot
and older app. See [recovery instructions](BACKUP_RECOVERY.md).

## Automated checks and remaining gates

`npm run test:desktop` packages into a fresh directory with spaces and runs it
from an unrelated working directory. It verifies hashes/tamper rejection,
allowlisted dependency contents, OS launch script checks, an exclusive home lock,
manual financial writes, income calculation, suggestions, failed online AI,
backup/export, app-folder replacement with preserved data/keys, restore and session
revocation. A Node preload denies external traffic and confirms the configured
unavailable gateway was actually attempted; no real accounts/providers are used.

The existing real browser suite can target the artifact:

```sh
npm run build:local
npm run package:desktop -- /absolute/new/package-folder
AVERA_TEST_DESKTOP_PACKAGE=/absolute/new/package-folder npm run test:local:browser
```

(The environment-assignment syntax above is POSIX; set the variable with your
shell's syntax on Windows.) The workflow runs package checks on Windows, macOS
and Linux with Node 22/24, then uploads only verified preview archives/checksums.
These are CI artifacts, not published production installers or deployments.

Final operator acceptance before cutover:

1. Wait for the final candidate's full CI and OS matrix to pass. Download the updated
   artifact, keep a fresh encrypted backup/original keys, and test the upgraded data
   home. Migration 5 ends old login sessions once; sign in again. Preserve gateway
   configuration. Earlier desktop acceptance is evidence for the prior preview,
   distinct from this updated candidate.
2. If you use external MCP clients, enable the independent endpoint, reconnect and
   verify read-only access and revocation as described in [the MCP guide](MCP.md).
   Old platform authorizations cannot transfer. A cloud client needs a separately
   hosted HTTPS application server, not the headless integration gateway.
3. Compare any original records/files with the independent installation and confirm
   migration/reconciliation or intentional re-entry. Keep verified recovery material
   and hosted database backup/credential recovery available. No production export
   or destructive migration is performed by this branch.
4. Record final device/keyboard/zoom/screen-reader acceptance to the extent required
   for your release. Automated axe checks do not certify all WCAG 2.2 AA criteria.
5. Select the final primary installation and cutover. Version 1 still has no
   multi-device sync. Cancel the original platform only after data, retained live
   providers, recovery and any external client use are accepted. No cancellation,
   new public hosting or deployment is performed automatically.

The old adapter/functions/schemas are retained only under test fixtures to keep
historical regressions. They are not production build inputs or downloadable
runtime dependencies. `npm run check:independent` checks source imports, the
lockfile and built assets for platform dependencies after building.
