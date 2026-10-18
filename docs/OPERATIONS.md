# Operations

## Deployment Modes

The static public site contains authored destination data and illustrative sample
trips only. It can compile and save trips locally in a browser, but cannot run
Python, protect shared secrets or persist a private server database.

The private application serves its built UI and API on one origin. No CORS is
enabled. `TRAVEL_API_TOKEN` protects every saved-trip route. No browser/provider
key or database URL intake exists. Configure providers in the server environment.
Do not publish an owner token to make a public demo look live.

## Limits and Trust

- Request bodies: 16 KB; notes: 600 chars; origin: 80 chars.
- Trips: 1-10 days, 1-8 travelers; 12 submissions/minute/process, at most 2 active.
- Provider responses: 64 KB each, no redirects/retries; combined deadline: 35s.
- Provider origins are fixed to api.groq.com and api.open-meteo.com.
- SQLite retention: newest 100 trips, each payload at most 150 KB. Browser: 20 trips.
- Public source links identify places, not price/access/opening-hours verification.
- LocalStorage is not encrypted storage. Server database is not encrypted by this app.

Same-origin scripts, local fonts/photos, CSP, no-referrer, deny-framing and API
no-store headers are applied by FastAPI. GitHub Pages controls its own headers;
do not claim the server's HTTP header policy for the static host.

One owner token grants access to all server trips; there are no per-user accounts.
Use a single worker for the stated per-process admission limits. Before exposing
remotely, add HTTPS, network access controls, upstream body/connection/time limits,
rate controls, secure secret injection, filesystem permissions, logging/retention
policy and a named maintainer. Put no private data in a shared Docker build context.

## Routes

Public: GET /health, /api/config (booleans), /api/catalog, /api/sample, / and assets.
Private: GET/POST /api/trips; GET/PUT/DELETE /api/trips/{UUID};
GET /api/trips/{UUID}/export. PUT includes expected_revision and the new request.
Concurrent stale updates return409. Failed providers do not save partial trips.

Authentication is `Authorization: Bearer <owner-token>`. Restart with a new token
to rotate it. The browser keeps the token in memory only; reload/disconnect clears
it. Trip persistence is separate from token lifetime.

## Data and Recovery

Use a durable writable TRAVEL_DB path. Restrict access to its owner; exports may
contain personal notes. Never put a real database in Git or the public site.
Browser Save stores locally; connecting switches to server history, not automatic
upload of existing browser trips. Deleting a trip removes its active record, not
previous exports/backups or forensic SQLite remnants. Define backup retention.

For a consistent backup, stop the service, copy the database to protected storage,
and restart. Test restoration on a separate path before relying on it. A passing
unit test is not a backup service or a recovery-time guarantee. Upgrades should
retain the prior wheel/container and a pre-upgrade database backup for rollback.

## Provider Boundaries

Groq receives the current request, days, budget and warnings, including personal
notes if supplied. Obtain consent for that upload. Output is untrusted commentary,
never executable code, tool instructions or authority for reservations/visa rules.
No prompt-injection immunity or AI factual accuracy is claimed.

Open-Meteo receives fixed catalog city coordinates and trip dates, not notes or
the owner token. Review hosted API licensing/usage limits before commercial use.
Individual forecast values can be missing; invalid responses fail visibly.
Outside-window requests are labeled unavailable without querying the provider.

Flights/hotel listings, real fares, live FX, booking, cancellations, routing,
visa/medical/legal advice and multi-city optimization are not implemented.