-- Buscar tablas de pedido de compra SAP (EKKO cabecera / EKPO posición), que traen
-- PSTYP (categoría de posición: normal/servicio) y KNTTP (categoría de clasificación) --
-- una forma ESTRUCTURAL de distinguir material vs. servicio, en vez de adivinar por texto.
SELECT table_schema AS dataset, table_name
FROM `proan-quantrue.D00_SANDBOX.INFORMATION_SCHEMA.TABLES`
WHERE REGEXP_CONTAINS(UPPER(table_name), r'EKKO|EKPO|EKBE|ESLL|ESSR')
UNION ALL
SELECT table_schema AS dataset, table_name
FROM `proan-quantrue.D20_DIMENSION.INFORMATION_SCHEMA.TABLES`
WHERE REGEXP_CONTAINS(UPPER(table_name), r'EKKO|EKPO|EKBE|ESLL|ESSR')
UNION ALL
SELECT table_schema AS dataset, table_name
FROM `proan-quantrue.D30_INTEGRATION.INFORMATION_SCHEMA.TABLES`
WHERE REGEXP_CONTAINS(UPPER(table_name), r'EKKO|EKPO|EKBE|ESLL|ESSR')
UNION ALL
SELECT table_schema AS dataset, table_name
FROM `proan-quantrue.D40_EDW.INFORMATION_SCHEMA.TABLES`
WHERE REGEXP_CONTAINS(UPPER(table_name), r'EKKO|EKPO|EKBE|ESLL|ESSR')
ORDER BY dataset, table_name;
