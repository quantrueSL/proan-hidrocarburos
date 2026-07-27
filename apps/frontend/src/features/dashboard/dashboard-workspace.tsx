"use client";

import { useState } from "react";
import { FiltersSidebar } from "@/components/filters-sidebar";
import type { DashboardData, DashboardFiltros } from "@/types/dashboard";
import type { HydrocarburosOption } from "@/types/hidrocarburos";
import { Donut, RankedBarChart, TrendChart } from "./charts";
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
  const activeFilterCount = [
    filters.fecha_desde, filters.fecha_hasta, filters.proveedor_id,
    filters.estado_sap, filters.confianza_mseg, filters.estatus_sat
  ].filter(Boolean).length;

  const r = data?.resumen;

  async function refresh(nextFilters = filters) {
    setBusy(true); setError(null);
    try {
      const response = await fetch(`/api/financialbi/hidrocarburos/dashboard${toQueryString(nextFilters)}`, { cache: "no-store" });
      if (!response.ok) throw new Error(await readError(response, "No se pudo actualizar el dashboard."));
      setData(await response.json());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo actualizar el dashboard.");
    } finally { setBusy(false); }
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

    <section className={`dashboard-grid dashboard-grid-status${busy ? " is-loading" : ""}`}>
      <Donut segments={flujoSegments} titulo="Flujo de aprobación" />
      <Donut segments={satSegments} titulo="Estatus ante el SAT" />
      <Donut segments={msegSegments} titulo="Recepción MSEG" />
      <Donut segments={sapSegments} titulo="Validado SAP" />
    </section>

    <section className={`dashboard-grid dashboard-grid-2x2${busy ? " is-loading" : ""}`}>
      <TrendChart fixedMetric="facturas" items={data?.gasto_por_periodo ?? []} titulo="Facturas por periodo (mensual)" />
      <RankedBarChart fixedMetric="facturas" items={data?.gasto_por_proveedor ?? []} titulo="Facturas por proveedor" />
      <RankedBarChart fixedMetric="facturas" items={data?.gasto_por_sitio ?? []} titulo="Facturas por sitio" />
      <RankedBarChart fixedMetric="facturas" items={data?.cobertura_ceco_sitio ?? []} maxRows={4} titulo="Cobertura CECO / sitio" />
    </section>
    </div>
  </div>;
}
