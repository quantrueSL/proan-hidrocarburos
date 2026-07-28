-- Fase 2 necesitaba el catálogo completo de columnas de dm_vendors (solo se había validado
-- id_proveedor/rfc/dirección/correo_electronico en Fase 1) antes de escribir HCARB_stg_vendors.sql.
-- Resultado: 12 columnas, todas STRING -- correo_electronico, id_direccion, rfc, id_proveedor,
-- pais, razon_social, municipio, colonia, codigo_postal, estado_cod, nombre_comercial,
-- direccion_completa. Confirma el catálogo que Esquema.md ya daba por "12 columnas" sin
-- enumerar -- ver también queries/128 (confirma que el dedup por id_proveedor es seguro).
SELECT column_name, data_type, ordinal_position
FROM `proan-quantrue.D20_DIMENSION.INFORMATION_SCHEMA.COLUMNS`
WHERE table_name = 'dm_vendors'
ORDER BY ordinal_position;
