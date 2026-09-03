"""Representación impresa (PDF) de un CFDI ya reconstruido.

No hace falta un PAC ni volver a timbrar nada: la validez fiscal vive en el
sello que ya trae el XML (calculado en su momento por el PAC/SAT), no en el
PDF. Cualquiera puede generar la representación impresa a partir de un XML
timbrado válido -- quien la reciba verifica escaneando el QR contra el
servidor del SAT en vivo, no contra este PDF.
"""

from __future__ import annotations

import base64
import xml.etree.ElementTree as ET
from io import BytesIO
from pathlib import Path

import qrcode
from jinja2 import Environment, FileSystemLoader, select_autoescape

_NS = {
    "cfdi": "http://www.sat.gob.mx/cfd/4",
    "tfd": "http://www.sat.gob.mx/TimbreFiscalDigital",
}

_QR_URL = "https://verificacfdi.face2.sat.gob.mx/default.aspx"

_env = Environment(
    loader=FileSystemLoader(Path(__file__).parent / "templates"),
    autoescape=select_autoescape(["html"]),
)


def _f(node: ET.Element, attr: str) -> str:
    return node.get(attr, "")


def _construir_qr_data_uri(*, uuid: str, rfc_emisor: str, rfc_receptor: str, total: str, sello: str) -> str:
    """QR estándar del CFDI: `id` (folio fiscal), `re`/`rr` (RFC emisor/receptor),
    `tt` (total a 6 decimales) y `fe` (últimos 8 caracteres del sello)."""
    try:
        total_fmt = f"{float(total):.6f}"
    except (TypeError, ValueError):
        total_fmt = total
    fe = sello[-8:] if sello else ""
    url = f"{_QR_URL}?id={uuid}&re={rfc_emisor}&rr={rfc_receptor}&tt={total_fmt}&fe={fe}"

    img = qrcode.make(url)
    buf = BytesIO()
    img.save(buf, format="PNG")
    return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode("ascii")


def _extraer_contexto(root: ET.Element) -> dict:
    emisor = root.find("cfdi:Emisor", _NS)
    receptor = root.find("cfdi:Receptor", _NS)
    conceptos_el = root.find("cfdi:Conceptos", _NS)
    conceptos = [
        {
            "clave_prod_serv": _f(c, "ClaveProdServ"),
            "no_identificacion": _f(c, "NoIdentificacion"),
            "descripcion": _f(c, "Descripcion"),
            "cantidad": _f(c, "Cantidad"),
            "unidad": _f(c, "Unidad") or _f(c, "ClaveUnidad"),
            "valor_unitario": _f(c, "ValorUnitario"),
            "importe": _f(c, "Importe"),
            "descuento": _f(c, "Descuento"),
        }
        for c in (conceptos_el.findall("cfdi:Concepto", _NS) if conceptos_el is not None else [])
    ]

    timbre = root.find("cfdi:Complemento/tfd:TimbreFiscalDigital", _NS)
    sello = _f(root, "Sello")

    return {
        "version": _f(root, "Version"),
        "serie": _f(root, "Serie"),
        "folio": _f(root, "Folio"),
        "fecha": _f(root, "Fecha"),
        "forma_pago": _f(root, "FormaPago"),
        "metodo_pago": _f(root, "MetodoPago"),
        "moneda": _f(root, "Moneda"),
        "lugar_expedicion": _f(root, "LugarExpedicion"),
        "sub_total": _f(root, "SubTotal"),
        "descuento": _f(root, "Descuento"),
        "total": _f(root, "Total"),
        "tipo_de_comprobante": _f(root, "TipoDeComprobante"),
        "no_certificado": _f(root, "NoCertificado"),
        "sello": sello,
        "emisor_rfc": _f(emisor, "Rfc") if emisor is not None else "",
        "emisor_nombre": _f(emisor, "Nombre") if emisor is not None else "",
        "emisor_regimen": _f(emisor, "RegimenFiscal") if emisor is not None else "",
        "receptor_rfc": _f(receptor, "Rfc") if receptor is not None else "",
        "receptor_nombre": _f(receptor, "Nombre") if receptor is not None else "",
        "receptor_uso_cfdi": _f(receptor, "UsoCFDI") if receptor is not None else "",
        "conceptos": conceptos,
        "uuid": _f(timbre, "UUID") if timbre is not None else "",
        "fecha_timbrado": _f(timbre, "FechaTimbrado") if timbre is not None else "",
        "sello_sat": _f(timbre, "SelloSAT") if timbre is not None else "",
        "sello_cfd": _f(timbre, "SelloCFD") if timbre is not None else sello,
        "no_certificado_sat": _f(timbre, "NoCertificadoSAT") if timbre is not None else "",
    }


def render(xml_root: ET.Element, *, cancelado: bool) -> bytes:
    """Renderiza la representación impresa en PDF a partir del `Element` raíz
    (`cfdi:Comprobante`) ya reconstruido por `reconstruccion.parse_reconstruido`."""
    ctx = _extraer_contexto(xml_root)
    ctx["cancelado"] = cancelado
    ctx["qr_data_uri"] = _construir_qr_data_uri(
        uuid=ctx["uuid"],
        rfc_emisor=ctx["emisor_rfc"],
        rfc_receptor=ctx["receptor_rfc"],
        total=ctx["total"],
        sello=ctx["sello"],
    )

    html = _env.get_template("factura.html").render(**ctx)

    from weasyprint import HTML  # import perezoso: carga libs nativas (Pango/Cairo)

    return HTML(string=html).write_pdf()
