"""Caché TTL privada y local para respuestas ya serializables del backend."""

from __future__ import annotations

from collections import OrderedDict
from collections.abc import Callable
from copy import deepcopy
from dataclasses import dataclass
from threading import Event, RLock
from time import monotonic
from typing import Generic, TypeVar


T = TypeVar("T")


@dataclass(frozen=True)
class CacheLookup(Generic[T]):
    value: T
    hit: bool
    age_seconds: float


@dataclass
class _CacheEntry:
    value: object
    created_at: float


@dataclass
class _InFlight:
    done: Event
    error: BaseException | None = None


class TTLCache:
    """LRU TTL local con deduplicación de cargas simultáneas por clave."""

    def __init__(
        self,
        *,
        name: str,
        max_entries: int,
        ttl_seconds: float,
        clock: Callable[[], float] = monotonic,
    ) -> None:
        if max_entries < 1:
            raise ValueError("max_entries debe ser al menos 1")
        if ttl_seconds <= 0:
            raise ValueError("ttl_seconds debe ser mayor que 0")

        self.name = name
        self._max_entries = max_entries
        self._ttl_seconds = ttl_seconds
        self._clock = clock
        self._entries: OrderedDict[str, _CacheEntry] = OrderedDict()
        self._in_flight: dict[str, _InFlight] = {}
        self._generation = 0
        self._lock = RLock()

    def get_or_load(self, key: str, loader: Callable[[], T]) -> CacheLookup[T]:
        """Devuelve una copia aislada; nunca conserva errores del cargador."""
        while True:
            now = self._clock()
            with self._lock:
                entry = self._entries.get(key)
                if entry is not None:
                    age_seconds = now - entry.created_at
                    if age_seconds < self._ttl_seconds:
                        self._entries.move_to_end(key)
                        return CacheLookup(deepcopy(entry.value), True, age_seconds)
                    del self._entries[key]

                in_flight = self._in_flight.get(key)
                if in_flight is None:
                    in_flight = _InFlight(done=Event())
                    self._in_flight[key] = in_flight
                    generation = self._generation
                    is_loader = True
                else:
                    is_loader = False

            if not is_loader:
                in_flight.done.wait()
                if in_flight.error is not None:
                    raise in_flight.error
                continue

            try:
                value = loader()
                cached_value = deepcopy(value)
            except BaseException as exc:
                with self._lock:
                    self._in_flight.pop(key, None)
                    in_flight.error = exc
                    in_flight.done.set()
                raise

            with self._lock:
                # Una invalidación ocurrida mientras se leía BigQuery evita
                # volver a insertar una respuesta anterior a la mutación.
                if generation == self._generation:
                    self._entries[key] = _CacheEntry(cached_value, self._clock())
                    self._entries.move_to_end(key)
                    while len(self._entries) > self._max_entries:
                        self._entries.popitem(last=False)
                self._in_flight.pop(key, None)
                in_flight.done.set()

            return CacheLookup(deepcopy(cached_value), False, 0.0)

    def clear(self) -> None:
        """Invalida entradas y evita que una carga anterior las repueble."""
        with self._lock:
            self._entries.clear()
            self._generation += 1

    def __len__(self) -> int:
        with self._lock:
            return len(self._entries)
