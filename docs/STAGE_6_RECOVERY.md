# Stage 6: backup, transfer and recovery

The independent runtime provides **Settings → Backups & recovery**. This covers
one signed-in account's personal records, saved sample datasets, relationships and
retained attachments. It never exports passwords, sessions, provider keys, gateway
grants or bank authorizations. Guests and the Base44 compatibility adapter do not
expose recovery. Multi-device synchronization remains disabled.

## Installation and automatic copies

On startup the local runtime applies migration 4 (additive recovery/file tables).
An existing SQLite installation first creates an encrypted, integrity-checked
installation snapshot using SQLite's supported online backup API. Failed upgrade
backup prevents migration. New databases do not need that snapshot. PostgreSQL
operators must take a provider database backup before upgrading; the application
cannot configure Render backups or point-in-time recovery for you.

Defaults, relative to the SQLite database directory:

| Setting | Default / purpose |
| --- | --- |
| `AVERA_BACKUP_DIR` | `backups`; private encrypted archives, outside web assets |
| `AVERA_BACKUP_KEY_PATH` | `backup.key`; automatically generated 32-byte installation key, outside archive/copy directories |
| `AVERA_BACKUP_COPY_DIR` | unset; optional mounted separate drive/private off-device folder |
| `AVERA_BACKUP_MAX_BYTES` | `536870912` (512 MiB), catalogued archive limit across accounts; configurable 32 MiB–10 GiB |

Keep the original `backup.key` and its `.id` fingerprint in a separate secure
recovery location. Do not commit them, include them in a downloadable package or
keep their only copy with the archives. Losing the key makes automatic archives
unrecoverable. A missing/changed key does not silently create a replacement;
ordinary finance use and passphrase exports remain available, but automatic
backup/restore waits for the original key and a restart.

While the runtime is running it checks every minute: at most one daily archive
per UTC date and one weekly archive per seven-day epoch bucket. Each account keeps
seven daily, four weekly, three manual and three pre-recovery safety archives.
Stopping Avera stops the scheduler. Same-disk copies do not protect against disk
loss. Off-device copying is optional, verified and reported separately; an
unavailable drive does not invalidate a successful local copy. Retention also
removes corresponding optional copies. Maintain independent long-term copies if
needed. Pre-upgrade installation archives are retained separately and require
operator storage monitoring. The configured cap covers catalogued account
archives, not these installation snapshots, temporary working space or other files.

SQLite account capture uses an online database snapshot and extracts only the
owner's records. PostgreSQL uses a consistent repeatable-read transaction. Archives
use AES-256-GCM and a salted scrypt-derived key; portable passphrases require at
least 16 characters. Crypto work is queued and bounded. Files are verified after
writing before a backup is catalogued. Disk/permission/key/limit/copy failures are
shown in Settings; free space or fix the selected directory and retry.

## Portable backup and guided restore

1. Open Settings, expand **Download an encrypted portable backup**, choose and
   repeat a unique passphrase, and download the `.avera` file.
2. Keep the file off the computer and the passphrase separately, for example in
   your password manager. Avera cannot reset this passphrase.
3. On the destination installation, create/sign in to an account. Expand
   **Review or restore a backup**, choose the file and enter its passphrase.
4. Preview the date, dataset and collection counts, attachments and exact saved
   money totals. This is a reconciliation of saved numbers, not a forecast.
5. Type `RESTORE` and apply. A verified encrypted copy of the current account is
   saved first. Replacement, relationship remapping and reconciliation commit
   together; failures roll back. A stale/expired preview requires a fresh preview.
6. Sign in again with the destination account's existing password. All sessions
   are revoked to discard stale editors. Other accounts are untouched. To undo a
   successful restore, review the **Before recovery** safety copy in the same UI.

Local bank links are deactivated during recovery; remote bank authorizations are
not revoked by an offline restore. Finish removal through Bank connections when
online. Restored bank accounts/transactions remain explicitly labelled disconnected
history. Reconnection is blocked until **Review bank history cleanup** is previewed
and confirmed through the same safety-copy flow. Cleanup removes restored bank
history and its linked attachments, preserving manual records, so a fresh import
cannot silently double-count that history. Provider secrets are never moved by a
portable backup. Reconnect with your own gateway installation grant afterwards.

Supported archives: format version 1, schema 4; at most 10,000 financial records,
200 retained attachments, 4 MiB per attachment and 32 MiB total serialized archive.
Oversize data fails explicitly, never truncates. Attachment bytes, hashes and
record relationships are checked. Recovery retains imported attachments privately
and exposes an authenticated owner-scoped retrieval port; this stage does not add
a general attachment browsing/upload product. Legacy resume filesystem blobs are
covered by installation snapshots, not ordinary account archives. Retain/re-upload
those separately when transferring an account.

## Authorized Base44 export migration

No live Base44 data is fetched by this stage. Obtain an authorized JSON export
before cutover; keep the original unchanged and private. The preparation tool
accepts an object with entity-name arrays and optional `attachments` (base64 data,
SHA-256, name, MIME type and record linkage). Every row/file must identify the
same source owner via `created_by_id` or `created_by`. It rejects unsupported
relationships and invalid financial fields; provider token rows are excluded.
Vendor CSV or a different export shape needs an explicit conversion first.

```sh
npm run recovery -- prepare-migration /private/authorized-export.json /private/owner.migration.json SOURCE_OWNER
```

The output is sensitive plaintext (new file only, owner-only permissions on POSIX).
Use an empty destination account, select **Prepared migration JSON**, preview and
compare counts/totals/attachments with the authorized source, then type `IMPORT`.
Colliding IDs are remapped with their relationships; existing other-owner records
remain untouched. Repeated/nonempty imports are rejected. No credentials migrate.
After acceptance, securely manage/delete temporary plaintext copies according to
your retention policy. A real migration still needs the owner's source export and
reconciliation; fixture success does not establish production completeness.

## Disaster recovery and version rollback

An automatic account archive can be converted on a working installation using the
original installation key. The new portable passphrase is entered without echo in
an interactive terminal (never put it in command arguments/environment variables):

```sh
npm run recovery -- rewrap-automatic /private/backups/account.avera /private/portable.avera /secure-keys/backup.key
```

For a pre-upgrade SQLite installation snapshot, stop Avera and stage a recovery
into a **new** directory. This never overwrites the current database:

```sh
npm run recovery -- unpack-installation /private/backups/pre-upgrade.avera /private/recovered-installation /secure-keys/backup.key
```

The tool verifies SQLite integrity/schema, extracts safe legacy private-file paths
and invalidates old sessions/challenges. Follow the staged `RESTORE.txt`. Use the
matching older app release for a schema downgrade; an ordinary account restore
never downgrades the database. Preserve the failed installation until verification.
Restore the original credential vault key, backend `.env.local`/secret settings and
installation grant separately; they are deliberately absent from the archive.
Review encrypted pending email/provider state before enabling services. Copying a
live SQLite database file is not an acceptable backup procedure.

Hosted operators: provision persistent private backup/key directories, configure
provider automated backups/PITR where the selected plan supports them, retain
separate vault/grant/secret recovery material, and rehearse provider restoration to
an isolated database and service with controlled HTTPS. Never point a rehearsal
at the production database/providers. The headless Render gateway does not run the
account recovery UI/scheduler; its PostgreSQL and credentials need operator-level
backup. Record actual provider retention, RPO/RTO and restore evidence. Local goals
remain no more than one day of lost work when backups ran and recovery within an
hour with a valid archive/device; these are targets, not guarantees.

## Release evidence and owner acceptance

Automated coverage exercises real disposable SQLite/PostgreSQL, encrypted transfer
between engines, counts/totals/relationships/attachment hashes, owner isolation,
corruption/wrong keys, stale previews, interrupted rollback, full storage, off-device
failure, retention, missing keys, bank-history cleanup and pre-upgrade unpacking.
Browser tests cover backup/export/preview/restore/reauthentication at four widths
and both themes, plus migration and axe checks. CI runs these checks independently.

Before real cutover, the owner must keep recovery material off-device, perform a
portable restore rehearsal on a separate installation, reconcile an authorized
source export, and configure/rehearse hosted database recovery. Windows/macOS
packaging, manual assistive-technology/zoom acceptance and Base44-disabled live
provider acceptance remain Stage 7/release gates. Base44 must remain available
until those gates pass. No production migration or deployment is performed here.
