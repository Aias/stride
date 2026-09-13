import type { Feature, FeatureCollection, MultiLineString, Position } from "geojson";
import { formatDate, number } from "./data";
import type { Point, Run } from "./data";

export type RouteBounds = [[number, number], [number, number]];
type RouteProperties = { id: string; label: string; activityType: Run["activityType"] };

function routeLines(points: readonly Point[]): Position[][] {
  const segments = new Map<number, Position[]>();
  for (const point of points) {
    const segment = segments.get(point.segment);
    const coordinate = [point.lon, point.lat];
    if (segment) segment.push(coordinate);
    else segments.set(point.segment, [coordinate]);
  }
  return [...segments.values()].filter(segment => segment.length > 1);
}

export function hasRoute(run: Run) {
  return routeLines(run.routePreview).length > 0;
}

export function routeCollection(runs: readonly Run[]): FeatureCollection<MultiLineString, RouteProperties> {
  const features: Feature<MultiLineString, RouteProperties>[] = [];
  for (const run of runs) {
    const coordinates = routeLines(run.routePreview);
    if (coordinates.length === 0) continue;
    const distance = run.miles === null ? "distance unavailable" : `${number.format(run.miles)} miles`;
    features.push({
      type: "Feature",
      properties: { id: run.id, activityType: run.activityType, label: `${run.activityType === "run" ? "Run" : "Walk"} · ${formatDate(run.day)}, ${distance}` },
      geometry: { type: "MultiLineString", coordinates },
    });
  }
  return { type: "FeatureCollection", features };
}

export function routeBounds(runs: readonly Run[]): RouteBounds | null {
  let west = Infinity;
  let east = -Infinity;
  let south = Infinity;
  let north = -Infinity;
  let found = false;
  for (const run of runs) {
    for (const line of routeLines(run.routePreview)) {
      for (const [longitude, latitude] of line) {
        if (longitude === undefined || latitude === undefined) continue;
        west = Math.min(west, longitude);
        east = Math.max(east, longitude);
        south = Math.min(south, latitude);
        north = Math.max(north, latitude);
        found = true;
      }
    }
  }
  return found ? [[west, south], [east, north]] : null;
}
