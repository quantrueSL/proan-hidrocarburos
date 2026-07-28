-- CRÍTICO: ¿todas estas facturas de gas están dirigidas a Proan (ReceptorRfc/ReceptorNombre),
-- o hay alguna dirigida a Maka? Si Maka ya es empresa separada, sus facturas no deberían
-- contar para este proyecto de hidrocarburos.
SELECT ReceptorRfc, ReceptorNombre, COUNT(*) AS n_facturas, COUNT(DISTINCT EmisorRfc) AS n_proveedores
FROM `proan-quantrue.D00_SANDBOX.cfdis`
WHERE ClaveProdServ LIKE '151115%' OR ClaveProdServ IN ('83101600','83101601')
GROUP BY ReceptorRfc, ReceptorNombre
ORDER BY n_facturas DESC;
