"""Cliente de BigQuery compartido por los motores de FinancialBI.

Variables de entorno:
  BQ_PROJECT_ID        (obligatoria)
  BQ_LOCATION          (opcional — por defecto "us-west4")
  BQ_CREDENTIALS_PATH  (opcional — omitir para usar Application Default
                        Credentials, que es lo que se hace en Cloud Run)

Uso:
    from financialbi.db import get_bq_client
    client = get_bq_client()

Los valores SIEMPRE se pasan como parametros de consulta (`@nombre` +
`bigquery.ScalarQueryParameter`), nunca interpolados en la cadena SQL: eso seria
una via de inyeccion. En los f-strings de los motores solo va estructura —
columnas, tabla, ORDER BY — nunca datos que vengan del cliente.

Historia: este modulo soportaba tambien Azure SQL via pymssql, con un conmutador
FINANCIALBI_DB_BACKEND y funciones `read_sql`/`query_to_records`. Hidrocarburos
solo usa BigQuery, pymssql ya no es dependencia y ningun motor llamaba a esas
funciones, asi que se retiro todo (jul-2026).
"""

from __future__ import annotations

import os

_bq_client = None  # cacheado a nivel de modulo -- ver comentario en get_bq_client


def get_bq_client():
    """Devuelve un `bigquery.Client` reutilizado entre llamadas.

    `bigquery.Client` es seguro para usar concurrentemente entre hilos (asi lo
    documenta Google) y crearlo implica cargar credenciales + inicializar el
    transporte HTTP -- nada gratis. `build_report_context` hace ~20 queries por
    carga de pagina; construir un cliente nuevo en cada una multiplicaba ese
    coste de arranque por 20 en cada request. Un solo cliente por proceso lo
    evita.
    """
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
