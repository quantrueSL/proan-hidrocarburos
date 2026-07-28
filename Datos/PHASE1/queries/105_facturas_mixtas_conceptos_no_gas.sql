-- HALLAZGO CLAVE: la mayoría de las facturas de gas NO son "solo gas" -- llevan otros
-- conceptos (no-gas) en el mismo CFDI. Se compara el SubTotal (cabecera = todos los conceptos,
-- sin IVA) contra la suma del Importe de las líneas de gas.
--   (a) franja: qué parte de la factura es gas.
--   (b) tasa de facturas mixtas por proveedor (variante comentada abajo).
-- Resultado: 73.7% de las facturas de gas de Proteína Animal son mixtas; en 394 el gas es
-- <10% de la factura. Consecuencia: el dashboard debe sumar Importe de la línea de gas,
-- NUNCA Total/SubTotal; el Módulo 3/4 aprueba/paga la factura completa (concilia contra Total).
WITH gas AS (
  SELECT UUID, EmisorNombre, ANY_VALUE(SubTotal) AS subtotal, SUM(Importe) AS suma_gas
  FROM `proan-quantrue.D00_SANDBOX.cfdis`
  WHERE ReceptorRfc = 'PAN921013AK7'
    AND (ClaveProdServ LIKE '151115%' OR ClaveProdServ IN ('83101600','83101601'))
  GROUP BY UUID, EmisorNombre
)
SELECT
  CASE WHEN suma_gas >= subtotal * 0.99 THEN 'gas = 100% factura'
       WHEN suma_gas >= subtotal * 0.5  THEN 'gas 50-99%'
       WHEN suma_gas >= subtotal * 0.1  THEN 'gas 10-50%'
       ELSE 'gas < 10% factura' END AS franja_gas,
  COUNT(*) AS n_facturas,
  ROUND(SUM(suma_gas), 0)  AS suma_concepto_gas,
  ROUND(SUM(subtotal), 0)  AS suma_subtotal_factura
FROM gas
GROUP BY franja_gas
ORDER BY n_facturas DESC;

-- (b) Tasa de facturas mixtas por proveedor:
-- SELECT EmisorNombre, COUNT(*) AS n_fact,
--   COUNTIF(subtotal > suma_gas + 1) AS mixtas,
--   ROUND(100 * COUNTIF(subtotal > suma_gas + 1) / COUNT(*), 0) AS pct_mixtas
-- FROM gas GROUP BY EmisorNombre ORDER BY n_fact DESC;
