"""Job de materialización de alertas e historias — llena las tablas gold en BigQuery.

Dos etapas, ambas reutilizando código existente TAL CUAL (cero traducción):

1. ALERTAS (run_all_alerts/run_ritmo_alerts de alertas_engine.py): elegir el
   periodo, descartar filas rule_id="ERROR" (van a los logs, no a gold),
   tipar columnas al esquema gold, y escribir con DELETE+INSERT en
   GOLD_ALERTAS_MENSUAL / GOLD_ALERTAS_RITMO.

2. HISTORIAS (enrich_df_with_trend/llm_select_top_alerts/summarize_alert de
   agente.py — lo que antes hacía app._build_historias_payload en cada
   request): lee las alertas YA materializadas en gold (no recalcula),
   enriquece con tendencia, el LLM elige el top-15 y redacta cada tarjeta,
   y el resultado se congela en GOLD_HISTORIAS_MENSUAL / GOLD_HISTORIAS_RITMO.
   Requiere credenciales LLM (LLM_API_URL / LLM_API_KEY / LLM_MODEL_ID).

Política de escritura por tabla:
  - GOLD_ALERTAS_MENSUAL: DELETE+INSERT del periodo. Por qué no MERGE: el
    conjunto de scope_id que califica en una corrida puede cambiar respecto a
    la anterior (ej. qué clientes entran al top-15 de V4/A3/D3/R4). Un MERGE
    por clave natural dejaría "huérfanas" las filas que ya no califican.
  - GOLD_HISTORIAS_MENSUAL: INMUTABLE — si el mes ya tiene filas, el job se
    niega a reescribirlo (el texto LLM se genera una sola vez por mes
    cerrado; regenerar requiere borrado manual consciente).
  - GOLD_ALERTAS_RITMO / GOLD_HISTORIAS_RITMO: PURGA TOTAL + INSERT en cada
    corrida (`_replace_ritmo`, no `_replace_period`) — estas dos tablas NUNCA
    deben contener más de un mes (el mes en curso). FIX 2026-07-20: la
    versión anterior solo borraba el periodo de HOY antes de insertar
    (`_replace_period`), así que el mes anterior se quedaba acumulado para
    siempre en cuanto cambiaba el mes (nadie lo borraba). Confirmado en
    BigQuery que esto todavía no se había manifestado (el pipeline no había
    cruzado un cambio de mes), pero era cuestión de tiempo.

Uso:
    python -m financialbi.materialize_alerts mensual [--period 2026-06]
    python -m financialbi.materialize_alerts ritmo
    python -m financialbi.materialize_alerts historias [--period 2026-06]
    python -m financialbi.materialize_alerts historias-ritmo

Pensado para correr como Cloud Run Job disparado por Cloud Scheduler —
por ahora se corre a mano mientras se valida el diseño con el cliente.
Requiere una service account de BigQuery con permiso de ESCRITURA (la que
usa el servicio web hoy es de solo lectura).
"""

from __future__ import annotations

import argparse
import logging
import os
import subprocess
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date, timedelta

import pandas as pd

try:
    from db import _get_bq_client
    from alertas_engine import (
        AlertConfig,
        run_all_alerts,
        run_ritmo_alerts,
        load_alerts_from_gold,
        load_alerts_from_gold_ritmo,
    )
    from agente import (
        enrich_df_with_trend,
        llm_select_top_alerts,
        summarize_alert,
        get_causal_pattern,
        _get_model,
    )
except ImportError:
    from financialbi.db import _get_bq_client
    from financialbi.alertas_engine import (
        AlertConfig,
        run_all_alerts,
        run_ritmo_alerts,
        load_alerts_from_gold,
        load_alerts_from_gold_ritmo,
    )
    from financialbi.agente import (
        enrich_df_with_trend,
        llm_select_top_alerts,
        summarize_alert,
        get_causal_pattern,
        _get_model,
    )

log = logging.getLogger(__name__)

_PROJECT = "proan-quantrue"
_DATASET = "D60_REPORTING"
_TABLE_MENSUAL = f"{_PROJECT}.{_DATASET}.MAKA_GOLD_ALERTAS_MENSUAL"
_TABLE_RITMO = f"{_PROJECT}.{_DATASET}.MAKA_GOLD_ALERTAS_RITMO"
_TABLE_HISTORIAS_MENSUAL = f"{_PROJECT}.{_DATASET}.MAKA_GOLD_HISTORIAS_MENSUAL"
_TABLE_HISTORIAS_RITMO = f"{_PROJECT}.{_DATASET}.MAKA_GOLD_HISTORIAS_RITMO"

# Máximo de tarjetas por periodo (el LLM elige las MAX_CARDS más relevantes).
MAX_CARDS = 15

# Placeholder a validar con el equipo/cliente (ver conversación sobre "mes
# cerrado"): un mes se considera cerrado a partir de este día del mes
# siguiente.
CLOSED_MONTH_MIN_DAY = 6


def _engine_version() -> str:
    """SHA corto del commit desplegado. Prioridad: env var explícita > git local > 'unknown'."""
    explicit = os.getenv("ENGINE_VERSION") or os.getenv("GIT_SHA")
    if explicit:
        return explicit
    try:
        return subprocess.check_output(
            ["git", "rev-parse", "--short", "HEAD"], stderr=subprocess.DEVNULL
        ).decode().strip()
    except Exception:
        return "unknown"


def _resolve_closed_period(today: date | None = None) -> str:
    """Devuelve el último mes "cerrado" (YYYY-MM) según el placeholder de día 6."""
    today = today or date.today()
    first_of_this_month = today.replace(day=1)
    last_month_end = first_of_this_month - timedelta(days=1)
    if today.day >= CLOSED_MONTH_MIN_DAY:
        target = last_month_end
    else:
        target = last_month_end.replace(day=1) - timedelta(days=1)
    return target.strftime("%Y-%m")


def _to_gold_rows(
    df: pd.DataFrame, engine_version: str, extra_cols: dict | None = None
) -> pd.DataFrame:
    """Convierte el DataFrame de run_all_alerts/run_ritmo_alerts al esquema gold."""
    errors = df[df["rule_id"] == "ERROR"]
    for _, row in errors.iterrows():
        log.warning("Detector con error (no se escribe a gold): %s", row.get("detalle"))

    real = df[df["rule_id"] != "ERROR"].copy()
    if real.empty:
        return real

    out = pd.DataFrame({
        "rule_id":        real["rule_id"],
        "periodo_date":   pd.to_datetime(real["periodo"], format="%Y-%m").dt.date,
        "scope_id":       real["scope_id"],
        "valor":          real["valor"],
        "umbral":         real["umbral"],
        "delta_pct":      real["delta_pct"],
        "detalle":        real["detalle"],
        "score_riesgo":   real["score_riesgo"],
        "tier":           real["tier"],
        "generated_at":   pd.Timestamp.now(tz="UTC"),
        "engine_version": engine_version,
    })
    if extra_cols:
        for col, value in extra_cols.items():
            out[col] = value
    return out


def _replace_period(client, table: str, rows: pd.DataFrame, periodo_date: str) -> None:
    """Borra las filas de ese periodo y las reinserta (ver docstring del módulo).
    Uso: tablas MENSUAL (históricas, acumulan un periodo más en cada corrida)."""
    client.query(
        f"DELETE FROM `{table}` WHERE periodo_date = DATE('{periodo_date}')"
    ).result()

    if rows.empty:
        log.info("Sin alertas para %s en %s — periodo queda vacío.", table, periodo_date)
        return

    job = client.load_table_from_dataframe(rows, table)
    job.result()
    log.info("Escritas %d filas en %s para periodo %s.", len(rows), table, periodo_date)


def _replace_ritmo(client, table: str, rows: pd.DataFrame, periodo_date: str) -> None:
    """Purga la tabla ENTERA antes de insertar (ver FIX 2026-07-20 en el
    docstring del módulo). Uso: tablas *_RITMO — solo deben contener el mes
    en curso, nunca histórico, así que un DELETE acotado al periodo de hoy
    (como hace `_replace_period`) deja "huérfano" cualquier mes anterior que
    haya quedado de una corrida pasada."""
    client.query(f"DELETE FROM `{table}` WHERE TRUE").result()

    if rows.empty:
        log.info("Sin alertas de ritmo para %s en %s — tabla queda vacía.", table, periodo_date)
        return

    job = client.load_table_from_dataframe(rows, table)
    job.result()
    log.info(
        "Escritas %d filas en %s para periodo %s (tabla purgada antes de insertar).",
        len(rows), table, periodo_date,
    )


def materialize_mensual(period: str | None = None) -> None:
    target_period = period or _resolve_closed_period()
    log.info("Materializando alertas mensuales para %s", target_period)

    df = run_all_alerts(cfg=AlertConfig(), target_period=target_period)
    gold_rows = _to_gold_rows(df, _engine_version())

    client = _get_bq_client()
    _replace_period(client, _TABLE_MENSUAL, gold_rows, f"{target_period}-01")


def materialize_ritmo() -> None:
    df, meta = run_ritmo_alerts(cfg=AlertConfig())
    if meta["too_early"]:
        log.info(
            "Día %s del mes, antes del mínimo (%s) — no se materializa ritmo hoy.",
            meta["day_of_month"], meta["min_day"],
        )
        return

    periodo_date = date.today().replace(day=1).isoformat()
    gold_rows = _to_gold_rows(
        df, _engine_version(), extra_cols={"cutoff_day": meta["cutoff_day"]}
    )

    client = _get_bq_client()
    _replace_ritmo(client, _TABLE_RITMO, gold_rows, periodo_date)


# ---------------------------------------------------------------------------
# Historias — tarjetas top-15 con texto LLM, congeladas en gold
# ---------------------------------------------------------------------------


def _build_historias_rows(
    alerts_df: pd.DataFrame, engine_version: str, extra_cols: dict | None = None
) -> pd.DataFrame:
    """Convierte alertas gold en tarjetas de historia (esquema GOLD_HISTORIAS_*).

    Mismo flujo que hacía app._build_historias_payload en cada request:
    enriquecer con tendencia → LLM elige top-MAX_CARDS → LLM redacta cada
    tarjeta (en paralelo). Aquí corre una sola vez y el resultado se congela.
    """
    real = alerts_df[alerts_df["rule_id"] != "ERROR"]
    if real.empty:
        return pd.DataFrame()

    real = enrich_df_with_trend(real)
    alerts_list = real.to_dict(orient="records")
    log.info("Historias: %d alertas candidatas, seleccionando top-%d…", len(alerts_list), MAX_CARDS)

    selected = llm_select_top_alerts(alerts_list, max_cards=MAX_CARDS)

    def _summarize(a: dict) -> dict:
        return summarize_alert(
            alerts=[a],
            causal_pattern=get_causal_pattern(a.get("rule_id", ""), float(a.get("delta_pct", 0) or 0)),
            scope_id=a.get("scope_id", ""),
        )

    with ThreadPoolExecutor(max_workers=8) as pool:
        futures = {pool.submit(_summarize, a): i for i, a in enumerate(selected)}
        resumenes: dict[int, dict] = {}
        for fut in as_completed(futures):
            idx = futures[fut]
            try:
                resumenes[idx] = fut.result()
            except Exception as exc:
                log.warning("summarize_alert fallo idx=%d: %s", idx, exc)
                a = selected[idx]
                resumenes[idx] = {
                    "titulo":  a.get("rule_id", ""),
                    "resumen": str(a.get("detalle", ""))[:80],
                }

    rows = []
    for i, a in enumerate(selected):
        rows.append({
            "periodo_date":    pd.to_datetime(a["periodo"], format="%Y-%m").date(),
            "orden":           i + 1,
            "rule_id":         a.get("rule_id", ""),
            "scope_id":        a.get("scope_id", ""),
            "titulo_llm":      resumenes.get(i, {}).get("titulo", a.get("rule_id", "")),
            "resumen_llm":     resumenes.get(i, {}).get("resumen", str(a.get("detalle", ""))[:80]),
            "causal_pattern":  get_causal_pattern(a.get("rule_id", ""), float(a.get("delta_pct", 0) or 0)),
            "trend_type":      a.get("trend_type", "NO_DISPONIBLE"),
            "trend_direction": a.get("trend_direction", "FLAT"),
            "trend_n":         int(a.get("trend_n", 0) or 0),
            "valor":           a.get("valor"),
            "umbral":          a.get("umbral"),
            "delta_pct":       a.get("delta_pct"),
            "detalle":         a.get("detalle"),
            "score_riesgo":    int(a.get("score_riesgo", 0) or 0),
            "tier":            a.get("tier"),
            "generated_at":    pd.Timestamp.now(tz="UTC"),
            "engine_version":  engine_version,
            "llm_model":       _get_model(),
        })
    out = pd.DataFrame(rows)
    if extra_cols:
        for col, value in extra_cols.items():
            out[col] = value
    return out


def materialize_historias(period: str | None = None) -> None:
    """Genera y congela las historias de un mes cerrado. INMUTABLE: si el mes
    ya tiene historias no hace nada (regenerar exige borrado manual)."""
    target_period = period or _resolve_closed_period()
    periodo_date = f"{target_period}-01"
    client = _get_bq_client()

    existing = list(client.query(
        f"SELECT COUNT(*) AS n FROM `{_TABLE_HISTORIAS_MENSUAL}` "
        f"WHERE periodo_date = DATE('{periodo_date}')"
    ).result())[0].n
    if existing > 0:
        log.warning(
            "GOLD_HISTORIAS_MENSUAL ya tiene %d filas para %s — mes inmutable, no se regenera.",
            existing, target_period,
        )
        return

    alerts_df = load_alerts_from_gold(target_period)
    if alerts_df.empty:
        log.info(
            "Sin alertas materializadas en GOLD_ALERTAS_MENSUAL para %s — "
            "no hay historias que generar (¿falta correr 'mensual' para ese mes?).",
            target_period,
        )
        return

    rows = _build_historias_rows(alerts_df, _engine_version())
    if rows.empty:
        log.info("Historias vacías para %s — no se escribe nada.", target_period)
        return

    job = client.load_table_from_dataframe(rows, _TABLE_HISTORIAS_MENSUAL)
    job.result()
    log.info(
        "Escritas %d historias en %s para periodo %s.",
        len(rows), _TABLE_HISTORIAS_MENSUAL, target_period,
    )


def materialize_historias_ritmo() -> None:
    """Genera las historias del mes en curso (MTD). Se reescribe en cada corrida."""
    alerts_df, meta = load_alerts_from_gold_ritmo()
    if meta["too_early"]:
        log.info(
            "Día %s del mes, antes del mínimo (%s) — no se materializan historias de ritmo hoy.",
            meta["day_of_month"], meta["min_day"],
        )
        return

    periodo_date = date.today().replace(day=1).isoformat()
    rows = _build_historias_rows(
        alerts_df, _engine_version(), extra_cols={"cutoff_day": meta["cutoff_day"]}
    )

    client = _get_bq_client()
    _replace_ritmo(client, _TABLE_HISTORIAS_RITMO, rows, periodo_date)


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="mode", required=True)

    mensual_parser = subparsers.add_parser("mensual", help="Materializa alertas de un mes cerrado")
    mensual_parser.add_argument(
        "--period", default=None,
        help="Periodo YYYY-MM a materializar. Si se omite, se calcula el último mes cerrado.",
    )

    subparsers.add_parser("ritmo", help="Materializa alertas de ritmo (mes a la fecha) del mes en curso")

    historias_parser = subparsers.add_parser(
        "historias", help="Genera y congela las historias (top-15 con texto LLM) de un mes cerrado"
    )
    historias_parser.add_argument(
        "--period", default=None,
        help="Periodo YYYY-MM. Si se omite, se calcula el último mes cerrado.",
    )

    subparsers.add_parser(
        "historias-ritmo", help="Genera las historias de ritmo (mes a la fecha) del mes en curso"
    )

    args = parser.parse_args()
    if args.mode == "mensual":
        materialize_mensual(args.period)
    elif args.mode == "ritmo":
        materialize_ritmo()
    elif args.mode == "historias":
        materialize_historias(args.period)
    else:
        materialize_historias_ritmo()


if __name__ == "__main__":
    main()
