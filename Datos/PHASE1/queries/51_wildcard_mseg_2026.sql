-- Las tablas MSEG diarias parecen ser DELTAS (solo movimientos de ese día), no acumulados.
-- Usar consulta comodín de BigQuery para barrer TODAS las tablas proan_MSEG_2026* de una vez.
SELECT _TABLE_SUFFIX AS tabla, COUNT(*) AS n_lineas, COUNT(DISTINCT MBLNR) AS n_documentos
FROM `proan-quantrue.D00_SANDBOX.proan_MSEG_2026*`
WHERE MATNR = '000000110000009544'
GROUP BY _TABLE_SUFFIX
ORDER BY tabla;
