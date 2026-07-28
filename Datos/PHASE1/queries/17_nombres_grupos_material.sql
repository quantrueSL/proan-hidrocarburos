SELECT external_material_group, ANY_VALUE(material_name) AS ejemplo_material, COUNT(*) AS n_materiales
FROM `proan-quantrue.D20_DIMENSION.dm_material`
WHERE external_material_group IN ('15101505','15101515','15101514','10191500','15121501','51102600','10171700','01010101','47131821','12163800','15121508','12161902','12191602')
GROUP BY external_material_group
ORDER BY external_material_group;
