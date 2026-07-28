SELECT table_name
FROM `proan-quantrue.D00_SANDBOX.INFORMATION_SCHEMA.TABLES`
WHERE REGEXP_CONTAINS(table_name, r'^proan_MSEG_\d{8}$')
ORDER BY table_name DESC
LIMIT 10;
