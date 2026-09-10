-- Alta idempotente de facturas nuevas en la cola de Compras (Módulo 3).
--
-- Se ejecuta como tarea diaria de Airflow después de
-- HCARB_gold_clasificacion.sql. El backend solo consulta la cola y registra
-- decisiones humanas.
--
-- Solo inserta UUID que todavía no existen en HCARB_gold_aprobacion. No hay
-- UPDATE ni DELETE, así que no altera estados ni datos de decisiones humanas.

MERGE `proan-quantrue.D60_REPORTING.HCARB_gold_aprobacion` AS aprobacion
USING (
  SELECT DISTINCT uuid
  FROM `proan-quantrue.D60_REPORTING.HCARB_GOLD_CLASIFICACION_FOLIO`
  WHERE uuid IS NOT NULL
) AS clasificacion
ON clasificacion.uuid = aprobacion.uuid
WHEN NOT MATCHED THEN
  INSERT (uuid, estado)
  VALUES (clasificacion.uuid, 'pendiente_validacion_compras');
