"use client";

import { useEffect, useState } from "react";
import { FiltersSidebar } from "@/components/filters-sidebar";
import type { DashboardData, DashboardFiltros, DashboardSatDetail } from "@/types/dashboard";
import type { HydrocarburosOption } from "@/types/hidrocarburos";
import { Donut, formatMoney, RankedBarChart, TrendChart } from "./charts";
import type { StatusSegment } from "./charts";

type Props = {
  initialData: DashboardData | null;
  initialError: string | null;
  proveedores: HydrocarburosOption[];
  ultimaActualizacion?: string | null;
};

function readError(response: Response, fallback: string) {
  return response.json().then((body: { detail?: string }) => body.detail || fallback).catch(() => fallback);
}

function toQueryString(filtros: DashboardFiltros): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filtros)) if (value) params.set(key, String(value));
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

export function DashboardWorkspace({ initialData, initialError, proveedores, ultimaActualizacion }: Props) {
  const [data, setData] = useState(initialData);
  const [error, setError] = useState(initialError);
  const [busy, setBusy] = useState(false);
  const [filters, setFilters] = useState<DashboardFiltros>({});
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [satDetail, setSatDetail] = useState<DashboardSatDetail | null>(null);
  const [satDetailError, setSatDetailError] = useState<string | null>(null);
  const [satDetailLoading, setSatDetailLoading] = useState(false);
  const [satModalOpen, setSatModalOpen] = useState(false);
  const [satView, setSatView] = useState<"cancelado" | "sin_confirmar">("cancelado");
  const activeFilterCount = [
    filters.fecha_desde, filters.fecha_hasta, filters.proveedor_id,
    filters.estado_sap, filters.confianza_mseg, filters.estatus_sat
  ].filter(Boolean).length;

  const r = data?.resumen;
  const totalFacturas = r?.total_facturas ?? 0;
  const coberturaSap = totalFacturas ? Math.round(((r?.validadas_sap ?? 0) / totalFacturas) * 100) : 0;
  const requierenAtencion = (r?.pendientes ?? 0) + (r?.pendientes_gerencia ?? 0) + (r?.rechazadas ?? 0);

  useEffect(() => {
    if (!satModalOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSatModalOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [satModalOpen]);

  async function refresh(nextFilters = filters) {
    setBusy(true); setError(null);
    try {
      const response = await fetch(`/api/financialbi/hidrocarburos/dashboard${toQueryString(nextFilters)}`, { cache: "no-store" });
      if (!response.ok) throw new Error(await readError(response, "No se pudo actualizar el dashboard."));
      setData(await response.json());
      setSatDetail(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo actualizar el dashboard.");
    } finally { setBusy(false); }
  }

  async function openSatDetail() {
    setSatModalOpen(true);
    setSatDetailLoading(true);
    setSatDetailError(null);
    setSatView((r?.canceladas_sat ?? 0) ? "cancelado" : "sin_confirmar");
    try {
      const query = toQueryString(filters);
      const response = await fetch(
        `/api/financialbi/hidrocarburos/dashboard${query || "?"}${query ? "&" : ""}detalle_sat=true`,
        { cache: "no-store" }
      );
      if (!response.ok) throw new Error(await readError(response, "No se pudieron cargar las facturas SAT."));
      setSatDetail(await response.json());
    } catch (cause) {
      setSatDetailError(cause instanceof Error ? cause.message : "No se pudieron cargar las facturas SAT.");
    } finally {
      setSatDetailLoading(false);
    }
  }

  const flujoSegments: StatusSegment[] = [
    { label: "Pendiente Compras", value: r?.pendientes ?? 0, tone: "neutral" },
    { label: "Pendiente Gerencia", value: r?.pendientes_gerencia ?? 0, tone: "warning" },
    { label: "Aprobada", value: r?.aprobadas ?? 0, tone: "good" },
    { label: "Rechazada", value: r?.rechazadas ?? 0, tone: "critical" }
  ];
  const satSegments: StatusSegment[] = [
    { label: "Vigente (SAT)", value: r?.vigentes_sat ?? 0, tone: "good" },
    { label: "Sin confirmar (SAT)", value: r?.sin_confirmar_sat ?? 0, tone: "neutral" },
    { label: "Cancelada (SAT)", value: r?.canceladas_sat ?? 0, tone: "critical" }
  ];
  const msegSegments: StatusSegment[] = [
    { label: "MSEG Alta", value: r?.mseg_alta ?? 0, tone: "good" },
    { label: "MSEG Media", value: r?.mseg_media ?? 0, tone: "warning" },
    { label: "Sin evidencia MSEG", value: r?.mseg_sin_evidencia ?? 0, tone: "neutral" }
  ];
  const sapSegments: StatusSegment[] = [
    { label: "Validado", value: r?.validadas_sap ?? 0, tone: "good" },
    { label: "No validado", value: (r?.total_facturas ?? 0) - (r?.validadas_sap ?? 0), tone: "neutral" }
  ];

  return <div className="workspace-with-sidebar">
    <FiltersSidebar
      activeCount={activeFilterCount}
      info={<>
        <p>Resume el estado operativo de las facturas y la cobertura de las evidencias SAP, SAT y MSEG.</p>
        <h3>Qué significa cada bloque</h3>
        <ul>
          <li><b>Flujo:</b> situación entre Compras y Gerencia.</li>
          <li><b>SAT:</b> vigencia fiscal conocida de los CFDI.</li>
          <li><b>MSEG:</b> evidencia de recepción de mercancía.</li>
          <li><b>SAP:</b> facturas relacionadas con un documento contable.</li>
        </ul>
      </>}
      infoTitle="Dashboard de Hidrocarburos"
      onToggle={() => setFiltersOpen((v) => !v)}
      open={filtersOpen}
      updatedAt={ultimaActualizacion}
    >
      <label>Desde<input onChange={(e) => setFilters({ ...filters, fecha_desde: e.target.value || null })} type="date" value={filters.fecha_desde || ""} /></label>
      <label>Hasta<input onChange={(e) => setFilters({ ...filters, fecha_hasta: e.target.value || null })} type="date" value={filters.fecha_hasta || ""} /></label>
      <label>Proveedor<select value={filters.proveedor_id || ""} onChange={(e) => setFilters({ ...filters, proveedor_id: e.target.value || null })}><option value="">Todos</option>{proveedores.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}</select></label>
      <label>Validado SAP<select value={filters.estado_sap || ""} onChange={(e) => setFilters({ ...filters, estado_sap: (e.target.value || null) as DashboardFiltros["estado_sap"] })}><option value="">Todos</option><option value="validada_sap">Validada</option><option value="sin_match_sap">Sin match</option></select></label>
      <label>Recepción MSEG<select value={filters.confianza_mseg || ""} onChange={(e) => setFilters({ ...filters, confianza_mseg: (e.target.value || null) as DashboardFiltros["confianza_mseg"] })}><option value="">Todas</option><option value="Alta">Alta</option><option value="Media">Media</option><option value="sin_evidencia">Sin evidencia</option></select></label>
      <label>Estatus SAT<select value={filters.estatus_sat || ""} onChange={(e) => setFilters({ ...filters, estatus_sat: (e.target.value || null) as DashboardFiltros["estatus_sat"] })}><option value="">Todos</option><option value="vigente">Vigente</option><option value="cancelado">Cancelado</option><option value="sin_confirmar">Sin confirmar</option></select></label>
      <div className="filters-sidebar-actions">
        <button className="hydro-button" disabled={busy} onClick={() => refresh()} type="button">{busy ? "Actualizando…" : "Aplicar filtros"}</button>
        <button className="hydro-link-button" onClick={() => { setFilters({}); refresh({}); }} type="button">Restablecer</button>
      </div>
    </FiltersSidebar>
    <div className="approval-page dashboard-page">
    {error ? <p className="approval-error" role="alert">{error}</p> : null}

    <header className="dashboard-summary">
      <div className="dashboard-summary-title">
        <p>Visión ejecutiva</p>
        <h1>Dashboard de Hidrocarburos</h1>
        <span>Seguimiento operativo, fiscal y contable de las facturas de gas.</span>
      </div>
      <div className="dashboard-summary-kpis" aria-label="Resumen ejecutivo">
        <div><span>Gasto total</span><strong>{formatMoney(r?.importe_gas_total)}</strong></div>
        <div><span>Facturas</span><strong>{totalFacturas}</strong></div>
        <div><span>Cobertura SAP</span><strong>{coberturaSap}%</strong></div>
        <div className={requierenAtencion ? "is-attention" : "is-good"}><span>Requieren atención</span><strong>{requierenAtencion}</strong></div>
      </div>
    </header>

    <section className={`dashboard-grid dashboard-grid-status${busy ? " is-loading" : ""}`}>
      <Donut segments={flujoSegments} titulo="Flujo de aprobación" />
      <Donut
        action={<button className="dashboard-donut-detail-button" onClick={openSatDetail} type="button">Ver facturas</button>}
        segments={satSegments}
        titulo="Estatus ante el SAT"
      />
      <Donut segments={msegSegments} titulo="Recepción MSEG" />
      <Donut segments={sapSegments} titulo="Validado SAP" />
    </section>

    <section className={`dashboard-grid dashboard-grid-2x2${busy ? " is-loading" : ""}`}>
      <TrendChart fixedMetric="facturas" items={data?.gasto_por_periodo ?? []} titulo="Facturas por periodo (mensual)" />
      <RankedBarChart fixedMetric="facturas" items={data?.gasto_por_proveedor ?? []} titulo="Facturas por proveedor" />
      <RankedBarChart fixedMetric="facturas" items={data?.gasto_por_sitio ?? []} titulo="Facturas por centro" />
      <RankedBarChart fixedMetric="facturas" items={data?.gasto_por_ceco ?? []} titulo="Facturas por CECO" />
    </section>

    {satModalOpen ? (
      <div className="dashboard-modal-backdrop" onMouseDown={(event) => {
        if (event.currentTarget === event.target) setSatModalOpen(false);
      }}>
        <section aria-labelledby="dashboard-sat-modal-title" aria-modal="true" className="dashboard-sat-modal" role="dialog">
          <header>
            <div>
              <p>Detalle fiscal</p>
              <h2 id="dashboard-sat-modal-title">Facturas que requieren atención ante el SAT</h2>
              <span>Consulta las facturas canceladas y aquellas cuyo estado todavía no está confirmado.</span>
            </div>
            <button aria-label="Cerrar detalle SAT" onClick={() => setSatModalOpen(false)} type="button">×</button>
          </header>

          <div className="dashboard-sat-tabs" role="tablist" aria-label="Estado SAT">
            <button aria-selected={satView === "cancelado"} onClick={() => setSatView("cancelado")} role="tab" type="button">
              Canceladas <strong>{satDetail?.canceladas ?? r?.canceladas_sat ?? 0}</strong>
            </button>
            <button aria-selected={satView === "sin_confirmar"} onClick={() => setSatView("sin_confirmar")} role="tab" type="button">
              Sin confirmar <strong>{satDetail?.sin_confirmar ?? r?.sin_confirmar_sat ?? 0}</strong>
            </button>
          </div>

          <div className="dashboard-sat-table-wrap">
            {satDetailLoading ? <p className="dashboard-sat-message">Cargando facturas…</p> : null}
            {satDetailError ? <p className="approval-error" role="alert">{satDetailError}</p> : null}
            {!satDetailLoading && !satDetailError ? (
              (satDetail?.rows.filter((row) => row.estatus_sat === satView).length ?? 0) ? (
                <table>
                  <thead><tr><th>Fecha</th><th>Proveedor</th><th>Folio</th><th>Importe gas</th><th>Estado SAT</th></tr></thead>
                  <tbody>
                    {satDetail?.rows.filter((row) => row.estatus_sat === satView).map((row) => (
                      <tr key={row.uuid}>
                        <td>{row.fecha ? new Date(`${row.fecha}T00:00:00`).toLocaleDateString("es-MX") : "—"}</td>
                        <td>{row.proveedor || "—"}</td>
                        <td>{`${row.serie || ""}${row.folio || ""}` || "—"}</td>
                        <td>{formatMoney(row.importe_gas)}</td>
                        <td><span className={`dashboard-sat-status is-${row.estatus_sat}`}>{row.estatus_sat === "cancelado" ? "Cancelada" : "Sin confirmar"}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : <p className="dashboard-sat-message">No hay facturas en este estado con los filtros actuales.</p>
            ) : null}
          </div>
        </section>
      </div>
    ) : null}
    </div>
  </div>;
}
