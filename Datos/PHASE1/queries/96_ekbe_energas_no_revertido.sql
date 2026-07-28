-- ¿Los pedidos de Energas que NO se revirtieron tienen Invoice Receipt (VGABE=2)
-- que cuadre con el importe de la recepción, o el misterio de escala persiste ahí?
SELECT EBELN, VGABE, BEWTP, BWART, SAFE.PARSE_DATE('%Y%m%d', CAST(BUDAT AS STRING)) AS fecha,
  SAFE_CAST(DMBTR AS NUMERIC) AS dmbtr
FROM `proan-quantrue.D00_SANDBOX.proan_EKBE_2026*`
WHERE EBELN IN ('4502193877', '4502358480', '4502228839')
QUALIFY ROW_NUMBER() OVER (PARTITION BY EBELN, VGABE, BUDAT, DMBTR ORDER BY _TABLE_SUFFIX) = 1
ORDER BY EBELN, VGABE, fecha;
