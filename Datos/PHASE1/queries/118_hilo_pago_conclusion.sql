-- Tirando del hilo del pago (jul-2026): ¿se puede saber si una factura de gas está PAGADA?
-- Conclusión: NO de forma fiable, ni siquiera con la capa D30_INTEGRATION.
--   (a) sap_bsik_open_items (partidas de proveedor / cuentas por pagar) solo tiene 9 filas de
--       gas, de 3 de los 11 proveedores, TODAS abiertas (0 con AUGDT_clearing_dt).
--   (b) De los 850 documentos RE (factura registrada) de gas en BKPF, solo 1 aparece en
--       sap_bsik_open_items por BELNR -> los otros 849 no están en "abiertas" (podrían estar
--       pagados y haber salido, o el snapshot es parcial: no se puede distinguir).
--   (c) NO existe tabla de partidas de proveedor COMPENSADAS/pagadas (BSAK) en D30 -- las
--       "cleared" disponibles son de clientes (sap_open_cleared_items tiene KUNNR/VBELN;
--       facturas_pago es de clientes; ACDOCA da 0 para estos proveedores).
-- => El registro de la factura (RE en BKPF) es sólido y usable (Módulos 1/2/3); el estatus de
--    PAGO (Módulo 4) NO es recuperable de las tablas actuales. Hace falta una fuente de pagos
--    de proveedor (BSAK / clearing de AP) que hoy no está en el almacén.
WITH lif AS (
  SELECT DISTINCT LTRIM(CAST(id_proveedor AS STRING),'0') AS lif
  FROM `proan-quantrue.D20_DIMENSION.dm_vendors`
  WHERE rfc IN ('DGN811026BU6','CGA9810197C5','HCI8401303N0','GCV610502NY0','DGS071124SN0',
    'SGA811211ED6','EME0001256D0','DPG840301KFA','NQU120510QZ7','GOJ950110A76','SDG980303CJ5')
)
SELECT COUNT(*) AS filas_ap_gas,
  COUNT(DISTINCT LTRIM(CAST(b.LIFNR_vendor_number AS STRING),'0')) AS proveedores_gas_en_ap,
  COUNTIF(b.AUGDT_clearing_dt IS NOT NULL) AS filas_compensadas,
  COUNTIF(b.AUGDT_clearing_dt IS NULL) AS filas_abiertas
FROM `proan-quantrue.D30_INTEGRATION.sap_bsik_open_items` b
JOIN lif ON LTRIM(CAST(b.LIFNR_vendor_number AS STRING),'0') = lif.lif;
