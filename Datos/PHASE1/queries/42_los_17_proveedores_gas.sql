-- ¿Quiénes son los 17 proveedores con CFDI de clave 151115xx, y cuáles de ellos
-- tienen algún documento MSEG real (con esa misma clave) en nuestro universo?
WITH proveedores_cfdi AS (
  SELECT EmisorRfc, ANY_VALUE(EmisorNombre) AS nombre, COUNT(*) AS n_facturas, ROUND(SUM(Importe),2) AS suma
  FROM `proan-quantrue.D00_SANDBOX.cfdis`
  WHERE FechaTimbrado >= '2026-01-01' AND ClaveProdServ LIKE '151115%'
  GROUP BY EmisorRfc
),
mseg_docs AS (
  SELECT DISTINCT mseg.MBLNR
  FROM `proan-quantrue.D00_SANDBOX.proan_MSEG_HIDROCARBUROS_20260714` mseg
  LEFT JOIN `proan-quantrue.D20_DIMENSION.dm_material`
    ON mseg.MATNR = material_number
  WHERE external_material_group LIKE '151115%'
),
mseg_rfc AS (
  SELECT DISTINCT dm_v.rfc, COUNT(DISTINCT mseg.MBLNR) AS n_mseg
  FROM `proan-quantrue.D00_SANDBOX.proan_MSEG_HIDROCARBUROS_20260714` mseg
  INNER JOIN mseg_docs USING (MBLNR)
  LEFT JOIN `proan-quantrue.D20_DIMENSION.dm_material` dm_m ON mseg.MATNR = dm_m.material_number
  LEFT JOIN `proan-quantrue.D20_DIMENSION.dm_vendors`  dm_v ON mseg.LIFNR = dm_v.id_proveedor
  WHERE dm_m.external_material_group LIKE '151115%'
  GROUP BY dm_v.rfc
)
SELECT p.EmisorRfc, p.nombre, p.n_facturas, p.suma, COALESCE(m.n_mseg, 0) AS n_documentos_mseg
FROM proveedores_cfdi p
LEFT JOIN mseg_rfc m ON p.EmisorRfc = m.rfc
ORDER BY p.suma DESC;
