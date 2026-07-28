SELECT table_name, column_name, data_type, ordinal_position
FROM `proan-quantrue.D20_DIMENSION.INFORMATION_SCHEMA.COLUMNS`
WHERE table_name IN ('dm_material', 'dm_vendors')
ORDER BY table_name, ordinal_position;
