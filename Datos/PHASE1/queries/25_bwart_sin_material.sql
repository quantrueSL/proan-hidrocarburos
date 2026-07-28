-- MATNR viene vacío (no es problema de formato/cruce, el dato no existe). Ver qué tipo de
-- movimiento SAP (BWART) es esto, para saber si de verdad no tiene nada que ver con hidrocarburos.
WITH mseg_docs AS (
  SELECT DISTINCT mseg.MBLNR
  FROM `proan-quantrue.D00_SANDBOX.proan_MSEG_HIDROCARBUROS_20260714` mseg
  LEFT JOIN `proan-quantrue.D20_DIMENSION.dm_material`
    ON mseg.MATNR = material_number
  WHERE external_material_group LIKE '151115%' OR ERFME IN ('L', 'M3')
)
SELECT mseg.BWART, mseg.ERFME, ANY_VALUE(mseg.SAKTO) AS ejemplo_cuenta, COUNT(*) AS n_lineas,
  COUNT(DISTINCT mseg.MBLNR) AS n_documentos, ROUND(SUM(mseg.DMBTR),2) AS suma_dmbtr
FROM `proan-quantrue.D00_SANDBOX.proan_MSEG_HIDROCARBUROS_20260714` mseg
INNER JOIN mseg_docs USING (MBLNR)
WHERE mseg.MATNR = ''
GROUP BY mseg.BWART, mseg.ERFME
ORDER BY suma_dmbtr DESC;
