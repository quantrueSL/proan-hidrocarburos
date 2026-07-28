-- Resto de columnas de MSEG hidrocarburos (posiciones 60+), tabla SAP MSEG muy ancha
SELECT column_name, data_type, ordinal_position
FROM `proan-quantrue.D00_SANDBOX.INFORMATION_SCHEMA.COLUMNS`
WHERE table_name = 'proan_MSEG_HIDROCARBUROS_20260714' AND ordinal_position > 59
ORDER BY ordinal_position;
