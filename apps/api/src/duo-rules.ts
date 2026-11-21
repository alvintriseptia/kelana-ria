import type { DuoAction, DuoReply, DuoRoom, DuoSeat, DuoZone, SoloCheckpoint, SoloEdition } from "@kelana-ria/contracts";
import { compactTrial, type SoloFixture } from "./solo-fixture.js";
import { verifyLocation } from "./solo-rules.js";
import type { ActionOutcome } from "./solo-rules.js";

type Member = Pick<DuoRoom, "startVerifiedUntil" | "visits" | "cooldowns"> & {
  credentialHash: string;
  ready: boolean;
};

export type DuoFixture = {
  edition: Omit<SoloEdition, "targets">;
  checkIn: SoloFixture["checkIn"];
  cooldownMs: number;
  tasks: SoloFixture["tasks"];
};

const compactDuoTrial: DuoFixture = {
  ...compactTrial,
  edition: {
    id: "compact-duo-trial-v1",
    board: compactTrial.edition.board,
    boardVersion: compactTrial.edition.boardVersion,
    format: compactTrial.edition.format,
    origin: compactTrial.edition.origin,
    durationMs: compactTrial.edition.durationMs,
    start: compactTrial.edition.start,
    checkpoints: compactTrial.edition.checkpoints,
  },
};

export type DuoRun = Pick<DuoRoom, "code" | "phase" | "startedAt" | "deadline" | "owners" | "outcome" | "events" | "paidPack"> & {
  fixture: DuoFixture;
  host: Member;
  guest: Member | null;
  paidPassId?: string;
};

export type DuoActionOutcome = ActionOutcome & { releasedSeat?: true };

export function newMember(credentialHash: string): Member {
  return { credentialHash, ready: false, startVerifiedUntil: null, visits: {}, cooldowns: {} };
}

export function newDuoRun(
  code: string,
  credentialHash: string,
  fixture: DuoFixture = compactDuoTrial,
  paid?: { passId: string; paidPack: NonNullable<DuoRoom["paidPack"]> },
): DuoRun {
  return {
    code,
    fixture,
    phase: "lobby",
    startedAt: null,
    deadline: null,
    owners: {},
    outcome: null,
    events: [],
    host: newMember(credentialHash),
    guest: null,
    ...(paid ? { paidPassId: paid.passId, paidPack: paid.paidPack } : {}),
  };
}

export function memberSeat(run: DuoRun, credentialHash: string): DuoSeat | undefined {
  if (!credentialHash) return undefined;
  if (run.host.credentialHash === credentialHash) return "host";
  if (run.guest?.credentialHash === credentialHash) return "guest";
  return undefined;
}

function memberAt(run: DuoRun, seat: DuoSeat): Member {
  const member = run[seat];
  if (!member) throw new Error("Duo seat is empty");
  return member;
}

function verified(member: Member, now: number) {
  return member.startVerifiedUntil !== null && member.startVerifiedUntil >= now;
}

function readyInLobby(member: Member | null, now: number) {
  return member !== null && member.ready && verified(member, now);
}

function score(checkpoints: SoloCheckpoint[], owners: DuoRoom["owners"]) {
  const landmarks = { host: 0, guest: 0 };
  const zoneCounts = new Map<string, Record<DuoSeat, number>>();
  for (const point of checkpoints) {
    const counts = zoneCounts.get(point.zone) ?? { host: 0, guest: 0 };
    const owner = owners[point.id];
    if (owner) {
      counts[owner]++;
      landmarks[owner]++;
    }
    zoneCounts.set(point.zone, counts);
  }
  const zones: DuoZone[] = Array.from(zoneCounts, ([name, { host, guest }]) => ({
    name,
    host,
    guest,
    owner: leader(host, guest),
  }));
  return { landmarks, zones };
}

function leader(host: number, guest: number): DuoSeat | null {
  if (host === guest) return null;
  return host > guest ? "host" : "guest";
}

export function decideWinner(zones: DuoZone[], landmarks: DuoRoom["landmarks"]) {
  const control = { host: 0, guest: 0 };
  for (const zone of zones) {
    if (zone.owner) control[zone.owner]++;
  }
  return leader(control.host, control.guest) ?? leader(landmarks.host, landmarks.guest);
}

function finish(run: DuoRun, at: number, reason: "time" | "all-claimed" | "forfeit", forfeitingSeat?: DuoSeat) {
  const { zones, landmarks } = score(run.fixture.edition.checkpoints, run.owners);
  const winner = forfeitingSeat
    ? (run.guest ? (forfeitingSeat === "host" ? "guest" : "host") : null)
    : decideWinner(zones, landmarks);
  run.phase = "finished";
  run.outcome = { winner, reason };
  run.events.push(forfeitingSeat ? { type: "finished", at, seat: forfeitingSeat } : { type: "finished", at });
}

export function expireDuo(run: DuoRun, now: number) {
  if (run.phase !== "active" || run.deadline === null || now < run.deadline) return false;
  finish(run, run.deadline, "time");
  return true;
}

export function viewDuo(run: DuoRun, seat: DuoSeat, now: number, result: ActionOutcome = {}): DuoReply {
  const member = memberAt(run, seat);
  const { edition } = run.fixture;
  const { code, phase, startedAt, deadline, owners, events, outcome, paidPack } = run;
  const { error, distanceMeters, challengeCheckpointId } = result;
  const canOpen = challengeCheckpointId && !openDuoChallenge(run, seat, challengeCheckpointId).error;
  return {
    room: {
      code, phase, startedAt, deadline, owners, events, outcome, seat, edition, now,
      ...score(edition.checkpoints, owners),
      seats: {
        host: { joined: run.host.credentialHash !== "", ready: phase === "lobby" ? readyInLobby(run.host, now) : run.host.ready },
        guest: { joined: run.guest !== null, ready: phase === "lobby" ? readyInLobby(run.guest, now) : (run.guest?.ready ?? false) },
      },
      startVerifiedUntil: member.startVerifiedUntil,
      visits: member.visits,
      cooldowns: member.cooldowns,
      ...(paidPack ? { paidPack } : {}),
    },
    error,
    distanceMeters,
    challenge: canOpen && challengeCheckpointId ? run.fixture.tasks[challengeCheckpointId].challenge : undefined,
  };
}

function openCheckpoint(run: DuoRun, checkpointId: string) {
  // Return the committed owner even when this landmark filled the last open spot in the room.
  if (Object.hasOwn(run.owners, checkpointId)) return "already-claimed";
  if (run.phase !== "active") return "round-finished";
  return run.fixture.edition.checkpoints.find((point) => point.id === checkpointId) ?? "unknown-checkpoint";
}

export function openDuoChallenge(run: DuoRun, seat: DuoSeat, checkpointId: string): ActionOutcome {
  const point = openCheckpoint(run, checkpointId);
  if (typeof point === "string") return { error: point };
  if (memberAt(run, seat).visits[checkpointId] === undefined) return { error: "visit-required" };
  return { challengeCheckpointId: checkpointId };
}

export function applyDuo(run: DuoRun, seat: DuoSeat, action: DuoAction, now: number): DuoActionOutcome {
  const member = memberAt(run, seat);
  const { edition, checkIn, tasks, cooldownMs } = run.fixture;

  if (action.type === "start") {
    if (seat !== "host") return { error: "host-only" };
    if (run.startedAt !== null) return {};
    if (run.phase !== "lobby") return { error: "round-finished" };
    const soloPaid = run.paidPack?.players === 1;
    if (!readyInLobby(run.host, now) || (!soloPaid && !readyInLobby(run.guest, now))) {
      return { error: "players-not-ready" };
    }
    run.startedAt = now;
    run.deadline = now + edition.durationMs;
    run.phase = "active";
    run.events.push({ type: "started", at: now });
    return {};
  }

  if (action.type === "leave") {
    if (run.phase !== "lobby" && run.phase !== "active") return { error: "round-finished" };
    if (run.phase !== action.phase) return { error: "room-phase-changed" };
    if (run.phase === "active") {
      finish(run, now, "forfeit", seat);
      return {};
    }
    if (seat === "guest") {
      run.guest = null;
      run.host.ready = false;
      return { releasedSeat: true };
    }
    run.phase = "canceled";
    run.outcome = { winner: null, reason: "canceled" };
    run.events.push({ type: "canceled", at: now, seat });
    return {};
  }

  if (action.type === "ready") {
    if (run.phase !== "lobby") return { error: "round-finished" };
    if (action.ready && !verified(member, now)) return { error: "start-unverified" };
    member.ready = action.ready;
    return {};
  }

  if (action.type === "check-in" && run.phase === "lobby" && action.checkpointId === edition.start.id) {
    const result = verifyLocation(edition.start, action.fix, now, checkIn);
    if (!result.error) {
      if (!verified(member, now)) member.ready = false;
      member.startVerifiedUntil = Math.max(member.startVerifiedUntil ?? 0, action.fix.timestamp + checkIn.maxAgeMs);
    }
    return result;
  }

  const point = openCheckpoint(run, action.checkpointId);
  if (typeof point === "string") return { error: point };

  if (action.type === "check-in") {
    const result = verifyLocation(point, action.fix, now, checkIn);
    if (result.error) return result;
    member.visits[point.id] = Math.max(member.visits[point.id] ?? 0, action.fix.timestamp + checkIn.maxAgeMs);
    return { ...result, challengeCheckpointId: point.id };
  }

  const visitUntil = member.visits[point.id];
  if (visitUntil === undefined) return { error: "visit-required" };
  if ((member.cooldowns[point.id] ?? 0) > now) return { error: "cooldown" };
  const task = tasks[point.id];
  if (!task.challenge.choices.some(({ id }) => id === action.choiceId)) return { error: "invalid-choice" };
  if (visitUntil < now && !action.fix) return { error: "fresh-fix-required" };
  if (action.fix) {
    const result = verifyLocation(point, action.fix, now, checkIn);
    if (result.error) return result;
    member.visits[point.id] = Math.max(visitUntil, action.fix.timestamp + checkIn.maxAgeMs);
  }

  if (action.choiceId !== task.correctChoiceId) {
    member.cooldowns[point.id] = now + cooldownMs;
    return { error: "wrong-answer" };
  }
  delete member.cooldowns[point.id];
  run.owners[point.id] = seat;
  run.events.push({ type: "claimed", at: now, seat, checkpointId: point.id });
  if (Object.keys(run.owners).length === edition.checkpoints.length) finish(run, now, "all-claimed");
  return {};
}
