# Stage 4: independent connected services

Stage 4 supplies the implementation and synthetic acceptance checks. **Live
provider/auth acceptance is pending.** No provider credentials or authorized live
test accounts were supplied in this workspace. No gateway has been deployed and
no subscriptions have been cancelled. Keep Base44 available until the final exit
and recovery gates pass.

## Data path

The independent build calls its own Node backend. SQLite remains the local
default, with PostgreSQL available for hosting. All thirteen existing application
functions now have independent implementations, including deterministic income,
feedback and goal operations delivered in Stage 3. There are no SDK/runtime
imports in the independent server. Compatibility functions remain unchanged for
regression checks; the portable retained business logic lives under
`server/integrations/logic`.

Gateway is the default integration mode. A local session identifies the user;
only that user's selected personal/sample dataset is assembled for Ask Avera and
suggestions. Provider refresh writes back to that installation's database.
Neither the gateway nor changing a configuration variable synchronizes databases.
Multi-device synchronization remains disabled in version 1.

| Operation | Data leaving the installation |
| --- | --- |
| Plaid Sandbox | Bank authorization/refresh requests; returned accounts and transactions are saved locally |
| Ask Avera | Question, bounded recent conversation turns and selected owned financial context; money calculations remain in code |
| Category suggestions | Merchant descriptions and allowed category labels |
| Bill suggestions | Local recurring-payment evidence first; optional AI classification uses merchant/category/cadence, without balances |
| Job search | User-entered skills/profile and location to AI web search, optional OpenWeb Ninja LinkedIn and Photon geocoding |
| Resume assistance | Separately consented resume bytes/text, with extracted suggestions returned for review rather than auto-saved |
| Account email | Recipient address and expiring verification/reset instructions |
| Google sign-in | Standard OIDC authorization/token exchange; independent session created after identity validation |

AI financial/profile processing is off by default. Enable or revoke it in
Settings → Connected services and AI. Resume processing always requires its own
consent. Disabling AI does not erase finances or bank connections. Recurring-bill
candidates can still be reviewed without AI; they are estimates and nothing is
selected or added automatically. Manual finance workflows continue offline.

Avera does not persist assistant conversations. OpenAI Responses requests set
`store:false`; this does not promise zero provider retention or change provider
training/retention terms. Approve the final disclosure and provider contracts
before use with real personal data. No model output executes payments.

## Default local setup: use an operator-controlled gateway

1. Obtain an HTTPS gateway address and a **unique installation grant** from the
   gateway operator. There is no preconfigured public Avera gateway.
2. Set these backend-only values in the installation's ignored `.env.local` or
   secret manager, then restart. Do not prefix credentials with `VITE_`.

```dotenv
AVERA_INTEGRATION_MODE=gateway
AVERA_GATEWAY_URL=https://your-avera-gateway.example
# AVERA_GATEWAY_TOKEN is supplied securely by your operator.
AVERA_SYNC_ENABLED=false
```

The gateway client appends `/gateway/v1/invoke` to this URL. HTTPS is required
except loopback HTTP for development. No gateway configuration means explicit
online-service unavailability; there is no silent direct-provider fallback.
Settings shows configuration availability, not a guarantee a subscription is
currently authorized. Bank connections show their last successful refresh and
errors. A gateway outage does not move or delete local records.

The installation grant belongs only on the local backend. It is distinct from
shared provider keys. Treat it as a credential, revoke it if lost, and never
include it in a public/downloadable distribution or ordinary export.

## Gateway operator setup

Use a separate installation/database and a controlled TLS reverse proxy. The Node
server binds loopback by default. For managed Render hosting, use the
[Render setup](RENDER_SETUP.md), which explicitly enables container networking.
Set `AVERA_PUBLIC_ORIGIN` to the exact public HTTPS origin;
the reverse proxy must forward the correct Host, enforce TLS and body/time limits,
and avoid logging credentials, request bodies, reset links or callback queries.
For a headless gateway, run `server/gateway.ts` with `npm run start:gateway`.
The same route can also be hosted by `start:local` when explicitly configured.
Neither command deploys a public service.

Create one new private grant file per installation with:

```sh
node scripts/create-gateway-grant.mjs /private/new-installation-grant.json
```

The helper creates a random token in a new mode-0600 file and does not print it.
Combine authorized entries into the operator's private JSON array and set
`AVERA_GATEWAY_GRANTS_FILE` to that file. Transfer each token through a secret
manager. Never put this file under source control. Remove its entry and restart
the gateway to revoke access. A stable, unique grant ID namespaces its local user
IDs; reusing/reassigning IDs can change access to existing bank handles.

Supply the retained provider credentials on the gateway server only:

| Variable | Purpose |
| --- | --- |
| `OPENAI_API_KEY`, optional `OPENAI_MODEL` | AI, structured suggestions and web search; default model `gpt-4.1-mini` |
| `PLAID_CLIENT_ID`, `PLAID_SECRET` | **Sandbox only**, preserving current application scope |
| `OPENWEBNINJA_API_KEY` | Optional LinkedIn source; AI web search remains the fallback |
| `RESEND_API_KEY`, `AVERA_EMAIL_FROM` | Transactional verification/recovery email; verify the sender domain |
| `AVERA_VAULT_KEY` | 32 random bytes encoded as base64; mandatory with configured PostgreSQL storage |

Photon uses its fixed public endpoint. Confirm service terms, limits and sender/
provider permissions separately. No custom browser-supplied provider URLs are
accepted. Requests reject redirects, have time/response limits, and return
sanitized errors. Persistent per-user minute/day limits fail closed if their
storage is unavailable; gateway grants also have aggregate limits. Provider
quotas/pricing still apply.

The gateway accepts bearer-authenticated server calls, rejects browser Origin
requests, namespaces actors by the authenticated grant, and holds real Plaid
tokens in its encrypted vault. It returns opaque, actor-bound bank handles to the
local backend. Another actor or installation cannot use that handle. The gateway
stores operational credentials, expiring email jobs and cleanup state, **not a
replicated financial database**.

## Advanced direct connections

Set `AVERA_INTEGRATION_MODE=direct` and configure the same provider variables on
the local backend. This uses the same service/business rules without the gateway.
Each operator owns its credentials; downloaded packages must never contain shared
keys. Missing providers fail explicitly. There is no fallback to Base44.

## Authentication

Password accounts remain usable without connected services. For verified new
accounts and email recovery, explicitly set `AVERA_AUTH_EMAIL=true` after
configuring email transport. Configuration rejects enabling this without a
configured direct sender or gateway URL/grant. A configured gateway must actually
have a working sender: availability is a live acceptance check, not inferred from
its URL. Never disable verification as an outage workaround for pending accounts.

Verification codes expire after ten minutes and five attempts. Email sends are
queued encrypted and retried while their challenge is valid. Reset requests use
the same response for known/unknown accounts and do not wait for provider delivery;
reset tokens are hashed, expire after thirty minutes and are single-use. A reset
revokes all existing sessions. Requests/attempts have persistent limits. Inspect
sender delivery status if mail does not arrive; no SMTP inbox was exercised here.
Expired challenge rows are pruned during account operations.

Existing Stage 3 accounts stay usable after migration. With email enabled they can
request verification through `/register?verify=their-email` without changing their
password. Forgotten passwords on email-disabled installations still have no email
recovery; encrypted backup/recovery is Stage 6, not implemented by this stage.

Optional Google OIDC uses `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` on the
**auth-hosting backend**. Register its exact callback URL:
`<origin>/api/v1/auth/google/callback`. The gateway does not act as a shared Google
OAuth broker for downloaded installations: a direct local Google login requires
an operator-owned client configured for its fixed loopback origin/port. Hosted
Google login uses the hosted origin. Never bundle shared Google secrets.

State, PKCE, nonce, signature/JWKS, issuer, audience, expiration and verified email
are checked. Callbacks are single-use. Google cannot silently take over an
existing unverified local email. Cookies are HttpOnly, SameSite=Lax and Secure
under HTTPS. The UI advertises recovery/Google only when configured; secrets are
never included in public settings. Existing sessions remain valid on offline
restarts until expiration.

The historical Base44 MCP publishing/authorization service remains compatibility
infrastructure; independent inbound MCP publishing is a separate Base44-exit
acceptance gate. Its consent port deliberately remains unavailable rather than
issuing grants that no independent MCP server can honor. This is separate from
Ask Avera and outgoing provider calls, which are implemented here.

## Credentials, resumes and recovery

AES-256-GCM protects private connection tokens/cursors, Google challenge payloads,
mail outbox and pending remote-file deletion entries. Public record APIs cannot
read these collections. For SQLite a mode-0600 vault key is generated beside the
database unless `AVERA_VAULT_KEY` or `AVERA_VAULT_KEY_PATH` is supplied. Keep the key
and database private; encryption is not a substitute for full-disk encryption.
Protect a separate copy of this key through your secret manager. Losing it can
require bank reconnection; it does not encrypt ordinary financial rows. Do not
rotate it by simply replacing the value: key rotation/migration is not implemented.

Resumes are validated for content/signature, filename, size (5 MB; text 60 KB),
encoding and consent. No caller-selected URI or public download URL is accepted.
Text goes directly to AI. Binary resumes are sent from request memory through
a private provider upload, without a local document copy. Provider files request
one-day expiration and deletion in `finally`; failed deletions remain encrypted
and retry during processing, at startup and in thirty-second background maintenance. Confirm
provider deletion/expiration support during live acceptance. Retention is not
claimed to be zero, including after a crash. File IDs and document contents are
not logged. Convert unsupported Word formats to PDF/text if the provider rejects
them; verify all promised formats before release.

Bank imports use stable keys and ownership/dataset validation. A persistent lease
serializes bank operations for an owner, including across server processes. A
crashed operation's lease expires after three minutes. A failed/overlarge refresh
retains the old cursor; partial writes are idempotent and retried before advancing
it. Bank imports are not one transaction across the network. Check status before
using balances; partial results must not be represented as a complete refresh.

Ordinary exports must exclude the private vault/outbox. The encrypted backup,
separate credential recovery, retention schedule and guided restore described in
the approved plan still belong to Stage 6. Do not treat copying an active SQLite
file as an implemented backup or remove Base44 yet.

Job searches now [check source-page availability](JOB_AVAILABILITY.md) before
returning independent results. Closed/expired and unconfirmed postings are omitted;
the UI shows check times and exclusion counts. Availability can change afterward.

## Live acceptance still required from the owner/operator

- Provision the gateway hosting/TLS and unique installation grants, or choose an
  advanced direct setup. Provide secrets through the host's secret manager.
- Use authorized test accounts to exercise Plaid Link, exchange, initial/modified/
  removed transactions, reconnect, outage/retry and disconnect. Current code is
  Sandbox-only; production Plaid access is a separate provider approval/change.
- Exercise AI answers, category updates, local/AI bill review, web results,
  LinkedIn fallback and geocoding against retained subscriptions. Confirm model
  capabilities, quotas, citations/listing accuracy and privacy/retention terms.
- Verify real email delivery, code expiration/resend, reset-link origin, session
  invalidation and Google consent/callback on the intended origins. Test actual
  PDF/Word/text extraction and remote cleanup/expiration.
- Approve AI-sharing disclosures and participate in manual accessibility and
  Windows/macOS/Linux acceptance in the later stages.

Fixture results establish implementation behavior, not provider certification or
production readiness. The stage remains **live acceptance pending** until these
results are recorded; Stage 5 does not imply these external gates have passed.
