-- Clasificación de los 133 sin-match a 4 vías. Resultado: formato 13 (10%), timing 36 (27%),
-- ausencia larga 46 (35%), ausencia corta/ambigua 38 (29%). "reciente" = fecha >= 2026-06-20
-- (últimos ~30d). "formato" = número (>=5 díg.) aparece en BKPF a ≤45d de la fecha del CFDI.
WITH gas AS (
  SELECT UPPER(REPLACE(CONCAT(IFNULL(Serie,''),CAST(Folio AS STRING)),' ','')) AS folio_key,
    ANY_VALUE(DATE(Fecha)) AS fecha, ANY_VALUE(LTRIM(REGEXP_REPLACE(CAST(Folio AS STRING),r'[^0-9]',''),'0')) AS fnz
  FROM `proan-quantrue.D00_SANDBOX.cfdis`
  WHERE ReceptorRfc='PAN921013AK7' AND (ClaveProdServ LIKE '151115%' OR ClaveProdServ IN ('83101600','83101601')) GROUP BY folio_key),
bk_exact AS (SELECT DISTINCT UPPER(REPLACE(TRIM(XBLNR_reference_document_number),' ','')) AS xk
       FROM `proan-quantrue.D30_INTEGRATION.bkpf_account_document_header` WHERE XBLNR_reference_document_number IS NOT NULL),
unmatched AS (SELECT g.* FROM gas g LEFT JOIN bk_exact b ON g.folio_key=b.xk WHERE b.xk IS NULL),
bk_num AS (SELECT LTRIM(REGEXP_REPLACE(TRIM(XBLNR_reference_document_number),r'[^0-9]',''),'0') AS xnz, BLDAT_document_dt AS fsap
       FROM `proan-quantrue.D30_INTEGRATION.bkpf_account_document_header`
       WHERE XBLNR_reference_document_number IS NOT NULL AND LENGTH(LTRIM(REGEXP_REPLACE(TRIM(XBLNR_reference_document_number),r'[^0-9]',''),'0'))>=5),
cls AS (
  SELECT u.folio_key, u.fecha, u.fnz, (u.fecha >= DATE '2026-06-20') AS reciente,
    MAX(IF(b.xnz IS NOT NULL,1,0)) AS format_rec
  FROM unmatched u LEFT JOIN bk_num b ON LENGTH(u.fnz)>=5 AND b.xnz=u.fnz AND ABS(DATE_DIFF(u.fecha,b.fsap,DAY))<=45
  GROUP BY 1,2,3)
SELECT COUNT(*) AS total,
  COUNTIF(format_rec=1) AS formato,
  COUNTIF(format_rec=0 AND reciente) AS timing,
  COUNTIF(format_rec=0 AND NOT reciente AND LENGTH(fnz)>=5) AS ausencia_larga,
  COUNTIF(format_rec=0 AND NOT reciente AND LENGTH(fnz)<5) AS ausencia_corta_ambigua
FROM cls;
