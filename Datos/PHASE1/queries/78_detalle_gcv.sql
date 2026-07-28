SELECT dm_v.rfc, dm_v.razon_social, mseg.MBLNR, mseg.BWART, mseg.SAKTO,
  SAFE.PARSE_DATE('%Y%m%d', CAST(mseg.BUDAT_MKPF AS STRING)) AS fecha,
  mseg.MATNR, mseg.WERKS, ROUND(mseg.DMBTR, 2) AS dmbtr, mseg.SHKZG
FROM `proan-quantrue.D00_SANDBOX.proan_MSEG_HIDROCARBUROS_20260714` mseg
LEFT JOIN `proan-quantrue.D20_DIMENSION.dm_vendors` dm_v ON mseg.LIFNR = dm_v.id_proveedor
WHERE dm_v.rfc = 'GCV610502NY0'
ORDER BY dmbtr DESC
LIMIT 60;
