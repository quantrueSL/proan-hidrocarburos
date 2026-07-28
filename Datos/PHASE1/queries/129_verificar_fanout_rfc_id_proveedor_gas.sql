-- Riesgo detectado al revisar HCARB_gold_clasificacion.sql (Fase 2): el LEFT JOIN de cfdis
-- contra HCARB_STG_VENDORS es por rfc, pero Esquema.md ya avisaba que un mismo rfc puede
-- tener más de un id_proveedor en dm_vendors -- si eso le pasa a alguno de los 11 proveedores
-- de gas, el JOIN haría fan-out y duplicaría importe_gas. Verificado antes de dar la query
-- por buena.
-- Resultado: los 11 rfc de proveedores de gas mapean cada uno a exactamente 1 id_proveedor
-- (n_id_proveedor_distintos = 1 en los 11). Sin riesgo de fan-out para este universo -- el
-- caso "un rfc con varios id_proveedor" que menciona Esquema.md existe en la tabla completa
-- pero no afecta a ninguno de los 11 proveedores de gas.
WITH gas_rfcs AS (
  SELECT DISTINCT EmisorRfc AS rfc
  FROM `proan-quantrue.D00_SANDBOX.cfdis`
  WHERE ReceptorRfc = 'PAN921013AK7'
    AND (ClaveProdServ LIKE '151115%' OR ClaveProdServ IN ('83101600', '83101601'))
)
SELECT
  v.rfc,
  COUNT(DISTINCT v.id_proveedor) AS n_id_proveedor_distintos
FROM `proan-quantrue.D20_DIMENSION.dm_vendors` v
JOIN gas_rfcs g ON UPPER(TRIM(v.rfc)) = UPPER(TRIM(g.rfc))
GROUP BY v.rfc
ORDER BY n_id_proveedor_distintos DESC;
