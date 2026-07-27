"use client";

import { useEffect, useState } from "react";
import type { DashboardGastoItem } from "@/types/dashboard";

// Componentes de gráfico del dashboard (jul-2026). Sin librería externa --
// mismo criterio que el resto del proyecto (se quitó plotly como Maka-legacy).
// Reglas seguidas (skill dataviz): un eje siempre, color secuencial de un solo
// tono para magnitudes de una sola serie (nunca arcoíris en barras nominales),
// colores de estado reservados para categorías de estado real, tooltip en
// hover Y foco (teclado), leyenda siempre que haya ≥2 categorías.

const money = new Intl.NumberFormat("es-MX", { maximumFractionDigits: 0 });
const MES_LABEL: Record<string, string> = {
  "01": "ene", "02": "feb", "03": "mar", "04": "abr", "05": "may", "06": "jun",
  "07": "jul", "08": "ago", "09": "sep", "10": "oct", "11": "nov", "12": "dic"
};

export function formatMoney(value: number | null | undefined) {
  return `${money.format(value || 0)} MXN`;
}

export function formatMonth(grupo: string) {
  const [y, m] = grupo.split("-");
  return m && MES_LABEL[m] ? `${MES_LABEL[m]} ${y}` : grupo;
}

// Tarjetas compactas por defecto (más gráficos visibles a la vez) con un
// botón "ampliar" que reabre el mismo cuerpo del gráfico en un modal grande --
// mismo estado (metric/hover), sin duplicar lógica.
function useEscapeClose(active: boolean, onClose: () => void) {
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, onClose]);
}

function ExpandButton({ titulo, onClick }: { titulo: string; onClick: () => void }) {
  return <button aria-label={`Ampliar ${titulo}`} className="dashboard-expand-btn" onClick={onClick} title="Ampliar" type="button">⤢</button>;
}

function ExpandModal({ titulo, controls, onClose, children }: { titulo: string; controls?: React.ReactNode; onClose: () => void; children: React.ReactNode }) {
  useEscapeClose(true, onClose);
  return (
    <div className="dashboard-modal-backdrop" onClick={onClose}>
      <div aria-label={titulo} aria-modal="true" className="dashboard-modal-card" onClick={(e) => e.stopPropagation()} role="dialog">
        <div className="dashboard-card-head">
          <h3>{titulo}</h3>
          <div className="dashboard-card-head-actions">
            {controls}
            <button aria-label="Cerrar" className="dashboard-expand-btn" onClick={onClose} title="Cerrar" type="button">✕</button>
          </div>
        </div>
        {children}
      </div>
    </div>
  );
}

type Metric = "importe" | "facturas";

function MetricToggle({ metric, onChange }: { metric: Metric; onChange: (m: Metric) => void }) {
  return (
    <div className="dashboard-metric-toggle" role="group" aria-label="Métrica a mostrar">
      <button aria-pressed={metric === "importe"} onClick={() => onChange("importe")} type="button">Importe</button>
      <button aria-pressed={metric === "facturas"} onClick={() => onChange("facturas")} type="button">Facturas</button>
    </div>
  );
}

// Barras horizontales rankeadas -- una sola serie (magnitud), un solo tono
// secuencial (nunca colorea por categoría: el orden ya lo dice todo).
// fixedMetric: si se da, no se muestra el selector Importe/Facturas -- se usa
// siempre esa métrica (jul-2026: los gráficos de abajo del dashboard son solo
// conteo de facturas, sin toggle).
export function RankedBarChart({ items, titulo, maxRows = 5, fixedMetric }: { items: DashboardGastoItem[]; titulo: string; maxRows?: number; fixedMetric?: Metric }) {
  const [metric, setMetric] = useState<Metric>(fixedMetric ?? "importe");
  const activeMetric = fixedMetric ?? metric;
  const [hover, setHover] = useState<number | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [zoomed, setZoomed] = useState(false);
  const visibles = showAll || zoomed ? items : items.slice(0, maxRows);
  const valueOf = (item: DashboardGastoItem) => (activeMetric === "importe" ? item.importe_gas || 0 : item.n_facturas);
  const max = Math.max(1, ...items.map(valueOf));
  const restantes = items.length - visibles.length;

  const body = (
    <>
      {visibles.length ? (
        <ul className="dashboard-bar-list">
          {visibles.map((item, i) => {
            const v = valueOf(item);
            const pct = Math.max(2, (v / max) * 100);
            return (
              <li
                className={`dashboard-bar-row${hover === i ? " is-hover" : ""}`}
                key={item.grupo}
                onBlur={() => setHover(null)}
                onFocus={() => setHover(i)}
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover(null)}
                tabIndex={0}
              >
                <span className="dashboard-bar-label" title={item.grupo}>{item.grupo}</span>
                <div className="dashboard-bar-track" aria-hidden="true"><div className="dashboard-bar-fill" style={{ width: `${pct}%` }} /></div>
                <span className="dashboard-bar-value">{activeMetric === "importe" ? formatMoney(item.importe_gas) : `${item.n_facturas} fact.`}</span>
                {hover === i ? (
                  <div className="dashboard-tooltip dashboard-tooltip-row" role="tooltip">
                    <strong>{formatMoney(item.importe_gas)}</strong>
                    <span>{item.n_facturas} factura{item.n_facturas === 1 ? "" : "s"}</span>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : <p className="dashboard-empty">Sin datos todavía.</p>}
      {!zoomed && items.length > maxRows ? (
        <button className="dashboard-link-button" onClick={() => setShowAll((v) => !v)} type="button">
          {showAll ? "Ver menos" : `Ver ${restantes} más`}
        </button>
      ) : null}
    </>
  );
  const controls = fixedMetric ? null : <MetricToggle metric={metric} onChange={setMetric} />;

  return (
    <div className="dashboard-card">
      <div className="dashboard-card-head"><h3>{titulo}</h3><div className="dashboard-card-head-actions">{controls}<ExpandButton onClick={() => setZoomed(true)} titulo={titulo} /></div></div>
      {body}
      {zoomed ? <ExpandModal controls={controls} onClose={() => setZoomed(false)} titulo={titulo}>{body}</ExpandModal> : null}
    </div>
  );
}

// Tendencia mensual -- línea + área, un solo tono. Crosshair + tooltip por
// punto (hit target HTML de 24px, no el SVG -- foco de teclado incluido).
export function TrendChart({ items, titulo, fixedMetric }: { items: DashboardGastoItem[]; titulo: string; fixedMetric?: Metric }) {
  const [metric, setMetric] = useState<Metric>(fixedMetric ?? "importe");
  const activeMetric = fixedMetric ?? metric;
  const [hover, setHover] = useState<number | null>(null);
  const [zoomed, setZoomed] = useState(false);
  const W = 640;
  const H = 200;
  const PAD_X = 8;
  // Arriba: espacio para el valor sobre cada punto. Abajo: espacio para el
  // eje horizontal + la etiqueta del mes debajo de él.
  const PAD_TOP = 22;
  const PAD_BOTTOM = 34;
  const AXIS_Y = H - PAD_BOTTOM;
  const valueOf = (item: DashboardGastoItem) => (activeMetric === "importe" ? item.importe_gas || 0 : item.n_facturas);
  const max = Math.max(1, ...items.map(valueOf));
  const n = items.length;
  const xAt = (i: number) => (n <= 1 ? W / 2 : PAD_X + (i * (W - PAD_X * 2)) / (n - 1));
  const yAt = (v: number) => AXIS_Y - (v / max) * (AXIS_Y - PAD_TOP);
  const points = items.map((item, i) => ({ x: xAt(i), y: yAt(valueOf(item)), item }));
  const linePath = points.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ");
  const areaPath = points.length
    ? `${linePath} L ${points[points.length - 1].x.toFixed(1)} ${AXIS_Y} L ${points[0].x.toFixed(1)} ${AXIS_Y} Z`
    : "";
  const hovered = hover != null ? points[hover] : null;

  const body = (
    <>
      {points.length ? (
        <div className="dashboard-trend-wrap">
          <svg className="dashboard-trend-svg" preserveAspectRatio="none" role="img" aria-label={titulo} viewBox={`0 0 ${W} ${H}`}>
            <line className="dashboard-trend-axis" x1={PAD_X} x2={W - PAD_X} y1={AXIS_Y} y2={AXIS_Y} />
            <line className="dashboard-trend-axis" x1={PAD_X} x2={PAD_X} y1={PAD_TOP} y2={AXIS_Y} />
            <path className="dashboard-trend-area" d={areaPath} />
            <path className="dashboard-trend-line" d={linePath} />
            {hovered ? <line className="dashboard-trend-crosshair" x1={hovered.x} x2={hovered.x} y1={PAD_TOP} y2={AXIS_Y} /> : null}
            {points.map((p, i) => (
              <circle className={`dashboard-trend-dot${hover === i ? " is-hover" : ""}`} cx={p.x} cy={p.y} key={p.item.grupo} r={hover === i ? 5 : 4} />
            ))}
          </svg>
          {/* Etiquetas en HTML (no <text> de SVG) para que no se distorsionen --
              el SVG usa preserveAspectRatio="none" para llenar la tarjeta. */}
          <div className="dashboard-trend-values">
            {points.map((p) => (
              <span className="dashboard-trend-value" key={p.item.grupo} style={{ left: `${(p.x / W) * 100}%`, top: `${(p.y / H) * 100}%` }}>
                {activeMetric === "importe" ? formatMoney(p.item.importe_gas) : p.item.n_facturas}
              </span>
            ))}
          </div>
          <div className="dashboard-trend-xlabels" style={{ top: `${(AXIS_Y / H) * 100}%` }}>
            {points.map((p) => (
              <span className="dashboard-trend-xlabel" key={p.item.grupo} style={{ left: `${(p.x / W) * 100}%` }}>
                {MES_LABEL[p.item.grupo.split("-")[1]] ?? p.item.grupo}
              </span>
            ))}
          </div>
          <div className="dashboard-trend-hits">
            {points.map((p, i) => (
              <button
                aria-label={`${formatMonth(p.item.grupo)}: ${formatMoney(p.item.importe_gas)}, ${p.item.n_facturas} facturas`}
                className="dashboard-trend-hit"
                key={p.item.grupo}
                onBlur={() => setHover(null)}
                onFocus={() => setHover(i)}
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover(null)}
                style={{ left: `${(p.x / W) * 100}%` }}
                type="button"
              />
            ))}
          </div>
        </div>
      ) : <p className="dashboard-empty">Sin datos todavía.</p>}
    </>
  );
  const controls = fixedMetric ? null : <MetricToggle metric={metric} onChange={setMetric} />;

  return (
    <div className="dashboard-card">
      <div className="dashboard-card-head"><h3>{titulo}</h3><div className="dashboard-card-head-actions">{controls}<ExpandButton onClick={() => setZoomed(true)} titulo={titulo} /></div></div>
      {body}
      {zoomed ? <ExpandModal controls={controls} onClose={() => setZoomed(false)} titulo={titulo}>{body}</ExpandModal> : null}
    </div>
  );
}

export type StatusTone = "good" | "warning" | "critical" | "neutral";
export type StatusSegment = { label: string; value: number; tone: StatusTone };

const DONUT_R = 42;
const DONUT_CX = 60;
const DONUT_CY = 60;
const DONUT_C = 2 * Math.PI * DONUT_R;

// Donut de categorías de ESTADO real (no identidad genérica) -- colores de
// estado reservados, centro con el total, siempre con leyenda + etiqueta
// (nunca solo color). Reemplaza la barra de estado horizontal (jul-2026).
export function Donut({ segments, titulo }: { segments: StatusSegment[]; titulo: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const total = segments.reduce((s, seg) => s + seg.value, 0);
  const visibles = segments.filter((s) => s.value > 0);
  let acumulado = 0;
  const arcos = segments.map((seg) => {
    const frac = total ? seg.value / total : 0;
    const dash = frac * DONUT_C;
    const arco = { ...seg, dash, offset: -acumulado };
    acumulado += dash;
    return arco;
  });

  return (
    <div className="dashboard-card">
      <h3>{titulo}</h3>
      {visibles.length ? (
        <div className="dashboard-donut-wrap">
          <svg aria-label={titulo} className="dashboard-donut-svg" role="img" viewBox="0 0 120 120">
            <circle className="dashboard-donut-track" cx={DONUT_CX} cy={DONUT_CY} r={DONUT_R} />
            <g transform={`rotate(-90 ${DONUT_CX} ${DONUT_CY})`}>
              {arcos.map((seg, i) => seg.value > 0 ? (
                <circle
                  className={`dashboard-donut-arc tone-${seg.tone}${hover === i ? " is-hover" : ""}`}
                  cx={DONUT_CX}
                  cy={DONUT_CY}
                  key={seg.label}
                  onBlur={() => setHover(null)}
                  onFocus={() => setHover(i)}
                  onMouseEnter={() => setHover(i)}
                  onMouseLeave={() => setHover(null)}
                  r={DONUT_R}
                  strokeDasharray={`${seg.dash} ${DONUT_C - seg.dash}`}
                  strokeDashoffset={seg.offset}
                  tabIndex={0}
                />
              ) : null)}
            </g>
            <text className="dashboard-donut-total" x={DONUT_CX} y={DONUT_CY - 4}>{money.format(total)}</text>
            <text className="dashboard-donut-caption" x={DONUT_CX} y={DONUT_CY + 13}>facturas</text>
          </svg>
          {hover != null ? (
            <div className="dashboard-tooltip dashboard-tooltip-donut" role="tooltip">
              <strong>{segments[hover].value}</strong>
              <span>{segments[hover].label} · {Math.round((segments[hover].value / (total || 1)) * 100)}%</span>
            </div>
          ) : null}
          <ul className="dashboard-status-legend">
            {segments.map((seg) => (
              <li key={seg.label}><span className={`dashboard-status-dot tone-${seg.tone}`} aria-hidden="true" />{seg.label} <b>{seg.value}</b></li>
            ))}
          </ul>
        </div>
      ) : <p className="dashboard-empty">Sin datos todavía.</p>}
    </div>
  );
}
