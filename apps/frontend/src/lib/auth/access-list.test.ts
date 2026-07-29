import { describe, expect, it } from "vitest";
import { normalizeEmail, parseAccessList, resolveAccessDecision } from "@/lib/auth/access-list";

// Copia del documento real creado a mano en la consola el 2026-07-29, campos
// extra incluidos y sin `comment` — tal cual está en Firestore.
const DOCUMENTO_REAL = {
  emails: ["pablocomavalbuena@gmail.com", "fromeominorqt@gmail.com"],
  enabled: true,
  name: "Acceso Hidrocarburos",
  roles: {
    "fromeominorqt@gmail.com": "gerencia",
    "pablocomavalbuena@gmail.com": "generico"
  },
  updated_at: new Date("2026-07-29T09:50:21.000Z"),
  updated_by: "consola"
};

describe("parseAccessList sobre el documento real", () => {
  it("resuelve los dos roles configurados", () => {
    const list = parseAccessList(DOCUMENTO_REAL);
    expect(list).toEqual({
      enabled: true,
      entries: {
        "pablocomavalbuena@gmail.com": "generico",
        "fromeominorqt@gmail.com": "gerencia"
      }
    });
  });

  it("ignora los campos que no le incumben", () => {
    // name, updated_at y updated_by no deben estorbar, y la falta de `comment`
    // tampoco: el documento se creó sin él.
    expect(parseAccessList(DOCUMENTO_REAL)?.enabled).toBe(true);
  });
});

describe("parseAccessList", () => {
  it("da genérico a quien está en emails sin entrada en roles", () => {
    const list = parseAccessList({ emails: ["sin.rol@proan.com"], roles: {} });
    expect(list?.entries).toEqual({ "sin.rol@proan.com": "generico" });
  });

  it("ignora entradas de roles que no están en emails", () => {
    // `emails` es la puerta: conceder un rol no da acceso por sí solo.
    const list = parseAccessList({
      emails: ["dentro@proan.com"],
      roles: { "dentro@proan.com": "gerencia", "fuera@proan.com": "gerencia" }
    });
    expect(list?.entries).toEqual({ "dentro@proan.com": "gerencia" });
    expect(resolveAccessDecision(list, "fuera@proan.com")).toEqual({ status: "denied", reason: "not-listed" });
  });

  it("degrada a genérico un rol mal escrito", () => {
    // El caso realista: teclear "gerente" o "Gerencia" en la consola.
    const list = parseAccessList({
      emails: ["a@proan.com", "b@proan.com", "c@proan.com"],
      roles: { "a@proan.com": "gerente", "b@proan.com": "Gerencia", "c@proan.com": 1 }
    });
    expect(list?.entries).toEqual({
      "a@proan.com": "generico",
      "b@proan.com": "generico",
      "c@proan.com": "generico"
    });
  });

  it("normaliza mayúsculas y espacios en los dos lados", () => {
    const list = parseAccessList({
      emails: ["  Gema.Gonzalez@Proan.com  "],
      roles: { "GEMA.GONZALEZ@proan.com": "gerencia" }
    });
    expect(resolveAccessDecision(list, " gema.gonzalez@PROAN.com ")).toEqual({
      status: "allowed",
      role: "gerencia"
    });
  });

  it("enabled ausente equivale a true, como en Mailing-lists", () => {
    expect(parseAccessList({ emails: ["a@proan.com"] })?.enabled).toBe(true);
  });

  it("tolera formas inesperadas sin reventar", () => {
    expect(parseAccessList({ emails: "no-es-lista", roles: [] })?.entries).toEqual({});
    expect(parseAccessList({ emails: [null, 42, "", "ok@proan.com"] })?.entries).toEqual({
      "ok@proan.com": "generico"
    });
    expect(parseAccessList(null)).toBeNull();
    expect(parseAccessList([])).toBeNull();
    expect(parseAccessList("texto")).toBeNull();
  });
});

describe("resolveAccessDecision", () => {
  const list = parseAccessList(DOCUMENTO_REAL);

  it("permite a quien está en la lista, con su rol", () => {
    expect(resolveAccessDecision(list, "fromeominorqt@gmail.com")).toEqual({
      status: "allowed",
      role: "gerencia"
    });
    expect(resolveAccessDecision(list, "pablocomavalbuena@gmail.com")).toEqual({
      status: "allowed",
      role: "generico"
    });
  });

  it("deniega a quien no está", () => {
    expect(resolveAccessDecision(list, "cualquiera@gmail.com")).toEqual({
      status: "denied",
      reason: "not-listed"
    });
  });

  it("deniega si la lista está deshabilitada, aunque el correo figure", () => {
    const apagada = parseAccessList({ ...DOCUMENTO_REAL, enabled: false });
    expect(resolveAccessDecision(apagada, "fromeominorqt@gmail.com")).toEqual({
      status: "denied",
      reason: "list-disabled"
    });
  });

  it("deniega si el documento no existe", () => {
    expect(resolveAccessDecision(null, "fromeominorqt@gmail.com")).toEqual({
      status: "denied",
      reason: "list-missing"
    });
  });

  it("no concede acceso con un correo vacío", () => {
    expect(resolveAccessDecision(list, "").status).toBe("denied");
  });
});

describe("normalizeEmail", () => {
  it("recorta y pasa a minúsculas", () => {
    expect(normalizeEmail("  A@B.com ")).toBe("a@b.com");
  });

  it("convierte lo que no es texto en cadena vacía", () => {
    expect(normalizeEmail(null)).toBe("");
    expect(normalizeEmail(42)).toBe("");
  });
});
