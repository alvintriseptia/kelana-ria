import type {
  GeoCoordinate,
  HideSeekQuestionFamily,
  LocationFix,
  RoomActivityEvent,
  RulebookEntitlementSummary,
  SeekBoardPoint,
  SeekDeckHiderView,
  SeekEngineRoomView,
  SeekMapPreview,
  SeekPublicBoard,
} from "@kelana-ria/contracts";
import { batch, signal, type Signal } from "@preact/signals";
import { useEffect, useLayoutEffect, useRef } from "preact/hooks";
import { clearActiveRoom, saveActiveRoom } from "./active-room-storage";
import { fetchAuthMe, getCachedAuth, onAuthChange, openAuthModal } from "./auth-modal";
import type { BoardMapHandle, BoardMapOptions, BoardMapUpdateOptions } from "./board-map";
import { getLocation } from "./device-location";
import { motionAllowed, playGameMotion } from "./game-motion";
import { createGameFxController, GameFxOverlay } from "./game-fx-overlay";
import { resolveDefaultPlayerName, saveRememberedGuestName } from "./guest-name";
import { createLiveLocationWatcher, type LiveLocationStatus } from "./live-location";
import {
  canUseWebShare,
  closeLobbyDialog,
  copyToClipboard,
  openConfirmDialog,
  openQrModal,
  openQuickJoinRoomDialog,
} from "./lobby-ui";
import { fetchMapConfig } from "./map-config";
import { preparePhotoFile, type PhotoDraftState } from "./photo-capture";
import { fetchApiJson, resolvePlayerError, type PlayerErrorSurface } from "./player-errors";
import { createPlayerToast } from "./player-toast";
import { openQuickGuideModal, type PhaseCueKey } from "./quick-guide";
import { createRoomActivityUi, freshnessBucket } from "./room-activity";
import { createRoomEventBridge, type RoomConnectionState } from "./room-events";
import { isSimulatedLocationAllowed } from "./runtime-config";
import { SeekActivityPanel } from "./seek/SeekActivityPanel";
import { SeekAskCluePanel } from "./seek/SeekAskCluePanel";
import { SeekBoardPanel } from "./seek/SeekBoardPanel";
import { SeekCatalogView } from "./seek/SeekCatalogView";
import { SeekDockSheet } from "./seek/SeekDockSheet";
import { animateSeekCardFlights, type SeekCardFlight } from "./seek/seek-motion";
import { SeekHandPanel } from "./seek/SeekHandPanel";
import { SeekHistoryPanel } from "./seek/SeekHistoryPanel";
import { SeekHud } from "./seek/SeekHud";
import { SeekRoomShellView } from "./seek/SeekRoomShellView";
import { SeekQaPanel } from "./seek/SeekShared";
import {
  destructiveExitSpec,
  inlineSlotForSeekAction,
  isBoardPhase,
  orderedSeekSeats,
  qaPoint,
  readSessionId,
  writeSessionId,
  type CapturedLocation,
  type DraftFixState,
  type DraftPreviewState,
  type PendingSeekAction,
  type QuestionDraft,
  type SeekInlineError,
  type SeekInlineSlot,
  type SeekPanel,
  type SeekPublicListing,
  type SeekRoomPayload,
} from "./seek/types";
import { InlineAlert } from "./ui/InlineAlert";
import { MapHost } from "./ui/MapHost";
import { mountPreact } from "./ui/mount";
import { PhaseCueStrip } from "./ui/PhaseCueStrip";
import { RestoreRulebookRoom } from "./ui/RestoreRulebookRoom";
import "./rulebook-seek-play.css";

/**
 * Leaf subscriber that keeps the imperative MapLibre seeker pin's freshness class
 * synchronized right after Preact commits SeekRelativeAge to DOM.
 */
function SeekPinFreshnessSync({
  seekerAt,
  clockNowSig,
  getMapHost,
}: {
  seekerAt: number | undefined;
  clockNowSig: Signal<number>;
  getMapHost: () => HTMLElement | null;
}) {
  const now = clockNowSig.value;
  useEffect(() => {
    if (seekerAt === undefined) return;
    const mapHost = getMapHost();
    const seekerPin = mapHost?.querySelector<HTMLElement>('[data-map-point="seeker"]');
    if (!seekerPin) return;
    const bucket = freshnessBucket(seekerAt, now);
    if (seekerPin.dataset.freshness !== bucket) {
      seekerPin.dataset.freshness = bucket;
      seekerPin.classList.remove("board-map-pin-fresh", "board-map-pin-aging", "board-map-pin-stale");
      seekerPin.classList.add(`board-map-pin-${bucket}`);
    }
  }, [seekerAt, now, getMapHost]);
  return null;
}

class SeekController {
  readonly listingsSig = signal<SeekPublicListing[]>([]);
  readonly ownedPackIdsSig = signal<string[]>([]);
  readonly entitlementsSig = signal<RulebookEntitlementSummary[]>([]);
  readonly allowHideSeekQaSig = signal(false);
  readonly allowSandboxCheckoutSig = signal(false);
  readonly activeOrderIdSig = signal<string | null>(null);
  readonly liveSig = signal<SeekRoomPayload | null>(null);
  readonly statusMsgSig = signal("");
  readonly inlineErrorSig = signal<SeekInlineError>(null);
  readonly busySig = signal(false);
  readonly mapFailedSig = signal(false);

  readonly joinCodeSig = signal("");
  readonly joinNameSig = signal("");
  readonly copiedCodeSig = signal(false);
  readonly copiedLinkSig = signal(false);
  readonly editingNameSig = signal(false);
  readonly renameDraftSig = signal("");
  readonly foundCodeDraftSig = signal("");
  readonly startMapExpandedSig = signal(false);
  readonly qaStationIdSig = signal("");

  readonly panelSig = signal<SeekPanel | null>("ask");
  readonly familySig = signal<HideSeekQuestionFamily | null>(null);
  readonly optionSig = signal("");
  readonly stationIdSig = signal("");
  readonly radiusDraftSig = signal("");
  readonly answerChoiceSig = signal("");
  readonly keepIdsSig = signal<Set<string>>(new Set());
  readonly dealActiveSig = signal<number | null>(null);
  readonly previewLoadingSig = signal("");
  readonly previewErrorSig = signal<{ key: string; message: string } | undefined>(undefined);
  readonly draftPreviewSig = signal<DraftPreviewState | undefined>(undefined);
  readonly seekPhotoDraftSig = signal<PhotoDraftState | null>(null);
  readonly seekPhotoUploadingSig = signal(false);
  readonly thermometerEndSig = signal<CapturedLocation | undefined>(undefined);

  readonly selfFixSig = signal<LocationFix | null>(null);
  readonly liveLocationStatusSig = signal<LiveLocationStatus>("prompt");
  readonly connectionStateSig = signal<RoomConnectionState>(
    typeof navigator === "undefined" || navigator.onLine ? "connected" : "offline",
  );
  readonly clockNowSig = signal<number>(Date.now());
  readonly cueRevisionSig = signal(0);

  readonly lifecycle = new AbortController();
  readonly toast;
  readonly fx = createGameFxController();
  readonly activityUi;
  readonly roomEvents;
  readonly liveLocation;

  roomCode = "";
  joinNameEdited = false;
  cachedBoard: { code: string; board: SeekPublicBoard } | null = null;
  roomEtag: { code: string; includeBoard: boolean; value: string } | null = null;
  qaAdvanceRetry:
    | { roomCode: string; step: string; expectedDeadline: number | null; actionId: string }
    | undefined;
  actionPending = false;
  pendingAction: PendingSeekAction | null = null;
  pendingEffects: RoomActivityEvent[] = [];
  pendingCardFlights: SeekCardFlight[] = [];
  pendingRoleMotion: number | null = null;
  pendingFocusPanelTitle = false;
  readonly photoClueFocusSig = signal<number | null>(null);
  pendingLivePayload: SeekRoomPayload | null = null;
  catalogLaunching = false;

  renderedTurn = "";
  drawKey = "";
  pendingId = "";
  seq = 0;
  roomRequest = 0;
  seekPhotoSeq = 0;
  previewSequence = 0;
  previewTimer: number | undefined;
  draftFix: DraftFixState | undefined;
  copiedCodeTimer: number | undefined;
  copiedLinkTimer: number | undefined;
  ticker: number | undefined;

  clockBase = performance.now();
  roomNow = Date.now();

  mapHostEl: HTMLElement | null = null;
  mapHandle: BoardMapHandle | undefined;
  mapRoomCode = "";
  mapKey = "";
  mapRequest = 0;
  focusedThermometer = "";
  savedCamera: { code: string; camera: NonNullable<BoardMapOptions["camera"]> } | undefined;
  mapConfigRequest: ReturnType<typeof fetchMapConfig> | undefined;

  startMiniMapHandle: BoardMapHandle | undefined;
  startMiniMapRoomCode = "";
  startMiniMapReq = 0;

  constructor(
    readonly root: HTMLElement,
    readonly onBack: () => void,
  ) {
    this.roomCode = new URLSearchParams(location.search).get("room") ?? "";
    this.joinCodeSig.value = this.roomCode;
    this.joinNameSig.value = resolveDefaultPlayerName(
      getCachedAuth()?.user?.displayName,
      "Pemain Baru",
    );

    this.toast = createPlayerToast({ signal: this.lifecycle.signal, layout: "page" });

    this.activityUi = createRoomActivityUi(
      this.lifecycle.signal,
      (notice) => {
        const room = this.liveSig.peek()?.room;
        if (!room || this.busySig.peek()) return;
        if (notice !== "activity" && notice.kind === "photo-clue" && notice.clueIndex !== undefined &&
            room.role === "seeker" && room.questions[notice.clueIndex]?.photoId) {
          const { clueIndex } = notice;
          batch(() => {
            this.photoClueFocusSig.value = clueIndex;
            this.panelSig.value = "history";
          });
          return;
        }
        this.panelSig.value =
          notice === "activity"
            ? "activity"
            : notice.panel === "questions"
              ? "question"
              : notice.panel === "clues"
                ? "history"
                : notice.panel === "cards"
                  ? "hand"
                  : "board";
        queueMicrotask(() => {
          this.root
            .querySelector<HTMLElement>("[data-activity-heading], #sg-panel-title")
            ?.focus({ preventScroll: true });
        });
      },
      (events) => {
        this.pendingEffects = [...this.pendingEffects, ...events];
      },
    );

    this.roomEvents = createRoomEventBridge({
      signal: this.lifecycle.signal,
      getActiveRoom: () => {
        const current = this.liveSig.peek();
        return current && this.roomCode && !current.room.outcome
          ? { code: this.roomCode, stateRev: current.stateRev ?? 0 }
          : null;
      },
      isBusy: () => this.busySig.peek() || this.actionPending,
      onSync: () => this.refreshRoom(true),
      onConnectionChange: (state) => {
        this.connectionStateSig.value = state;
      },
    });

    // Strictly local self-location watcher: Hide & Seek never transmits watchPosition fixes to the server.
    this.liveLocation = createLiveLocationWatcher({
      signal: this.lifecycle.signal,
      onFix: (fix) => {
        this.selfFixSig.value = fix;
        const current = this.liveSig.peek();
        if (!current || this.lifecycle.signal.aborted) return;
        if (current.room.phase === "lobby") {
          if (this.startMiniMapHandle && this.startMiniMapRoomCode === current.room.code) {
            this.startMiniMapHandle.update(this.buildStartMiniMapState(current));
          }
          return;
        }
        if (isBoardPhase(current.room)) {
          if (
            this.mapHandle &&
            this.mapRoomCode === current.room.code &&
            this.mapHostEl &&
            !this.mapFailedSig.peek()
          ) {
            this.mapHandle.update(this.buildSeekMapState(this.mapHostEl, current, this.mapRequest));
          }
        }
      },
      onStatusChange: (nextStatus) => {
        this.liveLocationStatusSig.value = nextStatus;
      },
    });
    this.liveLocationStatusSig.value = this.liveLocation.getStatus();

    onAuthChange((next) => {
      this.applySignedInJoinName(next.user?.displayName);
      if (!this.liveSig.peek() && !this.roomCode && !this.catalogLaunching) {
        void this.loadCatalog();
      }
    }, this.lifecycle.signal);

    if (!getCachedAuth()) {
      void fetchAuthMe(this.lifecycle.signal).then((fresh) => {
        if (!this.lifecycle.signal.aborted) {
          this.applySignedInJoinName(fresh.user?.displayName);
        }
      });
    }

    this.ticker = window.setInterval(() => {
      if (this.liveSig.peek()) {
        this.clockNowSig.value = this.currentNow();
      }
    }, 1000);

    void this.loadCatalog().catch((error) => {
      if (!this.lifecycle.signal.aborted) {
        this.reportError(error, { surface: "catalog", action: "load-catalog" }, "catalog");
      }
    });
  }

  currentNow(): number {
    return this.roomNow + performance.now() - this.clockBase;
  }

  applySignedInJoinName(displayName?: string | null): void {
    if (!displayName || this.joinNameEdited) return;
    this.joinNameSig.value = displayName;
  }

  syncLiveLocation(): void {
    const current = this.liveSig.peek();
    if (!current || current.room.outcome || current.room.phase === "canceled") {
      this.liveLocation.stop();
      return;
    }
    this.liveLocation.checkPermissionAndAutoStart();
  }

  currentSurface(): PlayerErrorSurface {
    const current = this.liveSig.peek();
    if (!current) return "catalog";
    return current.room.phase === "lobby" ? "lobby" : "seek";
  }

  ensurePendingAction(
    signature: string,
    kind: string,
    meta?: Omit<PendingSeekAction, "signature" | "id" | "kind">,
    persistKey?: string,
  ): PendingSeekAction {
    if (this.pendingAction?.signature === signature) return this.pendingAction;
    const restored = persistKey ? readSessionId(persistKey) : undefined;
    const id = restored ?? `seek-${crypto.randomUUID()}`;
    if (persistKey) writeSessionId(persistKey, id);
    this.pendingAction = { signature, id, kind, ...meta };
    return this.pendingAction;
  }

  clearPendingAction(persistKey?: string): void {
    this.pendingAction = null;
    if (persistKey) writeSessionId(persistKey);
  }

  reconcilePendingAction(payload: SeekRoomPayload): void {
    if (!this.pendingAction) return;
    const { room, deck } = payload;
    const {
      kind,
      cardInstanceId,
      stationId: pendingStation,
      questionId,
      family: qFamily,
      itemId,
      drawKey: pendingDraw,
    } = this.pendingAction;
    let resolvedOnServer = false;
    if (kind === "play-card" && cardInstanceId && room.role === "hider") {
      const hiderDeck = deck as SeekDeckHiderView;
      resolvedOnServer = !hiderDeck.hand.some((card) => card.instanceId === cardInstanceId);
    } else if (kind === "choose-draw" && room.role === "hider") {
      const activeDraw = (deck as SeekDeckHiderView).activeDraw;
      const nextDrawKey = activeDraw?.cards.map((c) => c.instanceId).join(":") ?? "";
      resolvedOnServer = !activeDraw || nextDrawKey !== pendingDraw;
    } else if (kind === "lock-anchor" && pendingStation) {
      resolvedOnServer = room.ownAnchorStationId === pendingStation;
    } else if (
      (kind === "answer-question" || kind === "answer-photo") &&
      questionId
    ) {
      resolvedOnServer = !room.questions.some(
        (q) => q.id === questionId && q.status === "pending",
      );
    } else if (kind === "ask" && qFamily && itemId) {
      resolvedOnServer = room.questions.some(
        (q) => q.status === "pending" && q.family === qFamily && q.itemId === itemId,
      );
    } else if (kind === "start") {
      resolvedOnServer = room.phase !== "lobby";
    } else if (kind === "ready") {
      resolvedOnServer = room.seats.some((seat) => seat.seatId === room.seatId && seat.ready);
    } else if (kind === "check-in-start") {
      resolvedOnServer = room.seats.some(
        (seat) => seat.seatId === room.seatId && seat.startVerifiedUntil !== null,
      );
    } else if (kind === "submit-found-code") {
      resolvedOnServer = room.phase !== "seeking";
    }
    if (resolvedOnServer) {
      this.pendingAction = null;
      this.toast.clear();
      this.toast.resetDedupe();
    }
  }

  reportError(
    input: unknown,
    context: { action: string; target?: string; surface?: PlayerErrorSurface },
    inlineSlot: SeekInlineSlot,
    targetId?: string,
  ) {
    const resolved = resolvePlayerError(input, {
      surface: context.surface ?? this.currentSurface(),
      action: context.action,
      target: context.target,
    });
    batch(() => {
      if (resolved.staleTarget) {
        this.stationIdSig.value = "";
      }
      if (resolved.placement === "toast") {
        this.inlineErrorSig.value = null;
        this.toast.show(resolved);
      } else {
        this.toast.clear();
        const slot: SeekInlineSlot =
          resolved.placement === "inline-screen"
            ? this.liveSig.peek()
              ? "lobby"
              : "catalog"
            : inlineSlot;
        this.inlineErrorSig.value = {
          slot,
          code: resolved.code,
          message: resolved.message,
          tone: resolved.tone,
          targetId: slot === "curse-action" ? targetId : undefined,
        };
      }
    });
    return resolved;
  }

  syncRoomUrl(code: string): void {
    const url = new URL(location.href);
    if (url.searchParams.get("room") !== code) url.searchParams.delete("adminPlaytest");
    url.searchParams.set("play", "rulebook-seek");
    url.searchParams.delete("pack");
    url.searchParams.delete("launch");
    if (code) url.searchParams.set("room", code);
    else url.searchParams.delete("room");
    history.replaceState(history.state, "", url);
  }

  buildStartMiniMapState(payload: SeekRoomPayload): BoardMapUpdateOptions {
    const sp = payload.room.turnStartPoint;
    const fix = this.selfFixSig.peek();
    return {
      start: { ...sp, x: 50, y: 50 },
      startLabel: "Awal",
      checkpoints: [],
      selfLocation: fix
        ? { latitude: fix.latitude, longitude: fix.longitude, accuracy: fix.accuracy }
        : undefined,
      checkInTarget: { center: sp, radiusMeters: payload.publicBoard.checkInRadiusMeters },
      onRequestSelfLocation: () => this.liveLocation.start(),
    };
  }

  destroyStartMiniMap(): void {
    this.startMiniMapReq++;
    this.startMiniMapHandle?.destroy();
    this.startMiniMapHandle = undefined;
    this.startMiniMapRoomCode = "";
  }

  mountStartMiniMap = (host: HTMLElement): (() => void) => {
    const payload = this.liveSig.peek();
    if (!payload) return () => {};
    const reqId = ++this.startMiniMapReq;
    this.startMiniMapHandle?.destroy();
    this.startMiniMapHandle = undefined;
    this.startMiniMapRoomCode = payload.room.code;

    void (async () => {
      try {
        this.mapConfigRequest ??= fetchMapConfig(this.lifecycle.signal);
        const [{ mountBoardMap }, mapCfg] = await Promise.all([
          import("./board-map"),
          this.mapConfigRequest,
        ]);
        const latest = this.liveSig.peek();
        if (
          reqId !== this.startMiniMapReq ||
          !host.isConnected ||
          !latest ||
          latest.room.code !== payload.room.code ||
          latest.room.phase !== "lobby" ||
          !this.startMapExpandedSig.peek()
        ) {
          return;
        }
        const handle = mountBoardMap({
          container: host,
          config: mapCfg,
          camera: {
            center: [latest.room.turnStartPoint.longitude, latest.room.turnStartPoint.latitude],
            zoom: 15.2,
          },
          ...this.buildStartMiniMapState(latest),
        });
        if (reqId !== this.startMiniMapReq) handle.destroy();
        else this.startMiniMapHandle = handle;
      } catch {
        if (reqId === this.startMiniMapReq) this.destroyStartMiniMap();
      }
    })();

    return () => {
      this.destroyStartMiniMap();
    };
  };

  closeMap(): void {
    const current = this.liveSig.peek();
    if (current?.room.phase === "regroup") {
      const camera = this.mapHandle?.getCamera();
      if (camera) this.savedCamera = { code: current.room.code, camera };
    } else {
      this.savedCamera = undefined;
    }
    this.mapRequest++;
    this.mapHandle?.destroy();
    this.mapHandle = undefined;
    this.mapHostEl = null;
    this.mapKey = "";
    this.mapRoomCode = "";
  }

  pointById(id: string | undefined): SeekBoardPoint | undefined {
    const current = this.liveSig.peek();
    return [current?.room.turnStartPoint, ...(current?.publicBoard.stations ?? [])].find(
      (point) => point?.id === id,
    );
  }

  seekerPoint(): GeoCoordinate | undefined {
    const current = this.liveSig.peek();
    return (
      this.pointById(this.stationIdSig.peek()) ??
      current?.room.seekerPosition ??
      current?.room.turnStartPoint
    );
  }

  async locationFix(point?: GeoCoordinate): Promise<CapturedLocation> {
    const current = this.liveSig.peek();
    const room = current?.room;
    if (current?.qa) {
      const { id, latitude, longitude } = qaPoint(current, this.qaStationIdSig.peek());
      return { latitude, longitude, accuracy: 10, timestamp: current.room.now, qaLocationId: id };
    }
    if (room && point && (await isSimulatedLocationAllowed(this.lifecycle.signal))) {
      return { latitude: point.latitude, longitude: point.longitude, accuracy: 10, timestamp: room.now };
    }
    const fix = await getLocation();
    this.liveLocation.setManualFix(fix);
    return fix;
  }

  selectedMapQuestion(): QuestionDraft | undefined {
    const current = this.liveSig.peek();
    const room = current?.room;
    const panel = this.panelSig.peek();
    const family = this.familySig.peek();
    const option = this.optionSig.peek();
    const stationId = this.stationIdSig.peek();
    const radiusDraft = this.radiusDraftSig.peek();
    if (
      !current ||
      !room ||
      room.role !== "seeker" ||
      !room.playPhase ||
      panel !== "ask" ||
      room.questions.some((question) => question.status === "pending") ||
      (family !== "radar" &&
        family !== "matching" &&
        family !== "measuring" &&
        family !== "tentacles")
    ) {
      return undefined;
    }
    const selected = room.menu.find((entry) => entry.family === family && entry.itemId === option);
    if (!selected?.availableInCurrentPhase || selected.lockedSingleUse) return undefined;
    const customRadiusMeters = selected.isCustomRadius ? Number(radiusDraft) : undefined;
    if (
      customRadiusMeters !== undefined &&
      (!Number.isFinite(customRadiusMeters) || customRadiusMeters <= 0)
    ) {
      return undefined;
    }
    const referenceKey = JSON.stringify([
      room.code,
      room.turnNumber,
      room.phase,
      current.qa ? qaPoint(current, this.qaStationIdSig.peek()).id : stationId,
    ]);
    const query = { family, itemId: option, customRadiusMeters };
    return { query, referenceKey, key: JSON.stringify([referenceKey, query]) };
  }

  activeDraftPreview(): DraftPreviewState | undefined {
    const preview = this.draftPreviewSig.peek();
    const draft = this.selectedMapQuestion();
    return preview && draft && preview.key === draft.key ? preview : undefined;
  }

  previewIsFresh(validUntil?: number): boolean {
    return validUntil === undefined || this.currentNow() <= validUntil;
  }

  previewPadding(host: HTMLElement) {
    const dockTop = this.root.querySelector(".sg-dock")?.getBoundingClientRect().top ?? host.clientHeight;
    const bottom = Math.max(160, Math.min(host.clientHeight - 215, host.clientHeight - dockTop + 24));
    return { top: 136, bottom, left: 34, right: 45 };
  }

  async updateDraftPreview(updateLocation = false): Promise<void> {
    const draft = this.selectedMapQuestion();
    if (
      !draft ||
      (!updateLocation &&
        (this.draftPreviewSig.peek()?.key === draft.key ||
          this.previewLoadingSig.peek() === draft.key))
    ) {
      return;
    }
    const request = ++this.previewSequence;
    const code = this.roomCode;
    batch(() => {
      this.previewLoadingSig.value = draft.key;
      this.previewErrorSig.value = undefined;
      this.draftPreviewSig.value = undefined;
    });
    try {
      const fix =
        !updateLocation &&
        this.draftFix?.referenceKey === draft.referenceKey &&
        this.previewIsFresh(this.draftFix.validUntil)
          ? this.draftFix.fix
          : await this.locationFix(this.seekerPoint());
      if (request !== this.previewSequence || this.selectedMapQuestion()?.key !== draft.key) return;
      const { ok, status, data: response } = await fetchApiJson<{
        preview?: SeekMapPreview;
        validUntil?: number;
        error?: string;
      }>("/api/rulebooks/question-preview", {
        signal: this.lifecycle.signal,
        body: {
          roomCode: code,
          ...draft.query,
          fix,
        },
      });
      if (request !== this.previewSequence || this.selectedMapQuestion()?.key !== draft.key) return;
      if (!ok || !response.preview) {
        const resolved = resolvePlayerError(
          { error: response.error ?? "preview-unavailable", status },
          { surface: "seek", action: "question-preview", target: draft.query.itemId },
        );
        this.previewErrorSig.value = { key: draft.key, message: resolved.message };
        return;
      }
      const validUntil = fix.qaLocationId ? undefined : response.validUntil;
      this.draftFix = { referenceKey: draft.referenceKey, fix, validUntil };
      this.draftPreviewSig.value = { key: draft.key, data: response.preview, fix, validUntil };
    } catch (error) {
      if (this.lifecycle.signal.aborted) return;
      if (request === this.previewSequence && this.selectedMapQuestion()?.key === draft.key) {
        const resolved = resolvePlayerError(error, {
          surface: "seek",
          action: "question-preview",
          target: draft.query.itemId,
        });
        this.previewErrorSig.value = { key: draft.key, message: resolved.message };
      }
    } finally {
      if (request === this.previewSequence) {
        this.previewLoadingSig.value = "";
      }
    }
  }

  /**
   * Commit a new authoritative room payload, updating activityUi and board/turn/draw
   * state atomically in a single signal batch so Preact renders once with zero flicker
   * and zero stripped data-game-motion attributes.
   */
  commitLivePayload(payload: SeekRoomPayload): void {
    const room = payload.room;
    const previous = this.liveSig.peek();
    this.activityUi.update(room, payload.activity);

    batch(() => {
      this.updateBoardMotion(previous, payload);
      this.liveSig.value = payload;
      this.clockNowSig.value = this.currentNow();

      if (room.phase === "canceled") {
        clearActiveRoom(room.code);
      }

      if (!isBoardPhase(room)) {
        this.renderedTurn = "";
        this.dealActiveSig.value = null;
        return;
      }

      const turn = `${room.code}/${room.turnNumber}/${room.role}/${room.phase}`;
      const isHider = room.role === "hider";
      const activeDraw = isHider ? (payload.deck as SeekDeckHiderView).activeDraw : null;
      const nextDraw = activeDraw?.cards.map((card) => card.instanceId).join(":") ?? "";
      const nextPending = room.questions.find((q) => q.status === "pending")?.id ?? "";
      const busy = this.busySig.peek();
      const openDraw = !busy && nextDraw !== "" && nextDraw !== this.drawKey;
      const deal = openDraw && motionAllowed()
        ? this.pendingEffects.filter(event => event.kind === "draw").at(-1)?.sequence ?? null
        : null;
      const incoming = isHider && nextPending !== "" && nextPending !== this.pendingId;

      if (this.renderedTurn !== turn) {
        this.renderedTurn = turn;
        this.foundCodeDraftSig.value = "";
        this.statusMsgSig.value = "";
        this.panelSig.value =
          room.phase === "head_start"
            ? "board"
            : isHider
              ? "hand"
              : "ask";
        this.familySig.value = null;
        this.optionSig.value = "";
        this.stationIdSig.value = "";
        this.thermometerEndSig.value = undefined;
        this.radiusDraftSig.value = "";
      }

      const currentPanel = this.panelSig.peek();
      const openIncoming =
        incoming && (currentPanel === null || currentPanel === "hand" || currentPanel === "question");
      if (openDraw || openIncoming) {
        this.panelSig.value = "hand";
        this.pendingFocusPanelTitle = true;
      }
      if (
        !isHider &&
        this.panelSig.peek() === "ask" &&
        this.pendingId &&
        !nextPending &&
        room.questions.some(
          (question) => question.id === this.pendingId && (question.answerLabel || question.overlay),
        )
      ) {
        this.panelSig.value = null;
        this.familySig.value = null;
        this.optionSig.value = "";
      }
      if (nextDraw !== this.drawKey) {
        this.keepIdsSig.value = new Set();
      }
      this.dealActiveSig.value = deal;
      if (!busy) {
        this.drawKey = nextDraw;
      }
      if (this.pendingId !== nextPending) {
        this.answerChoiceSig.value = "";
        this.seekPhotoDraftSig.value = null;
        this.seekPhotoUploadingSig.value = false;
      }
      this.pendingId = nextPending;
    });

    this.syncLiveLocation();
  }

  flushPendingPayloadAndUnlock(): void {
    const queued = this.pendingLivePayload;
    this.pendingLivePayload = null;
    this.busySig.value = false;
    if (queued) {
      this.commitLivePayload(queued);
    }
  }

  async loadCatalog(): Promise<void> {
    const params = new URLSearchParams(location.search);
    const launchPackId = params.get("pack");
    const shouldLaunch = !this.roomCode && params.get("launch") === "1" && Boolean(launchPackId);
    if (shouldLaunch && this.catalogLaunching) return;
    if (shouldLaunch) this.catalogLaunching = true;
    try {
      const { data } = await fetchApiJson<{
        listings?: SeekPublicListing[];
        ownedPackIds?: string[];
        entitlements?: RulebookEntitlementSummary[];
        allowHideSeekQa?: boolean;
        allowSandboxCheckout?: boolean;
      }>("/api/rulebooks?format=hide-and-seek", { signal: this.lifecycle.signal });
      if (this.lifecycle.signal.aborted) return;

      const listings = (data.listings ?? []).filter((l) => l.format === "hide-and-seek");
      const ownedPackIds = Array.isArray(data.ownedPackIds) ? data.ownedPackIds : [];
      const entitlements = Array.isArray(data.entitlements) ? data.entitlements : [];

      batch(() => {
        this.allowHideSeekQaSig.value = data.allowHideSeekQa === true;
        this.allowSandboxCheckoutSig.value = data.allowSandboxCheckout === true;
        this.listingsSig.value = listings;
        this.ownedPackIdsSig.value = ownedPackIds;
        this.entitlementsSig.value = entitlements;
      });

      if (!this.roomCode && shouldLaunch && launchPackId) {
        const target = listings.find(
          (l) => l.packId === launchPackId && (l.priceIdr === 0 || ownedPackIds.includes(l.packId)),
        );
        if (target) {
          const isOwnedPaid = target.priceIdr > 0 && ownedPackIds.includes(target.packId);
          const persistKey = `kelana-seek-${isOwnedPaid ? "owned" : "free"}:${target.packId}:${target.version}:0`;
          const pending = this.ensurePendingAction(
            `create-${isOwnedPaid ? "owned" : "free"}:${target.packId}:${target.version}:0`,
            isOwnedPaid ? "create-owned-room" : "create-free-room",
            undefined,
            persistKey,
          );
          const { ok, status, data: res } = await fetchApiJson<{
            ok?: boolean;
            roomCode?: string;
            error?: string;
          }>("/api/rulebooks", {
            signal: this.lifecycle.signal,
            body: {
              type: isOwnedPaid ? "create-owned-room" : "create-free-room",
              packId: target.packId,
              version: target.version,
              requestId: pending.id,
            },
          });
          if (ok && res.ok && res.roomCode) {
            this.clearPendingAction(persistKey);
            this.roomCode = res.roomCode;
            this.joinCodeSig.value = res.roomCode;
            this.statusMsgSig.value = `Ruang ${this.roomCode} siap dimainkan.`;
            await this.refreshRoom();
            return;
          }
          this.clearPendingAction(persistKey);
          this.reportError(
            { error: res.error, status },
            {
              surface: "catalog",
              action: isOwnedPaid ? "start-owned" : "start-free",
              target: target.packId,
            },
            "catalog",
          );
        }
      }

      if (this.roomCode) {
        await this.refreshRoom();
      }
    } finally {
      if (shouldLaunch) this.catalogLaunching = false;
    }
  }

  async refreshRoom(background = false, deferCommit = false): Promise<void> {
    if (!this.roomCode) return;
    const code = this.roomCode;
    const request = ++this.roomRequest;
    const requestAction = this.seq;
    const currentLive = this.liveSig.peek();
    const hasBoard = Boolean(currentLive && this.cachedBoard && this.cachedBoard.code === code);
    const includeBoard = !hasBoard;
    const path = includeBoard
      ? `/api/rulebooks/rooms/${encodeURIComponent(code)}`
      : `/api/rulebooks/rooms/${encodeURIComponent(code)}?includeBoard=0`;
    const reqHeaders: Record<string, string> = {};
    if (this.roomEtag && this.roomEtag.code === code && this.roomEtag.includeBoard === includeBoard) {
      reqHeaders["If-None-Match"] = this.roomEtag.value;
    }
    const { status, data, headers, notModified } = await fetchApiJson<
      Omit<SeekRoomPayload, "publicBoard"> & { publicBoard?: SeekPublicBoard; error?: string }
    >(path, { signal: this.lifecycle.signal, headers: reqHeaders, cache: "no-store" });

    if (
      request !== this.roomRequest ||
      code !== this.roomCode ||
      this.lifecycle.signal.aborted ||
      (background && (this.busySig.peek() || requestAction !== this.seq))
    ) {
      return;
    }
    if (notModified) {
      const serverNow = Number(headers.get("x-server-now"));
      if (Number.isFinite(serverNow) && serverNow > 0) {
        this.roomNow = serverNow;
        this.clockBase = performance.now();
        this.clockNowSig.value = this.currentNow();
      }
      this.roomEvents.markSynced();
      return;
    }
    if ("room" in data && data.room) {
      const board =
        data.publicBoard ?? (this.cachedBoard?.code === code ? this.cachedBoard.board : undefined);
      if (!board) {
        this.cachedBoard = null;
        this.roomEtag = null;
        return this.refreshRoom(background, deferCommit);
      }
      this.cachedBoard = { code, board };
      const etag = headers.get("etag");
      if (etag) this.roomEtag = { code, includeBoard, value: etag };
      const payload: SeekRoomPayload = { ...data, publicBoard: board };
      const { now, ...next } = payload.room;
      const previous = this.liveSig.peek();
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
      this.roomNow = now;
      this.clockBase = performance.now();
      this.reconcilePendingAction(payload);
      if (
        (payload.room.phase === "lobby" ||
          payload.room.phase === "head_start" ||
          payload.room.phase === "seeking" ||
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
        this.qaStationIdSig.value = payload.qa
          ? sessionStorage.getItem(`seek-qa-location:${payload.room.code}`) ?? ""
          : "";
        this.qaAdvanceRetry = undefined;
      }
      this.syncRoomUrl(this.roomCode);
      this.roomEvents.markSynced();
      if (unchanged) {
        this.clockNowSig.value = this.currentNow();
        return;
      }
      if (deferCommit) {
        this.pendingLivePayload = payload;
      } else {
        this.commitLivePayload(payload);
      }
    } else if (!background) {
      this.reportError(
        { error: data.error ?? "room-not-found", status },
        { surface: "lobby", action: "load-room", target: code },
        "catalog",
      );
    }
  }

  async runGuardedAction(
    actionName: string,
    catchSlot: SeekInlineSlot,
    catchTarget: string | undefined,
    fn: () => Promise<void>,
  ): Promise<void> {
    if (this.busySig.peek() || this.actionPending) return;
    const triggerEl =
      document.activeElement instanceof HTMLElement && this.root.contains(document.activeElement)
        ? document.activeElement
        : null;
    this.actionPending = true;
    this.root.setAttribute("aria-busy", "true");
    this.inlineErrorSig.value = null;
    try {
      await fn();
    } catch (error) {
      if (this.lifecycle.signal.aborted) return;
      this.busySig.value = false;
      this.reportError(error, { action: actionName, target: catchTarget }, catchSlot, catchTarget);
    } finally {
      this.actionPending = false;
      if (!this.lifecycle.signal.aborted) {
        this.root.removeAttribute("aria-busy");
        if (!this.pendingAction) this.roomEvents.sync();
        if (
          triggerEl &&
          triggerEl.isConnected &&
          !this.pendingFocusPanelTitle &&
          (!document.activeElement || document.activeElement === document.body)
        ) {
          queueMicrotask(() => {
            if (
              triggerEl.isConnected &&
              !triggerEl.hasAttribute("disabled") &&
              (!document.activeElement || document.activeElement === document.body)
            ) {
              triggerEl.focus({ preventScroll: true });
            }
          });
        }
      }
    }
  }

  async postRoomAction(action: Record<string, unknown>): Promise<boolean> {
    if (!this.roomCode) return false;
    const type = String(action.type ?? "action");
    const qId = typeof action.questionId === "string" ? action.questionId : undefined;
    const stId = typeof action.stationId === "string" ? action.stationId : undefined;
    const qFamily = typeof action.family === "string" ? action.family : undefined;
    const itemId = typeof action.itemId === "string" ? action.itemId : undefined;
    const targetKey = qId ?? stId ?? itemId ?? qFamily;
    const signature = JSON.stringify([
      this.roomCode,
      type,
      stId,
      qId,
      qFamily,
      itemId,
      action.answerCode,
      action.code,
      action.name,
      action.ready,
      action.turnOrder,
    ]);
    const pending = this.ensurePendingAction(signature, type, {
      stationId: stId,
      questionId: qId,
      family: qFamily,
      itemId,
    });
    const slot = inlineSlotForSeekAction(action, this.liveSig.peek()?.room.phase);

    ++this.seq;
    this.busySig.value = true;
    try {
      const { ok, status, data: res } = await fetchApiJson<{
        room?: SeekEngineRoomView;
        error?: string;
      }>("/api/rulebooks", {
        signal: this.lifecycle.signal,
        body: {
          type: "room-action",
          roomCode: this.roomCode,
          action: { actionId: pending.id, ...action },
        },
      });
      this.clearPendingAction();
      if (res.error || !ok) {
        this.reportError(
          { error: res.error ?? "invalid-request", status },
          { action: type, target: targetKey },
          slot,
        );
        await this.refreshRoom(false, true).catch(() => {});
        return false;
      }
      this.inlineErrorSig.value = null;
      this.toast.clear();
      this.toast.resetDedupe();
      if (type === "submit-found-code") this.foundCodeDraftSig.value = "";
      await this.refreshRoom(false, true).catch(() => {});
      return true;
    } catch (error) {
      if (this.lifecycle.signal.aborted) return false;
      const resolved = this.reportError(error, { action: type, target: targetKey }, slot);
      if (!resolved.uncertain) this.clearPendingAction();
      return false;
    } finally {
      this.flushPendingPayloadAndUnlock();
    }
  }

  private updateBoardMotion(previous: SeekRoomPayload | null, next: SeekRoomPayload): void {
    const room = next.room;
    const before = previous?.room;
    if (!before || before.code !== room.code || !isBoardPhase(room)) {
      this.fx.clear();
      this.pendingCardFlights = [];
      this.pendingRoleMotion = null;
      return;
    }

    const key = `${room.code}/${room.turnNumber}`;
    const roleChanged = before.role !== room.role && (room.role === "hider" || room.role === "seeker");
    const release = before.phase === "head_start" && room.phase === "seeking";
    if (roleChanged || release) {
      const title = roleChanged ? (room.role === "hider" ? "Giliranmu Bersembunyi" : "Giliranmu Mencari")
        : "Waktu Mencari Dimulai";
      this.fx.emitBanner(`${key}/${roleChanged ? room.role : room.phase}`, { title });
      this.pendingRoleMotion = next.stateRev ?? next.activity.sequence;
    }

    if (room.role !== "hider" || before.role !== "hider" || before.turnNumber !== room.turnNumber) return;
    if (room.ownAnchorStationId && !before.ownAnchorStationId) {
      this.fx.emitBanner(`${key}/anchor`, { title: "Titik Sembunyi Terkunci!", tone: "lock" });
    }
    const oldDeck = previous!.deck as SeekDeckHiderView;
    const deck = next.deck as SeekDeckHiderView;
    const active = oldDeck.activeDraw;
    const held = new Set(deck.hand.map(card => card.instanceId));
    if (active && !deck.activeDraw) this.pendingFocusPanelTitle = true;
    if (active && !deck.activeDraw && motionAllowed()) {
      const cards = this.root.querySelectorAll<HTMLElement>('.sg-offer button[data-instance]');
      this.pendingCardFlights = Array.from(cards)
        .filter(button => active.cards.some(card => card.instanceId === button.dataset.instance))
        .map(button => ({ start: button.getBoundingClientRect(), kept: held.has(button.dataset.instance ?? "") }));
    }
    const oldTraps = new Set(oldDeck.triggeredTraps.map(trap => trap.trapId));
    for (const trap of deck.triggeredTraps) {
      if (oldTraps.has(trap.trapId)) continue;
      this.fx.emitDelta(`${key}/trap/${trap.trapId}`, { label: `+${trap.bonusMinutes} menit`, tone: "time" });
    }
    const spent = oldDeck.hand.find(card => !held.has(card.instanceId));
    if (spent && !active) {
      const tone = spent.category === "curse" ? "danger" : spent.category === "time_bonus" ? "time" : "claim";
      this.fx.emitStamp(`${key}/${next.stateRev ?? next.activity.sequence}/spent`, {
        label: "Kartu Digunakan", tone,
      });
      const button = Array.from(this.root.querySelectorAll<HTMLElement>('[data-action="play-card"]'))
        .find(element => element.dataset.instance === spent.instanceId);
      if (button && motionAllowed()) this.pendingCardFlights = [{ start: button.getBoundingClientRect(), kept: false }];
    }
  }

  async postDeckAction(action: Record<string, unknown>): Promise<void> {
    if (!this.roomCode) return;
    const kind = String(action.kind ?? "deck-action");
    const curseId = typeof action.curseInstanceId === "string" ? action.curseInstanceId : undefined;
    const signature = JSON.stringify([
      this.roomCode,
      "deck",
      kind,
      curseId,
      action.keepInstanceIds,
      action.approve,
    ]);
    const pending = this.ensurePendingAction(signature, kind, { drawKey: this.drawKey });
    const slot: SeekInlineSlot = curseId ? "curse-action" : "board-checkin";

    ++this.seq;
    this.busySig.value = true;
    try {
      const { ok, status, data: res } = await fetchApiJson<{ ok?: boolean; error?: string }>(
        "/api/rulebooks",
        {
          signal: this.lifecycle.signal,
          body: {
            type: "deck-action",
            roomCode: this.roomCode,
            action: { actionId: pending.id, ...action },
          },
        },
      );
      this.clearPendingAction();
      if (res.error || !ok) {
        this.reportError(
          { error: res.error ?? "unknown-deck-action", status },
          { action: kind, target: curseId },
          slot,
          curseId,
        );
      } else {
        this.inlineErrorSig.value = null;
        this.toast.clear();
        this.toast.resetDedupe();
      }
      await this.refreshRoom(false, true).catch(() => {});
    } catch (error) {
      if (this.lifecycle.signal.aborted) return;
      const resolved = this.reportError(error, { action: kind, target: curseId }, slot, curseId);
      if (!resolved.uncertain) this.clearPendingAction();
    } finally {
      this.flushPendingPayloadAndUnlock();
    }
  }

  async postPlayCard(params: Record<string, unknown>): Promise<void> {
    if (!this.roomCode) return;
    const cardInstanceId =
      typeof params.cardInstanceId === "string" ? params.cardInstanceId : undefined;
    const targetStationId =
      typeof params.targetStationId === "string" ? params.targetStationId : undefined;
    const signature = JSON.stringify([this.roomCode, "play-card", cardInstanceId, targetStationId]);
    const pending = this.ensurePendingAction(signature, "play-card", {
      cardInstanceId,
      stationId: targetStationId,
    });

    ++this.seq;
    this.busySig.value = true;
    try {
      const { ok, status, data: res } = await fetchApiJson<{ ok?: boolean; error?: string }>(
        "/api/rulebooks",
        {
          signal: this.lifecycle.signal,
          body: {
            type: "play-card",
            roomCode: this.roomCode,
            actionId: pending.id,
            params,
          },
        },
      );
      this.clearPendingAction();
      if (res.error || !ok) {
        this.reportError(
          { error: res.error ?? "card-not-playable", status },
          { action: "play-card", target: cardInstanceId ?? targetStationId },
          "board-checkin",
        );
      } else {
        this.inlineErrorSig.value = null;
        this.toast.clear();
        this.toast.resetDedupe();
      }
      await this.refreshRoom(false, true).catch(() => {});
    } catch (error) {
      if (this.lifecycle.signal.aborted) return;
      const resolved = this.reportError(
        error,
        { action: "play-card", target: cardInstanceId ?? targetStationId },
        "board-checkin",
      );
      if (!resolved.uncertain) this.clearPendingAction();
    } finally {
      this.flushPendingPayloadAndUnlock();
    }
  }

  buildSeekMapState(
    host: HTMLElement,
    payload: SeekRoomPayload,
    mountSeq: number,
  ): BoardMapUpdateOptions {
    const { room, publicBoard } = payload;
    const point = (p: SeekBoardPoint) => ({ ...p, x: 50, y: 50 });
    const anchor =
      room.role === "hider" &&
      publicBoard.stations.find((station) => station.id === room.ownAnchorStationId);
    const seeker = room.seekerPosition;
    const clues = room.questions.filter((question) => question.askedAt >= (room.deductionResetAt ?? 0));
    const pending = clues.find((question) => question.status === "pending");
    const overlays = clues.flatMap((question) => (question.overlay ? [question.overlay] : []));
    const radarCircles = clues.flatMap((question) =>
      question.overlay?.type === "circle"
        ? [
            {
              id: question.id,
              center: point({ ...question.overlay.center, id: question.id, name: question.label }),
              radiusMeters: question.overlay.radiusMeters,
              inside: question.overlay.inside,
            },
          ]
        : [],
    );
    const answerChoice = this.answerChoiceSig.peek();
    const preview =
      room.role === "hider" && pending?.radarRadiusMeters && pending.privateComputedAnswer
        ? [
            {
              id: pending.id,
              center: point({ ...pending.referencePoint, id: pending.id, name: pending.label }),
              radiusMeters: pending.radarRadiusMeters,
              inside: answerChoice === "yes",
              preview: !answerChoice
                ? ("pending" as const)
                : answerChoice === pending.privateComputedAnswer.code
                  ? ("correct" as const)
                  : ("incorrect" as const),
            },
          ]
        : [];
    const lastThermometer = [...clues]
      .reverse()
      .find((question) => question.thermometerStart && question.status !== "vetoed");
    const thermEnd = this.thermometerEndSig.peek();
    const thermometer = room.thermometerStart
      ? { start: room.thermometerStart, end: thermEnd }
      : lastThermometer?.thermometerStart
        ? { start: lastThermometer.thermometerStart, end: lastThermometer.referencePoint }
        : undefined;
    const thermKey = thermometer?.end
      ? JSON.stringify([
          room.code,
          room.turnNumber,
          thermometer.start.latitude,
          thermometer.start.longitude,
          thermometer.end.latitude,
          thermometer.end.longitude,
        ])
      : "";
    const focusPoints =
      thermometer?.end && thermKey !== this.focusedThermometer
        ? [thermometer.start, thermometer.end]
        : undefined;
    this.focusedThermometer = thermKey;
    const dockTop = this.root.querySelector(".sg-dock")?.getBoundingClientRect().top ?? host.clientHeight;
    const bottom = focusPoints
      ? Math.max(164, Math.min(host.clientHeight - 178, host.clientHeight - dockTop + 25))
      : Math.min(228, Math.floor(host.clientHeight / 3));
    const canHide =
      room.role === "hider" &&
      ((room.phase === "head_start" && !room.ownAnchorStationId) || room.moveZoneUntil !== undefined);
    const candidates = room.candidateStationIds && new Set(room.candidateStationIds);
    const stationId = this.stationIdSig.peek();
    const selectedTargetPoint =
      [room.turnStartPoint, ...publicBoard.stations].find((p) => p.id === stationId) ??
      (anchor || undefined);
    const checkInTarget = selectedTargetPoint
      ? { center: selectedTargetPoint, radiusMeters: publicBoard.checkInRadiusMeters }
      : undefined;
    const selfFix = this.selfFixSig.peek();
    const now = this.clockNowSig.peek();

    return {
      focusPoints,
      start: point(room.turnStartPoint),
      startLabel: "Awal",
      fitPadding: { top: 147, bottom, left: 36, right: 45 },
      startSelectable:
        room.role === "seeker" ||
        (canHide && publicBoard.stations.some((station) => station.id === room.turnStartPoint.id)),
      selectedId: stationId || undefined,
      selfLocation: selfFix
        ? { latitude: selfFix.latitude, longitude: selfFix.longitude, accuracy: selfFix.accuracy }
        : undefined,
      checkInTarget,
      onRequestSelfLocation: () => this.liveLocation.start(),
      deductionBoundary: publicBoard.boundaryPolygon,
      thermometer,
      checkpoints: [
        ...publicBoard.stations
          .filter((station) => station.id !== room.turnStartPoint.id)
          .map((station) => ({
            ...point(station),
            selectable: canHide || room.role === "seeker",
            dimmed: candidates ? !candidates.has(station.id) : false,
            markerKind: "station" as const,
            markerText: station.id === room.ownAnchorStationId ? "◆" : "•",
            label: station.id === room.ownAnchorStationId ? "Lokasi terkunci" : undefined,
          })),
        ...(seeker
          ? (() => {
              const bucket = freshnessBucket(seeker.at, now);
              return [
                {
                  ...point({
                    ...seeker,
                    id: "seeker",
                    name: seeker.seatId === room.seatId ? "Kamu" : "Pencari",
                  }),
                  markerKind: "seeker" as const,
                  markerText: "◎",
                  label: "Check-in",
                  freshness: bucket,
                  dataAttrs: { "data-freshness": bucket },
                },
              ];
            })()
          : []),
        ...(thermometer
          ? [
              {
                ...point({ ...thermometer.start, id: "thermometer-a", name: "Titik A" }),
                markerKind: "thermometer" as const,
                markerText: "A",
              },
            ]
          : []),
        ...(thermometer?.end
          ? [
              {
                ...point({ ...thermometer.end, id: "thermometer-b", name: "Titik B" }),
                markerKind: "thermometer" as const,
                markerText: "B",
              },
            ]
          : []),
      ],
      radarCircles: [...radarCircles, ...preview],
      deductionOverlays: overlays.filter((overlay) => overlay.type !== "circle"),
      hidingZone:
        anchor && room.ownHidingZoneRadiusMeters
          ? { center: anchor, radiusMeters: room.ownHidingZoneRadiusMeters }
          : undefined,
      onSelect: (id: string) => {
        if (this.busySig.peek() || this.actionPending) return;
        this.stationIdSig.value = id;
        if (this.panelSig.peek() === "ask" && this.familySig.peek()) {
          void this.updateDraftPreview();
          return;
        }
        this.panelSig.value = "board";
        queueMicrotask(() => {
          this.root.querySelector<HTMLElement>("#sg-panel-title")?.focus({ preventScroll: true });
        });
      },
      onError: () =>
        queueMicrotask(() => {
          if (mountSeq !== this.mapRequest || this.mapFailedSig.peek()) return;
          batch(() => {
            this.mapFailedSig.value = true;
            const latest = this.liveSig.peek();
            const latestRoom = latest?.room;
            const latestPending = latestRoom?.questions.find((q) => q.status === "pending");
            if (
              !latestRoom ||
              latestRoom.role !== "hider" ||
              this.panelSig.peek() !== "hand" ||
              (!latestPending && !(latest?.deck as SeekDeckHiderView | undefined)?.activeDraw)
            ) {
              this.panelSig.value = "board";
            }
          });
        }),
    };
  }

  async mountMapOverlay(host: HTMLElement, payload: SeekRoomPayload): Promise<void> {
    const code = payload.room.code;
    if (this.mapHandle && code === this.mapRoomCode) {
      const nextState = this.buildSeekMapState(host, payload, this.mapRequest);
      this.mapHandle.update(nextState);
      this.mapHandle.setQuestionPreview(this.activeDraftPreview()?.data, this.previewPadding(host));
      return;
    }
    const current = ++this.mapRequest;
    const camera = this.savedCamera?.code === code ? this.savedCamera.camera : undefined;
    this.savedCamera = undefined;
    this.mapRoomCode = code;
    this.mapHandle?.destroy();
    this.mapHandle = undefined;
    try {
      const [{ mountBoardMap }, config] = await Promise.all([
        import("./board-map"),
        (this.mapConfigRequest ??= fetchMapConfig(this.lifecycle.signal)),
      ]);
      const latest = this.liveSig.peek() ?? payload;
      if (current !== this.mapRequest || !host.isConnected) return;
      const state = this.buildSeekMapState(host, latest, current);
      const handle = mountBoardMap({
        container: host,
        config,
        ...state,
        camera: state.focusPoints ? undefined : camera,
      });
      this.mapHandle = handle;
      handle.setQuestionPreview(this.activeDraftPreview()?.data, this.previewPadding(host));
    } catch {
      if (current !== this.mapRequest) return;
      batch(() => {
        this.mapFailedSig.value = true;
        if (payload.room.role !== "hider" || this.panelSig.peek() !== "hand") {
          this.panelSig.value = "board";
        }
      });
    }
  }

  async switchToSeekRoom(nextCode: string, nextStatus = ""): Promise<void> {
    this.roomCode = nextCode;
    this.cachedBoard = null;
    this.roomEtag = null;
    this.drawKey = "";
    this.pendingId = "";
    this.renderedTurn = "";
    this.pendingAction = null;
    this.pendingLivePayload = null;
    this.closeMap();
    this.destroyStartMiniMap();
    this.toast.clear();
    batch(() => {
      this.joinCodeSig.value = nextCode;
      this.liveSig.value = null;
      this.answerChoiceSig.value = "";
      this.seekPhotoDraftSig.value = null;
      this.seekPhotoUploadingSig.value = false;
      this.stationIdSig.value = "";
      this.familySig.value = null;
      this.optionSig.value = "";
      this.startMapExpandedSig.value = false;
      this.mapFailedSig.value = false;
      this.statusMsgSig.value = nextStatus;
      this.inlineErrorSig.value = null;
    });
    this.syncRoomUrl(nextCode);
    await this.refreshRoom();
  }

  async executePlayAgain(): Promise<void> {
    const current = this.liveSig.peek();
    if (!current || this.busySig.peek() || this.actionPending) return;
    const { room, pass } = current;
    const ownSeat = room.seats.find((s) => s.seatId === room.seatId);
    const requestType = pass.paid ? "create-owned-room" : "create-free-room";
    const hostName = resolveDefaultPlayerName(
      getCachedAuth()?.user?.displayName,
      ownSeat?.name ?? "Pemain",
    );
    const pending = this.ensurePendingAction(
      `play-again:${room.code}:${pass.packId}:${pass.version}`,
      requestType,
    );
    this.actionPending = true;
    this.busySig.value = true;
    this.root.setAttribute("aria-busy", "true");
    this.inlineErrorSig.value = null;
    try {
      const { ok, status, data: res } = await fetchApiJson<{
        ok?: boolean;
        roomCode?: string;
        error?: string;
      }>("/api/rulebooks", {
        signal: this.lifecycle.signal,
        body: {
          type: requestType,
          packId: pass.packId,
          version: pass.version,
          ...(pass.mode ? { mode: pass.mode } : {}),
          hostName,
          requestId: pending.id,
        },
      });
      this.clearPendingAction();
      if (this.lifecycle.signal.aborted) return;
      if (ok && res.ok && res.roomCode) {
        await this.switchToSeekRoom(res.roomCode, `Ruang baru ${res.roomCode} siap dimainkan.`);
        return;
      }
      this.reportError(
        { error: res.error ?? "invalid-request", status },
        { surface: "seek", action: requestType, target: pass.packId },
        "lobby",
      );
    } catch (error) {
      if (!this.lifecycle.signal.aborted) {
        const resolved = this.reportError(
          error,
          { surface: "seek", action: requestType, target: pass.packId },
          "lobby",
        );
        if (!resolved.uncertain) this.clearPendingAction();
      }
    } finally {
      this.busySig.value = false;
      this.actionPending = false;
      if (!this.lifecycle.signal.aborted) {
        this.root.removeAttribute("aria-busy");
        if (!this.pendingAction) this.roomEvents.sync();
      }
    }
  }

  async executeConfirmedLeave(toastText: string): Promise<void> {
    const current = this.liveSig.peek();
    if (!current || this.busySig.peek() || this.actionPending) return;
    const leavingCode = this.roomCode || current.room.code;
    this.actionPending = true;
    this.root.setAttribute("aria-busy", "true");
    this.inlineErrorSig.value = null;
    try {
      const ok = await this.postRoomAction({ type: "leave" });
      if (!ok || this.lifecycle.signal.aborted) return;
      clearActiveRoom(leavingCode);
      this.toast.resetDedupe();
      this.toast.show({ message: toastText, tone: "info", dedupeKey: `seek:leave:${leavingCode}` });
      this.onBack();
    } catch (error) {
      if (!this.lifecycle.signal.aborted) {
        this.reportError(error, { surface: "lobby", action: "leave" }, "lobby");
      }
    } finally {
      this.actionPending = false;
      if (!this.lifecycle.signal.aborted) {
        this.root.removeAttribute("aria-busy");
        if (!this.pendingAction) this.roomEvents.sync();
      }
    }
  }

  // ---- UI Action Handlers ----

  handleOpenStudio = () => {
    const url = new URL(location.href);
    url.searchParams.set("play", "rulebook-studio");
    url.searchParams.delete("room");
    url.searchParams.delete("adminPlaytest");
    history.pushState({ fromChooser: true }, "", url);
    window.dispatchEvent(new PopStateEvent("popstate"));
  };

  handleNavigateCatalog = () => {
    const current = this.liveSig.peek();
    if (current?.pass.mode || current?.room.phase === "canceled") {
      this.onBack();
      return;
    }
    this.destroyStartMiniMap();
    this.closeMap();
    this.liveLocation.stop();
    this.drawKey = "";
    this.pendingId = "";
    this.pendingAction = null;
    this.pendingLivePayload = null;
    this.roomCode = "";
    this.toast.clear();
    batch(() => {
      this.liveSig.value = null;
      this.startMapExpandedSig.value = false;
      this.seekPhotoDraftSig.value = null;
      this.seekPhotoUploadingSig.value = false;
      this.statusMsgSig.value = "";
      this.inlineErrorSig.value = null;
      this.mapFailedSig.value = false;
      this.joinCodeSig.value = "";
    });
    this.syncRoomUrl("");
    this.roomEvents.sync();
    void this.loadCatalog();
  };

  handleCopyCode = () => {
    const current = this.liveSig.peek();
    if (!current) return;
    void copyToClipboard(current.room.code).then((ok) => {
      if (this.lifecycle.signal.aborted || !ok) return;
      this.copiedCodeSig.value = true;
      window.clearTimeout(this.copiedCodeTimer);
      this.copiedCodeTimer = window.setTimeout(() => {
        if (!this.lifecycle.signal.aborted) this.copiedCodeSig.value = false;
      }, 2500);
    });
  };

  handleShareInvite = () => {
    const current = this.liveSig.peek();
    if (!current) return;
    const inviteUrl = `${location.origin}/?play=rulebook-seek&room=${encodeURIComponent(current.room.code)}`;
    void (async () => {
      if (canUseWebShare()) {
        try {
          await navigator.share({
            title: current.room.packMeta.title,
            text: `Gabung ruang Hide & Seek (${current.room.code}) di Kelana Ria!`,
            url: inviteUrl,
          });
          return;
        } catch (err) {
          if (err instanceof DOMException && err.name === "AbortError") return;
        }
      }
      const ok = await copyToClipboard(inviteUrl);
      if (this.lifecycle.signal.aborted || !ok) return;
      this.copiedLinkSig.value = true;
      window.clearTimeout(this.copiedLinkTimer);
      this.copiedLinkTimer = window.setTimeout(() => {
        if (!this.lifecycle.signal.aborted) this.copiedLinkSig.value = false;
      }, 2500);
    })();
  };

  handleShowQr = () => {
    const current = this.liveSig.peek();
    if (!current) return;
    const inviteUrl = `${location.origin}/?play=rulebook-seek&room=${encodeURIComponent(current.room.code)}`;
    openQrModal({
      roomCode: current.room.code,
      inviteUrl,
      title: current.room.packMeta.title,
    });
  };

  handleOpenQuickGuide = () => {
    const current = this.liveSig.peek();
    if (!current) return;
    const role =
      current.room.role === "hider"
        ? "hider"
        : current.room.role === "seeker"
          ? "seeker"
          : "lobby";
    openQuickGuideModal({
      format: "hide-and-seek",
      mode: "group",
      role,
      packId: current.pass.packId,
      version: current.pass.version,
      title: current.room.packMeta.title,
      inLobby: current.room.phase === "lobby",
      repeatCostMode: current.room.repeatCostMode,
      onResetCues: () => {
        this.cueRevisionSig.value += 1;
      },
    });
  };

  handleConfirmLeave = () => {
    const current = this.liveSig.peek();
    if (!current) return;
    const spec = destructiveExitSpec(current);
    if (!spec) return;
    openConfirmDialog({
      title: spec.title,
      body: spec.body,
      confirmLabel: spec.label,
      danger: true,
      onConfirm: () => {
        void this.executeConfirmedLeave(spec.toastText);
      },
    });
  };

  handleJoinNewRoom = () => {
    const auth = getCachedAuth();
    openQuickJoinRoomDialog({
      authenticatedDisplayName: auth?.user?.displayName,
      authenticated: auth?.authenticated,
      onJoined: (format, nextCode) => {
        if (format === "hide-and-seek") {
          void this.switchToSeekRoom(nextCode);
        } else {
          const url = new URL(location.href);
          url.searchParams.set("play", "rulebook-claim");
          url.searchParams.set("room", nextCode);
          url.searchParams.delete("pack");
          url.searchParams.delete("launch");
          url.searchParams.delete("adminPlaytest");
          history.pushState({ fromChooser: true }, "", url);
          window.dispatchEvent(new PopStateEvent("popstate"));
        }
      },
    });
  };

  handleJoinRoom = () => {
    const codeInput = this.joinCodeSig.peek().trim();
    const nameInput = this.joinNameSig.peek().trim() || "Pemain";
    batch(() => {
      this.joinCodeSig.value = codeInput;
      this.joinNameSig.value = nameInput;
    });
    if (!codeInput) {
      this.reportError("join-code-required", { surface: "lobby", action: "join-room" }, "join");
      this.root.querySelector<HTMLInputElement>("#rb-join-code")?.focus({ preventScroll: true });
      return;
    }
    void this.runGuardedAction("join-room", "join", codeInput, async () => {
      this.busySig.value = true;
      try {
        const { ok, status, data: res } = await fetchApiJson<{ ok?: boolean; error?: string }>(
          "/api/rulebooks",
          {
            signal: this.lifecycle.signal,
            body: {
              type: "join-room",
              roomCode: codeInput,
              name: nameInput,
            },
          },
        );
        if (ok && res.ok) {
          if (!getCachedAuth()?.authenticated) saveRememberedGuestName(nameInput);
          this.roomCode = codeInput;
          this.toast.clear();
          this.toast.resetDedupe();
          await this.refreshRoom(false, true);
        } else {
          this.reportError(
            { error: res.error ?? "room-not-found", status },
            { surface: "lobby", action: "join-room", target: codeInput },
            "join",
          );
        }
      } catch (error) {
        if (!this.lifecycle.signal.aborted) {
          this.reportError(
            error,
            { surface: "lobby", action: "join-room", target: codeInput },
            "join",
          );
        }
      } finally {
        this.flushPendingPayloadAndUnlock();
      }
    });
  };

  handleCreateRoom = (kind: "start-free" | "start-qa" | "start-owned", packId: string, version: number) => {
    void this.runGuardedAction(kind, "catalog", packId, async () => {
      this.busySig.value = true;
      const isQa = kind === "start-qa";
      const isOwnedLaunch = kind === "start-owned";
      const persistKey = `kelana-seek-${isOwnedLaunch ? "owned" : "free"}:${packId}:${version}:${isQa ? 1 : 0}`;
      const pending = this.ensurePendingAction(
        `create-${isOwnedLaunch ? "owned" : "free"}:${packId}:${version}:${isQa ? 1 : 0}`,
        isOwnedLaunch ? "create-owned-room" : "create-free-room",
        undefined,
        persistKey,
      );
      try {
        const { ok, status, data: res } = await fetchApiJson<{
          ok?: boolean;
          roomCode?: string;
          error?: string;
        }>("/api/rulebooks", {
          signal: this.lifecycle.signal,
          body: {
            type: isOwnedLaunch ? "create-owned-room" : "create-free-room",
            packId,
            version,
            requestId: pending.id,
            ...(isQa ? { qa: true } : {}),
          },
        });
        this.clearPendingAction(persistKey);
        if (ok && res.ok && res.roomCode) {
          this.roomCode = res.roomCode;
          this.joinCodeSig.value = res.roomCode;
          this.statusMsgSig.value = `Ruang ${this.roomCode} berhasil dibuat.`;
          this.toast.clear();
          this.toast.resetDedupe();
          await this.refreshRoom(false, true);
        } else {
          this.reportError(
            { error: res.error ?? "invalid-request", status },
            { surface: "catalog", action: kind, target: packId },
            "catalog",
          );
          if (res.error === "entitlement-active-room-exists") void this.loadCatalog();
        }
      } catch (error) {
        if (!this.lifecycle.signal.aborted) {
          const resolved = this.reportError(
            error,
            { surface: "catalog", action: kind, target: packId },
            "catalog",
          );
          if (!resolved.uncertain) this.clearPendingAction(persistKey);
        }
      } finally {
        this.flushPendingPayloadAndUnlock();
      }
    });
  };

  handleResumeOwned = (targetRoom: string) => {
    if (!targetRoom) return;
    void this.runGuardedAction("resume-owned", "catalog", targetRoom, async () => {
      this.busySig.value = true;
      try {
        this.roomCode = targetRoom;
        this.joinCodeSig.value = targetRoom;
        this.toast.clear();
        this.toast.resetDedupe();
        await this.refreshRoom(false, true);
      } finally {
        this.flushPendingPayloadAndUnlock();
      }
    });
  };

  handleBuyPack = (packId: string, version: number) => {
    void this.runGuardedAction("buy-pack", "catalog", packId, async () => {
      this.busySig.value = true;
      const persistKey = `kelana-seek-order:${packId}:${version}`;
      const pending = this.ensurePendingAction(
        `create-order:${packId}:${version}`,
        "create-order",
        undefined,
        persistKey,
      );
      try {
        const { ok, status, data: res } = await fetchApiJson<{
          ok?: boolean;
          order?: { orderId: string };
          error?: string;
        }>("/api/rulebooks", {
          signal: this.lifecycle.signal,
          body: {
            type: "create-order",
            packId,
            version,
            requestId: pending.id,
          },
        });
        this.clearPendingAction(persistKey);
        if (ok && res.ok && res.order) {
          this.activeOrderIdSig.value = res.order.orderId;
          this.statusMsgSig.value = `Order ${res.order.orderId} dibuat (Uji Pembayaran).`;
          this.toast.clear();
          this.toast.resetDedupe();
        } else if (status === 401 || res.error === "auth-required") {
          openAuthModal({
            reason: "Masuk dengan email agar paket tersimpan permanen di akunmu.",
            onSignedIn: () => {
              if (!this.lifecycle.signal.aborted) void this.loadCatalog();
            },
          });
        } else {
          this.reportError(
            { error: res.error ?? "invalid-request", status },
            { surface: "checkout", action: "buy-pack", target: packId },
            "catalog",
          );
          if (res.error === "pack-already-owned") void this.loadCatalog();
        }
      } catch (error) {
        if (!this.lifecycle.signal.aborted) {
          const resolved = this.reportError(
            error,
            { surface: "checkout", action: "buy-pack", target: packId },
            "catalog",
          );
          if (!resolved.uncertain) this.clearPendingAction(persistKey);
        }
      } finally {
        this.flushPendingPayloadAndUnlock();
      }
    });
  };

  handleSettleOrder = (orderId: string) => {
    void this.runGuardedAction("settle-order", "catalog", orderId, async () => {
      this.busySig.value = true;
      try {
        const { ok, status, data: res } = await fetchApiJson<{
          ok?: boolean;
          pass?: { roomCode: string };
          error?: string;
        }>("/api/rulebooks", {
          signal: this.lifecycle.signal,
          body: {
            type: "verify-settlement",
            orderId,
            transactionStatus: "settlement",
            statusCode: "200",
            currency: "IDR",
          },
        });
        if (ok && res.ok && res.pass) {
          this.activeOrderIdSig.value = null;
          this.toast.clear();
          this.toast.resetDedupe();
          this.roomCode = res.pass.roomCode;
          this.joinCodeSig.value = res.pass.roomCode;
          this.statusMsgSig.value = `Pembayaran lunas! Ruang ${this.roomCode} terbuka.`;
          await this.refreshRoom(false, true);
        } else if (status === 401 || res.error === "auth-required") {
          openAuthModal({
            reason: "Masuk dengan email agar paket tersimpan permanen di akunmu.",
            onSignedIn: () => {
              if (!this.lifecycle.signal.aborted) void this.loadCatalog();
            },
          });
        } else {
          this.reportError(
            { error: res.error ?? "payment-pending", status },
            { surface: "checkout", action: "settle-order", target: orderId },
            "catalog",
          );
        }
      } catch (error) {
        if (!this.lifecycle.signal.aborted) {
          this.reportError(
            error,
            { surface: "checkout", action: "settle-order", target: orderId },
            "catalog",
          );
        }
      } finally {
        this.flushPendingPayloadAndUnlock();
      }
    });
  };

  handleRefresh = () => {
    void this.runGuardedAction("refresh", "lobby", undefined, async () => {
      await this.refreshRoom();
    });
  };

  handleEditName = () => {
    const current = this.liveSig.peek();
    if (!current) return;
    const ownSeat = current.room.seats.find((s) => s.seatId === current.room.seatId);
    batch(() => {
      this.renameDraftSig.value = ownSeat?.name ?? "";
      this.editingNameSig.value = true;
    });
  };

  handleCancelName = () => {
    this.editingNameSig.value = false;
    queueMicrotask(() => {
      this.root
        .querySelector<HTMLButtonElement>('[data-testid="edit-own-name"]')
        ?.focus({ preventScroll: true });
    });
  };

  handleSaveName = () => {
    const cleaned = this.renameDraftSig.peek().trim();
    if (!cleaned || cleaned.length > 32) {
      this.reportError("invalid-seat-name", { surface: "lobby", action: "rename-seat" }, "lobby");
      return;
    }
    void this.runGuardedAction("save-name", "lobby", undefined, async () => {
      const ok = await this.postRoomAction({ type: "rename-seat", name: cleaned });
      if (ok) {
        this.editingNameSig.value = false;
        if (!getCachedAuth()?.authenticated) saveRememberedGuestName(cleaned);
      }
    });
  };

  handleMoveTurn = (targetSeat: string, dir: -1 | 1) => {
    const current = this.liveSig.peek();
    if (!current) return;
    const order = orderedSeekSeats(current.room).map((s) => s.seatId);
    const idx = order.indexOf(targetSeat);
    const nextIdx = idx + dir;
    if (idx < 0 || nextIdx < 0 || nextIdx >= order.length) return;
    [order[idx], order[nextIdx]] = [order[nextIdx], order[idx]];
    void this.runGuardedAction("move-turn", "lobby", targetSeat, async () => {
      await this.postRoomAction({ type: "set-turn-order", turnOrder: order });
    });
  };

  handleShuffleTurns = () => {
    const current = this.liveSig.peek();
    if (!current) return;
    const order = orderedSeekSeats(current.room).map((s) => s.seatId);
    if (order.length < 2) return;
    const next = [...order];
    for (let i = next.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [next[i], next[j]] = [next[j], next[i]];
    }
    if (next.every((id, i) => id === order[i])) {
      next.push(next.shift()!);
    }
    void this.runGuardedAction("shuffle-turns", "lobby", undefined, async () => {
      await this.postRoomAction({ type: "set-turn-order", turnOrder: next });
    });
  };

  handleSelectQaLocation = (nextId: string) => {
    const current = this.liveSig.peek();
    if (!current?.qa) return;
    batch(() => {
      this.qaStationIdSig.value = nextId;
      this.stationIdSig.value = "";
    });
    sessionStorage.setItem(`seek-qa-location:${current.room.code}`, nextId);
  };

  handleAdvanceQaClock = (step: "minute" | "five-minutes" | "phase-end") => {
    const current = this.liveSig.peek();
    if (!current?.qa) return;
    const expectedDeadline = current.room.phaseEndsAt;
    void this.runGuardedAction("qa-advance", "board-checkin", step, async () => {
      if (
        this.qaAdvanceRetry?.roomCode !== this.roomCode ||
        this.qaAdvanceRetry.step !== step ||
        this.qaAdvanceRetry.expectedDeadline !== expectedDeadline
      ) {
        this.qaAdvanceRetry = {
          roomCode: this.roomCode,
          step,
          expectedDeadline,
          actionId: crypto.randomUUID(),
        };
      }
      ++this.seq;
      this.busySig.value = true;
      try {
        const { ok, status, data: res } = await fetchApiJson<{ error?: string }>("/api/rulebooks", {
          signal: this.lifecycle.signal,
          body: { type: "seek-qa-advance", ...this.qaAdvanceRetry },
        });
        this.qaAdvanceRetry = undefined;
        if (res.error || !ok) {
          this.reportError(
            { error: res.error ?? "qa-deadline-changed", status },
            { action: "qa-advance", target: step },
            "board-checkin",
          );
        } else {
          this.toast.clear();
          this.toast.resetDedupe();
        }
        await this.refreshRoom(false, true).catch(() => {});
      } catch (error) {
        if (!this.lifecycle.signal.aborted) {
          const resolved = this.reportError(
            error,
            { action: "qa-advance", target: step },
            "board-checkin",
          );
          if (!resolved.uncertain) this.qaAdvanceRetry = undefined;
        }
      } finally {
        this.flushPendingPayloadAndUnlock();
      }
    });
  };

  handleTogglePanel = (next: SeekPanel) => {
    if (this.busySig.peek() || this.actionPending) return;
    const current = this.panelSig.peek();
    const target = next === current ? null : next;
    if (target === "found-code") this.pendingFocusPanelTitle = true;
    this.panelSig.value = target;
    if (target === "activity") {
      queueMicrotask(() => {
        this.root.querySelector<HTMLElement>("[data-activity-heading]")?.focus({ preventScroll: true });
      });
    }
    void this.updateDraftPreview();
  };

  handleSelectFamily = (nextFamily: HideSeekQuestionFamily) => {
    this.pendingFocusPanelTitle = true;
    batch(() => {
      this.familySig.value = nextFamily;
      this.optionSig.value = "";
      this.radiusDraftSig.value = "";
    });
    void this.updateDraftPreview();
  };

  handleBackToDeck = () => {
    this.pendingFocusPanelTitle = true;
    batch(() => {
      this.familySig.value = null;
      this.optionSig.value = "";
      this.radiusDraftSig.value = "";
    });
    void this.updateDraftPreview();
  };

  handleSelectOption = (itemId: string) => {
    this.optionSig.value = itemId;
    void this.updateDraftPreview();
  };

  handleRadiusInput = (value: string) => {
    this.radiusDraftSig.value = value;
    this.mapHandle?.setQuestionPreview();
    window.clearTimeout(this.previewTimer);
    this.previewTimer = window.setTimeout(() => {
      void this.updateDraftPreview();
    }, 160);
  };

  handleToggleKeep = (instanceId: string) => {
    const current = this.liveSig.peek();
    const draw =
      current?.room.role === "hider" ? (current.deck as SeekDeckHiderView).activeDraw : null;
    if (!draw || !draw.cards.some((card) => card.instanceId === instanceId)) return;
    const next = new Set(this.keepIdsSig.peek());
    if (next.has(instanceId)) {
      next.delete(instanceId);
    } else {
      if (draw.keepCount === 1) next.clear();
      if (next.size < draw.keepCount) next.add(instanceId);
    }
    batch(() => {
      this.dealActiveSig.value = null;
      this.keepIdsSig.value = next;
    });
  };

  handleConfirmDraw = () => {
    const current = this.liveSig.peek();
    const activeDraw =
      current?.room.role === "hider" ? (current.deck as SeekDeckHiderView).activeDraw : null;
    const keepIds = this.keepIdsSig.peek();
    if (!activeDraw || keepIds.size !== activeDraw.keepCount) return;
    void this.runGuardedAction("confirm-draw", "board-checkin", undefined, async () => {
      await this.postDeckAction({ kind: "choose-draw", keepInstanceIds: [...keepIds] });
    });
  };

  handleSelectPhotoFile = (file: File | undefined) => {
    const questionId = this.pendingId;
    batch(() => {
      this.seekPhotoDraftSig.value = null;
      this.inlineErrorSig.value = null;
    });
    if (!file) return;
    const seqNum = ++this.seekPhotoSeq;
    const promise = preparePhotoFile(file);
    this.seekPhotoDraftSig.value = { processing: true, prepared: null, promise, seq: seqNum };
    void promise.then(
      (prepared) => {
        if (
          questionId !== this.pendingId ||
          this.lifecycle.signal.aborted ||
          this.seekPhotoDraftSig.peek()?.seq !== seqNum
        ) {
          return;
        }
        this.seekPhotoDraftSig.value = { processing: false, prepared, seq: seqNum };
      },
      (error) => {
        if (
          questionId !== this.pendingId ||
          this.lifecycle.signal.aborted ||
          this.seekPhotoDraftSig.peek()?.seq !== seqNum
        ) {
          return;
        }
        this.seekPhotoDraftSig.value = null;
        this.reportError(error, { action: "answer-photo", target: questionId }, "answer-photo");
      },
    );
  };

  handleClearPhoto = () => {
    batch(() => {
      this.seekPhotoDraftSig.value = null;
      if (this.inlineErrorSig.peek()?.slot === "answer-photo") {
        this.inlineErrorSig.value = null;
      }
    });
  };

  handleSubmitPhoto = (questionId: string) => {
    void this.runGuardedAction("answer-photo", "answer-photo", questionId, async () => {
      const draft = this.seekPhotoDraftSig.peek();
      let prepared = draft?.prepared ?? null;
      if (!prepared && draft?.processing && draft.promise) {
        try {
          prepared = await draft.promise;
        } catch (error) {
          if (!this.lifecycle.signal.aborted) {
            this.seekPhotoDraftSig.value = null;
            this.reportError(error, { action: "answer-photo", target: questionId }, "answer-photo");
          }
          return;
        }
      }
      if (!prepared) {
        this.reportError("photo-required", { action: "answer-photo", target: questionId }, "answer-photo");
        return;
      }
      const pending = this.ensurePendingAction(
        JSON.stringify([this.roomCode, "answer-photo", questionId]),
        "answer-photo",
        { questionId },
      );
      ++this.seq;
      batch(() => {
        this.busySig.value = true;
        this.seekPhotoUploadingSig.value = true;
      });
      try {
        const { ok, status, data: response } = await fetchApiJson<{ error?: string }>(
          "/api/rulebooks/seek-photo",
          {
            signal: this.lifecycle.signal,
            body: {
              roomCode: this.roomCode,
              questionId,
              actionId: pending.id,
              photoBase64: prepared.base64,
            },
          },
        );
        this.clearPendingAction();
        if (response.error || !ok) {
          this.reportError(
            { error: response.error ?? "invalid-photo", status },
            { action: "answer-photo", target: questionId },
            "answer-photo",
          );
        } else {
          batch(() => {
            this.seekPhotoDraftSig.value = null;
            this.inlineErrorSig.value = null;
          });
          this.toast.clear();
          this.toast.resetDedupe();
        }
        await this.refreshRoom(false, true).catch(() => {});
      } catch (error) {
        if (!this.lifecycle.signal.aborted) {
          const resolved = this.reportError(
            error,
            { action: "answer-photo", target: questionId },
            "answer-photo",
          );
          if (!resolved.uncertain) this.clearPendingAction();
        }
      } finally {
        this.seekPhotoUploadingSig.value = false;
        this.flushPendingPayloadAndUnlock();
      }
    });
  };

  handleAskClue = (family: HideSeekQuestionFamily, itemId: string) => {
    void this.runGuardedAction("ask-clue", "ask-field", itemId || family, async () => {
      const radius = this.root.querySelector<HTMLInputElement>("#sg-radius");
      if (radius && (!radius.reportValidity() || !Number.isFinite(radius.valueAsNumber))) {
        this.reportError("invalid-custom-radius", { action: "ask-clue" }, "ask-field");
        return;
      }
      const customRadiusMeters = radius?.valueAsNumber;
      const mapQuestion = family !== "photo" && family !== "thermometer";
      const preview = this.activeDraftPreview();
      if (mapQuestion && (!preview || !this.previewIsFresh(preview.validUntil))) {
        void this.updateDraftPreview(true);
        return;
      }
      const thermEnd = this.thermometerEndSig.peek();
      const fix =
        preview?.fix ??
        (family === "thermometer" && thermEnd
          ? thermEnd
          : await this.locationFix(this.seekerPoint()));
      const sent = await this.postRoomAction({
        type: "ask",
        family,
        itemId,
        ...(customRadiusMeters !== undefined ? { customRadiusMeters } : {}),
        fix,
      });
      if (sent) {
        this.draftFix = undefined;
        batch(() => {
          this.draftPreviewSig.value = undefined;
          this.thermometerEndSig.value = undefined;
          this.radiusDraftSig.value = "";
        });
      }
    });
  };

  handleStartThermometer = () => {
    void this.runGuardedAction("start-thermometer", "ask-field", undefined, async () => {
      this.thermometerEndSig.value = undefined;
      await this.postRoomAction({
        type: "start-thermometer",
        fix: await this.locationFix(this.seekerPoint()),
      });
    });
  };

  handleMarkThermometerEnd = () => {
    void this.runGuardedAction("mark-thermometer-end", "ask-field", undefined, async () => {
      const fix = await this.locationFix(this.seekerPoint());
      this.thermometerEndSig.value = fix;
      if (!(await this.postRoomAction({ type: "seeker-check-in", fix }))) {
        this.thermometerEndSig.value = undefined;
      }
    });
  };

  handleSubmitFoundCode = () => {
    const code = this.foundCodeDraftSig.peek().trim();
    this.foundCodeDraftSig.value = code;
    if (!/^\d{4}$/.test(code)) {
      this.reportError("invalid-found-code", { action: "submit-found-code" }, "found-code");
      this.root.querySelector<HTMLInputElement>("#rb-found-input")?.focus({ preventScroll: true });
      return;
    }
    void this.runGuardedAction("submit-found-code", "found-code", undefined, async () => {
      await this.postRoomAction({ type: "submit-found-code", code });
    });
  };

  handlePlayCard = (cardInstanceId: string, primitive: string) => {
    void this.runGuardedAction("play-card", "board-checkin", cardInstanceId, async () => {
      const params: Record<string, unknown> = { cardInstanceId };
      if (primitive === "time_trap") {
        params.targetStationId =
          this.pointById(this.stationIdSig.peek())?.id ??
          this.liveSig.peek()?.publicBoard.stations[0]?.id;
      }
      if (primitive === "curse") params.photoId = "sim-curse-cost-photo";
      await this.postPlayCard(params);
    });
  };

  handleRetryMap = () => {
    this.mapConfigRequest = undefined;
    this.mapKey = "";
    this.mapFailedSig.value = false;
  };

  destroy(): void {
    this.lifecycle.abort();
    this.fx.destroy();
    closeLobbyDialog();
    this.liveLocation.stop();
    this.roomEvents.destroy();
    window.clearTimeout(this.previewTimer);
    window.clearTimeout(this.copiedCodeTimer);
    window.clearTimeout(this.copiedLinkTimer);
    window.clearInterval(this.ticker);
    this.root.removeAttribute("aria-busy");
    this.closeMap();
    this.destroyStartMiniMap();
  }
}

function SeekActiveGame({
  ctrl,
  payload,
}: {
  ctrl: SeekController;
  payload: SeekRoomPayload;
}) {
  const { room, deck } = payload;
  const isHider = room.role === "hider";
  const panel = ctrl.panelSig.value;
  const photoClueFocus = ctrl.photoClueFocusSig.value;
  const family = ctrl.familySig.value;
  const option = ctrl.optionSig.value;
  const stationId = ctrl.stationIdSig.value;
  const answerChoice = ctrl.answerChoiceSig.value;
  const keepIds = ctrl.keepIdsSig.value;
  const deal = ctrl.dealActiveSig.value;
  const thermometerEnd = ctrl.thermometerEndSig.value;
  const previewLoadingKey = ctrl.previewLoadingSig.value;
  const previewError = ctrl.previewErrorSig.value;
  const draftPreview = ctrl.draftPreviewSig.value;
  const seekPhotoDraft = ctrl.seekPhotoDraftSig.value;
  const seekPhotoUploading = ctrl.seekPhotoUploadingSig.value;
  const inlineError = ctrl.inlineErrorSig.value;
  const statusMsg = ctrl.statusMsgSig.value;
  const busy = ctrl.busySig.value;
  const mapFailed = ctrl.mapFailedSig.value;
  const qaStationId = ctrl.qaStationIdSig.value;
  const selfFix = ctrl.selfFixSig.value;
  const liveLocationStatus = ctrl.liveLocationStatusSig.value;
  const cueRevision = ctrl.cueRevisionSig.value;
  const radiusDraft = ctrl.radiusDraftSig.value;

  const controlsRef = useRef<HTMLDivElement | null>(null);
  const activityHostRef = useRef<HTMLDivElement | null>(null);
  const flightsHost = useRef<HTMLDivElement>(null);
  const stopFlights = useRef<(() => void) | undefined>(undefined);
  const mapHostRef = useRef<HTMLElement | null>(null);

  const selectedNav: SeekPanel = isHider ? "hand" : "ask";
  const foundCode = isHider && room.phase === "seeking" ? room.foundCode : undefined;
  const latest = [...room.questions]
    .reverse()
    .find(
      (question) =>
        question.answerLabel &&
        question.overlay &&
        question.askedAt >= (room.deductionResetAt ?? 0),
    );
  const hasMapResult = Boolean(latest && panel !== "history" && !mapFailed);
  const activeScreenAlert =
    inlineError && (inlineError.slot === "lobby" || inlineError.slot === "catalog")
      ? inlineError
      : null;

  const activeCueKey: PhaseCueKey | null =
    room.phase === "head_start"
      ? isHider
        ? "seek-head-start-hider"
        : "seek-head-start-seeker"
      : room.phase === "seeking"
        ? isHider
          ? "seek-seeking-hider"
          : "seek-seeking-seeker"
        : null;

  const draft = ctrl.selectedMapQuestion();
  const activePreview = draftPreview && draft && draftPreview.key === draft.key ? draftPreview : undefined;

  const nextMapKey = JSON.stringify([
    room.code,
    room.turnNumber,
    room.role,
    room.phase,
    room.ownAnchorStationId,
    room.seekerPosition,
    room.questions,
    room.deductionResetAt,
    room.moveZoneUntil,
    room.thermometerStart,
    thermometerEnd,
    answerChoice,
    stationId,
  ]);

  const handleMountMapHost = useRef((container: HTMLElement) => {
    mapHostRef.current = container;
    ctrl.mapHostEl = container;
    return () => {
      mapHostRef.current = null;
      ctrl.closeMap();
    };
  }).current;

  const getMapHost = useRef(() => mapHostRef.current).current;

  // Synchronously bind toast layout, room activity host, MapLibre overlay updates, and
  // committed game-motion effects right after Preact commits DOM.
  useLayoutEffect(() => {
    ctrl.toast.setLayout("game", hasMapResult || Boolean(payload.activity.prompt));
    ctrl.activityUi.mount(activityHostRef.current, hasMapResult);

    if (photoClueFocus !== null) {
      ctrl.photoClueFocusSig.value = null;
      const clue = controlsRef.current?.querySelector<HTMLElement>(`[data-photo-clue-index="${photoClueFocus}"]`);
      if (clue) {
        clue.scrollIntoView({ block: "nearest" });
        clue.focus({ preventScroll: true });
      }
    }

    if (ctrl.pendingFocusPanelTitle) {
      ctrl.pendingFocusPanelTitle = false;
      controlsRef.current
        ?.querySelector<HTMLElement>("#sg-panel-title")
        ?.focus({ preventScroll: true });
    }

    const effects = ctrl.pendingEffects;
    ctrl.pendingEffects = [];

    const roleSequence = ctrl.pendingRoleMotion;
    ctrl.pendingRoleMotion = null;
    const flights = ctrl.pendingCardFlights;
    ctrl.pendingCardFlights = [];
    if (flights.length && flightsHost.current) {
      stopFlights.current?.();
      const hand = controlsRef.current?.querySelector<HTMLElement>('[data-panel="hand"]') ?? null;
      stopFlights.current = animateSeekCardFlights(flightsHost.current, hand, flights);
    }
    if (!isHider) stopFlights.current?.();
    const roleEffect = effects
      .filter((event) => event.kind === "role")
      .at(-1);
    const cardEffect = effects
      .filter((event) => event.kind === "card" || event.kind === "curse")
      .at(-1);
    const deduction = effects.filter((event) => event.mapChange).at(-1);

    const mapHost = mapHostRef.current;
    if (mapHost) {
      if (mapFailed) {
        if (ctrl.mapKey) {
          ctrl.mapRequest++;
          ctrl.mapHandle?.destroy();
          ctrl.mapHandle = undefined;
          mapHost.replaceChildren();
          ctrl.mapKey = "";
        }
      } else if (ctrl.mapKey !== nextMapKey) {
        ctrl.mapKey = nextMapKey;
        const geometry = latest?.overlay?.type;
        void ctrl.mountMapOverlay(mapHost, payload).then(() => {
          if (
            deduction &&
            geometry &&
            motionAllowed() &&
            mapHost.isConnected &&
            ctrl.mapKey === nextMapKey &&
            ctrl.liveSig.peek()?.room.code === room.code
          ) {
            ctrl.mapHandle?.pulseDeduction(geometry);
            if (geometry === "station_filter" || geometry === "distance_compare") {
              const pins = mapHost.querySelectorAll<HTMLElement>(".board-map-pin-station");
              pins.forEach((marker, index) => {
                playGameMotion(marker, "update", deduction.sequence, Math.min(index, 15) * 0.038);
              });
            }
          }
        });
      } else {
        ctrl.mapHandle?.setQuestionPreview(activePreview?.data, ctrl.previewPadding(mapHost));
      }
    }

    const roleMotion = roleEffect?.sequence ?? roleSequence;
    if (roleMotion !== null) {
      playGameMotion(
        controlsRef.current?.querySelector<HTMLElement>(".sg-role") ?? null,
        "role",
        roleMotion,
      );
    }
    if (cardEffect) {
      playGameMotion(
        controlsRef.current?.querySelector<HTMLElement>(
          isHider ? '[data-panel="hand"]' : '[data-panel="board"]',
        ) ?? null,
        "update",
        cardEffect.sequence,
      );
    }
    if (deduction) {
      playGameMotion(
        controlsRef.current?.querySelector<HTMLElement>(".sg-map-result") ?? null,
        "update",
        deduction.sequence,
      );
    }
  });

  useEffect(() => {
    return () => {
      stopFlights.current?.();
      ctrl.activityUi.mount(null);
    };
  }, [ctrl]);

  const showSheet = Boolean(panel || activeScreenAlert || statusMsg);

  // Read radiusDraft so activePreview stays aligned if user types a custom radius.
  void radiusDraft;

  return (
    <section class="sg-game" aria-label="Papan Hide & Seek" data-role={room.role}>
      <MapHost id="sg-map" className="sg-board" onMount={handleMountMapHost} />
      <SeekPinFreshnessSync
        seekerAt={room.seekerPosition?.at}
        clockNowSig={ctrl.clockNowSig}
        getMapHost={getMapHost}
      />
      <GameFxOverlay controller={ctrl.fx} />
      <div ref={flightsHost} aria-hidden="true" />
      <div ref={activityHostRef} class="room-activity-host" />
      <div ref={controlsRef} id="sg-controls">
        <SeekHud
          payload={payload}
          panel={panel}
          hasMapResult={hasMapResult}
          latestResult={latest}
          busy={busy}
          clockNowSig={ctrl.clockNowSig}
          connectionStateSig={ctrl.connectionStateSig}
          onToggleQaPanel={() => ctrl.handleTogglePanel("qa")}
          onOpenQuickGuide={ctrl.handleOpenQuickGuide}
          onOpenActivity={() => ctrl.handleTogglePanel("activity")}
          onRefresh={ctrl.handleRefresh}
          onNavigateCatalog={ctrl.handleNavigateCatalog}
          onConfirmLeave={ctrl.handleConfirmLeave}
        />

        <div class="sg-dock">
          {activeCueKey && (
            <PhaseCueStrip
              cueKey={activeCueKey}
              cueRevision={cueRevision}
              onDismiss={() => {
                ctrl.cueRevisionSig.value += 1;
              }}
            />
          )}

          <SeekDockSheet panel={panel} open={showSheet}>
              {activeScreenAlert && (
                <InlineAlert message={activeScreenAlert.message} tone={activeScreenAlert.tone} />
              )}
              {statusMsg && <p role="status">{statusMsg}</p>}
              {panel === "activity" && (
                <SeekActivityPanel feed={payload.activity} clockNowSig={ctrl.clockNowSig} />
              )}
              {panel === "qa" && payload.qa && (
                <SeekQaPanel
                  payload={payload}
                  qaStationId={qaStationId}
                  busy={busy}
                  onSelectQaLocation={ctrl.handleSelectQaLocation}
                  onAdvanceClock={ctrl.handleAdvanceQaClock}
                />
              )}
              {panel === "found-code" && foundCode && (
                <>
                  <h2 id="sg-panel-title" tabIndex={-1}>Kode temuan</h2>
                  <div class="sg-found-code" data-testid="hider-found-code">{foundCode}</div>
                  <p>Berikan kode ini saat pencari menemukanmu.</p>
                </>
              )}
              {panel === "board" && (
                <SeekBoardPanel
                  payload={payload}
                  stationId={stationId}
                  qaStationId={qaStationId}
                  mapFailed={mapFailed}
                  selfFix={selfFix}
                  liveLocationStatus={liveLocationStatus}
                  foundCodeDraftSig={ctrl.foundCodeDraftSig}
                  inlineError={inlineError}
                  busy={busy}
                  onEnableLocation={() => ctrl.liveLocation.start()}
                  onRetryMap={ctrl.handleRetryMap}
                  onSelectStation={(id) => {
                    ctrl.stationIdSig.value = id;
                    void ctrl.updateDraftPreview();
                  }}
                  onLockAnchor={(stId) => {
                    void ctrl.runGuardedAction("lock-anchor", "board-checkin", stId, async () => {
                      await ctrl.postRoomAction({
                        type: "lock-anchor",
                        stationId: stId,
                        fix: await ctrl.locationFix(ctrl.pointById(stId)),
                      });
                    });
                  }}
                  onSeekerCheckIn={() => {
                    void ctrl.runGuardedAction("seeker-check-in", "board-checkin", undefined, async () => {
                      await ctrl.postRoomAction({
                        type: "seeker-check-in",
                        fix: await ctrl.locationFix(ctrl.seekerPoint()),
                      });
                    });
                  }}
                  onSubmitFoundCode={ctrl.handleSubmitFoundCode}
                  onClearCurseGps={(curseId) => {
                    void ctrl.runGuardedAction("clear-curse-gps", "curse-action", curseId, async () => {
                      await ctrl.postDeckAction({
                        kind: "clear-curse-gps",
                        curseInstanceId: curseId,
                        fix: await ctrl.locationFix(ctrl.seekerPoint()),
                      });
                    });
                  }}
                  onSubmitCursePhoto={(curseId) => {
                    void ctrl.runGuardedAction("submit-curse-photo", "curse-action", curseId, async () => {
                      await ctrl.postDeckAction({
                        kind: "submit-curse-photo",
                        curseInstanceId: curseId,
                        photoId: `curse-photo-${Date.now()}`,
                      });
                    });
                  }}
                  onClearCurseHonor={(curseId) => {
                    void ctrl.runGuardedAction("clear-curse-honor", "curse-action", curseId, async () => {
                      await ctrl.postDeckAction({
                        kind: "clear-curse-honor",
                        curseInstanceId: curseId,
                      });
                    });
                  }}
                  onBuyoutCurse={(curseId) => {
                    void ctrl.runGuardedAction("buyout-curse", "curse-action", curseId, async () => {
                      await ctrl.postDeckAction({
                        kind: "buyout-curse",
                        curseInstanceId: curseId,
                      });
                    });
                  }}
                  onReviewCursePhoto={(curseId, approve) => {
                    void ctrl.runGuardedAction("review-curse-photo", "curse-action", curseId, async () => {
                      await ctrl.postDeckAction({
                        kind: "review-curse-photo",
                        curseInstanceId: curseId,
                        approve,
                      });
                    });
                  }}
                />
              )}
              {panel === "history" && <SeekHistoryPanel room={room} />}
              {panel === "ask" && !isHider && (
                <SeekAskCluePanel
                  payload={payload}
                  family={family}
                  option={option}
                  thermometerEnd={thermometerEnd}
                  radiusDraftSig={ctrl.radiusDraftSig}
                  draft={draft}
                  activePreview={activePreview}
                  previewLoadingKey={previewLoadingKey}
                  previewError={previewError}
                  inlineError={inlineError}
                  busy={busy}
                  mapFailed={mapFailed}
                  clockNowSig={ctrl.clockNowSig}
                  onSelectFamily={ctrl.handleSelectFamily}
                  onBackToDeck={ctrl.handleBackToDeck}
                  onSelectOption={ctrl.handleSelectOption}
                  onRadiusInput={ctrl.handleRadiusInput}
                  onFocusPreview={() => {
                    if (mapHostRef.current) {
                      ctrl.mapHandle?.focusQuestionPreview(ctrl.previewPadding(mapHostRef.current));
                    }
                  }}
                  onRefreshPreview={() => {
                    void ctrl.updateDraftPreview(true);
                  }}
                  onStartThermometer={ctrl.handleStartThermometer}
                  onMarkThermometerEnd={ctrl.handleMarkThermometerEnd}
                  onAskClue={ctrl.handleAskClue}
                />
              )}
              {(panel === "hand" || panel === "question") && isHider && (
                <SeekHandPanel
                  payload={payload}
                  panel={panel}
                  deal={deal}
                  keepIds={keepIds}
                  selectedAnswer={answerChoice}
                  photoDraft={
                    seekPhotoDraft
                      ? {
                          prepared: seekPhotoDraft.prepared,
                          processing: seekPhotoDraft.processing,
                          uploading: seekPhotoUploading,
                        }
                      : null
                  }
                  inlineError={inlineError}
                  busy={busy}
                  clockNowSig={ctrl.clockNowSig}
                  onToggleKeep={ctrl.handleToggleKeep}
                  onConfirmDraw={ctrl.handleConfirmDraw}
                  onChooseAnswer={(code) => {
                    ctrl.answerChoiceSig.value = code;
                  }}
                  onSubmitAnswer={(qId) => {
                    void ctrl.runGuardedAction("answer-pending", "answer-field", qId, async () => {
                      await ctrl.postRoomAction({
                        type: "answer-question",
                        questionId: qId,
                        answerCode: ctrl.answerChoiceSig.peek(),
                      });
                    });
                  }}
                  onSelectPhotoFile={ctrl.handleSelectPhotoFile}
                  onClearPhoto={ctrl.handleClearPhoto}
                  onSubmitPhoto={ctrl.handleSubmitPhoto}
                  onPlayCard={ctrl.handlePlayCard}
                />
              )}
          </SeekDockSheet>

          <nav class="sg-nav" aria-label="Aksi permainan">
            <button
              type="button"
              data-action="game-panel"
              data-panel={selectedNav}
              aria-pressed={panel === selectedNav ? "true" : "false"}
              disabled={busy}
              onClick={() => ctrl.handleTogglePanel(selectedNav)}
            >
              <span class="sg-nav-icon" aria-hidden="true">
                {isHider ? "▤" : "✦"}
              </span>
              {isHider ? `Kartu ${deck.hiderHandCount}` : "Tanya"}
            </button>
            <button
              type="button"
              data-action="game-panel"
              data-panel="history"
              aria-pressed={panel === "history" ? "true" : "false"}
              disabled={busy}
              onClick={() => ctrl.handleTogglePanel("history")}
            >
              <span class="sg-nav-icon" aria-hidden="true">
                ◷
              </span>
              Riwayat
            </button>
            <button
              type="button"
              data-action="game-panel"
              data-panel="board"
              aria-pressed={panel === "board" ? "true" : "false"}
              disabled={busy}
              onClick={() => ctrl.handleTogglePanel("board")}
            >
              <span class="sg-nav-icon" aria-hidden="true">
                ◇
              </span>
              Titik
            </button>
            {foundCode && (
              <button
                type="button"
                data-action="game-panel"
                data-panel="found-code"
                aria-label="Kode temuan"
                aria-pressed={panel === "found-code"}
                disabled={busy}
                onClick={() => ctrl.handleTogglePanel("found-code")}
              >
                <span class="sg-nav-icon" aria-hidden="true">#</span>
                Kode
              </button>
            )}
          </nav>
        </div>
      </div>
    </section>
  );
}

function RulebookSeekApp({ ctrl }: { ctrl: SeekController }) {
  const live = ctrl.liveSig.value;
  const busy = ctrl.busySig.value;
  const statusMsg = ctrl.statusMsgSig.value;
  const inlineError = ctrl.inlineErrorSig.value;
  const boardPhase = Boolean(live && isBoardPhase(live.room));

  useLayoutEffect(() => {
    if (!boardPhase) {
      ctrl.activityUi.mount(null);
      ctrl.toast.setLayout("page");
      ctrl.pendingEffects = [];
    }
  }, [boardPhase, live, ctrl]);

  if (!live && ctrl.roomCode) {
    return <RestoreRulebookRoom error={inlineError?.message} onBack={ctrl.onBack} />;
  }

  if (!live) {
    return (
      <SeekCatalogView
        listings={ctrl.listingsSig.value}
        ownedPackIds={ctrl.ownedPackIdsSig.value}
        entitlements={ctrl.entitlementsSig.value}
        allowHideSeekQa={ctrl.allowHideSeekQaSig.value}
        allowSandboxCheckout={ctrl.allowSandboxCheckoutSig.value}
        activeOrderId={ctrl.activeOrderIdSig.value}
        statusMsg={statusMsg}
        inlineError={inlineError}
        busy={busy}
        joinCodeSig={ctrl.joinCodeSig}
        joinNameSig={ctrl.joinNameSig}
        onJoinNameEdited={() => {
          ctrl.joinNameEdited = true;
        }}
        onJoinRoom={ctrl.handleJoinRoom}
        onStartFree={(packId, version) => ctrl.handleCreateRoom("start-free", packId, version)}
        onStartOwned={(packId, version) => ctrl.handleCreateRoom("start-owned", packId, version)}
        onStartQa={(packId, version) => ctrl.handleCreateRoom("start-qa", packId, version)}
        onResumeOwned={ctrl.handleResumeOwned}
        onBuyPack={ctrl.handleBuyPack}
        onSettleOrder={ctrl.handleSettleOrder}
        onOpenStudio={ctrl.handleOpenStudio}
        onBack={ctrl.onBack}
      />
    );
  }

  if (!boardPhase) {
    return (
      <SeekRoomShellView
        payload={live}
        ownedPackIds={ctrl.ownedPackIdsSig.value}
        allowHideSeekQa={ctrl.allowHideSeekQaSig.value}
        statusMsg={statusMsg}
        inlineError={inlineError}
        busy={busy}
        copiedCode={ctrl.copiedCodeSig.value}
        copiedLink={ctrl.copiedLinkSig.value}
        editingName={ctrl.editingNameSig.value}
        renameDraftSig={ctrl.renameDraftSig}
        startMapExpanded={ctrl.startMapExpandedSig.value}
        qaStationId={ctrl.qaStationIdSig.value}
        selfFix={ctrl.selfFixSig.value}
        liveLocationStatus={ctrl.liveLocationStatusSig.value}
        cueRevision={ctrl.cueRevisionSig.value}
        clockNowSig={ctrl.clockNowSig}
        onDismissCue={() => {
          ctrl.cueRevisionSig.value += 1;
        }}
        onEnableLocation={() => ctrl.liveLocation.start()}
        onToggleStartMap={() => {
          ctrl.startMapExpandedSig.value = !ctrl.startMapExpandedSig.peek();
        }}
        onMountStartMiniMap={ctrl.mountStartMiniMap}
        onCopyCode={ctrl.handleCopyCode}
        onShareInvite={ctrl.handleShareInvite}
        onShowQr={ctrl.handleShowQr}
        onEditName={ctrl.handleEditName}
        onSaveName={ctrl.handleSaveName}
        onCancelName={ctrl.handleCancelName}
        onMoveTurn={ctrl.handleMoveTurn}
        onShuffleTurns={ctrl.handleShuffleTurns}
        onStartCheckIn={() => {
          void ctrl.runGuardedAction("sim-start-checkin", "lobby-checkin", undefined, async () => {
            await ctrl.postRoomAction({
              type: "check-in-start",
              fix: await ctrl.locationFix(live.room.turnStartPoint),
            });
          });
        }}
        onMarkReady={() => {
          void ctrl.runGuardedAction("mark-ready", "lobby", undefined, async () => {
            await ctrl.postRoomAction({ type: "ready", ready: true });
          });
        }}
        onUnmarkReady={() => {
          void ctrl.runGuardedAction("unmark-ready", "lobby", undefined, async () => {
            await ctrl.postRoomAction({ type: "ready", ready: false });
          });
        }}
        onStartMatch={() => {
          void ctrl.runGuardedAction("start-match", "lobby", undefined, async () => {
            await ctrl.postRoomAction({ type: "start" });
          });
        }}
        onStartQa={(packId, version) => ctrl.handleCreateRoom("start-qa", packId, version)}
        onSelectQaLocation={ctrl.handleSelectQaLocation}
        onAdvanceQaClock={ctrl.handleAdvanceQaClock}
        onRegroupCheckIn={() => {
          void ctrl.runGuardedAction("regroup", "regroup-checkin", undefined, async () => {
            const fix = live.room.regroupPoint
              ? await ctrl.locationFix(live.room.regroupPoint)
              : undefined;
            await ctrl.postRoomAction({ type: "regroup-check-in", fix });
          });
        }}
        onOpenQuickGuide={ctrl.handleOpenQuickGuide}
        onRefresh={ctrl.handleRefresh}
        onNavigateCatalog={ctrl.handleNavigateCatalog}
        onConfirmLeave={ctrl.handleConfirmLeave}
        onPlayAgain={() => {
          void ctrl.executePlayAgain();
        }}
        onJoinNewRoom={ctrl.handleJoinNewRoom}
      />
    );
  }

  return <SeekActiveGame ctrl={ctrl} payload={live} />;
}

export function mountRulebookSeekPlay(root: HTMLElement, onBack: () => void): () => void {
  const ctrl = new SeekController(root, onBack);
  const unmount = mountPreact(root, () => <RulebookSeekApp ctrl={ctrl} />);
  return () => {
    ctrl.destroy();
    unmount();
  };
}
