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

import queue
from types import SimpleNamespace

from demodulators.gnsssdrdecoder import GNSSSdrDecoder


def _build_test_config():
    return SimpleNamespace(
        gnss_sample_rate=4_000_000,
        gnss_total_channels=24,
        gnss_output_rate_ms=500,
        gnss_doppler_max=6000,
        gnss_enable_gps=True,
        gnss_enable_galileo=True,
        gnss_enable_glonass=True,
        gnss_enable_beidou=True,
        gnss_enable_qzss=True,
        baudrate=0,
        framing="gnss",
        config_source="test",
        satellite={},
        transmitter={},
    )


def _build_decoder():
    return GNSSSdrDecoder(
        iq_queue=queue.Queue(),
        data_queue=queue.Queue(),
        session_id="test-session",
        config=_build_test_config(),
        vfo=1,
    )


def test_handle_gnss_log_line_emits_lost_event_channel_first_format():
    decoder = _build_decoder()
    emitted = []
    decoder._send_output_update = lambda payload: emitted.append(payload)
    decoder._send_status_update = lambda *_args, **_kwargs: None

    decoder._handle_gnss_log_line("Loss of lock in channel 3 for satellite GPS PRN 07")

    assert len(emitted) == 1
    assert emitted[0]["event"] == "lost"
    assert emitted[0]["satellite_system"] == "G"
    assert emitted[0]["satellite_prn"] == 7
    assert emitted[0]["channel"] == 3


def test_handle_gnss_log_line_emits_lost_event_satellite_first_format():
    decoder = _build_decoder()
    emitted = []
    decoder._send_output_update = lambda payload: emitted.append(payload)
    decoder._send_status_update = lambda *_args, **_kwargs: None

    decoder._handle_gnss_log_line("Loss of lock for satellite E 29 in channel 2")

    assert len(emitted) == 1
    assert emitted[0]["event"] == "lost"
    assert emitted[0]["satellite_system"] == "E"
    assert emitted[0]["satellite_prn"] == 29
    assert emitted[0]["channel"] == 2


def test_poll_gnss_log_updates_processes_only_loss_lines(tmp_path):
    decoder = _build_decoder()
    log_file = tmp_path / "gnss.log"
    log_file.write_text(
        "\n".join(
            [
                "Tracking in channel 1 for satellite GPS PRN 03",
                "Loss of lock in channel 1 for satellite GPS PRN 03",
                "Successful acquisition in channel 1 for satellite G 3",
            ]
        )
        + "\n",
        encoding="utf-8",
    )

    decoder.gnss_info_log_path = str(log_file)
    decoder.gnss_log_read_offset = 0
    handled_lines = []
    decoder._handle_gnss_log_line = lambda line: handled_lines.append(line.strip())

    decoder._poll_gnss_log_updates()

    assert handled_lines == ["Loss of lock in channel 1 for satellite GPS PRN 03"]
