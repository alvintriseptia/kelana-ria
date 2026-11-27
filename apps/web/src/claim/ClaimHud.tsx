import type { Signal } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import type { RoomConnectionState } from "../room-events";
import { ClaimCountdown, ClaimMoreMenu } from "./ClaimShared";
import { phaseLabels, type ClaimRoomPayload } from "./types";

export function ClaimHud({
  payload,
  clockNowSig,
  connectionState,
  mapFailed,
  wakeLockSupported,
  wakeLockWanted,
  busy,
  onMountActivityHost,
  onOpenQuickGuide,
  onOpenActivity,
  onToggleWakeLock,
  onRefresh,
  onNavigateCatalog,
  onConfirmLeave,
}: {
  payload: ClaimRoomPayload;
  clockNowSig: Signal<number>;
  connectionState: RoomConnectionState;
  mapFailed: boolean;
  wakeLockSupported: boolean;
  wakeLockWanted: boolean;
  busy: boolean;
  onMountActivityHost: (host: HTMLElement | null) => void;
  onOpenQuickGuide: () => void;
  onOpenActivity: () => void;
  onToggleWakeLock: () => void;
  onRefresh: () => void;
  onNavigateCatalog: () => void;
  onConfirmLeave: () => void;
}) {
  const { room } = payload;
  const boardTitle = room.packMeta.title.replace(/ · Claim the City$/, "");
  const activityHostRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    onMountActivityHost(activityHostRef.current);
    return () => onMountActivityHost(null);
  }, []);

  return (
    <>
      <header class="sg-hud cg-hud">
        <div class="sg-role cg-brand">
          <span class="sg-role-mark" aria-hidden="true">
            ◆
          </span>
          <h1>
            Claim the City <small>{room.isSolo ? "Solo" : "Grup"}</small>
          </h1>
          <p title={boardTitle}>{boardTitle}</p>
          <span class="sr-only">{phaseLabels[room.phase]}</span>
        </div>
        <div class="sg-hud-actions">
          <div class="sg-timer cg-timer" aria-label="Waktu ronde">
            {room.deadline !== null && room.phase === "active" ? (
              <ClaimCountdown deadline={room.deadline} clockNowSig={clockNowSig} as="span" />
            ) : (
              "Selesai"
            )}
          </div>
          <ClaimMoreMenu
            payload={payload}
            wakeLockSupported={wakeLockSupported}
            wakeLockWanted={wakeLockWanted}
            busy={busy}
            onOpenQuickGuide={onOpenQuickGuide}
            onOpenActivity={onOpenActivity}
            onToggleWakeLock={onToggleWakeLock}
            onRefresh={onRefresh}
            onNavigateCatalog={onNavigateCatalog}
            onConfirmLeave={onConfirmLeave}
          />
        </div>
      </header>
      <div class="cg-map-legend" aria-label="Legenda peta" hidden={mapFailed}>
        ● Belum diklaim <span>◆ Rentan</span> <span>■ Terkunci</span>
        {!room.isSolo && (
          <>
            {" "}
            <span>▲ Pemain</span>
          </>
        )}
      </div>
      <div
        class="cg-conn-pill"
        data-cg-conn-pill
        role="status"
        hidden={connectionState === "connected"}
      >
        {connectionState === "offline" ? "Luring · menunggu koneksi" : "Menyambungkan ulang…"}
      </div>
      <div ref={activityHostRef} class="room-activity-host" />
    </>
  );
}
