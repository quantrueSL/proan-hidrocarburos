from __future__ import annotations

import logging
import math
from datetime import date, datetime
from decimal import Decimal
from typing import Any

from fastapi import FastAPI, HTTPException, Query, Response
from pydantic import BaseModel

from facturas_api import repository
from facturas_api.reconstruccion import ReconstruccionInvalida, parse_reconstruido, reconstruir_xml
from facturas_api.render_pdf import render as render_pdf

log = logging.getLogger(__name__)

app = FastAPI(title="Facturas API", version="0.1.0")


def _to_jsonable(value: Any) -> Any:
    """Igual que `_to_jsonable` en `apps/financialbi/financialbi/app.py` --
    se replica en vez de compartirse (no hay librería interna común hoy)."""
    if isinstance(value, dict):
        return {k: _to_jsonable(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_to_jsonable(v) for v in value]
    if isinstance(value, Decimal):
        return float(value)
    if isinstance(value, float) and (math.isnan(value) or math.isinf(value)):
        return None
    if isinstance(value, (datetime, date)):
        return str(value)
    if value is None:
        return None
    return value


class FacturaMetadata(BaseModel):
    uuid: str
    serie: str | None
    folio: str | None
    fecha: str | None
    rfc_emisor: str | None
    nombre_emisor: str | None
    total: float | None
    moneda: str | None
    estatus_cancelacion_sat: str | None
    urls: dict[str, str]


def _error(status_code: int, error: str, detail: str) -> HTTPException:
    return HTTPException(status_code=status_code, detail={"error": error, "detail": detail})


def _a_metadata(row: dict[str, Any]) -> FacturaMetadata:
    row = _to_jsonable(row)
    uuid = row["uuid"]
    return FacturaMetadata(
        uuid=uuid,
        serie=row.get("serie"),
        folio=row.get("folio"),
        fecha=row.get("fecha"),
        rfc_emisor=row.get("rfc_emisor"),
        nombre_emisor=row.get("nombre_emisor"),
        total=row.get("total"),
        moneda=row.get("moneda"),
        estatus_cancelacion_sat=row.get("estatus_cancelacion"),
        urls={
            "xml": f"/v1/facturas/{uuid}/xml",
            "pdf": f"/v1/facturas/{uuid}/pdf",
        },
    )


def _nombre_archivo(row: dict[str, Any], uuid: str, extension: str) -> str:
    serie = row.get("serie") or ""
    folio = row.get("folio") or ""
    return f"{serie}{folio}_{uuid}.{extension}"


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/v1/facturas", response_model=list[FacturaMetadata])
def buscar_facturas(
    rfc_emisor: str | None = Query(default=None),
    serie: str | None = Query(default=None),
    folio: str | None = Query(default=None),
    fecha_desde: date | None = Query(default=None),
    fecha_hasta: date | None = Query(default=None),
) -> list[FacturaMetadata]:
    if fecha_desde and fecha_hasta and fecha_desde > fecha_hasta:
        raise _error(400, "parametros_invalidos", "fecha_desde no puede ser posterior a fecha_hasta.")
    try:
        rows = repository.buscar_facturas(
            rfc_emisor=rfc_emisor,
            serie=serie,
            folio=folio,
            fecha_desde=fecha_desde.isoformat() if fecha_desde else None,
            fecha_hasta=fecha_hasta.isoformat() if fecha_hasta else None,
        )
    except Exception as exc:
        log.exception("facturas search error")
        raise _error(500, "error_interno", str(exc)) from exc
    return [_a_metadata(r) for r in rows]


@app.get("/v1/facturas/{uuid}", response_model=FacturaMetadata)
def obtener_factura(uuid: str) -> FacturaMetadata:
    try:
        row = repository.get_factura_metadata(uuid)
    except Exception as exc:
        log.exception("factura metadata error")
        raise _error(500, "error_interno", str(exc)) from exc
    if row is None:
        raise _error(404, "factura_no_encontrada", "No existe ninguna factura de gas con ese UUID.")
    return _a_metadata(row)


@app.get("/v1/facturas/{uuid}/xml")
def obtener_xml(uuid: str) -> Response:
    try:
        row = repository.get_factura_metadata(uuid)
        comprobante_json = repository.get_comprobante_json(uuid)
    except Exception as exc:
        log.exception("factura xml error")
        raise _error(500, "error_interno", str(exc)) from exc

    if row is None or comprobante_json is None:
        raise _error(404, "factura_no_encontrada", "No existe ninguna factura de gas con ese UUID.")

    try:
        xml_bytes = reconstruir_xml(comprobante_json)
    except ReconstruccionInvalida as exc:
        log.exception("factura xml reconstruccion error uuid=%s", uuid)
        raise _error(503, "generacion_no_disponible", str(exc)) from exc

    filename = _nombre_archivo(row, uuid, "xml")
    return Response(
        content=xml_bytes,
        media_type="application/xml",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@app.get("/v1/facturas/{uuid}/pdf")
def obtener_pdf(uuid: str) -> Response:
    try:
        row = repository.get_factura_metadata(uuid)
        comprobante_json = repository.get_comprobante_json(uuid)
    except Exception as exc:
        log.exception("factura pdf error")
        raise _error(500, "error_interno", str(exc)) from exc

    if row is None or comprobante_json is None:
        raise _error(404, "factura_no_encontrada", "No existe ninguna factura de gas con ese UUID.")

    try:
        xml_bytes = reconstruir_xml(comprobante_json)
        xml_root = parse_reconstruido(xml_bytes)
        cancelado = row.get("estatus_cancelacion") == "cancelado"
        pdf_bytes = render_pdf(xml_root, cancelado=cancelado)
    except ReconstruccionInvalida as exc:
        log.exception("factura pdf reconstruccion error uuid=%s", uuid)
        raise _error(503, "generacion_no_disponible", str(exc)) from exc
    except Exception as exc:
        log.exception("factura pdf render error uuid=%s", uuid)
        raise _error(503, "generacion_no_disponible", str(exc)) from exc

    filename = _nombre_archivo(row, uuid, "pdf")
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
