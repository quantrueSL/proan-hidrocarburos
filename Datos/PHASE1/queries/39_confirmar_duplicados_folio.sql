-- Confirmar: ¿hay MBLNR distintos (documentos SAP distintos) que referencian el MISMO folio
-- de factura (mismo XBLNR_MKPF), y por eso "compiten" por el mismo CFDI?
WITH mseg_docs AS (
  SELECT DISTINCT mseg.MBLNR
  FROM `proan-quantrue.D00_SANDBOX.proan_MSEG_HIDROCARBUROS_20260714` mseg
  LEFT JOIN `proan-quantrue.D20_DIMENSION.dm_material`
    ON mseg.MATNR = material_number
  WHERE external_material_group LIKE '151115%'
),
mseg_base AS (
  SELECT DISTINCT mseg.MBLNR, mseg.XBLNR_MKPF, mseg.BUDAT_MKPF, mseg.DMBTR, mseg.ERFMG, mseg.BWART, dm_v.rfc
  FROM `proan-quantrue.D00_SANDBOX.proan_MSEG_HIDROCARBUROS_20260714` mseg
  INNER JOIN mseg_docs USING (MBLNR)
  LEFT JOIN `proan-quantrue.D20_DIMENSION.dm_material`  dm_m ON mseg.MATNR = dm_m.material_number
  LEFT JOIN `proan-quantrue.D20_DIMENSION.dm_vendors`   dm_v ON mseg.LIFNR = dm_v.id_proveedor
  WHERE dm_m.external_material_group LIKE '151115%' AND dm_v.rfc IS NOT NULL
)
SELECT XBLNR_MKPF, COUNT(DISTINCT MBLNR) AS n_documentos_mismo_folio,
  STRING_AGG(DISTINCT MBLNR ORDER BY MBLNR) AS mblnrs,
  STRING_AGG(DISTINCT BWART) AS bwarts,
  STRING_AGG(DISTINCT CAST(BUDAT_MKPF AS STRING) ORDER BY CAST(BUDAT_MKPF AS STRING)) AS fechas,
  STRING_AGG(DISTINCT CAST(ROUND(DMBTR,2) AS STRING) ORDER BY CAST(ROUND(DMBTR,2) AS STRING)) AS importes_mseg
FROM mseg_base
WHERE rfc = 'DGN811026BU6'
GROUP BY XBLNR_MKPF
HAVING COUNT(DISTINCT MBLNR) > 1
ORDER BY XBLNR_MKPF;
