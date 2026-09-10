from __future__ import annotations

import unittest
from unittest.mock import patch

from facturas_api import repository


class BuscarFacturasQueryTests(unittest.TestCase):
    def test_nucleo_se_combina_con_los_demas_filtros_sin_duplicar_filas(self):
        with patch.object(repository, "_rows", return_value=[]) as rows:
            repository.buscar_facturas(
                rfc_emisor=["AAA010101AAA", "BBB020202BBB"],
                serie=None,
                folio=None,
                fecha_desde="2026-09-01",
                fecha_hasta="2026-09-30",
                nucleo=["Núcleo Norte", "Núcleo Sur"],
                limit=25,
                offset=100,
            )

        query, params = rows.call_args.args
        self.assertIn("c.EmisorRfc IN UNNEST(@rfc_emisor)", query)
        self.assertIn("SUBSTR(c.Fecha, 1, 10) >= @fecha_desde", query)
        self.assertIn("SUBSTR(c.Fecha, 1, 10) <= @fecha_hasta", query)
        self.assertIn("nuc.nucleo IN UNNEST(@nucleo)", query)
        self.assertIn("EXISTS (", query)
        self.assertIn("ARRAY_AGG(DISTINCT nuc_reparto.nucleo", query)
        self.assertIn("LIMIT @limit", query)
        self.assertIn("OFFSET @offset", query)
        self.assertEqual([param.name for param in params], ["rfc_emisor", "fecha_desde", "fecha_hasta", "nucleo", "limit", "offset"])

    def test_sin_nucleo_conserva_la_busqueda_actual(self):
        with patch.object(repository, "_rows", return_value=[]) as rows:
            repository.buscar_facturas(
                rfc_emisor=None,
                serie=None,
                folio=None,
                fecha_desde=None,
                fecha_hasta=None,
                nucleo=None,
                limit=100,
                offset=0,
            )

        query, params = rows.call_args.args
        self.assertNotIn("nuc.nucleo IN UNNEST(@nucleo)", query)
        self.assertIn("LIMIT @limit", query)
        self.assertEqual([param.name for param in params], ["limit", "offset"])
