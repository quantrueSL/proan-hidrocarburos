-- Cierre Fase 1 (insumo Módulo 2) — ¿por qué 133 de 1.051 folios de gas (13%) no casan en BKPF?
-- Desglose por proveedor de los sin-match. Hallazgo: se concentran en CORPO GAS (69 = 52% de
-- los 133), con fechas repartidas jul-2025→jun-2026 (NO recientes) → apunta a formato, no timing.
WITH gas AS (
  SELECT UPPER(REPLACE(CONCAT(IFNULL(Serie,''),CAST(Folio AS STRING)),' ','')) AS folio_key,
    ANY_VALUE(EmisorNombre) AS prov, ANY_VALUE(DATE(Fecha)) AS fecha
  FROM `proan-quantrue.D00_SANDBOX.cfdis`
  WHERE ReceptorRfc='PAN921013AK7' AND (ClaveProdServ LIKE '151115%' OR ClaveProdServ IN ('83101600','83101601'))
  GROUP BY folio_key),
bk AS (SELECT DISTINCT UPPER(REPLACE(TRIM(XBLNR_reference_document_number),' ','')) AS xk
       FROM `proan-quantrue.D30_INTEGRATION.bkpf_account_document_header` WHERE XBLNR_reference_document_number IS NOT NULL),
tagged AS (SELECT g.*, (bk.xk IS NOT NULL) AS en_bkpf FROM gas g LEFT JOIN bk ON g.folio_key=bk.xk)
SELECT prov, COUNT(*) AS folios, COUNTIF(en_bkpf) AS con_bkpf, COUNTIF(NOT en_bkpf) AS sin_bkpf,
  MIN(IF(NOT en_bkpf, fecha, NULL)) AS min_fecha_sinmatch, MAX(IF(NOT en_bkpf, fecha, NULL)) AS max_fecha_sinmatch
FROM tagged GROUP BY prov ORDER BY sin_bkpf DESC;
