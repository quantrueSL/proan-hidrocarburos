-- Cierre Fase 1 (insumo Módulo 2) — aplicar a sap_ekbe el mismo fix de folio que a BKPF (§22).
-- La query 119 derivaba el sitio (WERKS) para ~52% de folios vía folio_key EXACTO (Serie+Folio)
-- -> sap_ekbe.XBLNR -> EBELN -> sap_purchasing_orders.WERKS_Centro. Igual que BKPF, sap_ekbe.XBLNR
-- guarda el NÚMERO de folio con prefijo/sufijo variable, no Serie+Folio.
-- Al añadir el matcher numérico+fecha (LTRIM(REGEXP_REPLACE(...,r'[^0-9]',''),'0'), LENGTH>=5,
-- BUDAT ±45d) sobre los NO casados por exacto: se recuperan 66 folios, y los 66 completan la
-- cadena hasta WERKS. Cobertura de sitio: 547 (52%) -> 613 (58%).
WITH gas AS (
  SELECT UPPER(REPLACE(CONCAT(IFNULL(Serie,''),CAST(Folio AS STRING)),' ','')) AS folio_key,
    ANY_VALUE(DATE(Fecha)) AS fecha, ANY_VALUE(LTRIM(REGEXP_REPLACE(CAST(Folio AS STRING),r'[^0-9]',''),'0')) AS fnz
  FROM `proan-quantrue.D00_SANDBOX.cfdis`
  WHERE ReceptorRfc='PAN921013AK7' AND (ClaveProdServ LIKE '151115%' OR ClaveProdServ IN ('83101600','83101601')) GROUP BY folio_key),
ekbe AS (SELECT UPPER(REPLACE(TRIM(XBLNR),' ','')) AS xk, LTRIM(REGEXP_REPLACE(TRIM(XBLNR),r'[^0-9]',''),'0') AS xnz, EBELN, BUDAT
         FROM `proan-quantrue.D30_INTEGRATION.sap_ekbe` WHERE XBLNR IS NOT NULL),
po AS (SELECT DISTINCT EBELN_OrdenCompra AS EBELN, WERKS_Centro AS werks FROM `proan-quantrue.D30_INTEGRATION.sap_purchasing_orders` WHERE WERKS_Centro IS NOT NULL),
exact_keys AS (SELECT DISTINCT g.folio_key FROM gas g JOIN ekbe e ON g.folio_key=e.xk),
werks_exact AS (SELECT DISTINCT g.folio_key FROM gas g JOIN ekbe e ON g.folio_key=e.xk JOIN po ON e.EBELN=po.EBELN),
unmatched AS (SELECT g.* FROM gas g WHERE g.folio_key NOT IN (SELECT folio_key FROM exact_keys)),
rec_ekbe AS (SELECT DISTINCT u.folio_key FROM unmatched u JOIN ekbe e ON LENGTH(u.fnz)>=5 AND e.xnz=u.fnz AND ABS(DATE_DIFF(u.fecha,e.BUDAT,DAY))<=45),
werks_rec AS (SELECT DISTINCT u.folio_key FROM unmatched u JOIN ekbe e ON LENGTH(u.fnz)>=5 AND e.xnz=u.fnz AND ABS(DATE_DIFF(u.fecha,e.BUDAT,DAY))<=45 JOIN po ON e.EBELN=po.EBELN)
SELECT (SELECT COUNT(*) FROM gas) AS total_gas,
  (SELECT COUNT(*) FROM exact_keys) AS ekbe_exacto,
  (SELECT COUNT(*) FROM werks_exact) AS werks_baseline_52pct,
  (SELECT COUNT(*) FROM rec_ekbe) AS ekbe_recuperado_num,
  (SELECT COUNT(*) FROM werks_rec) AS werks_recuperado_num,
  (SELECT COUNT(*) FROM (SELECT folio_key FROM werks_exact UNION DISTINCT SELECT folio_key FROM werks_rec)) AS werks_total_58pct;
