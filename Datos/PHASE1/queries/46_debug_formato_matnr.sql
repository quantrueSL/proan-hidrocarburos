SELECT 'mseg_total' AS fuente, COUNT(*) AS n FROM `proan-quantrue.D00_SANDBOX.proan_MSEG_20260720`
UNION ALL
SELECT 'dm_material_total', COUNT(*) FROM `proan-quantrue.D20_DIMENSION.dm_material`;
