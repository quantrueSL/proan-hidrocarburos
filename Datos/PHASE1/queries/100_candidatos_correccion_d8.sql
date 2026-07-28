-- D8: para cada una de las 19 entregas discrepantes, buscar entre las facturas de
-- Gas Noel que YA NO están reclamadas por ningún otro documento MSEG (por folio+RFC)
-- una candidata cuya fecha y cantidad sean consistentes con lo que SAP dice haber
-- recibido -- propuesta concreta para que Compras la verifique, no solo la pregunta.
WITH mseg_docs AS (
  SELECT DISTINCT mseg.MBLNR
  FROM `proan-quantrue.D00_SANDBOX.proan_MSEG_HIDROCARBUROS_20260714` mseg
  LEFT JOIN `proan-quantrue.D20_DIMENSION.dm_material`
    ON mseg.MATNR = material_number
  WHERE external_material_group LIKE '151115%'
),
mseg_base AS (
  SELECT mseg.MBLNR, mseg.XBLNR_MKPF, mseg.DMBTR, mseg.ERFMG,
    SAFE.PARSE_DATE('%Y%m%d', CAST(mseg.BUDAT_MKPF AS STRING)) AS fecha, dm_v.rfc
  FROM `proan-quantrue.D00_SANDBOX.proan_MSEG_HIDROCARBUROS_20260714` mseg
  INNER JOIN mseg_docs USING (MBLNR)
  LEFT JOIN `proan-quantrue.D20_DIMENSION.dm_material`  dm_m ON mseg.MATNR = dm_m.material_number
  LEFT JOIN `proan-quantrue.D20_DIMENSION.dm_vendors`   dm_v ON mseg.LIFNR = dm_v.id_proveedor
  WHERE dm_m.external_material_group LIKE '151115%' AND dm_v.rfc = 'DGN811026BU6'
    AND mseg.XBLNR_MKPF IS NOT NULL AND TRIM(mseg.XBLNR_MKPF) != ''
),
final_por_folio AS (
  SELECT *, ROW_NUMBER() OVER (PARTITION BY XBLNR_MKPF ORDER BY MBLNR DESC) AS rn
  FROM mseg_base
),
cfdis_gas_noel AS (
  SELECT UUID, CAST(Folio AS STRING) AS folio_str, Serie, Importe, Cantidad,
    DATE(FechaTimbrado) AS fecha_factura
  FROM `proan-quantrue.D00_SANDBOX.cfdis`
  WHERE EmisorRfc = 'DGN811026BU6' AND ClaveProdServ LIKE '151115%'
    AND FechaTimbrado >= '2026-01-01'
),
matches AS (
  SELECT m.MBLNR, m.XBLNR_MKPF AS folio_sap, m.fecha, m.ERFMG AS cantidad_sap, m.DMBTR AS importe_sap,
    c.UUID AS uuid_matched, c.Cantidad AS cantidad_matched
  FROM final_por_folio m
  INNER JOIN cfdis_gas_noel c
    ON REPLACE(UPPER(TRIM(m.XBLNR_MKPF)),' ','') = REPLACE(UPPER(TRIM(CONCAT(c.Serie,c.folio_str))),' ','')
  WHERE m.rn = 1
),
uuids_ya_reclamados AS (
  SELECT DISTINCT uuid_matched AS UUID FROM matches
),
cfdis_disponibles AS (
  SELECT c.*
  FROM cfdis_gas_noel c
  LEFT JOIN uuids_ya_reclamados r ON c.UUID = r.UUID
  WHERE r.UUID IS NULL
),
entregas_problema AS (
  SELECT MBLNR, folio_sap, fecha, cantidad_sap, importe_sap
  FROM matches
  WHERE ABS(SAFE_DIVIDE(cantidad_sap, cantidad_matched) - 1) > 0.02
)
SELECT e.folio_sap, e.fecha AS fecha_entrega, ROUND(e.cantidad_sap,2) AS cantidad_sap,
  c.UUID AS candidato_uuid, c.fecha_factura, ROUND(c.Cantidad,2) AS cantidad_candidata,
  ROUND(c.Importe,2) AS importe_candidato,
  ABS(DATE_DIFF(c.fecha_factura, e.fecha, DAY)) AS dias_diferencia,
  ROUND(SAFE_DIVIDE(e.cantidad_sap, c.Cantidad), 3) AS ratio_cantidad
FROM entregas_problema e
INNER JOIN cfdis_disponibles c
  ON ABS(DATE_DIFF(c.fecha_factura, e.fecha, DAY)) <= 15
  AND ABS(SAFE_DIVIDE(e.cantidad_sap, c.Cantidad) - 1) < 0.15
ORDER BY e.fecha, dias_diferencia;
