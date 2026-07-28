-- Lista limpia para revisión manual con Compras: por cada folio, se queda solo el
-- documento "final" (el de MBLNR más alto, que en los casos ya confirmados es el que
-- tiene el importe corregido tras una reversión), y de esos se listan los que aún
-- tienen cantidad discrepante pese a que el precio unitario coincide.
WITH mseg_docs AS (
  SELECT DISTINCT mseg.MBLNR
  FROM `proan-quantrue.D00_SANDBOX.proan_MSEG_HIDROCARBUROS_20260714` mseg
  LEFT JOIN `proan-quantrue.D20_DIMENSION.dm_material`
    ON mseg.MATNR = material_number
  WHERE external_material_group LIKE '151115%'
),
mseg_base AS (
  SELECT
    mseg.MBLNR, mseg.XBLNR_MKPF, mseg.DMBTR, mseg.ERFMG, mseg.KOSTL,
    SAFE.PARSE_DATE('%Y%m%d', CAST(mseg.BUDAT_MKPF AS STRING)) AS fecha,
    dm_v.rfc
  FROM `proan-quantrue.D00_SANDBOX.proan_MSEG_HIDROCARBUROS_20260714` mseg
  INNER JOIN mseg_docs USING (MBLNR)
  LEFT JOIN `proan-quantrue.D20_DIMENSION.dm_material`  dm_m ON mseg.MATNR = dm_m.material_number
  LEFT JOIN `proan-quantrue.D20_DIMENSION.dm_vendors`   dm_v ON mseg.LIFNR = dm_v.id_proveedor
  WHERE dm_m.external_material_group LIKE '151115%' AND dm_v.rfc IS NOT NULL
    AND mseg.XBLNR_MKPF IS NOT NULL AND TRIM(mseg.XBLNR_MKPF) != ''
),
final_por_folio AS (
  SELECT *, ROW_NUMBER() OVER (PARTITION BY rfc, XBLNR_MKPF ORDER BY MBLNR DESC) AS rn
  FROM mseg_base
),
cfdis_base AS (
  SELECT UUID, CAST(Folio AS STRING) AS folio_str, Serie, Importe, Cantidad, ValorUnitario, EmisorRfc
  FROM `proan-quantrue.D00_SANDBOX.cfdis`
  WHERE FechaTimbrado >= '2026-01-01' AND ClaveProdServ LIKE '151115%'
),
cskt_vigente AS (
  SELECT KOSTL, LTEXT FROM `proan-quantrue.D00_SANDBOX.proan_CSKT_20260714` WHERE DATBI = '99991231'
)
SELECT
  m.XBLNR_MKPF AS folio, m.fecha, k.LTEXT AS ceco,
  ROUND(m.ERFMG, 2) AS cantidad_sap, ROUND(c.Cantidad, 2) AS cantidad_cfdi,
  ROUND(SAFE_DIVIDE(m.ERFMG, c.Cantidad), 2) AS ratio_cantidad,
  ROUND(m.DMBTR, 2) AS importe_sap, ROUND(c.Importe, 2) AS importe_cfdi,
  ROUND(SAFE_DIVIDE(SAFE_DIVIDE(m.DMBTR, m.ERFMG), c.ValorUnitario), 3) AS ratio_precio_unitario
FROM final_por_folio m
INNER JOIN cfdis_base c
  ON UPPER(TRIM(m.rfc)) = UPPER(TRIM(c.EmisorRfc))
  AND REPLACE(UPPER(TRIM(m.XBLNR_MKPF)),' ','') = REPLACE(UPPER(TRIM(CONCAT(c.Serie,c.folio_str))),' ','')
LEFT JOIN cskt_vigente k ON m.KOSTL = k.KOSTL
WHERE m.rn = 1
  AND ABS(COALESCE(SAFE_DIVIDE(m.ERFMG, c.Cantidad), 1) - 1) > 0.02
ORDER BY m.fecha;
