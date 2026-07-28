-- CECOs (KOSTL) usados de verdad por el universo limpio de gas (clave SAT 151115xx)
WITH mseg_docs AS (
  SELECT DISTINCT mseg.MBLNR
  FROM `proan-quantrue.D00_SANDBOX.proan_MSEG_HIDROCARBUROS_20260714` mseg
  LEFT JOIN `proan-quantrue.D20_DIMENSION.dm_material`
    ON mseg.MATNR = material_number
  WHERE external_material_group LIKE '151115%'
)
SELECT mseg.KOSTL, COUNT(DISTINCT mseg.MBLNR) AS n_documentos
FROM `proan-quantrue.D00_SANDBOX.proan_MSEG_HIDROCARBUROS_20260714` mseg
INNER JOIN mseg_docs USING (MBLNR)
GROUP BY mseg.KOSTL
ORDER BY n_documentos DESC;
