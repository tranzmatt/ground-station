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

"""First-time initialization logic for new database setup."""

import asyncio
import random
import string

from common.logger import logger
from db import AsyncSessionLocal
from db.models import TLESources
from tasks.registry import get_task

# TLE sync is now handled by background task manager
# from tlesync.logic import synchronize_satellite_data


async def first_time_initialization():
    """Function called on first server start to populate database with default data."""
    logger.info("Filling in initial data like TLE sources and default location...")
    async with AsyncSessionLocal() as session:
        try:

            def generate_identifier(length=16):
                """Generate a random identifier similar to what the CRUD does."""
                return "".join(random.choices(string.ascii_lowercase + string.digits, k=length))

            logger.info("FIRSTTIME - Populating database with default data...")
            # Add default TLE sources
            default_sources = [
                (
                    "Cubesats",
                    "http://www.celestrak.com/NORAD/elements/cubesat.txt",
                ),
                (
                    "NOAA",
                    "http://celestrak.org/NORAD/elements/gp.php?GROUP=noaa&FORMAT=tle",
                ),
                (
                    "Space stations",
                    "http://www.celestrak.com/NORAD/elements/gp.php?GROUP=stations&FORMAT=tle",
                ),
                (
                    "Weather",
                    "http://www.celestrak.org/NORAD/elements/gp.php?GROUP=weather&FORMAT=tle",
                ),
                (
                    "TinyGS",
                    "https://api.tinygs.com/v1/tinygs_supported.txt",
                ),
            ]

            for source_name, source_url in default_sources:
                source = TLESources(
                    name=source_name,
                    identifier=generate_identifier(),
                    url=source_url,
                    format="3le",
                )
                session.add(source)

            await session.commit()
            logger.info(
                "Initial data populated successfully with default TLE sources: "
                "Cubesats, NOAA, Space stations, Weather, TinyGS."
            )

        except Exception as e:
            logger.error(f"Error populating initial data: {e}")
            await session.rollback()
            raise


async def run_initial_sync(background_task_manager):
    """
    Run the initial satellite data synchronization after delay as a background task.

    This runs on first-time setup after database creation to populate TLE data.
    Uses the background task manager for consistency with other sync triggers.

    Args:
        background_task_manager: BackgroundTaskManager instance
    """
    try:
        logger.info("Waiting 5 seconds before starting initial synchronization...")
        await asyncio.sleep(5)
        logger.info("Starting initial satellite data synchronization as background task...")

        # Get the TLE sync task function
        tle_sync_task = get_task("tle_sync")

        # Start as background task
        task_id = await background_task_manager.start_task(
            func=tle_sync_task, args=(), kwargs={}, name="Initial TLE Sync", task_id=None
        )

        logger.info(f"Initial TLE sync started as background task: {task_id}")

    except Exception as e:
        logger.error(f"Error starting initial satellite synchronization: {e}")
        logger.exception(e)
