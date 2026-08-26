-- Variante de prueba de HCARB_gold_clasificacion.sql (rama Fer, ago-2026): idéntica
-- lógica, pero escribe en HCARB_GOLD_CLASIFICACION_FOLIO_fer en vez de la tabla real,
-- para comparar D30_INTEGRATION.cfdi_completo contra D00_SANDBOX.cfdis (ver
-- HCARB_gold_clasificacion.sql) sin tocar la tabla que lee producción. Backend local
-- apunta aquí vía HCARB_FOLIO_TABLE en config/financialbi.env. Borrar este archivo y
-- la tabla `_fer` cuando el cambio de fuente se confirme y se aplique a la tabla real.
-- Dedup por UUID+concepto_idx (no por contenido) -- ver HCARB_gold_clasificacion.sql.
DECLARE cutoff_fecha_negocio DATE DEFAULT '2026-01-01';

CREATE OR REPLACE TABLE `proan-quantrue.D60_REPORTING.HCARB_GOLD_CLASIFICACION_FOLIO_fer` AS
WITH cfdis_dedup AS (
  SELECT * EXCEPT(rn)
  FROM (
    SELECT *,
      ROW_NUMBER() OVER (
        PARTITION BY UUID, concepto_idx
        ORDER BY _ingested_at DESC
      ) AS rn
    FROM `proan-quantrue.D30_INTEGRATION.cfdi_completo`
    WHERE ReceptorRfc = 'PAN921013AK7'
      AND DATE(FechaTimbrado) >= cutoff_fecha_negocio
      AND DATE(Fecha) >= cutoff_fecha_negocio
  )
  WHERE rn = 1
),
cfdis_flagged AS (
  SELECT *,
    (ClaveProdServ LIKE '151115%' OR ClaveProdServ IN ('83101600', '83101601')) AS es_linea_gas
  FROM cfdis_dedup
),
uuids_gas AS (
  SELECT DISTINCT UUID
  FROM cfdis_flagged
  WHERE es_linea_gas
)
SELECT
  c.UUID AS uuid,
  ANY_VALUE(c.Serie) AS serie,
  ANY_VALUE(c.Folio) AS folio,
  ANY_VALUE(UPPER(REPLACE(CONCAT(IFNULL(c.Serie, ''), CAST(c.Folio AS STRING)), ' ', ''))) AS folio_key,
  ANY_VALUE(LTRIM(REGEXP_REPLACE(CAST(c.Folio AS STRING), r'[^0-9]', ''), '0')) AS folio_numero,
  ANY_VALUE(c.EmisorRfc) AS emisor_rfc,
  v.id_proveedor,
  ANY_VALUE(c.ReceptorRfc) AS receptor_rfc,
  ANY_VALUE(c.FechaTimbrado) AS fecha_timbrado,
  ANY_VALUE(c.Fecha) AS fecha,
  ANY_VALUE(c.TipoDeComprobante) AS tipo_de_comprobante,
  ANY_VALUE(c.Moneda) AS moneda,
  ANY_VALUE(c.MetodoPago) AS metodo_pago,
  ANY_VALUE(c.FormaPago) AS forma_pago,
  ANY_VALUE(c.SubTotal) AS subtotal,
  ANY_VALUE(c.Total) AS total,
  ANY_VALUE(c.TotalImpuestosTrasladados) AS total_impuestos_trasladados,
  ANY_VALUE(c.SubTotal) - SUM(IF(NOT c.es_linea_gas, c.Importe, 0)) AS importe_gas,
  COUNTIF(NOT c.es_linea_gas) > 0 AS es_mixta,
  COUNTIF(c.es_linea_gas) AS n_lineas_gas,
  COUNT(*) AS n_lineas_total,
  ARRAY_AGG(DISTINCT IF(c.es_linea_gas, c.ClaveProdServ, NULL) IGNORE NULLS) AS claves_gas,
  ARRAY_AGG(IF(c.es_linea_gas, c.Descripcion, NULL) IGNORE NULLS ORDER BY c.Importe DESC LIMIT 1)[SAFE_OFFSET(0)] AS material_principal,
  ARRAY_AGG(IF(c.es_linea_gas, c.Cantidad, NULL) IGNORE NULLS ORDER BY c.Importe DESC LIMIT 1)[SAFE_OFFSET(0)] AS cantidad_principal,
  ARRAY_AGG(IF(c.es_linea_gas, c.ClaveUnidad, NULL) IGNORE NULLS ORDER BY c.Importe DESC LIMIT 1)[SAFE_OFFSET(0)] AS clave_unidad_principal,
  ARRAY_AGG(
    IF(c.es_linea_gas,
       STRUCT(
         c.ClaveProdServ AS clave,
         c.Descripcion AS descripcion,
         c.Cantidad AS cantidad,
         c.ClaveUnidad AS clave_unidad,
         c.ValorUnitario AS valor_unitario,
         c.Importe AS importe
       ),
       NULL)
    IGNORE NULLS
    ORDER BY c.Importe DESC
  ) AS conceptos_gas
FROM cfdis_flagged c
JOIN uuids_gas g ON c.UUID = g.UUID
LEFT JOIN `proan-quantrue.D50_AGGREGATE_RENTABILIDAD.HCARB_STG_VENDORS` v
  ON UPPER(TRIM(c.EmisorRfc)) = UPPER(TRIM(v.rfc))
GROUP BY c.UUID, v.id_proveedor;
