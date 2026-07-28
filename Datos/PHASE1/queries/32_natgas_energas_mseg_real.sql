-- Los MSEG de Natgas Queretaro (24) y Energas de Mexico (578) -- ¿son de verdad gas
-- (151115xx) o son ruido (otros materiales en litros/m3), igual que pasó antes?
WITH mseg_docs AS (
  SELECT DISTINCT mseg.MBLNR
  FROM `proan-quantrue.D00_SANDBOX.proan_MSEG_HIDROCARBUROS_20260714` mseg
  LEFT JOIN `proan-quantrue.D20_DIMENSION.dm_material`
    ON mseg.MATNR = material_number
  WHERE external_material_group LIKE '151115%' OR ERFME IN ('L', 'M3')
)
SELECT dm_v.rfc, dm_v.razon_social,
  dm_m.external_material_group, ANY_VALUE(dm_m.material_name) AS ejemplo_material,
  COUNT(DISTINCT mseg.MBLNR) AS n_documentos, ROUND(SUM(mseg.DMBTR),2) AS suma_dmbtr
FROM `proan-quantrue.D00_SANDBOX.proan_MSEG_HIDROCARBUROS_20260714` mseg
INNER JOIN mseg_docs USING (MBLNR)
LEFT JOIN `proan-quantrue.D20_DIMENSION.dm_vendors` dm_v ON mseg.LIFNR = dm_v.id_proveedor
LEFT JOIN `proan-quantrue.D20_DIMENSION.dm_material` dm_m ON mseg.MATNR = dm_m.material_number
WHERE dm_v.rfc IN ('NQU120510QZ7', 'EME0001256D0')
GROUP BY dm_v.rfc, dm_v.razon_social, dm_m.external_material_group
ORDER BY dm_v.rfc, suma_dmbtr DESC;
