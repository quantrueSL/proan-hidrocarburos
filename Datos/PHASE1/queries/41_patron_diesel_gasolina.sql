-- Evidencia empírica para D2: ¿el patrón de diésel/gasolina se parece al de "pocas facturas
-- grandes de gas a aprobar a mano" (la Propuesta), o a "muchas transacciones pequeñas de
-- flotilla" (proceso distinto)? Comparar concentración de proveedores y tamaño de factura.
SELECT
  CASE WHEN ClaveProdServ LIKE '151115%' THEN 'Gas (151115xx)'
       WHEN ClaveProdServ LIKE '1510%' THEN 'Diesel/Gasolina (1510xxxx)'
  END AS categoria,
  COUNT(DISTINCT UUID) AS n_facturas,
  COUNT(DISTINCT EmisorRfc) AS n_proveedores_distintos,
  ROUND(AVG(Importe), 2) AS importe_promedio_factura,
  ROUND(APPROX_QUANTILES(Importe, 2)[OFFSET(1)], 2) AS importe_mediana,
  ROUND(MIN(Importe), 2) AS importe_min,
  ROUND(MAX(Importe), 2) AS importe_max
FROM `proan-quantrue.D00_SANDBOX.cfdis`
WHERE FechaTimbrado >= '2026-01-01'
  AND (ClaveProdServ LIKE '151115%' OR ClaveProdServ LIKE '1510%')
GROUP BY categoria;
