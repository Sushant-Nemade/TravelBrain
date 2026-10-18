FROM node:24-bookworm-slim AS frontend
WORKDIR /app
COPY LICENSE NOTICE.md ./
COPY frontend/ ./frontend/
RUN npm --prefix frontend ci --ignore-scripts && node frontend/scripts/licenses.mjs && npm --prefix frontend run build

FROM python:3.13-slim-bookworm AS builder
COPY --from=ghcr.io/astral-sh/uv:0.13.0 /uv /bin/uv
WORKDIR /app
COPY pyproject.toml uv.lock README.md LICENSE NOTICE.md ./
COPY src/ ./src/
COPY scripts/ ./scripts/
COPY --from=frontend /app/frontend/dist ./frontend/dist
RUN uv sync --frozen --no-dev && uv run --frozen python -m scripts.build_site --package

FROM python:3.13-slim-bookworm
RUN useradd --create-home --uid 10001 traveler
WORKDIR /app
COPY --from=builder --chown=traveler:traveler /app/.venv ./.venv
COPY --from=builder --chown=traveler:traveler /app/src ./src
RUN mkdir data && chown traveler:traveler data
ENV PATH="/app/.venv/bin:$PATH" HOST=0.0.0.0 PORT=8000 TRAVEL_DB=/app/data/trips.sqlite PYTHONUNBUFFERED=1
USER traveler
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/health', timeout=3)"
CMD ["python", "-m", "uvicorn", "src.web:app", "--host", "0.0.0.0", "--port", "8000"]