"""Cliente de BigQuery de facturas-api.

Mismo patrón que `apps/financialbi/financialbi/db.py` -- ver ese archivo para
el razonamiento completo. Se replica en vez de compartirse porque hoy no existe
ninguna librería interna común entre las apps de este workspace.

Variables de entorno:
  BQ_PROJECT_ID        (obligatoria)
  BQ_LOCATION          (opcional -- por defecto "us-west4")
  BQ_CREDENTIALS_PATH  (opcional -- omitir para usar Application Default
                        Credentials, que es lo que se hace en Cloud Run)

Los valores SIEMPRE se pasan como parámetros de consulta (`@nombre` +
`bigquery.ScalarQueryParameter`), nunca interpolados en la cadena SQL.
"""

from __future__ import annotations

import os

_bq_client = None


def get_bq_client():
    """Devuelve un `bigquery.Client` reutilizado entre llamadas (seguro para
    usar concurrentemente entre hilos, según documenta Google)."""
    global _bq_client
    if _bq_client is not None:
        return _bq_client

    from google.cloud import bigquery  # type: ignore

    project_id = os.environ["BQ_PROJECT_ID"]
    location = os.getenv("BQ_LOCATION", "us-west4")
    creds_path = os.getenv("BQ_CREDENTIALS_PATH")

    if creds_path:
        from google.oauth2 import service_account  # type: ignore

        credentials = service_account.Credentials.from_service_account_file(
            creds_path,
            scopes=["https://www.googleapis.com/auth/cloud-platform"],
        )
        _bq_client = bigquery.Client(project=project_id, credentials=credentials, location=location)
    else:
        _bq_client = bigquery.Client(project=project_id, location=location)
    return _bq_client
