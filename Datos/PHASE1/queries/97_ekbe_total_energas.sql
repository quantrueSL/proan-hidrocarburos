-- Total agregado: ¿cuánto suman de verdad los Invoice Receipt (VGABE=2) de TODOS
-- los EBELN de Energas en 2026? Deduplicado (las tablas diarias repiten líneas).
WITH ebeln_energas AS (
  SELECT DISTINCT EBELN
  FROM `proan-quantrue.D00_SANDBOX.proan_MSEG_HIDROCARBUROS_20260714` mseg
  LEFT JOIN `proan-quantrue.D20_DIMENSION.dm_vendors` dm_v ON mseg.LIFNR = dm_v.id_proveedor
  WHERE dm_v.rfc = 'EME0001256D0' AND mseg.SAKTO = '0005010611'
),
ekbe_dedup AS (
  SELECT EBELN, VGABE, EBELP, BUDAT, DMBTR,
    ROW_NUMBER() OVER (PARTITION BY EBELN, VGABE, EBELP, BUDAT, DMBTR ORDER BY _TABLE_SUFFIX) AS rn
  FROM `proan-quantrue.D00_SANDBOX.proan_EKBE_2026*`
  WHERE EBELN IN (SELECT EBELN FROM ebeln_energas)
)
SELECT VGABE, COUNT(DISTINCT EBELN) AS n_ebeln, COUNT(*) AS n_lineas,
  ROUND(SUM(SAFE_CAST(DMBTR AS NUMERIC)),2) AS suma_dmbtr
FROM ekbe_dedup
WHERE rn = 1
GROUP BY VGABE
ORDER BY VGABE;
