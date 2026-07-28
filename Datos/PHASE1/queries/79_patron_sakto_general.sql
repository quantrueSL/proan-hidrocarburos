-- ¿La cuenta 0005010611 (y el patrón 101+102 mismo día, mismo importe, MATNR vacío)
-- aparece en MÁS proveedores, o es cosa de estos dos? Si es general, no es una
-- característica de "GCV"/"EME" como vendors -- es un proceso contable/técnico.
SELECT mseg.SAKTO, dm_v.rfc, dm_v.razon_social,
  COUNT(DISTINCT mseg.MBLNR) AS n_documentos, ROUND(SUM(mseg.DMBTR),2) AS suma_dmbtr
FROM `proan-quantrue.D00_SANDBOX.proan_MSEG_HIDROCARBUROS_20260714` mseg
LEFT JOIN `proan-quantrue.D20_DIMENSION.dm_vendors` dm_v ON mseg.LIFNR = dm_v.id_proveedor
WHERE mseg.SAKTO = '0005010611' AND mseg.MATNR = ''
GROUP BY mseg.SAKTO, dm_v.rfc, dm_v.razon_social
ORDER BY suma_dmbtr DESC;
