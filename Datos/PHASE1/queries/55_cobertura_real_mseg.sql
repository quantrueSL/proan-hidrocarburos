-- ¿Qué porcentaje de las 1,088 facturas de gas (151115xx, los 17 proveedores) tiene
-- de verdad un documento MSEG conciliable, incluso contando solo el "buen" proveedor?
WITH mseg_docs AS (
  SELECT DISTINCT mseg.MBLNR
  FROM `proan-quantrue.D00_SANDBOX.proan_MSEG_HIDROCARBUROS_20260714` mseg
  LEFT JOIN `proan-quantrue.D20_DIMENSION.dm_material`
    ON mseg.MATNR = material_number
  WHERE external_material_group LIKE '151115%'
),
mseg_base AS (
  SELECT mseg.MBLNR, mseg.XBLNR_MKPF, dm_v.rfc,
    REGEXP_EXTRACT(mseg.XBLNR_MKPF, r'^([A-Za-z]+)')    AS xblnr_serie,
    REGEXP_EXTRACT(mseg.XBLNR_MKPF, r'[A-Za-z]+(\d+)$') AS xblnr_folio
  FROM `proan-quantrue.D00_SANDBOX.proan_MSEG_HIDROCARBUROS_20260714` mseg
  INNER JOIN mseg_docs USING (MBLNR)
  LEFT JOIN `proan-quantrue.D20_DIMENSION.dm_material`  dm_m ON mseg.MATNR = dm_m.material_number
  LEFT JOIN `proan-quantrue.D20_DIMENSION.dm_vendors`   dm_v ON mseg.LIFNR = dm_v.id_proveedor
  WHERE dm_m.external_material_group LIKE '151115%' AND dm_v.rfc IS NOT NULL
),
cfdis_gas AS (
  SELECT UUID, CAST(Folio AS STRING) AS folio_str, Serie, EmisorRfc
  FROM `proan-quantrue.D00_SANDBOX.cfdis`
  WHERE FechaTimbrado >= '2026-01-01' AND ClaveProdServ LIKE '151115%'
),
con_mseg AS (
  SELECT DISTINCT c.UUID
  FROM cfdis_gas c
  INNER JOIN mseg_base m
    ON UPPER(TRIM(m.rfc)) = UPPER(TRIM(c.EmisorRfc))
    AND REPLACE(UPPER(TRIM(m.XBLNR_MKPF)),' ','') = REPLACE(UPPER(TRIM(CONCAT(c.Serie,c.folio_str))),' ','')
)
SELECT
  (SELECT COUNT(*) FROM cfdis_gas) AS total_facturas_gas,
  (SELECT COUNT(*) FROM con_mseg) AS facturas_con_mseg,
  ROUND(100 * (SELECT COUNT(*) FROM con_mseg) / (SELECT COUNT(*) FROM cfdis_gas), 2) AS pct_con_mseg,
  (SELECT COUNT(*) FROM cfdis_gas WHERE EmisorRfc = 'DGN811026BU6') AS total_facturas_proveedor_bueno,
  (SELECT COUNT(*) FROM con_mseg c INNER JOIN cfdis_gas g ON c.UUID = g.UUID WHERE g.EmisorRfc = 'DGN811026BU6') AS con_mseg_proveedor_bueno;
