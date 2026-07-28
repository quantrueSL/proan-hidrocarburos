-- CRÍTICO: ¿MBLNR se repite entre distintos MJAHR (año fiscal) en este dataset?
-- Si sí, todas las queries que agruparon solo por MBLNR (sin MJAHR) pudieron mezclar
-- documentos de años distintos que comparten número.
SELECT MBLNR, COUNT(DISTINCT MJAHR) AS n_anios_distintos,
  STRING_AGG(DISTINCT MJAHR ORDER BY MJAHR) AS anios
FROM `proan-quantrue.D00_SANDBOX.proan_MSEG_HIDROCARBUROS_20260714`
GROUP BY MBLNR
HAVING COUNT(DISTINCT MJAHR) > 1
LIMIT 20;
