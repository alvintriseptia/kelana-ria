import type { DuoSeat, SeekAction, SeekPhase, SeekReply, SeekRoom, SoloPoint } from "@kelana-ria/contracts";
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
};

export type SeekActionOutcome = Omit<SeekReply, "room"> & { releasedSeat?: true };

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
    ruledOut: [],
    turns: [],
    outcome: null,
  };
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
}

function completeTurn(run: SeekRun, reason: "found" | "timeout", at: number) {
  const hider = hiderFor(run);
  if (!hider || !run.lock || run.releaseAt === null) throw new Error("Seeking turn has no valid lock");
  const result = {
    turn: run.turn,
    hider,
    checkpointId: run.lock.checkpointId,
    hidingMs: at - run.releaseAt,
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
  const winner = first.hidingMs === result.hidingMs ? null : first.hidingMs > result.hidingMs ? first.hider : result.hider;
  closeMatch(run, "finished", "scored", at, winner);
}

export function expireSeek(run: SeekRun, now: number) {
  let changed = false;
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
  } else {
    member.regrouped = true;
    if (run.host.regrouped && run.guest?.regrouped) {
      run.turn = 2;
      beginTurn(run, now);
    }
  }
  return location;
}

export function applySeek(run: SeekRun, seat: DuoSeat, action: SeekAction, now: number): SeekActionOutcome {
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

  const locking = action.type === "lock";
  if (run.phase !== (locking ? "head-start" : "seeking")) return { error: "room-phase-changed" };
  if (locking) {
    if (seat !== hiderFor(run)) return { error: "hider-only" };
    if (run.lock) return { error: "already-locked" };
  } else {
    if (seat === hiderFor(run)) return { error: "seeker-only" };
    if (!run.seekerVerified) return { error: "start-unverified" };
  }

  const point = run.fixture.edition.checkpoints.find(({ id }) => id === action.checkpointId);
  if (!point) return { error: "unknown-checkpoint" };
  const location = verifyLocation(point, action.fix, now, run.fixture.checkIn);
  if (location.error) return location;
  if (locking) {
    run.lock = { checkpointId: point.id, at: now };
    return location;
  }
  if (run.lock?.checkpointId === point.id) {
    completeTurn(run, "found", now);
    return { ...location, investigation: "found" };
  }
  if (!run.ruledOut.includes(point.id)) run.ruledOut.push(point.id);
  return { ...location, investigation: "miss" };
}
