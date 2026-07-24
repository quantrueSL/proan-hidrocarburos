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
  initialSummary: HydrocarburosSummary | null;
};

const money = {
  format(value: number) {
    return `${new Intl.NumberFormat("es-MX", { maximumFractionDigits: 0 }).format(value)} MXN`;
  }
};
const number = new Intl.NumberFormat("es-MX");
const dateFormatter = new Intl.DateTimeFormat("es-MX", { dateStyle: "medium" });

const MODULE_TITLE = "Clasificación CFDI";
const MODULE_DESCRIPTION = "Identifica el gasto de gas y separa las facturas con conceptos mixtos.";

function formatDate(value: string | null | undefined) {
  if (!value) return "—";
  return dateFormatter.format(new Date(`${value.slice(0, 10)}T12:00:00`));
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

// Detalle M1: por qué la factura es gas (CFDI + clasificación + conceptos de gas con su
// clave SAT). La evidencia SAP (documento, match, sitio, MSEG) vive ahora en el Portal de
// Compras (M2), donde se valida -- no aquí.
function DetailPanel({ invoice, loading, error, onClose }: {
  invoice: HydrocarburosInvoiceDetail | null; loading: boolean; error: string | null; onClose: () => void;
}) {
  if (!invoice && !loading && !error) return null;
  return (
    <>
      <button aria-label="Cerrar detalle" className="hydro-detail-backdrop" onClick={onClose} type="button" />
      <aside className="hydro-detail hydro-detail--m1" aria-label="Detalle de factura" role="dialog" aria-modal="true">
        <div className="hydro-detail-header"><div><p>Detalle de factura</p><h2>{invoice?.serie || ""}{invoice?.folio || ""}</h2></div><button onClick={onClose} type="button" aria-label="Cerrar detalle">×</button></div>
        {loading ? <p className="hydro-muted">Cargando evidencia…</p> : null}
        {error ? <p className="hydro-error">{error}</p> : null}
        {invoice ? <div className="hydro-detail-body">
          <section className="hydro-section--cfdi"><h3>CFDI y clasificación</h3><dl>
            <dt>Proveedor</dt><dd>{invoice.proveedor}</dd><dt>UUID</dt><dd className="hydro-uuid">{invoice.uuid}</dd>
            <dt>Fecha</dt><dd>{formatDate(invoice.fecha as string)}</dd><dt>Importe gas</dt><dd>{money.format(Number(invoice.importe_gas || 0))}</dd>
            <dt>Factura mixta</dt><dd>{invoice.es_mixta ? "Sí" : "No"}</dd><dt>Total CFDI</dt><dd>{money.format(Number(invoice.total || 0))}</dd>
          </dl></section>
          {invoice.conceptos_gas?.length ? <section className="hydro-section--conceptos"><h3>Conceptos de gas (clasificación M1)</h3>
            <ul className="hydro-conceptos">{invoice.conceptos_gas.map((c, i) => <li key={`${c.clave}-${i}`}>
              <div className="hydro-concepto-head"><span className="hydro-badge is-neutral">{c.clave || "—"}</span><strong>{money.format(Number(c.importe || 0))}</strong></div>
              <p>{c.descripcion || "—"}</p>
              <small>{c.cantidad == null ? "" : `${number.format(Number(c.cantidad))}${c.clave_unidad ? ` ${c.clave_unidad}` : ""}`}{c.valor_unitario == null ? "" : ` · ${money.format(Number(c.valor_unitario))}/u`}</small>
            </li>)}</ul>
          </section> : null}
        </div> : null}
      </aside>
    </>
  );
}

export function HydrocarburosWorkspace({ initialCatalog, initialError, initialFilters, initialInvoices, initialSummary }: Props) {
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

  if (error && (!summary || !invoices)) {
    return <div className="hydro-page" data-module="m1" data-module-description={MODULE_DESCRIPTION} data-module-title={MODULE_TITLE}>
      <header className="hydro-header"><div><p>Control operativo · M1</p><h1>Hidrocarburos</h1><span>Clasificación CFDI</span></div></header>
      <section className="hydro-unavailable" role="alert"><div><b>No se pudo cargar la bandeja</b><p>El servicio de Hidrocarburos no está disponible. Reinicia <code>carb-financialbi-dev</code> y vuelve a intentarlo.</p></div><button className="hydro-button" onClick={() => load(1)} type="button">Reintentar</button></section>
    </div>;
  }

  return <div className="hydro-page" data-module="m1" data-module-description={MODULE_DESCRIPTION} data-module-title={MODULE_TITLE}>
    <header className="hydro-header"><div><p>Control operativo · M1</p><h1>Hidrocarburos</h1><span>Clasificación CFDI</span></div></header>
    <section className="hydro-filters" aria-label="Filtros de la bandeja">
      <label>Desde<input type="date" value={filters.fecha_desde || ""} onChange={(e) => setFilters({ ...filters, fecha_desde: e.target.value || null })} /></label>
      <label>Hasta<input type="date" value={filters.fecha_hasta || ""} onChange={(e) => setFilters({ ...filters, fecha_hasta: e.target.value || null })} /></label>
      <label>Proveedor<select value={filters.proveedor_id || ""} onChange={(e) => setFilters({ ...filters, proveedor_id: e.target.value || null })}><option value="">Todos</option>{initialCatalog.proveedores.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}</select></label>
      <div className="hydro-filter-actions"><button className="hydro-button" disabled={loading} onClick={() => load(1)} type="button">{loading ? "Actualizando…" : "Aplicar filtros"}</button><button className="hydro-link-button" onClick={() => { setFilters(reset); load(1, reset); }} type="button">Restablecer</button></div>
    </section>
    {error ? <p className="hydro-error">{error}</p> : null}
    <section className="hydro-module-kpis" aria-label="Indicadores M1">
      <Kpi label="Facturas CFDI" value={number.format(total)} />
      <Kpi label="Importe gas" value={money.format(Number(summary?.importe_gas || 0))} />
      <Kpi label="Facturas mixtas" value={number.format(summary?.facturas_mixtas || 0)} />
      <Kpi label="Solo gas" value={number.format(Math.max(0, total - (summary?.facturas_mixtas || 0)))} />
    </section>
    <section className="hydro-table-card hydro-module-table">
      <div className="hydro-table-title"><div><p>M1 · Clasificación</p><h2>Facturas clasificadas</h2><span>{invoices ? `${number.format(invoices.total)} resultados` : "Sin resultados"}</span></div></div>
      <div className="hydro-table-wrap"><table><thead><tr><th>Fecha</th><th>Proveedor</th><th>Folio</th><th>Importe gas</th><th>Clave SAT</th><th>Clasificación</th></tr></thead><tbody>{invoices?.rows.map((row) => <tr key={row.uuid} onClick={() => openDetail(row)} tabIndex={0} onKeyDown={(e) => { if (e.key === "Enter") openDetail(row); }}><td>{formatDate(row.fecha)}</td><td>{row.proveedor}</td><td>{row.serie || ""}{row.folio || "—"}</td><td>{money.format(Number(row.importe_gas || 0))}</td><td>{row.claves_gas?.length ? row.claves_gas.join(", ") : "—"}</td><td><span className="hydro-badge is-neutral">{classificationLabel(row.es_mixta)}</span></td></tr>)}</tbody></table>{!loading && !invoices?.rows.length ? <p className="hydro-empty">No hay facturas para los filtros seleccionados.</p> : null}</div>
      <div className="hydro-pagination"><button disabled={loading || page <= 1} onClick={() => load(page - 1)} type="button">Anterior</button><span>Página {page} de {pages}</span><button disabled={loading || page >= pages} onClick={() => load(page + 1)} type="button">Siguiente</button></div>
    </section>
    <DetailPanel invoice={selected} loading={detailLoading} error={detailError} onClose={() => { setSelected(null); setDetailError(null); }} />
  </div>;
}
