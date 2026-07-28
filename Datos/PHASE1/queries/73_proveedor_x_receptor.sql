-- Cruce proveedor x receptor: ¿a qué entidad legal factura cada proveedor de gas?
-- "PAN" (prefijo de nuestras 4 plantas conocidas) = PROTEINA ANIMAL (PAN921013AK7).
-- Si un proveedor factura a otra entidad, puede no ser parte de este proyecto de hidrocarburos.
SELECT EmisorRfc, EmisorNombre, ReceptorRfc, ReceptorNombre, COUNT(*) AS n_facturas
FROM `proan-quantrue.D00_SANDBOX.cfdis`
WHERE ClaveProdServ LIKE '151115%' OR ClaveProdServ IN ('83101600','83101601')
GROUP BY EmisorRfc, EmisorNombre, ReceptorRfc, ReceptorNombre
ORDER BY EmisorRfc, n_facturas DESC;
