-- ¿Por qué ~29 líneas del proveedor de gas real no traen KOSTL? ¿Correlaciona con BWART,
-- con SAKTO (otra cuenta), o con las mismas reversiones que ya encontramos?
WITH mseg_docs AS (
  SELECT DISTINCT mseg.MBLNR
  FROM `proan-quantrue.D00_SANDBOX.proan_MSEG_HIDROCARBUROS_20260714` mseg
  LEFT JOIN `proan-quantrue.D20_DIMENSION.dm_material`
    ON mseg.MATNR = material_number
  WHERE external_material_group LIKE '151115%'
)
SELECT mseg.BWART, mseg.SAKTO, mseg.WERKS,
  CASE WHEN mseg.KOSTL = '' THEN 'vacio' ELSE 'con_valor' END AS estado_kostl,
  COUNT(*) AS n_lineas, COUNT(DISTINCT mseg.MBLNR) AS n_documentos
FROM `proan-quantrue.D00_SANDBOX.proan_MSEG_HIDROCARBUROS_20260714` mseg
INNER JOIN mseg_docs USING (MBLNR)
LEFT JOIN `proan-quantrue.D20_DIMENSION.dm_material` dm_m ON mseg.MATNR = dm_m.material_number
WHERE dm_m.external_material_group LIKE '151115%'
GROUP BY mseg.BWART, mseg.SAKTO, mseg.WERKS, estado_kostl
ORDER BY estado_kostl, n_documentos DESC;
