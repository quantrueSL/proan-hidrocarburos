-- Ver el maestro de plantas COMPLETO (no solo las 4 que aparecen en el MSEG de gas),
-- para ver si hay pistas de sitios en Chihuahua/Coahuila/SLP por nombre.
SELECT id_centro, descripcion_centro, id_division
FROM `proan-quantrue.D20_DIMENSION.dm_centros`
ORDER BY id_centro;
