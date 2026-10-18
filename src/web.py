import asyncio
import hmac
import os
import time
from collections import deque
from contextlib import asynccontextmanager
from datetime import date
from pathlib import Path
from uuid import UUID, NAMESPACE_URL, uuid5

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, ConfigDict, Field

from src.catalog import CATALOG_VERSION, DESTINATIONS
from src.contracts import TripRequest
from src.planner import build_plan, markdown
from src.providers import ProviderError, client, enrich
from src.store import ConflictError, TripStore


class BodyLimit:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http" or scope["method"] not in {"POST", "PUT", "PATCH"}:
            return await self.app(scope, receive, send)
        body = bytearray()
        while True:
            message = await receive()
            if message["type"] == "http.disconnect":
                return
            body.extend(message.get("body", b""))
            if len(body) > 16384:
                return await JSONResponse({"detail": "Request exceeds 16 KB."}, status_code=413)(
                    scope, receive, send
                )
            if not message.get("more_body"):
                break
        delivered = False

        async def bounded_receive():
            nonlocal delivered
            if delivered:
                return await receive()
            delivered = True
            return {"type": "http.request", "body": bytes(body), "more_body": False}

        await self.app(scope, bounded_receive, send)


class TripUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    expected_revision: int = Field(ge=1, strict=True)
    request: TripRequest


def sample_plans():
    plans = []
    for destination in DESTINATIONS:
        plan = build_plan(TripRequest(destination=destination, start_date=date(2027, 4, 12)))
        plan.update(
            id=str(uuid5(NAMESPACE_URL, f"travelbrain/{CATALOG_VERSION}/{destination}")),
            created_at="2026-10-18T00:00:00+00:00",
            sample=True,
        )
        plans.append(plan)
    return plans


def create_app(store=None, connection_factory=client):
    token = os.getenv("TRAVEL_API_TOKEN", "")
    if token and (not token.isascii() or not 32 <= len(token) <= 256):
        raise ValueError("TRAVEL_API_TOKEN must be 32-256 ASCII characters.")

    @asynccontextmanager
    async def lifespan(application):
        application.state.store = store or TripStore(os.getenv("TRAVEL_DB", "data/trips.sqlite"))
        yield

    application = FastAPI(
        title="TravelBrain Workbench", version="0.2.0", lifespan=lifespan, docs_url=None, redoc_url=None
    )
    application.add_middleware(BodyLimit)
    submissions = deque()
    capacity = asyncio.Semaphore(2)

    def owner(request: Request):
        supplied = request.headers.get("authorization", "")
        if not token:
            raise HTTPException(503, "Private API is disabled. Configure the server owner token.")
        if len(supplied) > 300 or not hmac.compare_digest(supplied.encode(), f"Bearer {token}".encode()):
            raise HTTPException(401, "Owner authentication required.")

    @application.middleware("http")
    async def security(request, call_next):
        response = await call_next(request)
        response.headers.update(
            {
                "Content-Security-Policy": "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'",
                "X-Content-Type-Options": "nosniff",
                "Referrer-Policy": "no-referrer",
                "X-Frame-Options": "DENY",
                "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
            }
        )
        if request.url.path.startswith("/api/"):
            response.headers["Cache-Control"] = "no-store"
        return response

    async def plan_request(body):
        now = time.monotonic()
        while submissions and submissions[0] < now - 60:
            submissions.popleft()
        if len(submissions) >= 12 or capacity.locked():
            raise HTTPException(429, "Planner busy or request limit reached. Try later.")
        submissions.append(now)
        async with capacity:
            try:
                plan = build_plan(body)
                if body.ai or body.live_weather:
                    async with connection_factory() as connection:
                        plan = await asyncio.wait_for(enrich(plan, connection), timeout=35)
                return plan
            except ValueError as error:
                raise HTTPException(422, str(error)) from error
            except (ProviderError, TimeoutError) as error:
                raise HTTPException(
                    502, "Optional provider failed or is not configured. No trip was saved."
                ) from error

    @application.get("/health")
    async def health():
        return {"status": "ok", "version": "0.2.0"}

    @application.get("/api/config")
    async def configuration():
        return {
            "private_api": bool(token),
            "ai": os.getenv("TRAVEL_AI_ENABLED") == "1"
            and bool(os.getenv("GROQ_API_KEY"))
            and bool(os.getenv("GROQ_MODEL")),
            "weather": os.getenv("TRAVEL_LIVE_WEATHER") == "1",
            "version": "0.2.0",
        }

    @application.get("/api/catalog")
    async def catalog():
        return {"version": CATALOG_VERSION, "destinations": DESTINATIONS}

    @application.get("/api/sample")
    async def samples():
        return sample_plans()

    @application.get("/api/trips", dependencies=[Depends(owner)])
    async def trips():
        return application.state.store.list()

    @application.post("/api/trips", dependencies=[Depends(owner)], status_code=201)
    async def create(body: TripRequest):
        return application.state.store.save(await plan_request(body))

    @application.get("/api/trips/{trip_id}", dependencies=[Depends(owner)])
    async def read(trip_id: UUID):
        plan = application.state.store.get(str(trip_id))
        if not plan:
            raise HTTPException(404, "Trip not found.")
        return plan

    @application.put("/api/trips/{trip_id}", dependencies=[Depends(owner)])
    async def update(trip_id: UUID, body: TripUpdate):
        current = await read(trip_id)
        if current["revision"] != body.expected_revision:
            raise HTTPException(409, "Trip changed. Reload before saving.")
        plan = await plan_request(body.request)
        plan.update(id=str(trip_id), revision=body.expected_revision + 1, created_at=current["created_at"])
        try:
            return application.state.store.save(plan, expected=body.expected_revision)
        except ConflictError as error:
            raise HTTPException(409, str(error)) from error

    @application.delete("/api/trips/{trip_id}", dependencies=[Depends(owner)], status_code=204)
    async def delete(trip_id: UUID):
        if not application.state.store.delete(str(trip_id)):
            raise HTTPException(404, "Trip not found.")
        return Response(status_code=204)

    @application.get("/api/trips/{trip_id}/export", dependencies=[Depends(owner)])
    async def export(trip_id: UUID):
        return Response(
            markdown(await read(trip_id)),
            media_type="text/markdown",
            headers={"Content-Disposition": 'attachment; filename="travelbrain-trip.md"'},
        )

    site = Path(__file__).resolve().parent / "site"
    local = Path(__file__).resolve().parent.parent / "frontend" / "dist"
    if local.is_dir():
        site = local
    if site.is_dir():
        application.mount("/assets", StaticFiles(directory=site / "assets"), name="assets")

        @application.get("/")
        async def index():
            return FileResponse(site / "index.html")

        @application.get("/{filename}")
        async def public_file(filename: str):
            if filename not in {"demo.json", "catalog.json", "LICENSE", "NOTICE.md", "licenses.json"}:
                raise HTTPException(404)
            return FileResponse(site / filename)

    return application


app = create_app()


def main():
    import uvicorn

    uvicorn.run(create_app(), host=os.getenv("HOST", "127.0.0.1"), port=int(os.getenv("PORT", "8886")))
