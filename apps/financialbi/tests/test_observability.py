from __future__ import annotations

import json
import unittest
from concurrent.futures import ThreadPoolExecutor
from unittest.mock import patch

from financialbi import observability


class _FakeJob:
    def __init__(self, value: object | None = None, error: Exception | None = None) -> None:
        self.value = value
        self.error = error

    def result(self) -> object:
        if self.error is not None:
            raise self.error
        return self.value


class _FakeClient:
    def __init__(self, job: _FakeJob | None = None, error: Exception | None = None) -> None:
        self.job = job
        self.error = error

    def query(self, *_args: object, **_kwargs: object) -> _FakeJob:
        if self.error is not None:
            raise self.error
        assert self.job is not None
        return self.job


class ObservabilityTests(unittest.TestCase):
    def test_event_is_json_and_has_request_context(self) -> None:
        with patch.object(observability._structured_log, "info") as info:
            token = observability.bind_request("request-1", "/health")
            try:
                observability.emit_event("http_request", status_code=200, duration_ms=12.5)
            finally:
                observability.reset_request(token)

        payload = json.loads(info.call_args.args[0])
        self.assertEqual(payload["event"], "http_request")
        self.assertEqual(payload["request_id"], "request-1")
        self.assertEqual(payload["endpoint"], "/health")
        self.assertEqual(payload["status_code"], 200)

    def test_bigquery_result_records_duration_without_sql(self) -> None:
        client = observability.ObservedBigQueryClient(_FakeClient(job=_FakeJob(value=[{"total": 1}])))
        with patch.object(observability, "emit_event") as emit:
            result = client.query("SELECT sensitive_sql").result()

        self.assertEqual(result, [{"total": 1}])
        event, = emit.call_args.args
        self.assertEqual(event, "bigquery_query")
        self.assertEqual(emit.call_args.kwargs["outcome"], "ok")
        self.assertNotIn("query", emit.call_args.kwargs)

    def test_bigquery_failure_records_error(self) -> None:
        client = observability.ObservedBigQueryClient(_FakeClient(job=_FakeJob(error=RuntimeError("fallo"))))
        with patch.object(observability, "emit_event") as emit:
            with self.assertRaisesRegex(RuntimeError, "fallo"):
                client.query("SELECT sensitive_sql").result()

        self.assertEqual(emit.call_args.args, ("bigquery_query",))
        self.assertEqual(emit.call_args.kwargs["outcome"], "error")

    def test_context_reaches_worker_threads(self) -> None:
        token = observability.bind_request("request-1", "/dashboard")
        try:
            with ThreadPoolExecutor(max_workers=1) as executor:
                future = observability.submit_with_request_context(
                    executor,
                    observability._request_context.get,
                )
                context = future.result()
        finally:
            observability.reset_request(token)

        self.assertIsNotNone(context)
        self.assertEqual(context.request_id, "request-1")
        self.assertEqual(context.endpoint, "/dashboard")

if __name__ == "__main__":
    unittest.main()
