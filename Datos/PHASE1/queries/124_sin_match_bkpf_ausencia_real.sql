-- AUSENCIA REAL: de los 86 sin-match "largos" (folio con >=5 díg.), separar los que tienen su
-- número en BKPF alguna vez (formato/colisión) de los que NO aparecen NUNCA (ausencia dura).
-- Resultado: 13 a ≤45d (formato), 54 número a otra fecha (>45d: casi todo colisión, el posteo
-- real ocurre a ≤7d), 1 nunca+reciente (timing), 18 nunca+antiguo (AUSENCIA REAL confirmada).
-- Ejemplos de ausencia real (número nunca en BKPF): CORPO GAS E0000498490/498489/491935 (dic-2025).
WITH gas AS (
  SELECT UPPER(REPLACE(CONCAT(IFNULL(Serie,''),CAST(Folio AS STRING)),' ','')) AS folio_key,
    ANY_VALUE(DATE(Fecha)) AS fecha, ANY_VALUE(LTRIM(REGEXP_REPLACE(CAST(Folio AS STRING),r'[^0-9]',''),'0')) AS fnz
  FROM `proan-quantrue.D00_SANDBOX.cfdis`
  WHERE ReceptorRfc='PAN921013AK7' AND (ClaveProdServ LIKE '151115%' OR ClaveProdServ IN ('83101600','83101601')) GROUP BY folio_key),
bk_exact AS (SELECT DISTINCT UPPER(REPLACE(TRIM(XBLNR_reference_document_number),' ','')) AS xk
       FROM `proan-quantrue.D30_INTEGRATION.bkpf_account_document_header` WHERE XBLNR_reference_document_number IS NOT NULL),
unmatched AS (SELECT g.* FROM gas g LEFT JOIN bk_exact b ON g.folio_key=b.xk WHERE b.xk IS NULL AND LENGTH(g.fnz)>=5),
bknum AS (SELECT DISTINCT LTRIM(REGEXP_REPLACE(TRIM(XBLNR_reference_document_number),r'[^0-9]',''),'0') AS xnz, BLDAT_document_dt AS fsap
       FROM `proan-quantrue.D30_INTEGRATION.bkpf_account_document_header`
       WHERE XBLNR_reference_document_number IS NOT NULL AND LENGTH(LTRIM(REGEXP_REPLACE(TRIM(XBLNR_reference_document_number),r'[^0-9]',''),'0'))>=5),
per AS (
  SELECT u.folio_key, u.fecha,
    MAX(IF(b.xnz IS NOT NULL AND ABS(DATE_DIFF(u.fecha,b.fsap,DAY))<=45,1,0)) AS en_45d,
    MAX(IF(b.xnz IS NOT NULL,1,0)) AS ever
  FROM unmatched u LEFT JOIN bknum b ON b.xnz=u.fnz GROUP BY u.folio_key, u.fecha)
SELECT COUNT(*) AS largos_sin_match, COUNTIF(en_45d=1) AS num_en_bkpf_45d,
  COUNTIF(en_45d=0 AND ever=1) AS num_otra_fecha_prob_colision,
  COUNTIF(ever=0 AND fecha>=DATE '2026-06-20') AS nunca_reciente_timing,
  COUNTIF(ever=0 AND fecha<DATE '2026-06-20') AS nunca_antiguo_ausencia_real
FROM per;
