-- Lista de tablas por dataset candidato a contener direcciones de planta o documentos de pago SAP
SELECT table_catalog, table_schema AS dataset, table_name
FROM `proan-quantrue.D00_SANDBOX.INFORMATION_SCHEMA.TABLES`
UNION ALL
SELECT table_catalog, table_schema AS dataset, table_name
FROM `proan-quantrue.D20_DIMENSION.INFORMATION_SCHEMA.TABLES`
UNION ALL
SELECT table_catalog, table_schema AS dataset, table_name
FROM `proan-quantrue.D30_INTEGRATION.INFORMATION_SCHEMA.TABLES`
UNION ALL
SELECT table_catalog, table_schema AS dataset, table_name
FROM `proan-quantrue.D40_EDW.INFORMATION_SCHEMA.TABLES`
ORDER BY dataset, table_name;
