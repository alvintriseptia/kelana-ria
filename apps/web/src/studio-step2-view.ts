import type {
  ClaimLandmarkDefinition,
  ClaimZoneDefinition,
  GeoCoordinate,
  GeoPoi,
  GeoSnapshot,
  GeoStation,
  StudioPointProvenance,
  TransitMode,
} from "@kelana-ria/contracts";
import { escapeText } from "./escape-text";
import { mapPinIconSvg } from "./studio-assets";
import { renderClaimChallenges, type ClaimStep3State } from "./studio-claim-builder";
import type {
  StudioMapMode,
  StudioTransitMode,
  StudioTransitPin,
} from "./studio-map-editor";
import { isClaimStudioPack, type StudioPack, type StudioVersionRecord } from "./studio-types";

export type JakartaTransitStation = {
  id: string;
  name: string;
  lat: number;
  lng: number;
  mode: StudioTransitMode;
  corridor: string;
};

export type JakartaTransitCatalog = {
  version: string;
  generatedAt: string;
  attribution: string;
  sources: string[];
  stations: JakartaTransitStation[];
};

export type Step2Target = { kind: "start" | "station" | "poi" | "landmark"; id: string };
export type Step2Tab = "primary" | "secondary" | "pois" | "start" | "boundary";

export type Step2UndoEntry = {
  pack: StudioPack;
  snapshot: GeoSnapshot;
  selected: Step2Target | null;
  subTab: Step2Tab;
  zoneId: string | null;
  vertex: number | null;
  label: string;
};

export type Step2State = {
  mapMode: StudioMapMode;
  subTab: Step2Tab;
  selected: Step2Target | null;
  mapFailed: boolean;
  lastClickedCoord: GeoCoordinate | null;
  transitCatalog: JakartaTransitCatalog | null;
  enabledTransitModes: Record<StudioTransitMode, boolean>;
  excludedTransitIds: Set<string>;
  transitQuery: string;
  transitFilter: StudioTransitMode | "all";
  drawer: "points" | "transit" | "osm-pois" | null;
  pointQuery: string;
  pointPage: number;
  zoneId: string | null;
  vertex: number | null;
  editingChallenges: boolean;
  saved: boolean;
  undoStack: Step2UndoEntry[];
  locatingGps: boolean;
  gpsFeedback: string;
  gpsError: string;
};

const TRANSIT_MODE_META: { mode: StudioTransitMode; label: string }[] = [
  { mode: "mrt", label: "MRT" },
  { mode: "lrt", label: "LRT" },
  { mode: "krl", label: "KRL" },
  { mode: "transjakarta", label: "TJ" },
];

export function pointInBoundary(
  coord: { latitude: number; longitude: number },
  polygon: GeoCoordinate[],
): boolean {
  if (polygon.length < 3) return false;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].longitude;
    const yi = polygon[i].latitude;
    const xj = polygon[j].longitude;
    const yj = polygon[j].latitude;
    const intersect =
      yi > coord.latitude !== yj > coord.latitude &&
      coord.longitude < ((xj - xi) * (coord.latitude - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

export function approxMeters(a: GeoCoordinate, b: GeoCoordinate): number {
  const rad = Math.PI / 180;
  const dLat = (b.latitude - a.latitude) * rad;
  const dLng = (b.longitude - a.longitude) * rad;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.latitude * rad) * Math.cos(b.latitude * rad) * Math.sin(dLng / 2) ** 2;
  return 12_742_000 * Math.asin(Math.sqrt(Math.min(1, s)));
}

export function findCatalogStationMatchIndex(
  stations: GeoStation[],
  item: JakartaTransitStation,
): number {
  const exact = stations.findIndex((s) => s.id === item.id);
  if (exact >= 0) return exact;
  return stations.findIndex(
    (s) => approxMeters(s, { latitude: item.lat, longitude: item.lng }) < 60,
  );
}

function buildStationAttributes(
  item: JakartaTransitStation,
  pack: StudioPack,
  existingStations: GeoStation[],
): Record<string, string> {
  const attrs: Record<string, string> = {
    mode: item.mode,
    corridor: item.corridor,
    source: "built-in-jakarta",
  };
  let nearest: GeoStation | null = null;
  let bestDist = Infinity;
  for (const st of existingStations) {
    const dist = approxMeters(st, { latitude: item.lat, longitude: item.lng });
    if (dist < bestDist) {
      bestDist = dist;
      nearest = st;
    }
  }
  if (!isClaimStudioPack(pack)) {
    const matchingItems = pack.investigationBook.families.matching?.items ?? [];
    for (const m of matchingItems) {
      if (m.matchType === "station_attribute" && m.attributeKey) {
        attrs[m.attributeKey] =
          nearest?.attributes?.[m.attributeKey] ?? (m.attributeKey === "corridor" ? item.corridor : "Jakarta");
      }
    }
  }
  if (!attrs.kecamatan) attrs.kecamatan = nearest?.attributes?.kecamatan ?? "Jakarta";
  return attrs;
}

export function createStationFromCatalog(
  item: JakartaTransitStation,
  pack: StudioPack,
  snap: GeoSnapshot,
): GeoStation {
  const coord = { latitude: item.lat, longitude: item.lng };
  const travelMs = Math.round((approxMeters(snap.startPoint, coord) / 5) * 1000 + 300_000);
  return {
    id: item.id,
    name: item.name,
    latitude: item.lat,
    longitude: item.lng,
    transitLines: [item.corridor],
    attributes: buildStationAttributes(item, pack, snap.stations),
    eligibleHidingAnchor: true,
    accessNotes: `Titik transit bawaan Jakarta (${item.mode.toUpperCase()}).`,
    publicHours: "05:00-24:00",
    estimatedTravelFromStartMs: Math.min(Math.max(travelMs, 180_000), 3_600_000),
  };
}

export function buildTransitOverlayPins(
  record: StudioVersionRecord,
  state: Step2State,
): StudioTransitPin[] {
  const stations = state.transitCatalog?.stations ?? [];
  return stations
    .filter(st => state.enabledTransitModes[st.mode] && (state.transitFilter === "all" || st.mode === state.transitFilter))
    .map((st) => {
      const inBoundary = pointInBoundary(
        { latitude: st.lat, longitude: st.lng },
        record.snapshot.boundaryPolygon,
      );
      const included = findCatalogStationMatchIndex(record.snapshot.stations, st) >= 0;
      return { ...st, inBoundary, included };
    });
}

function addPackTransitMode(pack: StudioPack, mode: TransitMode) {
  if (!pack.geography.allowedTransitModes.includes(mode)) {
    pack.geography.allowedTransitModes.push(mode);
  }
}

export function syncModeStationsInDraft(
  pack: StudioPack,
  snap: GeoSnapshot,
  state: Step2State,
  mode: StudioTransitMode,
  enabled: boolean,
): void {
  const catalog = state.transitCatalog?.stations ?? [];
  const ofMode = catalog.filter((st) => st.mode === mode);
  if (enabled) {
    addPackTransitMode(pack, mode);
    for (const item of ofMode) {
      if (state.excludedTransitIds.has(item.id)) continue;
      if (!pointInBoundary({ latitude: item.lat, longitude: item.lng }, snap.boundaryPolygon)) continue;
      if (findCatalogStationMatchIndex(snap.stations, item) === -1) {
        snap.stations.push(createStationFromCatalog(item, pack, snap));
      }
    }
  } else {
    snap.stations = snap.stations.filter((s) => {
      if (s.attributes?.source === "built-in-jakarta" && s.attributes?.mode === mode) return false;
      const matchesMode = ofMode.some((item) => item.id === s.id);
      return !matchesMode;
    });
  }
}

export function toggleCatalogStationInDraft(
  pack: StudioPack,
  snap: GeoSnapshot,
  state: Step2State,
  stationId: string,
): { name: string; included: boolean } | null {
  const item = state.transitCatalog?.stations.find((s) => s.id === stationId);
  if (!item) return null;
  const idx = findCatalogStationMatchIndex(snap.stations, item);
  if (idx >= 0) {
    snap.stations.splice(idx, 1);
    state.excludedTransitIds.add(item.id);
    return { name: item.name, included: false };
  }
  state.excludedTransitIds.delete(item.id);
  state.enabledTransitModes[item.mode] = true;
  addPackTransitMode(pack, item.mode);
  snap.stations.push(createStationFromCatalog(item, pack, snap));
  return { name: item.name, included: true };
}

export function syncBoundaryTransitStationsInDraft(
  pack: StudioPack,
  snap: GeoSnapshot,
  state: Step2State,
): void {
  const catalog = state.transitCatalog?.stations ?? [];
  const byId = new Map(catalog.map((s) => [s.id, s]));
  snap.stations = snap.stations.filter((st) => {
    if (st.attributes?.source !== "built-in-jakarta") return true;
    const cat = byId.get(st.id);
    if (!cat) return true;
    return state.enabledTransitModes[cat.mode] && pointInBoundary(st, snap.boundaryPolygon);
  });
  for (const item of catalog) {
    if (!state.enabledTransitModes[item.mode] || state.excludedTransitIds.has(item.id)) continue;
    if (!pointInBoundary({ latitude: item.lat, longitude: item.lng }, snap.boundaryPolygon)) continue;
    if (findCatalogStationMatchIndex(snap.stations, item) === -1) {
      snap.stations.push(createStationFromCatalog(item, pack, snap));
    }
  }
}

export function ensureStep2Selection(record: StudioVersionRecord, state: Step2State): Step2Target | null {
  if (state.selected) {
    if (state.selected.kind === "start") return state.selected;
    if (state.selected.kind === "station" && record.snapshot.stations.some((s) => s.id === state.selected!.id)) {
      return state.selected;
    }
    if (state.selected.kind === "poi" && record.snapshot.pois.some((p) => p.id === state.selected!.id)) {
      return state.selected;
    }
    if (
      state.selected.kind === "landmark" &&
      isClaimStudioPack(record.pack) &&
      record.pack.geography.landmarks.some((l) => l.id === state.selected!.id)
    ) {
      return state.selected;
    }
  }
  if (isClaimStudioPack(record.pack)) {
    const first = record.pack.geography.landmarks[0];
    state.selected = first
      ? { kind: "landmark", id: first.id }
      : { kind: "start", id: record.snapshot.startPoint.id };
  } else {
    const first = record.snapshot.stations[0];
    state.selected = first
      ? { kind: "station", id: first.id }
      : { kind: "start", id: record.snapshot.startPoint.id };
  }
  return state.selected;
}

export function updateStationAttributes(
  existing: Record<string, string> | undefined,
  kecamatan: string,
  corridor: string,
): Record<string, string> {
  const next: Record<string, string> = { ...(existing ?? {}) };
  if (kecamatan) next.kecamatan = kecamatan;
  else delete next.kecamatan;
  if (corridor) next.corridor = corridor;
  else delete next.corridor;
  return next;
}

function renderCoordAccordion(
  id: string,
  latId: string,
  lngId: string,
  latitude: number,
  longitude: number,
  dis: string,
): string {
  return `<details class="rb-accordion studio-coord-accordion" data-studio-accordion="coord-inspector" data-testid="coord-advanced">
    <summary>Koordinat &amp; ID (Lanjutan)</summary>
    <div class="studio-coord-body">
      <small>ID: <code>${escapeText(id)}</code></small>
      <div class="rb-grid-2">
        <label class="rb-field"><span>Latitude</span><input id="${latId}" type="number" step="0.00001" value="${latitude}" ${dis}></label>
        <label class="rb-field"><span>Longitude</span><input id="${lngId}" type="number" step="0.00001" value="${longitude}" ${dis}></label>
      </div>
    </div>
  </details>`;
}

function renderInspector(
  record: StudioVersionRecord,
  selected: Step2Target | null,
  editable: boolean,
  locatingGps: boolean,
): string {
  if (!selected) return "";
  const dis = editable ? "" : "disabled";
  const gpsBtn = editable
    ? `<button type="button" class="secondary" data-map-action="gps-move-selected" data-testid="studio-gps-move" ${locatingGps ? "disabled" : ""}>${locatingGps ? "Mencari lokasi…" : "Pakai Lokasi Saya"}</button>`
    : "";

  if (selected.kind === "start") {
    const sp = record.snapshot.startPoint;
    return `<details class="rb-accordion" open data-testid="step2-inspector">
      <summary data-studio-point-heading>${escapeText(sp.name)} (Titik Awal)</summary>
      <div class="rb-grid-2">
        <label class="rb-field"><span>Nama Titik Awal</span><input id="ed-sp-name" value="${escapeText(sp.name)}" ${dis}></label>
        <label class="rb-field"><span>Catatan Akses</span><input id="ed-sp-notes" value="${escapeText(sp.accessNotes ?? "")}" ${dis}></label>
      </div>
      ${renderCoordAccordion(sp.id, "ed-sp-lat", "ed-sp-lng", sp.latitude, sp.longitude, dis)}
      ${editable ? `<div class="rb-actions"><button type="button" class="primary" data-map-action="apply-selected">Terapkan Titik Awal</button>${gpsBtn}</div>` : ""}
    </details>`;
  }

  if (selected.kind === "station") {
    const idx = record.snapshot.stations.findIndex((s) => s.id === selected.id);
    const st = record.snapshot.stations[idx];
    if (!st) return "";
    const nameInputId = idx === 0 ? "ed-station-name" : "ed-point-name";
    return `<details class="rb-accordion" open data-testid="step2-inspector">
      <summary data-studio-point-heading>${escapeText(st.name)}</summary>
      <div class="rb-grid-2">
        <label class="rb-field"><span>Nama Stasiun</span><input id="${nameInputId}" data-field="name" value="${escapeText(st.name)}" ${dis}></label>
        <label class="rb-field"><span>Jalur Transit (pisahkan koma)</span><input id="ed-st-lines" value="${escapeText(st.transitLines.join(", "))}" ${dis}></label>
        <label class="rb-field"><span>Wilayah / Kecamatan</span><input id="ed-st-attr-kecamatan" value="${escapeText(st.attributes?.kecamatan ?? "")}" placeholder="Mis. Kebayoran Baru" ${dis}></label>
        <label class="rb-field"><span>Koridor / Area</span><input id="ed-st-attr-corridor" value="${escapeText(st.attributes?.corridor ?? "")}" placeholder="Mis. Selatan" ${dis}></label>
        <label class="rb-field"><span>Jam Publik</span><input id="ed-st-hours" value="${escapeText(st.publicHours ?? "05:00-23:00")}" ${dis}></label>
        <label class="rb-field"><span>Estimasi Tempuh (menit)</span><input id="ed-st-travel" type="number" value="${Math.round((st.estimatedTravelFromStartMs ?? 600_000) / 60_000)}" ${dis}></label>
        <label class="rb-field"><span>Bisa Jadi Titik Sembunyi</span>
          <select id="ed-st-anchor" ${dis}>
            <option value="true" ${st.eligibleHidingAnchor ? "selected" : ""}>Ya</option>
            <option value="false" ${!st.eligibleHidingAnchor ? "selected" : ""}>Tidak</option>
          </select>
        </label>
      </div>
      <label class="rb-field"><span>Catatan Akses Publik</span><input id="ed-st-notes" value="${escapeText(st.accessNotes ?? "")}" ${dis}></label>
      ${renderCoordAccordion(st.id, "ed-st-lat", "ed-st-lng", st.latitude, st.longitude, dis)}
      ${
        editable
          ? `<div class="rb-actions">
              <button type="button" class="primary" data-map-action="apply-selected">Simpan titik</button>
              ${gpsBtn}
              <button type="button" class="secondary" data-map-action="delete-selected">Hapus Stasiun</button>
            </div>`
          : ""
      }
    </details>`;
  }

  if (selected.kind === "poi") {
    const poi = record.snapshot.pois.find((p) => p.id === selected.id);
    if (!poi) return "";
    return `<details class="rb-accordion" open data-testid="step2-inspector">
      <summary data-studio-point-heading>${escapeText(poi.name)} (POI) ${fieldVerificationBadge(poi)}</summary>
      <div class="rb-grid-2">
        <label class="rb-field"><span>Nama POI</span><input id="ed-poi-name" value="${escapeText(poi.name)}" ${dis}></label>
        <label class="rb-field"><span>Kategori POI</span><input id="ed-poi-cat" value="${escapeText(poi.category)}" ${dis}></label>
      </div>
      ${renderCoordAccordion(poi.id, "ed-poi-lat", "ed-poi-lng", poi.latitude, poi.longitude, dis)}
      ${
        editable
          ? `<div class="rb-actions">
              <button type="button" class="primary" data-map-action="apply-selected">Simpan titik</button>
              ${gpsBtn}
              <button type="button" class="secondary" data-map-action="delete-selected">Hapus POI</button>
            </div>`
          : ""
      }
    </details>`;
  }

  if (selected.kind === "landmark" && isClaimStudioPack(record.pack)) {
    const idx = record.pack.geography.landmarks.findIndex((l) => l.id === selected.id);
    const lm = record.pack.geography.landmarks[idx];
    if (!lm) return "";
    const nameInputId = idx === 0 ? "ed-claim-landmark-name" : "ed-point-name";
    return `<details class="rb-accordion" open data-testid="step2-inspector">
      <summary data-studio-point-heading>${escapeText(lm.name)} ${fieldVerificationBadge(lm)}</summary>
      <button type="button" class="studio-tool" data-map-action="edit-challenges">Sunting tantangan landmark</button>
      <div class="rb-grid-2">
        <label class="rb-field"><span>Nama Landmark</span><input id="${nameInputId}" data-field="name" value="${escapeText(lm.name)}" ${dis}></label>
        <label class="rb-field"><span>Zona</span>
          <select id="ed-lm-zone" ${dis}>
            ${record.pack.geography.zones
              .map((z) => `<option value="${escapeText(z.id)}" ${z.id === lm.zoneId ? "selected" : ""}>${escapeText(z.label)} · ${escapeText(z.name)}</option>`)
              .join("")}
          </select>
        </label>
        <label class="rb-field"><span>Ringkasan Transit</span><input id="ed-lm-transit" value="${escapeText(lm.transitSummary)}" ${dis}></label>
        <label class="rb-field"><span>Jam Publik</span><input id="ed-lm-hours" value="${escapeText(lm.publicHours)}" ${dis}></label>
        <label class="rb-field"><span>Tempuh dari Mulai (menit)</span><input id="ed-lm-travel" type="number" value="${Math.round((lm.estimatedTravelFromStartMs ?? 600_000) / 60_000)}" ${dis}></label>
        <label class="rb-field"><span>Estimasi Tantangan (menit)</span><input id="ed-lm-chal" type="number" value="${Math.round((lm.estimatedChallengeMs ?? 240_000) / 60_000)}" ${dis}></label>
      </div>
      <label class="rb-field"><span>Catatan Akses Publik</span><input id="ed-lm-notes" value="${escapeText(lm.accessNotes)}" ${dis}></label>
      ${renderCoordAccordion(lm.id, "ed-lm-lat", "ed-lm-lng", lm.latitude, lm.longitude, dis)}
      ${
        editable
          ? `<div class="rb-actions">
              <button type="button" class="primary" data-map-action="apply-selected">Simpan titik</button>
              ${gpsBtn}
              <button type="button" class="secondary" data-map-action="delete-selected">Hapus Landmark</button>
            </div>`
          : ""
      }
    </details>`;
  }

  return "";
}

function fieldVerificationBadge(point?: StudioPointProvenance) {
  return point?.source === "osm-curated"
    ? `<span class="rb-badge">${point.fieldVerified ? "Terverifikasi ✓" : "Perlu Cek Lapangan"}</span>`
    : "";
}

export function renderStep2Top(state: Step2State, editable: boolean): string {
  const mapAction = state.mapMode === "add" ? "Ketuk peta untuk menambah titik."
    : state.mapMode === "move" ? "Ketuk lokasi baru untuk titik terpilih."
    : state.mapMode === "boundary" ? "Ketuk peta untuk menambah sudut batas."
    : editable ? "Ketuk pin untuk menyunting, atau seret pin terpilih."
    : "Ketuk pin untuk melihat rincian titik.";
  const lastUndo = state.undoStack[state.undoStack.length - 1];
  return `<div class="studio-map-caption">
      <p>${state.mapFailed ? "Pakai daftar lokasi untuk menyunting titik." : mapAction}</p>
      <span class="rb-badge" data-map-save-state role="status">${state.saved ? "Tersimpan" : "Belum disimpan"}</span>
    </div>
    <div class="studio-map-tools" role="group" aria-label="Cari lokasi dan atur tampilan peta">
      <button type="button" class="studio-tool studio-find-location" data-map-drawer="points" aria-expanded="${state.drawer === "points"}">Cari lokasi</button>
      <button type="button" class="studio-tool" data-map-drawer="transit" aria-expanded="${state.drawer === "transit"}">Transit Jakarta</button>
      ${editable ? `<button type="button" class="studio-tool" data-map-drawer="osm-pois" aria-controls="st-poi-drawer" aria-expanded="${state.drawer === "osm-pois"}">Kurasi POI</button>` : ""}
      ${state.mapFailed ? "" : '<button type="button" class="studio-tool" data-map-action="recenter">Pusatkan</button>'}
      ${editable ? `<button type="button" class="studio-tool" data-map-action="gps-add" data-testid="studio-gps-add" ${state.locatingGps ? "disabled" : ""}>${state.locatingGps ? "Mencari lokasi…" : "Pakai Lokasi Saya"}</button>` : ""}
      ${editable ? `<button type="button" class="studio-tool" data-map-action="undo-map" data-testid="studio-map-undo" ${state.undoStack.length === 0 ? "disabled" : ""} aria-label="${lastUndo ? escapeText(`Urungkan: ${lastUndo.label}`) : "Urungkan"}">Urungkan${state.undoStack.length > 0 ? ` (${state.undoStack.length})` : ""}</button>` : ""}
    </div>
    ${state.gpsError ? `<p class="studio-gps-feedback studio-gps-error" role="alert" data-testid="studio-gps-status">${escapeText(state.gpsError)}</p>`
      : state.gpsFeedback ? `<p class="studio-gps-feedback" role="status" data-testid="studio-gps-status">${escapeText(state.gpsFeedback)}</p>` : ""}
    ${!state.mapFailed && editable ? `<div class="studio-section-tabs studio-map-modes" role="group" aria-label="Mode interaksi peta">
      <button type="button" data-map-mode="select" aria-pressed="${state.mapMode === "select"}">${state.mapMode === "move" || state.mapMode === "boundary" ? "Kembali ke pilih titik" : "Pilih titik"}</button>
      <button type="button" data-map-mode="add" aria-pressed="${state.mapMode === "add"}">Tambah di peta</button>
    </div>` : ""}`;
}

function renderTransitModes(record: StudioVersionRecord, state: Step2State) {
  const inArea = state.transitCatalog?.stations.filter(st => pointInBoundary({ latitude: st.lat, longitude: st.lng }, record.snapshot.boundaryPolygon)) ?? [];
  return `<div class="st-transit-chips" role="group" aria-label="Moda transit dalam draf">
    ${TRANSIT_MODE_META.map(({ mode, label }) => `<button type="button" class="st-pill-icon st-transit-chip" data-transit-mode="${mode}"
      aria-pressed="${state.enabledTransitModes[mode]}">${mapPinIconSvg(mode)}<span>${label} ${inArea.filter(item => item.mode === mode).length}</span></button>`).join("")}
    </div>`;
}

function renderBuiltInTransitPanel(
  record: StudioVersionRecord,
  state: Step2State,
  editable: boolean,
): string {
  const stations = state.transitCatalog?.stations ?? [];
  const q = state.transitQuery.trim().toLowerCase();
  const inArea = stations.filter(
    (st) =>
      state.enabledTransitModes[st.mode] &&
      (state.transitFilter === "all" || st.mode === state.transitFilter) &&
      pointInBoundary({ latitude: st.lat, longitude: st.lng }, record.snapshot.boundaryPolygon),
  );
  const matching = q
    ? inArea.filter(
        (st) =>
          st.name.toLowerCase().includes(q) ||
          st.corridor.toLowerCase().includes(q) ||
          st.mode.toLowerCase().includes(q),
      )
    : inArea;
  const activeCount = inArea.filter(
    (st) => findCatalogStationMatchIndex(record.snapshot.stations, st) >= 0,
  ).length;
  const page = listPage(state.pointPage, matching.length);

  return `<div class="st-transit-panel" data-testid="jakarta-transit-panel">
    <div class="st-transit-panel-head">
      <strong>Transit Jakarta Bawaan · ${activeCount}/${inArea.length} aktif di area</strong>
      <small class="st-attribution">${escapeText(state.transitCatalog?.attribution ?? "© OpenStreetMap · Transjakarta")}</small>
    </div>
    ${renderTransitModes(record, state)}
    <label class="rb-field"><span>Filter tampilan transit</span><select id="st-transit-filter">
      <option value="all">Semua moda</option>
      ${TRANSIT_MODE_META.map(({ mode, label }) => `<option value="${mode}" ${state.transitFilter === mode ? "selected" : ""}>${label}</option>`).join("")}
    </select></label>
    ${
      stations.length === 0
        ? `<small role="status">Memuat katalog stasiun MRT/LRT/KRL/Transjakarta…</small>`
        : `<label class="rb-field"><span>Cari stasiun di area</span><input id="st-transit-search" type="search" placeholder="MRT, KRL, LRT, atau Halte TJ..." value="${escapeText(state.transitQuery)}"></label>
           <ul class="st-transit-list">
             ${
               matching.length === 0
                 ? "<li><small>Tidak ada stasiun cocok di dalam batas area.</small></li>"
                 : matching.slice(page * pageSize, (page + 1) * pageSize)
                     .map((st) => {
                       const included = findCatalogStationMatchIndex(record.snapshot.stations, st) >= 0;
                       return `<li>
                         <div class="st-pill-icon">
                           ${mapPinIconSvg(st.mode)}
                           <div><strong>${escapeText(st.name)}</strong><br><small>${escapeText(st.corridor)}</small></div>
                         </div>
                         ${editable ? `<button type="button" class="st-toggle-btn" data-toggle-transit-id="${escapeText(st.id)}" aria-pressed="${included}">${included ? "ON" : "OFF"}</button>` : `<span class="rb-badge">${included ? "ON" : "OFF"}</span>`}
                       </li>`;
                     })
                     .join("")
             }
           </ul>${renderListControls(page, matching.length)}`
    }
    ${editable && !isClaimStudioPack(record.pack) ? '<button type="button" class="secondary" data-map-action="seed-geo">Muat Ulang Data Peta</button>' : ""}
  </div>`;
}

const pageSize = 8;

function listPage(requested: number, count: number) {
  return Math.min(Math.max(0, requested), Math.max(0, Math.ceil(count / pageSize) - 1));
}

function renderListControls(page: number, count: number) {
  if (count <= pageSize) return "";
  return `<div class="rb-actions">
    <button type="button" class="secondary" data-point-page="${page - 1}" ${page === 0 ? "disabled" : ""}>Sebelumnya</button>
    <button type="button" class="secondary" data-point-page="${page + 1}" ${(page + 1) * pageSize >= count ? "disabled" : ""}>Berikutnya</button>
  </div>`;
}

function renderPointList(record: StudioVersionRecord, state: Step2State) {
  const pack = isClaimStudioPack(record.pack) ? record.pack : null;
  const rows: { kind: string; id: string; name: string; detail: string; point?: StudioPointProvenance }[] = state.subTab === "boundary"
    ? record.snapshot.boundaryPolygon.map((point, index) => ({ kind: "vertex", id: String(index), name: `Sudut ${index + 1}`, detail: `${point.latitude}, ${point.longitude}` }))
    : state.subTab === "start" ? [{ kind: "start", id: record.snapshot.startPoint.id, name: record.snapshot.startPoint.name, detail: "" }]
    : state.subTab === "pois" || (state.subTab === "secondary" && !pack)
      ? record.snapshot.pois.map(poi => ({ kind: "poi", id: poi.id, name: poi.name, detail: poi.category, point: poi }))
      : state.subTab === "secondary" && pack
        ? pack.geography.zones.map(zone => ({ kind: "zone", id: zone.id, name: zone.name, detail: zone.label }))
        : pack ? pack.geography.landmarks.map(point => ({ kind: "landmark", id: point.id, name: point.name, detail: point.zoneId, point }))
        : record.snapshot.stations.map(point => ({ kind: "station", id: point.id, name: point.name, detail: point.transitLines.join(", ") }));
  const q = state.pointQuery.trim().toLocaleLowerCase("id-ID");
  const matches = rows.filter(row => `${row.name} ${row.detail} ${row.id}`.toLocaleLowerCase("id-ID").includes(q));
  const page = listPage(state.pointPage, matches.length);
  return `<section class="studio-point-list" aria-label="Daftar lokasi">
    <label class="rb-field"><span>Cari lokasi</span><input type="search" id="st-point-search" value="${escapeText(state.pointQuery)}"></label>
    <ul class="rb-list">
      ${matches.length ? matches.slice(page * pageSize, (page + 1) * pageSize).map(row =>
        `<li><button type="button" class="secondary studio-point-item" data-select-kind="${row.kind}" data-select-id="${escapeText(row.id)}">
          <strong>${escapeText(row.name)}</strong><small>${escapeText(row.detail)}</small>${fieldVerificationBadge(row.point)}
        </button></li>`).join("") : "<li>Tidak ada lokasi yang cocok.</li>"}
    </ul>
    ${renderListControls(page, matches.length)}
  </section>`;
}

function renderZoneEditor(record: StudioVersionRecord, state: Step2State, editable: boolean): string {
  if (!isClaimStudioPack(record.pack)) return "";
  const zone = record.pack.geography.zones.find(item => item.id === state.zoneId);
  const dis = editable ? "" : "disabled";
  if (zone) return `<section class="studio-point-inspector" aria-label="Editor zona">
    <h4 tabindex="-1" data-studio-point-heading>${escapeText(zone.name)}</h4>
    <div class="rb-grid-2">
      <label class="rb-field"><span>Nama zona</span><input id="ed-zone-name" value="${escapeText(zone.name)}" ${dis}></label>
      <label class="rb-field"><span>Label zona</span><input id="ed-zone-label" value="${escapeText(zone.label)}" maxlength="3" ${dis}></label>
    </div>
    ${editable ? `<div class="rb-actions">
      <button type="button" class="primary" data-map-action="save-zone">Simpan zona</button>
      <button type="button" class="secondary" data-map-action="delete-zone" data-zone-id="${escapeText(zone.id)}">Hapus zona</button>
      <button type="button" class="secondary" data-map-action="new-zone">Zona baru</button>
    </div>` : ""}
  </section>`;
  return editable ? `<section class="studio-point-inspector" aria-label="Tambah zona">
    <h4 tabindex="-1" data-studio-point-heading>Zona baru</h4>
    <div class="rb-grid-2">
      <label class="rb-field"><span>ID Zona Baru</span><input id="ed-new-zone-id" placeholder="senopati"></label>
      <label class="rb-field"><span>Nama Zona</span><input id="ed-new-zone-name" placeholder="Senopati"></label>
      <label class="rb-field"><span>Label zona</span><input id="ed-new-zone-label" placeholder="SP" maxlength="3"></label>
      <label class="rb-field"><span>Ikon</span><input id="ed-new-zone-icon" value="pin"></label>
    </div>
    <button type="button" class="secondary" data-map-action="add-zone">Tambah Zona</button>
  </section>` : "";
}

function renderBoundaryEditor(record: StudioVersionRecord, state: Step2State, editable: boolean): string {
  const vertex = state.vertex === null ? undefined : record.snapshot.boundaryPolygon[state.vertex];
  const point = vertex ?? record.snapshot.startPoint;
  const dis = editable ? "" : "disabled";
  return `<section class="studio-point-inspector" aria-label="Editor batas">
    <h4 tabindex="-1" data-studio-point-heading>${vertex ? `Sudut ${state.vertex! + 1}` : "Batas area"}</h4>
    <div class="rb-grid-2">
      <label class="rb-field"><span>Lintang</span><input id="ed-v-lat" type="number" step="any" value="${point.latitude}" ${dis}></label>
      <label class="rb-field"><span>Bujur</span><input id="ed-v-lng" type="number" step="any" value="${point.longitude}" ${dis}></label>
    </div>
    ${editable ? `<div class="rb-actions">
      <button type="button" class="primary" data-map-action="${vertex ? "save-vertex" : "add-vertex"}">${vertex ? "Simpan sudut" : "Tambah sudut"}</button>
      ${vertex ? `<button type="button" class="secondary" data-map-action="remove-vertex" data-vertex-index="${state.vertex}" ${record.snapshot.boundaryPolygon.length <= 3 ? "disabled" : ""}>Hapus sudut</button>
        <button type="button" class="secondary" data-map-action="new-vertex">Sudut baru</button>` : ""}
      ${state.mapFailed ? "" : `<button type="button" class="secondary" data-map-mode="boundary" aria-pressed="${state.mapMode === "boundary"}">Tambah di peta</button>`}
    </div>` : ""}
  </section>`;
}

export function renderStep2Bottom(
  record: StudioVersionRecord,
  state: Step2State,
  editable: boolean,
  claimStep3?: ClaimStep3State,
): string {
  const claim = isClaimStudioPack(record.pack);
  const selected = ensureStep2Selection(record, state);
  const poiView = state.subTab === "pois" || (state.subTab === "secondary" && !claim);
  const currentPoint = poiView && selected?.kind !== "poi" ? null : selected;
  const zoneView = claim && state.subTab === "secondary";
  const boundaryView = state.subTab === "boundary";
  const addPoint = editable && (state.subTab === "primary" || poiView);
  const showLandmarkChallenges =
    state.editingChallenges &&
    claim &&
    isClaimStudioPack(record.pack) &&
    !zoneView &&
    !boundaryView &&
    currentPoint?.kind === "landmark" &&
    claimStep3 !== undefined;
  if (showLandmarkChallenges && isClaimStudioPack(record.pack) && claimStep3) {
    if (claimStep3.challengeTarget !== "backup" && claimStep3.challengeTarget !== currentPoint.id) {
      claimStep3.challengeTarget = currentPoint.id;
    }
  }
  return `<div class="studio-section-tabs studio-map-layers" role="group" aria-label="Jenis lokasi yang disunting">
      ${([["primary", claim ? "Landmark" : "Stasiun"], ["secondary", claim ? "Zona" : "POI"],
        ...(claim ? [["pois", "POI"]] as const : []), ["start", "Titik mulai"], ["boundary", "Batas"]] as const).map(([tab, label]) =>
          `<button type="button" data-map-tab="${tab}" aria-pressed="${state.subTab === tab}">${label}</button>`).join("")}
    </div>
    ${state.drawer === "points" ? renderPointList(record, state) : ""}
    ${state.drawer === "transit" ? renderBuiltInTransitPanel(record, state, editable) : ""}
    ${showLandmarkChallenges && isClaimStudioPack(record.pack) && claimStep3
      ? `<fieldset class="studio-point-inspector" data-challenge-fields aria-label="Editor tantangan lokasi">
          <button type="button" class="studio-tool" data-map-action="close-challenges">‹ Kembali ke lokasi</button>
          ${renderClaimChallenges(record.pack, claimStep3, editable ? "" : "disabled", editable)}
        </fieldset>`
      : `<fieldset data-point-fields aria-label="Editor lokasi">
      ${zoneView ? renderZoneEditor(record, state, editable) : boundaryView ? renderBoundaryEditor(record, state, editable)
        : renderInspector(record, currentPoint, editable, state.locatingGps)}
      ${editable && currentPoint && !zoneView && !boundaryView && !state.mapFailed
        ? `<button type="button" class="studio-tool" data-map-mode="move" aria-pressed="${state.mapMode === "move"}">Pindahkan titik di peta</button>` : ""}
      ${addPoint ? `<button type="button" class="studio-tool" data-map-action="${poiView ? "add-poi" : claim ? "add-landmark" : "add-station"}">Tambah ${poiView ? "POI" : claim ? "landmark" : "stasiun"}</button>` : ""}
    </fieldset>`}
    <div class="rb-sticky-footer studio-step-actions">
      <button type="button" class="studio-tool" data-step="1">← Draf</button>
      <button type="button" class="studio-tool" data-step="3">Aturan →</button>
    </div>`;
}

export function renderStep2View(
  record: StudioVersionRecord,
  state: Step2State,
  editable: boolean,
  claimStep3?: ClaimStep3State,
): string {
  return `<div class="rb-card studio-map-editor" data-studio-slot="map-editor">
    <div id="st-step2-top">${renderStep2Top(state, editable)}</div>
    <div id="st-map-host" class="rb-map-host" data-testid="studio-map-host" ${state.mapFailed ? "hidden" : ""}></div>
    <div id="st-map-fallback" data-testid="studio-map-fallback" ${state.mapFailed ? "" : "hidden"}>
      <p role="status">Peta belum bisa dimuat. Pilih lokasi dari daftar untuk menyuntingnya.</p>
      <button type="button" class="secondary" data-map-action="retry-map">Coba muat peta</button>
    </div>
    <div id="st-poi-drawer" hidden></div>
    <div id="st-step2-bottom">${renderStep2Bottom(record, state, editable, claimStep3)}</div>
  </div>`;
}

export function createNewStation(coord: GeoCoordinate, count: number): GeoStation {
  const id = `st-custom-${Date.now().toString(36)}-${count}`;
  return {
    id,
    name: `Stasiun Baru ${count + 1}`,
    latitude: coord.latitude,
    longitude: coord.longitude,
    transitLines: ["Transjakarta"],
    attributes: { kecamatan: "Kebayoran Baru", corridor: "Selatan" },
    eligibleHidingAnchor: true,
    accessNotes: "Area pejalan kaki publik di luar pintu stasiun.",
    publicHours: "05:00-23:00",
    estimatedTravelFromStartMs: 600_000,
  };
}

export function createNewPoi(coord: GeoCoordinate, count: number): GeoPoi {
  return {
    id: `poi-custom-${Date.now().toString(36)}-${count}`,
    name: `POI Publik ${count + 1}`,
    category: "taman",
    latitude: coord.latitude,
    longitude: coord.longitude,
  };
}

export function createNewLandmark(coord: GeoCoordinate, zoneId: string, count: number): ClaimLandmarkDefinition {
  return {
    id: `lm-custom-${Date.now().toString(36)}-${count}`,
    name: `Landmark Baru ${count + 1}`,
    zoneId,
    latitude: coord.latitude,
    longitude: coord.longitude,
    transitSummary: "Jalan kaki / Transjakarta",
    accessNotes: "Area publik pejalan kaki bebas tiket masuk.",
    publicHours: "06:00-22:00",
    estimatedTravelFromStartMs: 600_000,
    estimatedChallengeMs: 240_000,
  };
}

export function createNewZone(id: string, name: string, label: string, icon: string): ClaimZoneDefinition {
  return { id, name, label: label || name.slice(0, 2).toUpperCase(), icon: icon || "pin" };
}
