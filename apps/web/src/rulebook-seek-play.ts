import { motionAllowed, playGameMotion } from "./game-motion";
import type { RoomActivityEvent, RoomActivityFeed } from "@kelana-ria/contracts";
import { createRoomActivityUi, formatRelativeAge, freshnessBucket, renderRoomActivity } from "./room-activity";
import type {
  LocationFix,
  GeoCoordinate,
  SeekBoardPoint,
  SeekPublicBoard,
  SeekMapPreview,
  SeekMapPreviewRequest,
  HideSeekQuestionFamily,
  SeekDeckHiderView,
  SeekDeckPublicView,
  SeekEngineRoomView,
  RulebookEntitlementSummary,
} from "@kelana-ria/contracts";
import type { BoardMapHandle, BoardMapOptions, BoardMapUpdateOptions, mountBoardMap } from "./board-map";
import { escapeText } from "./escape-text";
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
} from "./lobby-ui";
import {
  dismissPhaseCue,
  openQuickGuideModal,
  renderOutdoorReadinessStrip,
  renderPhaseCueStrip,
  syncOutdoorReadinessInPlace,
  type PhaseCueKey,
} from "./quick-guide";
import { preparePhotoFile, type PhotoDraftState } from "./photo-capture";
import { createRoomEventBridge, type RoomConnectionState } from "./room-events";
import { answerText, incomingQuestion, questionDeck, questionNames, questionOptions, rewardCard } from "./seek-game-panels";
import "./rulebook-seek-play.css";

type PublicListing = {
  packId: string;
  version: number;
  format: "hide-and-seek";
  isOfficial: boolean;
  title: string;
  byline: string;
  summary: string;
  cityLabel: string;
  difficulty: string;
  priceIdr: number;
  minPlayers: number;
  maxPlayers: number;
  hidingZoneRadiusMeters: number;
  headStartMinutes: number;
  searchLimitMinutes: number;
  regroupMinutes: number;
  stationCount: number;
  startName: string;
  questionFamilies: { family: string; itemCount: number; drawCount: number; keepCount: number }[];
  deckSummary: { totalCards: number; timeBonuses: number; powerups: number; curses: number; baseHandLimit: number };
};

type RoomPayload = {
  activity: RoomActivityFeed;
  stateRev?: number;
  room: SeekEngineRoomView;
  publicBoard: SeekPublicBoard;
  qa?: true;
  draftPlaytest?: true;
  deck: SeekDeckPublicView | SeekDeckHiderView;
  pass: {
    roomCode: string; packId: string; version: number; minPlayers?: number; maxPlayers: number;
    paid: boolean; mode?: "group"; draftPlaytest?: boolean;
  };
};

type CapturedLocation = LocationFix & { qaLocationId?: string };
type QuestionDraft = {
  key: string;
  referenceKey: string;
  query: Omit<SeekMapPreviewRequest, "fix">;
};

type SeekInlineSlot =
  | "catalog"
  | "join"
  | "lobby"
  | "lobby-checkin"
  | "board-checkin"
  | "regroup-checkin"
  | "found-code"
  | "ask-field"
  | "answer-field"
  | "answer-photo"
  | "curse-action";

type SeekInlineError = {
  slot: SeekInlineSlot;
  code: string;
  message: string;
  tone: PlayerErrorTone;
  targetId?: string;
} | null;

type PendingSeekAction = {
  signature: string;
  id: string;
  kind: string;
  cardInstanceId?: string;
  stationId?: string;
  questionId?: string;
  family?: string;
  itemId?: string;
  drawKey?: string;
};

const phaseLabels: Record<SeekEngineRoomView["phase"], string> = {
  lobby: "Ruang Tunggu",
  head_start: "Waktu Sembunyi",
  seeking: "Fase Cari",
  endgame: "Endgame (Zona Terkunci)",
  regroup: "Berkumpul Kembali",
  finished: "Selesai",
  void: "Batal",
  incomplete: "Tidak Lengkap",
  canceled: "Dibatalkan",
};

const familyLabels: Record<HideSeekQuestionFamily, string> = {
  radar: "Radar",
  thermometer: "Termometer",
  matching: "Cocokkan",
  measuring: "Bandingkan",
  tentacles: "Tempat Terdekat",
  photo: "Foto",
};

const questionStatusLabels: Record<string, string> = {
  pending: "Menunggu jawaban",
  answered: "Dijawab",
  cannot_answer_endgame: "Tidak bisa dijawab",
  timeout: "Waktu habis",
  vetoed: "Dibatalkan (Veto)",
  closed: "Ditutup",
};

function questionStatusLabel(status: string): string {
  return questionStatusLabels[status] ?? status;
}

const curseBlockerLabels: Record<string, string> = {
  block_questions: "Blokir pertanyaan",
  block_transit: "Blokir transit",
  block_both: "Blokir pertanyaan & transit",
  block_steals: "Blokir rebut",
  block_claims: "Blokir klaim",
  none: "Tanpa blokir",
};

function curseBlockerLabel(blockerType: string): string {
  return curseBlockerLabels[blockerType] ?? blockerType;
}

const curseClearLabels: Record<string, string> = {
  timer: "Tunggu timer",
  next_n_questions: "Jawab beberapa pertanyaan",
  gps_detour: "Check-in lokasi",
  photo_challenge: "Bukti foto",
  honor_task: "Tugas langsung",
};

function curseClearLabel(clearType: string): string {
  return curseClearLabels[clearType] ?? clearType;
}

function idr(amount: number): string {
  return amount === 0 ? "Gratis (Resmi)" : `Rp ${amount.toLocaleString("id-ID")} · Beli sekali`;
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

export function mountRulebookSeekPlay(root: HTMLElement, onBack: () => void): () => void {
  let listings: PublicListing[] = [];
  let ownedPackIds: string[] = [];
  let entitlements: RulebookEntitlementSummary[] = [];
  let roomCode = new URLSearchParams(location.search).get("room") ?? "";
  let joinCode = roomCode;
  let joinName = resolveDefaultPlayerName(getCachedAuth()?.user?.displayName, "Pemain Baru");
  let joinNameEdited = false;
  let copiedCode = false;
  let copiedLink = false;
  let editingName = false;
  let renameDraft = "";
  let foundCodeDraft = "";
  let live: RoomPayload | null = null;
  let cachedBoard: { code: string; board: SeekPublicBoard } | null = null;
  let roomEtag: { code: string; includeBoard: boolean; value: string } | null = null;
  let activeOrderId: string | null = null;
  let allowHideSeekQa = false;
  let allowSandboxCheckout = false;
  let qaStationId = "";
  let qaAdvanceRetry: { roomCode: string; step: string; expectedDeadline: number | null; actionId: string } | undefined;
  let statusMsg = "";
  let inlineError: SeekInlineError = null;
  let busy = false;
  let mapFailed = false;
  let mapHandle: ReturnType<typeof mountBoardMap> | undefined;
  let mapRoomCode = "";
  let savedCamera: { code: string; camera: NonNullable<BoardMapOptions["camera"]> } | undefined;
  let focusedThermometer = "";
  let seq = 0;
  let roomRequest = 0;
  const lifecycle = new AbortController();
  const toast = createPlayerToast({ signal: lifecycle.signal, layout: "page" });
  type Panel = "ask" | "hand" | "question" | "history" | "activity" | "board" | "qa";
  let panel: Panel | null = "ask";
  let liveEffects: RoomActivityEvent[] = [];
  const activityUi = createRoomActivityUi(lifecycle.signal, notice => {
    if (!live || busy) return;
    panel = notice === "activity" ? "activity"
      : notice.panel === "questions" ? "question"
      : notice.panel === "clues" ? "history"
      : notice.panel === "cards" ? "hand" : "board";
    render();
    root.querySelector<HTMLElement>("[data-activity-heading], #sg-panel-title")?.focus({ preventScroll: true });
  }, events => { liveEffects = events; });
  let family: HideSeekQuestionFamily | null = null;
  let option = "";
  let stationId = "";
  let drawKey = "";
  let pendingId = "";
  let answerChoice = "";
  let radiusDraft = "";
  let previewSequence = 0;
  let previewTimer: number | undefined;
  let previewLoading = "";
  let previewError: { key: string; message: string } | undefined;
  let draftPreview: { key: string; data: SeekMapPreview; fix: CapturedLocation; validUntil?: number } | undefined;
  let draftFix: { referenceKey: string; fix: CapturedLocation; validUntil?: number } | undefined;
  let seekPhotoDraft: PhotoDraftState | null = null;
  let seekPhotoUploading = false;
  let seekPhotoSeq = 0;
  let thermometerEnd: CapturedLocation | undefined;
  let actionPending = false;
  let keepIds = new Set<string>();
  let renderedTurn = "";
  let mapHost: HTMLElement | null = null;
  let mapKey = "";
  let mapRequest = 0;
  let mapConfigRequest: ReturnType<typeof fetchMapConfig> | undefined;
  let connectionState: RoomConnectionState = typeof navigator === "undefined" || navigator.onLine ? "connected" : "offline";
  const roomEvents = createRoomEventBridge({
    signal: lifecycle.signal,
    getActiveRoom: () =>
      live && roomCode && !live.room.outcome
        ? { code: roomCode, stateRev: live.stateRev ?? 0 }
        : null,
    isBusy: () => busy || actionPending,
    onSync: () => refreshRoom(false, true),
    onConnectionChange: (state) => {
      connectionState = state;
      const pill = root.querySelector<HTMLElement>("[data-sg-conn-pill]");
      if (pill) {
        pill.hidden = state === "connected";
        pill.textContent = state === "offline" ? "Luring · menunggu koneksi" : "Menyambungkan ulang…";
      }
    },
  });
  let clockBase = performance.now();
  let roomNow = 0;
  let pendingAction: PendingSeekAction | null = null;
  let focusRestoreTarget: Record<string, string | undefined> | null = null;
  let selfFix: LocationFix | null = null;
  let liveLocationStatus: LiveLocationStatus = "prompt";
  let startMapExpanded = false;
  let startMiniMapHandle: BoardMapHandle | undefined;
  let startMiniMapRoomCode = "";
  let startMiniMapReq = 0;

  function destroyStartMiniMap() {
    startMiniMapReq++;
    startMiniMapHandle?.destroy();
    startMiniMapHandle = undefined;
    startMiniMapRoomCode = "";
  }

  function buildStartMiniMapState(payload: RoomPayload): BoardMapUpdateOptions {
    const sp = payload.room.turnStartPoint;
    return {
      start: { ...sp, x: 50, y: 50 },
      startLabel: "Awal",
      checkpoints: [],
      selfLocation: selfFix ? { latitude: selfFix.latitude, longitude: selfFix.longitude, accuracy: selfFix.accuracy } : undefined,
      checkInTarget: { center: sp, radiusMeters: payload.publicBoard.checkInRadiusMeters },
      onRequestSelfLocation: () => liveLocation.start(),
    };
  }

  async function syncStartMiniMap(host: HTMLElement, payload: RoomPayload) {
    if (startMiniMapHandle && startMiniMapRoomCode === payload.room.code) {
      startMiniMapHandle.update(buildStartMiniMapState(payload));
      return;
    }
    const reqId = ++startMiniMapReq;
    startMiniMapHandle?.destroy();
    startMiniMapHandle = undefined;
    startMiniMapRoomCode = payload.room.code;
    try {
      mapConfigRequest ??= fetchMapConfig(lifecycle.signal);
      const [{ mountBoardMap: mountMap }, mapCfg] = await Promise.all([
        import("./board-map"),
        mapConfigRequest,
      ]);
      if (reqId !== startMiniMapReq || !host.isConnected || !live || live.room.code !== payload.room.code || live.room.phase !== "lobby" || !startMapExpanded) {
        return;
      }
      const handle = mountMap({
        container: host,
        config: mapCfg,
        camera: { center: [payload.room.turnStartPoint.longitude, payload.room.turnStartPoint.latitude], zoom: 15.2 },
        ...buildStartMiniMapState(live),
      });
      if (reqId !== startMiniMapReq) handle.destroy();
      else startMiniMapHandle = handle;
    } catch {
      if (reqId === startMiniMapReq) destroyStartMiniMap();
    }
  }

  function updateLobbyOrRegroupProximityInPlace() {
    if (!live) return;
    if (live.room.phase === "lobby") {
      syncOutdoorReadinessInPlace(root, { fix: selfFix, status: liveLocationStatus });
      const card = root.querySelector<HTMLElement>('[data-testid="lobby-start-card"]');
      if (card) {
        const meter = renderDistanceMeter({
          fix: selfFix,
          target: live.room.turnStartPoint,
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
        if (checkBtn) checkBtn.classList.toggle("loc-btn-ready", meter.proximity.state === "ready");
      }
      if (startMiniMapHandle && startMiniMapRoomCode === live.room.code) {
        startMiniMapHandle.update(buildStartMiniMapState(live));
      }
      return;
    }
    if (live.room.phase === "regroup" && live.room.regroupPoint) {
      const meter = renderDistanceMeter({
        fix: selfFix,
        target: live.room.regroupPoint,
        checkInRadiusMeters: live.publicBoard.checkInRadiusMeters,
        maxGpsAccuracyMeters: live.publicBoard.maxGpsAccuracyMeters,
        status: liveLocationStatus,
        testId: "regroup-distance-meter",
        showEnableChip: true,
      });
      const prev = root.querySelector('[data-testid="regroup-distance-meter"], [data-testid="enable-live-location-btn"], .loc-meter-row');
      if (prev && meter.html) {
        const tmp = document.createElement("div");
        tmp.innerHTML = meter.html;
        const nextEl = tmp.firstElementChild;
        if (nextEl) prev.replaceWith(nextEl);
      }
      const regroupBtn = root.querySelector<HTMLButtonElement>('button[data-action="regroup"]');
      if (regroupBtn) regroupBtn.classList.toggle("loc-btn-ready", meter.proximity.state === "ready");
    }
  }

  // Strictly local self-location watcher: Hide & Seek never transmits watchPosition fixes to the server.
  let isRendering = false;
  const liveLocation = createLiveLocationWatcher({
    signal: lifecycle.signal,
    onFix: (fix) => {
      selfFix = fix;
      if (!live || lifecycle.signal.aborted || isRendering) return;
      if (live.room.phase === "lobby" || live.room.phase === "regroup") {
        updateLobbyOrRegroupProximityInPlace();
        return;
      }
      if (isBoardPhase(live.room)) {
        if (mapHandle && mapRoomCode === live.room.code && mapHost && !mapFailed) {
          mapHandle.update(buildSeekMapState(mapHost, live, mapRequest));
        }
        if (panel === "board") {
          render();
        }
      }
    },
    onStatusChange: (nextStatus) => {
      liveLocationStatus = nextStatus;
      if (!live || lifecycle.signal.aborted || isRendering) return;
      if (live.room.phase === "lobby" || live.room.phase === "regroup") {
        updateLobbyOrRegroupProximityInPlace();
      } else if (isBoardPhase(live.room) && panel === "board") {
        render();
      }
    },
  });
  liveLocationStatus = liveLocation.getStatus();

  function syncLiveLocation() {
    if (!live || live.room.outcome || live.room.phase === "canceled") {
      liveLocation.stop();
      return;
    }
    liveLocation.checkPermissionAndAutoStart();
  }

  function isBoardPhase(room: SeekEngineRoomView) {
    return room.phase === "head_start" || room.phase === "seeking" || room.phase === "endgame";
  }

  function currentSurface(): PlayerErrorSurface {
    if (!live) return "catalog";
    return live.room.phase === "lobby" ? "lobby" : "seek";
  }

  function ensurePendingAction(
    signature: string,
    kind: string,
    meta?: Omit<PendingSeekAction, "signature" | "id" | "kind">,
    persistKey?: string,
  ): PendingSeekAction {
    if (pendingAction?.signature === signature) return pendingAction;
    const restored = persistKey ? readSessionId(persistKey) : undefined;
    const id = restored ?? `seek-${crypto.randomUUID()}`;
    if (persistKey) writeSessionId(persistKey, id);
    pendingAction = { signature, id, kind, ...meta };
    return pendingAction;
  }

  function clearPendingAction(persistKey?: string) {
    pendingAction = null;
    if (persistKey) writeSessionId(persistKey);
  }

  function reconcilePendingAction(payload: RoomPayload) {
    if (!pendingAction) return;
    const { room, deck } = payload;
    const { kind, cardInstanceId, stationId: pendingStation, questionId, family: qFamily, itemId, drawKey: pendingDraw } = pendingAction;
    let resolvedOnServer = false;
    if (kind === "play-card" && cardInstanceId && room.role === "hider") {
      const hiderDeck = deck as SeekDeckHiderView;
      resolvedOnServer = !hiderDeck.hand.some(card => card.instanceId === cardInstanceId);
    } else if (kind === "choose-draw" && room.role === "hider") {
      const activeDraw = (deck as SeekDeckHiderView).activeDraw;
      const nextDrawKey = activeDraw?.cards.map(c => c.instanceId).join(":") ?? "";
      resolvedOnServer = !activeDraw || nextDrawKey !== pendingDraw;
    } else if (kind === "lock-anchor" && pendingStation) {
      resolvedOnServer = room.ownAnchorStationId === pendingStation;
    } else if ((kind === "answer-question" || kind === "answer-photo" || kind === "cannot-answer-endgame") && questionId) {
      resolvedOnServer = !room.questions.some(q => q.id === questionId && q.status === "pending");
    } else if (kind === "ask" && qFamily && itemId) {
      resolvedOnServer = room.questions.some(q => q.status === "pending" && q.family === qFamily && q.itemId === itemId);
    } else if (kind === "start") {
      resolvedOnServer = room.phase !== "lobby";
    } else if (kind === "ready") {
      resolvedOnServer = room.seats.some(seat => seat.seatId === room.seatId && seat.ready);
    } else if (kind === "check-in-start") {
      resolvedOnServer = room.seats.some(seat => seat.seatId === room.seatId && seat.startVerifiedUntil !== null);
    } else if (kind === "confirm-freeze") {
      resolvedOnServer = room.hiderFrozen;
    } else if (kind === "submit-found-code") {
      resolvedOnServer = room.phase !== "endgame";
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
    inlineSlot: SeekInlineSlot,
    targetId?: string,
  ) {
    const resolved = resolvePlayerError(input, {
      surface: context.surface ?? currentSurface(),
      action: context.action,
      target: context.target,
    });
    if (resolved.staleTarget) {
      stationId = "";
    }
    if (resolved.placement === "toast") {
      inlineError = null;
      toast.show(resolved);
    } else {
      toast.clear();
      const slot: SeekInlineSlot = resolved.placement === "inline-screen"
        ? (live ? "lobby" : "catalog")
        : inlineSlot;
      inlineError = {
        slot,
        code: resolved.code,
        message: resolved.message,
        tone: resolved.tone,
        targetId: slot === "curse-action" ? targetId : undefined,
      };
    }
    return resolved;
  }

  function slotAlert(slot: SeekInlineSlot, targetId?: string): string {
    if (!inlineError || inlineError.slot !== slot) return "";
    if (targetId !== undefined && inlineError.targetId !== undefined && inlineError.targetId !== targetId) return "";
    return renderInlineAlert(inlineError.message, inlineError.tone, `data-error-slot="${slot}"`);
  }

  function closeMap() {
    if (live?.room.phase === "regroup") {
      const camera = mapHandle?.getCamera();
      if (camera) savedCamera = { code: live.room.code, camera };
    } else {
      savedCamera = undefined;
    }
    mapRequest++;
    mapHandle?.destroy();
    mapHandle = undefined;
    mapHost = null;
    mapKey = "";
    mapRoomCode = "";
  }

  function clockText(milliseconds: number) {
    const seconds = Math.max(0, Math.ceil(milliseconds / 1000));
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
  }

  function updateClock() {
    const room = live?.room;
    if (!room) return;
    const now = roomNow + performance.now() - clockBase;
    const sendDraft = root.querySelector<HTMLButtonElement>("[data-preview-until]");
    if (sendDraft && now > Number(sendDraft.dataset.previewUntil)) {
      sendDraft.disabled = true;
      const previewStatus = root.querySelector<HTMLElement>("#sg-preview-status");
      if (previewStatus) previewStatus.textContent = "Lokasi pratinjau kedaluwarsa. Perbarui lokasi.";
    }
    root.querySelectorAll<HTMLElement>("[data-deadline]").forEach(element => {
      const text = clockText(Number(element.dataset.deadline) - now);
      if (element.textContent !== text) element.textContent = text;
    });
    root.querySelectorAll<HTMLElement>("[data-activity-at]").forEach(element => {
      const text = formatRelativeAge(Number(element.dataset.activityAt), now);
      if (element.textContent !== text) element.textContent = text;
    });
    const age = root.querySelector<HTMLElement>("#sg-position-age");
    if (age && room.seekerPosition) {
      const bucket = freshnessBucket(room.seekerPosition.at, now);
      const text = formatRelativeAge(room.seekerPosition.at, now, true);
      if (age.textContent !== text) age.textContent = text;
      if (age.dataset.freshness !== bucket) age.dataset.freshness = bucket;
      const seekerPin = mapHost?.querySelector<HTMLElement>('[data-map-point="seeker"]');
      if (seekerPin && seekerPin.dataset.freshness !== bucket) {
        seekerPin.dataset.freshness = bucket;
        seekerPin.classList.remove("board-map-pin-fresh", "board-map-pin-aging", "board-map-pin-stale");
        seekerPin.classList.add(`board-map-pin-${bucket}`);
      }
    }
  }

  function roomPoints({ room, publicBoard }: RoomPayload): SeekBoardPoint[] {
    const points = [room.turnStartPoint, publicBoard.startPoint, ...publicBoard.stations];
    if (room.regroupPoint) points.unshift(room.regroupPoint);
    return [...new Map(points.map(point => [point.id, point])).values()];
  }

  function qaPoint(payload: RoomPayload): SeekBoardPoint {
    return roomPoints(payload).find(point => point.id === qaStationId) ?? payload.room.regroupPoint ?? payload.room.turnStartPoint;
  }

  async function locationFix(point?: GeoCoordinate): Promise<CapturedLocation> {
    const room = live?.room;
    if (live?.qa) {
      const { id, latitude, longitude } = qaPoint(live);
      return { latitude, longitude, accuracy: 10, timestamp: live.room.now, qaLocationId: id };
    }
    if (room && point && await isSimulatedLocationAllowed(lifecycle.signal)) {
      return { latitude: point.latitude, longitude: point.longitude, accuracy: 10, timestamp: room.now };
    }
    const fix = await getLocation();
    liveLocation.setManualFix(fix);
    return fix;
  }

  function pointById(id: string | undefined) {
    return [live?.room.turnStartPoint, ...(live?.publicBoard.stations ?? [])].find(point => point?.id === id);
  }

  function seekerPoint() {
    return pointById(stationId) ?? live?.room.seekerPosition ?? live?.room.turnStartPoint;
  }

  function selectedMapQuestion(): QuestionDraft | undefined {
    const room = live?.room;
    if (!room || room.role !== "seeker" || !room.playPhase || panel !== "ask" ||
        room.questions.some(question => question.status === "pending") ||
        (family !== "radar" && family !== "matching" && family !== "measuring" && family !== "tentacles")) return;
    const selected = room.menu.find(entry => entry.family === family && entry.itemId === option);
    if (!selected?.availableInCurrentPhase || selected.lockedSingleUse) return;
    const customRadiusMeters = selected.isCustomRadius ? Number(radiusDraft) : undefined;
    if (customRadiusMeters !== undefined && (!Number.isFinite(customRadiusMeters) || customRadiusMeters <= 0)) return;
    const referenceKey = JSON.stringify([
      room.code, room.turnNumber, room.phase, live?.qa ? qaPoint(live).id : stationId,
    ]);
    const query = { family, itemId: option, customRadiusMeters };
    return { query, referenceKey, key: JSON.stringify([referenceKey, query]) };
  }

  function activeDraftPreview() {
    return draftPreview?.key === selectedMapQuestion()?.key ? draftPreview : undefined;
  }

  function previewIsFresh(validUntil?: number) {
    return validUntil === undefined || roomNow + performance.now() - clockBase <= validUntil;
  }

  function previewPadding(host: HTMLElement) {
    const dockTop = root.querySelector(".sg-dock")?.getBoundingClientRect().top ?? host.clientHeight;
    const bottom = Math.max(160, Math.min(host.clientHeight - 215, host.clientHeight - dockTop + 24));
    return { top: 136, bottom, left: 34, right: 45 };
  }

  async function updateDraftPreview(updateLocation = false) {
    const draft = selectedMapQuestion();
    if (!draft || (!updateLocation && (draftPreview?.key === draft.key || previewLoading === draft.key))) return;
    const request = ++previewSequence;
    const code = roomCode;
    previewLoading = draft.key;
    previewError = undefined;
    draftPreview = undefined;
    render();
    try {
      const fix = !updateLocation && draftFix?.referenceKey === draft.referenceKey && previewIsFresh(draftFix.validUntil)
        ? draftFix.fix : await locationFix(seekerPoint());
      if (request !== previewSequence || selectedMapQuestion()?.key !== draft.key) return;
      const { ok, status, data: response } = await fetchApiJson<{ preview?: SeekMapPreview; validUntil?: number; error?: string }>("/api/rulebooks/question-preview", {
        signal: lifecycle.signal,
        body: {
          roomCode: code,
          ...draft.query,
          fix,
        },
      });
      if (request !== previewSequence || selectedMapQuestion()?.key !== draft.key) return;
      if (!ok || !response.preview) {
        const resolved = resolvePlayerError(
          { error: response.error ?? "preview-unavailable", status },
          { surface: "seek", action: "question-preview", target: draft.query.itemId },
        );
        previewError = { key: draft.key, message: resolved.message };
        return;
      }
      const validUntil = fix.qaLocationId ? undefined : response.validUntil;
      draftFix = { referenceKey: draft.referenceKey, fix, validUntil };
      draftPreview = { key: draft.key, data: response.preview, fix, validUntil };
    } catch (error) {
      if (lifecycle.signal.aborted) return;
      if (request === previewSequence && selectedMapQuestion()?.key === draft.key) {
        const resolved = resolvePlayerError(error, { surface: "seek", action: "question-preview", target: draft.query.itemId });
        previewError = { key: draft.key, message: resolved.message };
      }
    } finally {
      if (request === previewSequence) {
        previewLoading = "";
        render();
      }
    }
  }

  function syncRoomUrl(code: string) {
    const url = new URL(location.href);
    url.searchParams.set("play", "rulebook-seek");
    url.searchParams.delete("pack");
    url.searchParams.delete("launch");
    if (code) url.searchParams.set("room", code);
    else url.searchParams.delete("room");
    history.replaceState(history.state, "", url);
  }

  async function loadCatalog() {
    const { data } = await fetchApiJson<{
      listings?: PublicListing[];
      ownedPackIds?: string[];
      entitlements?: RulebookEntitlementSummary[];
      allowHideSeekQa?: boolean;
      allowSandboxCheckout?: boolean;
    }>(
      "/api/rulebooks?format=hide-and-seek",
      { signal: lifecycle.signal },
    );
    allowHideSeekQa = data.allowHideSeekQa === true;
    allowSandboxCheckout = data.allowSandboxCheckout === true;
    listings = (data.listings ?? []).filter((l) => l.format === "hide-and-seek");
    ownedPackIds = Array.isArray(data.ownedPackIds) ? data.ownedPackIds : [];
    entitlements = Array.isArray(data.entitlements) ? data.entitlements : [];
    const params = new URLSearchParams(location.search);
    const launchPackId = params.get("pack");
    const shouldLaunch = params.get("launch") === "1";
    if (!roomCode && shouldLaunch && launchPackId) {
      const target = listings.find((l) => l.packId === launchPackId && (l.priceIdr === 0 || ownedPackIds.includes(l.packId)));
      if (target) {
        const isOwnedPaid = target.priceIdr > 0 && ownedPackIds.includes(target.packId);
        const persistKey = `kelana-seek-${isOwnedPaid ? "owned" : "free"}:${target.packId}:${target.version}:0`;
        const pending = ensurePendingAction(`create-${isOwnedPaid ? "owned" : "free"}:${target.packId}:${target.version}:0`, isOwnedPaid ? "create-owned-room" : "create-free-room", undefined, persistKey);
        const { ok, status, data: res } = await fetchApiJson<{ ok?: boolean; roomCode?: string; error?: string }>("/api/rulebooks", {
          signal: lifecycle.signal,
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
          statusMsg = `Ruang ${roomCode} siap dimainkan.`;
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
    const code = roomCode;
    const request = ++roomRequest;
    const requestAction = seq;
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
      (Omit<RoomPayload, "publicBoard"> & { publicBoard?: SeekPublicBoard; error?: string })
    >(path, { signal: lifecycle.signal, headers: reqHeaders, cache: "no-store" });
    if (request !== roomRequest || code !== roomCode || lifecycle.signal.aborted || (background && (busy || requestAction !== seq))) return;
    if (notModified) {
      const serverNow = Number(headers.get("x-server-now"));
      if (Number.isFinite(serverNow) && serverNow > 0) {
        roomNow = serverNow;
        clockBase = performance.now();
        updateClock();
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
      const payload: RoomPayload = { ...data, publicBoard: board };
      const { now, ...next } = payload.room;
      const previous = live;
      const unchanged = Boolean(
        previous &&
        previous.room.code === payload.room.code &&
        previous.room.seatId === payload.room.seatId &&
        previous.room.role === payload.room.role &&
        (previous.activity.prompt?.id ?? null) === (payload.activity.prompt?.id ?? null) &&
        (typeof previous.stateRev === "number" && typeof payload.stateRev === "number"
          ? previous.stateRev === payload.stateRev
          : JSON.stringify({ ...previous, room: { ...previous.room, now: 0 } }) ===
            JSON.stringify({ ...payload, room: { ...next, now: 0 } })),
      );
      roomNow = now;
      clockBase = performance.now();
      live = payload;
      reconcilePendingAction(payload);
      if (
        (payload.room.phase === "lobby" ||
          payload.room.phase === "head_start" ||
          payload.room.phase === "seeking" ||
          payload.room.phase === "endgame" ||
          payload.room.phase === "regroup") &&
        !payload.room.outcome
      ) {
        saveActiveRoom({
          roomCode: payload.room.code,
          format: "hide-and-seek",
          packId: payload.room.packMeta.packId,
          version: payload.room.packMeta.version,
          title: payload.room.packMeta.title,
          phase: payload.room.phase,
          role: payload.room.role,
          turnNumber: payload.room.turnNumber,
          totalPlannedTurns: payload.room.totalPlannedTurns,
          playerCount: payload.room.seats.length,
          maxPlayers: payload.pass.maxPlayers,
        });
      } else {
        clearActiveRoom(payload.room.code);
      }
      if (previous?.room.code !== payload.room.code) {
        qaStationId = payload.qa ? sessionStorage.getItem(`seek-qa-location:${payload.room.code}`) ?? "" : "";
        qaAdvanceRetry = undefined;
      }
      syncRoomUrl(roomCode);
      roomEvents.markSynced();
      if (unchanged) {
        updateClock();
        return;
      }
    } else if (allowInvitePrompt) {
      statusMsg = `Undangan ruang ${roomCode} terdeteksi. Masukkan namamu lalu tekan Gabung Ruang.`;
      inlineError = null;
    } else if (!background) {
      reportError({ error: data.error ?? "room-not-found", status }, { surface: "lobby", action: "load-room", target: code }, "catalog");
    }
    if (!skipRender) render();
  }

  function inlineSlotForSeekAction(action: Record<string, unknown>): SeekInlineSlot {
    const type = String(action.type ?? "");
    if (type === "check-in-start") return "lobby-checkin";
    if (type === "regroup-check-in") return "regroup-checkin";
    if (type === "lock-anchor" || type === "seeker-check-in" || type === "confirm-freeze") return "board-checkin";
    if (type === "submit-found-code") return "found-code";
    if (type === "ask" || type === "start-thermometer") return "ask-field";
    if (type === "answer-question") return "answer-field";
    return live?.room.phase === "lobby" ? "lobby" : "board-checkin";
  }

  async function postRoomAction(action: Record<string, unknown>): Promise<boolean> {
    if (!roomCode) return false;
    const type = String(action.type ?? "action");
    const qId = typeof action.questionId === "string" ? action.questionId : undefined;
    const stId = typeof action.stationId === "string" ? action.stationId : undefined;
    const qFamily = typeof action.family === "string" ? action.family : undefined;
    const itemId = typeof action.itemId === "string" ? action.itemId : undefined;
    const targetKey = qId ?? stId ?? itemId ?? qFamily;
    const signature = JSON.stringify([roomCode, type, stId, qId, qFamily, itemId, action.answerCode, action.code, action.offTransit, action.name, action.ready, action.turnOrder]);
    const pending = ensurePendingAction(signature, type, { stationId: stId, questionId: qId, family: qFamily, itemId });
    const slot = inlineSlotForSeekAction(action);

    ++seq;
    busy = true;
    render();
    try {
      const { ok, status, data: res } = await fetchApiJson<{ room?: SeekEngineRoomView; error?: string }>("/api/rulebooks", {
        signal: lifecycle.signal,
        body: {
          type: "room-action",
          roomCode,
          action: { actionId: pending.id, ...action },
        },
      });
      clearPendingAction();
      if (res.error || !ok) {
        reportError({ error: res.error ?? "invalid-request", status }, { action: type, target: targetKey }, slot);
        await refreshRoom(false, false, true).catch(() => {});
        return false;
      }
      inlineError = null;
      toast.clear();
      toast.resetDedupe();
      if (type === "submit-found-code") foundCodeDraft = "";
      await refreshRoom(false, false, true).catch(() => {});
      return true;
    } catch (error) {
      if (lifecycle.signal.aborted) return false;
      const resolved = reportError(error, { action: type, target: targetKey }, slot);
      if (!resolved.uncertain) clearPendingAction();
      return false;
    } finally {
      busy = false;
      render();
    }
  }

  async function postDeckAction(action: Record<string, unknown>) {
    if (!roomCode) return;
    const kind = String(action.kind ?? "deck-action");
    const curseId = typeof action.curseInstanceId === "string" ? action.curseInstanceId : undefined;
    const signature = JSON.stringify([roomCode, "deck", kind, curseId, action.keepInstanceIds, action.approve]);
    const pending = ensurePendingAction(signature, kind, { drawKey });
    const slot: SeekInlineSlot = curseId ? "curse-action" : "board-checkin";

    ++seq;
    busy = true;
    render();
    try {
      const { ok, status, data: res } = await fetchApiJson<{ ok?: boolean; error?: string }>("/api/rulebooks", {
        signal: lifecycle.signal,
        body: {
          type: "deck-action",
          roomCode,
          action: { actionId: pending.id, ...action },
        },
      });
      clearPendingAction();
      if (res.error || !ok) {
        reportError({ error: res.error ?? "unknown-deck-action", status }, { action: kind, target: curseId }, slot, curseId);
      } else {
        inlineError = null;
        toast.clear();
        toast.resetDedupe();
      }
      await refreshRoom(false, false, true).catch(() => {});
    } catch (error) {
      if (lifecycle.signal.aborted) return;
      const resolved = reportError(error, { action: kind, target: curseId }, slot, curseId);
      if (!resolved.uncertain) clearPendingAction();
    } finally {
      busy = false;
      render();
    }
  }

  async function postPlayCard(params: Record<string, unknown>) {
    if (!roomCode) return;
    const cardInstanceId = typeof params.cardInstanceId === "string" ? params.cardInstanceId : undefined;
    const targetStationId = typeof params.targetStationId === "string" ? params.targetStationId : undefined;
    const signature = JSON.stringify([roomCode, "play-card", cardInstanceId, targetStationId]);
    const pending = ensurePendingAction(signature, "play-card", { cardInstanceId, stationId: targetStationId });

    ++seq;
    busy = true;
    render();
    try {
      const { ok, status, data: res } = await fetchApiJson<{ ok?: boolean; error?: string }>("/api/rulebooks", {
        signal: lifecycle.signal,
        body: {
          type: "play-card",
          roomCode,
          actionId: pending.id,
          params,
        },
      });
      clearPendingAction();
      if (res.error || !ok) {
        reportError({ error: res.error ?? "card-not-playable", status }, { action: "play-card", target: cardInstanceId ?? targetStationId }, "board-checkin");
      } else {
        inlineError = null;
        toast.clear();
        toast.resetDedupe();
      }
      await refreshRoom(false, false, true).catch(() => {});
    } catch (error) {
      if (lifecycle.signal.aborted) return;
      const resolved = reportError(error, { action: "play-card", target: cardInstanceId ?? targetStationId }, "board-checkin");
      if (!resolved.uncertain) clearPendingAction();
    } finally {
      busy = false;
      render();
    }
  }

  function buildSeekMapState(
    host: HTMLElement,
    { room, publicBoard }: RoomPayload,
    mountSeq: number,
  ) {
    const point = (p: SeekBoardPoint) => ({ ...p, x: 50, y: 50 });
    const anchor = room.role === "hider" && publicBoard.stations.find(station => station.id === room.ownAnchorStationId);
    const seeker = room.seekerPosition;
    const clues = room.questions.filter(question => question.askedAt >= (room.deductionResetAt ?? 0));
    const pending = clues.find(question => question.status === "pending");
    const overlays = clues.flatMap(question => question.overlay ? [question.overlay] : []);
    const radarCircles = clues.flatMap(question => question.overlay?.type === "circle" ? [{
      id: question.id,
      center: point({ ...question.overlay.center, id: question.id, name: question.label }),
      radiusMeters: question.overlay.radiusMeters,
      inside: question.overlay.inside,
    }] : []);
    const preview = room.role === "hider" && pending?.radarRadiusMeters && pending.privateComputedAnswer
      ? [{ id: pending.id, center: point({ ...pending.referencePoint, id: pending.id, name: pending.label }),
          radiusMeters: pending.radarRadiusMeters, inside: answerChoice === "yes",
          preview: !answerChoice ? "pending" as const : answerChoice === pending.privateComputedAnswer.code ? "correct" as const : "incorrect" as const }]
      : [];
    const lastThermometer = [...clues].reverse().find(question => question.thermometerStart && question.status !== "vetoed");
    const thermometer = room.thermometerStart ? { start: room.thermometerStart, end: thermometerEnd }
      : lastThermometer?.thermometerStart ? { start: lastThermometer.thermometerStart, end: lastThermometer.referencePoint } : undefined;
    const thermKey = thermometer?.end ? JSON.stringify([
      room.code, room.turnNumber, thermometer.start.latitude, thermometer.start.longitude,
      thermometer.end.latitude, thermometer.end.longitude,
    ]) : "";
    const focusPoints = thermometer?.end && thermKey !== focusedThermometer
      ? [thermometer.start, thermometer.end] : undefined;
    focusedThermometer = thermKey;
    const dockTop = root.querySelector(".sg-dock")?.getBoundingClientRect().top ?? host.clientHeight;
    const bottom = focusPoints ? Math.max(164, Math.min(host.clientHeight - 178, host.clientHeight - dockTop + 25))
      : Math.min(228, Math.floor(host.clientHeight / 3));
    const canHide = room.role === "hider" && ((room.phase === "head_start" && !room.ownAnchorStationId) || room.moveZoneUntil !== undefined);
    const candidates = room.candidateStationIds && new Set(room.candidateStationIds);
    const selectedTargetPoint =
      [room.turnStartPoint, ...publicBoard.stations].find((p) => p.id === stationId) ??
      (anchor || undefined);
    const checkInTarget = selectedTargetPoint
      ? { center: selectedTargetPoint, radiusMeters: publicBoard.checkInRadiusMeters }
      : undefined;

    return {
      focusPoints,
      start: point(room.turnStartPoint),
      startLabel: "Awal",
      fitPadding: { top: 147, bottom, left: 36, right: 45 },
      startSelectable: room.role === "seeker" || (canHide && publicBoard.stations.some(station => station.id === room.turnStartPoint.id)),
      selectedId: stationId || undefined,
      selfLocation: selfFix ? { latitude: selfFix.latitude, longitude: selfFix.longitude, accuracy: selfFix.accuracy } : undefined,
      checkInTarget,
      onRequestSelfLocation: () => liveLocation.start(),
      deductionBoundary: publicBoard.boundaryPolygon,
      thermometer,
      checkpoints: [
        ...publicBoard.stations.filter(station => station.id !== room.turnStartPoint.id)
          .map(station => ({ ...point(station), selectable: canHide || room.role === "seeker", dimmed: candidates ? !candidates.has(station.id) : false,
            markerKind: "station" as const, markerText: station.id === room.ownAnchorStationId ? "◆" : "•",
            label: station.id === room.ownAnchorStationId ? "Lokasi terkunci" : undefined })),
        ...(seeker
          ? (() => {
              const bucket = freshnessBucket(seeker.at, roomNow + performance.now() - clockBase);
              return [{
                ...point({ ...seeker, id: "seeker", name: seeker.seatId === room.seatId ? "Kamu" : "Pencari" }),
                markerKind: "seeker" as const,
                markerText: "◎",
                label: "Check-in",
                freshness: bucket,
                dataAttrs: { "data-freshness": bucket },
              }];
            })()
          : []),
        ...(thermometer ? [{ ...point({ ...thermometer.start, id: "thermometer-a", name: "Titik A" }), markerKind: "thermometer" as const, markerText: "A" }] : []),
        ...(thermometer?.end ? [{ ...point({ ...thermometer.end, id: "thermometer-b", name: "Titik B" }), markerKind: "thermometer" as const, markerText: "B" }] : []),
      ],
      radarCircles: [...radarCircles, ...preview],
      deductionOverlays: overlays.filter(overlay => overlay.type !== "circle"),
      hidingZone: anchor && room.ownHidingZoneRadiusMeters ? { center: anchor, radiusMeters: room.ownHidingZoneRadiusMeters } : undefined,
      onSelect: (id: string) => {
        if (busy || actionPending) return;
        stationId = id;
        if (panel === "ask" && family) {
          void updateDraftPreview();
          return;
        }
        panel = "board";
        render();
        root.querySelector<HTMLElement>("#sg-panel-title")?.focus({ preventScroll: true });
      },
      onError: () => queueMicrotask(() => {
        if (mountSeq !== mapRequest || mapFailed) return;
        mapFailed = true;
        const latestRoom = live?.room;
        const latestPending = latestRoom?.questions.find(q => q.status === "pending");
        if (!latestRoom || latestRoom.role !== "hider" || panel !== "hand" || (!latestPending && !(live?.deck as SeekDeckHiderView | undefined)?.activeDraw)) {
          panel = "board";
        }
        render();
      }),
    };
  }

  async function mountMapOverlay(host: HTMLElement, payload: RoomPayload) {
    const code = payload.room.code;
    if (mapHandle && code === mapRoomCode) {
      const nextState = buildSeekMapState(host, payload, mapRequest);
      mapHandle.update(nextState);
      mapHandle.setQuestionPreview(activeDraftPreview()?.data, previewPadding(host));
      return;
    }
    const current = ++mapRequest;
    const camera = savedCamera?.code === code ? savedCamera.camera : undefined;
    savedCamera = undefined;
    mapRoomCode = code;
    mapHandle?.destroy();
    mapHandle = undefined;
    try {
      const [{ mountBoardMap }, config] = await Promise.all([
        import("./board-map"),
        mapConfigRequest ??= fetchMapConfig(lifecycle.signal),
      ]);
      const latest = live ?? payload;
      if (current !== mapRequest || !host.isConnected) return;
      const state = buildSeekMapState(host, latest, current);
      const handle = mountBoardMap({
        container: host,
        config,
        ...state,
        camera: state.focusPoints ? undefined : camera,
      });
      mapHandle = handle;
      handle.setQuestionPreview(activeDraftPreview()?.data, previewPadding(host));
    } catch {
      if (current !== mapRequest) return;
      mapFailed = true;
      if (payload.room.role !== "hider" || panel !== "hand") panel = "board";
      render();
    }
  }

  function renderCatalog(): string {
    return `<section class="rb-shell" aria-label="Katalog Hide & Seek">
      <div class="rb-card">
        <h2>Hide &amp; Seek (2–6 Pemain)</h2>
        <p>Pilih edisi resmi gratis atau paket buatan komunitas. Sembunyi di stasiun, kumpulkan petunjuk, dan mainkan kartu.</p>
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
          <label class="rb-field"><span>Kode Ruang</span><input id="rb-join-code" placeholder="RB-XXXXXX" value="${escapeText(joinCode)}"></label>
          <label class="rb-field"><span>Nama Pemain</span><input id="rb-join-name" value="${escapeText(joinName)}"></label>
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
              <span class="rb-badge">${item.minPlayers}–${item.maxPlayers} pemain</span>
              <span class="rb-badge">Zona ${item.hidingZoneRadiusMeters} m</span>
              <span class="rb-badge">${item.stationCount} stasiun</span>
            </div>
            <h3>${escapeText(item.title)} <small>v${item.version}</small></h3>
            <p>${escapeText(item.summary)}</p>
            <p><small>Oleh ${escapeText(item.byline)} · Mulai: ${escapeText(item.startName)} · Sembunyi ${item.headStartMinutes} mnt · Cari ${item.searchLimitMinutes} mnt · Kumpul ${item.regroupMinutes} mnt</small></p>
            <p><small>Dek: ${item.deckSummary.totalCards} kartu (${item.deckSummary.timeBonuses} bonus, ${item.deckSummary.powerups} powerup, ${item.deckSummary.curses} kutukan · batas tangan ${item.deckSummary.baseHandLimit})</small></p>
            <div class="rb-badges">
              ${item.questionFamilies.map((f) => `<span class="rb-badge">${escapeText(questionNames[f.family as HideSeekQuestionFamily] ?? f.family)} (${f.itemCount} · Ambil ${f.drawCount}/${f.keepCount})</span>`).join("")}
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
            ${allowHideSeekQa && item.priceIdr === 0
              ? `<button type="button" class="secondary" data-action="start-qa" data-pack="${escapeText(item.packId)}" data-version="${item.version}" ${busy ? "disabled" : ""}>Buat Ruang QA</button>` : ""}
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

  function renderQaControls(payload: RoomPayload): string {
    const { room } = payload;
    const host = room.seats.some(seat => seat.seatId === room.seatId && seat.isHost);
    const point = qaPoint(payload);
    return `<h2 id="sg-panel-title" tabindex="-1">Mode QA</h2>
      <label class="rb-field">Lokasi simulasi kamu
        <select id="sg-qa-location" ${busy ? "disabled" : ""}>
          ${roomPoints(payload).map(location => `<option value="${escapeText(location.id)}" ${location.id === point.id ? "selected" : ""}>${escapeText(location.name)}</option>`).join("")}
        </select>
      </label>
      <p class="sg-qa-note">Aksi berbasis GPS memakai lokasi ini sampai kamu memilih titik lain.</p>
      ${host && room.phaseEndsAt !== null ? `<div class="sg-qa-clock">
        <p>Majukan waktu untuk semua pemain di ruang ini</p>
        <div class="rb-actions">
          <button type="button" class="sg-pick" data-action="qa-advance" data-step="minute" ${busy ? "disabled" : ""}>+1 menit</button>
          <button type="button" class="sg-pick" data-action="qa-advance" data-step="five-minutes" ${busy ? "disabled" : ""}>+5 menit</button>
          <button type="button" class="sg-pick" data-action="qa-advance" data-step="phase-end" ${busy ? "disabled" : ""}>Akhir fase</button>
        </div>
      </div>` : !host ? '<p class="sg-qa-note">Host mengatur waktu ruang.</p>' : ""}
    `;
  }

  function destructiveExitSpec(payload: RoomPayload): {
    label: string;
    title: string;
    body: string;
    toastText: string;
  } | null {
    const { room, pass } = payload;
    if (room.outcome) return null;
    const own = room.seats.find((s) => s.seatId === room.seatId);
    if (!own) return null;
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
    return {
      label: "Menyerah & Keluar",
      title: "Menyerah dan keluar dari permainan?",
      body: "Keluar di tengah pertandingan akan mengakhiri sesi Hide & Seek ini sebagai menyerah untuk seluruh ruang.",
      toastText: "Kamu keluar dari permainan.",
    };
  }

  function orderedSeekSeats(room: SeekEngineRoomView): SeekEngineRoomView["seats"] {
    const byId = new Map(room.seats.map((s) => [s.seatId, s]));
    const ordered: SeekEngineRoomView["seats"] = [];
    for (const id of room.turnOrder) {
      const seat = byId.get(id);
      if (seat) {
        ordered.push(seat);
        byId.delete(id);
      }
    }
    for (const seat of byId.values()) ordered.push(seat);
    return ordered;
  }

  function isDraftPlaytest(payload: RoomPayload | null): boolean {
    return Boolean(payload?.draftPlaytest || payload?.pass?.draftPlaytest);
  }

  function draftStudioUrl(pass: RoomPayload["pass"]): string {
    return `/?play=rulebook-studio&studio=editor&format=hide-and-seek&draft=${encodeURIComponent(pass.packId)}&version=${pass.version}`;
  }

  function renderRoomMenu(): string {
    const open = root.querySelector<HTMLDetailsElement>(".sg-room-menu")?.open;
    const exitSpec = live ? destructiveExitSpec(live) : null;
    const backStudio = live && isDraftPlaytest(live)
      ? `<a class="cg-menu-link" data-testid="menu-back-to-studio" href="${draftStudioUrl(live.pass)}">← Kembali ke Studio</a>`
      : "";
    return `<details class="sg-room-menu" ${open ? "open" : ""}>
      <summary class="sg-quiet" aria-label="Menu permainan" title="Menu permainan"><span aria-hidden="true">⋯</span></summary>
      <div class="sg-room-menu-actions">
        ${backStudio}
        <button type="button" data-action="open-quick-guide" data-testid="menu-quick-guide-btn">? Panduan</button>
        ${live && isBoardPhase(live.room) ? '<button type="button" data-action="game-panel" data-panel="activity">Aktivitas terbaru</button>' : ""}
        <button type="button" data-action="refresh">Muat ulang</button>
        <button type="button" data-nav="catalog">Kembali ke Katalog</button>
        ${exitSpec ? `<button type="button" class="lobby-danger-btn" data-action="confirm-leave" data-testid="menu-leave-btn">${escapeText(exitSpec.label)}</button>` : ""}
      </div>
    </details>`;
  }

  function renderRoom(payload: RoomPayload): string {
    const { room, pass } = payload;
    if (room.phase === "canceled") {
      clearActiveRoom(room.code);
      return renderCanceledRoomCard({ roomCode: room.code, title: room.packMeta.title });
    }
    const isHider = room.role === "hider";
    const ownSeat = room.seats.find((s) => s.seatId === room.seatId);
    const isHost = Boolean(ownSeat?.isHost);
    const minPlayers = pass.minPlayers ?? 2;
    const enoughPlayers = room.seats.length >= minPlayers;
    const seatsOrdered = orderedSeekSeats(room);
    const inviteUrl = `${location.origin}/?play=rulebook-seek&room=${encodeURIComponent(room.code)}`;
    const exitSpec = destructiveExitSpec(payload);
    const isDraft = isDraftPlaytest(payload);

    return `<section class="rb-shell" aria-label="Permainan Hide & Seek">
      <div class="rb-card">
        <div class="sg-room-header">
          <div class="rb-badges">
            <span class="rb-badge">Kode: ${escapeText(room.code)}</span>
            <span class="rb-badge">${escapeText(phaseLabels[room.phase])}</span>
            <span class="rb-badge">Giliran ${room.turnNumber}/${room.totalPlannedTurns}</span>
            <span class="rb-badge">Peran: ${escapeText(isHider ? "Penyembunyi" : room.role === "seeker" ? "Pencari" : "Lobi")}</span>
            ${isDraft ? '<span class="rb-badge sg-qa-badge" data-testid="draft-playtest-badge">Uji Draf</span>' : payload.qa ? '<span class="rb-badge sg-qa-badge" data-testid="seek-qa-badge">Ruang QA</span>' : ""}
            ${isDraft ? "" : pass.paid ? '<span class="rb-badge rb-badge-paid">Pass Berbayar</span>' : '<span class="rb-badge">Resmi Gratis</span>'}
          </div>
          <div class="qg-header-tools">
            ${room.phase === "lobby" ? '<button type="button" class="qg-trigger-btn" data-action="open-quick-guide" data-testid="lobby-quick-guide-btn">? Panduan</button>' : ""}
            ${renderRoomMenu()}
          </div>
        </div>
        <h2>${escapeText(room.packMeta.title)}</h2>
        ${isDraft ? `<div class="cg-draft-bar-head" data-testid="draft-playtest-bar"><a class="cg-back-studio-link" data-testid="back-to-studio-btn" href="${draftStudioUrl(pass)}">← Kembali ke Studio</a></div>` : ""}
        ${statusMsg ? `<p role="status">${escapeText(statusMsg)}</p>` : ""}
        ${slotAlert("lobby")}
        ${allowHideSeekQa && !payload.qa && !pass.paid && room.phase === "lobby" && isHost
          ? `<div class="rb-actions"><button type="button" class="secondary" data-action="start-qa" data-pack="${escapeText(pass.packId)}" data-version="${pass.version}" ${busy ? "disabled" : ""}>Buat Ruang QA dari Paket Ini</button></div>` : ""}
      </div>

      ${(room.outcome || room.phase === "regroup") && payload.activity.events.length
        ? `<details class="rb-card rb-accordion"><summary>Aktivitas terbaru</summary>${renderRoomActivity(payload.activity, roomNow + performance.now() - clockBase)}</details>` : ""}

      ${payload.qa && !room.outcome ? `<section class="rb-card" aria-label="Kontrol QA">${renderQaControls(payload)}</section>` : ""}

      ${
        room.phase === "lobby"
          ? (() => {
              const startCard = renderStartPointCard({
                startPoint: room.turnStartPoint,
                fix: selfFix,
                checkInRadiusMeters: payload.publicBoard.checkInRadiusMeters,
                maxGpsAccuracyMeters: payload.publicBoard.maxGpsAccuracyMeters,
                status: liveLocationStatus,
                mapExpanded: startMapExpanded,
                mapHostId: "sg-start-minimap",
              });
              return `<div class="rb-card">
              ${renderPhaseCueStrip("seek-lobby")}
              ${renderOutdoorReadinessStrip({ fix: selfFix, status: liveLocationStatus })}
              ${startCard.html}
              ${renderLobbyInviteCard({ roomCode: room.code, inviteUrl, copiedCode, copiedLink })}
              <div class="lobby-team-head">
                <h3>Kursi Pemain (${room.seats.length}/${pass.maxPlayers})</h3>
                ${isHost && seatsOrdered.length >= 2
                  ? `<button type="button" class="secondary" data-action="shuffle-turns" data-testid="shuffle-turns-btn" ${busy ? "disabled" : ""}>Acak</button>`
                  : ""}
              </div>
              <ul class="rb-list" data-testid="seek-turn-list">
                ${seatsOrdered
                  .map((s, idx) => {
                    const isSelf = s.seatId === room.seatId;
                    return `<li data-seat-row="${escapeText(s.seatId)}">
                      <div class="lobby-seat-row">
                        <div class="lobby-seat-main">
                          <span class="lobby-turn-badge">Giliran ${idx + 1}</span>
                          <strong>${escapeText(s.name)}</strong>${s.isHost ? " · Host" : ""}${isSelf ? " · Kamu" : ""} · ${s.ready ? "Siap" : "Belum siap"}
                        </div>
                        <div class="lobby-seat-controls">
                          ${isSelf && !editingName ? `<button type="button" class="secondary lobby-icon-btn" data-action="edit-name" data-testid="edit-own-name" aria-label="Ubah nama pemain">✎</button>` : ""}
                          ${isHost && seatsOrdered.length >= 2 ? `
                            <button type="button" class="secondary lobby-icon-btn" data-action="move-turn" data-seat="${escapeText(s.seatId)}" data-dir="-1" aria-label="Naikkan giliran ${escapeText(s.name)}" ${busy || idx === 0 ? "disabled" : ""}>↑</button>
                            <button type="button" class="secondary lobby-icon-btn" data-action="move-turn" data-seat="${escapeText(s.seatId)}" data-dir="1" aria-label="Turunkan giliran ${escapeText(s.name)}" ${busy || idx === seatsOrdered.length - 1 ? "disabled" : ""}>↓</button>
                          ` : ""}
                        </div>
                      </div>
                      ${isSelf && editingName ? `<div class="lobby-rename-form">
                        <input id="sg-rename-input" type="text" maxlength="32" value="${escapeText(renameDraft)}" placeholder="Nama pemain" aria-label="Nama pemain baru">
                        <button type="button" class="primary" data-action="save-name" data-testid="save-own-name">Simpan</button>
                        <button type="button" class="secondary" data-action="cancel-name">Batal</button>
                      </div>` : ""}
                    </li>`;
                  })
                  .join("")}
              </ul>
              ${slotAlert("lobby-checkin")}
              <div class="rb-actions">
                <button type="button" class="secondary${startCard.proximity.state === "ready" ? " loc-btn-ready" : ""}" data-action="sim-start-checkin">Check-in di ${escapeText(room.turnStartPoint.name)}</button>
                ${ownSeat?.ready
                  ? `<button type="button" class="secondary" data-action="unmark-ready">Batal Siap</button>`
                  : `<button type="button" class="primary" data-action="mark-ready">Tandai Siap</button>`}
                ${isHost
                  ? `<button type="button" class="primary" data-action="start-match" ${enoughPlayers ? "" : "disabled"}>Mulai Permainan</button>`
                  : `<span class="lobby-wait-pill" role="status" data-testid="seek-wait-host">Menunggu Host memulai…</span>`}
              </div>
              ${!enoughPlayers ? `<p role="status">Undang pemain hingga ruang berisi setidaknya ${minPlayers} pemain.</p>` : ""}
              ${exitSpec ? `<div class="lobby-footer-exit">
                <button type="button" class="secondary lobby-danger-btn" data-action="confirm-leave" data-testid="lobby-leave-btn">${escapeText(exitSpec.label)}</button>
              </div>` : ""}
            </div>`;
            })()
          : ""
      }

      ${room.outcome ? `<div class="rb-card" data-testid="seek-outcome">
        <h3>Hasil permainan</h3>
        <p>${escapeText(room.seats.find(seat => seat.seatId === room.outcome?.winnerSeatId)?.name ?? "Tidak ada pemenang")}</p>
        <ul class="rb-list">${room.turns.map(turn => `<li>
          <strong>${escapeText(room.seats.find(seat => seat.seatId === turn.hiderSeatId)?.name ?? "Penyembunyi")}</strong>
          <span>${clockText(turn.adjustedMs)}</span></li>`).join("")}</ul>
        ${renderPostMatchActions({
          roomCode: room.code,
          packId: pass.packId,
          version: pass.version,
          started: room.startedAt !== null,
          canPlayAgain: !pass.paid || isHost || ownedPackIds.includes(pass.packId),
          busy,
        })}
      </div>` : ""}

      ${room.phase === "regroup" ? (() => {
        const regroupMeter = room.regroupPoint
          ? renderDistanceMeter({
              fix: selfFix,
              target: room.regroupPoint,
              checkInRadiusMeters: payload.publicBoard.checkInRadiusMeters,
              maxGpsAccuracyMeters: payload.publicBoard.maxGpsAccuracyMeters,
              status: liveLocationStatus,
              testId: "regroup-distance-meter",
              showEnableChip: true,
            })
          : null;
        return `<div class="rb-card" data-testid="seek-regroup-card">
        <h3>Berkumpul Kembali</h3>
        ${room.regroupPoint ? `<p>Titik awal berikutnya · <strong>${escapeText(room.regroupPoint.name)}</strong></p>` : ""}
        ${room.phaseEndsAt === null ? "" : `<p>Sisa waktu berkumpul · <span data-deadline="${room.phaseEndsAt}"></span></p>`}
        ${room.regroupPoint ? `<div class="cg-selected-meta-actions">
          ${regroupMeter?.html ?? ""}
          ${renderDirectionsLink(room.regroupPoint, { testId: "regroup-directions-link" })}
        </div>` : ""}
        ${slotAlert("regroup-checkin")}
        <button type="button" class="primary${regroupMeter?.proximity.state === "ready" ? " loc-btn-ready" : ""}" data-action="regroup">Check-in untuk giliran berikutnya</button>
      </div>`;
      })() : ""}

      <div class="rb-card">
        <h3>Riwayat Petunjuk (${room.questions.length})</h3>
        <ul class="rb-list">
          ${
            room.questions.length === 0
              ? "<li>Belum ada petunjuk yang diajukan pada giliran ini.</li>"
              : room.questions
                  .map(
                    (q) => `<li>
                      <strong>${escapeText(familyLabels[q.family])} · ${escapeText(q.label)}</strong>
                      <small>${escapeText(questionStatusLabel(q.status))}${q.answerLabel ? ` · ${escapeText(answerText(q.answerLabel))}` : ""}</small>
                    </li>`,
                  )
                  .join("")
          }
        </ul>
      </div>
    </section>`;
  }

  function renderCurses({ room, deck }: RoomPayload) {
    const isHider = room.role === "hider";
    return deck.activeCurses.length > 0
          ? `<div class="rb-card">
              <h3>Kutukan Aktif (${deck.activeCurses.length})</h3>
              <ul class="rb-list">
                ${deck.activeCurses
                  .map((c) => {
                    const penalty = c.effectModifiers.find((m) => m.type === "skip_penalty_minutes");
                    const autoApproveSec = c.pendingPhoto
                      ? Math.max(0, Math.ceil((c.pendingPhoto.autoApproveAt - room.now) / 1000))
                      : null;
                    return `<li>
                      <span class="rb-badge rb-badge-danger">${escapeText(c.title)}</span>
                      <p>${escapeText(c.description)}</p>
                      <small>${escapeText(curseBlockerLabel(c.blockerType))} · Cara lepas: ${escapeText(curseClearLabel(c.clearCondition.type))}</small>
                      ${
                        c.pendingPhoto
                          ? `<p><small>Foto bukti terkirim · Otomatis disetujui dalam ${autoApproveSec} dtk</small></p>`
                          : ""
                      }
                      ${slotAlert("curse-action", c.curseInstanceId)}
                      <div class="rb-actions">
                        ${
                          !isHider && c.clearCondition.type === "gps_detour"
                            ? `<button type="button" class="primary" data-action="clear-curse-gps" data-curse="${escapeText(c.curseInstanceId)}">Check-in Lokasi</button>`
                            : ""
                        }
                        ${
                          !isHider && c.clearCondition.type === "photo_challenge" && !c.pendingPhoto
                            ? `<button type="button" class="primary" data-action="submit-curse-photo" data-curse="${escapeText(c.curseInstanceId)}">Kirim Foto Bukti</button>`
                            : ""
                        }
                        ${
                          !isHider && c.clearCondition.type === "honor_task"
                            ? `<button type="button" class="primary" data-action="clear-curse-honor" data-curse="${escapeText(c.curseInstanceId)}">Selesaikan Tugas</button>`
                            : ""
                        }
                        ${
                          !isHider && penalty && penalty.type === "skip_penalty_minutes"
                            ? `<button type="button" class="secondary" data-action="buyout-curse" data-curse="${escapeText(c.curseInstanceId)}">Lewati (+${penalty.penaltyMinutes} mnt)</button>`
                            : ""
                        }
                        ${
                          isHider && c.pendingPhoto
                            ? `<button type="button" class="primary" data-action="review-curse-photo" data-curse="${escapeText(c.curseInstanceId)}" data-approve="true">Setujui Foto</button>
                               <button type="button" class="secondary" data-action="review-curse-photo" data-curse="${escapeText(c.curseInstanceId)}" data-approve="false">Tolak Foto</button>`
                            : ""
                        }
                      </div>
                    </li>`;
                  })
                  .join("")}
              </ul>
            </div>`
          : "";
  }

  function renderBoardControls(payload: RoomPayload) {
    const { room, publicBoard } = payload;
    const isHider = room.role === "hider";
    const canHide = isHider && ((room.phase === "head_start" && !room.ownAnchorStationId) || room.moveZoneUntil !== undefined);
    const checkpoints = canHide ? publicBoard.stations : [room.turnStartPoint, ...publicBoard.stations.filter(point => point.id !== room.turnStartPoint.id)];
    const selectedId = stationId || (payload.qa ? qaPoint(payload).id : "");
    const selected = checkpoints.find(station => station.id === selectedId);
    const ownAnchor = isHider && room.ownAnchorStationId
      ? publicBoard.stations.find(station => station.id === room.ownAnchorStationId)
      : undefined;
    const focusStation = selected ?? ownAnchor ?? room.turnStartPoint;
    const stationMeter = focusStation
      ? renderDistanceMeter({
          fix: selfFix,
          target: focusStation,
          checkInRadiusMeters: publicBoard.checkInRadiusMeters,
          maxGpsAccuracyMeters: publicBoard.maxGpsAccuracyMeters,
          status: liveLocationStatus,
          testId: "seek-station-distance-meter",
          showEnableChip: true,
        })
      : null;
    const readyClass = stationMeter?.proximity.state === "ready" ? " loc-btn-ready" : "";
    const stationList = mapFailed && (canHide || !isHider) ? `<div class="sg-picks" role="group" aria-label="Pilih titik">${checkpoints.map(station => {
      const dist = selfFix ? ` · ${formatDistanceShort(haversineMeters(selfFix, station))}` : "";
      return `<button type="button" class="sg-pick" data-action="select-station" data-station="${escapeText(station.id)}" aria-pressed="${station.id === selected?.id}">${escapeText(station.name)}${dist}</button>`;
    }).join("")}</div>` : "";
    return `<h2 id="sg-panel-title" tabindex="-1">${canHide ? "Pilih tempat sembunyi" : selected ? escapeText(selected.name) : "Check-in"}</h2>
      ${room.phase === "head_start" ? `<p>${isHider ? (canHide ? "Pilih stasiun pada peta, lalu kunci lokasi sebelum pencarian dimulai." : "Lokasi terkunci. Tetap di zona sampai waktu sembunyi habis.") : "Pencarian dimulai saat waktu sembunyi habis."}</p>` : ""}
      ${focusStation ? `<div class="cg-selected-meta-actions">
        ${stationMeter?.html ?? ""}
        ${renderDirectionsLink(focusStation, { testId: "seek-station-directions-link" })}
      </div>` : ""}
      ${mapFailed ? '<p role="status">Peta tidak tersedia. Pilih titik dari daftar.</p><button type="button" class="sg-quiet" data-action="retry-map">Muat ulang peta</button>' : ""}
      ${stationList}
      ${slotAlert("board-checkin")}
      ${canHide && selected ? `<button type="button" class="sg-main${readyClass}" data-action="lock-anchor" data-station="${escapeText(selected.id)}" ${busy ? "disabled" : ""}>Kunci lokasi</button>` : ""}
      ${!isHider && room.phase === "seeking" ? `<button type="button" class="sg-pick${readyClass}" data-action="seeker-check-in" ${busy ? "disabled" : ""}>Perbarui posisi</button>` : ""}
      ${!isHider && room.phase !== "head_start" ? `<button type="button" class="sg-main${readyClass}" data-action="trigger-endgame" data-station="${escapeText(selected?.id ?? "")}" ${busy ? "disabled" : ""}>Check-in turun dari transit</button>` : ""}
      ${isHider && room.phase === "endgame" && room.foundCode ? `<p>Berikan kode saat pencari menemukanmu.</p>
        <div class="rb-found-code" data-testid="hider-found-code">${escapeText(room.foundCode)}</div>
        ${room.hiderFrozen ? "<p>Posisi terkunci</p>" : '<button type="button" class="sg-main" data-action="confirm-freeze">Kunci posisi sekarang</button>'}` : ""}
      ${!isHider && room.phase === "endgame" ? `<div class="rb-field">
        <label for="rb-found-input">Kode temuan 4 digit</label>
        <input id="rb-found-input" inputmode="numeric" maxlength="4" placeholder="1234" value="${escapeText(foundCodeDraft)}">
        ${slotAlert("found-code")}
        <button type="button" class="sg-main" data-action="submit-found-code">Konfirmasi temuan</button>
      </div>` : ""}`;
  }

  function renderDraftPreview() {
    const draft = selectedMapQuestion();
    if (!draft) return { ready: false, content: "" };
    const active = activeDraftPreview();
    const data = active?.data;
    const ready = Boolean(active && previewIsFresh(active.validUntil));
    const meters = (value: number) => `${Math.round(value).toLocaleString("id-ID")} m`;
    const nearby = data?.targets?.map(target => target.name).join(" / ");
    const referenceName = data && live && roomPoints(live).find(point => point.latitude === data.reference.latitude &&
      point.longitude === data.reference.longitude)?.name;
    const status = previewLoading === draft.key ? "Menyiapkan pratinjau…" :
      previewError?.key === draft.key ? previewError.message :
      active && !ready ? "Lokasi pratinjau kedaluwarsa. Perbarui lokasi." :
      data ? [
        "Pratinjau",
        ...(data.radiusMeters !== undefined ? [`Radius ${meters(data.radiusMeters)}`, referenceName ?? "Titik GPS"] : []),
        ...(data.station ? [data.station.name] : []),
        ...(data.distanceMeters !== undefined && nearby ? [`${nearby} · ${meters(data.distanceMeters)}`] :
          data.targets ? [`${data.targets.length} titik tujuan`] : []),
      ].join(" · ") : "Siapkan lokasi untuk pratinjau.";
    return {
      ready,
      validUntil: active?.validUntil,
      content: `<div class="sg-preview">
        <p id="sg-preview-status" role="status">${escapeText(status)}</p>
        <div class="rb-actions">
          ${data && !mapFailed ? '<button type="button" class="sg-quiet" data-action="focus-preview">Fokus peta</button>' : ""}
          <button type="button" class="sg-quiet" data-action="refresh-preview" ${previewLoading === draft.key || busy ? "disabled" : ""}>Perbarui lokasi</button>
        </div>
      </div>`,
    };
  }

  function renderGamePanel(payload: RoomPayload, deal: boolean): string {
    const { room, deck, publicBoard } = payload;
    if (panel === "activity") return renderRoomActivity(payload.activity, roomNow + performance.now() - clockBase);
    if (panel === "qa") return payload.qa ? renderQaControls(payload) : "";
    if (panel === "board") return renderBoardControls(payload) + renderCurses(payload);
    if (panel === "history") return `<h2 id="sg-panel-title" tabindex="-1">Riwayat petunjuk</h2>
      <ul class="rb-list">${room.questions.length === 0 ? "<li>Belum ada petunjuk.</li>" : [...room.questions].reverse().map(question =>
        `<li><strong>${questionNames[question.family]} · ${escapeText(question.label)}</strong>
        <small>${escapeText(question.answerLabel ? answerText(question.answerLabel) : question.status === "pending" ? "Menunggu jawaban" : "Pertanyaan ditutup")}</small>
        ${question.photoId ? `<img class="sg-clue-photo" src="/api/rulebooks/rooms/${encodeURIComponent(room.code)}/photos/${encodeURIComponent(question.photoId)}" alt="Foto petunjuk" loading="lazy">` : ""}</li>`
      ).join("")}</ul>`;
    const pending = room.questions.find(question => question.status === "pending");
    if (panel === "ask") {
      if (room.phase === "head_start") return '<h2 id="sg-panel-title" tabindex="-1">Tunggu waktu sembunyi</h2>';
      if (pending) return `<h2 id="sg-panel-title" tabindex="-1">Menunggu jawaban</h2>
        <p>${escapeText(pending.label)} · <span data-deadline="${pending.deadline}"></span></p>`;
      if (family) {
        const entries = room.menu.filter(entry => entry.family === family);
        const picked = entries.find(entry => entry.itemId === option);
        const thermometer = family === "thermometer" ? {
          started: room.thermometerStart !== null,
          distance: room.thermometerStart && thermometerEnd ? haversineMeters(room.thermometerStart, thermometerEnd) : undefined,
        } : undefined;
        const preview = family === "photo" || family === "thermometer" ? undefined : renderDraftPreview();
        return questionOptions(family, entries, picked, deck.questionsBlocked || deck.bannedFamilies.includes(family), thermometer, busy, preview)
          + slotAlert("ask-field");
      }
      return questionDeck(room.menu);
    }
    if ((panel !== "hand" && panel !== "question") || room.role !== "hider") return "";
    const { activeDraw, hand, currentHandLimit } = deck as SeekDeckHiderView;
    if (activeDraw && (panel === "hand" || !pending)) return `<h2 id="sg-panel-title" tabindex="-1">Pilih kartu untuk disimpan</h2>
      <p class="sg-reward-note">Simpan ${activeDraw.keepCount} dari ${activeDraw.cards.length} · <span data-deadline="${activeDraw.deadline}"></span></p>
      <div class="sg-reward-grid ${deal ? "sg-deal" : ""}" data-count="${activeDraw.cards.length}">
        ${activeDraw.cards.map(card => `<div class="sg-offer">
          ${rewardCard(card, `type="button" data-action="choose-draw" data-instance="${escapeText(card.instanceId)}" ${busy ? "disabled" : ""}`, keepIds.has(card.instanceId))}
          <span class="sg-offer-back" aria-hidden="true">◆</span>
        </div>`).join("")}
      </div>
      <button type="button" class="sg-main" data-action="confirm-draw" ${busy || keepIds.size !== activeDraw.keepCount ? "disabled" : ""}>Simpan ${keepIds.size}/${activeDraw.keepCount} kartu</button>`;
    if (pending) {
      const alternatives = hand.filter(card => card.effect.primitive === "veto" || card.effect.primitive === "randomize");
      const extras = alternatives.map(card => `<button type="button" class="sg-pick" data-action="play-card"
        data-instance="${escapeText(card.instanceId)}" data-primitive="${card.effect.primitive}" ${busy ? "disabled" : ""}>${escapeText(card.title)}</button>`).join("")
        + (room.phase === "endgame" ? `<button type="button" class="sg-pick" data-action="cannot-answer" data-qid="${escapeText(pending.id)}" ${busy ? "disabled" : ""}>Tidak bisa menjawab</button>` : "");
      return incomingQuestion(
        pending,
        answerChoice,
        publicBoard.pois,
        seekPhotoDraft ? { prepared: seekPhotoDraft.prepared, processing: seekPhotoDraft.processing, uploading: seekPhotoUploading } : null,
        extras,
        busy,
      )
        + slotAlert("answer-photo")
        + slotAlert("answer-field")
        + `<p>Jawab dalam <span data-deadline="${pending.deadline}"></span></p>`;
    }
    return `<h2 id="sg-panel-title" tabindex="-1">Kartu di Tangan (${hand.length}/${currentHandLimit})</h2>
      ${hand.length === 0 ? "<p>Jawab pertanyaan untuk mengambil kartu.</p>" : `<div class="sg-reward-grid" data-count="${hand.length}">
        ${hand.map(card => {
          const primitive = card.effect.primitive;
          const canPlay = ["expand_hand", "discard_draw", "duplicate", "time_trap", "move_zone", "curse"].includes(primitive);
          return canPlay ? rewardCard(card, `type="button" data-action="play-card" data-instance="${escapeText(card.instanceId)}" data-primitive="${escapeText(primitive)}" ${busy ? "disabled" : ""}`) : rewardCard(card);
        }).join("")}
      </div>`}`;
  }

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
    if (lifecycle.signal.aborted) return;
    isRendering = true;
    try {
      syncLiveLocation();
    } finally {
      isRendering = false;
    }
    const menuFocused = document.activeElement === root.querySelector(".sg-room-menu summary");
    const room = live?.room;
    activityUi.update(room, live?.activity);
    const effects = liveEffects;
    liveEffects = [];
    if (!live || !room || !isBoardPhase(room)) {
      activityUi.mount(null);
      toast.setLayout("page");
      closeMap();
      destroyStartMiniMap();
      renderedTurn = "";
      const focusedInput = document.activeElement instanceof HTMLInputElement && root.contains(document.activeElement)
        ? { id: document.activeElement.id, start: document.activeElement.selectionStart, end: document.activeElement.selectionEnd }
        : null;
      const focusedBtn = document.activeElement instanceof HTMLButtonElement && root.contains(document.activeElement)
        ? { ...document.activeElement.dataset }
        : null;
      root.innerHTML = live ? renderRoom(live) : renderCatalog();
      if (live && room?.phase === "lobby" && startMapExpanded) {
        const miniHost = root.querySelector<HTMLElement>("#sg-start-minimap");
        if (miniHost) void syncStartMiniMap(miniHost, live);
      }
      if (menuFocused) {
        root.querySelector<HTMLElement>(".sg-room-menu summary")?.focus({ preventScroll: true });
      } else if (!busy) {
        if (focusedInput) {
          const el = root.querySelector<HTMLInputElement>(`#${CSS.escape(focusedInput.id)}`);
          if (el) {
            el.focus({ preventScroll: true });
            if (focusedInput.start != null && focusedInput.end != null) el.setSelectionRange(focusedInput.start, focusedInput.end);
          }
        } else {
          const desired = focusRestoreTarget ?? focusedBtn;
          if (desired) findMatchingButton(root, desired)?.focus({ preventScroll: true });
        }
        focusRestoreTarget = null;
      }
      updateClock();
      return;
    }
    destroyStartMiniMap();
    const turn = `${room.code}/${room.turnNumber}/${room.role}/${room.phase}`;
    const isHider = room.role === "hider";
    const activeDraw = isHider ? (live.deck as SeekDeckHiderView).activeDraw : null;
    const nextDraw = activeDraw?.cards.map(card => card.instanceId).join(":") ?? "";
    const nextPending = room.questions.find(question => question.status === "pending")?.id ?? "";
    const openDraw = !busy && nextDraw !== "" && nextDraw !== drawKey;
    const deal = openDraw && effects.some(event => event.kind === "draw") && motionAllowed();
    const incoming = isHider && nextPending !== "" && nextPending !== pendingId;
    if (renderedTurn !== turn) {
      renderedTurn = turn;
      statusMsg = "";
      panel = room.phase === "head_start" || room.phase === "endgame" ? "board" : isHider ? "hand" : "ask";
      family = null;
      option = "";
      stationId = "";
      thermometerEnd = undefined;
      radiusDraft = "";
    }
    const openIncoming = incoming && (panel === null || panel === "hand" || panel === "question");
    if (openDraw || openIncoming) panel = "hand";
    if (!isHider && panel === "ask" && pendingId && !nextPending && room.questions.some(question => question.id === pendingId && (question.answerLabel || question.overlay))) {
      panel = null;
      family = null;
      option = "";
    }
    if (nextDraw !== drawKey) keepIds = new Set();
    if (!busy) drawKey = nextDraw;
    if (pendingId !== nextPending) {
      answerChoice = "";
      seekPhotoDraft = null;
      seekPhotoUploading = false;
    }
    pendingId = nextPending;

    if (!mapHost) {
      root.innerHTML = `<section class="sg-game" aria-label="Papan Hide &amp; Seek">
        <div class="sg-board" id="sg-map"></div><div class="room-activity-host"></div><div id="sg-controls"><div id="sg-hud-host"></div><div class="sg-dock"></div></div>
      </section>`;
      mapHost = root.querySelector<HTMLElement>("#sg-map")!;
    }
    const controls = root.querySelector<HTMLElement>("#sg-controls")!;
    const hudHost = controls.querySelector<HTMLElement>("#sg-hud-host")!;
    const dock = controls.querySelector<HTMLElement>(".sg-dock")!;
    const previousRole = hudHost.querySelector<HTMLElement>(".sg-role");
    root.querySelector<HTMLElement>(".sg-game")!.dataset.role = room.role;
    const panelScroll = dock.querySelector(".sg-sheet")?.scrollTop ?? 0;
    const focused = document.activeElement instanceof HTMLElement && controls.contains(document.activeElement) ? document.activeElement : null;
    const previousInput = focused instanceof HTMLInputElement ? { id: focused.id, value: focused.value } : null;
    const activeSelect = focused instanceof HTMLSelectElement ? focused.id : "";
    const activeButton = focused instanceof HTMLButtonElement ? { ...focused.dataset } : null;
    const selectedNav = isHider ? "hand" : "ask";
    const station = [room.turnStartPoint, ...live.publicBoard.stations].find(item => item.id === room.seekerPosition?.stationId);
    const latest = [...room.questions].reverse().find(question => question.answerLabel && question.overlay &&
      question.askedAt >= (room.deductionResetAt ?? 0));
    const hasMapResult = Boolean(latest && panel !== "history" && !mapFailed);
    toast.setLayout("game", hasMapResult || Boolean(live.activity.prompt));
    const activeScreenAlert = inlineError && (inlineError.slot === "lobby" || inlineError.slot === "catalog")
      ? renderInlineAlert(inlineError.message, inlineError.tone)
      : "";
    const isDraft = isDraftPlaytest(live);
    hudHost.innerHTML = `<header class="sg-hud">
      <div class="sg-role">
        <span class="sg-role-mark" aria-hidden="true">${isHider ? "◆" : "◎"}</span>
        <h1>${isHider ? "Penyembunyi" : "Pencari"}</h1><p>${phaseLabels[room.phase]} · ${room.turnNumber}/${room.totalPlannedTurns}</p>
      </div>
      <div class="sg-hud-actions">
        ${isDraft ? `<button type="button" class="sg-quiet sg-qa-badge" data-testid="draft-playtest-badge" data-action="game-panel" data-panel="qa" aria-label="Kontrol Uji Draf" aria-expanded="${panel === "qa"}">Uji Draf</button>`
          : live.qa ? `<button type="button" class="sg-quiet sg-qa-badge" data-testid="seek-qa-badge" data-action="game-panel" data-panel="qa" aria-label="Mode QA" aria-expanded="${panel === "qa"}">QA</button>` : ""}
        ${room.phaseEndsAt === null ? "" : `<span class="sg-timer" aria-label="${room.phase === "head_start" ? "Waktu hingga pencarian dimulai" : "Sisa waktu"}" data-deadline="${room.phaseEndsAt}"></span>`}
        ${renderRoomMenu()}
      </div>
    </header>
    ${isDraft ? `<div class="sg-location sg-draft-hud-bar" data-testid="draft-playtest-bar"><a class="cg-back-studio-link" data-testid="back-to-studio-btn" href="${draftStudioUrl(live.pass)}">← Kembali ke Studio</a></div>` : ""}
    ${room.phase !== "head_start" ? `<p class="sg-location">${room.seekerPosition ? `${room.seekerPosition.seatId === room.seatId ? "Kamu" : "Pencari"} · ${station ? escapeText(station.name) : "Check-in terverifikasi"} · <span id="sg-position-age"></span>` : "Belum ada check-in pencari"}</p>` : ""}
    <p class="sg-location" data-sg-conn-pill role="status" ${connectionState === "connected" ? "hidden" : ""}>${connectionState === "offline" ? "Luring · menunggu koneksi" : "Menyambungkan ulang…"}</p>
    ${hasMapResult && latest ? `<p class="sg-map-result" role="status">${questionNames[latest.family]} · ${escapeText(answerText(latest.answerLabel ?? ""))}</p>` : ""}`;
    const activeCueKey: PhaseCueKey | null =
      room.phase === "head_start"
        ? isHider
          ? "seek-head-start-hider"
          : "seek-head-start-seeker"
        : room.phase === "seeking" || room.phase === "endgame"
          ? isHider
            ? "seek-seeking-hider"
            : "seek-seeking-seeker"
          : null;
    dock.innerHTML = `${activeCueKey ? renderPhaseCueStrip(activeCueKey) : ""}${panel || activeScreenAlert || statusMsg ? `<section class="sg-sheet" aria-label="Panel permainan">
        ${activeScreenAlert}
        ${statusMsg ? `<p role="status">${escapeText(statusMsg)}</p>` : ""}
        ${panel ? renderGamePanel(live, deal) : ""}
      </section>` : ""}
      <nav class="sg-nav" aria-label="Aksi permainan">
        <button type="button" data-action="game-panel" data-panel="${selectedNav}" aria-pressed="${panel === selectedNav}"><span class="sg-nav-icon" aria-hidden="true">${isHider ? "▤" : "✦"}</span>${isHider ? `Kartu ${live.deck.hiderHandCount}` : "Tanya"}</button>
        <button type="button" data-action="game-panel" data-panel="history" aria-pressed="${panel === "history"}"><span class="sg-nav-icon" aria-hidden="true">◷</span>Riwayat</button>
        <button type="button" data-action="game-panel" data-panel="board" aria-pressed="${panel === "board"}"><span class="sg-nav-icon" aria-hidden="true">◇</span>Titik</button>
      </nav>`;
    const nextRole = hudHost.querySelector<HTMLElement>(".sg-role");
    if (previousRole && nextRole && previousRole.innerHTML === nextRole.innerHTML) nextRole.replaceWith(previousRole);
    activityUi.mount(root.querySelector(".room-activity-host"), hasMapResult);
    if (openDraw || openIncoming) {
      controls.querySelector<HTMLElement>("#sg-panel-title")?.focus({ preventScroll: true });
    } else if (menuFocused) {
      controls.querySelector<HTMLElement>(".sg-room-menu summary")?.focus({ preventScroll: true });
    } else if (previousInput) {
      const input = document.getElementById(previousInput.id);
      if (input instanceof HTMLInputElement) {
        input.value = previousInput.value;
        input.focus({ preventScroll: true });
      }
    } else if (activeSelect) {
      document.getElementById(activeSelect)?.focus({ preventScroll: true });
    } else if (!busy) {
      const desired = focusRestoreTarget ?? activeButton;
      if (desired) {
        const replacement = findMatchingButton(controls, desired);
        (replacement ?? controls.querySelector<HTMLElement>("#sg-panel-title"))?.focus({ preventScroll: true });
      }
      focusRestoreTarget = null;
    }
    const sheet = controls.querySelector<HTMLElement>(".sg-sheet");
    if (sheet && !openDraw && !openIncoming && focused) sheet.scrollTop = panelScroll;
    const radius = controls.querySelector<HTMLInputElement>("#sg-radius");
    if (radius) radius.value = radiusDraft;
    updateClock();
    const roleEffect = effects.filter(event => event.kind === "role" || event.kind === "endgame").at(-1);
    const cardEffect = effects.filter(event => event.kind === "card" || event.kind === "curse").at(-1);
    const deduction = effects.filter(event => event.mapChange).at(-1);
    if (roleEffect) playGameMotion(controls.querySelector(".sg-role"), "role", roleEffect.sequence);
    if (cardEffect) playGameMotion(controls.querySelector(isHider ? '[data-panel="hand"]' : '[data-panel="board"]'), "update", cardEffect.sequence);
    if (deduction) playGameMotion(controls.querySelector(".sg-map-result"), "update", deduction.sequence);
    const nextMapKey = JSON.stringify([room.code, room.turnNumber, room.role, room.phase, room.ownAnchorStationId, room.seekerPosition, room.questions, room.deductionResetAt, room.moveZoneUntil, room.thermometerStart, thermometerEnd, answerChoice, stationId]);
    if (mapFailed) {
      if (mapKey) {
        mapRequest++;
        mapHandle?.destroy();
        mapHandle = undefined;
        mapHost.replaceChildren();
        mapKey = "";
      }
    } else if (mapKey !== nextMapKey) {
      mapKey = nextMapKey;
      const geometry = latest?.overlay?.type;
      void mountMapOverlay(mapHost, live).then(() => {
        if (deduction && geometry && motionAllowed() && mapHost?.isConnected && mapKey === nextMapKey && live?.room.code === room.code) {
          mapHandle?.pulseDeduction(geometry);
          if (geometry === "station_filter" || geometry === "distance_compare") {
            for (const marker of mapHost.querySelectorAll<HTMLElement>(".board-map-pin-station")) {
              playGameMotion(marker, "role", deduction.sequence);
            }
          }
        }
      });
    } else {
      mapHandle?.setQuestionPreview(activeDraftPreview()?.data, previewPadding(mapHost));
    }
  }

  root.addEventListener("input", event => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) return;
    if (target.id === "rb-join-code") joinCode = target.value;
    if (target.id === "rb-join-name") {
      joinName = target.value;
      joinNameEdited = true;
    }
    if (target.id === "sg-rename-input") renameDraft = target.value;
    if (target.id === "rb-found-input") foundCodeDraft = target.value;
    if (target.id === "sg-radius") {
      radiusDraft = target.value;
      mapHandle?.setQuestionPreview();
      window.clearTimeout(previewTimer);
      previewTimer = window.setTimeout(() => {
        render();
        void updateDraftPreview();
      }, 160);
    }
  }, { signal: lifecycle.signal });

  root.addEventListener("change", event => {
    if (event.target instanceof HTMLSelectElement && event.target.id === "sg-qa-location" && live?.qa) {
      qaStationId = event.target.value;
      stationId = "";
      sessionStorage.setItem(`seek-qa-location:${live.room.code}`, qaStationId);
      return;
    }
    if (!(event.target instanceof HTMLInputElement) || event.target.id !== "sg-clue-photo") return;
    const file = event.target.files?.[0];
    const questionId = pendingId;
    seekPhotoDraft = null;
    inlineError = null;
    if (!file) {
      render();
      return;
    }
    const seqNum = ++seekPhotoSeq;
    const promise = preparePhotoFile(file);
    seekPhotoDraft = { processing: true, prepared: null, promise, seq: seqNum };
    render();
    void promise.then(
      (prepared) => {
        if (questionId !== pendingId || lifecycle.signal.aborted || seekPhotoDraft?.seq !== seqNum) return;
        seekPhotoDraft = { processing: false, prepared, seq: seqNum };
        render();
      },
      (error) => {
        if (questionId !== pendingId || lifecycle.signal.aborted || seekPhotoDraft?.seq !== seqNum) return;
        seekPhotoDraft = null;
        reportError(error, { action: "answer-photo", target: questionId }, "answer-photo");
        render();
      },
    );
  }, { signal: lifecycle.signal });

  async function switchToSeekRoom(nextCode: string, nextStatus = "") {
    roomCode = nextCode;
    joinCode = nextCode;
    live = null;
    cachedBoard = null;
    roomEtag = null;
    drawKey = "";
    pendingId = "";
    answerChoice = "";
    seekPhotoDraft = null;
    seekPhotoUploading = false;
    stationId = "";
    family = null;
    option = "";
    renderedTurn = "";
    startMapExpanded = false;
    closeMap();
    destroyStartMiniMap();
    mapFailed = false;
    statusMsg = nextStatus;
    inlineError = null;
    pendingAction = null;
    toast.clear();
    syncRoomUrl(nextCode);
    await refreshRoom();
  }

  async function executePlayAgain() {
    if (!live || busy || actionPending) return;
    const { room, pass } = live;
    const ownSeat = room.seats.find((s) => s.seatId === room.seatId);
    const requestType = pass.paid ? "create-owned-room" : "create-free-room";
    const hostName = resolveDefaultPlayerName(getCachedAuth()?.user?.displayName, ownSeat?.name ?? "Pemain");
    const pending = ensurePendingAction(
      `play-again:${room.code}:${pass.packId}:${pass.version}`,
      requestType,
    );
    actionPending = true;
    busy = true;
    root.setAttribute("aria-busy", "true");
    inlineError = null;
    render();
    try {
      const { ok, status, data: res } = await fetchApiJson<{ ok?: boolean; roomCode?: string; error?: string }>(
        "/api/rulebooks",
        {
          signal: lifecycle.signal,
          body: {
            type: requestType,
            packId: pass.packId,
            version: pass.version,
            ...(pass.mode ? { mode: pass.mode } : {}),
            hostName,
            requestId: pending.id,
          },
        },
      );
      clearPendingAction();
      if (lifecycle.signal.aborted) return;
      if (ok && res.ok && res.roomCode) {
        await switchToSeekRoom(res.roomCode, `Ruang baru ${res.roomCode} siap dimainkan.`);
        return;
      }
      reportError(
        { error: res.error ?? "invalid-request", status },
        { surface: "seek", action: requestType, target: pass.packId },
        "lobby",
      );
    } catch (error) {
      if (!lifecycle.signal.aborted) {
        const resolved = reportError(error, { surface: "seek", action: requestType, target: pass.packId }, "lobby");
        if (!resolved.uncertain) clearPendingAction();
      }
    } finally {
      busy = false;
      actionPending = false;
      if (!lifecycle.signal.aborted) {
        root.removeAttribute("aria-busy");
        render();
        if (!pendingAction) roomEvents.sync();
      }
    }
  }

  async function executeConfirmedLeave(toastText: string) {
    if (!live || busy || actionPending) return;
    const leavingCode = roomCode || live.room.code;
    actionPending = true;
    root.setAttribute("aria-busy", "true");
    inlineError = null;
    try {
      const ok = await postRoomAction({ type: "leave" });
      if (!ok || lifecycle.signal.aborted) return;
      clearActiveRoom(leavingCode);
      toast.resetDedupe();
      toast.show({ message: toastText, tone: "info", dedupeKey: `seek:leave:${leavingCode}` });
      onBack();
    } catch (error) {
      if (!lifecycle.signal.aborted) {
        reportError(error, { surface: "lobby", action: "leave" }, "lobby");
        render();
      }
    } finally {
      actionPending = false;
      if (!lifecycle.signal.aborted) {
        root.removeAttribute("aria-busy");
        if (!pendingAction) roomEvents.sync();
      }
    }
  }

  root.addEventListener("click", (event) => {
    const btn = (event.target as HTMLElement | null)?.closest<HTMLButtonElement>("button");
    if (!btn || busy || actionPending || btn.disabled) return;

    if (btn.dataset.photoClear !== undefined) {
      seekPhotoDraft = null;
      if (inlineError?.slot === "answer-photo") inlineError = null;
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
      const inviteUrl = `${location.origin}/?play=rulebook-seek&room=${encodeURIComponent(live.room.code)}`;
      if (lobbyAction === "copy-code") {
        void copyToClipboard(live.room.code).then((ok) => {
          if (lifecycle.signal.aborted || !ok) return;
          copiedCode = true;
          render();
          window.setTimeout(() => {
            if (lifecycle.signal.aborted) return;
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
                text: `Gabung ruang Hide & Seek (${live.room.code}) di Kelana Ria!`,
                url: inviteUrl,
              });
              return;
            } catch (err) {
              if (err instanceof DOMException && err.name === "AbortError") return;
            }
          }
          const ok = await copyToClipboard(inviteUrl);
          if (lifecycle.signal.aborted || !ok) return;
          copiedLink = true;
          render();
          window.setTimeout(() => {
            if (lifecycle.signal.aborted) return;
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
    if (nav === "back") {
      onBack();
      return;
    }
    if (nav === "studio") {
      const url = new URL(location.href);
      url.searchParams.set("play", "rulebook-studio");
      url.searchParams.delete("room");
      history.pushState({ fromChooser: true }, "", url);
      window.dispatchEvent(new PopStateEvent("popstate"));
      return;
    }
    if (nav === "catalog") {
      if (live?.pass.mode || live?.room.phase === "canceled") return onBack();
      live = null;
      startMapExpanded = false;
      destroyStartMiniMap();
      liveLocation.stop();
      drawKey = "";
      pendingId = "";
      seekPhotoDraft = null;
      seekPhotoUploading = false;
      statusMsg = "";
      inlineError = null;
      pendingAction = null;
      toast.clear();
      mapFailed = false;
      roomCode = "";
      joinCode = "";
      syncRoomUrl("");
      roomEvents.sync();
      render();
      void loadCatalog();
      return;
    }

    const action = btn.dataset.action;
    if (!action) return;
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
          if (format === "hide-and-seek") {
            void switchToSeekRoom(nextCode);
          } else {
            const url = new URL(location.href);
            url.searchParams.set("play", "rulebook-claim");
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
      root.querySelector<HTMLInputElement>("#sg-rename-input")?.focus({ preventScroll: true });
      return;
    }
    if (action === "cancel-name") {
      editingName = false;
      render();
      root.querySelector<HTMLButtonElement>('[data-testid="edit-own-name"]')?.focus({ preventScroll: true });
      return;
    }
    if (action === "open-quick-guide" && live) {
      btn.closest<HTMLDetailsElement>(".sg-room-menu")?.removeAttribute("open");
      const role = live.room.role === "hider" ? "hider" : live.room.role === "seeker" ? "seeker" : "lobby";
      openQuickGuideModal({
        format: "hide-and-seek",
        mode: "group",
        role,
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
    if (action === "refresh") {
      const menu = btn.closest<HTMLDetailsElement>(".sg-room-menu");
      if (menu) {
        menu.open = false;
        menu.querySelector("summary")?.focus({ preventScroll: true });
      }
    }
    if (action === "choose-draw") {
      const draw = live?.room.role === "hider" ? (live.deck as SeekDeckHiderView).activeDraw : null;
      const instance = btn.dataset.instance;
      if (!draw || !instance || !draw.cards.some(card => card.instanceId === instance)) return;
      if (keepIds.has(instance)) {
        keepIds.delete(instance);
      } else {
        if (draw.keepCount === 1) keepIds.clear();
        if (keepIds.size < draw.keepCount) keepIds.add(instance);
      }
      render();
      return;
    }
    if (action === "game-panel") {
      const next = btn.dataset.panel as Panel;
      if (next === "activity") btn.closest<HTMLDetailsElement>(".sg-room-menu")?.removeAttribute("open");
      panel = next === panel ? null : next;
      render();
      if (panel === "activity") root.querySelector<HTMLElement>("[data-activity-heading]")?.focus({ preventScroll: true });
      void updateDraftPreview();
      return;
    }
    if (action === "question-family" || action === "question-deck" || action === "question-option" || action === "select-station") {
      if (action === "question-family" || action === "question-deck") {
        family = (btn.dataset.family as HideSeekQuestionFamily | undefined) ?? null;
        option = "";
      }
      if (action === "question-option") option = btn.dataset.item ?? "";
      if (action === "select-station") stationId = btn.dataset.station ?? "";
      if (action === "question-family" || action === "question-deck") radiusDraft = "";
      render();
      void updateDraftPreview();
      return;
    }
    if (action === "refresh-preview") {
      void updateDraftPreview(true);
      return;
    }
    if (action === "focus-preview" && mapHost) {
      mapHandle?.focusQuestionPreview(previewPadding(mapHost));
      return;
    }
    if (action === "choose-answer") {
      answerChoice = btn.dataset.answer ?? "";
      render();
      return;
    }
    if (action === "retry-map") {
      mapConfigRequest = undefined;
      mapFailed = false;
      render();
      return;
    }

    if (action === "join-room") {
      const codeInput = (root.querySelector<HTMLInputElement>("#rb-join-code")?.value ?? joinCode).trim();
      joinCode = codeInput;
      joinName = (root.querySelector<HTMLInputElement>("#rb-join-name")?.value ?? joinName).trim() || "Pemain";
      if (!codeInput) {
        reportError("join-code-required", { surface: "lobby", action: "join-room" }, "join");
        render();
        root.querySelector<HTMLInputElement>("#rb-join-code")?.focus({ preventScroll: true });
        return;
      }
    }

    if (action === "submit-found-code") {
      const code = (root.querySelector<HTMLInputElement>("#rb-found-input")?.value ?? foundCodeDraft).trim();
      foundCodeDraft = code;
      if (!/^\d{4}$/.test(code)) {
        reportError("invalid-found-code", { action: "submit-found-code" }, "found-code");
        render();
        root.querySelector<HTMLInputElement>("#rb-found-input")?.focus({ preventScroll: true });
        return;
      }
    }

    if (actionPending) return;
    actionPending = true;
    root.setAttribute("aria-busy", "true");
    inlineError = null;
    focusRestoreTarget = { ...btn.dataset };

    let catchSlot: SeekInlineSlot = live ? (live.room.phase === "lobby" ? "lobby" : "board-checkin") : "catalog";
    let catchTarget: string | undefined = btn.dataset.curse ?? btn.dataset.station ?? btn.dataset.qid ?? btn.dataset.pack;
    if (action === "sim-start-checkin") catchSlot = "lobby-checkin";
    else if (action === "regroup") catchSlot = "regroup-checkin";
    else if (action === "lock-anchor" || action === "trigger-endgame" || action === "seeker-check-in") catchSlot = "board-checkin";
    else if (action === "start-thermometer" || action === "mark-thermometer-end" || action === "ask-clue") catchSlot = "ask-field";
    else if (action === "answer-photo") catchSlot = "answer-photo";
    else if (action === "clear-curse-gps" || action === "submit-curse-photo" || action === "review-curse-photo" || action === "clear-curse-honor" || action === "buyout-curse") {
      catchSlot = "curse-action";
    } else if (action === "join-room") catchSlot = "join";

    void (async () => {
      const room = live?.room;
      if (action === "qa-advance" && live?.qa && room && btn.dataset.step) {
        const step = btn.dataset.step;
        const expectedDeadline = room.phaseEndsAt;
        if (qaAdvanceRetry?.roomCode !== roomCode || qaAdvanceRetry.step !== step || qaAdvanceRetry.expectedDeadline !== expectedDeadline) {
          qaAdvanceRetry = { roomCode, step, expectedDeadline, actionId: crypto.randomUUID() };
        }
        ++seq;
        busy = true;
        render();
        try {
          const { ok, status, data: res } = await fetchApiJson<{ error?: string }>("/api/rulebooks", {
            signal: lifecycle.signal,
            body: { type: "seek-qa-advance", ...qaAdvanceRetry },
          });
          qaAdvanceRetry = undefined;
          if (res.error || !ok) {
            reportError({ error: res.error ?? "qa-deadline-changed", status }, { action: "qa-advance", target: step }, "board-checkin");
          } else {
            toast.clear();
            toast.resetDedupe();
          }
          await refreshRoom(false, false, true).catch(() => {});
        } catch (error) {
          if (!lifecycle.signal.aborted) {
            const resolved = reportError(error, { action: "qa-advance", target: step }, "board-checkin");
            if (!resolved.uncertain) qaAdvanceRetry = undefined;
          }
        } finally {
          busy = false;
          render();
        }
      } else if (action === "start-free" || action === "start-qa" || action === "start-owned") {
        busy = true;
        render();
        const packId = btn.dataset.pack ?? "";
        const version = Number(btn.dataset.version ?? 1);
        const isQa = action === "start-qa";
        const isOwnedLaunch = action === "start-owned";
        const persistKey = `kelana-seek-${isOwnedLaunch ? "owned" : "free"}:${packId}:${version}:${isQa ? 1 : 0}`;
        const pending = ensurePendingAction(`create-${isOwnedLaunch ? "owned" : "free"}:${packId}:${version}:${isQa ? 1 : 0}`, isOwnedLaunch ? "create-owned-room" : "create-free-room", undefined, persistKey);
        try {
          const { ok, status, data: res } = await fetchApiJson<{ ok?: boolean; roomCode?: string; error?: string }>("/api/rulebooks", {
            signal: lifecycle.signal,
            body: {
              type: isOwnedLaunch ? "create-owned-room" : "create-free-room",
              packId,
              version,
              requestId: pending.id,
              ...(isQa ? { qa: true } : {}),
            },
          });
          clearPendingAction(persistKey);
          if (ok && res.ok && res.roomCode) {
            roomCode = res.roomCode;
            joinCode = res.roomCode;
            statusMsg = `Ruang ${roomCode} berhasil dibuat.`;
            toast.clear();
            toast.resetDedupe();
            await refreshRoom(false, false, true);
          } else {
            reportError({ error: res.error ?? "invalid-request", status }, { surface: "catalog", action, target: packId }, "catalog");
            if (res.error === "entitlement-active-room-exists") void loadCatalog();
          }
        } catch (error) {
          if (!lifecycle.signal.aborted) {
            const resolved = reportError(error, { surface: "catalog", action, target: packId }, "catalog");
            if (!resolved.uncertain) clearPendingAction(persistKey);
          }
        } finally {
          busy = false;
          render();
        }
      } else if (action === "resume-owned") {
        const targetRoom = btn.dataset.room ?? "";
        if (targetRoom) {
          busy = true;
          render();
          try {
            roomCode = targetRoom;
            joinCode = targetRoom;
            toast.clear();
            toast.resetDedupe();
            await refreshRoom(false, false, true);
          } finally {
            busy = false;
            render();
          }
        }
      } else if (action === "buy-pack") {
        busy = true;
        render();
        const packId = btn.dataset.pack ?? "";
        const version = Number(btn.dataset.version ?? 1);
        const persistKey = `kelana-seek-order:${packId}:${version}`;
        const pending = ensurePendingAction(`create-order:${packId}:${version}`, "create-order", undefined, persistKey);
        try {
          const { ok, status, data: res } = await fetchApiJson<{ ok?: boolean; order?: { orderId: string }; error?: string }>("/api/rulebooks", {
            signal: lifecycle.signal,
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
                if (!lifecycle.signal.aborted) void loadCatalog();
              },
            });
          } else {
            reportError({ error: res.error ?? "invalid-request", status }, { surface: "checkout", action: "buy-pack", target: packId }, "catalog");
            if (res.error === "pack-already-owned") void loadCatalog();
          }
        } catch (error) {
          if (!lifecycle.signal.aborted) {
            const resolved = reportError(error, { surface: "checkout", action: "buy-pack", target: packId }, "catalog");
            if (!resolved.uncertain) clearPendingAction(persistKey);
          }
        } finally {
          busy = false;
          render();
        }
      } else if (action === "settle-order") {
        busy = true;
        render();
        const orderId = btn.dataset.order ?? "";
        try {
          const { ok, status, data: res } = await fetchApiJson<{ ok?: boolean; pass?: { roomCode: string }; error?: string }>("/api/rulebooks", {
            signal: lifecycle.signal,
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
                if (!lifecycle.signal.aborted) void loadCatalog();
              },
            });
          } else {
            reportError({ error: res.error ?? "payment-pending", status }, { surface: "checkout", action: "settle-order", target: orderId }, "catalog");
          }
        } catch (error) {
          if (!lifecycle.signal.aborted) {
            reportError(error, { surface: "checkout", action: "settle-order", target: orderId }, "catalog");
          }
        } finally {
          busy = false;
          render();
        }
      } else if (action === "join-room") {
        busy = true;
        render();
        try {
          const { ok, status, data: res } = await fetchApiJson<{ ok?: boolean; error?: string }>("/api/rulebooks", {
            signal: lifecycle.signal,
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
        } catch (error) {
          if (!lifecycle.signal.aborted) {
            reportError(error, { surface: "lobby", action: "join-room", target: joinCode }, "join");
          }
        } finally {
          busy = false;
          render();
        }
      } else if (action === "refresh") {
        await refreshRoom();
      } else if (action === "save-name" && live) {
        const cleaned = (root.querySelector<HTMLInputElement>("#sg-rename-input")?.value ?? renameDraft).trim();
        if (!cleaned || cleaned.length > 32) {
          reportError("invalid-seat-name", { surface: "lobby", action: "rename-seat" }, "lobby");
          render();
        } else {
          const ok = await postRoomAction({ type: "rename-seat", name: cleaned });
          if (ok) {
            editingName = false;
            if (!getCachedAuth()?.authenticated) saveRememberedGuestName(cleaned);
            render();
          }
        }
      } else if (action === "move-turn" && live) {
        const targetSeat = btn.dataset.seat ?? "";
        const dir = Number(btn.dataset.dir ?? 0);
        const order = orderedSeekSeats(live.room).map((s) => s.seatId);
        const idx = order.indexOf(targetSeat);
        const nextIdx = idx + dir;
        if (idx >= 0 && nextIdx >= 0 && nextIdx < order.length) {
          [order[idx], order[nextIdx]] = [order[nextIdx], order[idx]];
          await postRoomAction({ type: "set-turn-order", turnOrder: order });
        }
      } else if (action === "shuffle-turns" && live) {
        const current = orderedSeekSeats(live.room).map((s) => s.seatId);
        if (current.length >= 2) {
          const next = [...current];
          for (let i = next.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [next[i], next[j]] = [next[j], next[i]];
          }
          if (next.every((id, i) => id === current[i])) {
            next.push(next.shift()!);
          }
          await postRoomAction({ type: "set-turn-order", turnOrder: next });
        }
      } else if (action === "sim-start-checkin") {
        await postRoomAction({ type: "check-in-start", fix: await locationFix(room?.turnStartPoint) });
      } else if (action === "mark-ready") {
        await postRoomAction({ type: "ready", ready: true });
      } else if (action === "unmark-ready") {
        await postRoomAction({ type: "ready", ready: false });
      } else if (action === "start-match") {
        await postRoomAction({ type: "start" });
      } else if (action === "lock-anchor") {
        await postRoomAction({ type: "lock-anchor", stationId: btn.dataset.station, fix: await locationFix(pointById(btn.dataset.station)) });
      } else if (action === "regroup") {
        const fix = room?.regroupPoint ? await locationFix(room.regroupPoint) : undefined;
        await postRoomAction({ type: "regroup-check-in", fix });
      } else if (action === "confirm-freeze") {
        await postRoomAction({ type: "confirm-freeze" });
      } else if (action === "answer-pending") {
        await postRoomAction({ type: "answer-question", questionId: btn.dataset.qid, answerCode: answerChoice });
      } else if (action === "answer-photo") {
        const questionId = btn.dataset.qid ?? "";
        let prepared = seekPhotoDraft?.prepared ?? null;
        if (!prepared && seekPhotoDraft?.processing && seekPhotoDraft.promise) {
          try {
            prepared = await seekPhotoDraft.promise;
          } catch (error) {
            if (!lifecycle.signal.aborted) {
              seekPhotoDraft = null;
              reportError(error, { action: "answer-photo", target: questionId }, "answer-photo");
              render();
            }
            return;
          }
        }
        if (!prepared) {
          reportError("photo-required", { action: "answer-photo", target: questionId }, "answer-photo");
          render();
          return;
        }
        const pending = ensurePendingAction(JSON.stringify([roomCode, "answer-photo", questionId]), "answer-photo", { questionId });
        ++seq;
        busy = true;
        seekPhotoUploading = true;
        render();
        try {
          const { ok, status, data: response } = await fetchApiJson<{ error?: string }>("/api/rulebooks/seek-photo", {
            signal: lifecycle.signal,
            body: {
              roomCode,
              questionId,
              actionId: pending.id,
              photoBase64: prepared.base64,
            },
          });
          clearPendingAction();
          if (response.error || !ok) {
            reportError({ error: response.error ?? "invalid-photo", status }, { action: "answer-photo", target: questionId }, "answer-photo");
          } else {
            seekPhotoDraft = null;
            inlineError = null;
            toast.clear();
            toast.resetDedupe();
          }
          await refreshRoom(false, false, true).catch(() => {});
        } catch (error) {
          if (!lifecycle.signal.aborted) {
            const resolved = reportError(error, { action: "answer-photo", target: questionId }, "answer-photo");
            if (!resolved.uncertain) clearPendingAction();
          }
        } finally {
          seekPhotoUploading = false;
          busy = false;
          render();
        }
      } else if (action === "cannot-answer") {
        await postRoomAction({ type: "cannot-answer-endgame", questionId: btn.dataset.qid });
      } else if (action === "trigger-endgame") {
        await postRoomAction({
          type: "seeker-check-in",
          offTransit: true,
          fix: await locationFix(pointById(btn.dataset.station) ?? seekerPoint()),
        });
      } else if (action === "seeker-check-in") {
        await postRoomAction({ type: "seeker-check-in", offTransit: false, fix: await locationFix(seekerPoint()) });
      } else if (action === "start-thermometer") {
        thermometerEnd = undefined;
        await postRoomAction({ type: "start-thermometer", fix: await locationFix(seekerPoint()) });
      } else if (action === "mark-thermometer-end") {
        const fix = await locationFix(seekerPoint());
        thermometerEnd = fix;
        if (!await postRoomAction({ type: "seeker-check-in", offTransit: false, fix })) {
          thermometerEnd = undefined;
          render();
        }
      } else if (action === "ask-clue") {
        const radius = root.querySelector<HTMLInputElement>("#sg-radius");
        if (radius && (!radius.reportValidity() || !Number.isFinite(radius.valueAsNumber))) {
          reportError("invalid-custom-radius", { action: "ask-clue" }, "ask-field");
          render();
          return;
        }
        const customRadiusMeters = radius?.valueAsNumber;
        const mapQuestion = btn.dataset.family !== "photo" && btn.dataset.family !== "thermometer";
        const preview = activeDraftPreview();
        if (mapQuestion && (!preview || !previewIsFresh(preview.validUntil))) {
          void updateDraftPreview(true);
          return;
        }
        const fix = preview?.fix ?? (btn.dataset.family === "thermometer" && thermometerEnd
          ? thermometerEnd : await locationFix(seekerPoint()));
        const sent = await postRoomAction({
          type: "ask",
          family: btn.dataset.family,
          itemId: btn.dataset.item,
          ...(customRadiusMeters !== undefined ? { customRadiusMeters } : {}),
          fix,
        });
        if (sent) {
          draftPreview = undefined;
          draftFix = undefined;
          thermometerEnd = undefined;
          radiusDraft = "";
        }
      } else if (action === "submit-found-code") {
        await postRoomAction({ type: "submit-found-code", code: foundCodeDraft });
      } else if (action === "confirm-draw") {
        const activeDraw = live?.room.role === "hider" ? (live.deck as SeekDeckHiderView).activeDraw : null;
        if (activeDraw && keepIds.size === activeDraw.keepCount) {
          await postDeckAction({ kind: "choose-draw", keepInstanceIds: [...keepIds] });
        }
      } else if (action === "play-card") {
        const inst = btn.dataset.instance;
        const primitive = btn.dataset.primitive;
        const params: Record<string, unknown> = { cardInstanceId: inst };
        if (primitive === "time_trap") params.targetStationId = pointById(stationId)?.id ?? live?.publicBoard.stations[0]?.id;
        if (primitive === "curse") params.photoId = "sim-curse-cost-photo";
        await postPlayCard(params);
      } else if (action === "clear-curse-gps") {
        await postDeckAction({
          kind: "clear-curse-gps",
          curseInstanceId: btn.dataset.curse,
          fix: await locationFix(seekerPoint()),
        });
      } else if (action === "submit-curse-photo") {
        await postDeckAction({
          kind: "submit-curse-photo",
          curseInstanceId: btn.dataset.curse,
          photoId: `curse-photo-${Date.now()}`,
        });
      } else if (action === "review-curse-photo") {
        await postDeckAction({
          kind: "review-curse-photo",
          curseInstanceId: btn.dataset.curse,
          approve: btn.dataset.approve === "true",
        });
      } else if (action === "clear-curse-honor") {
        await postDeckAction({ kind: "clear-curse-honor", curseInstanceId: btn.dataset.curse });
      } else if (action === "buyout-curse") {
        await postDeckAction({ kind: "buyout-curse", curseInstanceId: btn.dataset.curse });
      }
    })().catch(error => {
      if (lifecycle.signal.aborted) return;
      busy = false;
      reportError(error, { action, target: catchTarget }, catchSlot, catchTarget);
      render();
    }).finally(() => {
      actionPending = false;
      root.removeAttribute("aria-busy");
      if (!pendingAction) roomEvents.sync();
    });
  }, { signal: lifecycle.signal });

  document.addEventListener("pointerdown", event => {
    const menu = root.querySelector<HTMLDetailsElement>(".sg-room-menu[open]");
    if (menu && event.target instanceof Node && !menu.contains(event.target)) menu.open = false;
  }, { signal: lifecycle.signal });

  document.addEventListener("keydown", event => {
    if (event.key !== "Escape") return;
    const menu = root.querySelector<HTMLDetailsElement>(".sg-room-menu[open]");
    if (!menu) return;
    menu.open = false;
    menu.querySelector("summary")?.focus({ preventScroll: true });
    event.preventDefault();
  }, { signal: lifecycle.signal });

  function applySignedInJoinName(displayName?: string | null) {
    if (!displayName || joinNameEdited) return;
    joinName = displayName;
    const nameInput = root.querySelector<HTMLInputElement>("#rb-join-name");
    if (nameInput) nameInput.value = joinName;
  }

  onAuthChange((next) => {
    applySignedInJoinName(next.user?.displayName);
    if (!live) void loadCatalog();
  }, lifecycle.signal);

  if (!getCachedAuth()) {
    void fetchAuthMe(lifecycle.signal).then((fresh) => {
      if (!lifecycle.signal.aborted) applySignedInJoinName(fresh.user?.displayName);
    });
  }

  const ticker = window.setInterval(updateClock, 1000);
  void loadCatalog().catch((error) => {
    if (!lifecycle.signal.aborted) {
      reportError(error, { surface: "catalog", action: "load-catalog" }, "catalog");
      render();
    }
  });
  return () => {
    lifecycle.abort();
    closeLobbyDialog();
    liveLocation.stop();
    roomEvents.destroy();
    window.clearTimeout(previewTimer);
    root.removeAttribute("aria-busy");
    window.clearInterval(ticker);
    closeMap();
    destroyStartMiniMap();
  };
}
