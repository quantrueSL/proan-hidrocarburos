-- ¿Cuántos CECOs distintos y qué pedidos (EBELN) hay detrás de los importes grandes
-- de GCV/EME bajo la cuenta 0005010611? ¿Se repite el patrón "reversa mismo día,
-- se vuelve a postear correcto" que ya vimos a pequeña escala en Gas Noel?
SELECT dm_v.rfc, mseg.EBELN, mseg.BWART, COUNT(DISTINCT mseg.KOSTL) AS n_cecos_distintos,
  COUNT(DISTINCT mseg.MBLNR) AS n_documentos, ROUND(SUM(mseg.DMBTR),2) AS suma
FROM `proan-quantrue.D00_SANDBOX.proan_MSEG_HIDROCARBUROS_20260714` mseg
LEFT JOIN `proan-quantrue.D20_DIMENSION.dm_vendors` dm_v ON mseg.LIFNR = dm_v.id_proveedor
WHERE dm_v.rfc IN ('GCV610502NY0','EME0001256D0') AND mseg.SAKTO = '0005010611'
GROUP BY dm_v.rfc, mseg.EBELN, mseg.BWART
ORDER BY dm_v.rfc, suma DESC;
