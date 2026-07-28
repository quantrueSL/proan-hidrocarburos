-- Los pedidos de compra SÍ existen: sap_purchasing_orders (EKKO/EKPO) tiene EBELN_OrdenCompra +
-- LIFNR_Proveedor. Los 11 proveedores de gas tienen pedidos (10.593 distintos, 57.817 líneas).
-- Corrige Esquema §4 ("EKKO/EKPO no existen"). Habilita la vía "validar contra pedido/contrato"
-- del Módulo 2 -- la vía principal para el 98% sin recepción de material.
-- Nota: LIFNR se normaliza quitando ceros a la izquierda para cruzar con dm_vendors.id_proveedor.
-- Pendiente: acotar los pedidos a material de gas (10.593 es todo el negocio de esos proveedores).
WITH lif AS (
  SELECT DISTINCT LTRIM(CAST(id_proveedor AS STRING),'0') AS lif
  FROM `proan-quantrue.D20_DIMENSION.dm_vendors`
  WHERE rfc IN ('DGN811026BU6','CGA9810197C5','HCI8401303N0','GCV610502NY0','DGS071124SN0',
    'SGA811211ED6','EME0001256D0','DPG840301KFA','NQU120510QZ7','GOJ950110A76','SDG980303CJ5')
)
SELECT COUNT(*) AS lineas_po,
  COUNT(DISTINCT po.EBELN_OrdenCompra) AS pedidos_distintos,
  COUNT(DISTINCT LTRIM(CAST(po.LIFNR_Proveedor AS STRING),'0')) AS proveedores_gas_con_po
FROM `proan-quantrue.D30_INTEGRATION.sap_purchasing_orders` po
JOIN lif ON LTRIM(CAST(po.LIFNR_Proveedor AS STRING),'0') = lif.lif;
