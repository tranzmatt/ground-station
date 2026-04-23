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

import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {
    MapContainer,
    TileLayer,
    Marker,
    Polyline,
    Polygon,
    useMapEvents,
} from 'react-leaflet';
import {Box, Fab, Slider, Typography, Tooltip, IconButton, useTheme} from "@mui/material";
import { styled } from '@mui/material/styles';
import { Tooltip as LeafletTooltip } from 'react-leaflet';
import L from 'leaflet';
import {SatelliteAlt} from '@mui/icons-material';
import HomeIcon from '@mui/icons-material/Home';
import FullscreenIcon from '@mui/icons-material/Fullscreen';
import FilterCenterFocusIcon from '@mui/icons-material/FilterCenterFocus';
import SettingsIcon from '@mui/icons-material/Settings';
import {useDispatch, useSelector} from "react-redux";
import { useTranslation } from 'react-i18next';
import {
    setOpenMapSettingsDialog,
    setSatGroupId,
    setTerminatorLine,
    setDaySidePolygon,
    setPastOrbitLineColor,
    setFutureOrbitLineColor,
    setSatelliteCoverageColor,
    setOrbitProjectionDuration,
    setTileLayerID,
    setMapZoomLevel,
    setSunPos,
    setMoonPos,
    setGridEditable,
    setSliderTimeOffset,
    setLoading,
    fetchSatellite,
    getTrackingStateFromBackend,
    setSatelliteId,
    setTargetMapSetting,
} from './target-slice.jsx';
import {getTileLayerById} from "../common/tile-layers.jsx";
import {homeIcon, sunIcon, moonIcon, satelliteIcon2} from '../common/dataurl-icons.jsx';
import {
    TitleBar,
    MapStatusBar,
    InternationalDateLinePolyline,
    MapArrowControls,
    SimpleTruncatedHtml,
    getClassNamesBasedOnGridEditing,
    ThemedLeafletTooltip,
    humanizeAltitude,
    humanizeVelocity,
} from "../common/common.jsx";
import TargetNumberIcon from '../common/target-number-icon.jsx';
import MapSettingsIslandDialog from './map-settings-dialog.jsx';
import CoordinateGrid from "../common/mercator-grid.jsx";
import createTerminatorLine from "../common/terminator-line.jsx";
import {getSunMoonCoords} from "../common/sunmoon.jsx";
import {
    satelliteCoverageSelector,
    satelliteDetailsSelector,
    satellitePathsSelector,
    satellitePositionSelector,
    satelliteTrackingStateSelector,
    satelliteTransmittersSelector,
} from "./state-selectors.jsx";
import {useSocket} from "../common/socket.jsx";

const storageMapZoomValueKey = "target-map-zoom-level";
const TARGET_SLOT_ID_PATTERN = /^target-(\d+)$/;

// Match overview tracked-satellite tooltip style.
const TrackedSatelliteTooltip = styled(LeafletTooltip)(({ theme }) => ({
    color: theme.palette.text.primary,
    backgroundColor: theme.palette.error.dark,
    borderRadius: theme.shape.borderRadius,
    borderColor: theme.palette.error.main,
    zIndex: 1000,
    '&::before': {
        borderBottomColor: `${theme.palette.error.main} !important`,
    },
}));

// global leaflet map object
let MapObject = null;
const isFiniteNumber = (value) => Number.isFinite(Number(value));
const isValidLatLon = (lat, lon) => isFiniteNumber(lat) && isFiniteNumber(lon);
const isValidLatLonPoint = (point) =>
    Array.isArray(point)
    && point.length === 2
    && isValidLatLon(point[0], point[1]);
const isValidLatLonObjectPoint = (point) =>
    point
    && typeof point === 'object'
    && !Array.isArray(point)
    && isValidLatLon(point.lat, point.lon);
const isValidCoveragePoint = (point) =>
    isValidLatLonPoint(point) || isValidLatLonObjectPoint(point);
const normalizeCoveragePoint = (point) => {
    if (isValidLatLonPoint(point)) {
        return [Number(point[0]), Number(point[1])];
    }
    if (isValidLatLonObjectPoint(point)) {
        return [Number(point.lat), Number(point.lon)];
    }
    return null;
};

const MapSlider = function ({handleSliderChange}) {
    const marks = [
        {
            value: 0,
            label: '0m',
        },
        {
            value: 15,
            label: '+15',
        },
        {
            value: -15,
            label: '-15',
        },
        {
            value: 30,
            label: '+30m',
        },
        {
            value: -30,
            label: '-30m',
        },
        {
            value: 45,
            label: '+45',
        },
        {
            value: -45,
            label: '-45',
        },
        {
            value: 60,
            label: '+60m',
        },
        {
            value: -60,
            label: '-60m',
        }
    ];

    return (
        <Box sx={{
            width: '100%;',
            bottom: 10,
            position: 'absolute',
            left: '0%',
            zIndex: 400,
            textAlign: 'center',
            opacity: 0.8,
        }}>
            <Slider
                valueLabelDisplay="on"
                marks={marks}
                size="medium"
                track={false}
                aria-label=""
                defaultValue={""}
                onChange={(e, value) => {
                    handleSliderChange(value);
                }}
                min={-60}
                max={60}
                sx={{
                    height: 20,
                    width: '70%',
                }}
            />
        </Box>
    );
};

const CenterHomeButton = React.memo(function CenterHomeButton() {
    const { t } = useTranslation('target');
    const {location} = useSelector(state => state.location);

    const handleClick = () => {
        if (location && location.lat != null && location.lon != null) {
            MapObject.setView([location.lat, location.lon], MapObject.getZoom());
        }
    };

    return (
        <Fab size="small" color="primary" aria-label={t('map_controls.go_home')} onClick={handleClick} disabled={!location}>
            <HomeIcon/>
        </Fab>
    );
});

const CenterMapButton = React.memo(function CenterMapButton() {
    const { t } = useTranslation('target');
    const targetCoordinates = [0, 0];

    const handleClick = () => {
        MapObject.setView(targetCoordinates, MapObject.getZoom());
    };

    return (
        <Fab size="small" color="primary" aria-label={t('map_controls.go_to_center')} onClick={handleClick}>
            <FilterCenterFocusIcon/>
        </Fab>
    );
});

const FullscreenMapButton = React.memo(function FullscreenMapButton() {
    const { t } = useTranslation('target');

    const handleMapFullscreen = () => {
        const mapContainer = MapObject.getContainer();
        if (!document.fullscreenElement) {
            if (mapContainer.requestFullscreen) {
                mapContainer.requestFullscreen();
            } else if (mapContainer.mozRequestFullScreen) {
                mapContainer.mozRequestFullScreen();
            } else if (mapContainer.webkitRequestFullscreen) {
                mapContainer.webkitRequestFullscreen();
            } else if (mapContainer.msRequestFullscreen) {
                mapContainer.msRequestFullscreen();
            }
        } else {
            // Exit fullscreen if we're already in it
            if (document.exitFullscreen) {
                document.exitFullscreen();
            } else if (document.mozCancelFullScreen) {
                document.mozCancelFullScreen();
            } else if (document.webkitExitFullscreen) {
                document.webkitExitFullscreen();
            } else if (document.msExitFullscreen) {
                document.msExitFullscreen();
            }
        }
    };

    return (
        <Fab size="small" color="primary" aria-label={t('map_controls.go_fullscreen')} onClick={handleMapFullscreen}>
            <FullscreenIcon/>
        </Fab>
    );
});

const TargetSatelliteMapContainer = ({}) => {
    const {socket} = useSocket();
    const dispatch = useDispatch();
    const { t } = useTranslation('target');
    const theme = useTheme();
    const {
        groupId,
        trackerId,
        satelliteId: noradId,
        showPastOrbitPath,
        showFutureOrbitPath,
        showSatelliteCoverage,
        showSunIcon,
        showMoonIcon,
        showTerminatorLine,
        showTooltip,
        terminatorLine,
        daySidePolygon,
        pastOrbitLineColor,
        futureOrbitLineColor,
        satelliteCoverageColor,
        orbitProjectionDuration,
        tileLayerID,
        mapZoomLevel,
        sunPos,
        moonPos,
        gridEditable,
        sliderTimeOffset,
        openMapSettingsDialog,
        showGrid,
    } = useSelector(state => state.targetSatTrack);
    const trackerInstances = useSelector((state) => state.trackerInstances?.instances || []);
    const targetNumber = useMemo(() => {
        const activeTrackerInstance = trackerInstances.find((instance) => instance?.tracker_id === trackerId) || null;
        const instanceTargetNumber = Number(activeTrackerInstance?.target_number);
        if (Number.isFinite(instanceTargetNumber) && instanceTargetNumber > 0) {
            return instanceTargetNumber;
        }
        const trackerSlotMatch = String(trackerId || '').match(TARGET_SLOT_ID_PATTERN);
        if (trackerSlotMatch) {
            const parsedTargetNumber = Number(trackerSlotMatch[1]);
            if (Number.isFinite(parsedTargetNumber) && parsedTargetNumber > 0) {
                return parsedTargetNumber;
            }
        }
        return null;
    }, [trackerId, trackerInstances]);

    const satellitePosition = useSelector(satellitePositionSelector);
    const satelliteCoverage = useSelector(satelliteCoverageSelector);
    const satelliteDetails = useSelector(satelliteDetailsSelector);
    const satelliteTrackingState = useSelector(satelliteTrackingStateSelector);
    const satellitePaths = useSelector(satellitePathsSelector);
    const satelliteTransmitters = useSelector(satelliteTransmittersSelector);
    const {location} = useSelector(state => state.location);
    const [currentPastSatellitesPaths, setCurrentPastSatellitesPaths] = useState([]);
    const [currentFutureSatellitesPaths, setCurrentFutureSatellitesPaths] = useState([]);
    const [currentSatellitesPosition, setCurrentSatellitesPosition] = useState([]);
    const [currentSatellitesCoverage, setCurrentSatellitesCoverage] = useState([]);
    const [currentCrosshairs, setCurrentCrosshairs] = useState([]);
    const handleSetMapZoomLevel = useCallback((zoomLevel) => {
        dispatch(setMapZoomLevel(zoomLevel));
    }, [dispatch]);

    // Subscribe to map events
    function MapEventComponent({handleSetMapZoomLevel}) {
        const mapEvents = useMapEvents({
            zoomend: () => {
                const mapZoom = mapEvents.getZoom();
                handleSetMapZoomLevel(mapZoom);
                localStorage.setItem(storageMapZoomValueKey, mapZoom);
            },
        });
        return null;
    }

    useEffect(() => {
        satelliteUpdate(new Date());

        return () => {
        };

    }, [satelliteDetails, satellitePosition, satellitePaths, satelliteCoverage, sliderTimeOffset, showTooltip,
        orbitProjectionDuration, tileLayerID, showPastOrbitPath, showFutureOrbitPath, showSatelliteCoverage,
        showSunIcon, showMoonIcon, showTerminatorLine, pastOrbitLineColor, futureOrbitLineColor,
        satelliteCoverageColor]);

    const satelliteUpdate = function (now) {
        if (Object.keys(satelliteDetails['name']).length !== 0) {

            const satelliteName = satelliteDetails['name'];
            const satelliteId = satelliteDetails['norad_id'];
            const latitude = satellitePosition['lat'];
            const longitude = satellitePosition['lon'];
            const altitude = satellitePosition['alt'];
            const velocity = satellitePosition['vel'];
            const paths = satellitePaths;
            const coverage = satelliteCoverage;
            const hasValidSatellitePoint = isValidLatLon(latitude, longitude);

            // generate current positions for the group of satellites
            let currentPos = [];
            let currentCoverage = [];
            let currentFuturePaths = [];
            let currentPastPaths = [];
            let currentCrosshair = [];

            // focus map on satellite, center on latitude only
            //let mapCoords = MapObject.getCenter();
            //MapObject.setView([latitude, longitude], MapObject.getZoom());

            if (paths) {
                // past path
                currentPastPaths.push(<Polyline
                    key={`past-path-${noradId}`}
                    positions={paths['past']}
                    pathOptions={{
                        color: pastOrbitLineColor,
                        weight: 2,
                        opacity: 1,
                        smoothFactor: 1,
                    }}
                />)

                // future path
                currentFuturePaths.push(<Polyline
                    key={`future-path-${noradId}`}
                    positions={paths['future']}
                    pathOptions={{
                        color: futureOrbitLineColor,
                        weight: 2,
                        opacity: 0.8,
                        dashArray: "3 3",
                        smoothFactor: 1,
                    }}
                />)
            }

            if (hasValidSatellitePoint) {
                const crosshairColor = theme.palette.error.main;
                const squareIcon = L.divIcon({
                    className: 'custom-square-marker',
                    html: `<div style="width: 30px; height: 30px; border: 2px solid ${crosshairColor}; opacity: 0.8; box-sizing: border-box;"></div>`,
                    iconSize: [30, 30],
                    iconAnchor: [15, 15],
                });

                currentCrosshair.push(
                    <React.Fragment key={`crosshair-${satelliteId}`}>
                        <Marker
                            position={[latitude, longitude]}
                            icon={squareIcon}
                            interactive={false}
                        />
                        <Polyline
                            positions={[
                                [latitude, -180],
                                [latitude, 180],
                            ]}
                            pathOptions={{
                                color: crosshairColor,
                                weight: 1,
                                opacity: 1,
                                smoothFactor: 1,
                            }}
                        />
                        <Polyline
                            positions={[
                                [-90, longitude],
                                [90, longitude],
                            ]}
                            pathOptions={{
                                color: crosshairColor,
                                weight: 1,
                                opacity: 1,
                                smoothFactor: 1,
                            }}
                        />
                    </React.Fragment>
                );
            }

            if (hasValidSatellitePoint && showTooltip) {
                currentPos.push(<Marker key={"marker-" + satelliteId} position={[latitude, longitude]}
                                        icon={satelliteIcon2}>
                    <TrackedSatelliteTooltip
                        direction="bottom"
                        offset={[0, 15]}
                        opacity={1}
                        permanent
                        className={"tooltip-satellite"}
                        interactive={true}
                    >
                        <strong>
                            {targetNumber != null && (
                                <TargetNumberIcon
                                    targetNumber={targetNumber}
                                    size={15}
                                    sx={{ mr: 0.7, verticalAlign: 'middle', position: 'relative', top: -1 }}
                                    iconColor="common.white"
                                    badgeBgColor="warning.main"
                                    badgeTextColor="common.black"
                                />
                            )}
                            {satelliteName} - {parseInt(altitude) + " km, " + velocity.toFixed(2) + " km/s"}
                        </strong>
                    </TrackedSatelliteTooltip>
                </Marker>);
            } else if (hasValidSatellitePoint) {
                currentPos.push(<Marker key={"marker-" + satelliteId} position={[latitude, longitude]}
                                        icon={satelliteIcon2}>
                </Marker>);
            }

            if (Array.isArray(coverage) && coverage.length > 0 && coverage.every(isValidCoveragePoint)) {
                //let coverage = [];
                //coverage = getSatelliteCoverageCircle(latitude, longitude, altitude, 360);
                currentCoverage.push(<Polyline
                    noClip={true}
                    key={"coverage-" + satelliteDetails['name']}
                    pathOptions={{
                        color: satelliteCoverageColor,
                        weight: 1,
                        fill: true,
                        fillOpacity: 0.2,
                    }}
                    positions={coverage}
                />);
            }

            setCurrentPastSatellitesPaths(currentPastPaths);
            setCurrentFutureSatellitesPaths(currentFuturePaths);
            setCurrentSatellitesPosition(currentPos);
            setCurrentSatellitesCoverage(currentCoverage);
            setCurrentCrosshairs(currentCrosshair);

        } else {
            //console.warn("No satellite data found for norad id: ", noradId, satelliteDetails);
            setCurrentCrosshairs([]);
        }

        // Day/night boundary
        const terminatorLine = createTerminatorLine().reverse();
        dispatch(setTerminatorLine(terminatorLine));

        // Day side polygon
        const dayPoly = [...terminatorLine];
        dayPoly.push(dayPoly[dayPoly.length - 1]);
        dispatch(setDaySidePolygon(dayPoly));

        // sun and moon position
        const [sunPos, moonPos] = getSunMoonCoords();
        dispatch(setSunPos(sunPos));
        dispatch(setMoonPos(moonPos));
    }

    const handleWhenReady = (map) => {
        // map is ready
        MapObject = map.target;
    };

    // Keep target map focused on the selected satellite.
    // If coverage is shown, auto-fit to coverage bounds (legacy behavior).
    useEffect(() => {
        if (!MapObject) return;

        const selectedNoradId = String(noradId ?? '');
        const loadedNoradId = String(satelliteDetails?.norad_id ?? '');
        const lat = satellitePosition?.lat;
        const lon = satellitePosition?.lon;
        if (!isValidLatLon(lat, lon)) return;
        if (loadedNoradId !== selectedNoradId) return;

        const coveragePoints = Array.isArray(satelliteCoverage)
            ? satelliteCoverage
                .map(normalizeCoveragePoint)
                .filter((point) => Array.isArray(point) && point.length === 2)
            : [];
        if (showSatelliteCoverage && coveragePoints.length > 1) {
            const coverageBounds = L.latLngBounds(coveragePoints);
            if (coverageBounds.isValid()) {
                MapObject.fitBounds(coverageBounds, {
                    padding: [1, 1],
                    animate: false,
                });
                return;
            }
        }

        MapObject.setView([lat, lon], MapObject.getZoom(), { animate: false });
    }, [
        noradId,
        satelliteDetails?.norad_id,
        satellitePosition?.lat,
        satellitePosition?.lon,
        satelliteCoverage,
        showSatelliteCoverage,
    ]);

    useEffect(() => {
        const intervalId = setInterval(() => {
            if (MapObject) {
                MapObject.invalidateSize();
            }
        }, 1000);

        return () => {
            clearInterval(intervalId);
        };
    }, []);

    useEffect(() => {
        // zoom in and out a bit to fix the zoom factor issue
        if (MapObject) {
            const zoomLevel = MapObject.getZoom();
            const loc = MapObject.getCenter();
            setTimeout(() => {
                MapObject.setView([loc.lat, loc.lng], zoomLevel - 0.25);
                setTimeout(() => {
                    MapObject.setView([loc.lat, loc.lng], zoomLevel);
                }, 500);
            }, 0);
        }
        return () => {

        };
    }, [tileLayerID]);

    useEffect(() => {
        if (noradId) {
            dispatch(fetchSatellite({socket, noradId: noradId}));
        }

        return () => {

        };
    }, [noradId]);

    const handleOpenSettings = useCallback(() => {
        dispatch(setOpenMapSettingsDialog(true));
    }, [dispatch]);

    return (
        <>
            <TitleBar
                className={getClassNamesBasedOnGridEditing(gridEditable, ["window-title-bar"])}
                sx={{
                    bgcolor: 'background.titleBar',
                    borderBottom: '1px solid',
                    borderColor: 'border.main',
                    backdropFilter: 'blur(10px)'
                }}
            >
                <Box sx={{display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%'}}>
                    <Box sx={{display: 'flex', alignItems: 'center'}}>
                        <Typography variant="subtitle2" sx={{fontWeight: 'bold'}}>
                            {t('satellite_map.title')}
                        </Typography>
                    </Box>
                    <Box sx={{ display: 'flex', gap: 0.5 }}>
                        <Tooltip title={t('map_settings.title')}>
                            <span>
                                <IconButton
                                    size="small"
                                    onClick={handleOpenSettings}
                                    sx={{ padding: '2px' }}
                                >
                                    <SettingsIcon fontSize="small" />
                                </IconButton>
                            </span>
                        </Tooltip>
                    </Box>
                </Box>
            </TitleBar>
            <MapContainer
                className="target-map"
                center={satellitePosition?.lat && satellitePosition?.lon ? [satellitePosition.lat, satellitePosition.lon] : [0, 0]}
                zoom={mapZoomLevel}
                style={{width: '100%', height: 'calc(100% - 60px)'}}
                dragging={false}
                scrollWheelZoom={false}
                maxZoom={10}
                minZoom={0}
                whenReady={handleWhenReady}
                zoomSnap={0.25}
                zoomDelta={0.25}
                keyboard={false}
                bounceAtZoomLimits={false}
                closePopupOnClick={false}
            >
                <MapEventComponent handleSetMapZoomLevel={handleSetMapZoomLevel}/>

                <TileLayer url={getTileLayerById(tileLayerID)['url']}/>

                <Box sx={{'& > :not(style)': {m: 1}}} style={{right: 5, top: 5, position: 'absolute'}}>
                    <CenterHomeButton/>
                    <CenterMapButton/>
                    <FullscreenMapButton/>
                </Box>

                <MapSettingsIslandDialog updateBackend={() => {
                    const key = 'target-map-settings';
                    dispatch(setTargetMapSetting({socket, key: key}));
                }}/>

                {sunPos && showSunIcon ? (
                    isValidLatLonPoint(sunPos) ? <Marker position={sunPos} icon={sunIcon} opacity={0.5}/> : null
                ) : null}

                {moonPos && showMoonIcon ? (
                    isValidLatLonPoint(moonPos) ? <Marker position={moonPos} icon={moonIcon} opacity={0.5}/> : null
                ) : null}

                {daySidePolygon.length > 1 && showTerminatorLine && (
                    <Polygon
                        positions={daySidePolygon}
                        pathOptions={{
                            fillColor: 'black',
                            fillOpacity: 0.4,
                            color: 'white',
                            opacity: 0.5,
                            weight: 0,
                            smoothFactor: 1,
                        }}
                    />
                )}

                {terminatorLine.length > 1 && showTerminatorLine && (
                    <Polyline
                        positions={terminatorLine}
                        pathOptions={{
                            color: 'white',
                            weight: 1,
                            opacity: 0.1,
                        }}
                    />
                )}

                {InternationalDateLinePolyline()}

                {location && location.lat != null && location.lon != null && (
                    <Marker position={[location.lat, location.lon]} icon={homeIcon} opacity={0.8}/>
                )}

                {showPastOrbitPath ? currentPastSatellitesPaths : null}
                {showFutureOrbitPath ? currentFutureSatellitesPaths : null}
                {currentCrosshairs}
                {currentSatellitesPosition}
                {showSatelliteCoverage ? currentSatellitesCoverage : null}


                <MapArrowControls mapObject={MapObject}/>

                {showGrid && (
                    <CoordinateGrid
                        latInterval={15}
                        lngInterval={15}
                        latColor="#FFFFFF"
                        lngColor="#FFFFFF"
                        weight={1}
                        opacity={0.5}
                        showLabels={false}
                    />
                )}
            </MapContainer>
            <MapStatusBar>
                <SimpleTruncatedHtml
                    className={"attribution"}
                    htmlString={`<a href="https://leafletjs.com" title="A JavaScript library for interactive maps" target="_blank" rel="noopener noreferrer">Leaflet</a> | ${getTileLayerById(tileLayerID)['attribution']}`}
                />
            </MapStatusBar>
        </>
    );
};

export default TargetSatelliteMapContainer;
