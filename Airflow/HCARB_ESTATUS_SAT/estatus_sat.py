"""Cloud Run Job incremental para consultar el estado de CFDI en el SAT."""

from __future__ import annotations

import logging
import os
import time
import xml.etree.ElementTree as ET
from typing import Any

import requests
from google.cloud import bigquery

PROJECT = os.getenv("BQ_PROJECT_ID", "proan-quantrue")
LOCATION = os.getenv("BQ_LOCATION", "us-west4")
SAT_URL = "https://consultaqr.facturaelectronica.sat.gob.mx/ConsultaCFDIService.svc"
SOAP_ACTION = "http://tempuri.org/IConsultaCFDIService/Consulta"
TIMEOUT_SECONDS = 20
PAUSE_SECONDS = float(os.getenv("SAT_PAUSE_SECONDS", "1"))
RECHECK_DAYS = int(os.getenv("SAT_RECHECK_DAYS", "7"))
LIMIT = int(os.environ["SAT_LIMIT"]) if os.getenv("SAT_LIMIT") else None

FOLIO = f"`{PROJECT}.D60_REPORTING.HCARB_GOLD_CLASIFICACION_FOLIO`"
APPROVAL = f"`{PROJECT}.D60_REPORTING.HCARB_gold_aprobacion`"
STATUS = f"`{PROJECT}.D60_REPORTING.HCARB_ESTATUS_SAT`"

SOAP_TEMPLATE = """<?xml version="1.0" encoding="utf-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:tem="http://tempuri.org/">
  <soapenv:Header/>
  <soapenv:Body>
    <tem:Consulta>
      <tem:expresionImpresa><![CDATA[?re={re}&rr={rr}&tt={tt}&id={uuid}]]></tem:expresionImpresa>
    </tem:Consulta>
  </soapenv:Body>
</soapenv:Envelope>"""

DDL = f"""
CREATE TABLE IF NOT EXISTS {STATUS} (
  uuid STRING NOT NULL,
  estatus_cancelacion STRING NOT NULL,
  codigo_estatus STRING,
  es_cancelable STRING,
  estatus_cancelacion_sat STRING,
  fecha_consulta TIMESTAMP NOT NULL,
  fuente STRING NOT NULL
)"""

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("hcarb_estatus_sat")
client = bigquery.Client(project=PROJECT, location=LOCATION)


def local_name(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def field(root: ET.Element, name: str) -> str | None:
    return next((element.text for element in root.iter() if local_name(element.tag) == name), None)


def candidates() -> list[dict[str, Any]]:
    limit_sql = "LIMIT @limit" if LIMIT else ""
    query = f"""
      SELECT f.uuid, f.emisor_rfc, f.receptor_rfc, f.total
      FROM {FOLIO} f
      LEFT JOIN {STATUS} e ON f.uuid = e.uuid
      LEFT JOIN {APPROVAL} a ON f.uuid = a.uuid
      WHERE e.uuid IS NULL
         OR (
              COALESCE(a.estado, 'pendiente_validacion_compras') != 'aprobada'
              AND e.fecha_consulta < TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL {RECHECK_DAYS} DAY)
            )
      ORDER BY f.fecha DESC
      {limit_sql}
    """
    params = [bigquery.ScalarQueryParameter("limit", "INT64", LIMIT)] if LIMIT else []
    rows = client.query(query, job_config=bigquery.QueryJobConfig(query_parameters=params)).result()
    return [dict(row.items()) for row in rows]


def query_sat(invoice: dict[str, Any]) -> dict[str, Any]:
    body = SOAP_TEMPLATE.format(
        re=invoice["emisor_rfc"],
        rr=invoice["receptor_rfc"],
        tt=f"{float(invoice['total']):.2f}",
        uuid=invoice["uuid"],
    )
    response = requests.post(
        SAT_URL,
        data=body.encode("utf-8"),
        headers={"Content-Type": "text/xml; charset=utf-8", "SOAPAction": f'"{SOAP_ACTION}"'},
        timeout=TIMEOUT_SECONDS,
    )
    response.raise_for_status()
    root = ET.fromstring(response.text)
    raw_status = (field(root, "Estado") or "").strip()
    return {
        "uuid": invoice["uuid"],
        "estatus_cancelacion": raw_status.lower() if raw_status.lower() in {"vigente", "cancelado"} else "no_encontrado",
        "codigo_estatus": field(root, "CodigoEstatus"),
        "es_cancelable": field(root, "EsCancelable"),
        "estatus_cancelacion_sat": field(root, "EstatusCancelacion"),
    }


def save(result: dict[str, Any]) -> None:
    query = f"""
      MERGE {STATUS} target
      USING (SELECT @uuid uuid, @status estatus_cancelacion, @code codigo_estatus,
        @cancelable es_cancelable, @cancellation estatus_cancelacion_sat,
        CURRENT_TIMESTAMP() fecha_consulta, 'sat_webservice' fuente) source
      ON target.uuid = source.uuid
      WHEN MATCHED THEN UPDATE SET
        estatus_cancelacion=source.estatus_cancelacion, codigo_estatus=source.codigo_estatus,
        es_cancelable=source.es_cancelable, estatus_cancelacion_sat=source.estatus_cancelacion_sat,
        fecha_consulta=source.fecha_consulta, fuente=source.fuente
      WHEN NOT MATCHED THEN INSERT
        (uuid, estatus_cancelacion, codigo_estatus, es_cancelable, estatus_cancelacion_sat, fecha_consulta, fuente)
      VALUES (source.uuid, source.estatus_cancelacion, source.codigo_estatus, source.es_cancelable,
        source.estatus_cancelacion_sat, source.fecha_consulta, source.fuente)
    """
    values = [
        bigquery.ScalarQueryParameter("uuid", "STRING", result["uuid"]),
        bigquery.ScalarQueryParameter("status", "STRING", result["estatus_cancelacion"]),
        bigquery.ScalarQueryParameter("code", "STRING", result["codigo_estatus"]),
        bigquery.ScalarQueryParameter("cancelable", "STRING", result["es_cancelable"]),
        bigquery.ScalarQueryParameter("cancellation", "STRING", result["estatus_cancelacion_sat"]),
    ]
    client.query(query, job_config=bigquery.QueryJobConfig(query_parameters=values)).result()


def main() -> None:
    client.query(DDL).result()
    pending = candidates()
    ok = failed = 0
    for index, invoice in enumerate(pending):
        try:
            save(query_sat(invoice))
            ok += 1
        except Exception:
            failed += 1
            log.exception("Error consultando UUID %s", invoice["uuid"])
        if index < len(pending) - 1:
            time.sleep(PAUSE_SECONDS)
    log.info("HCARB SAT: total=%d ok=%d fallidos=%d", len(pending), ok, failed)
    if failed:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
