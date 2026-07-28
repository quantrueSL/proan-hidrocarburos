-- ¿Qué MATNR usa específicamente el material "GAS LP"/"GAS NATURAL" (15111510) dentro
-- del extracto HIDROCARBUROS, donde SÍ sabemos que el JOIN contra dm_material funciona?
SELECT DISTINCT mseg.MATNR, dm_m.material_name, dm_m.external_material_group
FROM `proan-quantrue.D00_SANDBOX.proan_MSEG_HIDROCARBUROS_20260714` mseg
INNER JOIN `proan-quantrue.D20_DIMENSION.dm_material` dm_m ON mseg.MATNR = dm_m.material_number
WHERE dm_m.external_material_group LIKE '151115%'
LIMIT 10;
