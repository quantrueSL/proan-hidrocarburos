SELECT MIN(table_name) AS primera, MAX(table_name) AS ultima, COUNT(*) AS n_tablas
FROM `proan-quantrue.D00_SANDBOX.INFORMATION_SCHEMA.TABLES`
WHERE REGEXP_CONTAINS(table_name, r'^proan_EKBE_2026\d{4}$');
