import React from 'react';
import { Box, CircularProgress } from '@mui/material';
import {
    resolveSatelliteFallbackPath,
    resolveSatelliteIconPath,
} from './icon-catalog.js';

const SatelliteIcon = ({
    satelliteId = '',
    noradId = '',
    size = 24,
    alt = 'satellite icon',
    sx = {},
}) => {
    const resolvedId = satelliteId || noradId;
    const primaryPath = resolveSatelliteIconPath(resolvedId, size);
    const fallbackPath = resolveSatelliteFallbackPath(resolvedId);
    const numericSize = Number(size);
    const iconSize = Number.isFinite(numericSize) ? numericSize : (size || 24);
    const [failed, setFailed] = React.useState(false);
    const [loaded, setLoaded] = React.useState(false);
    const [usingFallback, setUsingFallback] = React.useState(false);
    const path = usingFallback ? fallbackPath : primaryPath;
    const showImage = Boolean(path) && !failed;
    const spinnerSize = Number.isFinite(numericSize)
        ? Math.max(12, Math.min(24, Math.round(numericSize * 0.35)))
        : 18;

    React.useEffect(() => {
        setFailed(false);
        setLoaded(false);
        setUsingFallback(false);
    }, [primaryPath, fallbackPath]);

    if (!showImage) return null;

    return (
        <Box
            sx={{
                width: iconSize,
                height: iconSize,
                flexShrink: 0,
                position: 'relative',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                ...sx,
            }}
        >
            {!loaded ? (
                <CircularProgress
                    size={spinnerSize}
                    thickness={5}
                    sx={{
                        color: 'text.secondary',
                        opacity: 0.7,
                        position: 'absolute',
                    }}
                />
            ) : null}
            <Box
                component="img"
                src={path}
                alt={alt}
                loading="lazy"
                onLoad={() => setLoaded(true)}
                onError={() => {
                    // Try normalized icon set first, then fallback to /satimages/full/{norad}.png.
                    if (!usingFallback && fallbackPath && fallbackPath !== primaryPath) {
                        setLoaded(false);
                        setUsingFallback(true);
                        return;
                    }
                    setLoaded(false);
                    setFailed(true);
                }}
                sx={{
                    position: 'absolute',
                    inset: 0,
                    width: '100%',
                    height: '100%',
                    objectFit: 'contain',
                    opacity: loaded ? 1 : 0,
                    transition: 'opacity 120ms linear',
                }}
            />
        </Box>
    );
};

export default React.memo(SatelliteIcon);
