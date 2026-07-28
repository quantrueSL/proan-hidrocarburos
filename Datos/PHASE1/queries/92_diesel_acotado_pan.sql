-- Diésel/gasolina vs. gas, ambos acotados a Proteína Animal (ReceptorRfc).
SELECT
  CASE WHEN ClaveProdServ LIKE '151115%' OR ClaveProdServ IN ('83101600','83101601') THEN 'Gas'
       WHEN ClaveProdServ LIKE '1510%' THEN 'Diesel/Gasolina' END AS categoria,
  COUNT(DISTINCT UUID) AS n_facturas,
  COUNT(DISTINCT EmisorRfc) AS n_proveedores,
  ROUND(SUM(Importe),2) AS suma_importe
FROM `proan-quantrue.D00_SANDBOX.cfdis`
WHERE ReceptorRfc = 'PAN921013AK7'
  AND (ClaveProdServ LIKE '151115%' OR ClaveProdServ IN ('83101600','83101601') OR ClaveProdServ LIKE '1510%')
GROUP BY categoria;
