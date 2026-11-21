import { randomUUID } from "node:crypto";
import type { LocationFix, SoloAction, SoloPoint, SoloReply, SoloSession } from "@kelana-ria/contracts";
import type { SoloFixture } from "./solo-fixture.js";

export type SoloRun = {
  state: Omit<SoloSession, "edition" | "now">;
  fixture: SoloFixture;
};

export type ActionOutcome = {
  error?: string;
  challengeCheckpointId?: string;
  distanceMeters?: number;
  closedCheckpointId?: string;
};

export function newRun(fixture: SoloFixture): SoloRun {
  return {
    fixture,
    state: {
      id: randomUUID(),
      phase: "briefing",
      startVerifiedUntil: null,
      startedAt: null,
      deadline: null,
      claimed: [],
      zones: [],
      events: [],
      visits: {},
      cooldowns: {},
    },
  };
}

export function expire({ state }: SoloRun, now: number) {
  if (state.phase === "active" && state.deadline !== null && state.deadline <= now) {
    state.phase = "lost";
    state.events.push({ type: "expired", at: state.deadline });
    return true;
  }
  return false;
}

export function view({ state, fixture }: SoloRun, now: number, outcome: ActionOutcome = {}): SoloReply {
  const { error, distanceMeters, challengeCheckpointId, closedCheckpointId } = outcome;
  const canViewChallenge = challengeCheckpointId && state.phase === "active" && !state.claimed.includes(challengeCheckpointId);
  return {
    session: { ...state, edition: fixture.edition, now },
    error,
    distanceMeters,
    closedCheckpointId,
    challenge: canViewChallenge ? fixture.tasks[challengeCheckpointId].challenge : undefined,
  };
}

export function distanceBetween(point: Pick<SoloPoint, "latitude" | "longitude">, fix: Pick<LocationFix, "latitude" | "longitude">) {
  const radians = Math.PI / 180;
  const latitudeDifference = (fix.latitude - point.latitude) * radians;
  const longitudeDifference = (fix.longitude - point.longitude) * radians;
  const a = Math.sin(latitudeDifference / 2) ** 2
    + Math.cos(point.latitude * radians) * Math.cos(fix.latitude * radians) * Math.sin(longitudeDifference / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.sqrt(Math.min(1, a)));
}

export function verifyLocation(point: SoloPoint, fix: LocationFix, now: number, rules: SoloFixture["checkIn"]): ActionOutcome {
  const { latitude, longitude, accuracy, timestamp } = fix;
  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180 || accuracy < 0 || timestamp < 0) {
    return { error: "invalid-fix" };
  }
  if (timestamp > now || now - timestamp > rules.maxAgeMs) return { error: "stale-fix" };
  if (accuracy > rules.maxAccuracyMeters) return { error: "inaccurate-fix" };
  const distance = distanceBetween(point, fix);
  const distanceMeters = Math.round(distance * 10) / 10;
  return distance > rules.radiusMeters ? { error: "outside-radius", distanceMeters } : { distanceMeters };
}

export function openChallenge({ state, fixture }: SoloRun, checkpointId: string): ActionOutcome {
  if (!fixture.edition.checkpoints.some((point) => point.id === checkpointId)) return { error: "unknown-checkpoint" };
  if (state.phase !== "active") return { error: "round-finished" };
  if (state.claimed.includes(checkpointId)) return { error: "already-claimed" };
  if (state.visits[checkpointId] === undefined) return { error: "visit-required" };
  return { challengeCheckpointId: checkpointId };
}

export function apply(
  run: SoloRun,
  action: Exclude<SoloAction, { type: "replay" }>,
  now: number,
  closedCheckpoints?: ReadonlySet<string>,
): ActionOutcome {
  const { state, fixture } = run;
  const { edition, checkIn } = fixture;
  if (action.type === "start") {
    if (state.startedAt !== null) return {};
    if (state.phase !== "briefing") return { error: "round-finished" };
    if (closedCheckpoints) {
      const closedPoint = edition.checkpoints.find((point) => closedCheckpoints.has(point.id));
      if (closedPoint) {
        return { error: "checkpoint-closed", closedCheckpointId: closedPoint.id };
      }
    }
    if (state.startVerifiedUntil === null || now > state.startVerifiedUntil) return { error: "start-unverified" };
    state.startedAt = now;
    state.deadline = now + edition.durationMs;
    state.phase = "active";
    state.events.push({ type: "started", at: now });
    return {};
  }

  if (action.type === "abandon") {
    if (state.phase !== "active" && state.phase !== "briefing") return { error: "round-finished" };
    state.phase = "abandoned";
    state.events.push({ type: "abandoned", at: now });
    return {};
  }

  if (action.type === "check-in" && action.checkpointId === edition.start.id && state.phase === "briefing") {
    if (closedCheckpoints) {
      const closedPoint = edition.checkpoints.find((point) => closedCheckpoints.has(point.id));
      if (closedPoint) {
        return { error: "checkpoint-closed", closedCheckpointId: closedPoint.id };
      }
    }
    const outcome = verifyLocation(edition.start, action.fix, now, checkIn);
    if (!outcome.error) {
      state.startVerifiedUntil = Math.max(state.startVerifiedUntil ?? 0, action.fix.timestamp + checkIn.maxAgeMs);
    }
    return outcome;
  }
  if (state.phase !== "active") return { error: "round-finished" };
  const point = edition.checkpoints.find(({ id }) => id === action.checkpointId);
  if (!point) return { error: "unknown-checkpoint" };
  if (state.claimed.includes(point.id)) return { error: "already-claimed" };

  if (action.type === "check-in") {
    const outcome = verifyLocation(point, action.fix, now, checkIn);
    if (outcome.error) return outcome;
    state.visits[point.id] = Math.max(state.visits[point.id] ?? 0, action.fix.timestamp + checkIn.maxAgeMs);
    return { ...outcome, challengeCheckpointId: point.id };
  }

  const visitUntil = state.visits[point.id];
  if (visitUntil === undefined) return { error: "visit-required" };
  if ((state.cooldowns[point.id] ?? 0) > now) return { error: "cooldown" };
  const task = fixture.tasks[point.id];
  if (!task.challenge.choices.some(({ id }) => id === action.choiceId)) return { error: "invalid-choice" };
  if (visitUntil < now && !action.fix) return { error: "fresh-fix-required" };
  if (action.fix) {
    const outcome = verifyLocation(point, action.fix, now, checkIn);
    if (outcome.error) return outcome;
    state.visits[point.id] = Math.max(visitUntil, action.fix.timestamp + checkIn.maxAgeMs);
  }

  if (action.choiceId !== task.correctChoiceId) {
    state.cooldowns[point.id] = now + fixture.cooldownMs;
    return { error: "wrong-answer" };
  }
  delete state.cooldowns[point.id];
  state.claimed.push(point.id);
  if (!state.zones.includes(point.zone)) state.zones.push(point.zone);
  state.events.push({ type: "claimed", at: now, checkpointId: point.id });
  if (state.claimed.length >= edition.targets.landmarks && state.zones.length >= edition.targets.zones) {
    state.phase = "won";
    state.events.push({ type: "won", at: now });
  }
  return {};
}
