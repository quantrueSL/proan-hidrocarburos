-- HCARB_gold_aprobacion (D60_REPORTING) -- SOLO ESQUEMA DE REFERENCIA.
--
-- A diferencia de los demás .sql de esta carpeta, esta query NO se ejecuta
-- para (re)construir la tabla entera. HCARB_gold_aprobacion es una tabla
-- MUTABLE propiedad del backend (apps/financialbi/financialbi/aprobacion_engine.py):
-- el DDL de abajo lo ejecuta el propio backend de forma idempotente al
-- arrancar (`ensure_schema()`, ver app.py `@app.on_event("startup")`), y las
-- filas se insertan/actualizan una a una según las acciones de Compras y
-- Gerencia en la interfaz -- no hay ningún SELECT que la repueble desde cero.
--
-- Se deja aquí como referencia versionada (antes solo vivía como docstring en
-- Python) para que el esquema no dependa de leer código para conocerlo.
-- Diagrama de la máquina de estados: flujo-aprobacion.png (fuente flujo-aprobacion.mmd).
-- Detalle narrativo también en Datos/PHASE2/Esquema.md §4 (no versionado en git).

CREATE TABLE IF NOT EXISTS `proan-quantrue.D60_REPORTING.HCARB_gold_aprobacion` (
  uuid STRING NOT NULL,
  -- valores válidos: pendiente_validacion_compras | pendiente_aprobacion_gerencia
  -- | aprobada | rechazada (BigQuery no soporta CHECK de valor -- se valida
  -- en el backend, no en la tabla).
  estado STRING NOT NULL,
  ceco STRING,
  werks_manual STRING,
  usuario_compras STRING,
  fecha_validacion_compras TIMESTAMP,
  comentario_compras STRING,
  usuario_gerencia STRING,
  fecha_aprobacion_gerencia TIMESTAMP,
  comentario_gerencia STRING,
  rechazada_por_rol STRING,
  motivo_rechazo STRING,
  -- Reversibilidad: quién reabrió la última vez y por qué (no histórico
  -- completo -- una tabla de auditoría aparte sería más de lo que hace falta
  -- ahora mismo). Añadidas después con ALTER TABLE ... ADD COLUMN IF NOT EXISTS,
  -- por eso van separadas del CREATE TABLE original en el código fuente.
  reabierta_por STRING,
  fecha_reapertura TIMESTAMP,
  motivo_reapertura STRING
);

-- Quién escribe cada transición (todo en aprobacion_engine.py):
--
--   sync_pendientes()   (sin fila) -> pendiente_validacion_compras
--                        INSERT anti-join contra HCARB_GOLD_CLASIFICACION_FOLIO;
--                        se llama en cada carga de la cola de Compras, idempotente.
--   capturar_compras()  pendiente_validacion_compras -> pendiente_aprobacion_gerencia
--                        Compras captura CECO (siempre manual) y opcionalmente el
--                        sitio (solo si M2 no lo dedujo). También acepta como
--                        origen pendiente_aprobacion_gerencia (reversibilidad:
--                        permite corregir CECO/sitio mientras Gerencia no haya
--                        decidido, sin pasar por reabrir()).
--   aprobar_gerencia()  pendiente_aprobacion_gerencia -> aprobada
--   rechazar()          pendiente_validacion_compras -> rechazada   (rol=compras)
--                        pendiente_aprobacion_gerencia -> rechazada  (rol=gerencia)
--   reabrir()           pendiente_aprobacion_gerencia | aprobada | rechazada
--                        -> pendiente_validacion_compras
--                        Borra CECO/sitio/comentarios/quién decidió y deja
--                        registro de quién reabrió y por qué. Sin control de rol
--                        (D27 pendiente): cualquiera puede reabrir cualquier factura.
--
-- Sin auth real (D27): "usuario" es texto libre que captura el propio
-- frontend, no viene de un login con roles verificados.
