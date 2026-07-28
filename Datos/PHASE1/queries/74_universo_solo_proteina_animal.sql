-- D11 decidido: alcance = Proteína Animal (PAN921013AK7) únicamente.
-- Recalcular el universo de gas restringido a esta entidad.
SELECT EmisorRfc, EmisorNombre, COUNT(*) AS n_facturas,
  MIN(DATE(FechaTimbrado)) AS desde, MAX(DATE(FechaTimbrado)) AS hasta,
  ROUND(SUM(Importe),2) AS suma_importe
FROM `proan-quantrue.D00_SANDBOX.cfdis`
WHERE (ClaveProdServ LIKE '151115%' OR ClaveProdServ IN ('83101600','83101601'))
  AND ReceptorRfc = 'PAN921013AK7'
GROUP BY EmisorRfc, EmisorNombre
ORDER BY n_facturas DESC;
