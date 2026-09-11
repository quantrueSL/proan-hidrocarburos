"""Eventos estructurados y contexto de peticiones para Cloud Logging."""

from __future__ import annotations

import json
import logging
import sys
from concurrent.futures import Executor, Future
from contextvars import ContextVar, Token, copy_context
from dataclasses import dataclass
from time import perf_counter
from typing import Any, Callable, TypeVar
from uuid import uuid4

from fastapi import Request
from fastapi.routing import APIRoute
from starlette.responses import Response


T = TypeVar("T")


@dataclass(frozen=True)
class RequestContext:
    request_id: str
    endpoint: str


_request_context: ContextVar[RequestContext | None] = ContextVar("financialbi_request_context", default=None)
_structured_log = logging.getLogger("financialbi.observability")


def _configure_logger() -> None:
    if any(handler.get_name() == "financialbi-structured" for handler in _structured_log.handlers):
        return
    handler = logging.StreamHandler(sys.stdout)
    handler.set_name("financialbi-structured")
    handler.setFormatter(logging.Formatter("%(message)s"))
    _structured_log.addHandler(handler)
    _structured_log.setLevel(logging.INFO)
    _structured_log.propagate = False


_configure_logger()


def bind_request(request_id: str, endpoint: str) -> Token[RequestContext | None]:
    return _request_context.set(RequestContext(request_id=request_id, endpoint=endpoint))


def reset_request(token: Token[RequestContext | None]) -> None:
    _request_context.reset(token)


def emit_event(event: str, **fields: Any) -> None:
    """Escribe JSON válido para que Cloud Logging lo indexe como jsonPayload."""
    payload: dict[str, Any] = {"event": event, "component": "financialbi"}
    context = _request_context.get()
    if context is not None:
        payload["request_id"] = context.request_id
        payload["endpoint"] = context.endpoint
    payload.update({key: value for key, value in fields.items() if value is not None})
    _structured_log.info(json.dumps(payload, separators=(",", ":"), default=str))


def submit_with_request_context(executor: Executor, function: Callable[..., T], *args: Any) -> Future[T]:
    """Propaga el contexto de la petición a las queries concurrentes."""
    context = copy_context()
    return executor.submit(context.run, function, *args)


class ObservedQueryJob:
    """Proxy que mide el tiempo hasta que BigQuery termina el trabajo."""

    def __init__(self, job: Any, started_at: float) -> None:
        self._job = job
        self._started_at = started_at
        self._reported = False

    def result(self, *args: Any, **kwargs: Any) -> Any:
        try:
            result = self._job.result(*args, **kwargs)
        except Exception:
            self._emit("error")
            raise
        self._emit("ok")
        return result

    def _emit(self, outcome: str) -> None:
        if self._reported:
            return
        self._reported = True
        emit_event(
            "bigquery_query",
            outcome=outcome,
            duration_ms=round((perf_counter() - self._started_at) * 1000, 3),
        )

    def __getattr__(self, name: str) -> Any:
        return getattr(self._job, name)


class ObservedBigQueryClient:
    """Proxy transparente del cliente que nunca registra SQL ni parámetros."""

    def __init__(self, client: Any) -> None:
        self._client = client

    def query(self, *args: Any, **kwargs: Any) -> ObservedQueryJob:
        started_at = perf_counter()
        try:
            job = self._client.query(*args, **kwargs)
        except Exception:
            emit_event(
                "bigquery_query",
                outcome="error",
                duration_ms=round((perf_counter() - started_at) * 1000, 3),
            )
            raise
        return ObservedQueryJob(job, started_at)

    def __getattr__(self, name: str) -> Any:
        return getattr(self._client, name)


class ObservedRoute(APIRoute):
    """Mide la petición desde una ruta ya resuelta, sin registrar parámetros."""

    def get_route_handler(self) -> Callable[[Request], Any]:
        route_handler = super().get_route_handler()

        async def observed_route_handler(request: Request) -> Response:
            started_at = perf_counter()
            trace_id = request.headers.get("x-cloud-trace-context", "").split("/", 1)[0]
            token = bind_request(trace_id or str(uuid4()), self.path)
            try:
                response = await route_handler(request)
                emit_event(
                    "http_request",
                    method=request.method,
                    status_code=response.status_code,
                    duration_ms=round((perf_counter() - started_at) * 1000, 3),
                )
                return response
            except Exception:
                emit_event(
                    "http_request",
                    method=request.method,
                    status_code=500,
                    duration_ms=round((perf_counter() - started_at) * 1000, 3),
                )
                raise
            finally:
                reset_request(token)

        return observed_route_handler
