# Geocodio location setup

Geocodio replaces Photon in the independent application. The legacy Base44
compatibility backend is unchanged. OpenAI discovers jobs; Geocodio resolves
locations for approximate straight-line distance filtering. It does not determine
whether a posting is still active or calculate driving distance.

1. Create an account at https://dash.geocod.io/ and generate an API key. Start with
   the free allowance and configure account usage limits. Check current country
   coverage, pricing and storage terms at https://www.geocod.io/docs/ and
   https://www.geocod.io/terms-of-use. A search can make up to thirteen lookups;
   cached repeated locations within that search are reused. There is no
   cross-search or persistent location cache in this release.
2. In Render, open the Avera gateway service, then **Environment**. Add
   `GEOCODIO_API_KEY` with the key as its secret value. Save it securely; do not
   paste keys into chat, GitHub or frontend configuration. Gateway-mode desktops
   do not need this key. Advanced direct installations set it on their own server.
3. Merge/deploy the updated gateway code after its checks pass. This release
   also includes the posting-availability changes from PR #12 if not yet merged. Preserve the
   existing database, vault key, grants, OpenAI, Plaid and Resend configuration.
4. Update the desktop installation to the same release, run
   `npm ci --ignore-scripts`, `npm run build:local`, and restart
   `npm run start:local`. Both sides must be updated: older gateways do not allow
   the Geocodio endpoint, and the updated gateway rejects Photon requests.
5. Test a specific city/state or postal code and a known nearby/out-of-radius job
   location. Try an ambiguous city and verify that it asks for a more specific
   location. Confirm source-check timestamps still appear on accepted postings.
   Review lookup usage in the Geocodio dashboard without sharing the key.

Only the search location string is sent to Geocodio. The gateway injects the key,
allows only the fixed HTTPS v2.1 endpoint and a single `q` field, rejects
redirects, caps response size/time, and strips provider metadata from its reply.
Weak, ambiguous and state/country-only matches are rejected. Timeouts, missing
credentials and exhausted allowance never broaden the user's distance limit.
If a destination fails but other nearby matches succeed, results retain the
existing partial-location disclosure. An unresolved origin stops the search.

This change requires no database migration. To roll back, restore matching old
versions of both gateway and desktop; Photon reachability may still fail. Other
finance workflows do not require Geocodio.

Live Geocodio acceptance is pending an operator-supplied key and a test from the
hosted gateway. Synthetic tests do not establish provider availability.
