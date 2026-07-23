"use client";

import { useState } from "react";
import type {
  HydrocarburosCatalog,
  HydrocarburosFilters,
  HydrocarburosInvoiceDetail,
  HydrocarburosInvoiceRow,
  HydrocarburosSearchResponse,
  HydrocarburosSummary
} from "@/types/hidrocarburos";

type Props = {
  initialCatalog: HydrocarburosCatalog;
  initialError: string | null;
  initialFilters: HydrocarburosFilters;
  initialInvoices: HydrocarburosSearchResponse | null;
  initialModule: "m1" | "m2";
  initialSummary: HydrocarburosSummary | null;
};

const money = {
  format(value: number) {
    return `${new Intl.NumberFormat("es-MX", { maximumFractionDigits: 0 }).format(value)} MXN`;
  }
};
const number = new Intl.NumberFormat("es-MX");
const dateFormatter = new Intl.DateTimeFormat("es-MX", { dateStyle: "medium" });

function formatDate(value: string | null | undefined) {
  if (!value) return "—";
  return dateFormatter.format(new Date(`${value.slice(0, 10)}T12:00:00`));
}

function statusLabel(status: string | null | undefined) {
  return status === "validada_sap" ? "Validada SAP" : "Sin match SAP";
}

function classificationLabel(isMixed: boolean) {
  return isMixed ? "Mixta" : "Gas";
}

function readError(response: Response, fallback: string) {
  return response.json().then((body: { detail?: string }) => body.detail || fallback).catch(() => fallback);
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!response.ok) throw new Error(await readError(response, "No se pudo actualizar la información."));
  return response.json() as Promise<T>;
}

function Kpi({ label, value, note }: { label: string; value: string; note?: string }) {
  return <div className="hydro-kpi"><span>{label}</span><strong>{value}</strong>{note ? <small>{note}</small> : null}</div>;
}

function DetailPanel({ invoice, loading, error, module, onClose }: {
  invoice: HydrocarburosInvoiceDetail | null; loading: boolean; error: string | null; module: "m1" | "m2"; onClose: () => void;
}) {
  if (!invoice && !loading && !error) return null;
  return (
    <>
      <button aria-label="Cerrar detalle" className="hydro-detail-backdrop" onClick={onClose} type="button" />
      <aside className={`hydro-detail hydro-detail--${module}`} aria-label="Detalle de factura" role="dialog" aria-modal="true">
        <div className="hydro-detail-header"><div><p>Detalle de factura</p><h2>{invoice?.serie || ""}{invoice?.folio || ""}</h2></div><button onClick={onClose} type="button" aria-label="Cerrar detalle">×</button></div>
        {loading ? <p className="hydro-muted">Cargando evidencia…</p> : null}
        {error ? <p className="hydro-error">{error}</p> : null}
        {invoice ? <div className="hydro-detail-body">
          <section><h3>CFDI y clasificación</h3><dl>
            <dt>Proveedor</dt><dd>{invoice.proveedor}</dd><dt>UUID</dt><dd className="hydro-uuid">{invoice.uuid}</dd>
            <dt>Fecha</dt><dd>{formatDate(invoice.fecha as string)}</dd><dt>Importe gas</dt><dd>{money.format(Number(invoice.importe_gas || 0))}</dd>
            <dt>Factura mixta</dt><dd>{invoice.es_mixta ? "Sí" : "No"}</dd><dt>Total CFDI</dt><dd>{money.format(Number(invoice.total || 0))}</dd>
          </dl></section>
          <section><h3>Validación SAP</h3><dl>
            <dt>Estado</dt><dd><span className={`hydro-badge ${invoice.estado_sap === "validada_sap" ? "is-ok" : "is-review"}`}>{statusLabel(invoice.estado_sap as string)}</span></dd>
            <dt>Documento SAP</dt><dd>{String(invoice.belnr_sap || "—")}</dd><dt>Tipo de match</dt><dd>{String(invoice.tipo_match_sap || "—")}</dd>
            <dt>Días de diferencia</dt><dd>{invoice.dias_diferencia == null ? "—" : String(invoice.dias_diferencia)}</dd>
          </dl></section>
          <section><h3>Sitio y recepción</h3><dl>
            <dt>Sitio de consumo</dt><dd>{String(invoice.sitio_consumo || "Pendiente de captura manual")}</dd><dt>Centro</dt><dd>{String(invoice.werks || "—")}</dd>
            <dt>Recepción MSEG</dt><dd>{invoice.tiene_recepcion_mseg ? "Confirmada" : "No disponible"}</dd>
            {invoice.tiene_recepcion_mseg ? <><dt>Cantidad MSEG</dt><dd>{String(invoice.mseg_cantidad || "—")}</dd><dt>Importe MSEG</dt><dd>{money.format(Number(invoice.mseg_importe || 0))}</dd></> : null}
          </dl></section>
        </div> : null}
      </aside>
    </>
  );
}

export function HydrocarburosWorkspace({ initialCatalog, initialError, initialFilters, initialInvoices, initialModule, initialSummary }: Props) {
  const [filters, setFilters] = useState<HydrocarburosFilters>(initialFilters);
  const [summary, setSummary] = useState(initialSummary);
  const [invoices, setInvoices] = useState(initialInvoices);
  const [error, setError] = useState(initialError);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<HydrocarburosInvoiceDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  async function load(page = 1, nextFilters = filters) {
    setLoading(true); setError(null);
    try {
      const [nextSummary, nextInvoices] = await Promise.all([
        postJson<HydrocarburosSummary>("/api/financialbi/hidrocarburos/summary", nextFilters),
        postJson<HydrocarburosSearchResponse>("/api/financialbi/hidrocarburos/invoices/search", { ...nextFilters, page, page_size: 50 })
      ]);
      setSummary(nextSummary); setInvoices(nextInvoices);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "No se pudo cargar la bandeja."); }
    finally { setLoading(false); }
  }

  async function openDetail(row: HydrocarburosInvoiceRow) {
    setSelected(null); setDetailError(null); setDetailLoading(true);
    try {
      const response = await fetch(`/api/financialbi/hidrocarburos/invoices/${encodeURIComponent(row.uuid)}`);
      if (!response.ok) throw new Error(await readError(response, "No se pudo cargar el detalle."));
      setSelected(await response.json() as HydrocarburosInvoiceDetail);
    } catch (cause) { setDetailError(cause instanceof Error ? cause.message : "No se pudo cargar el detalle."); }
    finally { setDetailLoading(false); }
  }

  const total = summary?.facturas || 0;
  const page = invoices?.page || 1;
  const pages = invoices ? Math.max(1, Math.ceil(invoices.total / invoices.page_size)) : 1;
  const reset = { fecha_desde: initialCatalog.fecha_minima, fecha_hasta: initialCatalog.fecha_maxima, sitio: "all" as const };
  const isM1 = initialModule === "m1";
  const moduleTitle = isM1 ? "Clasificación CFDI" : "Validación SAP";
  const moduleDescription = isM1
    ? "Identifica el gasto de gas y separa las facturas con conceptos mixtos."
    : "Comprueba el registro de cada factura contra SAP, sitio y recepción MSEG.";

  if (error && (!summary || !invoices)) {
    return <div className="hydro-page" data-module={initialModule} data-module-description={moduleDescription} data-module-title={moduleTitle}>
      <header className="hydro-header"><div><p>Control operativo · M1 y M2</p><h1>Hidrocarburos</h1><span>Clasificación CFDI y validación contra SAP</span></div></header>
      <section className="hydro-unavailable" role="alert"><div><b>No se pudo cargar la bandeja</b><p>El servicio de Hidrocarburos no está disponible. Reinicia <code>carb-financialbi-dev</code> y vuelve a intentarlo.</p></div><button className="hydro-button" onClick={() => load(1)} type="button">Reintentar</button></section>
    </div>;
  }

  return <div className="hydro-page" data-module={initialModule} data-module-description={moduleDescription} data-module-title={moduleTitle}>
    <header className="hydro-header"><div><p>Control operativo · M1 y M2</p><h1>Hidrocarburos</h1><span>Clasificación CFDI y validación contra SAP</span></div></header>
    <section className="hydro-filters" aria-label="Filtros de la bandeja">
      <label>Desde<input type="date" value={filters.fecha_desde || ""} onChange={(e) => setFilters({ ...filters, fecha_desde: e.target.value || null })} /></label>
      <label>Hasta<input type="date" value={filters.fecha_hasta || ""} onChange={(e) => setFilters({ ...filters, fecha_hasta: e.target.value || null })} /></label>
      <label>Proveedor<select value={filters.proveedor_id || ""} onChange={(e) => setFilters({ ...filters, proveedor_id: e.target.value || null })}><option value="">Todos</option>{initialCatalog.proveedores.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}</select></label>
      {!isM1 ? <label>Estado SAP<select value={filters.estado_sap || ""} onChange={(e) => setFilters({ ...filters, estado_sap: (e.target.value || null) as HydrocarburosFilters["estado_sap"] })}><option value="">Todos</option><option value="validada_sap">Validada SAP</option><option value="sin_match_sap">Sin match SAP</option></select></label> : null}
      {!isM1 ? <label>Sitio<select value={filters.sitio || "all"} onChange={(e) => setFilters({ ...filters, sitio: e.target.value as HydrocarburosFilters["sitio"] })}><option value="all">Todos</option><option value="with_site">Con sitio</option><option value="without_site">Sin sitio</option></select></label> : null}
      <div className="hydro-filter-actions"><button className="hydro-button" disabled={loading} onClick={() => load(1)} type="button">{loading ? "Actualizando…" : "Aplicar filtros"}</button><button className="hydro-link-button" onClick={() => { setFilters(reset); load(1, reset); }} type="button">Restablecer</button></div>
    </section>
    {error ? <p className="hydro-error">{error}</p> : null}
    <section className="hydro-module-kpis" aria-label={`Indicadores ${isM1 ? "M1" : "M2"}`}>
      {isM1 ? <>
        <Kpi label="Facturas CFDI" value={number.format(total)} />
        <Kpi label="Importe gas" value={money.format(Number(summary?.importe_gas || 0))} />
        <Kpi label="Facturas mixtas" value={number.format(summary?.facturas_mixtas || 0)} />
        <Kpi label="Solo gas" value={number.format(Math.max(0, total - (summary?.facturas_mixtas || 0)))} />
      </> : <>
        <Kpi label="Facturas evaluadas" value={number.format(total)} />
        <Kpi label="Validada SAP" value={`${number.format(summary?.validadas_sap || 0)} / ${number.format(total)}`} />
        <Kpi label="Sin match SAP" value={number.format(Math.max(0, total - (summary?.validadas_sap || 0)))} />
        <Kpi label="Con sitio" value={`${number.format(summary?.con_sitio || 0)} / ${number.format(total)}`} />
        <Kpi label="Recepción MSEG" value={number.format(summary?.con_recepcion_mseg || 0)} />
      </>}
    </section>
    {isM1 ? <section className="hydro-table-card hydro-module-table">
      <div className="hydro-table-title"><div><p>M1 · Clasificación</p><h2>Facturas clasificadas</h2><span>{invoices ? `${number.format(invoices.total)} resultados` : "Sin resultados"}</span></div></div>
      <div className="hydro-table-wrap"><table><thead><tr><th>Fecha</th><th>Proveedor</th><th>Folio</th><th>Importe gas</th><th>Clasificación</th></tr></thead><tbody>{invoices?.rows.map((row) => <tr key={row.uuid} onClick={() => openDetail(row)} tabIndex={0} onKeyDown={(e) => { if (e.key === "Enter") openDetail(row); }}><td>{formatDate(row.fecha)}</td><td>{row.proveedor}</td><td>{row.serie || ""}{row.folio || "—"}</td><td>{money.format(Number(row.importe_gas || 0))}</td><td><span className="hydro-badge is-neutral">{classificationLabel(row.es_mixta)}</span></td></tr>)}</tbody></table>{!loading && !invoices?.rows.length ? <p className="hydro-empty">No hay facturas para los filtros seleccionados.</p> : null}</div>
      <div className="hydro-pagination"><button disabled={loading || page <= 1} onClick={() => load(page - 1)} type="button">Anterior</button><span>Página {page} de {pages}</span><button disabled={loading || page >= pages} onClick={() => load(page + 1)} type="button">Siguiente</button></div>
    </section> : null}
    <section className="hydro-kpis" aria-label="Indicadores"><Kpi label="Facturas" value={number.format(total)} /><Kpi label="Importe gas" value={money.format(Number(summary?.importe_gas || 0))} /><Kpi label="Facturas mixtas" value={number.format(summary?.facturas_mixtas || 0)} /><Kpi label="Validada SAP" value={`${number.format(summary?.validadas_sap || 0)} / ${number.format(total)}`} /><Kpi label="Con sitio" value={`${number.format(summary?.con_sitio || 0)} / ${number.format(total)}`} /><Kpi label="Recepción MSEG" value={number.format(summary?.con_recepcion_mseg || 0)} /></section>
    <section className="hydro-table-card"><div className="hydro-table-title"><div><h2>Bandeja de facturas</h2><p>{invoices ? `${number.format(invoices.total)} resultados` : "Sin resultados"}</p></div></div><div className="hydro-table-wrap"><table><thead><tr><th>Fecha</th><th>Proveedor</th><th>Folio</th><th>Importe gas</th><th>Estado SAP</th><th>Sitio</th><th>MSEG</th></tr></thead><tbody>{invoices?.rows.map((row) => <tr key={row.uuid} onClick={() => openDetail(row)} tabIndex={0} onKeyDown={(e) => { if (e.key === "Enter") openDetail(row); }}><td>{formatDate(row.fecha)}</td><td>{row.proveedor}</td><td>{row.serie || ""}{row.folio || "—"}</td><td>{money.format(Number(row.importe_gas || 0))}</td><td><span className={`hydro-badge ${row.estado_sap === "validada_sap" ? "is-ok" : "is-review"}`}>{statusLabel(row.estado_sap)}</span></td><td>{row.sitio_consumo || "Sin sitio"}</td><td>{row.tiene_recepcion_mseg ? "Sí" : "—"}</td></tr>)}</tbody></table>{!loading && !invoices?.rows.length ? <p className="hydro-empty">No hay facturas para los filtros seleccionados.</p> : null}</div><div className="hydro-pagination"><button disabled={loading || page <= 1} onClick={() => load(page - 1)} type="button">Anterior</button><span>Página {page} de {pages}</span><button disabled={loading || page >= pages} onClick={() => load(page + 1)} type="button">Siguiente</button></div></section>
    <DetailPanel invoice={selected} loading={detailLoading} error={detailError} module={initialModule} onClose={() => { setSelected(null); setDetailError(null); }} />
  </div>;
}
