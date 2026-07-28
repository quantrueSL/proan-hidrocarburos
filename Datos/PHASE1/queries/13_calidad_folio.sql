-- Calidad del campo XBLNR_MKPF (folio tecleado a mano en SAP) sobre documentos de hidrocarburo.
-- XBLNR_MKPF es de cabecera (MKPF), por eso se deduplica por MBLNR antes de contar. Solo agregados.
WITH mseg_docs AS (
  SELECT DISTINCT mseg.MBLNR
  FROM `proan-quantrue.D00_SANDBOX.proan_MSEG_HIDROCARBUROS_20260714` mseg
  LEFT JOIN `proan-quantrue.D20_DIMENSION.dm_material`
    ON mseg.MATNR = material_number
  WHERE external_material_group LIKE '151115%' OR ERFME IN ('L', 'M3')
),
mseg_hc_docs AS (
  SELECT DISTINCT mseg.MBLNR, mseg.XBLNR_MKPF,
    REGEXP_EXTRACT(mseg.XBLNR_MKPF, r'^([A-Za-z]+)')    AS serie,
    REGEXP_EXTRACT(mseg.XBLNR_MKPF, r'[A-Za-z]+(\d+)$') AS folio_num
  FROM `proan-quantrue.D00_SANDBOX.proan_MSEG_HIDROCARBUROS_20260714` mseg
  INNER JOIN mseg_docs USING (MBLNR)
)
SELECT
  COUNT(*) AS total_documentos,
  COUNTIF(XBLNR_MKPF IS NULL OR TRIM(XBLNR_MKPF) = '') AS xblnr_vacio,
  COUNTIF(serie IS NOT NULL AND folio_num IS NOT NULL) AS con_formato_serie_folio,
  COUNT(DISTINCT serie) AS series_distintas
FROM mseg_hc_docs;
