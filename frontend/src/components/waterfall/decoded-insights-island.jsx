/**
 * @license
 * Copyright (c) 2025 Efstratios Goudelis
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program. If not, see <https://www.gnu.org/licenses/>.
 *
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Box, Chip, Divider, Typography, useTheme } from '@mui/material';
import { DataGrid, gridClasses } from '@mui/x-data-grid';
import { shallowEqual, useSelector } from 'react-redux';
import {
    AntTab,
    AntTabs,
    getClassNamesBasedOnGridEditing,
    TitleBar,
} from '../common/common.jsx';
import DecodedPacketsDrawer from './decoded-packets-drawer.jsx';
import { useSocket } from '../common/socket.jsx';
import { useUserTimeSettings } from '../../hooks/useUserTimeSettings.jsx';
import { formatDateTime } from '../../utils/date-time.js';

const CONSTELLATION_BY_CODE = {
    G: 'GPS',
    E: 'GALILEO',
    R: 'GLONASS',
    C: 'BEIDOU',
    B: 'BEIDOU',
    J: 'QZSS',
};

function normalizeConstellation(value) {
    if (!value) return '';
    const raw = String(value).trim();
    const upper = raw.toUpperCase();
    if (CONSTELLATION_BY_CODE[upper]) {
        return CONSTELLATION_BY_CODE[upper];
    }
    if (upper === 'GALILEO') return 'GALILEO';
    if (upper === 'GLONASS') return 'GLONASS';
    if (upper === 'BEIDOU') return 'BEIDOU';
    if (upper === 'GPS') return 'GPS';
    if (upper === 'QZSS') return 'QZSS';
    return raw;
}

function extractChannel(output) {
    if (output?.channel !== undefined && output?.channel !== null) {
        const parsed = Number(output.channel);
        return Number.isFinite(parsed) ? parsed : null;
    }
    const message = String(output?.message || '');
    const match = message.match(/channel\s+(\d+)/i);
    if (!match) return null;
    const parsed = Number(match[1]);
    return Number.isFinite(parsed) ? parsed : null;
}

function extractSatelliteIdentity(output) {
    if (!output) return null;

    const code = String(output.satellite_system || '').trim().toUpperCase();
    const prnFromFields = Number(output.satellite_prn);
    if (code && Number.isFinite(prnFromFields)) {
        const constellation = normalizeConstellation(code);
        return {
            constellation,
            prn: prnFromFields,
        };
    }

    const satelliteText = String(output.satellite || '');
    const prnNameMatch = satelliteText.match(/([A-Za-z]+)\s+PRN\s+(\d+)/i);
    if (prnNameMatch) {
        return {
            constellation: normalizeConstellation(prnNameMatch[1]),
            prn: Number(prnNameMatch[2]),
        };
    }

    const message = String(output.message || '');
    const acqMatch = message.match(/for satellite\s+([A-Z])\s+(\d+)/i);
    if (acqMatch) {
        return {
            constellation: normalizeConstellation(acqMatch[1]),
            prn: Number(acqMatch[2]),
        };
    }

    const trackingMatch = message.match(/for satellite\s+([A-Za-z]+)\s+PRN\s+(\d+)/i);
    if (trackingMatch) {
        return {
            constellation: normalizeConstellation(trackingMatch[1]),
            prn: Number(trackingMatch[2]),
        };
    }

    return null;
}

function getStateForEvent(eventType, message, fallbackState = 'detected') {
    const normalizedMessage = String(message || '').toLowerCase();
    if (eventType === 'acquisition') return 'acquired';
    if (eventType === 'tracking' || eventType === 'nmea' || eventType === 'nmea_gga' || eventType === 'nmea_rmc') {
        return 'tracking';
    }
    if (normalizedMessage.includes('loss of lock')) return 'lost';
    if (normalizedMessage.includes('idle state')) return 'idle';
    return fallbackState;
}

function getMatchDisplayStatus(matchEntry) {
    if (!matchEntry) return 'pending';
    return matchEntry.status;
}

function buildSearchQuery(satellite) {
    return `${satellite.constellation} PRN ${String(satellite.prn).padStart(2, '0')}`;
}

function pickBestSatelliteMatch(candidates, satellite) {
    if (!Array.isArray(candidates) || candidates.length === 0) {
        return null;
    }

    const prn = String(satellite.prn);
    const constellation = String(satellite.constellation || '').toLowerCase();

    const scored = candidates.map((candidate) => {
        const haystack = [
            candidate?.name,
            candidate?.name_other,
            candidate?.alternative_name,
        ]
            .filter(Boolean)
            .join(' ')
            .toLowerCase();

        let score = 0;
        if (haystack.includes(constellation)) score += 2;
        if (haystack.includes(`prn ${prn}`)) score += 4;
        if (haystack.includes(`prn${prn}`)) score += 3;
        if (haystack.includes(prn)) score += 1;

        return { candidate, score };
    });

    scored.sort((a, b) => b.score - a.score);
    return scored[0].candidate;
}

const DecodedInsightsIsland = React.memo(function DecodedInsightsIsland() {
    const theme = useTheme();
    const { socket } = useSocket();
    const { timezone, locale } = useUserTimeSettings();
    const inflightMatchesRef = useRef(new Set());
    const [activeTab, setActiveTab] = useState('packets');
    const [selectedSatelliteId, setSelectedSatelliteId] = useState(null);
    const [satelliteMatches, setSatelliteMatches] = useState({});

    const { outputs, gridEditable } = useSelector(
        (state) => ({
            outputs: state.decoders.outputs,
            gridEditable: state.waterfall.gridEditable,
        }),
        shallowEqual
    );

    const formatTimestamp = useCallback((value) => {
        if (!value) return '-';
        return formatDateTime(value, {
            timezone,
            locale,
            options: {
                hour12: false,
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
            },
        });
    }, [timezone, locale]);

    const { satelliteRows, gnssEventCount } = useMemo(() => {
        const gnssOutputs = outputs
            .filter((item) => item?.type === 'decoder-output' && item?.decoder_type === 'gnss')
            .map((item) => ({
                timestampMs: Number(item.timestamp) * 1000,
                output: item.output || {},
            }))
            .filter((item) => Number.isFinite(item.timestampMs))
            .sort((a, b) => a.timestampMs - b.timestampMs);

        const rowsById = new Map();

        for (const item of gnssOutputs) {
            const output = item.output || {};
            const identity = extractSatelliteIdentity(output);
            if (!identity || !identity.constellation || !Number.isFinite(identity.prn)) {
                continue;
            }

            const id = `${identity.constellation}-${identity.prn}`;
            const eventType = String(output.event || 'event');
            const message = String(output.message || '');
            const eventState = getStateForEvent(eventType, message);
            const channel = extractChannel(output);

            if (!rowsById.has(id)) {
                rowsById.set(id, {
                    id,
                    satelliteId: `${identity.constellation} ${String(identity.prn).padStart(2, '0')}`,
                    constellation: identity.constellation,
                    prn: identity.prn,
                    state: eventState,
                    eventCount: 0,
                    acquisitionCount: 0,
                    trackingCount: 0,
                    nmeaCount: 0,
                    firstSeen: item.timestampMs,
                    lastSeen: item.timestampMs,
                    lastChannel: channel,
                    lastEvent: eventType,
                    lastMessage: message || '-',
                    latitude: null,
                    longitude: null,
                    altitudeM: null,
                    fixQuality: null,
                    events: [],
                });
            }

            const row = rowsById.get(id);
            row.eventCount += 1;
            row.firstSeen = Math.min(row.firstSeen, item.timestampMs);
            row.lastSeen = Math.max(row.lastSeen, item.timestampMs);
            row.lastChannel = channel ?? row.lastChannel;
            row.lastEvent = eventType;
            row.lastMessage = message || row.lastMessage;
            row.state = eventState || row.state;

            if (eventType === 'acquisition') row.acquisitionCount += 1;
            if (eventType === 'tracking') row.trackingCount += 1;
            if (eventType === 'nmea' || eventType === 'nmea_gga' || eventType === 'nmea_rmc') row.nmeaCount += 1;

            if (output.latitude !== undefined && output.latitude !== null) row.latitude = output.latitude;
            if (output.longitude !== undefined && output.longitude !== null) row.longitude = output.longitude;
            if (output.altitude_m !== undefined && output.altitude_m !== null) row.altitudeM = output.altitude_m;
            if (output.fix_quality !== undefined && output.fix_quality !== null) row.fixQuality = output.fix_quality;

            row.events.push({
                timestampMs: item.timestampMs,
                eventType,
                state: eventState,
                channel,
                message: message || '-',
            });
        }

        const rows = Array.from(rowsById.values()).sort((a, b) => b.lastSeen - a.lastSeen);
        for (const row of rows) {
            row.events.sort((a, b) => b.timestampMs - a.timestampMs);
        }

        return {
            satelliteRows: rows,
            gnssEventCount: gnssOutputs.length,
        };
    }, [outputs]);

    const packetOutputCount = useMemo(() => {
        return outputs.filter(
            (item) => item?.type === 'decoder-output'
                && String(item?.decoder_type || '').toLowerCase() !== 'gnss'
        ).length;
    }, [outputs]);

    useEffect(() => {
        if (!selectedSatelliteId || !satelliteRows.find((row) => row.id === selectedSatelliteId)) {
            setSelectedSatelliteId(satelliteRows[0]?.id || null);
        }
    }, [satelliteRows, selectedSatelliteId]);

    // Resolve unknown GNSS satellites against the local satellite DB incrementally
    // so UI remains responsive even when many rows appear at once.
    useEffect(() => {
        if (!socket || satelliteRows.length === 0) {
            return;
        }

        let started = 0;
        for (const satellite of satelliteRows) {
            if (started >= 3) break;
            if (satelliteMatches[satellite.id] || inflightMatchesRef.current.has(satellite.id)) continue;

            started += 1;
            const query = buildSearchQuery(satellite);
            inflightMatchesRef.current.add(satellite.id);
            setSatelliteMatches((prev) => ({
                ...prev,
                [satellite.id]: { status: 'loading', query },
            }));

            socket.emit('data_request', 'get-satellite-search', query, (response) => {
                inflightMatchesRef.current.delete(satellite.id);

                if (!response?.success) {
                    setSatelliteMatches((prev) => ({
                        ...prev,
                        [satellite.id]: { status: 'error', query, error: response?.error || 'Search failed' },
                    }));
                    return;
                }

                const candidates = Array.isArray(response?.data) ? response.data : [];
                const best = pickBestSatelliteMatch(candidates, satellite);
                setSatelliteMatches((prev) => ({
                    ...prev,
                    [satellite.id]: best
                        ? { status: 'matched', query, match: best, candidates: candidates.length }
                        : { status: 'none', query, candidates: 0 },
                }));
            });
        }
    }, [satelliteMatches, satelliteRows, socket]);

    const selectedSatellite = useMemo(() => {
        return satelliteRows.find((row) => row.id === selectedSatelliteId) || null;
    }, [satelliteRows, selectedSatelliteId]);

    const gnssGridRows = useMemo(() => {
        return satelliteRows.map((row) => {
            const matchEntry = satelliteMatches[row.id];
            const matchStatus = getMatchDisplayStatus(matchEntry);
            const matchedName = matchEntry?.match?.name || '-';
            const matchedNorad = matchEntry?.match?.norad_id || null;

            return {
                ...row,
                matchStatus,
                matchedName,
                matchedNorad,
            };
        });
    }, [satelliteRows, satelliteMatches]);

    const gnssColumns = useMemo(() => ([
        {
            field: 'satelliteId',
            headerName: 'Satellite',
            minWidth: 120,
            flex: 0.9,
            renderCell: (params) => (
                <Typography variant="caption" sx={{ fontWeight: 700, color: 'text.primary' }}>
                    {params.value}
                </Typography>
            ),
        },
        {
            field: 'state',
            headerName: 'State',
            minWidth: 95,
            flex: 0.7,
            renderCell: (params) => (
                <Chip
                    size="small"
                    label={String(params.value || '-').toUpperCase()}
                    sx={{
                        height: 20,
                        fontSize: '0.65rem',
                        fontWeight: 700,
                    }}
                    color={
                        params.value === 'tracking' ? 'success'
                            : params.value === 'acquired' ? 'info'
                                : params.value === 'lost' ? 'warning'
                                    : 'default'
                    }
                    variant={params.value === 'tracking' ? 'filled' : 'outlined'}
                />
            ),
        },
        {
            field: 'lastChannel',
            headerName: 'Chan',
            minWidth: 70,
            flex: 0.45,
            align: 'center',
            headerAlign: 'center',
            valueFormatter: (value) => (value === undefined || value === null ? '-' : value),
        },
        {
            field: 'acquisitionCount',
            headerName: 'Acq',
            minWidth: 65,
            flex: 0.4,
            align: 'center',
            headerAlign: 'center',
        },
        {
            field: 'trackingCount',
            headerName: 'Track',
            minWidth: 70,
            flex: 0.45,
            align: 'center',
            headerAlign: 'center',
        },
        {
            field: 'lastSeen',
            headerName: 'Last Seen',
            minWidth: 170,
            flex: 1.2,
            renderCell: (params) => (
                <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                    {formatTimestamp(params.value)}
                </Typography>
            ),
        },
        {
            field: 'matchedNorad',
            headerName: 'DB Match',
            minWidth: 160,
            flex: 1.1,
            renderCell: (params) => {
                const row = params.row;
                if (row.matchStatus === 'loading' || row.matchStatus === 'pending') {
                    return <Typography variant="caption" sx={{ color: 'text.secondary' }}>Matching...</Typography>;
                }
                if (row.matchStatus !== 'matched') {
                    return <Typography variant="caption" sx={{ color: 'text.disabled' }}>Unmatched</Typography>;
                }
                return (
                    <Typography variant="caption" sx={{ color: 'info.main', fontWeight: 700 }}>
                        {`${row.matchedName} (${row.matchedNorad})`}
                    </Typography>
                );
            },
        },
        {
            field: 'lastMessage',
            headerName: 'Last Message',
            minWidth: 300,
            flex: 2.1,
            renderCell: (params) => (
                <Typography
                    variant="caption"
                    sx={{
                        color: 'text.secondary',
                        fontFamily: 'monospace',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        width: '100%',
                    }}
                >
                    {params.value}
                </Typography>
            ),
        },
    ]), [formatTimestamp]);

    return (
        <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
            <TitleBar
                className={getClassNamesBasedOnGridEditing(gridEditable, ['window-title-bar'])}
            >
                <Typography variant="subtitle2" sx={{ fontWeight: 'bold' }}>
                    Decoded
                </Typography>
            </TitleBar>

            <AntTabs
                value={activeTab}
                onChange={(_, value) => setActiveTab(value)}
                variant="standard"
                sx={{
                    px: 1,
                    minHeight: 30,
                    '& .MuiTabs-flexContainer': {
                        justifyContent: 'flex-start',
                        alignItems: 'center',
                        gap: 0.5,
                    },
                    '& .MuiTabs-indicator': {
                        height: 2,
                    },
                }}
            >
                <AntTab
                    value="packets"
                    label={`PACKETS (${packetOutputCount})`}
                    sx={{
                        minHeight: 30,
                        height: 30,
                        minWidth: 0,
                        px: 1.25,
                        py: 0.25,
                        fontSize: '0.72rem',
                    }}
                />
                <AntTab
                    value="gnss"
                    label={`GNSS (${satelliteRows.length})`}
                    sx={{
                        minHeight: 30,
                        height: 30,
                        minWidth: 0,
                        px: 1.25,
                        py: 0.25,
                        fontSize: '0.72rem',
                    }}
                />
            </AntTabs>

            <Box sx={{ flex: 1, minHeight: 0, backgroundColor: theme.palette.background.paper }}>
                {activeTab === 'packets' && (
                    <DecodedPacketsDrawer embedded />
                )}

                {activeTab === 'gnss' && (
                    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
                        <Box sx={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'row' }}>
                            <Box sx={{ flex: 1, minWidth: 0 }}>
                                <DataGrid
                                    rows={gnssGridRows}
                                    columns={gnssColumns}
                                    density="compact"
                                    disableRowSelectionOnClick
                                    hideFooter
                                    onRowClick={(params) => setSelectedSatelliteId(params.id)}
                                    localeText={{ noRowsLabel: 'No GNSS satellite events yet' }}
                                    sx={{
                                        border: 0,
                                        [`& .${gridClasses.cell}:focus, & .${gridClasses.cell}:focus-within`]: {
                                            outline: 'none',
                                        },
                                        [`& .${gridClasses.columnHeader}`]: {
                                            backgroundColor: theme.palette.background.default,
                                            '&:focus, &:focus-within': {
                                                outline: 'none',
                                            },
                                        },
                                    }}
                                />
                            </Box>

                            <Divider orientation="vertical" flexItem sx={{ borderColor: theme.palette.border.main }} />

                            <Box
                                sx={{
                                    width: '36%',
                                    minWidth: 320,
                                    maxWidth: 460,
                                    px: 1.25,
                                    py: 1,
                                    overflowY: 'auto',
                                }}
                            >
                                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.8 }}>
                                    <Box
                                        sx={{
                                            display: 'flex',
                                            flexDirection: 'row',
                                            alignItems: 'center',
                                            gap: 0.75,
                                            flexWrap: 'wrap',
                                        }}
                                    >
                                        <Chip
                                            size="small"
                                            variant="outlined"
                                            label={`Detected ${satelliteRows.length}`}
                                            sx={{ height: 20, fontSize: '0.66rem' }}
                                        />
                                        <Chip
                                            size="small"
                                            variant="outlined"
                                            label={`Events ${gnssEventCount}`}
                                            sx={{ height: 20, fontSize: '0.66rem' }}
                                        />
                                        <Chip
                                            size="small"
                                            color={satelliteRows.length > 0 ? 'success' : 'default'}
                                            variant={satelliteRows.length > 0 ? 'filled' : 'outlined'}
                                            label={satelliteRows.length > 0 ? 'Active' : 'Waiting'}
                                            sx={{ height: 20, fontSize: '0.66rem', fontWeight: 700 }}
                                        />
                                    </Box>

                                    <Divider sx={{ borderColor: theme.palette.border.main }} />

                                    {!selectedSatellite && (
                                        <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                                            Select a satellite row to inspect its latest events.
                                        </Typography>
                                    )}

                                    {selectedSatellite && (
                                        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.8 }}>
                                            <Typography variant="caption" sx={{ fontWeight: 700, color: 'text.primary' }}>
                                                {`${selectedSatellite.satelliteId} details`}
                                            </Typography>
                                            <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                                                {`First seen: ${formatTimestamp(selectedSatellite.firstSeen)}`}
                                            </Typography>
                                            <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                                                {`Last seen: ${formatTimestamp(selectedSatellite.lastSeen)}`}
                                            </Typography>
                                            {(selectedSatellite.latitude !== null && selectedSatellite.longitude !== null) && (
                                                <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                                                    {`Position: ${selectedSatellite.latitude.toFixed(6)}, ${selectedSatellite.longitude.toFixed(6)}${selectedSatellite.altitudeM !== null ? ` alt ${selectedSatellite.altitudeM.toFixed(1)}m` : ''}`}
                                                </Typography>
                                            )}
                                            <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                                                {`Recent events:`}
                                            </Typography>
                                            {selectedSatellite.events.slice(0, 10).map((event, idx) => (
                                                <Typography
                                                    key={`${selectedSatellite.id}-${event.timestampMs}-${idx}`}
                                                    variant="caption"
                                                    sx={{
                                                        color: 'text.secondary',
                                                        fontFamily: 'monospace',
                                                        whiteSpace: 'nowrap',
                                                        overflow: 'hidden',
                                                        textOverflow: 'ellipsis',
                                                    }}
                                                >
                                                    {`${formatTimestamp(event.timestampMs)} | ${String(event.eventType).toUpperCase()} | ${event.message}`}
                                                </Typography>
                                            ))}
                                        </Box>
                                    )}
                                </Box>
                            </Box>
                        </Box>
                    </Box>
                )}
            </Box>
        </Box>
    );
});

export default DecodedInsightsIsland;
