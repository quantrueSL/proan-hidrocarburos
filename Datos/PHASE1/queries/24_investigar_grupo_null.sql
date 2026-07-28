-- El bloque más grande del filtro amplio (~$710M) es material que NI SIQUIERA cruza con
-- dm_material (external_material_group NULL). Investigar si es un problema de formato de
-- MATNR (ej. ceros a la izquierda) que esconde materiales que sí son gas.
WITH mseg_docs AS (
  SELECT DISTINCT mseg.MBLNR
  FROM `proan-quantrue.D00_SANDBOX.proan_MSEG_HIDROCARBUROS_20260714` mseg
  LEFT JOIN `proan-quantrue.D20_DIMENSION.dm_material`
    ON mseg.MATNR = material_number
  WHERE external_material_group LIKE '151115%' OR ERFME IN ('L', 'M3')
),
mseg_sin_cruce AS (
  SELECT mseg.MBLNR, mseg.MATNR, mseg.SGTXT, mseg.DMBTR
  FROM `proan-quantrue.D00_SANDBOX.proan_MSEG_HIDROCARBUROS_20260714` mseg
  INNER JOIN mseg_docs USING (MBLNR)
  LEFT JOIN `proan-quantrue.D20_DIMENSION.dm_material` dm_m ON mseg.MATNR = dm_m.material_number
  WHERE mseg.ERFME IN ('L', 'M3') AND dm_m.material_number IS NULL
)
SELECT MATNR, ANY_VALUE(SGTXT) AS ejemplo_texto, COUNT(*) AS n_lineas, COUNT(DISTINCT MBLNR) AS n_documentos, ROUND(SUM(DMBTR),2) AS suma_dmbtr
FROM mseg_sin_cruce
GROUP BY MATNR
ORDER BY suma_dmbtr DESC
LIMIT 25;
