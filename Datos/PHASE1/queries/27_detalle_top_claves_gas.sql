-- Detalle de descripción para las claves con mayor importe del hallazgo anterior,
-- para saber si son gas real mal clasificado o servicios/equipo relacionados con gas.
SELECT ClaveProdServ, EmisorNombre, Descripcion, Importe
FROM `proan-quantrue.D00_SANDBOX.cfdis`
WHERE FechaTimbrado >= '2026-01-01'
  AND ClaveProdServ IN ('83101600','72102900','83101601','84111506','26101766','73152100')
  AND REGEXP_CONTAINS(UPPER(Descripcion), r'\bGAS\b|PROPANO|BUTANO|\bGLP\b|\bGNC\b|\bGNL\b')
ORDER BY ClaveProdServ, Importe DESC
LIMIT 20;
