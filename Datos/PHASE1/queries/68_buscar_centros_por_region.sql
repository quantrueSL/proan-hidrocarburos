-- Búsqueda dirigida en las 492 filas de dm_centros por nombres que coincidan con las
-- regiones de los proveedores de gas fuera de Jalisco.
SELECT id_centro, descripcion_centro, id_division
FROM `proan-quantrue.D20_DIMENSION.dm_centros`
WHERE REGEXP_CONTAINS(UPPER(descripcion_centro), r'AHUMADA|CHIHUAHUA|TORREON|COAHUILA|POTOSI|CEDRAL|QUERETARO|ZAPOTLANEJO|JALOSTOTITLAN|CAPILLA')
ORDER BY id_centro;
