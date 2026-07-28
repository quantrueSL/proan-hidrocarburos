-- Timing: ¿los sin-match se concentran en los últimos 30-60 días? Hallazgo: SÍ en parte —
-- en los últimos 30 días 37 de 73 folios (51%) NO casan, vs 13% global → los recientes son
-- lag de SAP (aún no posteados). Pero 88 de los 133 (66%) son de hace >60 días → esos NO son
-- timing (formato o ausencia real). Ancla de fecha = 2026-07-20 (último dato).
WITH gas AS (
  SELECT UPPER(REPLACE(CONCAT(IFNULL(Serie,''),CAST(Folio AS STRING)),' ','')) AS folio_key, ANY_VALUE(DATE(Fecha)) AS fecha
  FROM `proan-quantrue.D00_SANDBOX.cfdis`
  WHERE ReceptorRfc='PAN921013AK7' AND (ClaveProdServ LIKE '151115%' OR ClaveProdServ IN ('83101600','83101601'))
  GROUP BY folio_key),
bk AS (SELECT DISTINCT UPPER(REPLACE(TRIM(XBLNR_reference_document_number),' ','')) AS xk
       FROM `proan-quantrue.D30_INTEGRATION.bkpf_account_document_header` WHERE XBLNR_reference_document_number IS NOT NULL),
tagged AS (SELECT g.*, (bk.xk IS NOT NULL) AS en_bkpf FROM gas g LEFT JOIN bk ON g.folio_key=bk.xk)
SELECT en_bkpf, COUNT(*) AS n,
  COUNTIF(fecha >= DATE_SUB(DATE '2026-07-20', INTERVAL 30 DAY)) AS ult_30d,
  COUNTIF(fecha >= DATE_SUB(DATE '2026-07-20', INTERVAL 60 DAY)) AS ult_60d,
  COUNTIF(fecha <  DATE_SUB(DATE '2026-07-20', INTERVAL 60 DAY)) AS antes_60d
FROM tagged GROUP BY en_bkpf;
