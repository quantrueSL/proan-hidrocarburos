#!/usr/bin/env bash
# Despliegue de facturas-api en Cloud Run (servicio independiente, un solo
# contenedor -- ver service.yaml sobre por qué no es sidecar de
# plataforma-hidrocarburos).
#
#   bash deploy/cloudrun-facturas-api/deploy.sh
#
# A propósito NO deja el servicio invocable públicamente (a diferencia de
# deploy/cloudrun/deploy.sh): falta configurar API Gateway delante y dar
# invoker solo a su identidad de servicio -- ver README.md de esta carpeta.
set -euo pipefail

PROJECT="proan-quantrue"
REGION="us-west4"
SERVICE="facturas-api"
REPO="${REGION}-docker.pkg.dev/${PROJECT}/cloud-run-source-deploy"
SERVICE_ACCOUNT="272166156031-compute@developer.gserviceaccount.com"

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

TAG="$(git rev-parse --short HEAD 2>/dev/null || echo nogit)-$(date +%Y%m%d-%H%M%S)"

echo "== Construyendo imagen ($TAG) =="
gcloud builds submit . \
  --project="$PROJECT" \
  --config=deploy/cloudrun-facturas-api/cloudbuild.yaml \
  --substitutions="_REPO=${REPO},_TAG=${TAG}"

echo "== Desplegando servicio =="
RENDERED="$(mktemp)"
trap 'rm -f "$RENDERED"' EXIT
sed \
  -e "s|__REPO__|${REPO}|g" \
  -e "s|__TAG__|${TAG}|g" \
  -e "s|__SERVICE_ACCOUNT__|${SERVICE_ACCOUNT}|g" \
  deploy/cloudrun-facturas-api/service.yaml > "$RENDERED"

gcloud run services replace "$RENDERED" \
  --project="$PROJECT" \
  --region="$REGION"

URL="$(gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION" --format='value(status.url)')"

echo
echo "Desplegado en: $URL"
echo
echo "Este servicio NO es invocable públicamente todavía (a propósito -- sin"
echo "add-iam-policy-binding). Falta: configurar API Gateway delante y darle"
echo "roles/run.invoker a SU identidad de servicio. Ver README.md de esta carpeta."
