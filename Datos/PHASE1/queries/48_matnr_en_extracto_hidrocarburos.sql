-- ¿El MATNR del extracto "HIDROCARBUROS" tiene el mismo formato que el MSEG completo (crudo),
-- o el de dm_material? Para saber por qué el JOIN funciona en uno y no en otro.
SELECT DISTINCT MATNR
FROM `proan-quantrue.D00_SANDBOX.proan_MSEG_HIDROCARBUROS_20260714`
WHERE MATNR IS NOT NULL AND MATNR != ''
LIMIT 10;
