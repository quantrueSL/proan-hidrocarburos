-- Módulo 2 (validación SAP, automático): ¿SAP registró la factura? + estado de pago + sitio.
--
-- DOS fuentes de validación (estado_sap = validada si CUALQUIERA casa). Se unen porque
-- cubren huecos distintos. IMPLEMENTADO (RE con ventana + partida+proveedor): 955/1056
-- (90,4%) validadas, sube del 85% anterior (solo RE); 600 pagadas / 4 pendientes. El
-- barrido Fase-1-bis midió un techo teórico de 990 (94%) usando RE SIN ventana, pero eso
-- reabre las colisiones de folio que la ventana corta (solo +35 facturas), así que no se
-- toca la ventana del RE. El ~9% restante no está en SAP por folio (suelo duro; sin campo
-- UUID en BKPF no se puede afinar más).
--
--  Fuente 1 -- Registro FI (bkpf, documento RE): exacto Serie+Folio=XBLNR + fecha <=90d;
--    fallback por número de folio (LTRIM(REGEXP_REPLACE(...,r'[^0-9]',''),'0')) + fecha <=15d,
--    guarda LENGTH>=5. La cabecera BKPF NO trae proveedor, así que la ventana de fecha es su
--    ÚNICA defensa anticolisión (el folio se reutiliza entre ejercicios). Ver match_sap_*.
--  Fuente 2 (nueva jul-2026) -- Partida de proveedor (BSAK compensada=pagada / BSIK abierta=
--    pendiente): folio + MISMO proveedor (LIFNR=id_proveedor de la factura). Como corrobora
--    el proveedor, es a prueba de colisiones SIN ventana de fecha (en el barrido, exigir el
--    proveedor tiró 670->604: esos 66 eran colisiones de folio con otro proveedor). Aporta
--    además el estado de pago (útil para el Módulo 4). BSAK es snapshot (2026-07-08); BSIK
--    diario (2026-07-22) -- el desfase de ~2 semanas es tolerable para un flag.
--
-- Sitio de consumo vía sap_ekbe -> pedido -> WERKS (misma lógica exacto/numérico, ~58%, D21).
-- Corroboración MSEG real (2% con recepción de gas material) como señal extra, no principal.
-- sin_match_sap NO bloquea aprobación -- flag de revisión suave (D18), se re-evalúa cada corrida.
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
-- Descartado en Fase-1-bis para CECO (no se pudo derivar, sigue siendo captura manual):
-- ACDOCA está acotado a RBUKRS='ETC' (no las sociedades del gas); 0FI_GL_14 congelado en
-- 2024; BSAK/BSIK traen KOSTL pero vacío (línea de proveedor); no existe EKKN. Es un límite
-- de INGESTA, no de modelo. La dirección física de planta SÍ existe en T001W y se expone
-- ahora como `direccion_sitio` (la "Dirección de Consumo" de la Propuesta, para el WERKS
-- resuelto ~58%).
--
-- Simplificación que queda sin resolver (menor impacto, no bloquea): mseg_match usa
-- ANY_VALUE si una factura casa con varias líneas MSEG -- no suma cantidades/importes.

CREATE OR REPLACE TABLE `proan-quantrue.D60_REPORTING.HCARB_GOLD_VALIDACION_SAP` AS
WITH folios AS (
  SELECT uuid, folio_key, folio_numero, fecha_timbrado, fecha,
         LTRIM(TRIM(id_proveedor), '0') AS proveedor_key
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
  -- Ventana de fecha también en el match exacto (jul-2026): el folio Serie+Folio se
  -- reutiliza entre ejercicios, así que sin ventana una colisión de folio años atrás
  -- casaba (se vieron 2 casos, uno a 1071 días) y además TAPABA el match numérico bueno
  -- (el numérico solo corre si no hubo exacto). 90 días: más holgado que los 15 del
  -- numérico porque el folio completo es evidencia fuerte, pero corta las colisiones
  -- (los 845 exactos legítimos están <=15 días; hueco limpio hasta los >365 de las 2).
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
-- BSAK = compensada (pagada) / BSIK = abierta (pendiente). Distinguimos pago por la tabla
-- de origen, no por AUGDT. fecha_pago = AUGDT (fecha de compensación) solo tiene sentido en
-- BSAK. Recupera facturas que existen en SAP como partida de proveedor pero cuyo documento
-- no casó como 'RE', y añade el estado de pago.
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
  -- Preferir 'pagada' (BSAK) sobre 'pendiente' (BSIK) si aparece en ambas.
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
  -- Misma ventana de 90 días que match_sap_exacto: el sitio también se derivaba por
  -- folio_key exacto sin acotar fecha, con el mismo riesgo de colisión de folio reutilizado.
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
),

-- (4) Dirección física de la planta (Fase-1-bis): T001W tiene la dirección postal por WERKS
-- (STRAS calle, ORT01 ciudad, REGIO región). Es la "Dirección de Consumo" de la Propuesta que
-- Fase 1 dio por inexistente. Solo para el WERKS resuelto (~58%); ORT01/PSTLZ suelen venir
-- vacías, así que se concatenan solo las partes no vacías.
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
  -- Evidencia del registro FI (RE); NULL si solo validó por partida de proveedor.
  s.tipo_match AS tipo_match_sap,
  s.belnr AS belnr_sap,
  s.fecha_sap AS fecha_registro_sap,
  s.dias_diferencia,
  -- Estado de pago (partida de proveedor); NULL si no aparece en BSAK/BSIK.
  p.estado_pago AS estado_pago_sap,
  p.belnr AS belnr_pago_sap,
  p.fecha_pago AS fecha_pago_sap,
  -- Sitio de consumo (vía pedido).
  st.werks,
  ce.descripcion_centro AS sitio_consumo,
  td.direccion_sitio,
  st.tipo_match_sitio,
  -- Corroboración MSEG.
  (mm.uuid IS NOT NULL) AS tiene_recepcion_mseg,
  mm.mseg_cantidad,
  mm.mseg_valor_unitario,
  mm.mseg_importe
FROM folios f
LEFT JOIN sap_match s ON f.uuid = s.uuid
LEFT JOIN match_proveedor p ON f.uuid = p.uuid
LEFT JOIN sitio_match st ON f.uuid = st.uuid
LEFT JOIN `proan-quantrue.D20_DIMENSION.dm_centros` ce ON st.werks = ce.id_centro
LEFT JOIN sitio_direccion td ON st.werks = td.werks
LEFT JOIN mseg_match mm ON f.uuid = mm.uuid;
