import React from 'react';
import { Box, IconButton, Paper, Stack, Tooltip } from '@mui/material';
import RefreshIcon from '@mui/icons-material/Refresh';
import FitScreenIcon from '@mui/icons-material/FitScreen';

const CelestialToolbar = ({
    onRefresh,
    onFitAll,
    loading,
    disabled = false,
}) => {
    return (
        <Paper
            elevation={1}
            sx={{
                p: 0,
                display: 'inline-block',
                width: '100%',
                borderBottom: '1px solid',
                borderColor: 'border.main',
                borderRadius: 0,
            }}
        >
            <Box
                sx={{
                    width: '100%',
                    overflowX: 'auto',
                    msOverflowStyle: 'none',
                    scrollbarWidth: 'none',
                    '&::-webkit-scrollbar': { display: 'none' },
                }}
            >
                <Stack direction="row" spacing={0} sx={{ minWidth: 'min-content', flexWrap: 'nowrap' }}>
                    <Tooltip title="Fit all">
                        <span>
                            <IconButton
                                onClick={onFitAll}
                                disabled={disabled}
                                color="primary"
                                sx={{ borderRadius: 0 }}
                            >
                                <FitScreenIcon />
                            </IconButton>
                        </span>
                    </Tooltip>
                    <Tooltip title="Refresh celestial scene">
                        <span>
                            <IconButton
                                onClick={onRefresh}
                                disabled={disabled || loading}
                                color="primary"
                                sx={{ borderRadius: 0 }}
                            >
                                <RefreshIcon />
                            </IconButton>
                        </span>
                    </Tooltip>
                </Stack>
            </Box>
        </Paper>
    );
};

export default React.memo(CelestialToolbar);
