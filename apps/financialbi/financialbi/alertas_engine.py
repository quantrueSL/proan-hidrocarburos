"""Motor de detección de anomalías financieras — Maka (BigQuery).

Dos cadencias distintas:

  run_all_alerts()  — 13 métricas sobre MESES CERRADOS (comparan el mes
                       completo contra el rango IQR histórico):
    V1, V3, V4 — ventas: totales, concentración HHI, clientes anómalos
    B1-B4      — P&G y balance: margen bruto %, EBITDA, gastos operativos,
                 grupo de balance atípico
    A1-A3      — acreedores (cuentas por pagar): saldo total, aging vencido,
                 proveedor anómalo
    D1-D3      — deudores (cuentas por cobrar): saldo total, aging vencido,
                 cliente anómalo

  run_ritmo_alerts() — 2 métricas de "mes a la fecha" (MTD) para el mes EN
                       CURSO, comparando el acumulado hasta hoy contra el
                       acumulado hasta el mismo día calendario en meses
                       anteriores:
    R1 — Ventas acumuladas a la fecha
    R4 — Cliente anómalo a la fecha

No hay categoría de producción: no existe tabla de producción real en
BigQuery para Maka, y la aproximación por lote de venta (V2/P1/P2/P3 en
versiones anteriores de este motor) resultó demasiado ruidosa/imprecisa para
ser útil — se quitó.

Maka es una sola entidad (no hay selector de sociedad/multi-empresa como en
otros despliegues de PROAN) — todas las métricas se calculan a nivel empresa.
El canal "06 - Partes Relacionadas" es facturación intercompañía (PAN<->MPE)
y se excluye de las métricas de ventas por defecto.

Todas las métricas devuelven el mismo esquema:
  rule_id | periodo | scope_id | valor | umbral | detalle | delta_pct

Uso:
    from alertas_engine import run_all_alerts, AlertConfig
    df = run_all_alerts(target_period="2026-05")
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Dict, List

import numpy as np
import pandas as pd
try:
    from db import read_sql
except ImportError:
    from financialbi.db import read_sql

# Tablas BigQuery (proyecto/dataset de Maka)
_BQ_VENTAS_TABLE          = "`proan-quantrue.D50_AGGREGATE_RENTABILIDAD.MAKA_VENTAS_RECETAS_COSTESMP`"
_BQ_PYG_MENSUAL_TABLE     = "`proan-quantrue.D50_AGGREGATE_RENTABILIDAD.MAKA_PYG_MENSUAL`"
_BQ_BALANCE_GRUPOS_TABLE  = "`proan-quantrue.D50_AGGREGATE_RENTABILIDAD.MAKA_BALANCE_GRUPOS`"
_BQ_ACREEDORES_TABLE      = "`proan-quantrue.D50_AGGREGATE_RENTABILIDAD.MAKA_ACREEDORES`"
_BQ_DEUDORES_TABLE        = "`proan-quantrue.D50_AGGREGATE_RENTABILIDAD.MAKA_DEUDORES`"

# Canal de facturación intercompañía (PAN <-> MPE) — no es venta de mercado real.
_CANAL_PARTES_RELACIONADAS = "06 - PARTES RELACIONADAS"

# Alertas de "ritmo" (mes a la fecha): no se evalúan antes de este día del mes
# en curso, para evitar ruido cuando el acumulado todavía es muy chico. 7 = una
# semana calendario completa (5 se consideró insuficiente: cae fácil en fin de
# semana/puente y deja un acumulado demasiado inestable para comparar).
MTD_MIN_DAY = 7

# Grupos de balance evaluados en B4 (excluye resultado_ejercicio: eso es P&G,
# no una partida de balance comparable mes a mes de la misma forma).
_BALANCE_GRUPOS = [
    "bancos", "cxc", "inventarios", "anticipos", "iva_favor",
    "activo_fijo", "deprec_acum", "otros_activo",
    "cxp", "deuda_bancaria", "impuestos_pagar", "otros_pasivo",
    "capital_social", "utilidades_retenidas", "sin_clasificar",
]


def _currency() -> str:
    return os.getenv("FINANCIALBI_CURRENCY", "MXN")


# ---------------------------------------------------------------------------
# Configuración
# ---------------------------------------------------------------------------


@dataclass
class AlertConfig:
    lookback_months: int = 24
    # Ventana más corta solo para las 9 reglas de "anchos de IQR" (V1/V3/R1/B3/B4/A1/A2/D1/D2).
    # Con la empresa todavía en pleno crecimiento, 24 meses de histórico "diluyen" cambios
    # recientes; 6 meses se adapta más rápido cuando el crecimiento se estabilice (a costa de un
    # Q1/Q3 algo más ruidoso). NO afecta a V4/R4/A3/D3 (mediana propia de cada entidad, sigue en
    # `lookback_months`) — ver Resumen-alertas.md sección 3.3.
    lookback_months_iqr: int = 6
    iqr_k: float = 1.5               # Multiplicador IQR (1.5 estándar, 2-3 conservador)
    ebitda_mom_threshold: float = 0.15  # Caída/mejora de EBITDA MoM que dispara alerta
    margen_mom_threshold_pts: float = 0.05  # Diferencia mínima de margen bruto MoM (puntos) que dispara B1


# ---------------------------------------------------------------------------
# Utilidades de periodo
# ---------------------------------------------------------------------------


def _period_range_dates(target_period: str, lookback_months: int) -> tuple[str, str]:
    """Devuelve (fecha_desde, fecha_hasta) como strings 'YYYY-MM-DD'."""
    import calendar as _cal
    year, month = int(target_period.split("-")[0]), int(target_period.split("-")[1])
    m_back, y_back = month - lookback_months, year
    while m_back <= 0:
        m_back += 12
        y_back -= 1
    last_day = _cal.monthrange(year, month)[1]
    return f"{y_back}-{m_back:02d}-01", f"{year}-{month:02d}-{last_day}"


def _period_range_yyyymm(target_period: str, lookback_months: int) -> tuple[int, int]:
    """Devuelve (yyyymm_desde, yyyymm_hasta) como enteros para tablas anio/mes."""
    year, month = int(target_period.split("-")[0]), int(target_period.split("-")[1])
    m_back, y_back = month - lookback_months, year
    while m_back <= 0:
        m_back += 12
        y_back -= 1
    return y_back * 100 + m_back, year * 100 + month


# ---------------------------------------------------------------------------
# Carga de datos desde BigQuery
# ---------------------------------------------------------------------------


def _load_fact(
    target_period: str | None = None,
    lookback_months: int = 24,
) -> pd.DataFrame:
    """Carga ventas por línea desde BigQuery (excluye partes relacionadas), con periodo."""
    if target_period:
        desde, hasta = _period_range_dates(target_period, lookback_months)
        fecha_cond = f"billing_date BETWEEN '{desde}' AND '{hasta}'"
    else:
        fecha_cond = "billing_date IS NOT NULL"

    fact_sql = f"""
        SELECT
            billing_date,
            distribution_channel,
            CAST(customer_number AS STRING) AS cliente_id,
            amount_mxn
        FROM {_BQ_VENTAS_TABLE}
        WHERE {fecha_cond}
    """
    fact = read_sql(fact_sql)
    fact["billing_date"] = pd.to_datetime(fact["billing_date"], errors="coerce")
    fact["periodo"] = fact["billing_date"].dt.to_period("M")
    fact["amount_mxn"] = pd.to_numeric(fact["amount_mxn"], errors="coerce").fillna(0.0)
    is_intercompany = (
        fact["distribution_channel"].astype(str).str.upper().str.strip()
        == _CANAL_PARTES_RELACIONADAS
    )
    return fact[~is_intercompany].copy()


def load_data(
    target_period: str | None = None,
    lookback_months: int = 24,
) -> Dict[str, pd.DataFrame]:
    """Carga las fuentes de Maka desde BigQuery, acotadas a la ventana de historia.

    Devuelve:
        fact       — ventas por línea (excluye partes relacionadas), con periodo
        pyg        — MAKA_PYG_MENSUAL (subtotales ya calculados)
        balgrp     — MAKA_BALANCE_GRUPOS en formato largo (grupo/saldo)
        acreedores — MAKA_ACREEDORES
        deudores   — MAKA_DEUDORES
    """
    if target_period:
        yyyymm_desde, yyyymm_hasta = _period_range_yyyymm(target_period, lookback_months)
        periodo_cond = f"(anio * 100 + mes) BETWEEN {yyyymm_desde} AND {yyyymm_hasta}"
    else:
        periodo_cond = "1=1"

    fact = _load_fact(target_period, lookback_months)

    pyg_sql = f"""
        SELECT anio, mes, ventas_netas, utilidad_bruta, utilidad_bruta_pct,
               gasto_operacion, ebitda, ebitda_pct
        FROM {_BQ_PYG_MENSUAL_TABLE}
        WHERE {periodo_cond}
    """
    pyg = read_sql(pyg_sql)
    pyg["periodo"] = pd.to_datetime(
        {"year": pyg["anio"].astype(int), "month": pyg["mes"].astype(int), "day": 1},
        errors="coerce",
    ).dt.to_period("M")
    for col in ("utilidad_bruta_pct", "gasto_operacion", "ebitda", "ventas_netas"):
        pyg[col] = pd.to_numeric(pyg[col], errors="coerce")

    balgrp_cols = ", ".join(_BALANCE_GRUPOS)
    balgrp_sql = f"""
        SELECT anio, mes, {balgrp_cols}
        FROM {_BQ_BALANCE_GRUPOS_TABLE}
        WHERE mes != 0 AND {periodo_cond}
    """
    balgrp_wide = read_sql(balgrp_sql)
    balgrp_wide["periodo"] = pd.to_datetime(
        {"year": balgrp_wide["anio"].astype(int), "month": balgrp_wide["mes"].astype(int), "day": 1},
        errors="coerce",
    ).dt.to_period("M")
    balgrp = balgrp_wide.melt(
        id_vars=["anio", "mes", "periodo"], value_vars=_BALANCE_GRUPOS,
        var_name="grupo", value_name="saldo",
    )
    balgrp["saldo"] = pd.to_numeric(balgrp["saldo"], errors="coerce").fillna(0.0)
    balgrp["saldo_abs"] = balgrp["saldo"].abs()

    def _load_counterparty(table: str) -> pd.DataFrame:
        sql = f"""
            SELECT anio, mes, razon_social, saldo_neto, bucket_90_mas
            FROM {table}
            WHERE saldo_neto IS NOT NULL AND {periodo_cond}
        """
        df = read_sql(sql)
        df["periodo"] = pd.to_datetime(
            {"year": df["anio"].astype(int), "month": df["mes"].astype(int), "day": 1},
            errors="coerce",
        ).dt.to_period("M")
        df["saldo_neto"] = pd.to_numeric(df["saldo_neto"], errors="coerce").fillna(0.0)
        df["bucket_90_mas"] = pd.to_numeric(df["bucket_90_mas"], errors="coerce").fillna(0.0)
        return df

    acreedores = _load_counterparty(_BQ_ACREEDORES_TABLE)
    deudores = _load_counterparty(_BQ_DEUDORES_TABLE)

    return {
        "fact": fact,
        "pyg": pyg,
        "balgrp": balgrp,
        "acreedores": acreedores,
        "deudores": deudores,
    }


# ---------------------------------------------------------------------------
# Catálogo para selectores del frontend
# ---------------------------------------------------------------------------


def get_alerts_catalog() -> dict:
    """Devuelve periodos disponibles y último mes activo (Maka: sin sociedades)."""
    df = read_sql(
        f"SELECT DISTINCT FORMAT_DATE('%Y-%m', billing_date) AS periodo "
        f"FROM {_BQ_VENTAS_TABLE} WHERE billing_date IS NOT NULL"
    )
    meses = sorted(r for r in df["periodo"].dropna().tolist() if r)
    ultimo = max(meses) if meses else ""
    return {"meses": meses, "ultimo_mes": ultimo}


# ---------------------------------------------------------------------------
# Utilidades internas
# ---------------------------------------------------------------------------


def _iqr_bounds(series: pd.Series, k: float = 1.5) -> tuple[float, float]:
    """Límites inferior/superior basados en IQR. Robusto a outliers históricos.

    limite_superior = Q3 + k·IQR
    limite_inferior = Q1 - k·IQR
    """
    q1, q3 = float(series.quantile(0.25)), float(series.quantile(0.75))
    iqr = q3 - q1
    return q1 - k * iqr, q3 + k * iqr


def _build_alert(rule_id, periodo, scope_id, value, threshold, detalle, delta_pct=0.0, severidad=None):
    """severidad: métrica usada SOLO para decidir el tier (no se persiste en gold).
    Por defecto es igual a delta_pct (comportamiento de siempre); las reglas de
    entidad (V4/R4/A3/D3) la sobreescriben con el % del total de la empresa —
    ver `_TIER_CUTOFFS_ENTIDAD` y Resumen-alertas.md sección 4.2."""
    return {
        "rule_id": rule_id,
        "periodo": str(periodo),
        "scope_id": str(scope_id),
        "valor": float(value),
        "umbral": float(threshold),
        "detalle": detalle,
        "delta_pct": float(delta_pct),
        "severidad": float(severidad) if severidad is not None else float(delta_pct),
    }


def _fnum(x, decimals=0):
    """Formatea un número con puntos de miles y coma decimal (ES)."""
    if pd.isna(x):
        return "—"
    if decimals == 0:
        return f"{x:,.0f}".replace(",", "X").replace(".", ",").replace("X", ".")
    return f"{x:,.{decimals}f}".replace(",", "X").replace(".", ",").replace("X", ".")


# ---------------------------------------------------------------------------
# Scoring
# ---------------------------------------------------------------------------

# Peso por regla: las métricas agregadas (empresa) pesan más que las granulares.
# El score final = score_base × peso. Rango resultante: 0–100 (peso 1.0) → 0–60 (peso 0.6).
_RULE_WEIGHT: dict[str, float] = {
    "V1": 1.0,   # Ventas totales — métrica agregada clave
    "V3": 0.8,   # HHI concentración clientes — relevante, algo abstracto
    "V4": 0.6,   # Cliente individual — granular, puede haber muchos
    "R1": 1.0,   # Ventas acumuladas a la fecha — métrica agregada clave (ritmo)
    "R4": 0.6,   # Cliente individual a la fecha — granular (ritmo)
    "B1": 1.0,   # Margen bruto % — métrica P&G fundamental
    "B2": 1.0,   # EBITDA — métrica P&G fundamental
    "B3": 0.9,   # Gastos operativos — relevante pero menos urgente
    "B4": 0.7,   # Grupo de balance individual — granular
    "A1": 1.0,   # Saldo total por pagar — métrica agregada clave
    "A2": 0.9,   # Aging vencido acreedores — riesgo de proveedor
    "A3": 0.6,   # Proveedor individual — granular
    "D1": 1.0,   # Saldo total por cobrar — métrica agregada clave
    "D2": 0.9,   # Aging vencido deudores — riesgo de cobranza
    "D3": 0.6,   # Cliente individual — granular
}


# Reglas de "entidad" (cliente/proveedor individual): su severidad se mide como
# % del total de la empresa ese mes, NO como % vs su propia mediana histórica
# (que puede ser minúscula y disparar deltas relativos sin sentido — ver
# Resumen-alertas.md sección 3.2).
_ENTITY_RULES: frozenset[str] = frozenset({"V4", "R4", "A3", "D3"})

# Reglas agregadas que usan el detector IQR genérico (`_detect_series_iqr`) o su
# misma lógica (B4, con bucle propio por grupo): su severidad se mide en "anchos
# de IQR" (cuántas veces el rango intercuartílico se aleja de la media), no en %
# relativo — no se rompe cuando la media histórica es chica. B1 (puntos MoM) y B2
# (EBITDA/ventas netas, ver `detect_b2_ebitda`) tienen cada uno su propio esquema.
_IQR_SEVERITY_RULES: frozenset[str] = frozenset({"V1", "V3", "R1", "B3", "B4", "A1", "A2", "D1", "D2"})

# (CRÍTICO, ATENCIÓN, SEGUIMIENTO) — cortes sobre `severidad`, no sobre delta_pct.
_TIER_CUTOFFS_DEFAULT = (0.30, 0.15, 0.05)      # % relativo (o puntos, para B1)
_TIER_CUTOFFS_ENTIDAD = (0.03, 0.01, 0.0015)    # % del total mensual de la empresa
# 0,0015 = mismo piso que ya usa el filtro de materialidad de las reglas de entidad.
_TIER_CUTOFFS_IQR = (10.0, 4.0, 2.0)            # anchos de IQR — validado con simulación real
# 2.0 ≈ el mínimo teórico al cruzar el borde del rango normal (lo/hi = media ± ~1,5-2 IQR).
_TIER_CUTOFFS_B2 = (0.15, 0.05, 0.0)            # % de ventas netas del mes — validado con simulación real


def _score_from_severidad(severidad: float, cutoffs: tuple[float, float, float]) -> tuple[int, str]:
    """Calcula score base (0-100) y tier a partir de `severidad` (no de delta_pct)."""
    critico, atencion, seguimiento = cutoffs
    adp = abs(severidad)
    if adp >= critico:
        return 85, "CRÍTICO"
    if adp >= atencion:
        return 65, "ATENCIÓN"
    if adp >= seguimiento:
        return 40, "SEGUIMIENTO"
    return 20, "SEGUIMIENTO"


def _calcular_scores(df: pd.DataFrame) -> pd.DataFrame:
    """Asigna score_riesgo y tier usando `severidad` × peso de regla.

    `severidad` decide el tier; `delta_pct` sigue siendo el que se muestra en
    `detalle` para el usuario — pueden ser distintos (ver `_build_alert`).
    """
    if df.empty:
        df = df.copy()
        df["score_riesgo"] = pd.array([], dtype="int64")
        df["tier"] = pd.array([], dtype="object")
        return df

    scores: list[int] = []
    tiers: list[str] = []
    for _, row in df.iterrows():
        if row.get("rule_id") == "ERROR":
            scores.append(0)
            tiers.append("SEGUIMIENTO")
            continue
        rule_id = str(row.get("rule_id", ""))
        severidad = float(row.get("severidad") if row.get("severidad") is not None else row.get("delta_pct") or 0.0)
        if rule_id in _ENTITY_RULES:
            cutoffs = _TIER_CUTOFFS_ENTIDAD
        elif rule_id in _IQR_SEVERITY_RULES:
            cutoffs = _TIER_CUTOFFS_IQR
        elif rule_id == "B2":
            cutoffs = _TIER_CUTOFFS_B2
        else:
            cutoffs = _TIER_CUTOFFS_DEFAULT
        s, t = _score_from_severidad(severidad, cutoffs)
        weight = _RULE_WEIGHT.get(rule_id, 0.8)
        scores.append(int(round(s * weight)))
        tiers.append(t)

    df = df.copy()
    df["score_riesgo"] = scores
    df["tier"] = tiers
    return df


# ---------------------------------------------------------------------------
# Detector genérico: serie agregada mensual vs rango IQR histórico
# ---------------------------------------------------------------------------


def _severidad_iqr(cur_val: float, ref_val: float, lo: float, hi: float) -> float:
    """Severidad para reglas agregadas: distancia a la media en "anchos de IQR"
    (más robusta que %-vs-media cuando la media histórica es chica — ver
    Resumen-alertas.md sección 3.2 punto 1, validado con simulación real)."""
    iqr = (hi - lo) / 3.0  # hi-lo = 2 * 1,5 * IQR (k=1,5 fijo en todo el motor)
    if iqr <= 0:
        return (cur_val - ref_val) / abs(ref_val) if ref_val else 0.0
    return (cur_val - ref_val) / iqr


def _detect_series_iqr(
    monthly: pd.Series,
    target: pd.Period,
    lookback: int,
    rule_id: str,
    build_detalle,
) -> pd.DataFrame:
    """monthly: Series indexada por periodo. build_detalle(cur_val, ref_val, lo, hi, delta_pct) -> str."""
    hist_ps = list(pd.period_range(target - lookback, target - 1, freq="M"))
    hist = monthly.reindex(hist_ps).dropna()
    if len(hist) < 3 or target not in monthly.index or pd.isna(monthly.get(target)):
        return pd.DataFrame()

    lo, hi = _iqr_bounds(hist, 1.5)
    cur_val = float(monthly[target])
    ref_val = float(hist.mean())
    if ref_val == 0 or (lo <= cur_val <= hi):
        return pd.DataFrame()

    delta_pct = (cur_val - ref_val) / abs(ref_val)
    thr = lo if cur_val < lo else hi
    detalle = build_detalle(cur_val, ref_val, lo, hi, delta_pct)
    severidad = _severidad_iqr(cur_val, ref_val, lo, hi)
    return pd.DataFrame([_build_alert(rule_id, target, "MAKA", cur_val, thr, detalle, delta_pct, severidad=severidad)])


# ---------------------------------------------------------------------------
# Detector genérico: ranking de entidades (cliente/proveedor) anómalas
# ---------------------------------------------------------------------------


def _rank_entity_changes(
    entity_monthly: pd.DataFrame,
    target: pd.Period,
    lookback: int,
) -> list[dict]:
    """entity_monthly: columnas [entity_id, periodo, valor]. Devuelve candidatos rankeados
    por magnitud de cambio vs mediana de meses con actividad (>0)."""
    hist_ps = list(pd.period_range(target - lookback, target - 1, freq="M"))
    id_col = entity_monthly.columns[0]
    rows: list[dict] = []
    for eid, g in entity_monthly.groupby(id_col):
        s = g.set_index("periodo")["valor"]
        hist_full = s.reindex(hist_ps, fill_value=0.0)
        hist_pos = hist_full[hist_full > 0]
        if len(hist_pos) < 3:
            continue
        ref_val = float(hist_pos.median())
        if ref_val <= 0:
            continue
        cur_val = float(s.get(target, 0.0))

        if cur_val == 0.0:
            buy_periods = list(hist_pos.index.sort_values())
            if len(buy_periods) >= 2:
                gaps = np.diff([p.ordinal for p in buy_periods])
                typical_gap = float(np.median(gaps)) if len(gaps) else 1.0
                months_since_last = float(target.ordinal - buy_periods[-1].ordinal)
                due_now = months_since_last >= max(1.0, typical_gap)
                if not due_now:
                    continue

        delta_pct = (cur_val - ref_val) / abs(ref_val)
        rows.append({
            "id": eid, "cur_val": cur_val, "ref_val": ref_val,
            "hist_ref": hist_pos, "delta_pct": delta_pct,
        })
    return sorted(rows, key=lambda r: abs(r["delta_pct"]), reverse=True)[:15]


# ---------------------------------------------------------------------------
# V1-V4: Ventas
# ---------------------------------------------------------------------------

_METRIC_NAMES = {
    "V1": "Ventas totales",
    "V3": "Concentración clientes (HHI)",
    "V4": "Cliente anómalo",
    "R1": "Ventas acumuladas a la fecha",
    "R4": "Cliente anómalo a la fecha",
    "B1": "Margen bruto %",
    "B2": "EBITDA",
    "B3": "Gastos operativos",
    "B4": "Grupo de balance atípico",
    "A1": "Saldo total por pagar",
    "A2": "Aging vencido (acreedores)",
    "A3": "Proveedor anómalo",
    "D1": "Saldo total por cobrar",
    "D2": "Aging vencido (deudores)",
    "D3": "Cliente anómalo (cobranza)",
}


def detect_v1_ventas_totales(fact, target, lookback):
    """V1 — Ventas totales del mes vs rango IQR histórico."""
    monthly = fact.groupby("periodo")["amount_mxn"].sum()

    def detalle(cur, ref, lo, hi, delta):
        dir_es = "por debajo" if cur < lo else "por encima"
        return (
            f"Ventas totales: {_fnum(cur)} {_currency()} "
            f"({_fnum(abs(delta) * 100, 1)}% {dir_es} del rango normal; "
            f"media histórica: {_fnum(ref)} {_currency()})."
        )

    return _detect_series_iqr(monthly, target, lookback, "V1", detalle)


def detect_v3_hhi_clientes(fact, target, lookback):
    """V3 — Índice Herfindahl (HHI) de concentración de clientes."""
    sales = fact.groupby(["periodo", "cliente_id"])["amount_mxn"].sum().reset_index()
    totals = sales.groupby("periodo")["amount_mxn"].sum().rename("total")
    sales = sales.merge(totals, on="periodo")
    sales = sales[sales["total"] > 0].copy()
    sales["share"] = sales["amount_mxn"] / sales["total"]
    monthly = sales.groupby("periodo").apply(lambda g: (g["share"] ** 2).sum())

    def detalle(cur, ref, lo, hi, delta):
        dir_es = "alta" if cur > hi else "baja"
        return (
            f"Concentración clientes HHI: {_fnum(cur, 3)} "
            f"(concentración {dir_es} vs media histórica {_fnum(ref, 3)})."
        )

    return _detect_series_iqr(monthly, target, lookback, "V3", detalle)


def detect_v4_clientes_anomalos(fact, target, lookback):
    """V4 — Top 15 clientes con mayor variación vs mediana histórica de meses con compra."""
    monthly = (
        fact.groupby(["cliente_id", "periodo"])["amount_mxn"]
        .sum().reset_index(name="valor")
    )
    ranked = _rank_entity_changes(monthly[["cliente_id", "periodo", "valor"]], target, lookback)
    if not ranked:
        return pd.DataFrame()

    total_mes = float(monthly[monthly["periodo"].eq(target)]["valor"].sum())
    _MAT_MIN_PCT = 0.0015  # 0.15% — cambio mínimo absoluto como fracción de ventas totales

    alerts = []
    for r in ranked:
        if abs(r["delta_pct"]) < 0.10:
            continue
        if total_mes > 0 and abs(r["cur_val"] - r["ref_val"]) < _MAT_MIN_PCT * total_mes:
            continue
        lo_thr, hi_thr = _iqr_bounds(r["hist_ref"], 1.5)
        thr = lo_thr if r["delta_pct"] < 0 else hi_thr
        dir_es = "caída" if r["delta_pct"] < 0 else "subida"
        severidad = (r["cur_val"] - r["ref_val"]) / total_mes if total_mes else r["delta_pct"]
        alerts.append(_build_alert(
            "V4", target, r["id"], r["cur_val"], thr,
            f"Cliente {r['id']}: {_fnum(r['cur_val'])} {_currency()} este mes "
            f"({dir_es} del {_fnum(abs(r['delta_pct']) * 100, 1)}% "
            f"vs mediana histórica de meses con compra {_fnum(r['ref_val'])} {_currency()}).",
            delta_pct=r["delta_pct"],
            severidad=severidad,
        ))
    return pd.DataFrame(alerts)


# ---------------------------------------------------------------------------
# R1, R4: Ritmo (mes a la fecha) — mismo mes en curso, comparado día a día
# ---------------------------------------------------------------------------


def _mtd_truncate(fact: pd.DataFrame, cutoff_day: int) -> pd.DataFrame:
    """Recorta `fact` a los primeros `cutoff_day` días de cada mes (acotado a los
    días reales de cada mes — p.ej. cutoff_day=31 en febrero se acota a 28/29)."""
    day = fact["billing_date"].dt.day
    days_in_month = fact["billing_date"].dt.days_in_month
    effective_cutoff = np.minimum(cutoff_day, days_in_month)
    return fact[day <= effective_cutoff].copy()


def detect_r1_ventas_ritmo(fact_mtd, target, lookback, cutoff_day):
    """R1 — Ventas acumuladas del mes en curso hasta hoy, vs. el acumulado hasta
    el mismo día calendario en los meses anteriores (rango IQR)."""
    monthly = fact_mtd.groupby("periodo")["amount_mxn"].sum()

    def detalle(cur, ref, lo, hi, delta):
        dir_es = "por debajo" if cur < lo else "por encima"
        return (
            f"Ventas acumuladas del 1 al {cutoff_day} del mes: {_fnum(cur)} {_currency()} "
            f"({_fnum(abs(delta) * 100, 1)}% {dir_es} del rango normal; "
            f"media histórica al mismo día: {_fnum(ref)} {_currency()})."
        )

    return _detect_series_iqr(monthly, target, lookback, "R1", detalle)


def detect_r4_cliente_ritmo(fact_mtd, target, lookback, cutoff_day):
    """R4 — Top 15 clientes cuyo ritmo de compra (acumulado a la fecha) se aparta
    más de la mediana histórica de meses con compra, al mismo día calendario."""
    monthly = (
        fact_mtd.groupby(["cliente_id", "periodo"])["amount_mxn"]
        .sum().reset_index(name="valor")
    )
    ranked = _rank_entity_changes(monthly[["cliente_id", "periodo", "valor"]], target, lookback)
    if not ranked:
        return pd.DataFrame()

    total_mes = float(monthly[monthly["periodo"].eq(target)]["valor"].sum())
    _MAT_MIN_PCT = 0.0015

    alerts = []
    for r in ranked:
        if abs(r["delta_pct"]) < 0.10:
            continue
        if total_mes > 0 and abs(r["cur_val"] - r["ref_val"]) < _MAT_MIN_PCT * total_mes:
            continue
        lo_thr, hi_thr = _iqr_bounds(r["hist_ref"], 1.5)
        thr = lo_thr if r["delta_pct"] < 0 else hi_thr
        dir_es = "caída" if r["delta_pct"] < 0 else "subida"
        severidad = (r["cur_val"] - r["ref_val"]) / total_mes if total_mes else r["delta_pct"]
        alerts.append(_build_alert(
            "R4", target, r["id"], r["cur_val"], thr,
            f"Cliente {r['id']}: {_fnum(r['cur_val'])} {_currency()} acumulado al día "
            f"{cutoff_day} del mes ({dir_es} del {_fnum(abs(r['delta_pct']) * 100, 1)}% "
            f"vs mediana histórica al mismo día {_fnum(r['ref_val'])} {_currency()}).",
            delta_pct=r["delta_pct"],
            severidad=severidad,
        ))
    return pd.DataFrame(alerts)


def run_ritmo_alerts(
    cfg: AlertConfig | None = None,
    reference_date: str | None = None,
) -> tuple[pd.DataFrame, dict]:
    """Ejecuta las alertas de "ritmo" (mes a la fecha) para el mes en curso.

    A diferencia de `run_all_alerts` (que compara meses cerrados completos),
    esto compara el acumulado del mes en curso hasta hoy contra el acumulado
    hasta el mismo día calendario en los `lookback` meses anteriores. No se
    evalúa antes del día `MTD_MIN_DAY` del mes (ver `AlertConfig`).

    Devuelve (df, meta) donde meta incluye day_of_month/cutoff_day/too_early.
    """
    cfg = cfg or AlertConfig()
    lookback = cfg.lookback_months
    today = pd.Timestamp(reference_date) if reference_date else pd.Timestamp.now()
    target = pd.Period(today, freq="M")
    day_of_month = int(today.day)

    if day_of_month < MTD_MIN_DAY:
        empty = pd.DataFrame(columns=[
            "rule_id", "periodo", "scope_id", "valor", "umbral",
            "detalle", "delta_pct", "score_riesgo", "tier",
        ])
        return empty, {
            "too_early": True,
            "day_of_month": day_of_month,
            "min_day": MTD_MIN_DAY,
            "cutoff_day": None,
        }

    fact = _load_fact(str(target), lookback)
    fact_mtd = _mtd_truncate(fact, day_of_month)

    # R1 (IQR agregada) usa `lookback_months_iqr`; R4 (entidad) se queda con `lookback` — ver
    # AlertConfig y el mismo criterio en run_all_alerts.
    detectors = [
        lambda: detect_r1_ventas_ritmo(fact_mtd, target, cfg.lookback_months_iqr, day_of_month),
        lambda: detect_r4_cliente_ritmo(fact_mtd, target, lookback, day_of_month),
    ]

    all_alerts: List[pd.DataFrame] = []
    for detect in detectors:
        try:
            out = detect()
            if out is not None and not out.empty:
                all_alerts.append(out)
        except Exception as exc:
            all_alerts.append(
                pd.DataFrame([{
                    "rule_id": "ERROR",
                    "periodo": str(target),
                    "scope_id": "detector",
                    "valor": np.nan,
                    "umbral": np.nan,
                    "detalle": f"Fallo en detector: {exc}",
                    "delta_pct": 0.0,
                }])
            )

    meta = {
        "too_early": False,
        "day_of_month": day_of_month,
        "min_day": MTD_MIN_DAY,
        "cutoff_day": day_of_month,
    }

    if not all_alerts:
        empty = pd.DataFrame(columns=[
            "rule_id", "periodo", "scope_id", "valor", "umbral",
            "detalle", "delta_pct", "score_riesgo", "tier",
        ])
        return empty, meta

    df = pd.concat(all_alerts, ignore_index=True)
    df = _calcular_scores(df)

    real   = df[df["rule_id"] != "ERROR"].sort_values("score_riesgo", ascending=False)
    errors = df[df["rule_id"] == "ERROR"]
    return pd.concat([real, errors], ignore_index=True), meta


# ---------------------------------------------------------------------------
# B1-B4: P&G y balance
# ---------------------------------------------------------------------------


def detect_b1_margen_bruto(pyg, target, lookback, cfg: AlertConfig):
    """B1 — Margen bruto % (utilidad_bruta_pct de RENTABILIDAD_PYG_MENSUAL).

    Comparación: mes anterior (MoM), en puntos porcentuales (no % relativo,
    porque ya es un ratio). Si no hay mes anterior con dato, cae a IQR histórico.
    """
    series = pyg.set_index("periodo")["utilidad_bruta_pct"]
    cur_val = series.get(target)
    if cur_val is None or pd.isna(cur_val):
        return pd.DataFrame()
    cur_val = float(cur_val)

    prior_val = series.get(target - 1)
    if prior_val is not None and not pd.isna(prior_val):
        ref_val = float(prior_val)
        delta_pts = cur_val - ref_val
        if abs(delta_pts) < cfg.margen_mom_threshold_pts:
            return pd.DataFrame()
        comparacion = "mes anterior"
        thr = ref_val
    else:
        hist_ps = list(pd.period_range(target - lookback, target - 1, freq="M"))
        hist = series.reindex(hist_ps).dropna()
        if len(hist) < 3:
            return pd.DataFrame()
        lo, hi = _iqr_bounds(hist, 1.5)
        if lo <= cur_val <= hi:
            return pd.DataFrame()
        ref_val = float(hist.mean())
        delta_pts = cur_val - ref_val
        comparacion = "media histórica"
        thr = lo if cur_val < lo else hi

    dir_es = "bajo" if delta_pts < 0 else "alto"
    detalle = (
        f"Margen bruto: {_fnum(cur_val * 100, 1)}% "
        f"(margen {dir_es} vs {comparacion}: {_fnum(ref_val * 100, 1)}%; "
        f"diferencia: {_fnum(delta_pts * 100, 1)} puntos)."
    )
    return pd.DataFrame([_build_alert("B1", target, "MAKA", cur_val, thr, detalle, delta_pts)])


def detect_b2_ebitda(pyg, target, lookback, cfg: AlertConfig):
    """B2 — EBITDA. Comparación: MoM (mes anterior). Si no hay mes anterior, IQR histórico.

    Severidad: cambio de EBITDA como % de las ventas netas del mes, no % vs el EBITDA de
    referencia (que se rompe si esa referencia está cerca de cero — ver Resumen-alertas.md
    sección 3.2 punto 1). Las ventas netas son un denominador estable que nunca es casi-cero.
    """
    series = pyg.set_index("periodo")["ebitda"]
    ventas = pyg.set_index("periodo")["ventas_netas"]
    hist_ps = list(pd.period_range(target - lookback, target - 1, freq="M"))

    cur_val = series.get(target)
    if cur_val is None or pd.isna(cur_val):
        return pd.DataFrame()
    cur_val = float(cur_val)
    ventas_mes = float(ventas.get(target) or 0.0)

    prior_val = series.get(target - 1)
    if prior_val is not None and not pd.isna(prior_val) and abs(float(prior_val)) >= 1:
        ref_val = float(prior_val)
        delta_pct = (cur_val - ref_val) / abs(ref_val)
        if abs(delta_pct) < cfg.ebitda_mom_threshold:
            return pd.DataFrame()
        comparacion = "mes anterior"
        thr = ref_val
    else:
        hist = series.reindex(hist_ps).dropna()
        if len(hist) < 3:
            return pd.DataFrame()
        lo, hi = _iqr_bounds(hist, 1.5)
        if lo <= cur_val <= hi:
            return pd.DataFrame()
        ref_val = float(hist.mean())
        if abs(ref_val) < 1:
            return pd.DataFrame()
        delta_pct = (cur_val - ref_val) / abs(ref_val)
        comparacion = "media histórica"
        thr = lo if cur_val < lo else hi

    dir_es = "caída" if delta_pct < 0 else "mejora"
    detalle = (
        f"EBITDA: {_fnum(cur_val)} {_currency()} "
        f"({dir_es} del {_fnum(abs(delta_pct) * 100, 1)}% vs {comparacion}: "
        f"{_fnum(ref_val)} {_currency()})."
    )
    severidad = (cur_val - ref_val) / ventas_mes if ventas_mes else delta_pct
    return pd.DataFrame([_build_alert("B2", target, "MAKA", cur_val, thr, detalle, delta_pct, severidad=severidad)])


def detect_b3_gastos_operativos(pyg, target, lookback):
    """B3 — Gastos de operación (gasto_operacion de RENTABILIDAD_PYG_MENSUAL) vs IQR."""
    monthly = pyg.set_index("periodo")["gasto_operacion"].abs()

    def detalle(cur, ref, lo, hi, delta):
        dir_es = "bajos" if cur < lo else "altos"
        return (
            f"Gastos operativos: {_fnum(cur)} {_currency()} "
            f"(inusualmente {dir_es}; {_fnum(abs(delta) * 100, 1)}% "
            f"vs media histórica {_fnum(ref)} {_currency()})."
        )

    return _detect_series_iqr(monthly, target, lookback, "B3", detalle)


def detect_b4_grupo_balance_atipico(balgrp, target, lookback):
    """B4 — Grupo de balance (bancos, CxC, inventarios, CxP...) fuera de su rango IQR histórico."""
    x = balgrp.groupby(["grupo", "periodo"])["saldo_abs"].sum().reset_index()
    hist_ps = set(pd.period_range(target - lookback, target - 1, freq="M"))
    alerts = []
    for grupo, g in x.groupby("grupo"):
        hist = g[g["periodo"].isin(hist_ps)]["saldo_abs"]
        cur_row = g[g["periodo"].eq(target)]
        if len(hist) < 4 or cur_row.empty:
            continue
        lo, hi = _iqr_bounds(hist, 1.5)
        cur_val = float(cur_row["saldo_abs"].iloc[0])
        ref_val = float(hist.mean())
        if ref_val == 0 or (lo <= cur_val <= hi):
            continue
        delta_pct = (cur_val - ref_val) / abs(ref_val)
        thr = lo if cur_val < lo else hi
        dir_es = "bajo" if cur_val < lo else "alto"
        severidad = _severidad_iqr(cur_val, ref_val, lo, hi)
        alerts.append(_build_alert(
            "B4", target, grupo, cur_val, thr,
            f"Grupo de balance '{grupo}': saldo {_fnum(cur_val)} {_currency()} "
            f"(inusualmente {dir_es}; media histórica: {_fnum(ref_val)} {_currency()}).",
            delta_pct=delta_pct,
            severidad=severidad,
        ))
    return pd.DataFrame(alerts)


# ---------------------------------------------------------------------------
# A1-A3: Acreedores (cuentas por pagar)
# ---------------------------------------------------------------------------


def detect_a1_saldo_total(acreedores, target, lookback):
    """A1 — Saldo total por pagar vs rango IQR histórico."""
    monthly = acreedores.groupby("periodo")["saldo_neto"].sum()

    def detalle(cur, ref, lo, hi, delta):
        dir_es = "por debajo" if cur < lo else "por encima"
        return (
            f"Saldo total por pagar: {_fnum(cur)} {_currency()} "
            f"({_fnum(abs(delta) * 100, 1)}% {dir_es} del rango normal; "
            f"media histórica: {_fnum(ref)} {_currency()})."
        )

    return _detect_series_iqr(monthly, target, lookback, "A1", detalle)


def detect_a2_aging_vencido(acreedores, target, lookback):
    """A2 — % del saldo por pagar vencido a más de 90 días vs rango IQR histórico."""
    x = acreedores.groupby("periodo").agg(
        bucket_90=("bucket_90_mas", "sum"), total=("saldo_neto", "sum")
    )
    x = x[x["total"] > 0]
    monthly = x["bucket_90"] / x["total"]

    def detalle(cur, ref, lo, hi, delta):
        # La métrica ya es un %: el cambio se expresa en puntos porcentuales
        # (cur − ref), no en % relativo — mismo criterio que B1. Ver
        # Resumen-alertas.md 3.2 punto 2.
        dir_es = "alto" if cur > hi else "bajo"
        pts = (cur - ref) * 100
        signo = "+" if pts >= 0 else "-"
        return (
            f"% de cuentas por pagar vencidas +90 días: {_fnum(cur * 100, 1)}% "
            f"({signo}{_fnum(abs(pts), 1)} puntos vs media histórica {_fnum(ref * 100, 1)}%; "
            f"inusualmente {dir_es})."
        )

    return _detect_series_iqr(monthly, target, lookback, "A2", detalle)


def detect_a3_proveedor_anomalo(acreedores, target, lookback):
    """A3 — Top 15 proveedores con mayor variación de saldo vs mediana histórica."""
    monthly = (
        acreedores.groupby(["razon_social", "periodo"])["saldo_neto"]
        .sum().reset_index(name="valor")
    )
    ranked = _rank_entity_changes(monthly[["razon_social", "periodo", "valor"]], target, lookback)
    if not ranked:
        return pd.DataFrame()

    total_mes = float(monthly[monthly["periodo"].eq(target)]["valor"].sum())
    _MAT_MIN_PCT = 0.0015

    alerts = []
    for r in ranked:
        if abs(r["delta_pct"]) < 0.10:
            continue
        if total_mes > 0 and abs(r["cur_val"] - r["ref_val"]) < _MAT_MIN_PCT * total_mes:
            continue
        lo_thr, hi_thr = _iqr_bounds(r["hist_ref"], 1.5)
        thr = lo_thr if r["delta_pct"] < 0 else hi_thr
        dir_es = "caída" if r["delta_pct"] < 0 else "subida"
        severidad = (r["cur_val"] - r["ref_val"]) / total_mes if total_mes else r["delta_pct"]
        alerts.append(_build_alert(
            "A3", target, r["id"], r["cur_val"], thr,
            f"Proveedor {r['id']}: saldo por pagar {_fnum(r['cur_val'])} {_currency()} "
            f"({dir_es} del {_fnum(abs(r['delta_pct']) * 100, 1)}% "
            f"vs mediana histórica {_fnum(r['ref_val'])} {_currency()}).",
            delta_pct=r["delta_pct"],
            severidad=severidad,
        ))
    return pd.DataFrame(alerts)


# ---------------------------------------------------------------------------
# D1-D3: Deudores (cuentas por cobrar)
# ---------------------------------------------------------------------------


def detect_d1_saldo_total(deudores, target, lookback):
    """D1 — Saldo total por cobrar vs rango IQR histórico."""
    monthly = deudores.groupby("periodo")["saldo_neto"].sum()

    def detalle(cur, ref, lo, hi, delta):
        dir_es = "por debajo" if cur < lo else "por encima"
        return (
            f"Saldo total por cobrar: {_fnum(cur)} {_currency()} "
            f"({_fnum(abs(delta) * 100, 1)}% {dir_es} del rango normal; "
            f"media histórica: {_fnum(ref)} {_currency()})."
        )

    return _detect_series_iqr(monthly, target, lookback, "D1", detalle)


def detect_d2_aging_vencido(deudores, target, lookback):
    """D2 — % del saldo por cobrar vencido a más de 90 días vs rango IQR histórico."""
    x = deudores.groupby("periodo").agg(
        bucket_90=("bucket_90_mas", "sum"), total=("saldo_neto", "sum")
    )
    x = x[x["total"] > 0]
    monthly = x["bucket_90"] / x["total"]

    def detalle(cur, ref, lo, hi, delta):
        # En puntos porcentuales, igual que A2/B1 — ver Resumen-alertas.md 3.2.
        dir_es = "alto" if cur > hi else "bajo"
        pts = (cur - ref) * 100
        signo = "+" if pts >= 0 else "-"
        return (
            f"% de cuentas por cobrar vencidas +90 días: {_fnum(cur * 100, 1)}% "
            f"({signo}{_fnum(abs(pts), 1)} puntos vs media histórica {_fnum(ref * 100, 1)}%; "
            f"inusualmente {dir_es}). Riesgo de cobranza."
        )

    return _detect_series_iqr(monthly, target, lookback, "D2", detalle)


def detect_d3_cliente_anomalo(deudores, target, lookback):
    """D3 — Top 15 clientes con mayor variación de saldo por cobrar vs mediana histórica."""
    monthly = (
        deudores.groupby(["razon_social", "periodo"])["saldo_neto"]
        .sum().reset_index(name="valor")
    )
    ranked = _rank_entity_changes(monthly[["razon_social", "periodo", "valor"]], target, lookback)
    if not ranked:
        return pd.DataFrame()

    total_mes = float(monthly[monthly["periodo"].eq(target)]["valor"].sum())
    _MAT_MIN_PCT = 0.0015

    alerts = []
    for r in ranked:
        if abs(r["delta_pct"]) < 0.10:
            continue
        if total_mes > 0 and abs(r["cur_val"] - r["ref_val"]) < _MAT_MIN_PCT * total_mes:
            continue
        lo_thr, hi_thr = _iqr_bounds(r["hist_ref"], 1.5)
        thr = lo_thr if r["delta_pct"] < 0 else hi_thr
        dir_es = "caída" if r["delta_pct"] < 0 else "subida"
        severidad = (r["cur_val"] - r["ref_val"]) / total_mes if total_mes else r["delta_pct"]
        alerts.append(_build_alert(
            "D3", target, r["id"], r["cur_val"], thr,
            f"Cliente {r['id']}: saldo por cobrar {_fnum(r['cur_val'])} {_currency()} "
            f"({dir_es} del {_fnum(abs(r['delta_pct']) * 100, 1)}% "
            f"vs mediana histórica {_fnum(r['ref_val'])} {_currency()}).",
            delta_pct=r["delta_pct"],
            severidad=severidad,
        ))
    return pd.DataFrame(alerts)


# ---------------------------------------------------------------------------
# Función principal
# ---------------------------------------------------------------------------


def run_all_alerts(
    cfg: AlertConfig | None = None,
    target_period: str | None = None,
) -> pd.DataFrame:
    """Ejecuta las 13 métricas y devuelve alertas ordenadas por riesgo.

    Columnas del DataFrame resultante:
        rule_id, periodo, scope_id, valor, umbral, detalle, delta_pct,
        score_riesgo, tier
    """
    cfg = cfg or AlertConfig()
    lookback = cfg.lookback_months
    lookback_iqr = cfg.lookback_months_iqr
    data = load_data(target_period=target_period, lookback_months=lookback)
    fact = data["fact"]
    pyg, balgrp = data["pyg"], data["balgrp"]
    acreedores, deudores = data["acreedores"], data["deudores"]

    if target_period is None:
        monthly = fact.groupby("periodo")["amount_mxn"].sum()
        if monthly.empty:
            raise ValueError("No hay ventas con periodos validos")
        target = monthly.index.max()
    else:
        target = pd.Period(target_period, freq="M")

    # V4/A3/D3 (entidad) usan `lookback` (mediana propia de cada entidad, necesita más
    # histórico). El resto (IQR agregadas) usa `lookback_iqr`, más corto — ver AlertConfig.
    detectors = [
        lambda: detect_v1_ventas_totales(fact, target, lookback_iqr),
        lambda: detect_v3_hhi_clientes(fact, target, lookback_iqr),
        lambda: detect_v4_clientes_anomalos(fact, target, lookback),
        lambda: detect_b1_margen_bruto(pyg, target, lookback, cfg),
        lambda: detect_b2_ebitda(pyg, target, lookback, cfg),
        lambda: detect_b3_gastos_operativos(pyg, target, lookback_iqr),
        lambda: detect_b4_grupo_balance_atipico(balgrp, target, lookback_iqr),
        lambda: detect_a1_saldo_total(acreedores, target, lookback_iqr),
        lambda: detect_a2_aging_vencido(acreedores, target, lookback_iqr),
        lambda: detect_a3_proveedor_anomalo(acreedores, target, lookback),
        lambda: detect_d1_saldo_total(deudores, target, lookback_iqr),
        lambda: detect_d2_aging_vencido(deudores, target, lookback_iqr),
        lambda: detect_d3_cliente_anomalo(deudores, target, lookback),
    ]

    all_alerts: List[pd.DataFrame] = []
    for detect in detectors:
        try:
            out = detect()
            if out is not None and not out.empty:
                all_alerts.append(out)
        except Exception as exc:
            all_alerts.append(
                pd.DataFrame([{
                    "rule_id": "ERROR",
                    "periodo": str(target),
                    "scope_id": "detector",
                    "valor": np.nan,
                    "umbral": np.nan,
                    "detalle": f"Fallo en detector: {exc}",
                    "delta_pct": 0.0,
                }])
            )

    if not all_alerts:
        return pd.DataFrame(columns=[
            "rule_id", "periodo", "scope_id", "valor", "umbral",
            "detalle", "delta_pct", "score_riesgo", "tier",
        ])

    df = pd.concat(all_alerts, ignore_index=True)
    df = _calcular_scores(df)

    real   = df[df["rule_id"] != "ERROR"].sort_values("score_riesgo", ascending=False)
    errors = df[df["rule_id"] == "ERROR"]
    return pd.concat([real, errors], ignore_index=True)


# ---------------------------------------------------------------------------
# Lectura desde gold — el servicio en vivo NO recalcula, solo consulta lo que
# materialize_alerts.py ya escribió. Ver ConsultasBigQuery/gold_alertas_ddl.sql.
# ---------------------------------------------------------------------------

_TABLE_GOLD_MENSUAL = "`proan-quantrue.D60_REPORTING.MAKA_GOLD_ALERTAS_MENSUAL`"
_TABLE_GOLD_RITMO   = "`proan-quantrue.D60_REPORTING.MAKA_GOLD_ALERTAS_RITMO`"
_TABLE_GOLD_HISTORIAS_MENSUAL = "`proan-quantrue.D60_REPORTING.MAKA_GOLD_HISTORIAS_MENSUAL`"
_TABLE_GOLD_HISTORIAS_RITMO   = "`proan-quantrue.D60_REPORTING.MAKA_GOLD_HISTORIAS_RITMO`"

_GOLD_ALERT_COLS = ["rule_id", "periodo", "scope_id", "valor", "umbral", "detalle", "delta_pct", "score_riesgo", "tier"]


def _empty_alerts_df() -> pd.DataFrame:
    return pd.DataFrame(columns=_GOLD_ALERT_COLS)


def load_alerts_from_gold(target_period: str | None = None) -> pd.DataFrame:
    """Lee alertas de meses cerrados ya materializadas en GOLD_ALERTAS_MENSUAL.

    No recalcula nada — si `target_period` todavía no fue materializado por
    materialize_alerts.py, devuelve un DataFrame vacío (no cae a cálculo en
    vivo). Si `target_period` es None, usa el último periodo disponible.
    """
    where = (
        f"periodo_date = DATE('{target_period}-01')"
        if target_period
        else f"periodo_date = (SELECT MAX(periodo_date) FROM {_TABLE_GOLD_MENSUAL})"
    )
    sql = f"""
        SELECT rule_id, FORMAT_DATE('%Y-%m', periodo_date) AS periodo,
               scope_id, valor, umbral, delta_pct, detalle, score_riesgo, tier
        FROM {_TABLE_GOLD_MENSUAL}
        WHERE {where}
        ORDER BY score_riesgo DESC
    """
    df = read_sql(sql)
    if df.empty:
        return _empty_alerts_df()

    for col in ("valor", "umbral", "delta_pct"):
        df[col] = pd.to_numeric(df[col], errors="coerce")
    df["score_riesgo"] = pd.to_numeric(df["score_riesgo"], errors="coerce").fillna(0).astype(int)
    return df[_GOLD_ALERT_COLS]


def load_alerts_from_gold_ritmo(reference_date: str | None = None) -> tuple[pd.DataFrame, dict]:
    """Lee alertas de "ritmo" (mes a la fecha) ya materializadas en GOLD_ALERTAS_RITMO.

    El chequeo de "muy temprano en el mes" (día < MTD_MIN_DAY) es cómputo de
    fecha puro — no necesita BigQuery — así que se mantiene aquí en vez de
    depender de que la tabla esté vacía por otra razón.
    """
    today = pd.Timestamp(reference_date) if reference_date else pd.Timestamp.now()
    day_of_month = int(today.day)

    if day_of_month < MTD_MIN_DAY:
        return _empty_alerts_df(), {
            "too_early": True,
            "day_of_month": day_of_month,
            "min_day": MTD_MIN_DAY,
            "cutoff_day": None,
        }

    periodo_date = today.replace(day=1).strftime("%Y-%m-%d")
    sql = f"""
        SELECT rule_id, FORMAT_DATE('%Y-%m', periodo_date) AS periodo,
               scope_id, valor, umbral, delta_pct, detalle, score_riesgo, tier, cutoff_day
        FROM {_TABLE_GOLD_RITMO}
        WHERE periodo_date = DATE('{periodo_date}')
        ORDER BY score_riesgo DESC
    """
    df = read_sql(sql)
    meta = {
        "too_early": False,
        "day_of_month": day_of_month,
        "min_day": MTD_MIN_DAY,
        "cutoff_day": int(df["cutoff_day"].iloc[0]) if not df.empty else day_of_month,
    }

    if df.empty:
        return _empty_alerts_df(), meta

    for col in ("valor", "umbral", "delta_pct"):
        df[col] = pd.to_numeric(df[col], errors="coerce")
    df["score_riesgo"] = pd.to_numeric(df["score_riesgo"], errors="coerce").fillna(0).astype(int)
    return df[_GOLD_ALERT_COLS], meta


# Columnas que expone el endpoint de historias (tarjetas ya congeladas por el
# job — ver ConsultasBigQuery/gold/alerts/gold_historias_ddl.sql).
_GOLD_HISTORIA_COLS = [
    "periodo", "orden", "rule_id", "scope_id", "titulo_llm", "resumen_llm",
    "causal_pattern", "trend_type", "trend_direction", "trend_n",
    "valor", "umbral", "delta_pct", "detalle", "score_riesgo", "tier",
]


def _postprocess_historias_df(df: pd.DataFrame) -> pd.DataFrame:
    for col in ("valor", "umbral", "delta_pct"):
        df[col] = pd.to_numeric(df[col], errors="coerce")
    for col in ("orden", "trend_n", "score_riesgo"):
        df[col] = pd.to_numeric(df[col], errors="coerce").fillna(0).astype(int)
    return df


def load_historias_from_gold(target_period: str | None = None) -> pd.DataFrame:
    """Lee las tarjetas ya congeladas en GOLD_HISTORIAS_MENSUAL.

    No genera nada — si el periodo no fue materializado por
    materialize_alerts.py (subcomando 'historias'), devuelve vacío. Si
    `target_period` es None, usa el último periodo disponible.
    """
    where = (
        f"periodo_date = DATE('{target_period}-01')"
        if target_period
        else f"periodo_date = (SELECT MAX(periodo_date) FROM {_TABLE_GOLD_HISTORIAS_MENSUAL})"
    )
    sql = f"""
        SELECT FORMAT_DATE('%Y-%m', periodo_date) AS periodo,
               orden, rule_id, scope_id, titulo_llm, resumen_llm,
               causal_pattern, trend_type, trend_direction, trend_n,
               valor, umbral, delta_pct, detalle, score_riesgo, tier
        FROM {_TABLE_GOLD_HISTORIAS_MENSUAL}
        WHERE {where}
        ORDER BY orden
    """
    df = read_sql(sql)
    if df.empty:
        return pd.DataFrame(columns=_GOLD_HISTORIA_COLS)
    return _postprocess_historias_df(df)[_GOLD_HISTORIA_COLS]


def load_historias_from_gold_ritmo(reference_date: str | None = None) -> tuple[pd.DataFrame, dict]:
    """Lee las tarjetas de "ritmo" (mes a la fecha) de GOLD_HISTORIAS_RITMO.

    Mismo contrato que load_alerts_from_gold_ritmo: chequeo de "muy temprano"
    por fecha (sin BigQuery) + meta con cutoff_day de la corrida grabada.
    """
    today = pd.Timestamp(reference_date) if reference_date else pd.Timestamp.now()
    day_of_month = int(today.day)

    if day_of_month < MTD_MIN_DAY:
        return pd.DataFrame(columns=_GOLD_HISTORIA_COLS), {
            "too_early": True,
            "day_of_month": day_of_month,
            "min_day": MTD_MIN_DAY,
            "cutoff_day": None,
        }

    periodo_date = today.replace(day=1).strftime("%Y-%m-%d")
    sql = f"""
        SELECT FORMAT_DATE('%Y-%m', periodo_date) AS periodo,
               orden, rule_id, scope_id, titulo_llm, resumen_llm,
               causal_pattern, trend_type, trend_direction, trend_n,
               valor, umbral, delta_pct, detalle, score_riesgo, tier, cutoff_day
        FROM {_TABLE_GOLD_HISTORIAS_RITMO}
        WHERE periodo_date = DATE('{periodo_date}')
        ORDER BY orden
    """
    df = read_sql(sql)
    meta = {
        "too_early": False,
        "day_of_month": day_of_month,
        "min_day": MTD_MIN_DAY,
        "cutoff_day": int(df["cutoff_day"].iloc[0]) if not df.empty else day_of_month,
    }

    if df.empty:
        return pd.DataFrame(columns=_GOLD_HISTORIA_COLS), meta
    return _postprocess_historias_df(df)[_GOLD_HISTORIA_COLS], meta
