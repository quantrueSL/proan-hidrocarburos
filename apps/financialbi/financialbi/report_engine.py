"""Motor del reporte financiero.

Reutiliza la conexion a Big Query y la carga de datos de alertas_engine
(silver.balance_cuentas, silver.facturacion, silver.produccion) y produce
un conjunto de agregados de alto nivel centrados en INGRESOS, PRODUCCION y
BALANCE (P&L). No usa margen ni coste de linea.

Uso:
    from report_engine import build_report_context, get_catalog_minimal
    cat = get_catalog_minimal()
    ctx = build_report_context(cfg=ReportConfig(), end_period="2025-07")
"""

from __future__ import annotations

import calendar
import unicodedata
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from typing import Callable, Dict, Optional

import pandas as pd

import os
try:
    from db import read_sql, BACKEND
except ImportError:
    from financialbi.db import read_sql, BACKEND


def _run_parallel(tasks: Dict[str, Callable[[], object]]) -> Dict[str, object]:
    """Ejecuta funciones independientes (todas I/O-bound contra BigQuery) en
    paralelo con hilos y devuelve sus resultados por nombre.

    `build_report_context` hace ~20 queries por carga de página que no
    dependen entre sí (Ventas, Margen, Región, Flujo, Solvencia...);
    ejecutarlas una detrás de otra suma la latencia de red de las 20. El
    cliente de `bigquery.Client` (cacheado en `db.py`) es seguro para
    concurrencia, así que lanzarlas con hilos reduce el tiempo total al de
    la más lenta en vez de a la suma de todas."""
    if not tasks:
        return {}
    with ThreadPoolExecutor(max_workers=len(tasks)) as executor:
        futures = {name: executor.submit(fn) for name, fn in tasks.items()}
        return {name: future.result() for name, future in futures.items()}

# Tabla BigQuery de Maka (ventas + costes de producción por lote)
# MIGRADO (20-jul-2026): de ZZ_PRUEBAS.RENTABILIDAD_* a los datasets/nombres
# definitivos (D50_AGGREGATE_RENTABILIDAD / D60_REPORTING, prefijo MAKA_) —
# ver BigQueryAirflow/README.md para el mapeo completo old->new.
_BQ_TABLE = "`proan-quantrue.D50_AGGREGATE_RENTABILIDAD.MAKA_VENTAS_RECETAS_COSTESMP`"
# GOLD (14-jul-2026): agregados de Ventas/Margen (Página 4) y apoyo a Región
# (Página 5), ya reducidos de línea-de-factura a (mes, dimensión) — ver
# BigQueryAirflow/gold/report/ventas_margen_gold.sql para el detalle de
# cada uno y qué función de abajo reemplaza cada uno.
_BQ_GOLD_MARGEN_MENSUAL = "`proan-quantrue.D60_REPORTING.MAKA_GOLD_MARGEN_MENSUAL`"
_BQ_GOLD_MARGEN_PRODUCTO_MENSUAL = "`proan-quantrue.D60_REPORTING.MAKA_GOLD_MARGEN_PRODUCTO_MENSUAL`"
_BQ_GOLD_REGION_FAMILIA_MENSUAL = "`proan-quantrue.D60_REPORTING.MAKA_GOLD_REGION_FAMILIA_MENSUAL`"
_BQ_GOLD_CLIENTES_MES = "`proan-quantrue.D60_REPORTING.MAKA_GOLD_CLIENTES_MES`"
_BQ_PYG_DETALLE_TABLE = "`proan-quantrue.D50_AGGREGATE_RENTABILIDAD.MAKA_PYG_DETALLE`"
# GOLD (14-jul-2026): estructura completa del P&G (subtotales, EBITDA, etc.)
# ya calculada en BigQuery — ver BigQueryAirflow/gold/report/pyg_detalle_gold.sql
# y `_pyg_summary_range_bigquery` más abajo.
_BQ_GOLD_PYG_DETALLE = "`proan-quantrue.D60_REPORTING.MAKA_GOLD_PYG_DETALLE`"
# GOLD (20-jul-2026): MAKA_GOLD_CONTRAPARTES es el UNION de MAKA_ACREEDORES/
# MAKA_DEUDORES (ya promocionadas, sin sufijo _TEMP — rediseño a serie
# mensual validado), con columnas de aging ya canónicas
# (saldo_sin_anticipos/anticipos en vez de facturas_pendientes/
# anticipos_pendientes|recibidos) y un top-5/totales por mes ya resueltos
# (rank_saldo_neto, es_top5, total_*_mes) que este backend TODAVÍA no lee
# (sigue devolviendo el mismo shape de antes; conectar esas columnas nuevas
# al frontend es una tarea aparte). Ver BigQueryAirflow/gold/report/contrapartes_gold.sql.
_BQ_CONTRAPARTES_TABLE = "`proan-quantrue.D60_REPORTING.MAKA_GOLD_CONTRAPARTES`"
# Vista de tendencia mensual (sin contraparte) — OJO: sus totales NO están
# particionados por area_negocio (son el total GLOBAL de cada tipo/mes), así
# que solo sirve como atajo cuando no hay filtro de línea de negocio; con
# filtro, `_load_counterparty_trend_bigquery` sigue agregando en vivo sobre
# `_BQ_CONTRAPARTES_TABLE` (ver esa función).
_BQ_CONTRAPARTES_TREND_VIEW = "`proan-quantrue.D60_REPORTING.MAKA_GOLD_CONTRAPARTES_TENDENCIA_MES`"
_BQ_SOLVENCIA_TABLE = "`proan-quantrue.D50_AGGREGATE_RENTABILIDAD.MAKA_SOLVENCIA`"
# GOLD (14-jul-2026): MAKA_GOLD_FLUJO_PIVOT es un superset exacto de
# MAKA_FLUJO_RECURSOS (mismas columnas + periodo/mes_corto) con el
# recorte de meses fantasma ya aplicado en SQL — validado en BigQuery: 1728
# filas silver -> 1638 filas gold, exactamente los 5 meses sin datos reales
# (ago-dic 2026) de menos. Ver BigQueryAirflow/gold/report/flujo_pivot_gold.sql.
_BQ_FLUJO_TABLE = "`proan-quantrue.D60_REPORTING.MAKA_GOLD_FLUJO_PIVOT`"
_SECCION_NO_ESPECIFICADO = "No especificado"
# Canal de facturación intercompañía (PAN <-> MPE, ej. "MAKA PET S DE RL DE CV").
# No es venta de mercado real -> se excluye por defecto de Ventas/Rentabilidad
# Comercial salvo que el usuario pida verlo explícitamente.
_CANAL_PARTES_RELACIONADAS = "06 - PARTES RELACIONADAS"


def _silver_ventas_where(
    start_yyyymm: Optional[int],
    end_yyyymm: Optional[int],
    familia: Optional[str] = None,
    canal: Optional[str] = None,
    incluir_partes_relacionadas: bool = False,
) -> str:
    """WHERE compartido para consultas contra RENTABILIDAD_VENTAS_RECETAS_COSTESMP
    (silver, grano línea de factura, columna de fecha ``billing_date``). Mismo
    criterio que ``_load_data_bigquery``: excluye por defecto el canal de
    partes relacionadas salvo que se pida explícitamente."""
    conds = ["billing_date IS NOT NULL"]
    if start_yyyymm and end_yyyymm:
        start_y, start_m = start_yyyymm // 100, start_yyyymm % 100
        end_y, end_m = end_yyyymm // 100, end_yyyymm % 100
        end_day = calendar.monthrange(end_y, end_m)[1]
        desde = f"{start_y}-{start_m:02d}-01"
        hasta = f"{end_y}-{end_m:02d}-{end_day}"
        conds.append(f"billing_date BETWEEN '{desde}' AND '{hasta}'")
    if familia:
        _fam = familia.replace("'", "''")
        conds.append(f"familia = '{_fam}'")
    if canal:
        _can = canal.replace("'", "''")
        conds.append(f"distribution_channel = '{_can}'")
    if not incluir_partes_relacionadas and canal != _CANAL_PARTES_RELACIONADAS:
        conds.append(f"distribution_channel != '{_CANAL_PARTES_RELACIONADAS}'")
    return " AND ".join(conds)


def _gold_ventas_where(
    start_yyyymm: Optional[int],
    end_yyyymm: Optional[int],
    familia: Optional[str] = None,
    canal: Optional[str] = None,
    incluir_partes_relacionadas: bool = False,
) -> str:
    """WHERE compartido para las tablas GOLD de ventas (grano mes/dimensión,
    columnas ``anio``/``mes``/``familia``/``canal``). Mismo criterio de
    exclusión de partes relacionadas que ``_silver_ventas_where``.

    OJO — ``'Sin asignar'`` (líneas con ``distribution_channel`` NULO en el
    silver, ~7.900 líneas / ~8,5M en ene-jun 2026) se excluye A PROPÓSITO
    aquí, aunque no sean partes relacionadas de verdad. Es para replicar
    EXACTO el comportamiento actual: en `_silver_ventas_where` el filtro SQL
    corre sobre la columna nullable original (`distribution_channel != '06
    - PARTES RELACIONADAS'`), y en SQL `NULL != X` es NULL (no verdadero),
    así que esas líneas ya se excluían sin querer. El gold convierte ese NULO
    en `'Sin asignar'` antes de filtrar, lo que las volvería a incluir si no
    se excluyen aquí a mano — cambiando el KPI de Ventas sin que nadie lo
    decidiera. Confirmado con Pablo (14-jul-2026): mantener el
    comportamiento actual por ahora; si esas ventas deben contar es una
    decisión de negocio pendiente, no algo a resolver silenciosamente en
    esta migración."""
    conds = []
    if start_yyyymm and end_yyyymm:
        conds.append(f"(anio * 100 + mes) BETWEEN {start_yyyymm} AND {end_yyyymm}")
    if familia:
        _fam = familia.replace("'", "''")
        conds.append(f"familia = '{_fam}'")
    if canal:
        _can = canal.replace("'", "''")
        conds.append(f"canal = '{_can}'")
    if not incluir_partes_relacionadas and canal != _CANAL_PARTES_RELACIONADAS:
        conds.append(f"canal != '{_CANAL_PARTES_RELACIONADAS}'")
        conds.append("canal != 'Sin asignar'")
    return " AND ".join(conds) if conds else "1=1"


def _empty_counterparty_df(counterparty: str) -> pd.DataFrame:
    anticipos_col = "anticipos_pendientes" if counterparty == "acreedores" else "anticipos_recibidos"
    return pd.DataFrame(
        columns=[
            "anio",
            "mes",
            "fecha_foto",
            "razon_social",
            "facturas_pendientes",
            anticipos_col,
            "saldo_neto",
            "sin_vencer",
            "bucket_0_30",
            "bucket_31_60",
            "bucket_61_90",
            "bucket_90_mas",
            "dias_promedio",
        ]
    )


def _load_counterparty_tables_bigquery(
    linea_negocio: Optional[str] = None,
    end_yyyymm: Optional[int] = None,
) -> tuple[pd.DataFrame, pd.DataFrame]:
    """Carga saldos de acreedores/deudores desde RENTABILIDAD_GOLD_CONTRAPARTES
    (gold, 14-jul-2026; UNION de las tablas _TEMP con aliases ya canónicos).

    Desde el rediseño a serie mensual (2026-07-08), estas tablas traen 1 fila
    por (año, mes, contraparte) — el "cierre" de cada mes disponible. Se
    muestra el mes MÁS RECIENTE que no sea posterior al cierre seleccionado
    en el resto del informe (``end_yyyymm``), en vez de exigir coincidencia
    exacta: así, si el rango pedido cae en un mes sin foto todavía (mes en
    curso) o en un hueco, se ve el último dato real disponible en vez de una
    tabla vacía — el mismo criterio que ya usa ``_load_solvencia_bigquery``
    para los "meses fantasma". Si ni siquiera hay una foto anterior o igual
    al cierre pedido (ej. rango totalmente anterior a jun-2025/jul-2024, que
    es cuando arrancan sap_BSIK/sap_BSID), el resultado viene vacío de
    verdad — no hay dato que mostrar, no es un fallo.
    """
    extra_where = ""
    if linea_negocio:
        _ln = linea_negocio.replace("'", "''")
        extra_where = f" AND area_negocio = '{_ln}'"

    def _mes_cond(tipo: str) -> str:
        if not end_yyyymm:
            return ""
        return f"""
          AND (anio * 100 + mes) = (
            SELECT MAX(anio * 100 + mes) FROM {_BQ_CONTRAPARTES_TABLE}
            WHERE tipo = '{tipo}' AND (anio * 100 + mes) <= {end_yyyymm} {extra_where}
          )
        """

    acreedores_sql = f"""
        SELECT
            anio, mes, fecha_foto,
            razon_social,
            saldo_sin_anticipos AS facturas_pendientes,
            anticipos AS anticipos_pendientes,
            saldo_neto,
            sin_vencer,
            bucket_0_30,
            bucket_31_60,
            bucket_61_90,
            bucket_90_mas,
            dias_promedio
        FROM {_BQ_CONTRAPARTES_TABLE}
        WHERE tipo = 'acreedor' {extra_where} {_mes_cond('acreedor')}
          AND saldo_neto IS NOT NULL
    """

    deudores_sql = f"""
        SELECT
            anio, mes, fecha_foto,
            razon_social,
            saldo_sin_anticipos AS facturas_pendientes,
            anticipos AS anticipos_recibidos,
            saldo_neto,
            sin_vencer,
            bucket_0_30,
            bucket_31_60,
            bucket_61_90,
            bucket_90_mas,
            dias_promedio
        FROM {_BQ_CONTRAPARTES_TABLE}
        WHERE tipo = 'deudor' {extra_where} {_mes_cond('deudor')}
          AND saldo_neto IS NOT NULL
    """

    def _acreedores() -> pd.DataFrame:
        try:
            return read_sql(acreedores_sql)
        except Exception:
            return _empty_counterparty_df("acreedores")

    def _deudores() -> pd.DataFrame:
        try:
            return read_sql(deudores_sql)
        except Exception:
            return _empty_counterparty_df("deudores")

    results = _run_parallel({"acreedores": _acreedores, "deudores": _deudores})
    return results["acreedores"], results["deudores"]


def _empty_counterparty_trend_df() -> pd.DataFrame:
    return pd.DataFrame(
        columns=[
            "anio", "mes", "saldo_neto", "sin_vencer",
            "bucket_0_30", "bucket_31_60", "bucket_61_90", "bucket_90_mas",
        ]
    )


def _load_counterparty_trend_bigquery(
    linea_negocio: Optional[str] = None,
    start_yyyymm: Optional[int] = None,
    end_yyyymm: Optional[int] = None,
) -> tuple[pd.DataFrame, pd.DataFrame]:
    """Tendencia mensual de acreedores/deudores sobre el rango [inicio, cierre]
    del resto del informe: totales agregados (no por contraparte) por mes,
    para el gráfico de evolución de la Página 5. Complementa a
    ``_load_counterparty_tables_bigquery``, que da el detalle por contraparte
    de UN solo mes (el de cierre). Igual que el resto del informe, esta sí usa
    el rango completo (Inicio→Cierre) porque aquí no se pide un balance en un
    instante sino "cómo ha evolucionado el saldo mes a mes" — más parecido a
    RENTABILIDAD_SOLVENCIA que a la vista de detalle de contraparte.

    GOLD (14-jul-2026): sin filtro de línea de negocio, lee directo de la
    vista RENTABILIDAD_GOLD_CONTRAPARTES_TENDENCIA_MES (totales ya agregados,
    sin GROUP BY aquí). Con filtro, esa vista no sirve (sus totales son
    globales, no por área de negocio) — se sigue agregando en vivo, pero ya
    desde RENTABILIDAD_GOLD_CONTRAPARTES en vez de las tablas _TEMP sueltas."""
    rango_cond = ""
    if start_yyyymm and end_yyyymm:
        rango_cond = f" AND (anio * 100 + mes) BETWEEN {start_yyyymm} AND {end_yyyymm}"

    if not linea_negocio:
        # Camino rápido: la vista ya trae el total GLOBAL (todas las líneas de
        # negocio) por (tipo, anio, mes) precalculado — sin GROUP BY aquí.
        def _trend_sql_view(tipo: str) -> str:
            return f"""
                SELECT anio, mes, saldo_neto, sin_vencer,
                       bucket_0_30, bucket_31_60, bucket_61_90, bucket_90_mas
                FROM {_BQ_CONTRAPARTES_TREND_VIEW}
                WHERE tipo = '{tipo}' {rango_cond}
                ORDER BY anio, mes
            """

        def _acreedores_trend() -> pd.DataFrame:
            try:
                return read_sql(_trend_sql_view("acreedor"))
            except Exception:
                return _empty_counterparty_trend_df()

        def _deudores_trend() -> pd.DataFrame:
            try:
                return read_sql(_trend_sql_view("deudor"))
            except Exception:
                return _empty_counterparty_trend_df()

        results = _run_parallel({"acreedores": _acreedores_trend, "deudores": _deudores_trend})
        return results["acreedores"], results["deudores"]

    # Con filtro de línea de negocio: la vista de tendencia no sirve (sus
    # totales no están particionados por area_negocio) — se agrega en vivo
    # sobre la tabla gold de detalle, filtrando por área igual que antes.
    _ln = linea_negocio.replace("'", "''")
    extra_where = f" AND area_negocio = '{_ln}'"

    def _trend_sql_live(tipo: str) -> str:
        return f"""
            SELECT
                anio, mes,
                SUM(saldo_neto)    AS saldo_neto,
                SUM(sin_vencer)    AS sin_vencer,
                SUM(bucket_0_30)   AS bucket_0_30,
                SUM(bucket_31_60)  AS bucket_31_60,
                SUM(bucket_61_90)  AS bucket_61_90,
                SUM(bucket_90_mas) AS bucket_90_mas
            FROM {_BQ_CONTRAPARTES_TABLE}
            WHERE tipo = '{tipo}' AND saldo_neto IS NOT NULL {extra_where} {rango_cond}
            GROUP BY anio, mes
            ORDER BY anio, mes
        """

    def _acreedores_trend_live() -> pd.DataFrame:
        try:
            return read_sql(_trend_sql_live("acreedor"))
        except Exception:
            return _empty_counterparty_trend_df()

    def _deudores_trend_live() -> pd.DataFrame:
        try:
            return read_sql(_trend_sql_live("deudor"))
        except Exception:
            return _empty_counterparty_trend_df()

    results = _run_parallel({"acreedores": _acreedores_trend_live, "deudores": _deudores_trend_live})
    return results["acreedores"], results["deudores"]


def _load_solvencia_bigquery(
    start_yyyymm: Optional[int] = None,
    end_yyyymm: Optional[int] = None,
) -> pd.DataFrame:
    """Carga los agregados de balance y ratios de solvencia y rentabilidad
    (Página 2) desde la tabla RENTABILIDAD_SOLVENCIA de BigQuery, acotados al
    rango [inicio, cierre]. Recorta los meses sin datos reales de P&G todavía."""
    cond = "1=1"
    if start_yyyymm and end_yyyymm:
        cond = f"(anio * 100 + mes) BETWEEN {start_yyyymm} AND {end_yyyymm}"
    sql = f"SELECT * FROM {_BQ_SOLVENCIA_TABLE} WHERE {cond} ORDER BY anio, mes"
    df = read_sql(sql)
    for col in df.columns:
        if col not in ("anio", "mes"):
            df[col] = pd.to_numeric(df[col], errors="coerce")
    # Los meses sin datos reales de P&G todavía quedan "clonados" del último
    # mes con datos (el balance es un saldo acumulado que no cambia sin
    # movimientos nuevos) en vez de vacíos. Se recortan para no pintar meses
    # "fantasma" (ej. agosto-diciembre repitiendo julio).
    if "ventas_netas_mes" in df.columns and not df.empty:
        con_datos = df.index[df["ventas_netas_mes"].fillna(0) != 0]
        if len(con_datos) > 0:
            df = df.loc[: con_datos.max()].reset_index(drop=True)
    return df


def _load_flujo_bigquery(
    start_yyyymm: Optional[int] = None,
    end_yyyymm: Optional[int] = None,
) -> pd.DataFrame:
    """Carga el Flujo de Recursos (Página 3) desde RENTABILIDAD_GOLD_FLUJO_PIVOT
    (gold, 14-jul-2026) de BigQuery: formato largo, 1 fila por (año, mes,
    partida del balance) con saldo_fin_mes, var_mes_anterior y var_inicio_anio
    ya calculadas (la variación de enero compara contra la apertura del año).
    El recorte de meses sin datos reales ya viene aplicado en la tabla gold;
    el recorte de abajo se deja como red de seguridad (no-op si la tabla ya
    viene recortada) mientras no esté orquestado el refresco automático."""
    cond = "1=1"
    if start_yyyymm and end_yyyymm:
        cond = f"(anio * 100 + mes) BETWEEN {start_yyyymm} AND {end_yyyymm}"
    sql = f"SELECT * FROM {_BQ_FLUJO_TABLE} WHERE {cond} ORDER BY anio, mes, orden"
    df = read_sql(sql)
    num_cols = (
        "anio", "mes", "orden",
        "saldo_fin_mes", "var_mes_anterior", "var_inicio_anio", "ventas_netas_mes",
    )
    for col in num_cols:
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors="coerce")
    # Meses "clonados" sin datos reales (variación 0 en todo): fuera. Aquí hay
    # varias filas por mes, así que se recorta por periodo, no por índice.
    if not df.empty and "ventas_netas_mes" in df.columns:
        periodo = df["anio"] * 100 + df["mes"]
        reales = periodo[df["ventas_netas_mes"].fillna(0) != 0]
        if not reales.empty:
            df = df[periodo <= reales.max()].reset_index(drop=True)
    return df


def _load_data_bigquery(
    start_yyyymm: Optional[int] = None,
    end_yyyymm: Optional[int] = None,
    familia: Optional[str] = None,
    canal: Optional[str] = None,
    linea_negocio: Optional[str] = None,
    planta: Optional[str] = None,
    incluir_partes_relacionadas: bool = False,
    include_counterparties: bool = True,
) -> Dict[str, pd.DataFrame]:
    """Carga contrapartes desde BigQuery (Maka).

    GOLD (14-jul-2026): "facturacion" y "balance" ya NO se cargan línea a
    línea aquí — ese fetch completo (toda la factura + todo el P&G del
    rango) solo alimentaba claves del summary que el frontend React nunca
    lee (`kpis`, `pyg`, `revenue_by_family`, `top_clients`, etc., ver
    `build_report_context`) más `revenue_trend`/el €/tonelada del P&G, que
    ahora se resuelven con agregados ya existentes en
    RENTABILIDAD_GOLD_MARGEN_MENSUAL (ver `_revenue_trend_bigquery` y
    `_tons_by_month_bigquery`) en vez de traer todas las filas y
    agregar en pandas. Se devuelven vacías para no romper el shape que
    espera el resto del pipeline (p. ej. el backend Azure/Nutrex, que sí
    las rellena de verdad).
    """
    fact = pd.DataFrame(columns=[
        "sociedad", "fecha_contable", "cliente_id", "cliente_nombre",
        "item_id", "item_desc", "item_grupo_desc", "categoria_articulo",
        "region", "importe_neto_sinIVA", "qty_facturada", "unidad_medida",
        "margen_linea_orig", "periodo",
    ])
    prod = pd.DataFrame(columns=["sociedad", "fecha_fin", "item_id", "item_desc",
                                   "item_grupo_desc", "qty_producida", "periodo"])
    balance = pd.DataFrame(
        columns=["sociedad", "periodo", "categoria_pyg", "balance", "mov_abs"]
    )

    if include_counterparties:
        acreedores, deudores = _load_counterparty_tables_bigquery(
            linea_negocio=linea_negocio, end_yyyymm=end_yyyymm
        )
        acreedores_trend, deudores_trend = _load_counterparty_trend_bigquery(
            linea_negocio=linea_negocio, start_yyyymm=start_yyyymm, end_yyyymm=end_yyyymm
        )
    else:
        # Sección clients_geo no pedida — evita las 4 queries de contrapartes.
        acreedores = _empty_counterparty_df("acreedores")
        deudores = _empty_counterparty_df("deudores")
        acreedores_trend = _empty_counterparty_trend_df()
        deudores_trend = _empty_counterparty_trend_df()

    return {
        "balance": balance,
        "facturacion": fact,
        "produccion": prod,
        "acreedores": acreedores,
        "deudores": deudores,
        "acreedores_trend": acreedores_trend,
        "deudores_trend": deudores_trend,
    }


def load_data(
    sociedad: Optional[str] = None,  # Solo Azure SQL (Nutrex). Ignorado en BigQuery.
    start_yyyymm: Optional[int] = None,
    end_yyyymm: Optional[int] = None,
    familia: Optional[str] = None,
    canal: Optional[str] = None,
    linea_negocio: Optional[str] = None,  # Solo BigQuery (Maka). GSBER.
    planta: Optional[str] = None,          # Solo BigQuery (Maka). WERKS.
    incluir_partes_relacionadas: bool = False,  # Solo BigQuery (Maka).
    include_counterparties: bool = True,  # Solo BigQuery (Maka). Carga parcial.
) -> Dict[str, pd.DataFrame]:
    """Carga las tres tablas desde Azure SQL con filtros opcionales en SQL.

    Args:
        sociedad: Codigo de sociedad (ej. 'S01'). Solo Azure SQL — ignorado en BigQuery.
        start_yyyymm: Limite inferior como entero YYYYMM (ej. 202401).
        end_yyyymm: Limite superior como entero YYYYMM (ej. 202605).
        familia: Filtro por familia de producto. Solo BigQuery.
        canal: Filtro por canal de distribucion. Solo BigQuery.
        linea_negocio: Filtro por línea de negocio (GSBER). Solo BigQuery.
        planta: Filtro por planta/centro (WERKS). Solo BigQuery.
        incluir_partes_relacionadas: Si True, incluye la facturación
            intercompañía del canal "06 - Partes Relacionadas" (PAN <-> MPE).
            Excluida por defecto porque no es venta de mercado real. Solo BigQuery.
    """
    if BACKEND == "bigquery":
        return _load_data_bigquery(
            start_yyyymm, end_yyyymm, familia, canal, linea_negocio, planta,
            incluir_partes_relacionadas, include_counterparties,
        )
    fact_conds: list[str] = ["1=1"]
    prod_conds: list[str] = ["1=1"]
    bal_conds:  list[str] = ["1=1"]
    fact_p: list = []
    prod_p: list = []
    bal_p:  list = []

    if sociedad:
        fact_conds.append("sociedad = %s");  fact_p.append(sociedad)
        prod_conds.append("sociedad = %s");  prod_p.append(sociedad)
        bal_conds.append("sociedad = %s");   bal_p.append(sociedad)

    if start_yyyymm and end_yyyymm:
        # Convertir YYYYMM a fechas para facturacion y produccion
        start_y, start_m = start_yyyymm // 100, start_yyyymm % 100
        end_y, end_m = end_yyyymm // 100, end_yyyymm % 100
        import calendar as _cal
        end_day = _cal.monthrange(end_y, end_m)[1]
        desde = f"{start_y}-{start_m:02d}-01"
        hasta = f"{end_y}-{end_m:02d}-{end_day}"
        fact_conds.append("fecha_contable >= %s AND fecha_contable <= %s")
        fact_p.extend([desde, hasta])
        prod_conds.append("fecha_fin >= %s AND fecha_fin <= %s")
        prod_p.extend([desde, hasta])
        # balance usa columnas anio/mes enteras
        bal_conds.append("(anio * 100 + mes) >= %s AND (anio * 100 + mes) <= %s")
        bal_p.extend([start_yyyymm, end_yyyymm])

    fact_sql = (
        "SELECT sociedad, fecha_contable, cliente_id, cliente_nombre, "
        "       item_id, item_desc, item_grupo_desc, categoria_articulo, "
        "       importe_neto_sinIVA, qty_facturada, unidad_medida, margen_linea_orig "
        f"FROM silver.facturacion WHERE {' AND '.join(fact_conds)}"
    )
    prod_sql = (
        "SELECT sociedad, fecha_fin, item_id, item_desc, item_grupo_desc, qty_producida "
        f"FROM silver.produccion WHERE {' AND '.join(prod_conds)}"
    )
    bal_sql = (
        "SELECT sociedad, anio, mes, cuenta, desc_cuenta, categoria_pyg, balance "
        f"FROM silver.balance_cuentas WHERE {' AND '.join(bal_conds)}"
    )

    fact    = read_sql(fact_sql, fact_p or None)
    prod    = read_sql(prod_sql, prod_p or None)
    balance = read_sql(bal_sql,  bal_p  or None)

    fact["fecha_contable"] = pd.to_datetime(fact["fecha_contable"], errors="coerce")
    fact["periodo"] = fact["fecha_contable"].dt.to_period("M")
    fact["qty_facturada"] = pd.to_numeric(
        fact["qty_facturada"], errors="coerce"
    ).fillna(0.0)
    fact["importe_neto_sinIVA"] = pd.to_numeric(
        fact["importe_neto_sinIVA"], errors="coerce"
    ).fillna(0.0)
    fact["margen_linea_orig"] = pd.to_numeric(
        fact.get("margen_linea_orig"), errors="coerce"
    )

    prod["fecha_fin"] = pd.to_datetime(prod["fecha_fin"], errors="coerce")
    prod["periodo"] = prod["fecha_fin"].dt.to_period("M")
    prod["qty_producida"] = pd.to_numeric(
        prod["qty_producida"], errors="coerce"
    ).fillna(0.0)

    balance["periodo"] = pd.to_datetime(
        {
            "year": balance["anio"].astype(int),
            "month": balance["mes"].astype(int),
            "day": 1,
        },
        errors="coerce",
    ).dt.to_period("M")
    balance["balance"] = pd.to_numeric(balance["balance"], errors="coerce").fillna(0.0)
    balance["mov_abs"] = balance["balance"].abs()

    return {
        "balance": balance,
        "facturacion": fact,
        "produccion": prod,
        "acreedores": _empty_counterparty_df("acreedores"),
        "deudores": _empty_counterparty_df("deudores"),
        "acreedores_trend": _empty_counterparty_trend_df(),
        "deudores_trend": _empty_counterparty_trend_df(),
    }


# ---------------------------------------------------------------------------
# Configuracion
# ---------------------------------------------------------------------------


@dataclass
class ReportConfig:
    top_n: int = 10


REPORT_VIEW_MODES = ("pg", "eur_ton", "sales", "prod")

# Carga parcial por pestaña: el frontend React manda `sections` con la sección
# de la pestaña activa y solo se computan/devuelven sus queries. Sin `sections`
# (frontend Streamlit, clientes antiguos) se construye el reporte completo.
# "pyg" cubre las vistas pg y eur_ton (comparten datos).
REPORT_SECTIONS = ("pyg", "solvencia", "flujo", "sales", "clients_geo", "prod")

# Tarea de `_run_parallel` (rama BigQuery de build_report_context) → sección.
_TASK_SECTION = {
    "pyg_range": "pyg",
    "tons_by_period": "pyg",
    "solvencia": "solvencia",
    "flujo": "flujo",
    "sales_kpis": "sales",
    "vol_by_family_month": "sales",
    "vol_by_categoria_month": "sales",
    "sales_revenue_by_family": "sales",
    "sales_top_clients": "sales",
    "top_products_month": "sales",
    "prod_vs_fact_month": "sales",
    "clients_by_month": "sales",
    "margen_kpis": "sales",
    "margen_by_family": "sales",
    "margen_by_product": "sales",
    "margen_by_canal": "sales",
    "margen_trend": "sales",
    "sales_by_region": "clients_geo",
    "region_family_matrix": "clients_geo",
    "revenue_trend": "sales",
}

# Sección → claves del summary. Las claves de secciones no pedidas se OMITEN
# de la respuesta (no se devuelven vacías): el frontend mergea por spread y
# una clave vacía machacaría una sección ya cargada.
_SECTION_SUMMARY_KEYS = {
    "pyg": {"pyg_range", "pyg_month_cols", "pyg_eur_ton", "tons_by_col"},
    "solvencia": {"solvencia"},
    "flujo": {"flujo"},
    "sales": {
        "sales_kpis", "revenue_trend", "vol_by_family_month",
        "vol_by_categoria_month", "sales_revenue_by_family",
        "sales_top_clients", "top_products_month", "prod_vs_fact_month",
        "clients_by_month", "margen_kpis", "margen_by_family",
        "margen_by_product", "margen_by_canal", "margen_trend",
    },
    "clients_geo": {
        "sales_by_region", "region_family_matrix", "acreedores", "deudores",
        "acreedores_trend", "deudores_trend",
    },
    "prod": {"prod_kpis", "prod_by_family_month", "top_production_by_month"},
}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _pct_change(cur: float, prev: float) -> Optional[float]:
    if prev is None or prev == 0 or pd.isna(prev):
        return None
    return (cur - prev) / abs(prev)


def _sum_revenue(fact: pd.DataFrame, period: pd.Period) -> float:
    return float(fact.loc[fact["periodo"].eq(period), "importe_neto_sinIVA"].sum())


def _sum_qty(df: pd.DataFrame, period: pd.Period, qty_col: str) -> float:
    sub = df[df["periodo"].eq(period)]
    if "unidad_medida" in sub.columns:
        sub = sub[sub["unidad_medida"].eq("KG")]
    return float(sub[qty_col].sum())


# ---------------------------------------------------------------------------
# Catalogo
# ---------------------------------------------------------------------------


def get_catalog_minimal() -> dict:
    """Load only catalog metadata (months, companies and filter dimensions)."""
    if BACKEND == "bigquery":
        # GOLD (14-jul-2026): antes escaneaba las tablas silver completas
        # (RENTABILIDAD_VENTAS_RECETAS_COSTESMP / RENTABILIDAD_PYG_DETALLE)
        # solo para sacar los valores distintos de mes/familia/canal/línea/
        # planta -- y se ejecutaba en CADA carga del reporte, antes que
        # cualquier otra query. Ahora sale de los agregados gold ya
        # existentes (validado 0-diff en las 5 dimensiones, 14-jul-2026).
        def _ventas_dims() -> pd.DataFrame:
            return read_sql(f"SELECT DISTINCT anio, mes, familia, canal FROM {_BQ_GOLD_MARGEN_MENSUAL}")

        def _pyg_dims() -> pd.DataFrame:
            return read_sql(
                f"SELECT DISTINCT linea_negocio, planta FROM {_BQ_GOLD_PYG_DETALLE} "
                f"WHERE linea_negocio IS NOT NULL"
            )

        results = _run_parallel({"ventas": _ventas_dims, "pyg": _pyg_dims})
        dims = results["ventas"]
        pyg_dims = results["pyg"]

        meses = sorted({f"{int(a):04d}-{int(m):02d}" for a, m in zip(dims["anio"], dims["mes"])})
        ultimo = meses[-1] if meses else str(pd.Period(pd.Timestamp.now(), freq="M"))
        familias = sorted(str(f) for f in dims["familia"].dropna().unique())
        # "Sin asignar" es un valor sintético del gold para canal NULO en el
        # silver (ver `_gold_ventas_where`) -- nunca fue una opción de filtro
        # real, se excluye para no ofrecerlo como si lo fuera.
        canales = sorted(str(c) for c in dims["canal"].dropna().unique() if c != "Sin asignar")
        lineas_negocio = sorted(str(v) for v in pyg_dims["linea_negocio"].dropna().unique())
        plantas = sorted(str(v) for v in pyg_dims["planta"].dropna().unique())
        return {
            "meses": meses, "sociedades": [], "ultimo_mes": ultimo,
            "familias": familias, "canales": canales,
            "lineas_negocio": lineas_negocio, "plantas": plantas,
        }
    else:
        fact = read_sql("SELECT DISTINCT fecha_contable, sociedad FROM silver.facturacion")
        fact["fecha_contable"] = pd.to_datetime(fact["fecha_contable"], errors="coerce")
        fact["periodo"] = fact["fecha_contable"].dt.to_period("M")
        meses = sorted(str(p) for p in fact["periodo"].dropna().unique())
        sociedades = sorted(str(s) for s in fact["sociedad"].dropna().unique())
        ultimo = meses[-1] if meses else str(pd.Period(pd.Timestamp.now(), freq="M"))
        return {
            "meses": meses, "sociedades": sociedades, "ultimo_mes": ultimo,
            "familias": [], "canales": [],
        }


def _resolve_sociedad(catalog_sociedades: list[str], sociedad: Optional[str]) -> str:
    if sociedad and str(sociedad) in catalog_sociedades:
        return str(sociedad)
    if "S01" in catalog_sociedades:
        return "S01"
    return catalog_sociedades[0] if catalog_sociedades else "S01"


def _resolve_target_period(
    catalog_meses: list[str],
    default_period: Optional[pd.Period],
    target_period: Optional[str],
) -> pd.Period:
    if target_period:
        return pd.Period(target_period, freq="M")
    if default_period is not None:
        return default_period
    if catalog_meses:
        return pd.Period(catalog_meses[-1], freq="M")
    return pd.Period(pd.Timestamp.now(), freq="M")


# ---------------------------------------------------------------------------
# Bloques del resumen
# ---------------------------------------------------------------------------


def _kpis(data: Dict[str, pd.DataFrame], target: pd.Period) -> dict:
    fact, prod, bal = data["facturacion"], data["produccion"], data["balance"]
    prev = target - 1

    ing_cur = _sum_revenue(fact, target)
    ing_prev = _sum_revenue(fact, prev)

    f_cur = fact[fact["periodo"].eq(target)]
    f_prev = fact[fact["periodo"].eq(prev)]

    kg_fact_cur = _sum_qty(fact, target, "qty_facturada")
    kg_fact_prev = _sum_qty(fact, prev, "qty_facturada")
    kg_prod_cur = _sum_qty(prod, target, "qty_producida")
    kg_prod_prev = _sum_qty(prod, prev, "qty_producida")

    clientes_cur = int(f_cur["cliente_id"].nunique())
    clientes_prev = int(f_prev["cliente_id"].nunique())
    productos_cur = int(f_cur["item_id"].nunique())

    b_cur = bal[bal["periodo"].eq(target)]
    b_prev = bal[bal["periodo"].eq(prev)]
    resultado_cur = float(b_cur["balance"].sum())
    resultado_prev = float(b_prev["balance"].sum())

    return {
        "ingresos": {"valor": ing_cur, "delta": _pct_change(ing_cur, ing_prev)},
        "kg_facturados": {
            "valor": kg_fact_cur,
            "delta": _pct_change(kg_fact_cur, kg_fact_prev),
        },
        "kg_producidos": {
            "valor": kg_prod_cur,
            "delta": _pct_change(kg_prod_cur, kg_prod_prev),
        },
        "clientes_activos": {
            "valor": clientes_cur,
            "delta": _pct_change(clientes_cur, clientes_prev),
        },
        "productos_facturados": {"valor": productos_cur, "delta": None},
        "resultado_pyg": {
            "valor": resultado_cur,
            "delta": _pct_change(resultado_cur, resultado_prev),
        },
    }


def _revenue_trend(fact: pd.DataFrame) -> pd.DataFrame:
    """Serie completa de ingresos por mes (sin filtrar por target_period)."""
    g = (
        fact.groupby("periodo", as_index=False)["importe_neto_sinIVA"]
        .sum()
        .rename(columns={"importe_neto_sinIVA": "ingresos"})
        .sort_values("periodo")
    )
    g["periodo"] = g["periodo"].astype(str)
    return g


def _production_trend(prod: pd.DataFrame) -> pd.DataFrame:
    """Serie completa de produccion en KG por mes."""
    g = (
        prod.groupby("periodo", as_index=False)["qty_producida"]
        .sum()
        .rename(columns={"qty_producida": "kg_producidos"})
        .sort_values("periodo")
    )
    g["periodo"] = g["periodo"].astype(str)
    return g


def _production_by_family(
    prod: pd.DataFrame, target: pd.Period, top_n: int
) -> pd.DataFrame:
    """Top familias por KG producidos en el mes objetivo."""
    sub = prod[prod["periodo"].eq(target)]
    g = (
        sub.groupby("item_grupo_desc", as_index=False)["qty_producida"]
        .sum()
        .rename(
            columns={"item_grupo_desc": "familia", "qty_producida": "kg_producidos"}
        )
        .sort_values("kg_producidos", ascending=False)
        .head(top_n)
        .reset_index(drop=True)
    )
    return g


# Mapeo de códigos de categoría a nombres legibles
_CATEGORIA_MAPPING = {
    "PI": "Piensos",
    "NB": "Nutrex Bo (Marca propia)",
    "AN": "Animales vivos",
    "ME": "Medicamentos/Zoosanitarios",
    "ENV": "Envases/Embalaje",
    "MA": "Materias primas",
    "AL": "Servicios/Otros",
    "PE": "Super Plan",
    "AC": "Accesorios",
    "CO": "Productos intermedios",
}


def _revenue_by(
    fact: pd.DataFrame, target: pd.Period, col: str, label: str, top_n: int
) -> pd.DataFrame:
    sub = fact[fact["periodo"].eq(target)]
    g = (
        sub.groupby(col, as_index=False)["importe_neto_sinIVA"]
        .sum()
        .rename(columns={col: label, "importe_neto_sinIVA": "ingresos"})
        .sort_values("ingresos", ascending=False)
        .head(top_n)
        .reset_index(drop=True)
    )
    return g


def _revenue_by_categoria(fact: pd.DataFrame, target: pd.Period) -> pd.DataFrame:
    """Agrupa ventas por categoría de artículo con nombres legibles."""
    sub = fact[fact["periodo"].eq(target)].copy()

    # Mapear códigos de categoría a nombres legibles
    sub["categoria_nombre"] = (
        sub["categoria_articulo"]
        .map(_CATEGORIA_MAPPING)
        .fillna(sub["categoria_articulo"])
    )

    # Agrupar por categoría y sumar ingresos
    g = (
        sub.groupby("categoria_nombre", as_index=False)["importe_neto_sinIVA"]
        .sum()
        .rename(columns={"importe_neto_sinIVA": "ingresos"})
        .sort_values("ingresos", ascending=False)
        .reset_index(drop=True)
    )
    return g


def _top_production_by_product(
    prod: pd.DataFrame, target: pd.Period, top_n: int
) -> pd.DataFrame:
    sub = prod[prod["periodo"].eq(target)]
    g = (
        sub.groupby("item_desc", as_index=False)["qty_producida"]
        .sum()
        .rename(columns={"item_desc": "producto", "qty_producida": "kg_producidos"})
        .sort_values("kg_producidos", ascending=False)
        .head(top_n)
        .reset_index(drop=True)
    )
    return g


def _prod_vs_fact_by_family(
    data: Dict[str, pd.DataFrame], target: pd.Period, top_n: int
) -> pd.DataFrame:
    fact, prod = data["facturacion"], data["produccion"]
    f = (
        fact[fact["periodo"].eq(target)]
        .groupby("item_grupo_desc", as_index=False)["qty_facturada"]
        .sum()
        .rename(columns={"qty_facturada": "kg_facturados"})
    )
    p = (
        prod[prod["periodo"].eq(target)]
        .groupby("item_grupo_desc", as_index=False)["qty_producida"]
        .sum()
        .rename(columns={"qty_producida": "kg_producidos"})
    )
    m = f.merge(p, on="item_grupo_desc", how="outer").fillna(0.0)
    m["total"] = m["kg_facturados"] + m["kg_producidos"]
    m = m.sort_values("total", ascending=False).head(top_n).drop(columns="total")
    return m.rename(columns={"item_grupo_desc": "familia"}).reset_index(drop=True)


def _norm_cat(value) -> str:
    """Normaliza una categoria_pyg para emparejarla con `_CATEGORIA_PYG_MAPPING`:
    minúsculas, sin tildes/acentos y sin espacios redundantes."""
    s = str(value or "").strip().lower()
    s = "".join(
        c for c in unicodedata.normalize("NFKD", s) if not unicodedata.combining(c)
    )
    return " ".join(s.split())


def _pyg_rows_maka(conceptos: pd.DataFrame) -> list[dict]:
    """Estructura P&G para Maka (BigQuery). Basada en cuentas SAP CO.

    Fórmulas (alineadas con Excel de referencia Maka):
      Total Ventas Brutas = suma de subcategorías de ingreso
      Total Ventas Netas  = Total Ventas Brutas + Descuentos y Promociones (negativo)
      Utilidad Bruta      = Total Ventas Netas + Costo de Venta (negativo)
      EBITDA              = Utilidad Bruta + Gastos de Operación (sin depreciación)
      Util. Financiera    = EBITDA + Depreciación + Gastos Financieros
    """
    rows: list[dict] = []

    def _row(concepto, importe, tipo, nivel):
        rows.append({"concepto": concepto, "importe": importe, "tipo": tipo, "nivel": nivel})

    def _get(nombre: str) -> float:
        r = conceptos[conceptos["concepto"] == nombre]
        return float(r["importe"].sum()) if not r.empty else 0.0

    # =========================================================================
    # VENTAS BRUTAS (por línea de producto)
    # =========================================================================
    _row("VENTAS BRUTAS", 0, "encabezado", -1)

    vtas_mat    = _get("Ventas Brutas Materiales")
    vtas_croq   = _get("Ventas Brutas Croqueta")
    vtas_alim   = _get("Venta Alimento Cocinado")
    vtas_masc   = _get("Venta Artículo Mascota")
    vtas_serv   = _get("Venta Servicio e Intereses")
    otros_ing   = _get("Otros Ingresos")        # range fallback 4019xxx+
    ing_resto   = _get("Ingresos Brutos")       # range fallback 4010xxx-4017xxx no mapeados

    _row("Ventas Brutas Materiales",    vtas_mat,  "concepto", 0)
    _row("Ventas Brutas Croqueta",      vtas_croq, "concepto", 0)
    _row("Venta Alimento Cocinado",     vtas_alim, "concepto", 0)
    if vtas_masc != 0:
        _row("Venta Artículo Mascota",  vtas_masc, "concepto", 0)
    if vtas_serv != 0:
        _row("Venta Servicio e Intereses", vtas_serv, "concepto", 0)
    if otros_ing != 0:
        _row("Otros Ingresos",          otros_ing, "concepto", 0)
    if ing_resto != 0:
        _row("Otras Ventas",            ing_resto, "concepto", 0)

    total_vtas_brutas = vtas_mat + vtas_croq + vtas_alim + vtas_masc + vtas_serv + otros_ing + ing_resto
    _row("Total Ventas Brutas", total_vtas_brutas, "subtotal", 0)

    descuentos = _get("Descuentos y Promociones")   # positivo en BigQuery (débito SAP)
    _row("Descuentos y Promociones", -descuentos, "concepto", 0)

    ventas_netas = total_vtas_brutas - descuentos
    _row("Total Ventas Netas", ventas_netas, "subtotal", 1)

    # =========================================================================
    # COSTO DE VENTA
    # =========================================================================
    _row("COSTO DE VENTA", 0, "encabezado", -1)

    costo_transformacion  = _get("Costo Transformación")
    costo_empaque         = _get("Costo Empaque")
    costo_alimento        = _get("Costo Alimento")
    costo_materiales      = _get("Costo Materiales")
    costo_croqueta        = _get("Costo Croqueta")
    costo_vta_croqueta    = _get("Costo Venta de Croqueta")
    costo_alim_cocinado   = _get("Costo Alimento Cocinado")
    costo_lofilizados     = _get("Costo Lofilizados")
    costo_venta           = _get("Costo de Venta")   # cuentas 5040xxx no subcategorizadas

    if costo_transformacion != 0:
        _row("Costo Transformación",       costo_transformacion, "concepto", 0)
    if costo_empaque != 0:
        _row("Costo Empaque",              costo_empaque,        "concepto", 0)
    if costo_alimento != 0:
        _row("Costo Alimento",             costo_alimento,       "concepto", 0)
    if costo_materiales != 0:
        _row("Costo Materiales",           costo_materiales,     "concepto", 0)
    if costo_croqueta != 0:
        _row("Costo Croqueta",             costo_croqueta,       "concepto", 0)
    if costo_vta_croqueta != 0:
        _row("Costo Venta de Croqueta",    costo_vta_croqueta,   "concepto", 0)
    if costo_alim_cocinado != 0:
        _row("Costo Alimento Cocinado", costo_alim_cocinado,  "concepto", 0)
    if costo_lofilizados != 0:
        _row("Costo Lofilizados",       costo_lofilizados,    "concepto", 0)
    if costo_venta != 0:
        _row("Costo de Venta",             costo_venta,          "concepto", 0)

    costo_total = (
        costo_transformacion + costo_empaque + costo_alimento + costo_materiales
        + costo_croqueta + costo_vta_croqueta + costo_alim_cocinado
        + costo_lofilizados + costo_venta
    )
    _row("Costo Total", costo_total, "subtotal", 1)

    utilidad_bruta = ventas_netas - costo_total
    _row("Utilidad Bruta", utilidad_bruta, "subtotal", 1)

    ub_pct = (utilidad_bruta / ventas_netas * 100) if ventas_netas else 0.0
    _row("Utilidad Bruta %", ub_pct, "porcentaje", 2)

    # =========================================================================
    # GASTOS DE OPERACIÓN (sin depreciación → para EBITDA)
    # =========================================================================
    _row("GASTOS DE OPERACIÓN", 0, "encabezado", -1)

    gastos_prod     = _get("Gastos de Producción")               # negativo
    gastos_adm_vtas = _get("Gastos de Administración y Ventas")  # negativo
    gastos_op       = _get("Gastos de Operación")                 # negativo (rango fallback)
    if gastos_prod != 0:
        _row("Gastos de Producción", gastos_prod, "concepto", 0)
    if gastos_adm_vtas != 0:
        _row("Gastos de Administración y Ventas", gastos_adm_vtas, "concepto", 0)
    if gastos_op != 0:
        _row("Gastos de Operación", gastos_op, "concepto", 0)

    ebitda = utilidad_bruta - gastos_prod - gastos_adm_vtas - gastos_op
    _row("EBITDA", ebitda, "subtotal", 1)

    ebitda_pct = (ebitda / ventas_netas * 100) if ventas_netas else 0.0
    _row("EBITDA %/Ventas", ebitda_pct, "porcentaje", 2)

    # =========================================================================
    # DEPRECIACIÓN Y GASTOS FINANCIEROS
    # =========================================================================
    depreciacion  = _get("Depreciación")           # negativo
    ingresos_fin  = _get("Ingresos Financieros")   # positivo (solo cuentas explícitas del mapping)
    gastos_fin    = _get("Gastos Financieros")     # negativo (solo cuentas explícitas del mapping)
    ing_gtos_fin  = ingresos_fin + gastos_fin      # neto de la partida financiera

    if depreciacion != 0 or ing_gtos_fin != 0:
        _row("RESULTADO FINANCIERO", 0, "encabezado", -1)
        if depreciacion != 0:
            _row("Amortizaciones", depreciacion, "concepto", 0)
        if ing_gtos_fin != 0:
            _row("Ingresos / Gastos Financieros", ing_gtos_fin, "concepto", 0)
        utilidad_financiera = ebitda + depreciacion + ing_gtos_fin
        _row("Utilidad / Pérdida Financiera", utilidad_financiera, "subtotal", 1)

    # Partidas no mapeadas
    no_esp = _get(_SECCION_NO_ESPECIFICADO)
    if abs(no_esp) >= 1.0:
        _row(_SECCION_NO_ESPECIFICADO, no_esp, "concepto", 0)

    return rows


def _pyg_rows_nutrex(conceptos: pd.DataFrame) -> list[dict]:
    """Estructura P&G para Nutrex (Azure SQL). Lógica original."""
    rows: list[dict] = []

    def _row(concepto, importe, tipo, nivel):
        rows.append({"concepto": concepto, "importe": importe, "tipo": tipo, "nivel": nivel})

    def _get(nombre: str) -> float:
        r = conceptos[conceptos["concepto"] == nombre]
        return float(r["importe"].sum()) if not r.empty else 0.0

    # INGRESOS
    _row("INGRESOS", 0, "encabezado", -1)
    ingresos_op  = _get("Ingresos Operativos")
    ingresos_div = _get("Ingresos Servicios Div.")
    _row("Ingresos Operativos",    ingresos_op,  "concepto", 0)
    _row("Ingresos Servicios Div.", ingresos_div, "concepto", 0)
    total_ingresos = ingresos_op + ingresos_div
    _row("Total Ingresos", total_ingresos, "subtotal", 1)

    # COGS
    _row("COGS", 0, "encabezado", -1)
    coste_directo = _get("Coste Directo Ventas")
    _row("Coste Directo Ventas", coste_directo, "concepto", 0)
    margen_bruto = total_ingresos + coste_directo
    _row("Margen Bruto", margen_bruto, "subtotal", 1)
    mb_pct = (margen_bruto / total_ingresos * 100) if total_ingresos else 0.0
    _row("Margen Bruto %", mb_pct, "porcentaje", 2)

    # OPERACIÓN
    _row("OPERACIÓN", 0, "encabezado", -1)
    costes_fab = _get("Costes Fabricación")
    _row("Costes Fabricación", costes_fab, "concepto", 0)
    mg_contrib_1 = margen_bruto + costes_fab
    _row("Mg. Contribución I", mg_contrib_1, "subtotal", 1)
    costes_com = _get("Costes Comerciales")
    _row("Costes Comerciales", costes_com, "concepto", 0)
    mg_contrib_2 = mg_contrib_1 + costes_com
    _row("Mg. Contribución II", mg_contrib_2, "subtotal", 1)
    gastos_gen = _get("Gastos Generales")
    _row("Gastos Generales", gastos_gen, "concepto", 0)
    ebitda = mg_contrib_2 + gastos_gen
    _row("EBITDA", ebitda, "subtotal", 1)
    ebitda_pct = (ebitda / total_ingresos * 100) if total_ingresos else 0.0
    _row("EBITDA %", ebitda_pct, "porcentaje", 2)

    # EXCEPCIONALES
    _row("EXCEPCIONALES", 0, "encabezado", -1)
    amortizaciones = _get("Amortizaciones")
    _row("Amortizaciones", amortizaciones, "concepto", 0)
    resultado_fin = _get("Resultado Financiero")
    _row("Resultado Financiero", resultado_fin, "concepto", 0)
    resultados_exc = _get("Resultados Excepcionales")
    _row("Resultados Excepcionales", resultados_exc, "concepto", 0)
    no_esp = _get(_SECCION_NO_ESPECIFICADO)
    _row(_SECCION_NO_ESPECIFICADO, no_esp, "concepto", 0)
    resultado_ejercicio = ebitda + amortizaciones + resultado_fin + resultados_exc + no_esp
    _row("Resultado Ejercicio", resultado_ejercicio, "subtotal", 1)

    return rows


def _pyg_rows_for_periods(bal: pd.DataFrame, periods) -> list[dict]:
    """Calcula las filas P&G agregando uno o varios periodos.

    Para un solo mes, pasar ``[periodo]``; para la columna YTD, pasar el rango
    completo (los porcentajes se recalculan sobre el agregado, no se suman).

    Devuelve una lista de dicts con: concepto, importe, tipo
    ("concepto" | "subtotal" | "porcentaje" | "encabezado") y nivel.
    Incluye encabezados y conceptos en cero (el filtrado se hace fuera).
    """
    sub = bal[bal["periodo"].isin(list(periods))].copy()

    # Para Maka (BigQuery): categoria_pyg ya viene del mapeo KSTAR directo.
    # Para Nutrex (Azure SQL): normalizar con _CATEGORIA_PYG_MAPPING.
    if BACKEND == "bigquery":
        sub["concepto"] = sub["categoria_pyg"].fillna(_SECCION_NO_ESPECIFICADO)
    else:
        sub["concepto"] = sub["categoria_pyg"].map(
            lambda c: _CATEGORIA_PYG_MAPPING.get(_norm_cat(c), _SECCION_NO_ESPECIFICADO)
        )

    conceptos = (
        sub.groupby("concepto", as_index=False)["balance"]
        .sum()
        .rename(columns={"balance": "importe"})
    )

    if BACKEND == "bigquery":
        return _pyg_rows_maka(conceptos)
    return _pyg_rows_nutrex(conceptos)


def _pyg_summary(bal: pd.DataFrame, target: pd.Period) -> pd.DataFrame:
    """P&G de un único mes (columna 'importe'). Usado por la vista €/Tonelada."""
    pyg_df = pd.DataFrame(_pyg_rows_for_periods(bal, [target]))
    # Ocultar encabezados y conceptos individuales en cero; mantener
    # subtotales y porcentajes aunque sean 0.
    pyg_df = pyg_df[
        ~(
            (pyg_df["tipo"] == "encabezado")
            | ((pyg_df["tipo"] == "concepto") & (pyg_df["importe"] == 0))
        )
    ].reset_index(drop=True)
    return pyg_df


def _pyg_summary_range(
    bal: pd.DataFrame, periods
) -> tuple[pd.DataFrame, list[str]]:
    """P&G multi-columna: una columna por mes del rango + columna YTD.

    Devuelve ``(df, month_cols)`` donde ``df`` tiene columnas
    concepto/tipo/nivel + una columna por periodo ('YYYY-MM') + 'YTD'.
    Los porcentajes de la columna YTD se recalculan sobre el agregado del
    rango (no son la suma de los porcentajes mensuales).
    """
    periods = list(periods)
    ytd_rows = _pyg_rows_for_periods(bal, periods)
    month_maps = {
        str(p): {r["concepto"]: r["importe"] for r in _pyg_rows_for_periods(bal, [p])}
        for p in periods
    }
    month_cols = [str(p) for p in periods] + ["YTD"]

    records = []
    for r in ytd_rows:
        rec = {"concepto": r["concepto"], "tipo": r["tipo"], "nivel": r["nivel"]}
        for p in periods:
            rec[str(p)] = month_maps[str(p)].get(r["concepto"], 0.0)
        rec["YTD"] = r["importe"]
        records.append(rec)

    df = pd.DataFrame(records)
    if df.empty:
        return df, month_cols

    # Ocultar encabezados y conceptos que estén en cero en TODAS las columnas;
    # mantener subtotales y porcentajes.
    is_enc = df["tipo"] == "encabezado"
    is_zero = (df["tipo"] == "concepto") & (df[month_cols].abs().sum(axis=1) == 0)
    df = df[~(is_enc | is_zero)].reset_index(drop=True)
    return df, month_cols


def _pyg_summary_eur_ton(
    bal: pd.DataFrame, fact: pd.DataFrame, periods
) -> tuple[pd.DataFrame, list[str], dict]:
    """P&G en €/tonelada facturada.

    Reutiliza ``_pyg_summary_range`` (P&G en €) y divide cada importe por las
    toneladas facturadas de su columna: cada mes por sus toneladas y la columna
    YTD por las toneladas de todo el rango. Las filas de porcentaje se dejan
    intactas (un % no se divide por toneladas; además es invariante al dividir
    numerador y denominador por la misma tonelada).

    Toneladas = suma de ``qty_facturada`` (en kg, solo ``unidad_medida == 'KG'``)
    dividida entre 1000. Si una columna tiene 0 toneladas, sus importes quedan NaN.

    Devuelve ``(df, month_cols, tons_by_col)``.
    """
    periods = list(periods)
    df, month_cols = _pyg_summary_range(bal, periods)

    # Toneladas facturadas por columna (mes a mes) y total del rango (YTD).
    tons = {str(p): _sum_qty(fact, p, "qty_facturada") / 1000.0 for p in periods}
    tons["YTD"] = sum(tons.values())

    return _apply_eur_ton_division(df, month_cols, tons), month_cols, tons


def _apply_eur_ton_division(df: pd.DataFrame, month_cols: list[str], tons: dict) -> pd.DataFrame:
    """Divide cada importe (excepto filas de porcentaje) entre las toneladas
    de su columna. Compartido por `_pyg_summary_eur_ton` (Nutrex/Azure) y
    `_pyg_eur_ton_from_range_bigquery` (Maka/BigQuery) — misma lógica,
    distinta fuente de `df`."""
    if df.empty:
        return df
    out = df.copy()
    tipos = out["tipo"].tolist()
    for col in month_cols:
        t = tons.get(col, 0.0)
        out[col] = [
            v
            if tp == "porcentaje"
            else (v / t if (t and not pd.isna(v)) else float("nan"))
            for v, tp in zip(df[col], tipos)
        ]
    return out


# ---------------------------------------------------------------------------
# GOLD (14-jul-2026): Página 1 (P&G Detalle) desde RENTABILIDAD_GOLD_PYG_DETALLE
# — reemplaza el patrón N+1 de `_pyg_rows_for_periods`/`_pyg_rows_maka`
# (reconstruir subtotales/EBITDA una vez por mes + una vez para el rango).
# Solo Maka (BigQuery) — Nutrex sigue con `_pyg_summary_range` de arriba.
# ---------------------------------------------------------------------------

# Mismo orden/estructura que emite `_pyg_rows_maka`, SIN las filas
# "encabezado": esas ya se descartaban siempre antes de llegar al frontend
# (`_pyg_summary_range` las quita sin condición vía `is_enc`), así que la
# tabla gold — que directamente no las materializa — no cambia nada visible.
_PYG_MAKA_CONCEPT_ORDER: list[tuple[str, str]] = [
    ("Ventas Brutas Materiales", "concepto"),
    ("Ventas Brutas Croqueta", "concepto"),
    ("Venta Alimento Cocinado", "concepto"),
    ("Venta Artículo Mascota", "concepto"),
    ("Venta Servicio e Intereses", "concepto"),
    ("Otros Ingresos", "concepto"),
    ("Otras Ventas", "concepto"),
    ("Total Ventas Brutas", "subtotal"),
    ("Descuentos y Promociones", "concepto"),
    ("Total Ventas Netas", "subtotal"),
    ("Costo Transformación", "concepto"),
    ("Costo Empaque", "concepto"),
    ("Costo Alimento", "concepto"),
    ("Costo Materiales", "concepto"),
    ("Costo Croqueta", "concepto"),
    ("Costo Venta de Croqueta", "concepto"),
    ("Costo Alimento Cocinado", "concepto"),
    ("Costo Lofilizados", "concepto"),
    ("Costo de Venta", "concepto"),
    ("Costo Total", "subtotal"),
    ("Utilidad Bruta", "subtotal"),
    ("Utilidad Bruta %", "porcentaje"),
    ("Gastos de Producción", "concepto"),
    ("Gastos de Administración y Ventas", "concepto"),
    ("Gastos de Operación", "concepto"),
    ("EBITDA", "subtotal"),
    ("EBITDA %/Ventas", "porcentaje"),
    ("Amortizaciones", "concepto"),
    ("Ingresos / Gastos Financieros", "concepto"),
    ("Utilidad / Pérdida Financiera", "subtotal"),
    (_SECCION_NO_ESPECIFICADO, "concepto"),
]


def _pyg_summary_range_bigquery(
    start_yyyymm: int,
    end_yyyymm: int,
    linea_negocio: Optional[str] = None,
    planta: Optional[str] = None,
) -> tuple[pd.DataFrame, list[str]]:
    """P&G multi-columna (Página 1) desde RENTABILIDAD_GOLD_PYG_DETALLE: una
    columna por mes del rango + columna YTD.

    YTD (decisión con Pablo, 14-jul-2026): SIEMPRE acumulado de CALENDARIO
    enero→mes de cierre (`importe_ytd`, tomado del último mes del rango),
    NO la suma del rango seleccionado como hacía `_pyg_summary_range` — si el
    rango elegido no empieza en enero, este YTD y la suma de las columnas de
    mes mostradas pueden no coincidir a propósito (pendiente: caption en el
    frontend aclarándolo).

    Sin filtro de línea/planta, se suma sobre TODAS las combinaciones (la
    tabla gold ya lo deja preparado: cada subtotal es una combinación lineal
    de sumas, así que sumar los subtotales de cada línea/planta reproduce
    el subtotal global). Con filtro, se filtra directo. "Utilidad/Pérdida
    Financiera" y sus componentes solo existen a nivel global (NULL, NULL) —
    desaparecen si se filtra por línea/planta, mismo hueco ya conocido hoy
    (Decisión 2 del diseño gold, sin resolver a propósito).

    Los % ("Utilidad Bruta %", "EBITDA %/Ventas") NO se pueden sumar entre
    líneas/plantas — se recalculan aquí desde los subtotales ya agregados.
    """
    conds = [f"(anio * 100 + mes) BETWEEN {start_yyyymm} AND {end_yyyymm}", "tipo != 'porcentaje'"]
    if linea_negocio:
        conds.append(f"linea_negocio = '{linea_negocio.replace(chr(39), chr(39) * 2)}'")
    if planta:
        conds.append(f"planta = '{planta.replace(chr(39), chr(39) * 2)}'")
    where = " AND ".join(conds)
    raw = read_sql(f"""
        SELECT anio, mes, concepto, SUM(importe_mes) AS importe_mes, SUM(importe_ytd) AS importe_ytd
        FROM {_BQ_GOLD_PYG_DETALLE}
        WHERE {where}
        GROUP BY anio, mes, concepto
    """)

    month_cols: list[str] = []
    periods_yyyymm: list[int] = []
    y, m = start_yyyymm // 100, start_yyyymm % 100
    ey, em = end_yyyymm // 100, end_yyyymm % 100
    while (y, m) <= (ey, em):
        periods_yyyymm.append(y * 100 + m)
        month_cols.append(_periodo_str(y, m))
        m += 1
        if m > 12:
            m, y = 1, y + 1
    month_cols_all = month_cols + ["YTD"]

    if raw.empty:
        return pd.DataFrame(columns=["concepto", "tipo", "nivel"] + month_cols_all), month_cols_all

    # `importe_mes`/`importe_ytd` vienen de una columna NUMERIC de BigQuery →
    # el cliente Python las trae como `decimal.Decimal`, no `float`. Sin este
    # cast, mezclarlas más abajo con los defaults `0.0` (float) revienta con
    # "unsupported operand type(s) for +: 'float' and 'decimal.Decimal'".
    raw["importe_mes"] = pd.to_numeric(raw["importe_mes"], errors="coerce").fillna(0.0)
    raw["importe_ytd"] = pd.to_numeric(raw["importe_ytd"], errors="coerce").fillna(0.0)
    raw["yyyymm"] = raw["anio"] * 100 + raw["mes"]
    by_month: dict[int, dict] = {
        p: dict(zip(g["concepto"], g["importe_mes"])) for p, g in raw.groupby("yyyymm")
    }
    ytd_slice = raw[raw["yyyymm"] == end_yyyymm]
    ytd_map = dict(zip(ytd_slice["concepto"], ytd_slice["importe_ytd"]))

    def _with_pct(d: dict) -> dict:
        d = dict(d)
        vn = d.get("Total Ventas Netas", 0.0) or 0.0
        d["Utilidad Bruta %"] = (d.get("Utilidad Bruta", 0.0) or 0.0) / vn * 100 if vn else 0.0
        d["EBITDA %/Ventas"] = (d.get("EBITDA", 0.0) or 0.0) / vn * 100 if vn else 0.0
        return d

    ytd_map = _with_pct(ytd_map)
    by_month = {p: _with_pct(d) for p, d in by_month.items()}

    records = []
    for concepto, tipo in _PYG_MAKA_CONCEPT_ORDER:
        rec: dict = {"concepto": concepto, "tipo": tipo, "nivel": 0}
        for p, col in zip(periods_yyyymm, month_cols):
            rec[col] = by_month.get(p, {}).get(concepto, 0.0)
        rec["YTD"] = ytd_map.get(concepto, 0.0)
        records.append(rec)

    df = pd.DataFrame(records)
    # Mismo criterio que `_pyg_summary_range`: ocultar conceptos en cero en
    # TODAS las columnas mostradas; mantener subtotales y porcentajes.
    is_zero = (df["tipo"] == "concepto") & (df[month_cols_all].abs().sum(axis=1) == 0)
    df = df[~is_zero].reset_index(drop=True)
    return df, month_cols_all


def _revenue_trend_bigquery(
    start_yyyymm: Optional[int],
    end_yyyymm: Optional[int],
    familia: Optional[str] = None,
    canal: Optional[str] = None,
    incluir_partes_relacionadas: bool = False,
) -> pd.DataFrame:
    """Serie de ingresos por mes desde RENTABILIDAD_GOLD_MARGEN_MENSUAL —
    reemplaza traer toda la factura línea a línea del rango solo para sumar
    por mes en pandas (validado 0-diff contra el silver línea a línea,
    ene-2020 a jul-2026, 14-jul-2026)."""
    where = _gold_ventas_where(start_yyyymm, end_yyyymm, familia, canal, incluir_partes_relacionadas)
    df = read_sql(
        f"SELECT anio, mes, SUM(ingresos_mxn) AS ingresos "
        f"FROM {_BQ_GOLD_MARGEN_MENSUAL} WHERE {where} GROUP BY anio, mes ORDER BY anio, mes"
    )
    if df.empty:
        return pd.DataFrame(columns=["periodo", "ingresos"])
    df["ingresos"] = pd.to_numeric(df["ingresos"], errors="coerce").fillna(0.0)
    df["periodo"] = df.apply(lambda r: f"{int(r['anio'])}-{int(r['mes']):02d}", axis=1)
    return df[["periodo", "ingresos"]]


def _tons_by_month_bigquery(
    start_yyyymm: int,
    end_yyyymm: int,
    familia: Optional[str] = None,
    canal: Optional[str] = None,
    incluir_partes_relacionadas: bool = False,
) -> dict:
    """Toneladas por mes desde RENTABILIDAD_GOLD_MARGEN_MENSUAL (validado
    0-diff contra la factura línea a línea). No se filtra por
    linea_negocio/planta porque la tabla de ventas no tiene esa dimensión
    (viene de COEP, no de la factura) — mismo criterio de siempre."""
    where = _gold_ventas_where(start_yyyymm, end_yyyymm, familia, canal, incluir_partes_relacionadas)
    tons_df = read_sql(
        f"SELECT anio, mes, SUM(toneladas) AS toneladas "
        f"FROM {_BQ_GOLD_MARGEN_MENSUAL} WHERE {where} GROUP BY anio, mes"
    )
    return {
        f"{int(r['anio'])}-{int(r['mes']):02d}": float(r["toneladas"]) if pd.notna(r["toneladas"]) else 0.0
        for _, r in tons_df.iterrows()
    }


def _pyg_eur_ton_from_range_bigquery(
    pyg_range_df: pd.DataFrame,
    month_cols: list[str],
    periods,
    tons_by_period: dict,
) -> tuple[pd.DataFrame, list[str], dict]:
    """P&G en €/tonelada (Página 1, vista alterna) a partir del resultado ya
    calculado de `_pyg_summary_range_bigquery` + las toneladas de
    `_tons_by_month_bigquery` -- separado de ambos para poder lanzar esas
    dos queries en paralelo con el resto de `build_report_context` en vez
    de recalcular el P&G (varios CTEs) una segunda vez solo por esta vista."""
    periods = list(periods)
    tons = {str(p): tons_by_period.get(str(p), 0.0) for p in periods}
    tons["YTD"] = sum(tons.values())
    return _apply_eur_ton_division(pyg_range_df, month_cols, tons), month_cols, tons


# ---------------------------------------------------------------------------
# Agregaciones de Analítica de Ventas — TODAS sobre el rango [inicio, cierre].
# Volumen siempre en toneladas (qty_facturada con unidad KG / 1000).
# ---------------------------------------------------------------------------


def _kg_lines(df: pd.DataFrame) -> pd.DataFrame:
    """Devuelve solo las líneas medidas en KG (para cálculos de volumen)."""
    if "unidad_medida" in df.columns:
        return df[df["unidad_medida"].eq("KG")]
    return df


def _sales_kpis_range(data: Dict[str, pd.DataFrame], periods) -> dict:
    """KPIs del periodo: ingresos (€), toneladas facturadas (KG) y nº de
    clientes activos, agregados sobre todo el rango."""
    fact = data["facturacion"]
    f = fact[fact["periodo"].isin(list(periods))]
    ingresos = float(f["importe_neto_sinIVA"].sum())
    toneladas = float(_kg_lines(f)["qty_facturada"].sum()) / 1000.0
    clientes = int(f["cliente_id"].nunique())
    return {"ingresos": ingresos, "toneladas": toneladas, "clientes": clientes}


def _prod_kpis_range(data: Dict[str, pd.DataFrame], periods) -> dict:
    """KPIs de producción del periodo: toneladas producidas, toneladas
    facturadas (KG) y nº de productos producidos distintos, sobre el rango."""
    fact, prod = data["facturacion"], data["produccion"]
    p = prod[prod["periodo"].isin(list(periods))]
    f = fact[fact["periodo"].isin(list(periods))]
    toneladas_prod = float(_kg_lines(p)["qty_producida"].sum()) / 1000.0
    toneladas_fact = float(_kg_lines(f)["qty_facturada"].sum()) / 1000.0
    productos = int(p["item_id"].nunique())
    return {
        "toneladas_producidas": toneladas_prod,
        "toneladas_facturadas": toneladas_fact,
        "productos": productos,
    }


def _revenue_by_range(
    fact: pd.DataFrame, periods, col: str, label: str, top_n: int
) -> pd.DataFrame:
    """Top-N por ingresos (€) sobre todo el rango, agrupado por `col`."""
    sub = fact[fact["periodo"].isin(list(periods))]
    return (
        sub.groupby(col, as_index=False)["importe_neto_sinIVA"]
        .sum()
        .rename(columns={col: label, "importe_neto_sinIVA": "ingresos"})
        .sort_values("ingresos", ascending=False)
        .head(top_n)
        .reset_index(drop=True)
    )


def _margen_kpis_range(fact: pd.DataFrame, periods) -> dict:
    """KPIs de margen directo del rango (Página 4).

    El margen solo existe en líneas con receta costeada (margen_linea_orig no
    nulo). `margen_pct` se calcula sobre los ingresos de ESAS líneas (no se
    diluye con ventas sin coste); `cobertura_pct` dice qué % de los ingresos
    tiene coste calculado."""
    f = fact[fact["periodo"].isin(list(periods))]
    ingresos = float(f["importe_neto_sinIVA"].sum()) if not f.empty else 0.0
    if f.empty or "margen_linea_orig" not in f.columns:
        return {"ingresos": ingresos, "margen": None,
                "margen_pct": None, "cobertura_pct": None}
    m = f[f["margen_linea_orig"].notna()]
    if m.empty:
        return {"ingresos": ingresos, "margen": None,
                "margen_pct": None, "cobertura_pct": 0.0 if ingresos else None}
    ing_costeados = float(m["importe_neto_sinIVA"].sum())
    margen = float(m["margen_linea_orig"].sum())
    return {
        "ingresos": ingresos,
        "margen": margen,
        "margen_pct": (margen / ing_costeados * 100) if ing_costeados else None,
        "cobertura_pct": (ing_costeados / ingresos * 100) if ingresos else None,
    }


def _margen_by_range(
    fact: pd.DataFrame,
    periods,
    col: str,
    label: str,
    top_n: int | None = None,
    name_map: dict | None = None,
) -> pd.DataFrame:
    """Ingresos, % del total, margen directo y margen % por dimensión, sobre
    el rango. Mismo criterio de margen que `_margen_kpis_range`."""
    cols = [label, "ingresos", "pct_ingresos", "margen", "margen_pct"]
    if fact.empty or col not in fact.columns or "margen_linea_orig" not in fact.columns:
        return pd.DataFrame(columns=cols)
    f = fact[fact["periodo"].isin(list(periods))].copy()
    if f.empty:
        return pd.DataFrame(columns=cols)
    f["_grupo"] = f[col].fillna("Sin asignar").astype(str)
    if name_map:
        f["_grupo"] = f["_grupo"].map(lambda x: name_map.get(x, x))
    f["_ing_costeados"] = f["importe_neto_sinIVA"].where(
        f["margen_linea_orig"].notna(), 0.0
    )
    g = f.groupby("_grupo", as_index=False).agg(
        ingresos=("importe_neto_sinIVA", "sum"),
        margen=("margen_linea_orig", "sum"),
        _ing_costeados=("_ing_costeados", "sum"),
    )
    total = float(g["ingresos"].sum())
    g["pct_ingresos"] = (g["ingresos"] / total * 100) if total else 0.0
    g["margen_pct"] = g.apply(
        lambda r: (r["margen"] / r["_ing_costeados"] * 100)
        if r["_ing_costeados"] else None,
        axis=1,
    )
    g = (
        g.rename(columns={"_grupo": label})
        .sort_values("ingresos", ascending=False)
        .drop(columns=["_ing_costeados"])
    )
    if top_n:
        g = g.head(top_n)
    return g[cols].reset_index(drop=True)


def _margen_trend_range(fact: pd.DataFrame, periods) -> pd.DataFrame:
    """Margen directo y margen % por mes del rango. Long DataFrame:
    periodo(str 'YYYY-MM'), margen, margen_pct."""
    cols = ["periodo", "margen", "margen_pct"]
    if fact.empty or "margen_linea_orig" not in fact.columns:
        return pd.DataFrame(columns=cols)
    f = fact[fact["periodo"].isin(list(periods))].copy()
    if f.empty:
        return pd.DataFrame(columns=cols)
    f["_ing_costeados"] = f["importe_neto_sinIVA"].where(
        f["margen_linea_orig"].notna(), 0.0
    )
    g = f.groupby("periodo", as_index=False).agg(
        margen=("margen_linea_orig", "sum"),
        _ing=("_ing_costeados", "sum"),
    )
    g["margen_pct"] = g.apply(
        lambda r: (r["margen"] / r["_ing"] * 100) if r["_ing"] else None, axis=1
    )
    g["periodo"] = g["periodo"].astype(str)
    return g.sort_values("periodo")[cols].reset_index(drop=True)


_REGION_SIN_ASIGNAR = {"": "Sin región", "NONE": "Sin región", "-": "Sin región"}


def _revenue_by_region_range(
    fact: pd.DataFrame, periods, top_n: int = 12
) -> pd.DataFrame:
    """Ingresos y toneladas por región del cliente sobre el rango; el resto
    de regiones se agrupa en 'Otras'. Solo BigQuery (Azure no trae region)."""
    cols = ["region", "ingresos", "toneladas"]
    if fact.empty or "region" not in fact.columns:
        return pd.DataFrame(columns=cols)
    f = fact[fact["periodo"].isin(list(periods))].copy()
    if f.empty:
        return pd.DataFrame(columns=cols)
    f["region"] = (
        f["region"].fillna("").astype(str).str.strip().replace(_REGION_SIN_ASIGNAR)
    )
    f["_t"] = pd.to_numeric(f["qty_facturada"], errors="coerce").fillna(0.0) / 1000.0
    g = f.groupby("region", as_index=False).agg(
        ingresos=("importe_neto_sinIVA", "sum"), toneladas=("_t", "sum")
    )
    g = g.sort_values("ingresos", ascending=False)
    if len(g) > top_n:
        resto = g.iloc[top_n:]
        g = pd.concat(
            [
                g.head(top_n),
                pd.DataFrame(
                    [{
                        "region": "Otras",
                        "ingresos": float(resto["ingresos"].sum()),
                        "toneladas": float(resto["toneladas"].sum()),
                    }]
                ),
            ],
            ignore_index=True,
        )
    return g.reset_index(drop=True)


def _region_family_matrix(
    fact: pd.DataFrame, periods, top_regions: int = 10, top_familias: int = 8
) -> pd.DataFrame:
    """Matriz región × familia (ingresos €) sobre el rango. Filas y columnas
    fuera del top se agrupan en 'Otras'; incluye columna Total por región."""
    if fact.empty or "region" not in fact.columns:
        return pd.DataFrame()
    f = fact[fact["periodo"].isin(list(periods))].copy()
    if f.empty:
        return pd.DataFrame()
    f["region"] = (
        f["region"].fillna("").astype(str).str.strip().replace(_REGION_SIN_ASIGNAR)
    )
    f["familia"] = f["item_grupo_desc"].fillna("Sin asignar").astype(str)
    top_r = (
        f.groupby("region")["importe_neto_sinIVA"].sum()
        .sort_values(ascending=False).head(top_regions).index
    )
    top_f = (
        f.groupby("familia")["importe_neto_sinIVA"].sum()
        .sort_values(ascending=False).head(top_familias).index
    )
    f["region"] = f["region"].where(f["region"].isin(top_r), "Otras")
    f["familia"] = f["familia"].where(f["familia"].isin(top_f), "Otras")
    pv = f.pivot_table(
        index="region", columns="familia", values="importe_neto_sinIVA",
        aggfunc="sum", fill_value=0.0,
    )
    pv["Total"] = pv.sum(axis=1)
    pv = pv.sort_values("Total", ascending=False)
    col_order = (
        list(pv.drop(columns=["Total"]).sum().sort_values(ascending=False).index)
        + ["Total"]
    )
    pv = pv[col_order]
    pv.columns.name = None
    return pv.reset_index()


def _volume_by_month_dim(
    fact: pd.DataFrame,
    periods,
    dim_col: str,
    top_n: int = 4,
    name_map: dict | None = None,
    qty_col: str = "qty_facturada",
) -> pd.DataFrame:
    """Toneladas facturadas (KG) por mes y por dimensión (`dim_col`), quedándose
    con las `top_n` mayores por volumen total del rango y agrupando el resto en
    'Otros'. Long DataFrame: periodo(str 'YYYY-MM'), grupo, toneladas."""
    f = _kg_lines(fact[fact["periodo"].isin(list(periods))]).copy()
    if f.empty:
        return pd.DataFrame(columns=["periodo", "grupo", "toneladas"])
    f["grupo"] = f[dim_col].fillna("Sin asignar").astype(str)
    if name_map:
        f["grupo"] = f["grupo"].map(lambda x: name_map.get(x, x))
    f["toneladas"] = f[qty_col] / 1000.0
    totals = f.groupby("grupo")["toneladas"].sum().sort_values(ascending=False)
    top = set(totals.head(top_n).index)
    f["grupo"] = f["grupo"].where(f["grupo"].isin(top), "Otros")
    g = f.groupby(["periodo", "grupo"], as_index=False)["toneladas"].sum()
    g["periodo"] = g["periodo"].astype(str)
    return g


def _top_products_by_month_tons(
    fact: pd.DataFrame, periods, top_n: int = 10
) -> pd.DataFrame:
    """Top-N productos por toneladas (KG) del rango, desglosado por mes.
    Long DataFrame: producto, periodo(str), toneladas."""
    f = _kg_lines(fact[fact["periodo"].isin(list(periods))]).copy()
    if f.empty:
        return pd.DataFrame(columns=["producto", "periodo", "toneladas"])
    f["toneladas"] = f["qty_facturada"] / 1000.0
    totals = f.groupby("item_desc")["toneladas"].sum().sort_values(ascending=False)
    top = list(totals.head(top_n).index)
    f = f[f["item_desc"].isin(top)]
    g = (
        f.groupby(["item_desc", "periodo"], as_index=False)["toneladas"]
        .sum()
        .rename(columns={"item_desc": "producto"})
    )
    g["periodo"] = g["periodo"].astype(str)
    return g


def _top_products_by_month(
    fact: pd.DataFrame,
    periods,
    top_n: int = 5,
    include_otros: bool = False,
    qty_col: str = "qty_facturada",
) -> pd.DataFrame:
    """Top-N productos POR MES (toneladas KG). El ranking se recalcula en cada
    mes: un producto aparece (con color propio) en los meses en que está en el
    top-N y desaparece en los que no.

    `include_otros=True` añade una barra 'Otros' con la cola de cada mes; por
    defecto NO se incluye porque en estos datos la cola es enorme y 'Otros'
    aplasta la escala del gráfico. Mismo formato long que `_volume_by_month_dim`
    (periodo, grupo, toneladas) para reutilizar el render de barras agrupadas."""
    f = _kg_lines(fact[fact["periodo"].isin(list(periods))]).copy()
    if f.empty:
        return pd.DataFrame(columns=["periodo", "grupo", "toneladas"])
    f["toneladas"] = f[qty_col] / 1000.0
    g = f.groupby(["periodo", "item_desc"], as_index=False)["toneladas"].sum()
    g["rank"] = g.groupby("periodo")["toneladas"].rank(method="first", ascending=False)
    if include_otros:
        g["grupo"] = g["item_desc"].where(g["rank"] <= top_n, "Otros")
        out = g.groupby(["periodo", "grupo"], as_index=False)["toneladas"].sum()
    else:
        out = (
            g[g["rank"] <= top_n]
            .rename(columns={"item_desc": "grupo"})[["periodo", "grupo", "toneladas"]]
            .copy()
        )
    out["periodo"] = out["periodo"].astype(str)
    return out


def _prod_vs_fact_by_month_tons(data: Dict[str, pd.DataFrame], periods) -> pd.DataFrame:
    """Toneladas producidas vs facturadas (KG) por mes del rango.
    DataFrame: periodo(str), producido_t, facturado_t."""
    periods = list(periods)
    fact, prod = data["facturacion"], data["produccion"]
    fac = _kg_lines(fact[fact["periodo"].isin(periods)]).groupby("periodo")[
        "qty_facturada"
    ].sum().div(1000.0)
    pro = _kg_lines(prod[prod["periodo"].isin(periods)]).groupby("periodo")[
        "qty_producida"
    ].sum().div(1000.0)
    rows = [
        {
            "periodo": str(p),
            "producido_t": float(pro.get(p, 0.0)),
            "facturado_t": float(fac.get(p, 0.0)),
        }
        for p in periods
    ]
    return pd.DataFrame(rows)


def _clients_by_month_eur(
    fact: pd.DataFrame, periods, top_n: int = 15
) -> pd.DataFrame:
    """Ingresos (€) por cliente y mes del rango (top-N clientes por total).
    DataFrame: cliente + una columna por mes ('YYYY-MM') + 'Total'."""
    periods = list(periods)
    f = fact[fact["periodo"].isin(periods)].copy()
    if f.empty:
        return pd.DataFrame()
    f["cliente"] = f["cliente_nombre"].fillna(f["cliente_id"].astype(str))
    totals = f.groupby("cliente")["importe_neto_sinIVA"].sum().sort_values(
        ascending=False
    )
    top = list(totals.head(top_n).index)
    f = f[f["cliente"].isin(top)]
    piv = f.pivot_table(
        index="cliente",
        columns="periodo",
        values="importe_neto_sinIVA",
        aggfunc="sum",
        fill_value=0.0,
    )
    piv = piv.reindex(columns=sorted(piv.columns))
    piv.columns = [str(c) for c in piv.columns]
    piv["Total"] = piv.sum(axis=1)
    piv = piv.sort_values("Total", ascending=False).reset_index()
    return piv


# ---------------------------------------------------------------------------
# GOLD (14-jul-2026): Página 4 (Ventas y Margen) + apoyo a Página 5 (Región).
# Reemplazan a las funciones de arriba (que agregaban en pandas sobre la
# tabla `fact` línea a línea) leyendo ya agregado por (mes, dimensión) desde
# las tablas RENTABILIDAD_GOLD_* — ver
# ConsultasBigQuery/gold/report/ventas_margen_gold.sql. Todas respetan los
# mismos filtros (familia, canal, partes relacionadas) que hoy, vía
# `_gold_ventas_where`. Solo se usan cuando BACKEND == "bigquery" (ver
# `build_report_context`); Azure/Nutrex sigue con las funciones de arriba.
# ---------------------------------------------------------------------------


def _periodo_str(anio, mes) -> str:
    return f"{int(anio):04d}-{int(mes):02d}"


def _sales_kpis_bigquery(
    start_yyyymm: Optional[int],
    end_yyyymm: Optional[int],
    familia: Optional[str] = None,
    canal: Optional[str] = None,
    incluir_partes_relacionadas: bool = False,
) -> dict:
    """KPIs del rango (Página 4): ingresos/toneladas desde
    RENTABILIDAD_GOLD_MARGEN_MENSUAL (sumandos ya agregados). `clientes`
    (nº de clientes distintos) NO es sumable desde el gold — un mismo
    cliente puede repetirse en varias filas (mes/familia/canal) — así que se
    resuelve con un COUNT(DISTINCT) en vivo sobre la tabla silver (sigue
    siendo BigQuery, no pandas: solo una query dirigida, no cargar líneas)."""
    where_gold = _gold_ventas_where(start_yyyymm, end_yyyymm, familia, canal, incluir_partes_relacionadas)
    row = read_sql(
        f"SELECT SUM(ingresos_mxn) AS ingresos, SUM(toneladas) AS toneladas "
        f"FROM {_BQ_GOLD_MARGEN_MENSUAL} WHERE {where_gold}"
    ).iloc[0]
    ingresos = float(row["ingresos"]) if pd.notna(row["ingresos"]) else 0.0
    toneladas = float(row["toneladas"]) if pd.notna(row["toneladas"]) else 0.0

    where_silver = _silver_ventas_where(start_yyyymm, end_yyyymm, familia, canal, incluir_partes_relacionadas)
    clientes_row = read_sql(
        f"SELECT COUNT(DISTINCT customer_number) AS clientes FROM {_BQ_TABLE} WHERE {where_silver}"
    ).iloc[0]
    clientes = int(clientes_row["clientes"]) if pd.notna(clientes_row["clientes"]) else 0
    return {"ingresos": ingresos, "toneladas": toneladas, "clientes": clientes}


def _margen_kpis_bigquery(
    start_yyyymm: Optional[int],
    end_yyyymm: Optional[int],
    familia: Optional[str] = None,
    canal: Optional[str] = None,
    incluir_partes_relacionadas: bool = False,
) -> dict:
    """KPIs de margen directo (Página 4) desde RENTABILIDAD_GOLD_MARGEN_MENSUAL.
    Mismo criterio que `_margen_kpis_range`: margen_pct sobre ingresos
    costeados (no se diluye con ventas sin receta costeada)."""
    where = _gold_ventas_where(start_yyyymm, end_yyyymm, familia, canal, incluir_partes_relacionadas)
    row = read_sql(
        f"SELECT SUM(ingresos_mxn) AS ingresos, SUM(ing_costeados_mxn) AS ing_costeados, "
        f"SUM(margen_mxn) AS margen FROM {_BQ_GOLD_MARGEN_MENSUAL} WHERE {where}"
    ).iloc[0]
    if pd.isna(row["ingresos"]):
        return {"ingresos": 0.0, "margen": None, "margen_pct": None, "cobertura_pct": None}
    ingresos = float(row["ingresos"])
    ing_costeados = float(row["ing_costeados"]) if pd.notna(row["ing_costeados"]) else 0.0
    margen = float(row["margen"]) if pd.notna(row["margen"]) else None
    return {
        "ingresos": ingresos,
        "margen": margen,
        "margen_pct": (margen / ing_costeados * 100) if margen is not None and ing_costeados else None,
        "cobertura_pct": (ing_costeados / ingresos * 100) if ingresos else None,
    }


def _margen_by_bigquery(
    dim: str,
    start_yyyymm: Optional[int],
    end_yyyymm: Optional[int],
    label: str,
    familia: Optional[str] = None,
    canal: Optional[str] = None,
    incluir_partes_relacionadas: bool = False,
    top_n: int | None = None,
    name_map: dict | None = None,
) -> pd.DataFrame:
    """Ingresos, % del total, margen directo y margen % por dimensión
    (`dim` = "familia" | "canal" | "producto"), sobre el rango. `familia`/
    `canal` desde RENTABILIDAD_GOLD_MARGEN_MENSUAL; `producto` desde
    RENTABILIDAD_GOLD_MARGEN_PRODUCTO_MENSUAL. Mismo criterio que
    `_margen_by_range`."""
    cols = [label, "ingresos", "pct_ingresos", "margen", "margen_pct"]
    where = _gold_ventas_where(start_yyyymm, end_yyyymm, familia, canal, incluir_partes_relacionadas)
    if dim == "producto":
        table, group_col = _BQ_GOLD_MARGEN_PRODUCTO_MENSUAL, "material_name"
    else:
        table, group_col = _BQ_GOLD_MARGEN_MENSUAL, dim
    df = read_sql(
        f"SELECT {group_col} AS grupo, SUM(ingresos_mxn) AS ingresos, "
        f"SUM(ing_costeados_mxn) AS ing_costeados, SUM(margen_mxn) AS margen "
        f"FROM {table} WHERE {where} GROUP BY grupo"
    )
    if df.empty:
        return pd.DataFrame(columns=cols)
    # Igual que en pandas: sumar por grupo puede dejar `margen` NULL (SQL) si
    # NINGUNA fila del grupo tiene coste — pandas .sum() en ese caso da 0.0,
    # no NaN, así que se replica aquí para no cambiar el comportamiento.
    df["margen"] = df["margen"].fillna(0.0)
    if name_map:
        df["grupo"] = df["grupo"].map(lambda x: name_map.get(x, x))
        df = df.groupby("grupo", as_index=False).agg(
            ingresos=("ingresos", "sum"),
            ing_costeados=("ing_costeados", "sum"),
            margen=("margen", "sum"),
        )
    total = float(df["ingresos"].sum())
    df["pct_ingresos"] = (df["ingresos"] / total * 100) if total else 0.0
    df["margen_pct"] = df.apply(
        lambda r: (r["margen"] / r["ing_costeados"] * 100) if r["ing_costeados"] else None,
        axis=1,
    )
    df = df.rename(columns={"grupo": label}).sort_values("ingresos", ascending=False)
    if top_n:
        df = df.head(top_n)
    return df[cols].reset_index(drop=True)


def _margen_trend_bigquery(
    start_yyyymm: Optional[int],
    end_yyyymm: Optional[int],
    familia: Optional[str] = None,
    canal: Optional[str] = None,
    incluir_partes_relacionadas: bool = False,
) -> pd.DataFrame:
    """Margen directo y margen % por mes del rango, desde
    RENTABILIDAD_GOLD_MARGEN_MENSUAL. Long DataFrame: periodo('YYYY-MM'),
    margen, margen_pct."""
    cols = ["periodo", "margen", "margen_pct"]
    where = _gold_ventas_where(start_yyyymm, end_yyyymm, familia, canal, incluir_partes_relacionadas)
    df = read_sql(
        f"SELECT anio, mes, SUM(ing_costeados_mxn) AS ing_costeados, SUM(margen_mxn) AS margen "
        f"FROM {_BQ_GOLD_MARGEN_MENSUAL} WHERE {where} GROUP BY anio, mes ORDER BY anio, mes"
    )
    if df.empty:
        return pd.DataFrame(columns=cols)
    df["margen"] = df["margen"].fillna(0.0)  # ver nota en _margen_by_bigquery
    df["periodo"] = df.apply(lambda r: _periodo_str(r["anio"], r["mes"]), axis=1)
    df["margen_pct"] = df.apply(
        lambda r: (r["margen"] / r["ing_costeados"] * 100) if r["ing_costeados"] else None, axis=1
    )
    return df[cols].reset_index(drop=True)


def _revenue_by_region_bigquery(
    start_yyyymm: Optional[int],
    end_yyyymm: Optional[int],
    familia: Optional[str] = None,
    canal: Optional[str] = None,
    incluir_partes_relacionadas: bool = False,
    top_n: int = 12,
) -> pd.DataFrame:
    """Ingresos y toneladas por región sobre el rango, desde
    RENTABILIDAD_GOLD_REGION_FAMILIA_MENSUAL (colapsando familia). El resto
    de regiones se agrupa en 'Otras'. Mismo criterio que
    `_revenue_by_region_range`."""
    cols = ["region", "ingresos", "toneladas"]
    where = _gold_ventas_where(start_yyyymm, end_yyyymm, familia, canal, incluir_partes_relacionadas)
    df = read_sql(
        f"SELECT region, SUM(ingresos_mxn) AS ingresos, SUM(toneladas) AS toneladas "
        f"FROM {_BQ_GOLD_REGION_FAMILIA_MENSUAL} WHERE {where} GROUP BY region"
    )
    if df.empty:
        return pd.DataFrame(columns=cols)
    df = df.sort_values("ingresos", ascending=False)
    if len(df) > top_n:
        resto = df.iloc[top_n:]
        df = pd.concat(
            [
                df.head(top_n),
                pd.DataFrame(
                    [{
                        "region": "Otras",
                        "ingresos": float(resto["ingresos"].sum()),
                        "toneladas": float(resto["toneladas"].sum()),
                    }]
                ),
            ],
            ignore_index=True,
        )
    return df.reset_index(drop=True)


def _region_family_matrix_bigquery(
    start_yyyymm: Optional[int],
    end_yyyymm: Optional[int],
    familia: Optional[str] = None,
    canal: Optional[str] = None,
    incluir_partes_relacionadas: bool = False,
    top_regions: int = 10,
    top_familias: int = 8,
) -> pd.DataFrame:
    """Matriz región × familia (ingresos €) sobre el rango, desde
    RENTABILIDAD_GOLD_REGION_FAMILIA_MENSUAL (colapsando mes y canal). Filas
    y columnas fuera del top se agrupan en 'Otras'; incluye columna Total.
    Mismo criterio que `_region_family_matrix`."""
    where = _gold_ventas_where(start_yyyymm, end_yyyymm, familia, canal, incluir_partes_relacionadas)
    df = read_sql(
        f"SELECT region, familia, SUM(ingresos_mxn) AS ingresos "
        f"FROM {_BQ_GOLD_REGION_FAMILIA_MENSUAL} WHERE {where} GROUP BY region, familia"
    )
    if df.empty:
        return pd.DataFrame()
    top_r = (
        df.groupby("region")["ingresos"].sum().sort_values(ascending=False).head(top_regions).index
    )
    top_f = (
        df.groupby("familia")["ingresos"].sum().sort_values(ascending=False).head(top_familias).index
    )
    df["region"] = df["region"].where(df["region"].isin(top_r), "Otras")
    df["familia"] = df["familia"].where(df["familia"].isin(top_f), "Otras")
    pv = df.pivot_table(
        index="region", columns="familia", values="ingresos", aggfunc="sum", fill_value=0.0
    )
    pv["Total"] = pv.sum(axis=1)
    pv = pv.sort_values("Total", ascending=False)
    col_order = (
        list(pv.drop(columns=["Total"]).sum().sort_values(ascending=False).index) + ["Total"]
    )
    pv = pv[col_order]
    pv.columns.name = None
    return pv.reset_index()


def _top_products_by_month_bigquery(
    start_yyyymm: Optional[int],
    end_yyyymm: Optional[int],
    familia: Optional[str] = None,
    canal: Optional[str] = None,
    incluir_partes_relacionadas: bool = False,
    top_n: int = 5,
) -> pd.DataFrame:
    """Top-N productos POR MES (toneladas), rankeado en BigQuery sobre
    RENTABILIDAD_GOLD_MARGEN_PRODUCTO_MENSUAL — el ranking se recalcula cada
    mes, igual que `_top_products_by_month` (no se usa la tabla
    RENTABILIDAD_GOLD_TOP_PRODUCTOS_MES aquí porque esa no tiene columnas
    familia/canal y no podría respetar esos filtros si están activos; esta
    consulta sí, agregando primero por mes/producto y rankeando después)."""
    cols = ["periodo", "grupo", "toneladas"]
    where = _gold_ventas_where(start_yyyymm, end_yyyymm, familia, canal, incluir_partes_relacionadas)
    df = read_sql(f"""
        WITH agregado AS (
          SELECT anio, mes, material_name, SUM(toneladas) AS toneladas
          FROM {_BQ_GOLD_MARGEN_PRODUCTO_MENSUAL}
          WHERE {where}
          GROUP BY anio, mes, material_name
        ),
        rankeado AS (
          SELECT anio, mes, material_name, toneladas,
                 ROW_NUMBER() OVER (
                   PARTITION BY anio, mes ORDER BY toneladas DESC, material_name
                 ) AS rn
          FROM agregado
        )
        SELECT anio, mes, material_name AS grupo, toneladas
        FROM rankeado WHERE rn <= {top_n}
        ORDER BY anio, mes, rn
    """)
    if df.empty:
        return pd.DataFrame(columns=cols)
    df["periodo"] = df.apply(lambda r: _periodo_str(r["anio"], r["mes"]), axis=1)
    return df[cols].reset_index(drop=True)


def _volume_by_month_dim_bigquery(
    dim_col: str,
    start_yyyymm: Optional[int],
    end_yyyymm: Optional[int],
    familia: Optional[str] = None,
    canal: Optional[str] = None,
    incluir_partes_relacionadas: bool = False,
    top_n: int = 4,
    name_map: dict | None = None,
) -> pd.DataFrame:
    """Toneladas por mes y por dimensión (`dim_col` = "familia" | "canal"),
    desde RENTABILIDAD_GOLD_MARGEN_MENSUAL, quedándose con los `top_n` de
    mayor volumen TOTAL del rango (no por mes) y agrupando el resto en
    'Otros'. Mismo criterio que `_volume_by_month_dim`."""
    cols = ["periodo", "grupo", "toneladas"]
    where = _gold_ventas_where(start_yyyymm, end_yyyymm, familia, canal, incluir_partes_relacionadas)
    df = read_sql(
        f"SELECT anio, mes, {dim_col} AS grupo, SUM(toneladas) AS toneladas "
        f"FROM {_BQ_GOLD_MARGEN_MENSUAL} WHERE {where} GROUP BY anio, mes, grupo"
    )
    if df.empty:
        return pd.DataFrame(columns=cols)
    if name_map:
        df["grupo"] = df["grupo"].map(lambda x: name_map.get(x, x))
    totals = df.groupby("grupo")["toneladas"].sum().sort_values(ascending=False)
    top = set(totals.head(top_n).index)
    df["grupo"] = df["grupo"].where(df["grupo"].isin(top), "Otros")
    g = df.groupby(["anio", "mes", "grupo"], as_index=False)["toneladas"].sum()
    g["periodo"] = g.apply(lambda r: _periodo_str(r["anio"], r["mes"]), axis=1)
    return g[cols].reset_index(drop=True)


def _prod_vs_fact_by_month_bigquery(
    start_yyyymm: Optional[int],
    end_yyyymm: Optional[int],
    familia: Optional[str] = None,
    canal: Optional[str] = None,
    incluir_partes_relacionadas: bool = False,
) -> pd.DataFrame:
    """Toneladas facturadas por mes del rango, desde
    RENTABILIDAD_GOLD_MARGEN_MENSUAL. `producido_t` siempre 0.0: la tabla de
    producción es un placeholder vacío en este backend (BigQuery/Maka no
    trae producción propia por esta vía) — mismo comportamiento que hoy
    tiene `_prod_vs_fact_by_month_tons` con `data["produccion"]` vacío.
    Incluye una fila por cada mes del rango aunque no haya ventas ese mes
    (igual que la versión en pandas)."""
    where = _gold_ventas_where(start_yyyymm, end_yyyymm, familia, canal, incluir_partes_relacionadas)
    df = read_sql(
        f"SELECT anio, mes, SUM(toneladas) AS facturado_t FROM {_BQ_GOLD_MARGEN_MENSUAL} "
        f"WHERE {where} GROUP BY anio, mes"
    )
    if not start_yyyymm or not end_yyyymm:
        if df.empty:
            return pd.DataFrame(columns=["periodo", "producido_t", "facturado_t"])
        df["periodo"] = df.apply(lambda r: _periodo_str(r["anio"], r["mes"]), axis=1)
        df["producido_t"] = 0.0
        return df[["periodo", "producido_t", "facturado_t"]].sort_values("periodo").reset_index(drop=True)

    if not df.empty:
        df["periodo"] = df.apply(lambda r: _periodo_str(r["anio"], r["mes"]), axis=1)
    all_months: list[str] = []
    y, m = start_yyyymm // 100, start_yyyymm % 100
    ey, em = end_yyyymm // 100, end_yyyymm % 100
    while (y, m) <= (ey, em):
        all_months.append(_periodo_str(y, m))
        m += 1
        if m > 12:
            m, y = 1, y + 1
    result = pd.DataFrame({"periodo": all_months})
    if not df.empty:
        result = result.merge(df[["periodo", "facturado_t"]], on="periodo", how="left")
    else:
        result["facturado_t"] = None
    result["facturado_t"] = result["facturado_t"].fillna(0.0)
    result["producido_t"] = 0.0
    return result[["periodo", "producido_t", "facturado_t"]]


def _clients_by_month_bigquery(
    start_yyyymm: Optional[int],
    end_yyyymm: Optional[int],
    incluir_partes_relacionadas: bool = False,
    top_n: int = 15,
) -> pd.DataFrame:
    """Ingresos (€) por cliente y mes del rango (top-N clientes por total),
    desde RENTABILIDAD_GOLD_CLIENTES_MES. Mismo shape que
    `_clients_by_month_eur` (cliente + una columna por mes + Total). El Δ%
    mes a mes que ya calcula esta tabla gold (LAG()) NO se conecta todavía
    aquí — el pivot es ancho (una columna por mes) y no hay un hueco natural
    para una columna de variación sin antes decidir con Pablo cómo mostrarla
    (¿una columna Δ% por mes, o solo el último? Pendiente, no bloquea este
    swap del resto de la tabla)."""
    ingresos_col = "ingresos_con_relacionadas" if incluir_partes_relacionadas else "ingresos_sin_relacionadas"
    cond = (
        f"(anio * 100 + mes) BETWEEN {start_yyyymm} AND {end_yyyymm}"
        if start_yyyymm and end_yyyymm else "1=1"
    )
    df = read_sql(
        f"SELECT anio, mes, cliente_id, cliente_nombre, {ingresos_col} AS ingresos "
        f"FROM {_BQ_GOLD_CLIENTES_MES} WHERE {cond}"
    )
    if df.empty:
        return pd.DataFrame()
    df["periodo"] = df.apply(lambda r: _periodo_str(r["anio"], r["mes"]), axis=1)
    totals = df.groupby("cliente_id")["ingresos"].sum().sort_values(ascending=False)
    top_ids = set(totals.head(top_n).index)
    df = df[df["cliente_id"].isin(top_ids)]
    piv = df.pivot_table(
        index="cliente_nombre", columns="periodo", values="ingresos", aggfunc="sum", fill_value=0.0
    )
    piv = piv.reindex(columns=sorted(piv.columns))
    piv.columns = [str(c) for c in piv.columns]
    piv["Total"] = piv.sum(axis=1)
    piv = piv.sort_values("Total", ascending=False).reset_index().rename(columns={"cliente_nombre": "cliente"})
    return piv


def _revenue_by_clients_bigquery(
    start_yyyymm: Optional[int],
    end_yyyymm: Optional[int],
    incluir_partes_relacionadas: bool = False,
    top_n: int = 10,
) -> pd.DataFrame:
    """Top-N clientes por ingresos (€) sobre el rango, desde
    RENTABILIDAD_GOLD_CLIENTES_MES. Mismo shape que
    `_revenue_by_range(..., "cliente_nombre", "cliente", top_n)`."""
    ingresos_col = "ingresos_con_relacionadas" if incluir_partes_relacionadas else "ingresos_sin_relacionadas"
    cond = (
        f"(anio * 100 + mes) BETWEEN {start_yyyymm} AND {end_yyyymm}"
        if start_yyyymm and end_yyyymm else "1=1"
    )
    df = read_sql(
        f"SELECT cliente_nombre AS cliente, SUM({ingresos_col}) AS ingresos "
        f"FROM {_BQ_GOLD_CLIENTES_MES} WHERE {cond} "
        f"GROUP BY cliente_nombre ORDER BY ingresos DESC LIMIT {top_n}"
    )
    return df.reset_index(drop=True)


def build_report_context(
    cfg: ReportConfig | None = None,
    start_period: str | None = None,
    end_period: str | None = None,
    sociedad: str | None = None,  # Solo Azure SQL (Nutrex). Ignorado en BigQuery.
    view_mode: str = "pg",
    familia: str | None = None,
    canal: str | None = None,
    linea_negocio: str | None = None,  # Solo BigQuery (Maka). GSBER.
    planta: str | None = None,          # Solo BigQuery (Maka). WERKS.
    incluir_partes_relacionadas: bool = False,  # Solo BigQuery (Maka).
    sections: list[str] | tuple[str, ...] | None = None,
) -> dict:
    """Build full context for the report page UI.

    El filtro es un RANGO dentro de un año: ``start_period`` (mes de inicio) y
    ``end_period`` (mes de cierre), ambos 'YYYY-MM'. El mes de cierre actúa como
    mes objetivo para KPIs y vistas de un solo mes; el P&G se devuelve además en
    formato multi-columna (un mes por columna + YTD) para el rango completo.

    ``sections``: carga parcial por pestaña (ver REPORT_SECTIONS). None o vacío
    → reporte completo. Nombres desconocidos se ignoran (fail-open).
    """
    cfg = cfg or ReportConfig()
    safe_view_mode = view_mode if view_mode in REPORT_VIEW_MODES else "pg"
    requested = {s for s in (sections or ()) if s in REPORT_SECTIONS} or None

    def _want(section: str) -> bool:
        return requested is None or section in requested

    # Paso 1: catálogo ligero para resolver sociedad y rango (sin cargar datos)
    catalog = get_catalog_minimal()
    catalog_meses = catalog["meses"]
    catalog_sociedades = catalog["sociedades"]
    global_latest = pd.Period(catalog["ultimo_mes"], freq="M") if catalog["ultimo_mes"] else None

    selected_sociedad = _resolve_sociedad(catalog_sociedades, sociedad)

    # Resolver rango: cierre = end_period (o último disponible); inicio =
    # start_period (o enero del mismo año del cierre).
    end = _resolve_target_period(catalog_meses, global_latest, end_period)
    if start_period:
        start = pd.Period(start_period, freq="M")
    else:
        start = pd.Period(f"{end.year}-01", freq="M")
    if start > end:
        start, end = end, start
    range_periods = list(pd.period_range(start, end, freq="M"))
    target = end  # mes de cierre
    range_start_yyyymm = start.year * 100 + start.month
    range_end_yyyymm = end.year * 100 + end.month

    # Paso 2: cargar solo los datos necesarios con filtros en SQL.
    # Buffer de 1 mes antes del inicio para poder calcular deltas MoM en KPIs.
    buf_start = start - 1
    start_yyyymm = buf_start.year * 100 + buf_start.month
    end_yyyymm   = end.year * 100 + end.month
    data_soc = load_data(
        sociedad=selected_sociedad,
        start_yyyymm=start_yyyymm,
        end_yyyymm=end_yyyymm,
        familia=familia,
        canal=canal,
        linea_negocio=linea_negocio,
        planta=planta,
        incluir_partes_relacionadas=incluir_partes_relacionadas,
        include_counterparties=_want("clients_geo"),
    )

    bal = data_soc["balance"]
    fact_soc = data_soc["facturacion"]
    range_strs = {str(p) for p in range_periods}

    if BACKEND == "bigquery":
        # GOLD (14-jul-2026): todas estas queries son independientes entre sí
        # (cada una alimenta una página distinta del informe, ya agregada en
        # su propia tabla gold) — se lanzan en paralelo con hilos en vez de
        # una detrás de otra para no pagar la latencia de red de ~18 queries
        # secuenciales en cada carga. Ver `_run_parallel` (arriba del todo).
        _args = (range_start_yyyymm, range_end_yyyymm, familia, canal, incluir_partes_relacionadas)

        def _solvencia() -> pd.DataFrame:
            try:
                return _load_solvencia_bigquery(range_start_yyyymm, range_end_yyyymm)
            except Exception:
                return pd.DataFrame()

        def _flujo() -> pd.DataFrame:
            try:
                return _load_flujo_bigquery(range_start_yyyymm, range_end_yyyymm)
            except Exception:
                return pd.DataFrame()

        all_tasks = {
            "pyg_range": lambda: _pyg_summary_range_bigquery(
                range_start_yyyymm, range_end_yyyymm, linea_negocio, planta
            ),
            "tons_by_period": lambda: _tons_by_month_bigquery(
                range_start_yyyymm, range_end_yyyymm, familia, canal, incluir_partes_relacionadas
            ),
            "solvencia": _solvencia,
            "flujo": _flujo,
            "sales_kpis": lambda: _sales_kpis_bigquery(*_args),
            "vol_by_family_month": lambda: _volume_by_month_dim_bigquery("familia", *_args, top_n=4),
            "vol_by_categoria_month": lambda: _volume_by_month_dim_bigquery(
                "canal", *_args, top_n=4, name_map=_CATEGORIA_MAPPING
            ),
            "sales_revenue_by_family": lambda: _margen_by_bigquery(
                "familia", range_start_yyyymm, range_end_yyyymm, "familia",
                familia=familia, canal=canal, incluir_partes_relacionadas=incluir_partes_relacionadas,
                top_n=cfg.top_n,
            )[["familia", "ingresos"]].reset_index(drop=True),
            "sales_top_clients": lambda: _revenue_by_clients_bigquery(
                range_start_yyyymm, range_end_yyyymm, incluir_partes_relacionadas, top_n=cfg.top_n
            ),
            "top_products_month": lambda: _top_products_by_month_bigquery(*_args, top_n=5),
            "prod_vs_fact_month": lambda: _prod_vs_fact_by_month_bigquery(*_args),
            "clients_by_month": lambda: _clients_by_month_bigquery(
                range_start_yyyymm, range_end_yyyymm, incluir_partes_relacionadas, top_n=15
            ),
            "margen_kpis": lambda: _margen_kpis_bigquery(*_args),
            "margen_by_family": lambda: _margen_by_bigquery(
                "familia", range_start_yyyymm, range_end_yyyymm, "familia",
                familia=familia, canal=canal, incluir_partes_relacionadas=incluir_partes_relacionadas,
            ),
            "margen_by_product": lambda: _margen_by_bigquery(
                "producto", range_start_yyyymm, range_end_yyyymm, "producto",
                familia=familia, canal=canal, incluir_partes_relacionadas=incluir_partes_relacionadas,
                top_n=cfg.top_n,
            ),
            "margen_by_canal": lambda: _margen_by_bigquery(
                "canal", range_start_yyyymm, range_end_yyyymm, "canal",
                familia=familia, canal=canal, incluir_partes_relacionadas=incluir_partes_relacionadas,
                name_map=_CATEGORIA_MAPPING,
            ),
            "margen_trend": lambda: _margen_trend_bigquery(*_args),
            "sales_by_region": lambda: _revenue_by_region_bigquery(*_args),
            "region_family_matrix": lambda: _region_family_matrix_bigquery(*_args),
            "revenue_trend": lambda: _revenue_trend_bigquery(
                range_start_yyyymm, range_end_yyyymm, familia, canal, incluir_partes_relacionadas
            ),
        }
        results = _run_parallel(
            {k: fn for k, fn in all_tasks.items() if _want(_TASK_SECTION[k])}
        )

        if "pyg_range" in results:
            pyg_range_df, pyg_month_cols = results["pyg_range"]
            pyg_eur_ton_df, _, tons_by_col = _pyg_eur_ton_from_range_bigquery(
                pyg_range_df, pyg_month_cols, range_periods, results["tons_by_period"]
            )
        else:
            pyg_range_df, pyg_month_cols = pd.DataFrame(), []
            pyg_eur_ton_df, tons_by_col = pd.DataFrame(), {}
        solvencia_df = results.get("solvencia", pd.DataFrame())
        flujo_df = results.get("flujo", pd.DataFrame())
        sales_kpis = results.get("sales_kpis", {})
        vol_by_family_month = results.get("vol_by_family_month", pd.DataFrame())
        vol_by_categoria_month = results.get("vol_by_categoria_month", pd.DataFrame())
        sales_revenue_by_family = results.get("sales_revenue_by_family", pd.DataFrame())
        sales_top_clients = results.get("sales_top_clients", pd.DataFrame())
        top_products_month = results.get("top_products_month", pd.DataFrame())
        prod_vs_fact_month = results.get("prod_vs_fact_month", pd.DataFrame())
        clients_by_month = results.get("clients_by_month", pd.DataFrame())
        margen_kpis = results.get("margen_kpis", {})
        margen_by_family = results.get("margen_by_family", pd.DataFrame())
        margen_by_product = results.get("margen_by_product", pd.DataFrame())
        margen_by_canal = results.get("margen_by_canal", pd.DataFrame())
        margen_trend = results.get("margen_trend", pd.DataFrame())
        sales_by_region = results.get("sales_by_region", pd.DataFrame())
        region_family_matrix = results.get("region_family_matrix", pd.DataFrame())
        revenue_trend = results.get("revenue_trend", pd.DataFrame())
    else:
        pyg_range_df, pyg_month_cols = _pyg_summary_range(bal, range_periods)
        pyg_eur_ton_df, _, tons_by_col = _pyg_summary_eur_ton(
            bal, data_soc["facturacion"], range_periods
        )
        solvencia_df = pd.DataFrame()
        flujo_df = pd.DataFrame()
        sales_kpis = _sales_kpis_range(data_soc, range_periods)
        vol_by_family_month = _volume_by_month_dim(
            fact_soc, range_periods, "item_grupo_desc", top_n=4
        )
        vol_by_categoria_month = _volume_by_month_dim(
            fact_soc, range_periods, "categoria_articulo", top_n=4, name_map=_CATEGORIA_MAPPING
        )
        sales_revenue_by_family = _revenue_by_range(
            fact_soc, range_periods, "item_grupo_desc", "familia", cfg.top_n
        )
        sales_top_clients = _revenue_by_range(
            fact_soc, range_periods, "cliente_nombre", "cliente", cfg.top_n
        )
        top_products_month = _top_products_by_month(fact_soc, range_periods, top_n=5)
        prod_vs_fact_month = _prod_vs_fact_by_month_tons(data_soc, range_periods)
        clients_by_month = _clients_by_month_eur(fact_soc, range_periods, top_n=15)
        margen_kpis = _margen_kpis_range(fact_soc, range_periods)
        margen_by_family = _margen_by_range(
            fact_soc, range_periods, "item_grupo_desc", "familia"
        )
        margen_by_product = _margen_by_range(
            fact_soc, range_periods, "item_desc", "producto", top_n=cfg.top_n
        )
        margen_by_canal = _margen_by_range(
            fact_soc, range_periods, "categoria_articulo", "canal",
            name_map=_CATEGORIA_MAPPING,
        )
        margen_trend = _margen_trend_range(fact_soc, range_periods)
        sales_by_region = _revenue_by_region_range(fact_soc, range_periods)
        region_family_matrix = _region_family_matrix(fact_soc, range_periods)
        revenue_trend = _revenue_trend(data_soc["facturacion"])

    if not revenue_trend.empty:
        revenue_trend = revenue_trend[
            revenue_trend["periodo"].isin(range_strs)
        ].reset_index(drop=True)

    # --- Agregaciones de Analítica de Producción (sobre el rango, en toneladas) ---
    prod_soc = data_soc["produccion"]
    prod_kpis = _prod_kpis_range(data_soc, range_periods)
    prod_by_family_month = _volume_by_month_dim(
        prod_soc, range_periods, "item_grupo_desc", top_n=4, qty_col="qty_producida"
    )
    top_production_by_month = _top_products_by_month(
        prod_soc, range_periods, top_n=5, qty_col="qty_producida"
    )

    summary = {
        "periodo": str(target),
        "periodo_inicio": str(start),
        "periodo_cierre": str(end),
        "sociedad": selected_sociedad,
        "revenue_trend": revenue_trend,
        "pyg_range": pyg_range_df,
        "pyg_month_cols": pyg_month_cols,
        "pyg_eur_ton": pyg_eur_ton_df,
        "tons_by_col": tons_by_col,
        # Analítica de Ventas (sobre el rango)
        "sales_kpis": sales_kpis,
        "vol_by_family_month": vol_by_family_month,
        "vol_by_categoria_month": vol_by_categoria_month,
        "sales_revenue_by_family": sales_revenue_by_family,
        "sales_top_clients": sales_top_clients,
        "top_products_month": top_products_month,
        "prod_vs_fact_month": prod_vs_fact_month,
        "clients_by_month": clients_by_month,
        # Rentabilidad Comercial (Página 4) — margen directo sobre el rango
        "margen_kpis": margen_kpis,
        "margen_by_family": margen_by_family,
        "margen_by_product": margen_by_product,
        "margen_by_canal": margen_by_canal,
        "margen_trend": margen_trend,
        # Clientes y Geografía (Página 5)
        "sales_by_region": sales_by_region,
        "region_family_matrix": region_family_matrix,
        "acreedores": data_soc.get("acreedores", _empty_counterparty_df("acreedores")),
        "deudores": data_soc.get("deudores", _empty_counterparty_df("deudores")),
        "acreedores_trend": data_soc.get("acreedores_trend", _empty_counterparty_trend_df()),
        "deudores_trend": data_soc.get("deudores_trend", _empty_counterparty_trend_df()),
        # Rentabilidad y Solvencia (Página 2) — balance por mes + ratios
        "solvencia": solvencia_df,
        # Flujo de Recursos (Página 3) — variación de cada partida del balance
        "flujo": flujo_df,
        # Analítica de Producción (sobre el rango)
        "prod_kpis": prod_kpis,
        "prod_by_family_month": prod_by_family_month,
        "top_production_by_month": top_production_by_month,
    }

    if requested is not None:
        allowed = {"periodo", "periodo_inicio", "periodo_cierre", "sociedad"}
        for sec in requested:
            allowed |= _SECTION_SUMMARY_KEYS[sec]
        summary = {k: v for k, v in summary.items() if k in allowed}

    return {
        "catalog": {
            "meses": catalog_meses,
            "sociedades": catalog_sociedades,
            "ultimo_mes": str(global_latest or target),
        },
        "selected": {
            "sociedad": selected_sociedad,
            "anio": str(end.year),
            "mes_inicio": f"{start.month:02d}",
            "mes_cierre": f"{end.month:02d}",
            "start_period": str(start),
            "end_period": str(end),
        },
        "view_mode": safe_view_mode,
        "is_pyg_only": safe_view_mode == "pg",
        "summary": summary,
    }
