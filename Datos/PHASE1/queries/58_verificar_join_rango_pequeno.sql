-- ¿Los MATNR "pequeños" que vimos de verdad en MSEG (13091, 12011, 28, 420...)
-- SÍ cruzan contra dm_material, o el rango pequeño está mal cubierto?
SELECT material_number, material_name, external_material_group
FROM `proan-quantrue.D20_DIMENSION.dm_material`
WHERE material_number IN (
  '000000000000013091', '000000000000012011', '000000000000000028', '000000000000000420'
);
