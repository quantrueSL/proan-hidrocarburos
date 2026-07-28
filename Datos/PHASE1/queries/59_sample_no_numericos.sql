SELECT material_number, material_name, external_material_group
FROM `proan-quantrue.D20_DIMENSION.dm_material`
WHERE SAFE_CAST(material_number AS INT64) IS NULL
LIMIT 10;
