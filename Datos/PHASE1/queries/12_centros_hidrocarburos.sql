-- Descripción de las 4 plantas (WERKS) que aparecen en las líneas de hidrocarburo
SELECT id_centro, descripcion_centro, id_division
FROM `proan-quantrue.D20_DIMENSION.dm_centros`
WHERE id_centro IN ('PAN1', 'PAN3', 'PANM', 'PANR');
