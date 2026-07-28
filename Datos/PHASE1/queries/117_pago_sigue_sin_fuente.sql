-- Aun con la capa nueva, el estatus de PAGO sigue sin fuente fiable para gas:
--   - sap_open_cleared_items (XBLNR):        2 de 1.051 folios
--   - sap_bsik_open_items    (XBLNR):        1 de 1.051 folios
--   - int_ACDOCA_historico   (LIFNR):        0 filas para los proveedores de gas (scope Maka)
--   - facturas_pago (pagado_lg) vía BELNR:   0 (es tabla de CLIENTES/cobrar, no proveedores)
-- Conclusión: la factura está REGISTRADA en SAP (RE en BKPF, 81%), pero NO consta si se pagó.
-- Ese es el hueco que queda para el Módulo 4 (más estrecho que "no hay nada").
WITH gas AS (
  SELECT DISTINCT UPPER(REPLACE(CONCAT(IFNULL(Serie,''),CAST(Folio AS STRING)),' ','')) AS folio_key
  FROM `proan-quantrue.D00_SANDBOX.cfdis`
  WHERE ReceptorRfc='PAN921013AK7' AND (ClaveProdServ LIKE '151115%' OR ClaveProdServ IN ('83101600','83101601'))
),
oc AS (SELECT DISTINCT UPPER(REPLACE(TRIM(XBLNR_reference_document_number),' ','')) xk
       FROM `proan-quantrue.D30_INTEGRATION.sap_open_cleared_items` WHERE XBLNR_reference_document_number IS NOT NULL),
bk AS (SELECT DISTINCT UPPER(REPLACE(TRIM(XBLNR_reference_document_number),' ','')) xk
       FROM `proan-quantrue.D30_INTEGRATION.sap_bsik_open_items` WHERE XBLNR_reference_document_number IS NOT NULL)
SELECT (SELECT COUNT(*) FROM gas) AS total_gas,
  (SELECT COUNT(*) FROM gas g JOIN oc ON g.folio_key=oc.xk) AS en_open_cleared_items,
  (SELECT COUNT(*) FROM gas g JOIN bk ON g.folio_key=bk.xk) AS en_bsik_open_items;
