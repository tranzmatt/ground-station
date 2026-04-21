# Copyright (c) 2026 Efstratios Goudelis

import pytest

from observations.tasks.trackerhandler import TrackerHandler


class _DummyTrackerManager:
    def __init__(self, tracking_state=None):
        self.tracking_state = tracking_state or {}
        self.calls = []

    async def get_tracking_state(self):
        return dict(self.tracking_state)

    async def update_tracking_state(self, **kwargs):
        self.calls.append(kwargs)
        self.tracking_state.update(kwargs)
        return {"success": True}


@pytest.mark.asyncio
async def test_start_tracker_unparks_before_tracking_when_requested(monkeypatch):
    manager = _DummyTrackerManager({"rotator_state": "parked"})
    monkeypatch.setattr(
        "observations.tasks.trackerhandler.get_tracker_manager",
        lambda _tracker_id: manager,
    )

    handler = TrackerHandler()
    ok = await handler.start_tracker_task(
        observation_id="obs-1",
        satellite={"norad_id": 25544, "group_id": "grp-1", "name": "ISS"},
        rotator_config={
            "id": "rot-1",
            "tracker_id": "target-1",
            "tracking_enabled": True,
            "unpark_before_tracking": True,
        },
        tasks=[],
    )

    assert ok is True
    assert len(manager.calls) == 2
    assert manager.calls[0]["rotator_state"] == "connected"
    assert manager.calls[0]["rotator_id"] == "rot-1"
    assert manager.calls[1]["rotator_state"] == "tracking"
    assert manager.calls[1]["rotator_id"] == "rot-1"


@pytest.mark.asyncio
async def test_stop_tracker_parks_when_requested(monkeypatch):
    manager = _DummyTrackerManager({"rotator_state": "tracking"})
    monkeypatch.setattr(
        "observations.tasks.trackerhandler.get_tracker_manager",
        lambda _tracker_id: manager,
    )

    handler = TrackerHandler()
    ok = await handler.stop_tracker_task(
        observation_id="obs-2",
        rotator_config={
            "id": "rot-1",
            "tracker_id": "target-1",
            "tracking_enabled": True,
            "park_after_observation": True,
        },
    )

    assert ok is True
    assert manager.calls == [{"rotator_state": "parked", "rotator_id": "rot-1"}]


@pytest.mark.asyncio
async def test_stop_tracker_leaves_rotator_connected_by_default(monkeypatch):
    manager = _DummyTrackerManager({"rotator_state": "tracking"})
    monkeypatch.setattr(
        "observations.tasks.trackerhandler.get_tracker_manager",
        lambda _tracker_id: manager,
    )

    handler = TrackerHandler()
    ok = await handler.stop_tracker_task(
        observation_id="obs-3",
        rotator_config={
            "id": "rot-1",
            "tracker_id": "target-1",
            "tracking_enabled": True,
            "park_after_observation": False,
        },
    )

    assert ok is True
    assert manager.calls == []
