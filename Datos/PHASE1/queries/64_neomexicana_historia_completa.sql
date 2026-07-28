-- Repetido con el filtro correcto de clave SAT (la vuelta anterior mezclaba otros
-- conceptos que este proveedor también factura, fuera del alcance de gas/GNC).
SELECT
  REGEXP_EXTRACT(Descripcion, r'municipio de ([A-Za-zÀ-ÿ ]+),') AS municipio_mencionado,
  COUNT(*) AS n_facturas, MIN(DATE(FechaTimbrado)) AS desde, MAX(DATE(FechaTimbrado)) AS hasta
FROM `proan-quantrue.D00_SANDBOX.cfdis`
WHERE EmisorRfc = 'NGN120221H35'
  AND ClaveProdServ IN ('83101600','83101601')
GROUP BY municipio_mencionado
ORDER BY n_facturas DESC;
