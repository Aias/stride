import { expect, test } from "bun:test";
import { datasetSchema } from "../src/data";
import { hasRoute, routeBounds, routeCollection } from "../src/routeGeometry";

const dataset = datasetSchema.parse(await Bun.file(new URL("../public/data/runs.json", import.meta.url)).json());

test("map features preserve route segment breaks and coordinates", () => {
  const collection = routeCollection(dataset.runs);
  const routed = dataset.runs.filter(hasRoute);
  expect(collection.features.length).toBe(routed.length);
  expect(routed.some(run => run.activityType === "walk")).toBe(true);
  for (const feature of collection.features) {
    const run = routed.find(run => run.id === feature.properties.id);
    if (!run) throw new Error("Map feature does not match a run");
    expect(feature.properties.activityType).toBe(run.activityType);
    const segments = new Map<number, number[][]>();
    for (const point of run.routePreview) {
      const coordinates = segments.get(point.segment) ?? [];
      coordinates.push([point.lon, point.lat]);
      segments.set(point.segment, coordinates);
    }
    expect(feature.geometry.coordinates).toEqual([...segments.values()].filter(points => points.length > 1));
  }
});

test("route bounds enclose all included coordinates and retain local scale for one run", () => {
  const bounds = routeBounds(dataset.runs);
  if (!bounds) throw new Error("Archive contains no route bounds");
  const points = routeCollection(dataset.runs).features.flatMap(feature => feature.geometry.coordinates.flat());
  expect(points.every(([lon, lat]) => lon !== undefined && lat !== undefined && lon >= bounds[0][0] && lon <= bounds[1][0] && lat >= bounds[0][1] && lat <= bounds[1][1])).toBe(true);
  const latest = dataset.runs.filter(hasRoute).toSorted((a, b) => b.day - a.day)[0];
  if (!latest) throw new Error("Archive contains no routed run");
  const local = routeBounds([latest]);
  if (!local) throw new Error("Routed run contains no bounds");
  expect(local[1][0] - local[0][0]).toBeLessThan(1);
  expect(local[1][1] - local[0][1]).toBeLessThan(1);
  expect(routeCollection([]).features).toEqual([]);
  expect(routeBounds([])).toBeNull();
});
