SELECT column_name, data_type, ordinal_position
FROM `proan-quantrue.D00_SANDBOX.INFORMATION_SCHEMA.COLUMNS`
WHERE table_name = 'proan_EKBE_20250501'
ORDER BY ordinal_position;
