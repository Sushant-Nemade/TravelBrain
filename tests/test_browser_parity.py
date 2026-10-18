import json
import shutil
import subprocess

from src.catalog import CATALOG_VERSION, DESTINATIONS
from src.contracts import TripRequest
from src.planner import build_plan


def test_browser_compiler_matches_server():
    requests = [
        TripRequest(
            start_date="2027-04-12",
            destination=destination,
            days=days,
            currency=currency,
            travelers=3,
            pace="busy",
            step_free=True,
            notes="Review access.",
        )
        for destination in DESTINATIONS
        for days in (1, 4, 10)
        for currency in ("EUR", "USD", "GBP")
    ]
    executable = shutil.which("node")
    assert executable, "Node.js is required for the cross-runtime parity gate."
    code = "import {compileTrip} from './frontend/static/js/engine.js';let data='';for await(const chunk of process.stdin)data+=chunk;const payload=JSON.parse(data);console.log(JSON.stringify(payload.requests.map(request=>compileTrip(request,payload.catalog))));"
    result = subprocess.run(
        [executable, "--input-type=module", "-e", code],
        input=json.dumps(
            {
                "requests": [request.model_dump(mode="json") for request in requests],
                "catalog": {"version": CATALOG_VERSION, "destinations": DESTINATIONS},
            }
        ),
        text=True,
        capture_output=True,
        timeout=20,
        check=True,
    )
    for request, actual in zip(requests, json.loads(result.stdout), strict=True):
        expected = build_plan(request)
        for key in ("id", "created_at"):
            actual.pop(key)
            expected.pop(key)
        assert actual == expected
