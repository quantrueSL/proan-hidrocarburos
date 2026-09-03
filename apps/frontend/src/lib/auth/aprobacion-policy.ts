// ─────────────────────────────────────────────────────────────────────────
// Qué rol hace falta para cada operación de aprobación (LOGIN.md §3).
//
// Lista blanca explícita: una forma de ruta que no esté aquí se deniega. Es un
// proxy que escribe en BigQuery, así que lo que no se reconoce no pasa.
//
// Módulo puro (sin next/*) para poder testear la política sin montar rutas.
// ─────────────────────────────────────────────────────────────────────────

/** `"any"` = cualquier sesión autenticada. `"denied"` = forma de ruta desconocida. */
export type AprobacionRequirement = "any" | "gerencia" | "denied";

/**
 * Rutas POST reenviadas a FinancialBI:
 *
 *   compras/{uuid}/validar    → cualquiera (asignar CECO y centro no decide nada)
 *   compras/{uuid}/rechazar   → gerencia   (el botón Rechazar también vive en Compras)
 *   gerencia/{uuid}/aprobar   → gerencia
 *   gerencia/{uuid}/rechazar  → gerencia
 *   {uuid}/reabrir            → cualquiera (decisión explícita: el genérico puede reabrir)
 */
export function aprobacionPostRequirement(path: string[]): AprobacionRequirement {
  if (path.length === 3) {
    const [bandeja, uuid, accion] = path;
    if (!uuid) {
      return "denied";
    }
    if (bandeja === "compras") {
      if (accion === "validar") return "any";
      if (accion === "rechazar") return "gerencia";
      return "denied";
    }
    if (bandeja === "gerencia") {
      if (accion === "aprobar" || accion === "rechazar") return "gerencia";
      return "denied";
    }
    return "denied";
  }

  if (path.length === 2) {
    const [uuid, accion] = path;
    if (uuid && accion === "reabrir") return "any";
    return "denied";
  }

  return "denied";
}

/**
 * Rutas GET. La bandeja de Gerencia se reserva a gerencia por coherencia con la
 * pestaña oculta: ninguna pantalla del genérico la consulta, así que restringirla
 * no le quita nada. El resto es consulta que el genérico ya ve en Compras.
 */
export function aprobacionGetRequirement(key: string): AprobacionRequirement {
  switch (key) {
    case "compras":
    case "historial":
    case "catalogo/ceco":
    case "catalogo/sitios":
    case "catalogo/nucleo":
      return "any";
    case "gerencia":
      return "gerencia";
    default:
      return "denied";
  }
}
