-- ¿Por qué solo 5 de 14 EBELN de Energas aparecieron en EKBE? ¿Formato distinto?
(SELECT 'mseg' AS fuente, mseg.EBELN
 FROM `proan-quantrue.D00_SANDBOX.proan_MSEG_HIDROCARBUROS_20260714` mseg
 LEFT JOIN `proan-quantrue.D20_DIMENSION.dm_vendors` dm_v ON mseg.LIFNR = dm_v.id_proveedor
 WHERE dm_v.rfc = 'EME0001256D0' AND mseg.SAKTO = '0005010611'
 GROUP BY mseg.EBELN)
UNION ALL
(SELECT 'ekbe' AS fuente, EBELN
 FROM `proan-quantrue.D00_SANDBOX.proan_EKBE_20260501`
 WHERE EBELN LIKE '450223%' OR EBELN LIKE '450228%'
 GROUP BY EBELN
 LIMIT 20);
