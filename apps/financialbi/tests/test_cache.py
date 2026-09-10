from __future__ import annotations

import threading
import unittest
from unittest.mock import patch

from fastapi import HTTPException

from financialbi import app as financial_app
from financialbi.cache import TTLCache


class FakeClock:
    def __init__(self) -> None:
        self.now = 0.0

    def __call__(self) -> float:
        return self.now


class TTLCacheTests(unittest.TestCase):
    def test_hit_expiration_and_defensive_copy(self) -> None:
        clock = FakeClock()
        cache = TTLCache(name="test", max_entries=2, ttl_seconds=10, clock=clock)
        calls = 0

        def loader() -> dict[str, list[int]]:
            nonlocal calls
            calls += 1
            return {"rows": [calls]}

        first = cache.get_or_load("key", loader)
        first.value["rows"].append(99)
        second = cache.get_or_load("key", loader)
        self.assertTrue(second.hit)
        self.assertEqual(second.value, {"rows": [1]})
        self.assertEqual(second.age_seconds, 0.0)

        clock.now = 10.0
        expired = cache.get_or_load("key", loader)
        self.assertFalse(expired.hit)
        self.assertEqual(expired.value, {"rows": [2]})
        self.assertEqual(calls, 2)

    def test_lru_capacity_and_loader_errors_are_not_cached(self) -> None:
        cache = TTLCache(name="test", max_entries=2, ttl_seconds=10)
        cache.get_or_load("first", lambda: 1)
        cache.get_or_load("second", lambda: 2)
        cache.get_or_load("first", lambda: 1)
        cache.get_or_load("third", lambda: 3)
        self.assertEqual(len(cache), 2)

        calls = 0

        def failing_loader() -> int:
            nonlocal calls
            calls += 1
            raise RuntimeError("BigQuery no disponible")

        with self.assertRaisesRegex(RuntimeError, "BigQuery no disponible"):
            cache.get_or_load("error", failing_loader)
        with self.assertRaisesRegex(RuntimeError, "BigQuery no disponible"):
            cache.get_or_load("error", failing_loader)
        self.assertEqual(calls, 2)

    def test_simultaneous_requests_share_one_loader(self) -> None:
        cache = TTLCache(name="test", max_entries=2, ttl_seconds=10)
        loading = threading.Event()
        release = threading.Event()
        calls = 0
        results: list[object] = []

        def loader() -> dict[str, int]:
            nonlocal calls
            calls += 1
            loading.set()
            self.assertTrue(release.wait(timeout=1))
            return {"value": 1}

        def read() -> None:
            results.append(cache.get_or_load("key", loader))

        first = threading.Thread(target=read)
        second = threading.Thread(target=read)
        first.start()
        self.assertTrue(loading.wait(timeout=1))
        second.start()
        release.set()
        first.join(timeout=1)
        second.join(timeout=1)

        self.assertFalse(first.is_alive())
        self.assertFalse(second.is_alive())
        self.assertEqual(calls, 1)
        self.assertEqual(sorted(result.hit for result in results), [False, True])


class EndpointCacheTests(unittest.TestCase):
    def setUp(self) -> None:
        financial_app._catalog_cache.clear()
        financial_app._dashboard_cache.clear()

    def test_catalog_is_cached_and_returns_isolated_responses(self) -> None:
        with patch.object(financial_app, "hidrocarburos_catalog", return_value={"rows": ["one"]}) as loader:
            first = financial_app.financial_hidrocarburos_catalog()
            first["rows"].append("changed")
            second = financial_app.financial_hidrocarburos_catalog()

        self.assertEqual(loader.call_count, 1)
        self.assertEqual(second, {"rows": ["one"]})

    def test_dashboard_cache_is_keyed_by_filters(self) -> None:
        with patch.object(financial_app, "dashboard_resumen_completo", return_value={"resumen": {"total": 1}}) as loader:
            financial_app.financial_dashboard(financial_app.DashboardFiltros(periodo="2026-07"))
            financial_app.financial_dashboard(financial_app.DashboardFiltros(periodo="2026-07"))
            financial_app.financial_dashboard(financial_app.DashboardFiltros(periodo="2026-08"))

        self.assertEqual(loader.call_count, 2)

    def test_dashboard_detail_routes_bypass_cache(self) -> None:
        with (
            patch.object(financial_app, "dashboard_facturas_detalle", return_value={"rows": []}) as detail,
            patch.object(financial_app, "dashboard_facturas_sat_atencion", return_value={"rows": []}) as detalle_sat,
        ):
            financial_app.financial_dashboard(financial_app.DashboardFiltros(detalle=True))
            financial_app.financial_dashboard(financial_app.DashboardFiltros(detalle=True))
            financial_app.financial_dashboard(financial_app.DashboardFiltros(detalle_sat=True))
            financial_app.financial_dashboard(financial_app.DashboardFiltros(detalle_sat=True))

        self.assertEqual(detail.call_count, 2)
        self.assertEqual(detalle_sat.call_count, 2)

    def test_successful_approval_invalidates_dashboard_but_conflict_does_not(self) -> None:
        dashboard_result = {"resumen": {"total": 1}}
        filtros = financial_app.DashboardFiltros()
        body = financial_app.CapturarCompraBody(usuario="compras", ceco="CC-01")

        with patch.object(financial_app, "dashboard_resumen_completo", return_value=dashboard_result) as dashboard:
            financial_app.financial_dashboard(filtros)
            with patch.object(
                financial_app,
                "capturar_compras",
                return_value={"ok": True, "estado_actual": "pendiente_aprobacion_gerencia"},
            ):
                financial_app.financial_aprobacion_validar_compras("invoice-1", body)
            financial_app.financial_dashboard(filtros)

            with patch.object(
                financial_app,
                "capturar_compras",
                return_value={"ok": False, "estado_actual": "aprobada"},
            ):
                with self.assertRaises(HTTPException):
                    financial_app.financial_aprobacion_validar_compras("invoice-1", body)
            financial_app.financial_dashboard(filtros)

        self.assertEqual(dashboard.call_count, 2)


if __name__ == "__main__":
    unittest.main()
