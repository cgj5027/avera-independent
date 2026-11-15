# Geocodio location setup

OpenAI discovers jobs; Geocodio resolves
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
3. Deploy a reviewed gateway commit after its checks pass. Preserve the
   existing database, vault key, grants, OpenAI, Plaid and Resend configuration.
4. Restart the gateway after saving the key. Local installations in gateway mode
   use this service without a separate geocoding key. Direct installations need
   the key on their own backend. For source upgrades, follow [local setup](LOCAL_SETUP.md).
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

Other finance workflows do not require Geocodio.

Validate location lookup on each deployment with a configured key; fixtures do not verify live provider availability or account limits.
