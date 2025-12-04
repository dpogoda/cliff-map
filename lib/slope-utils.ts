/**
 * Slope calculation utilities
 * Computes actual slope angles from elevation data
 */

import maplibregl from 'maplibre-gl';

export interface SlopeCell {
  lng: number;
  lat: number;
  slope: number; // in degrees
  elevation: number;
}

export interface SlopeGrid {
  cells: SlopeCell[];
  bounds: maplibregl.LngLatBounds;
  resolution: number;
}

/**
 * Calculate slope angle in degrees from elevation difference and distance
 */
export function calculateSlopeAngle(elevDiff: number, distance: number): number {
  if (distance === 0) return 0;
  return Math.atan(Math.abs(elevDiff) / distance) * (180 / Math.PI);
}

/**
 * Calculate distance between two lat/lng points in meters (Haversine formula)
 */
export function haversineDistance(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const R = 6371000; // Earth radius in meters
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLng = (lng2 - lng1) * (Math.PI / 180);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * (Math.PI / 180)) *
      Math.cos(lat2 * (Math.PI / 180)) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Sample elevation grid from map terrain
 */
export function sampleElevationGrid(
  map: maplibregl.Map,
  bounds: maplibregl.LngLatBounds,
  gridSize: number = 50
): { elevations: (number | null)[][]; lngs: number[]; lats: number[] } {
  const west = bounds.getWest();
  const east = bounds.getEast();
  const south = bounds.getSouth();
  const north = bounds.getNorth();

  const lngStep = (east - west) / gridSize;
  const latStep = (north - south) / gridSize;

  const elevations: (number | null)[][] = [];
  const lngs: number[] = [];
  const lats: number[] = [];

  for (let i = 0; i <= gridSize; i++) {
    lngs.push(west + i * lngStep);
  }
  for (let j = 0; j <= gridSize; j++) {
    lats.push(south + j * latStep);
  }

  for (let j = 0; j <= gridSize; j++) {
    const row: (number | null)[] = [];
    for (let i = 0; i <= gridSize; i++) {
      const lng = lngs[i];
      const lat = lats[j];
      const elev = map.queryTerrainElevation({ lng, lat });
      row.push(elev);
    }
    elevations.push(row);
  }

  return { elevations, lngs, lats };
}

/**
 * Calculate slope for each cell in the grid
 * Uses maximum slope from 4 cardinal directions
 */
export function calculateSlopeGrid(
  elevations: (number | null)[][],
  lngs: number[],
  lats: number[]
): SlopeCell[] {
  const cells: SlopeCell[] = [];
  const rows = elevations.length;
  const cols = elevations[0]?.length || 0;

  for (let j = 0; j < rows - 1; j++) {
    for (let i = 0; i < cols - 1; i++) {
      const elev = elevations[j][i];
      if (elev === null) continue;

      const elevRight = elevations[j][i + 1];
      const elevUp = elevations[j + 1]?.[i];
      const elevDiag = elevations[j + 1]?.[i + 1];

      // Calculate distances
      const distRight = haversineDistance(lats[j], lngs[i], lats[j], lngs[i + 1]);
      const distUp = haversineDistance(lats[j], lngs[i], lats[j + 1], lngs[i]);

      // Calculate slopes in each direction
      const slopes: number[] = [];

      if (elevRight !== null) {
        slopes.push(calculateSlopeAngle(elevRight - elev, distRight));
      }
      if (elevUp !== null) {
        slopes.push(calculateSlopeAngle(elevUp - elev, distUp));
      }
      if (elevDiag !== null) {
        const distDiag = Math.sqrt(distRight * distRight + distUp * distUp);
        slopes.push(calculateSlopeAngle(elevDiag - elev, distDiag));
      }

      // Use maximum slope
      const maxSlope = slopes.length > 0 ? Math.max(...slopes) : 0;

      cells.push({
        lng: (lngs[i] + lngs[i + 1]) / 2,
        lat: (lats[j] + lats[j + 1]) / 2,
        slope: maxSlope,
        elevation: elev,
      });
    }
  }

  return cells;
}

/**
 * Get color for slope value (0-90 degrees)
 * Green (flat) -> Yellow -> Orange -> Red (steep)
 */
export function getSlopeColor(slopeDegrees: number, minSlope: number = 5): string {
  if (slopeDegrees < minSlope) {
    return 'transparent';
  }

  // Normalize slope to 0-1 range (5-45 degrees mapped to 0-1)
  const normalized = Math.min(1, Math.max(0, (slopeDegrees - minSlope) / 40));

  // Color gradient: transparent -> yellow -> orange -> red
  if (normalized < 0.33) {
    // Yellow to orange
    const t = normalized / 0.33;
    const r = 255;
    const g = Math.round(255 - t * 100);
    const b = 0;
    return `rgba(${r}, ${g}, ${b}, ${0.3 + normalized * 0.4})`;
  } else if (normalized < 0.66) {
    // Orange to red
    const t = (normalized - 0.33) / 0.33;
    const r = 255;
    const g = Math.round(155 - t * 100);
    const b = 0;
    return `rgba(${r}, ${g}, ${b}, ${0.5 + normalized * 0.3})`;
  } else {
    // Red to dark red
    const t = (normalized - 0.66) / 0.34;
    const r = Math.round(255 - t * 55);
    const g = Math.round(55 - t * 55);
    const b = 0;
    return `rgba(${r}, ${g}, ${b}, ${0.7 + normalized * 0.2})`;
  }
}

/**
 * Create GeoJSON from slope cells
 */
export function createSlopeGeoJSON(
  cells: SlopeCell[],
  cellSize: number,
  minSlope: number = 5
): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = [];

  for (const cell of cells) {
    if (cell.slope < minSlope) continue;

    // Create a small polygon for each cell
    const halfSize = cellSize / 2;
    const coords: GeoJSON.Position[] = [
      [cell.lng - halfSize, cell.lat - halfSize],
      [cell.lng + halfSize, cell.lat - halfSize],
      [cell.lng + halfSize, cell.lat + halfSize],
      [cell.lng - halfSize, cell.lat + halfSize],
      [cell.lng - halfSize, cell.lat - halfSize],
    ];

    features.push({
      type: 'Feature',
      geometry: {
        type: 'Polygon',
        coordinates: [coords],
      },
      properties: {
        slope: cell.slope,
        elevation: cell.elevation,
        color: getSlopeColor(cell.slope, minSlope),
      },
    });
  }

  return {
    type: 'FeatureCollection',
    features,
  };
}
