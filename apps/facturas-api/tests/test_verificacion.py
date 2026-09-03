"""Pruebas de `verificacion.py` con una llave/certificado autofirmados
generados en la propia prueba -- nada de datos reales de ninguna factura.

La fidelidad contra facturas reales ya se probó a mano en la investigación:
dos facturas (una simple, una mixta de 131 líneas de concepto) validan su
`Sello` con este mismo código -- fue justo esa prueba la que encontró que
faltaba `normalize-space()` en los valores antes de concatenarlos.
"""

from __future__ import annotations

import base64
import datetime
import unittest
import xml.etree.ElementTree as ET

from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding, rsa
from cryptography.x509.oid import NameOID

from facturas_api.verificacion import construir_cadena_original, verificar_sello, VerificacionSelloError

_NS = "http://www.sat.gob.mx/cfd/4"


def _certificado_de_prueba() -> tuple[rsa.RSAPrivateKey, bytes]:
    """Genera un par de llaves RSA + certificado autofirmado, solo para la
    prueba -- no tiene nada que ver con ningún certificado real del SAT."""
    llave = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    nombre = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "Prueba")])
    ahora = datetime.datetime.now(datetime.timezone.utc)
    certificado = (
        x509.CertificateBuilder()
        .subject_name(nombre)
        .issuer_name(nombre)
        .public_key(llave.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(ahora - datetime.timedelta(days=1))
        .not_valid_after(ahora + datetime.timedelta(days=1))
        .sign(llave, hashes.SHA256())
    )
    return llave, certificado.public_bytes(serialization.Encoding.DER)


def _comprobante_firmado(*, descripcion_concepto: str) -> ET.Element:
    """Construye un `cfdi:Comprobante` mínimo, calcula su cadena original
    con el propio código bajo prueba y lo firma con una llave de prueba --
    así la prueba no depende de haber acertado la cadena por fuera."""
    llave, certificado_der = _certificado_de_prueba()

    root = ET.Element(f"{{{_NS}}}Comprobante")
    root.set("Version", "4.0")
    root.set("Fecha", "2026-01-01T00:00:00")
    root.set("NoCertificado", "00000000000000000000")
    root.set("SubTotal", "100.00")
    root.set("Moneda", "MXN")
    root.set("Total", "116.00")
    root.set("TipoDeComprobante", "I")
    root.set("Exportacion", "01")
    root.set("LugarExpedicion", "00000")

    emisor = ET.SubElement(root, f"{{{_NS}}}Emisor")
    emisor.set("Rfc", "AAA010101AAA")
    emisor.set("Nombre", "EMISOR DE PRUEBA")
    emisor.set("RegimenFiscal", "601")

    receptor = ET.SubElement(root, f"{{{_NS}}}Receptor")
    receptor.set("Rfc", "BBB020202BBB")
    receptor.set("Nombre", "RECEPTOR DE PRUEBA")
    receptor.set("DomicilioFiscalReceptor", "00000")
    receptor.set("RegimenFiscalReceptor", "601")
    receptor.set("UsoCFDI", "G03")

    conceptos = ET.SubElement(root, f"{{{_NS}}}Conceptos")
    concepto = ET.SubElement(conceptos, f"{{{_NS}}}Concepto")
    concepto.set("ClaveProdServ", "84111505")
    concepto.set("Cantidad", "1")
    concepto.set("ClaveUnidad", "ACT")
    concepto.set("Descripcion", descripcion_concepto)
    concepto.set("ValorUnitario", "100.00")
    concepto.set("Importe", "100.00")
    concepto.set("ObjetoImp", "02")

    cadena = construir_cadena_original(root)
    firma = llave.sign(cadena.encode("utf-8"), padding.PKCS1v15(), hashes.SHA256())

    root.set("Sello", base64.b64encode(firma).decode("ascii"))
    root.set("Certificado", base64.b64encode(certificado_der).decode("ascii"))
    return root


class ConstruirCadenaOriginalTests(unittest.TestCase):
    def test_empieza_y_termina_con_doble_pipe(self):
        root = _comprobante_firmado(descripcion_concepto="Concepto de prueba")
        cadena = construir_cadena_original(root)
        self.assertTrue(cadena.startswith("||"))
        self.assertTrue(cadena.endswith("||"))

    def test_normaliza_espacios_del_valor(self):
        """El bug real encontrado en la investigación: una descripción con
        espacios irregulares debe normalizarse (normalize-space), no copiarse
        tal cual -- si no, la cadena de una factura real con 131 conceptos no
        valida aunque el resto de la lógica sea correcta."""
        root = _comprobante_firmado(descripcion_concepto="Concepto   con    espacios\tirregulares")
        cadena = construir_cadena_original(root)
        self.assertIn("Concepto con espacios irregulares", cadena)
        self.assertNotIn("   ", cadena)

    def test_atributo_opcional_ausente_no_deja_hueco(self):
        root = _comprobante_firmado(descripcion_concepto="Concepto de prueba")
        # Serie/Folio son opcionales y no se fijaron -- no deben aparecer
        # como campos vacíos entre pipes (eso rompería la cadena).
        cadena = construir_cadena_original(root)
        self.assertNotIn("||4.0|||", cadena)  # dos pipes vacíos seguidos = hueco


class VerificarSelloTests(unittest.TestCase):
    def test_sello_valido_con_texto_simple(self):
        root = _comprobante_firmado(descripcion_concepto="Concepto de prueba")
        self.assertTrue(verificar_sello(root))

    def test_sello_valido_con_espacios_irregulares(self):
        """Regresión directa del bug real: antes del fix, este caso fallaba
        la verificación porque la cadena no coincidía con la firmada."""
        root = _comprobante_firmado(descripcion_concepto="Concepto   con    espacios\tirregulares")
        self.assertTrue(verificar_sello(root))

    def test_sello_alterado_no_valida(self):
        root = _comprobante_firmado(descripcion_concepto="Concepto de prueba")
        root.set("Total", "999999.99")  # se altera el documento tras firmarlo
        self.assertFalse(verificar_sello(root))

    def test_sin_sello_levanta_error(self):
        root = ET.Element(f"{{{_NS}}}Comprobante")
        with self.assertRaises(VerificacionSelloError):
            verificar_sello(root)


if __name__ == "__main__":
    unittest.main()
