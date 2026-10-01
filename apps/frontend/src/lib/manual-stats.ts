import type { DashboardResumen } from "@/types/dashboard";

/** Cifras de conciliación que muestra el manual de usuario, siempre calculadas sobre todo el universo. */
export type ManualStats = {
  total: number;
  validadasSap: number;
  msegAlta: number;
  conSitio: number;
  cecoTicket: number;
  cecoProveedor: number;
  cecoDocumento: number;
  cecoVariasOpciones: number;
  cecoSinSugerencia: number;
  updatedAt: string | null;
};

const percentFormatter = new Intl.NumberFormat("es-ES", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const countFormatter = new Intl.NumberFormat("es-ES");

/** `null` si el resumen no trae todas las cifras (por ejemplo, un servicio financialbi más antiguo): mejor "—" que un 0 falso. */
export function buildManualStats(resumen: Partial<DashboardResumen> | undefined, updatedAt?: string | null): ManualStats | null {
  if (!resumen) return null;
  const {
    total_facturas, validadas_sap, mseg_alta, con_sitio, ceco_ticket, ceco_proveedor, ceco_documento, ceco_documento_multiple, ceco_sin_sugerencia
  } = resumen;
  const values = [total_facturas, validadas_sap, mseg_alta, con_sitio, ceco_ticket, ceco_proveedor, ceco_documento, ceco_documento_multiple, ceco_sin_sugerencia];
  if (!values.every((value): value is number => typeof value === "number" && Number.isFinite(value))) return null;
  return {
    total: total_facturas as number,
    validadasSap: validadas_sap as number,
    msegAlta: mseg_alta as number,
    conSitio: con_sitio as number,
    cecoTicket: ceco_ticket as number,
    cecoProveedor: ceco_proveedor as number,
    cecoDocumento: ceco_documento as number,
    cecoVariasOpciones: ceco_documento_multiple as number,
    cecoSinSugerencia: ceco_sin_sugerencia as number,
    updatedAt: updatedAt ?? null
  };
}

export function formatCount(value: number | null | undefined): string {
  return value == null ? "—" : countFormatter.format(value);
}

/** Porcentaje con coma decimal ("91,2%"), o "—" si no hay universo sobre el que calcularlo. */
export function formatPercent(count: number | null | undefined, total: number | null | undefined): string {
  if (count == null || !total || total <= 0) return "—";
  return `${percentFormatter.format((count / total) * 100)}%`;
}
