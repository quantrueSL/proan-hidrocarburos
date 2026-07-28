-- Módulos 3/4: cfdis NO trae estatus de cancelación SAT. Se listan las columnas (no hay
-- Estatus/Cancelado/FechaCancelacion) y se confirma que el universo de gas es todo
-- TipoDeComprobante='I' (ingreso, sin notas de crédito) y MXN. Riesgo: se podría aprobar/pagar
-- un CFDI cancelado en el SAT sin enterarse -> hay que resolver con un chequeo externo del
-- Estatus SAT en Fase 2.
SELECT column_name, data_type
FROM `proan-quantrue.D00_SANDBOX.INFORMATION_SCHEMA.COLUMNS`
WHERE table_name = 'cfdis'
ORDER BY ordinal_position;

-- Composición del universo (tipo de comprobante y moneda):
-- SELECT TipoDeComprobante, Moneda, COUNT(*) AS n
-- FROM `proan-quantrue.D00_SANDBOX.cfdis`
-- WHERE ReceptorRfc = 'PAN921013AK7'
--   AND (ClaveProdServ LIKE '151115%' OR ClaveProdServ IN ('83101600','83101601'))
-- GROUP BY TipoDeComprobante, Moneda;
