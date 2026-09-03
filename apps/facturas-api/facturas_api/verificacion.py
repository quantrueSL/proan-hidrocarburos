"""Verificación criptográfica del sello digital (`Sello`) de un CFDI 4.0 ya
reconstruido por `reconstruccion.py`.

Construye la "cadena original" siguiendo el algoritmo público del SAT
(`cadenaoriginal_4_0.xslt`, Anexo 20) y valida la firma RSA-SHA256 del
`Sello` contra la llave pública embebida en `Certificado` -- ambos ya vienen
en el propio XML reconstruido, así que esto no depende de ningún servicio
externo ni de la Mongo que investiga Fer.

Reglas de la cadena original (confirmadas contra el XSLT público real del SAT
-- `cadenaoriginal_4_0.xslt` + `utilerias.xslt` -- no solo memoria):
  - Empieza y termina con "||"; los campos van separados por "|".
  - Un atributo opcional AUSENTE (o vacío: `xsl:if test="$valor"` es falso
    para cadena vacía) se omite por completo -- ni valor ni "|".
  - Cada valor pasa por el equivalente de `normalize-space()` (plantilla
    `ManejaEspacios`): espacios internos colapsados a uno solo, recortados al
    inicio/fin. Sin esto, una sola descripción de concepto con espacios
    irregulares invalida toda la cadena -- así se detectó el bug real
    verificando contra una factura mixta de 131 conceptos.
  - `TimbreFiscalDigital` no necesita exclusión explícita: al no tener texto
    (solo atributos) y no existir una plantilla que lo procese en el XSLT
    base, la regla por defecto de XSLT no emite nada para él -- coincide con
    que, en el momento en que el emisor calculó `Sello`, el PAC todavía no
    había timbrado el documento.

Alcance: cubre Comprobante/InformacionGlobal/CfdiRelacionados/Emisor/
Receptor/Conceptos (con impuestos, ACuentaTerceros, InformacionAduanera,
CuentaPredial, Parte) e Impuestos a nivel Comprobante -- el universo real de
las facturas de gas probadas. Los complementos específicos (aparte de
excluir TimbreFiscalDigital) no están cubiertos: cada uno tiene su propio
XSLT de cadena original que el Anexo 20 base no define.
"""

from __future__ import annotations

import base64
import xml.etree.ElementTree as ET

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import padding
from cryptography.x509 import load_der_x509_certificate

_NS = {
    "cfdi": "http://www.sat.gob.mx/cfd/4",
    "tfd": "http://www.sat.gob.mx/TimbreFiscalDigital",
}

_TFD_TAG = "{http://www.sat.gob.mx/TimbreFiscalDigital}TimbreFiscalDigital"


class VerificacionSelloError(Exception):
    """No se pudo ni siquiera intentar la verificación (faltan Sello o
    Certificado en el documento) -- distinto de "la firma no valida"."""


def _normalizar_espacios(valor: str) -> str:
    """Equivalente a XPath `normalize-space()`: colapsa cualquier corrida de
    espacios/tabs/saltos de línea a un solo espacio y recorta los extremos."""
    return " ".join(valor.split())


def _campo(elem: ET.Element | None, attr: str, partes: list[str]) -> None:
    if elem is None:
        return
    valor = elem.get(attr)
    # xsl:if test="$valor" es falso tanto para ausente como para "" -- se
    # omiten igual, sea el campo Requerido u Opcional.
    if valor:
        partes.append(_normalizar_espacios(valor))


def _impuestos_concepto(concepto: ET.Element, partes: list[str]) -> None:
    impuestos = concepto.find("cfdi:Impuestos", _NS)
    if impuestos is None:
        return
    traslados = impuestos.find("cfdi:Traslados", _NS)
    if traslados is not None:
        for t in traslados.findall("cfdi:Traslado", _NS):
            for attr in ("Base", "Impuesto", "TipoFactor", "TasaOCuota", "Importe"):
                _campo(t, attr, partes)
    retenciones = impuestos.find("cfdi:Retenciones", _NS)
    if retenciones is not None:
        for r in retenciones.findall("cfdi:Retencion", _NS):
            for attr in ("Base", "Impuesto", "TipoFactor", "TasaOCuota", "Importe"):
                _campo(r, attr, partes)


def _concepto(concepto: ET.Element, partes: list[str]) -> None:
    for attr in (
        "ClaveProdServ", "NoIdentificacion", "Cantidad", "ClaveUnidad", "Unidad",
        "Descripcion", "ValorUnitario", "Importe", "Descuento", "ObjetoImp",
    ):
        _campo(concepto, attr, partes)

    _impuestos_concepto(concepto, partes)

    for act in concepto.findall("cfdi:ACuentaTerceros", _NS):
        for attr in (
            "RfcACuentaTerceros", "NombreACuentaTerceros",
            "RegimenFiscalACuentaTerceros", "DomicilioFiscalACuentaTerceros",
        ):
            _campo(act, attr, partes)

    for ia in concepto.findall("cfdi:InformacionAduanera", _NS):
        _campo(ia, "NumeroPedimento", partes)

    cuenta_predial = concepto.find("cfdi:CuentaPredial", _NS)
    if cuenta_predial is not None:
        _campo(cuenta_predial, "Numero", partes)

    for parte in concepto.findall("cfdi:Parte", _NS):
        for attr in ("ClaveProdServ", "NoIdentificacion", "Cantidad", "Unidad", "Descripcion", "ValorUnitario", "Importe"):
            _campo(parte, attr, partes)
        for ia in parte.findall("cfdi:InformacionAduanera", _NS):
            _campo(ia, "NumeroPedimento", partes)


def construir_cadena_original(root: ET.Element) -> str:
    """Reconstruye la cadena original de `Sello` -- ver el docstring del
    módulo para las reglas y el alcance cubierto."""
    partes: list[str] = []

    for attr in (
        "Version", "Serie", "Folio", "Fecha", "FormaPago", "NoCertificado",
        "CondicionesDePago", "SubTotal", "Descuento", "Moneda", "TipoCambio",
        "Total", "TipoDeComprobante", "Exportacion", "MetodoPago",
        "LugarExpedicion", "Confirmacion",
    ):
        _campo(root, attr, partes)

    info_global = root.find("cfdi:InformacionGlobal", _NS)
    if info_global is not None:
        for attr in ("Periodicidad", "Meses", "Año"):
            _campo(info_global, attr, partes)

    cfdi_relacionados = root.find("cfdi:CfdiRelacionados", _NS)
    if cfdi_relacionados is not None:
        _campo(cfdi_relacionados, "TipoRelacion", partes)
        for rel in cfdi_relacionados.findall("cfdi:CfdiRelacionado", _NS):
            _campo(rel, "UUID", partes)

    emisor = root.find("cfdi:Emisor", _NS)
    for attr in ("Rfc", "Nombre", "RegimenFiscal", "FacAtrAdquirente"):
        _campo(emisor, attr, partes)

    receptor = root.find("cfdi:Receptor", _NS)
    for attr in (
        "Rfc", "Nombre", "DomicilioFiscalReceptor", "ResidenciaFiscal",
        "NumRegIdTrib", "RegimenFiscalReceptor", "UsoCFDI",
    ):
        _campo(receptor, attr, partes)

    conceptos = root.find("cfdi:Conceptos", _NS)
    if conceptos is not None:
        for concepto in conceptos.findall("cfdi:Concepto", _NS):
            _concepto(concepto, partes)

    impuestos = root.find("cfdi:Impuestos", _NS)
    if impuestos is not None:
        retenciones = impuestos.find("cfdi:Retenciones", _NS)
        if retenciones is not None:
            for r in retenciones.findall("cfdi:Retencion", _NS):
                for attr in ("Impuesto", "Importe"):
                    _campo(r, attr, partes)
        _campo(impuestos, "TotalImpuestosRetenidos", partes)

        traslados = impuestos.find("cfdi:Traslados", _NS)
        if traslados is not None:
            for t in traslados.findall("cfdi:Traslado", _NS):
                for attr in ("Base", "Impuesto", "TipoFactor", "TasaOCuota", "Importe"):
                    _campo(t, attr, partes)
        _campo(impuestos, "TotalImpuestosTrasladados", partes)

    return "||" + "|".join(partes) + "||"


def verificar_sello(root: ET.Element) -> bool:
    """`True` si `Sello` valida (RSA-SHA256, PKCS#1 v1.5) contra la cadena
    original reconstruida y la llave pública de `Certificado` -- ambos
    embebidos en el propio documento, sin llamadas externas.

    Levanta `VerificacionSelloError` si el documento no trae `Sello` o
    `Certificado` (no se puede ni intentar la verificación); devuelve
    `False`, sin levantar excepción, si la firma no valida.
    """
    sello_b64 = root.get("Sello")
    certificado_b64 = root.get("Certificado")
    if not sello_b64 or not certificado_b64:
        raise VerificacionSelloError("El comprobante no trae Sello o Certificado.")

    cadena = construir_cadena_original(root)
    firma = base64.b64decode(sello_b64)
    certificado = load_der_x509_certificate(base64.b64decode(certificado_b64))
    llave_publica = certificado.public_key()

    try:
        llave_publica.verify(
            firma,
            cadena.encode("utf-8"),
            padding.PKCS1v15(),
            hashes.SHA256(),
        )
        return True
    except InvalidSignature:
        return False
