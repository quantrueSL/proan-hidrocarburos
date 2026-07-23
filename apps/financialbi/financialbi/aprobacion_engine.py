"""Tabla de aprobación de facturas (Módulo 3) -- mutable, propiedad de la app.

A diferencia de las tablas HCARB_GOLD_* (recalculadas enteras por ConsultasBigQuery/,
ver ../../../ConsultasBigQuery/), esta tabla la escribe el backend directamente
(INSERT/UPDATE) según las acciones de Compras y Gerencia -- diseño completo en
Datos/PHASE2/Esquema.md §4 y Datos/PHASE2/resumen.md (D23, D27-D29).

Workflow de dos roles (D23): pendiente_validacion_compras (Compras captura CECO
y confirma/corrige el sitio) -> pendiente_aprobacion_gerencia (Gerencia
aprueba/rechaza) -> aprobada | rechazada. Identidad de usuario (D27): texto libre
por ahora, no viene de un login con roles reales -- auth real queda como deuda
técnica explícita.
"""

from __future__ import annotations

from typing import Any, Literal

from google.cloud import bigquery

from financialbi.db import _get_bq_client
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
    client = _get_bq_client()
    client.query(_SCHEMA_DDL).result()
    client.query(_ALTER_ADD_REAPERTURA).result()


def _client() -> bigquery.Client:
    return _get_bq_client()


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
        f.importe_gas, f.es_mixta,
        s.estado_sap, s.werks, s.sitio_consumo
"""


def _cola_query(estado: str) -> str:
    return f"""
      SELECT {_SELECT_COLA}
      FROM {_APROBACION} a
      JOIN {_FOLIO} f ON a.uuid = f.uuid
      LEFT JOIN {_SAP} s ON f.uuid = s.uuid
      LEFT JOIN {_VENDORS} v ON f.id_proveedor = v.id_proveedor
      WHERE a.estado = @estado
      ORDER BY fecha DESC
    """


def cola_compras() -> list[dict[str, Any]]:
    sync_pendientes()
    return _rows(
        _cola_query("pendiente_validacion_compras"),
        [bigquery.ScalarQueryParameter("estado", "STRING", "pendiente_validacion_compras")],
    )


def cola_gerencia() -> list[dict[str, Any]]:
    return _rows(
        _cola_query("pendiente_aprobacion_gerencia"),
        [bigquery.ScalarQueryParameter("estado", "STRING", "pendiente_aprobacion_gerencia")],
    )


def historial() -> list[dict[str, Any]]:
    """Facturas que ya salieron de la bandeja inicial de Compras -- pendientes
    de que Gerencia decida, aprobadas, o rechazadas. Es la vista que hace
    falta para reeditar (D-reversibilidad) antes de que Gerencia decida, o
    para reabrir una vez decidido; sin esto no hay forma de encontrar esas
    facturas desde la interfaz."""
    query = f"""
      SELECT {_SELECT_COLA}
      FROM {_APROBACION} a
      JOIN {_FOLIO} f ON a.uuid = f.uuid
      LEFT JOIN {_SAP} s ON f.uuid = s.uuid
      LEFT JOIN {_VENDORS} v ON f.id_proveedor = v.id_proveedor
      WHERE a.estado IN ('pendiente_aprobacion_gerencia', 'aprobada', 'rechazada')
      ORDER BY COALESCE(a.fecha_reapertura, a.fecha_aprobacion_gerencia, a.fecha_validacion_compras) DESC
    """
    return _rows(query)


def catalogo_ceco() -> list[dict[str, Any]]:
    """Sugerencia (D29, no bloqueante) -- snapshot fechado sin pipeline de
    refresco conocido, ver Datos/PHASE1/hallazgos.md §24 y Esquema.md."""
    query = f"""
      SELECT DISTINCT KOSTL AS id, LTEXT AS nombre
      FROM {_CECO_CATALOGO}
      WHERE DATBI = '99991231' AND LTEXT IS NOT NULL
      ORDER BY nombre
    """
    return _rows(query)


def catalogo_sitios() -> list[dict[str, Any]]:
    """Sugerencia (D29, no bloqueante) -- excluye la red MK## (Maka, no Proan)."""
    query = f"""
      SELECT id_centro AS id, descripcion_centro AS nombre
      FROM {_CENTROS}
      WHERE NOT STARTS_WITH(id_centro, 'MK')
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
