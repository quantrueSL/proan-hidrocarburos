-- DESCUBRIMIENTO (jul-2026): D30_INTEGRATION contiene una capa de integración SAP ENTERA que la
-- Fase 1 no había mirado (solo se exploró D00_SANDBOX y D20_DIMENSION). Corrige la afirmación de
-- Esquema §4 de que "EKKO/EKPO no existen". Tablas clave para conciliar facturas de gas:
--   bkpf_account_document_header  -> documentos contables FI (XBLNR = folio de factura proveedor)
--   sap_purchasing_orders         -> pedidos de compra (EBELN + LIFNR_Proveedor) = EKKO/EKPO
--   sap_mseg                      -> MSEG integrado, con LFBNR (nº factura proveedor) + EBELN
--   sap_open_cleared_items / sap_bsik_open_items -> cuentas por pagar (LIFNR + XBLNR)
--   sap_ekbe                      -> histórico de pedido (EBELN + XBLNR)
--   int_ACDOCA_historico          -> libro diario universal S/4HANA (EBELN + LIFNR)
--   facturas_pago                 -> estatus de pago (pagado_lg/fecha_pago) -- pero de CLIENTES
SELECT table_name, column_name, data_type
FROM `proan-quantrue.D30_INTEGRATION.INFORMATION_SCHEMA.COLUMNS`
WHERE table_name IN ('bkpf_account_document_header','sap_purchasing_orders','sap_mseg',
  'sap_open_cleared_items','sap_bsik_open_items','sap_ekbe','int_ACDOCA_historico','facturas_pago')
ORDER BY table_name, ordinal_position;
