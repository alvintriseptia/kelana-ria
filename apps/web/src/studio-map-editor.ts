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

export function mountStudioMapEditor(options: StudioMapEditorOptions): { destroy: () => void } {
  const { container, config, record, mode, selectedTarget, onMapClick, onSelectTarget, onError } = options;
  container.innerHTML = `<div class="board-map-shell">
    <div class="board-map-canvas" role="region" aria-label="Editor peta interaktif Studio Kreator"></div>
    <p class="board-map-attribution">
      Mode peta: <strong>${mode}</strong> · ${config.mode === "geoapify-vector" ? "Peta vektor langsung" : "Peta vektor luring"} · © Geoapify · © OpenStreetMap contributors
    </p>
  </div>`;

  const canvasHost = container.querySelector<HTMLElement>(".board-map-canvas")!;
  const { boundaryFeatures, radiusFeatures } = buildGeoJson(record, selectedTarget);
  let map: maplibregl.Map | undefined;
  let destroyed = false;
  let styleLoaded = false;
  const markers: maplibregl.Marker[] = [];

  const bounds = new maplibregl.LngLatBounds();
  bounds.extend([record.snapshot.startPoint.longitude, record.snapshot.startPoint.latitude]);
  if (isClaimStudioPack(record.pack)) {
    for (const lm of record.pack.geography.landmarks) bounds.extend([lm.longitude, lm.latitude]);
  } else {
    for (const st of record.snapshot.stations) bounds.extend([st.longitude, st.latitude]);
  }

  function addMarker(
    coord: GeoCoordinate,
    label: string,
    classes: string[],
    target: { kind: "start" | "station" | "poi" | "landmark"; id: string },
  ) {
    if (!map) return;
    const btn = document.createElement("button");
    btn.type = "button";
    const isSel = selectedTarget?.kind === target.kind && selectedTarget?.id === target.id;
    btn.className = ["board-map-pin", ...classes, isSel ? "board-map-pin-selected" : ""].filter(Boolean).join(" ");
    btn.textContent = label;
    btn.setAttribute("aria-label", label);
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      onSelectTarget(target);
    });
    markers.push(new maplibregl.Marker({ element: btn }).setLngLat([coord.longitude, coord.latitude]).addTo(map));
  }

  function initMap(style: maplibregl.StyleSpecification) {
    if (destroyed) return;
    try {
      map = new maplibregl.Map({
        container: canvasHost,
        style,
        center: [record.snapshot.startPoint.longitude, record.snapshot.startPoint.latitude],
        zoom: 12.5,
        attributionControl: false,
        transformRequest: (url) => ({ url: absolutizeMapUrl(url) }),
      });
      map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");

      map.on("load", () => {
        styleLoaded = true;
        if (!map || destroyed) return;
        if (config.mode === "geoapify-vector") {
          if (!map.getSource("studio-boundary")) {
            map.addSource("studio-boundary", {
              type: "geojson",
              data: { type: "FeatureCollection", features: boundaryFeatures as never },
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
              data: { type: "FeatureCollection", features: radiusFeatures as never },
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
        map.fitBounds(bounds, { padding: 36, maxZoom: 14.5, duration: 0 });
      });

      map.on("click", (ev) => {
        onMapClick({
          latitude: Number(ev.lngLat.lat.toFixed(5)),
          longitude: Number(ev.lngLat.lng.toFixed(5)),
        });
      });

      map.on("error", () => {
        if (!styleLoaded) onError();
      });

      addMarker(record.snapshot.startPoint, `A · ${record.snapshot.startPoint.name}`, ["board-map-pin-start"], {
        kind: "start",
        id: record.snapshot.startPoint.id,
      });

      if (isClaimStudioPack(record.pack)) {
        const zoneLabelById = new Map(record.pack.geography.zones.map((z) => [z.id, z.label]));
        record.pack.geography.landmarks.forEach((lm, idx) => {
          const zl = zoneLabelById.get(lm.zoneId) ?? lm.zoneId;
          addMarker(lm, `${idx + 1} · [${zl}] ${lm.name}`, [], { kind: "landmark", id: lm.id });
        });
      } else {
        record.snapshot.stations.forEach((st, idx) => {
          addMarker(st, `${idx + 1} · ${st.name}`, st.eligibleHidingAnchor ? [] : ["board-map-pin-dimmed"], {
            kind: "station",
            id: st.id,
          });
        });
        record.snapshot.pois.forEach((poi) => {
          addMarker(poi, `★ ${poi.name}`, ["board-map-pin-claimed"], { kind: "poi", id: poi.id });
        });
      }
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
    initMap(offlineStudioStyle(boundaryFeatures, radiusFeatures));
  }

  return {
    destroy() {
      destroyed = true;
      for (const m of markers) m.remove();
      map?.remove();
      map = undefined;
    },
  };
}
