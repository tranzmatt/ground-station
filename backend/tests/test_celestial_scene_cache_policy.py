from datetime import datetime, timezone

import pytest

from celestial import scene


class _DummyLogger:
    def info(self, *_args, **_kwargs):
        return None

    def warning(self, *_args, **_kwargs):
        return None


@pytest.mark.asyncio
async def test_get_vectors_snapshot_returns_exact_cache_hit(monkeypatch):
    epoch = datetime(2026, 1, 1, 12, 0, tzinfo=timezone.utc)
    payload = {"command": "Voyager 1", "position_xyz_au": [1.0, 0.0, 0.0]}

    async def _stub_load_vectors_from_db(*_args, **_kwargs):
        return {"payload": payload}

    def _unexpected_fetch(*_args, **_kwargs):
        raise AssertionError("Network fetch should not run on exact cache hit")

    monkeypatch.setattr(scene, "_load_vectors_from_db", _stub_load_vectors_from_db)
    monkeypatch.setattr(scene, "fetch_celestial_vectors", _unexpected_fetch)

    result = await scene._get_vectors_snapshot(
        command="Voyager 1",
        epoch=epoch,
        past_hours=1,
        future_hours=24,
        step_minutes=60,
        observer_location={"lat": 40.0, "lon": 22.0},
        force_refresh=False,
        logger=_DummyLogger(),
        allow_network_fetch=True,
    )

    assert result["cache"] == "db-hit"
    assert result["stale"] is False
    assert result["payload"]["command"] == "Voyager 1"


async def test_get_vectors_snapshot_cache_only_returns_miss_without_exact_cache(monkeypatch):
    epoch = datetime(2026, 1, 1, 12, 0, tzinfo=timezone.utc)

    async def _stub_load_vectors_from_db(*_args, **_kwargs):
        return None

    monkeypatch.setattr(scene, "_load_vectors_from_db", _stub_load_vectors_from_db)

    result = await scene._get_vectors_snapshot(
        command="Voyager 1",
        epoch=epoch,
        past_hours=1,
        future_hours=24,
        step_minutes=60,
        observer_location={"lat": 40.0, "lon": 22.0},
        force_refresh=True,
        logger=_DummyLogger(),
        allow_network_fetch=False,
    )

    assert result["cache"] == "cache-only-miss"
    assert result["stale"] is True
    assert result["payload"] is None
    assert "No cached vectors available" in str(result["error"])


@pytest.mark.asyncio
async def test_get_vectors_snapshot_fetches_and_stores_on_cache_miss(monkeypatch):
    epoch = datetime(2026, 1, 1, 12, 0, tzinfo=timezone.utc)
    calls = {"fetch": 0, "store": 0}
    fetched_payload = {
        "command": "Voyager 1",
        "position_xyz_au": [1.0, 0.0, 0.0],
        "orbit_samples_xyz_au": [[1.0, 0.0, 0.0], [1.0, 0.1, 0.0]],
        "orbit_sample_times_utc": [
            datetime(2026, 1, 1, 11, 0, tzinfo=timezone.utc).isoformat(),
            datetime(2026, 1, 1, 13, 0, tzinfo=timezone.utc).isoformat(),
        ],
    }

    async def _stub_load_vectors_from_db(*_args, **_kwargs):
        return None

    def _stub_fetch_celestial_vectors(*_args, **_kwargs):
        calls["fetch"] += 1
        return dict(fetched_payload)

    async def _stub_store_vectors_in_db(*_args, **_kwargs):
        calls["store"] += 1
        return None

    monkeypatch.setattr(scene, "_load_vectors_from_db", _stub_load_vectors_from_db)
    monkeypatch.setattr(scene, "fetch_celestial_vectors", _stub_fetch_celestial_vectors)
    monkeypatch.setattr(scene, "_store_vectors_in_db", _stub_store_vectors_in_db)

    result = await scene._get_vectors_snapshot(
        command="Voyager 1",
        epoch=epoch,
        past_hours=1,
        future_hours=24,
        step_minutes=60,
        observer_location={"lat": 40.0, "lon": 22.0},
        force_refresh=False,
        logger=_DummyLogger(),
        allow_network_fetch=True,
    )

    assert result["cache"] == "db-miss"
    assert result["stale"] is False
    assert result["payload"]["command"] == "Voyager 1"
    assert calls["fetch"] == 1
    assert calls["store"] == 1


@pytest.mark.asyncio
async def test_get_vectors_snapshot_returns_miss_on_fetch_error_without_fallback(monkeypatch):
    epoch = datetime(2026, 1, 1, 12, 0, tzinfo=timezone.utc)

    async def _stub_load_vectors_from_db(*_args, **_kwargs):
        return None

    def _failing_fetch(*_args, **_kwargs):
        raise RuntimeError("network down")

    monkeypatch.setattr(scene, "_load_vectors_from_db", _stub_load_vectors_from_db)
    monkeypatch.setattr(scene, "fetch_celestial_vectors", _failing_fetch)

    result = await scene._get_vectors_snapshot(
        command="Voyager 1",
        epoch=epoch,
        past_hours=1,
        future_hours=24,
        step_minutes=60,
        observer_location={"lat": 40.0, "lon": 22.0},
        force_refresh=True,
        logger=_DummyLogger(),
        allow_network_fetch=True,
    )

    assert result["cache"] == "miss"
    assert result["stale"] is True
    assert result["payload"] is None
    assert "network down" in str(result["error"])


@pytest.mark.asyncio
async def test_build_horizons_solar_system_bodies_keeps_missing_rows_without_origin_vectors(
    monkeypatch,
):
    epoch = datetime(2026, 6, 5, 12, 0, tzinfo=timezone.utc)

    def _stub_build_builtin_body_targets():
        return [
            {
                "body_id": "saturn",
                "target_key": "body:saturn",
                "horizons_command": "699",
                "name": "Saturn",
                "body_class": "planet",
                "parent_body_id": "sun",
            }
        ]

    async def _stub_ensure_scene_targets_registered(*_args, **_kwargs):
        return None

    async def _stub_get_vectors_snapshot(*_args, **_kwargs):
        return {
            "payload": None,
            "cache": "cache-only-miss",
            "stale": True,
            "error": "No data returned",
        }

    monkeypatch.setattr(scene, "_build_builtin_body_targets", _stub_build_builtin_body_targets)
    monkeypatch.setattr(
        scene, "_ensure_scene_targets_registered", _stub_ensure_scene_targets_registered
    )
    monkeypatch.setattr(scene, "_get_vectors_snapshot", _stub_get_vectors_snapshot)

    solar_meta, planets = await scene._build_horizons_solar_system_bodies(
        epoch=epoch,
        past_hours=6,
        future_hours=6,
        step_minutes=60,
        observer_location=None,
        force_refresh=True,
        allow_network_fetch=False,
        logger=_DummyLogger(),
    )

    assert solar_meta["cache"]["missing_count"] == 1
    assert len(planets) == 1
    row = planets[0]
    assert row["id"] == "saturn"
    assert row["stale"] is True
    assert row["position_xyz_au"] is None
    assert row["velocity_xyz_au_per_day"] is None
