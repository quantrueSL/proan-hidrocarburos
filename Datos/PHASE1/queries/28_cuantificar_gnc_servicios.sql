-- Cuantificar el gas facturado como "servicio" (83101600/83101601 - compresión/consumo GNC)
-- frente al universo que ya teníamos (151115xx). Solo agregados por proveedor.
SELECT ClaveProdServ, EmisorRfc, EmisorNombre, COUNT(*) AS n_facturas, ROUND(SUM(Importe),2) AS suma_importe
FROM `proan-quantrue.D00_SANDBOX.cfdis`
WHERE FechaTimbrado >= '2026-01-01'
  AND ClaveProdServ IN ('83101600','83101601')
GROUP BY ClaveProdServ, EmisorRfc, EmisorNombre
ORDER BY suma_importe DESC;
