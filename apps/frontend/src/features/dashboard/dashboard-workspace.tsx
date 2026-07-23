"use client";

import { useMemo, useState } from "react";
import type { DashboardData, DashboardGastoItem } from "@/types/dashboard";

type Props = {
  initialData: DashboardData | null;
  initialError: string | null;
};

const money = new Intl.NumberFormat("es-MX", { maximumFractionDigits: 0 });
const MAX_FILAS = 10;

function formatMoney(value: number | null | undefined) {
  return `${money.format(value || 0)} MXN`;
}

function readError(response: Response, fallback: string) {
  return response.json().then((body: { detail?: string }) => body.detail || fallback).catch(() => fallback);
}

function GastoLista({ items, titulo }: { items: DashboardGastoItem[]; titulo: string }) {
  const visibles = items.slice(0, MAX_FILAS);
  const max = Math.max(1, ...items.map((item) => item.importe_gas || 0));
  const restantes = items.length - visibles.length;
  return (
    <div className="dashboard-card">
      <h3>{titulo}</h3>
      {visibles.length ? (
        <ul className="dashboard-bar-list">
          {visibles.map((item) => (
            <li className="dashboard-bar-row" key={item.grupo}>
              <span className="dashboard-bar-label" title={item.grupo}>{item.grupo}</span>
              <div className="dashboard-bar-track" aria-hidden="true">
                <div className="dashboard-bar-fill" style={{ width: `${Math.max(2, ((item.importe_gas || 0) / max) * 100)}%` }} />
              </div>
              <span className="dashboard-bar-value">{formatMoney(item.importe_gas)}</span>
              <span className="dashboard-bar-count">{item.n_facturas} fact.</span>
            </li>
          ))}
        </ul>
      ) : <p className="dashboard-empty">Sin datos todavía.</p>}
      {restantes > 0 ? <p className="dashboard-more">y {restantes} más (no mostrados)</p> : null}
    </div>
  );
}

export function DashboardWorkspace({ initialData, initialError }: Props) {
  const [data, setData] = useState(initialData);
  const [error, setError] = useState(initialError);
  const [busy, setBusy] = useState(false);

  const r = data?.resumen;
  const canceladasHayAlgo = (r?.canceladas_sat || 0) > 0;

  async function refresh() {
    setBusy(true); setError(null);
    try {
      const response = await fetch("/api/financialbi/hidrocarburos/dashboard", { cache: "no-store" });
      if (!response.ok) throw new Error(await readError(response, "No se pudo actualizar el dashboard."));
      setData(await response.json());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo actualizar el dashboard.");
    } finally { setBusy(false); }
  }

  const periodoOrdenado = useMemo(() => data?.gasto_por_periodo ?? [], [data]);

  return <div className="approval-page dashboard-page">
    <header className="approval-header">
      <div><p>Hidrocarburos</p><h1>Dashboard</h1></div>
      <button aria-label="Actualizar dashboard" className="approval-refresh" disabled={busy} onClick={() => refresh()} title="Actualizar" type="button">↻</button>
    </header>

    {error ? <p className="approval-error" role="alert">{error}</p> : null}

    <section className="dashboard-kpis" aria-label="Resumen de estatus">
      <div className="dashboard-kpi"><span>Total facturas</span><strong>{r?.total_facturas ?? "—"}</strong></div>
      <div className="dashboard-kpi"><span>Pendientes Compras</span><strong>{r?.pendientes ?? "—"}</strong></div>
      <div className="dashboard-kpi"><span>Validadas</span><strong>{r?.validadas ?? "—"}</strong></div>
      <div className="dashboard-kpi"><span>Aprobadas</span><strong>{r?.aprobadas ?? "—"}</strong></div>
      <div className="dashboard-kpi"><span>Rechazadas</span><strong>{r?.rechazadas ?? "—"}</strong></div>
      <div className="dashboard-kpi dashboard-kpi-money"><span>Importe de gas total</span><strong>{formatMoney(r?.importe_gas_total)}</strong></div>
    </section>

    <section className="dashboard-kpis dashboard-kpis-sat" aria-label="Estatus ante el SAT">
      <div className="dashboard-kpi dashboard-kpi-good"><span>Vigentes (SAT)</span><strong>{r?.vigentes_sat ?? "—"}</strong></div>
      <div className={`dashboard-kpi${canceladasHayAlgo ? " dashboard-kpi-critical" : ""}`}>
        <span>Canceladas (SAT){canceladasHayAlgo ? " ⚠" : ""}</span><strong>{r?.canceladas_sat ?? "—"}</strong>
      </div>
      <div className="dashboard-kpi dashboard-kpi-muted"><span>Sin confirmar (SAT)</span><strong>{r?.sin_confirmar_sat ?? "—"}</strong></div>
    </section>

    <section className="dashboard-grid">
      <GastoLista items={data?.gasto_por_ceco ?? []} titulo="Gasto por CECO" />
      <GastoLista items={data?.gasto_por_sitio ?? []} titulo="Gasto por sitio" />
      <GastoLista items={periodoOrdenado} titulo="Gasto por periodo (mensual)" />
    </section>
  </div>;
}
