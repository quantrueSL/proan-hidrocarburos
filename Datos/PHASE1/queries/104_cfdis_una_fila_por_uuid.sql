-- ¿"Una fila por UUID" en cfdis es exacto? Casi: de las facturas de gas de Proteína Animal,
-- la gran mayoría tienen 1 fila, pero 24 UUIDs tienen 2 líneas de gas (máximo 2).
-- Regla para Fase 2: agregar Importe por UUID, no asumir una sola fila por factura.
SELECT
  COUNT(*) AS n_uuid,
  MAX(filas_por_uuid) AS max_filas_por_uuid,
  COUNTIF(filas_por_uuid > 1) AS uuids_multi_fila
FROM (
  SELECT UUID, COUNT(*) AS filas_por_uuid
  FROM `proan-quantrue.D00_SANDBOX.cfdis`
  WHERE ReceptorRfc = 'PAN921013AK7'
    AND (ClaveProdServ LIKE '151115%' OR ClaveProdServ IN ('83101600','83101601'))
  GROUP BY UUID
);
