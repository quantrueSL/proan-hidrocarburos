-- Tasa de match global: de todos los MATNR distintos que aparecen de verdad en un día
-- de MSEG completo (crudo), ¿qué % cruza con dm_material, y varía según el rango (chico/grande)?
WITH mseg_matnr AS (
  SELECT DISTINCT MATNR
  FROM `proan-quantrue.D00_SANDBOX.proan_MSEG_20260720`
  WHERE MATNR IS NOT NULL AND MATNR != ''
),
clasificado AS (
  SELECT m.MATNR, dm.material_number,
    CASE
      WHEN SAFE_CAST(m.MATNR AS INT64) IS NULL THEN 'no_numerico'
      WHEN SAFE_CAST(m.MATNR AS INT64) < 1000000 THEN 'rango_pequeno'
      ELSE 'rango_grande'
    END AS rango
  FROM mseg_matnr m
  LEFT JOIN `proan-quantrue.D20_DIMENSION.dm_material` dm ON m.MATNR = dm.material_number
)
SELECT rango, COUNT(*) AS n_materiales_distintos,
  COUNTIF(material_number IS NOT NULL) AS con_match,
  ROUND(100*COUNTIF(material_number IS NOT NULL)/COUNT(*), 2) AS pct_match
FROM clasificado
GROUP BY rango
ORDER BY rango;
