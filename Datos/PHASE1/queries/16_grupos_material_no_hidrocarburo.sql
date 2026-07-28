-- Qué son en realidad las líneas que el filtro ERFME IN ('L','M3') arrastra sin ser
-- clave SAT de hidrocarburo (151115xx). Sin datos personales, solo catálogo de materiales.
WITH mseg_docs AS (
  SELECT DISTINCT mseg.MBLNR
  FROM `proan-quantrue.D00_SANDBOX.proan_MSEG_HIDROCARBUROS_20260714` mseg
  LEFT JOIN `proan-quantrue.D20_DIMENSION.dm_material`
    ON mseg.MATNR = material_number
  WHERE external_material_group LIKE '151115%' OR ERFME IN ('L', 'M3')
),
mseg_lineas AS (
  SELECT mseg.MBLNR, mseg.DMBTR, dm_m.external_material_group, dm_m.material_name
  FROM `proan-quantrue.D00_SANDBOX.proan_MSEG_HIDROCARBUROS_20260714` mseg
  INNER JOIN mseg_docs USING (MBLNR)
  LEFT JOIN `proan-quantrue.D20_DIMENSION.dm_material` dm_m ON mseg.MATNR = dm_m.material_number
  WHERE mseg.ERFME IN ('L', 'M3')
    AND (dm_m.external_material_group IS NULL OR dm_m.external_material_group NOT LIKE '151115%')
)
SELECT external_material_group, COUNT(*) AS n_lineas, COUNT(DISTINCT MBLNR) AS n_documentos,
  ROUND(SUM(DMBTR), 2) AS suma_dmbtr
FROM mseg_lineas
GROUP BY external_material_group
ORDER BY suma_dmbtr DESC;
