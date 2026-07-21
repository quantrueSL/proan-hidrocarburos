# Dockerfile del servicio FinancialBI (FastAPI: reportes + alertas).
#
# Contexto de build: RAÍZ del repo (como en Maka) — necesita el pyproject.toml
# + uv.lock del workspace de la raíz para `uv sync --package financialbi`.
#
# Build (desde deploy/docker-compose*.yml, context: ..):
#   docker build -f apps/financialbi/Dockerfile -t carb-financialbi .
FROM python:3.11-slim

COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv

WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    UV_LINK_MODE=copy \
    UV_COMPILE_BYTECODE=1

# curl para el healthcheck. Sin build-essential: al quitar pymssql, todas las
# dependencias (fastapi/pandas/numpy/pyarrow/bigquery/openai) instalan desde
# wheels — no hace falta compilador.
RUN apt-get update && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*

# Resolver dependencias del workspace para el paquete financialbi.
COPY pyproject.toml uv.lock ./
COPY apps/financialbi/pyproject.toml ./apps/financialbi/pyproject.toml

RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --package financialbi --no-dev

COPY apps/financialbi/ ./apps/financialbi/

ENV PATH="/app/.venv/bin:$PATH"
ENV PYTHONPATH=/app/apps/financialbi

EXPOSE 8091

# Cloud Run inyecta $PORT (8080 por defecto); en local usamos 8091.
CMD ["sh", "-c", "uvicorn financialbi.app:app --host 0.0.0.0 --port ${PORT:-8091}"]
