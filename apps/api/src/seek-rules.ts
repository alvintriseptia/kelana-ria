import type { DuoSeat, SeekAction, SeekClueView, SeekPhase, SeekQuestion, SeekReply, SeekRoom, SoloPoint } from "@kelana-ria/contracts";
import {
  compactClueBoard, expireSeekQuestion, newSeekClueState, recordSeekReference, seekClueMenu, seekObjectiveAnswer,
  seekQuestionRequest, seekWalkingComparison, type ClueBoard, type SeekClueState,
} from "./seek-clues.js";
import { autoKeepSeekDraw, chooseSeekCards, discardHeldCards, drawSeekCards, seekCardEffectMs } from "./seek-deck.js";
import { compactTrial } from "./solo-fixture.js";
import { verifyLocation } from "./solo-rules.js";

const minute = 60_000;
const compactSeekTrial = {
  edition: {
    id: "compact-seek-trial-v1",
    start: compactTrial.edition.start,
    checkpoints: compactTrial.edition.checkpoints.map(({ id, name, latitude, longitude, x, y }): SoloPoint =>
      ({ id, name, latitude, longitude, x, y })),
    headStartMs: 30 * minute,
    searchMs: 60 * minute,
    regroupMs: 30 * minute,
  },
  checkIn: compactTrial.checkIn,
};

type Member = {
  credentialHash: string;
  ready: boolean;
  startVerifiedUntil: number | null;
  regrouped: boolean;
};

export type SeekRun = Pick<SeekRoom,
  "code" | "phase" | "turn" | "firstHider" | "roleRevision" | "startedAt" | "releaseAt" | "phaseEndsAt" | "ruledOut" | "turns" | "outcome"
> & {
  fixture: typeof compactSeekTrial;
  host: Member;
  guest: Member | null;
  lock: { checkpointId: string; at: number } | null;
  seekerVerified: boolean;
  clueBoard: ClueBoard;
  clueState: SeekClueState;
};

export type SeekActionOutcome = Omit<SeekReply, "room"> & { releasedSeat?: true; acceptedPhotoId?: string };

export function newSeekMember(credentialHash: string): Member {
  return { credentialHash, ready: false, startVerifiedUntil: null, regrouped: false };
}

export function newSeekRun(code: string, credentialHash: string): SeekRun {
  return {
    code,
    fixture: compactSeekTrial,
    phase: "lobby",
    turn: 1,
    firstHider: null,
    roleRevision: 0,
    startedAt: null,
    releaseAt: null,
    phaseEndsAt: null,
    host: newSeekMember(credentialHash),
    guest: null,
    lock: null,
    seekerVerified: false,
    clueBoard: compactClueBoard(compactSeekTrial.edition.start, compactSeekTrial.edition.checkpoints),
    clueState: newSeekClueState(),
    ruledOut: [],
    turns: [],
    outcome: null,
  };
}

export function hydrateSeek(run: SeekRun) {
  if (run.clueBoard && run.clueState) return false;
  const { start, checkpoints } = run.fixture.edition;
  run.clueBoard ??= compactClueBoard(start, checkpoints);
  if (!run.clueState) {
    run.clueState = newSeekClueState();
    if (run.seekerVerified) recordSeekReference(run.clueState, start.id);
  }
  return true;
}

export function seekMemberSeat(run: SeekRun, credentialHash: string): DuoSeat | undefined {
  if (run.host.credentialHash === credentialHash) return "host";
  if (run.guest?.credentialHash === credentialHash) return "guest";
  return undefined;
}

function otherSeat(seat: DuoSeat): DuoSeat {
  return seat === "host" ? "guest" : "host";
}

function hiderFor(run: SeekRun): DuoSeat | null {
  return run.firstHider && run.turn === 2 ? otherSeat(run.firstHider) : run.firstHider;
}

function verified(member: Member, now: number) {
  return member.startVerifiedUntil !== null && member.startVerifiedUntil >= now;
}

function readyInLobby(member: Member | null, now: number) {
  return member !== null && member.ready && verified(member, now);
}

function beginTurn(run: SeekRun, at: number) {
  run.phase = "head-start";
  run.releaseAt = at + run.fixture.edition.headStartMs;
  run.phaseEndsAt = run.releaseAt;
  run.lock = null;
  run.seekerVerified = false;
  run.clueState = newSeekClueState();
  run.ruledOut = [];
  run.host.regrouped = false;
  if (run.guest) run.guest.regrouped = false;
}

function closeMatch(
  run: SeekRun,
  phase: Extract<SeekPhase, "finished" | "void" | "incomplete" | "canceled">,
  reason: NonNullable<SeekRoom["outcome"]>["reason"],
  at: number,
  winner: DuoSeat | null = null,
) {
  run.phase = phase;
  run.phaseEndsAt = null;
  run.outcome = { winner, reason, at };
  run.clueState.delayUntil = null;
  for (const question of run.clueState.questions) {
    if (question.status === "pending") question.status = "closed";
    delete question.photoId;
  }
  for (const turn of run.turns) {
    for (const question of turn.clues ?? []) delete question.photoId;
  }
  delete run.clueState.deck.draw;
}

function completeTurn(run: SeekRun, reason: "found" | "timeout", at: number) {
  const hider = hiderFor(run);
  if (!hider || !run.lock || run.releaseAt === null) throw new Error("Seeking turn has no valid lock");
  const { deck, questions } = run.clueState;
  autoKeepSeekDraw(deck);
  const pending = questions.find(({ status }) => status === "pending");
  if (pending) pending.status = "closed";
  run.clueState.delayUntil = null;
  const hidingMs = at - run.releaseAt;
  const bonusMs = deck.hand.filter(({ kind }) => kind === "time-bonus").length * seekCardEffectMs;
  const result = {
    turn: run.turn,
    hider,
    checkpointId: run.lock.checkpointId,
    hidingMs,
    bonusMs,
    adjustedMs: hidingMs + bonusMs,
    ...(questions.length ? { clues: questions.map(({ choices, ...question }) => question) } : {}),
    reason,
    at,
  };
  run.turns.push(result);
  run.lock = null;
  run.seekerVerified = false;
  run.ruledOut = [];
  if (run.turn === 1) {
    run.phase = "regroup";
    run.phaseEndsAt = at + run.fixture.edition.regroupMs;
    return;
  }

  const first = run.turns[0];
  const firstScore = first.adjustedMs ?? first.hidingMs;
  const winner = firstScore === result.adjustedMs ? null : firstScore > result.adjustedMs ? first.hider : result.hider;
  closeMatch(run, "finished", "scored", at, winner);
}

function expireClues(run: SeekRun, now: number) {
  if (run.phase !== "seeking" || !run.lock || run.phaseEndsAt === null) return false;
  // The search deadline wins when it coincides with a response deadline.
  const through = Math.min(now, run.phaseEndsAt - 1);
  const { clueState, clueBoard } = run;
  let changed = expireSeekQuestion(clueBoard, clueState, run.lock.checkpointId, through);
  if (clueState.deck.draw && clueState.deck.draw.deadline <= through) {
    autoKeepSeekDraw(clueState.deck);
    changed = true;
  }
  if (clueState.delayUntil !== null && clueState.delayUntil <= through) {
    clueState.delayUntil = null;
    changed = true;
  }
  return changed;
}

export function expireSeek(run: SeekRun, now: number) {
  let changed = expireClues(run, now);
  while (run.phaseEndsAt !== null && now >= run.phaseEndsAt) {
    const at = run.phaseEndsAt;
    switch (run.phase) {
      case "head-start":
        if (run.lock === null) {
          closeMatch(run, "void", "missed-lock", at);
        } else {
          run.phase = "seeking";
          run.phaseEndsAt = at + run.fixture.edition.searchMs;
        }
        break;
      case "seeking":
        completeTurn(run, "timeout", at);
        break;
      case "regroup":
        closeMatch(run, "incomplete", "regroup-timeout", at);
        break;
      default:
        throw new Error("Seek room has an unexpected deadline");
    }
    changed = true;
  }
  return changed;
}

function viewClues(run: SeekRun, seat: DuoSeat): SeekClueView | undefined {
  const { clueBoard, clueState, phase } = run;
  const { branches, distanceSource, equalToleranceMeters, landmarks } = clueBoard;
  const { questions, delayUntil, referenceId, previousReferenceId, deck } = clueState;
  const hasArchivedHistory = run.outcome && run.turns.some(turn => turn.clues?.length);
  if (phase !== "seeking" && phase !== "regroup" && questions.length === 0 && !hasArchivedHistory) return undefined;
  const isHider = seat === hiderFor(run);
  const seeking = phase === "seeking";
  const target = seeking && isHider ? run.lock?.checkpointId : undefined;
  return {
    branches, distanceSource, equalToleranceMeters, landmarks, delayUntil,
    questions: questions.map(({ choices, ...question }) => ({
      ...question,
      ...(target && question.status === "pending" ? {
        choices, walkingComparison: seekWalkingComparison(clueBoard, question, target),
      } : {}),
    })),
    menu: seeking && !isHider ? seekClueMenu(clueBoard, clueState) : [],
    ...(seeking && !isHider ? { referenceId, previousReferenceId } : {}),
    ...(seeking && isHider ? { hand: deck.hand, draw: deck.draw } : {}),
  };
}

export function viewSeek(run: SeekRun, seat: DuoSeat, now: number, action: SeekActionOutcome = {}): SeekReply {
  const { code, phase, turn, firstHider, roleRevision, startedAt, releaseAt, phaseEndsAt, turns, outcome } = run;
  const hider = hiderFor(run);
  const member = run[seat];
  if (!member) throw new Error("Seek seat is empty");

  function viewSeat(other: Member | null) {
    return {
      joined: other !== null,
      ready: phase === "lobby" ? readyInLobby(other, now) : other?.ready ?? false,
      regrouped: other?.regrouped ?? false,
    };
  }

  const isSeeker = phase === "seeking" && seat !== hider;
  const ownLock = (phase === "head-start" || phase === "seeking") && seat === hider
    ? run.lock?.checkpointId
    : undefined;
  const { error, distanceMeters, investigation } = action;
  return {
    room: {
      code, seat, now, edition: run.fixture.edition, phase, turn, firstHider, roleRevision, hider, startedAt, releaseAt, phaseEndsAt,
      startVerifiedUntil: phase === "lobby" ? member.startVerifiedUntil : null,
      seats: { host: viewSeat(run.host), guest: viewSeat(run.guest) },
      canInvestigate: isSeeker && run.seekerVerified,
      ruledOut: isSeeker ? run.ruledOut : [],
      clues: viewClues(run, seat),
      ...(ownLock === undefined ? {} : { ownLock }),
      turns, outcome,
    },
    error, distanceMeters, investigation,
  };
}

function checkIn(run: SeekRun, seat: DuoSeat, member: Member, action: Extract<SeekAction, { type: "check-in" }>, now: number): SeekActionOutcome {
  const { phase, fix } = action;
  if (run.phase !== phase) return { error: "room-phase-changed" };
  if (phase === "seeking" && seat === hiderFor(run)) return { error: "seeker-only" };
  if (phase === "seeking" && run.seekerVerified) return {};
  if (phase === "regroup" && member.regrouped) return {};

  const location = verifyLocation(run.fixture.edition.start, fix, now, run.fixture.checkIn);
  if (location.error) return location;
  if (phase === "lobby") {
    if (!verified(member, now)) member.ready = false;
    member.startVerifiedUntil = Math.max(member.startVerifiedUntil ?? 0, fix.timestamp + run.fixture.checkIn.maxAgeMs);
  } else if (phase === "seeking") {
    run.seekerVerified = true;
    recordSeekReference(run.clueState, run.fixture.edition.start.id);
  } else {
    member.regrouped = true;
    if (run.host.regrouped && run.guest?.regrouped) {
      run.turn = 2;
      beginTurn(run, now);
    }
  }
  return location;
}

function openHiderQuestion(run: SeekRun, seat: DuoSeat, turn: SeekRoom["turn"], questionId: string):
  { question: SeekQuestion } | { error: string } {
  if (run.outcome) return { error: "round-finished" };
  if (run.turn !== turn) return { error: "turn-changed" };
  if (run.phase !== "seeking") return { error: "room-phase-changed" };
  if (seat !== hiderFor(run)) return { error: "hider-only" };
  const question = run.clueState.questions.find(({ id, status }) => id === questionId && status === "pending");
  return question ? { question } : { error: "question-closed" };
}

export function validateSeekPhoto(run: SeekRun, seat: DuoSeat, action: Extract<SeekAction, { type: "answer-question" }>) {
  const request = openHiderQuestion(run, seat, action.turn, action.questionId);
  if ("error" in request) return request.error;
  return request.question.family === "photo" && action.choiceId === undefined ? undefined : "invalid-clue-input";
}

function answerSeekQuestion(
  run: SeekRun, seat: DuoSeat, action: Extract<SeekAction, { type: "answer-question" | "photo-unavailable" }>,
  now: number, validPhoto: boolean,
): SeekActionOutcome {
  const request = openHiderQuestion(run, seat, action.turn, action.questionId);
  if ("error" in request) return request;
  const { question } = request;
  const target = run.lock!.checkpointId;
  if (action.type === "photo-unavailable") {
    if (question.family !== "photo") return { error: "invalid-clue-input" };
    question.answer = seekObjectiveAnswer(run.clueBoard, question, target).label;
    question.status = "substituted";
    return {};
  }
  if (question.family === "photo") {
    if (!validPhoto) return { error: "invalid-photo" };
    question.photoId = question.id;
  } else {
    if (action.photo !== undefined || !question.choices?.some(({ id }) => id === action.choiceId)) {
      return { error: "invalid-clue-input" };
    }
    const expected = seekObjectiveAnswer(run.clueBoard, question, target);
    if (action.choiceId !== expected.id) return { error: "incorrect-clue-answer" };
    question.answer = expected.label;
  }
  question.status = "answered";
  const { deck } = run.clueState;
  autoKeepSeekDraw(deck);
  drawSeekCards(deck, question.drawCount, question.keepCount, now, run.phaseEndsAt!);
  return { acceptedPhotoId: question.photoId };
}

function playSeekCard(run: SeekRun, state: SeekClueState, action: Extract<SeekAction, { type: "play-card" }>, now: number) {
  const { deck } = state;
  if (state.questions.some(({ status }) => status === "pending")) return { error: "clue-pending" };
  if (deck.draw) return { error: "draw-pending" };
  const card = deck.hand.find(({ id }) => id === action.cardId);
  if (!card || card.kind === "time-bonus") return { error: "card-not-playable" };
  if (card.kind === "question-delay") {
    if (action.discardId !== undefined) return { error: "invalid-card-discard" };
    if (state.delayUntil !== null) return { error: "question-delayed" };
    discardHeldCards(deck, [card.id]);
    state.delayUntil = now + seekCardEffectMs;
    return {};
  }
  const discard = deck.hand.find(({ id }) => id === action.discardId && id !== card.id);
  if (!discard) return { error: "invalid-card-discard" };
  discardHeldCards(deck, [card.id, discard.id]);
  drawSeekCards(deck, 2, 1, now, run.phaseEndsAt!);
  return {};
}

export function applySeek(run: SeekRun, seat: DuoSeat, action: SeekAction, now: number, validPhoto = false): SeekActionOutcome {
  const member = run[seat];
  if (!member) throw new Error("Seek seat is empty");

  if (action.type === "start") {
    if (seat !== "host") return { error: "host-only" };
    if (run.startedAt !== null) return {};
    if (run.phase !== "lobby") return { error: "round-finished" };
    if (!run.firstHider || !readyInLobby(run.host, now) || !readyInLobby(run.guest, now)) {
      return { error: "players-not-ready" };
    }
    run.startedAt = now;
    beginTurn(run, now);
    return {};
  }

  if (run.outcome) return { error: "round-finished" };

  if (action.type === "leave") {
    const inLobby = run.phase === "lobby";
    if (inLobby !== (action.phase === "lobby")) return { error: "room-phase-changed" };
    // Consent to forfeit applies to the match across active phases and turns.
    if (!inLobby) {
      closeMatch(run, "finished", "forfeit", now, otherSeat(seat));
    } else if (run.turn !== action.turn) {
      return { error: "turn-changed" };
    } else if (seat === "guest") {
      run.guest = null;
      run.host.ready = false;
      return { releasedSeat: true };
    } else {
      closeMatch(run, "canceled", "canceled", now);
    }
    return {};
  }

  if ("turn" in action && run.turn !== action.turn) return { error: "turn-changed" };

  if (action.type === "assign") {
    if (seat !== "host") return { error: "host-only" };
    if (run.phase !== "lobby") return { error: "room-phase-changed" };
    if (run.firstHider !== action.hider) {
      run.firstHider = action.hider;
      run.roleRevision++;
      run.host.ready = false;
      if (run.guest) run.guest.ready = false;
    }
    return {};
  }

  if (action.type === "ready") {
    if (run.phase !== "lobby") return { error: "room-phase-changed" };
    if (action.ready && !run.firstHider) return { error: "roles-unassigned" };
    if (action.ready && action.roleRevision !== run.roleRevision) return { error: "roles-changed" };
    if (action.ready && !verified(member, now)) return { error: "start-unverified" };
    member.ready = action.ready;
    return {};
  }

  if (action.type === "check-in") return checkIn(run, seat, member, action, now);

  if (action.type === "answer-question" || action.type === "photo-unavailable") {
    return answerSeekQuestion(run, seat, action, now, validPhoto);
  }
  const { clueState } = run;
  if (action.type === "ask") {
    if (run.phase !== "seeking") return { error: "room-phase-changed" };
    if (seat === hiderFor(run)) return { error: "seeker-only" };
    if (!run.seekerVerified) return { error: "start-unverified" };
    if ((action.referenceId !== undefined && action.referenceId !== clueState.referenceId) ||
        (action.previousReferenceId !== undefined && action.previousReferenceId !== clueState.previousReferenceId)) {
      return { error: "clue-reference-changed" };
    }
    return seekQuestionRequest(run.clueBoard, clueState, action.family, action, now, run.phaseEndsAt!);
  }
  if (action.type === "choose-cards" || action.type === "play-card") {
    if (run.phase !== "seeking") return { error: "room-phase-changed" };
    if (seat !== hiderFor(run)) return { error: "hider-only" };
    if (action.type === "play-card") return playSeekCard(run, clueState, action, now);
    return chooseSeekCards(clueState.deck, action.cardIds, action.discardIds) ? {} : { error: "invalid-card-choice" };
  }

  const locking = action.type === "lock";
  if (run.phase !== (locking ? "head-start" : "seeking")) return { error: "room-phase-changed" };
  if (locking) {
    if (seat !== hiderFor(run)) return { error: "hider-only" };
    if (run.lock) return { error: "already-locked" };
  } else {
    if (seat === hiderFor(run)) return { error: "seeker-only" };
    if (!run.seekerVerified) return { error: "start-unverified" };
  }

  const { start, checkpoints } = run.fixture.edition;
  const point = action.type === "reference" && action.checkpointId === start.id
    ? start
    : checkpoints.find(({ id }) => id === action.checkpointId);
  if (!point) return { error: "unknown-checkpoint" };
  const location = verifyLocation(point, action.fix, now, run.fixture.checkIn);
  if (location.error) return location;
  if (locking) {
    run.lock = { checkpointId: point.id, at: now };
    return location;
  }
  recordSeekReference(clueState, point.id);
  if (action.type === "reference") return location;
  if (run.lock?.checkpointId === point.id) {
    completeTurn(run, "found", now);
    return { ...location, investigation: "found" };
  }
  if (!run.ruledOut.includes(point.id)) run.ruledOut.push(point.id);
  return { ...location, investigation: "miss" };
}
