import { describe, expect, it } from "vitest";
import { aprobacionGetRequirement, aprobacionPostRequirement } from "@/lib/auth/aprobacion-policy";

const UUID = "8f0a1f2c-1111-2222-3333-444455556666";

describe("aprobacionPostRequirement", () => {
  it("deja validar en Compras a cualquier sesión", () => {
    expect(aprobacionPostRequirement(["compras", UUID, "validar"])).toBe("any");
  });

  it("reserva a gerencia el rechazo desde Compras", () => {
    // El botón Rechazar también vive en la pestaña Compras: es el caso que se
    // escapa si solo se oculta la pestaña de Aprobación.
    expect(aprobacionPostRequirement(["compras", UUID, "rechazar"])).toBe("gerencia");
  });

  it("reserva a gerencia aprobar y rechazar", () => {
    expect(aprobacionPostRequirement(["gerencia", UUID, "aprobar"])).toBe("gerencia");
    expect(aprobacionPostRequirement(["gerencia", UUID, "rechazar"])).toBe("gerencia");
  });

  it("deja reabrir a cualquier sesión", () => {
    expect(aprobacionPostRequirement([UUID, "reabrir"])).toBe("any");
  });

  it("deniega formas de ruta desconocidas", () => {
    expect(aprobacionPostRequirement([])).toBe("denied");
    expect(aprobacionPostRequirement(["compras"])).toBe("denied");
    expect(aprobacionPostRequirement(["compras", UUID])).toBe("denied");
    expect(aprobacionPostRequirement(["compras", UUID, "aprobar"])).toBe("denied");
    expect(aprobacionPostRequirement(["gerencia", UUID, "validar"])).toBe("denied");
    expect(aprobacionPostRequirement(["otra", UUID, "validar"])).toBe("denied");
    expect(aprobacionPostRequirement([UUID, "borrar"])).toBe("denied");
    expect(aprobacionPostRequirement(["compras", UUID, "rechazar", "extra"])).toBe("denied");
  });

  it("deniega un uuid vacío", () => {
    expect(aprobacionPostRequirement(["compras", "", "validar"])).toBe("denied");
    expect(aprobacionPostRequirement(["", "reabrir"])).toBe("denied");
  });
});

describe("aprobacionGetRequirement", () => {
  it("abre las consultas que usa el portal de Compras", () => {
    expect(aprobacionGetRequirement("compras")).toBe("any");
    expect(aprobacionGetRequirement("historial")).toBe("any");
    expect(aprobacionGetRequirement("catalogo/ceco")).toBe("any");
    expect(aprobacionGetRequirement("catalogo/sitios")).toBe("any");
  });

  it("reserva la bandeja de Gerencia", () => {
    expect(aprobacionGetRequirement("gerencia")).toBe("gerencia");
  });

  it("deniega lo desconocido", () => {
    expect(aprobacionGetRequirement("")).toBe("denied");
    expect(aprobacionGetRequirement("catalogo")).toBe("denied");
    expect(aprobacionGetRequirement("gerencia/extra")).toBe("denied");
  });
});
