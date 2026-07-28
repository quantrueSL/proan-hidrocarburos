-- Las sumas mensuales por RFC salieron desproporcionadas (cientos de millones vs miles).
-- Hipótesis: el filtro original "external_material_group LIKE '151115%' OR ERFME IN ('L','M3')"
-- es demasiado permisivo y arrastra líneas de OTROS materiales líquidos (no hidrocarburo)
-- que comparten proveedor. Se compara cuántas líneas quedan solo por el criterio de unidad.
WITH mseg_docs AS (
  SELECT DISTINCT mseg.MBLNR
  FROM `proan-quantrue.D00_SANDBOX.proan_MSEG_HIDROCARBUROS_20260714` mseg
  LEFT JOIN `proan-quantrue.D20_DIMENSION.dm_material`
    ON mseg.MATNR = material_number
  WHERE external_material_group LIKE '151115%' OR ERFME IN ('L', 'M3')
),
mseg_lineas AS (
  SELECT
    mseg.MBLNR, mseg.DMBTR, mseg.ERFME,
    dm_m.external_material_group,
    dm_m.material_name,
    CASE WHEN dm_m.external_material_group LIKE '151115%' THEN TRUE ELSE FALSE END AS es_clave_sat_hidrocarburo
  FROM `proan-quantrue.D00_SANDBOX.proan_MSEG_HIDROCARBUROS_20260714` mseg
  INNER JOIN mseg_docs USING (MBLNR)
  LEFT JOIN `proan-quantrue.D20_DIMENSION.dm_material` dm_m ON mseg.MATNR = dm_m.material_number
  WHERE (dm_m.external_material_group LIKE '151115%' OR mseg.ERFME IN ('L', 'M3'))
)
SELECT
  es_clave_sat_hidrocarburo,
  COUNT(*) AS n_lineas,
  COUNT(DISTINCT MBLNR) AS n_documentos,
  ROUND(SUM(DMBTR), 2) AS suma_dmbtr,
  COUNT(DISTINCT external_material_group) AS grupos_material_distintos
FROM mseg_lineas
GROUP BY es_clave_sat_hidrocarburo;
