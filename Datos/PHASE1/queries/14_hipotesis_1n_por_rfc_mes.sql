-- Prueba de la hipótesis "1 CFDI cubre varias recepciones SAP": agrega MSEG y CFDIs
-- por (RFC del proveedor, mes) y compara sumas/conteos. Solo agregados de negocio
-- (RFC de empresa, importes, fechas) -- nada de datos personales.
WITH mseg_docs AS (
  SELECT DISTINCT mseg.MBLNR
  FROM `proan-quantrue.D00_SANDBOX.proan_MSEG_HIDROCARBUROS_20260714` mseg
  LEFT JOIN `proan-quantrue.D20_DIMENSION.dm_material`
    ON mseg.MATNR = material_number
  WHERE external_material_group LIKE '151115%' OR ERFME IN ('L', 'M3')
),
mseg_base AS (
  SELECT
    mseg.MBLNR,
    SAFE.PARSE_DATE('%Y%m%d', CAST(mseg.BUDAT_MKPF AS STRING)) AS BUDAT_MKPF,
    mseg.DMBTR,
    dm_v.rfc
  FROM `proan-quantrue.D00_SANDBOX.proan_MSEG_HIDROCARBUROS_20260714` mseg
  INNER JOIN mseg_docs USING (MBLNR)
  LEFT JOIN `proan-quantrue.D20_DIMENSION.dm_material`  dm_m ON mseg.MATNR = dm_m.material_number
  LEFT JOIN `proan-quantrue.D20_DIMENSION.dm_vendors`   dm_v ON mseg.LIFNR = dm_v.id_proveedor
  WHERE (dm_m.external_material_group LIKE '151115%' OR mseg.ERFME IN ('L', 'M3'))
    AND dm_v.rfc IS NOT NULL
),
mseg_mensual AS (
  SELECT rfc, DATE_TRUNC(BUDAT_MKPF, MONTH) AS mes,
    COUNT(DISTINCT MBLNR) AS n_mseg, SUM(DMBTR) AS suma_mseg
  FROM mseg_base
  GROUP BY rfc, mes
),
cfdis_base AS (
  SELECT UUID, EmisorRfc, Importe, FechaTimbrado
  FROM `proan-quantrue.D00_SANDBOX.cfdis`
  WHERE FechaTimbrado >= '2026-01-01'
    AND ClaveProdServ LIKE '151115%'
),
cfdi_mensual AS (
  SELECT EmisorRfc AS rfc, DATE_TRUNC(DATE(FechaTimbrado), MONTH) AS mes,
    COUNT(DISTINCT UUID) AS n_cfdi, SUM(Importe) AS suma_cfdi
  FROM cfdis_base
  GROUP BY rfc, mes
)
SELECT
  COALESCE(m.rfc, c.rfc) AS rfc,
  COALESCE(m.mes, c.mes) AS mes,
  m.n_mseg, m.suma_mseg,
  c.n_cfdi, c.suma_cfdi,
  ROUND(m.suma_mseg - c.suma_cfdi, 2) AS diferencia,
  SAFE_DIVIDE(m.n_mseg, c.n_cfdi) AS ratio_docs
FROM mseg_mensual m
FULL OUTER JOIN cfdi_mensual c USING (rfc, mes)
WHERE m.n_mseg IS NULL OR c.n_cfdi IS NULL OR m.n_mseg != c.n_cfdi
ORDER BY ABS(COALESCE(m.suma_mseg,0) - COALESCE(c.suma_cfdi,0)) DESC
LIMIT 40;
