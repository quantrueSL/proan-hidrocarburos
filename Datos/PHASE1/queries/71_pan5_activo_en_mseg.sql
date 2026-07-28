-- ¿PAN5 (planta Villa Ahumada, recién encontrada en dm_centros) tiene actividad real
-- en MSEG (cualquier material), o es un centro dado de alta pero sin movimientos?
SELECT COUNT(*) AS n_lineas, COUNT(DISTINCT MBLNR) AS n_documentos,
  MIN(_TABLE_SUFFIX) AS primer_dia_visto, MAX(_TABLE_SUFFIX) AS ultimo_dia_visto
FROM `proan-quantrue.D00_SANDBOX.proan_MSEG_2026*`
WHERE WERKS = 'PAN5';
