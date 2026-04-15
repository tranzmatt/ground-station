import React, { useMemo, useEffect, useCallback, useState } from 'react';
import {
    Autocomplete,
    Box,
    Button,
    Chip,
    FormControl,
    InputLabel,
    Dialog,
    DialogActions,
    DialogContent,
    DialogTitle,
    MenuItem,
    Select,
    Stack,
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableRow,
    ToggleButton,
    ToggleButtonGroup,
    TextField,
    Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import ListAltIcon from '@mui/icons-material/ListAlt';
import RefreshIcon from '@mui/icons-material/Refresh';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import { useDispatch, useSelector } from 'react-redux';
import { useSocket } from '../common/socket.jsx';
import {
    closeAddDialog,
    closeManageDialog,
    createMonitoredCelestial,
    deleteMonitoredCelestial,
    fetchMonitoredCelestial,
    openAddDialog,
    openManageDialog,
    setMonitoredFormError,
    setMonitoredFormField,
    setSelectedMonitoredIds,
    toggleMonitoredCelestialEnabled,
    updateMonitoredCelestial,
} from './monitored-slice.jsx';
import { refreshMonitoredCelestialNow } from './celestial-slice.jsx';

const STALE_MS = 5 * 60 * 1000;
const HOUR_OPTIONS = [
    { value: 6, label: '6h' },
    { value: 12, label: '12h' },
    { value: 24, label: '1d' },
    { value: 72, label: '3d' },
    { value: 168, label: '7d' },
    { value: 336, label: '14d' },
    { value: 720, label: '1mo' },
    { value: 2160, label: '3mo' },
    { value: 4320, label: '6mo' },
    { value: 8760, label: '1y' },
];

const getStatusMeta = (entry) => {
    if (entry?.lastError) {
        return { label: 'Error', color: 'error' };
    }

    if (!entry?.lastRefreshAt) {
        return { label: 'Stale', color: 'warning' };
    }

    const ageMs = Date.now() - new Date(entry.lastRefreshAt).getTime();
    if (Number.isNaN(ageMs) || ageMs > STALE_MS) {
        return { label: 'Stale', color: 'warning' };
    }

    return { label: 'OK', color: 'success' };
};

const formatLastRefresh = (value) => {
    if (!value) {
        return 'Never';
    }

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        return 'Unknown';
    }

    return date.toLocaleString();
};

const CelestialTopBar = ({
    projectionPastHours = 24,
    projectionFutureHours = 24,
    onProjectionPastHoursChange,
    onProjectionFutureHoursChange,
}) => {
    const dispatch = useDispatch();
    const { socket } = useSocket();
    const monitoredState = useSelector((state) => state.celestialMonitored);
    const celestialLoading = useSelector((state) => state.celestial?.tracksLoading);
    const {
        monitored,
        selectedIds,
        addDialogOpen,
        manageDialogOpen,
        form,
        formError,
        saveLoading,
    } = monitoredState;

    const [editDialogOpen, setEditDialogOpen] = useState(false);
    const [editError, setEditError] = useState('');
    const [editForm, setEditForm] = useState({ id: '', displayName: '', command: '', enabled: true });
    const [addMode, setAddMode] = useState('catalog');
    const [catalogLoading, setCatalogLoading] = useState(false);
    const [catalogError, setCatalogError] = useState('');
    const [catalogEntries, setCatalogEntries] = useState([]);
    const [selectedCatalogEntry, setSelectedCatalogEntry] = useState(null);
    const [addFeedback, setAddFeedback] = useState('');

    const monitoredCount = monitored.length;

    const monitoredOptions = useMemo(
        () =>
            monitored.map((entry) => ({
                id: entry.id,
                label: entry.displayName,
                command: entry.command,
            })),
        [monitored],
    );

    const enabledCount = useMemo(
        () => monitored.filter((entry) => entry.enabled).length,
        [monitored],
    );

    useEffect(() => {
        if (!socket) {
            return undefined;
        }

        const fetchData = () => dispatch(fetchMonitoredCelestial({ socket }));
        fetchData();

        socket.on('connect', fetchData);
        return () => {
            socket.off('connect', fetchData);
        };
    }, [socket, dispatch]);

    useEffect(() => {
        if (!addDialogOpen || !socket) {
            return;
        }

        let active = true;
        setCatalogLoading(true);
        setCatalogError('');
        socket.emit('data_request', 'get-spacecraft-index', { limit: 1000 }, (response) => {
            if (!active) {
                return;
            }
            if (response?.success) {
                setCatalogEntries(response.data || []);
            } else {
                setCatalogEntries([]);
                setCatalogError(response?.error || 'Failed to load spacecraft catalog.');
            }
            setCatalogLoading(false);
        });

        return () => {
            active = false;
        };
    }, [addDialogOpen, socket]);

    useEffect(() => {
        if (addDialogOpen) {
            return;
        }
        setSelectedCatalogEntry(null);
        setCatalogError('');
        setAddFeedback('');
        setAddMode('catalog');
    }, [addDialogOpen]);

    const handleAdd = async () => {
        setAddFeedback('');
        if (!socket) {
            dispatch(setMonitoredFormError('Socket connection is not available.'));
            return;
        }

        const name = form.displayName.trim();
        const cmd = form.command.trim();
        if (!name || !cmd) {
            dispatch(setMonitoredFormError('Display name and command are required.'));
            return;
        }

        const exists = monitored.some((entry) => entry.command.toLowerCase() === cmd.toLowerCase());
        if (exists) {
            dispatch(setMonitoredFormError('This command is already in the monitored list.'));
            return;
        }

        if (addMode === 'catalog' && !selectedCatalogEntry) {
            dispatch(setMonitoredFormError('Select a spacecraft from the static catalog.'));
            return;
        }

        await dispatch(
            createMonitoredCelestial({
                socket,
                entry: {
                    displayName: name,
                    command: cmd,
                    enabled: true,
                    sourceMode: addMode,
                },
            }),
        );
        setAddFeedback(`Added "${name}" using command "${cmd}".`);
        setSelectedCatalogEntry(null);
    };

    const handleRefreshAll = useCallback(async () => {
        if (!socket || celestialLoading) {
            return;
        }

        await dispatch(
            refreshMonitoredCelestialNow({
                socket,
                ids: [],
                payload: {
                    past_hours: Number(projectionPastHours) || 24,
                    future_hours: Number(projectionFutureHours) || 24,
                    step_minutes: 60,
                },
            }),
        );
        await dispatch(fetchMonitoredCelestial({ socket }));
    }, [
        socket,
        celestialLoading,
        dispatch,
        projectionPastHours,
        projectionFutureHours,
    ]);

    const handleOpenEdit = (entry) => {
        setEditForm({
            id: entry.id,
            displayName: entry.displayName,
            command: entry.command,
            enabled: entry.enabled,
        });
        setEditError('');
        setEditDialogOpen(true);
    };

    const handleSaveEdit = async () => {
        if (!socket) {
            setEditError('Socket connection is not available.');
            return;
        }

        const name = editForm.displayName.trim();
        const cmd = editForm.command.trim();
        if (!name || !cmd) {
            setEditError('Display name and command are required.');
            return;
        }

        const exists = monitored.some(
            (entry) => entry.id !== editForm.id && entry.command.toLowerCase() === cmd.toLowerCase(),
        );
        if (exists) {
            setEditError('This command is already in the monitored list.');
            return;
        }

        const result = await dispatch(
            updateMonitoredCelestial({
                socket,
                entry: {
                    id: editForm.id,
                    displayName: name,
                    command: cmd,
                    enabled: editForm.enabled,
                },
            }),
        );

        if (result.meta.requestStatus === 'fulfilled') {
            setEditDialogOpen(false);
            setEditError('');
            return;
        }

        setEditError(result.payload || result.error?.message || 'Failed to update monitored target.');
    };

    const selectedOptions = monitoredOptions.filter((option) => selectedIds.includes(option.id));

    return (
        <>
            <Box
                sx={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 1.5,
                    px: 1.5,
                    py: 1,
                    bgcolor: 'background.paper',
                    borderBottom: '1px solid',
                    borderColor: 'border.main',
                    minHeight: '64px',
                }}
            >
                <Autocomplete
                    multiple
                    size="small"
                    options={monitoredOptions}
                    value={selectedOptions}
                    onChange={(event, value) => dispatch(setSelectedMonitoredIds(value.map((v) => v.id)))}
                    isOptionEqualToValue={(opt, val) => opt.id === val.id}
                    getOptionLabel={(option) => option.label}
                    renderTags={(tagValue, getTagProps) =>
                        tagValue.map((option, index) => (
                            <Chip
                                {...getTagProps({ index })}
                                key={option.id}
                                label={option.label}
                                size="small"
                            />
                        ))
                    }
                    renderInput={(params) => (
                        <TextField {...params} placeholder="Select monitored targets" />
                    )}
                    sx={{ flex: 1, minWidth: 260 }}
                />

                <Stack direction="row" spacing={1} alignItems="center">
                    <Stack direction="row" spacing={0.5} alignItems="center">
                        <Typography variant="caption" color="text.secondary" sx={{ fontFamily: 'monospace' }}>
                            Past
                        </Typography>
                        <FormControl size="small" sx={{ minWidth: 84 }}>
                            <Select
                                value={projectionPastHours}
                                onChange={(event) => onProjectionPastHoursChange?.(Number(event.target.value))}
                                disabled={!socket || celestialLoading}
                            >
                                {HOUR_OPTIONS.map((option) => (
                                    <MenuItem key={`past-${option.value}`} value={option.value}>
                                        {option.label}
                                    </MenuItem>
                                ))}
                            </Select>
                        </FormControl>
                    </Stack>
                    <Stack direction="row" spacing={0.5} alignItems="center">
                        <Typography variant="caption" color="text.secondary" sx={{ fontFamily: 'monospace' }}>
                            Future
                        </Typography>
                        <FormControl size="small" sx={{ minWidth: 84 }}>
                            <Select
                                value={projectionFutureHours}
                                onChange={(event) => onProjectionFutureHoursChange?.(Number(event.target.value))}
                                disabled={!socket || celestialLoading}
                            >
                                {HOUR_OPTIONS.map((option) => (
                                    <MenuItem key={`future-${option.value}`} value={option.value}>
                                        {option.label}
                                    </MenuItem>
                                ))}
                            </Select>
                        </FormControl>
                    </Stack>
                </Stack>

                <Stack direction="row" spacing={1}>
                    <Button
                        size="small"
                        variant="outlined"
                        startIcon={<AddIcon />}
                        onClick={() => dispatch(openAddDialog())}
                        disabled={!socket || celestialLoading}
                    >
                        Add
                    </Button>
                    <Button
                        size="small"
                        variant="outlined"
                        startIcon={<ListAltIcon />}
                        onClick={() => dispatch(openManageDialog())}
                    >
                        Manage
                    </Button>
                    <Button
                        size="small"
                        variant="outlined"
                        startIcon={<RefreshIcon />}
                        disabled={!socket || celestialLoading || enabledCount === 0}
                        onClick={handleRefreshAll}
                    >
                        Refresh All
                    </Button>
                </Stack>
            </Box>

            <Dialog open={addDialogOpen} onClose={() => dispatch(closeAddDialog())} maxWidth="sm" fullWidth>
                <DialogTitle>Add Monitored Celestial Target</DialogTitle>
                <DialogContent>
                    <Stack spacing={2} sx={{ pt: 1 }}>
                        <ToggleButtonGroup
                            color="primary"
                            exclusive
                            size="small"
                            value={addMode}
                            onChange={(event, value) => {
                                if (!value) return;
                                setAddMode(value);
                                dispatch(setMonitoredFormError(''));
                                setAddFeedback('');
                            }}
                        >
                            <ToggleButton value="catalog">Static Catalog</ToggleButton>
                            <ToggleButton value="exact">Exact Command</ToggleButton>
                        </ToggleButtonGroup>

                        {addMode === 'catalog' ? (
                            <FormControl size="small" fullWidth>
                                <InputLabel id="catalog-spacecraft-select-label">
                                    Static spacecraft list
                                </InputLabel>
                                <Select
                                    labelId="catalog-spacecraft-select-label"
                                    label="Static spacecraft list"
                                    value={selectedCatalogEntry?.id || ''}
                                    onChange={(event) => {
                                        const value = String(event.target.value || '');
                                        const entry = catalogEntries.find((item) => item.id === value) || null;
                                        setSelectedCatalogEntry(entry);
                                        setAddFeedback('');
                                        dispatch(setMonitoredFormError(''));
                                        if (entry) {
                                            dispatch(setMonitoredFormField({ field: 'displayName', value: entry.display_name || '' }));
                                            dispatch(setMonitoredFormField({ field: 'command', value: entry.command || '' }));
                                        }
                                    }}
                                >
                                    {catalogEntries.map((entry) => (
                                        <MenuItem key={entry.id} value={entry.id}>
                                            <Stack spacing={0} sx={{ width: '100%' }}>
                                                <Typography variant="body2">{entry.display_name}</Typography>
                                                <Typography
                                                    variant="caption"
                                                    color="text.secondary"
                                                    sx={{ fontFamily: 'monospace' }}
                                                >
                                                    {entry.command}{entry.agency ? ` · ${entry.agency}` : ''}
                                                </Typography>
                                            </Stack>
                                        </MenuItem>
                                    ))}
                                </Select>
                            </FormControl>
                        ) : (
                            <Typography variant="caption" color="text.secondary">
                                Manual mode: provide exact Horizons command string.
                            </Typography>
                        )}
                        {catalogLoading ? (
                            <Typography variant="caption" color="text.secondary">
                                Loading spacecraft catalog...
                            </Typography>
                        ) : null}

                        {addMode === 'catalog' ? (
                            <TextField
                                label="Display Name"
                                value={form.displayName}
                                disabled
                                fullWidth
                                size="small"
                            />
                        ) : null}
                        <TextField
                            label="Horizons Command"
                            value={form.command}
                            disabled={addMode === 'catalog'}
                            onChange={(event) =>
                                {
                                    const nextValue = event.target.value;
                                    dispatch(setMonitoredFormField({ field: 'command', value: nextValue }));
                                    if (addMode === 'exact') {
                                        dispatch(setMonitoredFormField({ field: 'displayName', value: nextValue }));
                                    }
                                }
                            }
                            fullWidth
                            size="small"
                        />
                        {catalogError ? (
                            <Typography variant="body2" color="error">
                                {catalogError}
                            </Typography>
                        ) : null}
                        {formError ? (
                            <Typography variant="body2" color="error">
                                {formError}
                            </Typography>
                        ) : null}
                        {addFeedback ? (
                            <Typography variant="body2" color="success.main">
                                {addFeedback}
                            </Typography>
                        ) : null}
                    </Stack>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => dispatch(closeAddDialog())}>Cancel</Button>
                    <Button onClick={handleAdd} variant="contained" disabled={saveLoading || !socket || celestialLoading}>
                        Add
                    </Button>
                </DialogActions>
            </Dialog>

            <Dialog
                open={manageDialogOpen}
                onClose={() => dispatch(closeManageDialog())}
                maxWidth="lg"
                fullWidth
            >
                <DialogTitle>Manage Monitored Celestial Targets</DialogTitle>
                <DialogContent>
                    <Table size="small">
                        <TableHead>
                            <TableRow>
                                <TableCell>Display Name</TableCell>
                                <TableCell>Horizons Command</TableCell>
                                <TableCell>Status</TableCell>
                                <TableCell>Last Refresh</TableCell>
                                <TableCell>Enabled</TableCell>
                            </TableRow>
                        </TableHead>
                        <TableBody>
                            {monitored.length ? (
                                monitored.map((entry) => {
                                    const statusMeta = getStatusMeta(entry);
                                    return (
                                        <TableRow key={entry.id}>
                                            <TableCell>{entry.displayName}</TableCell>
                                            <TableCell>{entry.command}</TableCell>
                                            <TableCell>
                                                <Chip
                                                    size="small"
                                                    color={statusMeta.color}
                                                    label={statusMeta.label}
                                                    variant="outlined"
                                                />
                                            </TableCell>
                                            <TableCell>
                                                <Typography variant="caption" sx={{ fontFamily: 'monospace' }}>
                                                    {formatLastRefresh(entry.lastRefreshAt)}
                                                </Typography>
                                                {entry.lastError ? (
                                                    <Typography variant="caption" color="error" sx={{ display: 'block' }}>
                                                        {entry.lastError}
                                                    </Typography>
                                                ) : null}
                                            </TableCell>
                                            <TableCell>
                                                <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
                                                    <Button
                                                        size="small"
                                                        variant="text"
                                                        onClick={() =>
                                                            socket && dispatch(toggleMonitoredCelestialEnabled({
                                                                socket,
                                                                id: entry.id,
                                                                enabled: !entry.enabled,
                                                            }))
                                                        }
                                                        disabled={!socket || celestialLoading}
                                                    >
                                                        {entry.enabled ? 'Enabled' : 'Disabled'}
                                                    </Button>
                                                    <Button
                                                        size="small"
                                                        startIcon={<EditIcon />}
                                                        onClick={() => handleOpenEdit(entry)}
                                                        disabled={!socket || celestialLoading}
                                                    >
                                                        Edit
                                                    </Button>
                                                    <Button
                                                        size="small"
                                                        color="error"
                                                        startIcon={<DeleteOutlineIcon />}
                                                        onClick={() =>
                                                            socket && dispatch(deleteMonitoredCelestial({
                                                                socket,
                                                                ids: [entry.id],
                                                            }))
                                                        }
                                                        disabled={!socket || celestialLoading}
                                                    >
                                                        Delete
                                                    </Button>
                                                </Stack>
                                            </TableCell>
                                        </TableRow>
                                    );
                                })
                            ) : (
                                <TableRow>
                                    <TableCell colSpan={5}>
                                        <Typography variant="body2" color="text.secondary">
                                            No monitored celestial targets yet.
                                        </Typography>
                                    </TableCell>
                                </TableRow>
                            )}
                        </TableBody>
                    </Table>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => dispatch(closeManageDialog())}>Close</Button>
                </DialogActions>
            </Dialog>

            <Dialog open={editDialogOpen} onClose={() => setEditDialogOpen(false)} maxWidth="sm" fullWidth>
                <DialogTitle>Edit Monitored Celestial Target</DialogTitle>
                <DialogContent>
                    <Stack spacing={2} sx={{ pt: 1 }}>
                        <TextField
                            label="Display Name"
                            value={editForm.displayName}
                            onChange={(event) =>
                                setEditForm((prev) => ({ ...prev, displayName: event.target.value }))
                            }
                            fullWidth
                            size="small"
                        />
                        <TextField
                            label="Horizons Command"
                            value={editForm.command}
                            onChange={(event) =>
                                setEditForm((prev) => ({ ...prev, command: event.target.value }))
                            }
                            fullWidth
                            size="small"
                        />
                        {editError ? (
                            <Typography variant="body2" color="error">
                                {editError}
                            </Typography>
                        ) : null}
                    </Stack>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setEditDialogOpen(false)}>Cancel</Button>
                    <Button
                        onClick={handleSaveEdit}
                        variant="contained"
                        disabled={saveLoading || !socket || celestialLoading}
                    >
                        Save
                    </Button>
                </DialogActions>
            </Dialog>
        </>
    );
};

export default React.memo(CelestialTopBar);
