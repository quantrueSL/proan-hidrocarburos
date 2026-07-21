"""Centralised database connection for the FinancialBI service.

Switch the backend by setting the env var FINANCIALBI_DB_BACKEND:
  - "azure"    (default) → Azure SQL Server via pymssql
  - "bigquery"           → Google BigQuery via google-cloud-bigquery

Required env vars per backend:
  azure:    AZ_SERVER, AZ_DATABASE, AZ_USER, AZ_PASSWORD
  bigquery: BQ_PROJECT_ID
            BQ_CREDENTIALS_PATH (optional — omit to use Application Default Credentials)
            BQ_LOCATION         (optional — default "US")

Usage in any engine:
    from db import read_sql
    df = read_sql("SELECT ...")                     # BigQuery: plain SQL string
    df = read_sql("SELECT ... WHERE x = %s", [v])  # Azure: positional params
"""

from __future__ import annotations

import os
import pandas as pd

BACKEND: str = os.getenv("FINANCIALBI_DB_BACKEND", "azure").strip().lower()


# ---------------------------------------------------------------------------
# Azure SQL
# ---------------------------------------------------------------------------

def _get_azure_conn():
    # pymssql sigue siendo la dependencia para Azure — se importa aquí (lazy)
    # para que el módulo cargue sin error cuando el backend es bigquery
    # (en ese caso pymssql puede no estar instalado).
    import pymssql
    return pymssql.connect(
        server=os.environ["AZ_SERVER"],
        database=os.environ["AZ_DATABASE"],
        user=os.environ["AZ_USER"],
        password=os.environ["AZ_PASSWORD"],
        tds_version="7.4",
    )


# ---------------------------------------------------------------------------
# BigQuery
# ---------------------------------------------------------------------------

_bq_client = None  # cacheado a nivel de módulo -- ver comentario en _get_bq_client


def _get_bq_client():
    """Devuelve un `bigquery.Client` reutilizado entre llamadas.

    `bigquery.Client` es seguro para usar concurrentemente entre hilos (así
    lo documenta Google) y crearlo implica cargar credenciales + inicializar
    el transporte HTTP -- nada gratis. `build_report_context` hace ~20
    queries por carga de página; construir un cliente nuevo en cada una
    multiplicaba ese coste de arranque por 20 en cada request. Un solo
    cliente por proceso lo evita.
    """
    global _bq_client
    if _bq_client is not None:
        return _bq_client
    from google.cloud import bigquery  # type: ignore
    project_id = os.environ["BQ_PROJECT_ID"]
    creds_path = os.getenv("BQ_CREDENTIALS_PATH")
    location = os.getenv("BQ_LOCATION", "us-west4")
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


# ---------------------------------------------------------------------------
# Unified interface
# ---------------------------------------------------------------------------

def read_sql(query: str, params: list | None = None) -> pd.DataFrame:
    """Run a SELECT query and return a DataFrame.

    BigQuery:  params are ignored — embed values directly in the query string.
    Azure SQL: params are positional (%s placeholders), passed to pd.read_sql.
    """
    if BACKEND == "bigquery":
        client = _get_bq_client()
        return client.query(query).to_dataframe()
    else:
        conn = _get_azure_conn()
        try:
            return pd.read_sql(query, conn, params=params or None)
        finally:
            conn.close()


def query_to_records(query: str, params: list | None = None) -> list[dict]:
    """Run a SELECT query and return a list of dicts (JSON-serialisable)."""
    df = read_sql(query, params)
    return df.where(pd.notnull(df), None).to_dict(orient="records")
