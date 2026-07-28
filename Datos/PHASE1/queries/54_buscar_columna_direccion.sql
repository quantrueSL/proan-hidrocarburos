-- EKBE no tiene campo de proveedor (solo EBELN), y sin EKKO/EKPO no hay forma de cruzarlo
-- por proveedor -- descartado como vía para el rastro de GNC-servicio.
-- Último intento para D4: buscar por COLUMNA (no por nombre de tabla) cualquier campo de
-- dirección en el dataset de dimensiones, por si la dirección de planta vive en otro lado.
SELECT table_name, column_name
FROM `proan-quantrue.D20_DIMENSION.INFORMATION_SCHEMA.COLUMNS`
WHERE REGEXP_CONTAINS(UPPER(column_name), r'DIRECCION|DOMICILIO|CALLE|ADDRESS|UBICACION|MUNICIPIO|COLONIA')
ORDER BY table_name, column_name;
