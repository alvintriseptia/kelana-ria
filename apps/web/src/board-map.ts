import * as maplibregl from "maplibre-gl";
import maplibreWorkerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?url";
import "maplibre-gl/dist/maplibre-gl.css";
import type { MapConfig, SoloPoint } from "@kelana-ria/contracts";
import "./board-map.css";

maplibregl.setWorkerUrl(maplibreWorkerUrl);

export type BoardMapRadarCircle = {
  id: string;
  center: SoloPoint;
  radiusMeters: number;
  inside: boolean;
};

export type BoardMapPoint = SoloPoint & {
  label?: string;
  claimed?: boolean;
  selectable?: boolean;
};

export type BoardMapOptions = {
  container: HTMLElement;
  config: MapConfig;
  start: SoloPoint;
  startSelectable?: boolean;
  checkpoints: BoardMapPoint[];
  selectedId?: string;
  radarCircles?: BoardMapRadarCircle[];
  onSelect?: (checkpointId: string) => void;
  onSelectStart?: () => void;
  onError?: (reason: string) => void;
};

function circlePolygon(center: SoloPoint, radiusMeters: number, steps = 48): [number, number][] {
  const earthRadius = 6_371_000;
  const latRad = (center.latitude * Math.PI) / 180;
  const ring: [number, number][] = [];
  for (let i = 0; i <= steps; i++) {
    const angle = (i / steps) * 2 * Math.PI;
    const dLat = (radiusMeters * Math.cos(angle)) / earthRadius;
    const dLng = (radiusMeters * Math.sin(angle)) / (earthRadius * Math.cos(latRad));
    ring.push([
      center.longitude + (dLng * 180) / Math.PI,
      center.latitude + (dLat * 180) / Math.PI,
    ]);
  }
  return ring;
}

function offlineVectorStyle(
  start: SoloPoint,
  checkpoints: BoardMapPoint[],
  radarCircles: BoardMapRadarCircle[],
): maplibregl.StyleSpecification {
  const corridorFeatures = checkpoints.map((point) => ({
    type: "Feature" as const,
    properties: { id: point.id },
    geometry: {
      type: "LineString" as const,
      coordinates: [
        [start.longitude, start.latitude],
        [point.longitude, point.latitude],
      ],
    },
  }));

  const radarFeatures = radarCircles.map((circle) => ({
    type: "Feature" as const,
    properties: { id: circle.id, inside: circle.inside },
    geometry: {
      type: "Polygon" as const,
      coordinates: [circlePolygon(circle.center, circle.radiusMeters)],
    },
  }));

  return {
    version: 8,
    sources: {
      corridors: {
        type: "geojson",
        data: { type: "FeatureCollection", features: corridorFeatures },
      },
      radars: {
        type: "geojson",
        data: { type: "FeatureCollection", features: radarFeatures },
      },
    },
    layers: [
      {
        id: "background",
        type: "background",
        paint: { "background-color": "#f3f4eb" },
      },
      {
        id: "corridor-lines",
        type: "line",
        source: "corridors",
        paint: {
          "line-color": "#94a399",
          "line-width": 2,
          "line-dasharray": [3, 2],
        },
      },
      {
        id: "radar-fill",
        type: "fill",
        source: "radars",
        paint: {
          "fill-color": ["case", ["get", "inside"], "#0f766e", "#b45309"],
          "fill-opacity": 0.14,
        },
      },
      {
        id: "radar-outline",
        type: "line",
        source: "radars",
        paint: {
          "line-color": ["case", ["get", "inside"], "#0f766e", "#b45309"],
          "line-width": 2,
        },
      },
    ],
  };
}

export function mountBoardMap(options: BoardMapOptions): { destroy: () => void } {
  const {
    container,
    config,
    start,
    startSelectable = false,
    checkpoints,
    selectedId,
    radarCircles = [],
    onSelect,
    onSelectStart,
    onError,
  } = options;

  container.innerHTML = `<div class="board-map-shell">
    <div class="board-map-canvas" role="region" aria-label="Peta interaktif papan permainan"></div>
    <p class="board-map-attribution">
      ${config.mode === "geoapify-vector" ? "Peta vektor langsung" : "Peta vektor luring (simulasi)"} ·
      <a href="https://www.geoapify.com/" target="_blank" rel="noopener noreferrer">© Geoapify</a> ·
      <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">© OpenStreetMap contributors</a> ·
      Transjakarta GTFS (CC BY 4.0) ·
      <a href="${config.mapLibreLicenseUrl}" target="_blank" rel="noopener noreferrer">MapLibre GL JS</a>
    </p>
  </div>`;

  const shell = container.querySelector<HTMLElement>(".board-map-shell")!;
  const attribution = shell.querySelector<HTMLElement>(".board-map-attribution")!;
  if (radarCircles.length > 0) {
    const radarList = document.createElement("ul");
    radarList.className = "board-map-radars";
    radarList.setAttribute("aria-label", "Lingkaran radar terkirim");
    for (const circle of radarCircles) {
      const item = document.createElement("li");
      item.dataset.radarInside = String(circle.inside);
      const badge = document.createElement("span");
      badge.className = `board-map-radar-badge ${circle.inside ? "board-map-radar-in" : "board-map-radar-out"}`;
      badge.textContent = circle.inside ? "Di dalam (Ya)" : "Di luar (Tidak)";
      const desc = document.createElement("span");
      desc.textContent = `Radar ${circle.radiusMeters} m · acuan ${circle.center.name}`;
      item.append(badge, desc);
      radarList.append(item);
    }
    shell.insertBefore(radarList, attribution);
  }

  const canvasHost = container.querySelector<HTMLElement>(".board-map-canvas")!;
  const allPoints: SoloPoint[] = [start, ...checkpoints, ...radarCircles.map((circle) => circle.center)];
  const bounds = new maplibregl.LngLatBounds();
  for (const p of allPoints) bounds.extend([p.longitude, p.latitude]);

  let map: maplibregl.Map | undefined;
  const markers: maplibregl.Marker[] = [];

  try {
    const style =
      config.mode === "geoapify-vector" && config.styleUrl
        ? config.styleUrl
        : offlineVectorStyle(start, checkpoints, radarCircles);

    map = new maplibregl.Map({
      container: canvasHost,
      style,
      center: [start.longitude, start.latitude],
      zoom: 12.5,
      attributionControl: false,
    });

    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");

    map.on("load", () => {
      if (!map) return;
      if (config.mode === "geoapify-vector" && radarCircles.length > 0 && !map.getSource("radars")) {
        map.addSource("radars", {
          type: "geojson",
          data: {
            type: "FeatureCollection",
            features: radarCircles.map((circle) => ({
              type: "Feature",
              properties: { id: circle.id, inside: circle.inside },
              geometry: {
                type: "Polygon",
                coordinates: [circlePolygon(circle.center, circle.radiusMeters)],
              },
            })),
          },
        });
        map.addLayer({
          id: "radar-fill",
          type: "fill",
          source: "radars",
          paint: {
            "fill-color": ["case", ["get", "inside"], "#0f766e", "#b45309"],
            "fill-opacity": 0.16,
          },
        });
        map.addLayer({
          id: "radar-outline",
          type: "line",
          source: "radars",
          paint: {
            "line-color": ["case", ["get", "inside"], "#0f766e", "#b45309"],
            "line-width": 2,
          },
        });
      }
      if (allPoints.length > 1) {
        map.fitBounds(bounds, { padding: 36, maxZoom: 14.5, duration: 0 });
      }
    });

    map.on("error", () => {
      onError?.("tile-load-failed");
    });

    // Add accessible start marker (distinct square badge + "A" label).
    const startEl = document.createElement(startSelectable ? "button" : "span");
    if (startEl instanceof HTMLButtonElement) {
      startEl.type = "button";
      startEl.addEventListener("click", () => (onSelectStart ? onSelectStart() : onSelect?.(start.id)));
    }
    startEl.className = [
      "board-map-pin",
      "board-map-pin-start",
      start.id === selectedId ? "board-map-pin-selected" : "",
    ]
      .filter(Boolean)
      .join(" ");
    startEl.textContent = `A · ${start.name}`;
    startEl.setAttribute("aria-label", `${start.name} (Titik awal)`);
    markers.push(new maplibregl.Marker({ element: startEl }).setLngLat([start.longitude, start.latitude]).addTo(map));

    // Add accessible checkpoint markers with text/shape ownership indicators (never color-only).
    checkpoints.forEach((point, index) => {
      const el = document.createElement(point.selectable ? "button" : "span");
      if (el instanceof HTMLButtonElement) {
        el.type = "button";
        el.addEventListener("click", () => onSelect?.(point.id));
      }
      el.className = [
        "board-map-pin",
        point.claimed ? "board-map-pin-claimed" : "",
        point.id === selectedId ? "board-map-pin-selected" : "",
      ]
        .filter(Boolean)
        .join(" ");
      el.textContent = point.label ? `${index + 1} · ${point.name} · ${point.label}` : `${index + 1} · ${point.name}`;
      el.setAttribute(
        "aria-label",
        point.label ? `${point.name} (${point.label})` : point.name,
      );
      markers.push(new maplibregl.Marker({ element: el }).setLngLat([point.longitude, point.latitude]).addTo(map!));
    });
  } catch {
    onError?.("webgl-unavailable");
  }

  return {
    destroy() {
      for (const m of markers) m.remove();
      map?.remove();
      map = undefined;
    },
  };
}
