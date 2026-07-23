"""Dashboard ejecutivo (Propuesta.md §3) -- resumen de estatus y análisis de
gasto. Una sola función/endpoint (`resumen_completo`) en vez de varias
sueltas, mismo criterio de "menos queries" que el resto del proyecto.

A. Resumen de estatus: total emitidas, validadas (pasaron Compras), aprobadas,
   rechazadas, pendientes -- más lo que aporta D24 (estatus_sat.py): vigentes/
   canceladas/sin consultar ante el SAT.
B. Análisis de gasto: por CECO, por sitio, acumulado por periodo (mensual).

No se desglosa por "sociedad" (Propuesta original) porque el alcance actual
(D1/D2, provisional) es una sola razón social -- si se ratifica ampliar el
alcance, añadir esa dimensión aquí.
"""

from __future__ import annotations

from typing import Any

from financialbi.aprobacion_engine import sync_pendientes
from financialbi.db import _get_bq_client
from financialbi.hidrocarburos_engine import _FOLIO, _SAP

_APROBACION = "`proan-quantrue.D60_REPORTING.HCARB_gold_aprobacion`"
_ESTATUS_SAT = "`proan-quantrue.D60_REPORTING.HCARB_ESTATUS_SAT`"


def _rows(query: str) -> list[dict[str, Any]]:
    result = _get_bq_client().query(query).result()
    return [dict(row.items()) for row in result]


def _resumen_estatus() -> dict[str, Any]:
    query = f"""
      SELECT
        COUNT(*) AS total_facturas,
        COUNTIF(COALESCE(a.estado, 'pendiente_validacion_compras') != 'pendiente_validacion_compras') AS validadas,
        COUNTIF(a.estado = 'aprobada') AS aprobadas,
        COUNTIF(a.estado = 'rechazada') AS rechazadas,
        COUNTIF(COALESCE(a.estado, 'pendiente_validacion_compras') = 'pendiente_validacion_compras') AS pendientes,
        COALESCE(SUM(f.importe_gas), 0) AS importe_gas_total,
        COUNTIF(e.estatus_cancelacion = 'vigente') AS vigentes_sat,
        COUNTIF(e.estatus_cancelacion = 'cancelado') AS canceladas_sat,
        COUNTIF(e.uuid IS NULL OR e.estatus_cancelacion = 'no_encontrado') AS sin_confirmar_sat
      FROM {_FOLIO} f
      LEFT JOIN {_APROBACION} a ON f.uuid = a.uuid
      LEFT JOIN {_ESTATUS_SAT} e ON f.uuid = e.uuid
    """
    rows = _rows(query)
    return rows[0] if rows else {}


def _gasto_por_ceco() -> list[dict[str, Any]]:
    query = f"""
      SELECT COALESCE(a.ceco, 'Sin CECO') AS grupo, SUM(f.importe_gas) AS importe_gas, COUNT(*) AS n_facturas
      FROM {_FOLIO} f
      LEFT JOIN {_APROBACION} a ON f.uuid = a.uuid
      GROUP BY grupo
      ORDER BY importe_gas DESC
    """
    return _rows(query)


def _gasto_por_sitio() -> list[dict[str, Any]]:
    query = f"""
      SELECT COALESCE(a.werks_manual, s.sitio_consumo, 'Sin sitio') AS grupo, SUM(f.importe_gas) AS importe_gas, COUNT(*) AS n_facturas
      FROM {_FOLIO} f
      LEFT JOIN {_APROBACION} a ON f.uuid = a.uuid
      LEFT JOIN {_SAP} s ON f.uuid = s.uuid
      GROUP BY grupo
      ORDER BY importe_gas DESC
    """
    return _rows(query)


def _gasto_por_periodo() -> list[dict[str, Any]]:
    query = f"""
      SELECT FORMAT_DATE('%Y-%m', DATE(f.fecha)) AS grupo, SUM(f.importe_gas) AS importe_gas, COUNT(*) AS n_facturas
      FROM {_FOLIO} f
      GROUP BY grupo
      ORDER BY grupo
    """
    return _rows(query)


def resumen_completo() -> dict[str, Any]:
    """Todo el payload del dashboard en una sola llamada de red desde el
    frontend (aunque internamente sean 4 queries -- una por bloque)."""
    sync_pendientes()  # para que "pendientes"/"total" incluyan altas recién llegadas de M1
    return {
        "resumen": _resumen_estatus(),
        "gasto_por_ceco": _gasto_por_ceco(),
        "gasto_por_sitio": _gasto_por_sitio(),
        "gasto_por_periodo": _gasto_por_periodo(),
    }
