# Release Evidence

Review date: 2026-10-18. This is a tested reference, not production certification.
Version 0.2.1 corrects a geographically incorrect Lisbon photo from 0.2.0 using
a verified Wikimedia Lisbon panorama with visible CC BY 4.0 attribution. Earlier
release assets are not silently replaced; use the corrected patch release.
Source baseline: KalyanM45/TravelBrain-Multi-Agent-AI-Travel-Planner at
59db5bb0f1aeebd593a5114c67f8e619afceb25a, GPLv3 with original history/LICENSE retained.

Local evidence: 27 Python tests pass, including a 27-combination browser/server
planning parity gate. All 14 desktop/mobile browser cases pass against a fresh
actual API: browser saves/reopen/delete, private API create/update, authentication,
exports, safe text rendering, exclusions, images and 320px layout screenshots.
Supported-source Ruff checks pass. Frontend build passes (~113 KB main JS).
Python and npm audits are clear after updating transitive urllib3 to 2.8.0.

Wheel/source completeness and private-state exclusions passed. The wheel's UI,
image assets and API were installed and checked outside the source checkout.
The source archive includes the frontend, tests, locks and deployment definitions;
the wheel excludes retired graph/MCP subpackages.

A single real Open-Meteo lookup through the actual adapter returned two forecast
days for public Paris coordinates, observed at 2026-10-17T23:59:13+00:00, with TLS
verification enabled. No raw forecast or private trip data was added to the demo.
This smoke is not a forecast-accuracy, uptime or commercial-usage certification.

Live Groq inference is unverified and requires explicit operator configuration.
Container and cross-platform verification run in the repository's Verify
TravelBrain workflow. The published reference release records the exact source
commit and successful workflow/deployment links when those gates are observed.

Costs and sample trips are authored illustrative data. Source links were not
scraped into a supposedly live dataset. No booking/flight/hotel availability,
worldwide coverage, accessibility assurance, forecast accuracy or SLA is claimed.