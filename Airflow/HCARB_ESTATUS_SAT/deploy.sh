#!/bin/bash
set -euo pipefail

PROJECT="proan-quantrue"
REGION="us-west4"
JOB_NAME="hcarb-estatus-sat"
IMAGE="${REGION}-docker.pkg.dev/${PROJECT}/cloud-run-source-deploy/${JOB_NAME}:latest"
SERVICE_ACCOUNT="272166156031-compute@developer.gserviceaccount.com"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

gcloud builds submit "$SCRIPT_DIR" --project="$PROJECT" --tag="$IMAGE"
gcloud run jobs deploy "$JOB_NAME" \
  --project="$PROJECT" \
  --region="$REGION" \
  --image="$IMAGE" \
  --service-account="$SERVICE_ACCOUNT" \
  --set-env-vars="BQ_PROJECT_ID=${PROJECT},BQ_LOCATION=${REGION},SAT_RECHECK_DAYS=7,SAT_PAUSE_SECONDS=1" \
  --max-retries=1 \
  --task-timeout=3600 \
  --memory=512Mi

echo "Desplegado ${JOB_NAME}. Prueba manual:"
echo "gcloud run jobs execute ${JOB_NAME} --project=${PROJECT} --region=${REGION} --wait"
