-- Re-verificación: los 18+ CECOs de Distribuidora de Gas Noel, ¿son de líneas de
-- gas real (151115xx) específicamente, o se coló algún KOSTL de otra línea del
-- mismo documento (que puede tener varias líneas, no todas de gas)?
WITH mseg_docs AS (
  SELECT DISTINCT mseg.MBLNR
  FROM `proan-quantrue.D00_SANDBOX.proan_MSEG_HIDROCARBUROS_20260714` mseg
  LEFT JOIN `proan-quantrue.D20_DIMENSION.dm_material`
    ON mseg.MATNR = material_number
  WHERE external_material_group LIKE '151115%'
)
SELECT mseg.KOSTL, dm_m.external_material_group, COUNT(DISTINCT mseg.MBLNR) AS n_documentos
FROM `proan-quantrue.D00_SANDBOX.proan_MSEG_HIDROCARBUROS_20260714` mseg
INNER JOIN mseg_docs USING (MBLNR)
LEFT JOIN `proan-quantrue.D20_DIMENSION.dm_material` dm_m ON mseg.MATNR = dm_m.material_number
LEFT JOIN `proan-quantrue.D20_DIMENSION.dm_vendors` dm_v ON mseg.LIFNR = dm_v.id_proveedor
WHERE dm_v.rfc = 'DGN811026BU6'
GROUP BY mseg.KOSTL, dm_m.external_material_group
ORDER BY dm_m.external_material_group, n_documentos DESC;
