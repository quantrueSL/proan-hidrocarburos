-- Módulo 2 (validación SAP, automático): ¿SAP FI registró la factura? + sitio de consumo.
-- Matcher (Fase 1 §22/§23, D18/D20): exacto Serie+Folio=XBLNR primero; si no hay match,
-- fallback por número de folio (LTRIM(REGEXP_REPLACE(...,r'[^0-9]',''),'0')) + fecha <=15d,
-- con guarda LENGTH>=5 para no colisionar con folios cortos. Mismo criterio aplicado a
-- bkpf_account_document_header (registro FI) y a sap_ekbe (sitio vía pedido) -- son
-- coberturas distintas (87%->recuperado vs 52%->58%, D21), no el mismo fenómeno.
-- sin_match_sap NO bloquea aprobación -- es flag de revisión suave (D18), se re-evalúa en
-- cada corrida del DAG.
-- Incluye el 2% con recepción MSEG real (material de gas) como corroboración extra, no
-- como fuente principal.
--
-- EJECUTADO jul-2026. Bugs reales encontrados y corregidos al ejecutar (ninguno se veía
-- en la revisión estática):
-- - BELNR real es BELNR_account_document_number (Esquema.md usaba el nombre corto).
-- - bkpf_re SÍ filtra ahora documentos reversados (STBLG_reverse_document_number).
-- - cfdis.Fecha es TIMESTAMP, BLDAT_document_dt es DATE -- DATE_DIFF necesita castear
--   DATE(f.fecha) antes de comparar.
-- - sitio_numerico NO tenía ventana de fecha (a diferencia de match_sap_numerico) --
--   inflaba sitio_consumo a 752/1051 (72%) en vez de los ~613 (58%) esperados por Fase 1
--   §23, porque el número de folio podía casar con CUALQUIER EKBE de la empresa sin
--   restricción temporal. Añadido fecha_ekbe (BUDAT) + <=15d, igual que BKPF; desempate de
--   ambos tramos (exacto/numérico) ahora por proximidad de fecha, no por WERKS alfabético.
-- - mseg_dedup no filtraba por material de gas: el extracto ya viene "demasiado amplio"
--   (Esquema.md lo advertía), así que sin el filtro de dm_material coincidían recepciones
--   de diésel/insecticida/detergente que comparten folio con la factura de gas (inflaba
--   tiene_recepcion_mseg a 505/1051 en vez de ~21). Añadido el filtro de queries/102-103.
--
-- Simplificación que queda sin resolver (menor impacto, no bloquea): mseg_match usa
-- ANY_VALUE si una factura casa con varias líneas MSEG -- no suma cantidades/importes
-- entre líneas.

CREATE OR REPLACE TABLE `proan-quantrue.D60_REPORTING.HCARB_GOLD_VALIDACION_SAP` AS
WITH folios AS (
  SELECT uuid, folio_key, folio_numero, fecha_timbrado, fecha
  FROM `proan-quantrue.D60_REPORTING.HCARB_GOLD_CLASIFICACION_FOLIO`
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
  JOIN bkpf_re b ON f.folio_key = b.xblnr_key
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
  JOIN ekbe_po e ON f.folio_key = e.xblnr_key
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

-- (3) Corroboración MSEG real (2% con recepción de gas) ---------------------------------
-- El extracto proan_MSEG_HIDROCARBUROS_20260714 viene pre-filtrado por un criterio
-- demasiado amplio (external_material_group LIKE '151115%' OR ERFME IN ('L','M3') --
-- mezcla diésel/insecticida/detergente, Esquema.md). Hay que acotar de verdad por los
-- materiales de gas reales (dm_material.external_material_group LIKE '151115%',
-- Fase 1 queries/102-103), si no cualquier receta liquida con el mismo folio cuela.
gas_material AS (
  SELECT material_number
  FROM `proan-quantrue.D20_DIMENSION.dm_material`
  WHERE external_material_group LIKE '151115%'
),
mseg_dedup AS (
  SELECT * EXCEPT(rn)
  FROM (
    SELECT *, ROW_NUMBER() OVER (PARTITION BY MBLNR, MJAHR, ZEILE ORDER BY MBLNR) AS rn
    FROM `proan-quantrue.D00_SANDBOX.proan_MSEG_HIDROCARBUROS_20260714`
    WHERE BWART != '102'
  )
  WHERE rn = 1
    AND MATNR IN (SELECT material_number FROM gas_material)
),
mseg_match AS (
  SELECT
    f.uuid,
    ANY_VALUE(m.DMBTR) AS mseg_importe,
    ANY_VALUE(m.ERFMG) AS mseg_cantidad,
    SAFE_DIVIDE(ANY_VALUE(m.DMBTR), ANY_VALUE(m.ERFMG)) AS mseg_valor_unitario
  FROM folios f
  JOIN mseg_dedup m ON UPPER(REPLACE(TRIM(m.XBLNR_MKPF), ' ', '')) = f.folio_key
  GROUP BY f.uuid
)

SELECT
  f.uuid,
  IF(s.uuid IS NOT NULL, 'validada_sap', 'sin_match_sap') AS estado_sap,
  s.tipo_match AS tipo_match_sap,
  s.belnr AS belnr_sap,
  s.fecha_sap AS fecha_registro_sap,
  s.dias_diferencia,
  st.werks,
  ce.descripcion_centro AS sitio_consumo,
  st.tipo_match_sitio,
  (mm.uuid IS NOT NULL) AS tiene_recepcion_mseg,
  mm.mseg_cantidad,
  mm.mseg_valor_unitario,
  mm.mseg_importe
FROM folios f
LEFT JOIN sap_match s ON f.uuid = s.uuid
LEFT JOIN sitio_match st ON f.uuid = st.uuid
LEFT JOIN `proan-quantrue.D20_DIMENSION.dm_centros` ce ON st.werks = ce.id_centro
LEFT JOIN mseg_match mm ON f.uuid = mm.uuid;
