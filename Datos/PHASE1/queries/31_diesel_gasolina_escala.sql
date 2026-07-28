-- Tamaño real de diésel/gasolina (1510xxxx) en MSEG y si existe contraparte en CFDI.
WITH mseg_docs AS (
  SELECT DISTINCT mseg.MBLNR
  FROM `proan-quantrue.D00_SANDBOX.proan_MSEG_HIDROCARBUROS_20260714` mseg
  LEFT JOIN `proan-quantrue.D20_DIMENSION.dm_material`
    ON mseg.MATNR = material_number
  WHERE external_material_group LIKE '151115%' OR ERFME IN ('L', 'M3')
),
mseg_diesel AS (
  SELECT mseg.MBLNR, mseg.DMBTR, dm_m.external_material_group
  FROM `proan-quantrue.D00_SANDBOX.proan_MSEG_HIDROCARBUROS_20260714` mseg
  INNER JOIN mseg_docs USING (MBLNR)
  LEFT JOIN `proan-quantrue.D20_DIMENSION.dm_material` dm_m ON mseg.MATNR = dm_m.material_number
  WHERE dm_m.external_material_group LIKE '1510%'
)
SELECT 'MSEG diesel/gasolina (1510xxxx)' AS universo, COUNT(DISTINCT MBLNR) AS n_documentos, ROUND(SUM(DMBTR),2) AS suma
FROM mseg_diesel
UNION ALL
SELECT 'CFDI diesel/gasolina (1510xxxx)' AS universo, COUNT(DISTINCT UUID), ROUND(SUM(Importe),2)
FROM `proan-quantrue.D00_SANDBOX.cfdis`
WHERE FechaTimbrado >= '2026-01-01' AND ClaveProdServ LIKE '1510%';
