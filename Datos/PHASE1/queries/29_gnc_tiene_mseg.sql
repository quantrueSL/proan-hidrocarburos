-- Estos proveedores de GNC facturan como "servicio" -- ¿tienen algún documento MSEG
-- (recepción de mercancía) asociado, o solo existen como factura/gasto de servicio?
SELECT dm_v.rfc, dm_v.razon_social, COUNT(mseg.MBLNR) AS n_documentos_mseg
FROM `proan-quantrue.D20_DIMENSION.dm_vendors` dm_v
LEFT JOIN `proan-quantrue.D00_SANDBOX.proan_MSEG_HIDROCARBUROS_20260714` mseg
  ON mseg.LIFNR = dm_v.id_proveedor
WHERE dm_v.rfc IN ('NQU120510QZ7', 'NGN120221H35', 'EME0001256D0')
GROUP BY dm_v.rfc, dm_v.razon_social;
