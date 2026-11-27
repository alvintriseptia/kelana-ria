import { effect } from "@preact/signals";
import type {
  AuthAdminsReply,
  AuthMeReply,
  ClaimCardEffect,
  ClaimChallengePrimitive,
  CurseClearCondition,
  GeoAttribution,
  GeoCoordinate,
  GeoSnapshot,
  HideSeekCardEffect,
  HideSeekQuestionFamily,
  HideSeekRegroupPolicy,
  HideSeekRepeatCostMode,
  MapConfig,
  RulebookFormat,
  RulebookValidationIssue,
  StudioPoiCandidate,
} from "@kelana-ria/contracts";
import {
  fetchAuthMe,
  getCachedAuth,
  onAuthChange,
  openAuthModal,
  renderAccountChip,
} from "./auth-modal";
import { escapeText } from "./escape-text";
import {
  renderAdminInspection,
  renderAdminReview,
  renderAdminReviewDialog,
  type AdminReviewRecord,
  type AdminReviewState,
  type AdminReviewPending,
} from "./studio-admin-review";
import {
  buildClaimCardFromForm,
  buildClaimChallengeFromForm,
  CLAIM_CARD_MAX_COPIES,
  CLAIM_CARD_MIN_COPIES,
  renderClaimLiveCardPreview,
  renderClaimStep3,
  type ClaimStep3State,
} from "./studio-claim-builder";
import {
  parseStudioBundleJson,
  triggerStudioBundleDownload,
} from "./studio-json";
import {
  buildSeekCardFromForm,
  renderSeekLiveCardPreview,
  renderSeekStep3,
  SEEK_CARD_MAX_COPIES,
  SEEK_CARD_MIN_COPIES,
  type SeekStep3State,
} from "./studio-seek-builder";
import { formatHeroCardSvg, stepIconSvg } from "./studio-assets";
import { mountStudioPoiDrawer, studioPoiAlreadyAdded } from "./studio-poi-drawer";
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
  pointInBoundary,
  renderStep2Bottom,
  renderStep2Top,
  renderStep2View,
  syncBoundaryTransitStationsInDraft,
  syncModeStationsInDraft,
  toggleCatalogStationInDraft,
  updateStationAttributes,
  type JakartaTransitCatalog,
  type Step2State,
  type Step2Target,
  type Step2UndoEntry,
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
import "./studio-entry.css";

type StudioView = "home" | "format" | "template" | "import" | "editor" | "review";
type StudioTemplate = { packId: string; title: string; format: RulebookFormat; isOfficial: boolean };
type CloneFields = { templatePackId: string; packId: string; title: string; byline: string; priceIdr: string };

const formatLabels = { "claim-the-city": "Claim the City", "hide-and-seek": "Hide & Seek" };

const SEEK_FAMILY_LABELS: Record<HideSeekQuestionFamily, string> = {
  radar: "Radar",
  thermometer: "Termometer",
  matching: "Cocokkan",
  measuring: "Bandingkan",
  tentacles: "Tempat Terdekat",
  photo: "Foto",
};

const AUTO_SAVE_FIELD_IDS = new Set([
  "ed-meta-title",
  "ed-meta-byline",
  "ed-meta-city",
  "ed-meta-price",
  "ed-meta-summary",
  "ed-claim-minp",
  "ed-claim-maxp",
  "ed-claim-team",
  "ed-claim-duration",
  "ed-claim-solo-locks",
  "ed-claim-solo-zones",
  "ed-claim-fail-policy",
  "ed-claim-cooldown",
  "ed-claim-hand",
  "ed-cdeck-enabled",
  "ed-cdeck-maxc",
  "ed-seek-minp",
  "ed-seek-maxp",
  "ed-zone",
  "ed-head",
  "ed-search",
  "ed-regroup",
  "ed-regroup-policy",
  "ed-repeat-mode",
  "ed-hand",
  "ed-max-curses",
  "ed-fam-enabled",
  "ed-fam-draw",
  "ed-fam-keep",
]);

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
  const lifetime = new AbortController();
  const { signal } = lifetime;
  const params = new URLSearchParams(location.search);
  let format: RulebookFormat = params.get("format") === "hide-and-seek" ? "hide-and-seek" : "claim-the-city";
  const requestedView = params.get("studio");
  let view: StudioView = requestedView === "format" || requestedView === "template" || requestedView === "import" ||
      requestedView === "editor" || requestedView === "review" ? requestedView : "home";
  let step: StudioStep = 1;
  let cloneFields: CloneFields | undefined;
  let packIdManual = false;
  let deleteConfirm: { packId: string; version: number; title: string; dialog: HTMLDialogElement } | null = null;
  let jsonBuffer = "";
  let versions: StudioVersionRecord[] = [];
  let templates: StudioTemplate[] = [];
  let earnings: StudioEarningsRecord[] = [];
  let isAdmin = false;
  let reviewVersions: AdminReviewRecord[] = [];
  const review: AdminReviewState = {
    status: "submitted", format: "all", expanded: new Set(), manageOpen: false, busy: false, adminError: "",
  };
  let pendingReview: (AdminReviewPending & { record?: AdminReviewRecord; email?: string }) | undefined;
  let reviewDialog: HTMLDialogElement | undefined;
  let reviewTrigger: HTMLButtonElement | undefined;
  let selectedKey = view === "editor" ? `${params.get("draft") ?? ""}@${Number(params.get("version"))}` : "";
  let authState: AuthMeReply | null = getCachedAuth();
  let authRequired = false;
  let loading = true;
  let busy = false;
  let formDirty = false;
  let savingForm = false;
  let validationErrors: RulebookValidationIssue[] = [];
  let dryRunSummary = "";
  let statusMsg = "";
  let errorMsg = "";
  let refreshSeq = 0;
  let studioMapHandle: StudioMapEditorHandle | undefined;
  let studioMapKey = "";
  let studioMapReq = 0;
  let poiDrawer: ReturnType<typeof mountStudioPoiDrawer> | undefined;
  let stopPoiPreview: (() => void) | undefined;
  let mapCfgPromise: Promise<MapConfig> | null = null;
  let transitCatalogPromise: Promise<JakartaTransitCatalog | null> | null = null;
  let savingMap = false;
  const mapEdits = new Map<string, Map<string, string>>();
  const openAccordions = new Set<string>();
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
    transitFilter: "all",
    drawer: null,
    pointQuery: "",
    pointPage: 0,
    zoneId: null,
    vertex: null,
    editingChallenges: false,
    saved: true,
    undoStack: [],
    locatingGps: false,
    gpsFeedback: "",
    gpsError: "",
  };
  const seekStep3: SeekStep3State = {
    subTab: "timers",
    family: "radar",
    cardPrimitive: "curse",
    curseClearType: "photo_challenge",
    editingQuestionIndex: null,
    editingQuestionDraft: null,
    editingCardIndex: null,
    editingCardDraft: null,
  };
  const claimStep3: ClaimStep3State = {
    subTab: "session",
    challengeTarget: "backup",
    challengePrimitive: "call_your_shot",
    cardPrimitive: "sabotage_curse",
    editingChallengeIndex: null,
    editingChallengeDraft: null,
    editingCardIndex: null,
    editingCardDraft: null,
  };
  const initialDryRun: DryRunState = {
    seekAnchorId: "",
    seekSeekerPosId: "start",
    seekClueKey: "",
    seekClueOutput: "",
    claimLandmarkId: "",
    claimVariantId: "",
    claimTimedDeadline: null,
    claimTestDone: false,
    claimTestOpen: false,
    claimShotTier: null,
    claimMultiStepIdx: 0,
    claimTestResult: "",
  };
  const dryRun = { ...initialDryRun };
  let dryClock: number | undefined;

  function updateDryClock() {
    const display = root.querySelector<HTMLElement>("[data-dry-claim-clock]");
    if (dryRun.claimTestDone || dryRun.claimTimedDeadline === null) {
      window.clearInterval(dryClock);
      return;
    }
    const seconds = Math.max(0, Math.ceil((dryRun.claimTimedDeadline - Date.now()) / 1000));
    if (display) display.textContent = `${seconds} detik`;
    if (!seconds) window.clearInterval(dryClock);
  }

  function resetClaimPreview(open: boolean) {
    window.clearInterval(dryClock);
    dryRun.claimTestOpen = open;
    dryRun.claimShotTier = null;
    dryRun.claimMultiStepIdx = 0;
    dryRun.claimTimedDeadline = null;
    dryRun.claimTestDone = false;
    dryRun.claimTestResult = "";
  }

  function resetStep3Editors() {
    seekStep3.editingQuestionIndex = null;
    seekStep3.editingQuestionDraft = null;
    seekStep3.editingCardIndex = null;
    seekStep3.editingCardDraft = null;
    claimStep3.editingChallengeIndex = null;
    claimStep3.editingChallengeDraft = null;
    claimStep3.editingCardIndex = null;
    claimStep3.editingCardDraft = null;
  }

  function go(next: StudioView, draft?: StudioVersionRecord, message = "", errors: RulebookValidationIssue[] = []) {
    if (signal.aborted) return;
    refreshSeq++;
    if (next !== "review") closeReviewDialog();
    view = next;
    if (next === "home" || next === "review") loading = true;
    format = draft?.format ?? format;
    if (draft) versions = [draft, ...versions.filter(record => record.packId !== draft.packId || record.version !== draft.version)];
    selectedKey = draft ? `${draft.packId}@${draft.version}` : "";
    step = 1;
    formDirty = false;
    savingForm = false;
    resetStep3Editors();
    openAccordions.clear();
    step2.selected = null;
    if (draft && isClaimStudioPack(draft.pack)) {
      claimStep3.challengeTarget = draft.pack.geography.landmarks[0]?.id ?? "backup";
    }
    step2.mapMode = "select";
    step2.subTab = "primary";
    step2.mapFailed = false;
    mapCfgPromise = null;
    step2.drawer = null;
    step2.pointQuery = "";
    step2.transitQuery = "";
    step2.transitFilter = "all";
    step2.pointPage = 0;
    step2.zoneId = null;
    step2.vertex = null;
    step2.editingChallenges = false;
    step2.saved = true;
    step2.undoStack = [];
    step2.locatingGps = false;
    step2.gpsFeedback = "";
    step2.gpsError = "";
    mapEdits.clear();
    Object.assign(dryRun, initialDryRun);
    dryRunSummary = "";
    cloneFields = undefined;
    packIdManual = false;
    closeDeleteDraftDialog();
    jsonBuffer = "";
    validationErrors = errors;
    errorMsg = "";
    statusMsg = message;
    const query = new URLSearchParams({ play: "rulebook-studio" });
    if (next !== "home") {
      query.set("studio", next);
      query.set("format", format);
    }
    if (draft) {
      query.set("draft", draft.packId);
      query.set("version", String(draft.version));
    }
    history.pushState(null, "", `/?${query}`);
    render();
    root.querySelector<HTMLElement>("#studio-page-heading")?.focus();
    if (loading) void refresh();
  }

  function slugifyPackTitle(title: string): string {
    const base = title
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 36);
    const raw = base ? (base.startsWith("pack-") ? base : `pack-${base}`) : "pack-kreator";
    const used = new Set([...versions.map((v) => v.packId), ...templates.map((t) => t.packId)]);
    if (!used.has(raw)) return raw;
    for (let n = 2; n < 100; n++) {
      const candidate = `${raw}-${n}`;
      if (!used.has(candidate)) return candidate;
    }
    return `${raw}-${Date.now().toString(36).slice(-4)}`;
  }

  function formatPriceLabel(priceIdr: number): string {
    return Number.isFinite(priceIdr) && priceIdr > 0 ? `Rp ${Math.round(priceIdr).toLocaleString("id-ID")}` : "Gratis";
  }

  function editorSaveStatusInfo(): { state: "saving" | "dirty" | "saved"; text: string } {
    if (savingForm || savingMap) return { state: "saving", text: "Menyimpan…" };
    if (formDirty || !step2.saved) return { state: "dirty", text: "Belum disimpan" };
    return { state: "saved", text: "Tersimpan ✓" };
  }

  function updateEditorSavePill() {
    if (signal.aborted) return;
    const pill = root.querySelector<HTMLElement>('[data-testid="studio-save-status"]');
    const info = editorSaveStatusInfo();
    if (pill) {
      pill.textContent = info.text;
      pill.dataset.saveState = info.state;
    }
    for (const saveBtn of root.querySelectorAll<HTMLButtonElement>('button[data-action="save-draft"]')) {
      saveBtn.disabled = savingForm || busy;
    }
  }

  function syncOpenAccordions() {
    for (const details of root.querySelectorAll<HTMLDetailsElement>("details[data-studio-accordion]")) {
      const key = details.dataset.studioAccordion;
      if (!key) continue;
      if (details.open) openAccordions.add(key);
      else openAccordions.delete(key);
    }
  }

  function restoreOpenAccordions(container: ParentNode) {
    for (const details of container.querySelectorAll<HTMLDetailsElement>("details[data-studio-accordion]")) {
      const key = details.dataset.studioAccordion;
      if (key && openAccordions.has(key)) details.open = true;
    }
  }

  async function persistDraft(
    updatedPack: StudioPack,
    updatedSnapshot: GeoSnapshot,
    successMessage?: string,
    savedMapKey?: string,
  ): Promise<boolean> {
    const mapSave = step === 2;
    if (mapSave && savingMap) return false;
    if (mapSave) {
      savingMap = true;
      updateMapSaveLabel();
    } else {
      savingForm = true;
      updateEditorSavePill();
    }
    try {
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
        const saved = res.record;
        if (saved) versions = versions.map(record => record.packId === saved.packId && record.version === saved.version ? saved : record);
        if (savedMapKey) mapEdits.delete(savedMapKey);
        step2.saved = mapEdits.size === 0;
        if (!mapSave) formDirty = false;
        errorMsg = "";
        validationErrors = res.validation?.errors ?? [];
        statusMsg = successMessage ?? (res.validation?.ok
          ? "Draf tersimpan dan lolos validator otomatis."
          : "Draf tersimpan dengan kesalahan validasi.");
        if (mapSave) savingMap = false;
        else savingForm = false;
        await refresh();
        return true;
      }
      errorMsg = res.error ?? "Gagal menyimpan draf.";
    } catch {
      errorMsg = "Perubahan belum tersimpan. Periksa koneksi, lalu coba lagi.";
    } finally {
      if (mapSave) savingMap = false;
      else savingForm = false;
      updateMapSaveLabel();
      updateEditorSavePill();
    }
    render();
    return false;
  }

  async function flushDirtyFormIfNeeded(): Promise<boolean> {
    if (!formDirty || view !== "editor") return true;
    if (savingForm) return false;
    const active = currentDraft();
    if (!active || !isEditable(active)) {
      formDirty = false;
      return true;
    }
    const { pack, snapshot } = applyFormEdits(active);
    return persistDraft(pack, snapshot);
  }

  function mapEditKey() {
    if (step2.subTab === "boundary") return `vertex:${step2.vertex ?? "new"}`;
    if (step2.subTab === "secondary" && format === "claim-the-city") return `zone:${step2.zoneId ?? "new"}`;
    return `${step2.selected?.kind}:${step2.selected?.id}`;
  }

  function updateMapSaveLabel() {
    if (signal.aborted) return;
    const label = root.querySelector<HTMLElement>("[data-map-save-state]");
    if (label) label.textContent = savingMap ? "Menyimpan…" : step2.saved ? "Tersimpan" : "Belum disimpan";
    for (const fields of root.querySelectorAll<HTMLFieldSetElement>(
      "fieldset[data-point-fields], fieldset[data-challenge-fields]",
    )) {
      fields.disabled = savingMap;
    }
    const draft = currentDraft();
    if (draft) poiDrawer?.update(draft, savingMap);
    updateEditorSavePill();
  }

  function restoreMapFields() {
    for (const [id, value] of mapEdits.get(mapEditKey()) ?? []) {
      const field = root.querySelector<HTMLInputElement | HTMLSelectElement>(`[data-point-fields] #${CSS.escape(id)}`);
      if (field) field.value = value;
    }
    updateMapSaveLabel();
  }

  function destroyStep2Map() {
    studioMapReq++;
    studioMapHandle?.destroy();
    studioMapHandle = undefined;
    studioMapKey = "";
  }

  function destroyPoiDrawer() {
    stopPoiPreview?.();
    stopPoiPreview = undefined;
    poiDrawer?.destroy();
    poiDrawer = undefined;
    studioMapHandle?.setPoiCandidates([], null);
  }

  function syncPoiDrawer(active: StudioVersionRecord) {
    const host = root.querySelector<HTMLElement>("#st-poi-drawer");
    if (!host) return;
    host.hidden = step2.drawer !== "osm-pois" || !isEditable(active);
    if (host.hidden) {
      if (poiDrawer) destroyPoiDrawer();
      return;
    }
    if (!poiDrawer) {
      const drawer = mountStudioPoiDrawer(host, active, {
        search: request => apiJson("/api/rulebooks/studio/curate-pois", request),
        add: importStudioPoi,
        close: () => {
          step2.drawer = null;
          render();
          root.querySelector<HTMLButtonElement>('[data-map-drawer="osm-pois"]')?.focus({ preventScroll: true });
        },
      });
      poiDrawer = drawer;
      stopPoiPreview = effect(() => {
        const candidates = drawer.candidates.value;
        const selected = drawer.selected.value;
        studioMapHandle?.setPoiCandidates(candidates, selected);
      });
    }
    poiDrawer.update(active, savingMap);
  }

  async function importStudioPoi(candidate: StudioPoiCandidate, attribution: GeoAttribution, zoneId?: string) {
    const active = currentDraft();
    if (signal.aborted || step !== 2 || savingMap || !active || !isEditable(active) ||
        !pointInBoundary(candidate, active.snapshot.boundaryPolygon) || studioPoiAlreadyAdded(active, candidate)) return false;

    const pack = structuredClone(active.pack);
    const snapshot = structuredClone(active.snapshot);
    const provenance = {
      source: candidate.source,
      osmId: candidate.osmId,
      fieldVerified: false,
      fieldVerificationNote: "",
    };
    let target: Step2Target;
    if (zoneId) {
      if (!isClaimStudioPack(pack) || !pack.geography.zones.some(zone => zone.id === zoneId)) return false;
      const landmark = {
        ...createNewLandmark(candidate, zoneId, pack.geography.landmarks.length),
        ...provenance,
        name: candidate.name,
        transitSummary: "",
        accessNotes: candidate.publicAccessHint ? "Periksa akses di lokasi." : "",
        publicHours: candidate.openingHours ?? "",
      };
      pack.geography.landmarks.push(landmark);
      target = { kind: "landmark", id: landmark.id };
    } else {
      const point = {
        ...createNewPoi(candidate, snapshot.pois.length),
        ...provenance,
        name: candidate.name,
        category: candidate.category,
        attributes: candidate.tags,
      };
      snapshot.pois.push(point);
      target = { kind: "poi", id: point.id };
    }
    if (!snapshot.attributions.some(entry => entry.source === attribution.source)) {
      snapshot.attributions.push(attribution);
    }
    const undoEntry = snapshotStep2Undo(active, "Impor POI");
    const ok = await persistStep2WithUndo(pack, snapshot, undoEntry, `${candidate.name} ditambahkan. Perlu cek lapangan.`);
    const latest = currentDraft();
    if (ok && !signal.aborted && view === "editor" && step === 2 &&
        latest?.packId === active.packId && latest.version === active.version) {
      step2.selected = target;
      step2.subTab = target.kind === "landmark" ? "primary" : isClaimStudioPack(pack) ? "pois" : "secondary";
      step2.editingChallenges = false;
      openAccordions.delete("coord-inspector");
      render();
    }
    return ok;
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

  const MAX_STEP2_UNDO = 10;

  function snapshotStep2Undo(active: StudioVersionRecord, label: string): Step2UndoEntry {
    const entry: Step2UndoEntry = {
      pack: structuredClone(active.pack),
      snapshot: structuredClone(active.snapshot),
      selected: step2.selected ? { ...step2.selected } : null,
      subTab: step2.subTab,
      zoneId: step2.zoneId,
      vertex: step2.vertex,
      label,
    };
    step2.undoStack.push(entry);
    return entry;
  }

  async function persistStep2WithUndo(
    pack: StudioPack,
    snap: GeoSnapshot,
    undoEntry: Step2UndoEntry,
    successMessage?: string,
    savedMapKey?: string,
  ): Promise<boolean> {
    const ok = await persistDraft(pack, snap, successMessage, savedMapKey);
    if (ok && step2.undoStack.length > MAX_STEP2_UNDO) {
      step2.undoStack.shift();
      render();
    } else if (!ok) {
      const idx = step2.undoStack.lastIndexOf(undoEntry);
      if (idx >= 0) {
        step2.undoStack.splice(idx, 1);
        render();
      }
    }
    return ok;
  }

  function moveTargetCoordInDraft(
    pack: StudioPack,
    snap: GeoSnapshot,
    target: Step2Target,
    coord: GeoCoordinate,
  ): boolean {
    if (target.kind === "start") {
      snap.startPoint.latitude = coord.latitude;
      snap.startPoint.longitude = coord.longitude;
      return true;
    }
    if (target.kind === "station") {
      const st = snap.stations.find((s) => s.id === target.id);
      if (!st) return false;
      st.latitude = coord.latitude;
      st.longitude = coord.longitude;
      return true;
    }
    if (target.kind === "poi") {
      const poi = snap.pois.find((p) => p.id === target.id);
      if (!poi) return false;
      poi.latitude = coord.latitude;
      poi.longitude = coord.longitude;
      return true;
    }
    if (target.kind === "landmark" && isClaimStudioPack(pack)) {
      const lm = pack.geography.landmarks.find((l) => l.id === target.id);
      if (!lm) return false;
      lm.latitude = coord.latitude;
      lm.longitude = coord.longitude;
      return true;
    }
    return false;
  }

  function addPointAtCoordInDraft(
    pack: StudioPack,
    snap: GeoSnapshot,
    coord: GeoCoordinate,
    sourceLabel: string,
  ): string {
    if (step2.subTab === "pois" || (step2.subTab === "secondary" && !isClaimStudioPack(pack))) {
      const poi = createNewPoi(coord, snap.pois.length);
      snap.pois.push(poi);
      step2.selected = { kind: "poi", id: poi.id };
      return `POI ${poi.name} ditambahkan ${sourceLabel}.`;
    }
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
      step2.subTab = "primary";
      claimStep3.challengeTarget = lm.id;
      return `Landmark ${lm.name} ditambahkan ${sourceLabel}.`;
    }
    const st = createNewStation(coord, snap.stations.length);
    snap.stations.push(st);
    step2.selected = { kind: "station", id: st.id };
    step2.subTab = "primary";
    return `Stasiun ${st.name} ditambahkan ${sourceLabel}.`;
  }

  function requestStudioGpsFix(): Promise<GeoCoordinate | null> {
    if (typeof navigator === "undefined" || !navigator.geolocation?.getCurrentPosition) {
      step2.locatingGps = false;
      step2.gpsFeedback = "";
      step2.gpsError = "GPS tidak tersedia di peramban ini.";
      render();
      return Promise.resolve(null);
    }
    step2.locatingGps = true;
    step2.gpsError = "";
    step2.gpsFeedback = "Mencari lokasi…";
    render();
    return new Promise((resolve) => {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          if (signal.aborted) {
            resolve(null);
            return;
          }
          resolve({
            latitude: Number(pos.coords.latitude.toFixed(5)),
            longitude: Number(pos.coords.longitude.toFixed(5)),
          });
        },
        (err) => {
          if (signal.aborted) {
            resolve(null);
            return;
          }
          step2.locatingGps = false;
          step2.gpsFeedback = "";
          step2.gpsError =
            err.code === 1
              ? "Izin lokasi ditolak. Aktifkan izin lokasi di peramban untuk memakai GPS."
              : err.code === 3
                ? "Waktu pencarian GPS habis. Pastikan kamu di area terbuka lalu coba lagi."
                : "Lokasi GPS belum bisa ditemukan saat ini. Coba lagi beberapa saat.";
          render();
          resolve(null);
        },
        { enableHighAccuracy: true, timeout: 12_000, maximumAge: 0 },
      );
    });
  }

  async function handleToggleTransitStation(stationId: string) {
    if (savingMap) return;
    const latest = currentDraft();
    if (!latest || !isEditable(latest)) return;
    const undoEntry = snapshotStep2Undo(latest, "Ubah stasiun transit");
    const pack = structuredClone(latest.pack);
    const snap = structuredClone(latest.snapshot);
    const toggled = toggleCatalogStationInDraft(pack, snap, step2, stationId);
    if (!toggled) {
      step2.undoStack.pop();
      return;
    }
    step2.gpsFeedback = "";
    step2.gpsError = "";
    await persistStep2WithUndo(
      pack,
      snap,
      undoEntry,
      `${toggled.name} ${toggled.included ? "diaktifkan ke" : "dikeluarkan dari"} draf.`,
    );
  }

  function handleStep2SelectTarget(target: Step2Target) {
    if (savingMap) return;
    const changed = step2.selected?.kind !== target.kind || step2.selected?.id !== target.id;
    step2.selected = target;
    step2.editingChallenges = false;
    if (changed) openAccordions.delete("coord-inspector");
    if (target.kind === "landmark") claimStep3.challengeTarget = target.id;
    step2.subTab = target.kind === "start" ? "start" : target.kind === "poi" ? (format === "claim-the-city" ? "pois" : "secondary") : "primary";
    step2.drawer = null;
    render();
    root.querySelector<HTMLElement>("[data-studio-point-heading]")?.focus();
  }

  function handleStep2MoveTarget(target: Step2Target, coord: GeoCoordinate) {
    if (savingMap) return;
    const latest = currentDraft();
    if (!latest || !isEditable(latest)) return;
    const undoEntry = snapshotStep2Undo(latest, "Seret pin");
    const pack = structuredClone(latest.pack);
    const snap = structuredClone(latest.snapshot);
    if (!moveTargetCoordInDraft(pack, snap, target, coord)) {
      step2.undoStack.pop();
      return;
    }
    step2.selected = target;
    step2.gpsFeedback = "";
    step2.gpsError = "";
    void persistStep2WithUndo(
      pack,
      snap,
      undoEntry,
      `Titik dipindahkan ke (${coord.latitude}, ${coord.longitude}).`,
    );
  }

  function handleStep2MapClick(coord: GeoCoordinate) {
    if (savingMap) return;
    step2.lastClickedCoord = coord;
    const latest = currentDraft();
    if (!latest || !isEditable(latest) || step2.mapMode === "select") {
      render();
      return;
    }
    const pack = structuredClone(latest.pack);
    const snap = structuredClone(latest.snapshot);
    if (step2.mapMode === "boundary") {
      const undoEntry = snapshotStep2Undo(latest, "Tambah sudut batas");
      snap.boundaryPolygon.push(coord);
      syncBoundaryTransitStationsInDraft(pack, snap, step2);
      step2.gpsFeedback = "";
      step2.gpsError = "";
      void persistStep2WithUndo(pack, snap, undoEntry, `Sudut batas ditambahkan (${coord.latitude}, ${coord.longitude}).`);
      return;
    }
    if (step2.mapMode === "add") {
      const undoEntry = snapshotStep2Undo(latest, "Tambah titik di peta");
      const msg = addPointAtCoordInDraft(pack, snap, coord, "di peta");
      step2.gpsFeedback = "";
      step2.gpsError = "";
      void persistStep2WithUndo(pack, snap, undoEntry, msg);
      return;
    }
    if (step2.mapMode === "move" && step2.selected) {
      const undoEntry = snapshotStep2Undo(latest, "Pindah titik");
      if (!moveTargetCoordInDraft(pack, snap, step2.selected, coord)) {
        step2.undoStack.pop();
        return;
      }
      step2.gpsFeedback = "";
      step2.gpsError = "";
      void persistStep2WithUndo(pack, snap, undoEntry, `Titik dipindahkan ke (${coord.latitude}, ${coord.longitude}).`);
    }
  }

  async function mountStep2Map(host: HTMLElement, active: StudioVersionRecord, draftKey: string) {
    const reqId = ++studioMapReq;
    studioMapKey = draftKey;
    ensureTransitCatalog();
    function mapFailed() {
      if (reqId !== studioMapReq) return;
      step2.mapFailed = true;
      if (step2.drawer !== "osm-pois") step2.drawer = "points";
      destroyStep2Map();
      studioMapKey = draftKey;
      render();
    }
    try {
      if (!mapCfgPromise) mapCfgPromise = apiJson<MapConfig>("/api/map/config");
      const [{ mountStudioMapEditor }, cfg] = await Promise.all([
        import("./studio-map-editor"),
        mapCfgPromise,
      ]);
      if (reqId !== studioMapReq || !host.isConnected) return;
      const latest = currentDraft() ?? active;
      const selected = ensureStep2Selection(latest, step2);
      const handle = mountStudioMapEditor({
        container: host,
        config: cfg,
        record: latest,
        mode: step2.mapMode,
        editable: isEditable(latest),
        selectedTarget: selected,
        transitStations: buildTransitOverlayPins(latest, step2),
        onToggleTransitStation: (stationId) => {
          void handleToggleTransitStation(stationId);
        },
        onSelectTarget: handleStep2SelectTarget,
        onMoveTarget: handleStep2MoveTarget,
        onMapClick: handleStep2MapClick,
        onSelectPoiCandidate: id => poiDrawer?.focusCandidate(id),
        onError: mapFailed,
      });
      if (reqId !== studioMapReq) {
        handle.destroy();
        return;
      }
      studioMapHandle = handle;
      if (poiDrawer) handle.setPoiCandidates(poiDrawer.candidates.value, poiDrawer.selected.value);
    } catch {
      mapFailed();
    }
  }

  function openStudioAuthModal() {
    openAuthModal({
      reason: "Masuk dengan email untuk menyimpan draf, publikasi, dan pendapatan kreator.",
    });
  }

  function handleStudioAuthRequired() {
    closeDeleteDraftDialog();
    refreshSeq++;
    authRequired = true;
    authState = {
      authenticated: false,
      user: null,
      allowSandboxOtp: Boolean(authState?.allowSandboxOtp),
    };
    versions = [];
    earnings = [];
    clearReview();
    isAdmin = false;
    errorMsg = "";
    loading = false;
    render();
  }

  async function apiJson<T>(path: string, body?: unknown): Promise<T> {
    const headers = new Headers();
    if (body !== undefined) headers.set("content-type", "application/json");
    const res = await fetch(path, {
      method: body === undefined ? "GET" : "POST",
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const parsed = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (res.status === 401 && !parsed.error) {
      parsed.error = "auth-required";
    }
    return parsed as T;
  }

  async function refresh() {
    const seq = ++refreshSeq;
    try {
      if (view === "review") {
        const data = await apiJson<{ versions?: AdminReviewRecord[]; error?: string }>("/api/rulebooks?role=reviewer");
        if (seq !== refreshSeq || signal.aborted) return;
        if (data.error === "auth-required") {
          handleStudioAuthRequired();
          return;
        }
        if (data.error) {
          clearReview();
          if (data.error === "admin-only") isAdmin = false;
          else errorMsg = "Antrean tinjauan belum bisa dibuka.";
        } else {
          authRequired = false;
          isAdmin = true;
          reviewVersions = data.versions ?? [];
        }
      } else {
        const data = await apiJson<{ versions?: StudioVersionRecord[]; earnings?: StudioEarningsRecord[]; listings?: StudioTemplate[]; isAdmin?: boolean; error?: string }>(
          "/api/rulebooks?role=writer",
        );
        if (seq !== refreshSeq || signal.aborted) return;
        if (data.error === "auth-required") {
          handleStudioAuthRequired();
          return;
        }
        authRequired = false;
        versions = data.versions ?? [];
        earnings = data.earnings ?? [];
        const official = (data.listings ?? []).filter(item => item.isOfficial);
        templates = official.filter((item, i) => official.findIndex(template => template.packId === item.packId) === i);
        isAdmin = Boolean(data.isAdmin);
      }
    } catch {
      if (seq !== refreshSeq || signal.aborted) return;
      errorMsg = "Studio belum bisa dibuka. Periksa koneksi, lalu coba lagi.";
    }
    loading = false;
    render();
  }

  function currentDraft(): StudioVersionRecord | undefined {
    return versions.find(v => v.format === format && `${v.packId}@${v.version}` === selectedKey);
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

  function renderCloneCard(officialTemplates: StudioTemplate[]): string {
    if (officialTemplates.length === 0) {
      return `<div class="rb-card" data-testid="clone-template-card"><h3>Mulai dari Templat Resmi</h3><p role="status">Memuat templat resmi…</p></div>`;
    }
    const defaultTitle =
      format === "claim-the-city" ? "Senopati Claim" : "Senopati Seek";
    const defaultByline = authState?.user?.displayName?.trim() || "Kreator Kelana";
    const defaultPackId = slugifyPackTitle(defaultTitle);
    const fields = cloneFields ?? {
      templatePackId: "",
      packId: defaultPackId,
      title: defaultTitle,
      byline: defaultByline,
      priceIdr: "30000",
    };
    return `<div class="rb-card" data-testid="clone-template-card">
      <h3>Mulai dari Templat Resmi</h3>
      <div class="rb-grid-2">
        <label class="rb-field"><span>Templat Resmi</span>
          <select id="st-template">
            ${officialTemplates.map(t => `<option value="${escapeText(t.packId)}" ${fields.templatePackId === t.packId ? "selected" : ""}>${escapeText(t.title)}</option>`).join("")}
          </select>
        </label>
        <label class="rb-field"><span>Judul Paket</span><input id="st-title" value="${escapeText(fields.title)}"></label>
        <label class="rb-field"><span>Nama Kreator</span><input id="st-byline" value="${escapeText(fields.byline)}"></label>
        <label class="rb-field"><span>Harga Paket (IDR)</span><input id="st-price" type="number" value="${escapeText(fields.priceIdr)}" min="0" step="1000"><small>Setelah terbit, paket bisa dijual sekali beli di katalog.</small></label>
      </div>
      <details class="rb-accordion studio-slug-accordion" data-testid="pack-id-advanced">
        <summary>ID Paket (Lanjutan) · <code data-testid="slug-preview">${escapeText(fields.packId)}</code></summary>
        <div class="studio-coord-body">
          <label class="rb-field"><span>ID Paket Baru</span><input id="st-pack-id" value="${escapeText(fields.packId)}"><small>Otomatis dibuat dari judul paket. Ubah bila perlu ID khusus.</small></label>
        </div>
      </details>
      <div class="rb-actions">
        <button type="button" class="primary" data-action="clone" ${busy ? "disabled" : ""}>Buat draf</button>
      </div>
    </div>`;
  }

  function renderStep1(active: StudioVersionRecord): string {
    const editable = isEditable(active);
    const disabled = editable ? "" : "disabled";
    const nextVersion = Math.max(...versions.filter(record => record.packId === active.packId).map(record => record.version)) + 1;
    const shapeBadge = active.format === "claim-the-city" ? "◆ Claim the City" : "◎ Hide & Seek";
    return `
      ${active.status === "changes-requested" && active.reviewNote
        ? `<div class="rb-banner-warn" role="alert" data-testid="revision-note-banner"><strong>Catatan Peninjau</strong><p>${escapeText(active.reviewNote)}</p></div>` : ""}
      <div class="rb-card">
        <h3>Info paket</h3>
        ${editable ? "" : `<p>Versi ini terkunci. Buat versi berikutnya untuk melanjutkan penyuntingan.</p>
          <button type="button" class="primary" data-action="clone-next-version" ${busy ? "disabled" : ""}>Buat Versi Berikutnya (v${nextVersion})</button>`}
        <section class="studio-catalog-preview" data-testid="step1-catalog-preview" aria-label="Pratinjau Kartu Katalog">
          <div class="studio-preview-eyebrow">Pratinjau Kartu Katalog</div>
          <article class="studio-preview-card">
            <div class="studio-preview-art">${formatHeroCardSvg(active.format)}</div>
            <div class="studio-preview-body">
              <div class="studio-preview-top">
                <span class="rb-badge">${shapeBadge}</span>
                <span class="rb-badge studio-preview-price" data-preview-field="price">${escapeText(formatPriceLabel(active.pack.meta.priceIdr))}</span>
              </div>
              <strong class="studio-preview-title" data-preview-field="title">${escapeText(active.pack.meta.title)}</strong>
              <p class="studio-preview-meta">
                <span data-preview-field="city">${escapeText(active.pack.meta.cityLabel)}</span> · oleh <span data-preview-field="byline">${escapeText(active.pack.meta.byline)}</span>
              </p>
              <p class="studio-preview-summary" data-preview-field="summary">${escapeText(active.pack.meta.summary || "Ringkasan singkat paket permainanmu.")}</p>
            </div>
          </article>
        </section>
        <div class="rb-grid-2">
          <label class="rb-field"><span>Judul Paket</span><input id="ed-meta-title" value="${escapeText(active.pack.meta.title)}" ${disabled}></label>
          <label class="rb-field"><span>Nama Kreator</span><input id="ed-meta-byline" value="${escapeText(active.pack.meta.byline)}" ${disabled}></label>
          <label class="rb-field"><span>Kota / Wilayah</span><input id="ed-meta-city" value="${escapeText(active.pack.meta.cityLabel)}" ${disabled}></label>
          <label class="rb-field"><span>Harga Paket (IDR)</span><input id="ed-meta-price" type="number" min="0" step="1000" value="${active.pack.meta.priceIdr}" ${disabled}><small>Setelah terbit, paket bisa dijual sekali beli di katalog.</small></label>
        </div>
        <label class="rb-field"><span>Ringkasan Paket</span><input id="ed-meta-summary" value="${escapeText(active.pack.meta.summary)}" ${disabled}></label>
        <div class="rb-sticky-footer">
          ${editable ? `<button type="button" class="secondary" data-action="save-draft" ${savingForm || busy ? "disabled" : ""}>Simpan</button>` : "<span></span>"}
          <button type="button" class="primary" data-step="2">Peta →</button>
        </div>
      </div>`;
  }

  function renderHomeEarningsCard(): string {
    const totalGross = earnings.reduce((sum, item) => sum + item.grossAmountIdr, 0);
    const totalShare = earnings.reduce((sum, item) => sum + item.creatorShareIdr, 0);
    return `<section class="rb-card studio-earnings-card" data-testid="studio-home-earnings" aria-label="Pendapatan Kreator">
      <h3>Pendapatan Kreator (${earnings.length})</h3>
      <div class="studio-earnings-stats">
        <div class="studio-stat-box">
          <small>Total Bruto</small>
          <strong>Rp ${totalGross.toLocaleString("id-ID")}</strong>
        </div>
        <div class="studio-stat-box">
          <small>Bagian Kreator</small>
          <strong>Rp ${totalShare.toLocaleString("id-ID")}</strong>
        </div>
      </div>
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
    </section>`;
  }

  function closeDeleteDraftDialog(restoreFocus = false) {
    const target = deleteConfirm;
    if (!target) return;
    deleteConfirm = null;
    target.dialog.close();
    target.dialog.remove();
    if (restoreFocus) {
      root.querySelector<HTMLButtonElement>(
        `[data-action="confirm-delete-draft"][data-pack="${CSS.escape(target.packId)}"][data-version="${target.version}"]`,
      )?.focus({ preventScroll: true });
    }
  }

  function openDeleteDraftDialog(packId: string, version: number, title: string) {
    const shell = root.querySelector(".studio-shell");
    if (!shell || deleteConfirm) return;
    const dialog = document.createElement("dialog");
    dialog.className = "studio-modal";
    dialog.dataset.testid = "delete-draft-dialog";
    dialog.setAttribute("aria-modal", "true");
    dialog.setAttribute("aria-labelledby", "studio-delete-title");
    dialog.setAttribute("aria-describedby", "studio-delete-description");
    dialog.innerHTML = `
      <h3 id="studio-delete-title">Hapus Draf Permanen?</h3>
      <p id="studio-delete-description">Draf <strong>${escapeText(title)}</strong> (v${version}) dan ruang uji draf aktifnya akan dihapus permanen.</p>
      <div class="rb-actions">
        <button type="button" class="secondary" data-action="cancel-delete-draft" autofocus>Batal</button>
        <button type="button" class="primary studio-danger-btn" data-action="execute-delete-draft">Hapus Permanen</button>
      </div>`;
    dialog.addEventListener("cancel", event => {
      event.preventDefault();
      if (!busy) closeDeleteDraftDialog(true);
    });
    dialog.addEventListener("keydown", event => {
      if (event.key !== "Tab") return;
      const buttons = dialog.querySelectorAll<HTMLButtonElement>("button:not(:disabled)");
      const first = buttons[0];
      const last = buttons[buttons.length - 1];
      const edge = event.shiftKey ? first : last;
      if (!edge || document.activeElement !== edge) return;
      event.preventDefault();
      (event.shiftKey ? last : first).focus();
    });
    deleteConfirm = { packId, version, title, dialog };
    shell.append(dialog);
    dialog.showModal();
  }

  function renderEntry(): string {
    if (view === "format") return `<div class="st-format-grid" role="group" aria-label="Pilih format permainan">
      ${(Object.keys(formatLabels) as RulebookFormat[]).map(item => `<button type="button" class="st-format-card" data-format="${item}">
        ${formatHeroCardSvg(item)}<strong>${escapeText(formatLabels[item])}</strong>
      </button>`).join("")}
    </div>`;
    if (view === "template") return renderCloneCard(templates.filter(item => item.format === format));
    if (view === "import") return `<div class="rb-card" data-testid="json-tools-card">
      <label class="rb-field"><span>Pilih Berkas JSON</span><input id="st-json-file" type="file" accept="application/json,.json"></label>
      <label class="rb-field"><span>JSON Bundel</span><textarea id="st-json-text" class="rb-json-area" placeholder='{"pack": {}, "snapshot": {}}'>${escapeText(jsonBuffer)}</textarea></label>
      <button type="button" class="primary" data-action="import-json" ${busy ? "disabled" : ""}>Impor &amp; Validasi JSON</button>
    </div>`;
    return `<div class="studio-home-stack">
      <div class="rb-card studio-home">
        <button type="button" class="primary" data-studio-view="format">Buat Game</button>
        <h3>Draf Saya</h3>
        ${loading ? '<p role="status">Memuat draf…</p>' : versions.length ? `<ul class="studio-drafts">
          ${versions.map(record => `<li class="studio-draft-item">
            <button type="button" class="secondary studio-draft" data-draft="${escapeText(record.packId)}@${record.version}">
              <strong>${escapeText(record.pack.meta.title)}</strong>
              <small>${escapeText(formatLabels[record.format])} · v${record.version} · ${escapeText(statusLabel(record.status))}</small>
            </button>
            ${isEditable(record)
              ? `<button type="button" class="secondary studio-draft-delete" data-action="confirm-delete-draft" data-pack="${escapeText(record.packId)}" data-version="${record.version}" data-title="${escapeText(record.pack.meta.title)}" aria-label="Hapus draf ${escapeText(record.pack.meta.title)}">Hapus</button>`
              : ""}
          </li>`).join("")}
        </ul>` : `<section class="studio-empty-onboarding" data-testid="studio-empty-onboarding" aria-label="Cara Buat Game">
          <div class="studio-empty-head">
            <span class="studio-preview-eyebrow">Cara Buat Game</span>
            <p class="studio-empty-sub">Empat tahap singkat untuk mengubah rute kotamu menjadi permainan nyata.</p>
          </div>
          <ol class="studio-empty-steps" data-testid="studio-empty-steps">
            <li class="studio-empty-step">${stepIconSvg(1)}<span><strong>1. Pilih Templat</strong><small>Kloning paket resmi</small></span></li>
            <li class="studio-empty-step">${stepIconSvg(2)}<span><strong>2. Tandai Peta</strong><small>Pin landmark &amp; stasiun</small></span></li>
            <li class="studio-empty-step">${stepIconSvg(3)}<span><strong>3. Atur Kartu</strong><small>Timer, tantangan &amp; dek</small></span></li>
            <li class="studio-empty-step">${stepIconSvg(4)}<span><strong>4. Uji &amp; Terbitkan</strong><small>Uji draf lalu ajukan</small></span></li>
          </ol>
          <div class="studio-empty-quickstarts">
            <button type="button" class="studio-quickstart-btn" data-quickstart-format="claim-the-city" data-testid="studio-quickstart-claim">
              <span class="studio-quickstart-art">${formatHeroCardSvg("claim-the-city")}</span>
              <span class="studio-quickstart-copy"><strong>Mulai Claim the City</strong><small>Landmark, tantangan &amp; zona</small></span>
            </button>
            <button type="button" class="studio-quickstart-btn" data-quickstart-format="hide-and-seek" data-testid="studio-quickstart-seek">
              <span class="studio-quickstart-art">${formatHeroCardSvg("hide-and-seek")}</span>
              <span class="studio-quickstart-copy"><strong>Mulai Hide &amp; Seek</strong><small>Stasiun transit, radar &amp; kartu</small></span>
            </button>
          </div>
        </section>`}
        ${hasReviewAccess() ? '<button type="button" class="secondary st-admin-entry" data-studio-view="review"><span aria-hidden="true">◆</span> Panel Admin</button>' : ""}
      </div>
      ${renderHomeEarningsCard()}
    </div>`;
  }

  function hasReviewAccess() {
    return isAdmin && authState?.user?.role === "admin";
  }

  function renderReview(): string {
    if (loading) return '<p role="status">Memuat antrean…</p>';
    if (hasReviewAccess()) {
      const error = review.adminError && !review.manageOpen
        ? `<p role="alert" class="rb-banner-error">${escapeText(review.adminError)}</p>` : "";
      return error + renderAdminReview(reviewVersions, review);
    }
    return `<section class="rb-card st-admin-denied">
      <h3>Akses khusus admin peninjau</h3>
      <div class="rb-actions">
        ${authState?.authenticated ? "" : '<button type="button" class="primary" data-auth-action="open-studio-auth">Masuk dengan Email</button>'}
        <button type="button" class="secondary" data-studio-view="home">‹ Kembali ke Studio</button>
      </div></section>`;
  }

  function closeReviewDialog() {
    const dialog = reviewDialog;
    reviewDialog = pendingReview = undefined;
    if (dialog?.open) dialog.close();
    dialog?.remove();
  }

  function clearReview() {
    closeReviewDialog();
    reviewVersions = [];
    review.admins = undefined;
    review.manageOpen = false;
    review.expanded.clear();
    review.adminError = "";
    review.busy = false;
  }

  function announceAdminError(error?: string) {
    if (error === "auth-required") {
      handleStudioAuthRequired();
      return;
    }
    if (error === "admin-only") {
      isAdmin = false;
      clearReview();
      render();
      return;
    }
    const messages: Record<string, string> = {
      "invalid-email": "Periksa alamat email.",
      "invalid-status": "Status paket sudah berubah. Muat ulang Panel Admin.",
      "validation-failed": "Paket belum lolos validasi. Periksa hasil validasi paket.",
      "user-not-found": "Email ini belum terdaftar.",
      "cannot-remove-last-admin": "Panel harus memiliki setidaknya satu admin.",
      "env-bootstrapped-admin": "Akses admin bawaan server dikelola melalui konfigurasi server.",
    };
    review.adminError = messages[error ?? ""] ?? "Permintaan belum bisa diproses. Coba lagi.";
  }

  async function updateAdminAccounts(action?: "grant" | "revoke", email?: string) {
    if (!hasReviewAccess() || view !== "review" || review.busy) return;
    const account = authState?.user?.userId;
    review.busy = true;
    review.adminError = "";
    const grant = root.querySelector<HTMLFormElement>("[data-admin-grant]");
    const trigger = action === "grant"
      ? (grant?.querySelector<HTMLButtonElement>('button[type="submit"]') ?? undefined)
      : action === "revoke" ? reviewTrigger : undefined;
    if (trigger) trigger.disabled = true;
    try {
      const data = await apiJson<AuthAdminsReply>("/api/auth/admins", action ? { action, email } : undefined);
      if (signal.aborted || account !== authState?.user?.userId) return;
      if (data.ok) {
        review.admins = data.admins;
        if (action) statusMsg = action === "grant" ? "Akses admin diberikan." : "Akses admin dicabut.";
        if (action === "revoke" && email === authState?.user?.email) {
          void fetchAuthMe(signal);
          isAdmin = false;
          clearReview();
        }
      } else announceAdminError(data.error);
    } catch {
      if (account === authState?.user?.userId) announceAdminError();
    } finally {
      if (trigger) trigger.disabled = false;
      if (!signal.aborted && account === authState?.user?.userId) {
        review.busy = false;
        if (view === "review") {
          render();
          const button = root.querySelector<HTMLButtonElement>(
            action === "grant" ? '[data-admin-grant] button[type="submit"]' : '[data-action="admin-manage"]',
          );
          button?.focus();
          if (action === "grant" && review.adminError) {
            const input = root.querySelector<HTMLInputElement>('[data-admin-grant] input[name="email"]');
            if (input) {
              input.value = email ?? "";
              input.focus();
            }
          }
        }
      }
    }
  }

  function confirmReview(pending: NonNullable<typeof pendingReview>, trigger: HTMLButtonElement) {
    if (review.busy || reviewDialog) return;
    const slot = document.createElement("div");
    slot.innerHTML = renderAdminReviewDialog(pending);
    const dialog = slot.querySelector<HTMLDialogElement>("[data-admin-dialog]");
    if (!dialog) return;
    pendingReview = pending;
    reviewDialog = dialog;
    reviewTrigger = trigger;
    root.querySelector(".studio-shell")?.append(dialog);
    dialog.addEventListener("close", () => {
      if (reviewDialog !== dialog) return;
      closeReviewDialog();
      trigger.focus();
    }, { once: true });
    dialog.addEventListener("cancel", event => {
      if (review.busy) event.preventDefault();
    });
    dialog.showModal();
  }

  async function submitModeration(record: AdminReviewRecord, action: "publish" | "request-changes" | "pause" | "resume" | "admin-playtest", note = "") {
    if (!hasReviewAccess() || view !== "review" || review.busy) return;
    const account = authState?.user?.userId;
    const form = reviewDialog?.querySelector<HTMLFormElement>("[data-admin-confirm]");
    const button = form?.querySelector<HTMLButtonElement>('button[type="submit"]');
    const trigger = reviewTrigger;
    review.busy = true;
    review.adminError = "";
    if (button) button.disabled = true;
    const actions = {
      publish: "publish-version", "request-changes": "request-changes", pause: "pause-version", resume: "resume-version",
      "admin-playtest": "start-admin-playtest",
    };
    try {
      const result = await apiJson<{ ok?: boolean; roomCode?: string; format?: RulebookFormat; error?: string }>(
        "/api/rulebooks", { type: actions[action], packId: record.packId, version: record.version, note, reason: note },
      );
      if (signal.aborted || view !== "review" || account !== authState?.user?.userId) return;
      if (!result.ok) {
        announceAdminError(result.error);
        return;
      }
      if (action === "admin-playtest" && result.roomCode) {
        const route = (result.format ?? record.format) === "claim-the-city" ? "rulebook-claim" : "rulebook-seek";
        location.assign(`/?play=${route}&room=${encodeURIComponent(result.roomCode)}&adminPlaytest=1`);
        return;
      }
      closeReviewDialog();
      const messages = {
        publish: "Paket diterbitkan ke katalog.", "request-changes": "Permintaan revisi dikirim ke kreator.",
        pause: "Penjualan paket dijeda.", resume: "Paket kembali tersedia di katalog.", "admin-playtest": "",
      };
      statusMsg = messages[action];
      await refresh();
      const target = root.querySelector<HTMLElement>(`[data-admin-pack="${CSS.escape(record.packId)}"][data-version="${record.version}"] summary`)
        ?? root.querySelector<HTMLButtonElement>('button[data-admin-status][aria-pressed="true"]');
      target?.focus();
    } catch {
      if (account === authState?.user?.userId) announceAdminError();
    } finally {
      if (button) button.disabled = false;
      if (!signal.aborted && view === "review" && account === authState?.user?.userId) {
        review.busy = false;
        if (review.adminError) {
          if (reviewDialog) {
            const feedback = reviewDialog.querySelector<HTMLElement>("[data-admin-dialog-error]");
            if (feedback) {
              feedback.hidden = false;
              feedback.textContent = review.adminError;
            }
          } else {
            render();
            root.querySelector<HTMLButtonElement>(
              `[data-action="${action}"][data-pack="${CSS.escape(record.packId)}"][data-version="${record.version}"]`,
            )?.focus();
          }
        } else if (trigger?.isConnected) trigger.focus();
      }
    }
  }

  function handleReviewButton(button: HTMLButtonElement) {
    if (!hasReviewAccess() || view !== "review") return false;
    const { adminStatus, adminFormat, action, pack, version, email } = button.dataset;
    if (review.busy) return true;
    if (adminStatus === "all" || adminStatus === "submitted" || adminStatus === "published" || adminStatus === "paused") {
      review.status = adminStatus;
      render();
      root.querySelector<HTMLButtonElement>(`[data-admin-status="${adminStatus}"]`)?.focus();
    } else if (adminFormat === "all" || adminFormat === "hide-and-seek" || adminFormat === "claim-the-city") {
      review.format = adminFormat;
      render();
      root.querySelector<HTMLButtonElement>(`[data-admin-format="${adminFormat}"]`)?.focus();
    } else if (action === "admin-manage") {
      review.manageOpen = !review.manageOpen;
      render();
      root.querySelector<HTMLButtonElement>('[data-action="admin-manage"]')?.focus();
      if (review.manageOpen) void updateAdminAccounts();
    } else if (action === "admin-revoke" && email) {
      const admin = review.admins?.find(item => item.email === email);
      if (admin) confirmReview({ action: "revoke", email, name: admin.displayName }, button);
    } else if (action === "admin-cancel") {
      reviewDialog?.close();
    } else if (action === "publish" || action === "request-changes" || action === "pause" || action === "resume" || action === "admin-playtest") {
      const record = reviewVersions.find(item => item.packId === pack && String(item.version) === version);
      if (record && action === "admin-playtest") {
        reviewTrigger = button;
        void submitModeration(record, action);
      } else if (record && action !== "admin-playtest") confirmReview({ action, record, name: record.pack.meta.title }, button);
    } else return false;
    return true;
  }

  function renderStep2(active?: StudioVersionRecord): string {
    if (!active) {
      return `<div class="rb-card"><p>Pilih atau kloning draf di Tahap 1 terlebih dahulu.</p><button type="button" class="primary" data-step="1">← Kembali ke Tahap 1</button></div>`;
    }
    return renderStep2View(active, step2, isEditable(active), claimStep3);
  }

  function renderStep3(active?: StudioVersionRecord): string {
    if (!active) {
      return `<div class="rb-card"><p>Pilih atau kloning draf di Tahap 1 terlebih dahulu.</p><button type="button" class="primary" data-step="1">← Kembali ke Tahap 1</button></div>`;
    }
    const editable = isEditable(active);
    if (isClaimStudioPack(active.pack)) {
      return renderClaimStep3(active.pack, claimStep3, editable, statusMsg, savingForm || busy);
    }
    return renderSeekStep3(active.pack, seekStep3, editable, statusMsg, savingForm || busy);
  }

  function renderStep4(active?: StudioVersionRecord): string {
    if (!active) {
      return `<div class="rb-card"><p>Pilih atau kloning draf di Tahap 1 terlebih dahulu.</p><button type="button" class="primary" data-step="1">← Kembali ke Tahap 1</button></div>`;
    }
    const editable = isEditable(active);
    return `<div class="rb-card" data-studio-slot="dry-run-panel">
      <h3>4. Validasi, Uji Coba &amp; Ajukan · ${escapeText(active.pack.meta.title)} (v${active.version})</h3>
      <div class="rb-badges">
        <span class="rb-badge">Status: ${escapeText(statusLabel(active.status))}</span>
        <span class="rb-badge">ID Peta: ${escapeText(active.snapshot.hash.slice(0, 10))}…</span>
      </div>
      <div class="rb-actions">
        <button type="button" class="primary" data-action="start-draft-playtest" data-testid="studio-playtest-btn" ${savingForm || busy ? "disabled" : ""}>Main Uji Coba (Draf)</button>
        <button type="button" class="secondary" data-action="dry-run">Uji Coba Cepat</button>
        ${editable ? `<button type="button" class="secondary" data-action="save-draft" ${savingForm || busy ? "disabled" : ""}>Jalankan Validator Otomatis</button>` : ""}
        ${editable ? `<button type="button" class="primary" data-action="submit-draft">Ajukan untuk Tinjauan</button>` : ""}
      </div>
      ${dryRunSummary ? `<p role="status" class="rb-badge">${escapeText(dryRunSummary)}</p>` : ""}
      <div class="rb-sticky-footer">
        <button type="button" class="secondary" data-step="3">← Aturan</button>
        ${editable ? `<button type="button" class="secondary" data-action="save-draft" ${savingForm || busy ? "disabled" : ""}>Validasi</button>` : "<span></span>"}
      </div>
    </div>

    ${renderInteractiveDryRunPanel(active, dryRun)}`;
  }

  function render() {
    if (signal.aborted) return;
    syncOpenAccordions();
    const active = currentDraft();
    if (!root.querySelector("#st-header-slot")) {
      root.innerHTML = `<section class="rb-shell studio-shell" aria-label="Studio Kreator">
        <div id="st-header-slot"></div>
        <div id="st-stepper-slot"></div>
        <div id="st-body-slot"></div>
      </section>`;
    }
    const headerSlot = root.querySelector<HTMLElement>("#st-header-slot")!;
    const stepperSlot = root.querySelector<HTMLElement>("#st-stepper-slot")!;
    const bodySlot = root.querySelector<HTMLElement>("#st-body-slot")!;
    const heading = {
      home: "Studio Kreator", format: "Pilih format permainan", template: "Pilih templat", import: "Impor game",
      editor: active?.pack.meta.title ?? "Editor draf", review: hasReviewAccess() ? "Panel Admin" : "Tinjauan Editorial",
    }[view];
    const showingMapIssues = headerSlot.querySelector<HTMLDetailsElement>("[data-map-validation]")?.open;
    const issues = validationErrors.length ? `<ul class="rb-errors" aria-label="Kesalahan validasi">${validationErrors.map(error => {
      const target = resolveValidationJump(error.path, format);
      const zone = error.code === "empty-zone" ? /"([^"]+)"/.exec(error.message)?.[1] ?? "" : "";
      return `<li><div>${escapeText(error.message)}</div>
        <button type="button" class="secondary" data-jump-path="${escapeText(error.path)}" data-jump-zone="${escapeText(zone)}">Lompat &amp; Perbaiki (${escapeText(target.label)}) →</button></li>`;
    }).join("")}</ul>` : "";
    const saveInfo = editorSaveStatusInfo();
    const showMoreMenu = !authRequired && view !== "review";

    headerSlot.innerHTML = `<div class="rb-card studio-heading">
      <div class="rb-actions studio-header-bar">
        ${view === "home" ? '<button type="button" class="secondary" data-nav="back">‹ Katalog</button>'
          : `<button type="button" class="secondary" data-studio-view="${view === "template" ? "format" : view === "import" ? "template" : "home"}">${view === "template" ? "‹ Pilih format" : view === "import" ? "‹ Pilih templat" : "‹ Studio"}</button>`}
        ${view === "review" ? '<button type="button" class="secondary" data-nav="catalog">Katalog Publik</button>' : ""}
        ${renderAccountChip(authState)}
        ${showMoreMenu ? `<details class="studio-more-menu" data-testid="studio-more-menu">
          <summary aria-label="Alat Lanjutan">⋯</summary>
          <div class="studio-more-popover" role="menu">
            ${view === "editor" && active ? '<button type="button" role="menuitem" data-action="export-json">Ekspor JSON</button>' : ""}
            <button type="button" role="menuitem" data-studio-view="import">Impor JSON</button>
          </div>
        </details>` : ""}
      </div>
      <h2 id="studio-page-heading" tabindex="-1">${escapeText(heading)}</h2>
      ${active ? `<div class="studio-context-row"><p class="studio-context">${escapeText(formatLabels[active.format])} · ${escapeText(active.packId)} v${active.version} · ${escapeText(statusLabel(active.status))}</p>${isEditable(active) ? `<span class="studio-save-pill" data-testid="studio-save-status" data-save-state="${saveInfo.state}" role="status">${saveInfo.text}</span>` : ""}</div>`
        : view === "template" || view === "import" ? `<p class="studio-context">${escapeText(formatLabels[format])}</p>` : ""}
      ${statusMsg && !(view === "editor" && step === 3) ? `<p role="status">${escapeText(statusMsg)}</p>` : ""}
      ${errorMsg ? `<p role="alert" class="rb-errors">${escapeText(errorMsg)}</p>` : ""}
      ${issues && step === 2 ? `<details data-map-validation ${showingMapIssues ? "open" : ""}>
        <summary>${validationErrors.length} hal perlu diperiksa</summary>${issues}</details>` : issues}
    </div>`;

    if (authRequired && view !== "review") {
      stepperSlot.innerHTML = "";
      destroyPoiDrawer();
      destroyStep2Map();
      bodySlot.innerHTML = `<div class="rb-card" data-testid="studio-auth-gate">
        <h3>Masuk untuk membuka Studio Kreator</h3>
        <p>Masuk dengan email untuk menyimpan draf, publikasi, dan pendapatan kreator di semua perangkat.</p>
        <div class="rb-actions">
          <button type="button" class="primary" data-auth-action="open-studio-auth">Masuk dengan Email</button>
          <button type="button" class="secondary" data-nav="back">‹ Kembali ke Katalog</button>
        </div>
      </div>`;
      return;
    }

    stepperSlot.innerHTML = active ? renderStepper() : "";
    if (view !== "editor" || !active) {
      destroyPoiDrawer();
      destroyStep2Map();
      bodySlot.innerHTML = view === "review" ? renderReview() : view !== "editor" ? renderEntry()
        : loading ? '<p role="status">Memuat draf…</p>' : '<p role="status">Versi draf ini tidak tersedia. Buka Draf Saya untuk memilih versi lain.</p>';
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
        topSlot.innerHTML = renderStep2Top(step2, editable);
        bottomSlot.innerHTML = renderStep2Bottom(active, step2, editable, claimStep3);
        restoreOpenAccordions(bottomSlot);
        restoreMapFields();
        mapHost.hidden = step2.mapFailed;
        fallbackEl.hidden = !step2.mapFailed;
        syncPoiDrawer(active);
        if (!step2.mapFailed) {
          studioMapHandle?.update({
            record: active,
            mode: step2.mapMode,
            editable,
            selectedTarget: ensureStep2Selection(active, step2),
            transitStations: buildTransitOverlayPins(active, step2),
            onToggleTransitStation: (stationId) => {
              void handleToggleTransitStation(stationId);
            },
            onSelectTarget: handleStep2SelectTarget,
            onMoveTarget: handleStep2MoveTarget,
            onMapClick: handleStep2MapClick,
          });
        }
        return;
      }

      destroyPoiDrawer();
      destroyStep2Map();
      studioMapKey = draftKey;
      bodySlot.innerHTML = renderStep2View(active, step2, editable, claimStep3);
      restoreOpenAccordions(bodySlot);
      restoreMapFields();
      syncPoiDrawer(active);
      if (!step2.mapFailed) {
        const freshHost = bodySlot.querySelector<HTMLElement>("#st-map-host");
        if (freshHost) void mountStep2Map(freshHost, active, draftKey);
      }
      return;
    }

    destroyPoiDrawer();
    destroyStep2Map();
    bodySlot.innerHTML =
      step === 1
        ? renderStep1(active)
        : step === 2
          ? renderStep2(active)
          : step === 3
            ? renderStep3(active)
            : renderStep4(active);
    restoreOpenAccordions(bodySlot);
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
      const cdeckEnabledEl = root.querySelector<HTMLSelectElement>("#ed-cdeck-enabled");
      if (cdeckEnabledEl) updatedPack.tacticalDeck.enabled = cdeckEnabledEl.value === "true";
      const cdeckMaxcEl = root.querySelector<HTMLInputElement>("#ed-cdeck-maxc");
      if (cdeckMaxcEl) updatedPack.tacticalDeck.maxActiveCursesPerTarget = Math.max(1, Number(cdeckMaxcEl.value || 1));
      const lmName = root.querySelector<HTMLInputElement>("#ed-claim-landmark-name")?.value.trim();
      if (lmName && updatedPack.geography.landmarks[0]) {
        updatedPack.geography.landmarks[0].name = lmName;
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
      const famEnabledEl = root.querySelector<HTMLSelectElement>("#ed-fam-enabled");
      const famDrawEl = root.querySelector<HTMLInputElement>("#ed-fam-draw");
      const famKeepEl = root.querySelector<HTMLInputElement>("#ed-fam-keep");
      const existingFam = updatedPack.investigationBook.families[seekStep3.family];
      if (existingFam && (famEnabledEl || famDrawEl || famKeepEl)) {
        if (famEnabledEl) existingFam.enabled = famEnabledEl.value === "true";
        if (famDrawEl) existingFam.drawCount = Math.max(1, Number(famDrawEl.value || 2));
        if (famKeepEl) existingFam.keepCount = Math.max(1, Math.min(existingFam.drawCount, Number(famKeepEl.value || 1)));
      }
      const stationName = root.querySelector<HTMLInputElement>("#ed-station-name")?.value.trim();
      if (stationName && updatedSnapshot.stations[0]) {
        updatedSnapshot.stations[0].name = stationName;
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

  function updateStep1CatalogPreview() {
    const preview = root.querySelector<HTMLElement>('[data-testid="step1-catalog-preview"]');
    if (!preview) return;
    const title = root.querySelector<HTMLInputElement>("#ed-meta-title")?.value.trim();
    const byline = root.querySelector<HTMLInputElement>("#ed-meta-byline")?.value.trim();
    const city = root.querySelector<HTMLInputElement>("#ed-meta-city")?.value.trim();
    const price = Number(root.querySelector<HTMLInputElement>("#ed-meta-price")?.value ?? 0);
    const summary = root.querySelector<HTMLInputElement>("#ed-meta-summary")?.value.trim();
    const setField = (name: string, text: string) => {
      const el = preview.querySelector<HTMLElement>(`[data-preview-field="${name}"]`);
      if (el) el.textContent = text;
    };
    if (title !== undefined) setField("title", title || "Judul Paket");
    if (byline !== undefined) setField("byline", byline || "Kreator");
    if (city !== undefined) setField("city", city || "Wilayah");
    setField("price", formatPriceLabel(price));
    if (summary !== undefined) setField("summary", summary || "Ringkasan singkat paket permainanmu.");
  }

  function captureEditingChallengeCommonFields() {
    if (!claimStep3.editingChallengeDraft) return;
    const title = root.querySelector<HTMLInputElement>("#ed-chal-title")?.value;
    const notes = root.querySelector<HTMLTextAreaElement>("#ed-chal-notes")?.value;
    const hint = root.querySelector<HTMLTextAreaElement>("#ed-chal-hint")?.value;
    const explanation = root.querySelector<HTMLTextAreaElement>("#ed-chal-explanation")?.value;
    const est = root.querySelector<HTMLInputElement>("#ed-chal-estimate")?.valueAsNumber;
    const rev = root.querySelector<HTMLInputElement>("#ed-chal-reviewed")?.checked;
    if (title !== undefined) claimStep3.editingChallengeDraft.title = title;
    if (notes !== undefined) claimStep3.editingChallengeDraft.verificationNotes = notes;
    if (hint !== undefined) claimStep3.editingChallengeDraft.hint = hint;
    if (explanation !== undefined) claimStep3.editingChallengeDraft.learningExplanation = explanation;
    if (est !== undefined && Number.isFinite(est)) claimStep3.editingChallengeDraft.estimatedSeconds = est;
    if (rev !== undefined) claimStep3.editingChallengeDraft.reviewed = rev;
  }

  function captureEditingCardCommonFields() {
    if (format === "claim-the-city" && claimStep3.editingCardDraft) {
      const title = root.querySelector<HTMLInputElement>("#ed-ccard-title")?.value;
      const desc = root.querySelector<HTMLInputElement>("#ed-ccard-desc")?.value;
      const copies = root.querySelector<HTMLInputElement>("#ed-ccard-copies")?.valueAsNumber;
      if (title !== undefined) claimStep3.editingCardDraft.title = title;
      if (desc !== undefined) claimStep3.editingCardDraft.description = desc;
      if (copies !== undefined && Number.isFinite(copies)) claimStep3.editingCardDraft.copies = copies;
    } else if (format === "hide-and-seek" && seekStep3.editingCardDraft) {
      const title = root.querySelector<HTMLInputElement>("#ed-card-title")?.value;
      const desc = root.querySelector<HTMLInputElement>("#ed-card-desc")?.value;
      const copies = root.querySelector<HTMLInputElement>("#ed-card-copies")?.valueAsNumber;
      if (title !== undefined) seekStep3.editingCardDraft.title = title;
      if (desc !== undefined) seekStep3.editingCardDraft.description = desc;
      if (copies !== undefined && Number.isFinite(copies)) seekStep3.editingCardDraft.copies = copies;
    }
  }

  root.addEventListener("input", (event) => {
    const target = event.target as HTMLElement | null;
    if (!target || !target.id) return;
    if (target instanceof HTMLInputElement && target.id === "st-title" && !packIdManual) {
      const nextSlug = slugifyPackTitle(target.value);
      const idInput = root.querySelector<HTMLInputElement>("#st-pack-id");
      if (idInput) idInput.value = nextSlug;
      const preview = root.querySelector<HTMLElement>('[data-testid="slug-preview"]');
      if (preview) preview.textContent = nextSlug;
      return;
    }
    if (target instanceof HTMLInputElement && target.id === "st-pack-id") {
      const trimmed = target.value.trim();
      packIdManual = trimmed.length > 0;
      const preview = root.querySelector<HTMLElement>('[data-testid="slug-preview"]');
      if (preview) preview.textContent = trimmed || slugifyPackTitle(root.querySelector<HTMLInputElement>("#st-title")?.value ?? "");
      return;
    }
    if (target instanceof HTMLInputElement && (target.id === "st-transit-search" || target.id === "st-point-search")) {
      const pos = target.selectionStart ?? target.value.length;
      if (target.id === "st-transit-search") step2.transitQuery = target.value;
      else step2.pointQuery = target.value;
      step2.pointPage = 0;
      render();
      const refreshed = root.querySelector<HTMLInputElement>(`#${target.id}`);
      if (refreshed) {
        refreshed.focus();
        refreshed.setSelectionRange(pos, pos);
      }
      return;
    }
    if ((target instanceof HTMLInputElement || target instanceof HTMLSelectElement) && target.closest("[data-point-fields]")) {
      const key = mapEditKey();
      const fields = mapEdits.get(key) ?? new Map<string, string>();
      fields.set(target.id, target.value);
      mapEdits.set(key, fields);
      step2.saved = false;
      updateMapSaveLabel();
      return;
    }
    if (view === "editor" && AUTO_SAVE_FIELD_IDS.has(target.id)) {
      const active = currentDraft();
      if (active && isEditable(active)) {
        formDirty = true;
        updateEditorSavePill();
      }
    }
    if (target.id.startsWith("ed-meta-")) {
      updateStep1CatalogPreview();
    }
    if (target.id.startsWith("ed-card-") || target.id.startsWith("ed-curse-") || target.id.startsWith("ed-ccard-")) {
      updateLiveCardPreview();
    }
  }, { signal });

  root.addEventListener("change", (event) => {
    const target = event.target as HTMLElement | null;
    if (target && target.id && view === "editor" && AUTO_SAVE_FIELD_IDS.has(target.id)) {
      const active = currentDraft();
      if (active && isEditable(active)) {
        formDirty = true;
        updateEditorSavePill();
      }
    }
    if (target instanceof HTMLSelectElement && target.id === "st-transit-filter") {
      step2.transitFilter = target.value as Step2State["transitFilter"];
      step2.pointPage = 0;
      render();
      root.querySelector<HTMLSelectElement>("#st-transit-filter")?.focus({ preventScroll: true });
      return;
    }
    if (
      target instanceof HTMLSelectElement &&
      (target.id.startsWith("ed-curse-") || target.id.startsWith("ed-ccard-")) &&
      target.id !== "ed-curse-clear" &&
      target.id !== "ed-ccard-prim"
    ) {
      updateLiveCardPreview();
      return;
    }
    if (target instanceof HTMLSelectElement && target.id === "ed-card-prim") {
      captureEditingCardCommonFields();
      seekStep3.cardPrimitive = target.value as HideSeekCardEffect["primitive"];
      render();
      return;
    }
    if (target instanceof HTMLSelectElement && target.id === "ed-curse-clear") {
      captureEditingCardCommonFields();
      seekStep3.curseClearType = target.value as CurseClearCondition["type"];
      render();
      return;
    }
    if (target instanceof HTMLSelectElement && target.id === "ed-chal-target") {
      claimStep3.challengeTarget = target.value;
      claimStep3.editingChallengeIndex = null;
      claimStep3.editingChallengeDraft = null;
      if (target.value !== "backup") {
        step2.selected = { kind: "landmark", id: target.value };
      }
      render();
      return;
    }
    if (target instanceof HTMLSelectElement && target.id === "ed-chal-prim") {
      captureEditingChallengeCommonFields();
      claimStep3.challengePrimitive = target.value as ClaimChallengePrimitive["primitive"];
      render();
      return;
    }
    if (target instanceof HTMLSelectElement && target.id === "ed-ccard-prim") {
      captureEditingCardCommonFields();
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
      dryRun.claimVariantId = "";
      resetClaimPreview(false);
      render();
      return;
    }
    if (target instanceof HTMLSelectElement && target.id === "dry-claim-variant") {
      dryRun.claimVariantId = target.value;
      resetClaimPreview(false);
      render();
      return;
    }
    if (target instanceof HTMLInputElement && target.id === "st-json-file") {
      const file = target.files?.[0];
      if (!file) return;
      void file.text().then((text) => {
        if (signal.aborted || view !== "import") return;
        jsonBuffer = text;
        const area = root.querySelector<HTMLTextAreaElement>("#st-json-text");
        if (area) area.value = text;
        statusMsg = `Berkas ${file.name} dimuat. Klik Impor & Validasi JSON untuk menyimpan.`;
        render();
      });
    }
  }, { signal });

  root.addEventListener("click", (event) => {
    const btn = (event.target as HTMLElement | null)?.closest<HTMLButtonElement>("button");
    if (!btn || busy || savingMap || savingForm) return;
    if (handleReviewButton(btn)) return;
    if (btn.dataset.authAction) {
      if (btn.dataset.authAction === "open-account" && authState?.authenticated) {
        openAuthModal({ mode: "account" });
      } else {
        openStudioAuthModal();
      }
      return;
    }
    if (btn.dataset.nav === "back") return onBack();
    if (btn.dataset.nav === "catalog") {
      history.pushState(null, "", "/catalog");
      window.dispatchEvent(new PopStateEvent("popstate"));
      return;
    }
    const chosenFormat = btn.dataset.format ?? btn.dataset.quickstartFormat;
    if (chosenFormat === "hide-and-seek" || chosenFormat === "claim-the-city") {
      format = chosenFormat;
      go("template");
      return;
    }
    if (btn.dataset.studioView) {
      const nextView = btn.dataset.studioView as StudioView;
      if (view === "editor" && formDirty) {
        void (async () => {
          if (!(await flushDirtyFormIfNeeded())) return;
          go(nextView);
        })();
        return;
      }
      go(nextView);
      return;
    }
    if (btn.dataset.draft) {
      const draft = versions.find(record => `${record.packId}@${record.version}` === btn.dataset.draft);
      if (draft) go("editor", draft);
      return;
    }
    if (btn.dataset.step) {
      const nextStep = Number(btn.dataset.step) as StudioStep;
      if (nextStep >= 1 && nextStep <= 4) {
        void (async () => {
          if (formDirty) {
            const ok = await flushDirtyFormIfNeeded();
            if (!ok) return;
          }
          if (nextStep !== step) statusMsg = "";
          step = nextStep;
          render();
          root.querySelector<HTMLButtonElement>(".rb-step-active")?.focus();
        })();
      }
      return;
    }
    if (btn.dataset.jumpPath) {
      const jumpPath = btn.dataset.jumpPath;
      const jumpZone = btn.dataset.jumpZone;
      void (async () => {
        if (formDirty) {
          const ok = await flushDirtyFormIfNeeded();
          if (!ok) return;
        }
        const target = resolveValidationJump(jumpPath, format);
        step = target.step;
        if (target.step2Tab) {
          step2.editingChallenges = target.focusSelector === "#ed-chal-target";
          const active = currentDraft();
          step2.subTab = target.step2Tab;
          step2.drawer = null;
          const index = Number(/\[(\d+)\]/.exec(jumpPath)?.[1] ?? 0);
          if (active && target.step2Tab === "primary") {
            const pack = active.pack;
            const claim = isClaimStudioPack(pack);
            if (claim && jumpPath.toLowerCase().includes("backup")) {
              const firstLm = pack.geography.landmarks[0];
              if (firstLm && step2.selected?.kind !== "landmark") {
                step2.selected = { kind: "landmark", id: firstLm.id };
              }
              claimStep3.challengeTarget = "backup";
            } else {
              const lmMatch = /landmarkChallenges\.([^.[]+)/.exec(jumpPath);
              const matchedLm = claim && lmMatch ? pack.geography.landmarks.find(l => l.id === lmMatch[1]) : undefined;
              const point = claim ? (matchedLm ?? pack.geography.landmarks[index]) : active.snapshot.stations[index];
              if (point) {
                step2.selected = { kind: claim ? "landmark" : "station", id: point.id };
                if (claim) claimStep3.challengeTarget = point.id;
              }
            }
          }
          if (active && target.step2Tab === "secondary") {
            if (isClaimStudioPack(active.pack)) step2.zoneId = jumpZone || active.pack.geography.zones[index]?.id || null;
            else if (active.snapshot.pois[index]) step2.selected = { kind: "poi", id: active.snapshot.pois[index].id };
          }
          if (active && target.step2Tab === "start") step2.selected = { kind: "start", id: active.snapshot.startPoint.id };
          if (active && target.step2Tab === "boundary") step2.vertex = active.snapshot.boundaryPolygon[index] ? index : null;
        }
        if (target.seekSubTab) seekStep3.subTab = target.seekSubTab;
        if (target.claimSubTab) claimStep3.subTab = target.claimSubTab;
        render();
        if (target.focusSelector || target.step2Tab) {
          const el = root.querySelector<HTMLElement>(target.focusSelector ?? "[data-studio-point-heading]");
          el?.focus();
        }
      })();
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
        dryRun.claimVariantId = root.querySelector<HTMLSelectElement>("#dry-claim-variant")?.value ?? dryRun.claimVariantId;
        resetClaimPreview(true);
        render();
        return;
      }
      if (dryAction === "dry-shot-tier") {
        dryRun.claimShotTier = btn.dataset.tier === "bold" ? "bold" : "standard";
        render();
        return;
      }
      if (dryAction === "start-claim-timer") {
        dryRun.claimTimedDeadline = Date.now() + Number(btn.dataset.dryLimit);
        dryRun.claimTestResult = "";
        render();
        window.clearInterval(dryClock);
        dryClock = window.setInterval(updateDryClock, 250);
        updateDryClock();
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
        const undoEntry = snapshotStep2Undo(active, `Ubah moda ${transitModeBtn.toUpperCase()}`);
        const pack = structuredClone(active.pack);
        const snap = structuredClone(active.snapshot);
        syncModeStationsInDraft(pack, snap, step2, transitModeBtn, nextEnabled);
        void persistStep2WithUndo(
          pack,
          snap,
          undoEntry,
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
      if (step2.mapMode === "add") step2.editingChallenges = false;
      if (step2.mapMode === "add" && (step2.subTab === "start" || step2.subTab === "boundary" ||
          (format === "claim-the-city" && step2.subTab === "secondary"))) step2.subTab = "primary";
      render();
      root.querySelector<HTMLButtonElement>(`[data-map-mode="${step2.mapMode}"]`)?.focus({ preventScroll: true });
      return;
    }
    if (btn.dataset.mapTab) {
      step2.editingChallenges = false;
      step2.subTab = btn.dataset.mapTab as Step2State["subTab"];
      step2.mapMode = "select";
      step2.pointQuery = "";
      step2.pointPage = 0;
      openAccordions.delete("coord-inspector");
      const active = currentDraft();
      if (active && step2.subTab === "start") step2.selected = { kind: "start", id: active.snapshot.startPoint.id };
      if (active && (step2.subTab === "pois" || (step2.subTab === "secondary" && format === "hide-and-seek"))) {
        const first = active.snapshot.pois[0];
        step2.selected = first ? { kind: "poi", id: first.id } : null;
      }
      if (step2.subTab === "primary" && step2.selected?.kind !== (format === "claim-the-city" ? "landmark" : "station")) step2.selected = null;
      render();
      root.querySelector<HTMLButtonElement>(`[data-map-tab="${step2.subTab}"]`)?.focus({ preventScroll: true });
      return;
    }
    if (btn.dataset.mapDrawer) {
      const drawer = btn.dataset.mapDrawer as NonNullable<Step2State["drawer"]>;
      step2.drawer = step2.drawer === drawer ? null : drawer;
      if (step2.drawer === "osm-pois") step2.mapMode = "select";
      step2.pointPage = 0;
      render();
      const focus = !step2.drawer ? `[data-map-drawer="${drawer}"]`
        : drawer === "osm-pois" ? "#st-osm-heading"
          : drawer === "points" ? "#st-point-search" : "#st-transit-search";
      root.querySelector<HTMLElement>(focus)?.focus();
      return;
    }
    if (btn.dataset.pointPage !== undefined) {
      step2.pointPage = Number(btn.dataset.pointPage);
      render();
      root.querySelector<HTMLButtonElement>(".studio-point-item, [data-toggle-transit-id]")?.focus();
      return;
    }
    if (btn.dataset.selectKind && btn.dataset.selectId) {
      if (btn.dataset.selectKind !== "zone" && btn.dataset.selectKind !== "vertex") {
        handleStep2SelectTarget({ kind: btn.dataset.selectKind as Step2Target["kind"], id: btn.dataset.selectId });
        return;
      }
      if (btn.dataset.selectKind === "zone") step2.zoneId = btn.dataset.selectId;
      else step2.vertex = Number(btn.dataset.selectId);
      step2.drawer = null;
      render();
      root.querySelector<HTMLElement>("[data-studio-point-heading]")?.focus();
      return;
    }
    if (btn.dataset.s3Tab) {
      const nextTab = btn.dataset.s3Tab as SeekStep3State["subTab"];
      void (async () => {
        if (formDirty) {
          const ok = await flushDirtyFormIfNeeded();
          if (!ok) return;
        }
        if (seekStep3.subTab !== nextTab) {
          statusMsg = "";
          seekStep3.editingQuestionIndex = null;
          seekStep3.editingQuestionDraft = null;
          seekStep3.editingCardIndex = null;
          seekStep3.editingCardDraft = null;
        }
        seekStep3.subTab = nextTab;
        render();
        root.querySelector<HTMLButtonElement>(`[data-s3-tab="${seekStep3.subTab}"]`)?.focus({ preventScroll: true });
      })();
      return;
    }
    if (btn.dataset.s3Family) {
      const nextFamily = btn.dataset.s3Family as HideSeekQuestionFamily;
      void (async () => {
        if (formDirty) {
          const ok = await flushDirtyFormIfNeeded();
          if (!ok) return;
        }
        seekStep3.family = nextFamily;
        seekStep3.editingQuestionIndex = null;
        seekStep3.editingQuestionDraft = null;
        render();
      })();
      return;
    }
    if (btn.dataset.c3Tab) {
      const nextTab = btn.dataset.c3Tab as ClaimStep3State["subTab"];
      void (async () => {
        if (formDirty) {
          const ok = await flushDirtyFormIfNeeded();
          if (!ok) return;
        }
        if (claimStep3.subTab !== nextTab) {
          statusMsg = "";
          claimStep3.editingCardIndex = null;
          claimStep3.editingCardDraft = null;
        }
        claimStep3.subTab = nextTab;
        render();
        root.querySelector<HTMLButtonElement>(`[data-c3-tab="${claimStep3.subTab}"]`)?.focus({ preventScroll: true });
      })();
      return;
    }
    if (btn.dataset.c3Prim) {
      captureEditingChallengeCommonFields();
      claimStep3.challengePrimitive = btn.dataset.c3Prim as ClaimChallengePrimitive["primitive"];
      render();
      return;
    }

    const s3Action = btn.dataset.s3Action;
    if (s3Action) {
      if (s3Action === "edit-book-item") {
        const active = currentDraft();
        if (!active || !isEditable(active) || isClaimStudioPack(active.pack)) return;
        const idx = Number(btn.dataset.index ?? -1);
        const existing = active.pack.investigationBook.families[seekStep3.family];
        const item = existing?.items[idx];
        if (!item) return;
        seekStep3.editingQuestionIndex = idx;
        seekStep3.editingQuestionDraft = structuredClone(item) as unknown as SeekStep3State["editingQuestionDraft"];
        errorMsg = "";
        render();
        const input = root.querySelector<HTMLInputElement>("#ed-item-label");
        input?.focus();
        input?.scrollIntoView({ block: "nearest" });
        return;
      }
      if (s3Action === "cancel-edit-book-item") {
        seekStep3.editingQuestionIndex = null;
        seekStep3.editingQuestionDraft = null;
        errorMsg = "";
        render();
        return;
      }
      if (s3Action === "edit-seek-card") {
        const active = currentDraft();
        if (!active || !isEditable(active) || isClaimStudioPack(active.pack)) return;
        const idx = Number(btn.dataset.index ?? -1);
        const card = active.pack.deck.cards[idx];
        if (!card) return;
        seekStep3.editingCardIndex = idx;
        seekStep3.editingCardDraft = structuredClone(card);
        seekStep3.cardPrimitive = card.effect.primitive;
        if (card.effect.primitive === "curse") {
          seekStep3.curseClearType = card.effect.curse.clearCondition.type;
        }
        errorMsg = "";
        render();
        const input = root.querySelector<HTMLInputElement>("#ed-card-title");
        input?.focus();
        input?.scrollIntoView({ block: "nearest" });
        return;
      }
      if (s3Action === "cancel-edit-seek-card") {
        seekStep3.editingCardIndex = null;
        seekStep3.editingCardDraft = null;
        errorMsg = "";
        render();
        return;
      }
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
          await persistDraft(pack, snap, `Pengaturan kategori ${SEEK_FAMILY_LABELS[fam] ?? fam} disimpan.`);
          return;
        }
        if (s3Action === "delete-book-item") {
          const idx = Number(btn.dataset.index ?? -1);
          const existing = pack.investigationBook.families[fam];
          if (existing && idx >= 0) {
            existing.items.splice(idx, 1);
            seekStep3.editingQuestionIndex = null;
            seekStep3.editingQuestionDraft = null;
            await persistDraft(pack, snap, `Pertanyaan ${SEEK_FAMILY_LABELS[fam] ?? fam} dihapus.`);
          }
          return;
        }
        if (s3Action === "add-book-item" || s3Action === "save-book-item") {
          const label = root.querySelector<HTMLInputElement>("#ed-item-label")?.value.trim();
          if (!label) {
            errorMsg = "Nama pertanyaan wajib diisi.";
            render();
            return;
          }
          const isEditing = s3Action === "save-book-item" && seekStep3.editingQuestionIndex !== null;
          const editIdx = isEditing ? seekStep3.editingQuestionIndex! : -1;
          const num = Number(root.querySelector<HTMLInputElement>("#ed-item-num")?.value ?? 750);
          const extra = root.querySelector<HTMLInputElement>("#ed-item-extra")?.value.trim() || "taman";
          const existingId = isEditing ? seekStep3.editingQuestionDraft?.id : undefined;
          const id = existingId || `${fam}-${Date.now().toString(36)}`;
          if (fam === "radar") {
            pack.investigationBook.families.radar ??= { enabled: true, drawCount: 2, keepCount: 1, availableInPhases: ["seeking"], items: [] };
            const nextItem = { id, label, radiusMeters: num };
            if (isEditing && pack.investigationBook.families.radar.items[editIdx]) pack.investigationBook.families.radar.items[editIdx] = nextItem;
            else pack.investigationBook.families.radar.items.push(nextItem);
          } else if (fam === "thermometer") {
            pack.investigationBook.families.thermometer ??= { enabled: true, drawCount: 2, keepCount: 1, availableInPhases: ["seeking"], items: [] };
            const nextItem = { id, label, minTravelMeters: num };
            if (isEditing && pack.investigationBook.families.thermometer.items[editIdx]) pack.investigationBook.families.thermometer.items[editIdx] = nextItem;
            else pack.investigationBook.families.thermometer.items.push(nextItem);
          } else if (fam === "matching") {
            pack.investigationBook.families.matching ??= { enabled: true, drawCount: 3, keepCount: 1, availableInPhases: ["seeking"], items: [] };
            const nextItem = { id, label, matchType: "station_attribute" as const, attributeKey: extra };
            if (isEditing && pack.investigationBook.families.matching.items[editIdx]) pack.investigationBook.families.matching.items[editIdx] = nextItem;
            else pack.investigationBook.families.matching.items.push(nextItem);
          } else if (fam === "measuring") {
            pack.investigationBook.families.measuring ??= { enabled: true, drawCount: 3, keepCount: 1, availableInPhases: ["seeking"], items: [] };
            const nextItem = { id, label, targetType: "poi_category" as const, poiCategory: extra };
            if (isEditing && pack.investigationBook.families.measuring.items[editIdx]) pack.investigationBook.families.measuring.items[editIdx] = nextItem;
            else pack.investigationBook.families.measuring.items.push(nextItem);
          } else if (fam === "tentacles") {
            pack.investigationBook.families.tentacles ??= { enabled: true, drawCount: 4, keepCount: 2, availableInPhases: ["seeking"], items: [] };
            const nextItem = { id, label, radiusMeters: num, poiCategory: extra };
            if (isEditing && pack.investigationBook.families.tentacles.items[editIdx]) pack.investigationBook.families.tentacles.items[editIdx] = nextItem;
            else pack.investigationBook.families.tentacles.items.push(nextItem);
          } else {
            pack.investigationBook.families.photo ??= { enabled: true, drawCount: 1, keepCount: 1, availableInPhases: ["seeking"], items: [] };
            const nextItem = { id, label, prompt: extra, phase: "both" as const };
            if (isEditing && pack.investigationBook.families.photo.items[editIdx]) pack.investigationBook.families.photo.items[editIdx] = nextItem;
            else pack.investigationBook.families.photo.items.push(nextItem);
          }
          seekStep3.editingQuestionIndex = null;
          seekStep3.editingQuestionDraft = null;
          await persistDraft(
            pack,
            snap,
            isEditing
              ? `Pertanyaan ${label} diperbarui.`
              : `Pertanyaan ${label} ditambahkan ke ${SEEK_FAMILY_LABELS[fam] ?? fam}.`,
          );
          return;
        }
        if (s3Action === "step-seek-card-copies") {
          const idx = Number(btn.dataset.index ?? -1);
          const delta = Number(btn.dataset.delta ?? 0);
          const card = pack.deck.cards[idx];
          if (!card || !delta) return;
          const nextCopies = Math.max(SEEK_CARD_MIN_COPIES, Math.min(SEEK_CARD_MAX_COPIES, card.copies + delta));
          if (nextCopies === card.copies) return;
          card.copies = nextCopies;
          if (seekStep3.editingCardIndex === idx && seekStep3.editingCardDraft) {
            seekStep3.editingCardDraft.copies = nextCopies;
          }
          await persistDraft(pack, snap, `Jumlah salinan ${card.title} diatur ke ${nextCopies}×.`);
          return;
        }
        if (s3Action === "add-seek-card" || s3Action === "save-seek-card") {
          const isEditing = s3Action === "save-seek-card" && seekStep3.editingCardIndex !== null;
          const editIdx = isEditing ? seekStep3.editingCardIndex! : -1;
          const existingId = isEditing ? seekStep3.editingCardDraft?.id : undefined;
          const card = buildSeekCardFromForm(root, seekStep3, undefined, existingId);
          if (!card) {
            errorMsg = "Judul kartu wajib diisi.";
            render();
            return;
          }
          if (isEditing && pack.deck.cards[editIdx]) {
            pack.deck.cards[editIdx] = card;
          } else {
            pack.deck.cards.push(card);
          }
          seekStep3.editingCardIndex = null;
          seekStep3.editingCardDraft = null;
          await persistDraft(pack, snap, isEditing ? `Kartu ${card.title} diperbarui.` : `Kartu ${card.title} ditambahkan ke dek.`);
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
            seekStep3.editingCardIndex = null;
            seekStep3.editingCardDraft = null;
            await persistDraft(pack, snap, "Kartu dihapus dari dek.");
          }
        }
      })();
      return;
    }

    const c3Action = btn.dataset.c3Action;
    if (c3Action) {
      if (c3Action === "preview-challenge") {
        const active = currentDraft();
        if (!active || !isClaimStudioPack(active.pack)) return;
        const target = claimStep3.challengeTarget;
        const items = target === "backup" ? active.pack.challenges.backupPool : active.pack.challenges.landmarkChallenges[target];
        const item = items?.[Number(btn.dataset.index)];
        if (!item) return;
        step = 4;
        dryRun.claimLandmarkId = target;
        dryRun.claimVariantId = item.id;
        resetClaimPreview(true);
        render();
        const preview = root.querySelector<HTMLElement>("[data-testid='dry-claim-modal']");
        preview?.focus({ preventScroll: true });
        preview?.scrollIntoView({ block: "nearest" });
        return;
      }
      if (c3Action === "edit-challenge") {
        const active = currentDraft();
        if (!active || !isEditable(active) || !isClaimStudioPack(active.pack)) return;
        const idx = Number(btn.dataset.index ?? -1);
        const list =
          claimStep3.challengeTarget === "backup"
            ? active.pack.challenges.backupPool
            : active.pack.challenges.landmarkChallenges[claimStep3.challengeTarget];
        const item = list?.[idx];
        if (!item) return;
        claimStep3.editingChallengeIndex = idx;
        claimStep3.editingChallengeDraft = structuredClone(item);
        claimStep3.challengePrimitive = item.payload.primitive;
        errorMsg = "";
        render();
        const input = root.querySelector<HTMLInputElement>("#ed-chal-title");
        input?.focus();
        input?.scrollIntoView({ block: "nearest" });
        return;
      }
      if (c3Action === "cancel-edit-challenge") {
        claimStep3.editingChallengeIndex = null;
        claimStep3.editingChallengeDraft = null;
        errorMsg = "";
        render();
        return;
      }
      if (c3Action === "edit-claim-card") {
        const active = currentDraft();
        if (!active || !isEditable(active) || !isClaimStudioPack(active.pack)) return;
        const idx = Number(btn.dataset.index ?? -1);
        const card = active.pack.tacticalDeck.cards[idx];
        if (!card) return;
        claimStep3.editingCardIndex = idx;
        claimStep3.editingCardDraft = structuredClone(card);
        claimStep3.cardPrimitive = card.effect.primitive;
        errorMsg = "";
        render();
        const input = root.querySelector<HTMLInputElement>("#ed-ccard-title");
        input?.focus();
        input?.scrollIntoView({ block: "nearest" });
        return;
      }
      if (c3Action === "cancel-edit-claim-card") {
        claimStep3.editingCardIndex = null;
        claimStep3.editingCardDraft = null;
        errorMsg = "";
        render();
        return;
      }
      void (async () => {
        const active = currentDraft();
        if (!active || !isEditable(active) || !isClaimStudioPack(active.pack)) return;
        const pack = structuredClone(active.pack);
        const snap = structuredClone(active.snapshot);
        if (c3Action === "add-challenge" || c3Action === "save-challenge") {
          const isEditing = c3Action === "save-challenge" && claimStep3.editingChallengeIndex !== null;
          const editIdx = isEditing ? claimStep3.editingChallengeIndex! : -1;
          const existingId = isEditing ? claimStep3.editingChallengeDraft?.id : undefined;
          const chal = buildClaimChallengeFromForm(root, claimStep3, existingId);
          if (!chal) {
            const error = root.querySelector<HTMLElement>("[data-claim-composer-error]");
            if (error) {
              error.textContent = "Isi judul, jawaban bila diperlukan, dan catatan sumber atau bukti. Centang peninjauan sebelum menyimpan.";
              error.hidden = false;
            }
            return;
          }
          if (claimStep3.challengeTarget === "backup") {
            if (isEditing && pack.challenges.backupPool[editIdx]) pack.challenges.backupPool[editIdx] = chal;
            else pack.challenges.backupPool.push(chal);
          } else {
            pack.challenges.landmarkChallenges[claimStep3.challengeTarget] ??= [];
            const targetList = pack.challenges.landmarkChallenges[claimStep3.challengeTarget];
            if (isEditing && targetList[editIdx]) targetList[editIdx] = chal;
            else targetList.push(chal);
          }
          claimStep3.editingChallengeIndex = null;
          claimStep3.editingChallengeDraft = null;
          await persistDraft(pack, snap, isEditing ? `Tantangan ${chal.title} diperbarui.` : `Tantangan ${chal.title} ditambahkan.`);
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
            claimStep3.editingChallengeIndex = null;
            claimStep3.editingChallengeDraft = null;
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
          await persistDraft(pack, snap, "Pengaturan Dek Kartu disimpan.");
          return;
        }
        if (c3Action === "step-claim-card-copies") {
          const idx = Number(btn.dataset.index ?? -1);
          const delta = Number(btn.dataset.delta ?? 0);
          const card = pack.tacticalDeck.cards[idx];
          if (!card || !delta) return;
          const nextCopies = Math.max(CLAIM_CARD_MIN_COPIES, Math.min(CLAIM_CARD_MAX_COPIES, card.copies + delta));
          if (nextCopies === card.copies) return;
          card.copies = nextCopies;
          if (claimStep3.editingCardIndex === idx && claimStep3.editingCardDraft) {
            claimStep3.editingCardDraft.copies = nextCopies;
          }
          await persistDraft(pack, snap, `Jumlah salinan ${card.title} diatur ke ${nextCopies}×.`);
          return;
        }
        if (c3Action === "add-claim-card" || c3Action === "save-claim-card") {
          const isEditing = c3Action === "save-claim-card" && claimStep3.editingCardIndex !== null;
          const editIdx = isEditing ? claimStep3.editingCardIndex! : -1;
          const existingCard = isEditing ? (claimStep3.editingCardDraft ?? undefined) : undefined;
          const card = buildClaimCardFromForm(root, claimStep3, undefined, existingCard);
          if (!card) {
            errorMsg = "Judul kartu wajib diisi.";
            render();
            return;
          }
          if (isEditing && pack.tacticalDeck.cards[editIdx]) {
            pack.tacticalDeck.cards[editIdx] = card;
          } else {
            pack.tacticalDeck.cards.push(card);
          }
          claimStep3.editingCardIndex = null;
          claimStep3.editingCardDraft = null;
          await persistDraft(pack, snap, isEditing ? `Kartu ${card.title} diperbarui.` : `Kartu ${card.title} ditambahkan.`);
          return;
        }
        if (c3Action === "delete-claim-card") {
          const idx = Number(btn.dataset.index ?? -1);
          if (idx >= 0) {
            pack.tacticalDeck.cards.splice(idx, 1);
            claimStep3.editingCardIndex = null;
            claimStep3.editingCardDraft = null;
            await persistDraft(pack, snap, "Kartu dihapus.");
          }
        }
      })();
      return;
    }

    const mapAction = btn.dataset.mapAction;
    if (mapAction) {
      if (mapAction === "edit-challenges" && format === "claim-the-city" && step2.selected?.kind === "landmark") {
        claimStep3.challengeTarget = step2.selected.id;
        claimStep3.editingChallengeIndex = null;
        claimStep3.editingChallengeDraft = null;
        step2.editingChallenges = true;
        render();
        root.querySelector<HTMLSelectElement>("#ed-chal-target")?.focus();
        return;
      }
      if (mapAction === "close-challenges") {
        step2.editingChallenges = false;
        claimStep3.editingChallengeIndex = null;
        claimStep3.editingChallengeDraft = null;
        render();
        root.querySelector<HTMLButtonElement>('[data-map-action="edit-challenges"]')?.focus();
        return;
      }
      if (mapAction === "retry-map") {
        step2.mapFailed = false;
        mapCfgPromise = null;
        render();
        const active = currentDraft();
        const host = root.querySelector<HTMLElement>("#st-map-host");
        if (active && host) void mountStep2Map(host, active, `${active.packId}@${active.version}`);
        return;
      }
      if (mapAction === "recenter") {
        studioMapHandle?.recenter();
        return;
      }
      if (mapAction === "new-zone" || mapAction === "new-vertex") {
        if (mapAction === "new-zone") step2.zoneId = null;
        else step2.vertex = null;
        render();
        root.querySelector<HTMLElement>("[data-studio-point-heading]")?.focus();
        return;
      }
      void (async () => {
        const active = currentDraft();
        if (!active || !isEditable(active)) return;
        errorMsg = "";
        validationErrors = [];
        const pack = structuredClone(active.pack);
        const snap = structuredClone(active.snapshot);
        const editKey = mapEditKey();
        const centerCoord = step2.lastClickedCoord ?? {
          latitude: Number((snap.startPoint.latitude - 0.002).toFixed(5)),
          longitude: Number((snap.startPoint.longitude + 0.002).toFixed(5)),
        };

        if (mapAction === "undo-map") {
          const prev = step2.undoStack.pop();
          if (!prev) return;
          const backupSelected = step2.selected ? { ...step2.selected } : null;
          const backupSubTab = step2.subTab;
          const backupZoneId = step2.zoneId;
          const backupVertex = step2.vertex;
          step2.selected = prev.selected ? { ...prev.selected } : null;
          step2.subTab = prev.subTab;
          step2.zoneId = prev.zoneId;
          step2.vertex = prev.vertex;
          step2.editingChallenges = false;
          step2.gpsFeedback = "";
          step2.gpsError = "";
          mapEdits.clear();
          step2.saved = true;
          const ok = await persistDraft(prev.pack, prev.snapshot, "Perubahan terakhir diurungkan.");
          if (!ok) {
            step2.undoStack.push(prev);
            step2.selected = backupSelected;
            step2.subTab = backupSubTab;
            step2.zoneId = backupZoneId;
            step2.vertex = backupVertex;
            render();
          }
          return;
        }
        if (mapAction === "gps-add" || mapAction === "gps-move-selected") {
          if (step2.locatingGps) return;
          const coord = await requestStudioGpsFix();
          if (!coord) return;
          const latest = currentDraft();
          if (!latest || !isEditable(latest) || latest.packId !== active.packId || latest.version !== active.version) {
            step2.locatingGps = false;
            step2.gpsFeedback = "";
            render();
            return;
          }
          const latestPack = structuredClone(latest.pack);
          const latestSnap = structuredClone(latest.snapshot);
          if (mapAction === "gps-move-selected") {
            const target = step2.selected ?? ensureStep2Selection(latest, step2);
            if (!target) {
              step2.locatingGps = false;
              step2.gpsFeedback = "";
              render();
              return;
            }
            const undoEntry = snapshotStep2Undo(latest, "Pindah titik ke GPS");
            if (!moveTargetCoordInDraft(latestPack, latestSnap, target, coord)) {
              step2.undoStack.pop();
              step2.locatingGps = false;
              step2.gpsFeedback = "";
              render();
              return;
            }
            step2.lastClickedCoord = coord;
            step2.locatingGps = false;
            step2.gpsError = "";
            step2.gpsFeedback = "Titik ditempatkan di posisimu";
            studioMapHandle?.panTo(coord);
            await persistStep2WithUndo(latestPack, latestSnap, undoEntry, "Titik ditempatkan di posisimu.", editKey);
            return;
          }
          const undoEntry = snapshotStep2Undo(latest, "Tambah titik di GPS");
          if (step2.subTab === "boundary") {
            latestSnap.boundaryPolygon.push(coord);
            syncBoundaryTransitStationsInDraft(latestPack, latestSnap, step2);
          } else if (step2.subTab === "start") {
            latestSnap.startPoint.latitude = coord.latitude;
            latestSnap.startPoint.longitude = coord.longitude;
            step2.selected = { kind: "start", id: latestSnap.startPoint.id };
          } else {
            addPointAtCoordInDraft(latestPack, latestSnap, coord, "di posisimu");
          }
          step2.lastClickedCoord = coord;
          step2.locatingGps = false;
          step2.gpsError = "";
          step2.gpsFeedback = "Titik ditempatkan di posisimu";
          studioMapHandle?.panTo(coord);
          await persistStep2WithUndo(latestPack, latestSnap, undoEntry, "Titik ditempatkan di posisimu.");
          return;
        }
        if (mapAction === "apply-selected" && step2.selected) {
          const undoEntry = snapshotStep2Undo(active, "Sunting titik");
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
              const kecamatan = root.querySelector<HTMLInputElement>("#ed-st-attr-kecamatan")?.value.trim() ?? "";
              const corridor = root.querySelector<HTMLInputElement>("#ed-st-attr-corridor")?.value.trim() ?? "";
              st.attributes = updateStationAttributes(st.attributes, kecamatan, corridor);
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
          step2.gpsFeedback = "";
          step2.gpsError = "";
          await persistStep2WithUndo(pack, snap, undoEntry, undefined, editKey);
          return;
        }
        if (mapAction === "delete-selected" && step2.selected) {
          const undoEntry = snapshotStep2Undo(active, "Hapus titik");
          if (step2.selected.kind === "station") {
            snap.stations = snap.stations.filter((s) => s.id !== step2.selected!.id);
          } else if (step2.selected.kind === "poi") {
            snap.pois = snap.pois.filter((p) => p.id !== step2.selected!.id);
          } else if (step2.selected.kind === "landmark" && isClaimStudioPack(pack)) {
            pack.geography.landmarks = pack.geography.landmarks.filter((l) => l.id !== step2.selected!.id);
            delete pack.challenges.landmarkChallenges[step2.selected.id];
          }
          step2.selected = null;
          step2.gpsFeedback = "";
          step2.gpsError = "";
          await persistStep2WithUndo(pack, snap, undoEntry, "Titik berhasil dihapus dari draf.", editKey);
          return;
        }
        if (mapAction === "add-station") {
          const undoEntry = snapshotStep2Undo(active, "Tambah stasiun");
          const st = createNewStation(centerCoord, snap.stations.length);
          snap.stations.push(st);
          step2.selected = { kind: "station", id: st.id };
          step2.gpsFeedback = "";
          step2.gpsError = "";
          await persistStep2WithUndo(pack, snap, undoEntry, `Stasiun ${st.name} ditambahkan.`);
          return;
        }
        if (mapAction === "add-poi") {
          const undoEntry = snapshotStep2Undo(active, "Tambah POI");
          const poi = createNewPoi(centerCoord, snap.pois.length);
          snap.pois.push(poi);
          step2.selected = { kind: "poi", id: poi.id };
          step2.gpsFeedback = "";
          step2.gpsError = "";
          await persistStep2WithUndo(pack, snap, undoEntry, `POI ${poi.name} ditambahkan.`);
          return;
        }
        if (mapAction === "add-landmark" && isClaimStudioPack(pack)) {
          const undoEntry = snapshotStep2Undo(active, "Tambah landmark");
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
          claimStep3.challengeTarget = lm.id;
          step2.gpsFeedback = "";
          step2.gpsError = "";
          await persistStep2WithUndo(pack, snap, undoEntry, `Landmark ${lm.name} ditambahkan.`);
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
          const undoEntry = snapshotStep2Undo(active, "Tambah zona");
          pack.geography.zones.push(createNewZone(zId, zName, zLabel, zIcon));
          step2.zoneId = zId;
          await persistStep2WithUndo(pack, snap, undoEntry, `Zona ${zName} ditambahkan.`, editKey);
          return;
        }
        if (mapAction === "save-zone" && isClaimStudioPack(pack)) {
          const zone = pack.geography.zones.find(item => item.id === step2.zoneId);
          const name = root.querySelector<HTMLInputElement>("#ed-zone-name")?.value.trim();
          const label = root.querySelector<HTMLInputElement>("#ed-zone-label")?.value.trim();
          if (!zone || !name || !label) {
            errorMsg = "Isi nama dan label zona untuk menyimpan.";
            render();
            return;
          }
          const undoEntry = snapshotStep2Undo(active, "Sunting zona");
          zone.name = name;
          zone.label = label;
          await persistStep2WithUndo(pack, snap, undoEntry, `Zona ${name} tersimpan.`, editKey);
          return;
        }
        if (mapAction === "delete-zone" && isClaimStudioPack(pack)) {
          const zId = btn.dataset.zoneId ?? "";
          if (pack.geography.landmarks.some((l) => l.zoneId === zId)) {
            errorMsg = `Zona '${zId}' masih digunakan oleh landmark. Pindahkan atau hapus landmark terlebih dahulu.`;
            render();
            return;
          }
          const undoEntry = snapshotStep2Undo(active, "Hapus zona");
          pack.geography.zones = pack.geography.zones.filter((z) => z.id !== zId);
          step2.zoneId = null;
          await persistStep2WithUndo(pack, snap, undoEntry, `Zona ${zId} dihapus.`, editKey);
          return;
        }
        if (mapAction === "add-vertex" || mapAction === "save-vertex") {
          const lat = root.querySelector<HTMLInputElement>("#ed-v-lat")?.valueAsNumber ?? NaN;
          const lng = root.querySelector<HTMLInputElement>("#ed-v-lng")?.valueAsNumber ?? NaN;
          if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
            errorMsg = "Isi lintang dan bujur yang valid untuk sudut batas.";
            render();
            return;
          }
          const undoEntry = snapshotStep2Undo(active, mapAction === "add-vertex" ? "Tambah sudut batas" : "Ubah sudut batas");
          const point = { latitude: lat, longitude: lng };
          if (mapAction === "add-vertex") snap.boundaryPolygon.push(point);
          else if (step2.vertex !== null && snap.boundaryPolygon[step2.vertex]) snap.boundaryPolygon[step2.vertex] = point;
          syncBoundaryTransitStationsInDraft(pack, snap, step2);
          await persistStep2WithUndo(pack, snap, undoEntry, "Sudut batas tersimpan.", editKey);
          return;
        }
        if (mapAction === "remove-vertex") {
          const idx = Number(btn.dataset.vertexIndex ?? -1);
          if (idx >= 0 && snap.boundaryPolygon.length > 3) {
            const undoEntry = snapshotStep2Undo(active, "Hapus sudut batas");
            snap.boundaryPolygon.splice(idx, 1);
            step2.vertex = null;
            for (const key of mapEdits.keys()) if (key.startsWith("vertex:")) mapEdits.delete(key);
            syncBoundaryTransitStationsInDraft(pack, snap, step2);
            await persistStep2WithUndo(pack, snap, undoEntry, "Sudut batas dihapus.");
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
            const undoEntry = snapshotStep2Undo(active, "Muat ulang data peta");
            await persistStep2WithUndo(pack, seeded.snapshot, undoEntry, "Data peta berhasil dimuat ulang.");
          } else {
            errorMsg = seeded.error ?? "Gagal memuat ulang data peta.";
            render();
          }
        }
      })();
      return;
    }

    const action = btn.dataset.action;
    if (!action) return;

    const moreMenu = btn.closest<HTMLDetailsElement>("details.studio-more-menu");
    if (moreMenu) moreMenu.open = false;

    if (action === "confirm-delete-draft") {
      const packId = btn.dataset.pack ?? "";
      const version = Number(btn.dataset.version ?? 0);
      const title = btn.dataset.title ?? packId;
      if (!packId || version < 1) return;
      openDeleteDraftDialog(packId, version, title);
      return;
    }
    if (action === "cancel-delete-draft") {
      closeDeleteDraftDialog(true);
      return;
    }

    const isCreating =
      action === "clone" ||
      action === "import-json" ||
      action === "clone-next-version" ||
      action === "execute-delete-draft" ||
      action === "start-draft-playtest";
    if (isCreating) {
      busy = true;
      btn.disabled = true;
    }

    void (async () => {
      errorMsg = "";
      validationErrors = [];

      if (action === "execute-delete-draft") {
        if (!deleteConfirm) return;
        const target = deleteConfirm;
        const res = await apiJson<{ ok?: boolean; error?: string }>("/api/rulebooks", {
          type: "delete-draft",
          packId: target.packId,
          version: target.version,
        });
        if (res.ok) {
          versions = versions.filter((v) => !(v.packId === target.packId && v.version === target.version));
          statusMsg = `Draf ${target.title} (v${target.version}) berhasil dihapus.`;
          await refresh();
          closeDeleteDraftDialog();
          root.querySelector<HTMLElement>("#studio-page-heading")?.focus({ preventScroll: true });
        } else {
          errorMsg =
            res.error === "invalid-status"
              ? "Hanya draf yang belum diterbitkan yang dapat dihapus."
              : res.error ?? "Gagal menghapus draf.";
          render();
          closeDeleteDraftDialog(true);
        }
        return;
      }
      if (action === "export-json") {
        if (formDirty && !(await flushDirtyFormIfNeeded())) return;
        const active = currentDraft();
        if (!active) return;
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
          const message = res.validation?.ok
            ? `JSON berhasil diimpor sebagai ${res.record.packId} v${res.record.version} dan lolos validator otomatis.`
            : `JSON diimpor sebagai ${res.record.packId} v${res.record.version} dengan kesalahan validasi.`;
          go("editor", res.record, message, res.validation?.errors ?? []);
        } else {
          errorMsg = res.error ?? "Gagal mengimpor JSON.";
          render();
        }
        return;
      }
      if (action === "clone") {
        const title = root.querySelector<HTMLInputElement>("#st-title")?.value.trim() ?? "";
        const rawPackId = root.querySelector<HTMLInputElement>("#st-pack-id")?.value.trim() ?? "";
        cloneFields = {
          templatePackId: root.querySelector<HTMLSelectElement>("#st-template")?.value ?? "",
          packId: rawPackId || slugifyPackTitle(title),
          title,
          byline: root.querySelector<HTMLInputElement>("#st-byline")?.value.trim() ?? "",
          priceIdr: root.querySelector<HTMLInputElement>("#st-price")?.value ?? "",
        };
        const res = await apiJson<{ ok?: boolean; record?: StudioVersionRecord; error?: string }>("/api/rulebooks", {
          type: "clone-official",
          ...cloneFields,
          autoAllocatePackId: !packIdManual,
          priceIdr: Number(cloneFields.priceIdr),
        });
        if (res.ok && res.record) {
          go("editor", res.record, `Draf ${res.record.packId} v${res.record.version} siap disunting.`);
        } else {
          errorMsg = res.error === "pack-unavailable" ? "ID paket ini sudah dipakai. Gunakan ID paket lain."
            : res.error === "invalid-metadata" ? "Isi ID paket, judul, dan nama kreator."
            : "Draf belum bisa dibuat. Periksa templat, lalu coba lagi.";
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
          go("editor", res.record, `Versi baru ${res.record.packId} v${res.record.version} siap disunting.`);
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
        await persistDraft(updatedPack, updatedSnapshot);
        return;
      }
      if (action === "dry-run") {
        if (formDirty && !(await flushDirtyFormIfNeeded())) return;
        const active = currentDraft();
        if (!active) return;
        if (isClaimStudioPack(active.pack)) {
          const lm = active.pack.geography.landmarks[0];
          dryRunSummary = `Uji coba lolos: ${active.pack.geography.zones.length} zona, ${active.pack.geography.landmarks.length} landmark (${lm?.name ?? "-"}), ${active.pack.challenges.backupPool.length} tantangan cadangan, siap diajukan.`;
        } else {
          const st = active.snapshot.stations[0];
          dryRunSummary = `Uji coba lolos: ${active.snapshot.stations.length} stasiun aktif, titik sembunyi uji ${st?.name ?? "-"} (radius ${active.pack.geography.hidingZoneRadiusMeters} m), ${active.pack.deck.cards.length} jenis kartu, siap diajukan.`;
        }
        render();
        return;
      }
      if (action === "start-draft-playtest") {
        if (formDirty && !(await flushDirtyFormIfNeeded())) return;
        const active = currentDraft();
        if (!active) return;
        const res = await apiJson<{
          ok?: boolean;
          roomCode?: string;
          format?: RulebookFormat;
          validation?: { errors: RulebookValidationIssue[] };
          error?: string;
        }>("/api/rulebooks", {
          type: "start-draft-playtest",
          packId: active.packId,
          version: active.version,
          hostName: authState?.user?.displayName?.trim() || active.pack.meta.byline || "Kreator",
        });
        if (res.ok && res.roomCode) {
          const playRoute = (res.format ?? active.format) === "claim-the-city" ? "rulebook-claim" : "rulebook-seek";
          location.assign(`/?play=${playRoute}&room=${encodeURIComponent(res.roomCode)}`);
          return;
        }
        validationErrors = res.validation?.errors ?? [];
        errorMsg =
          res.error === "validation-failed"
            ? "Perbaiki kesalahan validasi di atas sebelum membuka ruang uji draf."
            : res.error ?? "Gagal membuka ruang uji draf.";
        render();
        return;
      }
      if (action === "submit-draft") {
        if (formDirty && !(await flushDirtyFormIfNeeded())) return;
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
    })().catch(() => {
      errorMsg = "Perubahan belum bisa dikirim. Periksa koneksi, lalu coba lagi.";
      render();
      if (action === "execute-delete-draft") closeDeleteDraftDialog(true);
    }).finally(() => {
      if (isCreating) {
        busy = false;
        const actionButton = root.querySelector<HTMLButtonElement>(`[data-action="${action}"]`);
        if (actionButton && !signal.aborted) actionButton.disabled = false;
      }
    });
  }, { signal });

  root.addEventListener("toggle", event => {
    const details = event.target;
    if (!(details instanceof HTMLDetailsElement) || !details.isConnected || !details.dataset.adminInspect) return;
    const key = details.dataset.adminInspect;
    const inspection = details.querySelector(":scope > .admin-review-inspection");
    if (!details.open) {
      review.expanded.delete(key);
      inspection?.remove();
      return;
    }
    review.expanded.add(key);
    if (inspection || !hasReviewAccess()) return;
    const record = reviewVersions.find(item => `${item.packId}@${item.version}` === key);
    if (record) details.insertAdjacentHTML("beforeend", renderAdminInspection(record));
  }, { capture: true, signal });

  root.addEventListener("submit", event => {
    const form = event.target;
    if (!(form instanceof HTMLFormElement) || view !== "review" || !hasReviewAccess()) return;
    if (form.matches("[data-admin-grant]")) {
      event.preventDefault();
      const email = new FormData(form).get("email");
      if (typeof email === "string" && email.trim()) void updateAdminAccounts("grant", email.trim());
      return;
    }
    if (!form.matches("[data-admin-confirm]") || !pendingReview) return;
    event.preventDefault();
    const { action, record, email } = pendingReview;
    const input = form.querySelector<HTMLTextAreaElement>("[name=note]");
    const note = input?.value.trim() ?? "";
    if (input?.required && !note) {
      input.setCustomValidity("Isi catatan sebelum melanjutkan.");
      input.reportValidity();
      input.addEventListener("input", () => input.setCustomValidity(""), { once: true, signal });
      return;
    }
    if (action === "revoke" && email) {
      closeReviewDialog();
      void updateAdminAccounts(action, email);
    } else if (record && action !== "revoke") {
      void submitModeration(record, action, note);
    }
  }, { signal });

  onAuthChange((next) => {
    if (next.user?.userId !== authState?.user?.userId) closeDeleteDraftDialog();
    if (next.user?.userId !== authState?.user?.userId || next.user?.role !== "admin") {
      isAdmin = false;
      clearReview();
    }
    authState = next;
    if (next.authenticated) {
      authRequired = false;
      loading = true;
      errorMsg = "";
      render();
      void refresh();
    } else {
      handleStudioAuthRequired();
    }
  }, signal);

  if (!authState) {
    void fetchAuthMe(signal).then((fresh) => {
      if (signal.aborted) return;
      authState = fresh;
      render();
    });
  }

  render();
  void refresh();
  return () => {
    lifetime.abort();
    closeDeleteDraftDialog();
    closeReviewDialog();
    window.clearInterval(dryClock);
    destroyPoiDrawer();
    destroyStep2Map();
  };
}
