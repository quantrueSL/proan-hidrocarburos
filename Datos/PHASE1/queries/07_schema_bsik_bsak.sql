-- Esquema de las tablas de cuentas por pagar a proveedores (Kreditor) en tiempo real
SELECT table_name, column_name, data_type, ordinal_position
FROM `proan-quantrue.D00_SANDBOX.INFORMATION_SCHEMA.COLUMNS`
WHERE table_name IN ('bsik_real_time', 'bsak_real_time')
ORDER BY table_name, ordinal_position;
