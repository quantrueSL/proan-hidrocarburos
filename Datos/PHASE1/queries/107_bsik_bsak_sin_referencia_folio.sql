-- Módulo 4: bsik/bsak NO tienen XBLNR (la referencia SAP que suele llevar el folio de la
-- factura del proveedor). Los únicos campos de enlace son ZUONR (asignación), BELNR (doc
-- contable) y AUGBL (doc de compensación). Consecuencia: la conciliación de pago solo puede
-- ser por LIFNR + importe (Total del CFDI) + fecha -- propensa a colisiones-, como ya concluyó
-- la Fase 1 (Esquema §8). Pendiente: probar si ZUONR trae el folio (subiría el Módulo 4 de
-- match-por-importe a match-por-clave).
SELECT table_name, column_name, data_type
FROM `proan-quantrue.D00_SANDBOX.INFORMATION_SCHEMA.COLUMNS`
WHERE table_name IN ('bsik_real_time', 'bsak_real_time')
ORDER BY table_name, ordinal_position;
