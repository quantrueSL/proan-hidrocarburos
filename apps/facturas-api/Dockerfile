# Dockerfile de facturas-api (FastAPI: XML/PDF de facturas de gas).
#
# Contexto de build: RAÍZ del repo (igual que financialbi) -- necesita el
# pyproject.toml + uv.lock del workspace para `uv sync --package facturas-api`.
#
# Build (desde deploy/cloudrun-facturas-api/cloudbuild.yaml, context: ..):
#   docker build -f apps/facturas-api/Dockerfile -t facturas-api .
FROM python:3.11-slim

COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv

WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    UV_LINK_MODE=copy \
    UV_COMPILE_BYTECODE=1

# curl para el healthcheck. El resto son las librerías nativas que WeasyPrint
# necesita en RUNTIME para rasterizar HTML/CSS a PDF (Pango/Cairo/GDK-Pixbuf) --
# a diferencia de financialbi, aquí sí hacen falta paquetes del sistema.
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    libpango-1.0-0 \
    libpangocairo-1.0-0 \
    libcairo2 \
    libgdk-pixbuf-2.0-0 \
    libffi-dev \
    shared-mime-info \
    fonts-liberation \
    && rm -rf /var/lib/apt/lists/*

# Resolver dependencias del workspace para el paquete facturas-api.
COPY pyproject.toml uv.lock ./
COPY apps/facturas-api/pyproject.toml ./apps/facturas-api/pyproject.toml

RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --package facturas-api --no-dev

COPY apps/facturas-api/ ./apps/facturas-api/

ENV PATH="/app/.venv/bin:$PATH"
ENV PYTHONPATH=/app/apps/facturas-api

EXPOSE 8092

# Cloud Run inyecta $PORT (8080 por defecto); en local usamos 8092.
CMD ["sh", "-c", "uvicorn facturas_api.app:app --host 0.0.0.0 --port ${PORT:-8092}"]
