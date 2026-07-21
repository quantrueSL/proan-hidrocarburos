"""Agente LLM para analizar las alertas financieras más importantes.

Patrón: function-calling loop con OpenAI SDK (>=1.0).
El agente recibe las top alertas del periodo, puede consultar
históricos en BigQuery (Maka), y devuelve un informe ejecutivo en español.

Variables de entorno requeridas:
    LLM_API_URL   — base_url del endpoint OpenAI/Azure OpenAI
    LLM_API_KEY   — clave de autenticación
    LLM_MODEL_ID  — nombre del deployment (ej. 'gpt-4o-mini')
    BQ_PROJECT_ID, BQ_CREDENTIALS_PATH — BigQuery (ver financialbi/db.py)
"""

from __future__ import annotations

import logging
import os
from typing import Any

import pandas as pd
try:
    from db import read_sql
except ImportError:
    from financialbi.db import read_sql
from openai import OpenAI

log = logging.getLogger(__name__)

# Tablas BigQuery de Maka — deben coincidir con alertas_engine.py
_BQ_VENTAS_TABLE          = "`proan-quantrue.D50_AGGREGATE_RENTABILIDAD.MAKA_VENTAS_RECETAS_COSTESMP`"
_BQ_PYG_MENSUAL_TABLE     = "`proan-quantrue.D50_AGGREGATE_RENTABILIDAD.MAKA_PYG_MENSUAL`"
_BQ_BALANCE_GRUPOS_TABLE  = "`proan-quantrue.D50_AGGREGATE_RENTABILIDAD.MAKA_BALANCE_GRUPOS`"
_BQ_ACREEDORES_TABLE      = "`proan-quantrue.D50_AGGREGATE_RENTABILIDAD.MAKA_ACREEDORES`"
_BQ_DEUDORES_TABLE        = "`proan-quantrue.D50_AGGREGATE_RENTABILIDAD.MAKA_DEUDORES`"
_CANAL_PARTES_RELACIONADAS = "06 - PARTES RELACIONADAS"

# Grupos de balance válidos para B4 (allow-list: el nombre de grupo se usa
# como nombre de columna en SQL, así que no puede parametrizarse).
_BALANCE_GRUPOS = frozenset({
    "bancos", "cxc", "inventarios", "anticipos", "iva_favor",
    "activo_fijo", "deprec_acum", "otros_activo",
    "cxp", "deuda_bancaria", "impuestos_pagar", "otros_pasivo",
    "capital_social", "utilidades_retenidas", "sin_clasificar",
})


def _sql_str(value: str) -> str:
    """Escapa un string para embeberlo literal en SQL de BigQuery (sin params)."""
    return str(value).replace("\\", "\\\\").replace("'", "\\'")

# ---------------------------------------------------------------------------
# Cliente LLM — se crea una sola vez por proceso
# ---------------------------------------------------------------------------

_client: OpenAI | None = None


def _get_llm_client() -> OpenAI:
    global _client
    if _client is None:
        base_url = os.environ["LLM_API_URL"].rstrip("/") + "/"
        _client = OpenAI(base_url=base_url, api_key=os.environ["LLM_API_KEY"])
    return _client


def _get_model() -> str:
    return os.environ.get("LLM_MODEL_ID", "gpt-4o-mini")


# ---------------------------------------------------------------------------
# Patrón causal por regla (tarjetas individuales, sin grouping)
# ---------------------------------------------------------------------------

_RULE_TO_PATTERN: dict[str, str] = {
    "V1": "ANOMALIA_VENTAS",
    "V3": "ANOMALIA_VENTAS",
    "V4": "CLIENTE_ANOMALO",
    "R1": "RITMO_VENTAS",
    "R4": "RITMO_CLIENTE_ANOMALO",
    "B1": "COMPRESION_MARGEN",
    "B2": "CAIDA_EBITDA",  # Se sobrescribe dinámicamente si es mejora
    "B3": "GASTOS_ANOMALOS",
    "B4": "GRUPO_BALANCE_ATIPICO",
    "A1": "ANOMALIA_ACREEDORES",
    "A2": "ANOMALIA_ACREEDORES",
    "A3": "PROVEEDOR_ANOMALO",
    "D1": "ANOMALIA_DEUDORES",
    "D2": "ANOMALIA_DEUDORES",
    "D3": "CLIENTE_MOROSO",
}


def get_causal_pattern(rule_id: str, delta_pct: float) -> str:
    """Retorna el patrón causal. Para B2, es dinámico según mejora/caída."""
    if rule_id == "B2":
        return "MEJORA_EBITDA" if delta_pct >= 0 else "CAIDA_EBITDA"
    return _RULE_TO_PATTERN.get(rule_id, "SIN_PATRON")


# ---------------------------------------------------------------------------
# Conexión BigQuery (Maka)
# ---------------------------------------------------------------------------


def _query(sql: str) -> list[dict]:
    df = read_sql(sql)
    return df.where(pd.notnull(df), None).to_dict(orient="records")


# ---------------------------------------------------------------------------
# Tool de tendencia histórica
# ---------------------------------------------------------------------------

def _periodo_bounds(current_periodo: str, n_periods: int) -> tuple[str, str, int, int]:
    """Devuelve (date_from, date_to, bal_from, bal_to) para las queries."""
    y, m = int(current_periodo[:4]), int(current_periodo[5:7])
    sm, sy = m - n_periods, y
    while sm <= 0:
        sm += 12
        sy -= 1
    import calendar as _cal
    end_day = _cal.monthrange(y, m)[1]
    return (
        f"{sy}-{sm:02d}-01",
        f"{y}-{m:02d}-{end_day}",
        sy * 100 + sm,
        y * 100 + m,
    )


def _classify_trend(history: list[dict]) -> dict:
    """Clasifica una serie temporal: PUNTUAL / TENDENCIA / ACELERACION."""
    values = [float(r["valor"]) for r in history if r.get("valor") is not None]
    if len(values) < 3:
        return {"trend_type": "INSUFICIENTE", "direction": "FLAT", "n_consecutive": 0}

    diffs = [values[i] - values[i - 1] for i in range(1, len(values))]
    last_dir = "UP" if diffs[-1] > 0 else ("DOWN" if diffs[-1] < 0 else "FLAT")

    # Contar cuántos periodos consecutivos en la misma dirección (desde el final)
    n = 1
    for d in reversed(diffs[:-1]):
        if (last_dir == "UP" and d > 0) or (last_dir == "DOWN" and d < 0):
            n += 1
        else:
            break

    if n < 3:
        return {"trend_type": "PUNTUAL", "direction": last_dir, "n_consecutive": n}

    # Detectar aceleración: cada paso > 15% más grande que el anterior
    recent = [abs(d) for d in diffs[-min(3, len(diffs)):]]
    is_acc = len(recent) >= 2 and all(recent[i] > recent[i - 1] * 1.15 for i in range(1, len(recent)))
    return {
        "trend_type":   "ACELERACION" if is_acc else "TENDENCIA",
        "direction":    last_dir,
        "n_consecutive": n,
    }


_PERIODO_BQ = "FORMAT_DATE('%Y-%m', billing_date)"


def _fetch_metric_history(
    rule_id: str,
    scope_id: str,
    current_periodo: str,
    n_periods: int,
) -> list[dict]:
    """Lanza la query BigQuery correspondiente al rule_id y devuelve historial ordenado."""
    date_from, date_to, bal_from, bal_to = _periodo_bounds(current_periodo, n_periods)
    p = rule_id[:2]

    if p == "V1":
        return _query(
            f"SELECT {_PERIODO_BQ} AS periodo, SUM(amount_mxn) AS valor"
            f" FROM {_BQ_VENTAS_TABLE}"
            f" WHERE billing_date BETWEEN '{date_from}' AND '{date_to}'"
            f"   AND UPPER(TRIM(distribution_channel)) != '{_CANAL_PARTES_RELACIONADAS}'"
            f" GROUP BY periodo ORDER BY periodo"
        )

    if p == "V3":
        return []  # HHI requiere cálculo Python, no se puede trivializar en SQL

    if p == "V4":
        cliente_id = _sql_str(scope_id)
        return _query(
            f"SELECT {_PERIODO_BQ} AS periodo, SUM(amount_mxn) AS valor"
            f" FROM {_BQ_VENTAS_TABLE}"
            f" WHERE CAST(customer_number AS STRING) = '{cliente_id}'"
            f"   AND billing_date BETWEEN '{date_from}' AND '{date_to}'"
            f" GROUP BY periodo ORDER BY periodo"
        )

    # R1/R4 — "ritmo" (mes a la fecha): cada mes histórico se acota al mismo
    # día calendario que hoy (o al último día de ese mes si es más corto).
    _MTD_DAY_COND = (
        "EXTRACT(DAY FROM billing_date) <= "
        "LEAST(EXTRACT(DAY FROM CURRENT_DATE()), EXTRACT(DAY FROM LAST_DAY(billing_date)))"
    )

    if p == "R1":
        return _query(
            f"SELECT {_PERIODO_BQ} AS periodo, SUM(amount_mxn) AS valor"
            f" FROM {_BQ_VENTAS_TABLE}"
            f" WHERE billing_date BETWEEN '{date_from}' AND '{date_to}'"
            f"   AND UPPER(TRIM(distribution_channel)) != '{_CANAL_PARTES_RELACIONADAS}'"
            f"   AND {_MTD_DAY_COND}"
            f" GROUP BY periodo ORDER BY periodo"
        )

    if p == "R4":
        cliente_id = _sql_str(scope_id)
        return _query(
            f"SELECT {_PERIODO_BQ} AS periodo, SUM(amount_mxn) AS valor"
            f" FROM {_BQ_VENTAS_TABLE}"
            f" WHERE CAST(customer_number AS STRING) = '{cliente_id}'"
            f"   AND billing_date BETWEEN '{date_from}' AND '{date_to}'"
            f"   AND {_MTD_DAY_COND}"
            f" GROUP BY periodo ORDER BY periodo"
        )

    if p == "B1":
        return _query(
            "SELECT CONCAT(CAST(anio AS STRING), '-', LPAD(CAST(mes AS STRING), 2, '0')) AS periodo,"
            " utilidad_bruta_pct AS valor"
            f" FROM {_BQ_PYG_MENSUAL_TABLE}"
            f" WHERE (anio * 100 + mes) BETWEEN {bal_from} AND {bal_to}"
            " ORDER BY anio, mes"
        )

    if p == "B2":
        return _query(
            "SELECT CONCAT(CAST(anio AS STRING), '-', LPAD(CAST(mes AS STRING), 2, '0')) AS periodo,"
            " ebitda AS valor"
            f" FROM {_BQ_PYG_MENSUAL_TABLE}"
            f" WHERE (anio * 100 + mes) BETWEEN {bal_from} AND {bal_to}"
            " ORDER BY anio, mes"
        )

    if p == "B3":
        return _query(
            "SELECT CONCAT(CAST(anio AS STRING), '-', LPAD(CAST(mes AS STRING), 2, '0')) AS periodo,"
            " ABS(gasto_operacion) AS valor"
            f" FROM {_BQ_PYG_MENSUAL_TABLE}"
            f" WHERE (anio * 100 + mes) BETWEEN {bal_from} AND {bal_to}"
            " ORDER BY anio, mes"
        )

    if p == "B4":
        grupo = str(scope_id).strip()
        if grupo not in _BALANCE_GRUPOS:
            return []
        return _query(
            "SELECT CONCAT(CAST(anio AS STRING), '-', LPAD(CAST(mes AS STRING), 2, '0')) AS periodo,"
            f" ABS({grupo}) AS valor"
            f" FROM {_BQ_BALANCE_GRUPOS_TABLE}"
            f" WHERE mes != 0 AND (anio * 100 + mes) BETWEEN {bal_from} AND {bal_to}"
            " ORDER BY anio, mes"
        )

    if p in ("A1", "A2"):
        table = _BQ_ACREEDORES_TABLE
        if p == "A1":
            valor_expr = "SUM(saldo_neto)"
        else:
            valor_expr = "SAFE_DIVIDE(SUM(bucket_90_mas), SUM(saldo_neto))"
        return _query(
            "SELECT CONCAT(CAST(anio AS STRING), '-', LPAD(CAST(mes AS STRING), 2, '0')) AS periodo,"
            f" {valor_expr} AS valor"
            f" FROM {table}"
            f" WHERE saldo_neto IS NOT NULL AND (anio * 100 + mes) BETWEEN {bal_from} AND {bal_to}"
            " GROUP BY anio, mes ORDER BY anio, mes"
        )

    if p == "A3":
        razon_social = _sql_str(scope_id)
        return _query(
            "SELECT CONCAT(CAST(anio AS STRING), '-', LPAD(CAST(mes AS STRING), 2, '0')) AS periodo,"
            " SUM(saldo_neto) AS valor"
            f" FROM {_BQ_ACREEDORES_TABLE}"
            f" WHERE razon_social = '{razon_social}'"
            f"   AND (anio * 100 + mes) BETWEEN {bal_from} AND {bal_to}"
            " GROUP BY anio, mes ORDER BY anio, mes"
        )

    if p in ("D1", "D2"):
        table = _BQ_DEUDORES_TABLE
        if p == "D1":
            valor_expr = "SUM(saldo_neto)"
        else:
            valor_expr = "SAFE_DIVIDE(SUM(bucket_90_mas), SUM(saldo_neto))"
        return _query(
            "SELECT CONCAT(CAST(anio AS STRING), '-', LPAD(CAST(mes AS STRING), 2, '0')) AS periodo,"
            f" {valor_expr} AS valor"
            f" FROM {table}"
            f" WHERE saldo_neto IS NOT NULL AND (anio * 100 + mes) BETWEEN {bal_from} AND {bal_to}"
            " GROUP BY anio, mes ORDER BY anio, mes"
        )

    if p == "D3":
        razon_social = _sql_str(scope_id)
        return _query(
            "SELECT CONCAT(CAST(anio AS STRING), '-', LPAD(CAST(mes AS STRING), 2, '0')) AS periodo,"
            " SUM(saldo_neto) AS valor"
            f" FROM {_BQ_DEUDORES_TABLE}"
            f" WHERE razon_social = '{razon_social}'"
            f"   AND (anio * 100 + mes) BETWEEN {bal_from} AND {bal_to}"
            " GROUP BY anio, mes ORDER BY anio, mes"
        )

    return []


def get_trend_history(
    rule_id: str,
    scope_id: str,
    current_periodo: str,
    n_periods: int = 6,
) -> dict:
    """Consulta historial de la métrica disparada y clasifica la tendencia.

    Returns:
        {
            "trend_type":    "PUNTUAL" | "TENDENCIA" | "ACELERACION" | "NO_DISPONIBLE",
            "direction":     "UP" | "DOWN" | "FLAT",
            "n_consecutive": int,
            "history":       [{"periodo": "2025-01", "valor": 1234.5}, ...]
        }
    """
    try:
        history = _fetch_metric_history(rule_id, scope_id, current_periodo, n_periods)
        if not history:
            return {"trend_type": "NO_DISPONIBLE", "direction": "FLAT", "n_consecutive": 0, "history": []}
        return {**_classify_trend(history), "history": history}
    except Exception as exc:
        log.warning("get_trend_history rule=%s scope=%s: %s", rule_id, scope_id, exc)
        return {"trend_type": "NO_DISPONIBLE", "direction": "FLAT", "n_consecutive": 0, "history": []}


def enrich_df_with_trend(df: pd.DataFrame, n_periods: int = 6) -> pd.DataFrame:
    """Añade columnas trend_type / trend_direction / trend_n al DataFrame de alertas.

    Cachea por (rule_id, scope_id, periodo) para evitar queries duplicadas.
    """
    if df.empty:
        return df.assign(trend_type="NO_DISPONIBLE", trend_direction="FLAT", trend_n=0)

    cache: dict[tuple, dict] = {}

    def _get(row: pd.Series) -> dict:
        key = (row["rule_id"], row["scope_id"], str(row["periodo"]))
        if key not in cache:
            cache[key] = get_trend_history(
                row["rule_id"], row["scope_id"], str(row["periodo"]), n_periods
            )
        return cache[key]

    results = df.apply(_get, axis=1)
    out = df.copy()
    out["trend_type"]      = results.apply(lambda r: r.get("trend_type",    "NO_DISPONIBLE"))
    out["trend_direction"] = results.apply(lambda r: r.get("direction",     "FLAT"))
    out["trend_n"]         = results.apply(lambda r: r.get("n_consecutive", 0))
    return out


# ---------------------------------------------------------------------------
# Resumen LLM por alerta individual
# ---------------------------------------------------------------------------

def summarize_alert(
    alerts: list[dict],
    causal_pattern: str,
    scope_id: str,
) -> dict[str, str]:
    """Genera título corto + frase explicativa para una historia.

    Returns:
        {"titulo": "Avicultura: caída 20%", "resumen": "Ventas ...´}
    """
    client = _get_llm_client()
    model  = _get_model()

    # Extraer nombre legible de la entidad desde el campo detalle
    # El detalle suele empezar con "NOMBRE CLIENTE: ..." o "NOMBRE: valor=..."
    entity_name = scope_id.split(":", 1)[-1] if ":" in scope_id else scope_id
    top_alerts = sorted(alerts, key=lambda x: x.get("score_riesgo", 0), reverse=True)
    for a in top_alerts[:3]:
        det0 = str(a.get("detalle", ""))
        if ":" in det0:
            candidate = det0.split(":")[0].strip()
            if 2 < len(candidate) < 50 and not candidate.replace(" ", "").isdigit():
                entity_name = candidate
                break

    bullets = []
    for a in top_alerts[:5]:
        det = str(a.get("detalle", ""))[:120].replace("\n", " ")
        trend_t  = a.get("trend_type",      "NO_DISPONIBLE")
        trend_d  = a.get("trend_direction", "FLAT")
        trend_n  = int(a.get("trend_n", 0) or 0)

        if trend_t in ("TENDENCIA", "ACELERACION"):
            dir_es  = "al alza" if trend_d == "UP" else "a la baja"
            accel   = " (acelerando)" if trend_t == "ACELERACION" else ""
            t_note  = f" | {trend_t}: {trend_n} meses consecutivos {dir_es}{accel}"
        elif trend_t == "PUNTUAL":
            t_note  = " | PUNTUAL: mes anterior era normal"
        else:
            t_note  = ""

        bullets.append(f"- [{a.get('rule_id')}] {det}{t_note}")
    alertas_txt = "\n".join(bullets)

    prompt = (
        f"Patrón detectado: {causal_pattern}\n"
        f"Entidad: {entity_name}\n"
        f"Alertas:\n{alertas_txt}\n\n"
        "Responde exactamente en 2 líneas, sin texto adicional:\n"
        "Línea 1: Título máx 6 palabras: nombre de la entidad + ':' + cambio clave en % o valor. "
        "Ejemplo: 'Avicultura: caída 20%'\n"
        "Línea 2: Una frase explicativa en español (máx 18 palabras) que amplíe el contexto."
    )

    fallback_titulo = scope_id.split(":", 1)[-1] if ":" in scope_id else scope_id
    fallback_resumen = (
        str(alerts[0].get("detalle", "")).split(".")[0][:120] if alerts else causal_pattern
    )

    try:
        resp = client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": "Eres un analista financiero. Responde siempre en español con frases muy concisas."},
                {"role": "user",   "content": prompt},
            ],
            # Gemini gasta tokens de razonamiento dentro de max_tokens: un límite
            # bajo devuelve contenido vacío. La brevedad la fija el prompt.
            max_tokens=1024,
            temperature=0.3,
        )
        lines = resp.choices[0].message.content.strip().split("\n", 1)
        titulo  = lines[0].strip() if lines else fallback_titulo
        resumen = lines[1].strip() if len(lines) > 1 else fallback_resumen
        return {"titulo": titulo, "resumen": resumen}
    except Exception as exc:
        log.warning("summarize_alert LLM error: %s", exc)
        return {"titulo": fallback_titulo, "resumen": fallback_resumen}


# ---------------------------------------------------------------------------
# Selección de alertas individuales por LLM
# ---------------------------------------------------------------------------

def _fmt_valor_compact(rule_id: str, valor: float) -> str:
    """Formatea el valor absoluto de forma compacta con unidad para el prompt LLM."""
    if valor is None:
        return "-"
    p = rule_id[:2] if len(rule_id) >= 2 else rule_id
    abs_v = abs(valor)
    currency = os.getenv("FINANCIALBI_CURRENCY", "MXN")

    if p in ("V1", "V4", "R1", "R4", "B2", "B3", "B4", "A1", "A3", "D1", "D3"):
        if abs_v >= 1_000_000:
            return f"{valor / 1_000_000:.1f}M {currency}"
        if abs_v >= 1_000:
            return f"{valor / 1_000:.0f}K {currency}"
        return f"{valor:.0f} {currency}"
    if p == "B1":
        return f"{valor * 100:.1f}%mg"   # margen guardado como ratio 0-1
    if p in ("A2", "D2"):
        return f"{valor * 100:.1f}%"   # ratios guardados como 0-1
    return f"{valor:.3f}"   # V3 (HHI)


def llm_select_top_alerts(alerts: list[dict], max_cards: int = 10) -> list[dict]:
    """El LLM decide cuáles son las alertas individuales más importantes.

    Recibe la lista completa de alertas ya filtradas (solo las que salieron de
    rango) y devuelve las max_cards más relevantes en orden de prioridad.

    Dale prioridad a las alertas B1 (Margen bruto %) y B2 (EBITDA) si tienen cambios significativos, ya que impactan directamente en la rentabilidad.
    
    Incluye cambios positivos relevantes, no solo negativos.

    Si el LLM falla, devuelve las primeras max_cards ordenadas por score_riesgo.
    """
    sorted_alerts = sorted(
        alerts, key=lambda a: a.get("score_riesgo", 0) or 0, reverse=True
    )
    fallback = sorted_alerts[:max_cards]

    if len(sorted_alerts) <= max_cards:
        return sorted_alerts

    lines = []
    for i, a in enumerate(sorted_alerts):
        delta     = float(a.get("delta_pct", 0.0) or 0.0)
        valor_raw = float(a.get("valor", 0.0) or 0.0)
        sign      = "▲" if delta > 0 else "▼"
        trend     = a.get("trend_type", "-") or "-"
        valor_fmt = _fmt_valor_compact(a.get("rule_id", ""), valor_raw)
        lines.append(
            f"{i} | {a.get('rule_id','')} | {a.get('scope_id','')} | "
            f"{valor_fmt} | {sign}{abs(delta)*100:.0f}% | {a.get('tier','')} | {trend}"
        )

    tabla = "\n".join(lines)
    prompt = (
        f"Tienes {len(sorted_alerts)} anomalías financieras detectadas este mes.\n"
        "Columnas: índice | regla | entidad | valor_actual | Δ% | tier | tendencia\n\n"
        f"{tabla}\n\n"
        f"Elige los {max_cards} más relevantes para el comité directivo.\n"
        "Criterio: impacto MONETARIO real — una cuenta de 5K€ con 500% de cambio\n"
        "es menos importante que un EBITDA de 1M€ con 15% de caída.\n"
        "Un cambio positivo notable (▲) también cuenta si el valor es significativo.\n"
        "Responde SOLO con los índices en orden de importancia, separados por coma.\n"
        "Sin texto adicional. Ejemplo: 3,7,0,12,5"
    )

    try:
        client = _get_llm_client()
        model  = _get_model()
        resp = client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": "Eres analista financiero. Responde exactamente en el formato solicitado."},
                {"role": "user",   "content": prompt},
            ],
            # Ver nota en summarize_alert: el razonamiento de Gemini consume max_tokens.
            max_tokens=1024,
            temperature=0.1,
        )
        raw = resp.choices[0].message.content.strip()
        indices: list[int] = []
        seen: set[int] = set()
        for token in raw.replace("\n", ",").split(","):
            try:
                idx = int(token.strip())
                if 0 <= idx < len(sorted_alerts) and idx not in seen:
                    indices.append(idx)
                    seen.add(idx)
            except ValueError:
                continue
        if not indices:
            log.warning("llm_select_top_alerts: respuesta no parseable: %s", raw[:200])
            return fallback
        return [sorted_alerts[i] for i in indices[:max_cards]]
    except Exception as exc:
        log.warning("llm_select_top_alerts error: %s", exc)
        return fallback

