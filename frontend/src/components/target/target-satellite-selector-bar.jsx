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

import React, { useCallback, useState, useEffect, useMemo } from "react";
import {
    Box,
    Typography,
    Chip,
    Tooltip,
    Button,
    FormControl,
    InputLabel,
    Select,
    MenuItem,
    Tabs,
    Tab,
    useMediaQuery,
    useTheme,
} from "@mui/material";
import { useDispatch, useSelector } from "react-redux";
import { useSocket } from "../common/socket.jsx";
import { useTranslation } from 'react-i18next';
import AccessTimeIcon from '@mui/icons-material/AccessTime';
import TrendingUpIcon from '@mui/icons-material/TrendingUp';
import TrendingDownIcon from '@mui/icons-material/TrendingDown';
import HorizontalRuleIcon from '@mui/icons-material/HorizontalRule';
import GpsFixedIcon from '@mui/icons-material/GpsFixed';
import GpsOffIcon from '@mui/icons-material/GpsOff';
import StopIcon from '@mui/icons-material/Stop';
import {
    setAvailableTransmitters,
    setRotator,
    setSatelliteId,
    setTrackerId,
    setTrackingStateInBackend,
} from './target-slice.jsx';
import { toast } from "../../utils/toast-with-timestamp.jsx";
import SatelliteSearchAutocomplete from "./satellite-search.jsx";
import { useTargetRotatorSelectionDialog } from "./use-target-rotator-selection-dialog.jsx";

const TargetSatelliteSelectorBar = React.memo(function TargetSatelliteSelectorBar() {
    const { socket } = useSocket();
    const dispatch = useDispatch();
    const { t } = useTranslation('target');

    const {
        trackingState,
        trackerId,
        satellitePasses,
        satelliteId,
        satelliteData,
        selectedRadioRig,
        selectedTransmitter,
        rigData,
        rotatorData,
    } = useSelector((state) => state.targetSatTrack);
    const trackerInstances = useSelector((state) => state.trackerInstances?.instances || []);
    const activeTrackerInstance = useMemo(
        () => trackerInstances.find((instance) => instance.tracker_id === trackerId) || null,
        [trackerInstances, trackerId]
    );
    const activeTargetNumber = activeTrackerInstance?.target_number
        || (trackerInstances.findIndex((instance) => instance.tracker_id === trackerId) + 1)
        || null;

    const selectedSatellitePositions = useSelector(state => state.overviewSatTrack.selectedSatellitePositions);
    const trackerViews = useSelector((state) => state.targetSatTrack?.trackerViews || {});
    const { requestRotatorForTarget, dialog: rotatorSelectionDialog } = useTargetRotatorSelectionDialog();
    const theme = useTheme();
    const useDropdownSelector = useMediaQuery(theme.breakpoints.down('sm'));

    const [countdown, setCountdown] = useState('');
    const [searchResetKey, setSearchResetKey] = useState(0);

    const handleTrackingStop = useCallback(() => {
        const newTrackingState = {
            ...trackingState,
            tracker_id: trackerId,
            'rotator_state': "stopped",
            'rig_state': "stopped",
        };
        dispatch(setTrackingStateInBackend({socket, data: newTrackingState}));
    }, [dispatch, socket, trackingState, trackerId]);

    const handleTargetContextChange = useCallback((event) => {
        dispatch(setTrackerId(event.target.value));
    }, [dispatch]);
    const handleTargetTabChange = useCallback((event, value) => {
        if (!value) return;
        dispatch(setTrackerId(value));
    }, [dispatch]);

    const getTransmittersFromSatellite = useCallback((satellite) => {
        if (!satellite || typeof satellite !== 'object') {
            return [];
        }
        if (Array.isArray(satellite.transmitters)) {
            return satellite.transmitters;
        }
        return [];
    }, []);

    const handleRetargetSatelliteSelect = useCallback(async (satellite) => {
        if (!satellite?.norad_id) {
            return;
        }

        const selectedAssignment = await requestRotatorForTarget(satellite?.name);
        if (!selectedAssignment) {
            return;
        }

        const { rotatorId, trackerId: selectedTrackerId } = selectedAssignment;
        const selectedGroupId = satellite?.groups?.[0]?.id || trackingState?.group_id || "";
        const nextTransmitters = getTransmittersFromSatellite(satellite);

        dispatch(setSatelliteId(satellite.norad_id));
        dispatch(setRotator(rotatorId));
        dispatch(setTrackerId(selectedTrackerId));
        dispatch(setAvailableTransmitters(nextTransmitters));

        const data = {
            ...trackingState,
            tracker_id: selectedTrackerId,
            norad_id: satellite.norad_id,
            group_id: selectedGroupId,
            rig_id: selectedRadioRig,
            rotator_id: rotatorId,
            transmitter_id: selectedTransmitter,
        };

        try {
            await dispatch(setTrackingStateInBackend({ socket, data })).unwrap();
            setSearchResetKey((value) => value + 1);
        } catch (error) {
            toast.error(error?.message || 'Failed to set target');
        }
    }, [
        dispatch,
        getTransmittersFromSatellite,
        requestRotatorForTarget,
        selectedRadioRig,
        selectedTransmitter,
        socket,
        trackingState,
    ]);

    // Get current active pass or next upcoming pass
    const passInfo = useMemo(() => {
        if (!satellitePasses || satellitePasses.length === 0 || !satelliteId) return null;

        const now = new Date();

        // Find active pass
        const activePass = satellitePasses.find(pass => {
            if (pass.norad_id !== satelliteId) return false;
            const start = new Date(pass.event_start);
            const end = new Date(pass.event_end);
            return now >= start && now <= end;
        });

        if (activePass) {
            return { type: 'active', pass: activePass };
        }

        // Find next upcoming pass
        let nextPass = null;
        let earliestTime = null;

        for (const pass of satellitePasses) {
            if (pass.norad_id === satelliteId) {
                const startTime = new Date(pass.event_start);
                if (startTime > now) {
                    if (!nextPass || startTime < earliestTime) {
                        nextPass = pass;
                        earliestTime = startTime;
                    }
                }
            }
        }

        if (nextPass) {
            return { type: 'upcoming', pass: nextPass };
        }

        return null;
    }, [satellitePasses, satelliteId]);

    // Update countdown every second
    useEffect(() => {
        if (!passInfo) {
            setCountdown('');
            return;
        }

        const updateCountdown = () => {
            const now = new Date();
            const targetTime = passInfo.type === 'active'
                ? new Date(passInfo.pass.event_end)
                : new Date(passInfo.pass.event_start);

            const diff = targetTime - now;

            if (diff <= 0) {
                setCountdown('0s');
                return;
            }

            const days = Math.floor(diff / (1000 * 60 * 60 * 24));
            const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
            const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
            const seconds = Math.floor((diff % (1000 * 60)) / 1000);

            if (days > 0) {
                setCountdown(`${days}d ${hours}h ${minutes}m`);
            } else if (hours > 0) {
                setCountdown(`${hours}h ${minutes}m ${seconds}s`);
            } else if (minutes > 0) {
                setCountdown(`${minutes}m ${seconds}s`);
            } else {
                setCountdown(`${seconds}s`);
            }
        };

        updateCountdown();
        const interval = setInterval(updateCountdown, 1000);

        return () => clearInterval(interval);
    }, [passInfo]);

    const targetOptions = useMemo(() => trackerInstances.map((instance, index) => {
        const instanceTrackerId = instance?.tracker_id || '';
        const targetNumber = Number(instance?.target_number || (index + 1));
        const view = trackerViews?.[instanceTrackerId] || {};
        const satName = view?.satelliteData?.details?.name || 'No satellite';
        const satNorad = view?.trackingState?.norad_id || 'none';
        const rotatorId = view?.selectedRotator || instance?.rotator_id || 'none';
        const isTracking = Boolean(view?.rigData?.tracking || view?.rotatorData?.tracking);
        const satAz = Number.isFinite(view?.satelliteData?.position?.az) ? view.satelliteData.position.az : null;
        const satEl = Number.isFinite(view?.satelliteData?.position?.el) ? view.satelliteData.position.el : null;
        return {
            trackerId: instanceTrackerId,
            targetNumber,
            satName,
            satNorad,
            rotatorId,
            isTracking,
            satAz,
            satEl,
        };
    }), [trackerInstances, trackerViews]);

    const tabValue = targetOptions.some((option) => option.trackerId === trackerId)
        ? trackerId
        : (targetOptions[0]?.trackerId || false);

    return (
        <>
        {rotatorSelectionDialog}
        <Box
            sx={{
                // Mobile/Tablet: two-column grid (main area + narrow stop column)
                // Desktop (lg+): single row flex
                display: { xs: 'grid', lg: 'flex' },
                gridTemplateColumns: { xs: '1fr auto' },
                gridTemplateRows: { xs: 'auto auto' },
                columnGap: { xs: 2 },
                rowGap: { xs: 1.5 },
                alignItems: { lg: 'center' },
                gap: { lg: 2 },
                px: 1.5,
                py: { xs: 1, lg: 0 },
                bgcolor: 'background.paper',
                borderBottom: '1px solid',
                borderColor: 'border.main',
                minHeight: { xs: 'auto', lg: '64px' },
                height: { lg: '64px' },
                maxHeight: { lg: '64px' },
            }}
        >
            <Box
                sx={{
                    gridColumn: { xs: '1 / 2', lg: 'auto' },
                    gridRow: { xs: '1 / 2', lg: 'auto' },
                    display: 'flex',
                    alignItems: 'center',
                    flex: { lg: '1 1 auto' },
                    minWidth: { xs: 0, lg: 320 },
                    maxWidth: { lg: 'none' },
                    height: { lg: '100%' },
                }}
            >
                {useDropdownSelector ? (
                    <FormControl size="small" fullWidth>
                        <InputLabel id="active-target-context-label">Active Target</InputLabel>
                        <Select
                            labelId="active-target-context-label"
                            value={trackerId || ''}
                            label="Active Target"
                            onChange={handleTargetContextChange}
                        >
                            {targetOptions.map((option) => (
                                <MenuItem key={option.trackerId} value={option.trackerId}>
                                    {`Target ${option.targetNumber} • ${option.satName} • NORAD ${option.satNorad} • Rotator ${option.rotatorId}`}
                                </MenuItem>
                            ))}
                        </Select>
                    </FormControl>
                ) : (
                    <Box
                        sx={{
                            width: '100%',
                            height: '100%',
                            display: 'flex',
                            alignItems: 'stretch',
                        }}
                    >
                        <Tabs
                            value={tabValue}
                            onChange={handleTargetTabChange}
                            variant="scrollable"
                            scrollButtons="auto"
                            allowScrollButtonsMobile
                            sx={{
                                width: '100%',
                                minHeight: '100%',
                                height: '100%',
                                '& .MuiTabs-scroller': {
                                    display: 'flex',
                                    alignItems: 'stretch',
                                },
                                '& .MuiTabs-flexContainer': {
                                    minHeight: '100%',
                                    height: '100%',
                                    alignItems: 'stretch',
                                },
                                '& .MuiTabs-indicator': { display: 'none' },
                                '& .MuiTab-root': {
                                    minHeight: '100%',
                                    height: '100%',
                                    textTransform: 'none',
                                    px: 1.5,
                                    py: 0,
                                    mr: 0.25,
                                    minWidth: 120,
                                    borderRadius: 0,
                                    border: '1px solid transparent',
                                    borderColor: 'transparent',
                                    color: 'text.secondary',
                                    fontWeight: 600,
                                    '&.Mui-selected': {
                                        color: 'primary.contrastText',
                                        backgroundColor: 'primary.main',
                                        borderColor: 'primary.dark',
                                    }
                                },
                            }}
                        >
                            {targetOptions.map((option) => {
                                const shortName = option.satName.length > 20
                                    ? `${option.satName.slice(0, 20)}...`
                                    : option.satName;
                                return (
                                    <Tab
                                        key={option.trackerId}
                                        value={option.trackerId}
                                        label={
                                            <Tooltip
                                                title={`Target ${option.targetNumber} | ${option.satName} | NORAD ${option.satNorad} | Rotator ${option.rotatorId}`}
                                                arrow
                                            >
                                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.7, maxWidth: 230 }}>
                                                    <Box
                                                        sx={{
                                                            width: 16,
                                                            height: 16,
                                                            borderRadius: '50%',
                                                            bgcolor: option.isTracking ? 'success.light' : 'action.disabled',
                                                            flexShrink: 0,
                                                        }}
                                                    />
                                                    <Typography variant="caption" sx={{ fontWeight: 900, fontSize: '1.2rem', lineHeight: 1 }}>
                                                        T{option.targetNumber}
                                                    </Typography>
                                                    <Box sx={{ minWidth: 0, display: 'flex', flexDirection: 'column', alignItems: 'flex-start', maxWidth: 190 }}>
                                                        <Typography
                                                            variant="caption"
                                                            noWrap
                                                            sx={{ fontSize: '0.72rem', maxWidth: '100%', display: 'block', lineHeight: 1.1 }}
                                                        >
                                                            {shortName}
                                                        </Typography>
                                                        <Typography
                                                            variant="caption"
                                                            noWrap
                                                            sx={{
                                                                display: 'block',
                                                                fontSize: '0.61rem',
                                                                opacity: 0.9,
                                                                maxWidth: '100%',
                                                                fontFamily: 'monospace',
                                                                lineHeight: 1.05,
                                                            }}
                                                        >
                                                            {`Az ${option.satAz != null ? option.satAz.toFixed(1) : '--'}° • El ${option.satEl != null ? option.satEl.toFixed(1) : '--'}°`}
                                                        </Typography>
                                                    </Box>
                                                </Box>
                                            </Tooltip>
                                        }
                                    />
                                );
                            })}
                        </Tabs>
                    </Box>
                )}
            </Box>
            <Box
                sx={{
                    gridColumn: { xs: '1 / 2', lg: 'auto' },
                    gridRow: { xs: '2 / 3', lg: 'auto' },
                    display: 'flex',
                    alignItems: 'center',
                    flex: { lg: '0 0 360px' },
                    minWidth: { xs: 0, lg: 280 },
                    maxWidth: { lg: 360 },
                }}
            >
                <SatelliteSearchAutocomplete
                    key={searchResetKey}
                    onSatelliteSelect={handleRetargetSatelliteSelect}
                />
            </Box>

            {/* Pills + Stop (desktop row) OR Stop only (mobile/tablet column) */}
            <Box
                sx={{
                    // On mobile/tablet: right column spanning both rows
                    gridColumn: { xs: '2 / 3', lg: 'auto' },
                    gridRow: { xs: '1 / 3', lg: 'auto' },
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    ml: { lg: 'auto' },
                    flexShrink: 0,
                    justifyContent: { xs: 'center', lg: 'flex-start' },
                }}
            >
                {/* Tracking status badge */}
                {satelliteId && (
                    <Tooltip title={rigData?.tracking || rotatorData?.tracking ? "Tracking active" : "Tracking stopped"}>
                        <Chip
                            icon={rigData?.tracking || rotatorData?.tracking ? <GpsFixedIcon /> : <GpsOffIcon />}
                            label={rigData?.tracking || rotatorData?.tracking ? "Tracking" : "Stopped"}
                            size="small"
                            sx={{
                                display: { xs: 'none', lg: 'flex' },
                                bgcolor: rigData?.tracking || rotatorData?.tracking ? 'success.main' : 'action.hover',
                                color: rigData?.tracking || rotatorData?.tracking ? 'white' : 'text.secondary',
                                fontWeight: 'bold',
                                '& .MuiChip-icon': {
                                    color: rigData?.tracking || rotatorData?.tracking ? 'white' : 'text.secondary',
                                }
                            }}
                        />
                    </Tooltip>
                )}

                <Tooltip
                    title={
                        activeTrackerInstance
                            ? `Target ${activeTargetNumber || '?'} | tracker ${activeTrackerInstance.tracker_id} | rotator ${activeTrackerInstance.rotator_id || 'none'}`
                            : `Tracker ${trackerId || 'none'}`
                    }
                >
                    <Chip
                        size="small"
                        color="info"
                        variant="outlined"
                        label={activeTrackerInstance ? `Target ${activeTargetNumber || '?'}` : 'No target'}
                    />
                </Tooltip>

                {/* Current elevation with trend */}
                {satelliteId && satelliteData?.position && (
                    <Tooltip title={`Elevation: ${satelliteData.position.el?.toFixed(2)}°`}>
                        <Chip
                            icon={
                                selectedSatellitePositions?.[satelliteId]?.trend === 'rising_slow' || selectedSatellitePositions?.[satelliteId]?.trend === 'rising_fast' ? <TrendingUpIcon /> :
                                selectedSatellitePositions?.[satelliteId]?.trend === 'falling_slow' || selectedSatellitePositions?.[satelliteId]?.trend === 'falling_fast' ? <TrendingDownIcon /> :
                                selectedSatellitePositions?.[satelliteId]?.trend === 'peak' ? <HorizontalRuleIcon /> :
                                null
                            }
                            label={`El: ${satelliteData.position.el?.toFixed(1)}°`}
                            size="small"
                            sx={{
                                display: { xs: 'none', lg: 'flex' },
                                bgcolor: satelliteData.position.el < 0 ? 'action.hover' :
                                         satelliteData.position.el < 10 ? 'error.main' :
                                         satelliteData.position.el < 45 ? 'warning.main' : 'success.main',
                                color: satelliteData.position.el < 0 ? 'text.secondary' : 'white',
                                fontWeight: 'bold',
                                fontFamily: 'monospace',
                                '& .MuiChip-icon': {
                                    color: satelliteData.position.el < 0 ? 'text.secondary' :
                                           selectedSatellitePositions?.[satelliteId]?.trend === 'rising_slow' || selectedSatellitePositions?.[satelliteId]?.trend === 'rising_fast' ? 'info.light' :
                                           selectedSatellitePositions?.[satelliteId]?.trend === 'falling_slow' || selectedSatellitePositions?.[satelliteId]?.trend === 'falling_fast' ? 'error.light' :
                                           selectedSatellitePositions?.[satelliteId]?.trend === 'peak' ? 'warning.light' :
                                           'white',
                                }
                            }}
                        />
                    </Tooltip>
                )}

                {/* Pass countdown */}
                {passInfo && countdown && (
                    <Tooltip title={passInfo.type === 'active' ? 'Current pass ending' : 'Next pass starting'}>
                        <Chip
                            icon={passInfo.type === 'active' ? <AccessTimeIcon /> : <TrendingUpIcon />}
                            label={countdown}
                            size="small"
                            sx={{
                                display: { xs: 'none', lg: 'flex' },
                                bgcolor: passInfo.type === 'active' ? 'success.main' : 'info.main',
                                color: 'white',
                                fontWeight: 'bold',
                                fontFamily: 'monospace',
                                '& .MuiChip-icon': {
                                    color: 'white',
                                }
                            }}
                        />
                    </Tooltip>
                )}

                {/* Stop tracking button */}
                {satelliteId && (
                    <Button
                        variant="contained"
                        color="error"
                        startIcon={<StopIcon />}
                        disabled={rigData?.tracking !== true && rotatorData?.tracking !== true}
                        onClick={handleTrackingStop}
                        size="small"
                        sx={{
                            textTransform: 'none',
                            fontWeight: 'bold',
                            minWidth: { xs: 40, sm: 'auto' },
                            px: { xs: 1, sm: 2 },
                            height: 36,
                        }}
                    >
                        <Box component="span" sx={{ display: { xs: 'none', sm: 'inline' } }}>
                            {t('satellite_selector.stop_tracking')}
                        </Box>
                    </Button>
                )}
            </Box>
        </Box>
        </>
    );
});

export default TargetSatelliteSelectorBar;
