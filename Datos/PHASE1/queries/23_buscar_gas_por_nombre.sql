-- El filtro por clave SAT 151115xx se queda corto (por eso el prototipo metió el OR de litros/m3).
-- Buscamos materiales cuyo NOMBRE sugiere gas, sin importar su external_material_group,
-- para ver bajo qué grupos está mal clasificado el gas real. Agregado por grupo, no fila a fila.
SELECT
  external_material_group,
  COUNT(*) AS n_materiales,
  ANY_VALUE(material_name) AS ejemplo_1,
  ARRAY_AGG(material_name ORDER BY material_name LIMIT 5) AS ejemplos
FROM `proan-quantrue.D20_DIMENSION.dm_material`
WHERE REGEXP_CONTAINS(UPPER(material_name), r'\bGAS\b|PROPANO|BUTANO|\bGLP\b|\bGNC\b|\bGNL\b|GAS LP|GAS NAT')
GROUP BY external_material_group
ORDER BY n_materiales DESC;
