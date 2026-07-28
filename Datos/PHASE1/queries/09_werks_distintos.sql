-- ABLAD salió vacío en el 100% de los casos (descartado). WERKS (planta) solo tiene 4 valores
-- distintos entre las líneas de hidrocarburo: listarlos para buscar su maestro de plantas.
WITH mseg_docs AS (
  SELECT DISTINCT mseg.MBLNR
  FROM `proan-quantrue.D00_SANDBOX.proan_MSEG_HIDROCARBUROS_20260714` mseg
  LEFT JOIN `proan-quantrue.D20_DIMENSION.dm_material`
    ON mseg.MATNR = material_number
  WHERE external_material_group LIKE '151115%' OR ERFME IN ('L', 'M3')
),
mseg_hc AS (
  SELECT mseg.MBLNR, mseg.WERKS, mseg.GSBER
  FROM `proan-quantrue.D00_SANDBOX.proan_MSEG_HIDROCARBUROS_20260714` mseg
  INNER JOIN mseg_docs USING (MBLNR)
)
SELECT WERKS, GSBER, COUNT(*) AS n_lineas, COUNT(DISTINCT MBLNR) AS n_documentos
FROM mseg_hc
GROUP BY WERKS, GSBER
ORDER BY n_documentos DESC;
