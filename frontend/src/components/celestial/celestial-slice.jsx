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

import { createAsyncThunk, createSlice } from '@reduxjs/toolkit';

export const fetchCelestialScene = createAsyncThunk(
    'celestial/fetchScene',
    async ({ socket, payload = {} }, { rejectWithValue }) => {
        return await new Promise((resolve, reject) => {
            socket.emit('data_request', 'get-celestial-scene', payload, (response) => {
                if (response?.success) {
                    resolve(response.data);
                } else {
                    reject(rejectWithValue(response?.error || 'Failed to fetch celestial scene'));
                }
            });
        });
    }
);

export const fetchSolarSystemScene = createAsyncThunk(
    'celestial/fetchSolarSystemScene',
    async ({ socket, payload = {} }, { rejectWithValue }) => {
        return await new Promise((resolve, reject) => {
            socket.emit('data_request', 'get-solar-system-scene', payload, (response) => {
                if (response?.success) {
                    resolve(response.data);
                } else {
                    reject(rejectWithValue(response?.error || 'Failed to fetch solar system scene'));
                }
            });
        });
    }
);

export const fetchCelestialTracks = createAsyncThunk(
    'celestial/fetchCelestialTracks',
    async ({ socket, payload = {} }, { rejectWithValue }) => {
        return await new Promise((resolve, reject) => {
            socket.emit('data_request', 'get-celestial-tracks', payload, (response) => {
                if (response?.success) {
                    resolve(response.data);
                } else {
                    reject(rejectWithValue(response?.error || 'Failed to fetch celestial tracks'));
                }
            });
        });
    }
);

export const refreshCelestialScene = createAsyncThunk(
    'celestial/refreshScene',
    async ({ socket, payload = {} }, { rejectWithValue }) => {
        return await new Promise((resolve, reject) => {
            socket.emit('data_submission', 'refresh-celestial-now', payload, (response) => {
                if (response?.success) {
                    resolve(response.data);
                } else {
                    reject(rejectWithValue(response?.error || 'Failed to refresh celestial scene'));
                }
            });
        });
    }
);

export const refreshMonitoredCelestialNow = createAsyncThunk(
    'celestial/refreshMonitoredNow',
    async ({ socket, ids = [], payload = {} }, { rejectWithValue }) => {
        return await new Promise((resolve, reject) => {
            socket.emit('data_submission', 'refresh-monitored-celestial-now', { ids, ...payload }, (response) => {
                if (response?.success) {
                    resolve(response.data);
                } else {
                    reject(rejectWithValue(response?.error || 'Failed to refresh monitored celestial targets'));
                }
            });
        });
    }
);

export const getCelestialMapSettings = createAsyncThunk(
    'celestial/getMapSettings',
    async ({ socket }, { rejectWithValue }) => {
        return await new Promise((resolve, reject) => {
            socket.emit('data_request', 'get-map-settings', 'celestial-map-settings', (response) => {
                if (response?.success) {
                    resolve(response?.data?.value || null);
                } else {
                    reject(rejectWithValue('Failed to get celestial map settings'));
                }
            });
        });
    }
);

export const setCelestialMapSettings = createAsyncThunk(
    'celestial/setMapSettings',
    async ({ socket, value }, { rejectWithValue }) => {
        return await new Promise((resolve, reject) => {
            socket.emit(
                'data_submission',
                'set-map-settings',
                { name: 'celestial-map-settings', value },
                (response) => {
                    if (response?.success) {
                        resolve(response?.data?.value || value);
                    } else {
                        reject(rejectWithValue('Failed to set celestial map settings'));
                    }
                }
            );
        });
    }
);

const celestialSlice = createSlice({
    name: 'celestial',
    initialState: {
        solarScene: null,
        celestialTracks: null,
        mapSettings: null,
        solarLoading: false,
        tracksLoading: false,
        error: null,
        lastUpdated: null,
    },
    reducers: {
        setCelestialSceneLive: (state, action) => {
            const payload = action.payload || {};
            state.solarScene = payload;
            state.celestialTracks = payload;
            state.error = null;
            state.lastUpdated = new Date().toISOString();
        },
        setSolarSceneLive: (state, action) => {
            state.solarScene = action.payload;
            state.error = null;
            state.lastUpdated = new Date().toISOString();
        },
        setCelestialTracksLive: (state, action) => {
            state.celestialTracks = action.payload;
            state.error = null;
            state.lastUpdated = new Date().toISOString();
        },
    },
    extraReducers: (builder) => {
        builder
            .addCase(fetchCelestialScene.pending, (state) => {
                state.solarLoading = true;
                state.tracksLoading = true;
                state.error = null;
            })
            .addCase(fetchCelestialScene.fulfilled, (state, action) => {
                state.solarLoading = false;
                state.tracksLoading = false;
                state.solarScene = action.payload;
                state.celestialTracks = action.payload;
                state.lastUpdated = new Date().toISOString();
            })
            .addCase(fetchCelestialScene.rejected, (state, action) => {
                state.solarLoading = false;
                state.tracksLoading = false;
                state.error = action.payload || action.error?.message || 'Unknown error';
            })
            .addCase(fetchSolarSystemScene.pending, (state) => {
                state.solarLoading = true;
                state.error = null;
            })
            .addCase(fetchSolarSystemScene.fulfilled, (state, action) => {
                state.solarLoading = false;
                state.solarScene = action.payload;
                state.lastUpdated = new Date().toISOString();
            })
            .addCase(fetchSolarSystemScene.rejected, (state, action) => {
                state.solarLoading = false;
                state.error = action.payload || action.error?.message || 'Unknown error';
            })
            .addCase(fetchCelestialTracks.pending, (state) => {
                state.tracksLoading = true;
                state.error = null;
            })
            .addCase(fetchCelestialTracks.fulfilled, (state, action) => {
                state.tracksLoading = false;
                state.celestialTracks = action.payload;
                state.lastUpdated = new Date().toISOString();
            })
            .addCase(fetchCelestialTracks.rejected, (state, action) => {
                state.tracksLoading = false;
                state.error = action.payload || action.error?.message || 'Unknown error';
            })
            .addCase(refreshCelestialScene.pending, (state) => {
                state.solarLoading = true;
                state.tracksLoading = true;
                state.error = null;
            })
            .addCase(refreshCelestialScene.fulfilled, (state, action) => {
                state.solarLoading = false;
                state.tracksLoading = false;
                state.solarScene = action.payload;
                state.celestialTracks = action.payload;
                state.lastUpdated = new Date().toISOString();
            })
            .addCase(refreshCelestialScene.rejected, (state, action) => {
                state.solarLoading = false;
                state.tracksLoading = false;
                state.error = action.payload || action.error?.message || 'Unknown error';
            })
            .addCase(refreshMonitoredCelestialNow.pending, (state) => {
                state.tracksLoading = true;
                state.error = null;
            })
            .addCase(refreshMonitoredCelestialNow.fulfilled, (state, action) => {
                state.tracksLoading = false;
                state.celestialTracks = action.payload;
                state.lastUpdated = new Date().toISOString();
            })
            .addCase(refreshMonitoredCelestialNow.rejected, (state, action) => {
                state.tracksLoading = false;
                state.error = action.payload || action.error?.message || 'Unknown error';
            })
            .addCase(getCelestialMapSettings.fulfilled, (state, action) => {
                if (action.payload !== null && action.payload !== undefined) {
                    state.mapSettings = action.payload;
                }
            })
            .addCase(setCelestialMapSettings.fulfilled, (state, action) => {
                state.mapSettings = action.payload;
            });
    },
});

export const { setCelestialSceneLive, setSolarSceneLive, setCelestialTracksLive } = celestialSlice.actions;
export default celestialSlice.reducer;
