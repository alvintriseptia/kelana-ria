import type { SeekEngineQuestion } from "@kelana-ria/contracts";
import type { Signal } from "@preact/signals";
import type { RoomConnectionState } from "../room-events";
import { SeekDeadline, SeekRelativeAge, SeekRoomMenu } from "./SeekShared";
import {
  answerText,
  draftStudioUrl,
  isDraftPlaytest,
  phaseLabels,
  questionNames,
  type SeekPanel,
  type SeekRoomPayload,
} from "./types";

function SeekConnectionPill({
  connectionStateSig,
}: {
  connectionStateSig: Signal<RoomConnectionState>;
}) {
  const state = connectionStateSig.value;
  return (
    <p class="sg-location" data-sg-conn-pill role="status" hidden={state === "connected"}>
      {state === "offline" ? "Luring · menunggu koneksi" : "Menyambungkan ulang…"}
    </p>
  );
}

export function SeekHud({
  payload,
  panel,
  hasMapResult,
  latestResult,
  busy,
  clockNowSig,
  connectionStateSig,
  onToggleQaPanel,
  onOpenQuickGuide,
  onOpenActivity,
  onRefresh,
  onNavigateCatalog,
  onConfirmLeave,
}: {
  payload: SeekRoomPayload;
  panel: SeekPanel | null;
  hasMapResult: boolean;
  latestResult: SeekEngineQuestion | undefined;
  busy: boolean;
  clockNowSig: Signal<number>;
  connectionStateSig: Signal<RoomConnectionState>;
  onToggleQaPanel: () => void;
  onOpenQuickGuide: () => void;
  onOpenActivity: () => void;
  onRefresh: () => void;
  onNavigateCatalog: () => void;
  onConfirmLeave: () => void;
}) {
  const { room, publicBoard } = payload;
  const isHider = room.role === "hider";
  const isDraft = isDraftPlaytest(payload);
  const station = [room.turnStartPoint, ...publicBoard.stations].find(
    (item) => item.id === room.seekerPosition?.stationId,
  );

  return (
    <div id="sg-hud-host">
      <header class="sg-hud">
        <div class="sg-role">
          <span class="sg-role-mark" aria-hidden="true">
            {isHider ? "◆" : "◎"}
          </span>
          <h1>{isHider ? "Penyembunyi" : "Pencari"}</h1>
          <p>
            {phaseLabels[room.phase]} · {room.turnNumber}/{room.totalPlannedTurns}
          </p>
        </div>
        <div class="sg-hud-actions">
          {isDraft ? (
            <button
              type="button"
              class="sg-quiet sg-qa-badge"
              data-testid="draft-playtest-badge"
              data-action="game-panel"
              data-panel="qa"
              aria-label="Kontrol Uji Draf"
              aria-expanded={panel === "qa"}
              disabled={busy}
              onClick={onToggleQaPanel}
            >
              Uji Draf
            </button>
          ) : payload.qa ? (
            <button
              type="button"
              class="sg-quiet sg-qa-badge"
              data-testid="seek-qa-badge"
              data-action="game-panel"
              data-panel="qa"
              aria-label="Mode QA"
              aria-expanded={panel === "qa"}
              disabled={busy}
              onClick={onToggleQaPanel}
            >
              QA
            </button>
          ) : null}
          {room.phaseEndsAt !== null && (
            <SeekDeadline
              deadline={room.phaseEndsAt}
              clockNowSig={clockNowSig}
              className="sg-timer"
              ariaLabel={
                room.phase === "head_start" ? "Waktu hingga pencarian dimulai" : "Sisa waktu"
              }
            />
          )}
          <SeekRoomMenu
            payload={payload}
            busy={busy}
            onOpenQuickGuide={onOpenQuickGuide}
            onOpenActivity={onOpenActivity}
            onRefresh={onRefresh}
            onNavigateCatalog={onNavigateCatalog}
            onConfirmLeave={onConfirmLeave}
          />
        </div>
      </header>

      {isDraft && (
        <div class="sg-location sg-draft-hud-bar" data-testid="draft-playtest-bar">
          <a
            class="cg-back-studio-link"
            data-testid="back-to-studio-btn"
            href={draftStudioUrl(payload.pass)}
          >
            ← Kembali ke Studio
          </a>
        </div>
      )}

      {room.phase !== "head_start" && (
        <p class="sg-location">
          {room.seekerPosition ? (
            <>
              {room.seekerPosition.seatId === room.seatId ? "Kamu" : "Pencari"} ·{" "}
              {station ? station.name : "Check-in terverifikasi"} ·{" "}
              <SeekRelativeAge
                id="sg-position-age"
                at={room.seekerPosition.at}
                clockNowSig={clockNowSig}
                stalePrefix
              />
            </>
          ) : (
            "Belum ada check-in pencari"
          )}
        </p>
      )}

      <SeekConnectionPill connectionStateSig={connectionStateSig} />

      {hasMapResult && latestResult && (
        <p class="sg-map-result" role="status">
          {questionNames[latestResult.family]} · {answerText(latestResult.answerLabel ?? "")}
        </p>
      )}
    </div>
  );
}
