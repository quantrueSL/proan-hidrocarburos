SELECT Descripcion, COUNT(*) AS n
FROM `proan-quantrue.D00_SANDBOX.cfdis`
WHERE EmisorRfc = 'NGN120221H35' AND ClaveProdServ IN ('83101600','83101601')
  AND REGEXP_EXTRACT(Descripcion, r'municipio de ([A-Za-zÀ-ÿ ]+),') IS NULL
GROUP BY Descripcion
ORDER BY n DESC
LIMIT 15;
