-- FORMATO (la causa que sospechábamos, igual que el MATNR en Fase 1 q46-51): BKPF NO guarda la
-- Serie+Folio del CFDI, guarda el NÚMERO con otro prefijo/sufijo tecleado a mano. Ejemplos:
--   GCRE12179 -> "12179" | GCRE11569 -> "FL11569" | E0000472360 -> "BNSF472360"
--   V091473 -> "91473" | OJA88489 -> "88489FA" | CFDI6144183 -> "F 6144183"
-- => el número es la clave estable, la serie NO. Recupera 13 sin-match "largos" por número+fecha≤45d.
WITH gas AS (
  SELECT UPPER(REPLACE(CONCAT(IFNULL(Serie,''),CAST(Folio AS STRING)),' ','')) AS folio_key,
    ANY_VALUE(EmisorNombre) AS prov, ANY_VALUE(DATE(Fecha)) AS fecha,
    ANY_VALUE(LTRIM(REGEXP_REPLACE(CAST(Folio AS STRING),r'[^0-9]',''),'0')) AS fnz
  FROM `proan-quantrue.D00_SANDBOX.cfdis`
  WHERE ReceptorRfc='PAN921013AK7' AND (ClaveProdServ LIKE '151115%' OR ClaveProdServ IN ('83101600','83101601')) GROUP BY folio_key),
bk_exact AS (SELECT DISTINCT UPPER(REPLACE(TRIM(XBLNR_reference_document_number),' ','')) AS xk
       FROM `proan-quantrue.D30_INTEGRATION.bkpf_account_document_header` WHERE XBLNR_reference_document_number IS NOT NULL),
unmatched AS (SELECT g.* FROM gas g LEFT JOIN bk_exact b ON g.folio_key=b.xk WHERE b.xk IS NULL),
bk AS (SELECT XBLNR_reference_document_number AS raw, LTRIM(REGEXP_REPLACE(TRIM(XBLNR_reference_document_number),r'[^0-9]',''),'0') AS xnz,
         BLDAT_document_dt AS fsap, BLART_document_type AS blart
       FROM `proan-quantrue.D30_INTEGRATION.bkpf_account_document_header`
       WHERE XBLNR_reference_document_number IS NOT NULL AND LENGTH(LTRIM(REGEXP_REPLACE(TRIM(XBLNR_reference_document_number),r'[^0-9]',''),'0'))>=5)
SELECT u.prov, u.folio_key AS cfdi_folio_key, b.raw AS bkpf_xblnr, b.blart, u.fecha AS fecha_cfdi, b.fsap AS fecha_sap
FROM unmatched u JOIN bk b ON LENGTH(u.fnz)>=5 AND b.xnz=u.fnz AND ABS(DATE_DIFF(u.fecha,b.fsap,DAY))<=45
QUALIFY ROW_NUMBER() OVER (PARTITION BY u.folio_key ORDER BY ABS(DATE_DIFF(u.fecha,b.fsap,DAY)))=1
ORDER BY u.prov;
