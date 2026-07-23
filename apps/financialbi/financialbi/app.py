from __future__ import annotations

import logging
from datetime import date, datetime
from decimal import Decimal
from typing import Any, Literal

import numpy as np
import pandas as pd
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field
# NOTA: pymssql (backend Azure SQL) se importa de forma perezosa dentro de
# db.py solo cuando FINANCIALBI_DB_BACKEND=azure. En Hidrocarburos el backend
# es siempre BigQuery, así que ni se instala ni se importa aquí.

from financialbi.hidrocarburos_engine import catalog as hidrocarburos_catalog
from financialbi.hidrocarburos_engine import detail as hidrocarburos_detail
from financialbi.hidrocarburos_engine import search as hidrocarburos_search
from financialbi.hidrocarburos_engine import summary as hidrocarburos_summary
from financialbi.aprobacion_engine import (
    aprobar_gerencia,
    capturar_compras,
    catalogo_ceco,
    catalogo_sitios,
    cola_compras,
    cola_gerencia,
    ensure_schema as ensure_aprobacion_schema,
    rechazar as rechazar_aprobacion,
)

log = logging.getLogger(__name__)

app = FastAPI(title="FinancialBI", version="0.1.0")


@app.on_event("startup")
def _startup() -> None:
    # Idempotente -- CREATE TABLE IF NOT EXISTS, seguro llamarlo en cada arranque.
    ensure_aprobacion_schema()


class HydrocarburosFilters(BaseModel):
    fecha_desde: date | None = None
    fecha_hasta: date | None = None
    proveedor_id: str | None = None
    estado_sap: Literal["validada_sap", "sin_match_sap"] | None = None
    sitio: Literal["all", "with_site", "without_site"] = "all"


class HydrocarburosSearch(HydrocarburosFilters):
    page: int = Field(default=1, ge=1)
    page_size: int = Field(default=50, ge=1, le=100)


class CapturarCompraBody(BaseModel):
    # Identidad de usuario (D27): texto libre por ahora -- no hay login con
    # roles reales todavía, ver Datos/PHASE2/resumen.md.
    usuario: str = Field(min_length=1)
    ceco: str = Field(min_length=1)
    werks_manual: str | None = None
    comentario: str | None = None


class AprobarBody(BaseModel):
    usuario: str = Field(min_length=1)
    comentario: str | None = None


class RechazarBody(BaseModel):
    usuario: str = Field(min_length=1)
    motivo: str = Field(min_length=1)


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


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/v1/financialbi/hidrocarburos/catalog")
def financial_hidrocarburos_catalog() -> dict[str, Any]:
    try:
        return _to_jsonable(hidrocarburos_catalog())
    except Exception as exc:
        log.exception("hydrocarburos catalog error")
        raise HTTPException(status_code=500, detail=str(exc))


@app.post("/v1/financialbi/hidrocarburos/summary")
def financial_hidrocarburos_summary(body: HydrocarburosFilters) -> dict[str, Any]:
    try:
        return _to_jsonable(hidrocarburos_summary(**body.model_dump()))
    except Exception as exc:
        log.exception("hydrocarburos summary error")
        raise HTTPException(status_code=500, detail=str(exc))


@app.post("/v1/financialbi/hidrocarburos/invoices/search")
def financial_hidrocarburos_search(body: HydrocarburosSearch) -> dict[str, Any]:
    try:
        return _to_jsonable(hidrocarburos_search(**body.model_dump()))
    except Exception as exc:
        log.exception("hydrocarburos search error")
        raise HTTPException(status_code=500, detail=str(exc))


@app.get("/v1/financialbi/hidrocarburos/invoices/{uuid}")
def financial_hidrocarburos_detail(uuid: str) -> dict[str, Any]:
    try:
        invoice = hidrocarburos_detail(uuid)
        if invoice is None:
            raise HTTPException(status_code=404, detail="Factura no encontrada.")
        return _to_jsonable(invoice)
    except HTTPException:
        raise
    except Exception as exc:
        log.exception("hydrocarburos detail error")
        raise HTTPException(status_code=500, detail=str(exc))


# --- Módulo 3: aprobación (dos roles, D23) ----------------------------------

def _raise_if_not_ok(result: dict[str, Any]) -> None:
    """Traduce el resultado de aprobacion_engine a HTTP: 404 si la factura no
    existe en el flujo, 409 si existe pero no está en el estado esperado
    (ya la procesó otra persona, o la acción no aplica a su estado actual)."""
    if result["ok"]:
        return
    estado_actual = result["estado_actual"]
    if estado_actual is None:
        raise HTTPException(status_code=404, detail="Factura no encontrada en el flujo de aprobación.")
    raise HTTPException(
        status_code=409,
        detail=f"La factura está en estado '{estado_actual}', no se puede aplicar esta acción.",
    )


@app.get("/v1/financialbi/hidrocarburos/aprobacion/compras")
def financial_aprobacion_cola_compras() -> dict[str, Any]:
    try:
        return {"rows": _to_jsonable(cola_compras())}
    except Exception as exc:
        log.exception("aprobacion cola compras error")
        raise HTTPException(status_code=500, detail=str(exc))


@app.get("/v1/financialbi/hidrocarburos/aprobacion/gerencia")
def financial_aprobacion_cola_gerencia() -> dict[str, Any]:
    try:
        return {"rows": _to_jsonable(cola_gerencia())}
    except Exception as exc:
        log.exception("aprobacion cola gerencia error")
        raise HTTPException(status_code=500, detail=str(exc))


@app.get("/v1/financialbi/hidrocarburos/aprobacion/catalogo/ceco")
def financial_aprobacion_catalogo_ceco() -> dict[str, Any]:
    try:
        return {"rows": _to_jsonable(catalogo_ceco())}
    except Exception as exc:
        log.exception("aprobacion catalogo ceco error")
        raise HTTPException(status_code=500, detail=str(exc))


@app.get("/v1/financialbi/hidrocarburos/aprobacion/catalogo/sitios")
def financial_aprobacion_catalogo_sitios() -> dict[str, Any]:
    try:
        return {"rows": _to_jsonable(catalogo_sitios())}
    except Exception as exc:
        log.exception("aprobacion catalogo sitios error")
        raise HTTPException(status_code=500, detail=str(exc))


@app.post("/v1/financialbi/hidrocarburos/aprobacion/compras/{uuid}/validar")
def financial_aprobacion_validar_compras(uuid: str, body: CapturarCompraBody) -> dict[str, Any]:
    try:
        result = capturar_compras(uuid=uuid, **body.model_dump())
        _raise_if_not_ok(result)
        return {"ok": True, "estado": result["estado_actual"]}
    except HTTPException:
        raise
    except Exception as exc:
        log.exception("aprobacion validar compras error")
        raise HTTPException(status_code=500, detail=str(exc))


@app.post("/v1/financialbi/hidrocarburos/aprobacion/compras/{uuid}/rechazar")
def financial_aprobacion_rechazar_compras(uuid: str, body: RechazarBody) -> dict[str, Any]:
    try:
        result = rechazar_aprobacion(uuid=uuid, rol="compras", **body.model_dump())
        _raise_if_not_ok(result)
        return {"ok": True, "estado": result["estado_actual"]}
    except HTTPException:
        raise
    except Exception as exc:
        log.exception("aprobacion rechazar compras error")
        raise HTTPException(status_code=500, detail=str(exc))


@app.post("/v1/financialbi/hidrocarburos/aprobacion/gerencia/{uuid}/aprobar")
def financial_aprobacion_aprobar_gerencia(uuid: str, body: AprobarBody) -> dict[str, Any]:
    try:
        result = aprobar_gerencia(uuid=uuid, **body.model_dump())
        _raise_if_not_ok(result)
        return {"ok": True, "estado": result["estado_actual"]}
    except HTTPException:
        raise
    except Exception as exc:
        log.exception("aprobacion aprobar gerencia error")
        raise HTTPException(status_code=500, detail=str(exc))


@app.post("/v1/financialbi/hidrocarburos/aprobacion/gerencia/{uuid}/rechazar")
def financial_aprobacion_rechazar_gerencia(uuid: str, body: RechazarBody) -> dict[str, Any]:
    try:
        result = rechazar_aprobacion(uuid=uuid, rol="gerencia", **body.model_dump())
        _raise_if_not_ok(result)
        return {"ok": True, "estado": result["estado_actual"]}
    except HTTPException:
        raise
    except Exception as exc:
        log.exception("aprobacion rechazar gerencia error")
        raise HTTPException(status_code=500, detail=str(exc))
