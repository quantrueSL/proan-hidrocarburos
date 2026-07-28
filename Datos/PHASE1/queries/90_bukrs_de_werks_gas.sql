-- ¿El lado MSEG (WERKS) ya está acotado a la sociedad de Proteína Animal, o mezcla
-- otras sociedades del grupo? BUKRS = sociedad contable en MSEG.
SELECT WERKS, BUKRS, COUNT(*) AS n_lineas
FROM `proan-quantrue.D00_SANDBOX.proan_MSEG_HIDROCARBUROS_20260714`
WHERE WERKS IN ('PAN1','PAN3','PANM','PANR','PAN5')
GROUP BY WERKS, BUKRS
ORDER BY WERKS;
