"""
Diagnóstico de signo y escala del campo balance en balance_cuentas.
Compara revenue/COGs/opex del balance vs importe_neto_sinIVA de facturacion.
"""
import sys
sys.path.insert(0, "/app/apps/financialbi")

import pandas as pd
from financialbi.alertas_engine import load_data, AlertConfig, _REVENUE_CATS_PATTERN, _OPEX_CATS_PATTERN

cfg = AlertConfig()
SOCIEDAD = "S01"
PERIOD   = "2025-05"

data = load_data(sociedad=SOCIEDAD, target_period=PERIOD, lookback_months=max(cfg.lookback_months, cfg.seasonal_history_months))
bal  = data["balance"]
fact = data["facturacion"]

target = pd.Period(PERIOD, freq="M")

# Filtrar solo el mes objetivo
bal_t  = bal[bal["periodo"].eq(target)].copy()
fact_t = fact[fact["periodo"].eq(target)].copy()

print(f"\n=== BALANCE tabla — S01, {PERIOD} ===")
print(f"Total filas: {len(bal_t)}")
print(f"\nColumnas disponibles: {list(bal_t.columns)}")

# Mostrar valores RAW del campo balance por categoria_pyg
print(f"\n--- SUMA de 'balance' (haber-deber) por categoria_pyg ---")
resumen = (
    bal_t.groupby("categoria_pyg")[["balance", "mov_abs"]]
    .agg({"balance": "sum", "mov_abs": "sum", })
    .assign(n=bal_t.groupby("categoria_pyg")["balance"].count())
    .sort_values("balance", ascending=False)
)
print(resumen.to_string())

# Clasificación por tipo
rev_mask  = bal_t["categoria_pyg"].astype(str).str.contains(_REVENUE_CATS_PATTERN, case=False, na=False, regex=True)
cogs_mask = bal_t["categoria_pyg"].astype(str).str.contains("COGs", case=False, na=False)
opex_mask = bal_t["categoria_pyg"].astype(str).str.contains(_OPEX_CATS_PATTERN, case=False, na=False, regex=True)

ventas_bal = bal_t[rev_mask]["mov_abs"].sum()
cogs_bal   = bal_t[cogs_mask]["mov_abs"].sum()
opex_bal   = bal_t[opex_mask]["mov_abs"].sum()

# Para entender el signo: también sumamos balance SIN abs
ventas_raw = bal_t[rev_mask]["balance"].sum()
cogs_raw   = bal_t[cogs_mask]["balance"].sum()
opex_raw   = bal_t[opex_mask]["balance"].sum()

print(f"\n--- CÁLCULO EBITDA con mov_abs (fórmula actual B11) ---")
print(f"  ventas (mov_abs):  {ventas_bal:>15,.2f} EUR")
print(f"  cogs   (mov_abs):  {cogs_bal:>15,.2f} EUR")
print(f"  opex   (mov_abs):  {opex_bal:>15,.2f} EUR")
print(f"  EBITDA actual:     {ventas_bal - cogs_bal - opex_bal:>15,.2f} EUR  <--- ¿correcto?")

print(f"\n--- CÁLCULO EBITDA con balance SIGNED (haber-deber) ---")
print(f"  ventas (balance):  {ventas_raw:>15,.2f} EUR")
print(f"  cogs   (balance):  {cogs_raw:>15,.2f} EUR  (positivo = más haber que deber = crédito neto)")
print(f"  opex   (balance):  {opex_raw:>15,.2f} EUR")
print(f"  EBITDA signed:     {ventas_raw - cogs_raw - opex_raw:>15,.2f} EUR  <--- si ingresos>0 y costes<0, sumar")
print(f"  EBITDA alternativo (ventas + cogs + opex signed): {ventas_raw + cogs_raw + opex_raw:>15,.2f} EUR")

print(f"\n--- REFERENCIA: facturacion importe_neto_sinIVA ---")
print(f"  Total fact S01 {PERIOD}: {fact_t['importe_neto_sinIVA'].sum():>15,.2f} EUR")

print(f"\n--- DETALLE filas balance para revenue categories ---")
print(bal_t[rev_mask][["categoria_pyg", "cuenta", "desc_cuenta", "deber", "haber", "balance", "mov_abs"]].to_string())
print(f"\n--- DETALLE filas balance para COGs ---")
print(bal_t[cogs_mask][["categoria_pyg", "cuenta", "desc_cuenta", "deber", "haber", "balance", "mov_abs"]].to_string())
