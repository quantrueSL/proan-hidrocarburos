-- ¿Cada proveedor GNC-servicio factura siempre desde/hacia el mismo lugar (según el texto
-- de Descripcion), o varía? Si es estable, se podría automatizar la asignación de CECO
-- para la vía servicio en vez de hacerla a mano factura por factura.
SELECT EmisorRfc, EmisorNombre,
  REGEXP_EXTRACT(Descripcion, r'municipio de ([A-Za-zÀ-ÿ ]+),') AS municipio_mencionado,
  COUNT(*) AS n_facturas
FROM `proan-quantrue.D00_SANDBOX.cfdis`
WHERE FechaTimbrado >= '2026-01-01'
  AND ClaveProdServ IN ('83101600','83101601')
GROUP BY EmisorRfc, EmisorNombre, municipio_mencionado
ORDER BY EmisorRfc, n_facturas DESC;
