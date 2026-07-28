-- Para los proveedores de baja frecuencia (candidatos a sitio único), ver si TODAS
-- sus descripciones son iguales (refuerza sitio único) o varían (indicio de más de uno).
SELECT EmisorRfc, EmisorNombre, Descripcion, COUNT(*) AS n
FROM `proan-quantrue.D00_SANDBOX.cfdis`
WHERE ReceptorRfc = 'PAN921013AK7'
  AND EmisorRfc IN ('SGA811211ED6','EME0001256D0','DPG840301KFA','NQU120510QZ7','GOJ950110A76','SDG980303CJ5')
GROUP BY EmisorRfc, EmisorNombre, Descripcion
ORDER BY EmisorRfc, n DESC;
