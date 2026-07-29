import type { FrontendSession, SessionRole } from "@/types/auth";

// ─────────────────────────────────────────────────────────────────────────
// Roles de sesión (ver LOGIN.md §3).
//
//   gerencia  → puede todo.
//   generico  → todo menos aceptar o rechazar facturas: sin pestaña
//               Aprobación y sin el botón Rechazar de Compras.
//
// El rol vive en la sesión firmada del servidor. Nunca se lee del body ni de
// nada que el cliente pueda escribir.
// ─────────────────────────────────────────────────────────────────────────

export const SESSION_ROLES = ["gerencia", "generico"] as const;

export const DEFAULT_SESSION_ROLE: SessionRole = "generico";

export function isSessionRole(value: unknown): value is SessionRole {
  return typeof value === "string" && (SESSION_ROLES as readonly string[]).includes(value);
}

/** Rol desconocido o ausente → el menos privilegiado (fail-closed). */
export function normalizeSessionRole(value: unknown): SessionRole {
  return isSessionRole(value) ? value : DEFAULT_SESSION_ROLE;
}

export function isGerencia(session: Pick<FrontendSession, "role"> | null): boolean {
  return session?.role === "gerencia";
}

/** Aceptar o rechazar facturas, en Compras y en Gerencia. */
export function canDecidirFacturas(session: Pick<FrontendSession, "role"> | null): boolean {
  return isGerencia(session);
}

/** Ver la pestaña y la página de Aprobación. */
export function canAccessAprobacion(session: Pick<FrontendSession, "role"> | null): boolean {
  return isGerencia(session);
}
