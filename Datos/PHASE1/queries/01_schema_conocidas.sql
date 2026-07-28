-- Esquema (metadata, sin filas) de las tablas ya conocidas del prototipo hidrocarburos.sql
SELECT table_name, column_name, data_type, is_nullable, ordinal_position
FROM `proan-quantrue.D00_SANDBOX.INFORMATION_SCHEMA.COLUMNS`
WHERE table_name IN ('proan_MSEG_HIDROCARBUROS_20260714', 'cfdis', 'proan_CSKT_20260714')
ORDER BY table_name, ordinal_position;
