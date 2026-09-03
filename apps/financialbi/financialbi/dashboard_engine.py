"""Dashboard ejecutivo (Propuesta.md §3) -- resumen de estatus y análisis de
gasto. Una sola función/endpoint (`resumen_completo`) en vez de varias
sueltas, mismo criterio de "menos queries" que el resto del proyecto.

A. Resumen de estatus: total emitidas, validadas (pasaron Compras), aprobadas,
   rechazadas, pendientes -- más lo que aporta D24 (estatus_sat.py): vigentes/
   canceladas/sin consultar ante el SAT, y la cobertura MSEG (jul-2026, ver
   HCARB_gold_validacion_sap.sql -- confianza_mseg Alta/Media/sin evidencia).
B. Análisis de gasto: por proveedor, por sitio, por CECO (con nombre resuelto
   vía catálogo SAP), y acumulado por periodo (mensual).

Filtros (jul-2026): fecha_desde/fecha_hasta + proveedor_id/estado_sap/
confianza_mseg/estatus_sat acotan las 5 queries a la vez (mismo WHERE
compartido), vía el panel de filtros lateral (igual criterio que M2/M3).

No se desglosa por "sociedad" (Propuesta original) porque el alcance actual
(D1/D2, provisional) es una sola razón social -- si se ratifica ampliar el
alcance, añadir esa dimensión aquí.
"""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from datetime import date
from typing import Any

from google.cloud import bigquery

from financialbi.aprobacion_engine import _APROBACION, _CECO_CATALOGO, _NUCLEO
from financialbi.db import get_bq_client
from financialbi.hidrocarburos_engine import _FOLIO, _SAP, _VENDORS

_ESTATUS_SAT = "`proan-quantrue.D60_REPORTING.HCARB_ESTATUS_SAT`"


def _volumen_litros(alias: str = "f") -> str:
    """Convierte el volumen facturado a litros; unidades no físicas aportan 0."""
    return f"""CASE
      WHEN {alias}.clave_unidad_principal = 'LTR' THEN COALESCE({alias}.cantidad_principal, 0)
      WHEN {alias}.clave_unidad_principal = 'MTQ' THEN COALESCE({alias}.cantidad_principal, 0) * 1000
      ELSE 0
    END"""


def _construir_filtro(
    fecha_desde: date | None,
    fecha_hasta: date | None,
    proveedor_id: str | None,
    estado_sap: str | None,
    confianza_mseg: str | None,
    estatus_sat: str | None,
    periodo: str | None = None,
    sitio: str | None = None,
    ceco: str | None = None,
    estado_aprobacion: str | None = None,
    nucleo: str | None = None,
) -> tuple[str, list[bigquery.ScalarQueryParameter]]:
    # f siempre disponible (tabla base); s (_SAP) y e (_ESTATUS_SAT) deben estar
    # JOINeados en TODAS las sub-queries para que este WHERE compartido resuelva
    # sin importar cuál de los 5 bloques lo use -- ver joins añadidos abajo.
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
    if confianza_mseg:
        if confianza_mseg == "sin_evidencia":
            clauses.append("s.confianza_mseg IS NULL")
        else:
            clauses.append("s.confianza_mseg = @confianza_mseg")
            params.append(bigquery.ScalarQueryParameter("confianza_mseg", "STRING", confianza_mseg))
    if estatus_sat:
        if estatus_sat == "sin_confirmar":
            clauses.append("(e.uuid IS NULL OR e.estatus_cancelacion = 'no_encontrado')")
        else:
            clauses.append("e.estatus_cancelacion = @estatus_sat")
            params.append(bigquery.ScalarQueryParameter("estatus_sat", "STRING", estatus_sat))
    if periodo:
        clauses.append("FORMAT_DATE('%Y-%m', DATE(f.fecha)) = @periodo")
        params.append(bigquery.ScalarQueryParameter("periodo", "STRING", periodo))
    if sitio:
        clauses.append("COALESCE(a.werks_manual, s.sitio_consumo, 'Sin sitio') = @sitio")
        params.append(bigquery.ScalarQueryParameter("sitio", "STRING", sitio))
    if ceco == "__SIN_CECO__":
        clauses.append("COALESCE(a.ceco, s.ceco_sugerido) IS NULL")
    elif ceco == "__VARIOS_CECO__":
        # Mismo sentinela que usa _gasto_por_ceco para agrupar TODAS las
        # combinaciones ambiguas en una sola barra -- aquí el drill-down: toda
        # factura con varios CECO sugeridos que Compras todavía no ha resuelto
        # por ticket (si ya lo confirmó, ceco_por_ticket no es NULL y esta
        # factura ya no cuenta como "sin confirmar", aunque el legado `ceco`
        # siga siendo una lista si los CECO confirmados son distintos entre sí).
        clauses.append("a.ceco_por_ticket IS NULL AND STRPOS(COALESCE(a.ceco, s.ceco_sugerido), ',') > 0")
    elif ceco:
        # Ademas del match exacto de siempre, si la factura tiene un reparto por
        # ticket confirmado (ceco_por_ticket, ago-2026) el CECO buscado puede ser
        # solo una parte del reparto -- sin este OR, filtrar el dashboard por un
        # CECO real dejaria fuera facturas donde ese CECO es uno de varios.
        clauses.append("""(
          COALESCE(a.ceco, s.ceco_sugerido) = @ceco
          OR EXISTS (
            SELECT 1 FROM UNNEST(JSON_EXTRACT_ARRAY(a.ceco_por_ticket)) AS ticket_json
            WHERE JSON_VALUE(ticket_json, '$.ceco') = @ceco
          )
        )""")
        params.append(bigquery.ScalarQueryParameter("ceco", "STRING", ceco))
    if estado_aprobacion:
        clauses.append("COALESCE(a.estado, 'pendiente_validacion_compras') = @estado_aprobacion")
        params.append(bigquery.ScalarQueryParameter("estado_aprobacion", "STRING", estado_aprobacion))
    if nucleo == "__SIN_NUCLEO__":
        # Ninguno de los CeCo de esta factura (el legado o los confirmados por
        # ticket) aparece en el cruce Nucleo<->CeCo (dim_nucleo_draft, solo
        # filas estado='confirmado') -- mismo criterio que usa _gasto_por_nucleo
        # para el bucket 'Sin núcleo asignado': excluye explícitamente las
        # facturas sin CeCo o con varios CeCo sin confirmar (esas ya tienen su
        # propio bucket -- __SIN_CECO__/__VARIOS_CECO__, ver filtro ceco=).
        # NOTA: EXISTS(UNNEST(...)) anidado dentro de otro EXISTS/IN contra
        # otra tabla no es soportado por BigQuery ("Correlated subqueries that
        # reference other tables are not supported..." -- verificado en vivo);
        # por eso se usa IN + JOIN dentro del EXISTS en vez de EXISTS anidado.
        clauses.append(f"""(
          COALESCE(a.ceco, s.ceco_sugerido) IS NOT NULL
          AND STRPOS(COALESCE(a.ceco, s.ceco_sugerido), ',') = 0
          AND COALESCE(a.ceco, s.ceco_sugerido) NOT IN (
            SELECT ceco FROM {_NUCLEO} WHERE estado = 'confirmado'
          )
          AND NOT EXISTS (
            SELECT 1 FROM UNNEST(JSON_EXTRACT_ARRAY(a.ceco_por_ticket)) AS tj
            JOIN {_NUCLEO} nuc ON nuc.ceco = JSON_VALUE(tj, '$.ceco')
            WHERE nuc.estado = 'confirmado'
          )
        )""")
    elif nucleo:
        clauses.append(f"""(
          COALESCE(a.ceco, s.ceco_sugerido) IN (
            SELECT ceco FROM {_NUCLEO} WHERE estado = 'confirmado' AND nucleo = @nucleo
          )
          OR EXISTS (
            SELECT 1 FROM UNNEST(JSON_EXTRACT_ARRAY(a.ceco_por_ticket)) AS tj
            JOIN {_NUCLEO} nuc ON nuc.ceco = JSON_VALUE(tj, '$.ceco')
            WHERE nuc.estado = 'confirmado' AND nuc.nucleo = @nucleo
          )
        )""")
        params.append(bigquery.ScalarQueryParameter("nucleo", "STRING", nucleo))
    return " AND ".join(clauses), params


def _rows(query: str, params: list[bigquery.ScalarQueryParameter] | None = None) -> list[dict[str, Any]]:
    job_config = bigquery.QueryJobConfig(query_parameters=params or [])
    result = get_bq_client().query(query, job_config=job_config).result()
    return [dict(row.items()) for row in result]


def _resumen_estatus(where: str, params: list[bigquery.ScalarQueryParameter]) -> dict[str, Any]:
    query = f"""
      SELECT
        COUNT(*) AS total_facturas,
        COUNTIF(COALESCE(a.estado, 'pendiente_validacion_compras') != 'pendiente_validacion_compras') AS validadas,
        COUNTIF(a.estado = 'aprobada') AS aprobadas,
        COUNTIF(a.estado = 'rechazada') AS rechazadas,
        COUNTIF(COALESCE(a.estado, 'pendiente_validacion_compras') = 'pendiente_validacion_compras') AS pendientes,
        COUNTIF(a.estado = 'pendiente_aprobacion_gerencia') AS pendientes_gerencia,
        COALESCE(SUM(f.importe_gas), 0) AS importe_gas_total,
        COUNTIF(e.estatus_cancelacion = 'vigente') AS vigentes_sat,
        COUNTIF(e.estatus_cancelacion = 'cancelado') AS canceladas_sat,
        COUNTIF(e.uuid IS NULL OR e.estatus_cancelacion = 'no_encontrado') AS sin_confirmar_sat,
        COUNTIF(s.estado_sap = 'validada_sap') AS validadas_sap,
        COUNTIF(s.confianza_mseg = 'Alta') AS mseg_alta,
        COUNTIF(s.confianza_mseg = 'Media') AS mseg_media,
        COUNTIF(s.confianza_mseg IS NULL) AS mseg_sin_evidencia
      FROM {_FOLIO} f
      LEFT JOIN {_APROBACION} a ON f.uuid = a.uuid
      LEFT JOIN {_ESTATUS_SAT} e ON f.uuid = e.uuid
      LEFT JOIN {_SAP} s ON f.uuid = s.uuid
      WHERE {where}
    """
    rows = _rows(query, params)
    return rows[0] if rows else {}


def facturas_sat_atencion(
    *,
    fecha_desde: date | None = None,
    fecha_hasta: date | None = None,
    proveedor_id: str | None = None,
    estado_sap: str | None = None,
    confianza_mseg: str | None = None,
    estatus_sat: str | None = None,
    periodo: str | None = None,
    sitio: str | None = None,
    ceco: str | None = None,
    estado_aprobacion: str | None = None,
    nucleo: str | None = None,
) -> dict[str, Any]:
    """Detalle bajo demanda para el modal SAT del dashboard."""
    where, params = _construir_filtro(
        fecha_desde, fecha_hasta, proveedor_id, estado_sap, confianza_mseg, estatus_sat,
        periodo, sitio, ceco, estado_aprobacion, nucleo
    )
    query = f"""
      SELECT
        f.uuid,
        f.serie,
        CAST(f.folio AS STRING) AS folio,
        DATE(f.fecha) AS fecha,
        COALESCE(v.razon_social, f.emisor_rfc) AS proveedor,
        f.importe_gas,
        CASE
          WHEN e.estatus_cancelacion = 'cancelado' THEN 'cancelado'
          ELSE 'sin_confirmar'
        END AS estatus_sat
      FROM {_FOLIO} f
      LEFT JOIN {_VENDORS} v ON f.id_proveedor = v.id_proveedor
      LEFT JOIN {_APROBACION} a ON f.uuid = a.uuid
      LEFT JOIN {_SAP} s ON f.uuid = s.uuid
      LEFT JOIN {_ESTATUS_SAT} e ON f.uuid = e.uuid
      WHERE {where}
        AND (e.estatus_cancelacion = 'cancelado'
          OR e.uuid IS NULL
          OR e.estatus_cancelacion = 'no_encontrado')
      ORDER BY
        CASE WHEN e.estatus_cancelacion = 'cancelado' THEN 0 ELSE 1 END,
        DATE(f.fecha) DESC,
        proveedor
    """
    rows = _rows(query, params)
    return {
        "total": len(rows),
        "canceladas": sum(row["estatus_sat"] == "cancelado" for row in rows),
        "sin_confirmar": sum(row["estatus_sat"] == "sin_confirmar" for row in rows),
        "rows": rows,
    }


def _gasto_por_ceco(where: str, params: list[bigquery.ScalarQueryParameter]) -> list[dict[str, Any]]:
    """CECO real es COALESCE(a.ceco, el asignado a mano en Compras,
    s.ceco_sugerido, evidencia real de SAP/MSEG: ver HCARB_gold_validacion_sap.sql).
    Puede traer varios códigos separados por coma cuando el documento MSEG que
    casó reparte el gasto entre varios centros sin que ninguno domine (origen
    'documento_multiple', ~24% de las facturas) -- se agrupan TODOS bajo un
    único `filtro` fijo (`__VARIOS_CECO__`, mismo patrón que `__SIN_CECO__`),
    no por la combinación literal de códigos (bug corregido ago-2026: el
    comentario ya decía "una barra, no una por combinación" pero el `filtro`
    seguía siendo el string completo, así que cada combinación distinta salía
    como su propia fila -- ~30 filas idénticamente tituladas 'Varios CECO (sin
    confirmar)' en la tabla de prueba, todas menos una perdidas en el
    frontend por colisión de `key`, ver dashboard-workspace.tsx).

    ceco_por_ticket (ago-2026, ver aprobacion_engine.capturar_compras): cuando
    Compras SÍ confirmó un reparto por ticket, ya no hace falta esconder la
    factura en 'Varios CECO (sin confirmar)' -- se reparte importe_gas
    proporcionalmente entre los CECO reales confirmados (una fila por ticket,
    UNION ALL contra el resto de facturas que siguen con la lógica de siempre).
    volumen_litros se reparte con la misma proporción (no hay cantidad física
    por ticket en ceco_por_ticket, solo importe) -- aproximación razonable,
    consistente con que el importe también se reparte así. COUNT(DISTINCT
    x.uuid), no COUNT(*): una factura con 5 tickets del mismo CECO confirmado
    cuenta como 1 factura para ese CECO, no como 5."""
    query = f"""
      SELECT
        CASE
          WHEN x.ceco IS NULL THEN '__SIN_CECO__'
          WHEN STRPOS(x.ceco, ',') > 0 THEN '__VARIOS_CECO__'
          ELSE x.ceco
        END AS filtro,
        CASE
          WHEN x.ceco IS NULL THEN 'Sin CECO'
          WHEN STRPOS(x.ceco, ',') > 0 THEN 'Varios CECO (sin confirmar)'
          ELSE COALESCE(cat.LTEXT, x.ceco)
        END AS grupo,
        SUM(x.importe_gas) AS importe_gas,
        SUM(x.volumen_litros) AS volumen_litros,
        COUNT(DISTINCT x.uuid) AS n_facturas
      FROM (
        SELECT
          f.uuid,
          CAST(JSON_VALUE(ticket_json, '$.importe_ticket') AS FLOAT64) AS importe_gas,
          {_volumen_litros()} * SAFE_DIVIDE(CAST(JSON_VALUE(ticket_json, '$.importe_ticket') AS FLOAT64), f.importe_gas) AS volumen_litros,
          JSON_VALUE(ticket_json, '$.ceco') AS ceco
        FROM {_FOLIO} f
        JOIN {_APROBACION} a ON f.uuid = a.uuid AND a.ceco_por_ticket IS NOT NULL
        LEFT JOIN {_SAP} s ON f.uuid = s.uuid
        LEFT JOIN {_ESTATUS_SAT} e ON f.uuid = e.uuid,
          UNNEST(JSON_EXTRACT_ARRAY(a.ceco_por_ticket)) AS ticket_json
        WHERE {where}

        UNION ALL

        SELECT
          f.uuid,
          f.importe_gas,
          {_volumen_litros()} AS volumen_litros,
          COALESCE(a.ceco, s.ceco_sugerido) AS ceco
        FROM {_FOLIO} f
        LEFT JOIN {_APROBACION} a ON f.uuid = a.uuid
        LEFT JOIN {_SAP} s ON f.uuid = s.uuid
        LEFT JOIN {_ESTATUS_SAT} e ON f.uuid = e.uuid
        WHERE {where} AND a.ceco_por_ticket IS NULL
      ) x
      LEFT JOIN {_CECO_CATALOGO} cat ON cat.KOSTL = TRIM(x.ceco) AND cat.DATBI = '99991231' AND cat.KOKRS = 'PROA'
      GROUP BY filtro, grupo
      ORDER BY n_facturas DESC
    """
    return _rows(query, params)


def _gasto_por_nucleo(where: str, params: list[bigquery.ScalarQueryParameter]) -> list[dict[str, Any]]:
    """Igual que _gasto_por_ceco pero agrupando por Nucleo (dim_nucleo_draft,
    propuesta Methagas de agrupar instalaciones para el umbral de consumo,
    cruzada contra el catalogo real de SAP -- ver HALLAZGOS-FER.md secc. 11).
    Solo cuentan las filas estado='confirmado' del cruce -- todavia hay CeCo
    sin resolver (pendiente_confirmar) que no se usan para agrupar.

    La mayoria de facturas no tienen ningun CeCo dentro del alcance del
    Excel de nucleos (son CeCo de mantenimiento/administrativos, o el nucleo
    sigue pendiente_confirmar) -- caen en 'Sin nucleo asignado', el bucket
    mayoritario esperado hoy, no un error."""
    query = f"""
      SELECT
        CASE
          WHEN x.ceco IS NULL THEN '__SIN_CECO__'
          WHEN STRPOS(x.ceco, ',') > 0 THEN '__VARIOS_CECO__'
          WHEN nuc.nucleo IS NOT NULL THEN nuc.nucleo
          ELSE '__SIN_NUCLEO__'
        END AS filtro,
        CASE
          WHEN x.ceco IS NULL THEN 'Sin CECO'
          WHEN STRPOS(x.ceco, ',') > 0 THEN 'Varios CECO (sin confirmar)'
          WHEN nuc.nucleo IS NOT NULL THEN nuc.nucleo
          ELSE 'Sin núcleo asignado'
        END AS grupo,
        SUM(x.importe_gas) AS importe_gas,
        SUM(x.volumen_litros) AS volumen_litros,
        COUNT(DISTINCT x.uuid) AS n_facturas
      FROM (
        SELECT
          f.uuid,
          CAST(JSON_VALUE(ticket_json, '$.importe_ticket') AS FLOAT64) AS importe_gas,
          {_volumen_litros()} * SAFE_DIVIDE(CAST(JSON_VALUE(ticket_json, '$.importe_ticket') AS FLOAT64), f.importe_gas) AS volumen_litros,
          JSON_VALUE(ticket_json, '$.ceco') AS ceco
        FROM {_FOLIO} f
        JOIN {_APROBACION} a ON f.uuid = a.uuid AND a.ceco_por_ticket IS NOT NULL
        LEFT JOIN {_SAP} s ON f.uuid = s.uuid
        LEFT JOIN {_ESTATUS_SAT} e ON f.uuid = e.uuid,
          UNNEST(JSON_EXTRACT_ARRAY(a.ceco_por_ticket)) AS ticket_json
        WHERE {where}

        UNION ALL

        SELECT
          f.uuid,
          f.importe_gas,
          {_volumen_litros()} AS volumen_litros,
          COALESCE(a.ceco, s.ceco_sugerido) AS ceco
        FROM {_FOLIO} f
        LEFT JOIN {_APROBACION} a ON f.uuid = a.uuid
        LEFT JOIN {_SAP} s ON f.uuid = s.uuid
        LEFT JOIN {_ESTATUS_SAT} e ON f.uuid = e.uuid
        WHERE {where} AND a.ceco_por_ticket IS NULL
      ) x
      LEFT JOIN {_NUCLEO} nuc ON nuc.ceco = TRIM(x.ceco) AND nuc.estado = 'confirmado'
      GROUP BY filtro, grupo
      ORDER BY n_facturas DESC
    """
    return _rows(query, params)


def _gasto_por_proveedor(where: str, params: list[bigquery.ScalarQueryParameter]) -> list[dict[str, Any]]:
    """Gasto por proveedor (razón social) -- dato disponible desde la propia
    factura, no depende de que Compras/Gerencia hayan avanzado el flujo, así
    que siempre tiene cobertura completa (a diferencia de CECO/sitio)."""
    query = f"""
      SELECT
        f.id_proveedor AS filtro,
        COALESCE(v.razon_social, f.emisor_rfc) AS grupo,
        SUM(f.importe_gas) AS importe_gas,
        SUM({_volumen_litros()}) AS volumen_litros,
        COUNT(*) AS n_facturas
      FROM {_FOLIO} f
      LEFT JOIN {_VENDORS} v ON f.id_proveedor = v.id_proveedor
      LEFT JOIN {_APROBACION} a ON f.uuid = a.uuid
      LEFT JOIN {_SAP} s ON f.uuid = s.uuid
      LEFT JOIN {_ESTATUS_SAT} e ON f.uuid = e.uuid
      WHERE {where}
      GROUP BY filtro, grupo
      ORDER BY n_facturas DESC
    """
    return _rows(query, params)


def _gasto_por_sitio(where: str, params: list[bigquery.ScalarQueryParameter]) -> list[dict[str, Any]]:
    query = f"""
      SELECT
        COALESCE(a.werks_manual, s.sitio_consumo, 'Sin sitio') AS filtro,
        COALESCE(a.werks_manual, s.sitio_consumo, 'Sin sitio') AS grupo,
        SUM(f.importe_gas) AS importe_gas,
        SUM({_volumen_litros()}) AS volumen_litros,
        COUNT(*) AS n_facturas
      FROM {_FOLIO} f
      LEFT JOIN {_APROBACION} a ON f.uuid = a.uuid
      LEFT JOIN {_SAP} s ON f.uuid = s.uuid
      LEFT JOIN {_ESTATUS_SAT} e ON f.uuid = e.uuid
      WHERE {where}
      GROUP BY filtro, grupo
      ORDER BY n_facturas DESC
    """
    return _rows(query, params)


def _gasto_por_periodo(where: str, params: list[bigquery.ScalarQueryParameter]) -> list[dict[str, Any]]:
    query = f"""
      SELECT
        FORMAT_DATE('%Y-%m', DATE(f.fecha)) AS filtro,
        FORMAT_DATE('%Y-%m', DATE(f.fecha)) AS grupo,
        SUM(f.importe_gas) AS importe_gas,
        SUM({_volumen_litros()}) AS volumen_litros,
        COUNT(*) AS n_facturas
      FROM {_FOLIO} f
      LEFT JOIN {_APROBACION} a ON f.uuid = a.uuid
      LEFT JOIN {_SAP} s ON f.uuid = s.uuid
      LEFT JOIN {_ESTATUS_SAT} e ON f.uuid = e.uuid
      WHERE {where}
      GROUP BY filtro, grupo
      ORDER BY grupo
    """
    return _rows(query, params)


def facturas_detalle(
    *,
    fecha_desde: date | None = None,
    fecha_hasta: date | None = None,
    proveedor_id: str | None = None,
    estado_sap: str | None = None,
    confianza_mseg: str | None = None,
    estatus_sat: str | None = None,
    periodo: str | None = None,
    sitio: str | None = None,
    ceco: str | None = None,
    estado_aprobacion: str | None = None,
    nucleo: str | None = None,
) -> dict[str, Any]:
    """Facturas subyacentes a la selección interactiva del dashboard."""
    where, params = _construir_filtro(
        fecha_desde, fecha_hasta, proveedor_id, estado_sap, confianza_mseg, estatus_sat,
        periodo, sitio, ceco, estado_aprobacion, nucleo
    )
    query = f"""
      SELECT
        COUNT(*) OVER() AS _total,
        f.uuid,
        f.serie,
        CAST(f.folio AS STRING) AS folio,
        DATE(f.fecha) AS fecha,
        COALESCE(v.razon_social, f.emisor_rfc) AS proveedor,
        f.importe_gas,
        {_volumen_litros()} AS volumen_litros,
        COALESCE(a.estado, 'pendiente_validacion_compras') AS estado_aprobacion,
        COALESCE(s.estado_sap, 'sin_match_sap') AS estado_sap,
        COALESCE(s.confianza_mseg, 'sin_evidencia') AS confianza_mseg,
        CASE
          WHEN e.estatus_cancelacion = 'vigente' THEN 'vigente'
          WHEN e.estatus_cancelacion = 'cancelado' THEN 'cancelado'
          ELSE 'sin_confirmar'
        END AS estatus_sat,
        COALESCE(a.werks_manual, s.sitio_consumo, 'Sin sitio') AS sitio,
        COALESCE(a.ceco, s.ceco_sugerido) AS ceco,
        COALESCE(nuc.nucleo, 'Sin núcleo asignado') AS nucleo
      FROM {_FOLIO} f
      LEFT JOIN {_VENDORS} v ON f.id_proveedor = v.id_proveedor
      LEFT JOIN {_APROBACION} a ON f.uuid = a.uuid
      LEFT JOIN {_SAP} s ON f.uuid = s.uuid
      LEFT JOIN {_ESTATUS_SAT} e ON f.uuid = e.uuid
      LEFT JOIN {_NUCLEO} nuc ON nuc.ceco = COALESCE(a.ceco, s.ceco_sugerido) AND nuc.estado = 'confirmado'
      WHERE {where}
      ORDER BY DATE(f.fecha) DESC, proveedor, folio
      LIMIT 200
    """
    rows = _rows(query, params)
    total = int(rows[0]["_total"]) if rows else 0
    for row in rows:
        row.pop("_total", None)
    return {"total": total, "rows": rows}


def resumen_completo(
    *,
    fecha_desde: date | None = None,
    fecha_hasta: date | None = None,
    proveedor_id: str | None = None,
    estado_sap: str | None = None,
    confianza_mseg: str | None = None,
    estatus_sat: str | None = None,
    periodo: str | None = None,
    sitio: str | None = None,
    ceco: str | None = None,
    estado_aprobacion: str | None = None,
    nucleo: str | None = None,
) -> dict[str, Any]:
    """Todo el payload del dashboard en una sola llamada de red desde el
    frontend (aunque internamente sean 6 queries -- una por bloque). Los
    filtros acotan todo el payload a la vez, para que los números siempre
    concuerden entre KPIs y gráficos."""
    where, params = _construir_filtro(
        fecha_desde, fecha_hasta, proveedor_id, estado_sap, confianza_mseg, estatus_sat,
        periodo, sitio, ceco, estado_aprobacion, nucleo
    )
    # Cada query de BigQuery tiene un overhead apreciable de creación/espera
    # aunque el resultado esté cacheado. Son bloques independientes y el cliente
    # compartido es seguro entre hilos, así que se ejecutan concurrentemente.
    with ThreadPoolExecutor(max_workers=6) as executor:
        resumen_future = executor.submit(_resumen_estatus, where, params)
        proveedor_future = executor.submit(_gasto_por_proveedor, where, params)
        sitio_future = executor.submit(_gasto_por_sitio, where, params)
        ceco_future = executor.submit(_gasto_por_ceco, where, params)
        nucleo_future = executor.submit(_gasto_por_nucleo, where, params)
        periodo_future = executor.submit(_gasto_por_periodo, where, params)

    return {
        "resumen": resumen_future.result(),
        "gasto_por_proveedor": proveedor_future.result(),
        "gasto_por_sitio": sitio_future.result(),
        "gasto_por_ceco": ceco_future.result(),
        "gasto_por_nucleo": nucleo_future.result(),
        "gasto_por_periodo": periodo_future.result(),
    }
