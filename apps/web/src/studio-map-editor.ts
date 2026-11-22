import * as maplibregl from "maplibre-gl";
import type { GeoCoordinate, MapConfig } from "@kelana-ria/contracts";
import { absolutizeMapUrl, absolutizeStyleSpec, circlePolygon } from "./board-map";
import type { StudioVersionRecord } from "./studio-types";
import { isClaimStudioPack } from "./studio-types";

export type StudioMapMode = "select" | "add" | "move" | "boundary";
export type StudioMapLayer = "start" | "primary" | "poi" | "zone";

export type StudioMapEditorOptions = {
  container: HTMLElement;
  config: MapConfig;
  record: StudioVersionRecord;
  mode: StudioMapMode;
  selectedTarget: { kind: "start" | "station" | "poi" | "landmark"; id: string } | null;
  onMapClick: (coord: GeoCoordinate) => void;
  onSelectTarget: (target: { kind: "start" | "station" | "poi" | "landmark"; id: string }) => void;
  onError: () => void;
};

export type StudioMapUpdate = Pick<
  StudioMapEditorOptions,
  "record" | "mode" | "selectedTarget" | "onMapClick" | "onSelectTarget"
>;

export type StudioMapEditorHandle = {
  update: (next: StudioMapUpdate) => void;
  recenter: () => void;
  destroy: () => void;
};

function buildGeoJson(record: StudioVersionRecord, selectedTarget: StudioMapEditorOptions["selectedTarget"]) {
  const boundaryCoords = record.snapshot.boundaryPolygon.map((p) => [p.longitude, p.latitude]);
  if (boundaryCoords.length >= 3) {
    boundaryCoords.push(boundaryCoords[0]);
  }
  const boundaryFeatures =
    boundaryCoords.length >= 4
      ? [
          {
            type: "Feature" as const,
            properties: {},
            geometry: { type: "Polygon" as const, coordinates: [boundaryCoords] },
          },
        ]
      : [];

  let radiusCenter: GeoCoordinate | null = null;
  let radiusMeters = 0;
  if (selectedTarget) {
    if (selectedTarget.kind === "start") {
      radiusCenter = record.snapshot.startPoint;
      radiusMeters = isClaimStudioPack(record.pack)
        ? record.pack.geography.checkInRadiusMeters
        : record.pack.geography.hidingZoneRadiusMeters;
    } else if (selectedTarget.kind === "station") {
      const st = record.snapshot.stations.find((s) => s.id === selectedTarget.id);
      if (st) {
        radiusCenter = st;
        radiusMeters = isClaimStudioPack(record.pack) ? 100 : record.pack.geography.hidingZoneRadiusMeters;
      }
    } else if (selectedTarget.kind === "landmark" && isClaimStudioPack(record.pack)) {
      const lm = record.pack.geography.landmarks.find((l) => l.id === selectedTarget.id);
      if (lm) {
        radiusCenter = lm;
        radiusMeters = record.pack.geography.checkInRadiusMeters;
      }
    }
  }
  const radiusFeatures =
    radiusCenter && radiusMeters > 0
      ? [
          {
            type: "Feature" as const,
            properties: {},
            geometry: { type: "Polygon" as const, coordinates: [circlePolygon(radiusCenter, radiusMeters)] },
          },
        ]
      : [];

  return { boundaryFeatures, radiusFeatures };
}

function offlineStudioStyle(boundaryFeatures: unknown[], radiusFeatures: unknown[]): maplibregl.StyleSpecification {
  return {
    version: 8,
    sources: {
      "studio-boundary": {
        type: "geojson",
        data: { type: "FeatureCollection", features: boundaryFeatures as never },
      },
      "studio-radius": {
        type: "geojson",
        data: { type: "FeatureCollection", features: radiusFeatures as never },
      },
    },
    layers: [
      { id: "bg", type: "background", paint: { "background-color": "#f3f4eb" } },
      {
        id: "studio-boundary-fill",
        type: "fill",
        source: "studio-boundary",
        paint: { "fill-color": "#0f766e", "fill-opacity": 0.06 },
      },
      {
        id: "studio-boundary-line",
        type: "line",
        source: "studio-boundary",
        paint: { "line-color": "#153d34", "line-width": 2, "line-dasharray": [4, 2] },
      },
      {
        id: "studio-radius-fill",
        type: "fill",
        source: "studio-radius",
        paint: { "fill-color": "#d97706", "fill-opacity": 0.16 },
      },
      {
        id: "studio-radius-line",
        type: "line",
        source: "studio-radius",
        paint: { "line-color": "#d97706", "line-width": 2 },
      },
    ],
  };
}

type StudioTarget = NonNullable<StudioMapEditorOptions["selectedTarget"]>;
type MarkerEntry = {
  marker: maplibregl.Marker;
  el: HTMLButtonElement;
  customClassList: string[];
  target: StudioTarget;
  lat: number;
  lng: number;
};

function syncStudioPinClasses(el: HTMLElement, prev: string[], next: string[]): string[] {
  if (prev.length === next.length && prev.every((c, i) => c === next[i])) return prev;
  for (const cls of prev) {
    if (cls) el.classList.remove(cls);
  }
  for (const cls of next) {
    if (cls) el.classList.add(cls);
  }
  return next;
}

function computeStudioBounds(record: StudioVersionRecord): maplibregl.LngLatBounds {
  const bounds = new maplibregl.LngLatBounds();
  bounds.extend([record.snapshot.startPoint.longitude, record.snapshot.startPoint.latitude]);
  if (isClaimStudioPack(record.pack)) {
    for (const lm of record.pack.geography.landmarks) bounds.extend([lm.longitude, lm.latitude]);
  } else {
    for (const st of record.snapshot.stations) bounds.extend([st.longitude, st.latitude]);
  }
  return bounds;
}

export function mountStudioMapEditor(options: StudioMapEditorOptions): StudioMapEditorHandle {
  const { container, config, onError } = options;
  let current: StudioMapUpdate = {
    record: options.record,
    mode: options.mode,
    selectedTarget: options.selectedTarget,
    onMapClick: options.onMapClick,
    onSelectTarget: options.onSelectTarget,
  };

  container.innerHTML = `<div class="board-map-shell">
    <div class="board-map-canvas" role="region" aria-label="Editor peta interaktif Studio Kreator"></div>
    <p class="board-map-attribution">
      Mode peta: <strong data-studio-mode-label></strong> · ${config.mode === "geoapify-vector" ? "Peta vektor langsung" : "Peta vektor luring"} · © Geoapify · © OpenStreetMap contributors
    </p>
  </div>`;

  const canvasHost = container.querySelector<HTMLElement>(".board-map-canvas")!;
  const modeLabelEl = container.querySelector<HTMLElement>("[data-studio-mode-label]")!;
  modeLabelEl.textContent = current.mode;

  let map: maplibregl.Map | undefined;
  let destroyed = false;
  let styleLoaded = false;
  const markerMap = new Map<string, MarkerEntry>();

  function syncSources() {
    if (!map || !styleLoaded || destroyed) return;
    const { boundaryFeatures, radiusFeatures } = buildGeoJson(current.record, current.selectedTarget);
    const boundarySrc = map.getSource<maplibregl.GeoJSONSource>("studio-boundary");
    if (boundarySrc) {
      boundarySrc.setData({ type: "FeatureCollection", features: boundaryFeatures as never });
    }
    const radiusSrc = map.getSource<maplibregl.GeoJSONSource>("studio-radius");
    if (radiusSrc) {
      radiusSrc.setData({ type: "FeatureCollection", features: radiusFeatures as never });
    }
  }

  function syncMarkers() {
    if (!map || destroyed) return;
    const desired: {
      key: string;
      coord: GeoCoordinate;
      label: string;
      classes: string[];
      target: StudioTarget;
    }[] = [
      {
        key: `start:${current.record.snapshot.startPoint.id}`,
        coord: current.record.snapshot.startPoint,
        label: `A · ${current.record.snapshot.startPoint.name}`,
        classes: ["board-map-pin-start"],
        target: { kind: "start", id: current.record.snapshot.startPoint.id },
      },
    ];

    if (isClaimStudioPack(current.record.pack)) {
      const zoneLabelById = new Map(current.record.pack.geography.zones.map((z) => [z.id, z.label]));
      current.record.pack.geography.landmarks.forEach((lm, idx) => {
        const zl = zoneLabelById.get(lm.zoneId) ?? lm.zoneId;
        desired.push({
          key: `landmark:${lm.id}`,
          coord: lm,
          label: `${idx + 1} · [${zl}] ${lm.name}`,
          classes: [],
          target: { kind: "landmark", id: lm.id },
        });
      });
    } else {
      current.record.snapshot.stations.forEach((st, idx) => {
        desired.push({
          key: `station:${st.id}`,
          coord: st,
          label: `${idx + 1} · ${st.name}`,
          classes: st.eligibleHidingAnchor ? [] : ["board-map-pin-dimmed"],
          target: { kind: "station", id: st.id },
        });
      });
      current.record.snapshot.pois.forEach((poi) => {
        desired.push({
          key: `poi:${poi.id}`,
          coord: poi,
          label: `★ ${poi.name}`,
          classes: ["board-map-pin-claimed"],
          target: { kind: "poi", id: poi.id },
        });
      });
    }

    const seenKeys = new Set<string>();
    for (const item of desired) {
      seenKeys.add(item.key);
      const isSel =
        current.selectedTarget?.kind === item.target.kind && current.selectedTarget?.id === item.target.id;
      const classes = ["board-map-pin", ...item.classes, isSel ? "board-map-pin-selected" : ""].filter(Boolean);
      const existing = markerMap.get(item.key);
      if (existing) {
        existing.target = item.target;
        existing.customClassList = syncStudioPinClasses(existing.el, existing.customClassList, classes);
        if (existing.el.textContent !== item.label) existing.el.textContent = item.label;
        existing.el.setAttribute("aria-label", item.label);
        existing.el.dataset.mapPoint = item.target.id;
        if (existing.lat !== item.coord.latitude || existing.lng !== item.coord.longitude) {
          existing.lat = item.coord.latitude;
          existing.lng = item.coord.longitude;
          existing.marker.setLngLat([item.coord.longitude, item.coord.latitude]);
        }
      } else {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.classList.add(...classes);
        btn.textContent = item.label;
        btn.dataset.mapPoint = item.target.id;
        btn.setAttribute("aria-label", item.label);
        const entry: MarkerEntry = {
          marker: new maplibregl.Marker({ element: btn }).setLngLat([item.coord.longitude, item.coord.latitude]).addTo(map),
          el: btn,
          customClassList: classes,
          target: item.target,
          lat: item.coord.latitude,
          lng: item.coord.longitude,
        };
        btn.addEventListener("click", (e) => {
          e.stopPropagation();
          current.onSelectTarget(entry.target);
        });
        markerMap.set(item.key, entry);
      }
    }

    for (const [key, entry] of markerMap.entries()) {
      if (!seenKeys.has(key)) {
        entry.marker.remove();
        markerMap.delete(key);
      }
    }
  }

  function initMap(style: maplibregl.StyleSpecification) {
    if (destroyed) return;
    try {
      const { boundaryFeatures, radiusFeatures } = buildGeoJson(current.record, current.selectedTarget);
      map = new maplibregl.Map({
        container: canvasHost,
        style,
        center: [current.record.snapshot.startPoint.longitude, current.record.snapshot.startPoint.latitude],
        zoom: 12.5,
        attributionControl: false,
        transformRequest: (url) => ({ url: absolutizeMapUrl(url) }),
      });
      map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");

      map.on("load", () => {
        styleLoaded = true;
        if (!map || destroyed) return;
        const latestGeo = buildGeoJson(current.record, current.selectedTarget);
        if (config.mode === "geoapify-vector") {
          if (!map.getSource("studio-boundary")) {
            map.addSource("studio-boundary", {
              type: "geojson",
              data: { type: "FeatureCollection", features: latestGeo.boundaryFeatures as never },
            });
            map.addLayer({
              id: "studio-boundary-fill",
              type: "fill",
              source: "studio-boundary",
              paint: { "fill-color": "#0f766e", "fill-opacity": 0.06 },
            });
            map.addLayer({
              id: "studio-boundary-line",
              type: "line",
              source: "studio-boundary",
              paint: { "line-color": "#153d34", "line-width": 2, "line-dasharray": [4, 2] },
            });
          }
          if (!map.getSource("studio-radius")) {
            map.addSource("studio-radius", {
              type: "geojson",
              data: { type: "FeatureCollection", features: latestGeo.radiusFeatures as never },
            });
            map.addLayer({
              id: "studio-radius-fill",
              type: "fill",
              source: "studio-radius",
              paint: { "fill-color": "#d97706", "fill-opacity": 0.16 },
            });
            map.addLayer({
              id: "studio-radius-line",
              type: "line",
              source: "studio-radius",
              paint: { "line-color": "#d97706", "line-width": 2 },
            });
          }
        }
        syncSources();
        syncMarkers();
        map.fitBounds(computeStudioBounds(current.record), { padding: 36, maxZoom: 14.5, duration: 0 });
      });

      map.on("click", (ev) => {
        current.onMapClick({
          latitude: Number(ev.lngLat.lat.toFixed(5)),
          longitude: Number(ev.lngLat.lng.toFixed(5)),
        });
      });

      map.on("error", () => {
        if (!styleLoaded) onError();
      });

      syncMarkers();
    } catch {
      onError();
    }
  }

  if (config.mode === "geoapify-vector" && config.styleUrl) {
    void fetch(absolutizeMapUrl(config.styleUrl))
      .then(async (res) => {
        if (!res.ok) throw new Error(`style-${res.status}`);
        const raw = (await res.json()) as Record<string, unknown>;
        initMap(absolutizeStyleSpec(raw));
      })
      .catch(() => {
        if (!destroyed) onError();
      });
  } else {
    const { boundaryFeatures, radiusFeatures } = buildGeoJson(current.record, current.selectedTarget);
    initMap(offlineStudioStyle(boundaryFeatures, radiusFeatures));
  }

  return {
    update(next: StudioMapUpdate) {
      if (destroyed) return;
      current = next;
      modeLabelEl.textContent = current.mode;
      syncSources();
      syncMarkers();
    },
    recenter() {
      if (destroyed || !map) return;
      map.fitBounds(computeStudioBounds(current.record), { padding: 36, maxZoom: 14.5, duration: 250 });
    },
    destroy() {
      destroyed = true;
      for (const entry of markerMap.values()) entry.marker.remove();
      markerMap.clear();
      map?.remove();
      map = undefined;
    },
  };
}
