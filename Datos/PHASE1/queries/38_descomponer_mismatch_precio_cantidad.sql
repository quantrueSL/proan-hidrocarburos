-- Descomponer el mismatch de importe: ¿es un problema de PRECIO unitario, de CANTIDAD,
-- o de ambos sin patrón? Si precio_mseg/precio_cfdi es ~estable, el problema es de cantidad
-- (posible diferencia de unidad); si no, es un problema de valuación/captura de precio.
WITH mseg_docs AS (
  SELECT DISTINCT mseg.MBLNR
  FROM `proan-quantrue.D00_SANDBOX.proan_MSEG_HIDROCARBUROS_20260714` mseg
  LEFT JOIN `proan-quantrue.D20_DIMENSION.dm_material`
    ON mseg.MATNR = material_number
  WHERE external_material_group LIKE '151115%'
),
mseg_base AS (
  SELECT
    mseg.MBLNR, mseg.XBLNR_MKPF, mseg.DMBTR, mseg.ERFMG, mseg.ERFME, dm_v.rfc,
    REGEXP_EXTRACT(mseg.XBLNR_MKPF, r'^([A-Za-z]+)')    AS xblnr_serie,
    REGEXP_EXTRACT(mseg.XBLNR_MKPF, r'[A-Za-z]+(\d+)$') AS xblnr_folio
  FROM `proan-quantrue.D00_SANDBOX.proan_MSEG_HIDROCARBUROS_20260714` mseg
  INNER JOIN mseg_docs USING (MBLNR)
  LEFT JOIN `proan-quantrue.D20_DIMENSION.dm_material`  dm_m ON mseg.MATNR = dm_m.material_number
  LEFT JOIN `proan-quantrue.D20_DIMENSION.dm_vendors`   dm_v ON mseg.LIFNR = dm_v.id_proveedor
  WHERE dm_m.external_material_group LIKE '151115%' AND dm_v.rfc IS NOT NULL
),
cfdis_base AS (
  SELECT UUID, CAST(Folio AS STRING) AS folio_str, Serie, Importe, Cantidad, ClaveUnidad,
    ValorUnitario, EmisorRfc
  FROM `proan-quantrue.D00_SANDBOX.cfdis`
  WHERE FechaTimbrado >= '2026-01-01' AND ClaveProdServ LIKE '151115%'
),
matched AS (
  SELECT m.MBLNR, m.DMBTR, m.ERFMG, m.ERFME, c.UUID, c.Importe, c.Cantidad, c.ClaveUnidad, c.ValorUnitario
  FROM mseg_base m
  INNER JOIN cfdis_base c
    ON UPPER(TRIM(m.rfc)) = UPPER(TRIM(c.EmisorRfc))
    AND REPLACE(UPPER(TRIM(m.XBLNR_MKPF)),' ','') = REPLACE(UPPER(TRIM(CONCAT(c.Serie,c.folio_str))),' ','')
)
SELECT
  MBLNR, ERFME, ClaveUnidad,
  ROUND(DMBTR,2) AS dmbtr, ROUND(ERFMG,2) AS erfmg,
  ROUND(Importe,2) AS importe_cfdi, ROUND(Cantidad,2) AS cantidad_cfdi, ROUND(ValorUnitario,4) AS precio_cfdi,
  ROUND(SAFE_DIVIDE(DMBTR, ERFMG), 4) AS precio_implicito_mseg,
  ROUND(SAFE_DIVIDE(SAFE_DIVIDE(DMBTR, ERFMG), ValorUnitario), 4) AS ratio_precio,
  ROUND(SAFE_DIVIDE(ERFMG, Cantidad), 4) AS ratio_cantidad,
  ROUND(SAFE_DIVIDE(DMBTR, Importe), 4) AS ratio_importe_total
FROM matched
ORDER BY MBLNR;
