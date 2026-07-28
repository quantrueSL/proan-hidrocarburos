-- ¿Los documentos con importe/cantidad "raro" (score 6: folio+RFC ok, importe/cantidad no)
-- son en realidad reversiones (BWART 102) en vez de recepciones normales (BWART 101)?
WITH mseg_docs AS (
  SELECT DISTINCT mseg.MBLNR
  FROM `proan-quantrue.D00_SANDBOX.proan_MSEG_HIDROCARBUROS_20260714` mseg
  LEFT JOIN `proan-quantrue.D20_DIMENSION.dm_material`
    ON mseg.MATNR = material_number
  WHERE external_material_group LIKE '151115%'
),
mseg_base AS (
  SELECT
    mseg.MBLNR, mseg.BWART, mseg.XBLNR_MKPF, mseg.DMBTR, mseg.ERFMG, dm_v.rfc,
    REGEXP_EXTRACT(mseg.XBLNR_MKPF, r'^([A-Za-z]+)')    AS xblnr_serie,
    REGEXP_EXTRACT(mseg.XBLNR_MKPF, r'[A-Za-z]+(\d+)$') AS xblnr_folio,
    ROUND(mseg.DMBTR, 2)  AS dmbtr_r2,
    ROUND(mseg.DMBTR, 1)  AS dmbtr_r1,
    ROUND(mseg.ERFMG, 3)  AS erfmg_r3
  FROM `proan-quantrue.D00_SANDBOX.proan_MSEG_HIDROCARBUROS_20260714` mseg
  INNER JOIN mseg_docs USING (MBLNR)
  LEFT JOIN `proan-quantrue.D20_DIMENSION.dm_material`  dm_m ON mseg.MATNR = dm_m.material_number
  LEFT JOIN `proan-quantrue.D20_DIMENSION.dm_vendors`   dm_v ON mseg.LIFNR = dm_v.id_proveedor
  WHERE dm_m.external_material_group LIKE '151115%' AND dm_v.rfc IS NOT NULL
),
cfdis_base AS (
  SELECT UUID, CAST(Folio AS STRING) AS folio_str, Serie, Importe, Cantidad, EmisorRfc,
    ROUND(Importe, 2) AS importe_r2, ROUND(Importe, 1) AS importe_r1, ROUND(Cantidad, 3) AS cantidad_r3
  FROM `proan-quantrue.D00_SANDBOX.cfdis`
  WHERE FechaTimbrado >= '2026-01-01' AND ClaveProdServ LIKE '151115%'
),
scored AS (
  SELECT m.MBLNR, m.BWART, m.XBLNR_MKPF, m.DMBTR, m.ERFMG, c.UUID, c.Importe, c.Cantidad,
    (REPLACE(UPPER(TRIM(m.XBLNR_MKPF)),' ','') = REPLACE(UPPER(TRIM(CONCAT(c.Serie,c.folio_str))),' ','')) AS match_folio,
    (UPPER(TRIM(m.rfc)) = UPPER(TRIM(c.EmisorRfc))) AS match_rfc,
    (m.dmbtr_r2 = c.importe_r2 OR m.dmbtr_r1 = c.importe_r1) AS match_importe,
    (m.erfmg_r3 = c.cantidad_r3) AS match_cantidad,
    ROW_NUMBER() OVER (PARTITION BY m.MBLNR ORDER BY
      (CASE WHEN REPLACE(UPPER(TRIM(m.XBLNR_MKPF)),' ','') = REPLACE(UPPER(TRIM(CONCAT(c.Serie,c.folio_str))),' ','') THEN 4 ELSE 0 END
      + CASE WHEN UPPER(TRIM(m.rfc)) = UPPER(TRIM(c.EmisorRfc)) THEN 2 ELSE 0 END) DESC
    ) AS rn
  FROM mseg_base m
  INNER JOIN cfdis_base c ON UPPER(TRIM(m.rfc)) = UPPER(TRIM(c.EmisorRfc))
)
SELECT BWART, match_importe, match_cantidad, COUNT(*) AS n, ROUND(AVG(DMBTR),2) AS dmbtr_promedio
FROM scored
WHERE rn = 1 AND match_folio AND match_rfc
GROUP BY BWART, match_importe, match_cantidad
ORDER BY BWART, match_importe;
