-- ¿Aparece el proveedor real de gas (DGN811026BU6) en las tablas de cuentas por pagar?
WITH vendor AS (
  SELECT id_proveedor, rfc, razon_social
  FROM `proan-quantrue.D20_DIMENSION.dm_vendors`
  WHERE rfc = 'DGN811026BU6'
)
SELECT 'bsik_real_time (abiertas)' AS tabla, COUNT(*) AS n_lineas, ROUND(SUM(b.DMBTR),2) AS suma
FROM `proan-quantrue.D00_SANDBOX.bsik_real_time` b
INNER JOIN vendor v ON b.LIFNR = v.id_proveedor
UNION ALL
SELECT 'bsak_real_time (compensadas)' AS tabla, COUNT(*) AS n_lineas, ROUND(SUM(b.DMBTR),2) AS suma
FROM `proan-quantrue.D00_SANDBOX.bsak_real_time` b
INNER JOIN vendor v ON b.LIFNR = v.id_proveedor;
