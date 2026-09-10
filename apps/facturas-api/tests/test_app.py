from __future__ import annotations

import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient

from facturas_api.app import app


class BuscarFacturasTests(unittest.TestCase):
    def test_reenvia_nucleo_y_devuelve_nucleos(self):
        row = {
            "uuid": "00000000-0000-0000-0000-000000000000",
            "serie": "A",
            "folio": "1",
            "fecha": "2026-09-01T00:00:00",
            "rfc_emisor": "AAA010101AAA",
            "nombre_emisor": "Proveedor",
            "total": 100,
            "moneda": "MXN",
            "estatus_cancelacion": "vigente",
            "nucleos": ["Núcleo Norte", "Núcleo Sur"],
        }
        with patch("facturas_api.app.repository.buscar_facturas", return_value=[row]) as buscar:
            response = TestClient(app).get(
                "/v1/facturas",
                params={
                    "rfc_emisor": ["AAA010101AAA", "BBB020202BBB"],
                    "fecha_desde": "2026-09-01",
                    "fecha_hasta": "2026-09-30",
                    "nucleo": ["Núcleo Norte", "Núcleo Sur"],
                    "limit": "25",
                    "offset": "100",
                },
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()[0]["nucleos"], ["Núcleo Norte", "Núcleo Sur"])
        self.assertEqual(buscar.call_args.kwargs["rfc_emisor"], ["AAA010101AAA", "BBB020202BBB"])
        self.assertEqual(buscar.call_args.kwargs["nucleo"], ["Núcleo Norte", "Núcleo Sur"])
        self.assertEqual(buscar.call_args.kwargs["limit"], 25)
        self.assertEqual(buscar.call_args.kwargs["offset"], 100)

    def test_metadata_sin_nucleo_devuelve_lista_vacia(self):
        row = {
            "uuid": "00000000-0000-0000-0000-000000000000",
            "nucleos": None,
        }
        with patch("facturas_api.app.repository.get_factura_metadata", return_value=row):
            response = TestClient(app).get("/v1/facturas/00000000-0000-0000-0000-000000000000")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["nucleos"], [])
