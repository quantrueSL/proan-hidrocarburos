-- Calidad del campo ABLAD (candidato a "Dirección de Consumo") sobre las líneas de hidrocarburo.
-- Solo agregados: nada de filas individuales.
WITH mseg_docs AS (
  SELECT DISTINCT mseg.MBLNR
  FROM `proan-quantrue.D00_SANDBOX.proan_MSEG_HIDROCARBUROS_20260714` mseg
  LEFT JOIN `proan-quantrue.D20_DIMENSION.dm_material`
    ON mseg.MATNR = material_number
  WHERE external_material_group LIKE '151115%' OR ERFME IN ('L', 'M3')
),
mseg_hc AS (
  SELECT mseg.MBLNR, mseg.WERKS, mseg.ABLAD
  FROM `proan-quantrue.D00_SANDBOX.proan_MSEG_HIDROCARBUROS_20260714` mseg
  INNER JOIN mseg_docs USING (MBLNR)
)
SELECT
  COUNT(*) AS total_lineas,
  COUNT(DISTINCT MBLNR) AS total_documentos,
  COUNTIF(ABLAD IS NULL OR TRIM(ABLAD) = '') AS ablad_vacio,
  COUNT(DISTINCT ABLAD) AS ablad_valores_distintos,
  COUNT(DISTINCT WERKS) AS werks_valores_distintos
FROM mseg_hc;
