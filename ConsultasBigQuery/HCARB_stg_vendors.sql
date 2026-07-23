-- HCARB_STG_VENDORS: dedup de dm_vendors por id_proveedor.
-- La tabla trae una fila por correo_electronico, no por proveedor (Fase 1, hallazgo §18) --
-- 5 de los 11 proveedores de gas tienen 2 filas con el mismo id_proveedor. Un JOIN ingenuo
-- desde otras tablas duplicaría los importes de esos proveedores.
-- Regla de dedup: una fila por id_proveedor, se descarta correo_electronico (es la causa
-- de la duplicación, no se pierde ninguna otra columna -- confirmado contra las 25.110 filas
-- reales, Fase 1 hallazgo §24 / queries/128: ninguna fila duplicada difiere en nada más).
-- Esquema completo verificado (12 columnas, todas STRING, hallazgo §24): correo_electronico,
-- id_direccion, rfc, id_proveedor, pais, razon_social, municipio, colonia, codigo_postal,
-- estado_cod, nombre_comercial, direccion_completa. Nombre del proveedor = razon_social.
--
-- BORRADOR: esquema verificado, pero esta query en sí no se ha ejecutado todavía.

CREATE OR REPLACE TABLE `proan-quantrue.D50_AGGREGATE_RENTABILIDAD.HCARB_STG_VENDORS` AS
SELECT * EXCEPT(correo_electronico)
FROM `proan-quantrue.D20_DIMENSION.dm_vendors`
QUALIFY ROW_NUMBER() OVER (PARTITION BY id_proveedor ORDER BY correo_electronico) = 1;
