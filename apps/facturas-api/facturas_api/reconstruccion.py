"""Reconstrucción del XML del CFDI a partir de `cfdi_raw.comprobante_json`.

`comprobante_json` (BigQuery, `D00_SANDBOX.cfdi_raw`) es el árbol XML completo
del CFDI convertido a JSON: los atributos llevan el prefijo "@" (convención
tipo `xmltodict`) y los valores se preservan como texto literal, no como
números reparseados -- por eso, a diferencia de `cfdi_cabecera`/`conceptos`/
`complementos` (que sí pierden precisión al tipar cada columna), este sí basta
para reconstruir un XML fiel al original.

Validado manualmente contra dos facturas reales (una simple y una mixta de 131
líneas de concepto): el XML reconstruido es bien formado y `SelloCFD`,
`SelloSAT`, `NoCertificado` y los totales coinciden carácter a carácter con lo
que guarda `cfdi_cabecera` para el mismo UUID.
"""

from __future__ import annotations

import json
import xml.etree.ElementTree as ET

_CFDI_NS = "http://www.sat.gob.mx/cfd/4"


class ReconstruccionInvalida(Exception):
    """El `comprobante_json` no tiene la forma esperada de un CFDI."""


def _build_element(tag: str, node: object) -> ET.Element:
    elem = ET.Element(tag)
    if isinstance(node, dict):
        for key, value in node.items():
            if key.startswith("@"):
                elem.set(key[1:], str(value))
            elif key == "#text":
                elem.text = str(value)
            elif isinstance(value, list):
                for item in value:
                    elem.append(_build_element(key, item))
            else:
                elem.append(_build_element(key, value))
    else:
        elem.text = str(node)
    return elem


def reconstruir_xml(comprobante_json: str) -> bytes:
    """Convierte el `comprobante_json` de una fila de `cfdi_raw` en los bytes
    de un documento XML bien formado, con declaración UTF-8.

    Levanta `ReconstruccionInvalida` si el JSON no se puede parsear o no tiene
    la forma esperada (nodo raíz `cfdi:Comprobante`) -- el llamador lo traduce
    a un 503 `generacion_no_disponible`, nunca a un 500 genérico, porque es un
    fallo de datos de ESA factura concreta, no del servicio.
    """
    try:
        data = json.loads(comprobante_json)
    except (TypeError, json.JSONDecodeError) as exc:
        raise ReconstruccionInvalida(f"comprobante_json no es JSON válido: {exc}") from exc

    if not isinstance(data, dict) or len(data) != 1:
        raise ReconstruccionInvalida("comprobante_json no tiene un único nodo raíz.")

    root_tag, root_node = next(iter(data.items()))
    if not root_tag.endswith(":Comprobante"):
        raise ReconstruccionInvalida(f"nodo raíz inesperado: {root_tag!r}")

    try:
        root = _build_element(root_tag, root_node)
        xml_bytes = ET.tostring(root, encoding="utf-8", xml_declaration=True)
    except Exception as exc:  # noqa: BLE001 -- cualquier fallo de forma se trata igual
        raise ReconstruccionInvalida(f"no se pudo serializar el XML: {exc}") from exc

    return xml_bytes


def parse_reconstruido(xml_bytes: bytes) -> ET.Element:
    """Re-parsea el XML ya reconstruido, para que `render_pdf` trabaje sobre
    un `Element` con namespaces resueltos en vez de tener que re-serializar."""
    return ET.fromstring(xml_bytes)
