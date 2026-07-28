-- Punto ciego (re-revisión jul-2026): cfdis TAMBIÉN trae filas duplicadas, igual que MSEG y
-- dm_vendors. De las facturas de gas de Proteína Animal, 24 UUIDs tienen 2 filas y en los 24 la
-- 2ª fila es un duplicado EXACTO del mismo concepto (mismo ClaveProdServ+Cantidad+Importe+
-- Descripcion), no una segunda línea real. Consecuencia: SUM(Importe) por filas cuenta doble
-- esas 24 facturas -> el universo ($40.6M / 1,075 filas) está levemente inflado; usar
-- COUNT(DISTINCT UUID) y deduplicar antes de sumar. cfdis no tiene columna de línea, así que la
-- deduplicación defensiva es por (UUID, ClaveProdServ, Cantidad, Importe, Descripcion).
WITH multi AS (
  SELECT UUID, COUNT(*) AS n_rows,
    COUNT(DISTINCT FORMAT('%s|%t|%t|%s', ClaveProdServ, Cantidad, Importe, Descripcion)) AS n_distinct_concepto
  FROM `proan-quantrue.D00_SANDBOX.cfdis`
  WHERE ReceptorRfc = 'PAN921013AK7'
    AND (ClaveProdServ LIKE '151115%' OR ClaveProdServ IN ('83101600','83101601'))
  GROUP BY UUID HAVING COUNT(*) > 1
)
SELECT COUNT(*) AS uuids_multi_fila,
  COUNTIF(n_rows > n_distinct_concepto) AS uuids_con_fila_duplicada_exacta
FROM multi;
