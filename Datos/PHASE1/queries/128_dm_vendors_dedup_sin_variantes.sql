-- Confirma que el dedup de dm_vendors por id_proveedor (descartando correo_electronico,
-- hallazgo §18) es seguro: para cada id_proveedor con >1 fila, ¿varía alguna OTRA columna
-- entre esas filas, o solo cambia el correo?
-- Resultado (las 20 con más variantes, de los grupos con >1 fila en toda la tabla, 25.110
-- filas): n_variantes_sin_email = 1 en TODOS los casos (incluido id_proveedor 0000009585,
-- que tiene 4 filas). Es decir, ninguna fila duplicada difiere en nada más que el correo --
-- SELECT * EXCEPT(correo_electronico) + QUALIFY ROW_NUMBER()=1 (HCARB_stg_vendors.sql) no
-- pierde ninguna variación real, solo descarta el correo repetido.
SELECT
  id_proveedor,
  COUNT(*) AS n_filas,
  COUNT(DISTINCT TO_JSON_STRING((SELECT AS STRUCT * EXCEPT(correo_electronico) FROM UNNEST([t]) AS t))) AS n_variantes_sin_email
FROM `proan-quantrue.D20_DIMENSION.dm_vendors` AS t
GROUP BY id_proveedor
HAVING n_filas > 1
ORDER BY n_variantes_sin_email DESC
LIMIT 20;
