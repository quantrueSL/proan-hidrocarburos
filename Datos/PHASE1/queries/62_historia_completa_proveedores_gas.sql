-- Quitar el filtro de "solo 2026" y ver cuánta historia real hay por proveedor
-- (para saber si Natgas Querétaro/Energas de México tienen más facturas en otros años,
-- suficientes para probar estabilidad de ubicación como se hizo con Neomexicana).
SELECT EmisorRfc, EmisorNombre,
  MIN(DATE(FechaTimbrado)) AS primera_factura, MAX(DATE(FechaTimbrado)) AS ultima_factura,
  COUNT(*) AS n_facturas_total, ROUND(SUM(Importe),2) AS suma_importe
FROM `proan-quantrue.D00_SANDBOX.cfdis`
WHERE ClaveProdServ LIKE '151115%' OR ClaveProdServ IN ('83101600','83101601')
GROUP BY EmisorRfc, EmisorNombre
ORDER BY n_facturas_total DESC;
