-- Barrer TODO 2026 (comodín) para el material de gas y ver si aparecen otros proveedores
-- (de los 16 "sin MSEG") en esta historia más completa (deltas diarios), no solo en el
-- extracto acotado "HIDROCARBUROS_20260714".
WITH mseg_gas_2026 AS (
  SELECT _TABLE_SUFFIX AS dia, MBLNR, LIFNR, SAFE_CAST(DMBTR AS NUMERIC) AS DMBTR
  FROM `proan-quantrue.D00_SANDBOX.proan_MSEG_2026*`
  WHERE MATNR = '000000110000009544'
)
SELECT dm_v.rfc, dm_v.razon_social, COUNT(DISTINCT m.MBLNR) AS n_documentos,
  MIN(dia) AS primer_dia, MAX(dia) AS ultimo_dia, ROUND(SUM(m.DMBTR),2) AS suma_dmbtr
FROM mseg_gas_2026 m
LEFT JOIN `proan-quantrue.D20_DIMENSION.dm_vendors` dm_v ON m.LIFNR = dm_v.id_proveedor
GROUP BY dm_v.rfc, dm_v.razon_social
ORDER BY n_documentos DESC;
