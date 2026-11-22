import polygonClipping, { type MultiPolygon, type Polygon } from "polygon-clipping";
import * as maplibregl from "maplibre-gl";
import maplibreWorkerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?url";
import "maplibre-gl/dist/maplibre-gl.css";
import type { GeoCoordinate, MapConfig, SeekDeductionOverlay, SeekMapPreview, SoloPoint } from "@kelana-ria/contracts";
import "./board-map.css";

maplibregl.setWorkerUrl(maplibreWorkerUrl);

export type BoardMapRadarCircle = {
  id: string;
  center: SoloPoint;
  radiusMeters: number;
  inside: boolean;
  preview?: "pending" | "correct" | "incorrect";
};

export type BoardMapPoint = SoloPoint & {
  label?: string;
  markerText?: string;
  markerKind?: "thermometer" | "seeker" | "station";
  claimed?: boolean;
  selectable?: boolean;
  dimmed?: boolean;
  statusTag?: "unclaimed" | "claimed" | "locked" | "shielded" | "double";
};

type BoardCamera = Pick<maplibregl.CameraOptions, "center" | "zoom" | "bearing" | "pitch">;

export type BoardMapOptions = {
  container: HTMLElement;
  config: MapConfig;
  start: SoloPoint;
  startSelectable?: boolean;
  startLabel?: string;
  camera?: BoardCamera;
  fitPadding?: maplibregl.PaddingOptions;
  focusPoints?: GeoCoordinate[];
  deductionBoundary?: GeoCoordinate[];
  thermometer?: { start: GeoCoordinate; end?: GeoCoordinate };
  checkpoints: BoardMapPoint[];
  selectedId?: string;
  radarCircles?: BoardMapRadarCircle[];
  deductionOverlays?: SeekDeductionOverlay[];
  hidingZone?: { center: GeoCoordinate; radiusMeters: number };
  onSelect?: (checkpointId: string) => void;
  onSelectStart?: () => void;
  onError?: (reason: string) => void;
};

export function circlePolygon(center: GeoCoordinate, radiusMeters: number, steps = 48): [number, number][] {
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
  ring[ring.length - 1] = ring[0];
  return ring;
}

function bisectorLine(start: GeoCoordinate, end: GeoCoordinate): [number, number][] {
  const midLat = (start.latitude + end.latitude) / 2;
  const midLng = (start.longitude + end.longitude) / 2;
  const dLat = end.latitude - start.latitude;
  const dLng = end.longitude - start.longitude;
  const scale = 2.5;
  return [
    [midLng - dLat * scale, midLat + dLng * scale],
    [midLng + dLat * scale, midLat - dLng * scale],
  ];
}

export function absolutizeMapUrl(value: string): string {
  if (!value.startsWith("/")) return value;
  return `${window.location.origin}${value}`;
}

export function absolutizeStyleSpec(raw: Record<string, unknown>): maplibregl.StyleSpecification {
  const cloned = structuredClone(raw);
  if (typeof cloned.sprite === "string") cloned.sprite = absolutizeMapUrl(cloned.sprite);
  if (typeof cloned.glyphs === "string") cloned.glyphs = absolutizeMapUrl(cloned.glyphs);
  if (cloned.sources && typeof cloned.sources === "object") {
    for (const source of Object.values(cloned.sources as Record<string, unknown>)) {
      if (!source || typeof source !== "object") continue;
      const src = source as Record<string, unknown>;
      if (typeof src.url === "string") src.url = absolutizeMapUrl(src.url);
      if (Array.isArray(src.tiles)) {
        src.tiles = src.tiles.map((t) => (typeof t === "string" ? absolutizeMapUrl(t) : t));
      }
    }
  }
  return cloned as unknown as maplibregl.StyleSpecification;
}

function buildOverlayFeatures(
  radarCircles: BoardMapRadarCircle[],
  deductionOverlays: SeekDeductionOverlay[],
  hidingZone?: { center: GeoCoordinate; radiusMeters: number },
) {
  const circleFeatures = [
    ...radarCircles.filter(circle => !circle.preview).map((circle) => ({
      type: "Feature" as const,
      properties: { id: circle.id, inside: circle.inside, preview: circle.preview ?? "" },
      geometry: {
        type: "Polygon" as const,
        coordinates: [circlePolygon(circle.center, circle.radiusMeters)],
      },
    })),
    ...deductionOverlays
      .filter((o): o is Extract<SeekDeductionOverlay, { type: "circle" | "voronoi" }> => o.type === "circle" || o.type === "voronoi")
      .map((overlay, idx) => ({
        type: "Feature" as const,
        properties: { id: `ded-${idx}`, inside: overlay.type === "circle" ? overlay.inside : !overlay.outside },
        geometry: {
          type: "Polygon" as const,
          coordinates: [circlePolygon(overlay.center, overlay.radiusMeters)],
        },
      })),
    ...(hidingZone
      ? [
          {
            type: "Feature" as const,
            properties: { id: "hiding-zone", inside: true },
            geometry: {
              type: "Polygon" as const,
              coordinates: [circlePolygon(hidingZone.center, hidingZone.radiusMeters)],
            },
          },
        ]
      : []),
  ];

  const bisectorFeatures = deductionOverlays
    .filter((o): o is Extract<SeekDeductionOverlay, { type: "bisector" }> => o.type === "bisector")
    .map((overlay, idx) => ({
      type: "Feature" as const,
      properties: { id: `bis-${idx}`, result: overlay.result },
      geometry: {
        type: "LineString" as const,
        coordinates: bisectorLine(overlay.start, overlay.end),
      },
    }));

  return { circleFeatures, bisectorFeatures };
}

function offlineVectorStyle(
  start: SoloPoint,
  checkpoints: BoardMapPoint[],
  radarCircles: BoardMapRadarCircle[],
  deductionOverlays: SeekDeductionOverlay[],
  hidingZone?: { center: GeoCoordinate; radiusMeters: number },
  showRadarFills = true,
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

  const { circleFeatures, bisectorFeatures } = buildOverlayFeatures(radarCircles, deductionOverlays, hidingZone);

  return {
    version: 8,
    sources: {
      corridors: {
        type: "geojson",
        data: { type: "FeatureCollection", features: corridorFeatures },
      },
      radars: {
        type: "geojson",
        data: { type: "FeatureCollection", features: circleFeatures },
      },
      bisectors: {
        type: "geojson",
        data: { type: "FeatureCollection", features: bisectorFeatures },
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
          "fill-opacity": showRadarFills ? 0.14 : 0,
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
      {
        id: "bisector-lines",
        type: "line",
        source: "bisectors",
        paint: {
          "line-color": "#7c3aed",
          "line-width": 2.5,
          "line-dasharray": [4, 2],
        },
      },
    ],
  };
}

function searchArea(boundary: GeoCoordinate[], circles: BoardMapRadarCircle[]): GeoJSON.FeatureCollection {
  if (boundary.length < 3 || circles.length === 0) return { type: "FeatureCollection", features: [] };
  const ring: Polygon[0] = boundary.map(point => [point.longitude, point.latitude]);
  ring.push(ring[0]);
  const board: Polygon = [ring];
  let possible: MultiPolygon = [board];
  for (const circle of circles) {
    if (!possible.length) break;
    const radar: Polygon = [circlePolygon(circle.center, circle.radiusMeters, 96)];
    possible = circle.inside ? polygonClipping.intersection(possible, radar) : polygonClipping.difference(possible, radar);
  }
  const excluded = possible.length ? polygonClipping.difference(board, possible) : [board];
  return {
    type: "FeatureCollection",
    features: [
      { type: "Feature", properties: { possible: true }, geometry: { type: "MultiPolygon", coordinates: possible } },
      { type: "Feature", properties: { possible: false }, geometry: { type: "MultiPolygon", coordinates: excluded } },
    ].filter(feature => feature.geometry.coordinates.length > 0) as GeoJSON.Feature[],
  };
}

function questionPreviewFeatures(preview?: SeekMapPreview): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = [];
  if (!preview) return { type: "FeatureCollection", features };
  const coordinates = (point: GeoCoordinate) => [point.longitude, point.latitude];
  const origin = coordinates(preview.reference);
  if (preview.radiusMeters !== undefined) {
    features.push({
      type: "Feature", properties: { kind: "radius" },
      geometry: { type: "Polygon", coordinates: [circlePolygon(preview.reference, preview.radiusMeters, 96)] },
    });
  }
  for (const target of preview.station ? [preview.station] : preview.targets ?? []) {
    const targetPoint = coordinates(target);
    if (preview.radiusMeters === undefined) {
      features.push({
        type: "Feature", properties: { kind: "connection" }, geometry: { type: "LineString", coordinates: [origin, targetPoint] },
      });
    }
    features.push({ type: "Feature", properties: { kind: "target" }, geometry: { type: "Point", coordinates: targetPoint } });
  }
  features.push({ type: "Feature", properties: { kind: "reference" }, geometry: { type: "Point", coordinates: origin } });
  return { type: "FeatureCollection", features };
}

export function mountBoardMap(options: BoardMapOptions) {
  const {
    container,
    config,
    start,
    startSelectable = false,
    startLabel,
    camera,
    fitPadding,
    focusPoints,
    deductionBoundary,
    thermometer,
    checkpoints,
    selectedId,
    radarCircles = [],
    deductionOverlays = [],
    hidingZone,
    onSelect,
    onSelectStart,
    onError,
  } = options;

  delete container.dataset.mapReady;
  container.innerHTML = `<div class="board-map-shell">
    <div class="board-map-canvas" role="region" aria-label="Peta interaktif papan permainan"></div>
    <p class="board-map-attribution">
      ${config.mode === "geoapify-vector" ? "Peta vektor langsung" : "Peta vektor luring"} ·
      <a href="https://www.geoapify.com/" target="_blank" rel="noopener noreferrer">© Geoapify</a> ·
      <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">© OpenStreetMap contributors</a> ·
      Transjakarta GTFS (CC BY 4.0) ·
      <a href="${config.mapLibreLicenseUrl}" target="_blank" rel="noopener noreferrer">MapLibre GL JS</a>
    </p>
  </div>`;

  const shell = container.querySelector<HTMLElement>(".board-map-shell")!;
  const attribution = shell.querySelector<HTMLElement>(".board-map-attribution")!;
  if (!deductionBoundary && radarCircles.length > 0) {
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
  for (const p of focusPoints ?? allPoints) bounds.extend([p.longitude, p.latitude]);

  let map: maplibregl.Map | undefined;
  let destroyed = false;
  let styleLoaded = false;
  let questionPreview: SeekMapPreview | undefined;
  let previewPadding: Required<maplibregl.PaddingOptions> | undefined;
  const markers: maplibregl.Marker[] = [];

  function focusQuestionPreview(padding: maplibregl.PaddingOptions) {
    if (!map || !questionPreview || !styleLoaded) return;
    const { reference, station, targets, radiusMeters } = questionPreview;
    const bounds = new maplibregl.LngLatBounds();
    for (const point of [reference, ...(station ? [station] : targets ?? [])]) bounds.extend([point.longitude, point.latitude]);
    if (radiusMeters !== undefined) {
      for (const point of circlePolygon(reference, radiusMeters, 16)) bounds.extend(point);
    }
    map.fitBounds(bounds, { padding, maxZoom: 16, duration: 0 });
  }

  function drawQuestionPreview() {
    if (!map || !styleLoaded) return;
    const source = map.getSource<maplibregl.GeoJSONSource>("question-draft");
    if (source) {
      source.setData(questionPreviewFeatures(questionPreview));
    } else if (questionPreview) {
      map.addSource("question-draft", { type: "geojson", data: questionPreviewFeatures(questionPreview) });
      map.addLayer({
        id: "question-draft-fill", source: "question-draft", type: "fill",
        filter: ["==", ["get", "kind"], "radius"],
        paint: { "fill-color": "#2664aa", "fill-opacity": 0.12 },
      });
      map.addLayer({
        id: "question-draft-outline", source: "question-draft", type: "line",
        filter: ["match", ["get", "kind"], ["radius", "connection"], true, false],
        paint: { "line-color": "#255d9f", "line-width": 3, "line-dasharray": [2, 2] },
      });
      map.addLayer({
        id: "question-draft-points", source: "question-draft", type: "circle",
        filter: ["match", ["get", "kind"], ["reference", "target"], true, false],
        paint: {
          "circle-color": ["case", ["==", ["get", "kind"], "reference"], "#255d9f", "#6745a8"],
          "circle-radius": ["case", ["==", ["get", "kind"], "reference"], 7, 5],
          "circle-stroke-color": "#fff",
          "circle-stroke-width": 2,
        },
      });
    }
    if (!questionPreview) {
      delete container.dataset.questionPreview;
      return;
    }
    container.dataset.questionPreview = String(questionPreview.radiusMeters ?? "point");
    if (previewPadding) {
      const { reference } = questionPreview;
      const { x, y } = map.project([reference.longitude, reference.latitude]);
      if (x < previewPadding.left || x > canvasHost.clientWidth - previewPadding.right ||
          y < previewPadding.top || y > canvasHost.clientHeight - previewPadding.bottom) {
        focusQuestionPreview(previewPadding);
      }
    }
  }

  function initMap(style: maplibregl.StyleSpecification) {
    if (destroyed) return;
    try {
      map = new maplibregl.Map({
        container: canvasHost,
        style,
        center: [start.longitude, start.latitude],
        zoom: 12.5,
        ...camera,
        attributionControl: false,
        transformRequest: (url) => ({ url: absolutizeMapUrl(url) }),
      });

      map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");

      map.on("load", () => {
        styleLoaded = true;
        if (!map || destroyed) return;
        const { circleFeatures, bisectorFeatures } = buildOverlayFeatures(radarCircles, deductionOverlays, hidingZone);
        if (deductionBoundary) {
          const data = searchArea(deductionBoundary, radarCircles.filter(circle => !circle.preview));
          if (data.features.length) {
            map.addSource("radar-search-area", { type: "geojson", data });
            map.addLayer({
              id: "radar-search-shading", type: "fill", source: "radar-search-area",
              paint: {
                "fill-color": ["case", ["get", "possible"], "#28a981", "#26384e"],
                "fill-opacity": ["case", ["get", "possible"], 0.27, 0.34],
              },
            }, map.getLayer("radar-outline") ? "radar-outline" : undefined);
          }
        }
        const preview = radarCircles.find(circle => circle.preview);
        if (preview) {
          const color = preview.preview === "correct" ? "#087b61" : preview.preview === "incorrect" ? "#bc2e29" : "#295c8d";
          map.addSource("radar-preview", {
            type: "geojson",
            data: { type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [circlePolygon(preview.center, preview.radiusMeters)] } },
          });
          map.addLayer({ id: "radar-preview-fill", type: "fill", source: "radar-preview", paint: { "fill-color": color, "fill-opacity": 0.12 } });
          map.addLayer({ id: "radar-preview-outline", type: "line", source: "radar-preview", paint: { "line-color": color, "line-width": 3, "line-dasharray": [2, 2] } });
        }
        if (config.mode === "geoapify-vector" && circleFeatures.length > 0 && !map.getSource("radars")) {
          map.addSource("radars", {
            type: "geojson",
            data: { type: "FeatureCollection", features: circleFeatures },
          });
          map.addLayer({
            id: "radar-fill",
            type: "fill",
            source: "radars",
            paint: {
              "fill-color": ["case", ["get", "inside"], "#0f766e", "#b45309"],
              "fill-opacity": deductionBoundary ? 0 : 0.16,
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
        if (config.mode === "geoapify-vector" && bisectorFeatures.length > 0 && !map.getSource("bisectors")) {
          map.addSource("bisectors", {
            type: "geojson",
            data: { type: "FeatureCollection", features: bisectorFeatures },
          });
          map.addLayer({
            id: "bisector-lines",
            type: "line",
            source: "bisectors",
            paint: {
              "line-color": "#7c3aed",
              "line-width": 2.5,
              "line-dasharray": [4, 2],
            },
          });
        }
        if (thermometer?.end) {
          map.addSource("thermometer-track", {
            type: "geojson",
            data: { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: [
              [thermometer.start.longitude, thermometer.start.latitude],
              [thermometer.end.longitude, thermometer.end.latitude],
            ] } },
          });
          map.addLayer({
            id: "thermometer-track-line", type: "line", source: "thermometer-track",
            paint: { "line-color": "#9f214b", "line-width": 4, "line-dasharray": [2, 2] },
          });
        }
        if (hidingZone && deductionBoundary && map.getLayer("radar-fill")) {
          map.setPaintProperty("radar-fill", "fill-opacity", ["case", ["==", ["get", "id"], "hiding-zone"], 0.16, 0]);
        }
        if (!camera && (focusPoints?.length ?? allPoints.length) > 1) {
          map.fitBounds(bounds, { padding: fitPadding ?? 36, maxZoom: 14.5, duration: 0 });
        }
        drawQuestionPreview();
        container.dataset.mapReady = "true";
      });

      map.on("error", () => {
        if (!styleLoaded) onError?.("tile-load-failed");
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
      startEl.textContent = startLabel ? `${startLabel} · ${start.name}` : `A · ${start.name}`;
      startEl.dataset.mapPoint = start.id;
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
          point.dimmed ? "board-map-pin-dimmed" : "",
          point.markerKind ? `board-map-pin-${point.markerKind}` : "",
          point.statusTag ? `board-map-pin-${point.statusTag}` : "",
          point.id === selectedId ? "board-map-pin-selected" : "",
        ]
          .filter(Boolean)
          .join(" ");
        if (point.markerKind === "station") el.title = point.name;
        el.dataset.mapPoint = point.id;
        el.textContent = point.markerText ?? (point.label ? `${index + 1} · ${point.name} · ${point.label}` : `${index + 1} · ${point.name}`);
        el.setAttribute(
          "aria-label",
          point.label ? `${point.name} (${point.label})` : point.name,
        );
        markers.push(new maplibregl.Marker({ element: el }).setLngLat([point.longitude, point.latitude]).addTo(map!));
      });
    } catch {
      onError?.("webgl-unavailable");
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
        if (!destroyed) onError?.("tile-load-failed");
      });
  } else {
    initMap(offlineVectorStyle(start, checkpoints, radarCircles, deductionOverlays, hidingZone, !deductionBoundary));
  }

  return {
    getCamera: () => map && styleLoaded ? { center: map.getCenter(), zoom: map.getZoom(), pitch: map.getPitch(), bearing: map.getBearing() } : undefined,
    setQuestionPreview(preview?: SeekMapPreview, padding?: Required<maplibregl.PaddingOptions>) {
      if (preview === questionPreview) return;
      questionPreview = preview;
      previewPadding = padding;
      drawQuestionPreview();
    },
    focusQuestionPreview,
    destroy() {
      destroyed = true;
      delete container.dataset.mapReady;
      delete container.dataset.questionPreview;
      for (const m of markers) m.remove();
      map?.remove();
      map = undefined;
    },
  };
}
