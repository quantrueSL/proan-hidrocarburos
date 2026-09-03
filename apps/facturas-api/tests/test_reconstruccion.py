"""Pruebas de `reconstruccion.py` con un `comprobante_json` SINTÉTICO -- no se
usa ningún dato real de ninguna factura. La fidelidad contra datos reales ya
se validó a mano en la investigación (dos facturas reales, una simple y una
mixta de 131 líneas: XML bien formado y sellos/totales coincidiendo exacto
contra `cfdi_cabecera`); estas pruebas solo protegen la lógica de conversión
JSON->XML frente a regresiones.
"""

from __future__ import annotations

import json
import unittest
import xml.etree.ElementTree as ET

from facturas_api.reconstruccion import ReconstruccionInvalida, reconstruir_xml

_NS = {"cfdi": "http://www.sat.gob.mx/cfd/4", "tfd": "http://www.sat.gob.mx/TimbreFiscalDigital"}

_COMPROBANTE_SINTETICO = {
    "cfdi:Comprobante": {
        "@xmlns:cfdi": "http://www.sat.gob.mx/cfd/4",
        "@Version": "4.0",
        "@Serie": "TST",
        "@Folio": "1",
        "@Fecha": "2026-01-01T00:00:00",
        "@Sello": "sello-de-prueba",
        "@SubTotal": "100.00",
        "@Total": "116.00",
        "@Moneda": "MXN",
        "@TipoDeComprobante": "I",
        "cfdi:Emisor": {"@Rfc": "AAA010101AAA", "@Nombre": "EMISOR DE PRUEBA", "@RegimenFiscal": "601"},
        "cfdi:Receptor": {"@Rfc": "BBB020202BBB", "@Nombre": "RECEPTOR DE PRUEBA", "@UsoCFDI": "G03"},
        "cfdi:Conceptos": {
            "cfdi:Concepto": [
                {
                    "@ClaveProdServ": "84111505",
                    "@Cantidad": "7.000",
                    "@ClaveUnidad": "ACT",
                    "@Descripcion": "Concepto uno",
                    "@ValorUnitario": "50.00",
                    "@Importe": "50.00",
                },
                {
                    "@ClaveProdServ": "84111505",
                    "@Cantidad": "1",
                    "@ClaveUnidad": "ACT",
                    "@Descripcion": "Concepto dos",
                    "@ValorUnitario": "50.00",
                    "@Importe": "50.00",
                },
            ]
        },
        "cfdi:Complemento": {
            "tfd:TimbreFiscalDigital": {
                "@xmlns:tfd": "http://www.sat.gob.mx/TimbreFiscalDigital",
                "@UUID": "00000000-0000-0000-0000-000000000000",
                "@SelloCFD": "sello-de-prueba",
                "@SelloSAT": "sello-sat-de-prueba",
            }
        },
    }
}


class ReconstruirXmlTests(unittest.TestCase):
    def test_bien_formado_y_reparseable(self):
        xml_bytes = reconstruir_xml(json.dumps(_COMPROBANTE_SINTETICO))
        root = ET.fromstring(xml_bytes)  # no debe lanzar
        self.assertEqual(root.tag, "{http://www.sat.gob.mx/cfd/4}Comprobante")

    def test_valores_literales_no_se_normalizan(self):
        xml_bytes = reconstruir_xml(json.dumps(_COMPROBANTE_SINTETICO))
        # "7.000" debe seguir siendo "7.000" en el XML, no "7.0" ni "7" --
        # es justo lo que distingue a cfdi_raw de las tablas ya tipadas.
        self.assertIn(b'Cantidad="7.000"', xml_bytes)

    def test_conceptos_multiples_se_reconstruyen_todos(self):
        xml_bytes = reconstruir_xml(json.dumps(_COMPROBANTE_SINTETICO))
        root = ET.fromstring(xml_bytes)
        conceptos = root.findall("cfdi:Conceptos/cfdi:Concepto", _NS)
        self.assertEqual(len(conceptos), 2)
        self.assertEqual(conceptos[0].get("Descripcion"), "Concepto uno")
        self.assertEqual(conceptos[1].get("Descripcion"), "Concepto dos")

    def test_timbre_fiscal_presente(self):
        xml_bytes = reconstruir_xml(json.dumps(_COMPROBANTE_SINTETICO))
        root = ET.fromstring(xml_bytes)
        timbre = root.find("cfdi:Complemento/tfd:TimbreFiscalDigital", _NS)
        self.assertIsNotNone(timbre)
        self.assertEqual(timbre.get("SelloSAT"), "sello-sat-de-prueba")

    def test_json_invalido_levanta_reconstruccion_invalida(self):
        with self.assertRaises(ReconstruccionInvalida):
            reconstruir_xml("esto no es json")

    def test_nodo_raiz_inesperado_levanta_reconstruccion_invalida(self):
        with self.assertRaises(ReconstruccionInvalida):
            reconstruir_xml(json.dumps({"algo:Distinto": {"@x": "1"}}))

    def test_raiz_con_mas_de_un_nodo_levanta_reconstruccion_invalida(self):
        payload = dict(_COMPROBANTE_SINTETICO)
        payload["otro:Nodo"] = {"@x": "1"}
        with self.assertRaises(ReconstruccionInvalida):
            reconstruir_xml(json.dumps(payload))


if __name__ == "__main__":
    unittest.main()
