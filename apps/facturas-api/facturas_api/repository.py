"""Acceso a BigQuery de facturas-api.

Todas las consultas hacen INNER JOIN contra `HCARB_GOLD_CLASIFICACION_FOLIO`
(la tabla de facturas de gas que la herramienta ya clasifica) -- así el
alcance ("solo las facturas que ya tenemos en la herramienta") se cumple a
nivel de query, no como un chequeo aparte en Python que se pueda olvidar en
algún endpoint nuevo.

`HCARB_GOLD_CLASIFICACION_FOLIO` usa columnas en snake_case (`uuid`, ver
`financialbi/estatus_sat.py`); las tablas crudas de `D00_SANDBOX`
(`cfdi_cabecera`, `cfdi_raw`) usan PascalCase (`UUID`) -- no es un error, son
dos capas distintas del mismo dato.
"""

from __future__ import annotations

import os
from typing import Any

from google.cloud import bigquery

from facturas_api.db import get_bq_client

_FOLIO_TABLE = os.getenv("HCARB_FOLIO_TABLE", "proan-quantrue.D60_REPORTING.HCARB_GOLD_CLASIFICACION_FOLIO")
_FOLIO = f"`{_FOLIO_TABLE}`"

_CFDI_CABECERA_TABLE = os.getenv("CFDI_CABECERA_TABLE", "proan-quantrue.D00_SANDBOX.cfdi_cabecera")
_CFDI_CABECERA = f"`{_CFDI_CABECERA_TABLE}`"

_CFDI_RAW_TABLE = os.getenv("CFDI_RAW_TABLE", "proan-quantrue.D00_SANDBOX.cfdi_raw")
_CFDI_RAW = f"`{_CFDI_RAW_TABLE}`"

_ESTATUS_SAT_TABLE = os.getenv("HCARB_ESTATUS_SAT_TABLE", "proan-quantrue.D60_REPORTING.HCARB_ESTATUS_SAT")
_ESTATUS_SAT = f"`{_ESTATUS_SAT_TABLE}`"

_METADATA_SELECT = """
  SELECT
    c.UUID AS uuid, c.Serie AS serie, c.Folio AS folio, c.Fecha AS fecha,
    c.EmisorRfc AS rfc_emisor, c.EmisorNombre AS nombre_emisor,
    c.Total AS total, c.Moneda AS moneda,
    e.estatus_cancelacion
"""


def _rows(query: str, params: list[bigquery.ScalarQueryParameter]) -> list[dict[str, Any]]:
    job_config = bigquery.QueryJobConfig(query_parameters=params)
    return [dict(row.items()) for row in get_bq_client().query(query, job_config=job_config).result()]


def get_factura_metadata(uuid: str) -> dict[str, Any] | None:
    """Metadata de una factura de gas, o `None` si el UUID no existe o no
    pertenece al universo de facturas de gas ya clasificadas -- mismo
    resultado para los dos casos, a propósito (ver `app.py`)."""
    query = f"""
      {_METADATA_SELECT}
      FROM {_CFDI_CABECERA} c
      INNER JOIN {_FOLIO} f ON f.uuid = c.UUID
      LEFT JOIN {_ESTATUS_SAT} e ON e.uuid = c.UUID
      WHERE c.UUID = @uuid
      LIMIT 1
    """
    params = [bigquery.ScalarQueryParameter("uuid", "STRING", uuid)]
    rows = _rows(query, params)
    return rows[0] if rows else None


def buscar_facturas(
    *,
    rfc_emisor: str | None,
    serie: str | None,
    folio: str | None,
    fecha_desde: str | None,
    fecha_hasta: str | None,
) -> list[dict[str, Any]]:
    """Búsqueda por el identificador "humano" (RFC emisor + Serie + Folio),
    con rango de fecha opcional -- ver docs/data/naturaleza-de-los-datos.md sobre
    por qué el folio solo no es único (se repite entre ejercicios fiscales).
    Puede devolver varias coincidencias; el llamador decide qué hacer con eso.
    """
    clauses = []
    params: list[bigquery.ScalarQueryParameter] = []

    if rfc_emisor:
        clauses.append("c.EmisorRfc = @rfc_emisor")
        params.append(bigquery.ScalarQueryParameter("rfc_emisor", "STRING", rfc_emisor))
    if serie:
        clauses.append("c.Serie = @serie")
        params.append(bigquery.ScalarQueryParameter("serie", "STRING", serie))
    if folio:
        clauses.append("c.Folio = @folio")
        params.append(bigquery.ScalarQueryParameter("folio", "STRING", folio))
    if fecha_desde:
        # c.Fecha es STRING en formato ISO ("2026-08-29T09:36:14") -- comparar
        # el prefijo de fecha como texto funciona porque ISO 8601 ordena igual
        # lexicográfica que cronológicamente.
        clauses.append("SUBSTR(c.Fecha, 1, 10) >= @fecha_desde")
        params.append(bigquery.ScalarQueryParameter("fecha_desde", "STRING", fecha_desde))
    if fecha_hasta:
        clauses.append("SUBSTR(c.Fecha, 1, 10) <= @fecha_hasta")
        params.append(bigquery.ScalarQueryParameter("fecha_hasta", "STRING", fecha_hasta))

    where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
    query = f"""
      {_METADATA_SELECT}
      FROM {_CFDI_CABECERA} c
      INNER JOIN {_FOLIO} f ON f.uuid = c.UUID
      LEFT JOIN {_ESTATUS_SAT} e ON e.uuid = c.UUID
      {where}
      ORDER BY c.Fecha DESC
      LIMIT 100
    """
    return _rows(query, params)


def get_comprobante_json(uuid: str) -> str | None:
    """El JSON crudo del CFDI (`cfdi_raw.comprobante_json`) para un UUID del
    universo de gas, o `None` si no existe / no pertenece a ese universo."""
    query = f"""
      SELECT r.comprobante_json
      FROM {_CFDI_RAW} r
      INNER JOIN {_FOLIO} f ON f.uuid = r.UUID
      WHERE r.UUID = @uuid
      LIMIT 1
    """
    params = [bigquery.ScalarQueryParameter("uuid", "STRING", uuid)]
    rows = _rows(query, params)
    return rows[0]["comprobante_json"] if rows else None
