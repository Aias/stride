import { useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import { Map, NavigationControl, Popup, ScaleControl, setWorkerUrl } from "maplibre-gl";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import type { Run } from "./data";
import { hasRoute, routeBounds, routeCollection } from "./routeGeometry";
import type { RouteBounds } from "./routeGeometry";

type RouteMapProps = {
  allRuns: readonly Run[];
  runs: readonly Run[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
};

setWorkerUrl(workerUrl);

const sourceId = "run-routes";
const routesLayerId = "run-routes-visible";
const selectedLayerId = "run-route-selected";
const hitLayerId = "run-route-targets";
const styleUrl = "https://tiles.openfreemap.org/styles/positron";

function latestRoutedRun(runs: readonly Run[]) {
  let latest: Run | null = null;
  for (const run of runs) {
    if (hasRoute(run) && (latest === null || run.day > latest.day)) latest = run;
  }
  return latest;
}

function fit(map: Map, bounds: RouteBounds | null) {
  if (bounds) map.fitBounds(bounds, { padding: 56, duration: 0 });
}

export function RouteMap({ allRuns, runs, selectedId, onSelect }: RouteMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<Map>(null);
  const [message, setMessage] = useState<string | null>("Loading map…");
  const routes = useMemo(() => routeCollection(allRuns), [allRuns]);
  const routedIds = useMemo(() => new Set(routes.features.map(feature => feature.properties.id)), [routes]);
  const selectedRun = allRuns.find(run => run.id === selectedId) ?? null;
  const selectedRoute = selectedRun !== null && routedIds.has(selectedRun.id) ? selectedRun : null;
  const [initialBounds] = useState(() => {
    const selected = allRuns.find(run => run.id === selectedId && hasRoute(run));
    const initialRun = selected ?? latestRoutedRun(allRuns);
    return routeBounds(initialRun ? [initialRun] : []);
  });
  const visibleRoutedRuns = runs.filter(run => routedIds.has(run.id));
  const onRouteSelect = useEffectEvent((id: string | null) => onSelect(id));
  const synchronize = useEffectEvent(() => {
    const map = mapRef.current;
    if (!map || !map.getLayer(routesLayerId) || !map.getLayer(selectedLayerId) || !map.getLayer(hitLayerId)) return;
    const visibleIds = runs.map(run => run.id);
    map.setFilter(hitLayerId, ["in", ["get", "id"], ["literal", visibleIds]]);
    map.setFilter(routesLayerId, ["all", ["in", ["get", "id"], ["literal", visibleIds]], ["!=", ["get", "id"], selectedId ?? ""]]);
    map.setFilter(selectedLayerId, ["all", ["in", ["get", "id"], ["literal", visibleIds]], ["==", ["get", "id"], selectedId ?? ""]]);
  });

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    setMessage("Loading map…");
    const map = new Map({ container, style: styleUrl, bounds: initialBounds ?? undefined, fitBoundsOptions: { padding: 56 } });
    const popup = new Popup({ closeButton: false, closeOnClick: false, offset: 10 });
    mapRef.current = map;
    map.addControl(new NavigationControl({ showCompass: false }), "top-right");
    map.addControl(new ScaleControl({ unit: "imperial" }), "bottom-right");
    const resizeObserver = new ResizeObserver(() => map.resize());
    resizeObserver.observe(container);

    map.on("load", () => {
      map.addSource(sourceId, { type: "geojson", data: routes });
      map.addLayer({
        id: routesLayerId,
        type: "line",
        source: sourceId,
        paint: { "line-color": ["match", ["get", "activityType"], "walk", "#d07744", "#24765c"], "line-width": 2, "line-opacity": 0.28 },
      });
      map.addLayer({
        id: hitLayerId,
        type: "line",
        source: sourceId,
        paint: { "line-width": 10, "line-opacity": 0 },
      });
      map.addLayer({
        id: selectedLayerId,
        type: "line",
        source: sourceId,
        paint: { "line-color": "#1769ed", "line-width": 3, "line-opacity": 1 },
      });
      synchronize();
      setMessage(null);
    });

    const showFeature = (event: { features?: { properties: { label?: unknown } }[], lngLat: { lng: number, lat: number } }) => {
      const label = event.features?.[0]?.properties.label;
      if (typeof label !== "string") return;
      map.getCanvas().style.cursor = "pointer";
      popup.setLngLat(event.lngLat).setText(label).addTo(map);
    };
    const hideFeature = () => {
      map.getCanvas().style.cursor = "";
      popup.remove();
    };
    map.on("click", event => {
      if (!map.getLayer(hitLayerId)) return;
      const id: unknown = map.queryRenderedFeatures(event.point, { layers: [hitLayerId] })[0]?.properties.id;
      onRouteSelect(typeof id === "string" ? id : null);
    });
    map.on("mousemove", hitLayerId, showFeature);
    map.on("mouseleave", hitLayerId, hideFeature);
    map.on("error", () => setMessage("Some map content could not be loaded."));
    map.on("idle", () => setMessage(null));

    return () => {
      resizeObserver.disconnect();
      popup.remove();
      map.remove();
      mapRef.current = null;
    };
  }, [routes]);

  useEffect(() => synchronize());

  function fitVisibleRoutes() {
    const map = mapRef.current;
    if (map) fit(map, routeBounds(visibleRoutedRuns));
  }

  function focusSelected() {
    const map = mapRef.current;
    if (map) fit(map, routeBounds(selectedRoute ? [selectedRoute] : []));
  }

  function resetView() {
    const map = mapRef.current;
    if (map) fit(map, initialBounds);
  }

  return <section className="route-map-panel" aria-label="Activity routes">
    <div className="route-map-toolbar" aria-label="Map controls">
      <button type="button" onClick={fitVisibleRoutes} disabled={visibleRoutedRuns.length === 0}>Fit routes</button>
      <button type="button" onClick={focusSelected} disabled={selectedRoute === null}>Focus selected</button>
      <button type="button" onClick={resetView} disabled={initialBounds === null}>Reset view</button>
      <span className="route-map-count">{visibleRoutedRuns.length} {visibleRoutedRuns.length === 1 ? "route" : "routes"}</span>
    </div>
    <div className="route-map-frame">
      <div ref={containerRef} className="route-map" role="group" aria-label={`Street map showing ${visibleRoutedRuns.length} activities. Drag to pan, scroll to zoom, or use the map controls.`}/>
      {message ? <p className="route-map-status" role="status">{message}</p> : null}
      {visibleRoutedRuns.length === 0 ? <p className="route-map-status">No outdoor route coordinates match these filters.</p> : null}
    </div>
  </section>;
}
