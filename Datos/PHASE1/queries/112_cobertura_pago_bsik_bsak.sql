-- Punto ciego CRÍTICO (re-revisión jul-2026): NUNCA medimos la COBERTURA de pago, solo validamos
-- la técnica con 1 ejemplo ($6,460.77) y dimos D7 por "Resuelto". Medida real:
--   (a) solo 2 de 1,051 facturas de gas (0.2%) casan con una fila de bsik/bsak por proveedor+Total.
--   (b) solo 3 de los 11 proveedores de gas aparecen SIQUIERA en bsik/bsak; total ~$102K frente a
--       $40.6M facturados. Los mayores (Energas, Natgas, Distribuidora Potosina) tienen 0 filas.
-- Conclusión: bsik/bsak NO es la fuente de estatus de pago para ~99% del universo -> el Módulo 4
-- necesita otra vía (complementos REP, ciclo abierto->compensado, o fuente externa). Ver §19.
-- (a) Cobertura por importe:
WITH vend AS (SELECT DISTINCT rfc, id_proveedor FROM `proan-quantrue.D20_DIMENSION.dm_vendors`),
gas AS (
  SELECT UUID, EmisorRfc, ANY_VALUE(Total) AS total FROM `proan-quantrue.D00_SANDBOX.cfdis`
  WHERE ReceptorRfc='PAN921013AK7' AND (ClaveProdServ LIKE '151115%' OR ClaveProdServ IN ('83101600','83101601'))
  GROUP BY UUID, EmisorRfc),
pagos AS (
  SELECT v.rfc, b.DMBTR FROM (
    SELECT LIFNR, DMBTR FROM `proan-quantrue.D00_SANDBOX.bsik_real_time`
    UNION ALL SELECT LIFNR, DMBTR FROM `proan-quantrue.D00_SANDBOX.bsak_real_time`
  ) b JOIN vend v ON b.LIFNR = v.id_proveedor),
matched AS (SELECT DISTINCT g.UUID FROM gas g JOIN pagos p ON p.rfc=g.EmisorRfc AND ABS(p.DMBTR - g.total) < 1)
SELECT (SELECT COUNT(*) FROM gas) AS total_gas,
  (SELECT COUNT(*) FROM matched) AS con_pago_conciliable_aprox,
  ROUND(100*(SELECT COUNT(*) FROM matched)/(SELECT COUNT(*) FROM gas),1) AS pct;

-- (b) Presencia por proveedor en bsik/bsak:
-- WITH vend AS (SELECT DISTINCT rfc, id_proveedor FROM `proan-quantrue.D20_DIMENSION.dm_vendors`
--   WHERE rfc IN ('DGN811026BU6','CGA9810197C5','HCI8401303N0','GCV610502NY0','DGS071124SN0',
--     'SGA811211ED6','EME0001256D0','DPG840301KFA','NQU120510QZ7','GOJ950110A76','SDG980303CJ5')),
-- pagos AS (SELECT LIFNR,'abierta' t, DMBTR FROM `proan-quantrue.D00_SANDBOX.bsik_real_time`
--   UNION ALL SELECT LIFNR,'compensada', DMBTR FROM `proan-quantrue.D00_SANDBOX.bsak_real_time`)
-- SELECT v.rfc, COUNTIF(p.t='abierta') n_abiertas, COUNTIF(p.t='compensada') n_compensadas, ROUND(SUM(p.DMBTR),0) suma
-- FROM vend v LEFT JOIN pagos p ON p.LIFNR=v.id_proveedor GROUP BY v.rfc ORDER BY n_abiertas+n_compensadas DESC;
