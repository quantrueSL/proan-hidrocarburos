-- Última comprobación honesta: ¿hay variantes de ReceptorRfc para Proteína Animal
-- (espacios, mayúsculas/minúsculas) que el filtro exacto ReceptorRfc='PAN921013AK7'
-- se esté perdiendo?
SELECT ReceptorRfc, COUNT(*) AS n
FROM `proan-quantrue.D00_SANDBOX.cfdis`
WHERE (ClaveProdServ LIKE '151115%' OR ClaveProdServ IN ('83101600','83101601'))
  AND UPPER(TRIM(ReceptorRfc)) = 'PAN921013AK7'
GROUP BY ReceptorRfc;
