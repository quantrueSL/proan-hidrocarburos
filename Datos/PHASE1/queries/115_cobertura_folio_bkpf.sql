-- Las facturas de gas SÍ están registradas en SAP FI. 918 de 1.051 folios (87%) aparecen en
-- bkpf_account_document_header.XBLNR_reference_document_number. Por tipo de documento:
--   RE = 847 folios (Rechnungseingang = registro de factura de proveedor / cuenta por pagar)
--   WE = 908 folios (recepción de mercancía; incluye recepciones de servicio sin material de gas)
-- Es el ancla de conciliación que bsik/bsak NO daba (0.2%). Habilita que el Módulo 2 valide
-- "¿SAP registró esta factura?" para el ~81% (RE).
-- CAVEAT: el match es por folio SOLO (sin RFC) -> cruzar con RFC+importe para descartar colisiones
-- (los folios distintivos tipo GCRE##### y los tipos de doc RE/WE lo hacen muy probable real).
WITH gas AS (
  SELECT DISTINCT UPPER(REPLACE(CONCAT(IFNULL(Serie,''),CAST(Folio AS STRING)),' ','')) AS folio_key
  FROM `proan-quantrue.D00_SANDBOX.cfdis`
  WHERE ReceptorRfc='PAN921013AK7' AND (ClaveProdServ LIKE '151115%' OR ClaveProdServ IN ('83101600','83101601'))
)
SELECT b.BLART_document_type, COUNT(DISTINCT g.folio_key) AS n_folios_gas
FROM `proan-quantrue.D30_INTEGRATION.bkpf_account_document_header` b
JOIN gas g ON UPPER(REPLACE(TRIM(b.XBLNR_reference_document_number),' ',''))=g.folio_key
GROUP BY b.BLART_document_type
ORDER BY n_folios_gas DESC;

-- Total de folios de gas presentes en BKPF (cualquier tipo): 918 de 1.051 (87%).
