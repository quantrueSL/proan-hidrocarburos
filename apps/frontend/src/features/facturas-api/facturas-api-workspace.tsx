"use client";

import { useEffect, useMemo, useState } from "react";
import type { FacturaDocumentType, FacturaMetadata } from "@/types/facturas";

export type RfcSuggestion = { nombre: string; rfc: string };
type Props = { apiUrl: string; initialError: string | null; nucleos: string[]; rfcSuggestions: RfcSuggestion[] };
type SelectedDocuments = Record<FacturaDocumentType, boolean>;

const PAGE_SIZE = 100;
const initialDocuments: SelectedDocuments = { metadata: false, pdf: true, xml: true };
const dateFormatter = new Intl.DateTimeFormat("es-MX", { dateStyle: "medium" });
const moneyFormatter = new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN", maximumFractionDigits: 2 });

function displayDate(value: string | null) {
  return value ? dateFormatter.format(new Date(`${value.slice(0, 10)}T12:00:00`)) : "—";
}

function defaultName(row: FacturaMetadata, extension: ".pdf" | ".xml") {
  return `${row.serie || ""}${row.folio || ""}_${row.uuid}${extension}`;
}

function readError(response: Response, fallback: string) {
  return response.json().then((body: { detail?: string }) => body.detail || fallback).catch(() => fallback);
}

function RfcChipsInput({ onChange, suggestions, values }: { onChange: (values: string[]) => void; suggestions: RfcSuggestion[]; values: string[] }) {
  const [draft, setDraft] = useState("");
  const normalizedDraft = draft.trim().toLocaleLowerCase("es");
  const matches = normalizedDraft.length >= 2
    ? suggestions.filter(({ nombre, rfc }) => `${rfc} ${nombre}`.toLocaleLowerCase("es").includes(normalizedDraft) && !values.includes(rfc)).slice(0, 6)
    : [];
  function add(value = draft) {
    const next = value.split(/[,;\n]/).map((item) => item.trim().toUpperCase()).filter(Boolean);
    if (next.length) onChange([...new Set([...values, ...next])]);
    setDraft("");
  }
  return <label className="api-chip-field"><span>RFC emisor</span><div className="api-chip-input">
    {values.map((value) => <button aria-label={`Eliminar ${value}`} key={value} onClick={() => onChange(values.filter((item) => item !== value))} type="button">{value} ×</button>)}
    <input aria-autocomplete="list" aria-controls="api-rfc-suggestions" onBlur={() => add()} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === ",") { event.preventDefault(); add(); } }} placeholder={values.length ? "Añadir RFC…" : "Escribe un RFC o proveedor"} value={draft} />
    {matches.length ? <div className="api-rfc-suggestions" id="api-rfc-suggestions" role="listbox">{matches.map((suggestion) => <button key={suggestion.rfc} onMouseDown={(event) => event.preventDefault()} onClick={() => add(suggestion.rfc)} role="option" type="button"><strong>{suggestion.rfc}</strong><small>{suggestion.nombre}</small></button>)}</div> : null}
  </div></label>;
}

export function FacturasApiWorkspace({ apiUrl, initialError, nucleos, rfcSuggestions }: Props) {
  const [fechaDesde, setFechaDesde] = useState("");
  const [fechaHasta, setFechaHasta] = useState("");
  const [rfcs, setRfcs] = useState<string[]>([]);
  const [selectedNucleos, setSelectedNucleos] = useState<string[]>([]);
  const [rows, setRows] = useState<FacturaMetadata[]>([]);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [documents, setDocuments] = useState<SelectedDocuments>(initialDocuments);
  const [names, setNames] = useState<Record<string, { pdf?: string; xml?: string }>>({});
  const [loading, setLoading] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState(initialError);
  const [terminalOpen, setTerminalOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);

  useEffect(() => {
    if (!terminalOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") setTerminalOpen(false); };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", closeOnEscape);
    return () => { document.body.style.overflow = previousOverflow; window.removeEventListener("keydown", closeOnEscape); };
  }, [terminalOpen]);

  const selectedRows = useMemo(() => rows.filter((row) => selected.has(row.uuid)), [rows, selected]);
  const enabledDocuments = (Object.keys(documents) as FacturaDocumentType[]).filter((document) => documents[document]);

  function queryParams(nextOffset: number) {
    const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(nextOffset) });
    if (fechaDesde) params.set("fecha_desde", fechaDesde);
    if (fechaHasta) params.set("fecha_hasta", fechaHasta);
    rfcs.forEach((rfc) => params.append("rfc_emisor", rfc));
    selectedNucleos.forEach((nucleo) => params.append("nucleo", nucleo));
    return params;
  }

  function reset() {
    setFechaDesde(""); setFechaHasta(""); setRfcs([]); setSelectedNucleos([]); setRows([]); setSelected(new Set()); setHasMore(false); setOffset(0); setError(null);
  }

  function toggleNucleo(nucleo: string) {
    setSelectedNucleos((current) => current.includes(nucleo) ? current.filter((item) => item !== nucleo) : [...current, nucleo]);
  }

  async function search(nextOffset = 0, append = false) {
    setLoading(true); setError(null);
    if (!append) setFiltersOpen(false);
    try {
      const response = await fetch(`/api/facturas/search?${queryParams(nextOffset).toString()}`);
      if (!response.ok) throw new Error(await readError(response, "No se pudieron buscar las facturas."));
      const nextRows = await response.json() as FacturaMetadata[];
      setRows((current) => append ? [...current, ...nextRows.filter((row) => !current.some((item) => item.uuid === row.uuid))] : nextRows);
      setOffset(nextOffset + nextRows.length);
      setHasMore(nextRows.length === PAGE_SIZE);
      if (!append) setSelected(new Set());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudieron buscar las facturas.");
    } finally { setLoading(false); }
  }

  async function download() {
    if (!selectedRows.length || !enabledDocuments.length) return;
    setDownloading(true); setError(null);
    try {
      const response = await fetch("/api/facturas/download", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          documents: enabledDocuments,
          items: selectedRows.map((row) => ({ uuid: row.uuid, pdf_name: names[row.uuid]?.pdf || defaultName(row, ".pdf"), xml_name: names[row.uuid]?.xml || defaultName(row, ".xml") }))
        })
      });
      if (!response.ok) throw new Error(await readError(response, "No se pudo preparar el ZIP."));
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url; link.download = "facturas.zip"; link.click();
      URL.revokeObjectURL(url);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo preparar el ZIP.");
    } finally { setDownloading(false); }
  }

  const terminalQuery = `${apiUrl}/v1/facturas?${queryParams(0).toString()}`;

  return <div className="api-page">
    <header className="api-header">
      <div><p>Consulta documental</p><h1>Facturas API</h1></div>
      <button className="api-terminal-trigger" onClick={() => setTerminalOpen(true)} type="button"><span>Guía de petición por terminal</span><i aria-hidden="true">↗</i></button>
    </header>

    <section className="api-instructions"><h2>Cómo utilizar esta página</h2><p>Todos los filtros son opcionales. Puedes combinar varios RFC y núcleos; una factura debe coincidir con cualquiera de los valores de cada grupo. Selecciona las facturas y los documentos que quieres incluir antes de descargar el ZIP.</p><p>Las búsquedas muestran hasta 100 facturas por página. Usa <b>Cargar más</b> para continuar; cada ZIP admite hasta 100 facturas para evitar descargas excesivas.</p></section>

    <section className="api-filters" aria-label="Filtros de Facturas API">
      <button aria-expanded={filtersOpen} className="api-filters-toggle" onClick={() => setFiltersOpen((open) => !open)} type="button"><span>Filtros</span><i aria-hidden="true">{filtersOpen ? "−" : "+"}</i></button>
      {filtersOpen ? <div className="api-filter-content"><div className="api-filter-top">
          <label><span>Fecha inicio</span><input onChange={(event) => setFechaDesde(event.target.value)} type="date" value={fechaDesde} /></label>
          <label><span>Fecha fin</span><input onChange={(event) => setFechaHasta(event.target.value)} type="date" value={fechaHasta} /></label>
          <RfcChipsInput onChange={setRfcs} suggestions={rfcSuggestions} values={rfcs} />
        </div>
        <div className="api-nucleo-field"><div><span>Núcleos</span>{selectedNucleos.length ? <button onClick={() => setSelectedNucleos([])} type="button">Limpiar selección</button> : null}</div><div className="api-nucleo-grid">{nucleos.map((nucleo) => <label key={nucleo}><input checked={selectedNucleos.includes(nucleo)} onChange={() => toggleNucleo(nucleo)} type="checkbox" /><span>{nucleo}</span></label>)}</div></div>
      </div> : null}
      <div className="api-filter-actions"><button aria-label="Buscar facturas" className="hydro-button" disabled={loading} onClick={() => search()} type="button">{loading ? "…" : <svg aria-hidden="true" viewBox="0 0 24 24"><circle cx="10.5" cy="10.5" r="5.5" /><path d="m15 15 4.5 4.5" /></svg>}</button><button className="api-reset-button" onClick={reset} type="button">Restablecer</button></div>
    </section>

    {error ? <p className="hydro-error" role="alert">{error}</p> : null}
    {rows.length ? <section className="api-results">
      <div className="api-results-toolbar"><div><p>Resultados cargados</p><h2>{rows.length} factura{rows.length === 1 ? "" : "s"}</h2></div><div className="api-download-controls">{(Object.keys(documents) as FacturaDocumentType[]).map((document) => <label key={document}><span>{document === "metadata" ? "Metadata" : document.toUpperCase()}</span><input checked={documents[document]} onChange={() => setDocuments({ ...documents, [document]: !documents[document] })} role="switch" type="checkbox" /><b>{documents[document] ? "Incluir" : "No incluir"}</b></label>)}<button className="hydro-button api-download-button" disabled={!selectedRows.length || !enabledDocuments.length || downloading} onClick={download} type="button"><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M12 3v11m0 0 4-4m-4 4-4-4M5 18v3h14v-3" /></svg>{downloading ? "Generando ZIP…" : `Descargar ZIP (${selectedRows.length})`}</button></div></div>
      <div className="api-table-wrap"><table><thead><tr><th><input aria-label="Seleccionar todas las facturas cargadas" checked={rows.length > 0 && selected.size === rows.length} onChange={(event) => setSelected(event.target.checked ? new Set(rows.map((row) => row.uuid)) : new Set())} type="checkbox" /></th><th>Fecha</th><th>Proveedor / RFC</th><th>Folio</th><th>Total</th><th>Núcleos</th><th>Nombre PDF</th><th>Nombre XML</th></tr></thead><tbody>{rows.map((row) => <tr key={row.uuid}><td><input aria-label={`Seleccionar factura ${row.uuid}`} checked={selected.has(row.uuid)} onChange={(event) => setSelected((current) => { const next = new Set(current); event.target.checked ? next.add(row.uuid) : next.delete(row.uuid); return next; })} type="checkbox" /></td><td>{displayDate(row.fecha)}</td><td><strong>{row.nombre_emisor || "—"}</strong><small>{row.rfc_emisor || "—"}</small></td><td>{row.serie || ""}{row.folio || "—"}</td><td>{row.total == null ? "—" : `${moneyFormatter.format(row.total)} ${row.moneda && row.moneda !== "MXN" ? row.moneda : ""}`}</td><td>{row.nucleos.length ? row.nucleos.join(" · ") : "Sin núcleo confirmado"}</td><td><input aria-label={`Nombre PDF de ${row.uuid}`} onChange={(event) => setNames({ ...names, [row.uuid]: { ...names[row.uuid], pdf: event.target.value } })} value={names[row.uuid]?.pdf ?? defaultName(row, ".pdf")} /></td><td><input aria-label={`Nombre XML de ${row.uuid}`} onChange={(event) => setNames({ ...names, [row.uuid]: { ...names[row.uuid], xml: event.target.value } })} value={names[row.uuid]?.xml ?? defaultName(row, ".xml")} /></td></tr>)}</tbody></table></div>
      {hasMore ? <div className="api-load-more"><button disabled={loading} onClick={() => search(offset, true)} type="button">{loading ? "Cargando…" : "Cargar más"}</button></div> : null}
    </section> : !loading ? <section className="api-empty"><b>Configura filtros y busca facturas</b><span>Deja fechas vacías para consultar todo el histórico del RFC o núcleo elegido.</span></section> : null}

    {terminalOpen ? <div aria-labelledby="api-terminal-title" aria-modal="true" className="manual-modal-backdrop" onMouseDown={(event) => { if (event.currentTarget === event.target) setTerminalOpen(false); }} role="dialog"><article className="api-terminal-modal"><header><div><p>Integración externa</p><h2 id="api-terminal-title">Guía de petición por terminal</h2><span>Usa una key autorizada en tus propios sistemas; esta página no muestra ni conserva la key.</span></div><button aria-label="Cerrar guía" onClick={() => setTerminalOpen(false)} type="button">×</button></header><div className="api-terminal-modal-body"><section><h3>1. Buscar facturas</h3><p>Los filtros son opcionales. Repite <code>rfc_emisor</code> o <code>nucleo</code> para combinar varios valores; cada grupo se combina con los demás filtros.</p><pre>{`curl -H "x-api-key: TU_API_KEY" "${terminalQuery}"`}</pre></section><section><h3>2. Continuar una búsqueda</h3><p>La respuesta contiene hasta 100 facturas. Incrementa <code>offset</code> para pedir la página siguiente.</p><pre>{`curl -H "x-api-key: TU_API_KEY" "${apiUrl}/v1/facturas?limit=100&offset=100"`}</pre></section><section><h3>3. Descargar documentos</h3><p>Sustituye <code>{"{UUID}"}</code> por el UUID recibido en la búsqueda. <code>-OJ</code> conserva el nombre sugerido por el servidor.</p><pre>{`curl -H "x-api-key: TU_API_KEY" "${apiUrl}/v1/facturas/{UUID}"

curl -H "x-api-key: TU_API_KEY" -OJ "${apiUrl}/v1/facturas/{UUID}/pdf"
curl -H "x-api-key: TU_API_KEY" -OJ "${apiUrl}/v1/facturas/{UUID}/xml"`}</pre></section></div></article></div> : null}
  </div>;
}
