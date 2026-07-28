-- Repetir para GCV610502NY0 y EME0001256D0 mostrando EBELN (pedido) -- ¿también
-- están ligados a un pedido real, como Natgas Querétaro, o son otra cosa?
SELECT dm_v.rfc, mseg.MBLNR, mseg.BWART, mseg.EBELN,
  SAFE.PARSE_DATE('%Y%m%d', CAST(mseg.BUDAT_MKPF AS STRING)) AS fecha,
  mseg.SGTXT, ROUND(mseg.DMBTR,2) AS dmbtr, mseg.SHKZG, mseg.KOSTL
FROM `proan-quantrue.D00_SANDBOX.proan_MSEG_HIDROCARBUROS_20260714` mseg
LEFT JOIN `proan-quantrue.D20_DIMENSION.dm_vendors` dm_v ON mseg.LIFNR = dm_v.id_proveedor
WHERE dm_v.rfc IN ('GCV610502NY0','EME0001256D0') AND mseg.SAKTO = '0005010611'
ORDER BY dm_v.rfc, dmbtr DESC
LIMIT 40;
