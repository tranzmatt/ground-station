import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef } from 'react';
import { useSelector } from 'react-redux';
import { useSocket } from '../common/socket.jsx';

const WaterfallEngineContext = createContext(null);

const DEFAULT_WORKER_THEME = {
    palette: {
        background: {
            default: '#121212',
            paper: '#1e1e1e',
            elevated: '#2a2a2a',
        },
        border: {
            main: '#424242',
            light: '#494949',
            dark: '#262626',
        },
        overlay: {
            light: 'rgba(255, 255, 255, 0.08)',
            medium: 'rgba(255, 255, 255, 0.12)',
            dark: 'rgba(0, 0, 0, 0.5)',
        },
        text: {
            primary: '#ffffff',
            secondary: 'rgba(255, 255, 255, 0.7)',
        },
    },
};

export const WaterfallEngineProvider = ({ children }) => {
    const { socket } = useSocket();
    const workerRef = useRef(null);
    const fftListenersRef = useRef(new Set());
    const workerMessageListenersRef = useRef(new Set());
    const headlessInitKeyRef = useRef('');

    const {
        waterfallRendererMode,
        isStreaming,
        waterFallCanvasWidth,
        waterFallCanvasHeight,
        colorMap,
        dbRange,
        fftSize,
        showRotatorDottedLines,
        autoScalePreset,
        targetFPS,
    } = useSelector((state) => ({
        waterfallRendererMode: state.waterfall.waterfallRendererMode,
        isStreaming: state.waterfall.isStreaming,
        waterFallCanvasWidth: state.waterfall.waterFallCanvasWidth,
        waterFallCanvasHeight: state.waterfall.waterFallCanvasHeight,
        colorMap: state.waterfall.colorMap,
        dbRange: state.waterfall.dbRange,
        fftSize: state.waterfall.fftSize,
        showRotatorDottedLines: state.waterfall.showRotatorDottedLines,
        autoScalePreset: state.waterfall.autoScalePreset,
        targetFPS: state.waterfall.targetFPS,
    }));

    const timezone = useSelector((state) =>
        state.preferences?.preferences?.find((pref) => pref.name === 'timezone')?.value || 'UTC'
    );

    const notifyWorkerMessageListeners = useCallback((event) => {
        workerMessageListenersRef.current.forEach((listener) => {
            try {
                listener(event);
            } catch (error) {
                console.error('Worker message listener error:', error);
            }
        });
    }, []);

    const ensureWorker = useCallback(() => {
        if (workerRef.current) {
            return workerRef.current;
        }

        try {
            const worker = new Worker(
                new URL('./waterfall-worker.js', import.meta.url),
                { type: 'module' }
            );
            worker.onmessage = notifyWorkerMessageListeners;
            worker.onerror = (error) => {
                console.error('Waterfall worker error:', error);
            };
            workerRef.current = worker;
            headlessInitKeyRef.current = '';
            return worker;
        } catch (error) {
            console.error('Failed to create waterfall worker:', error);
            return null;
        }
    }, [notifyWorkerMessageListeners]);

    const postWorkerMessage = useCallback((message, transferables = undefined) => {
        const worker = ensureWorker();
        if (!worker) {
            return false;
        }

        if (transferables && transferables.length > 0) {
            worker.postMessage(message, transferables);
        } else {
            worker.postMessage(message);
        }

        return true;
    }, [ensureWorker]);

    const subscribeToFftData = useCallback((listener) => {
        if (typeof listener !== 'function') {
            return () => {};
        }

        fftListenersRef.current.add(listener);
        return () => {
            fftListenersRef.current.delete(listener);
        };
    }, []);

    const subscribeToWorkerMessages = useCallback((listener) => {
        if (typeof listener !== 'function') {
            return () => {};
        }

        workerMessageListenersRef.current.add(listener);
        return () => {
            workerMessageListenersRef.current.delete(listener);
        };
    }, []);

    const attachCanvases = useCallback(({
        waterFallCanvasRef,
        bandscopeCanvasRef,
        dBAxisScopeCanvasRef,
        waterFallLeftMarginCanvasRef,
        config,
    }) => {
        const worker = ensureWorker();
        if (!worker) {
            return false;
        }

        const waterfallCanvas = waterFallCanvasRef?.current;
        const bandscopeCanvas = bandscopeCanvasRef?.current;
        const dBAxisCanvas = dBAxisScopeCanvasRef?.current;
        const waterfallLeftMarginCanvas = waterFallLeftMarginCanvasRef?.current;

        if (!waterfallCanvas || !bandscopeCanvas || !dBAxisCanvas || !waterfallLeftMarginCanvas) {
            return false;
        }

        if (
            typeof waterfallCanvas.transferControlToOffscreen !== 'function' ||
            typeof bandscopeCanvas.transferControlToOffscreen !== 'function' ||
            typeof dBAxisCanvas.transferControlToOffscreen !== 'function' ||
            typeof waterfallLeftMarginCanvas.transferControlToOffscreen !== 'function'
        ) {
            console.warn('OffscreenCanvas transfer is not supported in this browser');
            return false;
        }

        try {
            const waterfallOffscreenCanvas = waterfallCanvas.transferControlToOffscreen();
            const bandscopeOffscreenCanvas = bandscopeCanvas.transferControlToOffscreen();
            const dBAxisOffscreenCanvas = dBAxisCanvas.transferControlToOffscreen();
            const waterfallLeftMarginOffscreenCanvas = waterfallLeftMarginCanvas.transferControlToOffscreen();

            worker.postMessage({
                cmd: 'initCanvas',
                waterfallCanvas: waterfallOffscreenCanvas,
                bandscopeCanvas: bandscopeOffscreenCanvas,
                dBAxisCanvas: dBAxisOffscreenCanvas,
                waterfallLeftMarginCanvas: waterfallLeftMarginOffscreenCanvas,
                config,
            }, [
                waterfallOffscreenCanvas,
                bandscopeOffscreenCanvas,
                dBAxisOffscreenCanvas,
                waterfallLeftMarginOffscreenCanvas,
            ]);

            return true;
        } catch (error) {
            console.error('Failed to attach OffscreenCanvas instances to waterfall worker:', error);
            return false;
        }
    }, [ensureWorker]);

    const detachCanvases = useCallback(() => {
        postWorkerMessage({ cmd: 'detachCanvases' });
    }, [postWorkerMessage]);

    useEffect(() => {
        const worker = ensureWorker();
        return () => {
            if (worker) {
                worker.terminate();
            }
            workerRef.current = null;
            headlessInitKeyRef.current = '';
        };
    }, [ensureWorker]);

    useEffect(() => {
        if (waterfallRendererMode !== 'worker') {
            return;
        }

        const initKey = `${waterFallCanvasWidth}:${waterFallCanvasHeight}:${fftSize}`;
        if (headlessInitKeyRef.current === initKey) {
            return;
        }

        const initialized = postWorkerMessage({
            cmd: 'initHeadless',
            config: {
                width: waterFallCanvasWidth,
                height: waterFallCanvasHeight,
                colorMap,
                dbRange,
                fftSize,
                showRotatorDottedLines,
                timezone,
                theme: DEFAULT_WORKER_THEME,
            },
        });

        if (initialized) {
            headlessInitKeyRef.current = initKey;
            postWorkerMessage({ cmd: 'setAutoScalePreset', preset: autoScalePreset });
        }
    }, [
        autoScalePreset,
        colorMap,
        dbRange,
        fftSize,
        postWorkerMessage,
        showRotatorDottedLines,
        timezone,
        waterfallRendererMode,
        waterFallCanvasHeight,
        waterFallCanvasWidth,
    ]);

    useEffect(() => {
        if (waterfallRendererMode !== 'worker') {
            return;
        }

        postWorkerMessage({
            cmd: 'updateConfig',
            colorMap,
            dbRange,
            fftSize,
            timezone,
            theme: DEFAULT_WORKER_THEME,
        });
    }, [waterfallRendererMode, colorMap, dbRange, fftSize, timezone, postWorkerMessage]);

    useEffect(() => {
        if (waterfallRendererMode !== 'worker') {
            return;
        }

        postWorkerMessage({ cmd: 'setAutoScalePreset', preset: autoScalePreset });
    }, [waterfallRendererMode, autoScalePreset, postWorkerMessage]);

    useEffect(() => {
        if (waterfallRendererMode !== 'worker') {
            return;
        }

        if (isStreaming) {
            postWorkerMessage({ cmd: 'start', fps: targetFPS });
            return;
        }

        postWorkerMessage({ cmd: 'stop' });
    }, [waterfallRendererMode, isStreaming, targetFPS, postWorkerMessage]);

    useEffect(() => {
        if (waterfallRendererMode !== 'worker' || !isStreaming) {
            return;
        }

        postWorkerMessage({ cmd: 'updateFPS', fps: targetFPS });
    }, [waterfallRendererMode, isStreaming, targetFPS, postWorkerMessage]);

    useEffect(() => {
        if (!socket) {
            return;
        }

        const handleFftData = (payload) => {
            const binaryData = payload?.data || payload;
            if (!binaryData) {
                return;
            }

            const floatArray = binaryData instanceof Float32Array
                ? binaryData
                : new Float32Array(binaryData);

            const frame = {
                fft: floatArray,
                recordingDatetime: payload?.recording_datetime || null,
                playbackElapsedSeconds: payload?.playback_elapsed_seconds || null,
                playbackRemainingSeconds: payload?.playback_remaining_seconds || null,
                playbackTotalSeconds: payload?.playback_total_seconds || null,
            };

            fftListenersRef.current.forEach((listener) => {
                try {
                    listener(frame);
                } catch (error) {
                    console.error('FFT listener error:', error);
                }
            });

            if (waterfallRendererMode === 'worker') {
                const worker = ensureWorker();
                if (worker) {
                    worker.postMessage({
                        cmd: 'updateFFTData',
                        fft: floatArray,
                        recording_datetime: frame.recordingDatetime,
                        playback_elapsed_seconds: frame.playbackElapsedSeconds,
                        playback_remaining_seconds: frame.playbackRemainingSeconds,
                        playback_total_seconds: frame.playbackTotalSeconds,
                        immediate: true,
                    }, [floatArray.buffer]);
                }
            }
        };

        socket.on('sdr-fft-data', handleFftData);
        return () => {
            socket.off('sdr-fft-data', handleFftData);
        };
    }, [ensureWorker, socket, waterfallRendererMode]);

    const value = useMemo(() => ({
        workerRef,
        postWorkerMessage,
        attachCanvases,
        detachCanvases,
        subscribeToFftData,
        subscribeToWorkerMessages,
    }), [
        attachCanvases,
        detachCanvases,
        postWorkerMessage,
        subscribeToFftData,
        subscribeToWorkerMessages,
    ]);

    return (
        <WaterfallEngineContext.Provider value={value}>
            {children}
        </WaterfallEngineContext.Provider>
    );
};

export const useWaterfallEngine = () => {
    const context = useContext(WaterfallEngineContext);
    if (!context) {
        throw new Error('useWaterfallEngine must be used within WaterfallEngineProvider');
    }
    return context;
};
