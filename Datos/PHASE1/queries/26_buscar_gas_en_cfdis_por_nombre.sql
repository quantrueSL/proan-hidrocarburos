-- ¿Hay CFDIs cuya Descripcion suena a gas pero cuyo ClaveProdServ NO es 151115xx?
-- Version compacta: solo conteos y suma por clave, sin texto libre (para no saturar salida).
SELECT ClaveProdServ, COUNT(*) AS n_facturas, COUNT(DISTINCT EmisorRfc) AS n_proveedores,
  ROUND(SUM(Importe), 2) AS suma_importe
FROM `proan-quantrue.D00_SANDBOX.cfdis`
WHERE FechaTimbrado >= '2026-01-01'
  AND REGEXP_CONTAINS(UPPER(Descripcion), r'\bGAS\b|PROPANO|BUTANO|\bGLP\b|\bGNC\b|\bGNL\b')
  AND ClaveProdServ NOT LIKE '151115%'
GROUP BY ClaveProdServ
ORDER BY suma_importe DESC
LIMIT 30;
