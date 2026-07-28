-- Verificación real (no de refilón): el bloque de $710M sin MATNR (universo amplio,
-- filtro contaminado) -- ¿es el mismo patrón de cuenta técnica + reverso mismo día
-- que se encontró para GCV/EME, o es otra cosa (compras genéricas reales)?
WITH mseg_docs AS (
  SELECT DISTINCT mseg.MBLNR
  FROM `proan-quantrue.D00_SANDBOX.proan_MSEG_HIDROCARBUROS_20260714` mseg
  LEFT JOIN `proan-quantrue.D20_DIMENSION.dm_material`
    ON mseg.MATNR = material_number
  WHERE external_material_group LIKE '151115%' OR ERFME IN ('L', 'M3')
)
SELECT mseg.SAKTO, mseg.BWART, dm_v.rfc, dm_v.razon_social,
  COUNT(DISTINCT mseg.MBLNR) AS n_documentos, ROUND(SUM(mseg.DMBTR),2) AS suma_dmbtr
FROM `proan-quantrue.D00_SANDBOX.proan_MSEG_HIDROCARBUROS_20260714` mseg
INNER JOIN mseg_docs USING (MBLNR)
LEFT JOIN `proan-quantrue.D20_DIMENSION.dm_vendors` dm_v ON mseg.LIFNR = dm_v.id_proveedor
WHERE mseg.MATNR = ''
GROUP BY mseg.SAKTO, mseg.BWART, dm_v.rfc, dm_v.razon_social
ORDER BY suma_dmbtr DESC
LIMIT 30;
