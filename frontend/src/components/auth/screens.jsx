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

import * as React from 'react';
import {
    Alert,
    Box,
    Button,
    Card,
    CardContent,
    CircularProgress,
    Dialog,
    DialogContent,
    DialogTitle,
    Stack,
    TextField,
    Typography,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import { useDispatch, useSelector } from 'react-redux';

import { GroundStationLogoGreenBlue } from '../common/dataurl-icons.jsx';
import { useSocket } from '../common/socket.jsx';
import { fetchLocationForUserId } from '../settings/location-slice.jsx';
import LocationPage from '../settings/location-form.jsx';
import { loginUser, setupAdmin } from './auth-slice.jsx';

const shellSx = {
    minHeight: '100vh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    p: 2.5,
    bgcolor: 'background.default',
};

const cardSx = {
    width: '100%',
    maxWidth: 500,
    border: (theme) => `1px solid ${theme.palette.border?.main || theme.palette.divider}`,
    boxShadow: (theme) =>
        theme.palette.mode === 'dark'
            ? '0 20px 46px rgba(0, 0, 0, 0.42)'
            : '0 20px 46px rgba(15, 23, 42, 0.16)',
};

const stationPanelSx = {
    p: 1.25,
    borderRadius: 1,
    border: (theme) => `1px solid ${theme.palette.divider}`,
    backgroundColor: (theme) =>
        alpha(theme.palette.primary.main, theme.palette.mode === 'dark' ? 0.14 : 0.08),
};

function normalizeStationIdentity(station) {
    if (!station || typeof station !== 'object') {
        return { name: null, callsign: null };
    }
    const name = String(station.name || '').trim() || null;
    const callsign = String(station.callsign || '').trim().toUpperCase() || null;
    return { name, callsign };
}

function StationIdentityPanel({ station }) {
    const { name, callsign } = normalizeStationIdentity(station);
    if (!name && !callsign) {
        return null;
    }

    return (
        <Box sx={stationPanelSx}>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.25 }}>
                Ground Station
            </Typography>
            {name && (
                <Typography variant="body2" fontWeight={600}>
                    {name}
                </Typography>
            )}
            {callsign && (
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                    Callsign: {callsign}
                </Typography>
            )}
        </Box>
    );
}

function AuthCardHeader({ title, description }) {
    return (
        <Stack direction="row" spacing={1.5} alignItems="center">
            <Box
                component="img"
                src={GroundStationLogoGreenBlue}
                alt="Ground Station"
                sx={{ width: 44, height: 44, objectFit: 'contain' }}
            />
            <Box>
                <Typography variant="h5" fontWeight={650}>
                    {title}
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mt: 0.35 }}>
                    {description}
                </Typography>
            </Box>
        </Stack>
    );
}

function AdminRegistrationForm({ title, description, station }) {
    const dispatch = useDispatch();
    const { loadingAction, error } = useSelector((state) => state.auth);

    const [username, setUsername] = React.useState('');
    const [password, setPassword] = React.useState('');
    const [confirmPassword, setConfirmPassword] = React.useState('');
    const [localError, setLocalError] = React.useState('');

    const handleSubmit = async (event) => {
        event.preventDefault();
        setLocalError('');

        if (!username.trim()) {
            setLocalError('Username is required.');
            return;
        }
        if (password.length < 8) {
            setLocalError('Password must be at least 8 characters long.');
            return;
        }
        if (password !== confirmPassword) {
            setLocalError('Passwords do not match.');
            return;
        }

        await dispatch(
            setupAdmin({
                username: username.trim(),
                password,
            })
        );
    };

    return (
        <Card sx={cardSx}>
            <CardContent sx={{ p: 3 }}>
                <Stack spacing={2}>
                    <AuthCardHeader title={title} description={description} />
                    <StationIdentityPanel station={station} />

                    {(localError || error) && (
                        <Alert severity="error">{localError || error}</Alert>
                    )}

                    <Box component="form" onSubmit={handleSubmit}>
                        <Stack spacing={2}>
                            <TextField
                                label="Username"
                                value={username}
                                onChange={(event) => setUsername(event.target.value)}
                                required
                                autoComplete="username"
                            />
                            <TextField
                                label="Password"
                                type="password"
                                value={password}
                                onChange={(event) => setPassword(event.target.value)}
                                required
                                autoComplete="new-password"
                            />
                            <TextField
                                label="Confirm password"
                                type="password"
                                value={confirmPassword}
                                onChange={(event) => setConfirmPassword(event.target.value)}
                                required
                                autoComplete="new-password"
                            />
                            <Button type="submit" variant="contained" disabled={loadingAction}>
                                {loadingAction ? 'Creating account...' : 'Create Admin Account'}
                            </Button>
                        </Stack>
                    </Box>
                </Stack>
            </CardContent>
        </Card>
    );
}

export function LoginScreen() {
    const dispatch = useDispatch();
    const { loadingAction, error, station } = useSelector((state) => state.auth);

    const [username, setUsername] = React.useState('');
    const [password, setPassword] = React.useState('');
    const [localError, setLocalError] = React.useState('');

    const handleSubmit = async (event) => {
        event.preventDefault();
        setLocalError('');

        if (!username.trim() || !password) {
            setLocalError('Username and password are required.');
            return;
        }

        await dispatch(
            loginUser({
                username: username.trim(),
                password,
            })
        );
    };

    return (
        <Box sx={shellSx}>
            <Card sx={cardSx}>
                <CardContent sx={{ p: 3 }}>
                    <Stack spacing={2}>
                        <AuthCardHeader
                            title="Sign In"
                            description="Authentication is required to use this Ground Station instance."
                        />
                        <StationIdentityPanel station={station} />
                        {(localError || error) && (
                            <Alert severity="error">{localError || error}</Alert>
                        )}
                        <Box component="form" onSubmit={handleSubmit}>
                            <Stack spacing={2}>
                                <TextField
                                    label="Username"
                                    value={username}
                                    onChange={(event) => setUsername(event.target.value)}
                                    autoComplete="username"
                                    required
                                />
                                <TextField
                                    label="Password"
                                    type="password"
                                    value={password}
                                    onChange={(event) => setPassword(event.target.value)}
                                    autoComplete="current-password"
                                    required
                                />
                                <Button type="submit" variant="contained" disabled={loadingAction}>
                                    {loadingAction ? 'Signing in...' : 'Sign In'}
                                </Button>
                            </Stack>
                        </Box>
                    </Stack>
                </CardContent>
            </Card>
        </Box>
    );
}

export function SetupScreen() {
    const dispatch = useDispatch();
    const { socket } = useSocket();
    const location = useSelector((state) => state.location.location);
    const authStation = useSelector((state) => state.auth.station);
    const hasLocation = Boolean(location && location.lat != null && location.lon != null);

    const [locationChecked, setLocationChecked] = React.useState(false);
    const [wizardCompleted, setWizardCompleted] = React.useState(false);

    React.useEffect(() => {
        if (hasLocation) {
            setWizardCompleted(true);
        }
    }, [hasLocation]);

    React.useEffect(() => {
        if (!socket) return undefined;

        let mounted = true;
        const loadLocation = async () => {
            try {
                await dispatch(
                    fetchLocationForUserId({ socket, suppressNotFoundWarning: true })
                ).unwrap();
            } catch {
                // Location fetch failures are surfaced in the location slice/toasts.
            } finally {
                if (mounted) {
                    setLocationChecked(true);
                }
            }
        };

        if (socket.connected) {
            loadLocation();
        }

        socket.on('connect', loadLocation);
        return () => {
            mounted = false;
            socket.off('connect', loadLocation);
        };
    }, [dispatch, socket]);

    const setupStationIdentity = React.useMemo(() => {
        const locationName = String(location?.name || '').trim() || null;
        const locationCallsign = String(location?.callsign || '').trim().toUpperCase() || null;
        if (locationName || locationCallsign) {
            return { name: locationName, callsign: locationCallsign };
        }
        return normalizeStationIdentity(authStation);
    }, [authStation, location]);

    if (!locationChecked) {
        return (
            <Box sx={shellSx}>
                <Stack direction="row" spacing={1.5} alignItems="center">
                    <CircularProgress size={22} />
                    <Typography variant="body1">Loading setup state...</Typography>
                </Stack>
            </Box>
        );
    }

    if (!wizardCompleted) {
        return (
            <Dialog
                open
                onClose={() => {}}
                disableEscapeKeyDown
                aria-labelledby="setup-location-dialog-title"
                maxWidth="lg"
                fullWidth
                PaperProps={{
                    sx: {
                        borderRadius: 2,
                        boxShadow: 24,
                        height: 'min(800px, calc(100vh - 24px))',
                        maxHeight: 'calc(100vh - 24px)',
                        display: 'flex',
                        flexDirection: 'column',
                    },
                }}
            >
                <DialogTitle
                    id="setup-location-dialog-title"
                    sx={{
                        py: 1.5,
                        px: 2.5,
                        display: 'flex',
                        alignItems: 'center',
                        lineHeight: 1.2,
                        fontSize: '1.35rem',
                        fontWeight: 600,
                        color: 'primary.main',
                    }}
                >
                    Ground Station Setup
                </DialogTitle>
                <DialogContent
                    dividers
                    sx={{
                        px: 2.5,
                        pt: '10px !important',
                        pb: 2.5,
                        display: 'flex',
                        flexDirection: 'column',
                        flex: 1,
                        minHeight: 0,
                        overflow: 'hidden',
                    }}
                >
                    <Box sx={{ flex: 1, minHeight: 0, display: 'flex' }}>
                        <LocationPage wizardMode onWizardCompleted={() => setWizardCompleted(true)} />
                    </Box>
                </DialogContent>
            </Dialog>
        );
    }

    return (
        <Box sx={shellSx}>
            <AdminRegistrationForm
                title="Create Administrator Account"
                description="Setup is incomplete. Create the first admin account to unlock the dashboard."
                station={setupStationIdentity}
            />
        </Box>
    );
}
