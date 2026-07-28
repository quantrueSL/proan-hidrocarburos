-- D9: frecuencia de facturación por proveedor (dentro de Proteína Animal).
-- Referencia conocida: Distribuidora de Gas Noel entrega ~1 factura cada 2-4 semanas
-- POR CECO (18 CECOs distintos, confirmado vía MSEG) -- una frecuencia alta total
-- es compatible con "sirve a muchos sitios", no con "un solo sitio".
SELECT EmisorRfc, EmisorNombre,
  COUNT(*) AS n_facturas,
  DATE_DIFF(MAX(DATE(FechaTimbrado)), MIN(DATE(FechaTimbrado)), MONTH) + 1 AS meses_de_historia,
  ROUND(COUNT(*) / (DATE_DIFF(MAX(DATE(FechaTimbrado)), MIN(DATE(FechaTimbrado)), MONTH) + 1), 1) AS facturas_por_mes
FROM `proan-quantrue.D00_SANDBOX.cfdis`
WHERE (ClaveProdServ LIKE '151115%' OR ClaveProdServ IN ('83101600','83101601'))
  AND ReceptorRfc = 'PAN921013AK7'
GROUP BY EmisorRfc, EmisorNombre
ORDER BY facturas_por_mes DESC;
