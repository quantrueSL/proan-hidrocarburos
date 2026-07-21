function readEnv(name: string, fallback: string): string {
  const value = process.env[name]?.trim();
  return value && value.length > 0 ? value : fallback;
}

/** URL del servicio FinancialBI (reportes + alertas). */
export function getFinancialbiServiceUrl(): string {
  return readEnv("FINANCIALBI_SERVICE_URL", "http://localhost:8091");
}

/** Ruta al fichero .htpasswd usado para autenticar el login. */
export function getHtpasswdPath(): string {
  return readEnv("HTPASSWD_PATH", "/app/.htpasswd");
}

/** TTL de la sesión (segundos). Por defecto 8 h. */
export function getSessionTtlSeconds(): number {
  const parsed = Number.parseInt(readEnv("SESSION_TTL_SECONDS", "28800"), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 28800;
}

export function getSessionCookieName(): string {
  return readEnv("SESSION_COOKIE_NAME", "carb_session");
}

export function isSecureSessionCookie(): boolean {
  return readEnv("SESSION_COOKIE_SECURE", "false").toLowerCase() === "true";
}
