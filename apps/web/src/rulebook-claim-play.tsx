import type {
  ClaimEngineRoomView,
  ClaimSeatPosition,
  GeoCoordinate,
  LocationFix,
  RoomActivityEvent,
  RulebookEntitlementSummary,
  RulebookPlayMode,
} from "@kelana-ria/contracts";
import { batch, useSignal } from "@preact/signals";
import { useEffect, useLayoutEffect, useRef } from "preact/hooks";
import { clearActiveRoom, saveActiveRoom } from "./active-room-storage";
import { fetchAuthMe, getCachedAuth, onAuthChange, openAuthModal } from "./auth-modal";
import type { BoardMapHandle, BoardMapUpdateOptions } from "./board-map";
import { ClaimActivityPanel } from "./claim/ClaimActivityPanel";
import { ClaimCardsPanel } from "./claim/ClaimCardsPanel";
import { ClaimCatalogView } from "./claim/ClaimCatalogView";
import { ClaimHud } from "./claim/ClaimHud";
import {
  ClaimActiveAlerts,
  ClaimActiveAttempt,
  ClaimLandmarkDetail,
  ClaimLandmarkList,
  ClaimRivalCard,
} from "./claim/ClaimLandmarkPanel";
import { ClaimLobbyView } from "./claim/ClaimLobbyView";
import { ClaimRivalPositionsList, ClaimScorePanel } from "./claim/ClaimScorePanel";
import { ClaimDraftBar } from "./claim/ClaimShared";
import { claimZoneOwnership, ClaimZoneList } from "./claim/ClaimZoneOwnership";
import {
  cardTargets,
  destructiveExitSpec,
  getActiveLeaf,
  isQaRoom,
  landmarkStatus,
  nextFreshTeamId,
  orderedTeamIds,
  readSessionId,
  resolveQaCoord,
  seatInitials,
  teamName,
  writeSessionId,
  zoneLabelFor,
  type ClaimInlineError,
  type ClaimInlineSlot,
  type ClaimPanel,
  type ClaimPublicListing,
  type ClaimRoomPayload,
  type PendingClaimAction,
  claimPanels,
} from "./claim/types";
import { getLocation } from "./device-location";
import { playGameMotion } from "./game-motion";
import { resolveDefaultPlayerName, saveRememberedGuestName } from "./guest-name";
import {
  createLiveLocationWatcher,
  haversineMeters,
  type LiveLocationStatus,
} from "./live-location";
import {
  canUseWebShare,
  CanceledRoomCard,
  closeLobbyDialog,
  copyToClipboard,
  openConfirmDialog,
  openQrModal,
  openQuickJoinRoomDialog,
} from "./lobby-ui";
import { fetchMapConfig } from "./map-config";
import { preparePhotoFile, type PhotoDraftState } from "./photo-capture";
import {
  fetchApiJson,
  resolvePlayerError,
  type PlayerErrorSurface,
} from "./player-errors";
import { createPlayerToast } from "./player-toast";
import { openQuickGuideModal } from "./quick-guide";
import { createRoomActivityUi, formatRelativeAge, freshnessBucket } from "./room-activity";
import { createRoomEventBridge, type RoomConnectionState } from "./room-events";
import { isSimulatedLocationAllowed } from "./runtime-config";
import { InlineAlert } from "./ui/InlineAlert";
import { MapHost } from "./ui/MapHost";
import { mountPreact } from "./ui/mount";
import { PhaseCueStrip } from "./ui/PhaseCueStrip";
import "./rulebook-seek-play.css";
import "./rulebook-claim-play.css";

function ClaimPlayApp({
  root,
  onBack,
  lifetime,
}: {
  root: HTMLElement;
  onBack: () => void;
  lifetime: AbortController;
}) {
  const initialRoomCode = new URLSearchParams(location.search).get("room") ?? "";

  const allowSandboxCheckoutSig = useSignal(false);
  const listingsSig = useSignal<ClaimPublicListing[]>([]);
  const ownedPackIdsSig = useSignal<string[]>([]);
  const entitlementsSig = useSignal<RulebookEntitlementSummary[]>([]);
  const roomCodeSig = useSignal(initialRoomCode);
  const joinCodeSig = useSignal(initialRoomCode);
  const joinNameSig = useSignal(
    resolveDefaultPlayerName(getCachedAuth()?.user?.displayName, "Pemain"),
  );
  const copiedCodeSig = useSignal(false);
  const copiedLinkSig = useSignal(false);
  const editingNameSig = useSignal(false);
  const renameDraftSig = useSignal("");
  const liveSig = useSignal<ClaimRoomPayload | null>(null);
  const activeOrderIdSig = useSignal<string | null>(null);
  const statusMsgSig = useSignal("");
  const inlineErrorSig = useSignal<ClaimInlineError>(null);
  const busySig = useSignal(false);
  const connectionStateSig = useSignal<RoomConnectionState>(
    typeof navigator === "undefined" || navigator.onLine ? "connected" : "offline",
  );
  const wakeLockWantedSig = useSignal(false);
  const selectedRivalPinSeatIdSig = useSignal("");
  const selfFixSig = useSignal<LocationFix | null>(null);
  const liveLocationStatusSig = useSignal<LiveLocationStatus>("prompt");
  const startMapExpandedSig = useSignal(false);
  const landmarkSortSig = useSignal<"zone" | "nearest">("zone");
  const photoDraftVersionSig = useSignal(0);
  const uploadingPhotoTargetSig = useSignal("");
  const demoLocationSig = useSignal(false);
  const qaLocationIdSig = useSignal("");
  const mapFailedSig = useSignal(false);
  const panelSig = useSignal<ClaimPanel>("challenge");
  const foldedSig = useSignal(false);
  const selectedIdSig = useSignal("");
  const selectedCardIdSig = useSignal("");
  const selectedRivalIdSig = useSignal("");
  const challengeHandIdSig = useSignal("");
  const cueRevisionSig = useSignal(0);
  const clockNowSig = useSignal(Date.now());

  const wakeLockSupported = typeof navigator !== "undefined" && "wakeLock" in navigator;
  const joinNameEditedRef = useRef(false);
  const cachedBoardRef = useRef<{ code: string; board: ClaimRoomPayload["publicBoard"] } | null>(
    null,
  );
  const roomEtagRef = useRef<{ code: string; includeBoard: boolean; value: string } | null>(null);
  const wakeLockSentinelRef = useRef<{
    release: () => Promise<void>;
    addEventListener?: (type: string, cb: () => void) => void;
  } | null>(null);
  const presenceInFlightRef = useRef(false);
  const forcePresenceCatchUpRef = useRef(true);
  const lastPresenceSentAtRef = useRef(0);
  const lastPresenceCoordRef = useRef<GeoCoordinate | null>(null);
  const startMiniMapHandleRef = useRef<BoardMapHandle | undefined>(undefined);
  const startMiniMapRoomCodeRef = useRef("");
  const startMiniMapReqRef = useRef(0);
  const startMiniMapHostRef = useRef<HTMLElement | null>(null);
  const claimMapHandleRef = useRef<BoardMapHandle | undefined>(undefined);
  const claimMapRoomCodeRef = useRef("");
  const claimMapReqRef = useRef(0);
  const claimMapHostRef = useRef<HTMLElement | null>(null);
  const refreshSeqRef = useRef(0);
  const serverOffsetRef = useRef(0);
  const photoDraftsRef = useRef(new Map<string, PhotoDraftState>());
  const photoDraftSeqRef = useRef(0);
  const pendingActionRef = useRef<PendingClaimAction | null>(null);
  const pendingEffectsRef = useRef<RoomActivityEvent[]>([]);
  const lastProcessedActivityKeyRef = useRef("");

  const toastRef = useRef<ReturnType<typeof createPlayerToast> | null>(null);
  const roomEventsRef = useRef<ReturnType<typeof createRoomEventBridge> | null>(null);
  const liveLocationRef = useRef<ReturnType<typeof createLiveLocationWatcher> | null>(null);
  const activityUiRef = useRef<ReturnType<typeof createRoomActivityUi> | null>(null);

  const sheetRef = useRef<HTMLDivElement | null>(null);
  const drawerScoreRef = useRef<HTMLSpanElement | null>(null);
  const cardsTabRef = useRef<HTMLButtonElement | null>(null);
  const activityHostRef = useRef<HTMLElement | null>(null);

  function currentSurface(): PlayerErrorSurface {
    const live = liveSig.value;
    if (!live) return "catalog";
    return live.room.phase === "lobby" ? "lobby" : "claim";
  }

  function releaseWakeLock() {
    const sentinel = wakeLockSentinelRef.current;
    wakeLockSentinelRef.current = null;
    if (sentinel) void sentinel.release().catch(() => {});
  }

  async function syncWakeLock() {
    const live = liveSig.value;
    const active = Boolean(
      wakeLockSupported &&
        wakeLockWantedSig.value &&
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
    if (wakeLockSentinelRef.current) return;
    try {
      const wl = (
        navigator as Navigator & {
          wakeLock?: {
            request: (type: "screen") => Promise<typeof wakeLockSentinelRef.current>;
          };
        }
      ).wakeLock;
      const sentinel = await wl?.request("screen");
      if (!sentinel) return;
      const currentLive = liveSig.value;
      if (
        lifetime.signal.aborted ||
        !wakeLockWantedSig.value ||
        document.hidden ||
        !currentLive ||
        currentLive.room.phase !== "active" ||
        currentLive.room.outcome
      ) {
        void sentinel.release().catch(() => {});
        return;
      }
      wakeLockSentinelRef.current = sentinel;
      sentinel.addEventListener?.("release", () => {
        if (wakeLockSentinelRef.current === sentinel) wakeLockSentinelRef.current = null;
      });
    } catch {
      // Wake lock can be denied by battery saver or browser policy.
    }
  }

  function destroyStartMiniMap() {
    startMiniMapReqRef.current++;
    startMiniMapHandleRef.current?.destroy();
    startMiniMapHandleRef.current = undefined;
    startMiniMapRoomCodeRef.current = "";
  }

  function buildStartMiniMapState(payload: ClaimRoomPayload): BoardMapUpdateOptions {
    const sp = payload.publicBoard.startPoint;
    const fix = selfFixSig.value;
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
      selfLocation: fix
        ? { latitude: fix.latitude, longitude: fix.longitude, accuracy: fix.accuracy }
        : undefined,
      checkInTarget: { center: sp, radiusMeters: payload.publicBoard.checkInRadiusMeters },
      onRequestSelfLocation: () => liveLocationRef.current?.start(),
    };
  }

  async function syncStartMiniMap(host: HTMLElement, payload: ClaimRoomPayload) {
    if (startMiniMapHandleRef.current && startMiniMapRoomCodeRef.current === payload.room.code) {
      startMiniMapHandleRef.current.update(buildStartMiniMapState(payload));
      return;
    }
    const reqId = ++startMiniMapReqRef.current;
    startMiniMapHandleRef.current?.destroy();
    startMiniMapHandleRef.current = undefined;
    startMiniMapRoomCodeRef.current = payload.room.code;
    try {
      const [{ mountBoardMap }, mapCfg] = await Promise.all([
        import("./board-map"),
        fetchMapConfig(lifetime.signal),
      ]);
      const currentLive = liveSig.value;
      if (
        reqId !== startMiniMapReqRef.current ||
        !host.isConnected ||
        !currentLive ||
        currentLive.room.code !== payload.room.code ||
        currentLive.room.phase !== "lobby" ||
        !startMapExpandedSig.value
      ) {
        return;
      }
      const handle = mountBoardMap({
        container: host,
        config: mapCfg,
        camera: {
          center: [
            payload.publicBoard.startPoint.longitude,
            payload.publicBoard.startPoint.latitude,
          ],
          zoom: 15.2,
        },
        ...buildStartMiniMapState(currentLive),
      });
      if (reqId !== startMiniMapReqRef.current) handle.destroy();
      else startMiniMapHandleRef.current = handle;
    } catch {
      if (reqId === startMiniMapReqRef.current) destroyStartMiniMap();
    }
  }

  function destroyClaimMap() {
    claimMapReqRef.current++;
    claimMapHandleRef.current?.destroy();
    claimMapHandleRef.current = undefined;
    claimMapRoomCodeRef.current = "";
  }

  function selectLandmark(id: string) {
    if (busySig.value) return;
    batch(() => {
      if (id.startsWith("rival:")) {
        selectedRivalPinSeatIdSig.value = id.slice(6);
        foldedSig.value = false;
        return;
      }
      selectedRivalPinSeatIdSig.value = "";
      selectedIdSig.value = id;
      foldedSig.value = false;
      if (panelSig.value !== "cards" || !selectedCardIdSig.value) {
        panelSig.value = "challenge";
      }
      if (
        inlineErrorSig.value?.slot === "landmark-checkin" &&
        inlineErrorSig.value.targetId !== id
      ) {
        inlineErrorSig.value = null;
      }
    });
  }

  function buildClaimMapState(payload: ClaimRoomPayload): BoardMapUpdateOptions {
    const { room, publicBoard } = payload;
    const teams = orderedTeamIds(room.seats);
    const mapNow = clockNowSig.peek();
    const stateById = new Map(room.landmarks.map((lm) => [lm.landmarkId, lm]));
    const targets =
      panelSig.value === "cards" && !foldedSig.value
        ? cardTargets(
            room,
            room.ownHand.find((card) => card.instanceId === selectedCardIdSig.value),
          )
        : [];
    const rivalPins =
      room.phase === "active" &&
      !room.isSolo &&
      !room.outcome &&
      room.opponentTracking?.mode !== "off"
        ? (room.seatPositions ?? [])
            .filter((pos) => pos.seatId !== room.seatId)
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
          return leaf?.primitive === "timed_micro_task" &&
            leaf.taskType === "sub_point_gps" &&
            leaf.subPoint
            ? leaf.subPoint
            : undefined;
        })()
      : undefined;
    const selectedLandmarkMeta =
      !selectedRivalPinSeatIdSig.value && selectedIdSig.value
        ? publicBoard.landmarks.find((lm) => lm.id === selectedIdSig.value)
        : undefined;
    const checkInTarget = activeSubPoint
      ? { center: activeSubPoint, radiusMeters: activeSubPoint.radiusMeters }
      : selectedLandmarkMeta
        ? { center: selectedLandmarkMeta, radiusMeters: publicBoard.checkInRadiusMeters }
        : undefined;
    const fix = selfFixSig.value;
    return {
      start: {
        id: publicBoard.startPoint.id,
        name: publicBoard.startPoint.name,
        latitude: publicBoard.startPoint.latitude,
        longitude: publicBoard.startPoint.longitude,
        x: 50,
        y: 50,
      },
      startLabel: "Awal",
      fitPadding: { top: 145, bottom: 205, left: 34, right: 34 },
      selectedId: selectedRivalPinSeatIdSig.value
        ? `rival:${selectedRivalPinSeatIdSig.value}`
        : selectedIdSig.value,
      selfLocation: fix
        ? { latitude: fix.latitude, longitude: fix.longitude, accuracy: fix.accuracy }
        : undefined,
      checkInTarget,
      onRequestSelfLocation: () => liveLocationRef.current?.start(),
      onSelect: selectLandmark,
      checkpoints: [
        ...publicBoard.landmarks.map((lm) => {
          const st = stateById.get(lm.id);
          return {
            id: lm.id,
            name: lm.name,
            zone: lm.zoneId,
            latitude: lm.latitude,
            longitude: lm.longitude,
            x: 50,
            y: 50,
            label: st
              ? `${landmarkStatus(st)}${st.ownerTeamId ? ` · ${teamName(room, st.ownerTeamId)}` : ""}`
              : lm.name,
            markerText: st?.status === "locked" ? "■" : st?.status === "claimed" ? "◆" : "●",
            markerKind: "landmark" as const,
            selectable: true,
            ownerStyle: (st?.ownerTeamId
              ? st.ownerTeamId === room.teamId
                ? "mine"
                : "rival"
              : undefined) as "mine" | "rival" | undefined,
            eligible: targets.includes(lm.id),
            statusTag: st?.status ?? "unclaimed",
            dimmed:
              room.ownBurnedLandmarks.includes(lm.id) ||
              (targets.length > 0 && !targets.includes(lm.id)),
          };
        }),
        ...rivalPins,
      ],
      labels: room.zones.flatMap((zone) => {
        const points = publicBoard.landmarks.filter((lm) => lm.zoneId === zone.zoneId);
        if (points.length === 0) return [];
        const { state, label, visual } = claimZoneOwnership(room, zone, teams);
        const markerState = visual && !room.isSolo ? `${visual.shape} ${visual.label}` : label;
        return [
          {
            id: `zone:${zone.zoneId}`,
            name: zone.name,
            x: 50,
            y: 50,
            latitude: points.reduce((sum, point) => sum + point.latitude, 0) / points.length,
            longitude: points.reduce((sum, point) => sum + point.longitude, 0) / points.length,
            markerText: `${zone.label} · ${markerState}`,
            markerKind: "zone",
            dataAttrs: { "data-zone-state": state },
            colors: visual && { foreground: visual.accent, background: visual.bg },
            label,
          },
        ];
      }),
      onError: () => {
        destroyClaimMap();
        mapFailedSig.value = true;
      },
    };
  }

  async function syncClaimMapOverlay(host: HTMLElement, payload: ClaimRoomPayload) {
    if (claimMapHandleRef.current && claimMapRoomCodeRef.current === payload.room.code) {
      claimMapHandleRef.current.update(buildClaimMapState(payload));
      return;
    }
    if (!claimMapHandleRef.current && claimMapRoomCodeRef.current === payload.room.code && host.isConnected) {
      return;
    }
    const reqId = ++claimMapReqRef.current;
    claimMapHandleRef.current?.destroy();
    claimMapHandleRef.current = undefined;
    claimMapRoomCodeRef.current = payload.room.code;
    try {
      const [{ mountBoardMap }, mapCfg] = await Promise.all([
        import("./board-map"),
        fetchMapConfig(lifetime.signal),
      ]);
      const currentLive = liveSig.value;
      if (
        reqId !== claimMapReqRef.current ||
        !host.isConnected ||
        !currentLive ||
        currentLive.room.code !== payload.room.code
      ) {
        if (reqId === claimMapReqRef.current) claimMapRoomCodeRef.current = "";
        return;
      }
      const handle = mountBoardMap({
        container: host,
        config: mapCfg,
        ...buildClaimMapState(currentLive),
      });
      if (reqId !== claimMapReqRef.current) handle.destroy();
      else claimMapHandleRef.current = handle;
    } catch {
      if (reqId !== claimMapReqRef.current) return;
      destroyClaimMap();
      mapFailedSig.value = true;
    }
  }

  function canPublishPresence(): boolean {
    const live = liveSig.value;
    return Boolean(
      !lifetime.signal.aborted &&
        live &&
        roomCodeSig.value &&
        live.room.phase === "active" &&
        !live.room.isSolo &&
        !live.room.outcome &&
        live.room.opponentTracking?.mode === "periodic_gps" &&
        !document.hidden &&
        navigator.onLine,
    );
  }

  function publishPresenceFix(coord: GeoCoordinate, accuracy: number) {
    const live = liveSig.value;
    if (!canPublishPresence() || presenceInFlightRef.current || !live) return;
    const nowWall = Date.now();
    const minThrottleMs = 3_200;
    const intervalMs = Math.max(
      minThrottleMs,
      Math.min(8_000, live.room.opponentTracking?.intervalMs ?? 10_000),
    );
    const elapsed = nowWall - lastPresenceSentAtRef.current;
    const moved = lastPresenceCoordRef.current
      ? haversineMeters(lastPresenceCoordRef.current, coord)
      : Infinity;
    const shouldSend =
      forcePresenceCatchUpRef.current ||
      !lastPresenceCoordRef.current ||
      elapsed >= intervalMs ||
      (moved >= 10 && elapsed >= minThrottleMs);
    if (!shouldSend) return;

    const codeAtSend = roomCodeSig.value;
    const fix = {
      latitude: coord.latitude,
      longitude: coord.longitude,
      accuracy: Number.isFinite(accuracy) && accuracy >= 0 ? accuracy : 10,
      timestamp: demoLocationSig.value
        ? live.room.now
        : Math.max(0, nowWall + serverOffsetRef.current - 1_000),
    };
    presenceInFlightRef.current = true;
    forcePresenceCatchUpRef.current = false;
    lastPresenceSentAtRef.current = nowWall;
    lastPresenceCoordRef.current = { latitude: fix.latitude, longitude: fix.longitude };
    void fetchApiJson<{ ok?: boolean }>(
      `/api/rulebooks/rooms/${encodeURIComponent(codeAtSend)}/presence`,
      {
        signal: lifetime.signal,
        body: { fix },
      },
    )
      .catch(() => {})
      .finally(() => {
        presenceInFlightRef.current = false;
      });
  }

  function syncPresenceWatch() {
    const live = liveSig.value;
    const watcher = liveLocationRef.current;
    if (!watcher) return;
    if (!live || live.room.outcome || live.room.phase === "canceled") {
      watcher.stop();
      return;
    }
    watcher.checkPermissionAndAutoStart();
    if (canPublishPresence() && watcher.getStatus() === "prompt") {
      watcher.start();
    }
  }

  function ensurePendingAction(
    signature: string,
    kind: string,
    meta?: Pick<PendingClaimAction, "cardInstanceId" | "landmarkId" | "offerId">,
    persistKey?: string,
  ): PendingClaimAction {
    if (pendingActionRef.current?.signature === signature) return pendingActionRef.current;
    const restored = persistKey ? readSessionId(persistKey) : undefined;
    const id = restored ?? `claim-${crypto.randomUUID()}`;
    if (persistKey) writeSessionId(persistKey, id);
    pendingActionRef.current = { signature, id, kind, ...meta };
    return pendingActionRef.current;
  }

  function clearPendingAction(persistKey?: string) {
    pendingActionRef.current = null;
    if (persistKey) writeSessionId(persistKey);
  }

  function reconcilePendingAction(room: ClaimEngineRoomView) {
    const pending = pendingActionRef.current;
    if (!pending) return;
    const { kind, cardInstanceId, landmarkId, offerId } = pending;
    let resolvedOnServer = false;
    if (kind === "play-card" && cardInstanceId) {
      resolvedOnServer = !room.ownHand.some((card) => card.instanceId === cardInstanceId);
      if (resolvedOnServer && selectedCardIdSig.value === cardInstanceId) {
        selectedCardIdSig.value = "";
      }
    } else if (kind === "choose-claim-reward" && offerId) {
      resolvedOnServer = room.ownClaimReward?.offerId !== offerId;
    } else if (kind === "check-in-landmark" && landmarkId) {
      resolvedOnServer = room.ownActiveAttempt?.landmarkId === landmarkId;
    } else if (kind === "start") {
      resolvedOnServer = room.phase !== "lobby";
    } else if (kind === "ready") {
      resolvedOnServer = room.seats.some((seat) => seat.seatId === room.seatId && seat.ready);
    } else if (kind === "check-in-start") {
      resolvedOnServer = room.seats.some(
        (seat) => seat.seatId === room.seatId && seat.startVerifiedUntil !== null,
      );
    } else if ((kind === "bail-challenge" || kind === "submit-challenge") && landmarkId) {
      resolvedOnServer = room.ownActiveAttempt?.landmarkId !== landmarkId;
    } else if (kind === "submit-photo" && landmarkId) {
      resolvedOnServer = !room.ownActiveAttempt || Boolean(room.ownActiveAttempt.pendingPhoto);
    }
    if (resolvedOnServer) {
      pendingActionRef.current = null;
      toastRef.current?.clear();
      toastRef.current?.resetDedupe();
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
    batch(() => {
      if (resolved.staleTarget) {
        selectedIdSig.value = "";
        selectedRivalIdSig.value = "";
        if (resolved.code === "card-not-in-hand" || resolved.code === "no-active-attempt") {
          selectedCardIdSig.value = "";
        }
      }
      if (resolved.placement === "toast") {
        inlineErrorSig.value = null;
        toastRef.current?.show(resolved);
      } else {
        toastRef.current?.clear();
        const slot: ClaimInlineSlot =
          resolved.placement === "inline-screen"
            ? liveSig.value
              ? "lobby"
              : "catalog"
            : inlineSlot;
        inlineErrorSig.value = {
          slot,
          code: resolved.code,
          message: resolved.message,
          tone: resolved.tone,
          targetId:
            slot === "lobby" || slot === "catalog" || slot === "join" || slot === "lobby-checkin"
              ? undefined
              : targetId,
        };
      }
    });
    return resolved;
  }

  function syncRoomUrl(code: string) {
    const url = new URL(location.href);
    if (url.searchParams.get("room") !== code) url.searchParams.delete("adminPlaytest");
    url.searchParams.set("play", "rulebook-claim");
    url.searchParams.delete("pack");
    url.searchParams.delete("launch");
    if (code) url.searchParams.set("room", code);
    else url.searchParams.delete("room");
    history.replaceState(history.state, "", url);
  }

  async function refreshRoom(allowInvitePrompt = false, background = false) {
    const code = roomCodeSig.value;
    if (!code) return;
    const req = ++refreshSeqRef.current;
    const hasBoard = Boolean(
      liveSig.value && cachedBoardRef.current && cachedBoardRef.current.code === code,
    );
    const includeBoard = !hasBoard;
    const path = includeBoard
      ? `/api/rulebooks/rooms/${encodeURIComponent(code)}`
      : `/api/rulebooks/rooms/${encodeURIComponent(code)}?includeBoard=0`;
    const reqHeaders: Record<string, string> = {};
    if (
      roomEtagRef.current &&
      roomEtagRef.current.code === code &&
      roomEtagRef.current.includeBoard === includeBoard
    ) {
      reqHeaders["If-None-Match"] = roomEtagRef.current.value;
    }
    const { status, data, headers, notModified } = await fetchApiJson<
      Omit<ClaimRoomPayload, "publicBoard"> & {
        publicBoard?: ClaimRoomPayload["publicBoard"];
        error?: string;
      }
    >(path, { signal: lifetime.signal, headers: reqHeaders, cache: "no-store" });
    if (
      req !== refreshSeqRef.current ||
      code !== roomCodeSig.value ||
      lifetime.signal.aborted ||
      (background && busySig.value)
    ) {
      return;
    }
    if (notModified) {
      const serverNow = Number(headers.get("x-server-now"));
      if (Number.isFinite(serverNow) && serverNow > 0) {
        serverOffsetRef.current = serverNow - Date.now();
        clockNowSig.value = serverNow;
      }
      roomEventsRef.current?.markSynced();
      return;
    }
    if ("room" in data && data.room) {
      const board =
        data.publicBoard ??
        (cachedBoardRef.current?.code === code ? cachedBoardRef.current.board : undefined);
      if (!board) {
        cachedBoardRef.current = null;
        roomEtagRef.current = null;
        return refreshRoom(allowInvitePrompt, background);
      }
      cachedBoardRef.current = { code, board };
      const etag = headers.get("etag");
      if (etag) roomEtagRef.current = { code, includeBoard, value: etag };
      const payload: ClaimRoomPayload = { ...data, publicBoard: board };
      serverOffsetRef.current = payload.room.now - Date.now();
      clockNowSig.value = payload.room.now;
      reconcilePendingAction(payload.room);
      if (
        (payload.room.phase === "lobby" || payload.room.phase === "active") &&
        !payload.room.outcome
      ) {
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
      const prevLive = liveSig.value;
      const unchanged = Boolean(
        background &&
          prevLive &&
          prevLive.room.code === payload.room.code &&
          prevLive.room.seatId === payload.room.seatId &&
          (prevLive.activity.prompt?.id ?? null) === (payload.activity.prompt?.id ?? null) &&
          (typeof prevLive.stateRev === "number" && typeof payload.stateRev === "number"
            ? prevLive.stateRev === payload.stateRev
            : JSON.stringify({ ...prevLive.room, now: 0 }) ===
                JSON.stringify({ ...payload.room, now: 0 }) &&
              JSON.stringify(prevLive.activity) === JSON.stringify(payload.activity)),
      );
      if (unchanged) {
        roomEventsRef.current?.markSynced();
        return;
      }
      const switchedRoom = prevLive?.room.code !== payload.room.code;
      batch(() => {
        if (
          selectedCardIdSig.value &&
          !payload.room.ownHand.some((card) => card.instanceId === selectedCardIdSig.value)
        ) {
          selectedCardIdSig.value = "";
        }
        if (payload.room.outcome && !prevLive?.room.outcome) {
          panelSig.value = "score";
          foldedSig.value = false;
        }
        if (switchedRoom) {
          const nextQaId = isQaRoom(payload)
            ? (sessionStorage.getItem(`claim-qa-location:${payload.room.code}`) ?? "")
            : "";
          qaLocationIdSig.value = nextQaId;
          const qaCoord = resolveQaCoord(payload, nextQaId);
          if (qaCoord) {
            liveLocationRef.current?.setManualFix({
              latitude: qaCoord.latitude,
              longitude: qaCoord.longitude,
              accuracy: 10,
              timestamp: payload.room.now,
            });
          }
        }
        liveSig.value = payload;
      });
      syncRoomUrl(code);
      roomEventsRef.current?.markSynced();
    } else if (background) {
      return;
    } else if (allowInvitePrompt) {
      batch(() => {
        statusMsgSig.value = `Undangan ruang ${code} terdeteksi. Masukkan namamu lalu tekan Gabung Ruang.`;
        inlineErrorSig.value = null;
      });
    } else {
      reportError(
        { error: data.error ?? "room-not-found", status },
        { surface: "lobby", action: "load-room", target: code },
        "catalog",
      );
    }
  }

  async function loadCatalog() {
    const { data } = await fetchApiJson<{
      listings?: ClaimPublicListing[];
      ownedPackIds?: string[];
      entitlements?: RulebookEntitlementSummary[];
      allowSandboxCheckout?: boolean;
    }>("/api/rulebooks?format=claim-the-city", { signal: lifetime.signal });
    if (lifetime.signal.aborted) return;
    const filtered = (data.listings ?? []).filter((l) => l.format === "claim-the-city");
    const owned = Array.isArray(data.ownedPackIds) ? data.ownedPackIds : [];
    const ents = Array.isArray(data.entitlements) ? data.entitlements : [];
    batch(() => {
      allowSandboxCheckoutSig.value = data.allowSandboxCheckout === true;
      listingsSig.value = filtered;
      ownedPackIdsSig.value = owned;
      entitlementsSig.value = ents;
    });
    const params = new URLSearchParams(location.search);
    const launchPackId = params.get("pack");
    const shouldLaunch = params.get("launch") === "1";
    if (!roomCodeSig.value && shouldLaunch && launchPackId) {
      const target = filtered.find(
        (l) => l.packId === launchPackId && (l.priceIdr === 0 || owned.includes(l.packId)),
      );
      if (target) {
        const isOwnedPaid = target.priceIdr > 0 && owned.includes(target.packId);
        const persistKey = `kelana-claim-${isOwnedPaid ? "owned" : "free"}:${target.packId}:${target.version}`;
        const pending = ensurePendingAction(
          `create-${isOwnedPaid ? "owned" : "free"}:${target.packId}:${target.version}`,
          isOwnedPaid ? "create-owned-room" : "create-free-room",
          undefined,
          persistKey,
        );
        const { ok, status, data: res } = await fetchApiJson<{
          ok?: boolean;
          roomCode?: string;
          error?: string;
        }>("/api/rulebooks", {
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
          batch(() => {
            roomCodeSig.value = res.roomCode!;
            joinCodeSig.value = res.roomCode!;
            statusMsgSig.value = `Ruang Claim ${res.roomCode} siap dimainkan.`;
          });
          await refreshRoom();
          return;
        }
        clearPendingAction(persistKey);
        reportError(
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
    if (roomCodeSig.value) {
      await refreshRoom(true);
    }
  }

  function inlineSlotForRoomAction(action: Record<string, unknown>): {
    slot: ClaimInlineSlot;
    targetId?: string;
  } {
    const type = String(action.type ?? "");
    const landmarkId = typeof action.landmarkId === "string" ? action.landmarkId : undefined;
    const curseId =
      typeof action.curseInstanceId === "string" ? action.curseInstanceId : undefined;
    if (type === "check-in-start") return { slot: "lobby-checkin" };
    if (type === "check-in-landmark") return { slot: "landmark-checkin", targetId: landmarkId };
    if (type === "submit-challenge") {
      return action.fix
        ? { slot: "challenge-gps", targetId: landmarkId }
        : { slot: "challenge-input", targetId: landmarkId };
    }
    if (type === "clear-curse-gps" || type === "clear-curse-honor" || type === "review-curse-photo") {
      return { slot: "curse-action", targetId: curseId };
    }
    return {
      slot: liveSig.value?.room.phase === "lobby" ? "lobby" : "landmark-checkin",
      targetId: landmarkId,
    };
  }

  async function postRoomAction(action: Record<string, unknown>): Promise<boolean> {
    const code = roomCodeSig.value;
    if (!code) return false;
    const type = String(action.type ?? "action");
    const landmarkId = typeof action.landmarkId === "string" ? action.landmarkId : undefined;
    const cardInstanceId =
      typeof action.cardInstanceId === "string" ? action.cardInstanceId : undefined;
    const offerId = typeof action.offerId === "string" ? action.offerId : undefined;
    const targetSeatId =
      typeof action.targetSeatId === "string" ? action.targetSeatId : undefined;
    const curseId =
      typeof action.curseInstanceId === "string" ? action.curseInstanceId : undefined;
    const targetKey = landmarkId ?? cardInstanceId ?? targetSeatId ?? curseId;
    const signature = JSON.stringify([
      code,
      type,
      landmarkId,
      cardInstanceId,
      offerId,
      targetSeatId,
      curseId,
      action.tier,
      action.choiceId,
      action.inputValue,
      action.teamId,
      action.name,
      action.ready,
    ]);
    const pending = ensurePendingAction(signature, type, { cardInstanceId, landmarkId, offerId });
    const previousAttempt = liveSig.value?.room.ownActiveAttempt;
    const { slot, targetId } = inlineSlotForRoomAction(action);

    try {
      const { ok, status, data: res } = await fetchApiJson<{
        room?: ClaimEngineRoomView;
        error?: string;
        distanceMeters?: number;
      }>("/api/rulebooks", {
        signal: lifetime.signal,
        body: {
          type: "room-action",
          roomCode: code,
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
        batch(() => {
          inlineErrorSig.value = null;
          if (type === "play-card") selectedCardIdSig.value = "";
          if (
            type === "check-in-landmark" &&
            res.room?.ownActiveAttempt &&
            res.room.ownActiveAttempt.landmarkId !== previousAttempt?.landmarkId
          ) {
            panelSig.value = "challenge";
            foldedSig.value = false;
          }
        });
        toastRef.current?.clear();
        toastRef.current?.resetDedupe();
      }
      await refreshRoom(false, false).catch(() => {});
      return succeeded;
    } catch (error) {
      if (lifetime.signal.aborted) return false;
      const resolved = reportError(error, { action: type, target: targetKey }, slot, targetId);
      if (!resolved.uncertain) clearPendingAction();
      return false;
    }
  }

  async function locationFix(target?: GeoCoordinate) {
    const live = liveSig.value;
    if (live && isQaRoom(live)) {
      const chosen = resolveQaCoord(live, qaLocationIdSig.value) ?? target;
      if (chosen) {
        const fix = {
          latitude: chosen.latitude,
          longitude: chosen.longitude,
          accuracy: 10,
          timestamp: live.room.now,
        };
        liveLocationRef.current?.setManualFix(fix);
        return fix;
      }
    }
    if (demoLocationSig.value && target && live) {
      return {
        latitude: target.latitude,
        longitude: target.longitude,
        accuracy: 10,
        timestamp: live.room.now,
      };
    }
    const fix = await getLocation();
    liveLocationRef.current?.setManualFix(fix);
    return fix;
  }

  function handlePhotoInput(targetId: string, file: File | undefined, isCurse: boolean) {
    const slot: ClaimInlineSlot = isCurse ? "curse-action" : "challenge-photo";
    if (!file) {
      photoDraftsRef.current.delete(targetId);
      photoDraftVersionSig.value += 1;
      return;
    }
    const seq = ++photoDraftSeqRef.current;
    if (inlineErrorSig.value?.slot === slot && inlineErrorSig.value.targetId === targetId) {
      inlineErrorSig.value = null;
    }
    const promise = preparePhotoFile(file);
    photoDraftsRef.current.set(targetId, { processing: true, prepared: null, promise, seq });
    photoDraftVersionSig.value += 1;
    void promise.then(
      (prepared) => {
        if (lifetime.signal.aborted) return;
        const current = photoDraftsRef.current.get(targetId);
        if (!current || current.seq !== seq) return;
        photoDraftsRef.current.set(targetId, { processing: false, prepared, seq });
        photoDraftVersionSig.value += 1;
      },
      (error) => {
        if (lifetime.signal.aborted) return;
        const current = photoDraftsRef.current.get(targetId);
        if (!current || current.seq !== seq) return;
        photoDraftsRef.current.delete(targetId);
        photoDraftVersionSig.value += 1;
        reportError(error, { action: "submit-photo", target: targetId }, slot, targetId);
      },
    );
  }

  function handleClearPhoto(targetId: string) {
    photoDraftsRef.current.delete(targetId);
    if (inlineErrorSig.value?.targetId === targetId) {
      inlineErrorSig.value = null;
    }
    photoDraftVersionSig.value += 1;
  }

  async function submitPhoto(targetId: string, isCurse: boolean) {
    const landmarkId = isCurse ? undefined : targetId;
    const curseInstanceId = isCurse ? targetId : undefined;
    const slot: ClaimInlineSlot = isCurse ? "curse-action" : "challenge-photo";
    const draft = photoDraftsRef.current.get(targetId);
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
      const input = Array.from(root.querySelectorAll<HTMLInputElement>("input[data-cg-photo]")).find(
        (element) => element.dataset.cgPhoto === targetId,
      );
      const file = input?.files?.[0];
      if (!file) {
        reportError("photo-required", { action: "submit-photo", target: targetId }, slot, targetId);
        return;
      }
      try {
        prepared = await preparePhotoFile(file);
        photoDraftsRef.current.set(targetId, {
          processing: false,
          prepared,
          seq: ++photoDraftSeqRef.current,
        });
        photoDraftVersionSig.value += 1;
      } catch (error) {
        reportError(error, { action: "submit-photo", target: targetId }, slot, targetId);
        return;
      }
    }
    const code = roomCodeSig.value;
    const signature = JSON.stringify([
      code,
      "submit-photo",
      landmarkId,
      curseInstanceId,
      prepared.byteLength,
      prepared.base64.slice(0, 32),
    ]);
    const pending = ensurePendingAction(signature, "submit-photo", { landmarkId });
    uploadingPhotoTargetSig.value = targetId;
    try {
      const { ok, status, data: res } = await fetchApiJson<{ error?: string }>(
        "/api/rulebooks/claim-photo",
        {
          signal: lifetime.signal,
          body: {
            roomCode: code,
            actionId: pending.id,
            landmarkId,
            curseInstanceId,
            photoBase64: prepared.base64,
          },
        },
      );
      clearPendingAction();
      if (res.error || !ok) {
        reportError(
          { error: res.error ?? "invalid-photo", status },
          { action: "submit-photo", target: targetId },
          slot,
          targetId,
        );
      } else {
        photoDraftsRef.current.delete(targetId);
        photoDraftVersionSig.value += 1;
        inlineErrorSig.value = null;
        toastRef.current?.clear();
        toastRef.current?.resetDedupe();
      }
      await refreshRoom(false, false).catch(() => {});
    } catch (error) {
      if (lifetime.signal.aborted) return;
      const resolved = reportError(
        error,
        { action: "submit-photo", target: targetId },
        slot,
        targetId,
      );
      if (!resolved.uncertain) clearPendingAction();
    } finally {
      uploadingPhotoTargetSig.value = "";
    }
  }

  /**
   * Runs an async user action while preventing duplicate submits and preserving
   * keyboard focus on the triggering button if `disabled` caused Chromium to blur it.
   */
  function runBusyAction(
    actionName: string,
    catchSlot: ClaimInlineSlot,
    catchTarget: string | undefined,
    fn: () => Promise<void>,
  ) {
    if (busySig.value) return;
    const triggerEl =
      document.activeElement instanceof HTMLElement && root.contains(document.activeElement)
        ? document.activeElement
        : null;
    const triggerAction = triggerEl?.dataset.action;

    busySig.value = true;
    root.setAttribute("aria-busy", "true");
    inlineErrorSig.value = null;

    void fn()
      .catch((error) => {
        if (lifetime.signal.aborted) return;
        reportError(error, { action: actionName, target: catchTarget }, catchSlot, catchTarget);
      })
      .finally(() => {
        busySig.value = false;
        if (lifetime.signal.aborted) return;
        root.removeAttribute("aria-busy");
        if (!pendingActionRef.current) roomEventsRef.current?.sync();
        // Restore focus if disabling the button during the request caused blur to <body>.
        queueMicrotask(() => {
          if (lifetime.signal.aborted) return;
          const active = document.activeElement;
          if (active && active !== document.body && root.contains(active)) return;
          if (triggerEl?.isConnected && !(triggerEl instanceof HTMLButtonElement && triggerEl.disabled)) {
            triggerEl.focus({ preventScroll: true });
            return;
          }
          if (triggerAction === "play-card") {
            sheetRef.current
              ?.querySelector<HTMLButtonElement>('[data-action="close-card"], [data-action="select-card"]')
              ?.focus({ preventScroll: true });
          }
        });
      });
  }

  async function switchToClaimRoom(nextCode: string, nextStatus = "") {
    destroyClaimMap();
    destroyStartMiniMap();
    cachedBoardRef.current = null;
    roomEtagRef.current = null;
    photoDraftsRef.current.clear();
    pendingActionRef.current = null;
    lastProcessedActivityKeyRef.current = "";
    toastRef.current?.clear();
    batch(() => {
      roomCodeSig.value = nextCode;
      joinCodeSig.value = nextCode;
      liveSig.value = null;
      selectedIdSig.value = "";
      selectedCardIdSig.value = "";
      selectedRivalIdSig.value = "";
      selectedRivalPinSeatIdSig.value = "";
      challengeHandIdSig.value = "";
      photoDraftVersionSig.value += 1;
      uploadingPhotoTargetSig.value = "";
      startMapExpandedSig.value = false;
      panelSig.value = "challenge";
      mapFailedSig.value = false;
      foldedSig.value = false;
      statusMsgSig.value = nextStatus;
      inlineErrorSig.value = null;
    });
    syncRoomUrl(nextCode);
    await refreshRoom();
  }

  async function executePlayAgain() {
    const live = liveSig.value;
    if (!live || busySig.value) return;
    const { room, pass } = live;
    const ownSeat = room.seats.find((s) => s.seatId === room.seatId);
    const replayMode: RulebookPlayMode = pass.mode ?? (room.isSolo ? "solo" : "group");
    const isOwnedPaid = pass.paid;
    const hostName = resolveDefaultPlayerName(
      getCachedAuth()?.user?.displayName,
      ownSeat?.name ?? "Pemain",
    );
    const requestType = isOwnedPaid ? "create-owned-room" : "create-free-room";
    const pending = ensurePendingAction(
      `play-again:${room.code}:${pass.packId}:${pass.version}:${replayMode}`,
      requestType,
    );
    runBusyAction(requestType, "lobby", pass.packId, async () => {
      try {
        const { ok, status, data: res } = await fetchApiJson<{
          ok?: boolean;
          roomCode?: string;
          error?: string;
        }>("/api/rulebooks", {
          signal: lifetime.signal,
          body: {
            type: requestType,
            packId: pass.packId,
            version: pass.version,
            mode: replayMode,
            hostName,
            requestId: pending.id,
          },
        });
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
          const resolved = reportError(
            error,
            { surface: "claim", action: requestType, target: pass.packId },
            "lobby",
          );
          if (!resolved.uncertain) clearPendingAction();
        }
      }
    });
  }

  async function executeConfirmedLeave(toastText: string) {
    const live = liveSig.value;
    if (!live || busySig.value) return;
    const leavingCode = roomCodeSig.value || live.room.code;
    const wasActiveSolo = live.room.phase === "active" && live.room.isSolo;
    runBusyAction("leave", "lobby", leavingCode, async () => {
      const ok = await postRoomAction({ type: "leave" });
      if (!ok || lifetime.signal.aborted) return;
      clearActiveRoom(leavingCode);
      liveLocationRef.current?.stop();
      releaseWakeLock();
      toastRef.current?.resetDedupe();
      toastRef.current?.show({
        message: toastText,
        tone: "info",
        dedupeKey: `claim:leave:${leavingCode}`,
      });
      if (!wasActiveSolo) {
        onBack();
      }
    });
  }

  function handleNavigateCatalog() {
    const live = liveSig.value;
    if (live?.pass.mode || live?.room.phase === "canceled") {
      onBack();
      return;
    }
    destroyClaimMap();
    destroyStartMiniMap();
    liveLocationRef.current?.stop();
    releaseWakeLock();
    cachedBoardRef.current = null;
    roomEtagRef.current = null;
    photoDraftsRef.current.clear();
    pendingActionRef.current = null;
    lastProcessedActivityKeyRef.current = "";
    toastRef.current?.clear();
    refreshSeqRef.current++;
    batch(() => {
      liveSig.value = null;
      roomCodeSig.value = "";
      joinCodeSig.value = "";
      selectedIdSig.value = "";
      selectedCardIdSig.value = "";
      selectedRivalIdSig.value = "";
      selectedRivalPinSeatIdSig.value = "";
      challengeHandIdSig.value = "";
      photoDraftVersionSig.value += 1;
      uploadingPhotoTargetSig.value = "";
      startMapExpandedSig.value = false;
      panelSig.value = "challenge";
      mapFailedSig.value = false;
      foldedSig.value = false;
      statusMsgSig.value = "";
      inlineErrorSig.value = null;
    });
    syncRoomUrl("");
    roomEventsRef.current?.sync();
    void loadCatalog();
  }

  function handleOpenQuickGuide() {
    const live = liveSig.value;
    if (!live) return;
    openQuickGuideModal({
      format: "claim-the-city",
      mode: live.room.isSolo || live.pass.mode === "solo" ? "solo" : "group",
      role: live.room.phase === "lobby" ? "lobby" : "player",
      packId: live.pass.packId,
      version: live.pass.version,
      title: live.room.packMeta.title,
      inLobby: live.room.phase === "lobby",
      onResetCues: () => {
        cueRevisionSig.value += 1;
      },
    });
  }

  function handleConfirmLeave() {
    const live = liveSig.value;
    if (!live) return;
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
  }

  function handleOpenActivity() {
    batch(() => {
      panelSig.value = "activity";
      foldedSig.value = false;
    });
    queueMicrotask(() => {
      root.querySelector<HTMLElement>("[data-activity-heading]")?.focus({ preventScroll: true });
    });
  }

  function handleOpenPanel(nextPanel: ClaimPanel) {
    batch(() => {
      panelSig.value = nextPanel;
      foldedSig.value = false;
    });
    queueMicrotask(() => {
      const target =
        nextPanel === "activity"
          ? root.querySelector<HTMLElement>("[data-activity-heading]")
          : root.querySelector<HTMLElement>(`[data-panel="${nextPanel}"]`);
      target?.focus({ preventScroll: true });
    });
  }

  function handleToggleFold() {
    foldedSig.value = !foldedSig.value;
    queueMicrotask(() => {
      root.querySelector<HTMLElement>(".cg-fold")?.focus({ preventScroll: true });
    });
  }

  // One-time lifecycle setup (toast, live location, SSE bridge, activity UI, auth, timers).
  useEffect(() => {
    const toast = createPlayerToast({ signal: lifetime.signal, layout: "page" });
    toastRef.current = toast;

    const activityUi = createRoomActivityUi(
      lifetime.signal,
      (notice) => {
        if (!liveSig.value || busySig.value) return;
        batch(() => {
          panelSig.value =
            notice === "activity"
              ? "activity"
              : notice.panel === "score"
                ? "score"
                : notice.panel === "cards"
                  ? "cards"
                  : "challenge";
          foldedSig.value = false;
          if (notice !== "activity" && notice.landmarkId) {
            selectedIdSig.value = notice.landmarkId;
          }
        });
        queueMicrotask(() => {
          const sheet = sheetRef.current;
          const target =
            notice !== "activity" && notice.panel === "review"
              ? sheet?.querySelector<HTMLElement>(
                  "button[data-action='review-rival-photo'], button[data-curse]",
                )
              : sheet?.querySelector<HTMLElement>("[data-activity-heading]");
          (target ?? sheet)?.focus({ preventScroll: true });
        });
      },
      (events) => {
        if (events.length) {
          pendingEffectsRef.current = [...pendingEffectsRef.current, ...events];
        }
      },
    );
    activityUiRef.current = activityUi;

    const liveLocation = createLiveLocationWatcher({
      signal: lifetime.signal,
      onFix: (fix) => {
        selfFixSig.value = fix;
        if (canPublishPresence()) {
          publishPresenceFix(fix, fix.accuracy);
        }
      },
      onStatusChange: (nextStatus) => {
        liveLocationStatusSig.value = nextStatus;
      },
    });
    liveLocationRef.current = liveLocation;
    liveLocationStatusSig.value = liveLocation.getStatus();

    const roomEvents = createRoomEventBridge({
      signal: lifetime.signal,
      getActiveRoom: () => {
        const live = liveSig.value;
        const code = roomCodeSig.value;
        return live &&
          code &&
          (live.room.phase === "lobby" || live.room.phase === "active") &&
          !live.room.outcome
          ? { code, stateRev: live.stateRev ?? 0 }
          : null;
      },
      isBusy: () => busySig.value,
      onSync: () => refreshRoom(false, true),
      onPresence: (positions: ClaimSeatPosition[], eventNow: number) => {
        const live = liveSig.value;
        if (
          !live ||
          live.room.code !== roomCodeSig.value ||
          live.room.phase !== "active" ||
          live.room.outcome
        ) {
          return;
        }
        serverOffsetRef.current = eventNow - Date.now();
        clockNowSig.value = eventNow;
        liveSig.value = {
          ...live,
          room: {
            ...live.room,
            seatPositions: positions,
          },
        };
      },
      onConnectionChange: (state) => {
        connectionStateSig.value = state;
      },
    });
    roomEventsRef.current = roomEvents;

    document.addEventListener(
      "visibilitychange",
      () => {
        if (lifetime.signal.aborted) return;
        if (document.hidden) {
          releaseWakeLock();
          return;
        }
        forcePresenceCatchUpRef.current = true;
        syncPresenceWatch();
        void syncWakeLock();
      },
      { signal: lifetime.signal },
    );

    window.addEventListener(
      "online",
      () => {
        if (lifetime.signal.aborted) return;
        forcePresenceCatchUpRef.current = true;
        const fix = selfFixSig.value;
        if (fix && canPublishPresence()) {
          publishPresenceFix(fix, fix.accuracy);
        }
        syncPresenceWatch();
      },
      { signal: lifetime.signal },
    );

    const applySignedInJoinName = (displayName?: string | null) => {
      if (!displayName || joinNameEditedRef.current) return;
      joinNameSig.value = displayName;
    };

    onAuthChange((next) => {
      applySignedInJoinName(next.user?.displayName);
      if (!liveSig.value) void loadCatalog();
    }, lifetime.signal);

    if (!getCachedAuth()) {
      void fetchAuthMe(lifetime.signal).then((fresh) => {
        if (!lifetime.signal.aborted) applySignedInJoinName(fresh.user?.displayName);
      });
    }

    void isSimulatedLocationAllowed(lifetime.signal).then((allowed) => {
      if (!lifetime.signal.aborted) demoLocationSig.value = allowed;
    });

    void loadCatalog().catch((error) => {
      if (lifetime.signal.aborted) return;
      reportError(error, { surface: "catalog", action: "load-catalog" }, "catalog");
    });

    const clock = window.setInterval(() => {
      clockNowSig.value = Date.now() + serverOffsetRef.current;
    }, 250);

    return () => {
      window.clearInterval(clock);
      closeLobbyDialog();
      liveLocation.stop();
      releaseWakeLock();
      roomEvents.destroy();
      toast.destroy();
      root.removeAttribute("aria-busy");
      destroyClaimMap();
      destroyStartMiniMap();
    };
  }, []);

  const live = liveSig.value;
  const isActiveView = Boolean(live && live.room.phase !== "lobby" && live.room.phase !== "canceled");

  // Sync toast layout, presence watcher, wake lock, and activity feed whenever room payload changes.
  useLayoutEffect(() => {
    toastRef.current?.setLayout(isActiveView ? "game" : "page", Boolean(live?.activity.prompt));
    syncPresenceWatch();
    void syncWakeLock();

    if (live?.room.phase === "canceled") {
      clearActiveRoom(live.room.code);
      activityUiRef.current?.mount(null);
      destroyClaimMap();
      destroyStartMiniMap();
    } else if (!live || live.room.phase === "lobby") {
      activityUiRef.current?.mount(null);
      destroyClaimMap();
    } else {
      destroyStartMiniMap();
    }

    const activityKey = live
      ? `${live.room.code}:${live.room.seatId}:${live.activity.sequence}:${live.activity.prompt?.id ?? ""}:${Boolean(live.room.outcome)}`
      : "";
    if (activityKey !== lastProcessedActivityKeyRef.current) {
      lastProcessedActivityKeyRef.current = activityKey;
      activityUiRef.current?.update(live?.room, live?.activity);
    }
    if (isActiveView && activityHostRef.current) {
      activityUiRef.current?.mount(activityHostRef.current);
    }
    roomEventsRef.current?.sync();
  }, [live, isActiveView, wakeLockWantedSig.value]);

  // Keep lobby start-point mini-map synced in-place when expanded or selfFix updates.
  useLayoutEffect(() => {
    if (!live || live.room.phase !== "lobby" || !startMapExpandedSig.value) {
      destroyStartMiniMap();
      return;
    }
    const host = startMiniMapHostRef.current;
    if (host) {
      void syncStartMiniMap(host, live);
    }
  }, [live, startMapExpandedSig.value, selfFixSig.value]);

  // Keep persistent active Claim MapLibre instance synced in-place and fire committed pin/zone motion.
  useLayoutEffect(() => {
    if (!isActiveView || !live) return;
    const effects = pendingEffectsRef.current;
    if (effects.length) {
      pendingEffectsRef.current = [];
      const scoreEffect = effects
        .filter((event) => event.zoneId || event.kind === "lock" || event.kind === "steal")
        .at(-1);
      const cardEffect = effects
        .filter((event) => event.kind === "draw" || event.kind === "card")
        .at(-1);
      if (scoreEffect) playGameMotion(drawerScoreRef.current, "update", scoreEffect.sequence);
      if (cardEffect) playGameMotion(cardsTabRef.current, "update", cardEffect.sequence);
    }

    if (mapFailedSig.value) return;
    const mapHost = claimMapHostRef.current;
    if (!mapHost) return;
    void syncClaimMapOverlay(mapHost, live).then(() => {
      if (!mapHost.isConnected || liveSig.value?.room.code !== live.room.code) return;
      for (const effect of effects) {
        const { kind, landmarkId, zoneId, sequence } = effect;
        if (
          landmarkId &&
          (kind === "claim" || kind === "lock" || kind === "steal" || kind === "card")
        ) {
          const pin = mapHost.querySelector<HTMLElement>(
            `[data-map-point="${CSS.escape(landmarkId)}"]`,
          );
          playGameMotion(pin, kind === "card" ? "role" : kind, sequence);
        }
        if (zoneId) {
          const marker = mapHost.querySelector<HTMLElement>(
            `[data-map-point="${CSS.escape(`zone:${zoneId}`)}"]`,
          );
          playGameMotion(marker, "role", sequence);
        }
      }
    });
  }, [
    isActiveView,
    live,
    mapFailedSig.value,
    panelSig.value,
    foldedSig.value,
    selectedIdSig.value,
    selectedCardIdSig.value,
    selectedRivalPinSeatIdSig.value,
    selfFixSig.value,
  ]);

  // Read photoDraftVersionSig so photo preview updates re-render affected photo capture widgets.
  void photoDraftVersionSig.value;

  if (live?.room.phase === "canceled") {
    return (
      <CanceledRoomCard
        roomCode={live.room.code}
        title={live.room.packMeta.title}
        onBackToCatalog={handleNavigateCatalog}
      />
    );
  }

  if (!live) {
    return (
      <ClaimCatalogView
        listings={listingsSig.value}
        ownedPackIds={ownedPackIdsSig.value}
        entitlements={entitlementsSig.value}
        allowSandboxCheckout={allowSandboxCheckoutSig.value}
        activeOrderId={activeOrderIdSig.value}
        joinCode={joinCodeSig.value}
        joinName={joinNameSig.value}
        statusMsg={statusMsgSig.value}
        inlineError={inlineErrorSig.value}
        busy={busySig.value}
        onJoinCodeInput={(val) => {
          joinCodeSig.value = val;
        }}
        onJoinNameInput={(val) => {
          joinNameSig.value = val;
          joinNameEditedRef.current = true;
        }}
        onJoinRoom={() => {
          const codeInput = joinCodeSig.value.trim();
          const chosenName = joinNameSig.value.trim() || "Pemain";
          joinCodeSig.value = codeInput;
          joinNameSig.value = chosenName;
          if (!codeInput) {
            reportError("join-code-required", { surface: "lobby", action: "join-room" }, "join");
            root.querySelector<HTMLInputElement>("#rb-claim-join-code")?.focus({ preventScroll: true });
            return;
          }
          runBusyAction("join-room", "join", codeInput, async () => {
            const { ok, status, data: res } = await fetchApiJson<{ ok?: boolean; error?: string }>(
              "/api/rulebooks",
              {
                signal: lifetime.signal,
                body: {
                  type: "join-room",
                  roomCode: codeInput,
                  name: chosenName,
                },
              },
            );
            if (ok && res.ok) {
              if (!getCachedAuth()?.authenticated) saveRememberedGuestName(chosenName);
              roomCodeSig.value = codeInput;
              toastRef.current?.clear();
              toastRef.current?.resetDedupe();
              await refreshRoom(false, false);
            } else {
              reportError(
                { error: res.error ?? "room-not-found", status },
                { surface: "lobby", action: "join-room", target: codeInput },
                "join",
              );
            }
          });
        }}
        onOpenStudio={() => {
          const url = new URL(location.href);
          url.searchParams.set("play", "rulebook-studio");
          url.searchParams.set("format", "claim-the-city");
          url.searchParams.delete("room");
          url.searchParams.delete("adminPlaytest");
          history.pushState({ fromChooser: true }, "", url);
          window.dispatchEvent(new PopStateEvent("popstate"));
        }}
        onBack={onBack}
        onStartFree={(packId, version) => {
          runBusyAction("start-free", "catalog", packId, async () => {
            const persistKey = `kelana-claim-free:${packId}:${version}`;
            const pending = ensurePendingAction(
              `create-free:${packId}:${version}`,
              "create-free-room",
              undefined,
              persistKey,
            );
            const { ok, status, data: res } = await fetchApiJson<{
              ok?: boolean;
              roomCode?: string;
              error?: string;
            }>("/api/rulebooks", {
              signal: lifetime.signal,
              body: {
                type: "create-free-room",
                packId,
                version,
                requestId: pending.id,
              },
            });
            clearPendingAction(persistKey);
            if (ok && res.ok && res.roomCode) {
              batch(() => {
                roomCodeSig.value = res.roomCode!;
                joinCodeSig.value = res.roomCode!;
                statusMsgSig.value = `Ruang Claim ${res.roomCode} berhasil dibuat.`;
              });
              toastRef.current?.clear();
              toastRef.current?.resetDedupe();
              await refreshRoom(false, false);
            } else {
              reportError(
                { error: res.error ?? "invalid-request", status },
                { surface: "catalog", action: "start-free", target: packId },
                "catalog",
              );
            }
          });
        }}
        onStartOwned={(packId, version) => {
          runBusyAction("start-owned", "catalog", packId, async () => {
            const persistKey = `kelana-claim-owned:${packId}:${version}`;
            const pending = ensurePendingAction(
              `create-owned:${packId}:${version}`,
              "create-owned-room",
              undefined,
              persistKey,
            );
            const { ok, status, data: res } = await fetchApiJson<{
              ok?: boolean;
              roomCode?: string;
              error?: string;
            }>("/api/rulebooks", {
              signal: lifetime.signal,
              body: {
                type: "create-owned-room",
                packId,
                version,
                requestId: pending.id,
              },
            });
            clearPendingAction(persistKey);
            if (ok && res.ok && res.roomCode) {
              batch(() => {
                roomCodeSig.value = res.roomCode!;
                joinCodeSig.value = res.roomCode!;
                statusMsgSig.value = `Ruang Claim ${res.roomCode} berhasil dibuat.`;
              });
              toastRef.current?.clear();
              toastRef.current?.resetDedupe();
              await refreshRoom(false, false);
            } else {
              reportError(
                { error: res.error ?? "invalid-request", status },
                { surface: "catalog", action: "start-owned", target: packId },
                "catalog",
              );
              if (res.error === "entitlement-active-room-exists") void loadCatalog();
            }
          });
        }}
        onResumeOwned={(targetRoom) => {
          if (!targetRoom) return;
          runBusyAction("resume-owned", "catalog", targetRoom, async () => {
            batch(() => {
              roomCodeSig.value = targetRoom;
              joinCodeSig.value = targetRoom;
            });
            toastRef.current?.clear();
            toastRef.current?.resetDedupe();
            await refreshRoom(false, false);
          });
        }}
        onBuyPack={(packId, version) => {
          runBusyAction("buy-pack", "catalog", packId, async () => {
            const persistKey = `kelana-claim-order:${packId}:${version}`;
            const pending = ensurePendingAction(
              `create-order:${packId}:${version}`,
              "create-order",
              undefined,
              persistKey,
            );
            const { ok, status, data: res } = await fetchApiJson<{
              ok?: boolean;
              order?: { orderId: string };
              error?: string;
            }>("/api/rulebooks", {
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
              batch(() => {
                activeOrderIdSig.value = res.order!.orderId;
                statusMsgSig.value = `Order ${res.order!.orderId} dibuat (Uji Pembayaran).`;
              });
              toastRef.current?.clear();
              toastRef.current?.resetDedupe();
            } else if (status === 401 || res.error === "auth-required") {
              openAuthModal({
                reason: "Masuk dengan email agar paket tersimpan permanen di akunmu.",
                onSignedIn: () => {
                  if (!lifetime.signal.aborted) void loadCatalog();
                },
              });
            } else {
              reportError(
                { error: res.error ?? "invalid-request", status },
                { surface: "checkout", action: "buy-pack", target: packId },
                "catalog",
              );
              if (res.error === "pack-already-owned") void loadCatalog();
            }
          });
        }}
        onSettleOrder={(orderId) => {
          runBusyAction("settle-order", "catalog", orderId, async () => {
            const { ok, status, data: res } = await fetchApiJson<{
              ok?: boolean;
              pass?: { roomCode: string };
              error?: string;
            }>("/api/rulebooks", {
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
              toastRef.current?.clear();
              toastRef.current?.resetDedupe();
              batch(() => {
                activeOrderIdSig.value = null;
                roomCodeSig.value = res.pass!.roomCode;
                joinCodeSig.value = res.pass!.roomCode;
                statusMsgSig.value = `Pembayaran lunas! Ruang ${res.pass!.roomCode} terbuka.`;
              });
              await refreshRoom(false, false);
            } else if (status === 401 || res.error === "auth-required") {
              openAuthModal({
                reason: "Masuk dengan email agar paket tersimpan permanen di akunmu.",
                onSignedIn: () => {
                  if (!lifetime.signal.aborted) void loadCatalog();
                },
              });
            } else {
              reportError(
                { error: res.error ?? "payment-pending", status },
                { surface: "checkout", action: "settle-order", target: orderId },
                "catalog",
              );
            }
          });
        }}
      />
    );
  }

  if (live.room.phase === "lobby") {
    const inviteUrl = `${location.origin}/?play=rulebook-claim&room=${encodeURIComponent(live.room.code)}`;
    return (
      <ClaimLobbyView
        payload={live}
        selfFix={selfFixSig.value}
        liveLocationStatus={liveLocationStatusSig.value}
        startMapExpanded={startMapExpandedSig.value}
        demoLocation={demoLocationSig.value}
        qaLocationId={qaLocationIdSig.value}
        copiedCode={copiedCodeSig.value}
        copiedLink={copiedLinkSig.value}
        editingName={editingNameSig.value}
        renameDraft={renameDraftSig.value}
        statusMsg={statusMsgSig.value}
        inlineError={inlineErrorSig.value}
        busy={busySig.value}
        cueRevision={cueRevisionSig.value}
        wakeLockSupported={wakeLockSupported}
        wakeLockWanted={wakeLockWantedSig.value}
        onEnableLocation={() => liveLocationRef.current?.start()}
        onToggleStartMap={() => {
          startMapExpandedSig.value = !startMapExpandedSig.value;
        }}
        onMountStartMiniMap={(container) => {
          startMiniMapHostRef.current = container;
          const current = liveSig.value;
          if (current && current.room.phase === "lobby") {
            void syncStartMiniMap(container, current);
          }
          return () => {
            if (startMiniMapHostRef.current === container) {
              startMiniMapHostRef.current = null;
            }
            destroyStartMiniMap();
          };
        }}
        onSelectQaLocation={(nextId) => {
          qaLocationIdSig.value = nextId;
          sessionStorage.setItem(`claim-qa-location:${live.room.code}`, nextId);
          const chosen = resolveQaCoord(live, nextId);
          if (chosen) {
            liveLocationRef.current?.setManualFix({
              latitude: chosen.latitude,
              longitude: chosen.longitude,
              accuracy: 10,
              timestamp: live.room.now,
            });
          }
        }}
        onAdvanceQaClock={(step) => {
          runBusyAction("claim-qa-advance", "landmark-checkin", step, async () => {
            const pending = ensurePendingAction(
              `qa-advance:${live.room.code}:${step}:${live.room.deadline ?? "none"}`,
              "qa-advance",
            );
            const { ok, status, data } = await fetchApiJson<{ ok?: boolean; error?: string }>(
              "/api/rulebooks",
              {
                signal: lifetime.signal,
                body: {
                  type: "qa-advance",
                  roomCode: live.room.code,
                  step,
                  actionId: pending.id,
                  ...(step === "phase-end" ? { expectedDeadline: live.room.deadline } : {}),
                },
              },
            );
            clearPendingAction();
            if (!ok || !data.ok) {
              reportError(
                { error: data.error ?? "qa-deadline-changed", status },
                { action: "qa-advance", target: step },
                "landmark-checkin",
              );
            } else {
              await refreshRoom(false, false);
            }
          });
        }}
        onCopyCode={() => {
          void copyToClipboard(live.room.code).then((ok) => {
            if (lifetime.signal.aborted || !ok) return;
            copiedCodeSig.value = true;
            window.setTimeout(() => {
              if (!lifetime.signal.aborted) copiedCodeSig.value = false;
            }, 2500);
          });
        }}
        onShareInvite={() => {
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
            copiedLinkSig.value = true;
            window.setTimeout(() => {
              if (!lifetime.signal.aborted) copiedLinkSig.value = false;
            }, 2500);
          })();
        }}
        onShowQr={() => {
          openQrModal({
            roomCode: live.room.code,
            inviteUrl,
            title: live.room.packMeta.title,
          });
        }}
        onStartEditName={() => {
          const ownSeat = live.room.seats.find((s) => s.seatId === live.room.seatId);
          batch(() => {
            renameDraftSig.value = ownSeat?.name ?? "";
            editingNameSig.value = true;
          });
        }}
        onRenameDraftInput={(val) => {
          renameDraftSig.value = val;
        }}
        onSaveName={() => {
          const cleaned = renameDraftSig.value.trim();
          runBusyAction("save-name", "lobby", undefined, async () => {
            if (!cleaned || cleaned.length > 32) {
              reportError("invalid-seat-name", { surface: "lobby", action: "rename-seat" }, "lobby");
              return;
            }
            const ok = await postRoomAction({ type: "rename-seat", name: cleaned });
            if (ok) {
              editingNameSig.value = false;
              if (!getCachedAuth()?.authenticated) saveRememberedGuestName(cleaned);
            }
          });
        }}
        onCancelEditName={() => {
          editingNameSig.value = false;
        }}
        onReassignSeatTeam={(targetSeatId, chosen) => {
          const nextTeamId = chosen === "__new__" ? nextFreshTeamId(live.room.seats) : chosen;
          runBusyAction("set-team", "lobby", targetSeatId, async () => {
            await postRoomAction({ type: "set-team", teamId: nextTeamId, targetSeatId });
          });
        }}
        onJoinTeam={(teamId) => {
          runBusyAction("join-team", "lobby", teamId, async () => {
            await postRoomAction({ type: "set-team", teamId });
          });
        }}
        onNewTeam={() => {
          runBusyAction("new-team", "lobby", undefined, async () => {
            await postRoomAction({ type: "set-team", teamId: nextFreshTeamId(live.room.seats) });
          });
        }}
        onCheckInStart={() => {
          runBusyAction("sim-start-checkin", "lobby-checkin", undefined, async () => {
            await postRoomAction({
              type: "check-in-start",
              fix: await locationFix(live.publicBoard.startPoint),
            });
          });
        }}
        onToggleReady={(ready) => {
          runBusyAction(ready ? "mark-ready" : "unmark-ready", "lobby", undefined, async () => {
            await postRoomAction({ type: "ready", ready });
          });
        }}
        onStartMatch={() => {
          runBusyAction("start-match", "lobby", undefined, async () => {
            await postRoomAction({ type: "start" });
          });
        }}
        onOpenQuickGuide={handleOpenQuickGuide}
        onOpenActivity={handleOpenActivity}
        onToggleWakeLock={() => {
          wakeLockWantedSig.value = !wakeLockWantedSig.value;
        }}
        onRefresh={() => {
          runBusyAction("refresh", "lobby", undefined, async () => {
            await refreshRoom(false, false);
          });
        }}
        onNavigateCatalog={handleNavigateCatalog}
        onConfirmLeave={handleConfirmLeave}
        onDismissCue={() => {
          cueRevisionSig.value += 1;
        }}
      />
    );
  }

  // Active / Finished Claim the City game shell with persistent MapHost
  const { room } = live;
  const panel = panelSig.value;
  const folded = foldedSig.value;
  const mapFailed = mapFailedSig.value;
  const inlineError = inlineErrorSig.value;
  const ownStanding = room.standings.find((score) => score.teamId === room.teamId);
  const activeCardForFallback =
    panel === "cards"
      ? room.ownHand.find((item) => item.instanceId === selectedCardIdSig.value)
      : undefined;
  const fallbackTargets = activeCardForFallback ? cardTargets(room, activeCardForFallback) : [];
  const activeAttemptKey = room.ownActiveAttempt
    ? `${room.ownActiveAttempt.landmarkId}:${room.ownActiveAttempt.challenge.title}:${room.ownActiveAttempt.currentStep}:${
        room.ownActiveAttempt.challenge.payload.primitive === "call_your_shot"
          ? (room.ownActiveAttempt.challenge.payload.chosenTier ?? "")
          : ""
      }`
    : "";

  return (
    <section class="sg-game cg-game" aria-label="Permainan Claim the City">
      <MapHost
        id="rb-claim-map-host"
        className="sg-board cg-board"
        hidden={mapFailed}
        onMount={(container) => {
          claimMapHostRef.current = container;
          const current = liveSig.value;
          if (current && !mapFailedSig.value) {
            void syncClaimMapOverlay(container, current);
          }
          return () => {
            if (claimMapHostRef.current === container) {
              claimMapHostRef.current = null;
            }
            destroyClaimMap();
          };
        }}
      />

      <aside class="cg-fallback" aria-label="Papan landmark" hidden={!mapFailed}>
        {mapFailed && (
          <>
            <div class="cg-map-status">
              <p role="status">Peta tidak tersedia.</p>
              <button
                type="button"
                class="sg-quiet"
                data-action="retry-map"
                onClick={() => {
                  mapFailedSig.value = false;
                }}
              >
                Coba Lagi
              </button>
            </div>
            <ClaimLandmarkList
              payload={live}
              selectedId={selectedIdSig.value}
              selfFix={selfFixSig.value}
              liveLocationStatus={liveLocationStatusSig.value}
              landmarkSort={landmarkSortSig.value}
              targets={fallbackTargets}
              listLabel="Daftar Landmark"
              busy={busySig.value}
              onSortChange={(nextSort) => {
                landmarkSortSig.value = nextSort;
                if (nextSort === "nearest" && !selfFixSig.value) {
                  liveLocationRef.current?.start();
                }
              }}
              onEnableLocation={() => liveLocationRef.current?.start()}
              onSelectLandmark={selectLandmark}
            />
            <ClaimZoneList room={room} />
            <ClaimRivalPositionsList room={room} clockNowSig={clockNowSig} />
          </>
        )}
      </aside>

      <ClaimHud
        payload={live}
        clockNowSig={clockNowSig}
        connectionState={connectionStateSig.value}
        mapFailed={mapFailed}
        wakeLockSupported={wakeLockSupported}
        wakeLockWanted={wakeLockWantedSig.value}
        busy={busySig.value}
        onMountActivityHost={(host) => {
          activityHostRef.current = host;
          activityUiRef.current?.mount(host);
        }}
        onOpenQuickGuide={handleOpenQuickGuide}
        onOpenActivity={handleOpenActivity}
        onToggleWakeLock={() => {
          wakeLockWantedSig.value = !wakeLockWantedSig.value;
        }}
        onRefresh={() => {
          runBusyAction("refresh", "landmark-checkin", undefined, async () => {
            await refreshRoom(false, false);
          });
        }}
        onNavigateCatalog={handleNavigateCatalog}
        onConfirmLeave={handleConfirmLeave}
      />

      <div class="sg-dock cg-dock">
        <div class="cg-drawer-bar">
          <span ref={drawerScoreRef}>
            {panel === "score" && !folded
              ? room.code
              : room.soloProgress
                ? `${room.soloProgress.lockedLandmarks}/${room.soloProgress.targetLandmarks} terkunci`
                : `${ownStanding?.zonesControlled ?? 0} zona · ${ownStanding?.lockedLandmarks ?? 0} terkunci`}
          </span>
          <button
            type="button"
            class="cg-fold"
            data-action="fold"
            aria-controls="cg-panel"
            aria-expanded={!folded}
            onClick={handleToggleFold}
          >
            {folded ? "Buka panel ⌃" : "Lihat peta ⌄"}
          </button>
        </div>

        <div ref={sheetRef} class="sg-sheet cg-sheet" id="cg-panel" tabIndex={-1} hidden={folded}>
          <ClaimDraftBar
            payload={live}
            qaLocationId={qaLocationIdSig.value}
            busy={busySig.value}
            onSelectQaLocation={(nextId) => {
              qaLocationIdSig.value = nextId;
              sessionStorage.setItem(`claim-qa-location:${live.room.code}`, nextId);
              const chosen = resolveQaCoord(live, nextId);
              if (chosen) {
                liveLocationRef.current?.setManualFix({
                  latitude: chosen.latitude,
                  longitude: chosen.longitude,
                  accuracy: 10,
                  timestamp: live.room.now,
                });
              }
            }}
            onAdvanceQaClock={(step) => {
              runBusyAction("claim-qa-advance", "landmark-checkin", step, async () => {
                const pending = ensurePendingAction(
                  `qa-advance:${live.room.code}:${step}:${live.room.deadline ?? "none"}`,
                  "qa-advance",
                );
                const { ok, status, data } = await fetchApiJson<{ ok?: boolean; error?: string }>(
                  "/api/rulebooks",
                  {
                    signal: lifetime.signal,
                    body: {
                      type: "qa-advance",
                      roomCode: live.room.code,
                      step,
                      actionId: pending.id,
                      ...(step === "phase-end" ? { expectedDeadline: live.room.deadline } : {}),
                    },
                  },
                );
                clearPendingAction();
                if (!ok || !data.ok) {
                  reportError(
                    { error: data.error ?? "qa-deadline-changed", status },
                    { action: "qa-advance", target: step },
                    "landmark-checkin",
                  );
                } else {
                  await refreshRoom(false, false);
                }
              });
            }}
          />

          {room.phase === "active" && !room.outcome && (
            <PhaseCueStrip
              cueKey="claim-active"
              cueRevision={cueRevisionSig.value}
              onDismiss={() => {
                cueRevisionSig.value += 1;
              }}
            />
          )}

          {inlineError && (inlineError.slot === "lobby" || inlineError.slot === "catalog") && (
            <InlineAlert message={inlineError.message} tone={inlineError.tone} />
          )}

          <ClaimRivalCard
            room={room}
            selectedRivalPinSeatId={selectedRivalPinSeatIdSig.value}
            clockNowSig={clockNowSig}
            onClose={() => {
              selectedRivalPinSeatIdSig.value = "";
            }}
          />

          {panel === "activity" ? (
            <ClaimActivityPanel feed={live.activity} clockNowSig={clockNowSig} />
          ) : panel === "cards" ? (
            <ClaimCardsPanel
              payload={live}
              selectedCardId={selectedCardIdSig.value}
              selectedId={selectedIdSig.value}
              selectedRivalId={selectedRivalIdSig.value}
              mapFailed={mapFailed}
              busy={busySig.value}
              onSelectCard={(instanceId) => {
                batch(() => {
                  selectedCardIdSig.value = instanceId;
                  selectedIdSig.value = "";
                  selectedRivalIdSig.value = "";
                });
                queueMicrotask(() => {
                  root.querySelector<HTMLElement>('[data-action="close-card"]')?.focus({
                    preventScroll: true,
                  });
                });
              }}
              onCloseCard={() => {
                batch(() => {
                  selectedCardIdSig.value = "";
                  selectedRivalIdSig.value = "";
                });
                queueMicrotask(() => {
                  root.querySelector<HTMLElement>('[data-action="select-card"]')?.focus({
                    preventScroll: true,
                  });
                });
              }}
              onSelectRival={(seatId) => {
                selectedRivalIdSig.value = seatId;
                queueMicrotask(() => {
                  root
                    .querySelector<HTMLElement>('[data-action="select-rival"][aria-pressed="true"]')
                    ?.focus({ preventScroll: true });
                });
              }}
              onPlayCard={(cardInstanceId, landmarkId, targetSeatId) => {
                runBusyAction("play-card", "landmark-checkin", landmarkId ?? cardInstanceId, async () => {
                  await postRoomAction({
                    type: "play-card",
                    cardInstanceId,
                    landmarkId,
                    targetSeatId,
                  });
                });
              }}
              onChooseReward={(offerId, cardInstanceId) => {
                runBusyAction("choose-claim-reward", "landmark-checkin", offerId, async () => {
                  if (await postRoomAction({ type: "choose-claim-reward", offerId, cardInstanceId })) {
                    requestAnimationFrame(() => {
                      root.querySelector<HTMLElement>(
                        '[data-action="choose-claim-reward"], [data-action="select-card"], [data-action="close-card"]',
                      )?.focus({ preventScroll: true });
                    });
                  }
                });
              }}
            />
          ) : panel === "score" ? (
            <ClaimScorePanel
              payload={live}
              ownedPackIds={ownedPackIdsSig.value}
              clockNowSig={clockNowSig}
              busy={busySig.value}
              onPlayAgain={() => void executePlayAgain()}
              onJoinNewRoom={() => {
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
                      url.searchParams.delete("adminPlaytest");
                      history.pushState({ fromChooser: true }, "", url);
                      window.dispatchEvent(new PopStateEvent("popstate"));
                    }
                  },
                });
              }}
              onNavigateCatalog={handleNavigateCatalog}
            />
          ) : (
            <>
              {room.ownActiveAttempt ? (
                <>
                  <ClaimActiveAttempt
                    key={activeAttemptKey}
                    payload={live}
                    attempt={room.ownActiveAttempt}
                    clockNowSig={clockNowSig}
                    photoDrafts={photoDraftsRef.current}
                    uploadingPhotoTarget={uploadingPhotoTargetSig.value}
                    inlineError={inlineError}
                    busy={busySig.value}
                    onChooseShotTier={(landmarkId, tier) => {
                      runBusyAction("choose-shot-tier", "landmark-checkin", landmarkId, async () => {
                        await postRoomAction({ type: "choose-shot-tier", landmarkId, tier });
                      });
                    }}
                    onSwapChallenge={(cardInstanceId, landmarkId) => {
                      runBusyAction("play-card", "landmark-checkin", landmarkId, async () => {
                        await postRoomAction({ type: "play-card", cardInstanceId, landmarkId });
                      });
                    }}
                    onBailChallenge={(landmarkId) => {
                      runBusyAction("bail-challenge", "landmark-checkin", landmarkId, async () => {
                        await postRoomAction({ type: "bail-challenge", landmarkId });
                      });
                    }}
                    onSelectPhotoFile={handlePhotoInput}
                    onClearPhoto={handleClearPhoto}
                    onSubmitMcq={(landmarkId, choiceId) => {
                      runBusyAction("submit-mcq", "challenge-input", landmarkId, async () => {
                        await postRoomAction({ type: "submit-challenge", landmarkId, choiceId });
                      });
                    }}
                    onSubmitInput={(landmarkId, rawValue, inputEl) => {
                      const inputValue = rawValue.trim();
                      if (!inputValue) {
                        reportError(
                          "input-required",
                          { action: "submit-input", target: landmarkId },
                          "challenge-input",
                          landmarkId,
                        );
                        inputEl?.focus({ preventScroll: true });
                        return;
                      }
                      runBusyAction("submit-input", "challenge-input", landmarkId, async () => {
                        await postRoomAction({ type: "submit-challenge", landmarkId, inputValue });
                      });
                    }}
                    onSubmitPhoto={(landmarkId) => {
                      runBusyAction("submit-photo", "challenge-photo", landmarkId, async () => {
                        await submitPhoto(landmarkId, false);
                      });
                    }}
                    onStartTimed={(landmarkId) => {
                      runBusyAction("start-timed", "landmark-checkin", landmarkId, async () => {
                        await postRoomAction({ type: "start-timed-task", landmarkId });
                      });
                    }}
                    onSubmitTimedGps={(landmarkId, target) => {
                      runBusyAction("submit-timed-gps", "challenge-gps", landmarkId, async () => {
                        await postRoomAction({
                          type: "submit-challenge",
                          landmarkId,
                          fix: await locationFix(target),
                        });
                      });
                    }}
                  />
                  {room.ownActiveAttempt.landmarkId !== selectedIdSig.value && selectedIdSig.value && (
                    <ClaimLandmarkDetail
                      payload={live}
                      selectedId={selectedIdSig.value}
                      selfFix={selfFixSig.value}
                      liveLocationStatus={liveLocationStatusSig.value}
                      landmarkSort={landmarkSortSig.value}
                      mapFailed={mapFailed}
                      challengeHandId={challengeHandIdSig.value}
                      clockNowSig={clockNowSig}
                      inlineError={inlineError}
                      busy={busySig.value}
                      onSortChange={(nextSort) => {
                        landmarkSortSig.value = nextSort;
                        if (nextSort === "nearest" && !selfFixSig.value) {
                          liveLocationRef.current?.start();
                        }
                      }}
                      onEnableLocation={() => liveLocationRef.current?.start()}
                      onSelectLandmark={selectLandmark}
                      onClearSelectedLandmark={() => {
                        batch(() => {
                          selectedIdSig.value = "";
                          selectedRivalPinSeatIdSig.value = "";
                        });
                      }}
                      onSelectChallengeHand={(id) => {
                        challengeHandIdSig.value = id;
                      }}
                      onCheckInLandmark={(landmarkId, chosenHandId) => {
                        const meta = live.publicBoard.landmarks.find((l) => l.id === landmarkId);
                        if (!meta) return;
                        runBusyAction("checkin-landmark", "landmark-checkin", landmarkId, async () => {
                          await postRoomAction({
                            type: "check-in-landmark",
                            landmarkId,
                            challengeHandId: chosenHandId,
                            fix: await locationFix(meta),
                          });
                        });
                      }}
                    />
                  )}
                </>
              ) : (
                <ClaimLandmarkDetail
                  payload={live}
                  selectedId={selectedIdSig.value}
                  selfFix={selfFixSig.value}
                  liveLocationStatus={liveLocationStatusSig.value}
                  landmarkSort={landmarkSortSig.value}
                  mapFailed={mapFailed}
                  challengeHandId={challengeHandIdSig.value}
                  clockNowSig={clockNowSig}
                  inlineError={inlineError}
                  busy={busySig.value}
                  onSortChange={(nextSort) => {
                    landmarkSortSig.value = nextSort;
                    if (nextSort === "nearest" && !selfFixSig.value) {
                      liveLocationRef.current?.start();
                    }
                  }}
                  onEnableLocation={() => liveLocationRef.current?.start()}
                  onSelectLandmark={selectLandmark}
                  onClearSelectedLandmark={() => {
                    batch(() => {
                      selectedIdSig.value = "";
                      selectedRivalPinSeatIdSig.value = "";
                    });
                  }}
                  onSelectChallengeHand={(id) => {
                    challengeHandIdSig.value = id;
                  }}
                  onCheckInLandmark={(landmarkId, chosenHandId) => {
                    const meta = live.publicBoard.landmarks.find((l) => l.id === landmarkId);
                    if (!meta) return;
                    runBusyAction("checkin-landmark", "landmark-checkin", landmarkId, async () => {
                      await postRoomAction({
                        type: "check-in-landmark",
                        landmarkId,
                        challengeHandId: chosenHandId,
                        fix: await locationFix(meta),
                      });
                    });
                  }}
                />
              )}

              <ClaimActiveAlerts
                payload={live}
                clockNowSig={clockNowSig}
                photoDrafts={photoDraftsRef.current}
                uploadingPhotoTarget={uploadingPhotoTargetSig.value}
                inlineError={inlineError}
                busy={busySig.value}
                onReviewRivalPhoto={(seatId, landmarkId, approve) => {
                  runBusyAction("review-rival-photo", "landmark-checkin", landmarkId, async () => {
                    await postRoomAction({
                      type: "review-challenge-photo",
                      targetSeatId: seatId,
                      landmarkId,
                      approve,
                    });
                  });
                }}
                onSelectPhotoFile={handlePhotoInput}
                onClearPhoto={handleClearPhoto}
                onClearCurseGps={(curseInstanceId) => {
                  runBusyAction("clear-curse-gps", "curse-action", curseInstanceId, async () => {
                    await postRoomAction({
                      type: "clear-curse-gps",
                      curseInstanceId,
                      fix: await locationFix(),
                    });
                  });
                }}
                onSubmitCursePhoto={(curseInstanceId) => {
                  runBusyAction("submit-curse-photo", "curse-action", curseInstanceId, async () => {
                    await submitPhoto(curseInstanceId, true);
                  });
                }}
                onClearCurseHonor={(curseInstanceId) => {
                  runBusyAction("clear-curse-honor", "curse-action", curseInstanceId, async () => {
                    await postRoomAction({ type: "clear-curse-honor", curseInstanceId });
                  });
                }}
                onReviewCursePhoto={(curseInstanceId, approve) => {
                  runBusyAction("review-curse-photo", "curse-action", curseInstanceId, async () => {
                    await postRoomAction({
                      type: "review-curse-photo",
                      curseInstanceId,
                      approve,
                    });
                  });
                }}
              />
            </>
          )}
        </div>

        <nav class="sg-nav" aria-label="Menu permainan">
          {claimPanels.map((item) => (
            <button
              key={item.id}
              ref={item.id === "cards" ? cardsTabRef : undefined}
              type="button"
              data-action="panel"
              data-panel={item.id}
              aria-pressed={!folded && item.id === panel}
              onClick={() => handleOpenPanel(item.id)}
            >
              <span class="sg-nav-icon" aria-hidden="true">
                {item.icon}
              </span>
              {item.name}
            </button>
          ))}
        </nav>
      </div>
      {!mapFailed && !room.isSolo && !room.outcome && (room.seatPositions?.length ?? 0) > 0 && (
        <ClaimPinFreshnessSync
          room={room}
          clockNowSig={clockNowSig}
          onBucketChange={() => {
            const current = liveSig.value;
            if (
              current &&
              claimMapHandleRef.current &&
              claimMapRoomCodeRef.current === current.room.code &&
              !mapFailedSig.value
            ) {
              claimMapHandleRef.current.update(buildClaimMapState(current));
            }
          }}
        />
      )}
    </section>
  );
}

function ClaimPinFreshnessSync({
  room,
  clockNowSig,
  onBucketChange,
}: {
  room: ClaimEngineRoomView;
  clockNowSig: { readonly value: number };
  onBucketChange: () => void;
}) {
  const now = clockNowSig.value;
  const key = (room.seatPositions ?? [])
    .filter((pos) => pos.seatId !== room.seatId)
    .map((pos) => `${pos.seatId}:${freshnessBucket(pos.at, now)}`)
    .join("|");
  const prevKeyRef = useRef(key);
  const onBucketChangeRef = useRef(onBucketChange);
  onBucketChangeRef.current = onBucketChange;

  useEffect(() => {
    if (prevKeyRef.current !== key) {
      prevKeyRef.current = key;
      onBucketChangeRef.current();
    }
  }, [key]);

  return null;
}

export function mountRulebookClaimPlay(root: HTMLElement, onBack: () => void): () => void {
  const lifetime = new AbortController();
  const unmount = mountPreact(root, () => (
    <ClaimPlayApp root={root} onBack={onBack} lifetime={lifetime} />
  ));
  return () => {
    lifetime.abort();
    unmount();
  };
}
