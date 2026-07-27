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
-- Corroboración MSEG real: 505/1056 (48%) con confianza_mseg Alta/Media -- ver bloque (3) y
-- el fix de jul-2026 más abajo (subió del 2% original, que era un bug de filtro, no un techo).
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
--   [SUPERADO, ver fix de jul-2026 más abajo: ese "~21 real" resultó ser el bug, no el hallazgo].
--
-- FIX jul-2026 (Fase-1-bis-2): el filtro `MATNR IN (6 materiales de dm_material)` descartaba
-- las recepciones que SAP contabiliza por cuenta contable directa sin material (MATNR vacío,
-- SAKTO='0005010611') -- que es el patrón DOMINANTE incluso para el único proveedor que sí
-- tenía MATNR poblado (Gas Noel: 4.991 filas por cuenta vs 52 por material). Cambiado el
-- filtro de "MATNR de la lista de gas" a "LIFNR = uno de los 11 proveedores de gas ya
-- identificados" (HCARB_STG_VENDORS) -- sube tiene_recepcion_mseg de 21 (2%) a 505 (48%).
-- Confirmado que XBLNR_MKPF/BUDAT_MKPF son de cabecera (0 documentos con >1 folio o fecha
-- distintos), así que se agrega DMBTR/ERFMG por MBLNR/MJAHR antes de comparar contra la
-- factura -- de paso resuelve la simplificación de ANY_VALUE que quedaba pendiente (abajo).
-- Score con fallback numérico (mismo patrón D18 de BKPF/EKBE): SÍ aporta aquí, a diferencia
-- de lo que parecía en un primer diagnóstico -- recupera casos con prefijo de folio distinto
-- (ej. "F6144731" en MSEG vs "CFDI6144731" en la factura), confirmados con importe exacto al
-- centavo. Auditoría (ZZ_PRUEBAS.hcarb_mseg_scored_try): 0 UUIDs/documentos duplicados, 0
-- colisiones de folio por proveedor. De los 451 matches con folio pero SIN importe exacto, el
-- importe MSEG es mayor al de la factura en 99% de los casos (signo consistente, no ruido) --
-- el documento SAP suele ser una recepción consolidada de varias entregas, así que el folio
-- prueba "hubo recepción asociada" pero el importe no reconcilia el monto de ESTA factura.
-- Por eso `confianza_mseg='Alta'` exige folio Y importe exacto (54 casos); el resto con folio
-- (exacto o numérico) queda en 'Media' (451 casos) -- evidencia de recepción, no de monto.
--
-- Descartado en Fase-1-bis para CECO (no se pudo derivar, sigue siendo captura manual):
-- ACDOCA está acotado a RBUKRS='ETC' (no las sociedades del gas); 0FI_GL_14 congelado en
-- 2024; BSAK/BSIK traen KOSTL pero vacío (línea de proveedor); no existe EKKN. Es un límite
-- de INGESTA, no de modelo. La dirección física de planta SÍ existe en T001W y se expone
-- ahora como `direccion_sitio` (la "Dirección de Consumo" de la Propuesta, para el WERKS
-- resuelto ~58%).

CREATE OR REPLACE TABLE `proan-quantrue.D60_REPORTING.HCARB_GOLD_VALIDACION_SAP` AS
WITH folios AS (
  SELECT uuid, folio_key, folio_numero, fecha_timbrado, fecha, importe_gas,
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

-- (3) Corroboración MSEG real -------------------------------------------------------------
-- El extracto proan_MSEG_HIDROCARBUROS_20260714 viene pre-filtrado por un criterio
-- demasiado amplio (external_material_group LIKE '151115%' OR ERFME IN ('L','M3') --
-- mezcla diésel/insecticida/detergente, Esquema.md). El filtro que se probó primero
-- (MATNR en el catálogo de 6 materiales de gas de dm_material) también descartaba de más:
-- la mayoría de las recepciones de estos proveedores se contabilizan por cuenta contable
-- directa, sin material (MATNR vacío, SAKTO='0005010611') -- ver header del archivo. El
-- filtro correcto es por proveedor: como estos 11 proveedores son distribuidoras de gas
-- dedicadas (no venden diésel/insecticida a Proan), acotar por LIFNR ya resuelve la
-- contaminación de material sin perder las recepciones sin MATNR.
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
-- Documento = grano real de una recepción SAP. XBLNR_MKPF/BUDAT_MKPF son de cabecera
-- (confirmado: 0 documentos con más de un folio o fecha distintos entre sus líneas), así
-- que se agregan las líneas de cada MBLNR antes de comparar contra la factura.
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
-- Score por documento-candidato (mismo patrón que match_sap_numerico/sitio_numerico):
-- folio exacto=4, folio numérico-fallback=3 (rescata prefijo distinto, ej. "F"/"CFDI"),
-- importe exacto (2 decimales)=3, importe relajado (1 decimal)=1. Ventana ±120 días --
-- verificado que hacen falta: hay matches reales (folio+importe exactos) hasta 92 días
-- de diferencia entre la fecha de la factura y la fecha en que SAP registra la recepción.
mseg_scored AS (
  SELECT
    f.uuid, m.MBLNR, m.MJAHR, m.doc_importe, m.doc_cantidad,
    (
      CASE WHEN m.folio_key_mseg = f.folio_key THEN 4
           WHEN LENGTH(f.folio_numero) >= 5 AND m.folio_numero_mseg = f.folio_numero THEN 3
           ELSE 0 END
      + CASE WHEN ROUND(m.doc_importe, 2) = ROUND(f.importe_gas, 2) THEN 3
             WHEN ROUND(m.doc_importe, 1) = ROUND(f.importe_gas, 1) THEN 1
             ELSE 0 END
    ) AS score,
    (m.folio_key_mseg = f.folio_key
     OR (LENGTH(f.folio_numero) >= 5 AND m.folio_numero_mseg = f.folio_numero)) AS match_folio,
    (ROUND(m.doc_importe, 2) = ROUND(f.importe_gas, 2)) AS match_importe,
    ABS(DATE_DIFF(DATE(f.fecha), m.fecha_mseg, DAY)) AS dias_diferencia
  FROM folios f
  JOIN mseg_doc m
    ON m.proveedor_key = f.proveedor_key
    AND ABS(DATE_DIFF(DATE(f.fecha), m.fecha_mseg, DAY)) <= 120
),
-- Mejor match mutuo (un documento no puede corroborar 2 facturas ni viceversa), igual que
-- best_match en Primera-iteracion/hidrocarburos.sql. confianza_mseg='Alta' solo si folio Y
-- importe casan exacto (recepción 1:1 verificable); 'Media' si solo el folio casa -- el
-- importe de MSEG en esos casos suele ser mayor al de la factura (recepción consolidada de
-- varias entregas/facturas bajo un mismo documento), así que confirma "hubo recepción" pero
-- no sirve para reconciliar el monto de esta factura en particular.
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

-- CECO sugerido (jul-2026, D22 pendiente de revisión con negocio -- esto NO bloquea,
-- solo prellena un campo que sigue editable, mismo criterio que D29):
-- (a) Proveedores de un solo sitio real (5-6 de 11: Villa Ahumada, Natgas Querétaro,
--     Hidrogas Chihuahua, Gas San Juan, San Diego Matehuala, Super Gas de los Altos --
--     ≥95% de su importe MSEG histórico cae en un único KOSTL) -- se sugiere ESE KOSTL
--     a TODAS sus facturas, aunque esta factura en concreto no haya casado ningún
--     documento (188 facturas). Los otros proveedores (Gas Noel, Corpo Gas, Energas de
--     México) reparten entre 10-61 KOSTL distintos sin que ninguno domine -- no aplica.
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
-- (b) Para el resto: los KOSTL que trae el documento MSEG que casó esta factura en
--     concreto. Casi nunca hay uno solo dominante en documentos multi-sitio (verificado:
--     de 251 facturas con documento multi-KOSTL, ninguna combinación de tamaño supera el
--     ~60% de concentración típica) -- se listan TODOS, no se adivina uno.
ceco_por_documento AS (
  SELECT MBLNR, MJAHR,
    STRING_AGG(DISTINCT NULLIF(TRIM(KOSTL), ''), ', ' ORDER BY NULLIF(TRIM(KOSTL), '')) AS cecos_documento,
    COUNT(DISTINCT NULLIF(TRIM(KOSTL), '')) AS n_cecos_documento
  FROM mseg_dedup
  GROUP BY MBLNR, MJAHR
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
  mm.confianza_mseg,
  mm.mseg_cantidad,
  mm.mseg_valor_unitario,
  mm.mseg_importe,
  -- CECO sugerido: patrón de proveedor de un solo sitio si existe, si no los KOSTL del
  -- documento MSEG que casó (uno o varios, separados por coma). NULL si nada aplica --
  -- el campo sigue 100% editable en la UI, esto solo prellena (D22 pendiente de revisar).
  COALESCE(cpp.ceco_proveedor, cd.cecos_documento) AS ceco_sugerido,
  -- Origen de la sugerencia (jul-2026, para explicarla en la UI, no solo mostrarla):
  -- 'proveedor' = proveedor de un solo sitio (aplica a TODAS sus facturas, con o sin match);
  -- 'documento' = un único KOSTL en el documento MSEG que casó esta factura;
  -- 'documento_multiple' = el documento reparte el gasto entre varios KOSTL, hay que elegir.
  CASE
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
LEFT JOIN ceco_por_documento cd ON cd.MBLNR = mm.MBLNR AND cd.MJAHR = mm.MJAHR;
