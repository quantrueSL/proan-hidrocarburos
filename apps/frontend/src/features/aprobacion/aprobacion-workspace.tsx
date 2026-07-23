"use client";

import { useMemo, useState } from "react";
import type { AprobacionInvoice, AprobacionOption, AprobacionQueue } from "@/types/aprobacion";

type Role = "compras" | "gerencia";
type Props = {
  cecos: AprobacionOption[];
  initialCompras: AprobacionInvoice[];
  initialError: string | null;
  initialGerencia: AprobacionInvoice[];
  sitios: AprobacionOption[];
  usuario: string;
};

const money = new Intl.NumberFormat("es-MX", { maximumFractionDigits: 0 });
const date = new Intl.DateTimeFormat("es-MX", { dateStyle: "medium" });

function formatDate(value: string | null) {
  return value ? date.format(new Date(`${value.slice(0, 10)}T12:00:00`)) : "—";
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

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="approval-field"><span>{label}</span>{children}</label>;
}

export function AprobacionWorkspace({ cecos, initialCompras, initialError, initialGerencia, sitios, usuario }: Props) {
  const [role, setRole] = useState<Role>("compras");
  const [compras, setCompras] = useState(initialCompras);
  const [gerencia, setGerencia] = useState(initialGerencia);
  const [selected, setSelected] = useState<AprobacionInvoice | null>(null);
  const [ceco, setCeco] = useState("");
  const [werks, setWerks] = useState("");
  const [comment, setComment] = useState("");
  const [rejecting, setRejecting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(initialError);

  const rows = role === "compras" ? compras : gerencia;
  const totalGas = useMemo(() => rows.reduce((sum, row) => sum + Number(row.importe_gas || 0), 0), [rows]);

  function choose(next: AprobacionInvoice) {
    setSelected(next); setCeco(next.ceco || ""); setWerks(next.werks_manual || next.werks || ""); setComment(""); setRejecting(false);
  }

  async function refresh(nextRole = role) {
    setBusy(true); setError(null);
    try {
      const queue = await getQueue(nextRole);
      if (nextRole === "compras") setCompras(queue.rows); else setGerencia(queue.rows);
      setSelected(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo actualizar la bandeja.");
    } finally { setBusy(false); }
  }

  async function submit(action: "validar" | "aprobar" | "rechazar") {
    if (!selected || busy) return;
    if (role === "compras" && action === "validar" && !ceco.trim()) {
      setError("Indica el CECO antes de enviar a Gerencia."); return;
    }
    if (action === "rechazar" && !comment.trim()) {
      setError("Indica el motivo del rechazo."); return;
    }
    const endpoint = role === "compras"
      ? `/api/financialbi/hidrocarburos/aprobacion/compras/${encodeURIComponent(selected.uuid)}/${action}`
      : `/api/financialbi/hidrocarburos/aprobacion/gerencia/${encodeURIComponent(selected.uuid)}/${action}`;
    const payload = role === "compras" && action === "validar"
      ? { usuario, ceco: ceco.trim(), werks_manual: werks.trim() || null, comentario: comment.trim() || null }
      : action === "aprobar"
        ? { usuario, comentario: comment.trim() || null }
        : { usuario, motivo: comment.trim() };
    setBusy(true); setError(null);
    try {
      const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      if (!response.ok) throw new Error(await readError(response, "No se pudo registrar la decisión."));
      await refresh(role);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo registrar la decisión.");
      setBusy(false);
    }
  }

  return <div className="approval-page">
    <header className="approval-header">
      <div><p>Hidrocarburos · M3</p><h1>Aprobación</h1></div>
      <button aria-label="Actualizar bandeja" className="approval-refresh" disabled={busy} onClick={() => refresh()} title="Actualizar" type="button">↻</button>
    </header>

    <section className="approval-role-tabs" aria-label="Bandejas de aprobación">
      <button className={role === "compras" ? "is-active" : ""} onClick={() => { setRole("compras"); setSelected(null); setError(null); }} type="button"><span>Compras</span><b>{compras.length}</b></button>
      <button className={role === "gerencia" ? "is-active" : ""} onClick={() => { setRole("gerencia"); setSelected(null); setError(null); }} type="button"><span>Gerencia</span><b>{gerencia.length}</b></button>
    </section>

    <section className="approval-kpis" aria-label="Indicadores de la cola">
      <div><span>Pendientes</span><strong>{rows.length}</strong></div>
      <div><span>Importe gas</span><strong>{formatMoney(totalGas)}</strong></div>
      <div><span>{role === "compras" ? "Pendientes de validar" : "Pendientes de aprobar"}</span><strong>{rows.length}</strong></div>
    </section>

    {error ? <p className="approval-error" role="alert">{error}</p> : null}
    <section className="approval-content">
      <div className="approval-table-area">
        <div className="approval-table-heading"><div><p>M3 · {role === "compras" ? "Revisión operativa" : "Decisión de Gerencia"}</p><h2>{role === "compras" ? "Facturas pendientes de validar" : "Facturas listas para aprobar"}</h2></div><span>{rows.length} pendientes</span></div>
        <div className="approval-table-wrap"><table><thead><tr><th>Fecha</th><th>Proveedor</th><th>Folio</th><th>Importe gas</th><th>CECO</th><th>Sitio</th></tr></thead><tbody>
          {rows.map((row) => <tr className={selected?.uuid === row.uuid ? "is-selected" : ""} key={row.uuid} onClick={() => choose(row)} tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter") choose(row); }}>
            <td>{formatDate(row.fecha)}</td><td>{row.proveedor}</td><td>{row.serie || ""}{row.folio || "—"}</td><td>{formatMoney(row.importe_gas)}</td><td>{row.ceco || "Pendiente"}</td><td>{row.werks_manual || row.sitio_consumo || row.werks || "—"}</td>
          </tr>)}
        </tbody></table>{!rows.length && !busy ? <p className="approval-empty">No hay facturas pendientes en esta bandeja.</p> : null}</div>
      </div>

      <aside className={`approval-detail${selected ? " is-open" : ""}`} aria-label="Detalle de aprobación">
        {selected ? <>
          <div className="approval-detail-header"><div><p>Factura seleccionada</p><h2>{selected.serie || ""}{selected.folio || ""}</h2></div><button aria-label="Cerrar detalle" onClick={() => setSelected(null)} type="button">×</button></div>
          <dl className="approval-invoice-data"><dt>Proveedor</dt><dd>{selected.proveedor}</dd><dt>Fecha</dt><dd>{formatDate(selected.fecha)}</dd><dt>Importe gas</dt><dd>{formatMoney(selected.importe_gas)}</dd><dt>Clasificación</dt><dd>{selected.es_mixta ? "Mixta" : "Gas"}</dd><dt>Estado SAP</dt><dd>{selected.estado_sap === "validada_sap" ? "Validada SAP" : "Sin match SAP"}</dd></dl>
          {role === "compras" ? <div className="approval-form">
            <Field label="CECO"><input list="approval-cecos" onChange={(event) => setCeco(event.target.value)} placeholder="Obligatorio" value={ceco} /><datalist id="approval-cecos">{cecos.map((item) => <option key={item.id} value={item.id}>{item.nombre}</option>)}</datalist></Field>
            <Field label="Sitio"><input list="approval-sitios" onChange={(event) => setWerks(event.target.value)} placeholder="Opcional" value={werks} /><datalist id="approval-sitios">{sitios.map((item) => <option key={item.id} value={item.id}>{item.nombre}</option>)}</datalist></Field>
            <Field label="Comentario"><textarea onChange={(event) => setComment(event.target.value)} placeholder="Opcional" value={comment} /></Field>
          </div> : <div className="approval-audit"><p>Validado por Compras</p><dl><dt>CECO</dt><dd>{selected.ceco || "—"}</dd><dt>Sitio</dt><dd>{selected.werks_manual || selected.werks || "—"}</dd><dt>Usuario</dt><dd>{selected.usuario_compras || "—"}</dd><dt>Comentario</dt><dd>{selected.comentario_compras || "—"}</dd></dl><Field label="Comentario"><textarea onChange={(event) => setComment(event.target.value)} placeholder="Opcional al aprobar" value={comment} /></Field></div>}
          {rejecting ? <div className="approval-reject"><p>El comentario será el motivo del rechazo.</p><div><button className="approval-text-button" disabled={busy} onClick={() => setRejecting(false)} type="button">Cancelar</button><button className="approval-reject-button" disabled={busy} onClick={() => submit("rechazar")} type="button">Confirmar rechazo</button></div></div> : <div className="approval-actions"><button className="approval-text-button" disabled={busy} onClick={() => setRejecting(true)} type="button">Rechazar</button><button className="approval-primary-button" disabled={busy} onClick={() => submit(role === "compras" ? "validar" : "aprobar")} type="button">{busy ? "Guardando…" : role === "compras" ? "Enviar a Gerencia" : "Aprobar factura"}</button></div>}
        </> : <div className="approval-detail-placeholder"><span>Selecciona una factura para revisarla</span></div>}
      </aside>
    </section>
  </div>;
}
