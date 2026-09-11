import { readFile } from "node:fs/promises";
import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import {
  consumeLoginAttempt,
  getClientAddress,
  getLoginRateLimitKey,
  resetLoginAttempts
} from "@/lib/auth/login-rate-limit";
import { clearSession, setSession } from "@/lib/auth/session";
import { getHtpasswdPath, getSessionTtlSeconds } from "@/lib/env";
import { getDefaultAuthenticatedRoute } from "../../../../client.config";

// Este handler lee el sistema de ficheros (.htpasswd) → runtime Node, nunca Edge.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ─────────────────────────────────────────────────────────────────────────
// Autenticación por .htpasswd (bcrypt), sin servicio de auth externo.
//
// Sustituye al antiguo fetch contra el microservicio LDAP de Maka
// (AUTH_LOGIN_URL). Los usuarios se crean a mano en el fichero .htpasswd
// (ver README: `htpasswd -B` o el script scripts/htpasswd). Cada línea es
//   usuario:$2b$...   (hash bcrypt; se acepta también el prefijo $2y$ de
// Apache, normalizándolo a $2b$ como hace bcryptjs).
// ─────────────────────────────────────────────────────────────────────────

type LoginRequestBody = {
  username?: string;
  password?: string;
};

/** Devuelve el hash bcrypt del usuario en el .htpasswd, o null si no existe. */
async function lookupHtpasswdHash(username: string): Promise<string | null> {
  let content: string;
  try {
    content = await readFile(getHtpasswdPath(), "utf8");
  } catch {
    throw new Error("No se pudo leer el fichero .htpasswd.");
  }

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || !line.includes(":")) {
      continue;
    }
    const idx = line.indexOf(":");
    const user = line.slice(0, idx);
    if (user === username) {
      // Apache emite $2y$; bcryptjs espera $2a$/$2b$. Son intercambiables.
      return line.slice(idx + 1).replace(/^\$2y\$/, "$2b$");
    }
  }
  return null;
}

export async function POST(request: Request) {
  let body: LoginRequestBody;
  try {
    body = (await request.json()) as LoginRequestBody;
  } catch {
    return NextResponse.json({ detail: "Cuerpo JSON inválido." }, { status: 400 });
  }

  const username = body.username?.trim() ?? "";
  const password = body.password ?? "";

  if (!username || !password) {
    return NextResponse.json(
      { detail: "Usuario y contraseña son obligatorios." },
      { status: 400 }
    );
  }

  let hash: string | null;
  try {
    hash = await lookupHtpasswdHash(username);
  } catch (error) {
    clearSession();
    return NextResponse.json(
      { detail: error instanceof Error ? error.message : "Error de autenticación." },
      { status: 500 }
    );
  }

  // Se reserva antes de bcrypt, que es la operación costosa que queremos proteger.
  const rateLimitKey = getLoginRateLimitKey(getClientAddress(request));
  const rateLimit = await consumeLoginAttempt(rateLimitKey);
  if (rateLimit.usedFallback) {
    console.warn(JSON.stringify({ event: "rate_limit_store_error", operation: "consume" }));
  }
  if (!rateLimit.allowed) {
    clearSession();
    console.warn(
      JSON.stringify({ event: "login_blocked", retry_after_seconds: rateLimit.retryAfterSeconds })
    );
    return NextResponse.json(
      { detail: "Demasiados intentos. Vuelve a intentarlo más tarde." },
      { status: 429, headers: { "Retry-After": String(rateLimit.retryAfterSeconds) } }
    );
  }

  const passwordOk = hash ? await bcrypt.compare(password, hash) : false;
  if (!passwordOk) {
    clearSession();
    console.warn(JSON.stringify({ event: "login_failed" }));
    // Mensaje genérico: no revelar si el usuario existe.
    return NextResponse.json({ detail: "Credenciales inválidas." }, { status: 401 });
  }

  const email = username.includes("@") ? username : `${username}@carb.local`;
  const expiresAt = Math.floor(Date.now() / 1000) + getSessionTtlSeconds();

  setSession({
    token: "htpasswd",
    email,
    username,
    displayName: username,
    gatewayUserId: username,
    apps: ["financialbi"],
    subject: username,
    // Decisión (LOGIN.md §2.7): el .htpasswd es la vía de Quantrue y de
    // administración, así que implica acceso total.
    role: "gerencia",
    expiresAt
  });

  const reset = await resetLoginAttempts(rateLimitKey);
  if (reset.usedFallback) {
    console.warn(JSON.stringify({ event: "rate_limit_store_error", operation: "reset" }));
  }

  return NextResponse.json({
    ok: true,
    redirectTo: getDefaultAuthenticatedRoute()
  });
}
