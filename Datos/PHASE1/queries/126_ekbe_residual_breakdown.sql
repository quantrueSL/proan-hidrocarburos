-- Desglose del residual de sitio (438 folios SIN WERKS tras el fix de formato de la query 125).
-- Resultado: 43 timing (reciente <30d), 193 folio corto ambiguo (nº <5 díg, colisión no testeable),
-- 106 nº en EKBE pero sin sitio limpio (colisión a fecha lejana o EBELN sin WERKS en el pedido),
-- 96 SIN rastro en EKBE en absoluto. Conclusión: a diferencia de BKPF (donde el formato era el
-- fallo dominante), el techo de cobertura de SITIO es ESTRUCTURAL — la mayoría del residual no
-- tiene rastro de recepción-PO en EKBE (compras pequeñas/servicio sin pedido), no es formato.
WITH gas AS (
  SELECT UPPER(REPLACE(CONCAT(IFNULL(Serie,''),CAST(Folio AS STRING)),' ','')) AS folio_key,
    ANY_VALUE(DATE(Fecha)) AS fecha, ANY_VALUE(LTRIM(REGEXP_REPLACE(CAST(Folio AS STRING),r'[^0-9]',''),'0')) AS fnz
  FROM `proan-quantrue.D00_SANDBOX.cfdis`
  WHERE ReceptorRfc='PAN921013AK7' AND (ClaveProdServ LIKE '151115%' OR ClaveProdServ IN ('83101600','83101601')) GROUP BY folio_key),
ekbe AS (SELECT UPPER(REPLACE(TRIM(XBLNR),' ','')) AS xk, LTRIM(REGEXP_REPLACE(TRIM(XBLNR),r'[^0-9]',''),'0') AS xnz, EBELN, BUDAT
         FROM `proan-quantrue.D30_INTEGRATION.sap_ekbe` WHERE XBLNR IS NOT NULL),
po AS (SELECT DISTINCT EBELN_OrdenCompra AS EBELN, WERKS_Centro AS werks FROM `proan-quantrue.D30_INTEGRATION.sap_purchasing_orders` WHERE WERKS_Centro IS NOT NULL),
werks_total AS (
  SELECT DISTINCT g.folio_key FROM gas g JOIN ekbe e ON g.folio_key=e.xk JOIN po ON e.EBELN=po.EBELN
  UNION DISTINCT
  SELECT DISTINCT g.folio_key FROM gas g JOIN ekbe e ON LENGTH(g.fnz)>=5 AND e.xnz=g.fnz AND ABS(DATE_DIFF(g.fecha,e.BUDAT,DAY))<=45 JOIN po ON e.EBELN=po.EBELN),
residual AS (SELECT g.* FROM gas g WHERE g.folio_key NOT IN (SELECT folio_key FROM werks_total)),
ekbe_num AS (SELECT DISTINCT xnz FROM ekbe WHERE LENGTH(xnz)>=5)
SELECT COUNT(*) AS residual_sin_sitio,
  COUNTIF(r.fecha >= DATE '2026-06-20') AS timing_reciente,
  COUNTIF(r.fecha < DATE '2026-06-20' AND LENGTH(r.fnz)<5) AS folio_corto_ambiguo,
  COUNTIF(r.fecha < DATE '2026-06-20' AND LENGTH(r.fnz)>=5 AND n.xnz IS NOT NULL) AS num_en_ekbe_sin_sitio,
  COUNTIF(r.fecha < DATE '2026-06-20' AND LENGTH(r.fnz)>=5 AND n.xnz IS NULL) AS sin_rastro_ekbe
FROM residual r LEFT JOIN ekbe_num n ON n.xnz=r.fnz;
