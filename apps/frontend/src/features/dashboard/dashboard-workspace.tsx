"use client";

import { useEffect, useState } from "react";
import { FiltersSidebar } from "@/components/filters-sidebar";
import type {
  DashboardData, DashboardFiltros, DashboardGastoItem, DashboardInvoiceDetail, DashboardSatDetail
} from "@/types/dashboard";
import type { HydrocarburosOption } from "@/types/hidrocarburos";
import {
  Donut, formatLiters, formatMoney, formatMonth, MetricToggle, RankedBarChart, TrendChart
} from "./charts";
import type { DashboardMetric, StatusSegment } from "./charts";

type Props = {
  initialData: DashboardData | null;
  initialError: string | null;
  proveedores: HydrocarburosOption[];
  ultimaActualizacion?: string | null;
};

type InteractiveFilterKey = "periodo" | "proveedor_id" | "sitio" | "ceco" | "nucleo" | "estado_aprobacion" | "estatus_sat" | "confianza_mseg" | "estado_sap";

// Debe coincidir exactamente con la etiqueta que arma dashboard_engine.py
// (_gasto_por_ceco) para las facturas con varios CECO reales sin confirmar
// por ticket todavía -- marca esa barra con tono de aviso (ver charts.tsx).
const VARIOS_CECO_LABEL = "Varios CECO (sin confirmar)";

// Debe coincidir exactamente con la etiqueta que arma dashboard_engine.py
// (_gasto_por_nucleo) para las facturas cuyo CeCo no está (todavía) en el
// cruce Núcleo<->CeCo confirmado -- ver HALLAZGOS-FER.md secc. 11.
const SIN_NUCLEO_LABEL = "Sin núcleo asignado";

const APPROVAL_LABEL: Record<string, string> = {
  pendiente_validacion_compras: "Pendiente Compras",
  pendiente_aprobacion_gerencia: "Pendiente Gerencia",
  aprobada: "Aprobada",
  rechazada: "Rechazada"
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
  const [metric, setMetric] = useState<DashboardMetric>("facturas");
  const [selectionLabels, setSelectionLabels] = useState<Partial<Record<InteractiveFilterKey, string>>>({});
  const [detail, setDetail] = useState<DashboardInvoiceDetail | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [satDetail, setSatDetail] = useState<DashboardSatDetail | null>(null);
  const [satDetailError, setSatDetailError] = useState<string | null>(null);
  const [satDetailLoading, setSatDetailLoading] = useState(false);
  const [satModalOpen, setSatModalOpen] = useState(false);
  const [satView, setSatView] = useState<"cancelado" | "sin_confirmar">("cancelado");
  const activeFilterCount = [
    filters.fecha_desde, filters.fecha_hasta, filters.proveedor_id,
    filters.estado_sap, filters.confianza_mseg, filters.estatus_sat,
    filters.periodo, filters.sitio, filters.ceco, filters.nucleo, filters.estado_aprobacion
  ].filter(Boolean).length;

  const r = data?.resumen;
  const totalFacturas = r?.total_facturas ?? 0;
  const coberturaSap = totalFacturas ? Math.round(((r?.validadas_sap ?? 0) / totalFacturas) * 100) : 0;
  const requierenAtencion = (r?.pendientes ?? 0) + (r?.pendientes_gerencia ?? 0) + (r?.rechazadas ?? 0);
  const metricLabel = metric === "importe" ? "Coste" : metric === "litros" ? "Litros" : "Facturas";
  const filterChips: { key: keyof DashboardFiltros; label: string }[] = [
    ...(filters.fecha_desde ? [{ key: "fecha_desde" as const, label: `Desde: ${filters.fecha_desde}` }] : []),
    ...(filters.fecha_hasta ? [{ key: "fecha_hasta" as const, label: `Hasta: ${filters.fecha_hasta}` }] : []),
    ...(filters.proveedor_id ? [{
      key: "proveedor_id" as const,
      label: `Proveedor: ${proveedores.find((item) => item.id === filters.proveedor_id)?.nombre || selectionLabels.proveedor_id || filters.proveedor_id}`
    }] : []),
    ...(filters.periodo ? [{ key: "periodo" as const, label: `Periodo: ${selectionLabels.periodo || formatMonth(filters.periodo)}` }] : []),
    ...(filters.sitio ? [{ key: "sitio" as const, label: `Centro: ${selectionLabels.sitio || filters.sitio}` }] : []),
    ...(filters.ceco ? [{
      key: "ceco" as const,
      label: `CECO: ${selectionLabels.ceco || (filters.ceco === "__SIN_CECO__" ? "Sin CECO" : filters.ceco === "__VARIOS_CECO__" ? VARIOS_CECO_LABEL : filters.ceco)}`
    }] : []),
    ...(filters.nucleo ? [{
      key: "nucleo" as const,
      label: `Núcleo: ${selectionLabels.nucleo || (filters.nucleo === "__SIN_NUCLEO__" ? SIN_NUCLEO_LABEL : filters.nucleo)}`
    }] : []),
    ...(filters.estado_aprobacion ? [{
      key: "estado_aprobacion" as const,
      label: `Flujo: ${APPROVAL_LABEL[filters.estado_aprobacion] || filters.estado_aprobacion}`
    }] : []),
    ...(filters.estatus_sat ? [{
      key: "estatus_sat" as const,
      label: `SAT: ${filters.estatus_sat === "sin_confirmar" ? "Sin confirmar" : filters.estatus_sat === "cancelado" ? "Cancelada" : "Vigente"}`
    }] : []),
    ...(filters.confianza_mseg ? [{
      key: "confianza_mseg" as const,
      label: `MSEG: ${filters.confianza_mseg === "sin_evidencia" ? "Sin evidencia" : filters.confianza_mseg}`
    }] : []),
    ...(filters.estado_sap ? [{
      key: "estado_sap" as const,
      label: `SAP: ${filters.estado_sap === "validada_sap" ? "Validada" : "Sin match"}`
    }] : [])
  ];

  useEffect(() => {
    if (!satModalOpen && !detailOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setSatModalOpen(false);
        setDetailOpen(false);
      }
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [satModalOpen, detailOpen]);

  async function refresh(nextFilters = filters) {
    setBusy(true); setError(null);
    try {
      const response = await fetch(`/api/financialbi/hidrocarburos/dashboard${toQueryString(nextFilters)}`, { cache: "no-store" });
      if (!response.ok) throw new Error(await readError(response, "No se pudo actualizar el dashboard."));
      setData(await response.json());
      setSatDetail(null);
      setDetail(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo actualizar el dashboard.");
    } finally { setBusy(false); }
  }

  async function toggleFilter(key: InteractiveFilterKey, value: string, label: string) {
    if (busy) return;
    const removing = filters[key] === value;
    const nextFilters = { ...filters, [key]: removing ? null : value };
    setFilters(nextFilters);
    setSelectionLabels((current) => ({ ...current, [key]: removing ? undefined : label }));
    await refresh(nextFilters);
  }

  async function toggleChartFilter(key: Extract<InteractiveFilterKey, "periodo" | "proveedor_id" | "sitio" | "ceco" | "nucleo">, item: DashboardGastoItem) {
    await toggleFilter(key, item.filtro, item.grupo);
  }

  async function clearFilter(key: keyof DashboardFiltros) {
    const nextFilters = { ...filters, [key]: null };
    setFilters(nextFilters);
    setSelectionLabels((current) => {
      const next = { ...current };
      delete next[key as InteractiveFilterKey];
      return next;
    });
    await refresh(nextFilters);
  }

  async function resetFilters() {
    setFilters({});
    setSelectionLabels({});
    await refresh({});
  }

  async function openDetail() {
    setDetailOpen(true);
    setDetailLoading(true);
    setDetailError(null);
    try {
      const query = toQueryString(filters);
      const response = await fetch(
        `/api/financialbi/hidrocarburos/dashboard${query || "?"}${query ? "&" : ""}detalle=true`,
        { cache: "no-store" }
      );
      if (!response.ok) throw new Error(await readError(response, "No se pudieron cargar las facturas."));
      setDetail(await response.json());
    } catch (cause) {
      setDetailError(cause instanceof Error ? cause.message : "No se pudieron cargar las facturas.");
    } finally {
      setDetailLoading(false);
    }
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
    { label: "Pendiente Compras", value: r?.pendientes ?? 0, tone: "neutral", filterValue: "pendiente_validacion_compras" },
    { label: "Pendiente Gerencia", value: r?.pendientes_gerencia ?? 0, tone: "warning", filterValue: "pendiente_aprobacion_gerencia" },
    { label: "Aprobada", value: r?.aprobadas ?? 0, tone: "good", filterValue: "aprobada" },
    { label: "Rechazada", value: r?.rechazadas ?? 0, tone: "critical", filterValue: "rechazada" }
  ];
  const satSegments: StatusSegment[] = [
    { label: "Vigente (SAT)", value: r?.vigentes_sat ?? 0, tone: "good", filterValue: "vigente" },
    { label: "Sin confirmar (SAT)", value: r?.sin_confirmar_sat ?? 0, tone: "neutral", filterValue: "sin_confirmar" },
    { label: "Cancelada (SAT)", value: r?.canceladas_sat ?? 0, tone: "critical", filterValue: "cancelado" }
  ];
  const msegSegments: StatusSegment[] = [
    { label: "MSEG Alta", value: r?.mseg_alta ?? 0, tone: "good", filterValue: "Alta" },
    { label: "MSEG Media", value: r?.mseg_media ?? 0, tone: "warning", filterValue: "Media" },
    { label: "Sin evidencia MSEG", value: r?.mseg_sin_evidencia ?? 0, tone: "neutral", filterValue: "sin_evidencia" }
  ];
  const sapSegments: StatusSegment[] = [
    { label: "Validado", value: r?.validadas_sap ?? 0, tone: "good", filterValue: "validada_sap" },
    { label: "No validado", value: (r?.total_facturas ?? 0) - (r?.validadas_sap ?? 0), tone: "neutral", filterValue: "sin_match_sap" }
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
        <button className="hydro-link-button" onClick={resetFilters} type="button">Restablecer</button>
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

    <section className="dashboard-selection-bar" aria-label="Filtros activos">
      <div className="dashboard-filter-chips">
        {filterChips.length ? filterChips.map((chip) => (
          <button key={chip.key} onClick={() => clearFilter(chip.key)} title={`Quitar ${chip.label}`} type="button">
            {chip.label}<span aria-hidden="true">×</span>
          </button>
        )) : <span>Selecciona un segmento, barra o mes para cruzar los datos.</span>}
      </div>
      <div className="dashboard-selection-actions">
        {filterChips.length ? <button className="hydro-link-button" onClick={resetFilters} type="button">Limpiar todo</button> : null}
        <button className="hydro-button" disabled={busy || detailLoading} onClick={openDetail} type="button">Ver facturas</button>
      </div>
    </section>

    <section className={`dashboard-grid dashboard-grid-status${busy ? " is-loading" : ""}`}>
      <Donut
        activeFilter={filters.estado_aprobacion}
        onSelect={(segment) => toggleFilter("estado_aprobacion", segment.filterValue, segment.label)}
        segments={flujoSegments}
        titulo="Flujo de aprobación"
      />
      <Donut
        action={<button className="dashboard-donut-detail-button" onClick={openSatDetail} type="button">Ver facturas</button>}
        activeFilter={filters.estatus_sat}
        onSelect={(segment) => toggleFilter("estatus_sat", segment.filterValue, segment.label)}
        segments={satSegments}
        titulo="Estatus ante el SAT"
      />
      <Donut
        activeFilter={filters.confianza_mseg}
        onSelect={(segment) => toggleFilter("confianza_mseg", segment.filterValue, segment.label)}
        segments={msegSegments}
        titulo="Recepción MSEG"
      />
      <Donut
        activeFilter={filters.estado_sap}
        onSelect={(segment) => toggleFilter("estado_sap", segment.filterValue, segment.label)}
        segments={sapSegments}
        titulo="Validado SAP"
      />
    </section>

    <section className="dashboard-analysis">
      <div className="dashboard-analysis-head">
        <h2>Análisis</h2>
        <MetricToggle metric={metric} onChange={setMetric} />
      </div>
      <div className={`dashboard-grid dashboard-grid-2x2${busy ? " is-loading" : ""}`}>
        <TrendChart
          activeFilter={filters.periodo}
          items={data?.gasto_por_periodo ?? []}
          metric={metric}
          onSelect={(item) => toggleChartFilter("periodo", item)}
          titulo={`${metricLabel} por periodo (mensual)`}
        />
        <RankedBarChart
          activeFilter={filters.proveedor_id}
          items={data?.gasto_por_proveedor ?? []}
          metric={metric}
          onSelect={(item) => toggleChartFilter("proveedor_id", item)}
          titulo={`${metricLabel} por proveedor`}
        />
        <RankedBarChart
          activeFilter={filters.sitio}
          items={data?.gasto_por_sitio ?? []}
          metric={metric}
          onSelect={(item) => toggleChartFilter("sitio", item)}
          titulo={`${metricLabel} por centro`}
        />
        <RankedBarChart
          activeFilter={filters.ceco}
          items={data?.gasto_por_ceco ?? []}
          metric={metric}
          onSelect={(item) => toggleChartFilter("ceco", item)}
          titulo={`${metricLabel} por CECO`}
          warnLabel={VARIOS_CECO_LABEL}
        />
        <RankedBarChart
          activeFilter={filters.nucleo}
          items={data?.gasto_por_nucleo ?? []}
          metric={metric}
          onSelect={(item) => toggleChartFilter("nucleo", item)}
          titulo={`${metricLabel} por núcleo`}
          warnLabel={SIN_NUCLEO_LABEL}
        />
      </div>
    </section>

    {detailOpen ? (
      <div className="dashboard-modal-backdrop" onMouseDown={(event) => {
        if (event.currentTarget === event.target) setDetailOpen(false);
      }}>
        <section aria-labelledby="dashboard-detail-modal-title" aria-modal="true" className="dashboard-sat-modal dashboard-invoice-modal" role="dialog">
          <header>
            <div>
              <p>Datos subyacentes</p>
              <h2 id="dashboard-detail-modal-title">Facturas de la selección actual</h2>
              <span>
                {detail ? `${detail.total} factura${detail.total === 1 ? "" : "s"} en total` : "Aplicando los filtros activos"}
                {detail && detail.total > detail.rows.length ? ` · mostrando las primeras ${detail.rows.length}` : ""}
              </span>
            </div>
            <button aria-label="Cerrar detalle" onClick={() => setDetailOpen(false)} type="button">×</button>
          </header>
          <div className="dashboard-sat-table-wrap">
            {detailLoading ? <p className="dashboard-sat-message">Cargando facturas…</p> : null}
            {detailError ? <p className="approval-error" role="alert">{detailError}</p> : null}
            {!detailLoading && !detailError ? (
              detail?.rows.length ? (
                <table>
                  <thead>
                    <tr>
                      <th>Fecha</th><th>Proveedor</th><th>Folio</th><th>Coste</th><th>Litros</th>
                      <th>Flujo</th><th>SAP</th><th>SAT</th><th>MSEG</th><th>Centro</th><th>CECO</th><th>Núcleo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.rows.map((row) => (
                      <tr key={row.uuid}>
                        <td>{row.fecha ? new Date(`${row.fecha}T00:00:00`).toLocaleDateString("es-MX") : "—"}</td>
                        <td>{row.proveedor || "—"}</td>
                        <td>{`${row.serie || ""}${row.folio || ""}` || "—"}</td>
                        <td>{formatMoney(row.importe_gas)}</td>
                        <td>{formatLiters(row.volumen_litros)}</td>
                        <td>{APPROVAL_LABEL[row.estado_aprobacion] || row.estado_aprobacion}</td>
                        <td>{row.estado_sap === "validada_sap" ? "Validada" : "Sin match"}</td>
                        <td>{row.estatus_sat === "sin_confirmar" ? "Sin confirmar" : row.estatus_sat === "cancelado" ? "Cancelada" : "Vigente"}</td>
                        <td>{row.confianza_mseg === "sin_evidencia" ? "Sin evidencia" : row.confianza_mseg}</td>
                        <td>{row.sitio || "—"}</td>
                        <td>{row.ceco || "—"}</td>
                        <td>{row.nucleo || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : <p className="dashboard-sat-message">No hay facturas con esta combinación de filtros.</p>
            ) : null}
          </div>
        </section>
      </div>
    ) : null}

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
