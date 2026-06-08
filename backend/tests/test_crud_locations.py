# Copyright (c) 2026 Efstratios Goudelis
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

"""
Unit tests for location CRUD and location handler response behavior.
"""

import asyncio

import pytest

import crud.locations as crud_locations
from handlers.entities import locations as locations_handler


class _SessionContext:
    def __init__(self, session):
        self._session = session

    async def __aenter__(self):
        return self._session

    async def __aexit__(self, exc_type, exc, tb):
        return False


class _Logger:
    def debug(self, *args, **kwargs):
        del args, kwargs


@pytest.mark.asyncio
class TestLocationsCrud:
    async def test_add_location_home_is_upsert(self, db_session):
        first = await crud_locations.add_location(
            db_session,
            {"name": "home", "lat": 37.9838, "lon": 23.7275, "alt": 145},
        )
        second = await crud_locations.add_location(
            db_session,
            {"name": "home", "lat": 40.6401, "lon": 22.9444, "alt": 12},
        )

        assert first["success"] is True
        assert second["success"] is True
        assert first["data"]["id"] == second["data"]["id"]
        assert float(second["data"]["lat"]) == pytest.approx(40.6401)
        assert float(second["data"]["lon"]) == pytest.approx(22.9444)
        assert int(second["data"]["alt"]) == 12

        all_locations = await crud_locations.fetch_all_locations(db_session)
        assert all_locations["success"] is True
        assert len(all_locations["data"]) == 1
        assert all_locations["data"][0]["id"] == first["data"]["id"]

    async def test_fetch_all_locations_returns_newest_first(self, db_session):
        first = await crud_locations.add_location(
            db_session,
            {"name": "alpha", "lat": 10.0, "lon": 20.0, "alt": 1},
        )
        await asyncio.sleep(0.002)
        second = await crud_locations.add_location(
            db_session,
            {"name": "beta", "lat": 30.0, "lon": 40.0, "alt": 2},
        )

        assert first["success"] is True
        assert second["success"] is True

        all_locations = await crud_locations.fetch_all_locations(db_session)
        assert all_locations["success"] is True
        assert len(all_locations["data"]) == 2
        assert all_locations["data"][0]["name"] == "beta"
        assert all_locations["data"][1]["name"] == "alpha"


@pytest.mark.asyncio
class TestLocationHandlers:
    async def test_submit_location_returns_saved_row(self, db_session, monkeypatch):
        monkeypatch.setattr(
            locations_handler,
            "AsyncSessionLocal",
            lambda: _SessionContext(db_session),
        )
        monkeypatch.setattr(locations_handler, "get_all_tracker_managers", lambda: {})

        reply = await locations_handler.submit_location(
            None,
            {"name": "home", "lat": 37.9838, "lon": 23.7275, "alt": 145},
            _Logger(),
            "sid-test",
        )

        assert reply["success"] is True
        assert isinstance(reply.get("data"), dict)
        assert reply["data"]["id"] is not None
        assert float(reply["data"]["lat"]) == pytest.approx(37.9838)

    async def test_edit_location_returns_updated_row(self, db_session, monkeypatch):
        added = await crud_locations.add_location(
            db_session,
            {"name": "home", "lat": 37.9838, "lon": 23.7275, "alt": 145},
        )
        location_id = added["data"]["id"]

        monkeypatch.setattr(
            locations_handler,
            "AsyncSessionLocal",
            lambda: _SessionContext(db_session),
        )
        monkeypatch.setattr(locations_handler, "get_all_tracker_managers", lambda: {})

        reply = await locations_handler.edit_location(
            None,
            {"id": location_id, "name": "home", "lat": 40.6401, "lon": 22.9444, "alt": 12},
            _Logger(),
            "sid-test",
        )

        assert reply["success"] is True
        assert isinstance(reply.get("data"), dict)
        assert reply["data"]["id"] == location_id
        assert float(reply["data"]["lat"]) == pytest.approx(40.6401)
        assert float(reply["data"]["lon"]) == pytest.approx(22.9444)
