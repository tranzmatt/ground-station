import * as React from 'react';
import {
    Box,
    Button,
    Chip,
    Divider,
    Dialog,
    DialogActions,
    DialogContent,
    DialogContentText,
    DialogTitle,
    FormControl,
    InputLabel,
    MenuItem,
    Select,
    Stack,
    Typography,
} from '@mui/material';
import { useSelector } from 'react-redux';
import { useTranslation } from 'react-i18next';
import { DEFAULT_TRACKER_ID, resolveTrackerId } from './tracking-constants.js';

const normalizeRotatorId = (candidate) => resolveTrackerId(candidate, '');
const TARGET_SLOT_ID_PATTERN = /^target-(\d+)$/;

const deriveNextTrackerSlotId = (rows = []) => {
    let maxTargetNumber = 0;
    rows.forEach((row) => {
        const trackerId = resolveTrackerId(row?.trackerId, DEFAULT_TRACKER_ID);
        const matched = trackerId.match(TARGET_SLOT_ID_PATTERN);
        if (!matched) {
            return;
        }
        const parsedNumber = Number(matched[1]);
        if (Number.isFinite(parsedNumber) && parsedNumber > maxTargetNumber) {
            maxTargetNumber = parsedNumber;
        }
    });
    return `target-${Math.max(1, maxTargetNumber + 1)}`;
};

export function useTargetRotatorSelectionDialog() {
    const { t } = useTranslation('target');
    const rotators = useSelector((state) => state.rotators?.rotators || []);
    const trackerInstances = useSelector((state) => state.trackerInstances?.instances || []);
    const selectedRotator = useSelector((state) => state.targetSatTrack?.selectedRotator || 'none');
    const trackerViews = useSelector((state) => state.targetSatTrack?.trackerViews || {});

    const [open, setOpen] = React.useState(false);
    const [pendingSatelliteName, setPendingSatelliteName] = React.useState('');
    const [pendingRotatorId, setPendingRotatorId] = React.useState('');
    const resolverRef = React.useRef(null);

    const closeWithResult = React.useCallback((result) => {
        const resolve = resolverRef.current;
        resolverRef.current = null;
        setOpen(false);
        setPendingSatelliteName('');
        setPendingRotatorId('');
        if (typeof resolve === 'function') {
            resolve(result);
        }
    }, []);

    const requestRotatorForTarget = React.useCallback((satelliteName = '') => {
        return new Promise((resolve) => {
            const initialRotatorId = normalizeRotatorId(selectedRotator);
            resolverRef.current = resolve;
            setPendingSatelliteName(satelliteName || '');
            setPendingRotatorId(initialRotatorId);
            setOpen(true);
        });
    }, [selectedRotator]);

    const canConfirm = pendingRotatorId !== '';
    const rotatorNameById = React.useMemo(() => {
        const mapping = {};
        rotators.forEach((rotator) => {
            mapping[String(rotator.id)] = rotator.name;
        });
        return mapping;
    }, [rotators]);

    const usageRows = React.useMemo(() => {
        return trackerInstances
            .map((instance, index) => {
                const trackerId = String(instance?.tracker_id || '');
                if (!trackerId) {
                    return null;
                }
                const targetNumber = Number(instance?.target_number || (index + 1));
                const trackingState = instance?.tracking_state || {};
                const rotatorId = String(instance?.rotator_id || trackingState?.rotator_id || 'none');
                const noradId = trackingState?.norad_id ?? null;
                const groupId = trackingState?.group_id ?? null;
                const trackerView = trackerViews?.[trackerId] || {};
                const viewRotatorData = trackerView?.rotatorData || {};
                const viewTrackingState = trackerView?.trackingState || trackingState || {};

                let statusLabel = 'unknown';
                let statusColor = 'default';
                if (!rotatorId || rotatorId === 'none') {
                    statusLabel = 'unassigned';
                    statusColor = 'default';
                } else if (
                    viewRotatorData?.connected === false
                    || viewTrackingState?.rotator_state === 'disconnected'
                ) {
                    statusLabel = 'disconnected';
                    statusColor = 'error';
                } else if (
                    viewRotatorData?.tracking === true
                    || viewTrackingState?.rotator_state === 'tracking'
                ) {
                    statusLabel = 'tracking';
                    statusColor = 'success';
                } else if (viewRotatorData?.slewing === true) {
                    statusLabel = 'slewing';
                    statusColor = 'warning';
                } else if (
                    viewRotatorData?.parked === true
                    || viewTrackingState?.rotator_state === 'parked'
                ) {
                    statusLabel = 'parked';
                    statusColor = 'warning';
                } else if (
                    viewRotatorData?.stopped === true
                    || viewTrackingState?.rotator_state === 'stopped'
                ) {
                    statusLabel = 'stopped';
                    statusColor = 'info';
                } else if (
                    viewRotatorData?.connected === true
                    || viewTrackingState?.rotator_state === 'connected'
                ) {
                    statusLabel = 'connected';
                    statusColor = 'success';
                }

                return {
                    trackerId,
                    targetNumber,
                    rotatorId,
                    rotatorName: rotatorNameById[rotatorId] || null,
                    noradId,
                    groupId,
                    isAlive: Boolean(instance?.is_alive),
                    statusLabel,
                    statusColor,
                };
            })
            .filter(Boolean)
            .sort((a, b) => a.targetNumber - b.targetNumber);
    }, [trackerInstances, rotatorNameById, trackerViews]);
    const usageByRotatorId = React.useMemo(() => {
        const mapping = {};
        usageRows.forEach((row) => {
            if (!row.rotatorId || row.rotatorId === 'none') {
                return;
            }
            if (!mapping[row.rotatorId]) {
                mapping[row.rotatorId] = [];
            }
            mapping[row.rotatorId].push(row);
        });
        return mapping;
    }, [usageRows]);

    const resolveTrackerIdForRotator = React.useCallback((rotatorId) => {
        const normalizedRotatorId = normalizeRotatorId(rotatorId);
        if (!normalizedRotatorId) {
            return DEFAULT_TRACKER_ID;
        }
        const rotatorUsage = usageByRotatorId[normalizedRotatorId] || [];
        if (rotatorUsage.length > 0) {
            return resolveTrackerId(rotatorUsage[0]?.trackerId, DEFAULT_TRACKER_ID);
        }
        const unassignedTracker = usageRows.find((row) => !row.rotatorId || row.rotatorId === 'none');
        if (unassignedTracker?.trackerId) {
            return resolveTrackerId(unassignedTracker.trackerId, DEFAULT_TRACKER_ID);
        }
        // If no existing assignment and no idle slot exists, allocate next slot id.
        return deriveNextTrackerSlotId(usageRows);
    }, [usageByRotatorId, usageRows]);

    const dialog = (
        <Dialog
            open={open}
            onClose={() => closeWithResult(null)}
            fullWidth
            maxWidth="sm"
            PaperProps={{
                sx: {
                    bgcolor: 'background.paper',
                    border: (theme) => `1px solid ${theme.palette.divider}`,
                    borderRadius: 2,
                },
            }}
        >
            <DialogTitle
                sx={{
                    bgcolor: (theme) => theme.palette.mode === 'dark' ? 'grey.900' : 'grey.100',
                    borderBottom: (theme) => `1px solid ${theme.palette.divider}`,
                    fontSize: '1.25rem',
                    fontWeight: 'bold',
                    py: 2.5,
                }}
            >
                {t('target_rotator_dialog.title', { defaultValue: 'Select Rotator' })}
            </DialogTitle>
            <DialogContent sx={{ bgcolor: 'background.paper', px: 3, py: 3 }}>
                <DialogContentText sx={{ mb: 2, mt: 1 }}>
                    {t('target_rotator_dialog.description', {
                        defaultValue: 'Choose the rotator that will handle tracking for {{satellite}}.',
                        satellite: pendingSatelliteName || t('target_rotator_dialog.this_satellite', { defaultValue: 'this satellite' }),
                    })}
                </DialogContentText>
                <FormControl fullWidth size="small">
                    <InputLabel id="target-rotator-select-label">
                        {t('target_rotator_dialog.rotator_label', { defaultValue: 'Rotator' })}
                    </InputLabel>
                    <Select
                        labelId="target-rotator-select-label"
                        value={pendingRotatorId}
                        label={t('target_rotator_dialog.rotator_label', { defaultValue: 'Rotator' })}
                        onChange={(event) => setPendingRotatorId(normalizeRotatorId(event.target.value))}
                    >
                        {rotators.map((rotator) => {
                            const rotatorUsage = usageByRotatorId[String(rotator.id)] || [];
                            const usageSummary = rotatorUsage.length
                                ? rotatorUsage
                                    .map((row) => `T${row.targetNumber}${row.noradId ? `→${row.noradId}` : ''}`)
                                    .join(', ')
                                : 'unassigned';
                            const statusSummary = rotatorUsage.length
                                ? rotatorUsage
                                    .map((row) => `T${row.targetNumber}:${row.statusLabel}`)
                                    .join(' | ')
                                : 'available';
                            const statusColor = rotatorUsage.length === 1
                                ? (rotatorUsage[0].statusColor || 'default')
                                : 'default';
                            return (
                                <MenuItem key={rotator.id} value={rotator.id} sx={{ alignItems: 'flex-start', py: 0.75 }}>
                                    <Box sx={{ display: 'flex', flexDirection: 'column', lineHeight: 1.2, width: '100%' }}>
                                        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
                                            <Typography variant="body2" sx={{ fontWeight: 600 }}>
                                                {rotator.name}
                                            </Typography>
                                            <Chip
                                                size="small"
                                                color={statusColor}
                                                variant="outlined"
                                                label={statusSummary}
                                                sx={{ height: 18, '& .MuiChip-label': { px: 0.7, fontSize: '0.62rem' } }}
                                            />
                                        </Box>
                                        <Typography variant="caption" color="text.secondary">
                                            {`${rotator.host}:${rotator.port} • ${usageSummary}`}
                                        </Typography>
                                    </Box>
                                </MenuItem>
                            );
                        })}
                    </Select>
                </FormControl>
                {rotators.length === 0 && (
                    <DialogContentText sx={{ mt: 2 }} color="warning.main">
                        {t('target_rotator_dialog.no_rotators', {
                            defaultValue: 'No rotators configured. Add a rotator first to set a target.',
                        })}
                    </DialogContentText>
                )}
                {usageRows.length > 0 && (
                    <Box sx={{ mt: 2 }}>
                        <Divider sx={{ mb: 1.5 }} />
                        <Typography variant="subtitle2" sx={{ mb: 1, fontWeight: 700 }}>
                            {t('target_rotator_dialog.usage_overview', { defaultValue: 'Current Usage' })}
                        </Typography>
                        <Stack spacing={0.7}>
                            {usageRows.map((row) => {
                                const isSelectedRotator = pendingRotatorId && row.rotatorId === pendingRotatorId;
                                return (
                                    <Box
                                        key={row.trackerId}
                                        sx={{
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'space-between',
                                            px: 1,
                                            py: 0.6,
                                            borderRadius: 1,
                                            bgcolor: isSelectedRotator ? 'action.selected' : 'action.hover',
                                        }}
                                    >
                                        <Typography variant="body2" sx={{ minWidth: 72, fontWeight: 700 }}>
                                            {`Target ${row.targetNumber}`}
                                        </Typography>
                                        <Typography
                                            variant="caption"
                                            sx={{
                                                flex: 1,
                                                mx: 1,
                                                whiteSpace: 'nowrap',
                                                overflow: 'hidden',
                                                textOverflow: 'ellipsis',
                                            }}
                                        >
                                            {row.rotatorId && row.rotatorId !== 'none'
                                                ? `${row.rotatorName || row.rotatorId} (${row.rotatorId.slice(0, 6)})`
                                                : 'No rotator'}
                                        </Typography>
                                        <Chip
                                            size="small"
                                            variant="outlined"
                                            color={row.noradId ? 'success' : 'default'}
                                            label={row.noradId ? `SAT ${row.noradId}` : 'No target'}
                                            sx={{ height: 20, '& .MuiChip-label': { px: 0.8, fontSize: '0.68rem' } }}
                                        />
                                    </Box>
                                );
                            })}
                        </Stack>
                    </Box>
                )}
            </DialogContent>
            <DialogActions
                sx={{
                    bgcolor: (theme) => theme.palette.mode === 'dark' ? 'grey.900' : 'grey.100',
                    borderTop: (theme) => `1px solid ${theme.palette.divider}`,
                    px: 3,
                    py: 2.5,
                    gap: 1.5,
                }}
            >
                <Button
                    variant="outlined"
                    onClick={() => closeWithResult(null)}
                    sx={{
                        borderColor: (theme) => theme.palette.mode === 'dark' ? 'grey.700' : 'grey.400',
                        '&:hover': {
                            borderColor: (theme) => theme.palette.mode === 'dark' ? 'grey.600' : 'grey.500',
                            bgcolor: (theme) => theme.palette.mode === 'dark' ? 'grey.800' : 'grey.200',
                        },
                    }}
                >
                    {t('target_rotator_dialog.cancel', { defaultValue: 'Cancel' })}
                </Button>
                <Button
                    color="success"
                    variant="contained"
                    disabled={!canConfirm}
                    onClick={() =>
                        closeWithResult({
                            rotatorId: pendingRotatorId,
                            trackerId: resolveTrackerIdForRotator(pendingRotatorId),
                        })
                    }
                >
                    {t('target_rotator_dialog.confirm', { defaultValue: 'Set Target' })}
                </Button>
            </DialogActions>
        </Dialog>
    );

    return { requestRotatorForTarget, dialog };
}
