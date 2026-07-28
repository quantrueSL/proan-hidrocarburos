SELECT table_name, column_name, data_type, ordinal_position
FROM `proan-quantrue.D20_DIMENSION.INFORMATION_SCHEMA.COLUMNS`
WHERE table_name IN ('dm_centros', 'dm_centro_sociedad', 'dm_company', 'dm_business_area')
ORDER BY table_name, ordinal_position;
