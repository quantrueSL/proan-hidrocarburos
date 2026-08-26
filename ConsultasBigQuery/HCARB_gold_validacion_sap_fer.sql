-- Variante de prueba de HCARB_gold_validacion_sap.sql (rama Fer, ago-2026): idéntica lógica
-- (incluido el desglose por ticket de entrega), pero lee HCARB_GOLD_CLASIFICACION_FOLIO_fer
-- (la tabla de prueba de M1) y escribe en HCARB_GOLD_VALIDACION_SAP_fer, sin tocar las tablas
-- reales que lee producción. Backend local apunta aquí vía HCARB_SAP_TABLE en
-- config/financialbi.env. Borrar este archivo y la tabla `_fer` cuando el cambio se confirme
-- y se aplique a las tablas reales.
CREATE OR REPLACE TABLE `proan-quantrue.D60_REPORTING.HCARB_GOLD_VALIDACION_SAP_fer` AS
WITH folios AS (
  SELECT uuid, folio_key, folio_numero, fecha_timbrado, fecha, importe_gas,
         LTRIM(TRIM(id_proveedor), '0') AS proveedor_key
  FROM `proan-quantrue.D60_REPORTING.HCARB_GOLD_CLASIFICACION_FOLIO_fer`
),

-- (1) Registro en SAP FI (bkpf, documento RE) --------------------------------------------
bkpf_re AS (
  SELECT
    UPPER(REPLACE(TRIM(XBLNR_reference_document_number), ' ', '')) AS xblnr_key,
    LTRIM(REGEXP_REPLACE(TRIM(XBLNR_reference_document_number), r'[^0-9]', ''), '0') AS xblnr_numero,
    BELNR_account_document_number AS belnr,
    BLDAT_document_dt AS fecha_sap
  FROM `proan-quantrue.D30_INTEGRATION.bkpf_account_document_header`
  WHERE BLART_document_type = 'RE'
    AND XBLNR_reference_document_number IS NOT NULL
    AND (STBLG_reverse_document_number IS NULL OR STBLG_reverse_document_number = '')
),
match_sap_exacto AS (
  SELECT f.uuid, b.belnr, b.fecha_sap, 'exacto' AS tipo_match,
    ABS(DATE_DIFF(DATE(f.fecha), b.fecha_sap, DAY)) AS dias_diferencia
  FROM folios f
  JOIN bkpf_re b
    ON f.folio_key = b.xblnr_key
    AND ABS(DATE_DIFF(DATE(f.fecha), b.fecha_sap, DAY)) <= 90
  QUALIFY ROW_NUMBER() OVER (PARTITION BY f.uuid ORDER BY dias_diferencia) = 1
),
match_sap_numerico AS (
  SELECT f.uuid, b.belnr, b.fecha_sap, 'numerico' AS tipo_match,
    ABS(DATE_DIFF(DATE(f.fecha), b.fecha_sap, DAY)) AS dias_diferencia
  FROM folios f
  LEFT JOIN match_sap_exacto me ON f.uuid = me.uuid
  JOIN bkpf_re b
    ON f.folio_numero = b.xblnr_numero
    AND LENGTH(f.folio_numero) >= 5
    AND ABS(DATE_DIFF(DATE(f.fecha), b.fecha_sap, DAY)) <= 15
  WHERE me.uuid IS NULL
  QUALIFY ROW_NUMBER() OVER (PARTITION BY f.uuid ORDER BY dias_diferencia) = 1
),
sap_match AS (
  SELECT * FROM match_sap_exacto
  UNION ALL
  SELECT * FROM match_sap_numerico
),

-- (1b) Partida de proveedor: folio + MISMO proveedor (colisión-proof, sin ventana) -------
partidas_proveedor AS (
  SELECT
    UPPER(REPLACE(TRIM(XBLNR), ' ', '')) AS xblnr_key,
    LTRIM(REGEXP_REPLACE(TRIM(XBLNR), r'[^0-9]', ''), '0') AS xblnr_numero,
    LTRIM(TRIM(LIFNR), '0') AS proveedor_key,
    BELNR AS belnr, BLDAT AS fecha_sap, AUGDT AS fecha_pago, 'pagada' AS estado_pago
  FROM `proan-quantrue.D00_SANDBOX.proan_BSAK_20260708`
  WHERE XBLNR IS NOT NULL AND LIFNR IS NOT NULL
  UNION ALL
  SELECT
    UPPER(REPLACE(TRIM(XBLNR), ' ', '')),
    LTRIM(REGEXP_REPLACE(TRIM(XBLNR), r'[^0-9]', ''), '0'),
    LTRIM(TRIM(LIFNR), '0'),
    BELNR, BLDAT, CAST(NULL AS STRING), 'pendiente'
  FROM `proan-quantrue.D00_SANDBOX.proan_BSIK_20260722`
  WHERE XBLNR IS NOT NULL AND LIFNR IS NOT NULL
),
match_proveedor AS (
  SELECT f.uuid, b.belnr, b.fecha_sap, b.fecha_pago, b.estado_pago
  FROM folios f
  JOIN partidas_proveedor b
    ON ((b.xblnr_key = f.folio_key) OR (LENGTH(f.folio_numero) >= 5 AND b.xblnr_numero = f.folio_numero))
    AND b.proveedor_key = f.proveedor_key
  WHERE f.proveedor_key IS NOT NULL AND f.proveedor_key != ''
  QUALIFY ROW_NUMBER() OVER (PARTITION BY f.uuid ORDER BY IF(b.estado_pago = 'pagada', 0, 1), b.belnr) = 1
),

-- (2) Sitio de consumo vía EKBE -> pedido -> WERKS --------------------------------------
ekbe_po AS (
  SELECT
    UPPER(REPLACE(TRIM(e.XBLNR), ' ', '')) AS xblnr_key,
    LTRIM(REGEXP_REPLACE(TRIM(e.XBLNR), r'[^0-9]', ''), '0') AS xblnr_numero,
    po.WERKS_Centro AS werks,
    e.BUDAT AS fecha_ekbe
  FROM `proan-quantrue.D30_INTEGRATION.sap_ekbe` e
  JOIN `proan-quantrue.D30_INTEGRATION.sap_purchasing_orders` po ON e.EBELN = po.EBELN_OrdenCompra
  WHERE e.XBLNR IS NOT NULL AND po.WERKS_Centro IS NOT NULL
),
sitio_exacto AS (
  SELECT f.uuid, e.werks, 'exacto' AS tipo_match_sitio
  FROM folios f
  JOIN ekbe_po e
    ON f.folio_key = e.xblnr_key
    AND ABS(DATE_DIFF(DATE(f.fecha), e.fecha_ekbe, DAY)) <= 90
  QUALIFY ROW_NUMBER() OVER (PARTITION BY f.uuid ORDER BY ABS(DATE_DIFF(DATE(f.fecha), e.fecha_ekbe, DAY))) = 1
),
sitio_numerico AS (
  SELECT f.uuid, e.werks, 'numerico' AS tipo_match_sitio
  FROM folios f
  LEFT JOIN sitio_exacto se ON f.uuid = se.uuid
  JOIN ekbe_po e
    ON f.folio_numero = e.xblnr_numero
    AND LENGTH(f.folio_numero) >= 5
    AND ABS(DATE_DIFF(DATE(f.fecha), e.fecha_ekbe, DAY)) <= 15
  WHERE se.uuid IS NULL
  QUALIFY ROW_NUMBER() OVER (PARTITION BY f.uuid ORDER BY ABS(DATE_DIFF(DATE(f.fecha), e.fecha_ekbe, DAY))) = 1
),
sitio_match AS (
  SELECT * FROM sitio_exacto
  UNION ALL
  SELECT * FROM sitio_numerico
),

-- (3) Corroboración MSEG real -------------------------------------------------------------
gas_vendor_keys AS (
  SELECT DISTINCT proveedor_key FROM folios
),
mseg_dedup AS (
  SELECT * EXCEPT(rn)
  FROM (
    SELECT *, ROW_NUMBER() OVER (PARTITION BY MBLNR, MJAHR, ZEILE ORDER BY MBLNR) AS rn
    FROM `proan-quantrue.D00_SANDBOX.proan_MSEG_HIDROCARBUROS_20260714`
    WHERE BWART != '102'
  )
  WHERE rn = 1
    AND LTRIM(TRIM(LIFNR), '0') IN (SELECT proveedor_key FROM gas_vendor_keys)
),
mseg_doc AS (
  SELECT
    MBLNR, MJAHR,
    ANY_VALUE(LTRIM(TRIM(LIFNR), '0')) AS proveedor_key,
    ANY_VALUE(UPPER(REPLACE(TRIM(XBLNR_MKPF), ' ', ''))) AS folio_key_mseg,
    ANY_VALUE(LTRIM(REGEXP_REPLACE(TRIM(XBLNR_MKPF), r'[^0-9]', ''), '0')) AS folio_numero_mseg,
    ANY_VALUE(SAFE.PARSE_DATE('%Y%m%d', CAST(BUDAT_MKPF AS STRING))) AS fecha_mseg,
    SUM(DMBTR) AS doc_importe,
    SUM(ERFMG) AS doc_cantidad
  FROM mseg_dedup
  GROUP BY MBLNR, MJAHR
),
mseg_scored AS (
  SELECT
    f.uuid, m.MBLNR, m.MJAHR, m.doc_importe, m.doc_cantidad,
    (
      CASE WHEN m.folio_key_mseg = f.folio_key THEN 4
           WHEN LENGTH(f.folio_numero) >= 5 AND m.folio_numero_mseg = f.folio_numero THEN 3
           ELSE 0 END
      + CASE WHEN ABS(m.doc_importe - f.importe_gas) <= GREATEST(0.2, 0.0003 * f.importe_gas) THEN 3
             WHEN ROUND(m.doc_importe, 1) = ROUND(f.importe_gas, 1) THEN 1
             ELSE 0 END
    ) AS score,
    (m.folio_key_mseg = f.folio_key
     OR (LENGTH(f.folio_numero) >= 5 AND m.folio_numero_mseg = f.folio_numero)) AS match_folio,
    (ABS(m.doc_importe - f.importe_gas) <= GREATEST(0.2, 0.0003 * f.importe_gas)) AS match_importe,
    ABS(DATE_DIFF(DATE(f.fecha), m.fecha_mseg, DAY)) AS dias_diferencia
  FROM folios f
  JOIN mseg_doc m
    ON m.proveedor_key = f.proveedor_key
    AND ABS(DATE_DIFF(DATE(f.fecha), m.fecha_mseg, DAY)) <= 120
),
mseg_match AS (
  SELECT
    uuid, MBLNR, MJAHR,
    doc_importe AS mseg_importe,
    doc_cantidad AS mseg_cantidad,
    SAFE_DIVIDE(doc_importe, doc_cantidad) AS mseg_valor_unitario,
    IF(match_folio AND match_importe, 'Alta', 'Media') AS confianza_mseg
  FROM (
    SELECT *,
      ROW_NUMBER() OVER (PARTITION BY MBLNR ORDER BY score DESC, dias_diferencia ASC) AS rn_mseg,
      ROW_NUMBER() OVER (PARTITION BY uuid ORDER BY score DESC, dias_diferencia ASC) AS rn_cfdi
    FROM mseg_scored
    WHERE score >= 2
  )
  WHERE rn_mseg = 1 AND rn_cfdi = 1
),

ceco_por_proveedor AS (
  SELECT proveedor_key, kostl AS ceco_proveedor
  FROM (
    SELECT proveedor_key, kostl,
      SAFE_DIVIDE(importe, SUM(importe) OVER (PARTITION BY proveedor_key)) AS concentracion,
      ROW_NUMBER() OVER (PARTITION BY proveedor_key ORDER BY importe DESC) AS rn
    FROM (
      SELECT LTRIM(TRIM(LIFNR), '0') AS proveedor_key, NULLIF(TRIM(KOSTL), '') AS kostl, SUM(DMBTR) AS importe
      FROM mseg_dedup
      GROUP BY proveedor_key, kostl
    )
    WHERE kostl IS NOT NULL
  )
  WHERE rn = 1 AND concentracion >= 0.95
),
ceco_por_documento AS (
  SELECT MBLNR, MJAHR,
    STRING_AGG(DISTINCT NULLIF(TRIM(KOSTL), ''), ', ' ORDER BY NULLIF(TRIM(KOSTL), '')) AS cecos_documento,
    COUNT(DISTINCT NULLIF(TRIM(KOSTL), '')) AS n_cecos_documento
  FROM mseg_dedup
  GROUP BY MBLNR, MJAHR
),

-- (4) Dirección física de la planta -------------------------------------------------------
sitio_direccion AS (
  SELECT werks,
    NULLIF(ARRAY_TO_STRING(
      ARRAY(SELECT p FROM UNNEST([calle, ciudad, region]) p WHERE p IS NOT NULL AND TRIM(p) != ''),
      ', '), '') AS direccion_sitio
  FROM (
    SELECT WERKS AS werks,
      ANY_VALUE(STRAS) AS calle, ANY_VALUE(ORT01) AS ciudad, ANY_VALUE(REGIO) AS region
    FROM `proan-quantrue.D00_SANDBOX.proan_T001W_*`
    GROUP BY WERKS
  )
),

-- (5) Desglose por ticket de entrega (ago-2026) -------------------------------------------
tickets_cfdi AS (
  SELECT c.UUID AS uuid, c.NoIdentificacion AS ticket,
    SUM(c.Cantidad) AS cantidad_ticket, ROUND(SUM(c.Importe), 2) AS importe_ticket
  FROM `proan-quantrue.D30_INTEGRATION.cfdi_completo` c
  WHERE c.UUID IN (SELECT uuid FROM mseg_match)
    AND (c.ClaveProdServ LIKE '151115%' OR c.ClaveProdServ IN ('83101600', '83101601'))
  GROUP BY c.UUID, c.NoIdentificacion
),
zeile_mseg AS (
  SELECT mm.uuid, m.ZEILE, NULLIF(TRIM(m.KOSTL), '') AS kostl,
    m.ERFMG AS cantidad_zeile, ROUND(m.DMBTR, 2) AS importe_zeile
  FROM mseg_match mm
  JOIN mseg_dedup m ON m.MBLNR = mm.MBLNR AND m.MJAHR = mm.MJAHR
),
tickets_match AS (
  SELECT t.uuid, t.ticket, t.cantidad_ticket, t.importe_ticket,
    z.kostl AS ceco, z.cantidad_zeile, z.importe_zeile
  FROM tickets_cfdi t
  LEFT JOIN zeile_mseg z
    ON z.uuid = t.uuid
    AND ABS(z.importe_zeile - t.importe_ticket) <= GREATEST(0.2, 0.0003 * t.importe_ticket)
  QUALIFY ROW_NUMBER() OVER (
    PARTITION BY t.uuid, t.ticket ORDER BY ABS(z.importe_zeile - t.importe_ticket), z.ZEILE
  ) = 1
),
tickets_agg AS (
  SELECT uuid,
    COUNT(*) AS n_tickets,
    COUNTIF(ceco IS NOT NULL) AS n_tickets_match,
    STRING_AGG(DISTINCT ceco, ', ' ORDER BY ceco) AS cecos_tickets,
    ARRAY_AGG(
      STRUCT(
        ticket, cantidad_ticket, importe_ticket,
        ceco, cantidad_zeile, importe_zeile,
        (ceco IS NOT NULL) AS match_exacto
      )
      ORDER BY importe_ticket DESC
    ) AS tickets_mseg
  FROM tickets_match
  GROUP BY uuid
)

SELECT
  f.uuid,
  IF(s.uuid IS NOT NULL OR p.uuid IS NOT NULL, 'validada_sap', 'sin_match_sap') AS estado_sap,
  CASE
    WHEN s.uuid IS NOT NULL AND p.uuid IS NOT NULL THEN 'RE+partida'
    WHEN s.uuid IS NOT NULL THEN 'RE'
    WHEN p.uuid IS NOT NULL THEN 'partida_proveedor'
    ELSE NULL
  END AS fuente_sap,
  s.tipo_match AS tipo_match_sap,
  s.belnr AS belnr_sap,
  s.fecha_sap AS fecha_registro_sap,
  s.dias_diferencia,
  p.estado_pago AS estado_pago_sap,
  p.belnr AS belnr_pago_sap,
  p.fecha_pago AS fecha_pago_sap,
  st.werks,
  ce.descripcion_centro AS sitio_consumo,
  td.direccion_sitio,
  st.tipo_match_sitio,
  CASE
    WHEN ta.n_tickets >= 1 AND ta.n_tickets_match = ta.n_tickets THEN 'Alta'
    ELSE mm.confianza_mseg
  END AS confianza_mseg,
  mm.mseg_cantidad,
  mm.mseg_valor_unitario,
  mm.mseg_importe,
  ta.tickets_mseg,
  ta.n_tickets AS mseg_n_tickets,
  ta.n_tickets_match AS mseg_n_tickets_match,
  COALESCE(
    IF(ta.n_tickets > 1 AND ta.n_tickets_match = ta.n_tickets, ta.cecos_tickets, NULL),
    cpp.ceco_proveedor,
    cd.cecos_documento
  ) AS ceco_sugerido,
  CASE
    WHEN ta.n_tickets > 1 AND ta.n_tickets_match = ta.n_tickets THEN 'ticket'
    WHEN cpp.ceco_proveedor IS NOT NULL THEN 'proveedor'
    WHEN cd.n_cecos_documento = 1 THEN 'documento'
    WHEN cd.n_cecos_documento > 1 THEN 'documento_multiple'
    ELSE NULL
  END AS ceco_sugerido_origen
FROM folios f
LEFT JOIN sap_match s ON f.uuid = s.uuid
LEFT JOIN match_proveedor p ON f.uuid = p.uuid
LEFT JOIN sitio_match st ON f.uuid = st.uuid
LEFT JOIN `proan-quantrue.D20_DIMENSION.dm_centros` ce ON st.werks = ce.id_centro
LEFT JOIN sitio_direccion td ON st.werks = td.werks
LEFT JOIN mseg_match mm ON f.uuid = mm.uuid
LEFT JOIN ceco_por_proveedor cpp ON cpp.proveedor_key = f.proveedor_key
LEFT JOIN ceco_por_documento cd ON cd.MBLNR = mm.MBLNR AND cd.MJAHR = mm.MJAHR
LEFT JOIN tickets_agg ta ON ta.uuid = f.uuid;
