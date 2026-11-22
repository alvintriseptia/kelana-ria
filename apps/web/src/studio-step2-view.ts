import type {
  ClaimLandmarkDefinition,
  ClaimZoneDefinition,
  GeoCoordinate,
  GeoPoi,
  GeoStation,
} from "@kelana-ria/contracts";
import { escapeText } from "./solo-view";
import { mapPinIconSvg } from "./studio-assets";
import type { StudioMapMode } from "./studio-map-editor";
import { isClaimStudioPack, type StudioVersionRecord } from "./studio-types";

export type Step2Target = { kind: "start" | "station" | "poi" | "landmark"; id: string };
export type Step2Tab = "primary" | "secondary" | "start" | "boundary";

export type Step2State = {
  mapMode: StudioMapMode;
  subTab: Step2Tab;
  selected: Step2Target | null;
  mapFailed: boolean;
  lastClickedCoord: GeoCoordinate | null;
};

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

function formatAttributes(attrs: Record<string, string>): string {
  return Object.entries(attrs)
    .map(([k, v]) => `${k}=${v}`)
    .join(", ");
}

export function parseAttributes(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of raw.split(",")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const val = part.slice(idx + 1).trim();
    if (key && val) out[key] = val;
  }
  return out;
}

function renderInspector(record: StudioVersionRecord, selected: Step2Target | null, editable: boolean): string {
  if (!selected) return "";
  const dis = editable ? "" : "disabled";

  if (selected.kind === "start") {
    const sp = record.snapshot.startPoint;
    return `<details class="rb-accordion" open data-testid="step2-inspector">
      <summary>Titik Terpilih: ${escapeText(sp.name)} (Titik Awal)</summary>
      <div class="rb-grid-2">
        <label class="rb-field"><span>Nama Titik Awal</span><input id="ed-sp-name" value="${escapeText(sp.name)}" ${dis}></label>
        <label class="rb-field"><span>Catatan Akses</span><input id="ed-sp-notes" value="${escapeText(sp.accessNotes ?? "")}" ${dis}></label>
        <label class="rb-field"><span>Latitude</span><input id="ed-sp-lat" type="number" step="0.00001" value="${sp.latitude}" ${dis}></label>
        <label class="rb-field"><span>Longitude</span><input id="ed-sp-lng" type="number" step="0.00001" value="${sp.longitude}" ${dis}></label>
      </div>
      ${editable ? `<div class="rb-actions"><button type="button" class="secondary" data-map-action="apply-selected">Terapkan Titik Awal</button></div>` : ""}
    </details>`;
  }

  if (selected.kind === "station") {
    const idx = record.snapshot.stations.findIndex((s) => s.id === selected.id);
    const st = record.snapshot.stations[idx];
    if (!st) return "";
    const nameInputId = idx === 0 ? "ed-station-name" : "ed-point-name";
    return `<details class="rb-accordion" open data-testid="step2-inspector">
      <summary>Titik Terpilih: ${escapeText(st.name)}</summary>
      <small>ID: <code>${escapeText(st.id)}</code></small>
      <div class="rb-grid-2">
        <label class="rb-field"><span>Nama Stasiun</span><input id="${nameInputId}" data-field="name" value="${escapeText(st.name)}" ${dis}></label>
        <label class="rb-field"><span>Jalur Transit (pisahkan koma)</span><input id="ed-st-lines" value="${escapeText(st.transitLines.join(", "))}" ${dis}></label>
        <label class="rb-field"><span>Latitude</span><input id="ed-st-lat" type="number" step="0.00001" value="${st.latitude}" ${dis}></label>
        <label class="rb-field"><span>Longitude</span><input id="ed-st-lng" type="number" step="0.00001" value="${st.longitude}" ${dis}></label>
        <label class="rb-field"><span>Atribut (kunci=nilai, koma)</span><input id="ed-st-attrs" value="${escapeText(formatAttributes(st.attributes))}" ${dis}></label>
        <label class="rb-field"><span>Jam Publik</span><input id="ed-st-hours" value="${escapeText(st.publicHours ?? "05:00-23:00")}" ${dis}></label>
        <label class="rb-field"><span>Estimasi Tempuh (menit)</span><input id="ed-st-travel" type="number" value="${Math.round((st.estimatedTravelFromStartMs ?? 600_000) / 60_000)}" ${dis}></label>
        <label class="rb-field"><span>Layak Jangkar Sembunyi</span>
          <select id="ed-st-anchor" ${dis}>
            <option value="true" ${st.eligibleHidingAnchor ? "selected" : ""}>Ya (Jangkar)</option>
            <option value="false" ${!st.eligibleHidingAnchor ? "selected" : ""}>Tidak</option>
          </select>
        </label>
      </div>
      <label class="rb-field"><span>Catatan Akses Publik</span><input id="ed-st-notes" value="${escapeText(st.accessNotes ?? "")}" ${dis}></label>
      ${
        editable
          ? `<div class="rb-actions">
              <button type="button" class="secondary" data-map-action="apply-selected">Terapkan Perubahan</button>
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
      <summary>Titik Terpilih: ${escapeText(poi.name)} (POI)</summary>
      <small>ID: <code>${escapeText(poi.id)}</code></small>
      <div class="rb-grid-2">
        <label class="rb-field"><span>Nama POI</span><input id="ed-poi-name" value="${escapeText(poi.name)}" ${dis}></label>
        <label class="rb-field"><span>Kategori POI</span><input id="ed-poi-cat" value="${escapeText(poi.category)}" ${dis}></label>
        <label class="rb-field"><span>Latitude</span><input id="ed-poi-lat" type="number" step="0.00001" value="${poi.latitude}" ${dis}></label>
        <label class="rb-field"><span>Longitude</span><input id="ed-poi-lng" type="number" step="0.00001" value="${poi.longitude}" ${dis}></label>
      </div>
      ${
        editable
          ? `<div class="rb-actions">
              <button type="button" class="secondary" data-map-action="apply-selected">Terapkan Perubahan</button>
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
      <summary>Titik Terpilih: ${escapeText(lm.name)}</summary>
      <small>ID: <code>${escapeText(lm.id)}</code></small>
      <div class="rb-grid-2">
        <label class="rb-field"><span>Nama Landmark</span><input id="${nameInputId}" data-field="name" value="${escapeText(lm.name)}" ${dis}></label>
        <label class="rb-field"><span>Zona</span>
          <select id="ed-lm-zone" ${dis}>
            ${record.pack.geography.zones
              .map((z) => `<option value="${escapeText(z.id)}" ${z.id === lm.zoneId ? "selected" : ""}>${escapeText(z.label)} · ${escapeText(z.name)}</option>`)
              .join("")}
          </select>
        </label>
        <label class="rb-field"><span>Latitude</span><input id="ed-lm-lat" type="number" step="0.00001" value="${lm.latitude}" ${dis}></label>
        <label class="rb-field"><span>Longitude</span><input id="ed-lm-lng" type="number" step="0.00001" value="${lm.longitude}" ${dis}></label>
        <label class="rb-field"><span>Ringkasan Transit</span><input id="ed-lm-transit" value="${escapeText(lm.transitSummary)}" ${dis}></label>
        <label class="rb-field"><span>Jam Publik</span><input id="ed-lm-hours" value="${escapeText(lm.publicHours)}" ${dis}></label>
        <label class="rb-field"><span>Tempuh dari Mulai (menit)</span><input id="ed-lm-travel" type="number" value="${Math.round((lm.estimatedTravelFromStartMs ?? 600_000) / 60_000)}" ${dis}></label>
        <label class="rb-field"><span>Estimasi Tantangan (menit)</span><input id="ed-lm-chal" type="number" value="${Math.round((lm.estimatedChallengeMs ?? 240_000) / 60_000)}" ${dis}></label>
      </div>
      <label class="rb-field"><span>Catatan Akses Publik</span><input id="ed-lm-notes" value="${escapeText(lm.accessNotes)}" ${dis}></label>
      ${
        editable
          ? `<div class="rb-actions">
              <button type="button" class="secondary" data-map-action="apply-selected">Terapkan Perubahan</button>
              <button type="button" class="secondary" data-map-action="delete-selected">Hapus Landmark</button>
            </div>`
          : ""
      }
    </details>`;
  }

  return "";
}

export function renderStep2Top(
  record: StudioVersionRecord,
  state: Step2State,
  editable: boolean,
): string {
  return `<h3>2. Peta &amp; Lokasi · ${escapeText(record.pack.meta.title)}</h3>
    <div class="rb-actions" aria-label="Mode interaksi peta">
      <button type="button" class="${state.mapMode === "select" ? "primary" : "secondary"}" data-map-mode="select">Pilih Titik</button>
      ${editable ? `<button type="button" class="${state.mapMode === "add" ? "primary" : "secondary"}" data-map-mode="add">+ Tambah di Peta</button>` : ""}
      ${editable ? `<button type="button" class="${state.mapMode === "move" ? "primary" : "secondary"}" data-map-mode="move">Pindahkan Terpilih</button>` : ""}
      ${editable ? `<button type="button" class="${state.mapMode === "boundary" ? "primary" : "secondary"}" data-map-mode="boundary">+ Titik Batas</button>` : ""}
      <button type="button" class="secondary" data-map-action="recenter">Pusatkan Peta</button>
    </div>`;
}

export function renderStep2Bottom(
  record: StudioVersionRecord,
  state: Step2State,
  editable: boolean,
): string {
  const selected = ensureStep2Selection(record, state);
  const claimPack = isClaimStudioPack(record.pack) ? record.pack : null;
  const claim = Boolean(claimPack);
  const dis = editable ? "" : "disabled";

  return `${
    state.lastClickedCoord
      ? `<p><small>Koordinat klik terakhir: <code>${state.lastClickedCoord.latitude}, ${state.lastClickedCoord.longitude}</code></small></p>`
      : ""
  }

    ${renderInspector(record, selected, editable)}

    <div class="rb-actions" aria-label="Layer lokasi">
      <button type="button" class="st-pill-icon ${state.subTab === "primary" ? "primary" : "secondary"}" data-map-tab="primary">${mapPinIconSvg(claimPack ? "zone" : "mrt")}<span>${claimPack ? `Landmark (${claimPack.geography.landmarks.length})` : `Stasiun (${record.snapshot.stations.length})`}</span></button>
      <button type="button" class="st-pill-icon ${state.subTab === "secondary" ? "primary" : "secondary"}" data-map-tab="secondary">${mapPinIconSvg(claimPack ? "zone" : "poi")}<span>${claimPack ? `Zona (${claimPack.geography.zones.length})` : `POI (${record.snapshot.pois.length})`}</span></button>
      <button type="button" class="st-pill-icon ${state.subTab === "start" ? "primary" : "secondary"}" data-map-tab="start">${mapPinIconSvg("start")}<span>Titik Mulai</span></button>
      <button type="button" class="${state.subTab === "boundary" ? "primary" : "secondary"}" data-map-tab="boundary">Batas (${record.snapshot.boundaryPolygon.length})</button>
      ${!claim && editable ? `<button type="button" class="secondary" data-map-action="seed-geo">Seed Ulang Geo</button>` : ""}
    </div>

    ${
      state.subTab === "start"
        ? `<p>Titik mulai: <strong>${escapeText(record.snapshot.startPoint.name)}</strong> (${record.snapshot.startPoint.latitude}, ${record.snapshot.startPoint.longitude})</p>
           <button type="button" class="secondary" data-select-kind="start" data-select-id="${escapeText(record.snapshot.startPoint.id)}">Pilih Titik Mulai di Inspector</button>`
        : state.subTab === "boundary"
          ? `<div>
              ${
                editable
                  ? `<div class="rb-grid-2">
                      <label class="rb-field"><span>Lat Sudut Baru</span><input id="ed-v-lat" type="number" step="0.0001" value="${record.snapshot.startPoint.latitude}"></label>
                      <label class="rb-field"><span>Lng Sudut Baru</span><input id="ed-v-lng" type="number" step="0.0001" value="${record.snapshot.startPoint.longitude}"></label>
                    </div>
                    <div class="rb-actions"><button type="button" class="secondary" data-map-action="add-vertex">+ Tambah Sudut Batas</button></div>`
                  : ""
              }
              <details class="rb-accordion" data-testid="step2-list-accordion">
                <summary>Daftar Sudut Batas (${record.snapshot.boundaryPolygon.length})</summary>
                <ul class="rb-list">
                  ${record.snapshot.boundaryPolygon
                    .map(
                      (v, i) => `<li>
                        <span>Sudut #${i + 1}: <code>${v.latitude}, ${v.longitude}</code></span>
                        ${editable && record.snapshot.boundaryPolygon.length > 3 ? `<button type="button" class="secondary" data-map-action="remove-vertex" data-vertex-index="${i}">Hapus Sudut</button>` : ""}
                      </li>`,
                    )
                    .join("")}
                </ul>
              </details>
            </div>`
          : claim && isClaimStudioPack(record.pack)
            ? state.subTab === "secondary"
              ? `<div>
                  ${
                    editable
                      ? `<div class="rb-grid-2">
                          <label class="rb-field"><span>ID Zona Baru</span><input id="ed-new-zone-id" placeholder="senopati"></label>
                          <label class="rb-field"><span>Nama Zona</span><input id="ed-new-zone-name" placeholder="Senopati"></label>
                          <label class="rb-field"><span>Label (2 huruf)</span><input id="ed-new-zone-label" placeholder="SP" maxlength="3"></label>
                          <label class="rb-field"><span>Ikon</span><input id="ed-new-zone-icon" value="pin"></label>
                        </div>
                        <div class="rb-actions"><button type="button" class="secondary" data-map-action="add-zone">+ Tambah Zona</button></div>`
                      : ""
                  }
                  <details class="rb-accordion" data-testid="step2-list-accordion">
                    <summary>Daftar Zona (${record.pack.geography.zones.length})</summary>
                    <ul class="rb-list">
                      ${record.pack.geography.zones
                        .map((z) => {
                          const count = isClaimStudioPack(record.pack)
                            ? record.pack.geography.landmarks.filter((l) => l.zoneId === z.id).length
                            : 0;
                          return `<li data-zone-id="${escapeText(z.id)}">
                            <div><strong>${escapeText(z.label)} · ${escapeText(z.name)}</strong> (<code>${escapeText(z.id)}</code> · ${count} landmark)</div>
                            ${editable ? `<button type="button" class="secondary" data-map-action="delete-zone" data-zone-id="${escapeText(z.id)}">Hapus Zona</button>` : ""}
                          </li>`;
                        })
                        .join("")}
                    </ul>
                  </details>
                </div>`
              : `<div>
                  ${editable ? `<div class="rb-actions"><button type="button" class="secondary" data-map-action="add-landmark">+ Tambah Landmark Baru</button></div>` : ""}
                  <details class="rb-accordion" data-testid="step2-list-accordion">
                    <summary>Daftar Landmark (${record.pack.geography.landmarks.length})</summary>
                    <ul class="rb-list">
                      ${record.pack.geography.landmarks
                        .map(
                          (l) => `<li>
                            <div><strong>${escapeText(l.name)}</strong> <span class="rb-badge">${escapeText(l.zoneId)}</span></div>
                            <small>${l.latitude.toFixed(5)}, ${l.longitude.toFixed(5)} · ${escapeText(l.transitSummary)}</small>
                            <button type="button" class="secondary" data-select-kind="landmark" data-select-id="${escapeText(l.id)}">Sunting</button>
                          </li>`,
                        )
                        .join("")}
                    </ul>
                  </details>
                </div>`
            : state.subTab === "secondary"
              ? `<div>
                  ${editable ? `<div class="rb-actions"><button type="button" class="secondary" data-map-action="add-poi">+ Tambah POI Baru</button></div>` : ""}
                  <details class="rb-accordion" data-testid="step2-list-accordion">
                    <summary>Daftar POI (${record.snapshot.pois.length})</summary>
                    <ul class="rb-list">
                      ${record.snapshot.pois
                        .map(
                          (p) => `<li>
                            <div><strong>${escapeText(p.name)}</strong> <span class="rb-badge">${escapeText(p.category)}</span></div>
                            <small>${p.latitude.toFixed(5)}, ${p.longitude.toFixed(5)}</small>
                            <button type="button" class="secondary" data-select-kind="poi" data-select-id="${escapeText(p.id)}">Sunting</button>
                          </li>`,
                        )
                        .join("")}
                    </ul>
                  </details>
                </div>`
              : `<div>
                  ${editable ? `<div class="rb-actions"><button type="button" class="secondary" data-map-action="add-station">+ Tambah Stasiun Baru</button></div>` : ""}
                  <details class="rb-accordion" data-testid="step2-list-accordion">
                    <summary>Daftar Stasiun (${record.snapshot.stations.length})</summary>
                    <ul class="rb-list">
                      ${record.snapshot.stations
                        .map(
                          (s) => `<li>
                            <div><strong>${escapeText(s.name)}</strong> ${s.eligibleHidingAnchor ? '<span class="rb-badge">Jangkar</span>' : '<span class="rb-badge rb-badge-warn">Non-jangkar</span>'}</div>
                            <small>${s.latitude.toFixed(5)}, ${s.longitude.toFixed(5)} · ${escapeText(s.transitLines.join(", "))}</small>
                            <button type="button" class="secondary" data-select-kind="station" data-select-id="${escapeText(s.id)}">Sunting</button>
                          </li>`,
                        )
                        .join("")}
                    </ul>
                  </details>
                </div>`
    }

    <div class="rb-sticky-footer">
      <button type="button" class="secondary" data-step="1">← Draf</button>
      ${editable ? `<button type="button" class="secondary" data-action="save-draft" ${dis}>Simpan</button>` : "<span></span>"}
      <button type="button" class="primary" data-step="3">Aturan →</button>
    </div>`;
}

export function renderStep2View(
  record: StudioVersionRecord,
  state: Step2State,
  editable: boolean,
): string {
  return `<div class="rb-card" data-studio-slot="map-editor">
    <div id="st-step2-top">${renderStep2Top(record, state, editable)}</div>
    <div id="st-map-host" class="rb-map-host" data-testid="studio-map-host" ${state.mapFailed ? "hidden" : ""}></div>
    <p id="st-map-fallback" role="status" data-testid="studio-map-fallback" ${state.mapFailed ? "" : "hidden"}>Tile peta tidak tersedia — seluruh daftar dan editor koordinat teks tetap dapat digunakan penuh.</p>
    <div id="st-step2-bottom">${renderStep2Bottom(record, state, editable)}</div>
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
