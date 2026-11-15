# Connected services

Manual finances and samples do not require provider accounts. AI, bank refresh,
job search and account email require an operator-configured gateway (the default),
or advanced direct connections. [Gateway hosting](GATEWAY_SETUP.md) is separate
from [hosting the financial website](HOSTED_APP_SETUP.md).

## Configure a local installation

Obtain an HTTPS gateway address and unique installation grant from your operator.
Set the following in `.env.local` for source installations, or `installation.env`
in the desktop's private data home. Restart after editing. Never use `VITE_` variables.

```dotenv
AVERA_INTEGRATION_MODE=gateway
AVERA_GATEWAY_URL=https://your-gateway.example
AVERA_GATEWAY_TOKEN=YOUR_PRIVATE_INSTALLATION_GRANT
AVERA_SYNC_ENABLED=false
```

The URL must be the gateway origin, without `/gateway/v1/invoke` appended. HTTPS
is required except loopback development. Do not put shared provider keys or grants
inside a downloadable package. A missing or unavailable gateway produces an
explicit service error; manual records remain available. Configuration status
is not a guarantee that provider credits/subscriptions are active.

The gateway namespaces each installation and local account. Provider refresh
writes to that installation's database. Neither the gateway nor changing variables
synchronizes independent databases; desktop/online synchronization is unavailable in V1.

## Data sharing and consent

| Operation | Data leaving the installation |
| --- | --- |
| Plaid Sandbox | Bank authorization/refresh requests; returned accounts and transactions are saved locally |
| Ask Avera | Question, bounded recent conversation turns and selected owned financial context; money calculations remain in code |
| Category suggestions | Merchant descriptions and allowed category labels |
| Bill suggestions | Local recurring-payment evidence first; optional AI classification uses merchant/category/cadence, without balances |
| Job search | User-entered skills/profile and location to AI web search, optional OpenWeb Ninja LinkedIn and Geocodio geocoding |
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

## Gateway operator setup

Use a separate installation/database and a controlled TLS reverse proxy. The Node
server binds loopback by default. For managed Render hosting, use the
[Render setup](GATEWAY_SETUP.md), which explicitly enables container networking.
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
| `GEOCODIO_API_KEY` | Required for distance-limited searches; set on gateway or direct server only |
| `OPENWEBNINJA_API_KEY` | Optional LinkedIn source; AI web search remains the fallback |
| `RESEND_API_KEY`, `AVERA_EMAIL_FROM` | Transactional verification/recovery email; verify the sender domain |
| `AVERA_VAULT_KEY` | 32 random bytes encoded as base64; mandatory with configured PostgreSQL storage |

See [Geocodio setup and rollout](GEOCODIO_SETUP.md). Geocodio uses its fixed API
v2.1 endpoint and a backend-only key. Confirm service terms, limits and sender/
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

## Direct connections and account email

Advanced operators may set `AVERA_INTEGRATION_MODE=direct` and configure provider
variables on their own application backend. Missing providers fail explicitly.
Retain each installation's original private vault key and back up its configuration.

Enable `AVERA_AUTH_EMAIL=true` only after configuring working Resend transport,
either through the gateway or directly. New accounts then require a verification
code and support password reset. Hosted origins must be exact HTTPS URLs so reset
links point to the correct website. Do not disable verification to work around an
email outage. Local accounts without email transport do not have email recovery.

Optional Google OIDC needs `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` on the
application backend, with the correct callback configured at Google. It is not
enabled by the default hosted Blueprint. Password sign-in remains available.

[Encrypted backup and recovery](BACKUP_RECOVERY.md) covers record transfer,
original-key retention and off-service recovery. Provider database recovery and
private gateway grants/keys must also be retained securely. Ordinary record
exports deliberately exclude provider tokens and account passwords.

[MCP](MCP.md) is optional read-only access to the financial application; it is
separate from Ask Avera, requires its own consent and is disabled by default.
