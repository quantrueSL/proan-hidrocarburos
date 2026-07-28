-- Pista indirecta: ¿la dirección FISCAL registrada de cada proveedor de gas (dm_vendors)
-- sugiere que son distribuidores regionales de un solo estado/zona? (evidencia circunstancial,
-- no prueba directa, pero barata de obtener).
SELECT dm_v.rfc, dm_v.razon_social, dm_v.municipio, dm_v.estado_cod, dm_v.colonia
FROM `proan-quantrue.D20_DIMENSION.dm_vendors` dm_v
WHERE dm_v.rfc IN (
  'DGN811026BU6','CGA9810197C5','DGS071124SN0','HCI8401303N0','NGN120221H35',
  'GCV610502NY0','SGA811211ED6','EME0001256D0','GTU970606FPA','DPG840301KFA',
  'NQU120510QZ7'
)
ORDER BY dm_v.rfc;
