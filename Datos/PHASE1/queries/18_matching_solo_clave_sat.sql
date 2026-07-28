-- Repite el matching CFDI <-> MSEG del prototipo original, pero con el filtro corregido:
-- SOLO external_material_group LIKE '151115%' (se quita el OR ERFME IN ('L','M3')).
-- Universo esperado: ~35 documentos. Solo datos de negocio (RFC/razón social de empresas,
-- folios, importes) -- nada personal.
WITH mseg_docs AS (
  SELECT DISTINCT mseg.MBLNR
  FROM `proan-quantrue.D00_SANDBOX.proan_MSEG_HIDROCARBUROS_20260714` mseg
  LEFT JOIN `proan-quantrue.D20_DIMENSION.dm_material`
    ON mseg.MATNR = material_number
  WHERE external_material_group LIKE '151115%'
),
mseg_base AS (
  SELECT
    mseg.MBLNR,
    mseg.EBELN,
    mseg.WERKS,
    SAFE.PARSE_DATE('%Y%m%d', CAST(mseg.CPUDT_MKPF AS STRING)) AS CPUDT_MKPF,
    SAFE.PARSE_DATE('%Y%m%d', CAST(mseg.BUDAT_MKPF AS STRING)) AS BUDAT_MKPF,
    mseg.KOSTL,
    mseg.SAKTO,
    mseg.XBLNR_MKPF,
    mseg.DMBTR,
    mseg.ERFMG,
    mseg.LIFNR,
    dm_v.rfc,
    dm_v.razon_social,
    dm_m.material_name,
    dm_m.external_material_group,
    REGEXP_EXTRACT(mseg.XBLNR_MKPF, r'^([A-Za-z]+)')        AS xblnr_serie,
    REGEXP_EXTRACT(mseg.XBLNR_MKPF, r'[A-Za-z]+(\d+)$')     AS xblnr_folio,
    ROUND(mseg.DMBTR, 2)  AS dmbtr_r2,
    ROUND(mseg.DMBTR, 1)  AS dmbtr_r1,
    ROUND(mseg.ERFMG, 3)  AS erfmg_r3
  FROM `proan-quantrue.D00_SANDBOX.proan_MSEG_HIDROCARBUROS_20260714` mseg
  INNER JOIN mseg_docs USING (MBLNR)
  LEFT JOIN `proan-quantrue.D20_DIMENSION.dm_material`  dm_m ON mseg.MATNR = dm_m.material_number
  LEFT JOIN `proan-quantrue.D20_DIMENSION.dm_vendors`   dm_v ON mseg.LIFNR = dm_v.id_proveedor
  WHERE dm_m.external_material_group LIKE '151115%'
    AND dm_v.rfc IS NOT NULL
),
cfdis_base AS (
  SELECT
    *,
    CAST(Folio AS STRING)         AS folio_str,
    ROUND(Importe, 2)             AS importe_r2,
    ROUND(Importe, 1)             AS importe_r1,
    ROUND(Cantidad, 3)            AS cantidad_r3
  FROM `proan-quantrue.D00_SANDBOX.cfdis`
  WHERE FechaTimbrado >= '2026-01-01'
    AND ClaveProdServ LIKE '151115%'
),
scored AS (
  SELECT
    m.MBLNR, m.EBELN, m.WERKS, m.CPUDT_MKPF, m.BUDAT_MKPF, m.KOSTL, m.SAKTO,
    m.XBLNR_MKPF, m.DMBTR, m.ERFMG, m.rfc AS mseg_rfc, m.razon_social,
    c.UUID, c.Serie, c.Folio, c.FechaTimbrado, c.EmisorRfc, c.EmisorNombre,
    c.Importe, c.Cantidad, c.Descripcion, c.ClaveProdServ, c.Total, c.Moneda,
    (
      CASE WHEN REPLACE(UPPER(TRIM(m.XBLNR_MKPF)), ' ', '') = REPLACE(UPPER(TRIM(CONCAT(c.Serie, c.folio_str))), ' ', '')
           THEN 4 ELSE 0 END
      + CASE WHEN UPPER(TRIM(m.rfc)) = UPPER(TRIM(c.EmisorRfc)) THEN 2 ELSE 0 END
      + CASE WHEN m.dmbtr_r2 = c.importe_r2 THEN 3 WHEN m.dmbtr_r1 = c.importe_r1 THEN 1 ELSE 0 END
      + CASE WHEN m.erfmg_r3 = c.cantidad_r3 THEN 2 ELSE 0 END
    ) AS score,
    (REPLACE(UPPER(TRIM(m.XBLNR_MKPF)), ' ', '') = REPLACE(UPPER(TRIM(CONCAT(c.Serie, c.folio_str))), ' ', '')) AS match_folio,
    (UPPER(TRIM(m.rfc)) = UPPER(TRIM(c.EmisorRfc))) AS match_rfc,
    (m.dmbtr_r2 = c.importe_r2 OR m.dmbtr_r1 = c.importe_r1) AS match_importe,
    (m.erfmg_r3 = c.cantidad_r3) AS match_cantidad
  FROM mseg_base m
  INNER JOIN cfdis_base c ON UPPER(TRIM(m.rfc)) = UPPER(TRIM(c.EmisorRfc))
),
best_match AS (
  SELECT *,
    ROW_NUMBER() OVER (PARTITION BY MBLNR ORDER BY score DESC, ABS(DATE_DIFF(DATE(FechaTimbrado), DATE(CPUDT_MKPF), DAY)) ASC) AS rn_mseg,
    ROW_NUMBER() OVER (PARTITION BY UUID  ORDER BY score DESC, ABS(DATE_DIFF(DATE(FechaTimbrado), DATE(CPUDT_MKPF), DAY)) ASC) AS rn_cfdi
  FROM scored
  WHERE score >= 2
)
SELECT
  'Conciliado' AS estado, MBLNR, XBLNR_MKPF, DMBTR, ERFMG, mseg_rfc, razon_social,
  UUID, Serie, Folio, Importe, Cantidad, score, match_folio, match_rfc, match_importe, match_cantidad
FROM best_match
WHERE rn_mseg = 1 AND rn_cfdi = 1
ORDER BY score;
