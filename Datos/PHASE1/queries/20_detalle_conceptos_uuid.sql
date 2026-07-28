-- Ver TODOS los conceptos (sin filtrar por clave SAT) de una factura donde Importe << Total,
-- para saber si el CFDI trae mezclados gas + otros conceptos en la misma factura.
SELECT UUID, Serie, Folio, ClaveProdServ, Descripcion, Cantidad, ClaveUnidad, ValorUnitario, Importe, Total
FROM `proan-quantrue.D00_SANDBOX.cfdis`
WHERE UUID IN ('4a291e0a-feea-4f57-988e-b94d098b6d21', '39f6b8bf-707f-4af8-a102-12e29ab23a2c', '96f31a83-c32a-4641-a3c4-f849779bfb1f')
ORDER BY UUID;
