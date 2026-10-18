# TravelBrain Workbench

An attributed GPLv3 trip-planning application derived from
[Hema Kalyan Murapaka's TravelBrain](https://github.com/KalyanM45/TravelBrain-Multi-Agent-AI-Travel-Planner).
Upstream history and LICENSE are retained; see [NOTICE.md](NOTICE.md).

Plan, review, change, save, reopen and export an itinerary without API keys.
The first release supports **Paris, Lisbon and Kyoto**, 1-10 days, 1-8 travelers,
three paces and EUR/USD/GBP illustrative budgets. This is not a worldwide booking
engine or a claim of upstream feature parity. The bounded catalog deliberately
leaves unmatched slots free instead of inventing places or repeating activities.

## What Works

- Validated dates, duration, group size, interests and exact minor-unit budgets.
- Source-linked activities, exclusions, editable trip requirements and budget warnings.
- Browser-local saved trips on the public site; private SQLite trips on your own server.
- Optimistic revisions, reopen/delete, JSON/Markdown exports and browser printing.
- Optional live Open-Meteo weather inside its forecast window and optional Groq
  commentary grounded in the compiled itinerary. Both require explicit server enablement.
- Local fonts/photos/icons, no analytics, no browser calls to model or weather providers.

All ticket, meal, transport and accommodation costs are authored **illustrative
allowances**, not quotes. Fixed illustrative currency ratios are not market FX.
Flights/intercity travel, insurance, taxes and booking charges are excluded.
Opening hours, route feasibility and step-free access need confirmation. Free-text
notes are retained, not interpreted as deterministic constraints. AI notes may be wrong.

## Quick Start

Requires Python 3.11+ (3.13 recommended), Node 22.12+ and uv.

```sh
git clone https://github.com/Sushant-Nemade/TravelBrain.git
cd TravelBrain
uv sync --frozen
npm --prefix frontend ci --ignore-scripts
uv run --frozen python -m scripts.build_site
node frontend/scripts/licenses.mjs
npm --prefix frontend run build
uv run --frozen travelbrain
```

Open http://127.0.0.1:8886/ . No credentials are needed for the browser planner.
Browser trips are stored in this origin's localStorage, not a cloud account;
clearing site data deletes them. Export anything you need to retain. Do not use
shared browser profiles for sensitive notes. The owner token is never stored there.

For private server persistence, generate a random 32-256-character ASCII token
locally (`python -c "import secrets; print(secrets.token_urlsafe(40))"`) and set
`TRAVEL_API_TOKEN` in your process environment before starting the server. Enter
it only into your own same-origin private planner connection dialog. Never send
it through chat or include it in source, URLs, screenshots or public settings.
PowerShell: `$env:TRAVEL_API_TOKEN = '<your locally generated value>'`.
POSIX: `export TRAVEL_API_TOKEN='<your locally generated value>'`.

`TRAVEL_DB` defaults to `data/trips.sqlite`; at most 100 server trips are retained.
No environment file is auto-loaded. Set variables in the shell/secret manager;
Compose reads its ignored `.env` as configuration, never as an image layer.

## Optional Providers

Weather: set `TRAVEL_LIVE_WEATHER=1`, connect as owner and select Live weather.
Open-Meteo's free hosted API has non-commercial terms and provider limits. This
adapter only requests trips wholly within today through 15 days ahead; no distant
forecast is fabricated. Attribution: [Open-Meteo, CC BY 4.0](https://open-meteo.com/).

AI: set `TRAVEL_AI_ENABLED=1`, `GROQ_API_KEY` and an explicitly selected
`GROQ_MODEL`. Review account terms, source-upload consent and budget first.
Only trip evidence is sent, with one fixed-origin request, no tools or retries,
a 1,200-token completion cap and validated bounded JSON. No live Groq inference
is claimed until separately verified. A token cap is not a monetary guarantee.

Use `TRAVEL_CA_BUNDLE` for an approved PEM trust bundle if needed; TLS remains
enabled. Never commit that machine-specific file or disable certificate checks.

## Verify

```sh
uv run --frozen pytest -q
uv run --frozen ruff check
npm --prefix frontend test
npm --prefix frontend audit
uv run --frozen pip-audit
uv run --frozen python -m scripts.build_site --package
uv run --frozen python -m build
uv run --frozen python scripts/verify_release.py
```

Browser tests start a fresh fixture-authenticated API themselves. They do not
call live providers. The Python parity gate requires the frontend npm install.
See [release evidence](docs/RELEASE_STATUS.md) and [operations](docs/OPERATIONS.md).

For a non-root container, run `docker compose up --build` (loopback port 8886,
durable named volume). The build definition is `Containerfile`; a direct build
uses `docker build -f Containerfile -t travelbrain .`. No Redis/PostgreSQL service
or runtime package download is needed. Select an unused APP_PORT if necessary.

## Architecture and Changes

`src/contracts.py` validates inputs; `src/catalog.py` owns authored planning data;
`src/planner.py` compiles dates/activities/budgets; `src/providers.py` optionally
adds weather/commentary; `src/store.py` owns transactional SQLite records;
`src/web.py` serves the API and built frontend. Browser compilation is checked
against server output across destinations, currencies and durations.

The inherited arbitrary database credential intake, client thread checkpoints,
MCP subprocess agents, Redis/PostgreSQL dependencies and legacy HTML renderer are
retired from the supported application. Historical modules and the
[original README](docs/UPSTREAM_README.md) remain for provenance, not as alternate
supported entry points. The wheel installs only the supported top-level `src`
modules and bundled site, not those old subpackages.

## Contributing and Security

Keep changes focused; add a regression for changed behavior and run the checks
above. Do not commit keys, real trip records, databases or machine trust files.
Preserve source/asset licenses. Report vulnerabilities privately through the
repository owner's GitHub contact rather than posting private inputs or secrets.

This single-owner reference is not a public multi-user service, travel agent,
accessibility certification or uptime guarantee. Public managed hosting is a
separate operating decision; no paid services are activated automatically.