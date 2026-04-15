import React, { useEffect, useState } from 'react';
import { Box, CircularProgress, IconButton, Stack, Tooltip, Typography } from '@mui/material';
import { useDispatch, useSelector } from 'react-redux';
import { Responsive, useContainerWidth } from 'react-grid-layout';
import { absoluteStrategy } from 'react-grid-layout/core';
import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';
import { useSocket } from '../common/socket.jsx';
import {
    getClassNamesBasedOnGridEditing,
    StyledIslandParentNoScrollbar,
    TitleBar,
} from '../common/common.jsx';
import {
    fetchCelestialTracks,
    fetchSolarSystemScene,
    getCelestialMapSettings,
    refreshMonitoredCelestialNow,
    setCelestialMapSettings,
} from './celestial-slice.jsx';
import { fetchMonitoredCelestial } from './monitored-slice.jsx';
import { setOpenGridSettingsDialog } from './monitored-slice.jsx';
import CelestialToolbar from './celestial-toolbar.jsx';
import CelestialStatusBar from './celestial-statusbar.jsx';
import SolarSystemCanvas from './solarsystem-canvas.jsx';
import CelestialTopBar from './celestial-topbar.jsx';
import MonitoredCelestialGridIsland from './monitored-grid-island.jsx';
import SettingsIcon from '@mui/icons-material/Settings';

const gridLayoutStoreName = 'celestial-layouts';
const SHARED_RESIZE_HANDLES = ['s', 'sw', 'w', 'se', 'nw', 'ne', 'e'];
const DEFAULT_PAST_HOURS = 24;
const DEFAULT_FUTURE_HOURS = 24;
const DEFAULT_STEP_MINUTES = 60;

function loadLayoutsFromLocalStorage() {
    try {
        const raw = localStorage.getItem(gridLayoutStoreName);
        return raw ? JSON.parse(raw) : null;
    } catch {
        return null;
    }
}

function saveLayoutsToLocalStorage(layouts) {
    localStorage.setItem(gridLayoutStoreName, JSON.stringify(layouts));
}

function normalizeLayoutsResizeHandles(layouts) {
    if (!layouts || typeof layouts !== 'object') {
        return layouts;
    }

    return Object.fromEntries(
        Object.entries(layouts).map(([breakpoint, items]) => [
            breakpoint,
            Array.isArray(items)
                ? items.map((item) => ({
                    ...item,
                    resizeHandles: [...SHARED_RESIZE_HANDLES],
                }))
                : items,
        ]),
    );
}

function ensureRequiredLayoutItems(layouts) {
    if (!layouts || typeof layouts !== 'object') {
        return layouts;
    }

    const fallbackItems = {
        lg: { i: 'monitored-celestial', x: 0, y: 24, w: 12, h: 10, resizeHandles: [...SHARED_RESIZE_HANDLES] },
        md: { i: 'monitored-celestial', x: 0, y: 24, w: 10, h: 10, resizeHandles: [...SHARED_RESIZE_HANDLES] },
        sm: { i: 'monitored-celestial', x: 0, y: 20, w: 6, h: 10, resizeHandles: [...SHARED_RESIZE_HANDLES] },
        xs: { i: 'monitored-celestial', x: 0, y: 18, w: 2, h: 9, resizeHandles: [...SHARED_RESIZE_HANDLES] },
        xxs: { i: 'monitored-celestial', x: 0, y: 18, w: 2, h: 9, resizeHandles: [...SHARED_RESIZE_HANDLES] },
    };

    return Object.fromEntries(
        Object.entries(layouts).map(([breakpoint, items]) => {
            const typedItems = Array.isArray(items) ? items : [];
            if (typedItems.some((item) => item?.i === 'monitored-celestial')) {
                return [breakpoint, typedItems];
            }
            const fallback = fallbackItems[breakpoint];
            return [breakpoint, fallback ? [...typedItems, fallback] : typedItems];
        }),
    );
}

const defaultLayouts = {
    lg: [
        { i: 'solar-system', x: 0, y: 0, w: 12, h: 24, resizeHandles: [...SHARED_RESIZE_HANDLES] },
        { i: 'monitored-celestial', x: 0, y: 24, w: 12, h: 10, resizeHandles: [...SHARED_RESIZE_HANDLES] },
    ],
    md: [
        { i: 'solar-system', x: 0, y: 0, w: 10, h: 24, resizeHandles: [...SHARED_RESIZE_HANDLES] },
        { i: 'monitored-celestial', x: 0, y: 24, w: 10, h: 10, resizeHandles: [...SHARED_RESIZE_HANDLES] },
    ],
    sm: [
        { i: 'solar-system', x: 0, y: 0, w: 6, h: 20, resizeHandles: [...SHARED_RESIZE_HANDLES] },
        { i: 'monitored-celestial', x: 0, y: 20, w: 6, h: 10, resizeHandles: [...SHARED_RESIZE_HANDLES] },
    ],
    xs: [
        { i: 'solar-system', x: 0, y: 0, w: 2, h: 18, resizeHandles: [...SHARED_RESIZE_HANDLES] },
        { i: 'monitored-celestial', x: 0, y: 18, w: 2, h: 9, resizeHandles: [...SHARED_RESIZE_HANDLES] },
    ],
    xxs: [
        { i: 'solar-system', x: 0, y: 0, w: 2, h: 18, resizeHandles: [...SHARED_RESIZE_HANDLES] },
        { i: 'monitored-celestial', x: 0, y: 18, w: 2, h: 9, resizeHandles: [...SHARED_RESIZE_HANDLES] },
    ],
};

const CelestialMainLayout = () => {
    const dispatch = useDispatch();
    const { socket } = useSocket();
    const isEditing = useSelector((state) => state.dashboard?.isEditing);
    const celestialState = useSelector((state) => state.celestial);
    const monitoredState = useSelector((state) => state.celestialMonitored);
    const { width, containerRef, mounted } = useContainerWidth({ measureBeforeMount: true });

    const [layouts, setLayouts] = useState(() => {
        const loaded = loadLayoutsFromLocalStorage();
        return ensureRequiredLayoutItems(normalizeLayoutsResizeHandles(loaded ?? defaultLayouts));
    });
    const [fitAllSignal, setFitAllSignal] = useState(0);

    const projectionSettings = React.useMemo(() => {
        const mapSettings = celestialState.mapSettings || {};
        return {
            past_hours: Number(mapSettings.pastHours) || DEFAULT_PAST_HOURS,
            future_hours: Number(mapSettings.futureHours) || DEFAULT_FUTURE_HOURS,
            step_minutes: Number(mapSettings.stepMinutes) || DEFAULT_STEP_MINUTES,
        };
    }, [celestialState.mapSettings]);

    const sceneRequestPayload = React.useMemo(
        () => ({
            past_hours: projectionSettings.past_hours,
            future_hours: projectionSettings.future_hours,
            step_minutes: projectionSettings.step_minutes,
        }),
        [projectionSettings.future_hours, projectionSettings.past_hours, projectionSettings.step_minutes],
    );

    const handleLayoutsChange = (currentLayout, allLayouts) => {
        const normalizedLayouts = normalizeLayoutsResizeHandles(allLayouts);
        const mergedLayouts = ensureRequiredLayoutItems(normalizedLayouts);
        setLayouts(mergedLayouts);
        saveLayoutsToLocalStorage(mergedLayouts);
    };

    useEffect(() => {
        if (!socket) return;
        dispatch(getCelestialMapSettings({ socket }));
        dispatch(fetchMonitoredCelestial({ socket }));
    }, [socket, dispatch]);

    useEffect(() => {
        if (!socket) return;
        dispatch(fetchSolarSystemScene({ socket, payload: sceneRequestPayload }));
        dispatch(fetchCelestialTracks({ socket, payload: sceneRequestPayload }));
    }, [socket, dispatch, sceneRequestPayload]);

    const handleViewportCommit = React.useCallback((nextViewport) => {
        if (!socket) return;

        const existing = celestialState.mapSettings || {};
        const prev = existing.solarSystemViewport || {};
        const unchanged =
            Number(prev.zoom) === Number(nextViewport.zoom)
            && Number(prev.panX) === Number(nextViewport.panX)
            && Number(prev.panY) === Number(nextViewport.panY);

        if (unchanged) return;

        dispatch(
            setCelestialMapSettings({
                socket,
                value: {
                    ...existing,
                    solarSystemViewport: nextViewport,
                },
            }),
        );
    }, [socket, celestialState.mapSettings, dispatch]);

    const combinedScene = React.useMemo(() => {
        const solar = celestialState.solarScene || {};
        const tracks = celestialState.celestialTracks || {};
        return {
            ...solar,
            ...tracks,
            planets: solar.planets || [],
            celestial: tracks.celestial || [],
            meta: {
                ...(solar.meta || {}),
                ...(tracks.meta || {}),
            },
        };
    }, [celestialState.solarScene, celestialState.celestialTracks]);

    const planetsCount = combinedScene?.planets?.length || 0;
    const trackedCount = combinedScene?.celestial?.length || 0;
    const hasSolarScene = planetsCount > 0;

    const updateProjectionSetting = React.useCallback((updates) => {
        if (!socket) return;
        const existing = celestialState.mapSettings || {};
        const nextSettings = { ...existing, ...updates };
        const unchanged = Object.keys(updates).every((key) => existing[key] === nextSettings[key]);
        if (unchanged) return;

        dispatch(
            setCelestialMapSettings({
                socket,
                value: nextSettings,
            }),
        );

        dispatch(
            fetchCelestialTracks({
                socket,
                payload: {
                    past_hours: Number(nextSettings.pastHours) || DEFAULT_PAST_HOURS,
                    future_hours: Number(nextSettings.futureHours) || DEFAULT_FUTURE_HOURS,
                    step_minutes: Number(nextSettings.stepMinutes) || DEFAULT_STEP_MINUTES,
                },
            }),
        );
    }, [socket, celestialState.mapSettings, dispatch]);

    const gridContents = [
        <StyledIslandParentNoScrollbar key="solar-system">
            <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
                <TitleBar className={getClassNamesBasedOnGridEditing(isEditing, [])}>
                    Solar System Layout
                </TitleBar>
                <CelestialToolbar
                    onFitAll={() => setFitAllSignal((value) => value + 1)}
                    onRefresh={async () => {
                        if (!socket) return;
                        await dispatch(refreshMonitoredCelestialNow({ socket, payload: sceneRequestPayload }));
                        await dispatch(fetchMonitoredCelestial({ socket }));
                    }}
                    loading={celestialState.tracksLoading}
                    disabled={!socket}
                />
                <Box sx={{ p: 0, flex: 1, minHeight: 0, overflow: 'hidden', position: 'relative' }}>
                    {celestialState.solarLoading || celestialState.tracksLoading ? (
                        <Stack direction="row" spacing={2} alignItems="center" sx={{ p: 1, position: 'absolute', zIndex: 2 }}>
                            <CircularProgress size={18} />
                        </Stack>
                    ) : null}
                    {celestialState.error && !hasSolarScene ? (
                        <Typography variant="body2" color="error" sx={{ p: 1 }}>
                            {celestialState.error}
                        </Typography>
                    ) : (
                        <Box sx={{ height: '100%', minHeight: 220 }}>
                            <SolarSystemCanvas
                                scene={combinedScene}
                                fitAllSignal={fitAllSignal}
                                initialViewport={celestialState.mapSettings?.solarSystemViewport}
                                onViewportCommit={handleViewportCommit}
                            />
                        </Box>
                    )}
                </Box>
                <CelestialStatusBar planetsCount={planetsCount} trackedCount={trackedCount} />
            </Box>
        </StyledIslandParentNoScrollbar>,
        <StyledIslandParentNoScrollbar key="monitored-celestial">
            <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
                <TitleBar
                    className={getClassNamesBasedOnGridEditing(isEditing, [])}
                    sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
                >
                    <Box component="span">Monitored Celestial</Box>
                    <Tooltip title="Table settings">
                        <span>
                            <IconButton
                                size="small"
                                onClick={() => dispatch(setOpenGridSettingsDialog(true))}
                                sx={{ p: 0.25 }}
                            >
                                <SettingsIcon fontSize="small" />
                            </IconButton>
                        </span>
                    </Tooltip>
                </TitleBar>
                <Box sx={{ p: 0, flex: 1, minHeight: 0 }}>
                    <MonitoredCelestialGridIsland
                        rows={monitoredState.monitored || []}
                        loading={Boolean(monitoredState.loading)}
                    />
                </Box>
            </Box>
        </StyledIslandParentNoScrollbar>,
    ];

    return (
        <Box sx={{ width: '100%', height: '100%' }}>
            <CelestialTopBar
                projectionPastHours={projectionSettings.past_hours}
                projectionFutureHours={projectionSettings.future_hours}
                onProjectionPastHoursChange={(value) => updateProjectionSetting({ pastHours: value })}
                onProjectionFutureHoursChange={(value) => updateProjectionSetting({ futureHours: value })}
            />
            <div ref={containerRef}>
                {mounted ? (
                    <Responsive
                        width={width}
                        positionStrategy={absoluteStrategy}
                        className="layout"
                        layouts={layouts}
                        onLayoutChange={handleLayoutsChange}
                        breakpoints={{ lg: 1200, md: 996, sm: 768, xs: 480, xxs: 0 }}
                        cols={{ lg: 12, md: 10, sm: 6, xs: 2, xxs: 2 }}
                        rowHeight={30}
                        dragConfig={{ enabled: isEditing, handle: '.react-grid-draggable' }}
                        resizeConfig={{ enabled: isEditing }}
                    >
                        {gridContents}
                    </Responsive>
                ) : null}
            </div>
        </Box>
    );
};

export default CelestialMainLayout;
