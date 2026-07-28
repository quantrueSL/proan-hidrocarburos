-- Calidad de datos (hallazgo de análisis paralelo, jul-2026): dm_vendors DUPLICA filas por
-- proveedor -- trae una fila por cada correo_electronico de contacto, no una por proveedor.
-- 5 de los 11 proveedores de gas (Energas, Natgas Qro, Gas Comercial de Villa Ahumada,
-- San Diego, Corpo Gas) tienen 2 filas con el MISMO id_proveedor. Consecuencia: cualquier JOIN
-- MSEG/bsik/bsak -> dm_vendors por id_proveedor DUPLICA los importes de esos proveedores.
-- Regla Fase 2: deduplicar dm_vendors a una fila por id_proveedor (ignorando correo_electronico)
-- antes de cruzar.
-- (Nota: nuestro universo se calcula desde cfdis directo, sin este JOIN, así que NO está
--  inflado; las coberturas usan COUNT(DISTINCT), también a salvo.)
WITH gas_rfc AS (
  SELECT DISTINCT EmisorRfc
  FROM `proan-quantrue.D00_SANDBOX.cfdis`
  WHERE ReceptorRfc = 'PAN921013AK7'
    AND (ClaveProdServ LIKE '151115%' OR ClaveProdServ IN ('83101600','83101601'))
)
SELECT v.rfc, COUNT(*) AS filas_dm_vendors, COUNT(DISTINCT v.id_proveedor) AS n_id_proveedor
FROM gas_rfc g
JOIN `proan-quantrue.D20_DIMENSION.dm_vendors` v ON v.rfc = g.EmisorRfc
GROUP BY v.rfc
ORDER BY filas_dm_vendors DESC;
