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

    def test_nucleo_id_se_combina_con_el_nombre_en_un_solo_grupo(self):
        with patch.object(repository, "_rows", return_value=[]) as rows:
            repository.buscar_facturas(
                rfc_emisor=None,
                serie=None,
                folio=None,
                fecha_desde=None,
                fecha_hasta=None,
                nucleo=["Cajas"],
                nucleo_id=[19, 22],
                limit=100,
                offset=0,
            )

        query, params = rows.call_args.args
        plano = " ".join(query.split())
        self.assertIn("nuc.nucleo IN UNNEST(@nucleo) OR nuc.nucleo_id IN UNNEST(@nucleo_id)", plano)
        self.assertIn("nuc_ticket.nucleo IN UNNEST(@nucleo) OR nuc_ticket.nucleo_id IN UNNEST(@nucleo_id)", query)
        self.assertEqual([param.name for param in params], ["nucleo", "nucleo_id", "limit", "offset"])
        self.assertEqual(params[1].array_type, "INT64")
        self.assertEqual(params[1].values, [19, 22])

    def test_solo_nucleo_id_no_exige_el_nombre(self):
        with patch.object(repository, "_rows", return_value=[]) as rows:
            repository.buscar_facturas(
                rfc_emisor=None,
                serie=None,
                folio=None,
                fecha_desde=None,
                fecha_hasta=None,
                nucleo=None,
                nucleo_id=[20],
                limit=100,
                offset=0,
            )

        query, params = rows.call_args.args
        self.assertNotIn("@nucleo)", query.replace("@nucleo_id)", ""))
        self.assertIn("nuc.nucleo_id IN UNNEST(@nucleo_id)", query)
        self.assertEqual([param.name for param in params], ["nucleo_id", "limit", "offset"])

    def test_ids_nucleo_validos_devuelve_un_conjunto(self):
        with patch.object(repository, "_rows", return_value=[{"nucleo_id": 19}, {"nucleo_id": 20}]):
            self.assertEqual(repository.ids_nucleo_validos(), {19, 20})
