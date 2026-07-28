-- Punto ciego (re-revisión jul-2026): insumos de diseño del Módulo 4 que no habíamos mirado.
-- (a) MetodoPago: el 99.7% de las facturas de gas son PPD (pago diferido/parcialidades), no PUE
--     -> el pago NO ocurre al emitir; se documenta después con complementos de pago (REP).
-- (b) Tipos de comprobante de estos proveedores hacia Proteína Animal: además de 'I' (ingreso)
--     hay 243 'P' (complementos de pago / REP) y 9 'E' (notas de crédito) que NUNCA miramos.
--     Los REP son la vía natural del estatus de pago de las PPD -- PERO cfdis no trae la columna
--     de documento relacionado (doctoRelacionado), así que la liga factura<->pago no está en la
--     tabla; habría que reparsear el XML o buscar otra fuente. A investigar en Fase 2.
SELECT MetodoPago, COUNT(DISTINCT UUID) AS n_facturas
FROM `proan-quantrue.D00_SANDBOX.cfdis`
WHERE ReceptorRfc = 'PAN921013AK7'
  AND (ClaveProdServ LIKE '151115%' OR ClaveProdServ IN ('83101600','83101601'))
GROUP BY MetodoPago ORDER BY n_facturas DESC;

-- (b) Tipos de comprobante de los proveedores de gas hacia Proteína Animal:
-- WITH gas_rfc AS (
--   SELECT DISTINCT EmisorRfc FROM `proan-quantrue.D00_SANDBOX.cfdis`
--   WHERE ReceptorRfc='PAN921013AK7' AND (ClaveProdServ LIKE '151115%' OR ClaveProdServ IN ('83101600','83101601')))
-- SELECT c.TipoDeComprobante, COUNT(DISTINCT c.UUID) AS n_uuid
-- FROM `proan-quantrue.D00_SANDBOX.cfdis` c JOIN gas_rfc g ON c.EmisorRfc=g.EmisorRfc
-- WHERE c.ReceptorRfc='PAN921013AK7' GROUP BY 1 ORDER BY n_uuid DESC;   -- I=1070, P=243, E=9
