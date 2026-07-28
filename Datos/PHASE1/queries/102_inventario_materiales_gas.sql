-- ¿Cuántos material_number distintos son "gas" (external_material_group 151115xx)?
-- Cierra el supuesto de que el gas es un único material: son 6, en 3 subclaves SAT
-- (15111505 / 15111510 / 15111512). Esto es lo que hacía incompleto el barrido de
-- query 52 (un solo MATNR hardcodeado, 000000110000009544).
SELECT
  COUNT(DISTINCT material_number) AS n_materiales_gas,
  STRING_AGG(DISTINCT external_material_group ORDER BY external_material_group) AS subclaves_sat
FROM `proan-quantrue.D20_DIMENSION.dm_material`
WHERE external_material_group LIKE '151115%';
