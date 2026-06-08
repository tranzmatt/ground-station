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

import traceback
import uuid
from datetime import datetime, timezone
from typing import Union

from sqlalchemy import delete, func, insert, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from common.common import logger, serialize_object
from db.models import Locations


async def fetch_location(session: AsyncSession, location_id: Union[uuid.UUID, str]) -> dict:
    """
    Fetch a single location by its UUID or its string representation.
    """
    try:
        if isinstance(location_id, str):
            location_id = uuid.UUID(location_id)

        stmt = select(Locations).filter(Locations.id == location_id)
        result = await session.execute(stmt)
        location = result.scalar_one_or_none()
        location = serialize_object(location)
        return {"success": True, "data": location, "error": None}

    except Exception as e:
        logger.error(f"Error fetching a location: {e}")
        logger.error(traceback.format_exc())
        return {"success": False, "error": str(e)}


async def fetch_all_locations(session: AsyncSession) -> dict:
    """
    Fetch all location records.
    """
    try:
        # Keep row order deterministic because several subsystems consume the first row.
        stmt = select(Locations).order_by(Locations.updated.desc(), Locations.added.desc())
        result = await session.execute(stmt)
        locations = result.scalars().all()
        locations = serialize_object(locations)
        return {"success": True, "data": locations, "error": None}

    except Exception as e:
        logger.error(f"Error fetching locations: {e}")
        logger.error(traceback.format_exc())
        return {"success": False, "error": str(e)}


async def add_location(session: AsyncSession, data: dict) -> dict:
    """
    Create and add a new location record.
    """
    try:
        now = datetime.now(timezone.utc)
        payload = dict(data)
        payload.pop("id", None)
        payload.pop("added", None)
        payload.pop("updated", None)
        location_name = str(payload.get("name") or "").strip().lower()

        # Frontend currently manages a single "home" location.
        # Treat submit as upsert for this logical singleton to avoid duplicates.
        if location_name == "home":
            payload["name"] = "home"
            existing_home_stmt = (
                select(Locations)
                .where(func.lower(Locations.name) == "home")
                .order_by(Locations.updated.desc(), Locations.added.desc())
            )
            existing_home_result = await session.execute(existing_home_stmt)
            existing_home = existing_home_result.scalar_one_or_none()
            if existing_home:
                payload["updated"] = now
                upd_stmt = (
                    update(Locations)
                    .where(Locations.id == existing_home.id)
                    .values(**payload)
                    .returning(Locations)
                )
                upd_result = await session.execute(upd_stmt)
                await session.commit()
                updated_home = upd_result.scalar_one_or_none()
                updated_home = serialize_object(updated_home)
                return {"success": True, "data": updated_home, "error": None}

        new_id = uuid.uuid4()
        payload["id"] = new_id
        payload["added"] = now
        payload["updated"] = now

        stmt = insert(Locations).values(**payload).returning(Locations)

        result = await session.execute(stmt)
        await session.commit()
        new_location = result.scalar_one()
        new_location = serialize_object(new_location)
        return {"success": True, "data": new_location, "error": None}

    except Exception as e:
        await session.rollback()
        logger.error(f"Error adding a location: {e}")
        logger.error(traceback.format_exc())
        return {"success": False, "error": str(e)}


async def edit_location(session: AsyncSession, data: dict) -> dict:
    """
    Edit an existing location record by updating provided fields.
    """
    try:
        # Extract location_id from data
        location_id = data.pop("id", None)
        if not location_id:
            raise Exception("id is required.")

        if data.get("added", None) is not None:
            del data["added"]
        if data.get("updated", None) is not None:
            del data["updated"]

        # Convert to UUID if it's a string
        if isinstance(location_id, str):
            location_id = uuid.UUID(location_id)

        # Ensure the location exists first
        stmt = select(Locations).filter(Locations.id == location_id)
        result = await session.execute(stmt)
        location = result.scalar_one_or_none()
        if not location:
            return {"success": False, "error": f"Location with id {location_id} not found."}

        upd_stmt = (
            update(Locations).where(Locations.id == location_id).values(**data).returning(Locations)
        )
        upd_result = await session.execute(upd_stmt)
        await session.commit()
        updated_location = upd_result.scalar_one_or_none()
        updated_location = serialize_object(updated_location)
        return {"success": True, "data": updated_location, "error": None}

    except Exception as e:
        await session.rollback()
        logger.error(f"Error editing a location: {e}")
        logger.error(traceback.format_exc())
        return {"success": False, "error": str(e)}


async def delete_location(session: AsyncSession, location_id: Union[uuid.UUID, str]) -> dict:
    """
    Delete a location record by its UUID.
    """
    try:
        # Convert to UUID if it's a string
        if isinstance(location_id, str):
            location_id = uuid.UUID(location_id)

        stmt = delete(Locations).where(Locations.id == location_id).returning(Locations)
        result = await session.execute(stmt)
        deleted = result.scalar_one_or_none()
        if not deleted:
            return {"success": False, "error": f"Location with id {location_id} not found."}
        await session.commit()
        return {"success": True, "data": None, "error": None}

    except Exception as e:
        await session.rollback()
        logger.error(f"Error deleting a location: {e}")
        logger.error(traceback.format_exc())
        return {"success": False, "error": str(e)}
