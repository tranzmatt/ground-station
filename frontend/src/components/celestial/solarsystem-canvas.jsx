import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Box, Typography } from '@mui/material';
import { useTheme } from '@mui/material/styles';

const PLANET_COLORS = {
    mercury: '#c2b280',
    venus: '#d6b57d',
    earth: '#4f8cff',
    mars: '#c04f3d',
    jupiter: '#d2a679',
    saturn: '#d9c188',
    uranus: '#76c7c0',
    neptune: '#5a7bd8',
};

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const MIN_ZOOM = 1;
const MAX_ZOOM = 1200;
const WHEEL_COMMIT_DELAY_MS = 180;
const DEFAULT_VIEWPORT = { zoom: 18, panX: 0, panY: 0 };
const normalizeViewport = (viewport) => ({
    zoom: clamp(Number(viewport?.zoom ?? DEFAULT_VIEWPORT.zoom), MIN_ZOOM, MAX_ZOOM),
    panX: Number(viewport?.panX ?? DEFAULT_VIEWPORT.panX) || 0,
    panY: Number(viewport?.panY ?? DEFAULT_VIEWPORT.panY) || 0,
});
const formatAu = (value) => {
    if (value >= 1) return `${value.toFixed(value >= 10 ? 0 : 1)} AU`;
    return `${value.toFixed(2)} AU`;
};

const drawArrowHead = (ctx, fromX, fromY, toX, toY, color) => {
    const dx = toX - fromX;
    const dy = toY - fromY;
    const length = Math.hypot(dx, dy);
    if (length < 0.01) return;

    const ux = dx / length;
    const uy = dy / length;
    const arrowLength = 8;
    const arrowWidth = 5;
    const baseX = toX - ux * arrowLength;
    const baseY = toY - uy * arrowLength;
    const perpX = -uy;
    const perpY = ux;

    ctx.beginPath();
    ctx.moveTo(toX, toY);
    ctx.lineTo(baseX + perpX * arrowWidth, baseY + perpY * arrowWidth);
    ctx.lineTo(baseX - perpX * arrowWidth, baseY - perpY * arrowWidth);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
};

const SolarSystemCanvas = ({ scene, fitAllSignal = 0, initialViewport = null, onViewportCommit = null }) => {
    const theme = useTheme();
    const containerRef = useRef(null);
    const canvasRef = useRef(null);
    const wheelCommitTimeoutRef = useRef(null);
    const lastFitSignalRef = useRef(fitAllSignal);
    const hasPersistentViewportRef = useRef(!!initialViewport);
    const viewportRef = useRef(DEFAULT_VIEWPORT);
    const dragRef = useRef({
        active: false,
        x: 0,
        y: 0,
    });

    const [viewport, setViewport] = useState(() => normalizeViewport(initialViewport || DEFAULT_VIEWPORT));

    const planets = scene?.planets || [];
    const tracked = scene?.celestial || [];

    const commitViewport = useCallback((nextViewport) => {
        hasPersistentViewportRef.current = true;
        if (onViewportCommit) {
            onViewportCommit(normalizeViewport(nextViewport));
        }
    }, [onViewportCommit]);

    const fitAll = useCallback(() => {
        const container = containerRef.current;
        if (!container) return;

        const rect = container.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) return;

        const points = [];
        planets.forEach((planet) => {
            if (Array.isArray(planet.position_xyz_au)) {
                points.push(planet.position_xyz_au);
            }
            const samples = planet.orbit_samples_xyz_au || [];
            samples.forEach((sample) => {
                if (Array.isArray(sample)) points.push(sample);
            });
        });
        tracked.forEach((body) => {
            if (Array.isArray(body.position_xyz_au)) {
                points.push(body.position_xyz_au);
            }
            const samples = body.orbit_samples_xyz_au || [];
            samples.forEach((sample) => {
                if (Array.isArray(sample)) points.push(sample);
            });
        });

        if (!points.length) {
            const fallbackViewport = normalizeViewport(DEFAULT_VIEWPORT);
            setViewport(fallbackViewport);
            commitViewport(fallbackViewport);
            return;
        }

        let minX = Infinity;
        let maxX = -Infinity;
        let minY = Infinity;
        let maxY = -Infinity;
        points.forEach((p) => {
            const x = Number(p[0] || 0);
            const y = Number(p[1] || 0);
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
        });

        const spanX = Math.max(0.1, maxX - minX);
        const spanY = Math.max(0.1, maxY - minY);
        const padding = 0.88;
        const zoomX = (rect.width * padding) / spanX;
        const zoomY = (rect.height * padding) / spanY;
        const nextZoom = clamp(Math.min(zoomX, zoomY), MIN_ZOOM, MAX_ZOOM);

        const worldCenterX = (minX + maxX) / 2;
        const worldCenterY = (minY + maxY) / 2;

        const nextViewport = {
            zoom: nextZoom,
            panX: -worldCenterX * nextZoom,
            panY: worldCenterY * nextZoom,
        };
        setViewport(nextViewport);
        commitViewport(nextViewport);
    }, [planets, tracked, commitViewport]);

    const drawScene = useCallback(() => {
        const container = containerRef.current;
        const canvas = canvasRef.current;
        if (!container || !canvas) return;

        const rect = container.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) return;

        const dpr = window.devicePixelRatio || 1;
        const width = Math.floor(rect.width);
        const height = Math.floor(rect.height);

        if (canvas.width !== Math.floor(width * dpr) || canvas.height !== Math.floor(height * dpr)) {
            canvas.width = Math.floor(width * dpr);
            canvas.height = Math.floor(height * dpr);
            canvas.style.width = `${width}px`;
            canvas.style.height = `${height}px`;
        }

        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, width, height);

        // Background.
        ctx.fillStyle = theme.palette.background.default;
        ctx.fillRect(0, 0, width, height);

        const cx = width / 2 + viewport.panX;
        const cy = height / 2 + viewport.panY;
        const scale = viewport.zoom;

        const toScreen = (position) => {
            const x = cx + (position?.[0] || 0) * scale;
            const y = cy - (position?.[1] || 0) * scale;
            return [x, y];
        };

        // World-space grid (moves with pan/zoom).
        const gridStepAu = scale > 80 ? 0.5 : scale > 30 ? 1 : scale > 12 ? 2 : 5;
        const worldMinX = (0 - cx) / scale;
        const worldMaxX = (width - cx) / scale;
        const worldMaxY = (cy - 0) / scale;
        const worldMinY = (cy - height) / scale;
        const startGridX = Math.floor(worldMinX / gridStepAu) * gridStepAu;
        const startGridY = Math.floor(worldMinY / gridStepAu) * gridStepAu;

        ctx.strokeStyle = theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)';
        ctx.lineWidth = 1;

        for (let gx = startGridX; gx <= worldMaxX; gx += gridStepAu) {
            const sx = cx + gx * scale;
            ctx.beginPath();
            ctx.moveTo(sx, 0);
            ctx.lineTo(sx, height);
            ctx.stroke();
        }
        for (let gy = startGridY; gy <= worldMaxY; gy += gridStepAu) {
            const sy = cy - gy * scale;
            ctx.beginPath();
            ctx.moveTo(0, sy);
            ctx.lineTo(width, sy);
            ctx.stroke();
        }

        // Sun.
        ctx.beginPath();
        ctx.arc(cx, cy, 8, 0, Math.PI * 2);
        ctx.fillStyle = '#f9c74f';
        ctx.fill();
        ctx.strokeStyle = '#f4a261';
        ctx.stroke();

        // Planet orbits (sampled paths).
        ctx.lineWidth = 1;
        planets.forEach((planet) => {
            const samples = planet.orbit_samples_xyz_au || [];
            if (!samples.length) return;
            ctx.beginPath();
            samples.forEach((sample, index) => {
                const [sx, sy] = toScreen(sample);
                if (index === 0) ctx.moveTo(sx, sy);
                else ctx.lineTo(sx, sy);
            });
            ctx.closePath();
            ctx.strokeStyle = theme.palette.mode === 'dark' ? 'rgba(180,180,200,0.35)' : 'rgba(90,90,120,0.3)';
            ctx.stroke();
        });

        // Planets.
        ctx.font = '11px monospace';
        planets.forEach((planet) => {
            const id = String(planet.id || '').toLowerCase();
            const color = PLANET_COLORS[id] || '#bbbbbb';
            const [sx, sy] = toScreen(planet.position_xyz_au);

            ctx.beginPath();
            ctx.arc(sx, sy, 4, 0, Math.PI * 2);
            ctx.fillStyle = color;
            ctx.fill();

            ctx.fillStyle = theme.palette.text.secondary;
            ctx.fillText(planet.name || id, sx + 7, sy - 6);
        });

        // Tracked objects from Horizons.
        tracked.forEach((body) => {
            const samples = body.orbit_samples_xyz_au || [];
            if (!samples.length) return;

            const strokeColor = body.stale
                ? (theme.palette.mode === 'dark' ? 'rgba(239,71,111,0.45)' : 'rgba(196,47,89,0.45)')
                : (theme.palette.mode === 'dark' ? 'rgba(6,214,160,0.42)' : 'rgba(0,130,96,0.42)');
            ctx.beginPath();
            samples.forEach((sample, index) => {
                const [sx, sy] = toScreen(sample);
                if (index === 0) ctx.moveTo(sx, sy);
                else ctx.lineTo(sx, sy);
            });
            ctx.strokeStyle = strokeColor;
            ctx.lineWidth = 1;
            ctx.setLineDash([3, 4]);
            ctx.stroke();
            ctx.setLineDash([]);

            // Direction arrows at both endpoints in forward time direction.
            if (samples.length >= 2) {
                const [startX, startY] = toScreen(samples[0]);
                const [startNextX, startNextY] = toScreen(samples[1]);
                drawArrowHead(ctx, startX, startY, startNextX, startNextY, strokeColor);

                const lastIndex = samples.length - 1;
                const [endPrevX, endPrevY] = toScreen(samples[lastIndex - 1]);
                const [endX, endY] = toScreen(samples[lastIndex]);
                drawArrowHead(ctx, endPrevX, endPrevY, endX, endY, strokeColor);
            }
        });

        // Tracked object markers from Horizons.
        ctx.font = '11px monospace';
        tracked.forEach((body) => {
            const [sx, sy] = toScreen(body.position_xyz_au);

            ctx.fillStyle = body.stale ? '#ef476f' : '#06d6a0';
            ctx.fillRect(sx - 3, sy - 3, 6, 6);

            ctx.fillStyle = theme.palette.text.secondary;
            ctx.fillText(body.name || body.command || 'object', sx + 8, sy + 4);
        });
    }, [planets, tracked, theme.palette.background.default, theme.palette.mode, theme.palette.text.secondary, viewport.panX, viewport.panY, viewport.zoom]);

    useEffect(() => {
        drawScene();
    }, [drawScene]);

    useEffect(() => {
        viewportRef.current = viewport;
    }, [viewport]);

    useEffect(() => {
        if (fitAllSignal === lastFitSignalRef.current) return;
        lastFitSignalRef.current = fitAllSignal;
        fitAll();
    }, [fitAllSignal, fitAll]);

    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;

        const observer = new ResizeObserver(() => {
            drawScene();
        });
        observer.observe(container);
        return () => observer.disconnect();
    }, [drawScene]);

    useEffect(() => {
        return () => {
            if (wheelCommitTimeoutRef.current) {
                window.clearTimeout(wheelCommitTimeoutRef.current);
            }
        };
    }, []);

    const handlePointerDown = (event) => {
        hasPersistentViewportRef.current = true;
        event.currentTarget.setPointerCapture?.(event.pointerId);
        dragRef.current.active = true;
        dragRef.current.x = event.clientX;
        dragRef.current.y = event.clientY;
    };

    const handlePointerMove = (event) => {
        if (!dragRef.current.active) return;
        const dx = event.clientX - dragRef.current.x;
        const dy = event.clientY - dragRef.current.y;
        dragRef.current.x = event.clientX;
        dragRef.current.y = event.clientY;
        setViewport((prev) => {
            const next = {
                ...prev,
                panX: prev.panX + dx,
                panY: prev.panY + dy,
            };
            viewportRef.current = next;
            return next;
        });
    };

    const handlePointerUp = () => {
        if (dragRef.current.active) {
            commitViewport(viewportRef.current);
        }
        dragRef.current.active = false;
    };

    const handleWheel = (event) => {
        if (!event.shiftKey) {
            return;
        }
        event.preventDefault();
        hasPersistentViewportRef.current = true;
        const direction = event.deltaY > 0 ? 0.92 : 1.08;
        const container = containerRef.current;
        if (!container) return;

        const rect = container.getBoundingClientRect();
        const mouseX = event.clientX - rect.left;
        const mouseY = event.clientY - rect.top;
        const width = rect.width;
        const height = rect.height;

        setViewport((prev) => {
            const nextZoom = clamp(prev.zoom * direction, MIN_ZOOM, MAX_ZOOM);
            const prevCx = width / 2 + prev.panX;
            const prevCy = height / 2 + prev.panY;

            // Keep world position under cursor fixed while zooming.
            const worldX = (mouseX - prevCx) / prev.zoom;
            const worldY = (prevCy - mouseY) / prev.zoom;
            const nextCx = mouseX - worldX * nextZoom;
            const nextCy = mouseY + worldY * nextZoom;

            const next = {
                zoom: nextZoom,
                panX: nextCx - width / 2,
                panY: nextCy - height / 2,
            };
            viewportRef.current = next;
            return next;
        });

        if (wheelCommitTimeoutRef.current) {
            window.clearTimeout(wheelCommitTimeoutRef.current);
        }
        wheelCommitTimeoutRef.current = window.setTimeout(() => {
            commitViewport(viewportRef.current);
        }, WHEEL_COMMIT_DELAY_MS);
    };

    const timestampText = useMemo(() => {
        if (!scene?.timestamp_utc) return 'No epoch';
        return `Epoch: ${scene.timestamp_utc}`;
    }, [scene?.timestamp_utc]);

    const scaleIndicator = useMemo(() => {
        const zoom = viewport.zoom;
        const gridStepAu = zoom > 80 ? 0.5 : zoom > 30 ? 1 : zoom > 12 ? 2 : 5;
        const pixels = gridStepAu * zoom;
        return {
            label: `Scale: ${formatAu(gridStepAu)} / square`,
            barWidthPx: clamp(pixels, 40, 180),
        };
    }, [viewport.zoom]);

    return (
        <Box sx={{ width: '100%', height: '100%', position: 'relative' }}>
            <Box
                ref={containerRef}
                sx={{ width: '100%', height: '100%', cursor: 'grab' }}
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onPointerCancel={handlePointerUp}
                onPointerLeave={handlePointerUp}
                onWheel={handleWheel}
            >
                <canvas ref={canvasRef} style={{ display: 'block', width: '100%', height: '100%' }} />
            </Box>
            <Typography
                variant="caption"
                sx={{
                    position: 'absolute',
                    left: 10,
                    top: 8,
                    color: 'text.secondary',
                    backgroundColor: theme.palette.mode === 'dark' ? 'rgba(0,0,0,0.35)' : 'rgba(255,255,255,0.6)',
                    px: 0.8,
                    py: 0.3,
                    borderRadius: 0.5,
                    fontFamily: 'monospace',
                }}
            >
                {timestampText}
            </Typography>
            <Box
                sx={{
                    position: 'absolute',
                    right: 10,
                    bottom: 8,
                    color: 'text.secondary',
                    backgroundColor: theme.palette.mode === 'dark' ? 'rgba(0,0,0,0.35)' : 'rgba(255,255,255,0.6)',
                    px: 0.8,
                    py: 0.5,
                    borderRadius: 0.5,
                    fontFamily: 'monospace',
                }}
            >
                <Typography variant="caption" sx={{ fontFamily: 'inherit', lineHeight: 1.1 }}>
                    {scaleIndicator.label}
                </Typography>
            </Box>
        </Box>
    );
};

export default React.memo(SolarSystemCanvas);
