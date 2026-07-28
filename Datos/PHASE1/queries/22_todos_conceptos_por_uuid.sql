-- Esta vez SIN filtrar por ClaveProdServ, para ver todos los conceptos de la misma factura.
SELECT UUID, ClaveProdServ, Descripcion, Cantidad, ClaveUnidad, ValorUnitario, Importe
FROM `proan-quantrue.D00_SANDBOX.cfdis`
WHERE UUID IN ('4a291e0a-feea-4f57-988e-b94d098b6d21', '39f6b8bf-707f-4af8-a102-12e29ab23a2c')
ORDER BY UUID, Importe DESC;
