from __future__ import annotations

import logging
from datetime import date, datetime
from decimal import Decimal
from typing import Any, Literal

import numpy as np
import pandas as pd
from fastapi import Depends, FastAPI, HTTPException
from pydantic import BaseModel, Field

from financialbi.hidrocarburos_engine import catalog as hidrocarburos_catalog
from financialbi.hidrocarburos_engine import detail as hidrocarburos_detail
from financialbi.hidrocarburos_engine import search as hidrocarburos_search
from financialbi.hidrocarburos_engine import summary as hidrocarburos_summary
from financialbi.aprobacion_engine import (
    aprobar_gerencia,
    capturar_compras,
    catalogo_ceco,
    catalogo_nucleo,
    catalogo_sitios,
    cola_compras,
    cola_gerencia,
    ensure_schema as ensure_aprobacion_schema,
    historial as aprobacion_historial,
    reabrir as reabrir_aprobacion,
    rechazar as rechazar_aprobacion,
)
from financialbi.dashboard_engine import facturas_sat_atencion as dashboard_facturas_sat_atencion
from financialbi.dashboard_engine import facturas_detalle as dashboard_facturas_detalle
from financialbi.dashboard_engine import resumen_completo as dashboard_resumen_completo
from financialbi.estatus_sat import ensure_schema as ensure_estatus_sat_schema

log = logging.getLogger(__name__)

app = FastAPI(title="FinancialBI", version="0.1.0")


@app.on_event("startup")
def _startup() -> None:
    # Idempotente -- CREATE TABLE IF NOT EXISTS, seguro llamarlo en cada arranque.
    ensure_aprobacion_schema()
    ensure_estatus_sat_schema()


class HydrocarburosFilters(BaseModel):
    busqueda: str | None = None
    fecha_desde: date | None = None
    fecha_hasta: date | None = None
    proveedor_id: str | None = None
    estado_sap: Literal["validada_sap", "sin_match_sap"] | None = None
    sitio: Literal["all", "with_site", "without_site"] = "all"
    clave_sat: str | None = None
    clasificacion: Literal["all", "gas", "mixta"] = "all"


class HydrocarburosSearch(HydrocarburosFilters):
    page: int = Field(default=1, ge=1)
    page_size: int = Field(default=50, ge=1, le=100)


# Mismos filtros que HydrocarburosFilters (M1) + confianza_mseg -- las colas de
# aprobación (M2/M3) leen de la misma tabla de origen, así que tiene sentido
# poder filtrar por lo mismo. Query params en un GET (Depends()), no body de POST.
class AprobacionFiltros(BaseModel):
    busqueda: str | None = None
    fecha_desde: date | None = None
    fecha_hasta: date | None = None
    proveedor_id: str | None = None
    estado_sap: Literal["validada_sap", "sin_match_sap"] | None = None
    confianza_mseg: Literal["Alta", "Media", "sin_evidencia"] | None = None
    sitio: Literal["all", "with_site", "without_site"] = "all"
    ceco_sugerido: Literal["all", "con_sugerencia", "sin_sugerencia"] = "all"


class AprobacionSearch(AprobacionFiltros):
    page: int = Field(default=1, ge=1)
    page_size: int = Field(default=50, ge=1, le=100)


# Filtros del dashboard: mismas dimensiones que AprobacionFiltros + estatus_sat
# (D24 -- el dashboard es el único lugar que resume cancelación SAT, las colas
# de aprobación no lo filtran). "sin_confirmar" agrupa "nunca consultado" y
# "no_encontrado", igual que el bucket sin_confirmar_sat del resumen.
class DashboardFiltros(BaseModel):
    fecha_desde: date | None = None
    fecha_hasta: date | None = None
    proveedor_id: str | None = None
    estado_sap: Literal["validada_sap", "sin_match_sap"] | None = None
    confianza_mseg: Literal["Alta", "Media", "sin_evidencia"] | None = None
    estatus_sat: Literal["vigente", "cancelado", "sin_confirmar"] | None = None
    periodo: str | None = None
    sitio: str | None = None
    ceco: str | None = None
    estado_aprobacion: Literal[
        "pendiente_validacion_compras", "pendiente_aprobacion_gerencia", "aprobada", "rechazada"
    ] | None = None
    nucleo: str | None = None
    detalle: bool = False
    detalle_sat: bool = False


class CecoPorTicketItem(BaseModel):
    # Un CECO confirmado por ticket de entrega (ago-2026, ver
    # HCARB_GOLD_VALIDACION_SAP.tickets_mseg) -- solo se manda cuando la
    # factura reparte gasto entre varios CECO reales.
    ticket: str | None = None
    ceco: str = Field(min_length=1)
    importe_ticket: float | None = None


class CapturarCompraBody(BaseModel):
    # Identidad de usuario (D27): texto libre por ahora -- no hay login con
    # roles reales todavía.
    usuario: str = Field(min_length=1)
    ceco: str = Field(min_length=1)
    werks_manual: str | None = None
    comentario: str | None = None
    # Cuando la factura tiene varios CECO reales confirmados por ticket
    # (ver aprobacion_engine.capturar_compras) -- opcional, NULL en el caso
    # común de 1 solo CECO.
    ceco_por_ticket: list[CecoPorTicketItem] | None = None


class AprobarBody(BaseModel):
    usuario: str = Field(min_length=1)
    comentario: str | None = None


class RechazarBody(BaseModel):
    usuario: str = Field(min_length=1)
    motivo: str = Field(min_length=1)


class ReabrirBody(BaseModel):
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
def financial_aprobacion_cola_compras(filtros: AprobacionSearch = Depends()) -> dict[str, Any]:
    try:
        return _to_jsonable(cola_compras(**filtros.model_dump()))
    except Exception as exc:
        log.exception("aprobacion cola compras error")
        raise HTTPException(status_code=500, detail=str(exc))


@app.get("/v1/financialbi/hidrocarburos/aprobacion/gerencia")
def financial_aprobacion_cola_gerencia(filtros: AprobacionSearch = Depends()) -> dict[str, Any]:
    try:
        return _to_jsonable(cola_gerencia(**filtros.model_dump()))
    except Exception as exc:
        log.exception("aprobacion cola gerencia error")
        raise HTTPException(status_code=500, detail=str(exc))


@app.get("/v1/financialbi/hidrocarburos/aprobacion/historial")
def financial_aprobacion_historial(filtros: AprobacionSearch = Depends()) -> dict[str, Any]:
    """Facturas ya avanzadas más allá de la bandeja inicial de Compras
    (pendientes de Gerencia, aprobadas, rechazadas) -- necesario para poder
    reeditar antes de decidir o reabrir después (ver la máquina de estados en
    ConsultasBigQuery/HCARB_gold_aprobacion_schema.sql)."""
    try:
        return _to_jsonable(aprobacion_historial(**filtros.model_dump()))
    except Exception as exc:
        log.exception("aprobacion historial error")
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


@app.get("/v1/financialbi/hidrocarburos/aprobacion/catalogo/nucleo")
def financial_aprobacion_catalogo_nucleo() -> dict[str, Any]:
    try:
        return {"rows": _to_jsonable(catalogo_nucleo())}
    except Exception as exc:
        log.exception("aprobacion catalogo nucleo error")
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


@app.post("/v1/financialbi/hidrocarburos/aprobacion/{uuid}/reabrir")
def financial_aprobacion_reabrir(uuid: str, body: ReabrirBody) -> dict[str, Any]:
    """Deshace una aprobación o rechazo -- la factura vuelve a
    pendiente_validacion_compras. Sin control de rol (D27), igual que el
    resto de acciones de M3."""
    try:
        result = reabrir_aprobacion(uuid=uuid, **body.model_dump())
        _raise_if_not_ok(result)
        return {"ok": True, "estado": result["estado_actual"]}
    except HTTPException:
        raise
    except Exception as exc:
        log.exception("aprobacion reabrir error")
        raise HTTPException(status_code=500, detail=str(exc))


# --- Dashboard (Propuesta.md §3) ---------------------------------------------

@app.get("/v1/financialbi/hidrocarburos/dashboard")
def financial_dashboard(filtros: DashboardFiltros = Depends()) -> dict[str, Any]:
    try:
        values = filtros.model_dump()
        detalle_sat = values.pop("detalle_sat")
        detalle = values.pop("detalle")
        if detalle_sat:
            return _to_jsonable(dashboard_facturas_sat_atencion(**values))
        if detalle:
            return _to_jsonable(dashboard_facturas_detalle(**values))
        return _to_jsonable(dashboard_resumen_completo(**values))
    except Exception as exc:
        log.exception("dashboard error")
        raise HTTPException(status_code=500, detail=str(exc))
