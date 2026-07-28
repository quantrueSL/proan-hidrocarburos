-- ¿El neto (101 - 102) por proveedor+cuenta es razonable, o sigue siendo absurdo
-- comparado con lo que ese proveedor factura de verdad (CFDI real)?
WITH mseg_docs AS (
  SELECT DISTINCT mseg.MBLNR
  FROM `proan-quantrue.D00_SANDBOX.proan_MSEG_HIDROCARBUROS_20260714` mseg
  LEFT JOIN `proan-quantrue.D20_DIMENSION.dm_material`
    ON mseg.MATNR = material_number
  WHERE external_material_group LIKE '151115%' OR ERFME IN ('L', 'M3')
),
neto AS (
  SELECT dm_v.rfc, dm_v.razon_social, mseg.SAKTO,
    SUM(CASE WHEN mseg.BWART = '101' THEN mseg.DMBTR ELSE 0 END) AS suma_101,
    SUM(CASE WHEN mseg.BWART = '102' THEN mseg.DMBTR ELSE 0 END) AS suma_102
  FROM `proan-quantrue.D00_SANDBOX.proan_MSEG_HIDROCARBUROS_20260714` mseg
  INNER JOIN mseg_docs USING (MBLNR)
  LEFT JOIN `proan-quantrue.D20_DIMENSION.dm_vendors` dm_v ON mseg.LIFNR = dm_v.id_proveedor
  WHERE mseg.MATNR = '' AND dm_v.rfc IS NOT NULL
  GROUP BY dm_v.rfc, dm_v.razon_social, mseg.SAKTO
)
SELECT rfc, razon_social, SAKTO, ROUND(suma_101,2) AS suma_101, ROUND(suma_102,2) AS suma_102,
  ROUND(suma_101 - suma_102, 2) AS neto
FROM neto
WHERE ABS(suma_101 - suma_102) > 100000
ORDER BY ABS(suma_101 - suma_102) DESC;
