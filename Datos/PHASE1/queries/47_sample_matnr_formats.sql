(SELECT 'mseg' AS fuente, MATNR AS valor FROM `proan-quantrue.D00_SANDBOX.proan_MSEG_20260720` WHERE MATNR IS NOT NULL AND MATNR != '' LIMIT 5)
UNION ALL
(SELECT 'dm_material' AS fuente, material_number AS valor FROM `proan-quantrue.D20_DIMENSION.dm_material` WHERE external_material_group LIKE '151115%' LIMIT 5);
