import type {
  ClaimCardEffect,
  ClaimChallengePrimitive,
  CurseClearCondition,
  GeoCoordinate,
  GeoSnapshot,
  HideSeekCardEffect,
  HideSeekQuestionFamily,
  HideSeekRegroupPolicy,
  HideSeekRepeatCostMode,
  MapConfig,
  RulebookFormat,
  RulebookValidationIssue,
} from "@kelana-ria/contracts";
import { escapeText } from "./solo-view";
import {
  buildClaimCardFromForm,
  buildClaimChallengeFromForm,
  renderClaimLiveCardPreview,
  renderClaimStep3,
  type ClaimStep3State,
} from "./studio-claim-builder";
import {
  parseStudioBundleJson,
  serializeStudioBundle,
  triggerStudioBundleDownload,
} from "./studio-json";
import {
  buildSeekCardFromForm,
  renderSeekLiveCardPreview,
  renderSeekStep3,
  type SeekStep3State,
} from "./studio-seek-builder";
import { formatHeroCardSvg, stepIconSvg } from "./studio-assets";
import {
  evaluateClaimDryRunAnswer,
  evaluateSeekDryRunClue,
  renderInteractiveDryRunPanel,
  resolveValidationJump,
  type DryRunState,
} from "./studio-dry-run";
import {
  buildTransitOverlayPins,
  createNewLandmark,
  createNewPoi,
  createNewStation,
  createNewZone,
  ensureStep2Selection,
  parseAttributes,
  renderStep2Bottom,
  renderStep2Top,
  renderStep2View,
  syncBoundaryTransitStationsInDraft,
  syncModeStationsInDraft,
  toggleCatalogStationInDraft,
  type JakartaTransitCatalog,
  type Step2State,
} from "./studio-step2-view";
import type {
  StudioMapEditorHandle,
  StudioMapMode,
  StudioTransitMode,
} from "./studio-map-editor";
import {
  isClaimStudioPack,
  type StudioEarningsRecord,
  type StudioPack,
  type StudioStep,
  type StudioVersionRecord,
} from "./studio-types";
import "./rulebook-seek-play.css";

const STEP_META: { step: StudioStep; short: string; label: string }[] = [
  { step: 1, short: "1. Draf", label: "Draf & Info" },
  { step: 2, short: "2. Peta", label: "Peta & Lokasi" },
  { step: 3, short: "3. Aturan", label: "Aturan & Kartu" },
  { step: 4, short: "4. Validasi", label: "Validasi & Ajukan" },
];

const STATUS_LABELS: Record<string, string> = {
  draft: "Draf",
  "changes-requested": "Perlu Revisi",
  submitted: "Menunggu Tinjauan",
  published: "Terbit",
  paused: "Dijeda",
};

function statusLabel(status: string): string {
  return STATUS_LABELS[status] ?? status;
}

export function mountRulebookStudio(root: HTMLElement, onBack: () => void): () => void {
  const initialFormat =
    new URLSearchParams(location.search).get("format") === "claim-the-city" ? "claim-the-city" : "hide-and-seek";
  let format: RulebookFormat = initialFormat;
  let tab: "writer" | "reviewer" = "writer";
  let step: StudioStep = 1;
  let showCloneForm = false;
  let showJsonTools = false;
  let jsonBuffer = "";
  let versions: StudioVersionRecord[] = [];
  let earnings: StudioEarningsRecord[] = [];
  let selectedKey = "";
  let validationErrors: RulebookValidationIssue[] = [];
  let dryRunSummary = "";
  let statusMsg = "";
  let errorMsg = "";
  let refreshSeq = 0;
  let studioMapHandle: StudioMapEditorHandle | undefined;
  let studioMapKey = "";
  let studioMapReq = 0;
  let mapCfgPromise: Promise<MapConfig> | null = null;
  let transitCatalogPromise: Promise<JakartaTransitCatalog | null> | null = null;
  const step2: Step2State = {
    mapMode: "select",
    subTab: "primary",
    selected: null,
    mapFailed: false,
    lastClickedCoord: null,
    transitCatalog: null,
    enabledTransitModes: {
      mrt: true,
      lrt: true,
      krl: true,
      transjakarta: true,
    },
    excludedTransitIds: new Set<string>(),
    transitQuery: "",
  };
  const seekStep3: SeekStep3State = {
    subTab: "timers",
    family: "radar",
    cardPrimitive: "curse",
    curseClearType: "photo_challenge",
  };
  const claimStep3: ClaimStep3State = {
    subTab: "session",
    challengeTarget: "backup",
    challengePrimitive: "call_your_shot",
    cardPrimitive: "sabotage_curse",
  };
  const dryRun: DryRunState = {
    seekAnchorId: "",
    seekSeekerPosId: "start",
    seekClueKey: "",
    seekClueOutput: "",
    claimLandmarkId: "",
    claimTestOpen: false,
    claimShotTier: null,
    claimMultiStepIdx: 0,
    claimTestResult: "",
  };

  async function persistDraft(
    updatedPack: StudioPack,
    updatedSnapshot: GeoSnapshot,
    successMessage?: string,
  ): Promise<boolean> {
    const res = await apiJson<{
      ok?: boolean;
      record?: StudioVersionRecord;
      validation?: { ok: boolean; errors: RulebookValidationIssue[] };
      error?: string;
    }>("/api/rulebooks", {
      type: "save-draft",
      pack: updatedPack,
      snapshot: updatedSnapshot,
      rehashSnapshot: true,
    });
    if (res.ok) {
      if (res.record) selectedKey = `${res.record.packId}@${res.record.version}`;
      validationErrors = res.validation?.errors ?? [];
      statusMsg =
        successMessage ??
        (res.validation?.ok
          ? "Draf tersimpan dan lolos validator otomatis."
          : "Draf tersimpan dengan kesalahan validasi.");
      await refresh();
      return true;
    }
    errorMsg = res.error ?? "Gagal menyimpan draf.";
    render();
    return false;
  }

  function destroyStep2Map() {
    studioMapReq++;
    studioMapHandle?.destroy();
    studioMapHandle = undefined;
    studioMapKey = "";
  }

  function ensureTransitCatalog() {
    if (step2.transitCatalog) return;
    if (!transitCatalogPromise) {
      transitCatalogPromise = apiJson<JakartaTransitCatalog>("/api/transit/jakarta")
        .then((catalog) => (Array.isArray(catalog?.stations) ? catalog : null))
        .catch(() => null);
    }
    void transitCatalogPromise.then((catalog) => {
      if (catalog && !step2.transitCatalog) {
        step2.transitCatalog = catalog;
        if (step === 2) render();
      }
    });
  }

  async function handleToggleTransitStation(stationId: string) {
    const latest = currentDraft();
    if (!latest || !isEditable(latest)) return;
    const pack = structuredClone(latest.pack);
    const snap = structuredClone(latest.snapshot);
    const toggled = toggleCatalogStationInDraft(pack, snap, step2, stationId);
    if (!toggled) return;
    await persistDraft(
      pack,
      snap,
      `${toggled.name} ${toggled.included ? "diaktifkan ke" : "dikeluarkan dari"} draf.`,
    );
  }

  function handleStep2SelectTarget(target: { kind: "start" | "station" | "poi" | "landmark"; id: string }) {
    step2.selected = target;
    render();
  }

  function handleStep2MapClick(coord: GeoCoordinate) {
    step2.lastClickedCoord = coord;
    const latest = currentDraft();
    if (!latest || !isEditable(latest) || step2.mapMode === "select") {
      render();
      return;
    }
    const pack = structuredClone(latest.pack);
    const snap = structuredClone(latest.snapshot);
    if (step2.mapMode === "boundary") {
      snap.boundaryPolygon.push(coord);
      syncBoundaryTransitStationsInDraft(pack, snap, step2);
      void persistDraft(pack, snap, `Sudut batas ditambahkan (${coord.latitude}, ${coord.longitude}).`);
      return;
    }
    if (step2.mapMode === "add") {
      if (isClaimStudioPack(pack)) {
        const emptyZone = pack.geography.zones.find(
          (z) => !pack.geography.landmarks.some((l) => l.zoneId === z.id),
        );
        const zoneId = emptyZone?.id ?? pack.geography.zones[0]?.id ?? "zone-1";
        const lm = createNewLandmark(coord, zoneId, pack.geography.landmarks.length);
        pack.geography.landmarks.push(lm);
        pack.challenges.landmarkChallenges[lm.id] = [
          {
            id: `chal-${lm.id}`,
            title: `Tantangan ${lm.name}`,
            verificationNotes: "Terverifikasi dari ruang publik.",
            reviewed: true,
            reviewedAt: new Date().toISOString().slice(0, 10),
            payload: {
              primitive: "photo_proof",
              prompt: `Ambil foto publik di ${lm.name}.`,
              verificationMode: "rival_or_timeout",
              autoApproveMs: 120_000,
            },
          },
        ];
        step2.selected = { kind: "landmark", id: lm.id };
        void persistDraft(pack, snap, `Landmark ${lm.name} ditambahkan di peta.`);
      } else if (step2.subTab === "secondary") {
        const poi = createNewPoi(coord, snap.pois.length);
        snap.pois.push(poi);
        step2.selected = { kind: "poi", id: poi.id };
        void persistDraft(pack, snap, `POI ${poi.name} ditambahkan di peta.`);
      } else {
        const st = createNewStation(coord, snap.stations.length);
        snap.stations.push(st);
        step2.selected = { kind: "station", id: st.id };
        void persistDraft(pack, snap, `Stasiun ${st.name} ditambahkan di peta.`);
      }
      return;
    }
    if (step2.mapMode === "move" && step2.selected) {
      if (step2.selected.kind === "start") {
        snap.startPoint.latitude = coord.latitude;
        snap.startPoint.longitude = coord.longitude;
      } else if (step2.selected.kind === "station") {
        const st = snap.stations.find((s) => s.id === step2.selected!.id);
        if (st) {
          st.latitude = coord.latitude;
          st.longitude = coord.longitude;
        }
      } else if (step2.selected.kind === "poi") {
        const poi = snap.pois.find((p) => p.id === step2.selected!.id);
        if (poi) {
          poi.latitude = coord.latitude;
          poi.longitude = coord.longitude;
        }
      } else if (step2.selected.kind === "landmark" && isClaimStudioPack(pack)) {
        const lm = pack.geography.landmarks.find((l) => l.id === step2.selected!.id);
        if (lm) {
          lm.latitude = coord.latitude;
          lm.longitude = coord.longitude;
        }
      }
      void persistDraft(pack, snap, `Titik dipindahkan ke (${coord.latitude}, ${coord.longitude}).`);
    }
  }

  async function mountStep2Map(host: HTMLElement, active: StudioVersionRecord, draftKey: string) {
    const reqId = ++studioMapReq;
    ensureTransitCatalog();
    try {
      if (!mapCfgPromise) mapCfgPromise = apiJson<MapConfig>("/api/map/config");
      const [{ mountStudioMapEditor }, cfg] = await Promise.all([
        import("./studio-map-editor"),
        mapCfgPromise,
      ]);
      if (reqId !== studioMapReq || !host.isConnected) return;
      const latest = currentDraft() ?? active;
      const selected = ensureStep2Selection(latest, step2);
      studioMapKey = draftKey;
      studioMapHandle = mountStudioMapEditor({
        container: host,
        config: cfg,
        record: latest,
        mode: step2.mapMode,
        selectedTarget: selected,
        transitStations: buildTransitOverlayPins(latest, step2),
        onToggleTransitStation: (stationId) => {
          void handleToggleTransitStation(stationId);
        },
        onSelectTarget: handleStep2SelectTarget,
        onMapClick: handleStep2MapClick,
        onError: () => {
          step2.mapFailed = true;
          destroyStep2Map();
          render();
        },
      });
    } catch {
      if (reqId !== studioMapReq) return;
      step2.mapFailed = true;
      destroyStep2Map();
      render();
    }
  }

  async function apiJson<T>(path: string, body?: unknown): Promise<T> {
    const res = await fetch(path, {
      method: body === undefined ? "GET" : "POST",
      headers: body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return (await res.json()) as T;
  }

  async function refresh() {
    const seq = ++refreshSeq;
    const targetFormat = format;
    const data = await apiJson<{ versions?: StudioVersionRecord[]; earnings?: StudioEarningsRecord[] }>(
      "/api/rulebooks?role=reviewer",
    );
    if (seq !== refreshSeq || targetFormat !== format) return;
    versions = (data.versions ?? []).filter((v) => v.format === format);
    earnings = data.earnings ?? [];
    const community = versions.filter((v) => !v.isOfficial);
    if (!selectedKey || !community.some((v) => `${v.packId}@${v.version}` === selectedKey)) {
      const firstDraft = community[0];
      selectedKey = firstDraft ? `${firstDraft.packId}@${firstDraft.version}` : "";
    }
    if (community.length === 0) showCloneForm = true;
    render();
  }

  function currentDraft(): StudioVersionRecord | undefined {
    return versions.find((v) => !v.isOfficial && `${v.packId}@${v.version}` === selectedKey);
  }

  function isEditable(rec: StudioVersionRecord): boolean {
    return rec.status === "draft" || rec.status === "changes-requested";
  }

  function isStepDone(stepNum: StudioStep, rec: StudioVersionRecord | undefined): boolean {
    if (!rec) return false;
    if (stepNum === 1) return true;
    if (stepNum === 2) {
      return rec.snapshot.boundaryPolygon.length >= 3 && rec.snapshot.stations.length + rec.snapshot.pois.length > 0;
    }
    if (stepNum === 3) {
      return isClaimStudioPack(rec.pack)
        ? Object.keys(rec.pack.challenges.landmarkChallenges).length > 0
        : rec.pack.deck.cards.length > 0;
    }
    return validationErrors.length === 0 && rec.status !== "draft";
  }

  function renderStepper(): string {
    const active = currentDraft();
    return `<nav class="rb-stepper" aria-label="Tahap penyusunan paket">
      ${STEP_META.map((item) => {
        const done = isStepDone(item.step, active);
        return `<button type="button" class="rb-step-btn ${step === item.step ? "rb-step-active" : ""}" data-step="${item.step}" aria-current="${step === item.step ? "step" : "false"}">${stepIconSvg(item.step)}<span>${escapeText(item.short)}</span>${done ? `<span class="st-step-done" aria-label="Selesai">✓</span>` : ""}</button>`;
      }).join("")}
    </nav>`;
  }

  function renderCloneCard(officialTemplates: StudioVersionRecord[]): string {
    if (officialTemplates.length === 0) {
      return `<div class="rb-card" data-testid="clone-template-card"><h3>Kloning dari Templat Resmi</h3><p role="status">Memuat templat resmi…</p></div>`;
    }
    const defaultPackId = format === "claim-the-city" ? "pack-senopati-claim" : "pack-senopati-seek";
    const defaultTitle =
      format === "claim-the-city" ? "Senopati Culinary Claim the City" : "Senopati Coffee Hide & Seek";
    return `<div class="rb-card" data-testid="clone-template-card">
      <h3>Kloning dari Templat Resmi</h3>
      <div class="rb-grid-2">
        <label class="rb-field"><span>Templat Resmi</span>
          <select id="st-template">
            ${officialTemplates.map((t) => `<option value="${escapeText(t.packId)}">${escapeText(t.pack.meta.title)}</option>`).join("")}
          </select>
        </label>
        <label class="rb-field"><span>ID Paket Baru</span><input id="st-pack-id" value="${defaultPackId}"></label>
        <label class="rb-field"><span>Judul Paket</span><input id="st-title" value="${defaultTitle}"></label>
        <label class="rb-field"><span>Nama Kreator</span><input id="st-byline" value="Kolektif Selatan"></label>
        <label class="rb-field"><span>Harga Sesi (IDR)</span><input id="st-price" type="number" value="30000" min="0" step="1000"></label>
      </div>
      <div class="rb-actions">
        <button type="button" class="primary" data-action="clone">Kloning Templat Jadi Draf</button>
      </div>
    </div>`;
  }

  function renderStep1(
    officialTemplates: StudioVersionRecord[],
    communityVersions: StudioVersionRecord[],
    active?: StudioVersionRecord,
  ): string {
    const nextVersionNum = active
      ? Math.max(...communityVersions.filter((v) => v.packId === active.packId).map((v) => v.version)) + 1
      : 2;

    return `
      ${
        active && active.status === "changes-requested" && active.reviewNote
          ? `<div class="rb-banner-warn" role="alert" data-testid="revision-note-banner">
              <strong>Catatan Peninjau (${escapeText(active.packId)} v${active.version}):</strong>
              <span>${escapeText(active.reviewNote)}</span>
            </div>`
          : ""
      }

      <div class="rb-card">
        <h3>Draf Saya (${communityVersions.length})</h3>
        ${
          communityVersions.length > 0
            ? `<label class="rb-field"><span>Pilih Draf / Versi Aktif</span>
                <select id="st-draft-select">
                  ${communityVersions
                    .map((v) => {
                      const key = `${v.packId}@${v.version}`;
                      return `<option value="${escapeText(key)}" ${key === selectedKey ? "selected" : ""}>${escapeText(v.pack.meta.title)} · ${escapeText(v.packId)} v${v.version} (${escapeText(statusLabel(v.status))})</option>`;
                    })
                    .join("")}
                </select>
              </label>`
            : `<p>Belum ada draf untuk format ini. Kloning templat resmi di bawah untuk memulai.</p>`
        }
        <div class="rb-actions">
          <button type="button" class="secondary" data-action="toggle-clone">${showCloneForm ? "Tutup Form Kloning" : "+ Kloning Templat Baru"}</button>
          ${
            active && !isEditable(active)
              ? `<button type="button" class="primary" data-action="clone-next-version">Buat Versi Berikutnya (v${nextVersionNum})</button>`
              : ""
          }
          <button type="button" class="secondary" data-action="toggle-json">${showJsonTools ? "Tutup JSON Tools" : "Ekspor / Impor JSON"}</button>
        </div>
      </div>

      ${showCloneForm ? renderCloneCard(officialTemplates) : ""}

      ${
        showJsonTools
          ? `<div class="rb-card" data-testid="json-tools-card">
              <h3>JSON Power Tools (<code>{ pack, snapshot }</code>)</h3>
              <p><small>Unduh draf sebagai JSON untuk disunting eksternal atau tempel/unggah berkas JSON untuk mengimpornya menjadi draf baru.</small></p>
              <div class="rb-actions">
                ${active ? `<button type="button" class="secondary" data-action="export-json">Unduh JSON Draf Aktif</button>` : ""}
                <label class="rb-field"><span>Pilih Berkas JSON</span><input id="st-json-file" type="file" accept="application/json,.json"></label>
              </div>
              <label class="rb-field">
                <span>JSON Bundel (<code>{ pack, snapshot }</code>)</span>
                <textarea id="st-json-text" class="rb-json-area" placeholder='{"pack": {...}, "snapshot": {...}}'>${escapeText(jsonBuffer)}</textarea>
              </label>
              <div class="rb-actions">
                <button type="button" class="primary" data-action="import-json">Impor &amp; Validasi JSON</button>
              </div>
            </div>`
          : ""
      }

      ${
        active
          ? `<div class="rb-card">
              <div class="rb-badges">
                <span class="rb-badge">${escapeText(active.packId)} v${active.version}</span>
                <span class="rb-badge">${escapeText(statusLabel(active.status))}</span>
              </div>
              <h3>Info Paket Aktif</h3>
              ${
                !isEditable(active)
                  ? `<p><small>Versi ini berstatus <strong>${escapeText(statusLabel(active.status))}</strong> dan terkunci. Klik <strong>Buat Versi Berikutnya</strong> untuk menyunting versi baru.</small></p>`
                  : ""
              }
              <div class="rb-grid-2">
                <label class="rb-field"><span>Judul Paket</span><input id="ed-meta-title" value="${escapeText(active.pack.meta.title)}" ${!isEditable(active) ? "disabled" : ""}></label>
                <label class="rb-field"><span>Nama Kreator</span><input id="ed-meta-byline" value="${escapeText(active.pack.meta.byline)}" ${!isEditable(active) ? "disabled" : ""}></label>
                <label class="rb-field"><span>Kota / Wilayah</span><input id="ed-meta-city" value="${escapeText(active.pack.meta.cityLabel)}" ${!isEditable(active) ? "disabled" : ""}></label>
                <label class="rb-field"><span>Harga Sesi (IDR)</span><input id="ed-meta-price" type="number" min="0" step="1000" value="${active.pack.meta.priceIdr}" ${!isEditable(active) ? "disabled" : ""}></label>
              </div>
              <label class="rb-field"><span>Ringkasan Paket</span><input id="ed-meta-summary" value="${escapeText(active.pack.meta.summary)}" ${!isEditable(active) ? "disabled" : ""}></label>
              <div class="rb-sticky-footer">
                <span></span>
                ${isEditable(active) ? `<button type="button" class="secondary" data-action="save-draft">Simpan</button>` : "<span></span>"}
                <button type="button" class="primary" data-step="2">Peta →</button>
              </div>
            </div>`
          : ""
      }
    `;
  }

  function renderStep2(active?: StudioVersionRecord): string {
    if (!active) {
      return `<div class="rb-card"><p>Pilih atau kloning draf di Tahap 1 terlebih dahulu.</p><button type="button" class="primary" data-step="1">← Kembali ke Tahap 1</button></div>`;
    }
    return renderStep2View(active, step2, isEditable(active));
  }

  function renderStep3(active?: StudioVersionRecord): string {
    if (!active) {
      return `<div class="rb-card"><p>Pilih atau kloning draf di Tahap 1 terlebih dahulu.</p><button type="button" class="primary" data-step="1">← Kembali ke Tahap 1</button></div>`;
    }
    const editable = isEditable(active);
    if (isClaimStudioPack(active.pack)) {
      return renderClaimStep3(active.pack, claimStep3, editable);
    }
    return renderSeekStep3(active.pack, seekStep3, editable);
  }

  function renderStep4(active?: StudioVersionRecord): string {
    if (!active) {
      return `<div class="rb-card"><p>Pilih atau kloning draf di Tahap 1 terlebih dahulu.</p><button type="button" class="primary" data-step="1">← Kembali ke Tahap 1</button></div>`;
    }
    const editable = isEditable(active);
    return `<div class="rb-card" data-studio-slot="dry-run-panel">
      <h3>4. Validasi, Simulasi Dry-Run &amp; Ajukan · ${escapeText(active.pack.meta.title)} (v${active.version})</h3>
      <div class="rb-badges">
        <span class="rb-badge">Status: ${escapeText(statusLabel(active.status))}</span>
        <span class="rb-badge">Hash Geo: ${escapeText(active.snapshot.hash.slice(0, 10))}…</span>
      </div>
      <div class="rb-actions">
        ${editable ? `<button type="button" class="secondary" data-action="save-draft">Jalankan Validator Otomatis</button>` : ""}
        <button type="button" class="secondary" data-action="dry-run">Simulasi Dry-Run GPS</button>
        ${editable ? `<button type="button" class="primary" data-action="submit-draft">Ajukan untuk Tinjauan</button>` : ""}
      </div>
      ${dryRunSummary ? `<p role="status" class="rb-badge">${escapeText(dryRunSummary)}</p>` : ""}
      <div class="rb-sticky-footer">
        <button type="button" class="secondary" data-step="3">← Aturan</button>
        ${editable ? `<button type="button" class="secondary" data-action="save-draft">Validasi</button>` : "<span></span>"}
        <button type="button" class="secondary" data-tab="reviewer">Peninjau →</button>
      </div>
    </div>

    ${renderInteractiveDryRunPanel(active, dryRun)}

    <div class="rb-card">
      <h3>Pendapatan Kreator (${earnings.length})</h3>
      <ul class="rb-list">
        ${
          earnings.length === 0
            ? "<li>Belum ada pesanan terbayar.</li>"
            : earnings
                .map(
                  (e) => `<li><strong>${escapeText(e.title)}</strong> · Order <code>${escapeText(e.orderId)}</code> · Bruto Rp ${e.grossAmountIdr.toLocaleString("id-ID")} · Bagian Kreator Rp ${e.creatorShareIdr.toLocaleString("id-ID")}</li>`,
                )
                .join("")
        }
      </ul>
    </div>`;
  }

  function render() {
    const officialTemplates = versions.filter((v) => v.isOfficial);
    const communityVersions = versions.filter((v) => !v.isOfficial);
    const submittedCount = communityVersions.filter((v) => v.status === "submitted").length;
    const active = currentDraft();

    if (!root.querySelector("#st-header-slot")) {
      root.innerHTML = `<section class="rb-shell" aria-label="Studio Kreator Rulebook">
        <div id="st-header-slot"></div>
        <div id="st-stepper-slot"></div>
        <div id="st-body-slot"></div>
      </section>`;
    }

    const headerSlot = root.querySelector<HTMLElement>("#st-header-slot")!;
    const stepperSlot = root.querySelector<HTMLElement>("#st-stepper-slot")!;
    const bodySlot = root.querySelector<HTMLElement>("#st-body-slot")!;

    headerSlot.innerHTML = `<div class="rb-card">
      <h2>Studio Kreator · ${format === "claim-the-city" ? "Claim the City" : "Hide &amp; Seek"}</h2>
      <div class="rb-badges">
        <span class="rb-badge">4 Langkah Visual</span>
        <span class="rb-badge">Peta Interaktif</span>
        <span class="rb-badge">Uji Coba Langsung</span>
      </div>
      <div class="st-format-grid" role="group" aria-label="Pilih format permainan">
        <button type="button" class="st-format-card" data-format="hide-and-seek" aria-pressed="${format === "hide-and-seek"}">
          ${formatHeroCardSvg("hide-and-seek")}
          <strong>Hide &amp; Seek</strong>
          <span class="st-tile-meta">6 Petunjuk · Dek &amp; Kutukan</span>
        </button>
        <button type="button" class="st-format-card" data-format="claim-the-city" aria-pressed="${format === "claim-the-city"}">
          ${formatHeroCardSvg("claim-the-city")}
          <strong>Claim the City</strong>
          <span class="st-tile-meta">Zona · 6 Primitif Tantangan</span>
        </button>
      </div>
      <div class="rb-actions">
        <button type="button" class="${tab === "writer" ? "primary" : "secondary"}" data-tab="writer">Penulis (Creator)</button>
        <button type="button" class="${tab === "reviewer" ? "primary" : "secondary"}" data-tab="reviewer">Peninjau (${submittedCount})</button>
        <button type="button" class="secondary" data-nav="catalog">Katalog Publik</button>
        <button type="button" class="secondary" data-nav="back">Beranda</button>
      </div>
      ${statusMsg ? `<p role="status">${escapeText(statusMsg)}</p>` : ""}
      ${errorMsg ? `<p role="alert" class="rb-errors">${escapeText(errorMsg)}</p>` : ""}
      ${
        validationErrors.length > 0
          ? `<ul class="rb-errors" aria-label="Kesalahan validasi">${validationErrors
              .map((e) => {
                const target = resolveValidationJump(e.path, format);
                return `<li>
                  <div><code>${escapeText(e.code)}</code> (${escapeText(e.path)}): ${escapeText(e.message)}</div>
                  <button type="button" class="secondary" data-jump-path="${escapeText(e.path)}">Lompat &amp; Perbaiki (${escapeText(target.label)}) →</button>
                </li>`;
              })
              .join("")}</ul>`
          : ""
      }
    </div>`;

    stepperSlot.innerHTML = tab === "writer" ? renderStepper() : "";

    if (tab !== "writer") {
      destroyStep2Map();
      bodySlot.innerHTML = `<div class="rb-card">
        <h3>Antrean Tinjauan Editorial (${communityVersions.length})</h3>
        <ul class="rb-list">
          ${
            communityVersions.length === 0
              ? "<li>Belum ada paket komunitas untuk format ini.</li>"
              : communityVersions
                  .map(
                    (v) => `<li>
                      <div class="rb-rev-head">
                        <strong>${escapeText(v.pack.meta.title)}</strong>
                        <div class="rb-badges">
                          <code>${escapeText(v.packId)} v${v.version}</code>
                          <span class="rb-badge">${escapeText(statusLabel(v.status))}</span>
                        </div>
                      </div>
                      ${v.reviewNote ? `<small>Catatan terakhir: ${escapeText(v.reviewNote)}</small>` : ""}
                      ${
                        v.status === "submitted"
                          ? `<label class="rb-field"><span>Catatan Revisi (opsional)</span><input id="rev-note-${escapeText(v.packId)}-${v.version}" value="Perjelas catatan akses lokasi."></label>`
                          : ""
                      }
                      <div class="rb-actions">
                        ${v.status === "submitted" ? `<button type="button" class="primary" data-action="publish" data-pack="${escapeText(v.packId)}" data-version="${v.version}">Terbitkan ke Katalog</button>` : ""}
                        ${v.status === "submitted" ? `<button type="button" class="secondary" data-action="request-changes" data-pack="${escapeText(v.packId)}" data-version="${v.version}">Minta Revisi</button>` : ""}
                        ${v.status === "published" ? `<button type="button" class="secondary" data-action="pause" data-pack="${escapeText(v.packId)}" data-version="${v.version}">Jeda Penjualan</button>` : ""}
                      </div>
                    </li>`,
                  )
                  .join("")
          }
        </ul>
      </div>`;
      return;
    }

    if (step === 2 && active) {
      ensureTransitCatalog();
      const editable = isEditable(active);
      const draftKey = `${active.packId}@${active.version}`;
      const topSlot = bodySlot.querySelector<HTMLElement>("#st-step2-top");
      const mapHost = bodySlot.querySelector<HTMLElement>("#st-map-host");
      const fallbackEl = bodySlot.querySelector<HTMLElement>("#st-map-fallback");
      const bottomSlot = bodySlot.querySelector<HTMLElement>("#st-step2-bottom");

      if (topSlot && mapHost && fallbackEl && bottomSlot && studioMapKey === draftKey) {
        topSlot.innerHTML = renderStep2Top(active, step2, editable);
        bottomSlot.innerHTML = renderStep2Bottom(active, step2, editable);
        mapHost.hidden = step2.mapFailed;
        fallbackEl.hidden = !step2.mapFailed;
        if (step2.mapFailed) {
          destroyStep2Map();
        } else {
          studioMapHandle?.update({
            record: active,
            mode: step2.mapMode,
            selectedTarget: ensureStep2Selection(active, step2),
            transitStations: buildTransitOverlayPins(active, step2),
            onToggleTransitStation: (stationId) => {
              void handleToggleTransitStation(stationId);
            },
            onSelectTarget: handleStep2SelectTarget,
            onMapClick: handleStep2MapClick,
          });
        }
        return;
      }

      destroyStep2Map();
      bodySlot.innerHTML = renderStep2View(active, step2, editable);
      if (!step2.mapFailed) {
        const freshHost = bodySlot.querySelector<HTMLElement>("#st-map-host");
        if (freshHost) void mountStep2Map(freshHost, active, draftKey);
      }
      return;
    }

    destroyStep2Map();
    bodySlot.innerHTML =
      step === 1
        ? renderStep1(officialTemplates, communityVersions, active)
        : step === 2
          ? renderStep2(active)
          : step === 3
            ? renderStep3(active)
            : renderStep4(active);
  }

  function applyFormEdits(active: StudioVersionRecord): { pack: StudioPack; snapshot: GeoSnapshot } {
    const updatedSnapshot: GeoSnapshot = structuredClone(active.snapshot);
    const updatedPack: StudioPack = structuredClone(active.pack);

    const metaTitle = root.querySelector<HTMLInputElement>("#ed-meta-title")?.value.trim();
    if (metaTitle) updatedPack.meta.title = metaTitle;
    const metaByline = root.querySelector<HTMLInputElement>("#ed-meta-byline")?.value.trim();
    if (metaByline) updatedPack.meta.byline = metaByline;
    const metaCity = root.querySelector<HTMLInputElement>("#ed-meta-city")?.value.trim();
    if (metaCity) updatedPack.meta.cityLabel = metaCity;
    const metaSummary = root.querySelector<HTMLInputElement>("#ed-meta-summary")?.value.trim();
    if (metaSummary) updatedPack.meta.summary = metaSummary;
    const metaPriceEl = root.querySelector<HTMLInputElement>("#ed-meta-price");
    if (metaPriceEl) updatedPack.meta.priceIdr = Number(metaPriceEl.value || 0);

    if (isClaimStudioPack(updatedPack)) {
      const minpEl = root.querySelector<HTMLInputElement>("#ed-claim-minp");
      if (minpEl) updatedPack.session.minPlayers = Number(minpEl.value || 1);
      const maxpEl = root.querySelector<HTMLInputElement>("#ed-claim-maxp");
      if (maxpEl) updatedPack.session.maxPlayers = Number(maxpEl.value || 4);
      const teamEl = root.querySelector<HTMLSelectElement>("#ed-claim-team");
      if (teamEl) updatedPack.session.teamMode = teamEl.value as "ffa" | "teams";
      const durEl = root.querySelector<HTMLInputElement>("#ed-claim-duration");
      if (durEl) updatedPack.session.durationMs = Number(durEl.value || 90) * 60_000;
      const locksEl = root.querySelector<HTMLInputElement>("#ed-claim-solo-locks");
      const zonesEl = root.querySelector<HTMLInputElement>("#ed-claim-solo-zones");
      if (updatedPack.session.soloTargets) {
        if (locksEl) updatedPack.session.soloTargets.lockedLandmarks = Number(locksEl.value || 4);
        if (zonesEl) updatedPack.session.soloTargets.distinctZones = Number(zonesEl.value || 2);
      }
      const fpEl = root.querySelector<HTMLSelectElement>("#ed-claim-fail-policy");
      if (fpEl) updatedPack.claiming.multiplayerFailPolicy = fpEl.value as "cooldown_ms" | "burned_for_player";
      const cdEl = root.querySelector<HTMLInputElement>("#ed-claim-cooldown");
      if (cdEl) updatedPack.claiming.failCooldownMs = Number(cdEl.value || 5) * 60_000;
      const handEl = root.querySelector<HTMLInputElement>("#ed-claim-hand");
      if (handEl) updatedPack.tacticalDeck.maxHandSize = Number(handEl.value || 2);
      const lmName = root.querySelector<HTMLInputElement>("#ed-claim-landmark-name")?.value.trim();
      if (lmName && updatedPack.geography.landmarks[0]) {
        updatedPack.geography.landmarks[0].name = lmName;
      }
      const photoTitle = root.querySelector<HTMLInputElement>("#ed-claim-photo-title")?.value.trim();
      if (photoTitle) {
        updatedPack.challenges.backupPool.push({
          id: `custom-photo-${Date.now()}`,
          title: photoTitle,
          verificationNotes: "Terverifikasi dari ruang publik bebas tiket oleh kreator.",
          reviewed: true,
          reviewedAt: new Date().toISOString().slice(0, 10),
          payload: {
            primitive: "photo_proof",
            prompt: `Ambil foto publik untuk tantangan: ${photoTitle}`,
            verificationMode: "rival_or_timeout",
            autoApproveMs: 3 * 60_000,
          },
        });
      }
    } else {
      const minpEl = root.querySelector<HTMLInputElement>("#ed-seek-minp");
      if (minpEl) updatedPack.session.minPlayers = Number(minpEl.value || 2);
      const maxpEl = root.querySelector<HTMLInputElement>("#ed-seek-maxp");
      if (maxpEl) updatedPack.session.maxPlayers = Number(maxpEl.value || 4);
      const rgpEl = root.querySelector<HTMLSelectElement>("#ed-regroup-policy");
      if (rgpEl) updatedPack.session.regroupPolicy = rgpEl.value as HideSeekRegroupPolicy;
      const repEl = root.querySelector<HTMLSelectElement>("#ed-repeat-mode");
      if (repEl) updatedPack.investigationBook.repeatCostMode = repEl.value as HideSeekRepeatCostMode;
      const zoneEl = root.querySelector<HTMLInputElement>("#ed-zone");
      if (zoneEl) updatedPack.geography.hidingZoneRadiusMeters = Number(zoneEl.value || 400);
      const headEl = root.querySelector<HTMLInputElement>("#ed-head");
      if (headEl) updatedPack.timers.headStartMs = Number(headEl.value || 25) * 60_000;
      const searchEl = root.querySelector<HTMLInputElement>("#ed-search");
      if (searchEl) updatedPack.timers.searchLimitMs = Number(searchEl.value || 60) * 60_000;
      const regroupEl = root.querySelector<HTMLInputElement>("#ed-regroup");
      if (regroupEl) updatedPack.timers.regroupLimitMs = Number(regroupEl.value || 30) * 60_000;
      const handEl = root.querySelector<HTMLInputElement>("#ed-hand");
      if (handEl) updatedPack.deck.baseHandLimit = Number(handEl.value || 5);
      const maxCursesEl = root.querySelector<HTMLInputElement>("#ed-max-curses");
      if (maxCursesEl) updatedPack.deck.maxActiveBlockingCurses = Number(maxCursesEl.value || 1);
      const stationName = root.querySelector<HTMLInputElement>("#ed-station-name")?.value.trim();
      if (stationName && updatedSnapshot.stations[0]) {
        updatedSnapshot.stations[0].name = stationName;
      }
      const curseTitle = root.querySelector<HTMLInputElement>("#ed-curse-title")?.value.trim();
      if (curseTitle) {
        updatedPack.deck.cards.push({
          id: `custom-curse-${Date.now()}`,
          category: "curse",
          copies: 1,
          title: curseTitle,
          description: "Kutukan foto kustom kreator (batas auto-approve 3 menit).",
          effect: {
            primitive: "curse",
            curse: {
              castingCosts: [{ type: "none" }],
              blockerType: "block_questions",
              clearCondition: {
                type: "photo_challenge",
                prompt: `Kirim foto tantangan: ${curseTitle}`,
                approvalMode: "opponent_or_timeout",
                autoApproveMs: 3 * 60_000,
              },
            },
          },
        });
      }
    }

    return { pack: updatedPack, snapshot: updatedSnapshot };
  }

  function updateLiveCardPreview() {
    const slot = root.querySelector<HTMLElement>('[data-testid="live-card-preview"]');
    if (!slot) return;
    slot.innerHTML =
      format === "claim-the-city"
        ? renderClaimLiveCardPreview(root, claimStep3)
        : renderSeekLiveCardPreview(root, seekStep3);
  }

  root.addEventListener("input", (event) => {
    const target = event.target as HTMLElement | null;
    if (!target || !target.id) return;
    if (target instanceof HTMLInputElement && target.id === "st-transit-search") {
      const pos = target.selectionStart ?? target.value.length;
      step2.transitQuery = target.value;
      render();
      const refreshed = root.querySelector<HTMLInputElement>("#st-transit-search");
      if (refreshed) {
        refreshed.focus();
        refreshed.setSelectionRange(pos, pos);
      }
      return;
    }
    if (target.id.startsWith("ed-card-") || target.id.startsWith("ed-curse-") || target.id.startsWith("ed-ccard-")) {
      updateLiveCardPreview();
    }
  });

  root.addEventListener("change", (event) => {
    const target = event.target as HTMLElement | null;
    if (
      target instanceof HTMLSelectElement &&
      (target.id.startsWith("ed-curse-") || target.id.startsWith("ed-ccard-")) &&
      target.id !== "ed-curse-clear" &&
      target.id !== "ed-ccard-prim"
    ) {
      updateLiveCardPreview();
      return;
    }
    if (target instanceof HTMLSelectElement && target.id === "st-draft-select") {
      selectedKey = target.value;
      step2.selected = null;
      dryRunSummary = "";
      validationErrors = [];
      statusMsg = "";
      errorMsg = "";
      render();
      return;
    }
    if (target instanceof HTMLSelectElement && target.id === "ed-card-prim") {
      seekStep3.cardPrimitive = target.value as HideSeekCardEffect["primitive"];
      render();
      return;
    }
    if (target instanceof HTMLSelectElement && target.id === "ed-curse-clear") {
      seekStep3.curseClearType = target.value as CurseClearCondition["type"];
      render();
      return;
    }
    if (target instanceof HTMLSelectElement && target.id === "ed-chal-target") {
      claimStep3.challengeTarget = target.value;
      render();
      return;
    }
    if (target instanceof HTMLSelectElement && target.id === "ed-chal-prim") {
      claimStep3.challengePrimitive = target.value as ClaimChallengePrimitive["primitive"];
      render();
      return;
    }
    if (target instanceof HTMLSelectElement && target.id === "ed-ccard-prim") {
      claimStep3.cardPrimitive = target.value as ClaimCardEffect["primitive"];
      render();
      return;
    }
    if (target instanceof HTMLSelectElement && target.id === "dry-seek-anchor") {
      dryRun.seekAnchorId = target.value;
      render();
      return;
    }
    if (target instanceof HTMLSelectElement && target.id === "dry-seek-pos") {
      dryRun.seekSeekerPosId = target.value;
      render();
      return;
    }
    if (target instanceof HTMLSelectElement && target.id === "dry-seek-clue") {
      dryRun.seekClueKey = target.value;
      render();
      return;
    }
    if (target instanceof HTMLSelectElement && target.id === "dry-claim-landmark") {
      dryRun.claimLandmarkId = target.value;
      dryRun.claimShotTier = null;
      dryRun.claimMultiStepIdx = 0;
      dryRun.claimTestResult = "";
      render();
      return;
    }
    if (target instanceof HTMLInputElement && target.id === "st-json-file") {
      const file = target.files?.[0];
      if (!file) return;
      void file.text().then((text) => {
        jsonBuffer = text;
        const area = root.querySelector<HTMLTextAreaElement>("#st-json-text");
        if (area) area.value = text;
        statusMsg = `Berkas ${file.name} dimuat. Klik Impor & Validasi JSON untuk menyimpan.`;
        render();
      });
    }
  });

  root.addEventListener("click", (event) => {
    const btn = (event.target as HTMLElement | null)?.closest<HTMLButtonElement>("button");
    if (!btn) return;
    if (btn.dataset.nav === "back") return onBack();
    if (btn.dataset.nav === "catalog") {
      const url = new URL(location.href);
      url.searchParams.set("play", format === "claim-the-city" ? "rulebook-claim" : "rulebook-seek");
      url.searchParams.delete("format");
      history.pushState({ fromChooser: true }, "", url);
      window.dispatchEvent(new PopStateEvent("popstate"));
      return;
    }
    if (btn.dataset.format === "hide-and-seek" || btn.dataset.format === "claim-the-city") {
      format = btn.dataset.format;
      selectedKey = "";
      versions = [];
      step2.selected = null;
      step2.subTab = "primary";
      step2.mapMode = "select";
      step = 1;
      showCloneForm = false;
      showJsonTools = false;
      dryRunSummary = "";
      statusMsg = "";
      errorMsg = "";
      validationErrors = [];
      render();
      void refresh();
      return;
    }
    if (btn.dataset.tab === "writer" || btn.dataset.tab === "reviewer") {
      tab = btn.dataset.tab;
      render();
      return;
    }
    if (btn.dataset.step) {
      const nextStep = Number(btn.dataset.step) as StudioStep;
      if (nextStep >= 1 && nextStep <= 4) {
        step = nextStep;
        render();
      }
      return;
    }
    if (btn.dataset.jumpPath) {
      const target = resolveValidationJump(btn.dataset.jumpPath, format);
      tab = "writer";
      step = target.step;
      if (target.step2Tab) step2.subTab = target.step2Tab;
      if (target.seekSubTab) seekStep3.subTab = target.seekSubTab;
      if (target.claimSubTab) claimStep3.subTab = target.claimSubTab;
      render();
      if (target.focusSelector) {
        const el = root.querySelector<HTMLElement>(target.focusSelector);
        el?.focus();
      }
      return;
    }
    if (btn.dataset.dryAction) {
      const active = currentDraft();
      if (!active) return;
      const dryAction = btn.dataset.dryAction;
      if (dryAction === "run-seek-clue" && !isClaimStudioPack(active.pack)) {
        dryRun.seekAnchorId = root.querySelector<HTMLSelectElement>("#dry-seek-anchor")?.value ?? dryRun.seekAnchorId;
        dryRun.seekSeekerPosId = root.querySelector<HTMLSelectElement>("#dry-seek-pos")?.value ?? dryRun.seekSeekerPosId;
        dryRun.seekClueKey = root.querySelector<HTMLSelectElement>("#dry-seek-clue")?.value ?? dryRun.seekClueKey;
        dryRun.seekClueOutput = evaluateSeekDryRunClue(active.pack, active, dryRun);
        render();
        return;
      }
      if (dryAction === "open-claim-test" && isClaimStudioPack(active.pack)) {
        dryRun.claimLandmarkId =
          root.querySelector<HTMLSelectElement>("#dry-claim-landmark")?.value ?? dryRun.claimLandmarkId;
        dryRun.claimTestOpen = true;
        dryRun.claimShotTier = null;
        dryRun.claimMultiStepIdx = 0;
        dryRun.claimTestResult = "";
        render();
        return;
      }
      if (dryAction === "dry-shot-tier") {
        dryRun.claimShotTier = btn.dataset.tier === "bold" ? "bold" : "standard";
        render();
        return;
      }
      if (dryAction === "submit-claim-test" && isClaimStudioPack(active.pack)) {
        dryRun.claimTestResult = evaluateClaimDryRunAnswer(active.pack, dryRun, root);
        render();
        return;
      }
    }
    const transitModeBtn = btn.dataset.transitMode as StudioTransitMode | undefined;
    if (transitModeBtn) {
      const nextEnabled = !step2.enabledTransitModes[transitModeBtn];
      step2.enabledTransitModes[transitModeBtn] = nextEnabled;
      render();
      const active = currentDraft();
      if (active && isEditable(active) && step2.transitCatalog) {
        const pack = structuredClone(active.pack);
        const snap = structuredClone(active.snapshot);
        syncModeStationsInDraft(pack, snap, step2, transitModeBtn, nextEnabled);
        void persistDraft(
          pack,
          snap,
          `Moda ${transitModeBtn.toUpperCase()} ${nextEnabled ? "diaktifkan" : "dinonaktifkan"} (${snap.stations.length} stasiun).`,
        );
      } else {
        render();
      }
      return;
    }
    if (btn.dataset.toggleTransitId) {
      void handleToggleTransitStation(btn.dataset.toggleTransitId);
      return;
    }
    if (btn.dataset.mapMode) {
      step2.mapMode = btn.dataset.mapMode as StudioMapMode;
      render();
      return;
    }
    if (btn.dataset.mapTab) {
      step2.subTab = btn.dataset.mapTab as Step2State["subTab"];
      render();
      return;
    }
    if (btn.dataset.selectKind && btn.dataset.selectId) {
      step2.selected = {
        kind: btn.dataset.selectKind as "start" | "station" | "poi" | "landmark",
        id: btn.dataset.selectId,
      };
      render();
      return;
    }
    if (btn.dataset.s3Tab) {
      seekStep3.subTab = btn.dataset.s3Tab as SeekStep3State["subTab"];
      render();
      return;
    }
    if (btn.dataset.s3Family) {
      seekStep3.family = btn.dataset.s3Family as HideSeekQuestionFamily;
      render();
      return;
    }
    if (btn.dataset.c3Tab) {
      claimStep3.subTab = btn.dataset.c3Tab as ClaimStep3State["subTab"];
      render();
      return;
    }
    if (btn.dataset.c3Prim) {
      claimStep3.challengePrimitive = btn.dataset.c3Prim as ClaimChallengePrimitive["primitive"];
      render();
      return;
    }

    const s3Action = btn.dataset.s3Action;
    if (s3Action) {
      void (async () => {
        const active = currentDraft();
        if (!active || !isEditable(active) || isClaimStudioPack(active.pack)) return;
        const pack = structuredClone(active.pack);
        const snap = structuredClone(active.snapshot);
        const fam = seekStep3.family;
        if (s3Action === "save-family-cfg") {
          const enabled = root.querySelector<HTMLSelectElement>("#ed-fam-enabled")?.value === "true";
          const drawCount = Math.max(1, Number(root.querySelector<HTMLInputElement>("#ed-fam-draw")?.value ?? 2));
          const keepCount = Math.max(1, Math.min(drawCount, Number(root.querySelector<HTMLInputElement>("#ed-fam-keep")?.value ?? 1)));
          const existing = pack.investigationBook.families[fam];
          if (existing) {
            existing.enabled = enabled;
            existing.drawCount = drawCount;
            existing.keepCount = keepCount;
          }
          await persistDraft(pack, snap, `Pengaturan keluarga ${fam} disimpan.`);
          return;
        }
        if (s3Action === "delete-book-item") {
          const idx = Number(btn.dataset.index ?? -1);
          const existing = pack.investigationBook.families[fam];
          if (existing && idx >= 0) {
            existing.items.splice(idx, 1);
            await persistDraft(pack, snap, `Item ${fam} dihapus.`);
          }
          return;
        }
        if (s3Action === "add-book-item") {
          const label = root.querySelector<HTMLInputElement>("#ed-item-label")?.value.trim();
          if (!label) {
            errorMsg = "Label item petunjuk wajib diisi.";
            render();
            return;
          }
          const num = Number(root.querySelector<HTMLInputElement>("#ed-item-num")?.value ?? 750);
          const extra = root.querySelector<HTMLInputElement>("#ed-item-extra")?.value.trim() || "taman";
          const id = `${fam}-${Date.now().toString(36)}`;
          if (fam === "radar") {
            pack.investigationBook.families.radar ??= { enabled: true, drawCount: 2, keepCount: 1, availableInPhases: ["seeking", "endgame"], items: [] };
            pack.investigationBook.families.radar.items.push({ id, label, radiusMeters: num });
          } else if (fam === "thermometer") {
            pack.investigationBook.families.thermometer ??= { enabled: true, drawCount: 2, keepCount: 1, availableInPhases: ["seeking"], items: [] };
            pack.investigationBook.families.thermometer.items.push({ id, label, minTravelMeters: num });
          } else if (fam === "matching") {
            pack.investigationBook.families.matching ??= { enabled: true, drawCount: 3, keepCount: 1, availableInPhases: ["seeking"], items: [] };
            pack.investigationBook.families.matching.items.push({ id, label, matchType: "station_attribute", attributeKey: extra });
          } else if (fam === "measuring") {
            pack.investigationBook.families.measuring ??= { enabled: true, drawCount: 3, keepCount: 1, availableInPhases: ["seeking"], items: [] };
            pack.investigationBook.families.measuring.items.push({ id, label, targetType: "poi_category", poiCategory: extra });
          } else if (fam === "tentacles") {
            pack.investigationBook.families.tentacles ??= { enabled: true, drawCount: 4, keepCount: 2, availableInPhases: ["seeking"], items: [] };
            pack.investigationBook.families.tentacles.items.push({ id, label, radiusMeters: num, poiCategory: extra });
          } else {
            pack.investigationBook.families.photo ??= { enabled: true, drawCount: 1, keepCount: 1, availableInPhases: ["seeking", "endgame"], items: [] };
            pack.investigationBook.families.photo.items.push({ id, label, prompt: extra, phase: "both" });
          }
          await persistDraft(pack, snap, `Item ${label} ditambahkan ke ${fam}.`);
          return;
        }
        if (s3Action === "add-seek-card") {
          const card = buildSeekCardFromForm(root, seekStep3);
          if (!card) {
            errorMsg = "Judul kartu wajib diisi.";
            render();
            return;
          }
          pack.deck.cards.push(card);
          await persistDraft(pack, snap, `Kartu ${card.title} ditambahkan ke dek.`);
          return;
        }
        if (s3Action === "dup-seek-card") {
          const idx = Number(btn.dataset.index ?? -1);
          const orig = pack.deck.cards[idx];
          if (orig) {
            const copy = structuredClone(orig);
            copy.id = `${orig.id}-copy-${Date.now().toString(36)}`;
            copy.title = `${orig.title} (Salinan)`;
            pack.deck.cards.push(copy);
            await persistDraft(pack, snap, `Kartu ${orig.title} diduplikasi.`);
          }
          return;
        }
        if (s3Action === "delete-seek-card") {
          const idx = Number(btn.dataset.index ?? -1);
          if (idx >= 0) {
            pack.deck.cards.splice(idx, 1);
            await persistDraft(pack, snap, "Kartu dihapus dari dek.");
          }
        }
      })();
      return;
    }

    const c3Action = btn.dataset.c3Action;
    if (c3Action) {
      void (async () => {
        const active = currentDraft();
        if (!active || !isEditable(active) || !isClaimStudioPack(active.pack)) return;
        const pack = structuredClone(active.pack);
        const snap = structuredClone(active.snapshot);
        if (c3Action === "add-challenge") {
          const chal = buildClaimChallengeFromForm(root, claimStep3);
          if (!chal) {
            errorMsg = "Judul tantangan wajib diisi.";
            render();
            return;
          }
          if (claimStep3.challengeTarget === "backup") {
            pack.challenges.backupPool.push(chal);
          } else {
            pack.challenges.landmarkChallenges[claimStep3.challengeTarget] ??= [];
            pack.challenges.landmarkChallenges[claimStep3.challengeTarget].push(chal);
          }
          await persistDraft(pack, snap, `Tantangan ${chal.title} ditambahkan.`);
          return;
        }
        if (c3Action === "delete-challenge") {
          const idx = Number(btn.dataset.index ?? -1);
          const list =
            claimStep3.challengeTarget === "backup"
              ? pack.challenges.backupPool
              : pack.challenges.landmarkChallenges[claimStep3.challengeTarget];
          if (list && idx >= 0) {
            list.splice(idx, 1);
            await persistDraft(pack, snap, "Tantangan dihapus.");
          }
          return;
        }
        if (c3Action === "save-deck-cfg") {
          pack.tacticalDeck.enabled = root.querySelector<HTMLSelectElement>("#ed-cdeck-enabled")?.value === "true";
          pack.tacticalDeck.maxActiveCursesPerTarget = Math.max(
            1,
            Number(root.querySelector<HTMLInputElement>("#ed-cdeck-maxc")?.value ?? 1),
          );
          await persistDraft(pack, snap, "Pengaturan Dek Taktis disimpan.");
          return;
        }
        if (c3Action === "add-claim-card") {
          const card = buildClaimCardFromForm(root, claimStep3);
          if (!card) {
            errorMsg = "Judul kartu taktis wajib diisi.";
            render();
            return;
          }
          pack.tacticalDeck.cards.push(card);
          await persistDraft(pack, snap, `Kartu taktis ${card.title} ditambahkan.`);
          return;
        }
        if (c3Action === "delete-claim-card") {
          const idx = Number(btn.dataset.index ?? -1);
          if (idx >= 0) {
            pack.tacticalDeck.cards.splice(idx, 1);
            await persistDraft(pack, snap, "Kartu taktis dihapus.");
          }
        }
      })();
      return;
    }

    const mapAction = btn.dataset.mapAction;
    if (mapAction) {
      if (mapAction === "recenter") {
        studioMapHandle?.recenter();
        return;
      }
      void (async () => {
        const active = currentDraft();
        if (!active || !isEditable(active)) return;
        errorMsg = "";
        validationErrors = [];
        const pack = structuredClone(active.pack);
        const snap = structuredClone(active.snapshot);
        const centerCoord = step2.lastClickedCoord ?? {
          latitude: Number((snap.startPoint.latitude - 0.002).toFixed(5)),
          longitude: Number((snap.startPoint.longitude + 0.002).toFixed(5)),
        };

        if (mapAction === "apply-selected" && step2.selected) {
          if (step2.selected.kind === "start") {
            snap.startPoint.name = root.querySelector<HTMLInputElement>("#ed-sp-name")?.value.trim() || snap.startPoint.name;
            snap.startPoint.accessNotes = root.querySelector<HTMLInputElement>("#ed-sp-notes")?.value.trim() || snap.startPoint.accessNotes;
            snap.startPoint.latitude = Number(root.querySelector<HTMLInputElement>("#ed-sp-lat")?.value ?? snap.startPoint.latitude);
            snap.startPoint.longitude = Number(root.querySelector<HTMLInputElement>("#ed-sp-lng")?.value ?? snap.startPoint.longitude);
          } else if (step2.selected.kind === "station") {
            const st = snap.stations.find((s) => s.id === step2.selected!.id);
            if (st) {
              st.name = root.querySelector<HTMLInputElement>('input[data-field="name"]')?.value.trim() || st.name;
              const lines = (root.querySelector<HTMLInputElement>("#ed-st-lines")?.value ?? "")
                .split(",")
                .map((x) => x.trim())
                .filter(Boolean);
              if (lines.length) st.transitLines = lines;
              st.latitude = Number(root.querySelector<HTMLInputElement>("#ed-st-lat")?.value ?? st.latitude);
              st.longitude = Number(root.querySelector<HTMLInputElement>("#ed-st-lng")?.value ?? st.longitude);
              st.attributes = parseAttributes(root.querySelector<HTMLInputElement>("#ed-st-attrs")?.value ?? "");
              st.publicHours = root.querySelector<HTMLInputElement>("#ed-st-hours")?.value.trim() || st.publicHours;
              st.estimatedTravelFromStartMs =
                Number(root.querySelector<HTMLInputElement>("#ed-st-travel")?.value ?? 10) * 60_000;
              st.eligibleHidingAnchor = root.querySelector<HTMLSelectElement>("#ed-st-anchor")?.value === "true";
              st.accessNotes = root.querySelector<HTMLInputElement>("#ed-st-notes")?.value.trim() || st.accessNotes;
            }
          } else if (step2.selected.kind === "poi") {
            const poi = snap.pois.find((p) => p.id === step2.selected!.id);
            if (poi) {
              poi.name = root.querySelector<HTMLInputElement>("#ed-poi-name")?.value.trim() || poi.name;
              poi.category = root.querySelector<HTMLInputElement>("#ed-poi-cat")?.value.trim() || poi.category;
              poi.latitude = Number(root.querySelector<HTMLInputElement>("#ed-poi-lat")?.value ?? poi.latitude);
              poi.longitude = Number(root.querySelector<HTMLInputElement>("#ed-poi-lng")?.value ?? poi.longitude);
            }
          } else if (step2.selected.kind === "landmark" && isClaimStudioPack(pack)) {
            const lm = pack.geography.landmarks.find((l) => l.id === step2.selected!.id);
            if (lm) {
              lm.name = root.querySelector<HTMLInputElement>('input[data-field="name"]')?.value.trim() || lm.name;
              lm.zoneId = root.querySelector<HTMLSelectElement>("#ed-lm-zone")?.value || lm.zoneId;
              lm.latitude = Number(root.querySelector<HTMLInputElement>("#ed-lm-lat")?.value ?? lm.latitude);
              lm.longitude = Number(root.querySelector<HTMLInputElement>("#ed-lm-lng")?.value ?? lm.longitude);
              lm.transitSummary = root.querySelector<HTMLInputElement>("#ed-lm-transit")?.value.trim() || lm.transitSummary;
              lm.publicHours = root.querySelector<HTMLInputElement>("#ed-lm-hours")?.value.trim() || lm.publicHours;
              lm.estimatedTravelFromStartMs =
                Number(root.querySelector<HTMLInputElement>("#ed-lm-travel")?.value ?? 10) * 60_000;
              lm.estimatedChallengeMs =
                Number(root.querySelector<HTMLInputElement>("#ed-lm-chal")?.value ?? 4) * 60_000;
              lm.accessNotes = root.querySelector<HTMLInputElement>("#ed-lm-notes")?.value.trim() || lm.accessNotes;
            }
          }
          await persistDraft(pack, snap);
          return;
        }
        if (mapAction === "delete-selected" && step2.selected) {
          if (step2.selected.kind === "station") {
            snap.stations = snap.stations.filter((s) => s.id !== step2.selected!.id);
          } else if (step2.selected.kind === "poi") {
            snap.pois = snap.pois.filter((p) => p.id !== step2.selected!.id);
          } else if (step2.selected.kind === "landmark" && isClaimStudioPack(pack)) {
            pack.geography.landmarks = pack.geography.landmarks.filter((l) => l.id !== step2.selected!.id);
            delete pack.challenges.landmarkChallenges[step2.selected.id];
          }
          step2.selected = null;
          await persistDraft(pack, snap, "Titik berhasil dihapus dari draf.");
          return;
        }
        if (mapAction === "add-station") {
          const st = createNewStation(centerCoord, snap.stations.length);
          snap.stations.push(st);
          step2.selected = { kind: "station", id: st.id };
          await persistDraft(pack, snap, `Stasiun ${st.name} ditambahkan.`);
          return;
        }
        if (mapAction === "add-poi") {
          const poi = createNewPoi(centerCoord, snap.pois.length);
          snap.pois.push(poi);
          step2.selected = { kind: "poi", id: poi.id };
          await persistDraft(pack, snap, `POI ${poi.name} ditambahkan.`);
          return;
        }
        if (mapAction === "add-landmark" && isClaimStudioPack(pack)) {
          const emptyZone = pack.geography.zones.find(
            (z) => !pack.geography.landmarks.some((l) => l.zoneId === z.id),
          );
          const zoneId = emptyZone?.id ?? pack.geography.zones[0]?.id ?? "zone-1";
          const lm = createNewLandmark(centerCoord, zoneId, pack.geography.landmarks.length);
          pack.geography.landmarks.push(lm);
          pack.challenges.landmarkChallenges[lm.id] = [
            {
              id: `chal-${lm.id}`,
              title: `Tantangan ${lm.name}`,
              verificationNotes: "Terverifikasi dari area publik pejalan kaki.",
              reviewed: true,
              reviewedAt: new Date().toISOString().slice(0, 10),
              payload: {
                primitive: "photo_proof",
                prompt: `Ambil foto publik di ${lm.name}.`,
                verificationMode: "rival_or_timeout",
                autoApproveMs: 120_000,
              },
            },
          ];
          step2.selected = { kind: "landmark", id: lm.id };
          await persistDraft(pack, snap, `Landmark ${lm.name} ditambahkan.`);
          return;
        }
        if (mapAction === "add-zone" && isClaimStudioPack(pack)) {
          const zId = root.querySelector<HTMLInputElement>("#ed-new-zone-id")?.value.trim();
          const zName = root.querySelector<HTMLInputElement>("#ed-new-zone-name")?.value.trim();
          const zLabel = root.querySelector<HTMLInputElement>("#ed-new-zone-label")?.value.trim() ?? "";
          const zIcon = root.querySelector<HTMLInputElement>("#ed-new-zone-icon")?.value.trim() ?? "pin";
          if (!zId || !zName) {
            errorMsg = "ID zona dan nama zona wajib diisi.";
            render();
            return;
          }
          if (pack.geography.zones.some((z) => z.id === zId)) {
            errorMsg = `ID zona '${zId}' sudah ada.`;
            render();
            return;
          }
          pack.geography.zones.push(createNewZone(zId, zName, zLabel, zIcon));
          await persistDraft(pack, snap, `Zona ${zName} ditambahkan.`);
          return;
        }
        if (mapAction === "delete-zone" && isClaimStudioPack(pack)) {
          const zId = btn.dataset.zoneId ?? "";
          if (pack.geography.landmarks.some((l) => l.zoneId === zId)) {
            errorMsg = `Zona '${zId}' masih digunakan oleh landmark. Pindahkan atau hapus landmark terlebih dahulu.`;
            render();
            return;
          }
          pack.geography.zones = pack.geography.zones.filter((z) => z.id !== zId);
          await persistDraft(pack, snap, `Zona ${zId} dihapus.`);
          return;
        }
        if (mapAction === "add-vertex") {
          const lat = Number(root.querySelector<HTMLInputElement>("#ed-v-lat")?.value);
          const lng = Number(root.querySelector<HTMLInputElement>("#ed-v-lng")?.value);
          if (Number.isFinite(lat) && Number.isFinite(lng)) {
            snap.boundaryPolygon.push({ latitude: lat, longitude: lng });
            syncBoundaryTransitStationsInDraft(pack, snap, step2);
            await persistDraft(pack, snap, "Sudut batas ditambahkan.");
          }
          return;
        }
        if (mapAction === "remove-vertex") {
          const idx = Number(btn.dataset.vertexIndex ?? -1);
          if (idx >= 0 && snap.boundaryPolygon.length > 3) {
            snap.boundaryPolygon.splice(idx, 1);
            syncBoundaryTransitStationsInDraft(pack, snap, step2);
            await persistDraft(pack, snap, "Sudut batas dihapus.");
          }
          return;
        }
        if (mapAction === "seed-geo") {
          const seeded = await apiJson<{ ok?: boolean; snapshot?: GeoSnapshot; error?: string }>(
            "/api/rulebooks/seed-geo",
            {
              snapshotId: snap.id,
              boundaryPolygon: snap.boundaryPolygon,
              startPoint: snap.startPoint,
            },
          );
          if (seeded.ok && seeded.snapshot) {
            await persistDraft(pack, seeded.snapshot, "GeoSnapshot berhasil di-seed ulang dari fixture.");
          } else {
            errorMsg = seeded.error ?? "Gagal seed ulang geo.";
            render();
          }
        }
      })();
      return;
    }

    const action = btn.dataset.action;
    if (!action) return;

    void (async () => {
      errorMsg = "";
      validationErrors = [];

      if (action === "toggle-clone") {
        showCloneForm = !showCloneForm;
        render();
        return;
      }
      if (action === "toggle-json") {
        showJsonTools = !showJsonTools;
        const active = currentDraft();
        if (showJsonTools && active && !jsonBuffer) {
          jsonBuffer = serializeStudioBundle(active);
        }
        render();
        return;
      }
      if (action === "export-json") {
        const active = currentDraft();
        if (!active) return;
        jsonBuffer = serializeStudioBundle(active);
        triggerStudioBundleDownload(active);
        statusMsg = `Bundel JSON ${active.packId} v${active.version} diekspor.`;
        render();
        return;
      }
      if (action === "import-json") {
        const raw = root.querySelector<HTMLTextAreaElement>("#st-json-text")?.value ?? jsonBuffer;
        jsonBuffer = raw;
        const parsed = parseStudioBundleJson(raw, format);
        if (!parsed.ok) {
          errorMsg = parsed.error;
          render();
          return;
        }
        // Allocate next available version if matching version is immutable.
        const matching = versions.find(
          (v) => v.packId === parsed.bundle.pack.meta.packId && v.version === parsed.bundle.pack.meta.version,
        );
        if (matching && !isEditable(matching)) {
          parsed.bundle.pack.meta.version = 0;
        }
        const res = await apiJson<{
          ok?: boolean;
          record?: StudioVersionRecord;
          validation?: { ok: boolean; errors: RulebookValidationIssue[] };
          error?: string;
        }>("/api/rulebooks", {
          type: "save-draft",
          pack: parsed.bundle.pack,
          snapshot: parsed.bundle.snapshot,
          rehashSnapshot: true,
        });
        if (res.ok && res.record) {
          selectedKey = `${res.record.packId}@${res.record.version}`;
          validationErrors = res.validation?.errors ?? [];
          statusMsg = res.validation?.ok
            ? `JSON berhasil diimpor sebagai ${res.record.packId} v${res.record.version} dan lolos validator otomatis.`
            : `JSON diimpor sebagai ${res.record.packId} v${res.record.version} dengan kesalahan validasi.`;
          await refresh();
        } else {
          errorMsg = res.error ?? "Gagal mengimpor JSON.";
          render();
        }
        return;
      }
      if (action === "clone") {
        const res = await apiJson<{ ok?: boolean; record?: StudioVersionRecord; error?: string }>("/api/rulebooks", {
          type: "clone-official",
          templatePackId: root.querySelector<HTMLSelectElement>("#st-template")?.value,
          packId: root.querySelector<HTMLInputElement>("#st-pack-id")?.value.trim(),
          title: root.querySelector<HTMLInputElement>("#st-title")?.value.trim(),
          byline: root.querySelector<HTMLInputElement>("#st-byline")?.value.trim(),
          priceIdr: Number(root.querySelector<HTMLInputElement>("#st-price")?.value ?? 0),
        });
        if (res.ok && res.record) {
          selectedKey = `${res.record.packId}@${res.record.version}`;
          showCloneForm = false;
          statusMsg = `Draf ${res.record.packId} v${res.record.version} berhasil dikloning.`;
          await refresh();
        } else {
          errorMsg = res.error ?? "Gagal kloning templat.";
          render();
        }
        return;
      }
      if (action === "clone-next-version") {
        const active = currentDraft();
        if (!active) return;
        const nextPack = structuredClone(active.pack);
        nextPack.meta.version = 0; // Server allocates max_v + 1
        nextPack.meta.isOfficial = false;
        const res = await apiJson<{ ok?: boolean; record?: StudioVersionRecord; error?: string }>("/api/rulebooks", {
          type: "save-draft",
          pack: nextPack,
          snapshot: structuredClone(active.snapshot),
          rehashSnapshot: true,
        });
        if (res.ok && res.record) {
          selectedKey = `${res.record.packId}@${res.record.version}`;
          statusMsg = `Versi baru ${res.record.packId} v${res.record.version} siap disunting.`;
          await refresh();
        } else {
          errorMsg = res.error ?? "Gagal membuat versi baru.";
          render();
        }
        return;
      }
      if (action === "save-draft") {
        const active = currentDraft();
        if (!active) return;
        const { pack: updatedPack, snapshot: updatedSnapshot } = applyFormEdits(active);
        const res = await apiJson<{
          ok?: boolean;
          validation?: { ok: boolean; errors: RulebookValidationIssue[] };
          error?: string;
        }>("/api/rulebooks", {
          type: "save-draft",
          pack: updatedPack,
          snapshot: updatedSnapshot,
          rehashSnapshot: true,
        });
        if (res.ok) {
          validationErrors = res.validation?.errors ?? [];
          statusMsg = res.validation?.ok
            ? "Draf tersimpan dan lolos validator otomatis."
            : "Draf tersimpan dengan kesalahan validasi.";
          await refresh();
        } else {
          errorMsg = res.error ?? "Gagal menyimpan draf.";
          render();
        }
        return;
      }
      if (action === "dry-run") {
        const active = currentDraft();
        if (!active) return;
        if (isClaimStudioPack(active.pack)) {
          const lm = active.pack.geography.landmarks[0];
          dryRunSummary = `Dry-Run OK: ${active.pack.geography.zones.length} zona, ${active.pack.geography.landmarks.length} landmark (uji ${lm?.name ?? "-"}), ${active.pack.challenges.backupPool.length} tantangan cadangan, siap diajukan.`;
        } else {
          const st = active.snapshot.stations[0];
          dryRunSummary = `Dry-Run OK: ${active.snapshot.stations.length} stasiun aktif, jangkar uji ${st?.name ?? "-"} (radius ${active.pack.geography.hidingZoneRadiusMeters}m), ${active.pack.deck.cards.length} jenis kartu, siap diajukan.`;
        }
        render();
        return;
      }
      if (action === "submit-draft") {
        const active = currentDraft();
        if (!active) return;
        const res = await apiJson<{ ok?: boolean; validation?: { errors: RulebookValidationIssue[] }; error?: string }>(
          "/api/rulebooks",
          {
            type: "submit-draft",
            packId: active.packId,
            version: active.version,
          },
        );
        if (res.ok) {
          statusMsg = "Draf diajukan ke peninjau editorial.";
          await refresh();
        } else {
          validationErrors = res.validation?.errors ?? [];
          errorMsg = res.error ?? "Gagal mengajukan draf.";
          render();
        }
        return;
      }
      if (action === "publish" || action === "request-changes" || action === "pause") {
        const packId = btn.dataset.pack ?? "";
        const version = Number(btn.dataset.version ?? 1);
        const type =
          action === "publish" ? "publish-version" : action === "pause" ? "pause-version" : "request-changes";
        const noteInput = root.querySelector<HTMLInputElement>(`#rev-note-${packId}-${version}`)?.value.trim();
        const res = await apiJson<{ ok?: boolean; error?: string }>("/api/rulebooks", {
          type,
          packId,
          version,
          note: noteInput || "Perjelas catatan akses lokasi.",
          reason: "Lokasi sedang perawatan.",
        });
        if (res.ok) {
          statusMsg = `Status diperbarui (${type}).`;
          await refresh();
        } else {
          errorMsg = res.error ?? "Gagal memproses tinjauan.";
          render();
        }
      }
    })();
  });

  void refresh();
  return () => {
    destroyStep2Map();
  };
}
