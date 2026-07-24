"use client";

import { useMemo, useState } from "react";
import type { AprobacionInvoice, AprobacionOption, AprobacionQueue } from "@/types/aprobacion";

type Role = "compras" | "gerencia" | "historial";
type Props = {
  cecos: AprobacionOption[];
  initialCompras: AprobacionInvoice[];
  initialError: string | null;
  initialGerencia: AprobacionInvoice[];
  initialHistorial: AprobacionInvoice[];
  sitios: AprobacionOption[];
  usuario: string;
  // Qué bandejas muestra esta instancia. M2 (Portal de Compras) = compras+historial;
  // M3 (Aprobación) = gerencia. La primera de la lista es la pestaña inicial.
  roles?: Role[];
  moduleLabel?: string;
  title?: string;
};

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

function readError(response: Response, fallback: string) {
  return response.json().then((body: { detail?: string }) => body.detail || fallback).catch(() => fallback);
}

async function getQueue(role: Role) {
  const response = await fetch(`/api/financialbi/hidrocarburos/aprobacion/${role}`, { cache: "no-store" });
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

export function AprobacionWorkspace({ cecos, initialCompras, initialError, initialGerencia, initialHistorial, sitios, usuario, roles = ["compras", "gerencia", "historial"], moduleLabel = "M3", title = "Aprobación" }: Props) {
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

  const rows = role === "compras" ? compras : role === "gerencia" ? gerencia : historial;
  const totalGas = useMemo(() => rows.reduce((sum, row) => sum + Number(row.importe_gas || 0), 0), [rows]);
  const validadasSap = useMemo(() => rows.filter((row) => row.estado_sap === "validada_sap").length, [rows]);
  const pctValidadoSap = rows.length ? Math.round((100 * validadasSap) / rows.length) : 0;

  function choose(next: AprobacionInvoice) {
    setSelected(next); setCeco(next.ceco || ""); setWerks(next.werks_manual || next.werks || "");
    setComment(""); setRejecting(false); setReopening(false);
  }

  async function refreshAll() {
    setBusy(true); setError(null);
    try {
      // Solo refresca las bandejas que esta instancia muestra (M2 no toca la de Gerencia,
      // M3 no toca las de Compras/Historial) -- evita queries de BigQuery inútiles.
      const queues = await Promise.all(roles.map((r) => getQueue(r)));
      roles.forEach((r, index) => {
        const nextRows = queues[index].rows;
        if (r === "compras") setCompras(nextRows);
        else if (r === "gerencia") setGerencia(nextRows);
        else setHistorial(nextRows);
      });
      setSelected(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo actualizar la bandeja.");
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

  return <div className="approval-page">
    <header className="approval-header">
      <div><p>Hidrocarburos · {moduleLabel}</p><h1>{title}</h1></div>
      <button aria-label="Actualizar bandeja" className="approval-refresh" disabled={busy} onClick={() => refreshAll()} title="Actualizar" type="button">↻</button>
    </header>

    {roles.length > 1 ? <section className="approval-role-tabs" aria-label="Bandejas de aprobación">
      {roles.map((r) => <button className={role === r ? "is-active" : ""} key={r} onClick={() => { setRole(r); setSelected(null); setError(null); }} type="button"><span>{TAB_LABEL[r]}</span><b>{r === "compras" ? compras.length : r === "gerencia" ? gerencia.length : historial.length}</b></button>)}
    </section> : null}

    <section className="approval-kpis" aria-label="Indicadores de la cola">
      <div><span>Pendientes</span><strong>{rows.length}</strong></div>
      <div><span>Importe gas</span><strong>{formatMoney(totalGas)}</strong></div>
      {role === "gerencia"
        ? <div><span>Pendientes de aprobar</span><strong>{rows.length}</strong></div>
        : <div title={`${validadasSap} de ${rows.length} casan con SAP`}><span>Validado SAP</span><strong>{pctValidadoSap}%</strong></div>}
    </section>

    {error ? <p className="approval-error" role="alert">{error}</p> : null}
    <section className="approval-content">
      <div className="approval-table-area">
        <div className="approval-table-heading"><div><p>{moduleLabel} · {role === "compras" ? "Revisión operativa" : role === "gerencia" ? "Decisión de Gerencia" : "Historial (editar o reabrir)"}</p><h2>{role === "compras" ? "Facturas pendientes de validar" : role === "gerencia" ? "Facturas listas para aprobar" : "Facturas ya avanzadas"}</h2></div><span>{rows.length} pendientes</span></div>
        <div className="approval-table-wrap"><table><thead><tr><th>Fecha</th><th>Proveedor</th><th>Folio</th><th>Importe gas</th><th>CECO</th><th>Sitio</th>{role !== "gerencia" ? <th>SAP</th> : null}{role === "historial" ? <th>Estado</th> : null}</tr></thead><tbody>
          {rows.map((row) => <tr className={selected?.uuid === row.uuid ? "is-selected" : ""} key={row.uuid} onClick={() => choose(row)} tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter") choose(row); }}>
            <td>{formatDate(row.fecha)}</td><td>{row.proveedor}</td><td>{row.serie || ""}{row.folio || "—"}</td><td>{formatMoney(row.importe_gas)}</td><td>{row.ceco || "Pendiente"}</td><td>{row.werks_manual || row.sitio_consumo || row.werks || "—"}</td>
            {role !== "gerencia" ? <td>{row.estado_sap ? <span className={`approval-sap-tag${row.estado_sap === "validada_sap" ? " is-ok" : " is-warn"}`}>{row.estado_sap === "validada_sap" ? "Validada" : "Sin match"}</span> : "—"}</td> : null}
            {role === "historial" ? <td>{ESTADO_LABEL[row.estado] || row.estado}</td> : null}
          </tr>)}
        </tbody></table>{!rows.length && !busy ? <p className="approval-empty">No hay facturas en esta bandeja.</p> : null}</div>
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
              <dt>Recepción MSEG</dt><dd>{selected.tiene_recepcion_mseg ? "Confirmada" : "No disponible"}</dd>
              {selected.tiene_recepcion_mseg ? <><dt>Cantidad MSEG</dt><dd>{selected.mseg_cantidad == null ? "—" : String(selected.mseg_cantidad)}</dd><dt>Importe MSEG</dt><dd>{formatMoney(selected.mseg_importe)}</dd></> : null}
            </dl>
          </div> : null}

          {puedeEditar ? <div className="approval-form">
            <Field label="CECO"><input list="approval-cecos" onChange={(event) => setCeco(event.target.value)} placeholder="Obligatorio" value={ceco} /><datalist id="approval-cecos">{cecos.map((item) => <option key={item.id} value={item.id}>{item.nombre}</option>)}</datalist></Field>
            <Field label="Sitio"><input list="approval-sitios" onChange={(event) => setWerks(event.target.value)} placeholder="Opcional" value={werks} /><datalist id="approval-sitios">{sitios.map((item) => <option key={item.id} value={item.id}>{item.nombre}</option>)}</datalist></Field>
            <Field label="Comentario"><textarea onChange={(event) => setComment(event.target.value)} placeholder="Opcional" value={comment} /></Field>
          </div> : null}

          {soloLectura ? <div className="approval-audit"><p>Validado por Compras</p><dl><dt>CECO</dt><dd>{selected.ceco || "—"}</dd><dt>Sitio</dt><dd>{selected.werks_manual || selected.werks || "—"}</dd><dt>Usuario</dt><dd>{selected.usuario_compras || "—"}</dd><dt>Comentario</dt><dd>{selected.comentario_compras || "—"}</dd></dl><Field label="Comentario"><textarea onChange={(event) => setComment(event.target.value)} placeholder="Opcional al aprobar" value={comment} /></Field></div> : null}

          {puedeReabrir ? <div className="approval-audit">
            <p>{selected.estado === "aprobada" ? "Aprobada por Gerencia" : "Rechazada"}</p>
            <dl>
              <dt>CECO</dt><dd>{selected.ceco || "—"}</dd>
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
  </div>;
}
