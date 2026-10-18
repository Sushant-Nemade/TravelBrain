import httpx
import pytest
from fastapi.testclient import TestClient

from src.providers import ProviderError, enrich
from src.planner import build_plan
from src.contracts import TripRequest
from src.store import TripStore
from src.web import create_app


@pytest.fixture
def anyio_backend():
    return "asyncio"


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("TRAVEL_API_TOKEN", "test-" + "X" * 40)
    with TestClient(create_app(TripStore(tmp_path / "trips.sqlite"))) as connection:
        yield connection


HEADERS = {"Authorization": "Bearer test-" + "X" * 40}
REQUEST = {"start_date": "2027-04-12", "destination": "paris"}


def test_actual_api_lifecycle(client):
    assert client.get("/health").status_code == 200
    assert client.get("/api/trips").status_code == 401
    response = client.post("/api/trips", json=REQUEST, headers=HEADERS)
    assert response.status_code == 201
    trip = response.json()
    path = "/api/trips/" + trip["id"]
    assert client.get(path, headers=HEADERS).json() == trip
    update = {"expected_revision": 1, "request": {**REQUEST, "travelers": 3}}
    assert client.put(path, json=update, headers=HEADERS).json()["revision"] == 2
    assert client.put(path, json=update, headers=HEADERS).status_code == 409
    assert "## Budget" in client.get(path + "/export", headers=HEADERS).text
    assert client.delete(path, headers=HEADERS).status_code == 204
    assert client.get(path, headers=HEADERS).status_code == 404


def test_limits_no_credentials_endpoint_and_private_headers(client):
    assert client.post("/api/trips", content=b"x" * 17000, headers=HEADERS).status_code == 413
    assert (
        client.post("/api/trips", json={**REQUEST, "database_url": "secret"}, headers=HEADERS).status_code
        == 422
    )
    assert client.post("/api/config", json={"groq_api_key": "not-accepted"}).status_code == 405
    assert client.get("/api/trips", headers=HEADERS).headers["cache-control"] == "no-store"
    assert "frame-ancestors 'none'" in client.get("/health").headers["content-security-policy"]
    for _ in range(12):
        assert client.post("/api/trips", json=REQUEST, headers=HEADERS).status_code == 201
    assert client.post("/api/trips", json=REQUEST, headers=HEADERS).status_code == 429


@pytest.mark.anyio
async def test_optional_ai_origin_grounding_and_failure(monkeypatch):
    monkeypatch.setenv("TRAVEL_AI_ENABLED", "1")
    monkeypatch.setenv("GROQ_API_KEY", "fixture-secret")
    monkeypatch.setenv("GROQ_MODEL", "fixture-model")
    calls = []

    def transport(request):
        calls.append(request)
        assert request.url.host == "api.groq.com"
        assert request.headers["authorization"] == "Bearer fixture-secret"
        assert b"max_tokens" in request.content and b"Flights" in request.content
        return httpx.Response(
            200,
            json={
                "choices": [
                    {
                        "finish_reason": "stop",
                        "message": {
                            "content": '{"overview":"Review reservations.","tips":["Confirm access."]}'
                        },
                    }
                ]
            },
        )

    async with httpx.AsyncClient(transport=httpx.MockTransport(transport)) as connection:
        plan = await enrich(build_plan(TripRequest(**REQUEST, ai=True)), connection)
    assert plan["ai_notes"]["provider"] == "Groq" and len(calls) == 1
    async with httpx.AsyncClient(
        transport=httpx.MockTransport(lambda request: httpx.Response(401, text="fixture-secret"))
    ) as connection:
        with pytest.raises(ProviderError, match="Provider rejected") as failure:
            await enrich(build_plan(TripRequest(**REQUEST, ai=True)), connection)
        assert "fixture-secret" not in str(failure.value)


@pytest.mark.anyio
async def test_weather_outside_window_never_calls_provider(monkeypatch):
    monkeypatch.setenv("TRAVEL_LIVE_WEATHER", "1")

    def unexpected(request):
        raise AssertionError("Outside-window weather must not query a provider")

    async with httpx.AsyncClient(transport=httpx.MockTransport(unexpected)) as connection:
        plan = await enrich(build_plan(TripRequest(**REQUEST, live_weather=True)), connection)
    assert plan["weather"]["status"] == "outside_forecast_window"
