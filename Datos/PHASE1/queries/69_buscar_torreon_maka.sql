-- Completar la búsqueda: Torreón/Coahuila (Energas de México) no apareció; probar variantes.
-- Y ver todos los sitios "MAKA" para entender ese patrón de nombres.
SELECT id_centro, descripcion_centro, id_division
FROM `proan-quantrue.D20_DIMENSION.dm_centros`
WHERE REGEXP_CONTAINS(UPPER(descripcion_centro), r'LAGUNA|GOMEZ PALACIO|MAKA')
ORDER BY id_centro;
