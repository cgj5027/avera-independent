# Full online Avera on Render

This deploys the full financial website, separate from the existing provider gateway.
The same source still runs locally with SQLite on Windows, macOS and Linux. Online
accounts use this new PostgreSQL database from any browser. Desktop and online
records do not synchronize in V1; portable encrypted export/import is an explicit
transfer. Both modes run from this repository.

## 1. Prepare the release and credentials

Merge the hosted-app PR only after **Security and validation** is green, including
the desktop matrix. Keep a current encrypted export of the installation whose
records you intend to transfer, its passphrase, original keys and record totals.
Keep the existing application available until the online version is accepted.

In a current source checkout, run the following from its terminal. The destination
must be a **new directory outside the repository**, with an existing parent:

```sh
npm run hosted:secrets -- "$HOME/avera-hosted-private"
```

Windows PowerShell: use a new path such as `"$env:USERPROFILE/avera-hosted-private"`.
The helper writes private files without printing credentials or overwriting an
existing folder. Store them in your password manager or encrypted recovery storage.
Do not commit them, put them in `VITE_` variables or send them in chat.

On the **existing avera-gateway** Render service, find the secret JSON file named
by `AVERA_GATEWAY_GRANTS_FILE`. Append the single object from
`gateway-grant-to-add.json` to its **current JSON array**, preserving every existing
grant and valid JSON commas/brackets. Save/restart the gateway. Do not replace its
array with the single object; do not change its vault key or desktop grants.
If you have an up-to-date private copy of the current grants file, the helper can
produce a merged array for review:

```sh
npm run hosted:secrets -- "$HOME/avera-hosted-private" /private/path/current-grants.json
```

Choose one helper invocation. An old local grants copy may omit current grants;
compare any merged file with the live gateway configuration before replacing it.
The new website receives a distinct installation grant and a new vault key.
Existing desktops keep their settings and provider connections.

## 2. Create the paid online resources

In Render, choose **New → Blueprint**, connect `cgj5027/avera-independent`, select
`main` and its root `render.yaml`. This file declares only:

| Resource | Configuration | Approximate monthly cost |
| --- | --- | --- |
| `avera-web` | Node 24, `1c-2g`, 2 GB RAM | $25 |
| `avera-financial-db` | PostgreSQL 16, `0.1c-256mb` | $6 |
| Database storage | 5 GB | $1.50 |
| Web private persistent disk | 2 GB | $0.50 |

Expected additional total: **about $33/month**, excluding tax, existing gateway,
provider usage and overages. Review Render's actual estimate before applying.
For light personal use, changing the web service's `plan` in `render.yaml` to
`0.5c-512mb` reduces web compute to about $7/month and the additional total to
about $15/month. Monitor memory, especially during backup/restore; upgrade if
Render reports out-of-memory restarts. Keep the Blueprint plan consistent with
your chosen instance size so a later sync does not revert a dashboard-only change.
Both resources use Virginia; edit both regions before first creation if needed.
The PostgreSQL external IP allow-list is empty; the web service uses its internal
connection string. Do not reuse the gateway database.

The preview must show only these **new** resources. Render can adopt an existing
resource with a matching name: if either name already exists, rename the new
resource and its database reference before applying. Preserve the existing gateway.

Enter the two requested values from `hosted-secrets.env`:

- `AVERA_GATEWAY_TOKEN`
- `AVERA_VAULT_KEY`

Apply the Blueprint and wait for its database and web service to become healthy.
The Blueprint attaches a persistent disk at `/var/data` and sets private files,
encrypted archives and the generated recovery key under `/var/data/avera`.
**Do not start without that disk or replace the vault/recovery keys after data exists.**
Keep `AVERA_PUBLIC_ORIGIN` unset initially: the service uses Render's supplied
HTTPS URL while staging. `PORT` is read automatically; do not enter `$PORT` as a
literal environment value. Build and start commands are supplied by the Blueprint.
Deploys follow successful checks on `main`.

## 3. Validate on the temporary Render URL

Open the **new web service's URL**, not the gateway URL. The gateway remains
headless. Before changing DNS, verify:

1. Create an account, receive its Resend code, verify and sign in.
2. Create a synthetic manual transaction/bill and confirm list entries and totals.
   Restart the service and confirm persistence. Test at mobile and desktop sizes.
3. Request a password reset and use its link. Links must use this website's HTTPS
   address. A missing email commonly means the new gateway grant was not appended
   correctly; inspect status/logs without posting secrets.
4. In Settings, confirm services and explicit AI consent. Check Ask Avera,
   suggestions, location and a Plaid Sandbox connection. OpenWebNinja can remain
   unset; existing fallback behavior is retained. Live provider checks are separate
   from synthetic CI tests. Google sign-in is not enabled by this Blueprint.
5. In Settings → Backup and recovery, create a passphrase-protected portable export,
   save it off-service and rehearse a restore in a disposable installation.

If transferring personal records, use an encrypted portable export from the
current installation and restore it into the intended new online account. Read
the restore preview; compare record counts, balances, source labels and financial
totals before accepting the website as primary. This does not migrate account
passwords or silently transfer provider tokens. Review bank connection/history
reconciliation before reconnecting, to avoid importing duplicate transactions.
See [recovery](BACKUP_RECOVERY.md) for supported scope and restore safeguards.

## 4. Move avera.run after staging passes

Record existing Cloudflare `@` and `www` values for rollback. In the **new web
service's Settings → Custom Domains**, use `avera.run` (the Blueprint requests it).
Render normally adds `www` with a redirect to the root domain. Follow the exact
DNS targets displayed there; do not invent an IP or point at the gateway.

In Cloudflare → `avera.run` → DNS → Records, update the existing root and `www`
records to the targets provided by Render. Use **DNS only** initially for domain
verification and certificate issuance. Resolve duplicate/conflicting root or `www`
records; retain the previous values for rollback. Preserve all Resend records,
including `resend._domainkey`, `rsend`, `send` and `_dmarc`. An existing Cloudflare
`www` redirect may remain if it consistently redirects to `https://avera.run`.

Set **`AVERA_PUBLIC_ORIGIN=https://avera.run`** on the **new web service**, save
and redeploy as DNS is switched. Wait for Render domain verification and HTTPS,
then repeat account, email, data, AI and backup checks at `https://avera.run`.
Visitors to `www` must arrive at the root URL. Request a fresh reset link after
changing origins. Once canonical origin is set, the Render hostname accepts only
its exact GET `/api/v1/health` probe; other paths there intentionally return 421.
If rolling back DNS, revert the website's canonical origin consistently as well.

Only retire the old website after these public checks and data reconciliation
pass. Keep the previous installation and its records until data transfer and totals
reconciliation are accepted. Subscription cancellation is a separate operator decision.

## Operations and recovery

The web service is a single instance because uploads and backup keys use its
persistent disk. Disk-backed Render deploys have a brief interruption; do not
enable multiple instances without moving this private storage to a shared adapter.
PostgreSQL is the source of financial records; a disk alone does not back it up.

Confirm Render's database recovery/PITR retention for the selected paid plan.
Keep its recovery options enabled and periodically test recovery in a separate
database/installation. In addition, retain off-service encrypted portable exports
and their passphrases. Store the **hosted vault key**, **recovery key**
(`/var/data/avera/backup.key` and its companion ID), installation grant and any
other private files in secure off-service recovery storage. Provider database
backups without the original keys cannot decrypt private integration data.

Routine application archives run daily with the established retention limits
(7 daily, 4 weekly, 3 manual, 3 safety). They share this disk and are not sufficient
for a Render account/disk disaster. Monitor the 2 GB disk and 5 GB database and
export regularly; the existing application archive size limit is 512 MiB.
Never restore over production as a rehearsal. Restored bank authorization and
external-client grants require explicit review/reconnection as documented.

MCP remains disabled by default and is not required for Ask Avera. If later enabled,
use the final website's HTTPS origin, the existing OAuth consent flow and explicit
external-client acceptance. Hosted accounts are usable across browsers; this does
not enable automatic synchronization with independent desktop installations.

References: [Render Blueprint specification](https://render.com/docs/blueprint-spec),
[Render pricing](https://render.com/pricing),
[custom domains](https://render.com/docs/custom-domains),
[persistent disks](https://render.com/docs/disks), and
[PostgreSQL recovery](https://render.com/docs/postgresql-backups).
