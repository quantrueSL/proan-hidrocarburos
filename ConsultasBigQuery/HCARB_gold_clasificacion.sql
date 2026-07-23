-- Módulo 1 (clasificación): tabla grano UUID (factura completa).
-- Universo (D1/D2, provisional): ReceptorRfc='PAN921013AK7' (Proteína Animal) y >=1 línea
-- con ClaveProdServ de gas (151115xx producto, 83101600/83101601 GNC servicio).
-- Dedup obligatorio antes de sumar (hallazgo Fase 1 §18): (UUID, ClaveProdServ, Cantidad,
-- Importe, Descripcion) -- 24 de 1.051 facturas traen 2 filas exactas duplicadas del mismo
-- concepto.
-- importe_gas se suma con Importe de línea, NUNCA con Total/SubTotal (74% de facturas
-- mixtas, Fase 1 §16).
--
-- D26 (jul-2026): originalmente había también HCARB_GOLD_CLASIFICACION_LINEA (grano
-- línea-concepto, D12/D19) para desglosar facturas mixtas. Se eliminó: al ejecutar salió
-- con el mismo grano que esta tabla (1.051=1.051, 1 a 1) -- los conceptos no-gas de una
-- factura mixta NO se guardan como fila aparte en cfdis (confirma §16), así que no hay
-- desglose real que mostrar. Si aparece una fuente con desglose real, reconstruir desde
-- Datos/PHASE2/resumen.md D26 / historial de este archivo.
--
-- El LEFT JOIN contra HCARB_STG_VENDORS es por rfc -- verificado que no hace fan-out para
-- los 11 proveedores de gas (cada rfc mapea a 1 solo id_proveedor, Fase 1 hallazgo §25 /
-- queries/129), aunque en dm_vendors completo sí existen rfc con varios id_proveedor.
--
-- EJECUTADO jul-2026. Bugs reales encontrados y corregidos al ejecutar:
-- - PARTITION BY del dedup castea Cantidad/Importe a STRING -- BigQuery no permite
--   particionar ROW_NUMBER() OVER (...) por columnas FLOAT64 directamente (sí lo permite
--   GROUP BY). Mismo valor exacto -> misma representación STRING, no cambia el dedup.
-- - es_mixta comparaba contra Total (con IVA), no SubTotal -- daba 100% mixtas siempre
--   (Total > importe_gas por el IVA, aunque la factura fuera 100% gas). Corregido a
--   SubTotal. Además necesita tolerancia (>0.01, no >0): 91 folios eran "mixtos" solo por
--   redondeo de <=1 centavo entre SubTotal y la suma de Importe -- sin tolerancia daba 83%
--   mixtas en vez del ~74% esperado (Fase 1 §16); con tolerancia, 781/1051 = 74.3%.

CREATE OR REPLACE TABLE `proan-quantrue.D60_REPORTING.HCARB_GOLD_CLASIFICACION_FOLIO` AS
WITH cfdis_dedup AS (
  SELECT * EXCEPT(rn)
  FROM (
    SELECT *,
      ROW_NUMBER() OVER (
        PARTITION BY UUID, ClaveProdServ, CAST(Cantidad AS STRING), CAST(Importe AS STRING), Descripcion
        ORDER BY FechaTimbrado
      ) AS rn
    FROM `proan-quantrue.D00_SANDBOX.cfdis`
    WHERE ReceptorRfc = 'PAN921013AK7'
  )
  WHERE rn = 1
),
uuids_gas AS (
  SELECT DISTINCT UUID
  FROM cfdis_dedup
  WHERE ClaveProdServ LIKE '151115%' OR ClaveProdServ IN ('83101600', '83101601')
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
  SUM(IF(c.ClaveProdServ LIKE '151115%' OR c.ClaveProdServ IN ('83101600', '83101601'), c.Importe, 0)) AS importe_gas,
  ANY_VALUE(c.SubTotal) - SUM(IF(c.ClaveProdServ LIKE '151115%' OR c.ClaveProdServ IN ('83101600', '83101601'), c.Importe, 0)) > 0.01 AS es_mixta,
  COUNTIF(c.ClaveProdServ LIKE '151115%' OR c.ClaveProdServ IN ('83101600', '83101601')) AS n_lineas_gas,
  COUNT(*) AS n_lineas_total
FROM cfdis_dedup c
JOIN uuids_gas g ON c.UUID = g.UUID
LEFT JOIN `proan-quantrue.D50_AGGREGATE_RENTABILIDAD.HCARB_STG_VENDORS` v
  ON UPPER(TRIM(c.EmisorRfc)) = UPPER(TRIM(v.rfc))
GROUP BY c.UUID, v.id_proveedor;
