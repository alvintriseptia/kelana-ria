import type { LocationFix } from "@kelana-ria/contracts";
import type { Signal } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import { evaluateCheckInProximity, type LiveLocationStatus } from "../live-location";
import {
  CanceledRoomCard,
  LobbyInviteCard,
  LobbySeatItem,
  OutdoorReadinessStrip,
  PostMatchActions,
} from "../lobby-ui";
import { DraftStudioLink } from "../ui/DraftStudioLink";
import { DirectionsLink, DistanceMeter, StartPointCard } from "../ui/LocationWidgets";
import { PhaseCueStrip } from "../ui/PhaseCueStrip";
import { SeekActivityPanel } from "./SeekActivityPanel";
import { SeekDeadline, SeekQaPanel, SeekRoomMenu, SeekSlotAlert } from "./SeekShared";
import {
  answerText,
  clockText,
  destructiveExitSpec,
  familyLabels,
  isDraftPlaytest,
  orderedSeekSeats,
  phaseLabels,
  questionStatusLabel,
  type SeekInlineError,
  type SeekRoomPayload,
} from "./types";

export function SeekRoomShellView({
  payload,
  ownedPackIds,
  allowHideSeekQa,
  statusMsg,
  inlineError,
  busy,
  copiedCode,
  copiedLink,
  editingName,
  renameDraftSig,
  startMapExpanded,
  qaStationId,
  selfFix,
  liveLocationStatus,
  cueRevision,
  clockNowSig,
  onDismissCue,
  onEnableLocation,
  onToggleStartMap,
  onMountStartMiniMap,
  onCopyCode,
  onShareInvite,
  onShowQr,
  onEditName,
  onSaveName,
  onCancelName,
  onMoveTurn,
  onShuffleTurns,
  onStartCheckIn,
  onMarkReady,
  onUnmarkReady,
  onStartMatch,
  onStartQa,
  onSelectQaLocation,
  onAdvanceQaClock,
  onRegroupCheckIn,
  onOpenQuickGuide,
  onRefresh,
  onNavigateCatalog,
  onConfirmLeave,
  onPlayAgain,
  onJoinNewRoom,
}: {
  payload: SeekRoomPayload;
  ownedPackIds: string[];
  allowHideSeekQa: boolean;
  statusMsg: string;
  inlineError: SeekInlineError;
  busy: boolean;
  copiedCode: boolean;
  copiedLink: boolean;
  editingName: boolean;
  renameDraftSig: Signal<string>;
  startMapExpanded: boolean;
  qaStationId: string;
  selfFix: LocationFix | null;
  liveLocationStatus: LiveLocationStatus;
  cueRevision: number;
  clockNowSig: Signal<number>;
  onDismissCue: () => void;
  onEnableLocation: () => void;
  onToggleStartMap: () => void;
  onMountStartMiniMap: (container: HTMLElement) => (() => void) | void;
  onCopyCode: () => void;
  onShareInvite: () => void;
  onShowQr: () => void;
  onEditName: () => void;
  onSaveName: () => void;
  onCancelName: () => void;
  onMoveTurn: (seatId: string, dir: -1 | 1) => void;
  onShuffleTurns: () => void;
  onStartCheckIn: () => void;
  onMarkReady: () => void;
  onUnmarkReady: () => void;
  onStartMatch: () => void;
  onStartQa: (packId: string, version: number) => void;
  onSelectQaLocation: (stationId: string) => void;
  onAdvanceQaClock: (step: "minute" | "five-minutes" | "phase-end") => void;
  onRegroupCheckIn: () => void;
  onOpenQuickGuide: () => void;
  onRefresh: () => void;
  onNavigateCatalog: () => void;
  onConfirmLeave: () => void;
  onPlayAgain: () => void;
  onJoinNewRoom: () => void;
}) {
  const { room, pass } = payload;
  const renameInputRef = useRef<HTMLInputElement | null>(null);
  const seenSeatIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (editingName) {
      renameInputRef.current?.focus({ preventScroll: true });
    }
  }, [editingName]);

  if (room.phase === "canceled") {
    return (
      <CanceledRoomCard
        roomCode={room.code}
        title={room.packMeta.title}
        onBackToCatalog={onNavigateCatalog}
      />
    );
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

  const startProximity = evaluateCheckInProximity(
    selfFix,
    room.turnStartPoint,
    payload.publicBoard.checkInRadiusMeters,
    payload.publicBoard.maxGpsAccuracyMeters,
  );
  const regroupProximity = room.regroupPoint
    ? evaluateCheckInProximity(
        selfFix,
        room.regroupPoint,
        payload.publicBoard.checkInRadiusMeters,
        payload.publicBoard.maxGpsAccuracyMeters,
      )
    : null;

  const isKnownSeat = (seatId: string) => {
    if (seenSeatIdsRef.current.size === 0) return true;
    return seenSeatIdsRef.current.has(seatId);
  };
  useEffect(() => {
    for (const s of room.seats) seenSeatIdsRef.current.add(s.seatId);
  }, [room.code, room.seats]);

  return (
    <section class="rb-shell" aria-label="Permainan Hide & Seek">
      <div class="rb-card">
        <div class="sg-room-header">
          <div class="rb-badges">
            <span class="rb-badge">Kode: {room.code}</span>
            <span class="rb-badge">{phaseLabels[room.phase]}</span>
            <span class="rb-badge">
              Giliran {room.turnNumber}/{room.totalPlannedTurns}
            </span>
            <span class="rb-badge">
              Peran: {isHider ? "Penyembunyi" : room.role === "seeker" ? "Pencari" : "Lobi"}
            </span>
            {isDraft ? (
              <span class="rb-badge sg-qa-badge" data-testid="draft-playtest-badge">
                Uji Draf
              </span>
            ) : payload.qa ? (
              <span class="rb-badge sg-qa-badge" data-testid="seek-qa-badge">
                Ruang QA
              </span>
            ) : null}
            {!isDraft &&
              (pass.paid ? (
                <span class="rb-badge rb-badge-paid">Pass Berbayar</span>
              ) : (
                <span class="rb-badge">Resmi Gratis</span>
              ))}
          </div>
          <div class="qg-header-tools">
            {room.phase === "lobby" && (
              <button
                type="button"
                class="qg-trigger-btn"
                data-action="open-quick-guide"
                data-testid="lobby-quick-guide-btn"
                disabled={busy}
                onClick={onOpenQuickGuide}
              >
                ? Panduan
              </button>
            )}
            <SeekRoomMenu
              payload={payload}
              busy={busy}
              onOpenQuickGuide={onOpenQuickGuide}
              onOpenActivity={() => {}}
              onRefresh={onRefresh}
              onNavigateCatalog={onNavigateCatalog}
              onConfirmLeave={onConfirmLeave}
            />
          </div>
        </div>
        <h2>{room.packMeta.title}</h2>
        {isDraft && (
          <div class="cg-draft-bar-head" data-testid="draft-playtest-bar">
            <DraftStudioLink format="hide-and-seek" pass={pass} />
          </div>
        )}
        {statusMsg && <p role="status">{statusMsg}</p>}
        <SeekSlotAlert error={inlineError} slot="lobby" />
        {allowHideSeekQa && !payload.qa && !pass.paid && room.phase === "lobby" && isHost && (
          <div class="rb-actions">
            <button
              type="button"
              class="secondary"
              data-action="start-qa"
              data-pack={pass.packId}
              data-version={pass.version}
              disabled={busy}
              onClick={() => onStartQa(pass.packId, pass.version)}
            >
              Buat Ruang QA dari Paket Ini
            </button>
          </div>
        )}
      </div>

      {(room.outcome || room.phase === "regroup") && payload.activity.events.length > 0 && (
        <details class="rb-card rb-accordion">
          <summary>Aktivitas terbaru</summary>
          <SeekActivityPanel feed={payload.activity} clockNowSig={clockNowSig} />
        </details>
      )}

      {payload.qa && !room.outcome && (
        <section class="rb-card" aria-label="Kontrol QA">
          <SeekQaPanel
            payload={payload}
            qaStationId={qaStationId}
            busy={busy}
            onSelectQaLocation={onSelectQaLocation}
            onAdvanceClock={onAdvanceQaClock}
          />
        </section>
      )}

      {room.phase === "lobby" && (
        <div class="rb-card">
          <PhaseCueStrip
            cueKey="seek-lobby"
            cueRevision={cueRevision}
            onDismiss={onDismissCue}
          />
          <OutdoorReadinessStrip
            fix={selfFix}
            status={liveLocationStatus}
            onEnableLocation={onEnableLocation}
          />
          <StartPointCard
            startPoint={room.turnStartPoint}
            fix={selfFix}
            checkInRadiusMeters={payload.publicBoard.checkInRadiusMeters}
            maxGpsAccuracyMeters={payload.publicBoard.maxGpsAccuracyMeters}
            status={liveLocationStatus}
            mapExpanded={startMapExpanded}
            mapHostId="sg-start-minimap"
            onEnableLocation={onEnableLocation}
            onToggleMap={onToggleStartMap}
            onMountMiniMap={onMountStartMiniMap}
          />
          <LobbyInviteCard
            roomCode={room.code}
            inviteUrl={inviteUrl}
            copiedCode={copiedCode}
            copiedLink={copiedLink}
            onCopyCode={onCopyCode}
            onShareInvite={onShareInvite}
            onShowQr={onShowQr}
          />
          <div class="lobby-team-head">
            <h3>
              Kursi Pemain ({room.seats.length}/{pass.maxPlayers})
            </h3>
            {isHost && seatsOrdered.length >= 2 && (
              <button
                type="button"
                class="secondary"
                data-action="shuffle-turns"
                data-testid="shuffle-turns-btn"
                disabled={busy}
                onClick={onShuffleTurns}
              >
                Acak
              </button>
            )}
          </div>
          <ul class="rb-list" data-testid="seek-turn-list">
            {seatsOrdered.map((s, idx) => {
              const isSelf = s.seatId === room.seatId;
              return (
                <li key={s.seatId} data-seat-row={s.seatId}>
                  <LobbySeatItem isNew={!isKnownSeat(s.seatId)}>
                    <div class="lobby-seat-main">
                      <span class="lobby-turn-badge">Giliran {idx + 1}</span>
                      <strong>{s.name}</strong>
                      {s.isHost ? " · Host" : ""}
                      {isSelf ? " · Kamu" : ""} · {s.ready ? "Siap" : "Belum siap"}
                    </div>
                    <div class="lobby-seat-controls">
                      {isSelf && !editingName && (
                        <button
                          type="button"
                          class="secondary lobby-icon-btn"
                          data-action="edit-name"
                          data-testid="edit-own-name"
                          aria-label="Ubah nama pemain"
                          disabled={busy}
                          onClick={onEditName}
                        >
                          ✎
                        </button>
                      )}
                      {isHost && seatsOrdered.length >= 2 && (
                        <>
                          <button
                            type="button"
                            class="secondary lobby-icon-btn"
                            data-action="move-turn"
                            data-seat={s.seatId}
                            data-dir="-1"
                            aria-label={`Naikkan giliran ${s.name}`}
                            disabled={busy || idx === 0}
                            onClick={() => onMoveTurn(s.seatId, -1)}
                          >
                            ↑
                          </button>
                          <button
                            type="button"
                            class="secondary lobby-icon-btn"
                            data-action="move-turn"
                            data-seat={s.seatId}
                            data-dir="1"
                            aria-label={`Turunkan giliran ${s.name}`}
                            disabled={busy || idx === seatsOrdered.length - 1}
                            onClick={() => onMoveTurn(s.seatId, 1)}
                          >
                            ↓
                          </button>
                        </>
                      )}
                    </div>
                  </LobbySeatItem>
                  {isSelf && editingName && (
                    <div class="lobby-rename-form">
                      <input
                        ref={renameInputRef}
                        id="sg-rename-input"
                        type="text"
                        maxLength={32}
                        value={renameDraftSig.value}
                        placeholder="Nama pemain"
                        aria-label="Nama pemain baru"
                        onInput={(event) => {
                          renameDraftSig.value = event.currentTarget.value;
                        }}
                      />
                      <button
                        type="button"
                        class="primary"
                        data-action="save-name"
                        data-testid="save-own-name"
                        disabled={busy}
                        onClick={onSaveName}
                      >
                        Simpan
                      </button>
                      <button
                        type="button"
                        class="secondary"
                        data-action="cancel-name"
                        disabled={busy}
                        onClick={onCancelName}
                      >
                        Batal
                      </button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
          <SeekSlotAlert error={inlineError} slot="lobby-checkin" />
          <div class="rb-actions">
            <button
              type="button"
              class={`secondary${startProximity.state === "ready" ? " loc-btn-ready" : ""}`}
              data-action="sim-start-checkin"
              disabled={busy}
              onClick={onStartCheckIn}
            >
              Check-in di {room.turnStartPoint.name}
            </button>
            {ownSeat?.ready ? (
              <button
                type="button"
                class="secondary"
                data-action="unmark-ready"
                disabled={busy}
                onClick={onUnmarkReady}
              >
                Batal Siap
              </button>
            ) : (
              <button
                type="button"
                class="primary"
                data-action="mark-ready"
                disabled={busy}
                onClick={onMarkReady}
              >
                Tandai Siap
              </button>
            )}
            {isHost ? (
              <button
                type="button"
                class="primary"
                data-action="start-match"
                disabled={busy || !enoughPlayers}
                onClick={onStartMatch}
              >
                Mulai Permainan
              </button>
            ) : (
              <span class="lobby-wait-pill" role="status" data-testid="seek-wait-host">
                Menunggu Host memulai…
              </span>
            )}
          </div>
          {!enoughPlayers && (
            <p role="status">
              Undang pemain hingga ruang berisi setidaknya {minPlayers} pemain.
            </p>
          )}
          {exitSpec && (
            <div class="lobby-footer-exit">
              <button
                type="button"
                class="secondary lobby-danger-btn"
                data-action="confirm-leave"
                data-testid="lobby-leave-btn"
                disabled={busy}
                onClick={onConfirmLeave}
              >
                {exitSpec.label}
              </button>
            </div>
          )}
        </div>
      )}

      {room.outcome && (
        <div class="rb-card" data-testid="seek-outcome">
          <h3>Hasil permainan</h3>
          <p>
            {room.seats.find((seat) => seat.seatId === room.outcome?.winnerSeatId)?.name ??
              "Tidak ada pemenang"}
          </p>
          <ul class="rb-list">
            {room.turns.map((turn, idx) => (
              <li key={`${turn.hiderSeatId}-${idx}`}>
                <strong>
                  {room.seats.find((seat) => seat.seatId === turn.hiderSeatId)?.name ??
                    "Penyembunyi"}
                </strong>
                <span>{clockText(turn.adjustedMs)}</span>
              </li>
            ))}
          </ul>
          <PostMatchActions
            roomCode={room.code}
            packId={pass.packId}
            version={pass.version}
            started={room.startedAt !== null}
            canPlayAgain={!pass.paid || isHost || ownedPackIds.includes(pass.packId)}
            busy={busy}
            onPlayAgain={onPlayAgain}
            onJoinNewRoom={onJoinNewRoom}
            onBackToCatalog={onNavigateCatalog}
          />
        </div>
      )}

      {room.phase === "regroup" && (
        <div class="rb-card" data-testid="seek-regroup-card">
          <h3>Berkumpul Kembali</h3>
          {room.regroupPoint && (
            <p>
              Titik awal berikutnya · <strong>{room.regroupPoint.name}</strong>
            </p>
          )}
          {room.phaseEndsAt !== null && (
            <p>
              Sisa waktu berkumpul ·{" "}
              <SeekDeadline deadline={room.phaseEndsAt} clockNowSig={clockNowSig} />
            </p>
          )}
          {room.regroupPoint && (
            <div class="cg-selected-meta-actions">
              <DistanceMeter
                fix={selfFix}
                target={room.regroupPoint}
                checkInRadiusMeters={payload.publicBoard.checkInRadiusMeters}
                maxGpsAccuracyMeters={payload.publicBoard.maxGpsAccuracyMeters}
                status={liveLocationStatus}
                testId="regroup-distance-meter"
                showEnableChip
                onEnableLocation={onEnableLocation}
              />
              <DirectionsLink coord={room.regroupPoint} testId="regroup-directions-link" />
            </div>
          )}
          <SeekSlotAlert error={inlineError} slot="regroup-checkin" />
          <button
            type="button"
            class={`primary${regroupProximity?.state === "ready" ? " loc-btn-ready" : ""}`}
            data-action="regroup"
            disabled={busy}
            onClick={onRegroupCheckIn}
          >
            Check-in untuk giliran berikutnya
          </button>
        </div>
      )}

      <div class="rb-card">
        <h3>Riwayat Petunjuk ({room.questions.length})</h3>
        <ul class="rb-list">
          {room.questions.length === 0 ? (
            <li>Belum ada petunjuk yang diajukan pada giliran ini.</li>
          ) : (
            room.questions.map((q) => (
              <li key={q.id}>
                <strong>
                  {familyLabels[q.family]} · {q.label}
                </strong>
                <small>
                  {questionStatusLabel(q.status)}
                  {q.answerLabel ? ` · ${answerText(q.answerLabel)}` : ""}
                </small>
              </li>
            ))
          )}
        </ul>
      </div>
    </section>
  );
}
