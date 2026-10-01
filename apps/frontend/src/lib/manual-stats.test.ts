import { describe, expect, it } from "vitest";
import { buildManualStats, formatCount, formatPercent } from "./manual-stats";

const resumen = {
  total_facturas: 657,
  validadas_sap: 611,
  mseg_alta: 497,
  con_sitio: 437,
  ceco_ticket: 284,
  ceco_proveedor: 41,
  ceco_documento: 11,
  ceco_documento_multiple: 157,
  ceco_sin_sugerencia: 164
};

describe("formatPercent", () => {
  it("usa coma decimal y un decimal", () => {
    expect(formatPercent(611, 657)).toBe("93,0%");
    expect(formatPercent(497, 657)).toBe("75,6%");
    expect(formatPercent(437, 657)).toBe("66,5%");
  });

  it("no inventa un porcentaje sin universo", () => {
    expect(formatPercent(0, 0)).toBe("—");
    expect(formatPercent(null, 10)).toBe("—");
    expect(formatPercent(5, undefined)).toBe("—");
  });

  it("muestra 0,0% cuando el universo existe pero no hay coincidencias", () => {
    expect(formatPercent(0, 10)).toBe("0,0%");
  });
});

describe("formatCount", () => {
  it("formatea enteros y marca los ausentes", () => {
    expect(formatCount(157)).toBe("157");
    expect(formatCount(0)).toBe("0");
    expect(formatCount(null)).toBe("—");
  });
});

describe("buildManualStats", () => {
  it("traslada las cifras del resumen y la fecha de actualización", () => {
    const stats = buildManualStats(resumen, "2026-09-09T13:30:00Z");
    expect(stats).toMatchObject({ total: 657, validadasSap: 611, msegAlta: 497, conSitio: 437, cecoVariasOpciones: 157, cecoSinSugerencia: 164 });
    expect(stats?.updatedAt).toBe("2026-09-09T13:30:00Z");
  });

  it("devuelve null si falta alguna cifra en lugar de mostrar ceros falsos", () => {
    const { con_sitio: _omitida, ...incompleto } = resumen;
    expect(buildManualStats(incompleto)).toBeNull();
    expect(buildManualStats(undefined)).toBeNull();
  });
});
