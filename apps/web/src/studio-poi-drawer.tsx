import { computed, signal } from "@preact/signals";
import type {
  GeoAttribution, StudioPoiCandidate, StudioPoiCategory, StudioPoiCurateRequest, StudioPoiCurateResponse,
} from "@kelana-ria/contracts";
import { formatDistanceShort } from "./live-location";
import { approxMeters } from "./studio-step2-view";
import { isClaimStudioPack, type StudioVersionRecord } from "./studio-types";
import { mountPreact } from "./ui/mount";

const categories = {
  taman: ["🌳", "Taman"],
  monumen: ["🗿", "Monumen"],
  museum: ["🏛️", "Museum"],
  pasar: ["🧺", "Pasar"],
  ruang_publik: ["⛲", "Ruang Publik"],
  ibadah: ["🕌", "Ibadah"],
  perpustakaan: ["📚", "Perpustakaan"],
  kuliner_ikon: ["🍲", "Kuliner"],
} satisfies Record<StudioPoiCategory, [string, string]>;
const allCategories = Object.keys(categories) as StudioPoiCategory[];
const pageSize = 5;

export function studioPoiDraftPoints(record: StudioVersionRecord) {
  return [
    record.snapshot.startPoint,
    ...record.snapshot.stations,
    ...record.snapshot.pois,
    ...(isClaimStudioPack(record.pack) ? record.pack.geography.landmarks : []),
  ];
}

export function studioPoiAlreadyAdded(record: StudioVersionRecord, candidate: StudioPoiCandidate): boolean {
  return studioPoiDraftPoints(record).some(point =>
    ("osmId" in point && point.osmId === candidate.osmId) || approxMeters(point, candidate) <= 50);
}

type DrawerOptions = {
  search: (request: StudioPoiCurateRequest) => Promise<StudioPoiCurateResponse & { error?: string }>;
  add: (candidate: StudioPoiCandidate, attribution: GeoAttribution, zoneId?: string) => Promise<boolean>;
  close: () => void;
};

function curateError(error?: string) {
  if (error === "rate-limited") return "Pencarian terlalu sering. Tunggu sebentar, lalu coba lagi.";
  if (error === "poi-area-too-large") return "Area terlalu luas. Perkecil batas area, lalu coba lagi.";
  if (error === "invalid-request") return "Periksa bentuk batas area, lalu coba lagi.";
  if (error === "auth-required") return "Masuk kembali untuk mencari POI.";
  return "POI belum bisa dimuat. Periksa koneksi, lalu coba lagi.";
}

export function mountStudioPoiDrawer(
  host: HTMLElement,
  initialRecord: StudioVersionRecord,
  options: DrawerOptions,
) {
  const record = signal(initialRecord);
  const categoriesSelected = signal(allCategories);
  const result = signal<StudioPoiCurateResponse | null>(null);
  const page = signal(0);
  const selected = signal<string | null>(null);
  const zonesSelected = signal<Record<string, string>>({});
  const searching = signal(false);
  const importing = signal(false);
  const saving = signal(false);
  const error = signal("");
  const importError = signal("");
  let requestId = 0;
  let disposed = false;

  const candidates = computed(() =>
    result.value?.candidates.filter(point => categoriesSelected.value.includes(point.category)) ?? []);

  function focusCard(index: number) {
    const candidate = candidates.value[index];
    if (!candidate) return;
    page.value = Math.floor(index / pageSize);
    selected.value = candidate.osmId;
    requestAnimationFrame(() => host.querySelector<HTMLElement>(
      `[data-osm-card="${CSS.escape(candidate.osmId)}"]`,
    )?.focus());
  }

  function toggle(category: StudioPoiCategory) {
    categoriesSelected.value = categoriesSelected.value.includes(category)
      ? categoriesSelected.value.filter(item => item !== category)
      : [...categoriesSelected.value, category];
    page.value = 0;
    selected.value = null;
  }

  async function search() {
    const current = record.value;
    const { boundaryPolygon, startPoint } = current.snapshot;
    if (searching.value || !categoriesSelected.value.length || boundaryPolygon.length < 3) return;
    const claim = isClaimStudioPack(current.pack) ? current.pack : null;
    const coordinate = ({ latitude, longitude }: { latitude: number; longitude: number }) => ({ latitude, longitude });
    const request: StudioPoiCurateRequest = {
      boundaryPolygon,
      startPoint: coordinate(startPoint),
      categories: categoriesSelected.value,
      existingPoints: studioPoiDraftPoints(current).map(coordinate),
      zones: claim?.geography.zones.map(zone => ({
        id: zone.id,
        landmarks: claim.geography.landmarks.filter(point => point.zoneId === zone.id).map(coordinate),
      })),
    };
    const id = ++requestId;
    searching.value = true;
    error.value = "";
    importError.value = "";
    try {
      const data = await options.search(request);
      if (id !== requestId) return;
      if (data.error || !Array.isArray(data.candidates)) {
        error.value = curateError(data.error);
        return;
      }
      page.value = 0;
      selected.value = null;
      zonesSelected.value = {};
      result.value = data;
    } catch {
      if (id === requestId) error.value = curateError();
    } finally {
      if (id === requestId) searching.value = false;
    }
  }

  async function add(candidate: StudioPoiCandidate, zoneId?: string) {
    if (!result.value || saving.value || importing.value || studioPoiAlreadyAdded(record.value, candidate)) return;
    importing.value = true;
    importError.value = "";
    try {
      if (!await options.add(candidate, result.value.attribution, zoneId) && !disposed) {
        importError.value = "POI belum tersimpan. Periksa draf, lalu coba lagi.";
      }
    } finally {
      importing.value = false;
      if (!disposed) {
        const card = host.querySelector<HTMLElement>(`[data-osm-card="${CSS.escape(candidate.osmId)}"]`);
        if (card && card.contains(document.activeElement) === false) card.focus({ preventScroll: true });
      }
    }
  }

  function Drawer() {
    const current = record.value;
    const claim = isClaimStudioPack(current.pack);
    const zones = isClaimStudioPack(current.pack) ? current.pack.geography.zones : [];
    const list = candidates.value;
    const data = result.value;
    const invalidBoundary = current.snapshot.boundaryPolygon.length < 3;
    const busy = searching.value || importing.value || saving.value;
    return (
      <section class="studio-poi-drawer" aria-labelledby="st-osm-heading">
        <header>
          <h3 id="st-osm-heading" tabIndex={-1}>Kurasi POI</h3>
          <button type="button" class="studio-tool" onClick={options.close}>Tutup</button>
        </header>
        <div class="studio-poi-categories" role="group" aria-label="Kategori POI">
          {allCategories.map(category => (
            <button type="button" class="studio-tool" key={category} aria-pressed={categoriesSelected.value.includes(category)}
              disabled={searching.value} onClick={() => toggle(category)}>
              <span aria-hidden="true">{categories[category][0]}</span> {categories[category][1]}
            </button>
          ))}
        </div>
        {invalidBoundary && <p>Tambahkan sedikitnya tiga sudut batas area untuk mencari POI.</p>}
        <button type="button" class="primary" onClick={() => void search()}
          disabled={busy || invalidBoundary || !categoriesSelected.value.length}>
          {error.value ? "Coba Lagi" : "Cari POI di Area"}
        </button>
        <p class="studio-poi-status" role="status">
          {searching.value ? "Mencari POI…" : data && (list.length ? `${list.length} kandidat POI` : "Tidak ada POI untuk kategori ini. Pilih kategori lain atau ubah batas area.")}
        </p>
        {error.value && <p role="alert">{error.value}</p>}
        {importError.value && <p role="alert">{importError.value}</p>}
        {data && <div class="studio-poi-source">
          <span class="rb-badge">{data.mode === "live" ? "Data OSM Langsung" : "Data Simulasi / Cadangan"}</span>
          <small>{data.attribution.notice}</small>
        </div>}
        <ul class="studio-poi-cards">
          {list.slice(page.value * pageSize, (page.value + 1) * pageSize).map(candidate => {
            const [icon, label] = categories[candidate.category];
            const alreadyAdded = studioPoiAlreadyAdded(current, candidate);
            const zoneId = zones.find(zone => zone.id === (zonesSelected.value[candidate.osmId] ?? candidate.suggestedZoneId))?.id
              ?? zones[0]?.id;
            return (
              <li key={candidate.osmId} tabIndex={-1} data-osm-card={candidate.osmId}
                class="studio-poi-card" data-selected={selected.value === candidate.osmId}>
                <strong>{candidate.name}</strong>
                <div class="studio-poi-source">
                  <span class="rb-badge"><span aria-hidden="true">{icon} </span>{label}</span>
                  {candidate.distanceFromStartMeters !== undefined && <small>{formatDistanceShort(candidate.distanceFromStartMeters)} dari titik mulai</small>}
                </div>
                {candidate.publicAccessHint && <small>Akses {candidate.publicAccessHint === "permissive" ? "dengan izin pemilik" : "publik"} menurut OSM</small>}
                {candidate.openingHours && <small>Jam di OSM · {candidate.openingHours}</small>}
                {alreadyAdded ? <span class="rb-badge">Sudah di Draf ✓</span> : <>
                  {claim && zoneId && <>
                    <label class="rb-field">
                      <span>Zona</span>
                      <select value={zoneId} disabled={busy} onChange={event => {
                        zonesSelected.value = { ...zonesSelected.value, [candidate.osmId]: event.currentTarget.value };
                      }}>
                        {zones.map(zone => <option key={zone.id} value={zone.id}>{zone.name}</option>)}
                      </select>
                    </label>
                    <button type="button" class="primary" disabled={busy} onClick={() => void add(candidate, zoneId)}>+ Jadikan Landmark</button>
                  </>}
                  {claim && !zoneId && <small>Buat zona untuk menjadikan titik ini landmark.</small>}
                  <button type="button" class={claim && zoneId ? "secondary" : "primary"} disabled={busy}
                    onClick={() => void add(candidate)}>{claim ? "+ Tambah sebagai POI" : "+ Tambah ke POI"}</button>
                </>}
              </li>
            );
          })}
        </ul>
        {list.length > pageSize && <nav class="studio-poi-source" aria-label="Halaman kandidat">
          <button type="button" class="studio-tool" disabled={!page.value}
            onClick={() => focusCard((page.value - 1) * pageSize)}>Sebelumnya</button>
          <button type="button" class="studio-tool" disabled={(page.value + 1) * pageSize >= list.length}
            onClick={() => focusCard((page.value + 1) * pageSize)}>Berikutnya</button>
        </nav>}
      </section>
    );
  }

  const unmount = mountPreact(host, () => <Drawer />);
  return {
    candidates,
    selected,
    focusCandidate(id: string) {
      focusCard(candidates.value.findIndex(candidate => candidate.osmId === id));
    },
    update(next: StudioVersionRecord, isSaving: boolean) {
      const snapshot = record.value.snapshot;
      if (JSON.stringify([snapshot.boundaryPolygon, snapshot.startPoint.latitude, snapshot.startPoint.longitude]) !==
          JSON.stringify([next.snapshot.boundaryPolygon, next.snapshot.startPoint.latitude, next.snapshot.startPoint.longitude])) {
        requestId++;
        result.value = null;
        searching.value = false;
        error.value = "";
        importError.value = "";
        selected.value = null;
        page.value = 0;
      }
      record.value = next;
      saving.value = isSaving;
    },
    destroy() {
      requestId++;
      disposed = true;
      unmount();
    },
  };
}
