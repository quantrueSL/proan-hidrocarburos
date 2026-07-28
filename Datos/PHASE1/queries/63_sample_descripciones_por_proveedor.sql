-- Ver 3 descripciones de ejemplo por proveedor para entender qué patrones de texto usan
-- (antes de diseñar una extracción de ubicación más general que "municipio de X").
SELECT EmisorRfc, EmisorNombre, Descripcion
FROM (
  SELECT EmisorRfc, EmisorNombre, Descripcion,
    ROW_NUMBER() OVER (PARTITION BY EmisorRfc ORDER BY FechaTimbrado DESC) AS rn
  FROM `proan-quantrue.D00_SANDBOX.cfdis`
  WHERE ClaveProdServ LIKE '151115%' OR ClaveProdServ IN ('83101600','83101601')
)
WHERE rn <= 3
ORDER BY EmisorRfc, rn;
