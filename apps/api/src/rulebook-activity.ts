import type {
  ClaimEngineRoomView,
  RoomActivityEvent,
  RoomActivityFeed,
  RoomActivityNotice,
  SeekDeckHiderView,
  SeekDeckPublicView,
  SeekEngineQuestion,
  SeekEngineRoomView,
} from "@kelana-ria/contracts";
import { computeZoneStandings, type ClaimEngineMatch } from "./claim-engine/claim-engine.js";
import type { SeekDeckEngineState } from "./seek-engine/deck-engine.js";
import { activeHiderSeatId, type SeekEngineMatch } from "./seek-engine/seek-engine.js";

const recentLimit = 24;
const reminderWindowMs = 30_000;

type EventCopy = Omit<RoomActivityEvent, "id" | "sequence">;
type Seat = { seatId: string };

export type RoomActivitySnapshot = {
  feeds: [string, { sequence: number; events: RoomActivityEvent[] }][];
  claimEventCount: number;
  claimOwners: [string, string | null][];
  zoneControllers: [string, string | null][];
  claimHands: [string, number][];
  claimProofs: [string, string][];
  seekTurn: number;
  seekPhase: SeekEngineMatch["phase"];
  completedTurns: number;
  seekDrawKey: string;
  seekHandKey: string;
  seekCurseKey: string;
  questionStates: [string, SeekEngineQuestion["status"]][];
};

export function createRoomActivity(initial?: RoomActivitySnapshot) {
  const feeds = new Map<string, { sequence: number; events: RoomActivityEvent[] }>(
    initial?.feeds.map(([seatId, feed]) => [
      seatId,
      { sequence: feed.sequence, events: feed.events.filter(event => String(event.kind) !== "endgame").map(event => ({ ...event })) },
    ]) ?? [],
  );
  let claimEventCount = initial?.claimEventCount ?? 0;
  let claimOwners = new Map<string, string | null>(initial?.claimOwners ?? []);
  let zoneControllers = new Map<string, string | null>(initial?.zoneControllers ?? []);
  let claimHands = new Map<string, number>(initial?.claimHands ?? []);
  let claimProofs = new Map<string, string>(initial?.claimProofs ?? []);
  let seekTurn = initial?.seekTurn ?? 0;
  let seekPhase: SeekEngineMatch["phase"] = initial?.seekPhase ?? "lobby";
  let completedTurns = initial?.completedTurns ?? 0;
  let seekDrawKey = initial?.seekDrawKey ?? "";
  let seekHandKey = initial?.seekHandKey ?? "";
  let seekCurseKey = initial?.seekCurseKey ?? "";
  const questionStates = new Map<string, SeekEngineQuestion["status"]>(initial?.questionStates ?? []);
  let publishedSinceCheck = false;

  function publish(seats: readonly Seat[], copy: EventCopy, alertFor?: (seatId: string) => boolean) {
    if (seats.length > 0) publishedSinceCheck = true;
    for (const { seatId } of seats) {
      const feed = feeds.get(seatId) ?? { sequence: 0, events: [] };
      const sequence = ++feed.sequence;
      feed.events.push({ ...copy, id: String(sequence), sequence, ...(alertFor?.(seatId) ? { alert: true as const } : {}) });
      if (feed.events.length > recentLimit) feed.events.shift();
      feeds.set(seatId, feed);
    }
  }

  function view(seatId: string, prompt: RoomActivityNotice | null): RoomActivityFeed {
    const feed = feeds.get(seatId);
    return { sequence: feed?.sequence ?? 0, events: feed?.events.slice() ?? [], prompt };
  }

  function observeClaim(match: ClaimEngineMatch, now: number, zones = computeZoneStandings(match).zones): boolean {
    publishedSinceCheck = false;
    let dirty = false;
    const { seats, phase } = match;
    const zoneById = new Map(zones.map(zone => [zone.zoneId, zone]));
    const landmarkById = new Map(match.pack.geography.landmarks.map(landmark => [landmark.id, landmark]));
    const changedZones = new Set(zones.filter(zone =>
      zone.controllerTeamId !== (zoneControllers.get(zone.zoneId) ?? null)).map(zone => zone.zoneId));
    if (changedZones.size > 0) dirty = true;
    const teamOf = (seatId: string) => seats.find(seat => seat.seatId === seatId)?.teamId;
    if (claimEventCount !== match.events.length) dirty = true;
    for (const event of match.events.slice(claimEventCount)) {
      const { type, at, landmarkId } = event;
      if (type === "started") {
        publish(seats, { kind: "round-start", text: "Ronde dimulai. Pilih landmark untuk bermain.", panel: "board", at }, () => true);
      } else if (type === "claimed" || type === "locked" || type === "stolen") {
        if (!landmarkId) continue;
        const landmark = landmarkById.get(landmarkId);
        if (!landmark) continue;
        const previousTeam = claimOwners.get(landmarkId);
        const flipped = type === "stolen" && changedZones.delete(landmark.zoneId);
        const text = type === "stolen"
          ? `${landmark.name} berpindah tim.${flipped ? " Penguasaan zona berubah." : ""}`
          : `${landmark.name} ${type === "claimed" ? "diklaim" : "terkunci"}.`;
        publish(seats, {
          kind: type === "claimed" ? "claim" : type === "locked" ? "lock" : "steal",
          text, panel: "board", at, landmarkId, ...(flipped ? { zoneId: landmark.zoneId } : {}),
        }, seatId => type === "stolen" && phase === "active" && teamOf(seatId) === previousTeam);
      } else if (type === "challenge_failed" && landmarkId) {
        const landmark = match.landmarks[landmarkId];
        if (phase === "active" && landmark?.vulnerableAlertAt === at && landmark.ownerTeamId) {
          publish(seats.filter(seat => seat.teamId !== landmark.ownerTeamId), {
            kind: "vulnerable", text: `${landmarkById.get(landmarkId)?.name ?? "Landmark"} bisa direbut.`,
            panel: "board", at, landmarkId,
          });
        }
      } else if (type === "card_played" || type === "curse_cast" || type === "curse_cleared") {
        publish(seats.filter(seat => seat.seatId === event.seatId), {
          kind: "card", panel: "cards", text: "Efek kartu diterapkan.", at,
          ...(landmarkId ? { landmarkId } : {}),
        });
      } else if (type === "finished" || type === "abandoned" || type === "canceled") {
        if (match.startedAt !== null) {
          publish(seats, { kind: "round-complete", text: "Ronde selesai.", panel: "score", at });
        }
      }
    }
    for (const zoneId of changedZones) {
      const zone = zoneById.get(zoneId)!;
      const previous = zoneControllers.get(zoneId);
      publish(seats, {
        kind: "zone", panel: "score", text: `Penguasaan ${zone.name} berubah.`,
        at: match.events.at(-1)?.at ?? now, zoneId,
      }, seatId => phase === "active" && Boolean(previous) && teamOf(seatId) === previous);
    }
    for (const seat of seats) {
      const count = match.deck.handsBySeat[seat.seatId]?.length ?? 0;
      const prevCount = claimHands.get(seat.seatId) ?? 0;
      if (count !== prevCount) dirty = true;
      if (phase === "active" && count > prevCount) {
        publish([seat], { kind: "draw", text: "Kartu baru masuk ke tanganmu.", panel: "cards", at: now });
      }
      claimHands.set(seat.seatId, count);
    }
    const proofs = new Map(Object.values(match.activeAttemptsBySeat).flatMap(attempt => attempt?.pendingPhoto
      ? [[attempt.seatId, attempt.landmarkId] as const]
      : []));
    if (proofs.size !== claimProofs.size || [...proofs.entries()].some(([seatId, landmarkId]) => claimProofs.get(seatId) !== landmarkId)) {
      dirty = true;
    }
    if (phase === "active") {
      for (const [seatId, landmarkId] of claimProofs) {
        if (!proofs.has(seatId)) {
          publish(seats.filter(seat => seat.seatId === seatId), {
            kind: "proof", text: "Tinjauan bukti berakhir. Periksa status landmark.", panel: "board", at: now,
            landmarkId,
          });
        }
      }
    }
    for (const landmark of Object.values(match.landmarks)) {
      if ((claimOwners.get(landmark.landmarkId) ?? null) !== landmark.ownerTeamId) {
        dirty = true;
        break;
      }
    }
    claimProofs = proofs;
    claimEventCount = match.events.length;
    claimOwners = new Map(Object.values(match.landmarks).map(landmark => [landmark.landmarkId, landmark.ownerTeamId]));
    zoneControllers = new Map(zones.map(zone => [zone.zoneId, zone.controllerTeamId]));
    return dirty || publishedSinceCheck;
  }

  function viewClaim(room: ClaimEngineRoomView): RoomActivityFeed {
    const prompts: RoomActivityNotice[] = [];
    if (room.phase === "active") {
      const review = room.pendingRivalPhotoReviews.slice().sort((a, b) => a.autoApproveAt - b.autoApproveAt)[0];
      const curse = room.activeCurses.find(effect => effect.targetSeatId === room.seatId);
      if (review) {
        prompts.push({ id: `claim-review-${review.submittedAt}-${review.attemptOwnerSeatId}`,
          kind: "proof", text: "Ada bukti untuk ditinjau.", panel: "review", deadline: review.autoApproveAt });
      }
      if (curse && !curse.pendingPhoto) {
        prompts.push({ id: `claim-effect-${curse.castAt}`, kind: "curse", text: "Ada efek aktif. Lihat cara menyelesaikannya.", panel: "review",
          ...(curse.expiresAt === null ? {} : { deadline: curse.expiresAt }) });
      }
      if (room.ownClaimReward) {
        prompts.push({ id: `claim-reward-${room.ownClaimReward.offerId}`, kind: "draw",
          text: "Pilih satu kartu hadiah.", panel: "cards" });
      }
    }
    return view(room.seatId, nextPrompt(prompts));
  }

  function observeSeek(match: SeekEngineMatch, deck: SeekDeckEngineState, now: number): boolean {
    publishedSinceCheck = false;
    let dirty = false;
    const { seats, turnNumber: turn, phase } = match;
    const hiderId = activeHiderSeatId(match);
    const hiders = seats.filter(seat => seat.seatId === hiderId);
    const seekers = seats.filter(seat => seat.seatId !== hiderId);
    const answering = phase === "seeking";
    const newTurn = phase !== "lobby" && (turn !== seekTurn || seekPhase === "lobby");

    function noteQuestion(question: SeekEngineQuestion, questionTurn: number, formerHiderId: string | null, active: boolean, clueIndex?: number) {
      if (questionStates.get(question.id) === question.status) return;
      dirty = true;
      questionStates.set(question.id, question.status);
      if (question.status === "pending") {
        publish(hiders, { kind: "question", text: "Ada pertanyaan baru.", panel: "questions", at: question.askedAt, turn: questionTurn });
      } else if (question.status === "answered") {
        const photoClue = clueIndex !== undefined && question.family === "photo" && Boolean(question.photoId);
        publish(seats.filter(seat => seat.seatId !== formerHiderId), {
          kind: photoClue ? "photo-clue" : "answer",
          text: photoClue ? "Foto petunjuk sudah masuk." : "Jawaban sudah masuk. Lihat petunjuk.",
          panel: "clues", at: now, turn: questionTurn,
          ...(photoClue ? { clueIndex } : {}),
          ...(question.overlay ? { mapChange: true as const } : {}),
        }, () => active);
      } else {
        const text = question.status === "timeout" ? "Waktu jawab habis. Periksa pertanyaan." : "Pertanyaan ditutup.";
        publish(seats.filter(seat => seat.seatId === formerHiderId || seat.seatId === question.askedBySeatId), {
          kind: "question-closed", text, panel: "clues", at: question.status === "timeout" ? question.deadline : now, turn: questionTurn,
        }, seatId => active && question.status === "timeout" && seatId === question.askedBySeatId);
      }
    }

    if (completedTurns !== match.turns.length) dirty = true;
    for (const result of match.turns.slice(completedTurns)) {
      for (const clue of result.clues) noteQuestion(clue, result.turnNumber, result.hiderSeatId, false);
      publish(seats, { kind: "turn-complete", text: "Giliran selesai.", panel: "regroup", at: result.completedAt, turn: result.turnNumber });
    }
    completedTurns = match.turns.length;
    if (newTurn) {
      dirty = true;
      questionStates.clear();
      seekDrawKey = seekHandKey = seekCurseKey = "";
      if (!match.outcome) {
        publish(hiders, { kind: "role", text: "Giliranmu bersembunyi.", panel: "board", at: now, turn }, () => true);
        publish(seekers, { kind: "role", text: "Giliranmu mencari. Periksa waktu mulai.", panel: "board", at: now, turn }, () => true);
      }
    }
    if (phase !== seekPhase) dirty = true;
    if (phase === "seeking" && seekPhase !== phase) {
      publish(seekers, { kind: "release", text: "Waktu mencari dimulai.", panel: "board", at: match.releaseAt ?? now, turn }, () => true);
    }
    if (answering) {
      match.questions.forEach((question, index) => noteQuestion(question, turn, hiderId, true, index));
      const currentDraw = deck.activeDraw?.cards[0]?.instanceId ?? "";
      const currentHand = deck.hand.map(card => card.instanceId).join(":");
      const currentCurses = deck.activeCurses.map(curse => curse.curseInstanceId).join(":");
      if (currentDraw !== seekDrawKey || currentHand !== seekHandKey || currentCurses !== seekCurseKey) dirty = true;
      if (currentDraw && currentDraw !== seekDrawKey) {
        publish(hiders, { kind: "draw", text: "Pilih kartu untuk disimpan.", panel: "cards", at: now, turn });
      }
      if (currentHand && currentHand !== seekHandKey && !currentDraw) {
        publish(hiders, { kind: "card", text: "Tangan kartumu diperbarui.", panel: "cards", at: now, turn });
      }
      if (currentCurses && currentCurses !== seekCurseKey) {
        publish(seekers, { kind: "curse", text: "Ada efek aktif. Lihat cara menyelesaikannya.", panel: "board", at: now, turn }, () => true);
      }
      seekDrawKey = currentDraw;
      seekHandKey = currentHand;
      seekCurseKey = currentCurses;
    }
    if (match.outcome && match.startedAt !== null && seekPhase !== phase) {
      publish(seats, { kind: "round-complete", text: "Permainan selesai.", panel: "score", at: match.outcome.at });
    }
    if (phase !== "lobby") seekTurn = turn;
    seekPhase = phase;
    return dirty || publishedSinceCheck;
  }

  function viewSeek(room: SeekEngineRoomView, deck: SeekDeckPublicView | SeekDeckHiderView): RoomActivityFeed {
    const prompts: RoomActivityNotice[] = [];
    const turn = room.turnNumber;
    if (room.phase === "head_start" && room.role === "hider" && !room.ownAnchorStationId && room.phaseEndsAt !== null) {
      prompts.push({ id: `hide-${turn}`, kind: "role", text: "Pilih titik sembunyi sebelum pencarian dimulai.", panel: "board", deadline: room.phaseEndsAt });
    }
    if (room.phase === "seeking" && room.role === "hider") {
      const pending = room.questions.map((question, index) => ({ question, index }))
        .filter(({ question }) => question.status === "pending")
        .sort((a, b) => a.question.deadline - b.question.deadline);
      const next = pending[0];
      if (next) {
        const { question, index } = next;
        const nearDeadline = question.deadline - question.askedAt > reminderWindowMs && question.deadline - room.now <= reminderWindowMs;
        const text = nearDeadline ? "Waktu jawab hampir habis." : "Ada pertanyaan baru. Jawab sebelum waktu habis.";
        prompts.push({
          id: `question-${turn}-${index}${nearDeadline ? "-reminder" : ""}`, kind: "question",
          text: pending.length > 1 ? `${text} Ada ${pending.length - 1} pertanyaan lain.` : text,
          panel: "questions", deadline: question.deadline,
        });
      }
      const draw = (deck as SeekDeckHiderView).activeDraw;
      if (draw) prompts.push({ id: `draw-${turn}-${draw.deadline}`, kind: "draw",
        text: "Pilih kartu untuk disimpan.", panel: "cards", deadline: draw.deadline });
    }
    if (room.phase === "regroup" && room.phaseEndsAt !== null && !room.seats.find(seat => seat.seatId === room.seatId)?.regrouped) {
      prompts.push({ id: `regroup-${turn}`, kind: "turn-complete", text: "Buka titik kumpul untuk giliran berikutnya.", panel: "regroup", deadline: room.phaseEndsAt });
    }
    return view(room.seatId, nextPrompt(prompts));
  }

  function snapshot(): RoomActivitySnapshot {
    return {
      feeds: [...feeds.entries()].map(([seatId, feed]) => [
        seatId,
        { sequence: feed.sequence, events: feed.events.map(event => ({ ...event })) },
      ]),
      claimEventCount,
      claimOwners: [...claimOwners.entries()],
      zoneControllers: [...zoneControllers.entries()],
      claimHands: [...claimHands.entries()],
      claimProofs: [...claimProofs.entries()],
      seekTurn,
      seekPhase,
      completedTurns,
      seekDrawKey,
      seekHandKey,
      seekCurseKey,
      questionStates: [...questionStates.entries()],
    };
  }

  return { observeClaim, observeSeek, viewClaim, viewSeek, snapshot };
}

function nextPrompt(prompts: RoomActivityNotice[]): RoomActivityNotice | null {
  return prompts.sort((a, b) => (a.deadline ?? Infinity) - (b.deadline ?? Infinity))[0] ?? null;
}
