import type { LocationFix } from "@kelana-ria/contracts";
import { useEffect, useRef } from "preact/hooks";
import { evaluateCheckInProximity, type LiveLocationStatus } from "../live-location";
import {
  LobbyInviteCard,
  LobbySeatItem,
  LobbyTeamChip,
  OutdoorReadinessStrip,
  teamVisual,
} from "../lobby-ui";
import { StartPointCard } from "../ui/LocationWidgets";
import { PhaseCueStrip } from "../ui/PhaseCueStrip";
import { ClaimDraftBar, ClaimMoreMenu, ClaimSlotAlert } from "./ClaimShared";
import {
  destructiveExitSpec,
  isQaRoom,
  orderedTeamIds,
  phaseLabels,
  type ClaimInlineError,
  type ClaimRoomPayload,
} from "./types";

export function ClaimLobbyView({
  payload,
  selfFix,
  liveLocationStatus,
  startMapExpanded,
  demoLocation,
  qaLocationId,
  copiedCode,
  copiedLink,
  editingName,
  renameDraft,
  statusMsg,
  inlineError,
  busy,
  cueRevision,
  wakeLockSupported,
  wakeLockWanted,
  onEnableLocation,
  onToggleStartMap,
  onMountStartMiniMap,
  onSelectQaLocation,
  onAdvanceQaClock,
  onCopyCode,
  onShareInvite,
  onShowQr,
  onStartEditName,
  onRenameDraftInput,
  onSaveName,
  onCancelEditName,
  onReassignSeatTeam,
  onJoinTeam,
  onNewTeam,
  onCheckInStart,
  onToggleReady,
  onStartMatch,
  onOpenQuickGuide,
  onOpenActivity,
  onToggleWakeLock,
  onRefresh,
  onNavigateCatalog,
  onConfirmLeave,
  onDismissCue,
}: {
  payload: ClaimRoomPayload;
  selfFix: LocationFix | null;
  liveLocationStatus: LiveLocationStatus;
  startMapExpanded: boolean;
  demoLocation: boolean;
  qaLocationId: string;
  copiedCode: boolean;
  copiedLink: boolean;
  editingName: boolean;
  renameDraft: string;
  statusMsg: string;
  inlineError: ClaimInlineError;
  busy: boolean;
  cueRevision: number;
  wakeLockSupported: boolean;
  wakeLockWanted: boolean;
  onEnableLocation: () => void;
  onToggleStartMap: () => void;
  onMountStartMiniMap: (container: HTMLElement) => (() => void) | void;
  onSelectQaLocation: (nextId: string) => void;
  onAdvanceQaClock: (step: "minute" | "five-minutes" | "phase-end") => void;
  onCopyCode: () => void;
  onShareInvite: () => void;
  onShowQr: () => void;
  onStartEditName: () => void;
  onRenameDraftInput: (value: string) => void;
  onSaveName: () => void;
  onCancelEditName: () => void;
  onReassignSeatTeam: (seatId: string, chosenTeam: string) => void;
  onJoinTeam: (teamId: string) => void;
  onNewTeam: () => void;
  onCheckInStart: () => void;
  onToggleReady: (ready: boolean) => void;
  onStartMatch: () => void;
  onOpenQuickGuide: () => void;
  onOpenActivity: () => void;
  onToggleWakeLock: () => void;
  onRefresh: () => void;
  onNavigateCatalog: () => void;
  onConfirmLeave: () => void;
  onDismissCue: () => void;
}) {
  const { room, pass, publicBoard } = payload;
  const inviteUrl = `${location.origin}/?play=rulebook-claim&room=${encodeURIComponent(room.code)}`;
  const isGroupLobby = pass.mode !== "solo" && pass.maxPlayers > 1;
  const enoughPlayers = !pass.minPlayers || room.seats.length >= pass.minPlayers;
  const ownSeat = room.seats.find((seat) => seat.seatId === room.seatId);
  const isHost = Boolean(ownSeat?.isHost);
  const teams = orderedTeamIds(room.seats);
  const enoughTeams =
    !isGroupLobby || (pass.mode === undefined && room.seats.length <= 1) || teams.length >= 2;
  const ownTeamMembers = ownSeat
    ? room.seats.filter((s) => s.teamId === ownSeat.teamId).length
    : 0;
  const exitSpec = destructiveExitSpec(payload);
  const startProximity = evaluateCheckInProximity(
    selfFix,
    publicBoard.startPoint,
    publicBoard.checkInRadiusMeters,
    publicBoard.maxGpsAccuracyMeters,
  );

  const seenSeatIdsRef = useRef<Set<string> | null>(null);
  const prevSeats = seenSeatIdsRef.current;
  const newSeatIds = new Set<string>();
  if (prevSeats) {
    for (const s of room.seats) {
      if (!prevSeats.has(s.seatId)) newSeatIds.add(s.seatId);
    }
  }
  useEffect(() => {
    seenSeatIdsRef.current = new Set(room.seats.map((s) => s.seatId));
  }, [room.code, room.seats.map((s) => s.seatId).join(",")]);

  const renameInputRef = useRef<HTMLInputElement | null>(null);
  const editNameBtnRef = useRef<HTMLButtonElement | null>(null);
  const prevEditingRef = useRef(editingName);
  useEffect(() => {
    if (editingName && !prevEditingRef.current) {
      renameInputRef.current?.focus({ preventScroll: true });
    } else if (!editingName && prevEditingRef.current) {
      editNameBtnRef.current?.focus({ preventScroll: true });
    }
    prevEditingRef.current = editingName;
  }, [editingName]);

  return (
    <section class="rb-shell" aria-label="Ruang Claim the City">
      <div class="rb-card">
        <div class="rb-actions cg-lobby-head">
          <div>
            <div class="rb-badges">
              <span class="rb-badge">Kode: {room.code}</span>
              <span class="rb-badge">{phaseLabels[room.phase]}</span>
              {pass.mode && (
                <span class="rb-badge">{pass.mode === "solo" ? "Solo" : "Grup"}</span>
              )}
              {pass.paid && <span class="rb-badge rb-badge-paid">Pass Berbayar</span>}
            </div>
            <h2>{room.packMeta.title}</h2>
          </div>
          <div class="qg-header-tools">
            <button
              type="button"
              class="qg-trigger-btn"
              data-action="open-quick-guide"
              data-testid="lobby-quick-guide-btn"
              onClick={onOpenQuickGuide}
            >
              ? Panduan
            </button>
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
        </div>

        {statusMsg && <p role="status">{statusMsg}</p>}
        <ClaimSlotAlert error={inlineError} slot="lobby" />
        <PhaseCueStrip
          cueKey="claim-lobby"
          extraNote={isGroupLobby ? "Atur tim di bawah sebelum mulai." : undefined}
          cueRevision={cueRevision}
          onDismiss={onDismissCue}
        />
        <ClaimDraftBar
          payload={payload}
          qaLocationId={qaLocationId}
          busy={busy}
          onSelectQaLocation={onSelectQaLocation}
          onAdvanceQaClock={onAdvanceQaClock}
        />
        <OutdoorReadinessStrip
          fix={selfFix}
          status={liveLocationStatus}
          onEnableLocation={onEnableLocation}
        />
        <StartPointCard
          startPoint={publicBoard.startPoint}
          fix={selfFix}
          checkInRadiusMeters={publicBoard.checkInRadiusMeters}
          maxGpsAccuracyMeters={publicBoard.maxGpsAccuracyMeters}
          status={liveLocationStatus}
          mapExpanded={startMapExpanded}
          mapHostId="cg-start-minimap"
          onEnableLocation={onEnableLocation}
          onToggleMap={onToggleStartMap}
          onMountMiniMap={onMountStartMiniMap}
        />
        {isGroupLobby && (
          <LobbyInviteCard
            roomCode={room.code}
            inviteUrl={inviteUrl}
            copiedCode={copiedCode}
            copiedLink={copiedLink}
            onCopyCode={onCopyCode}
            onShareInvite={onShareInvite}
            onShowQr={onShowQr}
          />
        )}

        <h3>
          Kursi Pemain ({room.seats.length}/{pass.maxPlayers})
        </h3>
        <ul class="rb-list">
          {room.seats.map((seat) => {
            const isSelf = seat.seatId === room.seatId;
            const tIdx = Math.max(0, teams.indexOf(seat.teamId));
            return (
              <li key={seat.seatId} data-seat-row={seat.seatId}>
                <LobbySeatItem isNew={newSeatIds.has(seat.seatId)}>
                  <div class="lobby-seat-main">
                    {isGroupLobby && (
                      <LobbyTeamChip teamIndex={tIdx} className="lobby-team-badge" />
                    )}
                    <strong>{seat.name}</strong>
                    {seat.isHost ? " · Host" : ""}
                    {isSelf ? " · Kamu" : ""} · {seat.ready ? "Siap" : "Belum siap"}
                  </div>
                  <div class="lobby-seat-controls">
                    {isSelf && !editingName && (
                      <button
                        ref={editNameBtnRef}
                        type="button"
                        class="secondary lobby-icon-btn"
                        data-action="edit-name"
                        data-testid="edit-own-name"
                        aria-label="Ubah nama pemain"
                        disabled={busy}
                        onClick={onStartEditName}
                      >
                        ✎
                      </button>
                    )}
                    {isHost && isGroupLobby && (
                      <select
                        class="lobby-seat-select"
                        data-reassign-seat={seat.seatId}
                        aria-label={`Pindah tim ${seat.name}`}
                        value={seat.teamId}
                        disabled={busy}
                        onChange={(event) =>
                          onReassignSeatTeam(seat.seatId, event.currentTarget.value)
                        }
                      >
                        {teams.map((tid, idx) => {
                          const tv = teamVisual(idx);
                          return (
                            <option key={tid} value={tid}>
                              {tv.shape} {tv.label}
                            </option>
                          );
                        })}
                        <option value="__new__">+ Tim Baru</option>
                      </select>
                    )}
                  </div>
                </LobbySeatItem>
                {isSelf && editingName && (
                  <div class="lobby-rename-form">
                    <input
                      ref={renameInputRef}
                      id="cg-rename-input"
                      type="text"
                      maxLength={32}
                      value={renameDraft}
                      placeholder="Nama pemain"
                      aria-label="Nama pemain baru"
                      disabled={busy}
                      onInput={(event) => onRenameDraftInput(event.currentTarget.value)}
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
                      onClick={onCancelEditName}
                    >
                      Batal
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>

        {isGroupLobby && (
          <section
            class="lobby-team-section"
            aria-label="Susunan Tim"
            data-testid="claim-team-switcher"
          >
            <div class="lobby-team-head">
              <h4>Susunan Tim ({teams.length} tim)</h4>
              <button
                type="button"
                class="secondary"
                data-action="new-team"
                data-testid="new-team-btn"
                disabled={busy || ownTeamMembers <= 1}
                onClick={onNewTeam}
              >
                + Tim Baru
              </button>
            </div>
            <div class="lobby-team-grid">
              {teams.map((tid, idx) => {
                const vis = teamVisual(idx);
                const members = room.seats.filter((s) => s.teamId === tid);
                const isOwnTeam = ownSeat?.teamId === tid;
                return (
                  <div
                    key={tid}
                    class="lobby-team-card"
                    data-team-card={tid}
                    style={{
                      "--team-accent": vis.accent,
                      "--team-bg": vis.bg,
                      "--team-border": vis.border,
                    }}
                  >
                    <div class="lobby-team-top">
                      <span class="lobby-team-badge">
                        <span aria-hidden="true">{vis.shape}</span> {vis.label} ({members.length})
                      </span>
                      {isOwnTeam ? (
                        <span class="rb-badge">Tim Kamu</span>
                      ) : (
                        <button
                          type="button"
                          class="secondary"
                          data-action="join-team"
                          data-team={tid}
                          disabled={busy}
                          onClick={() => onJoinTeam(tid)}
                        >
                          Gabung {vis.label}
                        </button>
                      )}
                    </div>
                    <div class="lobby-team-members">
                      {members.map((m) => (
                        <span key={m.seatId} class="lobby-member-pill">
                          {m.name}
                          {m.isHost ? " ★" : ""}
                        </span>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {pass.mode !== "solo" && (
          <p class="cg-presence-notice">
            Lokasi dibagikan ke pemain di ruang selama ronde aktif.
          </p>
        )}
        <ClaimSlotAlert error={inlineError} slot="lobby-checkin" />

        <div class="rb-actions">
          <button
            type="button"
            class={`secondary${startProximity.state === "ready" ? " loc-btn-ready" : ""}`}
            data-action="sim-start-checkin"
            disabled={busy}
            onClick={onCheckInStart}
          >
            {demoLocation || isQaRoom(payload)
              ? "Simulasikan Check-in Titik Awal"
              : "Check-in Titik Awal"}
          </button>
          {ownSeat?.ready ? (
            <button
              type="button"
              class="secondary"
              data-action="unmark-ready"
              disabled={busy}
              onClick={() => onToggleReady(false)}
            >
              Batal Siap
            </button>
          ) : (
            <button
              type="button"
              class="primary"
              data-action="mark-ready"
              disabled={busy}
              onClick={() => onToggleReady(true)}
            >
              Tandai Siap
            </button>
          )}
          {isHost ? (
            <button
              type="button"
              class="primary"
              data-action="start-match"
              disabled={busy || !(enoughPlayers && enoughTeams)}
              onClick={onStartMatch}
            >
              Mulai Permainan
            </button>
          ) : (
            <span class="lobby-wait-pill" role="status">
              Menunggu Host memulai…
            </span>
          )}
        </div>

        {!enoughPlayers && (
          <p>Undang pemain hingga ruang berisi setidaknya {pass.minPlayers} pemain.</p>
        )}
        {enoughPlayers && !enoughTeams && (
          <p role="status" data-testid="not-enough-teams-hint">
            Minimal 2 tim berbeda untuk memulai.
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
    </section>
  );
}
