"""Tabla de aprobación de facturas (Módulo 3) -- mutable, propiedad de la app.

A diferencia de las tablas HCARB_GOLD_* (recalculadas enteras por ConsultasBigQuery/,
ver ../../../ConsultasBigQuery/), esta tabla la escribe el backend directamente
(INSERT/UPDATE) según las acciones de Compras y Gerencia -- esquema completo en
ConsultasBigQuery/HCARB_gold_aprobacion_schema.sql.

Workflow de dos roles (D23): pendiente_validacion_compras (Compras captura CECO
y confirma/corrige el sitio) -> pendiente_aprobacion_gerencia (Gerencia
aprueba/rechaza) -> aprobada | rechazada. Identidad de usuario (D27): texto libre
por ahora, no viene de un login con roles reales -- auth real queda como deuda
técnica explícita.
"""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from datetime import date
from typing import Any, Literal

from google.cloud import bigquery

from financialbi.db import get_bq_client
from financialbi.hidrocarburos_engine import _FOLIO, _SAP, _VENDORS

_APROBACION_TABLE = "proan-quantrue.D60_REPORTING.HCARB_gold_aprobacion"
_APROBACION = f"`{_APROBACION_TABLE}`"
_CECO_CATALOGO = "`proan-quantrue.D00_SANDBOX.proan_CSKT_20260714`"
_CENTROS = "`proan-quantrue.D20_DIMENSION.dm_centros`"

Rol = Literal["compras", "gerencia"]

ESTADOS = (
    "pendiente_validacion_compras",
    "pendiente_aprobacion_gerencia",
    "aprobada",
    "rechazada",
)

_SCHEMA_DDL = f"""
CREATE TABLE IF NOT EXISTS {_APROBACION} (
  uuid STRING NOT NULL,
  -- valores válidos: ver ESTADOS arriba (BigQuery no soporta CHECK constraints
  -- de valor -- se valida en el backend, no en la tabla).
  estado STRING NOT NULL,
  ceco STRING,
  werks_manual STRING,
  usuario_compras STRING,
  fecha_validacion_compras TIMESTAMP,
  comentario_compras STRING,
  usuario_gerencia STRING,
  fecha_aprobacion_gerencia TIMESTAMP,
  comentario_gerencia STRING,
  rechazada_por_rol STRING,
  motivo_rechazo STRING,
  -- Reversibilidad: quién reabrió la última vez y por qué (no histórico completo,
  -- solo la última reapertura -- una tabla de auditoría aparte sería más de lo
  -- que hace falta ahora mismo).
  reabierta_por STRING,
  fecha_reapertura TIMESTAMP,
  motivo_reapertura STRING
)
"""

_ALTER_ADD_REAPERTURA = f"""
ALTER TABLE {_APROBACION}
  ADD COLUMN IF NOT EXISTS reabierta_por STRING,
  ADD COLUMN IF NOT EXISTS fecha_reapertura TIMESTAMP,
  ADD COLUMN IF NOT EXISTS motivo_reapertura STRING
"""

_ESTADO_ORIGEN = {
    "compras": "pendiente_validacion_compras",
    "gerencia": "pendiente_aprobacion_gerencia",
}


def ensure_schema() -> None:
    """Crea HCARB_gold_aprobacion si no existe, y añade las columnas de
    reapertura si faltan (tabla creada antes de que existieran). Idempotente."""
    client = get_bq_client()
    client.query(_SCHEMA_DDL).result()
    client.query(_ALTER_ADD_REAPERTURA).result()


def _client() -> bigquery.Client:
    return get_bq_client()


def _rows(query: str, params: list[bigquery.ScalarQueryParameter] | None = None) -> list[dict[str, Any]]:
    job_config = bigquery.QueryJobConfig(query_parameters=params or [])
    result = _client().query(query, job_config=job_config).result()
    return [dict(row.items()) for row in result]


def sync_pendientes() -> int:
    """Da de alta en HCARB_gold_aprobacion las facturas clasificadas (M1) que
    todavía no tienen fila -- quedan en pendiente_validacion_compras. Idempotente,
    se puede llamar en cada request de la cola de Compras sin duplicar filas."""
    query = f"""
      INSERT INTO {_APROBACION} (uuid, estado)
      SELECT f.uuid, 'pendiente_validacion_compras'
      FROM {_FOLIO} f
      LEFT JOIN {_APROBACION} a ON f.uuid = a.uuid
      WHERE a.uuid IS NULL
    """
    job = _client().query(query)
    job.result()
    return job.num_dml_affected_rows or 0


_SELECT_COLA = """
        a.uuid, a.estado, a.ceco, a.werks_manual,
        a.usuario_compras, a.fecha_validacion_compras, a.comentario_compras,
        a.usuario_gerencia, a.fecha_aprobacion_gerencia, a.comentario_gerencia,
        a.rechazada_por_rol, a.motivo_rechazo,
        a.reabierta_por, a.fecha_reapertura, a.motivo_reapertura,
        f.serie, CAST(f.folio AS STRING) AS folio, DATE(f.fecha) AS fecha,
        f.id_proveedor, COALESCE(v.razon_social, f.emisor_rfc) AS proveedor,
        f.importe_gas, f.es_mixta, f.total, f.moneda,
        f.material_principal, f.cantidad_principal, f.clave_unidad_principal,
        f.claves_gas, f.n_lineas_gas, f.n_lineas_total,
        -- Evidencia SAP completa (Módulo 2 "consultar a SAP y mostrar"): antes vivía en
        -- una vista M2 aparte de solo lectura; ahora se ve donde Compras valida.
        s.estado_sap, s.fuente_sap, s.werks, s.sitio_consumo, s.direccion_sitio,
        s.tipo_match_sap, s.belnr_sap, s.fecha_registro_sap, s.dias_diferencia,
        s.estado_pago_sap, s.belnr_pago_sap, s.fecha_pago_sap,
        s.tipo_match_sitio, s.confianza_mseg,
        s.mseg_cantidad, s.mseg_valor_unitario, s.mseg_importe,
        s.ceco_sugerido, s.ceco_sugerido_origen,
        -- Desglose por ticket de entrega (ago-2026): NULL si no hay documento MSEG emparejado.
        s.tickets_mseg, s.mseg_n_tickets, s.mseg_n_tickets_match
"""


def _filtros_cola(
    *,
    busqueda: str | None = None,
    fecha_desde: date | None = None,
    fecha_hasta: date | None = None,
    proveedor_id: str | None = None,
    estado_sap: str | None = None,
    confianza_mseg: str | None = None,
    sitio: str = "all",
) -> tuple[str, list[bigquery.ScalarQueryParameter]]:
    """Filtros de la cola de aprobación -- clave_sat/clasificación (que sí tiene
    M1) se dejaron fuera a propósito: en M2/M3 todas las facturas ya pasaron la
    clasificación, así que filtrar por eso no aporta nada a la decisión de
    Compras/Gerencia (feedback explícito del usuario, jul-2026). confianza_mseg
    añade 'sin_evidencia' (no existe como filtro en M1) para poder aislar las
    facturas sin ningún rastro de MSEG."""
    clauses = ["TRUE"]
    params: list[bigquery.ScalarQueryParameter] = []
    if busqueda and busqueda.strip():
        clauses.append(
            """LOWER(CONCAT(
              COALESCE(f.serie, ''), COALESCE(CAST(f.folio AS STRING), ''), ' ',
              COALESCE(f.folio_key, ''), ' ',
              COALESCE(CAST(f.folio AS STRING), ''), ' ',
              COALESCE(f.uuid, ''), ' ',
              COALESCE(v.razon_social, f.emisor_rfc, '')
            )) LIKE CONCAT('%', LOWER(@busqueda), '%')"""
        )
        params.append(bigquery.ScalarQueryParameter("busqueda", "STRING", busqueda.strip()))
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
    if confianza_mseg == "sin_evidencia":
        clauses.append("s.confianza_mseg IS NULL")
    elif confianza_mseg:
        clauses.append("s.confianza_mseg = @confianza_mseg")
        params.append(bigquery.ScalarQueryParameter("confianza_mseg", "STRING", confianza_mseg))
    if sitio == "with_site":
        clauses.append("s.werks IS NOT NULL")
    elif sitio == "without_site":
        clauses.append("s.werks IS NULL")
    return " AND ".join(clauses), params


def _cola_from(extra_where: str) -> str:
    return f"""
      FROM {_APROBACION} a
      JOIN {_FOLIO} f ON a.uuid = f.uuid
      LEFT JOIN {_SAP} s ON f.uuid = s.uuid
      LEFT JOIN {_VENDORS} v ON f.id_proveedor = v.id_proveedor
      WHERE {extra_where}
    """


def _paginar_cola(
    from_clause: str, params: list[bigquery.ScalarQueryParameter], order_by: str, page: int, page_size: int
) -> dict[str, Any]:
    """Mismo patrón que hidrocarburos_engine.search(): página + conteo total en
    una llamada, para que la UI muestre 'Página X de Y' igual que M1 en vez de
    traer las 500+ facturas de la cola de golpe. Los KPIs de la cola (importe
    total, % validado SAP, % con MSEG) se calculaban antes recorriendo TODAS
    las filas cargadas -- ahora que solo se carga una página a la vez, esos
    agregados hay que pedirlos aparte (resumen), igual que summary()/search()
    en hidrocarburos_engine.py."""
    query_params = params + [
        bigquery.ScalarQueryParameter("limit", "INT64", page_size),
        bigquery.ScalarQueryParameter("offset", "INT64", (page - 1) * page_size),
    ]
    query = f"SELECT {_SELECT_COLA} {from_clause} ORDER BY {order_by} LIMIT @limit OFFSET @offset"
    resumen_query = f"""
      SELECT
        COUNT(*) AS total,
        COALESCE(SUM(f.importe_gas), 0) AS importe_gas_total,
        COUNTIF(s.estado_sap = 'validada_sap') AS validadas_sap,
        COUNTIF(s.confianza_mseg IS NOT NULL) AS con_mseg
      {from_clause}
    """
    with ThreadPoolExecutor(max_workers=2) as executor:
        resumen_future = executor.submit(_rows, resumen_query, params)
        rows_future = executor.submit(_rows, query, query_params)
        resumen_rows = resumen_future.result()
        rows = rows_future.result()
    resumen = resumen_rows[0] if resumen_rows else {"total": 0, "importe_gas_total": 0, "validadas_sap": 0, "con_mseg": 0}
    return {
        "total": resumen["total"],
        "page": page,
        "page_size": page_size,
        "resumen": {
            "importe_gas_total": resumen["importe_gas_total"],
            "validadas_sap": resumen["validadas_sap"],
            "con_mseg": resumen["con_mseg"],
        },
        "rows": rows,
    }


def cola_compras(*, page: int = 1, page_size: int = 50, **filtros: Any) -> dict[str, Any]:
    sync_pendientes()
    where, params = _filtros_cola(**filtros)
    full_params = [bigquery.ScalarQueryParameter("estado", "STRING", "pendiente_validacion_compras")] + params
    return _paginar_cola(_cola_from(f"a.estado = @estado AND ({where})"), full_params, "fecha DESC", page, page_size)


def cola_gerencia(*, page: int = 1, page_size: int = 50, **filtros: Any) -> dict[str, Any]:
    where, params = _filtros_cola(**filtros)
    full_params = [bigquery.ScalarQueryParameter("estado", "STRING", "pendiente_aprobacion_gerencia")] + params
    return _paginar_cola(_cola_from(f"a.estado = @estado AND ({where})"), full_params, "fecha DESC", page, page_size)


def historial(*, page: int = 1, page_size: int = 50, **filtros: Any) -> dict[str, Any]:
    """Facturas que ya salieron de la bandeja inicial de Compras -- pendientes
    de que Gerencia decida, aprobadas, o rechazadas. Es la vista que hace
    falta para reeditar (D-reversibilidad) antes de que Gerencia decida, o
    para reabrir una vez decidido; sin esto no hay forma de encontrar esas
    facturas desde la interfaz."""
    where, params = _filtros_cola(**filtros)
    extra_where = f"a.estado IN ('pendiente_aprobacion_gerencia', 'aprobada', 'rechazada') AND ({where})"
    order_by = "COALESCE(a.fecha_reapertura, a.fecha_aprobacion_gerencia, a.fecha_validacion_compras) DESC"
    return _paginar_cola(_cola_from(extra_where), params, order_by, page, page_size)


def catalogo_ceco() -> list[dict[str, Any]]:
    """Sugerencia (D29, no bloqueante) -- snapshot fechado sin pipeline de
    refresco conocido.

    Acotado a KOKRS='PROA' (area de control de Proan): CSKT no trae sociedad/RFC
    (BUKRS), pero KOKRS parte el maestro en PROA (5.699, Proan), SC01 (4.075,
    otra empresa: retail de alimentos) y PREU (27, vehiculos/activos).

    CORREGIDO jul-2026 (D22 revertida): antes traia el
    catalogo COMPLETO de PROA (~5.569) porque MSEG solo cubria 1-2 sitios de
    gas -- ya no es el caso (fix de filtro por proveedor, 543/1.056 con
    ceco_sugerido). Acotado a los CECOs que YA aparecieron en datos de gas
    (MSEG de los 11 proveedores, o ya capturados a mano por Compras) -- lista
    mucho mas corta y relevante. Sigue sin bloquear: el <datalist> del frontend
    permite escribir cualquier codigo que no este en esta lista."""
    query = f"""
      WITH vistos AS (
        SELECT DISTINCT NULLIF(TRIM(KOSTL), '') AS ceco
        FROM `proan-quantrue.D00_SANDBOX.proan_MSEG_HIDROCARBUROS_20260714`
        WHERE BWART != '102'
          AND LTRIM(TRIM(LIFNR), '0') IN (SELECT DISTINCT LTRIM(TRIM(id_proveedor), '0') FROM {_FOLIO})
        UNION DISTINCT
        SELECT DISTINCT NULLIF(TRIM(ceco), '') FROM {_APROBACION} WHERE ceco IS NOT NULL
      )
      SELECT DISTINCT c.KOSTL AS id, c.LTEXT AS nombre
      FROM {_CECO_CATALOGO} c
      JOIN vistos v ON v.ceco = c.KOSTL
      WHERE c.DATBI = '99991231' AND c.LTEXT IS NOT NULL AND c.KOKRS = 'PROA'
      ORDER BY nombre
    """
    return _rows(query)


def catalogo_sitios() -> list[dict[str, Any]]:
    """Sugerencia (D29, no bloqueante) -- excluye la red MK## (Maka, no Proan).

    CORREGIDO jul-2026 (simetrico a catalogo_ceco()): acotado a sitios que YA
    aparecieron en datos de gas -- WERKS resuelto via EKBE/pedido
    (HCARB_GOLD_VALIDACION_SAP.werks), WERKS visto en MSEG de los 11
    proveedores, o ya capturado a mano por Compras (werks_manual). El gas real
    converge en 4 plantas (D10) de las 492 de todo Proan -- antes traia las
    492. Sigue sin bloquear: el <datalist> permite cualquier codigo no listado.
    """
    query = f"""
      WITH vistos AS (
        SELECT DISTINCT werks FROM {_SAP} WHERE werks IS NOT NULL
        UNION DISTINCT
        SELECT DISTINCT NULLIF(TRIM(WERKS), '') AS werks
        FROM `proan-quantrue.D00_SANDBOX.proan_MSEG_HIDROCARBUROS_20260714`
        WHERE BWART != '102'
          AND LTRIM(TRIM(LIFNR), '0') IN (SELECT DISTINCT LTRIM(TRIM(id_proveedor), '0') FROM {_FOLIO})
        UNION DISTINCT
        SELECT DISTINCT NULLIF(TRIM(werks_manual), '') AS werks FROM {_APROBACION} WHERE werks_manual IS NOT NULL
      )
      SELECT DISTINCT c.id_centro AS id, c.descripcion_centro AS nombre
      FROM {_CENTROS} c
      JOIN vistos v ON v.werks = c.id_centro
      WHERE NOT STARTS_WITH(c.id_centro, 'MK')
      ORDER BY nombre
    """
    return _rows(query)


def _estado_actual(uuid: str) -> str | None:
    rows = _rows(
        f"SELECT estado FROM {_APROBACION} WHERE uuid = @uuid",
        [bigquery.ScalarQueryParameter("uuid", "STRING", uuid)],
    )
    return rows[0]["estado"] if rows else None


def capturar_compras(
    *, uuid: str, ceco: str, usuario: str, werks_manual: str | None = None, comentario: str | None = None
) -> dict[str, Any]:
    """Compras captura CECO (siempre) y opcionalmente el sitio manual (solo si
    M2 no lo dedujo) -- pasa la factura a pendiente_aprobacion_gerencia.

    Reversibilidad: el WHERE acepta también pendiente_aprobacion_gerencia como
    origen -- Compras puede corregir un error de captura (CECO/sitio) mientras
    Gerencia no haya decidido todavía, sin necesitar reabrir nada."""
    query = f"""
      UPDATE {_APROBACION}
      SET ceco = @ceco, werks_manual = @werks_manual, usuario_compras = @usuario,
          fecha_validacion_compras = CURRENT_TIMESTAMP(), comentario_compras = @comentario,
          estado = 'pendiente_aprobacion_gerencia'
      WHERE uuid = @uuid
        AND estado IN ('pendiente_validacion_compras', 'pendiente_aprobacion_gerencia')
    """
    params = [
        bigquery.ScalarQueryParameter("uuid", "STRING", uuid),
        bigquery.ScalarQueryParameter("ceco", "STRING", ceco),
        bigquery.ScalarQueryParameter("werks_manual", "STRING", werks_manual),
        bigquery.ScalarQueryParameter("usuario", "STRING", usuario),
        bigquery.ScalarQueryParameter("comentario", "STRING", comentario),
    ]
    job = _client().query(query, job_config=bigquery.QueryJobConfig(query_parameters=params))
    job.result()
    ok = bool(job.num_dml_affected_rows)
    return {"ok": ok, "estado_actual": _estado_actual(uuid) if not ok else "pendiente_aprobacion_gerencia"}


def aprobar_gerencia(*, uuid: str, usuario: str, comentario: str | None = None) -> dict[str, Any]:
    query = f"""
      UPDATE {_APROBACION}
      SET usuario_gerencia = @usuario, fecha_aprobacion_gerencia = CURRENT_TIMESTAMP(),
          comentario_gerencia = @comentario, estado = 'aprobada'
      WHERE uuid = @uuid AND estado = 'pendiente_aprobacion_gerencia'
    """
    params = [
        bigquery.ScalarQueryParameter("uuid", "STRING", uuid),
        bigquery.ScalarQueryParameter("usuario", "STRING", usuario),
        bigquery.ScalarQueryParameter("comentario", "STRING", comentario),
    ]
    job = _client().query(query, job_config=bigquery.QueryJobConfig(query_parameters=params))
    job.result()
    ok = bool(job.num_dml_affected_rows)
    return {"ok": ok, "estado_actual": _estado_actual(uuid) if not ok else "aprobada"}


def rechazar(*, uuid: str, rol: Rol, usuario: str, motivo: str) -> dict[str, Any]:
    """Cualquiera de los dos roles puede rechazar/devolver una factura desde
    su propio paso (D23) -- registra quién y por qué en las columnas de su rol."""
    estado_origen = _ESTADO_ORIGEN[rol]
    campo_usuario = "usuario_compras" if rol == "compras" else "usuario_gerencia"
    campo_fecha = "fecha_validacion_compras" if rol == "compras" else "fecha_aprobacion_gerencia"
    query = f"""
      UPDATE {_APROBACION}
      SET {campo_usuario} = @usuario, {campo_fecha} = CURRENT_TIMESTAMP(),
          estado = 'rechazada', rechazada_por_rol = @rol, motivo_rechazo = @motivo
      WHERE uuid = @uuid AND estado = @estado_origen
    """
    params = [
        bigquery.ScalarQueryParameter("uuid", "STRING", uuid),
        bigquery.ScalarQueryParameter("usuario", "STRING", usuario),
        bigquery.ScalarQueryParameter("rol", "STRING", rol),
        bigquery.ScalarQueryParameter("motivo", "STRING", motivo),
        bigquery.ScalarQueryParameter("estado_origen", "STRING", estado_origen),
    ]
    job = _client().query(query, job_config=bigquery.QueryJobConfig(query_parameters=params))
    job.result()
    ok = bool(job.num_dml_affected_rows)
    return {"ok": ok, "estado_actual": _estado_actual(uuid) if not ok else "rechazada"}


def reabrir(*, uuid: str, usuario: str, motivo: str) -> dict[str, Any]:
    """Deshace cualquier avance sobre una factura (ya validada por Compras,
    aprobada, o rechazada) y la devuelve a pendiente_validacion_compras --
    borra los datos anteriores (CECO, sitio, comentarios, quién decidió) y
    deja constancia de quién reabrió y por qué. Incluye pendiente_aprobacion_gerencia
    a propósito: sirve también para "me equivoqué de CECO, quiero borrar todo
    y empezar de cero" sin necesitar que Gerencia apruebe o rechace antes.
    No hay control de rol (D27): cualquiera puede reabrir cualquier factura,
    igual que cualquiera puede validar/aprobar."""
    query = f"""
      UPDATE {_APROBACION}
      SET estado = 'pendiente_validacion_compras',
          ceco = NULL, werks_manual = NULL,
          usuario_compras = NULL, fecha_validacion_compras = NULL, comentario_compras = NULL,
          usuario_gerencia = NULL, fecha_aprobacion_gerencia = NULL, comentario_gerencia = NULL,
          rechazada_por_rol = NULL, motivo_rechazo = NULL,
          reabierta_por = @usuario, fecha_reapertura = CURRENT_TIMESTAMP(), motivo_reapertura = @motivo
      WHERE uuid = @uuid
        AND estado IN ('pendiente_aprobacion_gerencia', 'aprobada', 'rechazada')
    """
    params = [
        bigquery.ScalarQueryParameter("uuid", "STRING", uuid),
        bigquery.ScalarQueryParameter("usuario", "STRING", usuario),
        bigquery.ScalarQueryParameter("motivo", "STRING", motivo),
    ]
    job = _client().query(query, job_config=bigquery.QueryJobConfig(query_parameters=params))
    job.result()
    ok = bool(job.num_dml_affected_rows)
    return {"ok": ok, "estado_actual": _estado_actual(uuid) if not ok else "pendiente_validacion_compras"}
