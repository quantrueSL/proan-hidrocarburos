from __future__ import annotations

import threading
import unittest
from unittest.mock import patch

from financialbi import aprobacion_engine, dashboard_engine, hidrocarburos_engine


class QueryConcurrencyTests(unittest.TestCase):
    def test_invoice_count_and_rows_run_concurrently(self) -> None:
        barrier = threading.Barrier(2)

        def fake_rows(query: str, _params: list[object]) -> list[dict[str, object]]:
            barrier.wait(timeout=1)
            return [{"total": 1}] if "COUNT(*)" in query else [{"uuid": "invoice-1"}]

        with patch.object(hidrocarburos_engine, "_rows", side_effect=fake_rows):
            result = hidrocarburos_engine.search(page=1, page_size=50)

        self.assertEqual(result["total"], 1)
        self.assertEqual(result["rows"], [{"uuid": "invoice-1"}])

    def test_queue_summary_and_rows_run_concurrently(self) -> None:
        barrier = threading.Barrier(2)

        def fake_rows(query: str, _params: list[object]) -> list[dict[str, object]]:
            barrier.wait(timeout=1)
            if "COUNT(*) AS total" in query:
                return [{"total": 1, "importe_gas_total": 25, "validadas_sap": 1, "con_mseg": 1}]
            return [{"uuid": "invoice-1"}]

        with patch.object(aprobacion_engine, "_rows", side_effect=fake_rows):
            result = aprobacion_engine._paginar_cola("FROM example", [], "uuid", 1, 50)

        self.assertEqual(result["total"], 1)
        self.assertEqual(result["rows"], [{"uuid": "invoice-1", "ceco_por_ticket": None}])

    def test_dashboard_blocks_run_concurrently(self) -> None:
        barrier = threading.Barrier(6)

        def result(value: object):
            def run(_where: str, _params: list[object]) -> object:
                barrier.wait(timeout=1)
                return value
            return run

        with (
            patch.object(dashboard_engine, "_resumen_estatus", side_effect=result({"total_facturas": 1})),
            patch.object(dashboard_engine, "_gasto_por_proveedor", side_effect=result([{"grupo": "A"}])),
            patch.object(dashboard_engine, "_gasto_por_sitio", side_effect=result([{"grupo": "B"}])),
            patch.object(dashboard_engine, "_gasto_por_ceco", side_effect=result([{"grupo": "C"}])),
            patch.object(dashboard_engine, "_gasto_por_nucleo", side_effect=result([{"grupo": "N"}])),
            patch.object(dashboard_engine, "_gasto_por_periodo", side_effect=result([{"grupo": "2026-07"}])),
        ):
            result_payload = dashboard_engine.resumen_completo()

        self.assertEqual(result_payload["resumen"]["total_facturas"], 1)
        self.assertEqual(result_payload["gasto_por_nucleo"][0]["grupo"], "N")
        self.assertEqual(result_payload["gasto_por_periodo"][0]["grupo"], "2026-07")

    def test_dashboard_volume_is_normalized_to_liters(self) -> None:
        expression = dashboard_engine._volumen_litros("invoice")

        self.assertIn(
            "invoice.clave_unidad_principal = 'LTR' THEN COALESCE(invoice.cantidad_principal, 0)",
            expression,
        )
        self.assertIn(
            "invoice.clave_unidad_principal = 'MTQ' THEN COALESCE(invoice.cantidad_principal, 0) * 1000",
            expression,
        )
        self.assertIn("ELSE 0", expression)

    def test_dashboard_interactive_filters_are_parameterized(self) -> None:
        where, params = dashboard_engine._construir_filtro(
            None, None, None, None, None, None,
            periodo="2026-07",
            sitio="Centro Norte",
            ceco="__SIN_CECO__",
            estado_aprobacion="aprobada",
        )

        self.assertIn("@periodo", where)
        self.assertIn("@sitio", where)
        self.assertIn("COALESCE(a.ceco, s.ceco_sugerido) IS NULL", where)
        self.assertIn("@estado_aprobacion", where)
        self.assertEqual([param.name for param in params], ["periodo", "sitio", "estado_aprobacion"])

        nucleo_where, nucleo_params = dashboard_engine._construir_filtro(
            None, None, None, None, None, None, nucleo="Reproducción de Aves"
        )
        self.assertIn("nuc.nucleo = @nucleo", nucleo_where)
        self.assertEqual([param.name for param in nucleo_params], ["nucleo"])

        sin_nucleo_where, sin_nucleo_params = dashboard_engine._construir_filtro(
            None, None, None, None, None, None, nucleo="__SIN_NUCLEO__"
        )
        self.assertIn("estado_identificacion_ceco = 'confirmado'", sin_nucleo_where)
        self.assertIn("estado_asignacion_nucleo = 'confirmada'", sin_nucleo_where)
        self.assertIn("a.ceco_por_ticket IS NULL", sin_nucleo_where)
        self.assertIn("a.ceco_por_ticket IS NOT NULL", sin_nucleo_where)
        self.assertEqual(sin_nucleo_params, [])

    def test_nucleo_catalog_only_reads_confirmed_rows(self) -> None:
        with patch.object(aprobacion_engine, "_rows", return_value=[]) as rows:
            aprobacion_engine.catalogo_nucleo()

        self.assertIn("WHERE estado_identificacion_ceco = 'confirmado'", rows.call_args.args[0])
        self.assertIn("estado_asignacion_nucleo = 'confirmada'", rows.call_args.args[0])

    def test_dashboard_detail_removes_internal_total(self) -> None:
        row = {"_total": 3, "uuid": "invoice-1"}
        with patch.object(dashboard_engine, "_rows", return_value=[row]) as rows:
            result = dashboard_engine.facturas_detalle()

        self.assertEqual(result["total"], 3)
        self.assertEqual(result["rows"], [{"uuid": "invoice-1"}])
        query = rows.call_args.args[0]
        self.assertIn("reparto.cecos", query)
        self.assertIn("reparto.nucleos", query)
        self.assertIn("reparto.cecos_sin_nucleo", query)

    def test_text_search_is_parameterized(self) -> None:
        where, params = hidrocarburos_engine._filters(busqueda=" GCRE13556 ")

        self.assertIn("@busqueda", where)
        self.assertIn("f.serie", where)
        self.assertEqual(params[0].name, "busqueda")
        self.assertEqual(params[0].value, "GCRE13556")

        approval_where, approval_params = aprobacion_engine._filtros_cola(busqueda=" GCRE13556 ")
        self.assertIn("f.serie", approval_where)
        self.assertEqual(approval_params[0].value, "GCRE13556")


if __name__ == "__main__":
    unittest.main()
