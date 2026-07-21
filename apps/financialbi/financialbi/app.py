from __future__ import annotations

import logging
import os
from datetime import datetime
from decimal import Decimal
from functools import lru_cache
from typing import Any

import numpy as np
import pandas as pd
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
# NOTA: pymssql (backend Azure SQL) se importa de forma perezosa dentro de
# db.py solo cuando FINANCIALBI_DB_BACKEND=azure. En Hidrocarburos el backend
# es siempre BigQuery, así que ni se instala ni se importa aquí.

from financialbi.alertas_engine import (
    load_alerts_from_gold,
    load_alerts_from_gold_ritmo,
    load_historias_from_gold,
    load_historias_from_gold_ritmo,
)
from financialbi.report_engine import (
    get_catalog_minimal,
    build_report_context,
    ReportConfig,
)

log = logging.getLogger(__name__)

app = FastAPI(title="FinancialBI", version="0.1.0")


class FinancialQuery(BaseModel):
    target_period: str | None = None
    sociedad: str | None = None
    familia: str | None = None
    canal: str | None = None
    lang: str = "es"
    # Report range + view. Optional so single-period callers keep working
    # (end_period falls back to target_period in the /report endpoint).
    start_period: str | None = None
    end_period: str | None = None
    view_mode: str = "pg"
    # Filtros P&G Maka (solo BigQuery): línea de negocio (GSBER) y planta (WERKS)
    linea_negocio: str | None = None
    planta: str | None = None
    # Ventas Maka (solo BigQuery): incluir facturación intercompañía PAN<->MPE
    # (canal "06 - Partes Relacionadas"). False = excluida (default).
    incluir_partes_relacionadas: bool = False
    # Carga parcial por pestaña (ver REPORT_SECTIONS en report_engine).
    # None/vacío → reporte completo (frontend Streamlit no lo envía).
    sections: list[str] | None = None


def _to_jsonable(value: Any) -> Any:
    if value is None:
        return None
    if isinstance(value, (str, bool, int, float)):
        if isinstance(value, float) and (np.isnan(value) or np.isinf(value)):
            return None
        return value
    if isinstance(value, (datetime, pd.Timestamp, pd.Period)):
        return str(value)
    if isinstance(value, Decimal):
        return float(value)
    if isinstance(value, (np.integer,)):
        return int(value)
    if isinstance(value, (np.floating,)):
        f = float(value)
        return None if (np.isnan(f) or np.isinf(f)) else f
    if isinstance(value, dict):
        return {k: _to_jsonable(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_to_jsonable(v) for v in value]
    if pd.isna(value):
        return None
    return str(value)


def _df_records(df: pd.DataFrame | None) -> list[dict[str, Any]]:
    if df is None or df.empty:
        return []
    records = df.to_dict(orient="records")
    return [_to_jsonable(r) for r in records]


def _jsonify_context(obj: Any) -> Any:
    """Recursively JSON-encode a report context, tagging DataFrames so the
    frontend can rebuild them losslessly: DataFrame -> {"__df__": {columns, data}}.
    Everything else goes through _to_jsonable (handles Period/Decimal/NaN/numpy)."""
    if isinstance(obj, pd.DataFrame):
        split = obj.to_dict(orient="split")
        return {
            "__df__": {
                "columns": [str(c) for c in split["columns"]],
                "data": _to_jsonable(split["data"]),
            }
        }
    if isinstance(obj, dict):
        return {k: _jsonify_context(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [_jsonify_context(v) for v in obj]
    return _to_jsonable(obj)


def _fast_shared_catalog() -> dict[str, Any]:
    """Return shared catalog using lightweight queries.

    Delegates to get_catalog_minimal() which handles both Azure SQL and BigQuery
    depending on FINANCIALBI_DB_BACKEND.
    """
    return get_catalog_minimal()


@lru_cache(maxsize=128)
def _cached_report_payload(
    start_period: str, end_period: str, sociedad: str, view_mode: str,
    familia: str = "", canal: str = "",
    linea_negocio: str = "", planta: str = "",
    incluir_partes_relacionadas: bool = False,
    sections: tuple[str, ...] = (),  # tupla (hashable) para la key del lru_cache
) -> dict[str, Any]:
    ctx = build_report_context(
        cfg=ReportConfig(),
        start_period=start_period or None,
        end_period=end_period or None,
        sociedad=sociedad or None,
        view_mode=view_mode or "pg",
        familia=familia or None,
        canal=canal or None,
        linea_negocio=linea_negocio or None,
        planta=planta or None,
        incluir_partes_relacionadas=incluir_partes_relacionadas,
        sections=list(sections) or None,
    )
    return _jsonify_context(ctx)


@lru_cache(maxsize=128)
def _cached_alerts_payload(target_period: str) -> dict[str, Any]:
    # Lee lo ya materializado por materialize_alerts.py — no recalcula nada.
    real = load_alerts_from_gold(target_period or None)

    total_alertas = int(len(real))

    # Conteo por tier para el frontend (puede estar vacio si score no calculo)
    tier_counts: dict[str, int] = (
        {k: int(v) for k, v in real["tier"].value_counts().items()}
        if "tier" in real.columns and not real.empty
        else {}
    )

    # Limitar a las 25 alertas de mayor score (real ya viene ordenada desc)
    top25 = real.head(25)

    return {
        "target_period": target_period or None,
        "total_alertas": total_alertas,
        "tier_counts": tier_counts,
        "rows": _df_records(top25),
    }


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/v1/financialbi/catalog")
def financial_catalog() -> dict[str, Any]:
    try:
        shared = _fast_shared_catalog()
        return {
            "shared": _to_jsonable(shared),
            # Keep backwards-compatible keys used by some clients.
            "report": _to_jsonable(shared),
            "alerts": _to_jsonable(shared),
            # Unidades de presentación — configurables en financialbi_db.dev.env
            "currency": os.getenv("FINANCIALBI_CURRENCY", "€"),
            "qty_unit": os.getenv("FINANCIALBI_QTY_UNIT", "T"),
        }
    except Exception as exc:
        log.exception("financial catalog error")
        raise HTTPException(status_code=500, detail=str(exc))


@app.post("/v1/financialbi/report")
def financial_report(body: FinancialQuery) -> dict[str, Any]:
    try:
        # end_period drives the close month; fall back to target_period so
        # older single-period callers keep working.
        end = body.end_period or body.target_period or ""
        return _cached_report_payload(
            body.start_period or "", end, body.sociedad or "", body.view_mode or "pg",
            body.familia or "", body.canal or "",
            body.linea_negocio or "", body.planta or "",
            body.incluir_partes_relacionadas,
            # sorted+set canoniza la key de caché (["a","b"] == ["b","a"])
            tuple(sorted(set(body.sections or []))),
        )
    except Exception as exc:
        log.exception("financial report error")
        raise HTTPException(status_code=500, detail=str(exc))


@app.post("/v1/financialbi/alerts")
def financial_alerts(body: FinancialQuery) -> dict[str, Any]:
    try:
        return _cached_alerts_payload(body.target_period or "")
    except Exception as exc:
        log.exception("financial alerts error")
        raise HTTPException(status_code=500, detail=str(exc))


@app.get("/v1/financialbi/alerts_mtd")
def financial_alerts_mtd() -> dict[str, Any]:
    """Alertas de "ritmo" (mes a la fecha) para el mes en curso. Sin caché:
    el acumulado cambia según se factura, y no depende de ningún filtro."""
    try:
        # Lee lo ya materializado por materialize_alerts.py — no recalcula nada.
        real, meta = load_alerts_from_gold_ritmo()

        if meta["too_early"]:
            return {
                "too_early": True,
                "day_of_month": meta["day_of_month"],
                "min_day": meta["min_day"],
                "total_alertas": 0,
                "tier_counts": {},
                "rows": [],
            }

        tier_counts: dict[str, int] = (
            {k: int(v) for k, v in real["tier"].value_counts().items()}
            if "tier" in real.columns and not real.empty
            else {}
        )
        top25 = real.head(25)

        return {
            "too_early": False,
            "day_of_month": meta["day_of_month"],
            "cutoff_day": meta["cutoff_day"],
            "total_alertas": int(len(real)),
            "tier_counts": tier_counts,
            "rows": _df_records(top25),
        }
    except Exception as exc:
        log.exception("financial alerts_mtd error")
        raise HTTPException(status_code=500, detail=str(exc))


@lru_cache(maxsize=128)
def _cached_historias_payload(target_period: str) -> dict[str, Any]:
    # Lee las tarjetas ya congeladas por materialize_alerts.py (subcomando
    # 'historias') — cero tendencia y cero LLM en el request.
    df = load_historias_from_gold(target_period or None)
    return {
        "target_period":   target_period or None,
        "total_historias": int(len(df)),
        "historias":       _df_records(df),
    }


@app.post("/v1/financialbi/historias")
def financial_historias(body: FinancialQuery) -> dict[str, Any]:
    """Devuelve tarjetas de alertas priorizadas — un SELECT sobre
    GOLD_HISTORIAS_MENSUAL, igual de simple que /alerts. El trabajo caro
    (tendencia + selección top-15 + texto LLM) ya lo hizo el job."""
    try:
        return _cached_historias_payload(body.target_period or "")
    except Exception as exc:
        log.exception("financial historias error")
        raise HTTPException(status_code=500, detail=str(exc))


@app.get("/v1/financialbi/historias_mtd")
def financial_historias_mtd() -> dict[str, Any]:
    """Tarjetas de "ritmo" (mes a la fecha) — un SELECT sobre
    GOLD_HISTORIAS_RITMO. Sin caché: la tabla se reescribe en cada corrida
    del job y no depende de filtros."""
    try:
        df, meta = load_historias_from_gold_ritmo()
        if meta["too_early"]:
            return {
                "too_early": True,
                "day_of_month": meta["day_of_month"],
                "min_day": meta["min_day"],
                "total_historias": 0,
                "historias": [],
            }
        return {
            "too_early":       False,
            "day_of_month":    meta["day_of_month"],
            "cutoff_day":      meta["cutoff_day"],
            "target_period":   None,
            "total_historias": int(len(df)),
            "historias":       _df_records(df),
        }
    except Exception as exc:
        log.exception("financial historias_mtd error")
        raise HTTPException(status_code=500, detail=str(exc))
