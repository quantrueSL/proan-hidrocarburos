-- Spike Módulo 2 (jul-2026): ¿está blindado el match con BKPF, se puede derivar el SITIO de
-- consumo, y existe el CECO en alguna tabla? Resultados:
--   (1) BLINDAJE BKPF: 845 de 847 facturas con documento RE lo tienen a <=7 días de la fecha del
--       CFDI (solo 2 a >30d) -> el match por folio (87%) NO es colisión. "Factura registrada" = sólido.
--   (2) SITIO (WERKS): derivable para ~52% (547 folios) vía folio -> sap_ekbe.XBLNR -> EBELN ->
--       sap_purchasing_orders.WERKS_Centro. 544 de 547 = "PAN Planta San Juan 1". La dirección
--       postal/geográfica NO existe (solo el nombre de sede en dm_centros).
--   (3) CECO (KOSTL): NO está en sap_purchasing_orders (imputación en EKKN, ausente); las tablas
--       con KOSTL están vacías para gas o son de ventas -> el CECO sigue siendo manual (D9).

-- (1) Blindaje por proximidad de fecha:
WITH gas AS (
  SELECT UPPER(REPLACE(CONCAT(IFNULL(Serie,''),CAST(Folio AS STRING)),' ','')) AS folio_key, ANY_VALUE(DATE(Fecha)) AS fecha_cfdi
  FROM `proan-quantrue.D00_SANDBOX.cfdis`
  WHERE ReceptorRfc='PAN921013AK7' AND (ClaveProdServ LIKE '151115%' OR ClaveProdServ IN ('83101600','83101601'))
  GROUP BY folio_key
),
re AS (SELECT UPPER(REPLACE(TRIM(XBLNR_reference_document_number),' ','')) AS folio_key, BLDAT_document_dt AS fecha_sap
       FROM `proan-quantrue.D30_INTEGRATION.bkpf_account_document_header` WHERE BLART_document_type='RE' AND XBLNR_reference_document_number IS NOT NULL),
j AS (SELECT g.folio_key, MIN(ABS(DATE_DIFF(g.fecha_cfdi, r.fecha_sap, DAY))) AS min_dias
      FROM gas g JOIN re r ON g.folio_key=r.folio_key GROUP BY g.folio_key)
SELECT COUNT(*) AS folios_con_RE, COUNTIF(min_dias<=7) AS dentro_7d, COUNTIF(min_dias>30) AS mas_30d FROM j;

-- (2) Sitio de consumo por factura (folio -> EKBE -> pedido -> WERKS -> nombre de sede):
-- WITH gas AS (... mismo ...),
--   ekbe AS (SELECT DISTINCT UPPER(REPLACE(TRIM(XBLNR),' ','')) folio_key, EBELN FROM `proan-quantrue.D30_INTEGRATION.sap_ekbe` WHERE XBLNR IS NOT NULL),
--   po AS (SELECT DISTINCT EBELN_OrdenCompra EBELN, WERKS_Centro werks FROM `proan-quantrue.D30_INTEGRATION.sap_purchasing_orders` WHERE WERKS_Centro IS NOT NULL)
-- SELECT COALESCE(c.descripcion_centro, po.werks) sitio, COUNT(DISTINCT g.folio_key) n_facturas
-- FROM gas g JOIN ekbe e ON g.folio_key=e.folio_key JOIN po ON e.EBELN=po.EBELN
-- LEFT JOIN `proan-quantrue.D20_DIMENSION.dm_centros` c ON po.werks=c.id_centro
-- GROUP BY sitio ORDER BY n_facturas DESC;

-- (3) Búsqueda de KOSTL (CECO) en D30 -> solo en tablas vacías para gas o de ventas:
-- SELECT table_name, column_name FROM `proan-quantrue.D30_INTEGRATION.INFORMATION_SCHEMA.COLUMNS`
-- WHERE REGEXP_CONTAINS(UPPER(column_name), r'KOSTL|KNTTP|EKKN|ACCT');
