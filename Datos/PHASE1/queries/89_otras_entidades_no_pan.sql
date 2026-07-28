-- ¿Qué otras razones sociales (aparte de Proteína Animal) reciben facturas de gas,
-- y cuánto pesan? Para decidir qué se queda fuera al acotar todo a PAN921013AK7.
SELECT ReceptorRfc, ReceptorNombre, COUNT(*) AS n_facturas, ROUND(SUM(Importe),2) AS suma
FROM `proan-quantrue.D00_SANDBOX.cfdis`
WHERE ClaveProdServ LIKE '151115%' OR ClaveProdServ IN ('83101600','83101601')
GROUP BY ReceptorRfc, ReceptorNombre
ORDER BY n_facturas DESC;
