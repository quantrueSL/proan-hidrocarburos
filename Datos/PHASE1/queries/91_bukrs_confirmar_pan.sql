-- Confirmar que BUKRS='PAN' = Proteína Animal, y ver si hay OTRAS sociedades
-- mezcladas en el MSEG de hidrocarburos.
SELECT * FROM `proan-quantrue.D20_DIMENSION.dm_company` WHERE company_code = 'PAN' OR company LIKE '%PAN%' LIMIT 10;
