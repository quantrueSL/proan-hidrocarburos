-- Módulo 1 (clasificación): tabla grano UUID (factura completa).
-- Universo (D1/D2, provisional): ReceptorRfc='PAN921013AK7' (Proteína Animal) y >=1 línea
-- con ClaveProdServ de gas (151115xx producto, 83101600/83101601 GNC servicio).
-- Dedup obligatorio antes de sumar (hallazgo Fase 1 §18): 24 de 1.051 facturas traían 2 filas
-- exactas duplicadas del mismo concepto (cfdis, sin concepto_idx -- dedup por contenido:
-- ClaveProdServ+Cantidad+Importe+Descripcion). Con cfdi_completo (ago-2026) el dedup pasa a
-- ser por UUID+concepto_idx -- ver nota más abajo, el dedup por contenido ya no es seguro
-- cuando una factura trae decenas de líneas.
-- importe_gas parte de SubTotal (validado por el SAT), no de sumar Importe de línea --
-- ver el FIX jul-2026 más abajo y docs/data/naturaleza-de-los-datos.md. El "74% de facturas
-- mixtas" que motivó originalmente sumar por línea (Fase 1 §16) resultó ser el mismo bug
-- de líneas faltantes en cfdis, no mezcla real de producto -- con el fix, 0 facturas son
-- mixtas de verdad.
--
-- D26 (jul-2026): originalmente había también HCARB_GOLD_CLASIFICACION_LINEA (grano
-- línea-concepto, D12/D19) para desglosar facturas mixtas. Se eliminó: al ejecutar salió
-- con el mismo grano que esta tabla (1.051=1.051, 1 a 1) -- los conceptos no-gas de una
-- factura mixta NO se guardan como fila aparte en cfdis (confirma §16), así que no hay
-- desglose real que mostrar. Si aparece una fuente con desglose real, reconstruir desde
-- el historial de este archivo (git log).
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

-- Trazabilidad de clasificación (jul-2026): claves_gas + conceptos_gas exponen QUÉ clave
-- SAT y QUÉ concepto clasificaron cada factura como gas -- la clasificación deja de ser una
-- caja negra ("¿por qué es gas esta factura?") y se vuelve auditable línea a línea. Hace
-- visible de paso que el universo real incluye 83101600/83101601 (GNC como servicio) además
-- de las 6 claves-producto 151115xx de la Propuesta -- el gas se factura a veces como
-- servicio, no como producto, así que ceñirse a las 6 dejaría fuera facturas de gas reales.
-- El predicado de gas se calcula una sola vez (es_linea_gas en cfdis_flagged) en vez de
-- repetirlo en cada agregado.

-- D31 (jul-2026): cutoff de fecha de negocio >=2026-01-01. proan_MSEG_HIDROCARBUROS_20260714
-- solo cubre MJAHR=2026 (Fase 1 §15), pero cfdis no tenía piso de fecha y arrancaba
-- ~jun-2025 (Fase 1 §19.5) -- ~7 meses que MSEG nunca podrá validar porque el dato no existe
-- en SAP para ese rango. Se corta aquí (único punto, todo lo demás hereda vía JOIN/lectura
-- de esta tabla) exigiendo FechaTimbrado Y Fecha >= el cutoff, no solo uno de los dos.
--
-- Fuente D30_INTEGRATION.cfdi_completo (ago-2026, reemplaza D00_SANDBOX.cfdis): cfdis
-- venía incompleta -- para 414/547 facturas del universo de gas solo traía 1 línea (de gas)
-- aunque SubTotal exigiera más (ver el FIX "importe_gas" más abajo, que hasta ahora
-- compensaba esa carencia restando desde SubTotal en vez de sumar líneas). cfdi_completo
-- trae TODAS las líneas por factura (grano UUID+concepto_idx, mismas columnas que cfdis).
-- Verificado contra BigQuery real (ago-2026): mismo universo de facturas del receptor
-- (277.489 vs 277.446 UUID, prácticamente igual) pero con casi el doble de líneas
-- (543.759 vs 278.776) -- confirma que antes faltaban líneas, no que haya facturas nuevas.
-- cfdi_completo trae además filas exactamente duplicadas por reingesta (1.675 pares
-- UUID+concepto_idx con contenido idéntico, mismo _id).
--
-- Dedup por UUID+concepto_idx, NO por contenido (ago-2026): el dedup original (por
-- ClaveProdServ+Cantidad+Importe+Descripcion) daba por hecho que dos líneas con esos 4
-- valores iguales eran la misma línea reingresada -- válido con cfdis (1 línea/factura,
-- nunca colisionaba) pero no con cfdi_completo, donde una factura trae hasta 49 líneas y
-- es normal que dos conceptos DISTINTOS compartan producto+cantidad+precio+descripción
-- (p.ej. dos entregas iguales el mismo día). Medido contra BigQuery real: 217/614 facturas
-- de gas tenían colisiones así, perdiendo 1.273 líneas reales -- sin efecto en importe_gas
-- ni es_mixta (0 facturas cambiaban, la colisión siempre caía dentro de la misma categoría
-- gas/no-gas), pero sí en n_lineas_total/conceptos_gas (la evidencia auditable de M1).
-- concepto_idx es el índice posicional real de la línea dentro del CFDI -- una reingesta
-- duplica el mismo concepto_idx (mismo _id, confirmado), así que dedupear por
-- UUID+concepto_idx (quedándonos con el _ingested_at más reciente) colapsa solo eso, nunca
-- líneas legítimamente distintas.
DECLARE cutoff_fecha_negocio DATE DEFAULT '2026-01-01';

CREATE OR REPLACE TABLE `proan-quantrue.D60_REPORTING.HCARB_GOLD_CLASIFICACION_FOLIO` AS
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
  -- FIX jul-2026 (investigación confianza_mseg): importe_gas ya NO suma solo las líneas
  -- de gas que trae cfdis -- para 414/547 facturas cfdis solo trae 1 línea (de gas,
  -- internamente consistente: Cantidad*ValorUnitario=Importe) mientras SubTotal es 17-22x
  -- mayor -- el SAT exige SubTotal=suma de TODOS los conceptos para timbrar, así que a esas
  -- facturas les faltan líneas en la extracción de cfdis (no se pueden recuperar, no hay
  -- fuente mejor). Confirmado con una fuente independiente (proan_MSEG_HIDROCARBUROS,
  -- SAP): su importe de recepción reconcilia con SubTotal (mediana ratio 1.0) en el 100% de
  -- los casos, mixtos o no -- nunca con el importe_gas viejo para los mixtos (20.2x). Se
  -- resta el importe no-gas confirmado del SubTotal (fuente validada por el SAT) en vez de
  -- sumar las líneas de gas que veamos -- funciona aunque falten líneas de gas en cfdis, y
  -- sigue siendo correcto si algún día aparece una factura genuinamente mixta.
  ANY_VALUE(c.SubTotal) - SUM(IF(NOT c.es_linea_gas, c.Importe, 0)) AS importe_gas,
  -- es_mixta ya NO compara SubTotal contra importe_gas (eso es lo que estaba mal:
  -- comparar el SubTotal bueno contra el importe_gas roto siempre parecía "mixta").
  -- Ahora es directamente "¿hay una línea real marcada como no-gas?" -- con los datos
  -- de hoy, 0 facturas la tienen (las 414 "mixtas" del hallazgo de Fase 1 §16 eran este
  -- mismo bug, no mezcla real de producto).
  COUNTIF(NOT c.es_linea_gas) > 0 AS es_mixta,
  COUNTIF(c.es_linea_gas) AS n_lineas_gas,
  COUNT(*) AS n_lineas_total,
  -- Claves SAT distintas que clasificaron la factura como gas (para badge/filtro).
  ARRAY_AGG(DISTINCT IF(c.es_linea_gas, c.ClaveProdServ, NULL) IGNORE NULLS) AS claves_gas,
  -- Material/cantidad "principal" (jul-2026, para columnas de M1): de la línea de gas de
  -- mayor importe -- en la práctica casi siempre hay una sola línea de gas por factura
  -- (README: 1.035+18+3=1.056), así que esto ya cubre la inmensa mayoría sin ambigüedad.
  ARRAY_AGG(IF(c.es_linea_gas, c.Descripcion, NULL) IGNORE NULLS ORDER BY c.Importe DESC LIMIT 1)[SAFE_OFFSET(0)] AS material_principal,
  ARRAY_AGG(IF(c.es_linea_gas, c.Cantidad, NULL) IGNORE NULLS ORDER BY c.Importe DESC LIMIT 1)[SAFE_OFFSET(0)] AS cantidad_principal,
  ARRAY_AGG(IF(c.es_linea_gas, c.ClaveUnidad, NULL) IGNORE NULLS ORDER BY c.Importe DESC LIMIT 1)[SAFE_OFFSET(0)] AS clave_unidad_principal,
  -- Líneas de gas con su clave + descripción + cantidad/unidad/importe (evidencia de por qué
  -- la factura es gas). Grano línea anidado dentro de la factura, ordenado por importe desc.
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
