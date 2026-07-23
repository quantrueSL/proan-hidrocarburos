-- HCARB_ESTATUS_SAT (D60_REPORTING) -- SOLO ESQUEMA DE REFERENCIA.
--
-- Igual que HCARB_gold_aprobacion_schema.sql: esta query NO reconstruye la
-- tabla. Se puebla llamando al webservice público del SAT ("Consulta de
-- Estado de CFDI"), no con un SELECT sobre BigQuery. El DDL de abajo lo
-- ejecuta el propio backend de forma idempotente
-- (apps/financialbi/financialbi/estatus_sat.py, `ensure_schema()`).
--
-- Hoy se corre a mano: `python -m financialbi.estatus_sat [limite]` --
-- pensado para convertirse en task de Airflow (ver README.md de esta carpeta).
-- Diagrama del flujo: flujo-estatus-sat.png (fuente flujo-estatus-sat.mmd).

CREATE TABLE IF NOT EXISTS `proan-quantrue.D60_REPORTING.HCARB_ESTATUS_SAT` (
  uuid STRING NOT NULL,
  estatus_cancelacion STRING NOT NULL,      -- 'vigente' | 'cancelado' | 'no_encontrado'
  codigo_estatus STRING,                    -- texto crudo del SAT (para depurar)
  es_cancelable STRING,
  estatus_cancelacion_sat STRING,           -- texto crudo "EstatusCancelacion" del SAT
  fecha_consulta TIMESTAMP NOT NULL,
  fuente STRING NOT NULL
);

-- Mecánica (todo en estatus_sat.py):
--
--   1. _candidatos(): facturas de HCARB_GOLD_CLASIFICACION_FOLIO sin fila
--      todavía en esta tabla, MÁS las que se consultaron hace más de 7 días
--      (_RECHEQUEO_DIAS) y cuya factura en HCARB_gold_aprobacion no esté
--      todavía 'aprobada' (una vez aprobada, una cancelación posterior es
--      caso de disputa manual, no de re-chequeo automático).
--   2. consultar_uno(): llamada SOAP real a
--      https://consultaqr.facturaelectronica.sat.gob.mx/ConsultaCFDIService.svc
--      (SOAPAction http://tempuri.org/IConsultaCFDIService/Consulta,
--      parámetro `expresionImpresa` -- verificado contra la WSDL real, no de
--      memoria). Secuencial con 1s de pausa entre llamadas -- nunca en
--      paralelo, para no golpear el servicio del SAT.
--   3. _guardar(): MERGE upsert por uuid con el resultado (vigente/cancelado/
--      no_encontrado + los campos crudos de la respuesta, para depurar).
--
-- Corrida completa del histórico: 2026-07-23, 1.027 facturas contrastadas.
-- Resultado: 1.033 vigentes, 13 canceladas (~$1.33M MXN, ninguna aprobada
-- todavía), 1 no encontrada, 4 sin respuesta del webservice (quedan como
-- candidatas para el siguiente pase -- no se les escribió fila).
