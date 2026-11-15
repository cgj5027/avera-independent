# Independent read-only MCP

Avera now owns its inbound MCP service. It is separate from Ask Avera and the
provider gateway. It is **off by default**; enabling it never grants a client
access without an approval. Disabling the endpoint suspends access; re-enabling
can resume unexpired approvals. Revoke clients before disabling if you want their
access permanently removed. A user must sign in, inspect the client and requested
permissions, and approve each connection.

## Connect a local desktop AI client

1. Install a current checked release and retain your existing encrypted backup,
   gateway settings and original key files. Stop Avera.
2. In the private data home's `installation.env`, add `AVERA_MCP_ENABLED=true`.
   On Mac the default home is `~/Library/Application Support/Avera`; Windows uses
   `%APPDATA%\Avera`; Linux uses `$XDG_DATA_HOME/avera` or `~/.local/share/avera`.
3. Restart Avera. Migration 5 adds independent authorization tables and ends older
   login sessions once. Sign in again with your existing Avera password. Your
   financial records, gateway grant and vault/recovery keys stay in place.
4. In an AI client that supports **Streamable HTTP MCP with OAuth**, add
   `http://127.0.0.1:4175/mcp` (use your configured Avera port if different).
5. The client discovers the authorization server and registers a public OAuth
   client. In Avera's consent page, verify your account, the client name and its
   redirect origin. Names are supplied by clients; approve only a connection you
   started and trust. Approve or deny explicitly.
6. Test listing/getting one personal record, then revoke the connection in
   **Settings → General → Connected AI clients**. A subsequent request must fail.
   Reconnect through the client if you want to keep using it.

Do not enter an OpenAI/Plaid/Resend key or the integration gateway grant into an
MCP client. Those are not MCP credentials. The client receives its own scoped
OAuth tokens after approval. Authorizations from other installations do not transfer; remove
those old connections and reconnect explicitly to Avera.

Some local clients support only stdio servers or static headers; those are not
compatible with this OAuth/Streamable HTTP endpoint. Registered callbacks must be
HTTPS, or HTTP loopback for native clients. Arbitrary custom URI schemes and
redirects into a loopback `/api` path are rejected. A client must support PKCE
S256, the `avera:read` scope and RFC 8707 resource indicators.

## What approval shares

Two tools are available:

| Tool | Access |
| --- | --- |
| `avera_list_records` | A personal-record collection, up to 50 rows with an owner-bound pagination cursor |
| `avera_get_record` | One personal record, checked against the authorized owner |

Collections cover accounts, transactions, bills, budgets, household/income,
goals/contributions, forecasts, property/mortgage, opportunity profiles and public
bank connection status. Saved sample datasets are excluded. Provider identifiers,
private files/resume blobs, encrypted credentials, passwords, sessions and gateway
keys are excluded. Tools cannot create, change or delete records, call providers,
move money or authorize payments. Source labels remain attached to record data.

This is explicit sharing of personal data with the approved client and any AI
service that client uses. Its retention/training policy is separate from Avera's
Ask Avera consent. Revocation stops future requests; it cannot retract copies a
client already received. A financial-record restore, installation recovery or
password reset revokes existing MCP grants. A changed tool-permission set also
requires fresh authorization. Signing out alone does not revoke an approved client.

## Hosted/cloud clients

A cloud-hosted AI client cannot reach a desktop's loopback address. It needs a
separately operated **Avera application server** behind controlled public HTTPS,
with its own private configuration, financial database, auth and backup/recovery.
Set `AVERA_PUBLIC_ORIGIN` to that exact HTTPS origin and `AVERA_MCP_ENABLED=true`;
the existing server can stay bound to loopback behind the TLS reverse proxy.
Serve the independent `dist-local` build and route discovery, `/oauth/*`, `/mcp`
and the Avera UI/API through that same origin. Use the earlier separate-installation
and TLS guidance; do not expose the database itself.

The existing `https://avera-gateway.onrender.com` is a **headless integration
gateway**, not this financial application server. Do not enable MCP on it or reuse
its database as a shortcut. The code rejects MCP in headless gateway mode. Nothing
in this release provisions a new host, publishes a tunnel or copies your data.

MCP reads the database belonging to the installation that serves it. There is no
multi-device sync: a separate hosted installation does not automatically reflect
edits on a desktop. Choose the intended primary installation or use an explicit
backup/import and reconciliation. Keep the chosen host's credential/vault recovery
and database backups separate and tested.

Native/server-side clients normally send no browser Origin header. Browser clients
must use the same origin or an operator-selected exact HTTPS/loopback origin in
`AVERA_MCP_ALLOWED_ORIGINS` (comma-separated, no wildcard). This is a CORS/origin
allowlist, not authorization; a valid scoped bearer token is still required.

## Protocol and security

Discovery: `/.well-known/oauth-protected-resource/mcp` (also root protected-resource
metadata) and `/.well-known/oauth-authorization-server`. Public client registration:
`POST /oauth/register`. Authorization code flow: `GET /oauth/authorize`, then
`POST /oauth/token` using form encoding. Revocation: `POST /oauth/revoke`.

The MCP transport is stateless POST with JSON responses; it does not offer an SSE
GET stream. It negotiates 2025-11-25, 2025-06-18 or 2025-03-26 protocol versions.
A bearer token is required even to initialize/list tools. Cookie sessions cannot
act as MCP tokens. The server validates Host, Origin and resource audience, rejects
unsupported methods/arguments and rate-limits registration/token/RPC activity.

Consent handles expire after ten minutes and bind to the signed-in account;
authorization codes expire after one minute. PKCE S256 is mandatory. Access tokens
last one hour; rotating refresh tokens last thirty days. Code/refresh replay revokes
the grant. Only hashes of codes/tokens are stored. Client registrations are bounded
at 1,000 per installation; an operator must review capacity before a larger public
service. No arbitrary client metadata URLs/assets are fetched. Request bodies and
provider/financial secrets are not logged.

Session cookies are scoped to `/api/v1`, and loopback callbacks under `/api` are
rejected so a native client's callback does not receive an Avera session cookie.
Migration 5 invalidates older root-path cookie sessions. Ordinary record archives
exclude these authorizations; a restored installation invalidates them too.

Automated interoperability uses the official MCP client for discovery, registration,
PKCE, code exchange, initialization and tool calls on real SQLite/PostgreSQL. Browser
checks exercise approval/denial, callback cookie isolation and revocation in both
themes at four widths. These are synthetic records, not certification of a specific
customer's AI client or public HTTPS deployment.
