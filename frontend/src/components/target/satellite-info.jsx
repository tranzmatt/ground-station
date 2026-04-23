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

import {useDispatch, useSelector} from "react-redux";
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import {
    betterStatusValue,
    getClassNamesBasedOnGridEditing,
    humanizeAltitude,
    humanizeDate,
    humanizeLatitude,
    humanizeLongitude,
    humanizeVelocity,
    getFrequencyBand,
    getBandColor,
    renderCountryFlagsCSV,
    TitleBar
} from "../common/common.jsx";
import {
    Box,
    Typography,
    Divider,
    Chip,
    Button,
    Tooltip,
    IconButton
} from '@mui/material';
import TrackChangesIcon from '@mui/icons-material/TrackChanges';
import SatelliteAltIcon from '@mui/icons-material/SatelliteAlt';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import CancelIcon from '@mui/icons-material/Cancel';
import ExploreIcon from '@mui/icons-material/Explore';
import HeightIcon from '@mui/icons-material/Height';
import SpeedIcon from '@mui/icons-material/Speed';
import MyLocationIcon from '@mui/icons-material/MyLocation';
import PublicIcon from '@mui/icons-material/Public';
import RocketLaunchIcon from '@mui/icons-material/RocketLaunch';
import UpdateIcon from '@mui/icons-material/Update';
import BusinessIcon from '@mui/icons-material/Business';
import RadioIcon from '@mui/icons-material/Radio';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import EditIcon from '@mui/icons-material/Edit';
import RadioButtonCheckedIcon from '@mui/icons-material/RadioButtonChecked';
import Grid from "@mui/material/Grid";
import React from "react";
import TransmittersDialog from "../satellites/transmitters-dialog.jsx";
import SatelliteEditDialog from "../satellites/satellite-edit-dialog.jsx";
import {fetchSatellite} from "./target-slice.jsx";
import {useSocket} from "../common/socket.jsx";
// ElevationDisplay not used in target page; using satelliteData for elevation per request

const TargetSatelliteInfoIsland = () => {
    const { t } = useTranslation('target');
    const { t: tSat } = useTranslation('satellites');
    const dispatch = useDispatch();
    const { socket } = useSocket();
    const { satelliteData, gridEditable, satelliteId } = useSelector((state) => state.targetSatTrack);
    const trackerInstances = useSelector((state) => state.trackerInstances?.instances || []);
    const selectedSatellitePositions = useSelector(state => state.overviewSatTrack.selectedSatellitePositions);
    const navigate = useNavigate();
    const transmitters = satelliteData?.transmitters || [];
    const [satelliteEditDialogOpen, setSatelliteEditDialogOpen] = React.useState(false);
    const [transmittersDialogOpen, setTransmittersDialogOpen] = React.useState(false);
    const selectedNoradId = satelliteData?.details?.norad_id || satelliteId || null;
    const selectedSatelliteName = satelliteData?.details?.name || '';
    const hasTargets = trackerInstances.length > 0;
    const hasSatelliteSelection = Boolean(selectedNoradId);
    const satelliteDialogData = {
        ...(satelliteData?.details || {}),
        norad_id: selectedNoradId,
        name: selectedSatelliteName,
        transmitters,
    };

    const handleSatelliteSaved = () => {
        if (!selectedNoradId) {
            return;
        }
        dispatch(fetchSatellite({ socket, noradId: selectedNoradId }));
    };

    // Mini circular gauge for angular measurements
    const CircularGauge = ({ value, max, size = 36 }) => {
        const percentage = (value / max) * 100;
        const circumference = 2 * Math.PI * 13;
        const strokeDashoffset = circumference - (percentage / 100) * circumference;

        return (
            <Box sx={{ position: 'relative', width: size, height: size, display: 'inline-flex' }}>
                <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
                    <circle
                        cx={size / 2}
                        cy={size / 2}
                        r="13"
                        stroke="rgba(255,255,255,0.08)"
                        strokeWidth="2.5"
                        fill="none"
                    />
                    <circle
                        cx={size / 2}
                        cy={size / 2}
                        r="13"
                        stroke="currentColor"
                        strokeWidth="2.5"
                        fill="none"
                        strokeDasharray={circumference}
                        strokeDashoffset={strokeDashoffset}
                        strokeLinecap="round"
                    />
                </svg>
            </Box>
        );
    };

    const DataPoint = ({ icon: Icon, label, value, unit = '', showGauge = false, gaugeValue, gaugeMax, emphasis = false }) => (
        <Box sx={{
            p: 1,
            bgcolor: 'overlay.light',
            borderRadius: 1,
            display: 'flex',
            flexDirection: 'column',
            height: '100%'
        }}>
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 0.5 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', flex: 1 }}>
                    <Icon sx={{ fontSize: 12, mr: 0.5, color: 'text.secondary' }} />
                    <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: '0.65rem', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                        {label}
                    </Typography>
                </Box>
                {showGauge && gaugeValue !== undefined && (
                    <Box sx={{ color: emphasis ? 'primary.main' : 'secondary.main' }}>
                        <CircularGauge value={gaugeValue} max={gaugeMax} size={30} />
                    </Box>
                )}
            </Box>
            <Typography variant="h6" sx={{
                fontWeight: 600,
                color: emphasis ? 'primary.main' : 'text.primary',
                lineHeight: 1.2,
                fontFamily: 'monospace',
                fontSize: '1rem'
            }}>
                {value}
                {unit && <Typography component="span" variant="caption" sx={{ ml: 0.5, color: 'text.secondary', fontFamily: 'inherit' }}>{unit}</Typography>}
            </Typography>
        </Box>
    );

    const Section = ({ title, icon: Icon, children }) => (
        <Box sx={{ mb: 1.5 }}>
            <Box sx={{
                display: 'flex',
                alignItems: 'center',
                mb: 1
            }}>
                <Icon sx={{ fontSize: 14, mr: 0.75, color: 'secondary.main' }} />
                <Typography variant="overline" sx={{
                    fontSize: '0.7rem',
                    fontWeight: 700,
                    color: 'secondary.main',
                    letterSpacing: '0.5px'
                }}>
                    {title}
                </Typography>
            </Box>
            {children}
        </Box>
    );

    const formatFrequencyRange = (lowHz, highHz) => {
        if (!lowHz && !highHz) return t('satellite_info.values.na');
        if (lowHz && highHz) return `${(lowHz / 1e6).toFixed(3)}-${(highHz / 1e6).toFixed(3)} MHz`;
        const hz = lowHz || highHz;
        return `${(hz / 1e6).toFixed(3)} MHz`;
    };

    return (
        <Box sx={{
            height: '100%',
            display: 'flex',
            flexDirection: 'column',
            bgcolor: 'background.paper',
            backdropFilter: 'blur(10px)',
            backgroundImage: 'linear-gradient(rgba(255, 255, 255, 0.05), rgba(255, 255, 255, 0.05))'
        }}>
            {/* Header */}
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
                            {t('satellite_info.title')}
                        </Typography>
                    </Box>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <Typography variant="caption" sx={{color: 'text.secondary'}}>
                            ID: {satelliteData && satelliteData['details'] ? satelliteData['details']['norad_id'] : ''}
                        </Typography>
                    </Box>
                </Box>
            </TitleBar>

            {!hasSatelliteSelection && (
                <Box
                    sx={{
                        flex: 1,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        px: 2,
                    }}
                >
                    <Box
                        sx={{
                            width: '100%',
                            maxWidth: 380,
                            textAlign: 'center',
                            p: 2.5,
                            borderRadius: 1.25,
                            border: '1px dashed',
                            borderColor: 'border.main',
                            backgroundColor: 'overlay.light',
                        }}
                    >
                        <TrackChangesIcon sx={{ color: 'text.secondary', mb: 1 }} />
                        <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                            {hasTargets ? 'No satellite selected' : 'No targets configured'}
                        </Typography>
                        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                            {hasTargets
                                ? 'Choose a satellite from the target selector to view live orbital details.'
                                : 'Create a target first, then select a satellite to see telemetry and metadata.'}
                        </Typography>
                    </Box>
                </Box>
            )}

            {hasSatelliteSelection && (
            <>
            {/* Satellite Status Header - Sticky */}
            <Box sx={{
                p: 1,
                background: satelliteData && satelliteData['details'] ?
                    (() => {
                        const status = satelliteData['details']['status'];
                        switch(status) {
                            case 'alive': return (theme) => `linear-gradient(135deg, ${theme.palette.success.main}26 0%, ${theme.palette.success.main}0D 100%)`;
                            case 'dead': return (theme) => `linear-gradient(135deg, ${theme.palette.error.main}26 0%, ${theme.palette.error.main}0D 100%)`;
                            case 're-entered': return (theme) => `linear-gradient(135deg, ${theme.palette.warning.main}26 0%, ${theme.palette.warning.main}0D 100%)`;
                            default: return (theme) => `linear-gradient(135deg, ${theme.palette.overlay.light} 0%, ${theme.palette.overlay.main} 100%)`;
                        }
                    })() : (theme) => `linear-gradient(135deg, ${theme.palette.overlay.light} 0%, ${theme.palette.overlay.main} 100%)`,
                borderBottom: '1px solid',
                borderColor: 'border.main'
            }}>
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 0.75 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', flex: 1, minWidth: 0 }}>
                        <Box sx={{
                            width: 10,
                            height: 10,
                            borderRadius: '50%',
                            mr: 1,
                            flexShrink: 0,
                            bgcolor: satelliteData && satelliteData['details'] && satelliteData['details']['status'] === 'alive' ? 'success.main' : 'error.main',
                            boxShadow: (theme) => `0 0 8px ${satelliteData && satelliteData['details'] && satelliteData['details']['status'] === 'alive' ? theme.palette.success.main : theme.palette.error.main}`
                        }} />
                        <Box sx={{ minWidth: 0, flex: 1 }}>
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, minWidth: 0 }}>
                                <Typography
                                    variant="subtitle1"
                                    noWrap
                                    sx={{ fontWeight: 700, letterSpacing: '0.3px', minWidth: 0 }}
                                >
                                    {satelliteData && satelliteData['details']
                                        ? `${satelliteData['details']['name']}${satelliteData['details']['name_other'] ? ` • ${satelliteData['details']['name_other']}` : ''}`
                                        : "NO DATA"}
                                </Typography>
                                <Tooltip title="Edit Details">
                                    <span>
                                        <IconButton
                                            size="small"
                                            onClick={() => setSatelliteEditDialogOpen(true)}
                                            disabled={!selectedNoradId}
                                        >
                                            <EditIcon fontSize="small" />
                                        </IconButton>
                                    </span>
                                </Tooltip>
                                <Tooltip title="Edit Transmitters">
                                    <span>
                                        <IconButton
                                            size="small"
                                            onClick={() => setTransmittersDialogOpen(true)}
                                            disabled={!selectedNoradId}
                                        >
                                            <RadioButtonCheckedIcon fontSize="small" />
                                        </IconButton>
                                    </span>
                                </Tooltip>
                            </Box>
                        </Box>
                    </Box>
                    {satelliteData && satelliteData['details'] && (
                        <Box sx={{ ml: 1 }}>
                            {betterStatusValue(satelliteData['details']['status'])}
                        </Box>
                    )}
                </Box>

                <Grid container spacing={0.5}>
                    <Grid size={3}>
                        <Box sx={{ display: 'flex', alignItems: 'center', px: 0.5, py: 0.3, bgcolor: 'overlay.main', borderRadius: 0.5 }}>
                            <RocketLaunchIcon sx={{ fontSize: 11, mr: 0.4, color: 'text.secondary' }} />
                            <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: '0.68rem' }}>
                                {satelliteData && satelliteData['details'] ? humanizeDate(satelliteData['details']['launched']) : 'N/A'}
                            </Typography>
                        </Box>
                    </Grid>
                    <Grid size={satelliteData && satelliteData['details'] && satelliteData['details']['operator'] && satelliteData['details']['operator'] !== 'None' ? 3.5 : 6}>
                        <Box sx={{ display: 'flex', alignItems: 'center', px: 0.5, py: 0.3, bgcolor: 'overlay.main', borderRadius: 0.5 }}>
                            <UpdateIcon sx={{ fontSize: 11, mr: 0.4, color: 'text.secondary' }} />
                            <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: '0.68rem' }}>
                                {satelliteData && satelliteData['details'] ? humanizeDate(satelliteData['details']['updated']) : 'N/A'}
                            </Typography>
                        </Box>
                    </Grid>
                    {satelliteData && satelliteData['details'] && satelliteData['details']['operator'] && satelliteData['details']['operator'] !== 'None' && (
                        <Grid size={2.5}>
                            <Box sx={{ display: 'flex', alignItems: 'center', px: 0.5, py: 0.3, bgcolor: 'overlay.main', borderRadius: 0.5 }}>
                                <BusinessIcon sx={{ fontSize: 11, mr: 0.4, color: 'text.secondary' }} />
                                <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: '0.68rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                    {satelliteData['details']['operator']}
                                </Typography>
                            </Box>
                        </Grid>
                    )}
                    <Grid size={3}>
                        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', px: 0.5, py: 0.3, bgcolor: 'overlay.main', borderRadius: 0.5 }}>
                            <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: '0.68rem', whiteSpace: 'nowrap' }}>
                                {satelliteData && satelliteData['details'] && satelliteData['details']['countries'] ?
                                    renderCountryFlagsCSV(satelliteData['details']['countries']) :
                                    'N/A'
                                }
                            </Typography>
                        </Box>
                    </Grid>
                </Grid>
            </Box>

            {/* Main Content */}
            <Box sx={{ pr: 1.5, pl: 1.5, pt: 1.5, pb: 1, flex: 1, overflow: 'auto' }}>

                {/* Real-time Position Data - Priority Section */}
                <Box sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
                    <ExploreIcon sx={{ fontSize: 14, mr: 0.75, color: 'primary.main' }} />
                    <Typography variant="overline" sx={{
                        fontSize: '0.7rem',
                        fontWeight: 700,
                        color: 'primary.main',
                        letterSpacing: '0.5px'
                    }}>
                        Real-Time Position
                    </Typography>
                </Box>
                <Box sx={{
                    mb: 1.5,
                    p: 1.25,
                    bgcolor: 'overlay.light',
                    borderRadius: 1
                }}>
                    <Grid container spacing={1}>
                        <Grid size={6}>
                            <Box sx={{
                                textAlign: 'center',
                                p: 1,
                                bgcolor: 'background.paper',
                                borderRadius: 1,
                                border: '1px solid',
                                borderColor: 'divider'
                            }}>
                                <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: '0.55rem', textTransform: 'uppercase', letterSpacing: '0.5px', display: 'block', mb: 0.5 }}>
                                    Elevation
                                </Typography>
                                <Typography variant="h4" sx={{ fontWeight: 700, color: 'primary.main', fontFamily: 'monospace', lineHeight: 1 }}>
                                    {satelliteData && satelliteData['position'] && satelliteData['position']['el'] !== undefined
                                        ? `${satelliteData['position']['el'].toFixed(1)}°`
                                        : '--'}
                                </Typography>
                            </Box>
                        </Grid>
                        <Grid size={6}>
                            <Box sx={{
                                textAlign: 'center',
                                p: 1,
                                bgcolor: 'background.paper',
                                borderRadius: 1,
                                border: '1px solid',
                                borderColor: 'divider'
                            }}>
                                <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: '0.55rem', textTransform: 'uppercase', letterSpacing: '0.5px', display: 'block', mb: 0.5 }}>
                                    Azimuth
                                </Typography>
                                <Typography variant="h4" sx={{ fontWeight: 700, color: 'secondary.main', fontFamily: 'monospace', lineHeight: 1 }}>
                                    {satelliteData && satelliteData['position'] && satelliteData['position']['az'] ? `${satelliteData['position']['az'].toFixed(1)}°` : '--'}
                                </Typography>
                            </Box>
                        </Grid>
                        <Grid size={6}>
                            <Box sx={{
                                textAlign: 'center',
                                p: 1,
                                bgcolor: 'background.paper',
                                borderRadius: 1,
                                border: '1px solid',
                                borderColor: 'divider'
                            }}>
                                <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: '0.55rem', textTransform: 'uppercase', letterSpacing: '0.5px', display: 'block', mb: 0.5 }}>
                                    Altitude
                                </Typography>
                                <Typography variant="h5" sx={{ fontWeight: 700, color: 'text.primary', fontFamily: 'monospace', lineHeight: 1 }}>
                                    {satelliteData && satelliteData['position'] ? humanizeAltitude(satelliteData['position']['alt'], 0) : '--'}
                                    <Typography component="span" sx={{ ml: 0.5, fontSize: '0.7rem', color: 'text.secondary' }}>km</Typography>
                                </Typography>
                            </Box>
                        </Grid>
                        <Grid size={6}>
                            <Box sx={{
                                textAlign: 'center',
                                p: 1,
                                bgcolor: 'background.paper',
                                borderRadius: 1,
                                border: '1px solid',
                                borderColor: 'divider'
                            }}>
                                <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: '0.55rem', textTransform: 'uppercase', letterSpacing: '0.5px', display: 'block', mb: 0.5 }}>
                                    Velocity
                                </Typography>
                                <Typography variant="h5" sx={{ fontWeight: 700, color: 'text.primary', fontFamily: 'monospace', lineHeight: 1 }}>
                                    {satelliteData && satelliteData['position'] ? humanizeVelocity(satelliteData['position']['vel']) : '--'}
                                    <Typography component="span" sx={{ ml: 0.5, fontSize: '0.7rem', color: 'text.secondary' }}>km/s</Typography>
                                </Typography>
                            </Box>
                        </Grid>
                    </Grid>
                </Box>

                {/* Geographic Position */}
                <Section title={t('satellite_info.sections.position_data')} icon={PublicIcon}>
                    <Grid container spacing={0.75}>
                        <Grid size={6}>
                            <DataPoint
                                icon={PublicIcon}
                                label={t('satellite_info.labels.latitude')}
                                value={satelliteData && satelliteData['position'] ? humanizeLatitude(satelliteData['position']['lat']) : t('satellite_info.values.na')}
                                emphasis
                            />
                        </Grid>
                        <Grid size={6}>
                            <DataPoint
                                icon={PublicIcon}
                                label={t('satellite_info.labels.longitude')}
                                value={satelliteData && satelliteData['position'] ? humanizeLongitude(satelliteData['position']['lon']) : t('satellite_info.values.na')}
                                emphasis
                            />
                        </Grid>
                    </Grid>
                </Section>

                <Divider sx={{ my: 1, borderColor: 'border.main' }} />

                {/* Orbital Data */}
                <Section title={t('satellite_info.sections.orbital_data')} icon={SpeedIcon}>
                    <Grid container spacing={0.75}>
                        <Grid size={6}>
                            <DataPoint
                                icon={HeightIcon}
                                label={t('satellite_info.labels.altitude')}
                                value={satelliteData && satelliteData['position'] ? humanizeAltitude(satelliteData['position']['alt'], 0) : t('satellite_info.values.na')}
                                unit="km"
                            />
                        </Grid>
                        <Grid size={6}>
                            <DataPoint
                                icon={SpeedIcon}
                                label={t('satellite_info.labels.velocity')}
                                value={satelliteData && satelliteData['position'] ? humanizeVelocity(satelliteData['position']['vel']) : t('satellite_info.values.na')}
                                unit="km/s"
                            />
                        </Grid>
                        <Grid size={12}>
                            <Box sx={{
                                p: 1,
                                bgcolor: 'overlay.light',
                                borderRadius: 1,
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between'
                            }}>
                                <Box sx={{ display: 'flex', alignItems: 'center' }}>
                                    {satelliteData && satelliteData['details'] && satelliteData['details']['is_geostationary'] ?
                                        <CheckCircleIcon sx={{ fontSize: 14, mr: 0.75, color: 'success.main' }} /> :
                                        <CancelIcon sx={{ fontSize: 14, mr: 0.75, color: 'text.secondary' }} />
                                    }
                                    <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: '0.65rem', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                                        {t('satellite_info.labels.geostationary')}
                                    </Typography>
                                </Box>
                                <Chip
                                    label={satelliteData && satelliteData['details'] && satelliteData['details']['is_geostationary'] ? t('satellite_info.values.yes') : t('satellite_info.values.no')}
                                    size="small"
                                    color={satelliteData && satelliteData['details'] && satelliteData['details']['is_geostationary'] ? 'success' : 'default'}
                                    sx={{ height: 18, fontSize: '0.65rem', fontWeight: 600 }}
                                />
                            </Box>
                        </Grid>
                    </Grid>
                </Section>

                <Divider sx={{ my: 1, borderColor: 'border.main' }} />

                {/* Compact Transmitters */}
                <Section title={t('satellite_transmitters.title')} icon={RadioIcon}>
                    <Box sx={{ p: 1, bgcolor: 'overlay.light', borderRadius: 1 }}>
                        <Grid container spacing={1} sx={{ mb: 1 }}>
                            <Grid size={6}>
                                <Box sx={{ textAlign: 'center' }}>
                                    <Typography variant="h6" sx={{ fontWeight: 700, color: 'text.primary', fontFamily: 'monospace', lineHeight: 1 }}>
                                        {transmitters.length}
                                    </Typography>
                                    <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: '0.6rem', textTransform: 'uppercase' }}>
                                        {t('satellite_transmitters.labels.total')}
                                    </Typography>
                                </Box>
                            </Grid>
                            <Grid size={6}>
                                <Box sx={{ textAlign: 'center' }}>
                                    <Typography variant="h6" sx={{ fontWeight: 700, color: 'success.main', fontFamily: 'monospace', lineHeight: 1 }}>
                                        {transmitters.filter(tx => tx?.alive && tx?.status === 'active').length}
                                    </Typography>
                                    <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: '0.6rem', textTransform: 'uppercase' }}>
                                        {t('satellite_transmitters.labels.active')}
                                    </Typography>
                                </Box>
                            </Grid>
                        </Grid>

                        {transmitters.length > 0 ? (
                            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.65 }}>
                                {[...transmitters]
                                    .sort((a, b) => {
                                        const aActive = Number(Boolean(a?.alive && a?.status === 'active'));
                                        const bActive = Number(Boolean(b?.alive && b?.status === 'active'));
                                        return bActive - aActive;
                                    })
                                    .slice(0, 4)
                                    .map((tx, idx) => {
                                        const band = tx?.downlink_low ? getFrequencyBand(tx.downlink_low) : null;
                                        const isActive = tx?.alive && tx?.status === 'active';
                                        return (
                                            <Box
                                                key={tx?.id || idx}
                                                sx={{
                                                    px: 0.75,
                                                    py: 0.55,
                                                    borderRadius: 0.8,
                                                    bgcolor: 'background.paper',
                                                    border: '1px solid',
                                                    borderColor: isActive ? 'success.dark' : 'border.main',
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    justifyContent: 'space-between',
                                                    gap: 0.6
                                                }}
                                            >
                                                <Box sx={{ minWidth: 0, flex: 1 }}>
                                                    <Typography
                                                        variant="caption"
                                                        noWrap
                                                        sx={{ fontSize: '0.66rem', fontWeight: 700, color: 'text.primary', display: 'block' }}
                                                    >
                                                        {tx?.description || t('satellite_info.values.na')}
                                                    </Typography>
                                                    <Typography
                                                        variant="caption"
                                                        noWrap
                                                        sx={{ fontSize: '0.62rem', color: 'text.secondary', fontFamily: 'monospace', display: 'block' }}
                                                    >
                                                        {formatFrequencyRange(tx?.downlink_low, tx?.downlink_high)}
                                                        {tx?.mode ? ` • ${tx.mode}` : ''}
                                                    </Typography>
                                                </Box>
                                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flexShrink: 0 }}>
                                                    {band && (
                                                        <Box
                                                            sx={{
                                                                px: 0.7,
                                                                py: 0.2,
                                                                borderRadius: 99,
                                                                bgcolor: getBandColor(band) || 'primary.main'
                                                            }}
                                                        >
                                                            <Typography variant="caption" sx={{ color: '#fff', fontSize: '0.58rem', fontWeight: 700 }}>
                                                                {band}
                                                            </Typography>
                                                        </Box>
                                                    )}
                                                    <Chip
                                                        label={isActive ? 'ACTIVE' : 'INACTIVE'}
                                                        size="small"
                                                        color={isActive ? 'success' : 'default'}
                                                        sx={{ height: 18, fontSize: '0.56rem', fontWeight: 700 }}
                                                    />
                                                </Box>
                                            </Box>
                                        );
                                    })}
                                {transmitters.length > 4 && (
                                    <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: '0.62rem', textAlign: 'center', pt: 0.25 }}>
                                        +{transmitters.length - 4} more
                                    </Typography>
                                )}
                            </Box>
                        ) : (
                            <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', textAlign: 'center', py: 0.5 }}>
                                {t('satellite_transmitters.messages.no_transmitters')}
                            </Typography>
                        )}
                    </Box>
                </Section>

                <Divider sx={{ my: 1, borderColor: 'border.main' }} />

                {/* TLE Data */}
                {satelliteData && satelliteData['details'] && satelliteData['details']['tle1'] && (
                    <>
                        <Section title="TLE Data" icon={SatelliteAltIcon}>
                            <Box sx={{
                                p: 1,
                                bgcolor: 'overlay.light',
                                borderRadius: 1
                            }}>
                                <Typography variant="caption" sx={{
                                    color: 'text.secondary',
                                    fontSize: '0.55rem',
                                    display: 'block',
                                    mb: 0.5,
                                    textTransform: 'uppercase'
                                }}>
                                    Line 1
                                </Typography>
                                <Typography variant="caption" sx={{
                                    color: 'text.primary',
                                    fontFamily: 'monospace',
                                    fontSize: '0.6rem',
                                    display: 'block',
                                    mb: 1,
                                    wordBreak: 'break-all'
                                }}>
                                    {satelliteData['details']['tle1']}
                                </Typography>

                                <Typography variant="caption" sx={{
                                    color: 'text.secondary',
                                    fontSize: '0.55rem',
                                    display: 'block',
                                    mb: 0.5,
                                    textTransform: 'uppercase'
                                }}>
                                    Line 2
                                </Typography>
                                <Typography variant="caption" sx={{
                                    color: 'text.primary',
                                    fontFamily: 'monospace',
                                    fontSize: '0.6rem',
                                    display: 'block',
                                    wordBreak: 'break-all'
                                }}>
                                    {satelliteData['details']['tle2']}
                                </Typography>
                            </Box>
                        </Section>

                        <Divider sx={{ my: 1, borderColor: 'border.main' }} />
                    </>
                )}

                {/* Additional Metadata */}
                <Section title={t('satellite_info.sections.metadata')} icon={RocketLaunchIcon}>
                    <Box sx={{
                        p: 1,
                        bgcolor: 'overlay.light',
                        borderRadius: 1
                    }}>
                        <Grid container spacing={1}>
                            <Grid size={12}>
                                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 0.5 }}>
                                    <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: '0.65rem', textTransform: 'uppercase' }}>
                                        {t('satellite_info.labels.satellite_id')}
                                    </Typography>
                                    <Typography variant="caption" sx={{ color: 'text.primary', fontWeight: 600, fontSize: '0.65rem', fontFamily: 'monospace' }}>
                                        {satelliteData && satelliteData['details'] ? satelliteData['details']['sat_id'] : t('satellite_info.values.na')}
                                    </Typography>
                                </Box>
                            </Grid>
                            <Grid size={12}>
                                <Divider sx={{ my: 0.5 }} />
                            </Grid>
                            <Grid size={12}>
                                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 0.5 }}>
                                    <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: '0.65rem', textTransform: 'uppercase' }}>
                                        Added to DB
                                    </Typography>
                                    <Typography variant="caption" sx={{ color: 'text.primary', fontWeight: 600, fontSize: '0.65rem' }}>
                                        {satelliteData && satelliteData['details'] ? humanizeDate(satelliteData['details']['added']) : t('satellite_info.values.na')}
                                    </Typography>
                                </Box>
                            </Grid>
                            {satelliteData && satelliteData['details'] && satelliteData['details']['website'] && (
                                <>
                                    <Grid size={12}>
                                        <Divider sx={{ my: 0.5 }} />
                                    </Grid>
                                    <Grid size={12}>
                                        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 0.5 }}>
                                            <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: '0.65rem', textTransform: 'uppercase' }}>
                                                Website
                                            </Typography>
                                            <Typography
                                                component="a"
                                                href={satelliteData['details']['website']}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                variant="caption"
                                                sx={{
                                                    color: 'primary.main',
                                                    fontWeight: 600,
                                                    fontSize: '0.65rem',
                                                    textDecoration: 'none',
                                                    '&:hover': {
                                                        textDecoration: 'underline'
                                                    }
                                                }}
                                            >
                                                Link ↗
                                            </Typography>
                                        </Box>
                                    </Grid>
                                </>
                            )}
                            {satelliteData && satelliteData['details'] && satelliteData['details']['citation'] && (
                                <>
                                    <Grid size={12}>
                                        <Divider sx={{ my: 0.5 }} />
                                    </Grid>
                                    <Grid size={12}>
                                        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                            <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: '0.65rem', textTransform: 'uppercase' }}>
                                                Citation
                                            </Typography>
                                            <Typography variant="caption" sx={{ color: 'text.primary', fontWeight: 600, fontSize: '0.65rem', fontStyle: 'italic' }}>
                                                {satelliteData['details']['citation']}
                                            </Typography>
                                        </Box>
                                    </Grid>
                                </>
                            )}
                        </Grid>
                    </Box>
                </Section>

                {/* View Details Button */}
                {satelliteData && satelliteData['details'] && satelliteData['details']['norad_id'] && (
                    <Box sx={{ mt: 1.5, display: 'flex', alignItems: 'center', gap: 0.5, width: '100%' }}>
                        <Button
                            variant="text"
                            size="small"
                            startIcon={<EditIcon sx={{ fontSize: 14 }} />}
                            onClick={() => setSatelliteEditDialogOpen(true)}
                            disabled={!selectedNoradId}
                            sx={{
                                flex: 1,
                                minWidth: 0,
                                fontSize: '0.65rem',
                                textTransform: 'none',
                                color: 'text.secondary',
                                '&:hover': {
                                    color: 'primary.main',
                                    bgcolor: 'transparent'
                                }
                            }}
                        >
                            Edit Details
                        </Button>
                        <Button
                            variant="text"
                            size="small"
                            startIcon={<RadioButtonCheckedIcon sx={{ fontSize: 14 }} />}
                            onClick={() => setTransmittersDialogOpen(true)}
                            disabled={!selectedNoradId}
                            sx={{
                                flex: 1,
                                minWidth: 0,
                                fontSize: '0.65rem',
                                textTransform: 'none',
                                color: 'text.secondary',
                                '&:hover': {
                                    color: 'primary.main',
                                    bgcolor: 'transparent'
                                }
                            }}
                        >
                            Edit Transmitters
                        </Button>
                        <Button
                            variant="text"
                            size="small"
                            startIcon={<InfoOutlinedIcon sx={{ fontSize: 14 }} />}
                            onClick={() => navigate(`/satellite/${satelliteData['details']['norad_id']}`)}
                            sx={{
                                flex: 1,
                                minWidth: 0,
                                fontSize: '0.65rem',
                                textTransform: 'none',
                                color: 'text.secondary',
                                '&:hover': {
                                    color: 'primary.main',
                                    bgcolor: 'transparent'
                                }
                            }}
                        >
                            View Full Details
                        </Button>
                    </Box>
                )}
            </Box>
            <SatelliteEditDialog
                open={satelliteEditDialogOpen}
                onClose={() => setSatelliteEditDialogOpen(false)}
                satelliteData={satelliteDialogData}
                onSaved={handleSatelliteSaved}
            />
            <TransmittersDialog
                open={transmittersDialogOpen}
                onClose={() => setTransmittersDialogOpen(false)}
                title={tSat('satellite_database.edit_transmitters_title', {
                    name: selectedSatelliteName || selectedNoradId || '',
                })}
                satelliteData={satelliteDialogData}
                variant="paper"
                widthOffsetPx={20}
            />
            </>
            )}
        </Box>
    );
}

export default TargetSatelliteInfoIsland;
