-- Calidad de datos (hallazgo de análisis paralelo, jul-2026): el extracto MSEG
-- proan_MSEG_HIDROCARBUROS_20260714 trae filas EXACTAMENTE duplicadas (un lote del histórico
-- cargado dos veces). Verificado: 176,465 de 518,055 filas son duplicados por (MBLNR,MJAHR,ZEILE)
-- -- el 34% de la tabla. Afecta también a los documentos de gas (592 líneas -> 338 distintas).
-- Consecuencia: cualquier SUM(DMBTR)/COUNT(*) sin deduplicar infla ~1.5x. Regla Fase 2:
-- deduplicar por (MBLNR, MJAHR, ZEILE) antes de sumar.
-- (Nota: nuestras coberturas y conteos de documentos usan COUNT(DISTINCT MBLNR)/DISTINCT UUID,
--  así que NO cambian; solo los importes del lado SAP -p.ej. el "$4.56M" de hallazgos §2- pueden
--  estar inflados.)
SELECT
  COUNT(*) AS total_lineas,
  COUNT(DISTINCT FORMAT('%s|%s|%s', MBLNR, CAST(MJAHR AS STRING), CAST(ZEILE AS STRING))) AS lineas_distintas,
  COUNT(*) - COUNT(DISTINCT FORMAT('%s|%s|%s', MBLNR, CAST(MJAHR AS STRING), CAST(ZEILE AS STRING))) AS filas_duplicadas
FROM `proan-quantrue.D00_SANDBOX.proan_MSEG_HIDROCARBUROS_20260714`;

-- Variante restringida a documentos de gas (comprobar que también les afecta):
-- WITH gas AS (
--   SELECT DISTINCT m.MBLNR FROM `proan-quantrue.D00_SANDBOX.proan_MSEG_HIDROCARBUROS_20260714` m
--   JOIN `proan-quantrue.D20_DIMENSION.dm_material` d ON m.MATNR = d.material_number
--   WHERE d.external_material_group LIKE '151115%')
-- SELECT COUNT(*) AS lineas_gas,
--   COUNT(DISTINCT FORMAT('%s|%s|%s', e.MBLNR, CAST(e.MJAHR AS STRING), CAST(e.ZEILE AS STRING))) AS distintas
-- FROM `proan-quantrue.D00_SANDBOX.proan_MSEG_HIDROCARBUROS_20260714` e JOIN gas USING (MBLNR);
