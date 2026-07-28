-- Repetir el cruce de los 17 proveedores de gas, pero contra el MSEG COMPLETO
-- (proan_MSEG_20260720, snapshot más reciente), no contra el extracto acotado
-- "HIDROCARBUROS". Solo agregados por proveedor. (DMBTR viene como STRING aquí.)
WITH gas_material AS (
  SELECT material_number
  FROM `proan-quantrue.D20_DIMENSION.dm_material`
  WHERE external_material_group LIKE '151115%'
),
mseg_gas AS (
  SELECT mseg.LIFNR, mseg.MBLNR, SAFE_CAST(mseg.DMBTR AS NUMERIC) AS DMBTR
  FROM `proan-quantrue.D00_SANDBOX.proan_MSEG_20260720` mseg
  INNER JOIN gas_material gm ON mseg.MATNR = gm.material_number
)
SELECT dm_v.rfc, dm_v.razon_social, COUNT(DISTINCT m.MBLNR) AS n_documentos, ROUND(SUM(m.DMBTR),2) AS suma_dmbtr
FROM mseg_gas m
LEFT JOIN `proan-quantrue.D20_DIMENSION.dm_vendors` dm_v ON m.LIFNR = dm_v.id_proveedor
GROUP BY dm_v.rfc, dm_v.razon_social
ORDER BY suma_dmbtr DESC;
