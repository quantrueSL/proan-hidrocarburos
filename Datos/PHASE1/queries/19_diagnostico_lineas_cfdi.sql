-- ¿Los CFDIs de este proveedor de gas tienen varias líneas/conceptos por UUID?
-- Si es así, "Importe" (por línea) no es comparable contra DMBTR (documento completo);
-- habría que comparar contra "Total" agregado por UUID.
SELECT UUID, COUNT(*) AS n_lineas, SUM(Importe) AS suma_importe_lineas, ANY_VALUE(Total) AS total_factura
FROM `proan-quantrue.D00_SANDBOX.cfdis`
WHERE EmisorRfc = 'DGN811026BU6'
  AND ClaveProdServ LIKE '151115%'
  AND FechaTimbrado >= '2026-01-01'
GROUP BY UUID
ORDER BY n_lineas DESC
LIMIT 20;
