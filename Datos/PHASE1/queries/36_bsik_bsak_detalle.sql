-- Detalle línea a línea para cruzar mentalmente contra los CFDI ya conocidos de este proveedor.
WITH vendor AS (
  SELECT id_proveedor FROM `proan-quantrue.D20_DIMENSION.dm_vendors` WHERE rfc = 'DGN811026BU6'
)
SELECT 'abierta' AS estado, b.BELNR, b.BLDAT, b.BUDAT, b.DMBTR, b.SHKZG, b.ZUONR, b.KOSTL, NULL AS AUGDT
FROM `proan-quantrue.D00_SANDBOX.bsik_real_time` b
INNER JOIN vendor v ON b.LIFNR = v.id_proveedor
UNION ALL
SELECT 'compensada' AS estado, b.BELNR, b.BLDAT, b.BUDAT, b.DMBTR, b.SHKZG, b.ZUONR, b.KOSTL, b.AUGDT
FROM `proan-quantrue.D00_SANDBOX.bsak_real_time` b
INNER JOIN vendor v ON b.LIFNR = v.id_proveedor
ORDER BY estado, BUDAT;
