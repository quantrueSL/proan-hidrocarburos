"use client";

import { useEffect, useMemo, useState } from "react";
import { FiltersSidebar } from "@/components/filters-sidebar";
import type { AprobacionFiltros, AprobacionInvoice, AprobacionOption, AprobacionQueue, AprobacionSearch } from "@/types/aprobacion";

type Role = "compras" | "gerencia" | "historial";
type Props = {
  cecos: AprobacionOption[];
  initialCompras: AprobacionQueue;
  initialError: string | null;
  initialGerencia: AprobacionQueue;
  initialHistorial: AprobacionQueue;
  sitios: AprobacionOption[];
  proveedores: AprobacionOption[];
  ultimaActualizacion?: string | null;
  usuario: string;
  // Qué bandejas muestra esta instancia. M2 (Portal de Compras) = compras+historial;
  // M3 (Aprobación) = gerencia. La primera de la lista es la pestaña inicial.
  roles?: Role[];
};

const PAGE_SIZE = 50;

const money = new Intl.NumberFormat("es-MX", { maximumFractionDigits: 0 });
const date = new Intl.DateTimeFormat("es-MX", { dateStyle: "medium" });

const ESTADO_LABEL: Record<string, string> = {
  pendiente_validacion_compras: "Pendiente Compras",
  pendiente_aprobacion_gerencia: "Pendiente Gerencia",
  aprobada: "Aprobada",
  rechazada: "Rechazada"
};

const TAB_LABEL: Record<Role, string> = { compras: "Compras", gerencia: "Gerencia", historial: "Historial" };

const FUENTE_SAP_LABEL: Record<string, string> = {
  RE: "Registro FI (RE)",
  partida_proveedor: "Partida de proveedor",
  "RE+partida": "Registro FI + partida"
};
const PAGO_SAP_LABEL: Record<string, string> = { pagada: "Pagada", pendiente: "Pendiente" };
const CONFIANZA_MSEG_LABEL: Record<string, string> = {
  Alta: "Confirmada (folio + importe)",
  Media: "Referenciada (importe sin reconciliar)"
};
// Explica de dónde sale ceco_sugerido -- no basta con mostrarlo, hay que decir por qué
// (jul-2026, a petición explícita: "que aparezca algo tipo el CECO sale de MSEG...").
const CECO_ORIGEN_LABEL: Record<string, string> = {
  proveedor: "Este proveedor siempre usa este CECO (sin necesitar recepción MSEG de esta factura)",
  documento: "Sale de la recepción MSEG que casó con esta factura",
  documento_multiple: "La recepción MSEG que casó reparte el gasto entre varios CECO -- confirma el que corresponda"
};

function formatDate(value: string | null) {
  return value ? date.format(new Date(`${value.slice(0, 10)}T12:00:00`)) : "—";
}

// Fechas SAP (p.ej. AUGDT de BSAK) vienen como 'YYYYMMDD' sin guiones.
function formatSapDate(value: string | null) {
  if (!value) return "—";
  const m = /^(\d{4})(\d{2})(\d{2})$/.exec(value.trim());
  return m ? date.format(new Date(`${m[1]}-${m[2]}-${m[3]}T12:00:00`)) : value;
}

function formatMoney(value: number | null) {
  return `${money.format(value || 0)} MXN`;
}

// CECO se guarda como código(s) separados por coma (uno o varios, si el documento
// MSEG reparte el gasto entre varios sitios) -- esto resuelve el nombre para mostrar,
// con el detalle completo (código + nombre de cada uno) en el tooltip para cuando no cabe.
function cecoLabel(raw: string | null | undefined, catalogo: Map<string, string>): { corto: string; completo: string } | null {
  const codigos = (raw || "").split(",").map((c) => c.trim()).filter(Boolean);
  if (!codigos.length) return null;
  const partes = codigos.map((codigo) => ({ codigo, nombre: catalogo.get(codigo) || null }));
  return {
    corto: partes.map((p) => p.nombre || p.codigo).join(", "),
    completo: partes.map((p) => (p.nombre ? `${p.nombre} (${p.codigo})` : p.codigo)).join(" · ")
  };
}

function readError(response: Response, fallback: string) {
  return response.json().then((body: { detail?: string }) => body.detail || fallback).catch(() => fallback);
}

function toQueryString(filtros: AprobacionSearch): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filtros)) {
    if (value !== null && value !== undefined && value !== "" && value !== "all") params.set(key, String(value));
  }
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

async function getQueue(role: Role, filtros: AprobacionSearch) {
  const response = await fetch(`/api/financialbi/hidrocarburos/aprobacion/${role}${toQueryString(filtros)}`, { cache: "no-store" });
  if (!response.ok) throw new Error(await readError(response, "No se pudo actualizar la bandeja."));
  return response.json() as Promise<AprobacionQueue>;
}

// El endpoint depende del estado ACTUAL de la factura, no de qué pestaña se
// esté mirando -- así "Historial" puede reeditar (pendiente_aprobacion_gerencia)
// o reabrir (aprobada/rechazada) sin duplicar la lógica de compras/gerencia.
function endpointFor(uuid: string, estado: string, action: "validar" | "aprobar" | "rechazar" | "reabrir") {
  const id = encodeURIComponent(uuid);
  if (action === "reabrir") return `/api/financialbi/hidrocarburos/aprobacion/${id}/reabrir`;
  if (action === "validar") return `/api/financialbi/hidrocarburos/aprobacion/compras/${id}/validar`;
  if (action === "aprobar") return `/api/financialbi/hidrocarburos/aprobacion/gerencia/${id}/aprobar`;
  const rol = estado === "pendiente_aprobacion_gerencia" ? "gerencia" : "compras";
  return `/api/financialbi/hidrocarburos/aprobacion/${rol}/${id}/rechazar`;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="approval-field"><span>{label}</span>{children}</label>;
}

export function AprobacionWorkspace({ cecos, initialCompras, initialError, initialGerencia, initialHistorial, sitios, proveedores, ultimaActualizacion, usuario, roles = ["compras", "gerencia", "historial"] }: Props) {
  const [role, setRole] = useState<Role>(roles[0]);
  const [compras, setCompras] = useState(initialCompras);
  const [gerencia, setGerencia] = useState(initialGerencia);
  const [historial, setHistorial] = useState(initialHistorial);
  const [selected, setSelected] = useState<AprobacionInvoice | null>(null);
  const [ceco, setCeco] = useState("");
  const [werks, setWerks] = useState("");
  const [comment, setComment] = useState("");
  const [rejecting, setRejecting] = useState(false);
  const [reopening, setReopening] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(initialError);
  const [filters, setFilters] = useState<AprobacionFiltros>({});
  const [filtersOpen, setFiltersOpen] = useState(false);
  const cecoNombrePorId = useMemo(() => new Map(cecos.map((item) => [item.id, item.nombre])), [cecos]);

  useEffect(() => {
    if (!selected) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setSelected(null);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selected]);
  function cecoDD(value: string | null) {
    const info = cecoLabel(value, cecoNombrePorId);
    return info ? <span title={info.completo}>{info.corto}</span> : "—";
  }

  const queue = role === "compras" ? compras : role === "gerencia" ? gerencia : historial;
  const rows = queue.rows;
  // Los KPIs (importe/validado SAP/MSEG) son agregados de TODA la cola filtrada,
  // no solo de la página visible -- por eso vienen de queue.resumen/.total y no
  // de recorrer `rows` (que ahora son solo 50 a la vez).
  const pctValidadoSap = queue.total ? Math.round((100 * queue.resumen.validadas_sap) / queue.total) : 0;
  const pctConMseg = queue.total ? Math.round((100 * queue.resumen.con_mseg) / queue.total) : 0;
  const pages = Math.max(1, Math.ceil(queue.total / queue.page_size));
  const activeFilterCount = [
    filters.busqueda, filters.proveedor_id, filters.estado_sap, filters.confianza_mseg,
    filters.sitio && filters.sitio !== "all" ? filters.sitio : null
  ].filter(Boolean).length;

  function choose(next: AprobacionInvoice) {
    // El CECO ya capturado manda siempre; si no hay, se prellena con la sugerencia
    // (patrón de proveedor o KOSTL del documento MSEG) -- sigue siendo editable, nunca bloquea.
    setSelected(next); setCeco(next.ceco || next.ceco_sugerido || ""); setWerks(next.werks_manual || next.werks || "");
    setComment(""); setRejecting(false); setReopening(false);
  }

  function applyQueue(r: Role, next: AprobacionQueue) {
    if (r === "compras") setCompras(next);
    else if (r === "gerencia") setGerencia(next);
    else setHistorial(next);
  }

  // Vuelve siempre a la página 1 -- se usa al aplicar/restablecer filtros y
  // tras validar/aprobar/rechazar/reabrir (la factura procesada desaparece de
  // la cola, así que la página en la que estaba ya no aplica igual).
  async function refreshAll(nextFilters = filters) {
    setBusy(true); setError(null);
    try {
      // Solo refresca las bandejas que esta instancia muestra (M2 no toca la de Gerencia,
      // M3 no toca las de Compras/Historial) -- evita queries de BigQuery inútiles.
      const queues = await Promise.all(roles.map((r) => getQueue(r, { ...nextFilters, page: 1, page_size: PAGE_SIZE })));
      roles.forEach((r, index) => applyQueue(r, queues[index]));
      setSelected(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo actualizar la bandeja.");
    } finally { setBusy(false); }
  }

  async function changePage(nextPage: number) {
    setBusy(true); setError(null);
    try {
      applyQueue(role, await getQueue(role, { ...filters, page: nextPage, page_size: PAGE_SIZE }));
      setSelected(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo cambiar de página.");
    } finally { setBusy(false); }
  }

  async function submit(action: "validar" | "aprobar" | "rechazar" | "reabrir") {
    if (!selected || busy) return;
    if (action === "validar" && !ceco.trim()) {
      setError("Indica el CECO antes de enviar a Gerencia."); return;
    }
    if ((action === "rechazar" || action === "reabrir") && !comment.trim()) {
      setError(action === "reabrir" ? "Indica el motivo de la reapertura." : "Indica el motivo del rechazo."); return;
    }
    const endpoint = endpointFor(selected.uuid, selected.estado, action);
    const payload = action === "validar"
      ? { usuario, ceco: ceco.trim(), werks_manual: werks.trim() || null, comentario: comment.trim() || null }
      : action === "aprobar"
        ? { usuario, comentario: comment.trim() || null }
        : { usuario, motivo: comment.trim() };
    setBusy(true); setError(null);
    try {
      const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      if (!response.ok) throw new Error(await readError(response, "No se pudo registrar la decisión."));
      await refreshAll();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo registrar la decisión.");
      setBusy(false);
    }
  }

  const puedeEditar = selected && (role === "compras" || (role === "historial" && selected.estado === "pendiente_aprobacion_gerencia"));
  // Reabrir: deshace cualquier avance (pendiente de Gerencia, aprobada o rechazada)
  // y borra el CECO/decisión anterior -- "me equivoqué, empezar de cero" sin
  // necesitar que Gerencia apruebe o rechace primero.
  const puedeReabrir = selected && role === "historial" && selected.estado !== "pendiente_validacion_compras";
  const soloLectura = selected && role === "gerencia";

  return <div className="workspace-with-sidebar">
    <FiltersSidebar
      activeCount={activeFilterCount}
      info={roles.includes("compras") ? <>
        <p>Compras revisa la evidencia disponible, confirma el CECO y corrige el sitio cuando sea necesario antes de enviar la factura a Gerencia.</p>
        <h3>Antes de enviar</h3>
        <ul>
          <li>El CECO es obligatorio; las sugerencias son editables.</li>
          <li>“Sin match SAP” no bloquea el flujo, pero requiere más revisión.</li>
          <li>MSEG indica la evidencia de recepción y su confianza.</li>
        </ul>
      </> : <>
        <p>Gerencia recibe las facturas ya revisadas por Compras para aprobarlas o rechazarlas con su contexto operativo.</p>
        <h3>Cómo decidir</h3>
        <ul>
          <li>Comprueba el CECO, el sitio y la validación de Compras.</li>
          <li>El comentario es opcional al aprobar y obligatorio al rechazar.</li>
        </ul>
      </>}
      infoTitle={roles.includes("compras") ? "Portal de Compras" : "Aprobación de Gerencia"}
      onToggle={() => setFiltersOpen((v) => !v)}
      open={filtersOpen}
      updatedAt={ultimaActualizacion}
    >
      <label>Buscar<input onChange={(e) => setFilters({ ...filters, busqueda: e.target.value || null })} placeholder="Folio, UUID o proveedor…" type="search" value={filters.busqueda || ""} /></label>
      <label>Desde<input type="date" value={filters.fecha_desde || ""} onChange={(e) => setFilters({ ...filters, fecha_desde: e.target.value || null })} /></label>
      <label>Hasta<input type="date" value={filters.fecha_hasta || ""} onChange={(e) => setFilters({ ...filters, fecha_hasta: e.target.value || null })} /></label>
      <label>Proveedor<select value={filters.proveedor_id || ""} onChange={(e) => setFilters({ ...filters, proveedor_id: e.target.value || null })}><option value="">Todos</option>{proveedores.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}</select></label>
      <label>Estado SAP<select value={filters.estado_sap || ""} onChange={(e) => setFilters({ ...filters, estado_sap: (e.target.value || null) as AprobacionFiltros["estado_sap"] })}><option value="">Todos</option><option value="validada_sap">Validada</option><option value="sin_match_sap">Sin match</option></select></label>
      <label>Sitio<select value={filters.sitio || "all"} onChange={(e) => setFilters({ ...filters, sitio: e.target.value as AprobacionFiltros["sitio"] })}><option value="all">Todos</option><option value="with_site">Con sitio</option><option value="without_site">Sin sitio</option></select></label>
      <label>Recepción MSEG<select value={filters.confianza_mseg || ""} onChange={(e) => setFilters({ ...filters, confianza_mseg: (e.target.value || null) as AprobacionFiltros["confianza_mseg"] })}><option value="">Todas</option><option value="Alta">Alta</option><option value="Media">Media</option><option value="sin_evidencia">Sin evidencia</option></select></label>
      <div className="filters-sidebar-actions"><button className="hydro-button" disabled={busy} onClick={() => refreshAll()} type="button">{busy ? "Actualizando…" : "Aplicar filtros"}</button><button className="hydro-link-button" onClick={() => { setFilters({}); refreshAll({}); }} type="button">Restablecer</button></div>
    </FiltersSidebar>
    <div className="approval-page">
    {roles.length > 1 ? <section className="approval-role-tabs" aria-label="Bandejas de aprobación">
      {roles.map((r) => <button className={role === r ? "is-active" : ""} key={r} onClick={() => { setRole(r); setSelected(null); setError(null); }} type="button"><span>{TAB_LABEL[r]}</span><b>{r === "compras" ? compras.total : r === "gerencia" ? gerencia.total : historial.total}</b></button>)}
    </section> : null}

    <section className="approval-kpis" aria-label="Indicadores de la cola">
      <div><span>Pendientes</span><strong>{queue.total}</strong></div>
      <div><span>Importe gas</span><strong>{formatMoney(queue.resumen.importe_gas_total)}</strong></div>
      {role === "gerencia"
        ? <div><span>Pendientes de aprobar</span><strong>{queue.total}</strong></div>
        : <div title={`${queue.resumen.validadas_sap} de ${queue.total} casan con SAP`}><span>Validado SAP</span><strong>{pctValidadoSap}%</strong></div>}
      <div title={`${queue.resumen.con_mseg} de ${queue.total} con recepción MSEG`}><span>Con evidencia MSEG</span><strong>{pctConMseg}%</strong></div>
    </section>

    {error ? <p className="approval-error" role="alert">{error}</p> : null}
    <section className="approval-content">
      <div className="approval-table-area">
        <div className="approval-table-heading"><div><p>{role === "compras" ? "Revisión operativa" : role === "gerencia" ? "Decisión de Gerencia" : "Historial (editar o reabrir)"}</p><h2>{role === "compras" ? "Facturas pendientes de validar" : role === "gerencia" ? "Facturas listas para aprobar" : "Facturas ya avanzadas"}</h2></div></div>
        <div className="approval-table-wrap"><table><thead><tr><th>Fecha</th><th>Proveedor</th><th>Folio</th><th>Importe gas</th><th>CECO</th><th>Sitio</th>{role !== "gerencia" ? <th>SAP</th> : null}<th>MSEG</th>{role === "historial" ? <th>Estado</th> : null}</tr></thead><tbody>
          {rows.map((row) => {
            const cecoInfo = row.ceco ? cecoLabel(row.ceco, cecoNombrePorId) : cecoLabel(row.ceco_sugerido, cecoNombrePorId);
            return <tr aria-label={`Revisar factura ${row.serie || ""}${row.folio || row.uuid}`} className={selected?.uuid === row.uuid ? "is-selected" : ""} key={row.uuid} onClick={() => choose(row)} role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); choose(row); } }}>
              <td>{formatDate(row.fecha)}</td><td>{row.proveedor}</td><td>{row.serie || ""}{row.folio || "—"}</td><td>{formatMoney(row.importe_gas)}</td>
              <td>{cecoInfo ? <span className={`approval-truncate${row.ceco ? "" : " approval-ceco-sugerido"}`} title={cecoInfo.completo}>{cecoInfo.corto}</span> : "Pendiente"}</td>
              <td>{row.werks_manual || row.sitio_consumo || row.werks || "—"}</td>
              {role !== "gerencia" ? <td>{row.estado_sap ? <span className={`approval-sap-tag${row.estado_sap === "validada_sap" ? " is-ok" : " is-warn"}`}>{row.estado_sap === "validada_sap" ? "Validada" : "Sin match"}</span> : "—"}</td> : null}
              <td>{row.confianza_mseg ? <span className={`approval-sap-tag${row.confianza_mseg === "Alta" ? " is-ok" : " is-warn"}`} title={CONFIANZA_MSEG_LABEL[row.confianza_mseg]}>{row.confianza_mseg}</span> : "—"}</td>
              {role === "historial" ? <td>{ESTADO_LABEL[row.estado] || row.estado}</td> : null}
            </tr>;
          })}
        </tbody></table>{!rows.length && !busy ? <div className="approval-empty"><b>No hay facturas en esta bandeja</b><span>{activeFilterCount ? "Prueba con otros filtros o elimina la búsqueda." : "No tienes decisiones pendientes en este momento."}</span></div> : null}</div>
        <div className="hydro-pagination"><button disabled={busy || queue.page <= 1} onClick={() => changePage(queue.page - 1)} type="button">Anterior</button><span>Página {queue.page} de {pages}</span><button disabled={busy || queue.page >= pages} onClick={() => changePage(queue.page + 1)} type="button">Siguiente</button></div>
      </div>

      {selected ? <button aria-label="Cerrar detalle" className="approval-detail-backdrop" onClick={() => setSelected(null)} type="button" /> : null}
      <aside className={`approval-detail${selected ? " is-open" : ""}`} aria-label="Detalle de aprobación" aria-modal={selected ? "true" : undefined} role={selected ? "dialog" : undefined}>
        {selected ? <>
          <div className="approval-detail-header"><div><p>Factura seleccionada · {ESTADO_LABEL[selected.estado] || selected.estado}</p><h2>{selected.serie || ""}{selected.folio || ""}</h2></div><button aria-label="Cerrar detalle" onClick={() => setSelected(null)} type="button">×</button></div>
          <dl className="approval-invoice-data"><dt>Proveedor</dt><dd>{selected.proveedor}</dd><dt>Fecha</dt><dd>{formatDate(selected.fecha)}</dd><dt>Importe gas</dt><dd>{formatMoney(selected.importe_gas)}</dd><dt>Clasificación</dt><dd>{selected.es_mixta ? "Mixta" : "Gas"}</dd><dt>Estado SAP</dt><dd>{selected.estado_sap === "validada_sap" ? "Validada SAP" : "Sin match SAP"}</dd></dl>

          {role !== "gerencia" ? <div className="approval-audit approval-sap">
            <p>Evidencia SAP</p>
            <dl>
              <dt>Fuente</dt><dd>{selected.fuente_sap ? (FUENTE_SAP_LABEL[selected.fuente_sap] ?? selected.fuente_sap) : "Sin match SAP"}</dd>
              <dt>Documento SAP</dt><dd>{selected.belnr_sap || "—"}</dd>
              <dt>Tipo de match</dt><dd>{selected.tipo_match_sap || "—"}</dd>
              <dt>Días de diferencia</dt><dd>{selected.dias_diferencia == null ? "—" : String(selected.dias_diferencia)}</dd>
              <dt>Estado de pago</dt><dd>{selected.estado_pago_sap ? (PAGO_SAP_LABEL[selected.estado_pago_sap] ?? selected.estado_pago_sap) : "Sin dato"}</dd>
              {selected.estado_pago_sap === "pagada" ? <><dt>Fecha de pago</dt><dd>{formatSapDate(selected.fecha_pago_sap)}</dd><dt>Doc. de pago</dt><dd>{selected.belnr_pago_sap || "—"}</dd></> : null}
              <dt>Sitio (SAP)</dt><dd>{selected.sitio_consumo || "—"}{selected.tipo_match_sitio ? ` · ${selected.tipo_match_sitio}` : ""}</dd>
              <dt>Dirección de Consumo</dt><dd>{selected.direccion_sitio || "—"}</dd>
            </dl>
          </div> : null}

          {role !== "gerencia" ? <div className="approval-audit approval-mseg">
            <p>Evidencia MSEG</p>
            <dl>
              <dt>Recepción</dt><dd>{selected.confianza_mseg ? (CONFIANZA_MSEG_LABEL[selected.confianza_mseg] ?? selected.confianza_mseg) : "No disponible"}</dd>
              {selected.confianza_mseg ? <><dt>Cantidad</dt><dd>{selected.mseg_cantidad == null ? "—" : String(selected.mseg_cantidad)}</dd><dt>Importe</dt><dd>{formatMoney(selected.mseg_importe)}</dd></> : null}
              {selected.ceco_sugerido_origen ? <><dt>CECO sugerido</dt><dd>{CECO_ORIGEN_LABEL[selected.ceco_sugerido_origen]}</dd></> : null}
            </dl>
          </div> : null}

          {puedeEditar ? <div className="approval-form">
            <Field label="CECO">
              <input list="approval-cecos" onChange={(event) => setCeco(event.target.value)} placeholder="Obligatorio" value={ceco} />
              <datalist id="approval-cecos">{cecos.map((item) => <option key={item.id} value={item.id}>{item.nombre}</option>)}</datalist>
              {(() => {
                const info = cecoLabel(ceco, cecoNombrePorId);
                const coincideConSugerido = Boolean(selected.ceco_sugerido) && ceco.trim() === selected.ceco_sugerido;
                return <>
                  {info ? <small className="approval-field-hint" title={info.completo}>{info.corto}</small> : null}
                  {coincideConSugerido && selected.ceco_sugerido_origen ? <small className="approval-field-hint approval-field-hint-origen">{CECO_ORIGEN_LABEL[selected.ceco_sugerido_origen]}</small> : null}
                </>;
              })()}
            </Field>
            <Field label="Sitio"><input list="approval-sitios" onChange={(event) => setWerks(event.target.value)} placeholder="Opcional" value={werks} /><datalist id="approval-sitios">{sitios.map((item) => <option key={item.id} value={item.id}>{item.nombre}</option>)}</datalist></Field>
            <Field label="Comentario"><textarea onChange={(event) => setComment(event.target.value)} placeholder="Opcional" value={comment} /></Field>
          </div> : null}

          {soloLectura ? <div className="approval-audit"><p>Validado por Compras</p><dl><dt>CECO</dt><dd>{cecoDD(selected.ceco)}</dd><dt>Sitio</dt><dd>{selected.werks_manual || selected.werks || "—"}</dd><dt>Usuario</dt><dd>{selected.usuario_compras || "—"}</dd><dt>Comentario</dt><dd>{selected.comentario_compras || "—"}</dd></dl><Field label="Comentario"><textarea onChange={(event) => setComment(event.target.value)} placeholder="Opcional al aprobar" value={comment} /></Field></div> : null}

          {puedeReabrir ? <div className="approval-audit">
            <p>{selected.estado === "aprobada" ? "Aprobada por Gerencia" : "Rechazada"}</p>
            <dl>
              <dt>CECO</dt><dd>{cecoDD(selected.ceco)}</dd>
              <dt>Sitio</dt><dd>{selected.werks_manual || selected.werks || "—"}</dd>
              <dt>Compras</dt><dd>{selected.usuario_compras || "—"}</dd>
              <dt>Gerencia</dt><dd>{selected.usuario_gerencia || "—"}</dd>
              {selected.estado === "rechazada" ? <><dt>Motivo de rechazo</dt><dd>{selected.motivo_rechazo || "—"}</dd></> : null}
            </dl>
            {reopening ? <Field label="Motivo de la reapertura"><textarea onChange={(event) => setComment(event.target.value)} placeholder="Obligatorio" value={comment} /></Field> : null}
          </div> : null}

          {rejecting ? <div className="approval-reject"><p>El comentario será el motivo del rechazo.</p><div><button className="approval-text-button" disabled={busy} onClick={() => setRejecting(false)} type="button">Cancelar</button><button className="approval-reject-button" disabled={busy} onClick={() => submit("rechazar")} type="button">Confirmar rechazo</button></div></div>
          : reopening ? <div className="approval-reject"><p>La factura volverá a &ldquo;Pendiente Compras&rdquo;, sin CECO ni decisión previa.</p><div><button className="approval-text-button" disabled={busy} onClick={() => setReopening(false)} type="button">Cancelar</button><button className="approval-reject-button" disabled={busy} onClick={() => submit("reabrir")} type="button">Confirmar reapertura</button></div></div>
          : <div className="approval-actions">
              {puedeEditar || soloLectura ? <button className="approval-text-button" disabled={busy} onClick={() => setRejecting(true)} type="button">Rechazar</button> : null}
              {puedeReabrir ? <button className="approval-text-button" disabled={busy} onClick={() => setReopening(true)} type="button">Reabrir</button> : null}
              {puedeEditar ? <button className="approval-primary-button" disabled={busy} onClick={() => submit("validar")} type="button">{busy ? "Guardando…" : selected.estado === "pendiente_aprobacion_gerencia" ? "Guardar corrección" : "Enviar a Gerencia"}</button> : null}
              {soloLectura ? <button className="approval-primary-button" disabled={busy} onClick={() => submit("aprobar")} type="button">{busy ? "Guardando…" : "Aprobar factura"}</button> : null}
            </div>}
        </> : <div className="approval-detail-placeholder"><span>Selecciona una factura para revisarla</span></div>}
      </aside>
    </section>
    </div>
  </div>;
}
