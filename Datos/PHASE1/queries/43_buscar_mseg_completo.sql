-- ¿Existe una tabla MSEG más completa/en vivo (tipo *_real_time, como bsik/bsak),
-- en vez del extracto fechado "proan_MSEG_HIDROCARBUROS_20260714"?
SELECT table_schema AS dataset, table_name
FROM `proan-quantrue.D00_SANDBOX.INFORMATION_SCHEMA.TABLES`
WHERE REGEXP_CONTAINS(UPPER(table_name), r'MSEG')
UNION ALL
SELECT table_schema AS dataset, table_name
FROM `proan-quantrue.D20_DIMENSION.INFORMATION_SCHEMA.TABLES`
WHERE REGEXP_CONTAINS(UPPER(table_name), r'MSEG')
UNION ALL
SELECT table_schema AS dataset, table_name
FROM `proan-quantrue.D30_INTEGRATION.INFORMATION_SCHEMA.TABLES`
WHERE REGEXP_CONTAINS(UPPER(table_name), r'MSEG')
UNION ALL
SELECT table_schema AS dataset, table_name
FROM `proan-quantrue.D40_EDW.INFORMATION_SCHEMA.TABLES`
WHERE REGEXP_CONTAINS(UPPER(table_name), r'MSEG')
ORDER BY dataset, table_name;
