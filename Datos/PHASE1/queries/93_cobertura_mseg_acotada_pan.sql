-- Cobertura MSEG recalculada, con el lado CFDI también acotado a Proteína Animal
-- (el lado MSEG ya se confirmó 100% PAN vía BUKRS).
WITH mseg_docs AS (
  SELECT DISTINCT mseg.MBLNR
  FROM `proan-quantrue.D00_SANDBOX.proan_MSEG_HIDROCARBUROS_20260714` mseg
  LEFT JOIN `proan-quantrue.D20_DIMENSION.dm_material`
    ON mseg.MATNR = material_number
  WHERE external_material_group LIKE '151115%'
),
mseg_base AS (
  SELECT mseg.MBLNR, mseg.XBLNR_MKPF, dm_v.rfc
  FROM `proan-quantrue.D00_SANDBOX.proan_MSEG_HIDROCARBUROS_20260714` mseg
  INNER JOIN mseg_docs USING (MBLNR)
  LEFT JOIN `proan-quantrue.D20_DIMENSION.dm_material`  dm_m ON mseg.MATNR = dm_m.material_number
  LEFT JOIN `proan-quantrue.D20_DIMENSION.dm_vendors`   dm_v ON mseg.LIFNR = dm_v.id_proveedor
  WHERE dm_m.external_material_group LIKE '151115%' AND dm_v.rfc IS NOT NULL
),
cfdis_gas_pan AS (
  SELECT UUID, CAST(Folio AS STRING) AS folio_str, Serie, EmisorRfc
  FROM `proan-quantrue.D00_SANDBOX.cfdis`
  WHERE (ClaveProdServ LIKE '151115%' OR ClaveProdServ IN ('83101600','83101601'))
    AND ReceptorRfc = 'PAN921013AK7'
),
con_mseg AS (
  SELECT DISTINCT c.UUID
  FROM cfdis_gas_pan c
  INNER JOIN mseg_base m
    ON UPPER(TRIM(m.rfc)) = UPPER(TRIM(c.EmisorRfc))
    AND REPLACE(UPPER(TRIM(m.XBLNR_MKPF)),' ','') = REPLACE(UPPER(TRIM(CONCAT(c.Serie,c.folio_str))),' ','')
)
SELECT
  (SELECT COUNT(*) FROM cfdis_gas_pan) AS total_facturas_gas_pan,
  (SELECT COUNT(*) FROM con_mseg) AS facturas_con_mseg,
  ROUND(100 * (SELECT COUNT(*) FROM con_mseg) / (SELECT COUNT(*) FROM cfdis_gas_pan), 2) AS pct_con_mseg;
