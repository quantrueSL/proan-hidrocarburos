-- D7: ¿hay una posición de "recepción de factura" (VGABE=2) en EKBE para los EBELN
-- ya conocidos, que explique por qué el valor de la recepción (101) es 10-40x mayor
-- que lo realmente facturado? Barrido con comodín sobre todo 2026.
SELECT EBELN, VGABE, BEWTP, BWART, SAFE.PARSE_DATE('%Y%m%d', CAST(BUDAT AS STRING)) AS fecha,
  SAFE_CAST(DMBTR AS NUMERIC) AS dmbtr, SAFE_CAST(WRBTR AS NUMERIC) AS wrbtr
FROM `proan-quantrue.D00_SANDBOX.proan_EKBE_2026*`
WHERE EBELN IN ('4502193451', '4502235640', '4502198970')
QUALIFY ROW_NUMBER() OVER (PARTITION BY EBELN, VGABE, BUDAT, DMBTR ORDER BY _TABLE_SUFFIX) = 1
ORDER BY EBELN, fecha;
