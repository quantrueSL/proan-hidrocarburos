-- D20_DIMENSION es el dataset de maestros/dimensiones: listar todo (suele ser pequeño)
-- para buscar un maestro de plantas (WERKS) con nombre/dirección.
SELECT table_name
FROM `proan-quantrue.D20_DIMENSION.INFORMATION_SCHEMA.TABLES`
ORDER BY table_name;
