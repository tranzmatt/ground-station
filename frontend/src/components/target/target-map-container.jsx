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

import {useSelector} from "react-redux";
import {normalizeMapEngine} from "../common/tile-layers.jsx";
import {normalizeTargetType} from './celestial-target-utils.js';
import LeafletTargetMapRenderer from './target-map-leaflet.jsx';
import TargetMapMapLibreRenderer from './target-map-maplibre.jsx';

const TargetMapContainer = () => {
    const mapEngine = useSelector((state) => state.targetSatTrack?.mapEngine);
    const trackingState = useSelector((state) => state.targetSatTrack?.trackingState || {});
    const normalizedMapEngine = normalizeMapEngine(mapEngine);
    const targetType = normalizeTargetType(trackingState);

    if (normalizedMapEngine === 'maplibre' && targetType === 'satellite') {
        return <TargetMapMapLibreRenderer/>;
    }

    return <LeafletTargetMapRenderer/>;
};

export default TargetMapContainer;
