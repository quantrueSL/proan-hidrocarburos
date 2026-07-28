-- D9: ¿el importe por factura de los proveedores de baja frecuencia es estable
-- (apoya sitio único, consumo similar cada vez) o muy variable (podría ser varios
-- sitios de tamaño distinto, o consumo irregular)?
SELECT EmisorRfc, EmisorNombre, COUNT(*) AS n_facturas,
  ROUND(AVG(Importe),2) AS promedio,
  ROUND(STDDEV(Importe),2) AS desviacion,
  ROUND(SAFE_DIVIDE(STDDEV(Importe), AVG(Importe)),2) AS coef_variacion
FROM `proan-quantrue.D00_SANDBOX.cfdis`
WHERE ReceptorRfc = 'PAN921013AK7'
  AND EmisorRfc IN ('SGA811211ED6','EME0001256D0','DPG840301KFA','NQU120510QZ7','GOJ950110A76','SDG980303CJ5')
  AND (ClaveProdServ LIKE '151115%' OR ClaveProdServ IN ('83101600','83101601'))
GROUP BY EmisorRfc, EmisorNombre
ORDER BY coef_variacion;
