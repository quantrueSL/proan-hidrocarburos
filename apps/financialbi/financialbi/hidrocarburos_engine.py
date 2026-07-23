"""Consultas de solo lectura para los módulos M1/M2 de Hidrocarburos."""

from __future__ import annotations

from datetime import date
from typing import Any, Literal

from google.cloud import bigquery

from financialbi.db import _get_bq_client

_FOLIO = "`proan-quantrue.D60_REPORTING.HCARB_GOLD_CLASIFICACION_FOLIO`"
_SAP = "`proan-quantrue.D60_REPORTING.HCARB_GOLD_VALIDACION_SAP`"
_VENDORS = "`proan-quantrue.D50_AGGREGATE_RENTABILIDAD.HCARB_STG_VENDORS`"

SiteStatus = Literal["all", "with_site", "without_site"]
SapStatus = Literal["validada_sap", "sin_match_sap"]


def _base_query() -> str:
    return f"""
      FROM {_FOLIO} f
      LEFT JOIN {_SAP} s ON f.uuid = s.uuid
      LEFT JOIN {_VENDORS} v ON f.id_proveedor = v.id_proveedor
    """


def _filters(
    *,
    fecha_desde: date | None = None,
    fecha_hasta: date | None = None,
    proveedor_id: str | None = None,
    estado_sap: SapStatus | None = None,
    sitio: SiteStatus = "all",
) -> tuple[str, list[bigquery.ScalarQueryParameter]]:
    clauses = ["TRUE"]
    params: list[bigquery.ScalarQueryParameter] = []
    if fecha_desde:
        clauses.append("DATE(f.fecha) >= @fecha_desde")
        params.append(bigquery.ScalarQueryParameter("fecha_desde", "DATE", fecha_desde))
    if fecha_hasta:
        clauses.append("DATE(f.fecha) <= @fecha_hasta")
        params.append(bigquery.ScalarQueryParameter("fecha_hasta", "DATE", fecha_hasta))
    if proveedor_id:
        clauses.append("f.id_proveedor = @proveedor_id")
        params.append(bigquery.ScalarQueryParameter("proveedor_id", "STRING", proveedor_id))
    if estado_sap:
        clauses.append("s.estado_sap = @estado_sap")
        params.append(bigquery.ScalarQueryParameter("estado_sap", "STRING", estado_sap))
    if sitio == "with_site":
        clauses.append("s.werks IS NOT NULL")
    elif sitio == "without_site":
        clauses.append("s.werks IS NULL")
    return " AND ".join(clauses), params


def _rows(query: str, params: list[bigquery.ScalarQueryParameter]) -> list[dict[str, Any]]:
    job_config = bigquery.QueryJobConfig(query_parameters=params)
    result = _get_bq_client().query(query, job_config=job_config).result()
    return [dict(row.items()) for row in result]


def catalog() -> dict[str, Any]:
    query = f"""
      WITH base AS (
        SELECT
          DATE(f.fecha) AS fecha,
          f.id_proveedor,
          COALESCE(v.razon_social, f.emisor_rfc) AS proveedor,
          s.werks,
          s.sitio_consumo
        {_base_query()}
      )
      SELECT
        MIN(fecha) AS fecha_minima,
        MAX(fecha) AS fecha_maxima,
        ARRAY(
          SELECT AS STRUCT id_proveedor AS id, proveedor AS nombre
          FROM (SELECT DISTINCT id_proveedor, proveedor FROM base WHERE id_proveedor IS NOT NULL)
          ORDER BY nombre
        ) AS proveedores,
        ARRAY(
          SELECT AS STRUCT werks AS id, sitio_consumo AS nombre
          FROM (SELECT DISTINCT werks, sitio_consumo FROM base WHERE werks IS NOT NULL)
          ORDER BY nombre
        ) AS sitios
      FROM base
    """
    rows = _rows(query, [])
    return rows[0] if rows else {"fecha_minima": None, "fecha_maxima": None, "proveedores": [], "sitios": []}


def summary(**filters: Any) -> dict[str, Any]:
    where, params = _filters(**filters)
    query = f"""
      SELECT
        COUNT(*) AS facturas,
        COALESCE(SUM(f.importe_gas), 0) AS importe_gas,
        COUNTIF(f.es_mixta) AS facturas_mixtas,
        COUNTIF(s.estado_sap = 'validada_sap') AS validadas_sap,
        COUNTIF(s.werks IS NOT NULL) AS con_sitio,
        COUNTIF(s.tiene_recepcion_mseg) AS con_recepcion_mseg
      {_base_query()}
      WHERE {where}
    """
    rows = _rows(query, params)
    return rows[0] if rows else {}


def search(*, page: int, page_size: int, **filters: Any) -> dict[str, Any]:
    where, params = _filters(**filters)
    params.extend([
        bigquery.ScalarQueryParameter("limit", "INT64", page_size),
        bigquery.ScalarQueryParameter("offset", "INT64", (page - 1) * page_size),
    ])
    query = f"""
      SELECT
        f.uuid, DATE(f.fecha) AS fecha, f.serie, CAST(f.folio AS STRING) AS folio,
        f.id_proveedor, COALESCE(v.razon_social, f.emisor_rfc) AS proveedor,
        f.importe_gas, f.es_mixta, s.estado_sap, s.werks, s.sitio_consumo,
        s.tiene_recepcion_mseg
      {_base_query()}
      WHERE {where}
      ORDER BY fecha DESC, f.uuid
      LIMIT @limit OFFSET @offset
    """
    count_query = f"SELECT COUNT(*) AS total {_base_query()} WHERE {where}"
    count_params = params[:-2]
    total_rows = _rows(count_query, count_params)
    return {"total": total_rows[0]["total"] if total_rows else 0, "page": page, "page_size": page_size, "rows": _rows(query, params)}


def detail(uuid: str) -> dict[str, Any] | None:
    query = f"""
      SELECT
        f.uuid, f.serie, CAST(f.folio AS STRING) AS folio, f.folio_key, f.folio_numero,
        f.emisor_rfc, f.id_proveedor, COALESCE(v.razon_social, f.emisor_rfc) AS proveedor,
        f.receptor_rfc, DATE(f.fecha) AS fecha, f.fecha_timbrado,
        f.tipo_de_comprobante, f.moneda, f.metodo_pago, f.forma_pago,
        f.subtotal, f.total, f.total_impuestos_trasladados, f.importe_gas,
        f.es_mixta, f.n_lineas_gas, f.n_lineas_total,
        s.estado_sap, s.tipo_match_sap, s.belnr_sap, s.fecha_registro_sap,
        s.dias_diferencia, s.werks, s.sitio_consumo, s.tipo_match_sitio,
        s.tiene_recepcion_mseg, s.mseg_cantidad, s.mseg_valor_unitario, s.mseg_importe
      {_base_query()}
      WHERE f.uuid = @uuid
      LIMIT 1
    """
    rows = _rows(query, [bigquery.ScalarQueryParameter("uuid", "STRING", uuid)])
    return rows[0] if rows else None
