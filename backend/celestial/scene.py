# Copyright (c) 2025 Efstratios Goudelis
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.

"""Scene builder for celestial page (offline planets + Horizons celestial)."""

from __future__ import annotations

import asyncio
import threading
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

from celestial.horizons import fetch_celestial_vectors
from celestial.solarsystem import compute_solar_system_snapshot

CACHE_TTL_SECONDS = 86400
DEFAULT_CELESTIAL_TARGETS: List[Dict[str, str]] = []


@dataclass
class CacheEntry:
    payload: Dict[str, Any]
    fetched_at_monotonic: float


_celestial_cache: Dict[str, CacheEntry] = {}
_celestial_cache_lock = threading.Lock()


def _parse_epoch(data: Optional[Dict[str, Any]]) -> datetime:
    if not data:
        return datetime.now(timezone.utc)

    epoch_raw = data.get("epoch")
    if not epoch_raw:
        return datetime.now(timezone.utc)

    try:
        epoch_str = str(epoch_raw).strip()
        if epoch_str.endswith("Z"):
            epoch_str = epoch_str[:-1] + "+00:00"
        parsed = datetime.fromisoformat(epoch_str)
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        return parsed.astimezone(timezone.utc)
    except Exception:
        return datetime.now(timezone.utc)


def _normalize_targets(data: Optional[Dict[str, Any]]) -> List[Dict[str, str]]:
    if not data:
        return DEFAULT_CELESTIAL_TARGETS.copy()

    requested = data.get("celestial")
    if not requested:
        return DEFAULT_CELESTIAL_TARGETS.copy()

    normalized: List[Dict[str, str]] = []

    for item in requested:
        if isinstance(item, str):
            command = item.strip()
            if command:
                normalized.append({"command": command, "name": command})
            continue

        if isinstance(item, dict):
            command = str(item.get("command") or item.get("id") or item.get("target") or "").strip()
            if not command:
                continue
            name = str(item.get("name") or command).strip()
            normalized.append({"command": command, "name": name})

    return normalized


def _parse_projection_options(data: Optional[Dict[str, Any]]) -> Tuple[int, int, int]:
    if not data:
        return 24, 24, 60

    def parse_int(name: str, default: int, low: int, high: int) -> int:
        try:
            value = int(data.get(name, default))
        except (TypeError, ValueError):
            return default
        return max(low, min(high, value))

    past_hours = parse_int("past_hours", 24, 1, 24 * 365)
    future_hours = parse_int("future_hours", 24, 1, 24 * 365)
    step_minutes = parse_int("step_minutes", 60, 5, 6 * 60)
    return past_hours, future_hours, step_minutes


async def _fetch_celestial_with_cache(
    targets: List[Dict[str, str]],
    epoch: datetime,
    past_hours: int,
    future_hours: int,
    step_minutes: int,
    force_refresh: bool,
    logger,
) -> List[Dict[str, Any]]:
    rows: List[Dict[str, Any]] = []
    now_monotonic = time.monotonic()

    for target in targets:
        command = target["command"]
        name = target["name"]
        cache_key = f"{command}|p{past_hours}|f{future_hours}|s{step_minutes}"

        use_cached = False
        cached_entry: Optional[CacheEntry] = None

        with _celestial_cache_lock:
            cached_entry = _celestial_cache.get(cache_key)
            if (
                cached_entry
                and not force_refresh
                and now_monotonic - cached_entry.fetched_at_monotonic <= CACHE_TTL_SECONDS
            ):
                use_cached = True

        if use_cached and cached_entry:
            cached_payload = dict(cached_entry.payload)
            cached_payload["name"] = name
            cached_payload["stale"] = False
            cached_payload["cache"] = "hit"
            rows.append(cached_payload)
            continue

        try:
            fetched = await asyncio.to_thread(
                fetch_celestial_vectors,
                command,
                epoch,
                past_hours,
                future_hours,
                step_minutes,
            )
            fetched["name"] = name
            fetched["stale"] = False
            fetched["cache"] = "miss"

            with _celestial_cache_lock:
                _celestial_cache[cache_key] = CacheEntry(
                    payload=fetched,
                    fetched_at_monotonic=time.monotonic(),
                )

            rows.append(fetched)
        except Exception as exc:
            logger.warning(f"Horizons fetch failed for celestial '{command}': {exc}")

            fallback_payload: Optional[Dict[str, Any]] = None
            with _celestial_cache_lock:
                cached_entry = _celestial_cache.get(cache_key)
                if cached_entry:
                    fallback_payload = dict(cached_entry.payload)

            if fallback_payload:
                fallback_payload["name"] = name
                fallback_payload["stale"] = True
                fallback_payload["cache"] = "stale"
                fallback_payload["error"] = str(exc)
                rows.append(fallback_payload)
            else:
                rows.append(
                    {
                        "name": name,
                        "command": command,
                        "source": "horizons",
                        "stale": True,
                        "error": str(exc),
                    }
                )

    return rows


async def build_celestial_scene(
    data: Optional[Dict[str, Any]],
    logger,
    force_refresh: bool = False,
) -> Dict[str, Any]:
    """Build a scene payload for UI rendering and backend sharing."""
    epoch = _parse_epoch(data)
    targets = _normalize_targets(data)
    past_hours, future_hours, step_minutes = _parse_projection_options(data)

    solar_meta, planets = compute_solar_system_snapshot(epoch)
    celestial = await _fetch_celestial_with_cache(
        targets,
        epoch,
        past_hours,
        future_hours,
        step_minutes,
        force_refresh,
        logger,
    )

    return {
        "success": True,
        "data": {
            "timestamp_utc": epoch.isoformat(),
            "frame": "heliocentric-ecliptic",
            "center": "sun",
            "units": {
                "position": "au",
                "velocity": "au/day",
            },
            "planets": planets,
            "celestial": celestial,
            "meta": {
                "solar_system": solar_meta,
                "celestial_source": "horizons",
                "cache_ttl_seconds": CACHE_TTL_SECONDS,
                "projection": {
                    "past_hours": past_hours,
                    "future_hours": future_hours,
                    "step_minutes": step_minutes,
                },
            },
        },
    }


async def build_solar_system_scene(
    data: Optional[Dict[str, Any]],
    logger,
) -> Dict[str, Any]:
    """Build only the offline solar system portion for fast initial render."""
    epoch = _parse_epoch(data)
    past_hours, future_hours, step_minutes = _parse_projection_options(data)
    solar_meta, planets = compute_solar_system_snapshot(epoch)

    return {
        "success": True,
        "data": {
            "timestamp_utc": epoch.isoformat(),
            "frame": "heliocentric-ecliptic",
            "center": "sun",
            "units": {
                "position": "au",
                "velocity": "au/day",
            },
            "planets": planets,
            "meta": {
                "solar_system": solar_meta,
                "projection": {
                    "past_hours": past_hours,
                    "future_hours": future_hours,
                    "step_minutes": step_minutes,
                },
            },
        },
    }


async def build_celestial_tracks(
    data: Optional[Dict[str, Any]],
    logger,
    force_refresh: bool = False,
) -> Dict[str, Any]:
    """Build only Horizons-backed tracked celestial objects."""
    epoch = _parse_epoch(data)
    targets = _normalize_targets(data)
    past_hours, future_hours, step_minutes = _parse_projection_options(data)
    celestial = await _fetch_celestial_with_cache(
        targets,
        epoch,
        past_hours,
        future_hours,
        step_minutes,
        force_refresh,
        logger,
    )

    return {
        "success": True,
        "data": {
            "timestamp_utc": epoch.isoformat(),
            "frame": "heliocentric-ecliptic",
            "center": "sun",
            "units": {
                "position": "au",
                "velocity": "au/day",
            },
            "celestial": celestial,
            "meta": {
                "celestial_source": "horizons",
                "cache_ttl_seconds": CACHE_TTL_SECONDS,
                "projection": {
                    "past_hours": past_hours,
                    "future_hours": future_hours,
                    "step_minutes": step_minutes,
                },
            },
        },
    }
