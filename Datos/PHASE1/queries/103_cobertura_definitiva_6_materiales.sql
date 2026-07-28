-- Barrido DEFINITIVO de cobertura MSEG: los 6 materiales de gas (no solo uno) x todo 2026
-- (wildcard proan_MSEG_2026*), agregando por proveedor. Corrige query 52, que solo barría
-- el material 000000110000009544. Resultado: sigue apareciendo SOLO Distribuidora de Gas Noel
-- -> el hallazgo "~98% sin MSEG" aguanta con el conjunto completo de materiales.
-- (Nota: las tablas diarias crudas son deltas muy incompletas -solo 2 de los 35 MBLNR de Gas
--  Noel-, así que esto corrobora "no hay otros proveedores", no cuenta documentos; el conteo
--  de peso sale del extracto proan_MSEG_HIDROCARBUROS_20260714.)
WITH gas_material AS (
  SELECT material_number
  FROM `proan-quantrue.D20_DIMENSION.dm_material`
  WHERE external_material_group LIKE '151115%'
),
mseg_gas AS (
  SELECT m.LIFNR, m.MBLNR
  FROM `proan-quantrue.D00_SANDBOX.proan_MSEG_2026*` m
  INNER JOIN gas_material g ON m.MATNR = g.material_number
)
SELECT dm_v.rfc, dm_v.razon_social, COUNT(DISTINCT mseg_gas.MBLNR) AS n_docs_mseg
FROM mseg_gas
LEFT JOIN `proan-quantrue.D20_DIMENSION.dm_vendors` dm_v ON mseg_gas.LIFNR = dm_v.id_proveedor
GROUP BY dm_v.rfc, dm_v.razon_social
ORDER BY n_docs_mseg DESC;
