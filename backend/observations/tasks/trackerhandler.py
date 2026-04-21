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

"""Tracker task handler - manages rotator tracking lifecycle."""

import asyncio
import traceback
from typing import Any, Dict, List

from common.logger import logger
from tracker.contracts import normalize_tracker_id, require_tracker_id
from tracker.runner import get_tracker_manager


class TrackerHandler:
    """Handles rotator tracking lifecycle for observations."""

    @staticmethod
    def _resolve_tracker_id(rotator_config: Dict[str, Any]) -> str:
        tracker_id: str = normalize_tracker_id(rotator_config.get("tracker_id"))
        if tracker_id:
            return tracker_id
        return str(require_tracker_id(rotator_config.get("id")))

    async def start_tracker_task(
        self,
        observation_id: str,
        satellite: Dict[str, Any],
        rotator_config: Dict[str, Any],
        tasks: List[Dict[str, Any]],
    ) -> bool:
        """
        Start rotator tracking for an observation.

        Args:
            observation_id: The observation ID
            satellite: Satellite information dict
            rotator_config: Rotator configuration dict
            tasks: List of observation tasks

        Returns:
            True if tracker started successfully
        """
        try:
            if not rotator_config.get("tracking_enabled") or not rotator_config.get("id"):
                logger.debug(f"Rotator tracking not enabled for observation {observation_id}")
                return False

            # Extract transmitter ID from decoder tasks (if any)
            transmitter_id = "none"
            for task in tasks:
                if task.get("type") == "decoder":
                    transmitter_id = task.get("config", {}).get("transmitter_id", "none")
                    break

            # Update tracking state to target this satellite
            tracker_id = self._resolve_tracker_id(rotator_config)
            tracker_manager = get_tracker_manager(tracker_id)
            unpark_before_tracking = bool(rotator_config.get("unpark_before_tracking", False))
            tracking_state = await tracker_manager.get_tracking_state() or {}
            current_rotator_state = str(tracking_state.get("rotator_state", "")).lower()

            # Optional unpark step before switching to tracking mode.
            if current_rotator_state == "parked" and unpark_before_tracking:
                await tracker_manager.update_tracking_state(
                    rotator_state="connected",
                    rotator_id=rotator_config.get("id"),
                )
                await asyncio.sleep(0.2)

            await tracker_manager.update_tracking_state(
                norad_id=satellite.get("norad_id"),
                group_id=satellite.get("group_id"),
                rotator_state="tracking",  # Start tracking satellite
                rotator_id=rotator_config.get("id"),
                rig_state="disconnected",  # Observations don't use rig for now
                rig_id="none",
                transmitter_id=transmitter_id,
                rig_vfo="none",
                vfo1="uplink",
                vfo2="downlink",
            )

            logger.info(
                f"Started tracking {satellite.get('name')} (NORAD {satellite.get('norad_id')}) "
                f"for observation {observation_id}"
            )
            return True

        except Exception as e:
            logger.error(f"Error starting tracker: {e}")
            logger.error(traceback.format_exc())
            return False

    async def stop_tracker_task(self, observation_id: str, rotator_config: Dict[str, Any]) -> bool:
        """
        Stop rotator tracking for an observation.

        Args:
            observation_id: The observation ID
            rotator_config: Rotator configuration dict

        Returns:
            True if tracker stop/park operations succeeded
        """
        try:
            if not rotator_config.get("tracking_enabled") or not rotator_config.get("id"):
                logger.debug(f"No rotator configured for observation {observation_id}")
                return True

            tracker_id = self._resolve_tracker_id(rotator_config)
            tracker_manager = get_tracker_manager(tracker_id)
            park_after_observation = bool(rotator_config.get("park_after_observation", False))

            if park_after_observation:
                await tracker_manager.update_tracking_state(
                    rotator_state="parked",
                    rotator_id=rotator_config.get("id"),
                )
                logger.info(f"Parked rotator after observation {observation_id}")
            else:
                logger.debug(f"Leaving rotator connected after observation {observation_id}")

            return True
        except Exception as e:
            logger.error(f"Error stopping tracker for observation {observation_id}: {e}")
            logger.error(traceback.format_exc())
            return False
