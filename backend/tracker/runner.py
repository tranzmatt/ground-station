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

import asyncio
import logging
import multiprocessing
import time
from dataclasses import dataclass
from multiprocessing import Queue
from multiprocessing.synchronize import Event as MpEvent
from typing import Any, Dict, Optional

import setproctitle

from tracker.contracts import require_tracker_id
from tracker.logic import SatelliteTracker
from tracker.manager import TrackerManager

logger = logging.getLogger("tracker-worker")


@dataclass
class TrackerRuntime:
    tracker_id: str
    process: multiprocessing.Process
    queue_to_tracker: Queue
    stop_event: MpEvent


class TrackerSupervisor:
    def __init__(self):
        self.output_queue: Queue = multiprocessing.Queue()
        self.runtimes: Dict[str, TrackerRuntime] = {}
        self.managers: Dict[str, TrackerManager] = {}
        self.tracker_rotator_map: Dict[str, str] = {}
        self.rotator_tracker_map: Dict[str, str] = {}
        self.tracker_target_number_map: Dict[str, int] = {}
        self._next_target_number: int = 1

    def _ensure_target_number(self, tracker_id: str) -> int:
        normalized_tracker_id = require_tracker_id(tracker_id)
        existing_number = self.tracker_target_number_map.get(normalized_tracker_id)
        if existing_number is not None:
            return existing_number
        target_number = self._next_target_number
        self._next_target_number += 1
        self.tracker_target_number_map[normalized_tracker_id] = target_number
        return target_number

    @staticmethod
    def _normalize_rotator_id(candidate: Optional[str]) -> Optional[str]:
        if candidate is None:
            return None
        normalized = str(candidate).strip()
        if not normalized or normalized == "none":
            return None
        return normalized

    def _build_process(self, tracker_id: str, queue_to_tracker: Queue, stop_event: MpEvent):
        normalized_id = require_tracker_id(tracker_id)

        def run_tracking_task():
            title = f"Ground Station - SatelliteTracker[{normalized_id}]"
            setproctitle.setproctitle(title)
            multiprocessing.current_process().name = title

            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)
            try:
                tracker = SatelliteTracker(
                    queue_out=self.output_queue,
                    queue_in=queue_to_tracker,
                    stop_event=stop_event,
                    tracker_id=normalized_id,
                )
                loop.run_until_complete(tracker.run())
            except Exception as e:
                logger.error("Error in tracker process '%s': %s", normalized_id, e)
                logger.exception(e)
            finally:
                loop.close()

        return multiprocessing.Process(
            target=run_tracking_task, name="Ground Station - SatelliteTracker"
        )

    def start_tracker(self, tracker_id: str) -> TrackerRuntime:
        normalized_id = require_tracker_id(tracker_id)
        self._ensure_target_number(normalized_id)
        existing = self.runtimes.get(normalized_id)
        if existing and existing.process.is_alive():
            return existing

        queue_to_tracker: Queue = multiprocessing.Queue()
        stop_event = multiprocessing.Event()
        process = self._build_process(normalized_id, queue_to_tracker, stop_event)
        process.start()

        runtime = TrackerRuntime(
            tracker_id=normalized_id,
            process=process,
            queue_to_tracker=queue_to_tracker,
            stop_event=stop_event,
        )
        self.runtimes[normalized_id] = runtime

        logger.info("Started tracker process '%s' with PID %s", normalized_id, process.pid)

        manager = self.managers.get(normalized_id)
        if manager is None:
            manager = TrackerManager(queue_to_tracker=queue_to_tracker, tracker_id=normalized_id)
            self.managers[normalized_id] = manager
        else:
            manager.queue_to_tracker = queue_to_tracker

        return runtime

    def stop_tracker(self, tracker_id: str, timeout: float = 3.0) -> None:
        normalized_id = require_tracker_id(tracker_id)
        runtime = self.runtimes.get(normalized_id)
        if not runtime:
            return

        try:
            if runtime.process and runtime.process.is_alive():
                runtime.stop_event.set()
                runtime.process.join(timeout=timeout)
                if runtime.process.is_alive():
                    logger.warning(
                        "Tracker process '%s' did not exit within %.1fs; killing process",
                        normalized_id,
                        timeout,
                    )
                    try:
                        runtime.process.terminate()
                    except Exception:
                        pass
                    runtime.process.join(timeout=0.3)
                if runtime.process.is_alive():
                    try:
                        runtime.process.kill()
                    except Exception:
                        pass
                    runtime.process.join(timeout=0.3)
                    if runtime.process.is_alive():
                        logger.error(
                            "Tracker process '%s' is still alive after kill; continuing cleanup",
                            normalized_id,
                        )
            # Avoid queue finalizer hangs during teardown.
            try:
                runtime.queue_to_tracker.cancel_join_thread()
                runtime.queue_to_tracker.close()
            except Exception:
                pass
        finally:
            self.runtimes.pop(normalized_id, None)
            self.assign_rotator(normalized_id, None)

    def stop_all(self, timeout: float = 3.0) -> None:
        for tracker_id in list(self.runtimes.keys()):
            self.stop_tracker(tracker_id, timeout=timeout)

    def remove_tracker(self, tracker_id: str, timeout: float = 3.0) -> Dict[str, Any]:
        normalized_id = require_tracker_id(tracker_id)
        self.stop_tracker(normalized_id, timeout=timeout)
        self.managers.pop(normalized_id, None)
        self.tracker_rotator_map.pop(normalized_id, None)
        return {"success": True, "tracker_id": normalized_id}

    def get_runtime(self, tracker_id: str) -> Optional[TrackerRuntime]:
        return self.runtimes.get(require_tracker_id(tracker_id))

    def get_or_create_manager(self, tracker_id: str) -> TrackerManager:
        normalized_id = require_tracker_id(tracker_id)
        runtime = self.get_runtime(normalized_id)
        if runtime is None or not runtime.process.is_alive():
            runtime = self.start_tracker(normalized_id)

        manager = self.managers.get(normalized_id)
        if manager is None:
            manager = TrackerManager(
                queue_to_tracker=runtime.queue_to_tracker,
                tracker_id=normalized_id,
            )
            self.managers[normalized_id] = manager
        else:
            manager.queue_to_tracker = runtime.queue_to_tracker
        return manager

    def get_all_tracker_ids(self) -> list[str]:
        return sorted(self.runtimes.keys())

    def is_alive(self, tracker_id: str) -> bool:
        runtime = self.get_runtime(tracker_id)
        return bool(runtime and runtime.process and runtime.process.is_alive())

    def get_managers(self) -> Dict[str, TrackerManager]:
        return dict(self.managers)

    def assign_rotator(self, tracker_id: str, rotator_id: Optional[str]) -> Dict[str, Any]:
        normalized_tracker_id = require_tracker_id(tracker_id)
        self._ensure_target_number(normalized_tracker_id)
        normalized_rotator_id = self._normalize_rotator_id(rotator_id)
        previous_rotator_id = self.tracker_rotator_map.get(normalized_tracker_id)

        if previous_rotator_id == normalized_rotator_id:
            return {
                "success": True,
                "tracker_id": normalized_tracker_id,
                "rotator_id": normalized_rotator_id,
                "previous_rotator_id": previous_rotator_id,
            }

        if normalized_rotator_id:
            owner_tracker_id = self.rotator_tracker_map.get(normalized_rotator_id)
            if owner_tracker_id and owner_tracker_id != normalized_tracker_id:
                return {
                    "success": False,
                    "error": "rotator_in_use",
                    "tracker_id": normalized_tracker_id,
                    "rotator_id": normalized_rotator_id,
                    "owner_tracker_id": owner_tracker_id,
                    "previous_rotator_id": previous_rotator_id,
                }

        if previous_rotator_id:
            self.rotator_tracker_map.pop(previous_rotator_id, None)

        if normalized_rotator_id:
            self.rotator_tracker_map[normalized_rotator_id] = normalized_tracker_id
            self.tracker_rotator_map[normalized_tracker_id] = normalized_rotator_id
        else:
            self.tracker_rotator_map.pop(normalized_tracker_id, None)

        return {
            "success": True,
            "tracker_id": normalized_tracker_id,
            "rotator_id": normalized_rotator_id,
            "previous_rotator_id": previous_rotator_id,
        }

    def swap_rotators(self, tracker_a_id: str, tracker_b_id: str) -> Dict[str, Any]:
        normalized_tracker_a_id = require_tracker_id(tracker_a_id)
        normalized_tracker_b_id = require_tracker_id(tracker_b_id)
        self._ensure_target_number(normalized_tracker_a_id)
        self._ensure_target_number(normalized_tracker_b_id)

        if normalized_tracker_a_id == normalized_tracker_b_id:
            rotator_id = self.tracker_rotator_map.get(normalized_tracker_a_id)
            return {
                "success": True,
                "tracker_a_id": normalized_tracker_a_id,
                "tracker_b_id": normalized_tracker_b_id,
                "tracker_a_rotator_id": rotator_id,
                "tracker_b_rotator_id": rotator_id,
                "previous_tracker_a_rotator_id": rotator_id,
                "previous_tracker_b_rotator_id": rotator_id,
            }

        tracker_a_rotator_id = self.tracker_rotator_map.get(normalized_tracker_a_id)
        tracker_b_rotator_id = self.tracker_rotator_map.get(normalized_tracker_b_id)

        if tracker_b_rotator_id:
            self.tracker_rotator_map[normalized_tracker_a_id] = tracker_b_rotator_id
            self.rotator_tracker_map[tracker_b_rotator_id] = normalized_tracker_a_id
        else:
            self.tracker_rotator_map.pop(normalized_tracker_a_id, None)

        if tracker_a_rotator_id:
            self.tracker_rotator_map[normalized_tracker_b_id] = tracker_a_rotator_id
            self.rotator_tracker_map[tracker_a_rotator_id] = normalized_tracker_b_id
        else:
            self.tracker_rotator_map.pop(normalized_tracker_b_id, None)

        return {
            "success": True,
            "tracker_a_id": normalized_tracker_a_id,
            "tracker_b_id": normalized_tracker_b_id,
            "tracker_a_rotator_id": tracker_b_rotator_id,
            "tracker_b_rotator_id": tracker_a_rotator_id,
            "previous_tracker_a_rotator_id": tracker_a_rotator_id,
            "previous_tracker_b_rotator_id": tracker_b_rotator_id,
        }

    def get_assigned_rotator(self, tracker_id: str) -> Optional[str]:
        return self.tracker_rotator_map.get(require_tracker_id(tracker_id))

    def get_instances_payload(self) -> Dict[str, Any]:
        tracker_ids = sorted(
            set(self.runtimes.keys())
            | set(self.managers.keys())
            | set(self.tracker_rotator_map.keys())
        )
        instances: list[Dict[str, Any]] = []
        for tracker_id in tracker_ids:
            runtime = self.runtimes.get(tracker_id)
            manager = self.managers.get(tracker_id)
            target_number = self._ensure_target_number(tracker_id)
            tracking_state = (
                dict(manager.current_tracking_state)
                if manager and manager.current_tracking_state
                else {}
            )
            instances.append(
                {
                    "tracker_id": tracker_id,
                    "target_number": target_number,
                    "rotator_id": self.tracker_rotator_map.get(tracker_id),
                    "is_alive": bool(runtime and runtime.process and runtime.process.is_alive()),
                    "pid": runtime.process.pid if runtime and runtime.process else None,
                    "tracking_state": tracking_state,
                }
            )

        return {
            "instances": instances,
            "updated_at": time.time(),
        }


_tracker_supervisor = TrackerSupervisor()

queue_from_tracker: Queue = _tracker_supervisor.output_queue


def start_tracker_process(tracker_id: str):
    normalized_id = require_tracker_id(tracker_id)
    runtime = _tracker_supervisor.start_tracker(normalized_id)
    return runtime.process, runtime.queue_to_tracker, queue_from_tracker, runtime.stop_event


def stop_tracker_process(tracker_id: str, timeout: float = 3.0) -> None:
    _tracker_supervisor.stop_tracker(tracker_id, timeout=timeout)


def stop_all_tracker_processes(timeout: float = 3.0) -> None:
    _tracker_supervisor.stop_all(timeout=timeout)


def get_tracker_manager(tracker_id: str) -> TrackerManager:
    manager = _tracker_supervisor.get_or_create_manager(tracker_id)
    return manager


def get_existing_tracker_manager(tracker_id: str) -> Optional[TrackerManager]:
    normalized_id = require_tracker_id(tracker_id)
    return _tracker_supervisor.get_managers().get(normalized_id)


def remove_tracker_instance(tracker_id: str, timeout: float = 3.0) -> Dict[str, Any]:
    return _tracker_supervisor.remove_tracker(tracker_id, timeout=timeout)


def get_tracker_supervisor() -> TrackerSupervisor:
    return _tracker_supervisor


def assign_rotator_to_tracker(tracker_id: str, rotator_id: Optional[str]) -> Dict[str, Any]:
    return _tracker_supervisor.assign_rotator(tracker_id, rotator_id)


def restore_tracker_rotator_assignment(tracker_id: str, rotator_id: Optional[str]) -> None:
    _tracker_supervisor.assign_rotator(tracker_id, rotator_id)


def get_assigned_rotator_for_tracker(tracker_id: str) -> Optional[str]:
    return _tracker_supervisor.get_assigned_rotator(tracker_id)


def swap_rotators_between_trackers(tracker_a_id: str, tracker_b_id: str) -> Dict[str, Any]:
    return _tracker_supervisor.swap_rotators(tracker_a_id, tracker_b_id)


def get_tracker_instances_payload() -> Dict[str, Any]:
    return _tracker_supervisor.get_instances_payload()


def get_all_tracker_managers() -> Dict[str, TrackerManager]:
    return _tracker_supervisor.get_managers()
