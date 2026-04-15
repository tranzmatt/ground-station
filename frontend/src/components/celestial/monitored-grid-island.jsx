import React, { useEffect, useMemo, useState } from 'react';
import { DataGrid, gridClasses } from '@mui/x-data-grid';
import { alpha, darken, lighten, styled } from '@mui/material/styles';
import {
    Box,
    Button,
    Checkbox,
    Dialog,
    DialogActions,
    DialogContent,
    DialogTitle,
    Divider,
    FormControl,
    FormControlLabel,
    FormGroup,
    InputLabel,
    MenuItem,
    Select,
    Typography,
} from '@mui/material';
import { useDispatch, useSelector } from 'react-redux';
import {
    setMonitoredTableColumnVisibility,
    setMonitoredTablePageSize,
    setMonitoredTableSortModel,
    setOpenGridSettingsDialog,
} from './monitored-slice.jsx';

const AU_IN_KM = 149597870.7;
const SECONDS_PER_DAY = 86400;
const AU_PER_DAY_TO_KM_PER_S = AU_IN_KM / SECONDS_PER_DAY;
const LIGHT_TIME_MIN_PER_AU = 8.316746397;

const getPassBackgroundColor = (color, theme, coefficient) => ({
    backgroundColor: darken(color, coefficient),
    ...theme.applyStyles('light', {
        backgroundColor: lighten(color, coefficient),
    }),
});

const StyledDataGrid = styled(DataGrid)(({ theme }) => ({
    '& .MuiDataGrid-row': {
        borderLeft: '3px solid transparent',
    },
    '& .passes-row-live': {
        backgroundColor: alpha(theme.palette.success.main, 0.2),
        borderLeftColor: alpha(theme.palette.success.main, 0.95),
        ...theme.applyStyles('light', {
            backgroundColor: alpha(theme.palette.success.main, 0.1),
            borderLeftColor: alpha(theme.palette.success.main, 0.65),
        }),
    },
    '& .passes-row-upcoming': {
        backgroundColor: alpha(theme.palette.warning.main, 0.14),
        borderLeftColor: alpha(theme.palette.warning.main, 0.9),
        ...theme.applyStyles('light', {
            backgroundColor: alpha(theme.palette.warning.main, 0.08),
            borderLeftColor: alpha(theme.palette.warning.main, 0.6),
        }),
    },
    '& .passes-row-passed': {
        '& .MuiDataGrid-cell': {
            color: theme.palette.text.secondary,
        },
    },
    '& .passes-row-dead': {
        backgroundColor: alpha(theme.palette.error.main, 0.24),
        borderLeftColor: alpha(theme.palette.error.main, 0.9),
        ...theme.applyStyles('light', {
            backgroundColor: alpha(theme.palette.error.main, 0.1),
            borderLeftColor: alpha(theme.palette.error.main, 0.65),
        }),
    },
    '& .passes-cell-passing': {
        ...getPassBackgroundColor(theme.palette.success.main, theme, 0.7),
    },
}));

const formatNumeric = (value, digits = 3) => {
    if (!Number.isFinite(value)) return '-';
    return Number(value).toFixed(digits);
};

const formatLastRefresh = (value) => {
    if (!value) return 'Never';
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return 'Unknown';
    return parsed.toLocaleString();
};

const formatAge = (value, nowMs) => {
    if (!value) return 'Never';
    const parsed = new Date(value).getTime();
    if (!Number.isFinite(parsed)) return 'Unknown';
    const diffSec = Math.max(0, Math.floor((nowMs - parsed) / 1000));
    if (diffSec < 60) return `${diffSec}s`;
    if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m`;
    if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h`;
    return `${Math.floor(diffSec / 86400)}d`;
};

const magnitude3 = (vector) => {
    if (!Array.isArray(vector) || vector.length < 3) return NaN;
    const [x, y, z] = vector;
    if (![x, y, z].every((v) => Number.isFinite(v))) return NaN;
    return Math.sqrt(x * x + y * y + z * z);
};

const computeProjectionSpan = (orbitSampling) => {
    const past = Number(orbitSampling?.past_hours);
    const future = Number(orbitSampling?.future_hours);
    const step = Number(orbitSampling?.step_minutes);
    if (!Number.isFinite(past) || !Number.isFinite(future) || !Number.isFinite(step)) {
        return '-';
    }
    return `${past}h / ${future}h @ ${step}m`;
};

const SettingsDialog = ({ open, onClose }) => {
    const dispatch = useDispatch();
    const columnVisibility = useSelector((state) => state.celestialMonitored.tableColumnVisibility);
    const tablePageSize = useSelector((state) => state.celestialMonitored.tablePageSize);

    const columns = [
        { name: 'displayName', label: 'Name', category: 'identity', alwaysVisible: true },
        { name: 'command', label: 'Horizons Command', category: 'identity', alwaysVisible: true },
        { name: 'source', label: 'Source', category: 'identity' },
        { name: 'sourceMode', label: 'Source Mode', category: 'identity' },
        { name: 'enabled', label: 'Enabled', category: 'state', alwaysVisible: true },
        { name: 'distanceFromSunAu', label: 'Distance from Sun (AU)', category: 'metrics' },
        { name: 'speedKmS', label: 'Speed (km/s)', category: 'metrics' },
        { name: 'lightTimeMinutes', label: 'Light Time (min)', category: 'metrics' },
        { name: 'lastRefreshAt', label: 'Last Refresh', category: 'state' },
        { name: 'lastRefreshAge', label: 'Refresh Age', category: 'state' },
        { name: 'projectionSpan', label: 'Projection Span', category: 'projection' },
        { name: 'cacheStatus', label: 'Cache', category: 'projection' },
        { name: 'stale', label: 'Stale', category: 'projection' },
        { name: 'sampleCount', label: 'Samples', category: 'projection' },
        { name: 'lastError', label: 'Last Error', category: 'state' },
    ];

    const categories = {
        identity: 'Identity',
        state: 'State',
        metrics: 'Metrics',
        projection: 'Projection',
    };

    const columnsByCategory = {
        identity: columns.filter((col) => col.category === 'identity'),
        state: columns.filter((col) => col.category === 'state'),
        metrics: columns.filter((col) => col.category === 'metrics'),
        projection: columns.filter((col) => col.category === 'projection'),
    };

    return (
        <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
            <DialogTitle>Monitored Celestial Table Settings</DialogTitle>
            <DialogContent>
                <Box sx={{ mb: 2 }}>
                    <FormControl fullWidth size="small">
                        <InputLabel id="celestial-table-rows-label">Rows per page</InputLabel>
                        <Select
                            labelId="celestial-table-rows-label"
                            value={tablePageSize}
                            label="Rows per page"
                            onChange={(event) => dispatch(setMonitoredTablePageSize(event.target.value))}
                        >
                            {[5, 10, 15, 20, 25].map((option) => (
                                <MenuItem key={option} value={option}>
                                    {option}
                                </MenuItem>
                            ))}
                        </Select>
                    </FormControl>
                    <Divider sx={{ mt: 2 }} />
                </Box>

                {Object.entries(columnsByCategory).map(([category, cols]) => (
                    <Box key={category} sx={{ mb: 2 }}>
                        <Typography variant="subtitle2" sx={{ fontWeight: 'bold', mb: 1 }}>
                            {categories[category]}
                        </Typography>
                        <FormGroup>
                            {cols.map((column) => (
                                <FormControlLabel
                                    key={column.name}
                                    control={
                                        <Checkbox
                                            checked={column.alwaysVisible || columnVisibility[column.name] !== false}
                                            onChange={() =>
                                                dispatch(
                                                    setMonitoredTableColumnVisibility({
                                                        ...columnVisibility,
                                                        [column.name]: !columnVisibility[column.name],
                                                    }),
                                                )
                                            }
                                            disabled={column.alwaysVisible}
                                        />
                                    }
                                    label={column.label}
                                />
                            ))}
                        </FormGroup>
                        <Divider sx={{ mt: 1 }} />
                    </Box>
                ))}
            </DialogContent>
            <DialogActions>
                <Button onClick={onClose} variant="contained">
                    Close
                </Button>
            </DialogActions>
        </Dialog>
    );
};

const MonitoredCelestialGridIsland = ({ rows = [], loading = false }) => {
    const dispatch = useDispatch();
    const tracks = useSelector((state) => state.celestial?.celestialTracks?.celestial || []);
    const {
        tableColumnVisibility,
        tablePageSize,
        tableSortModel,
        openGridSettingsDialog,
    } = useSelector((state) => state.celestialMonitored);
    const [nowMs, setNowMs] = useState(() => Date.now());
    const [page, setPage] = useState(0);

    useEffect(() => {
        const interval = setInterval(() => setNowMs(Date.now()), 30000);
        return () => clearInterval(interval);
    }, []);

    const trackByCommand = useMemo(() => {
        const entries = Array.isArray(tracks) ? tracks : [];
        return entries.reduce((acc, track) => {
            const key = String(track?.command || '').toLowerCase();
            if (key) acc[key] = track;
            return acc;
        }, {});
    }, [tracks]);

    const enrichedRows = useMemo(
        () =>
            (rows || []).map((row) => {
                const track = trackByCommand[String(row.command || '').toLowerCase()] || {};
                const distanceAu = magnitude3(track.position_xyz_au);
                const speedAuPerDay = magnitude3(track.velocity_xyz_au_per_day);
                const speedKmS = Number.isFinite(speedAuPerDay) ? speedAuPerDay * AU_PER_DAY_TO_KM_PER_S : NaN;
                const lightTimeMin = Number.isFinite(distanceAu) ? distanceAu * LIGHT_TIME_MIN_PER_AU : NaN;
                const sampleCount = Array.isArray(track.orbit_samples_xyz_au) ? track.orbit_samples_xyz_au.length : 0;
                return {
                    ...row,
                    source: track.source || '-',
                    sourceMode: row.sourceMode || row.source_mode || '-',
                    distanceFromSunAu: distanceAu,
                    speedKmS,
                    lightTimeMinutes: lightTimeMin,
                    lastRefreshAge: formatAge(row.lastRefreshAt, nowMs),
                    projectionSpan: computeProjectionSpan(track.orbit_sampling),
                    cacheStatus: track.cache || '-',
                    stale: track.stale ? 'Yes' : 'No',
                    sampleCount,
                };
            }),
        [rows, trackByCommand, nowMs],
    );

    const columns = useMemo(
        () => [
            { field: 'displayName', headerName: 'Name', minWidth: 170, flex: 1 },
            { field: 'command', headerName: 'Horizons Command', minWidth: 170, flex: 1 },
            { field: 'source', headerName: 'Source', minWidth: 110, flex: 0.7 },
            { field: 'sourceMode', headerName: 'Source Mode', minWidth: 120, flex: 0.8 },
            {
                field: 'enabled',
                headerName: 'Enabled',
                minWidth: 90,
                align: 'center',
                headerAlign: 'center',
                valueGetter: (value) => (value ? 'Yes' : 'No'),
            },
            {
                field: 'distanceFromSunAu',
                headerName: 'Distance from Sun (AU)',
                minWidth: 165,
                valueGetter: (value) => formatNumeric(value, 4),
            },
            {
                field: 'speedKmS',
                headerName: 'Speed (km/s)',
                minWidth: 120,
                valueGetter: (value) => formatNumeric(value, 3),
            },
            {
                field: 'lightTimeMinutes',
                headerName: 'Light Time (min)',
                minWidth: 130,
                valueGetter: (value) => formatNumeric(value, 2),
            },
            {
                field: 'lastRefreshAt',
                headerName: 'Last Refresh',
                minWidth: 185,
                valueGetter: (value) => formatLastRefresh(value),
            },
            { field: 'lastRefreshAge', headerName: 'Refresh Age', minWidth: 100 },
            { field: 'projectionSpan', headerName: 'Projection Span', minWidth: 150 },
            { field: 'cacheStatus', headerName: 'Cache', minWidth: 90 },
            { field: 'stale', headerName: 'Stale', minWidth: 80 },
            { field: 'sampleCount', headerName: 'Samples', minWidth: 90, type: 'number' },
            {
                field: 'lastError',
                headerName: 'Last Error',
                minWidth: 250,
                flex: 1.2,
                valueGetter: (value) => value || '-',
            },
        ],
        [],
    );

    return (
        <Box sx={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
            <Box sx={{ width: '100%', flex: 1, minHeight: 0 }}>
                <StyledDataGrid
                    rows={enrichedRows}
                    columns={columns}
                    getRowId={(row) => row.id}
                    loading={loading}
                    density="compact"
                    disableRowSelectionOnClick
                    columnVisibilityModel={tableColumnVisibility}
                    onColumnVisibilityModelChange={(model) => dispatch(setMonitoredTableColumnVisibility(model))}
                    paginationModel={{ pageSize: tablePageSize, page }}
                    onPaginationModelChange={(model) => {
                        setPage(model.page);
                        dispatch(setMonitoredTablePageSize(model.pageSize));
                    }}
                    pageSizeOptions={[5, 10, 15, 20, 25]}
                    sortModel={tableSortModel}
                    onSortModelChange={(model) => dispatch(setMonitoredTableSortModel(model))}
                    getRowClassName={(params) => {
                        if (params.row.lastError && params.row.lastError !== '-') return 'passes-row-dead';
                        if (!params.row.enabled) return 'passes-row-passed';
                        if (params.row.stale === 'Yes') return 'passes-row-upcoming';
                        return 'passes-row-live';
                    }}
                    sx={{
                        border: 0,
                        marginTop: 0,
                        [`& .${gridClasses.cell}:focus, & .${gridClasses.cell}:focus-within`]: {
                            outline: 'none',
                        },
                        [`& .${gridClasses.columnHeader}:focus, & .${gridClasses.columnHeader}:focus-within`]: {
                            outline: 'none',
                        },
                        '& .MuiDataGrid-overlay': {
                            fontSize: '0.875rem',
                            fontStyle: 'italic',
                            color: 'text.secondary',
                        },
                    }}
                />
            </Box>
            <SettingsDialog
                open={openGridSettingsDialog}
                onClose={() => dispatch(setOpenGridSettingsDialog(false))}
            />
        </Box>
    );
};

export default React.memo(MonitoredCelestialGridIsland);
