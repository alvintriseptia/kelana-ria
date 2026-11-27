import type { ClaimEngineRoomView } from "@kelana-ria/contracts";
import type { Signal } from "@preact/signals";
import { PostMatchActions } from "../lobby-ui";
import { claimDecidingMetric, claimResultReasons } from "../rulebook-claim-result";
import { ClaimRelativeAge, LearningExplanation } from "./ClaimShared";
import { phaseLabels, teamName, zoneLabelFor, type ClaimRoomPayload } from "./types";

export function ClaimRivalPositionsList({
  room,
  clockNowSig,
}: {
  room: ClaimEngineRoomView;
  clockNowSig: Signal<number>;
}) {
  if (
    room.isSolo ||
    room.phase !== "active" ||
    room.outcome ||
    room.opponentTracking?.mode === "off"
  ) {
    return null;
  }
  const posBySeat = new Map((room.seatPositions ?? []).map((p) => [p.seatId, p]));
  const others = room.seats.filter((seat) => seat.seatId !== room.seatId);
  if (others.length === 0) return null;

  return (
    <>
      <h3>Posisi Pemain</h3>
      <ul class="rb-list cg-players-list" aria-label="Posisi Pemain">
        {others.map((seat) => {
          const pos = posBySeat.get(seat.seatId);
          if (!pos) {
            return (
              <li key={seat.seatId} data-player-seat={seat.seatId}>
                <span>
                  <strong>▲ {seat.name}</strong> · Belum ada lokasi
                </span>
              </li>
            );
          }
          const zoneName = zoneLabelFor(room, pos.zoneId);
          const sourceTag = pos.source === "checkin" ? "Check-in" : "GPS";
          return (
            <li key={seat.seatId} data-player-seat={seat.seatId} data-source={pos.source}>
              <span>
                <strong>▲ {seat.name}</strong>
                {zoneName ? ` · ${zoneName}` : ""} · {sourceTag}
              </span>
              <ClaimRelativeAge
                at={pos.at}
                clockNowSig={clockNowSig}
                stalePrefix
                className="cg-player-age"
              />
            </li>
          );
        })}
      </ul>
    </>
  );
}

export function ClaimScorePanel({
  payload,
  ownedPackIds,
  clockNowSig,
  busy,
  onPlayAgain,
  onJoinNewRoom,
  onNavigateCatalog,
}: {
  payload: ClaimRoomPayload;
  ownedPackIds: string[];
  clockNowSig: Signal<number>;
  busy: boolean;
  onPlayAgain: () => void;
  onJoinNewRoom: () => void;
  onNavigateCatalog: () => void;
}) {
  const { room, pass } = payload;
  const solo = room.soloProgress;
  const ownSeat = room.seats.find((s) => s.seatId === room.seatId);
  const canPlayAgain =
    !pass.paid || Boolean(ownSeat?.isHost) || ownedPackIds.includes(pass.packId);

  let outcomeTitle = "Seri!";
  if (room.outcome) {
    if (
      room.outcome.reason === "abandoned" ||
      room.outcome.reason === "canceled" ||
      (room.outcome.reason === "forfeit" && !room.outcome.winnerTeamId)
    ) {
      outcomeTitle = phaseLabels[room.phase];
    } else if (room.isSolo) {
      outcomeTitle = room.outcome.soloWon ? "Menang Solo!" : "Sesi Solo Berakhir";
    } else if (room.outcome.winnerTeamId) {
      outcomeTitle = `Pemenang · ${teamName(room, room.outcome.winnerTeamId)}`;
    }
  }
  const decidingMetric = room.outcome
    ? claimDecidingMetric(room.standings, room.outcome, room.isSolo)
    : null;

  return (
    <>
      {room.outcome && (
        <div class="cg-result" data-testid="claim-outcome">
          <small>Hasil Akhir</small>
          <h2>{outcomeTitle}</h2>
          <p>
            {claimResultReasons[room.outcome.reason]}
            {decidingMetric ? ` Penentu kemenangan · ${decidingMetric}.` : ""}
          </p>
        </div>
      )}
      {room.outcome && room.ownLearningExplanation && (
        <LearningExplanation text={room.ownLearningExplanation.text} />
      )}
      {!room.outcome && <h2>Skor Ronde</h2>}
      {solo ? (
        <div class="cg-score-grid" aria-label="Target Solo">
          <div>
            <strong>
              {solo.lockedLandmarks}/{solo.targetLandmarks}
            </strong>
            <small>Landmark terkunci</small>
          </div>
          <div>
            <strong>
              {solo.distinctZones}/{solo.targetZones}
            </strong>
            <small>Zona berbeda</small>
          </div>
        </div>
      ) : (
        <>
          <ul class="rb-list cg-standings" aria-label="Papan Skor Zona">
            {room.standings.map((score) => (
              <li key={score.teamId}>
                <strong>
                  {teamName(room, score.teamId)}
                  {score.teamId === room.teamId ? " · Kamu" : ""}
                </strong>
                <small>
                  {score.zonesControlled} zona · {score.lockedLandmarks} terkunci ·{" "}
                  {score.totalLandmarks} total landmark
                </small>
              </li>
            ))}
          </ul>
          <p class="cg-rank-rule">
            Urutan skor · Zona dikuasai › Landmark terkunci › Total landmark
          </p>
        </>
      )}
      <ClaimRivalPositionsList room={room} clockNowSig={clockNowSig} />
      {room.outcome && (
        <PostMatchActions
          roomCode={room.code}
          packId={pass.packId}
          version={pass.version}
          started={room.startedAt !== null}
          canPlayAgain={canPlayAgain}
          busy={busy}
          onPlayAgain={onPlayAgain}
          onJoinNewRoom={onJoinNewRoom}
          onBackToCatalog={onNavigateCatalog}
        />
      )}
    </>
  );
}
