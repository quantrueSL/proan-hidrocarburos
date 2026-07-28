-- ¿dm_material usa un solo "formato" de material_number, o conviven varios rangos?
-- Se mide por cantidad de dígitos significativos (quitando ceros a la izquierda).
SELECT
  LENGTH(CAST(SAFE_CAST(material_number AS INT64) AS STRING)) AS n_digitos_significativos,
  COUNT(*) AS n_materiales,
  MIN(SAFE_CAST(material_number AS INT64)) AS valor_min,
  MAX(SAFE_CAST(material_number AS INT64)) AS valor_max
FROM `proan-quantrue.D20_DIMENSION.dm_material`
GROUP BY n_digitos_significativos
ORDER BY n_digitos_significativos;
