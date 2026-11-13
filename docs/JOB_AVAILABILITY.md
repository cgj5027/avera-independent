# Job posting availability checks

Independent job search now checks public source pages before returning listings.
OpenAI web search is explicitly required for discovery, and its prompt asks for
current, still-open postings rather than search snippets. This is followed by a
separate deterministic availability check; a model's claim alone is insufficient.
OpenWebNinja remains optional and any results from it pass the same check.

The checker excludes:

- Removed pages (HTTP 404/410), expired `JobPosting.validThrough` deadlines and
  explicit closed/filled/no-longer-accepting notices, even on HTTP 200 pages.
- Pages whose posting identity does not match the candidate, generic careers
  pages, or pages without sufficient evidence that the opening is active.
- Unverifiable pages: login/anti-bot blocks, inaccessible sites, timeouts,
  invalid metadata and unsupported/oversized responses. These are **not assumed
  closed**, but are omitted rather than presented as active.

A matching structured posting needs an unexpired deadline or application evidence.
Without structured metadata, the page needs a matching job heading, employer text
and a public application link/form. Dates come from page metadata, never model
estimates. HTML is parsed without executing scripts or submitting forms.
A page still loading does not by itself establish that applications are open.

Checks happen before the twelve-result limit. Related-role searches can replace
rejected candidates, with duplicate checks cached within the request. A search
checks at most 36 distinct candidates and each verification batch is limited to
24, with six concurrent requests, bounded time/body/redirect limits. Candidates
outside the budget are omitted as unverified. No posting history is persisted.
Frontend requests allow up to three minutes for discovery plus checks.

Public posting URLs are fetched on the gateway (or direct backend), without
provider credentials, session cookies or browser credentials. Only HTTPS on the
standard port is allowed. Literal IPs and local/reserved destinations are refused;
DNS results must all be public and the chosen IP is pinned for the connection.
Every redirect is validated again; TLS verification stays enabled. The desktop
passes public candidate title/company/URL data through authenticated gateway
operation `jobs.verify`, not a general-purpose URL-fetch API.

Results display the source-check time and counts excluded as closed/expired or
unconfirmed. A check is evidence **at that time, not a guarantee**: employers can
close jobs afterward, and a publisher can leave outdated metadata/application
links in place. Login-only, JavaScript-only or protected sites may have valid jobs
that this checker cannot confirm. A smaller or empty result set is preferable to
filling it with unverified jobs. No applications or messages are sent.

The compatibility Base44 backend retains its historical behavior; this change
applies to independent gateway/direct searches. No location-filter behavior was
changed. The reported Photon reachability issue is separate; clearing location
continues to mean no distance limit, not verified geographic matching.

## Rollout

1. Merge the reviewed fix after CI passes, and manually deploy the latest main
   commit to the Render gateway (automatic deployment was disabled during setup).
2. Update the local checkout to the same main version, preserve `.env.local`, run
   `npm ci --ignore-scripts`, `npm run build:local`, and restart `npm run start:local`.
   `parse5`, already used in development, is now an explicit production dependency.
3. Repeat job searches with synthetic profiles. Check multiple returned postings
   manually and review the exclusion counts/check times. Provider/live acceptance
   remains distinct from fixture tests; no live credentials were available here.

The gateway and local backend both need the update. An older gateway will reject
`jobs.verify`, and an updated local backend will safely omit unchecked results.
This does not require a new subscription or another job-data provider.

## Local verification

- 435 regression tests (23 files), including check-time/exclusion UI and a delayed
  search completing after one minute, passed.
- 57 native checks passed with real SQLite and disposable PostgreSQL 16, no skips.
  Synthetic posting cases cover removed/expired/closed pages, stale metadata,
  blocked and malformed pages, active application evidence, ranking before the
  result limit, empty results, cache/budget behavior, gateway authorization and
  DNS-pinned redirect handling without credentials.
- 41 independent and 200 compatibility browser cases passed across four widths
  and both themes, with no reported axe violations; independent runs reported no
  browser exceptions or Base44/external resource requests.
- Lint, frontend/backend/platform type checks, both builds and diff checks passed.
  Full/production dependency audits reported zero known vulnerabilities, and
  redacted staged-diff/history secret scans found no leaks.

These are fixture/regression results, not live employer/provider certification.
Existing bundle-size warnings and the compatibility build's missing Base44
configuration warning remain. GitHub CI is a separate pre-merge gate.
