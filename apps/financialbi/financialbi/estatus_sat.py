"""Estatus de cancelación SAT (D24) -- consulta el webservice público del SAT
"Consulta de Estado de CFDI" y guarda el resultado en HCARB_ESTATUS_SAT.

Protocolo verificado EN VIVO jul-2026 contra la WSDL real
(https://consultaqr.facturaelectronica.sat.gob.mx/ConsultaCFDIService.svc?singleWsdl)
y probado con una llamada real (una factura real -- resultó Cancelado -- y un
UUID inventado -- resultó No Encontrado):
  - SOAPAction: http://tempuri.org/IConsultaCFDIService/Consulta
  - Parámetro de petición: `expresionImpresa` (NO `expresionImpresionFiscal`,
    que es como se suele recordar/documentar de memoria -- se corrigió contra
    la WSDL real antes de escribir este archivo).
  - Respuesta (tipo Acuse): CodigoEstatus, EsCancelable, Estado,
    EstatusCancelacion, ValidacionEFOS. `Estado` ∈ {"Vigente", "Cancelado",
    "No Encontrado"}.

Sin credenciales (D30) -- servicio público. Sin límite de tasa oficial, pero
el SAT throttlea IPs agresivas -- se corre secuencial con pausa entre
llamadas, nunca en paralelo.

Cadencia (D30): consulta las facturas sin estatus todavía, y re-consulta
periódicamente las que no estén `aprobada` -- una vez aprobada, una
cancelación posterior es un caso de disputa manual, no de re-chequeo
automático.

Pensado para invocarse a mano (`python -m financialbi.estatus_sat`) hasta que
exista el DAG de Airflow -- mismo patrón que tenía `materialize_alerts.py`
antes de borrarse (Maka-legacy), pero para esto sí aplica.
"""

from __future__ import annotations

import logging
import time
import xml.etree.ElementTree as ET
from typing import Any

import requests
from google.cloud import bigquery

from financialbi.db import _get_bq_client
from financialbi.hidrocarburos_engine import _FOLIO

log = logging.getLogger(__name__)

_SAT_URL = "https://consultaqr.facturaelectronica.sat.gob.mx/ConsultaCFDIService.svc"
_SAT_SOAP_ACTION = "http://tempuri.org/IConsultaCFDIService/Consulta"
_SAT_TIMEOUT_SEGUNDOS = 20
_PAUSA_ENTRE_LLAMADAS_SEGUNDOS = 1.0
_RECHEQUEO_DIAS = 7

_ESTATUS_SAT_TABLE = "proan-quantrue.D60_REPORTING.HCARB_ESTATUS_SAT"
_ESTATUS_SAT = f"`{_ESTATUS_SAT_TABLE}`"
_APROBACION = "`proan-quantrue.D60_REPORTING.HCARB_gold_aprobacion`"

_SCHEMA_DDL = f"""
CREATE TABLE IF NOT EXISTS {_ESTATUS_SAT} (
  uuid STRING NOT NULL,
  estatus_cancelacion STRING NOT NULL,      -- 'vigente' | 'cancelado' | 'no_encontrado'
  codigo_estatus STRING,                    -- texto crudo del SAT (para depurar)
  es_cancelable STRING,
  estatus_cancelacion_sat STRING,           -- texto crudo "EstatusCancelacion" del SAT
  fecha_consulta TIMESTAMP NOT NULL,
  fuente STRING NOT NULL
)
"""

_SOAP_TEMPLATE = """<?xml version="1.0" encoding="utf-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:tem="http://tempuri.org/">
  <soapenv:Header/>
  <soapenv:Body>
    <tem:Consulta>
      <tem:expresionImpresa><![CDATA[?re={re}&rr={rr}&tt={tt}&id={uuid}]]></tem:expresionImpresa>
    </tem:Consulta>
  </soapenv:Body>
</soapenv:Envelope>"""

_ESTADO_MAP = {"vigente": "vigente", "cancelado": "cancelado"}


def ensure_schema() -> None:
    """Crea HCARB_ESTATUS_SAT si no existe. Idempotente."""
    _get_bq_client().query(_SCHEMA_DDL).result()


def _local(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def _campo(root: ET.Element, nombre: str) -> str | None:
    for el in root.iter():
        if _local(el.tag) == nombre:
            return el.text
    return None


def consultar_uno(*, uuid: str, emisor_rfc: str, receptor_rfc: str, total: float) -> dict[str, Any]:
    """Llama al webservice del SAT para una factura. Propaga cualquier error
    de red/parseo -- el llamador (run()) decide si reintentar o saltar."""
    body = _SOAP_TEMPLATE.format(re=emisor_rfc, rr=receptor_rfc, tt=f"{float(total):.2f}", uuid=uuid)
    response = requests.post(
        _SAT_URL,
        data=body.encode("utf-8"),
        headers={
            "Content-Type": "text/xml; charset=utf-8",
            "SOAPAction": f'"{_SAT_SOAP_ACTION}"',
        },
        timeout=_SAT_TIMEOUT_SEGUNDOS,
    )
    response.raise_for_status()
    root = ET.fromstring(response.text)
    estado_crudo = (_campo(root, "Estado") or "").strip()
    return {
        "uuid": uuid,
        "estatus_cancelacion": _ESTADO_MAP.get(estado_crudo.lower(), "no_encontrado"),
        "codigo_estatus": _campo(root, "CodigoEstatus"),
        "es_cancelable": _campo(root, "EsCancelable"),
        "estatus_cancelacion_sat": _campo(root, "EstatusCancelacion"),
    }


def _candidatos(limite: int | None = None) -> list[dict[str, Any]]:
    """Facturas sin consultar todavía, o consultadas hace más de
    _RECHEQUEO_DIAS y que no estén `aprobada` (D30)."""
    query = f"""
      SELECT f.uuid, f.emisor_rfc, f.receptor_rfc, f.total
      FROM {_FOLIO} f
      LEFT JOIN {_ESTATUS_SAT} e ON f.uuid = e.uuid
      LEFT JOIN {_APROBACION} a ON f.uuid = a.uuid
      WHERE e.uuid IS NULL
         OR (
              COALESCE(a.estado, 'pendiente_validacion_compras') != 'aprobada'
              AND e.fecha_consulta < TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL {_RECHEQUEO_DIAS} DAY)
            )
      ORDER BY f.fecha DESC
      {"LIMIT @limite" if limite else ""}
    """
    params = [bigquery.ScalarQueryParameter("limite", "INT64", limite)] if limite else []
    job_config = bigquery.QueryJobConfig(query_parameters=params)
    result = _get_bq_client().query(query, job_config=job_config).result()
    return [dict(row.items()) for row in result]


def _guardar(resultado: dict[str, Any]) -> None:
    query = f"""
      MERGE {_ESTATUS_SAT} AS destino
      USING (SELECT
        @uuid AS uuid, @estatus_cancelacion AS estatus_cancelacion,
        @codigo_estatus AS codigo_estatus, @es_cancelable AS es_cancelable,
        @estatus_cancelacion_sat AS estatus_cancelacion_sat,
        CURRENT_TIMESTAMP() AS fecha_consulta, 'sat_webservice' AS fuente
      ) AS origen
      ON destino.uuid = origen.uuid
      WHEN MATCHED THEN UPDATE SET
        estatus_cancelacion = origen.estatus_cancelacion,
        codigo_estatus = origen.codigo_estatus,
        es_cancelable = origen.es_cancelable,
        estatus_cancelacion_sat = origen.estatus_cancelacion_sat,
        fecha_consulta = origen.fecha_consulta,
        fuente = origen.fuente
      WHEN NOT MATCHED THEN
        INSERT (uuid, estatus_cancelacion, codigo_estatus, es_cancelable, estatus_cancelacion_sat, fecha_consulta, fuente)
        VALUES (origen.uuid, origen.estatus_cancelacion, origen.codigo_estatus, origen.es_cancelable, origen.estatus_cancelacion_sat, origen.fecha_consulta, origen.fuente)
    """
    params = [
        bigquery.ScalarQueryParameter("uuid", "STRING", resultado["uuid"]),
        bigquery.ScalarQueryParameter("estatus_cancelacion", "STRING", resultado["estatus_cancelacion"]),
        bigquery.ScalarQueryParameter("codigo_estatus", "STRING", resultado.get("codigo_estatus")),
        bigquery.ScalarQueryParameter("es_cancelable", "STRING", resultado.get("es_cancelable")),
        bigquery.ScalarQueryParameter("estatus_cancelacion_sat", "STRING", resultado.get("estatus_cancelacion_sat")),
    ]
    _get_bq_client().query(query, job_config=bigquery.QueryJobConfig(query_parameters=params)).result()


def run(limite: int | None = None) -> dict[str, int]:
    """Corre el chequeo por lotes. Ritmo secuencial con pausa (D30) -- nunca
    en paralelo, para no golpear el servicio del SAT."""
    ensure_schema()
    candidatos = _candidatos(limite)
    ok = 0
    fallidos = 0
    for i, factura in enumerate(candidatos):
        try:
            resultado = consultar_uno(
                uuid=factura["uuid"],
                emisor_rfc=factura["emisor_rfc"],
                receptor_rfc=factura["receptor_rfc"],
                total=factura["total"],
            )
            _guardar(resultado)
            ok += 1
        except Exception:
            log.exception("Fallo consultando estatus SAT para %s", factura["uuid"])
            fallidos += 1
        if i < len(candidatos) - 1:
            time.sleep(_PAUSA_ENTRE_LLAMADAS_SEGUNDOS)
    log.info("Estatus SAT: %d ok, %d fallidos de %d candidatos", ok, fallidos, len(candidatos))
    return {"ok": ok, "fallidos": fallidos, "total": len(candidatos)}


if __name__ == "__main__":
    import sys

    limite_arg = int(sys.argv[1]) if len(sys.argv) > 1 else None
    resumen = run(limite_arg)
    print(f"Estatus SAT: {resumen['ok']} ok, {resumen['fallidos']} fallidos de {resumen['total']} candidatos")
