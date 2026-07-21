import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import {
  getSessionCookieName,
  isSecureSessionCookie
} from "@/lib/env";
import type { FrontendSession } from "@/types/auth";

function encodeSession(session: FrontendSession): string {
  return Buffer.from(JSON.stringify(session), "utf8").toString("base64url");
}

function decodeSession(value: string): FrontendSession | null {
  try {
    const decoded = Buffer.from(value, "base64url").toString("utf8");
    return JSON.parse(decoded) as FrontendSession;
  } catch {
    return null;
  }
}

export function getSession(): FrontendSession | null {
  const cookieStore = cookies();
  const rawValue = cookieStore.get(getSessionCookieName())?.value;

  if (!rawValue) {
    return null;
  }

  return decodeSession(rawValue);
}

export function requireSession(): FrontendSession {
  const session = getSession();

  if (!session) {
    redirect("/login");
  }

  return session;
}

export function setSession(session: FrontendSession): void {
  const cookieStore = cookies();
  const expiresAt = session.expiresAt ? new Date(session.expiresAt * 1000) : undefined;

  cookieStore.set({
    name: getSessionCookieName(),
    value: encodeSession(session),
    httpOnly: true,
    sameSite: "lax",
    secure: isSecureSessionCookie(),
    path: "/",
    expires: expiresAt
  });
}

export function clearSession(): void {
  const cookieStore = cookies();
  cookieStore.delete(getSessionCookieName());
}

