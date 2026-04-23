# Copyright (c) 2025 Efstratios Goudelis
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.
#
# This program is distributed in the hope that it will be useful,
# but WITHOUT ANY WARRANTY; without even the implied warranty of
# MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
# GNU General Public License for more details.
#
# You should have received a copy of the GNU General Public License
# along with this program. If not, see <https://www.gnu.org/licenses/>.

"""Tracking state handlers and emission functions."""

import asyncio
import time
from datetime import datetime, timezone
from typing import Any, Dict, Optional, Union

import crud
from common.constants import (
    RigStates,
    RotatorStates,
    SocketEvents,
    TrackerCommandScopes,
    TrackerCommandStatus,
)
from db import AsyncSessionLocal
from session.tracker import session_tracker
from tracker.contracts import InvalidTrackerIdError, get_tracking_state_name, require_tracker_id
from tracker.data import compiled_satellite_data, get_ui_tracker_state
from tracker.instances import emit_tracker_instances
from tracker.runner import (
    assign_rotator_to_tracker,
    get_assigned_rotator_for_tracker,
    get_tracker_instances_payload,
    get_tracker_manager,
    remove_tracker_instance,
    restore_tracker_rotator_assignment,
    swap_rotators_between_trackers,
)
from tracking.events import fetch_next_events_for_satellite


def _tracker_id_required_response() -> Dict[str, Any]:
    return {
        "success": False,
        "error": "tracker_id_required",
        "message": "tracker_id is required",
    }


def _missing_new_tracker_fields(value: Dict[str, Any]) -> list[str]:
    required_fields = [
        "norad_id",
        "group_id",
        "rotator_state",
        "rig_state",
        "rig_id",
        "rotator_id",
    ]
    missing: list[str] = []
    for field in required_fields:
        field_value = value.get(field)
        if field in {"norad_id", "group_id"}:
            if field_value in (None, "", 0):
                missing.append(field)
        else:
            if field_value is None:
                missing.append(field)
    return missing


async def emit_tracker_data(dbsession, sio, logger, tracker_id: str):
    """
    Emits satellite tracking data to the provided Socket.IO instance. This function retrieves the
    current state of satellite tracking from the database, processes the relevant satellite data,
    fetches the UI tracker state, and emits the resulting combined data to a specific event on
    the Socket.IO instance. Errors during data retrieval, processing, or emitting are logged.

    :param dbsession: Database session object used to access and query the database.
    :type dbsession: Any
    :param sio: Socket.IO server instance for emitting events.
    :type sio: AsyncServer
    :param logger: Logger object for logging errors or exceptions.
    :type logger: Any
    :return: This function does not return any value as it emits data asynchronously.
    :rtype: None
    """
    tracker_id = require_tracker_id(tracker_id)
    state_name = get_tracking_state_name(tracker_id)
    try:
        logger.debug("Sending tracker data to clients...")

        tracking_state_reply = await crud.trackingstate.get_tracking_state(
            dbsession, name=state_name
        )

        # Check if tracking state exists (not None for first-time users)
        if not tracking_state_reply.get("success") or tracking_state_reply.get("data") is None:
            logger.debug("No tracking state found, skipping tracker data emission")
            return

        tracking_value = tracking_state_reply["data"].get("value")
        if tracking_value is None:
            logger.debug("Tracking state has no value, skipping tracker data emission")
            return

        norad_id = tracking_value.get("norad_id", None)
        satellite_data = await compiled_satellite_data(dbsession, norad_id)
        data = {
            "tracker_id": tracker_id,
            "satellite_data": satellite_data,
            "tracking_state": tracking_value,
        }
        await sio.emit("satellite-tracking", data)
        await sio.emit(SocketEvents.SATELLITE_TRACKING_V2, data)

    except Exception as e:
        logger.error(f"Error emitting tracker data: {e}")
        logger.exception(e)


async def emit_ui_tracker_values(dbsession, sio, logger, tracker_id: str):
    """
    Call this when UI tracker values are updated

    :param dbsession:
    :param sio:
    :param logger:
    :return:
    """

    tracker_id = require_tracker_id(tracker_id)
    state_name = get_tracking_state_name(tracker_id)
    try:
        logger.debug("Sending UI tracker value to clients...")

        tracking_state_reply = await crud.trackingstate.get_tracking_state(
            dbsession, name=state_name
        )

        # Check if tracking state exists (not None for first-time users)
        if not tracking_state_reply.get("success") or tracking_state_reply.get("data") is None:
            logger.debug("No tracking state found, skipping UI tracker values emission")
            return

        tracking_value = tracking_state_reply["data"].get("value")
        if tracking_value is None:
            logger.debug("Tracking state has no value, skipping UI tracker values emission")
            return

        group_id = tracking_value.get("group_id", None)
        norad_id = tracking_value.get("norad_id", None)
        ui_tracker_state = await get_ui_tracker_state(group_id, norad_id, tracker_id)
        data = ui_tracker_state["data"]
        if isinstance(data, dict):
            data["tracker_id"] = tracker_id
        await sio.emit("ui-tracker-state", data)
        await sio.emit(SocketEvents.UI_TRACKER_STATE_V2, data)

    except Exception as e:
        logger.error(f"Error emitting UI tracker values: {e}")
        logger.exception(e)


async def get_tracking_state(
    sio: Any, data: Optional[Dict], logger: Any, sid: str
) -> Dict[str, Any]:
    """
    Get current tracking state and emit tracker data.

    Args:
        sio: Socket.IO server instance
        data: Not used
        logger: Logger instance
        sid: Socket.IO session ID

    Returns:
        Dictionary with success status and tracking state
    """
    try:
        requested_tracker_id = require_tracker_id((data or {}).get("tracker_id"))
    except InvalidTrackerIdError:
        return _tracker_id_required_response()
    state_name = get_tracking_state_name(requested_tracker_id)
    async with AsyncSessionLocal() as dbsession:
        logger.debug(f"Fetching tracking state, data: {data}")
        tracking_state = await crud.trackingstate.get_tracking_state(dbsession, name=state_name)
        await emit_tracker_data(dbsession, sio, logger, requested_tracker_id)
        await emit_ui_tracker_values(dbsession, sio, logger, requested_tracker_id)
        response = {"success": tracking_state["success"], "data": tracking_state.get("data", [])}
        response["tracker_id"] = requested_tracker_id
        return response


async def set_tracking_state(
    sio: Any, data: Optional[Dict], logger: Any, sid: str
) -> Dict[str, Any]:
    """
    Update tracking state and emit tracker data.

    Args:
        sio: Socket.IO server instance
        data: Tracking state updates (format: {"name": "satellite-tracking", "value": {...}})
        logger: Logger instance
        sid: Socket.IO session ID

    Returns:
        Dictionary with success status and updated tracking state
    """
    logger.info(f"Updating satellite tracking state, data: {data}")

    try:
        tracker_id = require_tracker_id((data or {}).get("tracker_id"))
    except InvalidTrackerIdError:
        return _tracker_id_required_response()

    # Extract the value from the data structure
    value = data.get("value", {}) if data else {}
    value = value if isinstance(value, dict) else {}

    existing_payload = get_tracker_instances_payload()
    existing_instances = existing_payload.get("instances", []) if existing_payload else []
    existing_tracker_ids = {
        require_tracker_id(instance.get("tracker_id"))
        for instance in existing_instances
        if instance and instance.get("tracker_id")
    }
    is_new_tracker = tracker_id not in existing_tracker_ids
    if is_new_tracker:
        missing_fields = _missing_new_tracker_fields(value)
        if missing_fields:
            return {
                "success": False,
                "error": "tracker_create_requires_fields",
                "message": (
                    f"Cannot create tracker '{tracker_id}' without required fields: "
                    f"{', '.join(missing_fields)}"
                ),
                "data": {
                    "tracker_id": tracker_id,
                    "missing_fields": missing_fields,
                },
            }

    # Enforce one rotator -> one tracker ownership.
    assignment_previous_rotator = get_assigned_rotator_for_tracker(tracker_id)
    requested_rotator_id = value.get("rotator_id") if value else None
    ownership_touched = requested_rotator_id is not None
    if ownership_touched:
        assignment_result = assign_rotator_to_tracker(tracker_id, requested_rotator_id)
        if not assignment_result.get("success"):
            owner_tracker_id = assignment_result.get("owner_tracker_id")
            message = f"Rotator '{requested_rotator_id}' is already assigned to tracker '{owner_tracker_id}'."
            logger.warning(
                "Rotator ownership conflict while setting tracking state "
                "(requester_sid=%s, tracker_id=%s, requested_rotator_id=%s, owner_tracker_id=%s)",
                sid,
                tracker_id,
                requested_rotator_id,
                owner_tracker_id,
            )
            return {
                "success": False,
                "error": "rotator_in_use",
                "message": message,
                "data": {
                    "tracker_id": tracker_id,
                    "rotator_id": requested_rotator_id,
                    "owner_tracker_id": owner_tracker_id,
                },
            }

    # Use TrackerManager to update tracking state
    manager = get_tracker_manager(tracker_id)
    result = await manager.update_tracking_state(requester_sid=sid, **value)
    if not result.get("success") and ownership_touched:
        restore_tracker_rotator_assignment(tracker_id, assignment_previous_rotator)
    command_id = result.get("command_id")

    command_scope = result.get("command_scope", TrackerCommandScopes.TRACKING)
    requested_state = {
        "rotator_state": value.get("rotator_state"),
        "rig_state": value.get("rig_state"),
    }
    if command_id:
        await sio.emit(
            SocketEvents.TRACKER_COMMAND_STATUS,
            {
                "command_id": command_id,
                "tracker_id": tracker_id,
                "status": TrackerCommandStatus.SUBMITTED,
                "scope": command_scope,
                "requested_state": requested_state,
            },
        )

    # Track session's rig and VFO selection
    if value:
        rig_id = value.get("rig_id")
        rig_vfo = value.get("rig_vfo")
        rig_state = value.get("rig_state")

        if rig_id and rig_id != "none":
            session_tracker.set_session_rig(sid, rig_id)
            logger.debug(f"Session {sid} tracking rig {rig_id}")

        if rig_vfo and rig_vfo != "none":
            session_tracker.set_session_vfo(sid, rig_vfo)
            logger.debug(f"Session {sid} selected VFO {rig_vfo}")

        # Unlock VFOs when tracking stops for this SDR
        if rig_state == RigStates.STOPPED and rig_id and rig_id != "none":
            # Note: VFO locking state (lockedTransmitterId) is UI-only and managed by the frontend
            # No backend action needed when tracking stops
            logger.info(f"Tracking stopped for session {sid}")

    # Emit so that any open browsers are also informed of any change
    async with AsyncSessionLocal() as dbsession:
        await emit_tracker_data(dbsession, sio, logger, tracker_id)
        await emit_ui_tracker_values(dbsession, sio, logger, tracker_id)
    await emit_tracker_instances(sio)

    return {
        "success": result.get("success", False),
        "data": {
            "tracker_id": tracker_id,
            "value": result.get("data", {}).get("value", value),
            "command_id": command_id,
            "command_scope": command_scope,
            "requested_state": requested_state,
        },
    }


async def swap_target_rotators(
    sio: Any, data: Optional[Dict], logger: Any, sid: str
) -> Dict[str, Any]:
    payload = data or {}
    try:
        tracker_a_id = require_tracker_id(payload.get("tracker_a_id"))
        tracker_b_id = require_tracker_id(payload.get("tracker_b_id"))
    except InvalidTrackerIdError:
        return {
            "success": False,
            "error": "tracker_ids_required",
            "message": "tracker_a_id and tracker_b_id are required",
        }

    if tracker_a_id == tracker_b_id:
        return {
            "success": False,
            "error": "swap_requires_two_distinct_trackers",
            "message": "tracker_a_id and tracker_b_id must be different",
        }

    manager_a = get_tracker_manager(tracker_a_id)
    manager_b = get_tracker_manager(tracker_b_id)
    state_a = await manager_a.get_tracking_state() or {}
    state_b = await manager_b.get_tracking_state() or {}

    state_a_rotator = state_a.get("rotator_id")
    state_b_rotator = state_b.get("rotator_id")
    assigned_rotator_a = get_assigned_rotator_for_tracker(tracker_a_id)
    assigned_rotator_b = get_assigned_rotator_for_tracker(tracker_b_id)
    effective_rotator_a = assigned_rotator_a or state_a_rotator
    effective_rotator_b = assigned_rotator_b or state_b_rotator

    if not effective_rotator_a or effective_rotator_a == "none":
        return {
            "success": False,
            "error": "swap_requires_assigned_rotators",
            "message": f"Tracker '{tracker_a_id}' has no rotator assigned",
            "data": {"tracker_id": tracker_a_id},
        }

    if not effective_rotator_b or effective_rotator_b == "none":
        return {
            "success": False,
            "error": "swap_requires_assigned_rotators",
            "message": f"Tracker '{tracker_b_id}' has no rotator assigned",
            "data": {"tracker_id": tracker_b_id},
        }

    if effective_rotator_a == effective_rotator_b:
        return {
            "success": False,
            "error": "swap_requires_distinct_rotators",
            "message": "Cannot swap because both trackers already use the same rotator",
            "data": {
                "tracker_a_id": tracker_a_id,
                "tracker_b_id": tracker_b_id,
                "rotator_id": effective_rotator_a,
            },
        }

    if state_a.get("rotator_state") != RotatorStates.DISCONNECTED:
        return {
            "success": False,
            "error": "swap_requires_disconnected_rotators",
            "message": f"Tracker '{tracker_a_id}' rotator must be disconnected before swapping",
            "data": {
                "tracker_id": tracker_a_id,
                "rotator_state": state_a.get("rotator_state"),
            },
        }

    if state_b.get("rotator_state") != RotatorStates.DISCONNECTED:
        return {
            "success": False,
            "error": "swap_requires_disconnected_rotators",
            "message": f"Tracker '{tracker_b_id}' rotator must be disconnected before swapping",
            "data": {
                "tracker_id": tracker_b_id,
                "rotator_state": state_b.get("rotator_state"),
            },
        }

    logger.info(
        "Swapping rotators between trackers (requester_sid=%s, tracker_a_id=%s, tracker_b_id=%s, "
        "tracker_a_rotator_id=%s, tracker_b_rotator_id=%s)",
        sid,
        tracker_a_id,
        tracker_b_id,
        effective_rotator_a,
        effective_rotator_b,
    )

    swap_result = swap_rotators_between_trackers(tracker_a_id, tracker_b_id)
    if not swap_result.get("success"):
        return {
            "success": False,
            "error": "swap_failed",
            "message": "Failed to swap rotator ownership",
            "data": swap_result,
        }

    update_a_result = await manager_a.update_tracking_state(rotator_id=effective_rotator_b)
    if not update_a_result.get("success"):
        logger.error(
            "Failed persisting swapped rotator for tracker '%s'; rolling back ownership maps",
            tracker_a_id,
        )
        swap_rotators_between_trackers(tracker_a_id, tracker_b_id)
        return {
            "success": False,
            "error": "swap_persist_failed",
            "message": f"Failed updating tracking state for tracker '{tracker_a_id}'",
            "data": {
                "tracker_id": tracker_a_id,
                "result": update_a_result,
            },
        }

    update_b_result = await manager_b.update_tracking_state(rotator_id=effective_rotator_a)
    if not update_b_result.get("success"):
        logger.error(
            "Failed persisting swapped rotator for tracker '%s'; reverting both tracker updates",
            tracker_b_id,
        )
        await manager_a.update_tracking_state(rotator_id=effective_rotator_a)
        swap_rotators_between_trackers(tracker_a_id, tracker_b_id)
        return {
            "success": False,
            "error": "swap_persist_failed",
            "message": f"Failed updating tracking state for tracker '{tracker_b_id}'",
            "data": {
                "tracker_id": tracker_b_id,
                "result": update_b_result,
            },
        }

    async with AsyncSessionLocal() as dbsession:
        await emit_tracker_data(dbsession, sio, logger, tracker_a_id)
        await emit_ui_tracker_values(dbsession, sio, logger, tracker_a_id)
        await emit_tracker_data(dbsession, sio, logger, tracker_b_id)
        await emit_ui_tracker_values(dbsession, sio, logger, tracker_b_id)
    await emit_tracker_instances(sio)

    return {
        "success": True,
        "data": {
            "tracker_a_id": tracker_a_id,
            "tracker_b_id": tracker_b_id,
            "tracker_a_rotator_id": effective_rotator_b,
            "tracker_b_rotator_id": effective_rotator_a,
        },
    }


async def get_tracker_instances(
    sio: Any, data: Optional[Dict], logger: Any, sid: str
) -> Dict[str, Union[bool, dict]]:
    return {
        "success": True,
        "data": get_tracker_instances_payload(),
    }


async def delete_tracker_instance(
    sio: Any, data: Optional[Dict], logger: Any, sid: str
) -> Dict[str, Union[bool, dict, str]]:
    payload = data or {}
    try:
        tracker_id = require_tracker_id(payload.get("tracker_id"))
    except InvalidTrackerIdError:
        return _tracker_id_required_response()

    existing_payload = get_tracker_instances_payload()
    existing_instances = existing_payload.get("instances", []) if existing_payload else []
    existing_tracker_ids = {
        require_tracker_id(instance.get("tracker_id"))
        for instance in existing_instances
        if instance and instance.get("tracker_id")
    }
    if tracker_id not in existing_tracker_ids:
        return {
            "success": False,
            "error": "tracker_not_found",
            "message": f"Tracker '{tracker_id}' does not exist",
        }

    # Stop/remove tracker runtime first so it cannot race DB writes during deletion.
    # Run in a worker thread to avoid blocking the event loop if teardown stalls.
    try:
        remove_result = await asyncio.wait_for(
            asyncio.to_thread(remove_tracker_instance, tracker_id),
            timeout=6.0,
        )
    except TimeoutError:
        return {
            "success": False,
            "error": "remove_tracker_timeout",
            "message": f"Timed out while removing tracker instance '{tracker_id}'",
        }
    if not remove_result.get("success"):
        return {
            "success": False,
            "error": remove_result.get("error", "failed_removing_tracker_instance"),
            "message": f"Failed removing tracker instance '{tracker_id}'",
            "data": remove_result,
        }

    state_name = get_tracking_state_name(tracker_id)
    async with AsyncSessionLocal() as dbsession:
        delete_state_reply = await crud.trackingstate.delete_tracking_state(dbsession, state_name)
        if not delete_state_reply.get("success"):
            return {
                "success": False,
                "error": delete_state_reply.get("error", "failed_deleting_tracking_state"),
                "message": "Failed deleting tracking state row",
            }

    await emit_tracker_instances(sio)
    return {
        "success": True,
        "data": {
            "tracker_id": tracker_id,
            "tracking_state_deleted": bool(delete_state_reply.get("deleted")),
            "instances": get_tracker_instances_payload().get("instances", []),
        },
    }


async def fetch_next_passes(
    sio: Any, data: Optional[Dict], logger: Any, sid: str
) -> Dict[str, Union[bool, list, float]]:
    """
    Fetch next passes for a satellite.

    Args:
        sio: Socket.IO server instance
        data: NORAD ID, forecast hours, and optional force_recalculate flag
        logger: Logger instance
        sid: Socket.IO session ID

    Returns:
        Dictionary with success status and next passes
    """
    norad_id = data.get("norad_id", None) if data else None
    hours = data.get("hours", 4.0) if data else 4.0
    min_elevation = data.get("min_elevation", 0) if data else 0
    force_recalculate = data.get("force_recalculate", False) if data else False
    logger.info(
        f"Handling request from client_id={sid}, norad_id={norad_id}, hours={hours}, "
        f"min_elevation={min_elevation}, force_recalculate={force_recalculate} (get_next_passes)"
    )
    # Always calculate passes from horizon (above_el=0) to get complete pass times
    next_passes = await fetch_next_events_for_satellite(
        norad_id=norad_id, hours=hours, above_el=0, force_recalculate=force_recalculate
    )

    # Filter passes by peak elevation if min_elevation is specified
    if next_passes["success"] and min_elevation > 0:
        filtered_passes = [
            p for p in next_passes.get("data", []) if p.get("peak_altitude", 0) >= min_elevation
        ]
        next_passes["data"] = filtered_passes

    return {
        "success": next_passes["success"],
        "data": next_passes.get("data", []),
        "cached": next_passes.get("cached", False),
        "forecast_hours": next_passes.get("forecast_hours", 4.0),
    }


def _coerce_float(value: Any, default: float) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def _coerce_int(value: Any) -> Optional[int]:
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _parse_iso_to_ms(value: Any) -> Optional[int]:
    if not isinstance(value, str):
        return None
    text = value.strip()
    if not text:
        return None
    try:
        dt = datetime.fromisoformat(text.replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return int(dt.timestamp() * 1000)
    except (TypeError, ValueError):
        return None


async def fetch_next_pass_summaries_for_trackers(
    sio: Any, data: Optional[Dict], logger: Any, sid: str
) -> Dict[str, Union[bool, dict, str]]:
    """
    Fetch lightweight next-pass summaries for multiple trackers in one request.

    Request shape:
      {
        "hours": 24.0,
        "trackers": [
          {"tracker_id": "target-1", "norad_id": 25544, "min_elevation": 10},
          ...
        ]
      }

    Response shape:
      {
        "success": true,
        "data": {
          "computed_at_ms": 1713880000000,
          "summaries": {
            "target-1": {
              "tracker_id": "target-1",
              "norad_id": 25544,
              "mode": "live|upcoming|none",
              "aos_ts": "...",
              "los_ts": "...",
              "cached": true
            }
          }
        }
      }
    """
    payload = data or {}
    hours = _coerce_float(payload.get("hours"), 24.0)
    tracker_requests = payload.get("trackers") or []
    if not isinstance(tracker_requests, list):
        return {
            "success": False,
            "error": "invalid_payload",
            "message": "trackers must be a list",
        }

    normalized_trackers = []
    for raw in tracker_requests:
        if not isinstance(raw, dict):
            continue
        try:
            tracker_id = require_tracker_id(raw.get("tracker_id"))
        except InvalidTrackerIdError:
            continue
        normalized_trackers.append(
            {
                "tracker_id": tracker_id,
                "norad_id": _coerce_int(raw.get("norad_id")),
                "min_elevation": _coerce_float(raw.get("min_elevation"), 0.0),
            }
        )

    if not normalized_trackers:
        return {
            "success": True,
            "data": {
                "computed_at_ms": int(time.time() * 1000),
                "summaries": {},
            },
        }

    now_ms = int(time.time() * 1000)

    unique_norad_ids = sorted(
        {
            tracker["norad_id"]
            for tracker in normalized_trackers
            if isinstance(tracker.get("norad_id"), int)
        }
    )

    passes_by_norad: Dict[int, list[Dict[str, Any]]] = {}
    cache_by_norad: Dict[int, bool] = {}
    for norad_id in unique_norad_ids:
        passes_reply = await fetch_next_events_for_satellite(
            norad_id=norad_id,
            hours=hours,
            above_el=0,
            force_recalculate=False,
        )
        if not passes_reply.get("success"):
            logger.warning(
                "Failed fetching pass summary source for norad_id=%s (sid=%s)",
                norad_id,
                sid,
            )
            passes_by_norad[norad_id] = []
            cache_by_norad[norad_id] = False
            continue

        passes_by_norad[norad_id] = passes_reply.get("data", []) or []
        cache_by_norad[norad_id] = bool(passes_reply.get("cached", False))

    summaries_by_tracker_id: Dict[str, Dict[str, Any]] = {}
    for tracker in normalized_trackers:
        tracker_id = tracker["tracker_id"]
        norad_id = tracker["norad_id"]
        min_elevation = tracker["min_elevation"]

        summary = {
            "tracker_id": tracker_id,
            "norad_id": norad_id,
            "mode": "none",
            "aos_ts": None,
            "los_ts": None,
            "cached": False,
        }

        if norad_id is None:
            summaries_by_tracker_id[tracker_id] = summary
            continue

        candidate_passes: list[Dict[str, Any]] = passes_by_norad.get(norad_id, [])
        filtered_passes = [
            p
            for p in candidate_passes
            if _coerce_float(p.get("peak_altitude"), 0.0) >= min_elevation
        ]

        active_pass: Optional[Dict[str, Any]] = None
        next_pass: Optional[Dict[str, Any]] = None
        next_start_ms: Optional[int] = None
        for entry in filtered_passes:
            start_ms = _parse_iso_to_ms(entry.get("event_start"))
            end_ms = _parse_iso_to_ms(entry.get("event_end"))
            if start_ms is None or end_ms is None:
                continue
            if start_ms <= now_ms < end_ms:
                active_end_ms = (
                    _parse_iso_to_ms(active_pass["event_end"])
                    if active_pass is not None and "event_end" in active_pass
                    else None
                )
                if active_pass is None or active_end_ms is None or end_ms < active_end_ms:
                    active_pass = entry
                continue
            if start_ms > now_ms and (next_start_ms is None or start_ms < next_start_ms):
                next_pass = entry
                next_start_ms = start_ms

        summary["cached"] = bool(cache_by_norad.get(norad_id, False))
        if active_pass:
            summary["mode"] = "live"
            summary["aos_ts"] = active_pass.get("event_start")
            summary["los_ts"] = active_pass.get("event_end")
        elif next_pass:
            summary["mode"] = "upcoming"
            summary["aos_ts"] = next_pass.get("event_start")
            summary["los_ts"] = next_pass.get("event_end")

        summaries_by_tracker_id[tracker_id] = summary

    return {
        "success": True,
        "data": {
            "computed_at_ms": now_ms,
            "summaries": summaries_by_tracker_id,
        },
    }


def register_handlers(registry):
    """Register tracking handlers with the command registry."""
    registry.register_batch(
        {
            "get-tracking-state": (get_tracking_state, "data_request"),
            "set-tracking-state": (set_tracking_state, "data_submission"),
            "swap-target-rotators": (swap_target_rotators, "data_submission"),
            "get-tracker-instances": (get_tracker_instances, "data_request"),
            "delete-tracker-instance": (delete_tracker_instance, "data_submission"),
            "fetch-next-passes": (fetch_next_passes, "data_request"),
            "fetch-next-pass-summary-for-trackers": (
                fetch_next_pass_summaries_for_trackers,
                "data_request",
            ),
        }
    )
