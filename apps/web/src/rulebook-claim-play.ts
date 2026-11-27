import type { ClaimSeatPosition, RoomActivityEvent, RoomActivityFeed } from "@kelana-ria/contracts";
import { playGameMotion } from "./game-motion";
import { createRoomActivityUi, formatRelativeAge, freshnessBucket, renderRoomActivity } from "./room-activity";
import type {
  ClaimActiveAttemptView,
  ClaimCardInstance,
  ClaimEngineRoomView,
  ClaimLandmarkState,
  ClaimPublicBoard,
  ClaimSanitizedLeafChallenge,
  GeoCoordinate,
  LocationFix,
  RulebookEntitlementSummary,
  RulebookPlayMode,
} from "@kelana-ria/contracts";
import type { BoardMapHandle, BoardMapUpdateOptions } from "./board-map";
import { getLocation } from "./device-location";
import {
  createLiveLocationWatcher,
  formatDistanceShort,
  haversineMeters,
  renderDirectionsLink,
  renderDistanceMeter,
  renderStartPointCard,
  type LiveLocationStatus,
} from "./live-location";
import { fetchMapConfig } from "./map-config";
import { fetchApiJson, resolvePlayerError, type PlayerErrorSurface, type PlayerErrorTone } from "./player-errors";
import { createPlayerToast, renderInlineAlert } from "./player-toast";
import { claimDecidingMetric, claimResultReasons } from "./rulebook-claim-result";
import { isSimulatedLocationAllowed } from "./runtime-config";
import { clearActiveRoom, saveActiveRoom } from "./active-room-storage";
import { fetchAuthMe, getCachedAuth, onAuthChange, openAuthModal } from "./auth-modal";
import { resolveDefaultPlayerName, saveRememberedGuestName } from "./guest-name";
import {
  canUseWebShare,
  closeLobbyDialog,
  copyToClipboard,
  openConfirmDialog,
  openQrModal,
  openQuickJoinRoomDialog,
  renderCanceledRoomCard,
  renderLobbyInviteCard,
  renderPostMatchActions,
  teamVisual,
} from "./lobby-ui";
import {
  dismissPhaseCue,
  openQuickGuideModal,
  renderOutdoorReadinessStrip,
  renderPhaseCueStrip,
  syncOutdoorReadinessInPlace,
  type PhaseCueKey,
} from "./quick-guide";
import { preparePhotoFile, renderPhotoCaptureWidget, type PhotoDraftState } from "./photo-capture";
import { createRoomEventBridge, type RoomConnectionState } from "./room-events";
import { escapeText } from "./solo-view";
import "./rulebook-seek-play.css";
import "./rulebook-claim-play.css";

type ClaimPublicListing = {
  packId: string;
  version: number;
  format: "claim-the-city";
  isOfficial: boolean;
  title: string;
  byline: string;
  summary: string;
  cityLabel: string;
  difficulty: string;
  priceIdr: number;
  minPlayers: number;
  maxPlayers: number;
  teamMode: string;
  durationMinutes: number;
  soloTargets: { lockedLandmarks: number; distinctZones: number } | null;
  startName: string;
  zones: { id: string; name: string; label: string; landmarkCount: number }[];
  landmarkCount: number;
  challengePrimitives: string[];
  tacticalDeckSummary: { enabled: boolean; totalCards: number; maxHandSize: number };
};

type ClaimRoomPayload = {
  activity: RoomActivityFeed;
  format: "claim-the-city";
  qa?: true;
  draftPlaytest?: true;
  stateRev?: number;
  room: ClaimEngineRoomView;
  publicBoard: ClaimPublicBoard;
  pass: {
    roomCode: string; packId: string; version: number; maxPlayers: number; paid: boolean;
    minPlayers?: number; mode?: RulebookPlayMode; draftPlaytest?: boolean;
  };
};

type ClaimInlineSlot =
  | "catalog"
  | "join"
  | "lobby"
  | "lobby-checkin"
  | "landmark-checkin"
  | "challenge-input"
  | "challenge-photo"
  | "challenge-gps"
  | "curse-action";

type ClaimInlineError = {
  slot: ClaimInlineSlot;
  code: string;
  message: string;
  tone: PlayerErrorTone;
  targetId?: string;
} | null;

type PendingClaimAction = {
  signature: string;
  id: string;
  kind: string;
  cardInstanceId?: string;
  landmarkId?: string;
};

const phaseLabels: Record<ClaimEngineRoomView["phase"], string> = {
  lobby: "Ruang Tunggu",
  active: "Permainan Aktif",
  finished: "Selesai",
  abandoned: "Ditinggalkan",
  canceled: "Dibatalkan",
};

const claimPrimitiveLabels: Record<string, string> = {
  observation_mcq: "Pilihan Ganda",
  observation_input: "Isian",
  photo_proof: "Bukti Foto",
  timed_micro_task: "Tugas Cepat",
  call_your_shot: "Standar / Ekstra",
  multi_step: "2 Langkah",
};

function claimPrimitiveLabel(primitive: string): string {
  return claimPrimitiveLabels[primitive] ?? primitive;
}

function idr(amount: number): string {
  return amount === 0 ? "Gratis (Resmi)" : `Rp ${amount.toLocaleString("id-ID")} · Beli sekali`;
}

function getActiveLeaf(attempt: ClaimActiveAttemptView): ClaimSanitizedLeafChallenge | null {
  const payload = attempt.challenge.payload;
  if (payload.primitive === "call_your_shot") {
    return payload.activeTask ?? null;
  }
  if (payload.primitive === "multi_step") {
    return payload.steps[attempt.currentStep] ?? null;
  }
  return payload;
}

type ClaimPanel = "challenge" | "cards" | "score" | "activity";
const claimPanels: { id: ClaimPanel; icon: string; name: string }[] = [
  { id: "challenge", icon: "◆", name: "Tantangan" },
  { id: "cards", icon: "▣", name: "Kartu" },
  { id: "score", icon: "◈", name: "Skor" },
];

const cardLabels: Record<ClaimCardInstance["effect"]["primitive"], [string, string]> = {
  scout_challenge: ["Intai", "scout"],
  shield_claim: ["Lindungi", "shield"],
  double_weight: ["Bobot Ganda", "double"],
  swap_challenge: ["Tukar", "swap"],
  instant_lock: ["Kunci Instan", "lock"],
  sabotage_curse: ["Sabotase", "curse"],
};

function landmarkStatus(landmark: ClaimLandmarkState): string {
  if (landmark.status === "locked") return "Terkunci";
  if (landmark.status === "claimed") return "Rentan direbut";
  return "Belum diklaim";
}

function teamName(room: ClaimEngineRoomView, teamId: string): string {
  const names = room.seats.filter(seat => seat.teamId === teamId).map(seat => seat.name);
  return names.length ? names.join(", ") : teamId;
}

function seatInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  return (parts[0] ?? "P").slice(0, 2).toUpperCase();
}

function zoneLabelFor(room: ClaimEngineRoomView, zoneId?: string): string {
  if (!zoneId) return "";
  const zone = room.zones.find(z => z.zoneId === zoneId);
  return zone?.name || zone?.label || "";
}

function clockLabel(ms: number): string {
  const seconds = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function readSessionId(key: string): string | undefined {
  try {
    return sessionStorage.getItem(key) ?? undefined;
  } catch {
    return undefined;
  }
}

function writeSessionId(key: string, value?: string) {
  try {
    if (value) sessionStorage.setItem(key, value);
    else sessionStorage.removeItem(key);
  } catch {
    // Storage may be unavailable in restricted contexts.
  }
}

export function mountRulebookClaimPlay(root: HTMLElement, onBack: () => void): () => void {
  let allowSandboxCheckout = false;
  let listings: ClaimPublicListing[] = [];
  let ownedPackIds: string[] = [];
  let entitlements: RulebookEntitlementSummary[] = [];
  let roomCode = new URLSearchParams(location.search).get("room") ?? "";
  let joinCode = roomCode;
  let joinName = resolveDefaultPlayerName(getCachedAuth()?.user?.displayName, "Pemain");
  let joinNameEdited = false;
  let copiedCode = false;
  let copiedLink = false;
  let editingName = false;
  let renameDraft = "";
  let live: ClaimRoomPayload | null = null;
  let cachedBoard: { code: string; board: ClaimRoomPayload["publicBoard"] } | null = null;
  let roomEtag: { code: string; includeBoard: boolean; value: string } | null = null;
  let activeOrderId: string | null = null;
  let statusMsg = "";
  let inlineError: ClaimInlineError = null;
  let busy = false;
  const lifetime = new AbortController();
  let connectionState: RoomConnectionState = typeof navigator === "undefined" || navigator.onLine ? "connected" : "offline";
  const wakeLockSupported = typeof navigator !== "undefined" && "wakeLock" in navigator;
  let wakeLockWanted = false;
  let wakeLockSentinel: { release: () => Promise<void>; addEventListener?: (type: string, cb: () => void) => void } | null = null;
  let presenceInFlight = false;
  let forcePresenceCatchUp = true;
  let lastPresenceSentAt = 0;
  let lastPresenceCoord: GeoCoordinate | null = null;
  let selectedRivalPinSeatId = "";
  let selfFix: LocationFix | null = null;
  let liveLocationStatus: LiveLocationStatus = "prompt";
  let startMapExpanded = false;
  let startMiniMapHandle: BoardMapHandle | undefined;
  let startMiniMapRoomCode = "";
  let startMiniMapReq = 0;
  let landmarkSort: "zone" | "nearest" = "zone";
  const photoDrafts = new Map<string, PhotoDraftState>();
  let photoDraftSeq = 0;
  let uploadingPhotoTarget = "";

  function photoPicker(target: string): string {
    const draft = photoDrafts.get(target);
    return renderPhotoCaptureWidget({
      targetAttrName: "data-cg-photo",
      targetId: target,
      prepared: draft?.prepared,
      processing: draft?.processing,
      disabled: busy,
      hintText: "Ambil foto bukti langsung di lokasi (otomatis diperkecil < 2 MB).",
    });
  }

  function handlePhotoInput(targetId: string, file: File | undefined, isCurse: boolean) {
    const slot: ClaimInlineSlot = isCurse ? "curse-action" : "challenge-photo";
    if (!file) {
      photoDrafts.delete(targetId);
      render();
      return;
    }
    const seq = ++photoDraftSeq;
    if (inlineError?.slot === slot && inlineError.targetId === targetId) inlineError = null;
    const promise = preparePhotoFile(file);
    photoDrafts.set(targetId, { processing: true, prepared: null, promise, seq });
    render();
    void promise.then(
      (prepared) => {
        if (lifetime.signal.aborted) return;
        const current = photoDrafts.get(targetId);
        if (!current || current.seq !== seq) return;
        photoDrafts.set(targetId, { processing: false, prepared, seq });
        render();
      },
      (error) => {
        if (lifetime.signal.aborted) return;
        const current = photoDrafts.get(targetId);
        if (!current || current.seq !== seq) return;
        photoDrafts.delete(targetId);
        reportError(error, { action: "submit-photo", target: targetId }, slot, targetId);
        render();
      },
    );
  }

  function updateConnectionPill() {
    const pill = root.querySelector<HTMLElement>("[data-cg-conn-pill]");
    if (!pill) return;
    pill.hidden = connectionState === "connected";
    pill.textContent = connectionState === "offline" ? "Luring · menunggu koneksi" : "Menyambungkan ulang…";
  }

  function releaseWakeLock() {
    const sentinel = wakeLockSentinel;
    wakeLockSentinel = null;
    if (sentinel) void sentinel.release().catch(() => {});
  }

  async function syncWakeLock() {
    const active = Boolean(
      wakeLockSupported &&
      wakeLockWanted &&
      live &&
      live.room.phase === "active" &&
      !live.room.outcome &&
      !document.hidden &&
      !lifetime.signal.aborted,
    );
    if (!active) {
      releaseWakeLock();
      return;
    }
    if (wakeLockSentinel) return;
    try {
      const wl = (navigator as Navigator & { wakeLock?: { request: (type: "screen") => Promise<typeof wakeLockSentinel> } }).wakeLock;
      const sentinel = await wl?.request("screen");
      if (!sentinel) return;
      if (lifetime.signal.aborted || !wakeLockWanted || document.hidden || !live || live.room.phase !== "active" || live.room.outcome) {
        void sentinel.release().catch(() => {});
        return;
      }
      wakeLockSentinel = sentinel;
      sentinel.addEventListener?.("release", () => {
        if (wakeLockSentinel === sentinel) wakeLockSentinel = null;
      });
    } catch {
      // Wake lock can be denied by battery saver or browser policy.
    }
  }

  function destroyStartMiniMap() {
    startMiniMapReq++;
    startMiniMapHandle?.destroy();
    startMiniMapHandle = undefined;
    startMiniMapRoomCode = "";
  }

  function buildStartMiniMapState(payload: ClaimRoomPayload): BoardMapUpdateOptions {
    const sp = payload.publicBoard.startPoint;
    return {
      start: {
        id: sp.id,
        name: sp.name,
        latitude: sp.latitude,
        longitude: sp.longitude,
        x: 50,
        y: 50,
      },
      startLabel: "Awal",
      checkpoints: [],
      selfLocation: selfFix ? { latitude: selfFix.latitude, longitude: selfFix.longitude, accuracy: selfFix.accuracy } : undefined,
      checkInTarget: { center: sp, radiusMeters: payload.publicBoard.checkInRadiusMeters },
      onRequestSelfLocation: () => liveLocation.start(),
    };
  }

  async function syncStartMiniMap(host: HTMLElement, payload: ClaimRoomPayload) {
    if (startMiniMapHandle && startMiniMapRoomCode === payload.room.code) {
      startMiniMapHandle.update(buildStartMiniMapState(payload));
      return;
    }
    const reqId = ++startMiniMapReq;
    startMiniMapHandle?.destroy();
    startMiniMapHandle = undefined;
    startMiniMapRoomCode = payload.room.code;
    try {
      const [{ mountBoardMap }, mapCfg] = await Promise.all([
        import("./board-map"),
        fetchMapConfig(lifetime.signal),
      ]);
      if (reqId !== startMiniMapReq || !host.isConnected || !live || live.room.code !== payload.room.code || live.room.phase !== "lobby" || !startMapExpanded) {
        return;
      }
      const handle = mountBoardMap({
        container: host,
        config: mapCfg,
        camera: { center: [payload.publicBoard.startPoint.longitude, payload.publicBoard.startPoint.latitude], zoom: 15.2 },
        ...buildStartMiniMapState(live),
      });
      if (reqId !== startMiniMapReq) handle.destroy();
      else startMiniMapHandle = handle;
    } catch {
      if (reqId === startMiniMapReq) destroyStartMiniMap();
    }
  }

  function updateLobbyProximityInPlace() {
    if (!live || live.room.phase !== "lobby") return;
    syncOutdoorReadinessInPlace(root, { fix: selfFix, status: liveLocationStatus });
    const card = root.querySelector<HTMLElement>('[data-testid="lobby-start-card"]');
    if (!card) return;
    const meter = renderDistanceMeter({
      fix: selfFix,
      target: live.publicBoard.startPoint,
      checkInRadiusMeters: live.publicBoard.checkInRadiusMeters,
      maxGpsAccuracyMeters: live.publicBoard.maxGpsAccuracyMeters,
      status: liveLocationStatus,
      testId: "lobby-distance-meter",
      showEnableChip: true,
    });
    const prev = card.querySelector('[data-testid="lobby-distance-meter"], [data-testid="enable-live-location-btn"], .loc-meter-row');
    if (prev && meter.html) {
      const tmp = document.createElement("div");
      tmp.innerHTML = meter.html;
      const nextEl = tmp.firstElementChild;
      if (nextEl) prev.replaceWith(nextEl);
    }
    const checkBtn = root.querySelector<HTMLButtonElement>('button[data-action="sim-start-checkin"]');
    if (checkBtn) {
      checkBtn.classList.toggle("loc-btn-ready", meter.proximity.state === "ready");
    }
    if (startMiniMapHandle && startMiniMapRoomCode === live.room.code) {
      startMiniMapHandle.update(buildStartMiniMapState(live));
    }
  }

  let isRendering = false;
  const liveLocation = createLiveLocationWatcher({
    signal: lifetime.signal,
    onFix: (fix) => {
      selfFix = fix;
      if (canPublishPresence()) {
        publishPresenceFix(fix, fix.accuracy);
      }
      if (!live || lifetime.signal.aborted || isRendering) return;
      if (live.room.phase === "lobby") {
        updateLobbyProximityInPlace();
        return;
      }
      if (live.room.phase === "active" && !live.room.outcome) {
        if (claimMapHandle && claimMapRoomCode === live.room.code && !mapFailed) {
          claimMapHandle.update(buildClaimMapState(live));
        }
        if (panel === "challenge" || mapFailed) {
          render();
        }
      }
    },
    onStatusChange: (nextStatus) => {
      liveLocationStatus = nextStatus;
      if (!live || lifetime.signal.aborted || isRendering) return;
      if (live.room.phase === "lobby") {
        updateLobbyProximityInPlace();
      } else if (live.room.phase === "active" && (panel === "challenge" || mapFailed)) {
        render();
      }
    },
  });
  liveLocationStatus = liveLocation.getStatus();

  function stopPresenceWatch() {
    liveLocation.stop();
  }

  function canPublishPresence(): boolean {
    return Boolean(
      !lifetime.signal.aborted &&
      live &&
      roomCode &&
      live.room.phase === "active" &&
      !live.room.isSolo &&
      !live.room.outcome &&
      live.room.opponentTracking?.mode === "periodic_gps" &&
      !document.hidden &&
      navigator.onLine,
    );
  }

  function publishPresenceFix(coord: GeoCoordinate, accuracy: number) {
    if (!canPublishPresence() || presenceInFlight || !live) return;
    const nowWall = Date.now();
    const minThrottleMs = 3_200;
    const intervalMs = Math.max(minThrottleMs, Math.min(8_000, live.room.opponentTracking?.intervalMs ?? 10_000));
    const elapsed = nowWall - lastPresenceSentAt;
    const moved = lastPresenceCoord ? haversineMeters(lastPresenceCoord, coord) : Infinity;
    const shouldSend =
      forcePresenceCatchUp ||
      !lastPresenceCoord ||
      elapsed >= intervalMs ||
      (moved >= 10 && elapsed >= minThrottleMs);
    if (!shouldSend) return;

    const codeAtSend = roomCode;
    const fix = {
      latitude: coord.latitude,
      longitude: coord.longitude,
      accuracy: Number.isFinite(accuracy) && accuracy >= 0 ? accuracy : 10,
      timestamp: demoLocation ? live.room.now : Math.max(0, nowWall + serverOffset - 1_000),
    };
    presenceInFlight = true;
    forcePresenceCatchUp = false;
    lastPresenceSentAt = nowWall;
    lastPresenceCoord = { latitude: fix.latitude, longitude: fix.longitude };
    void fetchApiJson<{ ok?: boolean }>(`/api/rulebooks/rooms/${encodeURIComponent(codeAtSend)}/presence`, {
      signal: lifetime.signal,
      body: { fix },
    })
      .catch(() => {})
      .finally(() => {
        presenceInFlight = false;
      });
  }

  function syncPresenceWatch() {
    if (!live || live.room.outcome || live.room.phase === "canceled") {
      liveLocation.stop();
      return;
    }
    liveLocation.checkPermissionAndAutoStart();
    if (canPublishPresence() && liveLocation.getStatus() === "prompt") {
      liveLocation.start();
    }
  }

  document.addEventListener("visibilitychange", () => {
    if (lifetime.signal.aborted) return;
    if (document.hidden) {
      releaseWakeLock();
      return;
    }
    forcePresenceCatchUp = true;
    syncPresenceWatch();
    void syncWakeLock();
  }, { signal: lifetime.signal });

  window.addEventListener("online", () => {
    if (lifetime.signal.aborted) return;
    forcePresenceCatchUp = true;
    if (selfFix && canPublishPresence()) {
      publishPresenceFix(selfFix, selfFix.accuracy);
    }
    syncPresenceWatch();
  }, { signal: lifetime.signal });

  const roomEvents = createRoomEventBridge({
    signal: lifetime.signal,
    getActiveRoom: () =>
      live && roomCode && (live.room.phase === "lobby" || live.room.phase === "active") && !live.room.outcome
        ? { code: roomCode, stateRev: live.stateRev ?? 0 }
        : null,
    isBusy: () => busy,
    onSync: () => refreshRoom(false, true),
    onPresence: (positions: ClaimSeatPosition[], eventNow: number) => {
      if (!live || live.room.code !== roomCode || live.room.phase !== "active" || live.room.outcome) return;
      live.room.seatPositions = positions;
      serverOffset = eventNow - Date.now();
      if (claimMapHandle && claimMapRoomCode === live.room.code && !mapFailed) {
        claimMapHandle.update(buildClaimMapState(live));
      }
      if (panel === "score" || selectedRivalPinSeatId || mapFailed) {
        render();
      } else {
        updateClocks();
      }
    },
    onConnectionChange: (state) => {
      connectionState = state;
      updateConnectionPill();
    },
  });
  const toast = createPlayerToast({ signal: lifetime.signal, layout: "page" });
  let demoLocation = false;
  let qaLocationId = "";
  let mapFailed = false;

  function isDraftPlaytest(payload: ClaimRoomPayload | null): boolean {
    return Boolean(payload?.draftPlaytest || payload?.pass?.draftPlaytest);
  }

  function isQaRoom(payload: ClaimRoomPayload | null): boolean {
    return Boolean(payload?.qa || isDraftPlaytest(payload));
  }

  function draftStudioUrl(pass: ClaimRoomPayload["pass"]): string {
    return `/?play=rulebook-studio&studio=editor&format=claim-the-city&draft=${encodeURIComponent(pass.packId)}&version=${pass.version}`;
  }

  function resolveQaCoord(payload: ClaimRoomPayload): GeoCoordinate | null {
    if (!qaLocationId) return null;
    if (payload.publicBoard.startPoint.id === qaLocationId) return payload.publicBoard.startPoint;
    const lm = payload.publicBoard.landmarks.find((item) => item.id === qaLocationId);
    return lm ?? null;
  }

  function renderClaimDraftBar(payload: ClaimRoomPayload): string {
    if (!isQaRoom(payload)) return "";
    const isDraft = isDraftPlaytest(payload);
    const isActive = payload.room.phase === "active" && !payload.room.outcome;
    const ownSeat = payload.room.seats.find((s) => s.seatId === payload.room.seatId);
    const isHost = Boolean(ownSeat?.isHost);
    return `<section class="cg-draft-bar" data-testid="draft-playtest-bar" aria-label="Kontrol Uji Draf">
      <div class="cg-draft-bar-head">
        ${isDraft ? '<span class="rb-badge sg-qa-badge" data-testid="draft-playtest-badge">Uji Draf</span>' : '<span class="rb-badge sg-qa-badge">Mode QA</span>'}
        ${isDraft ? `<a class="cg-back-studio-link" data-testid="back-to-studio-btn" href="${draftStudioUrl(payload.pass)}">← Kembali ke Studio</a>` : ""}
      </div>
      <label class="cg-qa-loc-field">
        <span>Simulasi GPS</span>
        <select id="claim-qa-location" data-testid="claim-qa-location">
          <option value="" ${qaLocationId === "" ? "selected" : ""}>Otomatis di target check-in</option>
          <option value="${escapeText(payload.publicBoard.startPoint.id)}" ${qaLocationId === payload.publicBoard.startPoint.id ? "selected" : ""}>Titik Awal · ${escapeText(payload.publicBoard.startPoint.name)}</option>
          ${payload.publicBoard.landmarks
            .map(
              (lm) =>
                `<option value="${escapeText(lm.id)}" ${qaLocationId === lm.id ? "selected" : ""}>Landmark · ${escapeText(lm.name)}</option>`,
            )
            .join("")}
        </select>
      </label>
      ${isActive && isHost ? `<div class="cg-qa-clock-row">
        <button type="button" class="secondary" data-action="claim-qa-advance" data-step="minute" ${busy ? "disabled" : ""}>+1 menit</button>
        <button type="button" class="secondary" data-action="claim-qa-advance" data-step="five-minutes" ${busy ? "disabled" : ""}>+5 menit</button>
        <button type="button" class="secondary" data-action="claim-qa-advance" data-step="phase-end" ${busy ? "disabled" : ""}>Akhiri Ronde</button>
      </div>` : ""}
    </section>`;
  }
  let claimMapHandle: BoardMapHandle | undefined;
  let claimMapRoomCode = "";
  let claimMapReq = 0;
  let refreshSeq = 0;
  let serverOffset = 0;
  let panel: ClaimPanel = "challenge";
  let liveEffects: RoomActivityEvent[] = [];
  const activityUi = createRoomActivityUi(lifetime.signal, notice => {
    if (!live || busy) return;
    panel = notice === "activity" ? "activity"
      : notice.panel === "score" ? "score"
      : notice.panel === "cards" ? "cards" : "challenge";
    folded = false;
    if (notice !== "activity" && notice.landmarkId) selectedId = notice.landmarkId;
    render();
    const sheet = root.querySelector<HTMLElement>(".cg-sheet");
    const target = notice !== "activity" && notice.panel === "review"
      ? sheet?.querySelector<HTMLElement>("button[data-action='review-rival-photo'], button[data-curse]")
      : sheet?.querySelector<HTMLElement>("[data-activity-heading]");
    (target ?? sheet)?.focus({ preventScroll: true });
  }, events => { liveEffects = events; });
  let folded = false;
  let selectedId = "";
  let selectedCardId = "";
  let selectedRivalId = "";
  let challengeHandId = "";
  let pendingAction: PendingClaimAction | null = null;

  function cardTargets(room: ClaimEngineRoomView, card?: ClaimCardInstance): string[] {
    return room.landmarks.filter(lm => {
      const own = lm.ownerTeamId === room.teamId;
      switch (card?.effect.primitive) {
        case "scout_challenge":
          return !room.ownChallengeHand && lm.status !== "locked" && !room.scoutedChallenges[lm.landmarkId] &&
            !room.ownBurnedLandmarks.includes(lm.landmarkId);
        case "shield_claim":
          return !room.isSolo && own && lm.status === "claimed";
        case "instant_lock":
          return own && lm.status === "claimed" &&
            (!room.ownChallengeHand || room.ownActiveAttempt?.landmarkId === lm.landmarkId) &&
            (!room.ownActiveAttempt || room.ownActiveAttempt.landmarkId === lm.landmarkId);
        case "double_weight":
          return own && lm.status === "locked" && !lm.doubleWeighted;
        case "swap_challenge":
          return room.ownActiveAttempt?.landmarkId === lm.landmarkId;
        default:
          return false;
      }
    }).map(lm => lm.landmarkId);
  }

  function currentSurface(): PlayerErrorSurface {
    if (!live) return "catalog";
    return live.room.phase === "lobby" ? "lobby" : "claim";
  }

  function ensurePendingAction(
    signature: string,
    kind: string,
    meta?: { cardInstanceId?: string; landmarkId?: string },
    persistKey?: string,
  ): PendingClaimAction {
    if (pendingAction?.signature === signature) return pendingAction;
    const restored = persistKey ? readSessionId(persistKey) : undefined;
    const id = restored ?? `claim-${crypto.randomUUID()}`;
    if (persistKey) writeSessionId(persistKey, id);
    pendingAction = { signature, id, kind, ...meta };
    return pendingAction;
  }

  function clearPendingAction(persistKey?: string) {
    pendingAction = null;
    if (persistKey) writeSessionId(persistKey);
  }

  function reconcilePendingAction(room: ClaimEngineRoomView) {
    if (!pendingAction) return;
    const { kind, cardInstanceId, landmarkId } = pendingAction;
    let resolvedOnServer = false;
    if (kind === "play-card" && cardInstanceId) {
      resolvedOnServer = !room.ownHand.some(card => card.instanceId === cardInstanceId);
      if (resolvedOnServer && selectedCardId === cardInstanceId) selectedCardId = "";
    } else if (kind === "check-in-landmark" && landmarkId) {
      resolvedOnServer = room.ownActiveAttempt?.landmarkId === landmarkId;
    } else if (kind === "start") {
      resolvedOnServer = room.phase !== "lobby";
    } else if (kind === "ready") {
      resolvedOnServer = room.seats.some(seat => seat.seatId === room.seatId && seat.ready);
    } else if (kind === "check-in-start") {
      resolvedOnServer = room.seats.some(seat => seat.seatId === room.seatId && seat.startVerifiedUntil !== null);
    } else if ((kind === "bail-challenge" || kind === "submit-challenge") && landmarkId) {
      resolvedOnServer = room.ownActiveAttempt?.landmarkId !== landmarkId;
    } else if (kind === "submit-photo" && landmarkId) {
      resolvedOnServer = !room.ownActiveAttempt || Boolean(room.ownActiveAttempt.pendingPhoto);
    }
    if (resolvedOnServer) {
      pendingAction = null;
      toast.clear();
      toast.resetDedupe();
    }
  }

  function reportError(
    input: unknown,
    context: { action: string; target?: string; surface?: PlayerErrorSurface },
    inlineSlot: ClaimInlineSlot,
    targetId?: string,
  ) {
    const resolved = resolvePlayerError(input, {
      surface: context.surface ?? currentSurface(),
      action: context.action,
      target: context.target,
    });
    if (resolved.staleTarget) {
      selectedId = "";
      selectedRivalId = "";
      if (resolved.code === "card-not-in-hand" || resolved.code === "no-active-attempt") {
        selectedCardId = "";
      }
    }
    if (resolved.placement === "toast") {
      inlineError = null;
      toast.show(resolved);
    } else {
      toast.clear();
      const slot: ClaimInlineSlot = resolved.placement === "inline-screen"
        ? (live ? "lobby" : "catalog")
        : inlineSlot;
      inlineError = {
        slot,
        code: resolved.code,
        message: resolved.message,
        tone: resolved.tone,
        targetId: slot === "lobby" || slot === "catalog" || slot === "join" || slot === "lobby-checkin" ? undefined : targetId,
      };
    }
    return resolved;
  }

  function slotAlert(slot: ClaimInlineSlot, targetId?: string): string {
    if (!inlineError || inlineError.slot !== slot) return "";
    if (targetId !== undefined && inlineError.targetId !== undefined && inlineError.targetId !== targetId) return "";
    return renderInlineAlert(inlineError.message, inlineError.tone, `data-error-slot="${slot}"`);
  }

  function syncRoomUrl(code: string) {
    const url = new URL(location.href);
    url.searchParams.set("play", "rulebook-claim");
    url.searchParams.delete("pack");
    url.searchParams.delete("launch");
    if (code) url.searchParams.set("room", code);
    else url.searchParams.delete("room");
    history.replaceState(history.state, "", url);
  }

  async function loadCatalog() {
    const { data } = await fetchApiJson<{
      listings?: ClaimPublicListing[];
      ownedPackIds?: string[];
      entitlements?: RulebookEntitlementSummary[];
      allowSandboxCheckout?: boolean;
    }>(
      "/api/rulebooks?format=claim-the-city",
      { signal: lifetime.signal },
    );
    allowSandboxCheckout = data.allowSandboxCheckout === true;
    listings = (data.listings ?? []).filter((l) => l.format === "claim-the-city");
    ownedPackIds = Array.isArray(data.ownedPackIds) ? data.ownedPackIds : [];
    entitlements = Array.isArray(data.entitlements) ? data.entitlements : [];
    const params = new URLSearchParams(location.search);
    const launchPackId = params.get("pack");
    const shouldLaunch = params.get("launch") === "1";
    if (!roomCode && shouldLaunch && launchPackId) {
      const target = listings.find((l) => l.packId === launchPackId && (l.priceIdr === 0 || ownedPackIds.includes(l.packId)));
      if (target) {
        const isOwnedPaid = target.priceIdr > 0 && ownedPackIds.includes(target.packId);
        const persistKey = `kelana-claim-${isOwnedPaid ? "owned" : "free"}:${target.packId}:${target.version}`;
        const pending = ensurePendingAction(`create-${isOwnedPaid ? "owned" : "free"}:${target.packId}:${target.version}`, isOwnedPaid ? "create-owned-room" : "create-free-room", undefined, persistKey);
        const { ok, status, data: res } = await fetchApiJson<{ ok?: boolean; roomCode?: string; error?: string }>("/api/rulebooks", {
          signal: lifetime.signal,
          body: {
            type: isOwnedPaid ? "create-owned-room" : "create-free-room",
            packId: target.packId,
            version: target.version,
            requestId: pending.id,
          },
        });
        if (ok && res.ok && res.roomCode) {
          clearPendingAction(persistKey);
          roomCode = res.roomCode;
          joinCode = res.roomCode;
          statusMsg = `Ruang Claim ${roomCode} siap dimainkan.`;
          await refreshRoom();
          return;
        }
        clearPendingAction(persistKey);
        reportError({ error: res.error, status }, { surface: "catalog", action: isOwnedPaid ? "start-owned" : "start-free", target: target.packId }, "catalog");
      }
    }
    if (roomCode) {
      await refreshRoom(true);
    } else {
      render();
    }
  }

  async function refreshRoom(allowInvitePrompt = false, background = false, skipRender = false) {
    if (!roomCode) return;
    const req = ++refreshSeq;
    const code = roomCode;
    const hasBoard = Boolean(live && cachedBoard && cachedBoard.code === code);
    const includeBoard = !hasBoard;
    const path = includeBoard
      ? `/api/rulebooks/rooms/${encodeURIComponent(code)}`
      : `/api/rulebooks/rooms/${encodeURIComponent(code)}?includeBoard=0`;
    const reqHeaders: Record<string, string> = {};
    if (roomEtag && roomEtag.code === code && roomEtag.includeBoard === includeBoard) {
      reqHeaders["If-None-Match"] = roomEtag.value;
    }
    const { status, data, headers, notModified } = await fetchApiJson<
      (Omit<ClaimRoomPayload, "publicBoard"> & { publicBoard?: ClaimRoomPayload["publicBoard"]; error?: string })
    >(path, { signal: lifetime.signal, headers: reqHeaders, cache: "no-store" });
    if (req !== refreshSeq || code !== roomCode || lifetime.signal.aborted || (background && busy)) return;
    if (notModified) {
      const serverNow = Number(headers.get("x-server-now"));
      if (Number.isFinite(serverNow) && serverNow > 0) {
        serverOffset = serverNow - Date.now();
        updateClocks();
      }
      roomEvents.markSynced();
      if (!background && !skipRender) render();
      return;
    }
    if ("room" in data && data.room) {
      const board = data.publicBoard ?? (cachedBoard?.code === code ? cachedBoard.board : undefined);
      if (!board) {
        cachedBoard = null;
        roomEtag = null;
        return refreshRoom(allowInvitePrompt, background, skipRender);
      }
      cachedBoard = { code, board };
      const etag = headers.get("etag");
      if (etag) roomEtag = { code, includeBoard, value: etag };
      const payload: ClaimRoomPayload = { ...data, publicBoard: board };
      serverOffset = payload.room.now - Date.now();
      reconcilePendingAction(payload.room);
      if ((payload.room.phase === "lobby" || payload.room.phase === "active") && !payload.room.outcome) {
        saveActiveRoom({
          roomCode: payload.room.code,
          format: "claim-the-city",
          packId: payload.room.packMeta.packId,
          version: payload.room.packMeta.version,
          title: payload.room.packMeta.title,
          phase: payload.room.phase,
          role: payload.room.isSolo ? "solo" : "group",
          playerCount: payload.room.seats.length,
          maxPlayers: payload.pass.maxPlayers,
        });
      } else {
        clearActiveRoom(payload.room.code);
      }
      if (selectedCardId && !payload.room.ownHand.some(card => card.instanceId === selectedCardId)) {
        selectedCardId = "";
      }
      const unchanged = Boolean(
        background &&
        live &&
        live.room.code === payload.room.code &&
        live.room.seatId === payload.room.seatId &&
        (live.activity.prompt?.id ?? null) === (payload.activity.prompt?.id ?? null) &&
        (typeof live.stateRev === "number" && typeof payload.stateRev === "number"
          ? live.stateRev === payload.stateRev
          : JSON.stringify({ ...live.room, now: 0 }) === JSON.stringify({ ...payload.room, now: 0 }) &&
            JSON.stringify(live.activity) === JSON.stringify(payload.activity)),
      );
      if (unchanged) {
        live = payload;
        roomEvents.markSynced();
        return;
      }
      if (payload.room.outcome && !live?.room.outcome) {
        panel = "score";
        folded = false;
      }
      const switchedRoom = live?.room.code !== payload.room.code;
      live = payload;
      if (switchedRoom) {
        qaLocationId = isQaRoom(payload) ? (sessionStorage.getItem(`claim-qa-location:${payload.room.code}`) ?? "") : "";
        const qaCoord = resolveQaCoord(payload);
        if (qaCoord) {
          liveLocation.setManualFix({
            latitude: qaCoord.latitude,
            longitude: qaCoord.longitude,
            accuracy: 10,
            timestamp: payload.room.now,
          });
        }
      }
      syncRoomUrl(roomCode);
      roomEvents.markSynced();
    } else if (background) {
      return;
    } else if (allowInvitePrompt) {
      statusMsg = `Undangan ruang ${roomCode} terdeteksi. Masukkan namamu lalu tekan Gabung Ruang.`;
      inlineError = null;
    } else {
      reportError({ error: data.error ?? "room-not-found", status }, { surface: "lobby", action: "load-room", target: code }, "catalog");
    }
    if (!skipRender) render();
  }

  function inlineSlotForRoomAction(action: Record<string, unknown>): { slot: ClaimInlineSlot; targetId?: string } {
    const type = String(action.type ?? "");
    const landmarkId = typeof action.landmarkId === "string" ? action.landmarkId : undefined;
    const curseId = typeof action.curseInstanceId === "string" ? action.curseInstanceId : undefined;
    if (type === "check-in-start") return { slot: "lobby-checkin" };
    if (type === "check-in-landmark") return { slot: "landmark-checkin", targetId: landmarkId };
    if (type === "submit-challenge") {
      return action.fix ? { slot: "challenge-gps", targetId: landmarkId } : { slot: "challenge-input", targetId: landmarkId };
    }
    if (type === "clear-curse-gps" || type === "clear-curse-honor" || type === "review-curse-photo") {
      return { slot: "curse-action", targetId: curseId };
    }
    return { slot: live?.room.phase === "lobby" ? "lobby" : "landmark-checkin", targetId: landmarkId };
  }

  async function postRoomAction(action: Record<string, unknown>): Promise<boolean> {
    if (!roomCode) return false;
    const type = String(action.type ?? "action");
    const landmarkId = typeof action.landmarkId === "string" ? action.landmarkId : undefined;
    const cardInstanceId = typeof action.cardInstanceId === "string" ? action.cardInstanceId : undefined;
    const targetSeatId = typeof action.targetSeatId === "string" ? action.targetSeatId : undefined;
    const curseId = typeof action.curseInstanceId === "string" ? action.curseInstanceId : undefined;
    const targetKey = landmarkId ?? cardInstanceId ?? targetSeatId ?? curseId;
    const signature = JSON.stringify([
      roomCode,
      type,
      landmarkId,
      cardInstanceId,
      targetSeatId,
      curseId,
      action.tier,
      action.choiceId,
      action.inputValue,
      action.teamId,
      action.name,
      action.ready,
    ]);
    const pending = ensurePendingAction(signature, type, { cardInstanceId, landmarkId });
    const previousAttempt = live?.room.ownActiveAttempt;
    const { slot, targetId } = inlineSlotForRoomAction(action);

    try {
      const { ok, status, data: res } = await fetchApiJson<{ room?: ClaimEngineRoomView; error?: string; distanceMeters?: number }>("/api/rulebooks", {
        signal: lifetime.signal,
        body: {
          type: "room-action",
          roomCode,
          action: { actionId: pending.id, ...action },
        },
      });
      clearPendingAction();
      const succeeded = Boolean(ok && !res.error);
      if (!succeeded) {
        reportError(
          { error: res.error ?? "invalid-request", status },
          { action: type, target: targetKey },
          slot,
          targetId,
        );
      } else {
        inlineError = null;
        toast.clear();
        toast.resetDedupe();
        if (type === "play-card") selectedCardId = "";
        if (type === "check-in-landmark" && res.room?.ownActiveAttempt &&
          res.room.ownActiveAttempt.landmarkId !== previousAttempt?.landmarkId) {
          panel = "challenge";
          folded = false;
        }
      }
      await refreshRoom(false, false, true).catch(() => {});
      return succeeded;
    } catch (error) {
      if (lifetime.signal.aborted) return false;
      const resolved = reportError(error, { action: type, target: targetKey }, slot, targetId);
      if (!resolved.uncertain) clearPendingAction();
      return false;
    }
  }

  async function submitPhoto(button: HTMLButtonElement) {
    const landmarkId = button.dataset.landmark;
    const curseInstanceId = button.dataset.curse;
    const targetId = landmarkId ?? curseInstanceId ?? "";
    const slot: ClaimInlineSlot = curseInstanceId ? "curse-action" : "challenge-photo";
    const draft = photoDrafts.get(targetId);
    let prepared = draft?.prepared ?? null;
    if (!prepared && draft?.processing && draft.promise) {
      try {
        prepared = await draft.promise;
      } catch (error) {
        reportError(error, { action: "submit-photo", target: targetId }, slot, targetId);
        return;
      }
    }
    if (!prepared) {
      const input = Array.from(root.querySelectorAll<HTMLInputElement>("input[data-cg-photo]"))
        .find(element => element.dataset.cgPhoto === targetId);
      const file = input?.files?.[0];
      if (!file) {
        reportError("photo-required", { action: "submit-photo", target: targetId }, slot, targetId);
        return;
      }
      try {
        prepared = await preparePhotoFile(file);
        photoDrafts.set(targetId, { processing: false, prepared, seq: ++photoDraftSeq });
      } catch (error) {
        reportError(error, { action: "submit-photo", target: targetId }, slot, targetId);
        return;
      }
    }
    const signature = JSON.stringify([roomCode, "submit-photo", landmarkId, curseInstanceId, prepared.byteLength, prepared.base64.slice(0, 32)]);
    const pending = ensurePendingAction(signature, "submit-photo", { landmarkId });
    uploadingPhotoTarget = targetId;
    render();
    try {
      const { ok, status, data: res } = await fetchApiJson<{ error?: string }>("/api/rulebooks/claim-photo", {
        signal: lifetime.signal,
        body: {
          roomCode,
          actionId: pending.id,
          landmarkId,
          curseInstanceId,
          photoBase64: prepared.base64,
        },
      });
      clearPendingAction();
      if (res.error || !ok) {
        reportError({ error: res.error ?? "invalid-photo", status }, { action: "submit-photo", target: targetId }, slot, targetId);
      } else {
        photoDrafts.delete(targetId);
        inlineError = null;
        toast.clear();
        toast.resetDedupe();
      }
      await refreshRoom(false, false, true).catch(() => {});
    } catch (error) {
      if (lifetime.signal.aborted) return;
      const resolved = reportError(error, { action: "submit-photo", target: targetId }, slot, targetId);
      if (!resolved.uncertain) clearPendingAction();
    } finally {
      uploadingPhotoTarget = "";
    }
  }

  function destroyClaimMap() {
    claimMapReq++;
    claimMapHandle?.destroy();
    claimMapHandle = undefined;
    claimMapRoomCode = "";
  }

  function buildClaimMapState(payload: ClaimRoomPayload): BoardMapUpdateOptions {
    const { room, publicBoard } = payload;
    const mapNow = Date.now() + serverOffset;
    const stateById = new Map(room.landmarks.map(lm => [lm.landmarkId, lm]));
    const targets = panel === "cards" && !folded
      ? cardTargets(room, room.ownHand.find(card => card.instanceId === selectedCardId))
      : [];
    const rivalPins =
      room.phase === "active" && !room.isSolo && !room.outcome && room.opponentTracking?.mode !== "off"
        ? (room.seatPositions ?? [])
            .filter(pos => pos.seatId !== room.seatId)
            .map((pos) => {
              const bucket = freshnessBucket(pos.at, mapNow);
              const zoneName = zoneLabelFor(room, pos.zoneId);
              const ageLabel = formatRelativeAge(pos.at, mapNow, true);
              return {
                id: `rival:${pos.seatId}`,
                name: pos.name,
                latitude: pos.latitude,
                longitude: pos.longitude,
                x: 50,
                y: 50,
                label: [zoneName, ageLabel].filter(Boolean).join(" · "),
                markerText: `▲ ${seatInitials(pos.name)}`,
                markerKind: "rival" as const,
                selectable: true,
                ownerStyle: (pos.teamId === room.teamId ? "mine" : "rival") as "mine" | "rival",
                freshness: bucket,
                dataAttrs: {
                  "data-rival-seat": pos.seatId,
                  "data-freshness": bucket,
                  "data-source": pos.source,
                },
              };
            })
        : [];
    const activeSubPoint = room.ownActiveAttempt
      ? (() => {
          const leaf = getActiveLeaf(room.ownActiveAttempt);
          return leaf?.primitive === "timed_micro_task" && leaf.taskType === "sub_point_gps" && leaf.subPoint
            ? leaf.subPoint
            : undefined;
        })()
      : undefined;
    const selectedLandmarkMeta =
      !selectedRivalPinSeatId && selectedId
        ? publicBoard.landmarks.find((lm) => lm.id === selectedId)
        : undefined;
    const checkInTarget = activeSubPoint
      ? { center: activeSubPoint, radiusMeters: activeSubPoint.radiusMeters }
      : selectedLandmarkMeta
        ? { center: selectedLandmarkMeta, radiusMeters: publicBoard.checkInRadiusMeters }
        : undefined;
    return {
      start: {
        id: payload.publicBoard.startPoint.id,
        name: payload.publicBoard.startPoint.name,
        latitude: payload.publicBoard.startPoint.latitude,
        longitude: payload.publicBoard.startPoint.longitude,
        x: 50,
        y: 50,
      },
      startLabel: "Awal",
      fitPadding: { top: 145, bottom: 205, left: 34, right: 34 },
      selectedId: selectedRivalPinSeatId ? `rival:${selectedRivalPinSeatId}` : selectedId,
      selfLocation: selfFix ? { latitude: selfFix.latitude, longitude: selfFix.longitude, accuracy: selfFix.accuracy } : undefined,
      checkInTarget,
      onRequestSelfLocation: () => liveLocation.start(),
      onSelect: selectLandmark,
      checkpoints: [
        ...payload.publicBoard.landmarks.map((lm) => {
          const st = stateById.get(lm.id);
          return {
            id: lm.id,
            name: lm.name,
            zone: lm.zoneId,
            latitude: lm.latitude,
            longitude: lm.longitude,
            x: 50,
            y: 50,
            label: st ? `${landmarkStatus(st)}${st.ownerTeamId ? ` · ${teamName(room, st.ownerTeamId)}` : ""}` : lm.name,
            markerText: st?.status === "locked" ? "■" : st?.status === "claimed" ? "◆" : "●",
            markerKind: "landmark" as const,
            selectable: true,
            ownerStyle: (st?.ownerTeamId ? (st.ownerTeamId === room.teamId ? "mine" : "rival") : undefined) as "mine" | "rival" | undefined,
            eligible: targets.includes(lm.id),
            statusTag: st?.status ?? "unclaimed",
            dimmed: room.ownBurnedLandmarks.includes(lm.id) || (targets.length > 0 && !targets.includes(lm.id)),
          };
        }),
        ...rivalPins,
      ],
      labels: room.zones.flatMap(zone => {
        const points = publicBoard.landmarks.filter(lm => lm.zoneId === zone.zoneId);
        if (points.length === 0) return [];
        const controller = zone.controllerTeamId;
        const soloDone = room.landmarks.some(lm => lm.zoneId === zone.zoneId && lm.status === "locked" && lm.ownerTeamId === room.teamId);
        const owner = room.isSolo ? (soloDone ? "Tercapai" : "") : controller ? (controller === room.teamId ? "Kamu" : "Lawan") : "";
        return [{
          id: `zone:${zone.zoneId}`, name: zone.name, x: 50, y: 50,
          latitude: points.reduce((sum, point) => sum + point.latitude, 0) / points.length,
          longitude: points.reduce((sum, point) => sum + point.longitude, 0) / points.length,
          markerText: owner ? `${zone.label} · ${owner}` : zone.label,
          markerKind: "zone",
          ownerStyle: owner ? (owner === "Lawan" ? "rival" : "mine") : undefined,
          label: owner || "Netral",
        }];
      }),
      onError: () => {
        mapFailed = true;
        destroyClaimMap();
        render();
      },
    };
  }

  function selectLandmark(id: string) {
    if (busy) return;
    if (id.startsWith("rival:")) {
      selectedRivalPinSeatId = id.slice(6);
      folded = false;
      render();
      return;
    }
    selectedRivalPinSeatId = "";
    selectedId = id;
    folded = false;
    if (panel !== "cards" || !selectedCardId) panel = "challenge";
    if (inlineError?.slot === "landmark-checkin" && inlineError.targetId !== id) {
      inlineError = null;
    }
    render();
  }

  async function syncClaimMapOverlay(host: HTMLElement, payload: ClaimRoomPayload) {
    if (claimMapHandle && claimMapRoomCode === payload.room.code) {
      claimMapHandle.update(buildClaimMapState(payload));
      return;
    }
    if (!claimMapHandle && claimMapRoomCode === payload.room.code && host.isConnected) {
      return;
    }
    const reqId = ++claimMapReq;
    claimMapHandle?.destroy();
    claimMapHandle = undefined;
    claimMapRoomCode = payload.room.code;
    try {
      const [{ mountBoardMap }, mapCfg] = await Promise.all([
        import("./board-map"),
        fetchMapConfig(lifetime.signal),
      ]);
      if (reqId !== claimMapReq || !host.isConnected || !live || live.room.code !== payload.room.code) {
        if (reqId === claimMapReq) claimMapRoomCode = "";
        return;
      }
      const handle = mountBoardMap({
        container: host,
        config: mapCfg,
        ...buildClaimMapState(live),
      });
      if (reqId !== claimMapReq) handle.destroy();
      else claimMapHandle = handle;
    } catch {
      if (reqId !== claimMapReq) return;
      mapFailed = true;
      destroyClaimMap();
      render();
    }
  }

  function renderCatalog(): string {
    return `<section class="rb-shell" aria-label="Katalog Claim the City">
      <div class="rb-card">
        <h2>Claim the City (1–6 Pemain)</h2>
        <p>Rebut wilayah lewat Klaim, Kunci, dan Rebut landmark. Selesaikan tantangan di lokasi dan pakai kartu untuk balik keadaan.</p>
        <div class="rb-actions">
          <button type="button" class="secondary" data-nav="studio">Buka Studio Kreator</button>
          <button type="button" class="secondary" data-nav="back">Kembali ke Katalog</button>
        </div>
        ${statusMsg ? `<p role="status">${escapeText(statusMsg)}</p>` : ""}
        ${slotAlert("catalog")}
      </div>

      <div class="rb-card">
        <h3>Gabung Ruang dengan Kode Undangan</h3>
        <div class="rb-grid-2">
          <label class="rb-field"><span>Kode Ruang</span><input id="rb-claim-join-code" placeholder="RC-XXXXXX" value="${escapeText(joinCode)}"></label>
          <label class="rb-field"><span>Nama Pemain</span><input id="rb-claim-join-name" value="${escapeText(joinName)}"></label>
        </div>
        ${slotAlert("join")}
        <div class="rb-actions">
          <button type="button" class="primary" data-action="join-room" ${busy ? "disabled" : ""}>Gabung Ruang</button>
        </div>
      </div>

      ${listings
        .map((item) => {
          const owned = item.priceIdr > 0 && ownedPackIds.includes(item.packId);
          const ent = owned ? entitlements.find((e) => e.packId === item.packId) : undefined;
          return `<article class="rb-card" data-pack-id="${escapeText(item.packId)}">
            <div class="rb-badges">
              ${owned ? '<span class="rb-badge rb-badge-owned" data-testid="owned-badge"><span aria-hidden="true">✓</span> Dimiliki</span>' : `<span class="rb-badge ${item.priceIdr > 0 ? "rb-badge-paid" : ""}">${escapeText(idr(item.priceIdr))}</span>`}
              <span class="rb-badge">${escapeText(item.cityLabel)}</span>
              <span class="rb-badge">${item.minPlayers}–${item.maxPlayers} pemain (${item.teamMode === "teams" ? "Tim" : "Individu"})</span>
              <span class="rb-badge">${item.zones.length} zona · ${item.landmarkCount} landmark</span>
              <span class="rb-badge">${item.durationMinutes} menit</span>
            </div>
            <h3>${escapeText(item.title)} <small>v${item.version}</small></h3>
            <p>${escapeText(item.summary)}</p>
            <p><small>Oleh ${escapeText(item.byline)} · Mulai: ${escapeText(item.startName)}${item.soloTargets ? ` · Target Solo: ${item.soloTargets.lockedLandmarks} kunci di ${item.soloTargets.distinctZones} zona` : ""}</small></p>
            <p><small>Dek Kartu: ${item.tacticalDeckSummary.enabled ? `${item.tacticalDeckSummary.totalCards} kartu (maks. ${item.tacticalDeckSummary.maxHandSize} di tangan)` : "Nonaktif"} · Tantangan: ${escapeText(item.challengePrimitives.map(claimPrimitiveLabel).join(", "))}</small></p>
            <div class="rb-badges">
              ${item.zones.map((z) => `<span class="rb-badge">${escapeText(z.label)} · ${escapeText(z.name)} (${z.landmarkCount})</span>`).join("")}
            </div>
            <div class="rb-actions">
              ${
                item.priceIdr === 0
                  ? `<button type="button" class="primary" data-action="start-free" data-pack="${escapeText(item.packId)}" data-version="${item.version}" ${busy ? "disabled" : ""}>Buat Ruang Gratis</button>`
                  : owned
                    ? ent?.activeRoomCode
                      ? `<button type="button" class="primary" data-action="resume-owned" data-room="${escapeText(ent.activeRoomCode)}" ${busy ? "disabled" : ""}>Lanjutkan Ruang (${escapeText(ent.activeRoomCode)})</button>`
                      : `<button type="button" class="primary" data-action="start-owned" data-pack="${escapeText(item.packId)}" data-version="${item.version}" ${busy ? "disabled" : ""}>Buat Ruang (Dimiliki)</button>`
                    : allowSandboxCheckout
                      ? `<button type="button" class="primary" data-action="buy-pack" data-pack="${escapeText(item.packId)}" data-version="${item.version}" ${busy ? "disabled" : ""}>Beli Paket (${escapeText(idr(item.priceIdr))} · Uji Pembayaran)</button>`
                      : "<p>Edisi berbayar belum tersedia pada uji publik ini.</p>"
              }
            </div>
          </article>`;
        })
        .join("")}

      ${
        activeOrderId
          ? `<div class="rb-card">
              <h3>Pembayaran Uji Midtrans</h3>
              <p>Order <code>${escapeText(activeOrderId)}</code> menunggu verifikasi pelunasan.</p>
              <button type="button" class="primary" data-action="settle-order" data-order="${escapeText(activeOrderId)}" ${busy ? "disabled" : ""}>Simulasikan Pelunasan Midtrans</button>
            </div>`
          : ""
      }
    </section>`;
  }

  function renderActiveAttempt(attempt: ClaimActiveAttemptView, room: ClaimEngineRoomView): string {
    const payload = attempt.challenge.payload;
    const leaf = getActiveLeaf(attempt);
    const swapCard = room.ownHand.find((c) => c.effect.primitive === "swap_challenge");
    const lmName = live?.publicBoard.landmarks.find((l) => l.id === attempt.landmarkId)?.name ?? attempt.landmarkId;

    return `<div class="rb-card" data-testid="active-challenge-modal">
      <div class="rb-badges">
        <span class="rb-badge">${attempt.isStealAttempt ? "⚡ Upaya Rebut & Kunci" : "🔓 Tantangan Kunci Landmark"}</span>
        <span class="rb-badge">${escapeText(claimPrimitiveLabel(payload.primitive))}</span>
        ${payload.primitive === "multi_step" ? `<span class="rb-badge">Langkah ${attempt.currentStep + 1}/2</span>` : ""}
      </div>
      <h3>${escapeText(attempt.challenge.title)} · ${escapeText(lmName)}</h3>
      ${attempt.hint ? `<details class="rb-accordion" data-claim-hint><summary>Petunjuk lokasi</summary><p>${escapeText(attempt.hint)}</p></details>` : ""}

      ${
        payload.primitive === "call_your_shot" && !payload.chosenTier
          ? `<p>Tema: <strong>${escapeText(payload.theme)}</strong>. Pilih tingkat tantangan:</p>
             <div class="rb-actions">
               <button type="button" class="secondary" data-action="choose-shot-tier" data-landmark="${escapeText(attempt.landmarkId)}" data-tier="standard">Standar</button>
               <button type="button" class="primary" data-action="choose-shot-tier" data-landmark="${escapeText(attempt.landmarkId)}" data-tier="bold">Ekstra (+1 Kartu)</button>
             </div>`
          : leaf
            ? renderLeafChallenge(leaf, attempt, room)
            : ""
      }

      <div class="rb-actions">
        ${
          swapCard
            ? `<button type="button" class="secondary" data-action="play-card" data-instance="${escapeText(swapCard.instanceId)}" data-primitive="swap_challenge" data-landmark="${escapeText(attempt.landmarkId)}">Ganti Tantangan</button>`
            : ""
        }
        <button type="button" class="secondary" data-action="bail-challenge" data-landmark="${escapeText(attempt.landmarkId)}">Menyerah (${room.isSolo ? "Hanguskan Landmark" : "Buka untuk Direbut"})</button>
      </div>
    </div>`;
  }

  function renderLeafChallenge(
    leaf: ClaimSanitizedLeafChallenge,
    attempt: ClaimActiveAttemptView,
    room: ClaimEngineRoomView,
  ): string {
    if (leaf.primitive === "observation_mcq") {
      return `<p>${escapeText(leaf.prompt)}</p>
        <div class="rb-list" role="radiogroup" aria-label="Pilihan jawaban">
          ${leaf.choices
            .map(
              (c, idx) => `<label><input type="radio" name="claim-mcq" value="${escapeText(c.id)}" ${idx === 0 ? "checked" : ""}> ${escapeText(c.label)}</label>`,
            )
            .join("")}
        </div>
        ${slotAlert("challenge-input", attempt.landmarkId)}
        <div class="rb-actions">
          <button type="button" class="primary" data-action="submit-mcq" data-landmark="${escapeText(attempt.landmarkId)}">Kirim Jawaban</button>
        </div>`;
    }
    if (leaf.primitive === "observation_input") {
      return `<p>${escapeText(leaf.prompt)}</p>
        <label class="rb-field">
          <span>Jawaban (${leaf.inputMode === "number" ? "Angka" : "Teks"})</span>
          <input id="claim-input-answer" inputmode="${leaf.inputMode === "number" ? "numeric" : "text"}" placeholder="Ketik jawaban pengamatan">
        </label>
        ${slotAlert("challenge-input", attempt.landmarkId)}
        <div class="rb-actions">
          <button type="button" class="primary" data-action="submit-input" data-landmark="${escapeText(attempt.landmarkId)}">Kirim Jawaban</button>
        </div>`;
    }
    if (leaf.primitive === "photo_proof") {
      const autoSec = attempt.pendingPhoto
        ? Math.max(0, Math.ceil((attempt.pendingPhoto.autoApproveAt - room.now) / 1000))
        : Math.round(leaf.autoApproveMs / 1000);
      const isUploading = uploadingPhotoTarget === attempt.landmarkId;
      return `<p>${escapeText(leaf.prompt)}</p>
        ${
          attempt.pendingPhoto
            ? `<p role="status">Foto bukti terkirim · Disetujui otomatis dalam <strong data-cg-countdown="${attempt.pendingPhoto.autoApproveAt}">${clockLabel(autoSec * 1000)}</strong>.</p>`
            : `${photoPicker(attempt.landmarkId)}${slotAlert("challenge-photo", attempt.landmarkId)}<div class="rb-actions">
                <button type="button" class="primary" data-action="submit-photo" data-landmark="${escapeText(attempt.landmarkId)}">${isUploading ? "Mengunggah…" : "Unggah Foto Bukti"}</button>
              </div>`
        }`;
    }
    const remainingSec = attempt.timedDeadline
      ? Math.max(0, Math.ceil((attempt.timedDeadline - room.now) / 1000))
      : Math.round(leaf.timeLimitMs / 1000);
    return `<p>${escapeText(leaf.prompt)}</p>
      <p><span class="rb-badge rb-badge-warn">Batas waktu · <strong ${attempt.timedDeadline ? `data-cg-countdown="${attempt.timedDeadline}"` : ""}>${clockLabel(remainingSec * 1000)}</strong></span></p>
      ${
        attempt.timedStartedAt === null
          ? `<button type="button" class="primary" data-action="start-timed" data-landmark="${escapeText(attempt.landmarkId)}">Mulai Timer Tugas</button>`
          : leaf.taskType === "sub_point_gps"
            ? `${slotAlert("challenge-gps", attempt.landmarkId)}<button type="button" class="primary" data-action="submit-timed-gps" data-landmark="${escapeText(attempt.landmarkId)}" data-lat="${leaf.subPoint?.latitude ?? 0}" data-lng="${leaf.subPoint?.longitude ?? 0}">Check-in Sub-Titik (${escapeText(leaf.subPoint?.label ?? "Target")})</button>`
            : leaf.taskType === "photo_proof"
              ? `${photoPicker(attempt.landmarkId)}${slotAlert("challenge-photo", attempt.landmarkId)}<button type="button" class="primary" data-action="submit-photo" data-landmark="${escapeText(attempt.landmarkId)}">${uploadingPhotoTarget === attempt.landmarkId ? "Mengunggah…" : "Kirim Foto"}</button>`
              : `<label class="rb-field"><span>Jawaban Cepat</span><input id="claim-input-answer"></label>
                 ${slotAlert("challenge-input", attempt.landmarkId)}
                 <button type="button" class="primary" data-action="submit-input" data-landmark="${escapeText(attempt.landmarkId)}">Kirim Jawaban Cepat</button>`
      }`;
  }

  function renderClaimAlerts(payload: ClaimRoomPayload): string {
    const { room, publicBoard } = payload;
    if (room.phase !== "active") return "";
    const lmMetaById = new Map(publicBoard.landmarks.map(lm => [lm.id, lm]));
    const open = room.landmarks.filter(lm => lm.status === "claimed" && lm.vulnerableAlertAt !== null && lm.ownerTeamId !== room.teamId);
    return `${open.length ? `<div class="cg-notice" data-testid="open-to-steal-alert">
      <strong>Terbuka untuk direbut!</strong>
      <p>${open.map(lm => escapeText(lmMetaById.get(lm.landmarkId)?.name ?? lm.landmarkId)).join(", ")}</p>
    </div>` : ""}
      ${
        room.pendingRivalPhotoReviews.length > 0
          ? `<div class="rb-card">
              <h3>Tinjauan Foto Tantangan Lawan (${room.pendingRivalPhotoReviews.length})</h3>
              <ul class="rb-list">
                ${room.pendingRivalPhotoReviews
                  .map((rev) => {
                    return `<li>
                      <strong>${escapeText(lmMetaById.get(rev.landmarkId)?.name ?? rev.landmarkId)}</strong>
                      <small>Disetujui otomatis dalam <span data-cg-countdown="${rev.autoApproveAt}">${clockLabel(rev.autoApproveAt - room.now)}</span></small>
                      ${renderPhoto(room.code, rev.photoId)}
                      <div class="rb-actions">
                        <button type="button" class="primary" data-action="review-rival-photo" data-seat="${escapeText(rev.attemptOwnerSeatId)}" data-landmark="${escapeText(rev.landmarkId)}" data-approve="true">Setujui Foto</button>
                        <button type="button" class="secondary" data-action="review-rival-photo" data-seat="${escapeText(rev.attemptOwnerSeatId)}" data-landmark="${escapeText(rev.landmarkId)}" data-approve="false">Tolak Foto</button>
                      </div>
                    </li>`;
                  })
                  .join("")}
              </ul>
            </div>`
          : ""
      }

      ${
        room.activeCurses.length > 0
          ? `<div class="rb-card">
              <h3>Kutukan Aktif (${room.activeCurses.length})</h3>
              <ul class="rb-list">
                ${room.activeCurses
                  .map((c) => {
                    const isTarget = c.targetSeatId === room.seatId;
                    const isCaster = c.casterSeatId === room.seatId;
                    const clear = c.clearCondition;
                    return `<li>
                      <span class="rb-badge rb-badge-danger">${escapeText(c.title)}</span>
                      <p>${escapeText(c.description)}</p>
                      ${clear.type === "gps_detour" ? `<small>Check-in dalam radius ${clear.radiusMeters} m dari lokasi kategori ${escapeText(clear.poiCategory)}.</small>` : ""}
                      ${clear.type === "honor_task" ? `<small>${escapeText(clear.instruction)}</small>` : ""}
                      ${clear.type === "photo_challenge" ? `<small>${escapeText(clear.prompt)}</small>` : ""}
                      ${c.expiresAt ? `<small>Berakhir dalam <span data-cg-countdown="${c.expiresAt}">${clockLabel(c.expiresAt - room.now)}</span></small>` : ""}
                      ${isTarget && c.clearCondition.type === "photo_challenge" && !c.pendingPhoto ? photoPicker(c.curseInstanceId) : ""}
                      ${isCaster && c.pendingPhoto ? renderPhoto(room.code, c.pendingPhoto.photoId) : ""}
                      ${slotAlert("curse-action", c.curseInstanceId)}
                      <div class="rb-actions">
                        ${isTarget && c.clearCondition.type === "gps_detour" ? `<button type="button" class="primary" data-action="clear-curse-gps" data-curse="${escapeText(c.curseInstanceId)}">Check-in Lokasi</button>` : ""}
                        ${isTarget && c.clearCondition.type === "photo_challenge" && !c.pendingPhoto ? `<button type="button" class="primary" data-action="submit-curse-photo" data-curse="${escapeText(c.curseInstanceId)}">${uploadingPhotoTarget === c.curseInstanceId ? "Mengunggah…" : "Kirim Foto Bukti"}</button>` : ""}
                        ${isTarget && c.clearCondition.type === "honor_task" ? `<button type="button" class="primary" data-action="clear-curse-honor" data-curse="${escapeText(c.curseInstanceId)}">Selesaikan Tugas</button>` : ""}
                        ${isCaster && c.pendingPhoto ? `<button type="button" class="primary" data-action="review-curse-photo" data-curse="${escapeText(c.curseInstanceId)}" data-approve="true">Setujui Foto</button>` : ""}
                        ${isCaster && c.pendingPhoto ? `<button type="button" class="secondary" data-action="review-curse-photo" data-curse="${escapeText(c.curseInstanceId)}" data-approve="false">Tolak Foto</button>` : ""}
                      </div>
                    </li>`;
                  })
                  .join("")}
              </ul>
            </div>`
          : ""
      }

`;
  }

  function renderPhoto(code: string, id: string): string {
    return `<img class="cg-proof" alt="Foto bukti untuk ditinjau" src="/api/rulebooks/rooms/${encodeURIComponent(code)}/photos/${encodeURIComponent(id)}">`;
  }

  function nextFreshTeamId(seats: ClaimEngineRoomView["seats"]): string {
    const used = new Set(seats.map((s) => s.teamId));
    for (let i = 1; i <= seats.length + 20; i++) {
      const candidate = `team-${i}`;
      if (!used.has(candidate)) return candidate;
    }
    return `team-${Date.now()}`;
  }

  function orderedTeamIds(seats: ClaimEngineRoomView["seats"]): string[] {
    const ids: string[] = [];
    for (const s of seats) {
      if (!ids.includes(s.teamId)) ids.push(s.teamId);
    }
    return ids;
  }

  function destructiveExitSpec(payload: ClaimRoomPayload): {
    label: string;
    title: string;
    body: string;
    toastText: string;
  } | null {
    const { room, pass } = payload;
    if (room.outcome) return null;
    const own = room.seats.find((s) => s.seatId === room.seatId);
    if (!own || own.leftAt != null) return null;
    if (room.phase === "lobby") {
      if (own.isHost) {
        return {
          label: "Batalkan Ruang",
          title: "Batalkan ruang ini?",
          body: pass.paid
            ? "Semua pemain akan keluar dari lobi, dan slot ruang aktif paket berbayarmu langsung terbuka kembali."
            : "Semua pemain yang sudah bergabung akan keluar dari lobi ini.",
          toastText: "Ruang dibatalkan.",
        };
      }
      return {
        label: "Tinggalkan Lobi",
        title: "Tinggalkan lobi?",
        body: "Kursimu di lobi akan dilepas. Kamu tetap bisa gabung lagi selama Host belum memulai permainan.",
        toastText: "Kamu meninggalkan lobi.",
      };
    }
    if (room.phase === "active") {
      if (room.isSolo) {
        return {
          label: "Akhiri Permainan",
          title: "Akhiri permainan solo?",
          body: "Ronde solo ini akan berakhir sebagai ditinggalkan dan tidak bisa dilanjutkan lagi.",
          toastText: "Permainan solo diakhiri.",
        };
      }
      return {
        label: "Menyerah & Keluar",
        title: "Menyerah dan keluar dari pertandingan?",
        body: "Kamu akan keluar dari pertandingan aktif. Jika tinggal 1 tim aktif, pertandingan langsung selesai; jika masih ada minimal 2 tim aktif, pemain lain tetap melanjutkan.",
        toastText: "Kamu keluar dari pertandingan.",
      };
    }
    return null;
  }

  function renderLobby(payload: ClaimRoomPayload): string {
    const { room, pass, publicBoard } = payload;
    const invite = `${location.origin}/?play=rulebook-claim&room=${encodeURIComponent(room.code)}`;
    const isGroupLobby = pass.mode !== "solo" && pass.maxPlayers > 1;
    const enoughPlayers = !pass.minPlayers || room.seats.length >= pass.minPlayers;
    const ownSeat = room.seats.find((seat) => seat.seatId === room.seatId);
    const isHost = Boolean(ownSeat?.isHost);
    const teams = orderedTeamIds(room.seats);
    const enoughTeams = !isGroupLobby || (pass.mode === undefined && room.seats.length <= 1) || teams.length >= 2;
    const ownTeamMembers = ownSeat ? room.seats.filter((s) => s.teamId === ownSeat.teamId).length : 0;
    const exitSpec = destructiveExitSpec(payload);
    const startCard = renderStartPointCard({
      startPoint: publicBoard.startPoint,
      fix: selfFix,
      checkInRadiusMeters: publicBoard.checkInRadiusMeters,
      maxGpsAccuracyMeters: publicBoard.maxGpsAccuracyMeters,
      status: liveLocationStatus,
      mapExpanded: startMapExpanded,
      mapHostId: "cg-start-minimap",
    });

    return `<section class="rb-shell" aria-label="Ruang Claim the City">
      <div class="rb-card">
        <div class="rb-actions cg-lobby-head">
          <div>
            <div class="rb-badges">
              <span class="rb-badge">Kode: ${escapeText(room.code)}</span>
              <span class="rb-badge">${phaseLabels[room.phase]}</span>
              ${pass.mode ? `<span class="rb-badge">${pass.mode === "solo" ? "Solo" : "Grup"}</span>` : ""}
              ${pass.paid ? '<span class="rb-badge rb-badge-paid">Pass Berbayar</span>' : ""}
            </div>
            <h2>${escapeText(room.packMeta.title)}</h2>
          </div>
          <div class="qg-header-tools">
            <button type="button" class="qg-trigger-btn" data-action="open-quick-guide" data-testid="lobby-quick-guide-btn">? Panduan</button>
            ${renderMore()}
          </div>
        </div>
        ${statusMsg ? `<p role="status">${escapeText(statusMsg)}</p>` : ""}
        ${slotAlert("lobby")}
        ${renderPhaseCueStrip("claim-lobby", isGroupLobby ? "Atur tim di bawah sebelum mulai." : undefined)}
        ${renderClaimDraftBar(payload)}
        ${renderOutdoorReadinessStrip({ fix: selfFix, status: liveLocationStatus })}
        ${startCard.html}
        ${isGroupLobby ? renderLobbyInviteCard({ roomCode: room.code, inviteUrl: invite, copiedCode, copiedLink }) : ""}
        <h3>Kursi Pemain (${room.seats.length}/${pass.maxPlayers})</h3>
        <ul class="rb-list">
          ${room.seats.map((seat) => {
            const isSelf = seat.seatId === room.seatId;
            const tIdx = Math.max(0, teams.indexOf(seat.teamId));
            const vis = teamVisual(tIdx);
            return `<li data-seat-row="${escapeText(seat.seatId)}">
              <div class="lobby-seat-row">
                <div class="lobby-seat-main">
                  ${isGroupLobby ? `<span class="lobby-team-badge" style="--team-accent:${vis.accent}"><span aria-hidden="true">${vis.shape}</span> ${vis.label}</span>` : ""}
                  <strong>${escapeText(seat.name)}</strong>${seat.isHost ? " · Host" : ""}${isSelf ? " · Kamu" : ""} · ${seat.ready ? "Siap" : "Belum siap"}
                </div>
                <div class="lobby-seat-controls">
                  ${isSelf && !editingName ? `<button type="button" class="secondary lobby-icon-btn" data-action="edit-name" data-testid="edit-own-name" aria-label="Ubah nama pemain">✎</button>` : ""}
                  ${isHost && isGroupLobby ? `<select class="lobby-seat-select" data-reassign-seat="${escapeText(seat.seatId)}" aria-label="Pindah tim ${escapeText(seat.name)}">
                    ${teams.map((tid, idx) => {
                      const tv = teamVisual(idx);
                      return `<option value="${escapeText(tid)}" ${seat.teamId === tid ? "selected" : ""}>${tv.shape} ${tv.label}</option>`;
                    }).join("")}
                    <option value="__new__">+ Tim Baru</option>
                  </select>` : ""}
                </div>
              </div>
              ${isSelf && editingName ? `<div class="lobby-rename-form">
                <input id="cg-rename-input" type="text" maxlength="32" value="${escapeText(renameDraft)}" placeholder="Nama pemain" aria-label="Nama pemain baru">
                <button type="button" class="primary" data-action="save-name" data-testid="save-own-name">Simpan</button>
                <button type="button" class="secondary" data-action="cancel-name">Batal</button>
              </div>` : ""}
            </li>`;
          }).join("")}
        </ul>
        ${isGroupLobby ? `<section class="lobby-team-section" aria-label="Susunan Tim" data-testid="claim-team-switcher">
          <div class="lobby-team-head">
            <h4>Susunan Tim (${teams.length} tim)</h4>
            <button type="button" class="secondary" data-action="new-team" data-testid="new-team-btn" ${busy || ownTeamMembers <= 1 ? "disabled" : ""}>+ Tim Baru</button>
          </div>
          <div class="lobby-team-grid">
            ${teams.map((tid, idx) => {
              const vis = teamVisual(idx);
              const members = room.seats.filter((s) => s.teamId === tid);
              const isOwnTeam = ownSeat?.teamId === tid;
              return `<div class="lobby-team-card" data-team-card="${escapeText(tid)}" style="--team-accent:${vis.accent};--team-bg:${vis.bg};--team-border:${vis.border}">
                <div class="lobby-team-top">
                  <span class="lobby-team-badge"><span aria-hidden="true">${vis.shape}</span> ${vis.label} (${members.length})</span>
                  ${isOwnTeam
                    ? `<span class="rb-badge">Tim Kamu</span>`
                    : `<button type="button" class="secondary" data-action="join-team" data-team="${escapeText(tid)}" ${busy ? "disabled" : ""}>Gabung ${vis.label}</button>`}
                </div>
                <div class="lobby-team-members">
                  ${members.map((m) => `<span class="lobby-member-pill">${escapeText(m.name)}${m.isHost ? " ★" : ""}</span>`).join("")}
                </div>
              </div>`;
            }).join("")}
          </div>
        </section>` : ""}
        ${pass.mode !== "solo" ? '<p class="cg-presence-notice">Lokasi dibagikan ke pemain di ruang selama ronde aktif.</p>' : ""}
        ${slotAlert("lobby-checkin")}
        <div class="rb-actions">
          <button type="button" class="secondary${startCard.proximity.state === "ready" ? " loc-btn-ready" : ""}" data-action="sim-start-checkin">${demoLocation || isQaRoom(payload) ? "Simulasikan Check-in Titik Awal" : "Check-in Titik Awal"}</button>
          ${ownSeat?.ready
            ? `<button type="button" class="secondary" data-action="unmark-ready">Batal Siap</button>`
            : `<button type="button" class="primary" data-action="mark-ready">Tandai Siap</button>`}
          ${isHost
            ? `<button type="button" class="primary" data-action="start-match" ${enoughPlayers && enoughTeams ? "" : "disabled"}>Mulai Permainan</button>`
            : `<span class="lobby-wait-pill" role="status">Menunggu Host memulai…</span>`}
        </div>
        ${!enoughPlayers ? `<p>Undang pemain hingga ruang berisi setidaknya ${pass.minPlayers} pemain.</p>` : ""}
        ${enoughPlayers && !enoughTeams ? `<p role="status" data-testid="not-enough-teams-hint">Minimal 2 tim berbeda untuk memulai.</p>` : ""}
        ${exitSpec ? `<div class="lobby-footer-exit">
          <button type="button" class="secondary lobby-danger-btn" data-action="confirm-leave" data-testid="lobby-leave-btn">${escapeText(exitSpec.label)}</button>
        </div>` : ""}
      </div>
    </section>`;
  }

  function renderMoreMenuItems(): string {
    const exitSpec = live ? destructiveExitSpec(live) : null;
    const backStudio = live && isDraftPlaytest(live)
      ? `<a class="cg-menu-link" data-testid="menu-back-to-studio" href="${draftStudioUrl(live.pass)}">← Kembali ke Studio</a>`
      : "";
    return `${backStudio}<button type="button" data-action="open-quick-guide" data-testid="menu-quick-guide-btn">? Panduan</button>
        <button type="button" data-action="panel" data-panel="activity">Aktivitas terbaru</button>
        ${wakeLockSupported ? `<button type="button" data-action="toggle-wakelock" aria-pressed="${wakeLockWanted}">Layar tetap menyala: ${wakeLockWanted ? "Aktif" : "Nonaktif"}</button>` : ""}
        <button type="button" data-action="refresh">Muat Ulang Ruang</button>
        <button type="button" data-nav="catalog">Kembali ke Katalog</button>
        ${exitSpec ? `<button type="button" class="lobby-danger-btn" data-action="confirm-leave" data-testid="menu-leave-btn">${escapeText(exitSpec.label)}</button>` : ""}`;
  }

  function renderMore(): string {
    return `<details class="sg-room-menu">
      <summary class="sg-quiet" aria-label="Lainnya">⋯</summary>
      <div class="sg-room-menu-actions">
        ${renderMoreMenuItems()}
      </div>
    </details>`;
  }

  function renderLandmarkList(payload: ClaimRoomPayload, targets: string[] = [], listLabel = "Pilih Landmark"): string {
    const { room, publicBoard } = payload;
    const stateById = new Map(room.landmarks.map(item => [item.landmarkId, item]));
    const zoneLabelById = new Map(room.zones.map(z => [z.zoneId, z.label || z.name]));
    const distById = new Map<string, number>();
    if (selfFix) {
      for (const lm of publicBoard.landmarks) {
        distById.set(lm.id, Math.round(haversineMeters(selfFix, lm)));
      }
    }

    const renderRow = (lm: ClaimPublicBoard["landmarks"][number]) => {
      const state = stateById.get(lm.id);
      const dist = distById.get(lm.id);
      const zoneText = zoneLabelById.get(lm.zoneId) ?? lm.zoneId;
      return `<li data-landmark-list-item="${escapeText(lm.id)}">
        <button type="button" class="cg-landmark-row" data-action="select-landmark" data-landmark="${escapeText(lm.id)}" aria-pressed="${lm.id === selectedId}">
          <span class="cg-landmark-row-main">
            <strong>${escapeText(lm.name)}</strong>
            <small>${targets.includes(lm.id) ? "Target · " : ""}${escapeText(zoneText)}${state ? ` · ${landmarkStatus(state)}` : ""}</small>
          </span>
          ${dist !== undefined ? `<span class="cg-landmark-dist-pill" data-landmark-distance="${dist}">${formatDistanceShort(dist)}</span>` : ""}
        </button>
      </li>`;
    };

    const toolbar = `<div class="cg-landmark-toolbar">
      <h2>${escapeText(listLabel)}</h2>
      <div class="cg-sort-pills" role="group" aria-label="Urutkan landmark">
        <button type="button" data-action="sort-landmarks" data-sort="zone" data-testid="claim-sort-zone" aria-pressed="${landmarkSort === "zone"}">Zona</button>
        <button type="button" data-action="sort-landmarks" data-sort="nearest" data-testid="claim-sort-nearest" aria-pressed="${landmarkSort === "nearest"}">Terdekat</button>
      </div>
    </div>`;

    if (landmarkSort === "nearest") {
      const sorted = [...publicBoard.landmarks].sort((a, b) => {
        const da = distById.get(a.id);
        const db = distById.get(b.id);
        if (da !== undefined && db !== undefined && da !== db) return da - db;
        return 0;
      });
      return `${toolbar}
        ${!selfFix && liveLocationStatus !== "unavailable" ? `<div class="cg-selected-meta-actions">
          ${liveLocationStatus === "requesting" || liveLocationStatus === "watching"
            ? `<span class="loc-meter loc-meter--pending" role="status">◎ Mencari posisi GPS…</span>`
            : `<button type="button" class="loc-enable-chip" data-loc-action="enable-live-location" data-testid="enable-live-location-btn">◎ Aktifkan Lokasi untuk urutkan Terdekat</button>`}
        </div>` : ""}
        <ul class="cg-landmark-drawer-list" aria-label="${escapeText(listLabel)}" data-testid="claim-landmark-list" data-sort-mode="nearest">
          ${sorted.map(renderRow).join("")}
        </ul>`;
    }

    const groupedItems = room.zones.flatMap(zone => {
      const items = publicBoard.landmarks.filter(lm => lm.zoneId === zone.zoneId);
      if (items.length === 0) return [];
      return [
        `<li class="cg-landmark-group-title" role="presentation">${escapeText(zone.name || zone.label)}</li>`,
        ...items.map(renderRow),
      ];
    }).join("");

    return `${toolbar}
      <ul class="cg-landmark-drawer-list" aria-label="${escapeText(listLabel)}" data-testid="claim-landmark-list" data-sort-mode="zone">${groupedItems}</ul>`;
  }

  function renderLandmark(payload: ClaimRoomPayload): string {
    const { room, publicBoard } = payload;
    const meta = publicBoard.landmarks.find(lm => lm.id === selectedId);
    const lm = room.landmarks.find(lm => lm.landmarkId === selectedId);
    if (!lm || !meta) {
      if (mapFailed) {
        return `<div class="cg-section-title"><h2>Tantangan</h2></div>
          <p>Pilih landmark di daftar untuk melihat status dan check-in.</p>`;
      }
      return renderLandmarkList(payload);
    }
    const escapedId = escapeText(lm.landmarkId);
    const rival = lm.ownerTeamId && lm.ownerTeamId !== room.teamId;
    const shielded = lm.shieldUntil !== null && lm.shieldUntil > room.now;
    const burned = room.ownBurnedLandmarks.includes(lm.landmarkId);
    const cooldown = room.ownCooldowns[lm.landmarkId] ?? 0;
    const scouted = room.scoutedChallenges[lm.landmarkId];
    let blocked = "";
    if (room.ownActiveAttempt) blocked = "Selesaikan tantangan aktif untuk check-in di sini.";
    else if (burned) blocked = "Landmark ini hangus untuk permainanmu.";
    else if (cooldown > room.now) blocked = `Coba lagi dalam <strong data-cg-countdown="${cooldown}">${clockLabel(cooldown - room.now)}</strong>.`;
    else if (rival && shielded) blocked = `Perisai lawan aktif selama <strong data-cg-countdown="${lm.shieldUntil}">${clockLabel(lm.shieldUntil! - room.now)}</strong>.`;
    const canAttempt = room.phase === "active" && lm.status !== "locked";
    const hand = room.ownChallengeHand;
    const meter = renderDistanceMeter({
      fix: selfFix,
      target: meta,
      checkInRadiusMeters: publicBoard.checkInRadiusMeters,
      maxGpsAccuracyMeters: publicBoard.maxGpsAccuracyMeters,
      status: liveLocationStatus,
      testId: "claim-landmark-distance-meter",
      showEnableChip: true,
    });
    return `<div class="cg-selected" data-landmark-id="${escapedId}">
      <div class="cg-section-title">
        <div class="rb-badges">
          <span class="rb-badge">${escapeText(room.zones.find(zone => zone.zoneId === lm.zoneId)?.label ?? lm.zoneId)}</span>
          <span class="rb-badge">${landmarkStatus(lm)}</span>
          ${lm.ownerTeamId ? `<span class="rb-badge">${escapeText(teamName(room, lm.ownerTeamId))}</span>` : ""}
          ${shielded ? '<span class="rb-badge rb-badge-warn">Perisai aktif</span>' : ""}
          ${lm.doubleWeighted ? '<span class="rb-badge rb-badge-paid">2× Bobot</span>' : ""}
        </div>
        <button type="button" class="sg-quiet" data-action="clear-selected-landmark" data-testid="claim-back-to-list">← Daftar</button>
      </div>
      <h2>${escapeText(meta.name)}</h2>
      ${room.ownLearningExplanation?.landmarkId === lm.landmarkId ? learningExplanation(room.ownLearningExplanation.text) : ""}
      ${meta.transitSummary ? `<p>${escapeText(meta.transitSummary)}</p>` : ""}
      ${meta.accessNotes ? `<small>${escapeText(meta.accessNotes)}</small>` : ""}
      <div class="cg-selected-meta-actions">
        ${meter.html}
        ${renderDirectionsLink(meta, { testId: "claim-landmark-directions" })}
      </div>
      ${scouted ? `<p>Hasil Intai · <strong>${escapeText(scouted.title)}</strong></p>` : ""}
      ${canAttempt && blocked ? `<p>${blocked}</p>` : ""}
      ${canAttempt && !blocked && hand?.length ? `<label class="rb-field"><span>Pilih tantangan</span><select data-claim-hand>
        ${hand.map(challenge => `<option value="${escapeText(challenge.id)}" ${challengeHandId === challenge.id ? "selected" : ""}>${escapeText(challenge.title)}</option>`).join("")}
      </select></label>` : ""}
      ${canAttempt && !blocked && hand?.length === 0 ? "<p>Belum ada kartu tantangan yang dapat digunakan.</p>" : ""}
      ${slotAlert("landmark-checkin", lm.landmarkId)}
      ${canAttempt && !blocked && hand?.length !== 0 ? `<button type="button" class="sg-main${meter.proximity.state === "ready" ? " loc-btn-ready" : ""}" data-action="checkin-landmark" data-landmark="${escapedId}">${rival ? "Check-in &amp; Rebut Landmark" : "Check-in Landmark"}</button>` : ""}
    </div>`;
  }

  function renderCards(room: ClaimEngineRoomView): string {
    if (room.phase !== "active") return "<h2>Kartu</h2><p>Permainan sudah berakhir.</p>";
    const card = room.ownHand.find(item => item.instanceId === selectedCardId);
    if (!card) {
      return `<div class="cg-section-title"><h2>Kartu</h2><span class="rb-badge">${room.ownHand.length}</span></div>
        ${room.ownHand.length === 0 ? "<p>Kunci atau rebut landmark untuk menarik kartu.</p>" : `<div class="cg-card-stack">
          ${room.ownHand.map(item => {
            const [label, art] = cardLabels[item.effect.primitive];
            return `<button type="button" class="cg-tactic" data-action="select-card" data-instance="${escapeText(item.instanceId)}">
              <span class="cg-card-art sg-reward-art cg-art-${art}" aria-hidden="true"></span>
              <span class="cg-card-copy"><small>${label}</small><strong>${escapeText(item.title)}</strong></span>
            </button>`;
          }).join("")}
        </div>`}`;
    }
    const primitive = card.effect.primitive;
    const rivals = primitive === "sabotage_curse" ? room.seats.filter(seat => seat.teamId !== room.teamId) : [];
    const targets = cardTargets(room, card);
    const targetId = primitive === "swap_challenge" ? room.ownActiveAttempt?.landmarkId : selectedId;
    const chosen = Boolean(targetId && targets.includes(targetId));
    const chosenName = chosen ? live?.publicBoard.landmarks.find(lm => lm.id === targetId)?.name : "";
    const rivalChosen = rivals.some(seat => seat.seatId === selectedRivalId);
    return `<div class="cg-section-title">
      <h2>${escapeText(card.title)}</h2>
      <button type="button" class="sg-quiet" data-action="close-card">Semua kartu</button>
    </div>
    <p>${escapeText(card.description)}</p>
    ${rivals.length ? `<div class="sg-picks" aria-label="Pilih lawan">${rivals.map(seat => `
      <button type="button" class="sg-pick" data-action="select-rival" data-seat="${escapeText(seat.seatId)}"
        aria-pressed="${seat.seatId === selectedRivalId}">${escapeText(seat.name)}</button>`).join("")}</div>` : ""}
    ${chosenName ? `<p>Target <strong>${escapeText(chosenName)}</strong></p>` : ""}
    ${!chosen && !rivals.length ? `<p>${targets.length ? `Pilih pin yang disorot di ${mapFailed ? "daftar" : "peta"}.` : "Belum ada target yang memenuhi syarat."}</p>` : ""}
    <button type="button" class="sg-main" data-action="play-card" data-instance="${escapeText(card.instanceId)}"
      data-landmark="${escapeText(chosen && targetId ? targetId : "")}" data-seat="${escapeText(rivalChosen ? selectedRivalId : "")}"
      ${chosen || rivalChosen ? "" : "disabled"}>Mainkan Kartu</button>`;
  }

  function renderResult(room: ClaimEngineRoomView): string {
    if (!room.outcome) return "";
    const outcome = room.outcome;
    let title = "Seri!";
    if (outcome.reason === "abandoned" || outcome.reason === "canceled" || (outcome.reason === "forfeit" && !outcome.winnerTeamId)) {
      title = phaseLabels[room.phase];
    }
    else if (room.isSolo) title = outcome.soloWon ? "Menang Solo!" : "Sesi Solo Berakhir";
    else if (outcome.winnerTeamId) title = `Pemenang · ${teamName(room, outcome.winnerTeamId)}`;
    const decidingMetric = claimDecidingMetric(room.standings, outcome, room.isSolo);
    return `<div class="cg-result" data-testid="claim-outcome"><small>Hasil Akhir</small><h2>${escapeText(title)}</h2>
      <p>${claimResultReasons[outcome.reason]}${decidingMetric ? ` Penentu kemenangan · ${decidingMetric}.` : ""}</p></div>`;
  }

  function renderRivalCard(room: ClaimEngineRoomView): string {
    if (!selectedRivalPinSeatId || room.phase !== "active" || room.isSolo || room.outcome) return "";
    const pos = (room.seatPositions ?? []).find(p => p.seatId === selectedRivalPinSeatId);
    if (!pos) return "";
    const now = Date.now() + serverOffset;
    const bucket = freshnessBucket(pos.at, now);
    const zoneName = zoneLabelFor(room, pos.zoneId);
    const sourceText = pos.source === "checkin" ? "Check-in landmark" : "GPS langsung";
    const meta = [zoneName, sourceText].filter(Boolean).join(" · ");
    return `<div class="cg-rival-card" data-testid="claim-rival-card" data-rival-seat="${escapeText(pos.seatId)}">
      <div class="cg-rival-card-copy">
        <strong>▲ ${escapeText(pos.name)}</strong>
        <small>${meta ? `${escapeText(meta)} · ` : ""}<span data-cg-age-at="${pos.at}" data-cg-age-stale="1" data-freshness="${bucket}">${escapeText(formatRelativeAge(pos.at, now, true))}</span></small>
      </div>
      <button type="button" class="cg-rival-close" data-action="close-rival-card" aria-label="Tutup info pemain">×</button>
    </div>`;
  }

  function renderRivalPositionsList(room: ClaimEngineRoomView): string {
    if (room.isSolo || room.phase !== "active" || room.outcome || room.opponentTracking?.mode === "off") return "";
    const now = Date.now() + serverOffset;
    const posBySeat = new Map((room.seatPositions ?? []).map(p => [p.seatId, p]));
    const others = room.seats.filter(seat => seat.seatId !== room.seatId);
    if (others.length === 0) return "";
    return `<h3>Posisi Pemain</h3>
      <ul class="rb-list cg-players-list" aria-label="Posisi Pemain">${others.map(seat => {
        const pos = posBySeat.get(seat.seatId);
        if (!pos) {
          return `<li data-player-seat="${escapeText(seat.seatId)}"><span><strong>▲ ${escapeText(seat.name)}</strong> · Belum ada lokasi</span></li>`;
        }
        const bucket = freshnessBucket(pos.at, now);
        const zoneName = zoneLabelFor(room, pos.zoneId);
        const sourceTag = pos.source === "checkin" ? "Check-in" : "GPS";
        return `<li data-player-seat="${escapeText(seat.seatId)}" data-source="${escapeText(pos.source)}">
          <span><strong>▲ ${escapeText(seat.name)}</strong>${zoneName ? ` · ${escapeText(zoneName)}` : ""} · ${sourceTag}</span>
          <span class="cg-player-age" data-cg-age-at="${pos.at}" data-cg-age-stale="1" data-freshness="${bucket}">${escapeText(formatRelativeAge(pos.at, now, true))}</span>
        </li>`;
      }).join("")}</ul>`;
  }

  function renderScore(payload: ClaimRoomPayload): string {
    const { room, pass } = payload;
    const solo = room.soloProgress;
    const ownSeat = room.seats.find((s) => s.seatId === room.seatId);
    const canPlayAgain = !pass.paid || Boolean(ownSeat?.isHost) || ownedPackIds.includes(pass.packId);
    return `${renderResult(room)}
      ${room.outcome && room.ownLearningExplanation ? learningExplanation(room.ownLearningExplanation.text) : ""}
      ${room.outcome ? "" : "<h2>Skor Ronde</h2>"}
      ${solo ? `<div class="cg-score-grid" aria-label="Target Solo">
        <div><strong>${solo.lockedLandmarks}/${solo.targetLandmarks}</strong><small>Landmark terkunci</small></div>
        <div><strong>${solo.distinctZones}/${solo.targetZones}</strong><small>Zona berbeda</small></div>
      </div>` : `<ul class="rb-list cg-standings" aria-label="Papan Skor Zona">${room.standings.map(score => `<li>
        <strong>${escapeText(teamName(room, score.teamId))}${score.teamId === room.teamId ? " · Kamu" : ""}</strong>
        <small>${score.zonesControlled} zona · ${score.lockedLandmarks} terkunci · ${score.totalLandmarks} total landmark</small>
      </li>`).join("")}</ul>
      <p class="cg-rank-rule">Urutan skor · Zona dikuasai › Landmark terkunci › Total landmark</p>`}
      ${renderRivalPositionsList(room)}
      ${room.outcome ? renderPostMatchActions({
        roomCode: room.code,
        packId: pass.packId,
        version: pass.version,
        started: room.startedAt !== null,
        canPlayAgain,
        busy,
      }) : ""}`;
  }

  function learningExplanation(text: string): string {
    return `<aside class="rb-card" aria-label="Fakta lokasi"><strong>Fakta lokasi</strong><p>${escapeText(text)}</p></aside>`;
  }

  function renderFallback(payload: ClaimRoomPayload): string {
    const { room } = payload;
    const card = panel === "cards" && room.ownHand.find(item => item.instanceId === selectedCardId);
    const targets = card ? cardTargets(room, card) : [];
    return `<div class="cg-map-status">
      <p role="status">Peta tidak tersedia.</p>
      <button type="button" class="sg-quiet" data-action="retry-map">Coba Lagi</button>
    </div>
    ${renderLandmarkList(payload, targets, "Daftar Landmark")}
    ${renderRivalPositionsList(room)}`;
  }

  function updateClocks() {
    const now = Date.now() + serverOffset;
    for (const clock of root.querySelectorAll<HTMLElement>("[data-cg-countdown]")) {
      const label = clockLabel(Number(clock.dataset.cgCountdown) - now);
      if (clock.textContent !== label) clock.textContent = label;
    }
    for (const el of root.querySelectorAll<HTMLElement>("[data-activity-at]")) {
      const label = formatRelativeAge(Number(el.dataset.activityAt), now);
      if (el.textContent !== label) el.textContent = label;
    }
    for (const el of root.querySelectorAll<HTMLElement>("[data-cg-age-at]")) {
      const at = Number(el.dataset.cgAgeAt);
      const bucket = freshnessBucket(at, now);
      const label = formatRelativeAge(at, now, el.dataset.cgAgeStale === "1");
      if (el.textContent !== label) el.textContent = label;
      if (el.dataset.freshness !== bucket) el.dataset.freshness = bucket;
    }
    if (live && claimMapHandle && claimMapRoomCode === live.room.code && !mapFailed && live.room.seatPositions?.length) {
      let bucketChanged = false;
      for (const pos of live.room.seatPositions) {
        if (pos.seatId === live.room.seatId) continue;
        const pin = root.querySelector<HTMLElement>(`[data-rival-seat="${CSS.escape(pos.seatId)}"]`);
        if (pin && pin.dataset.freshness !== freshnessBucket(pos.at, now)) {
          bucketChanged = true;
          break;
        }
      }
      if (bucketChanged) {
        claimMapHandle.update(buildClaimMapState(live));
      }
    }
  }

  let focusRestoreTarget: Record<string, string | undefined> | null = null;

  function findMatchingButton(container: ParentNode, dataset: Record<string, string | undefined>): HTMLButtonElement | null {
    const keys = Object.keys(dataset).filter(k => dataset[k] !== undefined);
    if (keys.length === 0) return null;
    for (const btn of container.querySelectorAll<HTMLButtonElement>("button")) {
      if (btn.disabled) continue;
      if (keys.every(k => btn.dataset[k] === dataset[k])) return btn;
    }
    return null;
  }

  function render() {
    if (lifetime.signal.aborted) return;
    isRendering = true;
    try {
      syncPresenceWatch();
    } finally {
      isRendering = false;
    }
    void syncWakeLock();
    activityUi.update(live?.room, live?.activity);
    const effects = liveEffects;
    liveEffects = [];
    toast.setLayout(live && live.room.phase !== "lobby" && live.room.phase !== "canceled" ? "game" : "page", Boolean(live?.activity.prompt));
    if (live?.room.phase === "canceled") {
      clearActiveRoom(live.room.code);
      activityUi.mount(null);
      destroyClaimMap();
      destroyStartMiniMap();
      root.innerHTML = renderCanceledRoomCard({ roomCode: live.room.code, title: live.room.packMeta.title });
      return;
    }
    if (!live || live.room.phase === "lobby") {
      activityUi.mount(null);
      destroyClaimMap();
      destroyStartMiniMap();
      const focusedInput = document.activeElement instanceof HTMLInputElement && root.contains(document.activeElement)
        ? { id: document.activeElement.id, start: document.activeElement.selectionStart, end: document.activeElement.selectionEnd }
        : null;
      const focusedBtn = document.activeElement instanceof HTMLButtonElement && root.contains(document.activeElement)
        ? { ...document.activeElement.dataset }
        : null;
      root.innerHTML = live ? renderLobby(live) : renderCatalog();
      if (live && startMapExpanded) {
        const miniHost = root.querySelector<HTMLElement>("#cg-start-minimap");
        if (miniHost) void syncStartMiniMap(miniHost, live);
      }
      if (!busy) {
        if (focusedInput) {
          const el = root.querySelector<HTMLInputElement>(`#${CSS.escape(focusedInput.id)}`);
          if (el) {
            el.focus({ preventScroll: true });
            if (focusedInput.start != null && focusedInput.end != null) el.setSelectionRange(focusedInput.start, focusedInput.end);
          }
        } else {
          const targetDataset = focusRestoreTarget ?? focusedBtn;
          if (targetDataset) findMatchingButton(root, targetDataset)?.focus({ preventScroll: true });
        }
        focusRestoreTarget = null;
      }
      return;
    }
    destroyStartMiniMap();
    if (!root.querySelector(".cg-game")) {
      root.innerHTML = `<section class="sg-game cg-game" aria-label="Permainan Claim the City">
        <div id="rb-claim-map-host" class="sg-board cg-board"></div>
        <aside class="cg-fallback" aria-label="Papan landmark" hidden></aside>
        <header class="sg-hud cg-hud">
          <div class="sg-role cg-brand"></div>
          <div class="sg-hud-actions"><div class="sg-timer cg-timer" aria-label="Waktu ronde"></div>${renderMore()}</div>
        </header>
        <div class="cg-map-legend" aria-label="Legenda peta">● Belum diklaim <span>◆ Rentan</span> <span>■ Terkunci</span>${live.room.isSolo ? "" : " <span>▲ Pemain</span>"}</div>
        <div class="cg-conn-pill" data-cg-conn-pill role="status" ${connectionState === "connected" ? "hidden" : ""}>${connectionState === "offline" ? "Luring · menunggu koneksi" : "Menyambungkan ulang…"}</div>
        <div class="room-activity-host"></div>
        <div class="sg-dock cg-dock">
          <div class="cg-drawer-bar"></div>
          <div class="sg-sheet cg-sheet" id="cg-panel" tabindex="-1"></div>
          <nav class="sg-nav" aria-label="Menu permainan">${claimPanels.map(item => `<button type="button"
            data-action="panel" data-panel="${item.id}"><span class="sg-nav-icon" aria-hidden="true">${item.icon}</span>${item.name}</button>`).join("")}</nav>
        </div>
      </section>`;
    }
    const game = root.querySelector<HTMLElement>(".cg-game")!;
    const { room } = live;
    const menuActions = game.querySelector<HTMLElement>(".sg-room-menu-actions");
    const nextMenuHtml = renderMoreMenuItems();
    if (menuActions && menuActions.innerHTML !== nextMenuHtml) {
      menuActions.innerHTML = nextMenuHtml;
    }
    updateConnectionPill();
    const brand = game.querySelector<HTMLElement>(".cg-brand")!;
    const boardTitle = room.packMeta.title.replace(/ · Claim the City$/, "");
    const brandHtml = `<span class="sg-role-mark" aria-hidden="true">◆</span>
      <h1>Claim the City <small>${room.isSolo ? "Solo" : "Grup"}</small></h1>
      <p title="${escapeText(boardTitle)}">${escapeText(boardTitle)}</p>
      <span class="sr-only">${phaseLabels[room.phase]}</span>`;
    if (brand.innerHTML !== brandHtml) brand.innerHTML = brandHtml;
    const timer = game.querySelector<HTMLElement>(".cg-timer")!;
    if (room.deadline !== null && room.phase === "active") timer.dataset.cgCountdown = String(room.deadline);
    else {
      delete timer.dataset.cgCountdown;
      timer.textContent = "Selesai";
    }
    const fallback = game.querySelector<HTMLElement>(".cg-fallback")!;
    fallback.hidden = !mapFailed;
    const map = game.querySelector<HTMLElement>("#rb-claim-map-host")!;
    map.hidden = mapFailed;
    game.querySelector<HTMLElement>(".cg-map-legend")!.hidden = mapFailed;
    const bar = game.querySelector<HTMLElement>(".cg-drawer-bar")!;
    const own = room.standings.find(score => score.teamId === room.teamId);
    bar.innerHTML = `<span>${panel === "score" && !folded ? escapeText(room.code) : room.soloProgress
      ? `${room.soloProgress.lockedLandmarks}/${room.soloProgress.targetLandmarks} terkunci`
      : `${own?.zonesControlled ?? 0} zona · ${own?.lockedLandmarks ?? 0} terkunci`}</span>
      <button type="button" class="cg-fold" data-action="fold" aria-controls="cg-panel" aria-expanded="${!folded}">${folded ? "Buka panel ⌃" : "Lihat peta ⌄"}</button>`;
    const sheet = game.querySelector<HTMLElement>(".cg-sheet")!;
    const answer = sheet.querySelector<HTMLInputElement>("#claim-input-answer");
    const checked = sheet.querySelector<HTMLInputElement>('input[name="claim-mcq"]:checked');
    const hint = sheet.querySelector<HTMLDetailsElement>("[data-claim-hint]");
    const oldDraftKey = sheet.dataset.draftKey;
    const draftKey = room.ownActiveAttempt ? JSON.stringify([room.ownActiveAttempt.landmarkId, room.ownActiveAttempt.challenge, room.ownActiveAttempt.currentStep]) : "";
    const restoreId = document.activeElement instanceof HTMLInputElement && sheet.contains(document.activeElement) ? document.activeElement.id : "";
    const activeBtnDataset = document.activeElement instanceof HTMLButtonElement && sheet.contains(document.activeElement)
      ? { ...document.activeElement.dataset }
      : null;
    const selectionStart = answer?.selectionStart;
    const selectionEnd = answer?.selectionEnd;
    const previousScroll = sheet.scrollTop;
    const activeScreenAlert = inlineError && (inlineError.slot === "lobby" || inlineError.slot === "catalog")
      ? renderInlineAlert(inlineError.message, inlineError.tone)
      : "";
    sheet.dataset.draftKey = draftKey;
    sheet.hidden = folded;
    sheet.innerHTML = `${renderClaimDraftBar(live)}${room.phase === "active" && !room.outcome ? renderPhaseCueStrip("claim-active") : ""}${activeScreenAlert}${renderRivalCard(room)}
      ${panel === "activity" ? renderRoomActivity(live.activity, Date.now() + serverOffset) : panel === "cards" ? renderCards(room) : panel === "score" ? renderScore(live) : `
        ${room.ownActiveAttempt
          ? renderActiveAttempt(room.ownActiveAttempt, room) + (room.ownActiveAttempt.landmarkId !== selectedId && selectedId ? renderLandmark(live) : "")
          : renderLandmark(live)}
        ${renderClaimAlerts(live)}`}`;
    if (draftKey && draftKey === oldDraftKey) {
      const newHint = sheet.querySelector<HTMLDetailsElement>("[data-claim-hint]");
      if (hint?.open && newHint) newHint.open = true;
      const newAnswer = sheet.querySelector<HTMLInputElement>("#claim-input-answer");
      if (answer && newAnswer) {
        newAnswer.value = answer.value;
        if (restoreId === newAnswer.id) {
          newAnswer.focus({ preventScroll: true });
          if (selectionStart != null && selectionEnd != null) newAnswer.setSelectionRange(selectionStart, selectionEnd);
        }
      }
      if (checked) {
        const radio = Array.from(sheet.querySelectorAll<HTMLInputElement>('input[name="claim-mcq"]')).find(input => input.value === checked.value);
        if (radio) radio.checked = true;
      }
    }
    sheet.scrollTop = previousScroll;
    for (const button of sheet.querySelectorAll<HTMLButtonElement>("button[data-action]")) {
      if (busy) button.disabled = true;
    }
    if (!busy && !restoreId) {
      const desired = focusRestoreTarget ?? activeBtnDataset;
      if (desired) {
        const match = findMatchingButton(sheet, desired)
          ?? (desired.action === "play-card" ? sheet.querySelector<HTMLButtonElement>('[data-action="close-card"]') : null);
        match?.focus({ preventScroll: true });
      }
      focusRestoreTarget = null;
    }
    for (const button of game.querySelectorAll<HTMLButtonElement>("[data-panel]")) {
      button.setAttribute("aria-pressed", String(!folded && button.dataset.panel === panel));
    }
    activityUi.mount(game.querySelector(".room-activity-host"));
    const scoreEffect = effects.filter(event => event.zoneId || event.kind === "lock" || event.kind === "steal").at(-1);
    const cardEffect = effects.filter(event => event.kind === "draw" || event.kind === "card").at(-1);
    if (scoreEffect) playGameMotion(bar.querySelector("span"), "update", scoreEffect.sequence);
    if (cardEffect) playGameMotion(game.querySelector('[data-panel="cards"]'), "update", cardEffect.sequence);
    if (mapFailed) fallback.innerHTML = renderFallback(live);
    else void syncClaimMapOverlay(map, live).then(() => {
      if (!map.isConnected || live?.room.code !== room.code) return;
      for (const effect of effects) {
        const { kind, landmarkId, zoneId, sequence } = effect;
        if (landmarkId && (kind === "claim" || kind === "lock" || kind === "steal" || kind === "card")) {
          const pin = map.querySelector<HTMLElement>(`[data-map-point="${CSS.escape(landmarkId)}"]`);
          playGameMotion(pin, kind === "card" ? "role" : kind, sequence);
        }
        if (zoneId) {
          const marker = map.querySelector<HTMLElement>(`[data-map-point="${CSS.escape(`zone:${zoneId}`)}"]`);
          playGameMotion(marker, "role", sequence);
        }
      }
    });
    updateClocks();
  }

  async function locationFix(target?: GeoCoordinate) {
    if (live && isQaRoom(live)) {
      const chosen = resolveQaCoord(live) ?? target;
      if (chosen) {
        const fix = { latitude: chosen.latitude, longitude: chosen.longitude, accuracy: 10, timestamp: live.room.now };
        liveLocation.setManualFix(fix);
        return fix;
      }
    }
    if (demoLocation && target && live) {
      return { latitude: target.latitude, longitude: target.longitude, accuracy: 10, timestamp: live.room.now };
    }
    const fix = await getLocation();
    liveLocation.setManualFix(fix);
    return fix;
  }

  root.addEventListener("input", event => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) return;
    if (target.id === "rb-claim-join-code") joinCode = target.value;
    if (target.id === "rb-claim-join-name") {
      joinName = target.value;
      joinNameEdited = true;
    }
    if (target.id === "cg-rename-input") renameDraft = target.value;
  }, { signal: lifetime.signal });

  root.addEventListener("change", event => {
    if (event.target instanceof HTMLSelectElement && event.target.id === "claim-qa-location" && live && isQaRoom(live)) {
      qaLocationId = event.target.value;
      sessionStorage.setItem(`claim-qa-location:${live.room.code}`, qaLocationId);
      const chosen = resolveQaCoord(live);
      if (chosen) {
        liveLocation.setManualFix({
          latitude: chosen.latitude,
          longitude: chosen.longitude,
          accuracy: 10,
          timestamp: live.room.now,
        });
      }
      render();
      return;
    }
    if (event.target instanceof HTMLInputElement && event.target.hasAttribute("data-cg-photo")) {
      const targetId = event.target.dataset.cgPhoto ?? "";
      const isCurse = Boolean(live?.room.activeCurses.some((c) => c.curseInstanceId === targetId));
      handlePhotoInput(targetId, event.target.files?.[0], isCurse);
      return;
    }
    if (event.target instanceof HTMLSelectElement && event.target.hasAttribute("data-claim-hand")) {
      challengeHandId = event.target.value;
      return;
    }
    if (event.target instanceof HTMLSelectElement && event.target.dataset.reassignSeat && live && !busy) {
      const targetSeatId = event.target.dataset.reassignSeat;
      const chosen = event.target.value;
      const nextTeamId = chosen === "__new__" ? nextFreshTeamId(live.room.seats) : chosen;
      busy = true;
      root.setAttribute("aria-busy", "true");
      void postRoomAction({ type: "set-team", teamId: nextTeamId, targetSeatId })
        .catch((error) => {
          if (!lifetime.signal.aborted) reportError(error, { surface: "lobby", action: "set-team" }, "lobby");
        })
        .finally(() => {
          busy = false;
          if (lifetime.signal.aborted) return;
          root.removeAttribute("aria-busy");
          render();
          if (!pendingAction) roomEvents.sync();
        });
    }
  }, { signal: lifetime.signal });

  async function switchToClaimRoom(nextCode: string, nextStatus = "") {
    roomCode = nextCode;
    joinCode = nextCode;
    live = null;
    cachedBoard = null;
    roomEtag = null;
    selectedId = selectedCardId = selectedRivalId = selectedRivalPinSeatId = challengeHandId = "";
    photoDrafts.clear();
    uploadingPhotoTarget = "";
    startMapExpanded = false;
    destroyClaimMap();
    destroyStartMiniMap();
    panel = "challenge";
    mapFailed = false;
    folded = false;
    statusMsg = nextStatus;
    inlineError = null;
    pendingAction = null;
    toast.clear();
    syncRoomUrl(nextCode);
    await refreshRoom();
  }

  async function executePlayAgain() {
    if (!live || busy) return;
    const { room, pass } = live;
    const ownSeat = room.seats.find((s) => s.seatId === room.seatId);
    const replayMode: RulebookPlayMode = pass.mode ?? (room.isSolo ? "solo" : "group");
    const isOwnedPaid = pass.paid;
    const hostName = resolveDefaultPlayerName(getCachedAuth()?.user?.displayName, ownSeat?.name ?? "Pemain");
    const requestType = isOwnedPaid ? "create-owned-room" : "create-free-room";
    const pending = ensurePendingAction(
      `play-again:${room.code}:${pass.packId}:${pass.version}:${replayMode}`,
      requestType,
    );
    busy = true;
    root.setAttribute("aria-busy", "true");
    inlineError = null;
    render();
    try {
      const { ok, status, data: res } = await fetchApiJson<{ ok?: boolean; roomCode?: string; error?: string }>(
        "/api/rulebooks",
        {
          signal: lifetime.signal,
          body: {
            type: requestType,
            packId: pass.packId,
            version: pass.version,
            mode: replayMode,
            hostName,
            requestId: pending.id,
          },
        },
      );
      clearPendingAction();
      if (lifetime.signal.aborted) return;
      if (ok && res.ok && res.roomCode) {
        await switchToClaimRoom(res.roomCode, `Ruang baru ${res.roomCode} siap dimainkan.`);
        return;
      }
      reportError(
        { error: res.error ?? "invalid-request", status },
        { surface: "claim", action: requestType, target: pass.packId },
        "lobby",
      );
    } catch (error) {
      if (!lifetime.signal.aborted) {
        const resolved = reportError(error, { surface: "claim", action: requestType, target: pass.packId }, "lobby");
        if (!resolved.uncertain) clearPendingAction();
      }
    } finally {
      busy = false;
      if (!lifetime.signal.aborted) {
        root.removeAttribute("aria-busy");
        render();
        if (!pendingAction) roomEvents.sync();
      }
    }
  }

  async function executeConfirmedLeave(toastText: string) {
    if (!live || busy) return;
    const leavingCode = roomCode || live.room.code;
    const wasActiveSolo = live.room.phase === "active" && live.room.isSolo;
    busy = true;
    root.setAttribute("aria-busy", "true");
    inlineError = null;
    try {
      const ok = await postRoomAction({ type: "leave" });
      if (!ok || lifetime.signal.aborted) return;
      clearActiveRoom(leavingCode);
      stopPresenceWatch();
      releaseWakeLock();
      toast.resetDedupe();
      toast.show({ message: toastText, tone: "info", dedupeKey: `claim:leave:${leavingCode}` });
      if (!wasActiveSolo) {
        onBack();
        return;
      }
    } catch (error) {
      if (!lifetime.signal.aborted) {
        reportError(error, { surface: "lobby", action: "leave" }, "lobby");
      }
    } finally {
      busy = false;
      if (!lifetime.signal.aborted) {
        root.removeAttribute("aria-busy");
        render();
        if (!pendingAction) roomEvents.sync();
      }
    }
  }

  root.addEventListener("click", (event) => {
    const btn = (event.target as HTMLElement | null)?.closest<HTMLButtonElement>("button");
    if (!btn || busy) return;
    const clearPhotoTarget = btn.dataset.photoClear;
    if (clearPhotoTarget !== undefined) {
      photoDrafts.delete(clearPhotoTarget);
      if (inlineError?.targetId === clearPhotoTarget) inlineError = null;
      render();
      return;
    }
    const locAction = btn.dataset.locAction;
    if (locAction === "enable-live-location") {
      liveLocation.start();
      return;
    }
    if (locAction === "toggle-start-map" && live) {
      startMapExpanded = !startMapExpanded;
      render();
      return;
    }
    const lobbyAction = btn.dataset.lobbyAction;
    if (lobbyAction && live) {
      const inviteUrl = `${location.origin}/?play=rulebook-claim&room=${encodeURIComponent(live.room.code)}`;
      if (lobbyAction === "copy-code") {
        void copyToClipboard(live.room.code).then((ok) => {
          if (lifetime.signal.aborted || !ok) return;
          copiedCode = true;
          render();
          window.setTimeout(() => {
            if (lifetime.signal.aborted) return;
            copiedCode = false;
            render();
          }, 2500);
        });
      } else if (lobbyAction === "share-invite") {
        void (async () => {
          if (canUseWebShare()) {
            try {
              await navigator.share({
                title: live.room.packMeta.title,
                text: `Gabung ruang Claim the City (${live.room.code}) di Kelana Ria!`,
                url: inviteUrl,
              });
              return;
            } catch (err) {
              if (err instanceof DOMException && err.name === "AbortError") return;
            }
          }
          const ok = await copyToClipboard(inviteUrl);
          if (lifetime.signal.aborted || !ok) return;
          copiedLink = true;
          render();
          window.setTimeout(() => {
            if (lifetime.signal.aborted) return;
            copiedLink = false;
            render();
          }, 2500);
        })();
      } else if (lobbyAction === "show-qr") {
        openQrModal({ roomCode: live.room.code, inviteUrl, title: live.room.packMeta.title });
      }
      return;
    }

    const nav = btn.dataset.nav;
    if (nav === "back") return onBack();
    if (nav === "studio") {
      const url = new URL(location.href);
      url.searchParams.set("play", "rulebook-studio");
      url.searchParams.set("format", "claim-the-city");
      url.searchParams.delete("room");
      history.pushState({ fromChooser: true }, "", url);
      window.dispatchEvent(new PopStateEvent("popstate"));
      return;
    }
    if (nav === "catalog") {
      if (live?.pass.mode || live?.room.phase === "canceled") return onBack();
      live = null;
      roomCode = "";
      joinCode = "";
      selectedId = selectedCardId = selectedRivalId = selectedRivalPinSeatId = challengeHandId = "";
      photoDrafts.clear();
      uploadingPhotoTarget = "";
      startMapExpanded = false;
      destroyStartMiniMap();
      stopPresenceWatch();
      releaseWakeLock();
      panel = "challenge";
      mapFailed = false;
      folded = false;
      statusMsg = "";
      inlineError = null;
      pendingAction = null;
      toast.clear();
      refreshSeq++;
      syncRoomUrl("");
      roomEvents.sync();
      render();
      void loadCatalog();
      return;
    }

    const action = btn.dataset.action;
    if (!action) return;
    if (action === "open-quick-guide" && live) {
      btn.closest<HTMLDetailsElement>(".sg-room-menu")?.removeAttribute("open");
      openQuickGuideModal({
        format: "claim-the-city",
        mode: live.room.isSolo || live.pass.mode === "solo" ? "solo" : "group",
        role: live.room.phase === "lobby" ? "lobby" : "player",
        packId: live.pass.packId,
        version: live.pass.version,
        title: live.room.packMeta.title,
        inLobby: live.room.phase === "lobby",
        onResetCues: () => render(),
      });
      return;
    }
    if (action === "dismiss-phase-cue") {
      const cueKey = btn.dataset.cueKey as PhaseCueKey | undefined;
      if (cueKey) {
        dismissPhaseCue(cueKey);
        render();
      }
      return;
    }
    if (action === "play-again" && live) {
      void executePlayAgain();
      return;
    }
    if (action === "join-new-room") {
      const auth = getCachedAuth();
      openQuickJoinRoomDialog({
        authenticatedDisplayName: auth?.user?.displayName,
        authenticated: auth?.authenticated,
        onJoined: (format, nextCode) => {
          if (format === "claim-the-city") {
            void switchToClaimRoom(nextCode);
          } else {
            const url = new URL(location.href);
            url.searchParams.set("play", "rulebook-seek");
            url.searchParams.set("room", nextCode);
            url.searchParams.delete("pack");
            url.searchParams.delete("launch");
            history.pushState({ fromChooser: true }, "", url);
            window.dispatchEvent(new PopStateEvent("popstate"));
          }
        },
      });
      return;
    }
    if (action === "sort-landmarks") {
      const nextSort = btn.dataset.sort === "nearest" ? "nearest" : "zone";
      landmarkSort = nextSort;
      if (nextSort === "nearest" && !selfFix) liveLocation.start();
      render();
      return;
    }
    if (action === "clear-selected-landmark") {
      selectedId = "";
      selectedRivalPinSeatId = "";
      render();
      return;
    }
    if (action === "confirm-leave" && live) {
      btn.closest<HTMLDetailsElement>(".sg-room-menu")?.removeAttribute("open");
      const spec = destructiveExitSpec(live);
      if (!spec) return;
      openConfirmDialog({
        title: spec.title,
        body: spec.body,
        confirmLabel: spec.label,
        danger: true,
        onConfirm: () => {
          void executeConfirmedLeave(spec.toastText);
        },
      });
      return;
    }
    if (action === "edit-name" && live) {
      const ownSeat = live.room.seats.find((s) => s.seatId === live!.room.seatId);
      renameDraft = ownSeat?.name ?? "";
      editingName = true;
      render();
      root.querySelector<HTMLInputElement>("#cg-rename-input")?.focus({ preventScroll: true });
      return;
    }
    if (action === "cancel-name") {
      editingName = false;
      render();
      root.querySelector<HTMLButtonElement>('[data-testid="edit-own-name"]')?.focus({ preventScroll: true });
      return;
    }
    if (action === "toggle-wakelock") {
      wakeLockWanted = !wakeLockWanted;
      void syncWakeLock();
      btn.closest<HTMLDetailsElement>(".sg-room-menu")?.removeAttribute("open");
      render();
      return;
    }
    if (action === "close-rival-card") {
      selectedRivalPinSeatId = "";
      render();
      return;
    }
    if (action === "panel") {
      panel = btn.dataset.panel as ClaimPanel;
      if (panel === "activity") btn.closest<HTMLDetailsElement>(".sg-room-menu")?.removeAttribute("open");
      folded = false;
    } else if (action === "fold") {
      folded = !folded;
    } else if (action === "select-card") {
      selectedCardId = btn.dataset.instance ?? "";
      selectedId = selectedRivalId = "";
    } else if (action === "close-card") {
      selectedCardId = selectedRivalId = "";
    } else if (action === "select-rival") {
      selectedRivalId = btn.dataset.seat ?? "";
    } else if (action === "select-landmark") {
      selectLandmark(btn.dataset.landmark ?? "");
      return;
    } else if (action === "retry-map") {
      mapFailed = false;
    }
    if (["panel", "fold", "select-card", "close-card", "select-rival", "retry-map"].includes(action)) {
      render();
      const focused = action === "panel" ? root.querySelector<HTMLElement>(panel === "activity" ? "[data-activity-heading]" : `[data-panel="${panel}"]`)
        : action === "fold" ? root.querySelector<HTMLElement>(".cg-fold")
        : action === "select-card" ? root.querySelector<HTMLElement>('[data-action="close-card"]')
        : action === "close-card" ? root.querySelector<HTMLElement>('[data-action="select-card"]')
        : action === "select-rival" ? root.querySelector<HTMLElement>('[data-action="select-rival"][aria-pressed="true"]')
        : null;
      focused?.focus({ preventScroll: true });
      return;
    }

    if (action === "join-room") {
      const codeInput = (root.querySelector<HTMLInputElement>("#rb-claim-join-code")?.value ?? joinCode).trim();
      joinCode = codeInput;
      joinName = (root.querySelector<HTMLInputElement>("#rb-claim-join-name")?.value ?? joinName).trim() || "Pemain";
      if (!codeInput) {
        reportError("join-code-required", { surface: "lobby", action: "join-room" }, "join");
        render();
        root.querySelector<HTMLInputElement>("#rb-claim-join-code")?.focus({ preventScroll: true });
        return;
      }
    }

    if (action === "submit-input") {
      const inputEl = root.querySelector<HTMLInputElement>("#claim-input-answer");
      const inputValue = inputEl?.value.trim() ?? "";
      if (!inputValue) {
        reportError("input-required", { action: "submit-input", target: btn.dataset.landmark }, "challenge-input", btn.dataset.landmark);
        render();
        root.querySelector<HTMLInputElement>("#claim-input-answer")?.focus({ preventScroll: true });
        return;
      }
    }

    busy = true;
    root.setAttribute("aria-busy", "true");
    inlineError = null;
    focusRestoreTarget = { ...btn.dataset };

    let catchSlot: ClaimInlineSlot = live ? (live.room.phase === "lobby" ? "lobby" : "landmark-checkin") : "catalog";
    let catchTarget: string | undefined = btn.dataset.landmark ?? btn.dataset.curse ?? btn.dataset.pack;
    if (action === "sim-start-checkin") catchSlot = "lobby-checkin";
    else if (action === "checkin-landmark") catchSlot = "landmark-checkin";
    else if (action === "submit-timed-gps") catchSlot = "challenge-gps";
    else if (action === "clear-curse-gps" || action === "submit-curse-photo") catchSlot = "curse-action";
    else if (action === "join-room") catchSlot = "join";

    void (async () => {
      if (action === "claim-qa-advance" && live && isQaRoom(live) && btn.dataset.step) {
        const step = btn.dataset.step;
        const pending = ensurePendingAction(`qa-advance:${live.room.code}:${step}:${live.room.deadline ?? "none"}`, "qa-advance");
        const { ok, status, data } = await fetchApiJson<{ ok?: boolean; error?: string }>("/api/rulebooks", {
          signal: lifetime.signal,
          body: {
            type: "qa-advance",
            roomCode: live.room.code,
            step,
            actionId: pending.id,
            ...(step === "phase-end" ? { expectedDeadline: live.room.deadline } : {}),
          },
        });
        clearPendingAction();
        if (!ok || !data.ok) {
          reportError({ error: data.error ?? "qa-deadline-changed", status }, { action: "qa-advance", target: step }, "landmark-checkin");
        } else {
          await refreshRoom(false, false, true);
        }
        return;
      }
      if (action === "start-free" || action === "start-owned") {
        render();
        const packId = btn.dataset.pack ?? "";
        const version = Number(btn.dataset.version ?? 1);
        const isOwnedLaunch = action === "start-owned";
        const persistKey = `kelana-claim-${isOwnedLaunch ? "owned" : "free"}:${packId}:${version}`;
        const pending = ensurePendingAction(`create-${isOwnedLaunch ? "owned" : "free"}:${packId}:${version}`, isOwnedLaunch ? "create-owned-room" : "create-free-room", undefined, persistKey);
        const { ok, status, data: res } = await fetchApiJson<{ ok?: boolean; roomCode?: string; error?: string }>("/api/rulebooks", {
          signal: lifetime.signal,
          body: {
            type: isOwnedLaunch ? "create-owned-room" : "create-free-room",
            packId,
            version,
            requestId: pending.id,
          },
        });
        clearPendingAction(persistKey);
        if (ok && res.ok && res.roomCode) {
          roomCode = res.roomCode;
          joinCode = res.roomCode;
          statusMsg = `Ruang Claim ${roomCode} berhasil dibuat.`;
          toast.clear();
          toast.resetDedupe();
          await refreshRoom(false, false, true);
        } else {
          reportError({ error: res.error ?? "invalid-request", status }, { surface: "catalog", action, target: packId }, "catalog");
          if (res.error === "entitlement-active-room-exists") void loadCatalog();
        }
      } else if (action === "resume-owned") {
        const targetRoom = btn.dataset.room ?? "";
        if (targetRoom) {
          roomCode = targetRoom;
          joinCode = targetRoom;
          toast.clear();
          toast.resetDedupe();
          await refreshRoom(false, false, true);
        }
      } else if (action === "buy-pack") {
        render();
        const packId = btn.dataset.pack ?? "";
        const version = Number(btn.dataset.version ?? 1);
        const persistKey = `kelana-claim-order:${packId}:${version}`;
        const pending = ensurePendingAction(`create-order:${packId}:${version}`, "create-order", undefined, persistKey);
        const { ok, status, data: res } = await fetchApiJson<{ ok?: boolean; order?: { orderId: string }; error?: string }>("/api/rulebooks", {
          signal: lifetime.signal,
          body: {
            type: "create-order",
            packId,
            version,
            requestId: pending.id,
          },
        });
        clearPendingAction(persistKey);
        if (ok && res.ok && res.order) {
          activeOrderId = res.order.orderId;
          statusMsg = `Order ${activeOrderId} dibuat (Uji Pembayaran).`;
          toast.clear();
          toast.resetDedupe();
        } else if (status === 401 || res.error === "auth-required") {
          openAuthModal({
            reason: "Masuk dengan email agar paket tersimpan permanen di akunmu.",
            onSignedIn: () => {
              if (!lifetime.signal.aborted) void loadCatalog();
            },
          });
        } else {
          reportError({ error: res.error ?? "invalid-request", status }, { surface: "checkout", action: "buy-pack", target: packId }, "catalog");
          if (res.error === "pack-already-owned") void loadCatalog();
        }
      } else if (action === "settle-order") {
        render();
        const orderId = btn.dataset.order ?? "";
        const { ok, status, data: res } = await fetchApiJson<{ ok?: boolean; pass?: { roomCode: string }; error?: string }>("/api/rulebooks", {
          signal: lifetime.signal,
          body: {
            type: "verify-settlement",
            orderId,
            transactionStatus: "settlement",
            statusCode: "200",
            currency: "IDR",
          },
        });
        if (ok && res.ok && res.pass) {
          activeOrderId = null;
          toast.clear();
          toast.resetDedupe();
          roomCode = res.pass.roomCode;
          joinCode = res.pass.roomCode;
          statusMsg = `Pembayaran lunas! Ruang ${roomCode} terbuka.`;
          await refreshRoom(false, false, true);
        } else if (status === 401 || res.error === "auth-required") {
          openAuthModal({
            reason: "Masuk dengan email agar paket tersimpan permanen di akunmu.",
            onSignedIn: () => {
              if (!lifetime.signal.aborted) void loadCatalog();
            },
          });
        } else {
          reportError({ error: res.error ?? "payment-pending", status }, { surface: "checkout", action: "settle-order", target: orderId }, "catalog");
        }
      } else if (action === "join-room") {
        render();
        const { ok, status, data: res } = await fetchApiJson<{ ok?: boolean; error?: string }>("/api/rulebooks", {
          signal: lifetime.signal,
          body: {
            type: "join-room",
            roomCode: joinCode,
            name: joinName,
          },
        });
        if (ok && res.ok) {
          if (!getCachedAuth()?.authenticated) saveRememberedGuestName(joinName);
          roomCode = joinCode;
          toast.clear();
          toast.resetDedupe();
          await refreshRoom(false, false, true);
        } else {
          reportError({ error: res.error ?? "room-not-found", status }, { surface: "lobby", action: "join-room", target: joinCode }, "join");
        }
      } else if (action === "refresh") {
        btn.closest("details")?.removeAttribute("open");
        await refreshRoom(false, false, true);
      } else if (action === "save-name" && live) {
        const cleaned = (root.querySelector<HTMLInputElement>("#cg-rename-input")?.value ?? renameDraft).trim();
        if (!cleaned || cleaned.length > 32) {
          reportError("invalid-seat-name", { surface: "lobby", action: "rename-seat" }, "lobby");
        } else {
          const ok = await postRoomAction({ type: "rename-seat", name: cleaned });
          if (ok) {
            editingName = false;
            if (!getCachedAuth()?.authenticated) saveRememberedGuestName(cleaned);
          }
        }
      } else if (action === "join-team" && live) {
        const teamId = btn.dataset.team ?? "";
        if (teamId) await postRoomAction({ type: "set-team", teamId });
      } else if (action === "new-team" && live) {
        await postRoomAction({ type: "set-team", teamId: nextFreshTeamId(live.room.seats) });
      } else if (action === "sim-start-checkin" && live) {
        await postRoomAction({
          type: "check-in-start",
          fix: await locationFix(live.publicBoard.startPoint),
        });
      } else if (action === "mark-ready") {
        await postRoomAction({ type: "ready", ready: true });
      } else if (action === "unmark-ready") {
        await postRoomAction({ type: "ready", ready: false });
      } else if (action === "start-match") {
        await postRoomAction({ type: "start" });
      } else if (action === "checkin-landmark" && live) {
        const lmId = btn.dataset.landmark ?? "";
        const meta = live.publicBoard.landmarks.find((l) => l.id === lmId);
        if (!meta) return;
        await postRoomAction({
          type: "check-in-landmark",
          landmarkId: lmId,
          challengeHandId: root.querySelector<HTMLSelectElement>("[data-claim-hand]")?.value,
          fix: await locationFix(meta),
        });
      } else if (action === "choose-shot-tier") {
        await postRoomAction({
          type: "choose-shot-tier",
          landmarkId: btn.dataset.landmark,
          tier: btn.dataset.tier,
        });
      } else if (action === "start-timed") {
        await postRoomAction({ type: "start-timed-task", landmarkId: btn.dataset.landmark });
      } else if (action === "submit-mcq") {
        const choiceId = root.querySelector<HTMLInputElement>('input[name="claim-mcq"]:checked')?.value ?? "";
        await postRoomAction({ type: "submit-challenge", landmarkId: btn.dataset.landmark, choiceId });
      } else if (action === "submit-input") {
        const inputValue = root.querySelector<HTMLInputElement>("#claim-input-answer")?.value.trim() ?? "";
        await postRoomAction({ type: "submit-challenge", landmarkId: btn.dataset.landmark, inputValue });
      } else if (action === "submit-photo") {
        await submitPhoto(btn);
      } else if (action === "submit-timed-gps" && live) {
        await postRoomAction({
          type: "submit-challenge",
          landmarkId: btn.dataset.landmark,
          fix: await locationFix({
            latitude: Number(btn.dataset.lat ?? 0),
            longitude: Number(btn.dataset.lng ?? 0),
          }),
        });
      } else if (action === "bail-challenge") {
        await postRoomAction({ type: "bail-challenge", landmarkId: btn.dataset.landmark });
      } else if (action === "review-rival-photo") {
        await postRoomAction({
          type: "review-challenge-photo",
          targetSeatId: btn.dataset.seat,
          landmarkId: btn.dataset.landmark,
          approve: btn.dataset.approve === "true",
        });
      } else if (action === "play-card" && live) {
        await postRoomAction({
          type: "play-card",
          cardInstanceId: btn.dataset.instance,
          landmarkId: btn.dataset.landmark || undefined,
          targetSeatId: btn.dataset.seat || undefined,
        });
      } else if (action === "clear-curse-gps" && live) {
        await postRoomAction({
          type: "clear-curse-gps",
          curseInstanceId: btn.dataset.curse,
          fix: await locationFix(),
        });
      } else if (action === "submit-curse-photo") {
        await submitPhoto(btn);
      } else if (action === "review-curse-photo") {
        await postRoomAction({
          type: "review-curse-photo",
          curseInstanceId: btn.dataset.curse,
          approve: btn.dataset.approve === "true",
        });
      } else if (action === "clear-curse-honor") {
        await postRoomAction({ type: "clear-curse-honor", curseInstanceId: btn.dataset.curse });
      }
    })().catch(error => {
      if (lifetime.signal.aborted) return;
      reportError(error, { action, target: catchTarget }, catchSlot, catchTarget);
    }).finally(() => {
      busy = false;
      if (lifetime.signal.aborted) return;
      root.removeAttribute("aria-busy");
      render();
      if (!pendingAction) roomEvents.sync();
    });
  }, { signal: lifetime.signal });

  function applySignedInJoinName(displayName?: string | null) {
    if (!displayName || joinNameEdited) return;
    joinName = displayName;
    const nameInput = root.querySelector<HTMLInputElement>("#rb-claim-join-name");
    if (nameInput) nameInput.value = joinName;
  }

  onAuthChange((next) => {
    applySignedInJoinName(next.user?.displayName);
    if (!live) void loadCatalog();
  }, lifetime.signal);

  if (!getCachedAuth()) {
    void fetchAuthMe(lifetime.signal).then((fresh) => {
      if (!lifetime.signal.aborted) applySignedInJoinName(fresh.user?.displayName);
    });
  }

  void isSimulatedLocationAllowed(lifetime.signal).then(allowed => {
    demoLocation = allowed;
    if (live?.room.phase === "lobby") render();
  });
  void loadCatalog().catch((error) => {
    if (lifetime.signal.aborted) return;
    reportError(error, { surface: "catalog", action: "load-catalog" }, "catalog");
    render();
  });
  const clock = window.setInterval(updateClocks, 250);
  return () => {
    lifetime.abort();
    closeLobbyDialog();
    stopPresenceWatch();
    releaseWakeLock();
    roomEvents.destroy();
    root.removeAttribute("aria-busy");
    window.clearInterval(clock);
    destroyClaimMap();
    destroyStartMiniMap();
  };
}
