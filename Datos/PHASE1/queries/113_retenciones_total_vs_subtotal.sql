-- Punto ciego (re-revisión jul-2026): el 21% de las facturas de gas (221 de 1,075) tienen
-- Total < SubTotal + TotalImpuestosTrasladados -> hay RETENCIONES (el proveedor retiene ISR/IVA).
-- cfdis NO trae columna de retenciones (solo se infiere como SubTotal+Traslados-Total). El
-- impuesto trasladado medio es ~15.9% (IVA 16%). Ninguna factura tiene Total mayor (no hay IEPS
-- adicional visible). Consecuencia para el Módulo 4: el importe realmente pagable es Total (ya
-- neto de retención); cualquier match por importe debe usar Total, no SubTotal+IVA, y aun así
-- es frágil (ver cobertura en queries/112).
SELECT
  COUNT(*) AS n_filas,
  COUNTIF(Total < SubTotal + TotalImpuestosTrasladados - 1) AS total_menor_con_retencion,
  COUNTIF(Total > SubTotal + TotalImpuestosTrasladados + 1) AS total_mayor,
  ROUND(AVG(SAFE_DIVIDE(TotalImpuestosTrasladados, SubTotal)), 4) AS ratio_impuesto_medio
FROM `proan-quantrue.D00_SANDBOX.cfdis`
WHERE ReceptorRfc = 'PAN921013AK7'
  AND (ClaveProdServ LIKE '151115%' OR ClaveProdServ IN ('83101600','83101601'));
