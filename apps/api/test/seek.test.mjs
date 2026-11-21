import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { setTimeout as pause } from "node:timers/promises";
import sharp from "sharp";
import { createSoloServer } from "../dist/index.js";

const startTime = 1_800_000_000_000;
const headStartMs = 30 * 60 * 1000;
const searchMs = 60 * 60 * 1000;
const regroupMs = 30 * 60 * 1000;
const release = startTime + headStartMs;
const deadline = release + searchMs;
let nextClient = 0;

async function listen(context, options) {
  const server = createSoloServer(options);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const close = () => new Promise((resolve, reject) => server.close((error) => {
    if (error) reject(error);
    else resolve();
  }));
  context.after(() => server.listening ? close() : undefined);
  return { url: `http://127.0.0.1:${server.address().port}`, close };
}

function client(url, initialCookie) {
  let cookie = initialCookie;
  const clientId = ++nextClient;
  let nextAction = 0;

  async function send(path = "", action) {
    const headers = {};
    if (cookie) headers.cookie = cookie;
    if (action) headers["content-type"] = "application/json";
    const response = await fetch(`${url}/api/seek${path}`, {
      method: action ? "POST" : "GET",
      headers,
      body: action ? JSON.stringify(action) : undefined,
    });
    const setCookie = response.headers.get("set-cookie");
    if (setCookie) cookie = setCookie.split(";")[0];
    return { status: response.status, body: await response.json(), setCookie };
  }

  return {
    bootstrap: () => send(),
    create: () => send("", { type: "create", actionId: "create-room" }),
    join: (code, actionId = "join-room") => send("", { type: "join", code, actionId }),
    room: (code) => send(`/${code}`),
    act: (code, type, fields = {}) => send(`/${code}`, { type, actionId: `client-${clientId}-action-${++nextAction}`, ...fields }),
    get cookie() { return cookie; },
  };
}

async function scenario(context, databasePath = ":memory:") {
  let time = startTime;
  const options = { databasePath, now: () => time };
  const { url, close } = await listen(context, options);
  const host = client(url);
  const guest = client(url);
  const bootstrap = await host.bootstrap();
  assert.equal(bootstrap.status, 200, "Hide & Seek bootstrap is available");
  assert.match(bootstrap.setCookie, /Path=\/api\/seek(?:;|$)/i);
  assert.match(bootstrap.setCookie, /HttpOnly/i);
  assert.equal((await guest.bootstrap()).status, 200);
  const created = await host.create();
  assert.equal(created.status, 200);
  const { code, edition } = created.body.room;
  const fix = (point, overrides = {}) => ({
    latitude: point.latitude,
    longitude: point.longitude,
    accuracy: 10,
    timestamp: time,
    ...overrides,
  });
  return { host, guest, code, edition, close, url, options, fix, time: (at) => { time = at; } };
}

test("the invite fills two seats and only their credentials can read or act in the room", async (context) => {
  const { host, guest, code, url } = await scenario(context);
  assert.equal((await host.create()).body.room.code, code);
  assert.equal((await guest.join(code.toLowerCase())).body.room.seat, "guest");
  assert.equal((await client(url, guest.cookie).room(code)).body.room.seat, "guest");
  const third = client(url);
  assert.equal((await third.room(code)).status, 401);
  await third.bootstrap();
  assert.deepEqual((await third.room(code)).body, { error: "room-required" });
  assert.deepEqual((await third.act(code, "start")).body, { error: "room-required" });
  assert.deepEqual((await third.join(code)).body, { error: "room-full" });
});

function checkIn({ code, edition, fix }, player, phase = "lobby", turn = 1, overrides) {
  return player.act(code, "check-in", { phase, turn, fix: fix(edition.start, overrides) });
}

async function ready(setup, player) {
  const { body } = await checkIn(setup, player);
  assert.equal(body.error, undefined);
  assert.equal((await player.act(setup.code, "ready", { ready: true, roleRevision: body.room.roleRevision })).body.error, undefined);
}

async function start(setup, hider = "host") {
  const { host, guest, code } = setup;
  assert.equal((await guest.join(code)).body.room.seat, "guest");
  assert.equal((await host.act(code, "assign", { hider })).body.error, undefined);
  await ready(setup, host);
  await ready(setup, guest);
  const result = await host.act(code, "start", { actionId: "start-match" });
  assert.equal(result.body.error, undefined);
  assert.equal(result.body.room.phase, "head-start");
  assert.equal(result.body.room.startedAt, startTime);
  assert.equal(result.body.room.releaseAt, release);
  assert.equal(result.body.room.phaseEndsAt, release);
  return result.body.room;
}

function visit({ code, fix }, player, type, point, fields = {}) {
  return player.act(code, type, { turn: 1, checkpointId: point.id, fix: fix(point), ...fields });
}

test("only the host can start a two-player lobby with assigned roles and fresh readiness", async (context) => {
  const setup = await scenario(context);
  const { host, guest, code, time } = setup;
  assert.equal((await host.act(code, "start")).body.error, "players-not-ready");
  assert.equal((await checkIn(setup, host)).body.error, undefined);
  assert.equal((await host.act(code, "ready", { ready: true, roleRevision: 0 })).body.error, "roles-unassigned");
  await guest.join(code);
  assert.equal((await guest.act(code, "assign", { hider: "guest" })).body.error, "host-only");
  await host.act(code, "assign", { hider: "guest" });
  assert.equal((await checkIn(setup, guest, "lobby", 1, { latitude: 0 })).body.error, "outside-radius");
  assert.equal((await guest.act(code, "ready", { ready: true, roleRevision: 1 })).body.error, "start-unverified");
  await ready(setup, host);
  await ready(setup, guest);
  assert.equal((await guest.act(code, "start")).body.error, "host-only");
  const reassigned = await host.act(code, "assign", { hider: "host" });
  assert.equal(reassigned.body.room.seats.host.ready, false);
  assert.equal(reassigned.body.room.seats.guest.ready, false);
  assert.equal((await host.act(code, "start")).body.error, "players-not-ready");
  await ready(setup, host);
  await ready(setup, guest);
  time(startTime + 30_001);
  assert.equal((await host.act(code, "start")).body.error, "players-not-ready");
  await ready(setup, host);
  await ready(setup, guest);
  const first = await host.act(code, "start", { actionId: "started" });
  time(startTime + 31_000);
  const retry = await host.act(code, "start", { actionId: "started" });
  assert.equal(first.body.room.startedAt, startTime + 30_001);
  assert.equal(retry.body.room.startedAt, first.body.room.startedAt);
  assert.equal(retry.body.room.releaseAt, first.body.room.releaseAt);
});

test("a ready tap confirms the observed role assignment even if roles changed back", async (context) => {
  const setup = await scenario(context);
  const { host, guest, code } = setup;
  await guest.join(code);
  await host.act(code, "assign", { hider: "host" });
  const observed = (await checkIn(setup, guest)).body.room;
  assert.equal(observed.firstHider, "host");
  await host.act(code, "assign", { hider: "guest" });
  await host.act(code, "assign", { hider: "host" });
  const stale = (await guest.act(code, "ready", { ready: true, roleRevision: observed.roleRevision })).body;
  assert.equal(stale.error, "roles-changed");
  assert.equal(stale.room.firstHider, observed.firstHider);
  assert.equal(stale.room.seats.guest.ready, false);
  const confirmed = (await guest.act(code, "ready", { ready: true, roleRevision: stale.room.roleRevision })).body;
  assert.equal(confirmed.error, undefined);
  assert.equal(confirmed.room.seats.guest.ready, true);
});

test("the first verified lock is private and immutable until the scheduled release", async (context) => {
  const setup = await scenario(context);
  const { host, guest, code, edition, url, time, fix } = setup;
  const [target, alternative] = edition.checkpoints;
  const briefing = (await guest.join(code)).body.room;
  assert.equal(briefing.ownLock, undefined);
  assert.doesNotMatch(JSON.stringify(briefing), /correctChoice|answerKey|choiceId|prompt|accuracy|timestamp|tl-3f/i);
  await start(setup);
  const before = (await guest.room(code)).body.room;
  time(release - 1);
  assert.equal((await visit(setup, guest, "lock", target)).body.error, "hider-only");
  assert.equal((await visit(setup, host, "lock", edition.start)).body.error, "unknown-checkpoint");
  assert.equal((await visit(setup, host, "lock", target, { fix: fix(alternative) })).body.error, "outside-radius");
  const locked = await visit(setup, host, "lock", target, { actionId: "first-lock" });
  assert.equal(locked.body.room.ownLock, target.id);
  assert.equal((await visit(setup, host, "lock", alternative)).body.error, "already-locked");
  assert.equal((await visit(setup, host, "lock", alternative, { actionId: "first-lock" })).body.room.ownLock, target.id);
  const reconnect = await client(url, guest.cookie).room(code);
  assert.deepEqual(reconnect.body.room, { ...before, now: release - 1 });
  assert.equal((await visit(setup, guest, "investigate", target)).body.error, "room-phase-changed");
  time(release);
  const released = await guest.room(code);
  assert.equal(released.body.room.phase, "seeking");
  assert.equal(released.body.room.phaseEndsAt, deadline);
  assert.equal(released.body.room.ownLock, undefined);
  assert.equal(released.body.room.canInvestigate, false);
  assert.equal((await visit(setup, guest, "investigate", target)).body.error, "start-unverified");
});

test("at release a lock arriving for the first time voids the match for both seats", async (context) => {
  const setup = await scenario(context);
  const { host, guest, code, edition, time } = setup;
  await start(setup);
  time(release);
  const late = await visit(setup, host, "lock", edition.checkpoints[0]);
  assert.equal(late.body.error, "round-finished");
  assert.equal(late.body.room.phase, "void");
  assert.equal(late.body.room.phaseEndsAt, null);
  assert.deepEqual(late.body.room.outcome, { reason: "missed-lock", winner: null, at: release });
  assert.deepEqual(late.body.room.turns, []);
  const other = (await guest.room(code)).body.room;
  assert.deepEqual(other.outcome, late.body.room.outcome);
  assert.equal(other.ownLock, undefined);
});

test("reconnect preserves a discovery committed one millisecond before expiry and resets deductions at the swap", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "kelana-seek-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const setup = await scenario(context, join(directory, "trial.sqlite"));
  const { host, guest, code, edition, time, close, options, url, fix } = setup;
  const [firstTarget, secondTarget] = edition.checkpoints;
  await start(setup);
  assert.equal((await visit(setup, host, "lock", firstTarget)).body.error, undefined);
  time(release);
  assert.equal((await checkIn(setup, guest, "seeking")).body.room.canInvestigate, true);
  assert.equal((await visit(setup, guest, "investigate", secondTarget)).body.investigation, "miss");
  assert.deepEqual((await guest.room(code)).body.room.ruledOut, [secondTarget.id]);
  assert.deepEqual((await host.room(code)).body.room.ruledOut, []);
  time(deadline - 1);
  const attempted = { type: "investigate", actionId: "found-once", turn: 1, checkpointId: firstTarget.id, fix: fix(firstTarget) };
  const response = await fetch(`${url}/api/seek/${code}`, {
    method: "POST",
    headers: { cookie: guest.cookie, "content-type": "application/json" },
    body: JSON.stringify(attempted),
  });
  assert.equal(response.status, 200);
  await response.body.cancel();
  await close();
  time(deadline);
  const restarted = await listen(context, options);
  const resumedHost = client(restarted.url, host.cookie);
  const resumedGuest = client(restarted.url, guest.cookie);
  const found = await resumedGuest.act(code, "investigate", attempted);
  assert.equal(found.body.investigation, "found");
  const regroup = found.body.room;
  assert.equal(regroup.phase, "regroup");
  assert.equal(regroup.phaseEndsAt, deadline - 1 + regroupMs);
  assert.equal(regroup.outcome, null);
  assert.deepEqual(regroup.turns, [{
    turn: 1, hider: "host", checkpointId: firstTarget.id, hidingMs: searchMs - 1, bonusMs: 0, adjustedMs: searchMs - 1, reason: "found", at: deadline - 1,
  }]);
  assert.deepEqual((await resumedHost.room(code)).body.room.turns, regroup.turns);
  const firstRegroup = await resumedHost.act(code, "check-in", {
    phase: "regroup", turn: 1, fix: fix(edition.start), actionId: "regroup-check",
  });
  assert.equal(firstRegroup.body.room.phase, "regroup");
  assert.equal(firstRegroup.body.room.seats.host.regrouped, true);
  time(deadline + 60_000);
  const swapped = await resumedGuest.act(code, "check-in", {
    phase: "regroup", turn: 1, fix: fix(edition.start), actionId: "regroup-check",
  });
  assert.equal(swapped.body.room.phase, "head-start");
  assert.equal(swapped.body.room.hider, "guest");
  assert.equal(swapped.body.room.turn, 2);
  assert.equal(swapped.body.room.ownLock, undefined);
  assert.deepEqual(swapped.body.room.ruledOut, []);
  assert.equal(swapped.body.room.canInvestigate, false);
  assert.equal(swapped.body.room.seats.host.regrouped, false);
  assert.equal(swapped.body.room.seats.guest.regrouped, false);
  assert.deepEqual(swapped.body.room.turns, regroup.turns);
  assert.equal((await visit(setup, resumedGuest, "lock", secondTarget)).body.error, "turn-changed");
  assert.equal((await visit(setup, resumedGuest, "lock", secondTarget, { turn: 2 })).body.error, undefined);
  const secondDeadline = deadline + 60_000 + headStartMs + searchMs;
  time(secondDeadline);
  const finished = (await resumedHost.room(code)).body.room;
  assert.equal(finished.phase, "finished");
  assert.deepEqual(finished.turns, [
    ...regroup.turns,
    { turn: 2, hider: "guest", checkpointId: secondTarget.id, hidingMs: searchMs, bonusMs: 0, adjustedMs: searchMs, reason: "timeout", at: secondDeadline },
  ]);
  assert.deepEqual(finished.outcome, { winner: "guest", reason: "scored", at: secondDeadline });
  assert.deepEqual((await resumedGuest.room(code)).body.room.outcome, finished.outcome);
});

test("an investigation at the exact deadline loses and an exact-deadline regroup check cannot start turn two", async (context) => {
  const setup = await scenario(context);
  const { host, guest, code, edition, time } = setup;
  const [target] = edition.checkpoints;
  await start(setup);
  await visit(setup, host, "lock", target);
  time(release);
  await checkIn(setup, guest, "seeking");
  time(deadline);
  const late = await visit(setup, guest, "investigate", target);
  assert.equal(late.body.error, "room-phase-changed");
  assert.equal(late.body.investigation, undefined);
  assert.deepEqual(late.body.room.turns, [{
    turn: 1, hider: "host", checkpointId: target.id, hidingMs: searchMs, bonusMs: 0, adjustedMs: searchMs, reason: "timeout", at: deadline,
  }]);
  time(deadline + regroupMs - 1);
  assert.equal((await checkIn(setup, host, "regroup")).body.room.seats.host.regrouped, true);
  time(deadline + regroupMs);
  const incomplete = await checkIn(setup, guest, "regroup");
  assert.equal(incomplete.body.error, "round-finished");
  assert.equal(incomplete.body.room.phase, "incomplete");
  assert.deepEqual(incomplete.body.room.turns, late.body.room.turns);
  assert.deepEqual(incomplete.body.room.outcome, { reason: "regroup-timeout", winner: null, at: deadline + regroupMs });
  const exit = await host.act(code, "leave", { phase: "regroup", turn: 1 });
  assert.deepEqual(exit.body.room.outcome, incomplete.body.room.outcome);
});

test("an offline reconnect commits expiry timestamps in order and never awards a match winner after missed regroup", async (context) => {
  const setup = await scenario(context);
  const { host, guest, code, edition, time } = setup;
  const [target] = edition.checkpoints;
  await start(setup, "guest");
  await visit(setup, guest, "lock", target);
  time(deadline + regroupMs + 300_000);
  const reconnected = (await guest.room(code)).body.room;
  assert.equal(reconnected.phase, "incomplete");
  assert.deepEqual(reconnected.turns, [{
    turn: 1, hider: "guest", checkpointId: target.id, hidingMs: searchMs, bonusMs: 0, adjustedMs: searchMs, reason: "timeout", at: deadline,
  }]);
  assert.deepEqual(reconnected.outcome, { reason: "regroup-timeout", winner: null, at: deadline + regroupMs });
  assert.deepEqual((await host.room(code)).body.room.outcome, reconnected.outcome);
});

test("a late lobby exit cannot forfeit and a qualified active exit ends the match once", async (context) => {
  const setup = await scenario(context);
  const { host, guest, code, edition } = setup;
  await start(setup);
  const [target] = edition.checkpoints;
  await visit(setup, host, "lock", target);
  const staleExit = await guest.act(code, "leave", { phase: "lobby", turn: 1 });
  assert.equal(staleExit.body.error, "room-phase-changed");
  assert.equal(staleExit.body.room.phase, "head-start");
  const exit = { phase: "head-start", turn: 1, actionId: "leave-forever" };
  const forfeit = await guest.act(code, "leave", exit);
  assert.equal(forfeit.body.room.phase, "finished");
  assert.deepEqual(forfeit.body.room.outcome, { reason: "forfeit", winner: "host", at: startTime });
  assert.equal(forfeit.body.room.ownLock, undefined);
  assert.deepEqual(forfeit.body.room.turns, []);
  assert.deepEqual((await guest.act(code, "leave", exit)).body.room.outcome, forfeit.body.room.outcome);
  assert.deepEqual((await host.room(code)).body.room.outcome, forfeit.body.room.outcome);
});

test("a confirmed head-start forfeit still applies when it reaches the server at release", async (context) => {
  const setup = await scenario(context);
  const { host, guest, code, edition, time } = setup;
  await start(setup);
  await visit(setup, host, "lock", edition.checkpoints[0]);
  time(release);
  const exit = await guest.act(code, "leave", { phase: "head-start", turn: 1 });
  assert.equal(exit.body.error, undefined);
  assert.deepEqual(exit.body.room.outcome, { reason: "forfeit", winner: "host", at: release });
  assert.deepEqual((await host.room(code)).body.room.outcome, exit.body.room.outcome);
});

test("a confirmed regroup forfeit still applies when the other seat starts turn two", async (context) => {
  const setup = await scenario(context);
  const { host, guest, code, edition, time } = setup;
  await start(setup);
  await visit(setup, host, "lock", edition.checkpoints[0]);
  time(deadline);
  assert.equal((await checkIn(setup, host, "regroup")).body.room.phase, "regroup");
  assert.equal((await checkIn(setup, guest, "regroup")).body.room.turn, 2);
  const exit = await host.act(code, "leave", { phase: "regroup", turn: 1 });
  assert.equal(exit.body.error, undefined);
  assert.deepEqual(exit.body.room.outcome, { reason: "forfeit", winner: "guest", at: deadline });
  assert.equal(exit.body.room.turns[0].reason, "timeout");
  assert.deepEqual((await guest.room(code)).body.room.outcome, exit.body.room.outcome);
});

test("an unstarted guest can release the seat and the host can cancel without awarding a winner", async (context) => {
  const { host, guest, code, url } = await scenario(context);
  await guest.join(code);
  const releaseSeat = { phase: "lobby", turn: 1, actionId: "leave-lobby" };
  assert.deepEqual((await guest.act(code, "leave", releaseSeat)).body, {});
  const replacement = client(url);
  await replacement.bootstrap();
  assert.equal((await replacement.join(code)).body.room.seat, "guest");
  assert.equal((await guest.join(code)).status, 403);
  assert.deepEqual((await guest.act(code, "leave", releaseSeat)).body, {});
  assert.equal((await replacement.room(code)).body.room.seats.guest.joined, true);
  const canceled = await host.act(code, "leave", { phase: "lobby", turn: 1 });
  assert.equal(canceled.body.room.phase, "canceled");
  assert.deepEqual(canceled.body.room.outcome, { reason: "canceled", winner: null, at: startTime });
  assert.deepEqual((await replacement.room(code)).body.room.outcome, canceled.body.room.outcome);
});

test("two equal hiding times finish the match as a draw", async (context) => {
  const setup = await scenario(context);
  const { host, guest, code, edition, time } = setup;
  const [firstTarget, secondTarget] = edition.checkpoints;
  await start(setup);
  await visit(setup, host, "lock", firstTarget);
  time(deadline);
  assert.equal((await host.room(code)).body.room.outcome, null);
  await checkIn(setup, host, "regroup");
  await checkIn(setup, guest, "regroup");
  await visit(setup, guest, "lock", secondTarget, { turn: 2 });
  const secondDeadline = deadline + headStartMs + searchMs;
  time(secondDeadline);
  const finished = (await host.room(code)).body.room;
  assert.deepEqual(finished.turns.map(({ hidingMs }) => hidingMs), [searchMs, searchMs]);
  assert.deepEqual(finished.outcome, { winner: null, reason: "scored", at: secondDeadline });
  assert.deepEqual((await guest.room(code)).body.room.outcome, finished.outcome);
});

async function beginSeeking(setup, target = setup.edition.checkpoints[0]) {
  await start(setup);
  assert.equal((await visit(setup, setup.host, "lock", target)).body.error, undefined);
  setup.time(release);
  assert.equal((await checkIn(setup, setup.guest, "seeking")).body.error, undefined);
}

function ask({ code }, player, family, fields = {}) {
  return player.act(code, "ask", { turn: 1, family, ...fields });
}

function answer({ code }, player, question, fields) {
  return player.act(code, "answer-question", { turn: 1, questionId: question.id, ...fields });
}

test("verified reference, private correction, and duplicate radar replies share one immutable result and draw", async (context) => {
  const setup = await scenario(context);
  const { host, guest, code, edition, time, fix, url } = setup;
  const [, , , , stadion] = edition.checkpoints;
  await beginSeeking(setup);
  const ready = (await guest.room(code)).body.room.clues;
  assert.equal(ready?.referenceId, edition.start.id);
  assert.deepEqual(ready.menu.find(({ family }) => family === "warmer").options, []);
  assert.equal((await ask(setup, guest, "warmer")).body.error, "clue-unavailable");
  assert.equal((await ask(setup, guest, "radar", { radiusMeters: 7 })).body.error, "invalid-clue-input");
  const queried = await ask(setup, guest, "radar", { radiusMeters: 1000 });
  assert.equal(queried.body.error, undefined);
  const [radar] = queried.body.room.clues.questions;
  assert.equal(radar.referenceId, edition.start.id);
  assert.equal(radar.askedAt, release);
  assert.equal(radar.deadline, release + 120_000);
  assert.equal(radar.choices, undefined);
  const hiderQuestion = (await host.room(code)).body.room.clues.questions[0];
  assert.deepEqual(hiderQuestion.choices.map(({ id }) => id), ["yes", "no"]);
  assert.equal(radar.answer, undefined);
  assert.equal(queried.body.room.clues.hand, undefined);
  assert.equal(queried.body.room.clues.draw, undefined);
  assert.equal((await ask(setup, guest, "matching")).body.error, "clue-pending");

  const forged = await visit(setup, guest, "reference", stadion, { fix: fix(edition.start) });
  assert.equal(forged.body.error, "outside-radius");
  const moved = await visit(setup, guest, "investigate", stadion);
  assert.equal(moved.body.investigation, "miss");
  assert.equal(moved.body.room.clues.referenceId, stadion.id);
  assert.equal(moved.body.room.clues.previousReferenceId, edition.start.id);
  assert.equal(moved.body.room.clues.questions[0].referenceId, edition.start.id);
  assert.equal((await ask(setup, guest, "radar", {
    radiusMeters: 1000, referenceId: edition.start.id,
  })).body.error, "clue-reference-changed");

  time(radar.deadline - 1);
  const corrected = await answer(setup, host, radar, { choiceId: "no" });
  assert.equal(corrected.body.error, "incorrect-clue-answer");
  assert.equal(corrected.body.room.clues.questions[0].status, "pending");
  assert.equal(corrected.body.room.clues.draw, undefined);
  const stillPending = (await guest.room(code)).body;
  assert.equal(stillPending.error, undefined);
  assert.equal(stillPending.room.clues.questions[0].answer, undefined);
  const accepted = await answer(setup, host, radar, { choiceId: "yes", actionId: "radar-answer" });
  assert.equal(accepted.body.error, undefined);
  assert.equal(accepted.body.room.clues.questions[0].answer, "Ya");
  const { draw } = accepted.body.room.clues;
  assert.equal(draw.cards.length, 2);
  assert.equal(draw.keepCount, 1);
  assert.equal(draw.deadline, radar.deadline - 1 + 30_000);
  assert.deepEqual((await client(url, host.cookie).room(code)).body.room.clues.draw, draw);
  assert.deepEqual((await answer(setup, host, radar, { choiceId: "no", actionId: "radar-answer" })).body.room.clues.draw, draw);
  assert.equal((await answer(setup, host, radar, { choiceId: "yes" })).body.error, "question-closed");
  await checkIn(setup, guest, "seeking");
  assert.equal((await guest.room(code)).body.room.clues.referenceId, stadion.id);
  assert.equal((await visit(setup, guest, "reference", edition.start)).body.room.clues.referenceId, edition.start.id);
  const repeated = await ask(setup, guest, "radar", { radiusMeters: 1000 });
  assert.equal(repeated.body.error, undefined);
  assert.deepEqual(repeated.body.room.clues.questions, accepted.body.room.clues.questions);
  assert.deepEqual((await host.room(code)).body.room.clues.draw, draw);

  time(draw.deadline);
  const automatic = (await host.room(code)).body.room.clues;
  assert.equal(automatic.draw, undefined);
  assert.deepEqual(automatic.hand, draw.cards.slice(0, 1));
  assert.equal((await guest.room(code)).body.room.clues.hand, undefined);
});

test("timed-out clues fall back once in order, while clues capped by discovery or the search limit close", async (context) => {
  const setup = await scenario(context);
  const { host, guest, code, edition, time } = setup;
  await beginSeeking(setup);
  const first = (await ask(setup, guest, "matching")).body.room.clues?.questions[0];
  assert.ok(first);
  time(first.deadline);
  const objectiveTimeout = await answer(setup, host, first, { choiceId: "same" });
  assert.equal(objectiveTimeout.body.error, "question-closed");
  assert.equal(objectiveTimeout.body.room.clues.questions[0].status, "timeout");
  assert.equal(objectiveTimeout.body.room.clues.questions[0].answer, "Cabang sama");
  assert.deepEqual(objectiveTimeout.body.room.clues.hand, []);
  assert.equal(objectiveTimeout.body.room.clues.draw, undefined);
  const photo = (await ask(setup, guest, "photo")).body.room.clues.questions[1];
  assert.equal(photo.deadline, first.deadline + 240_000);
  time(photo.deadline);
  const afterPhotoExpiry = (await guest.room(code)).body.room.clues.questions[1];
  assert.equal(afterPhotoExpiry.status, "substituted");
  assert.equal(afterPhotoExpiry.answer, "Cabang sama");
  assert.equal(afterPhotoExpiry.photoId, undefined);
  assert.equal((await host.room(code)).body.room.clues.draw, undefined);
  assert.deepEqual((await ask(setup, guest, "photo")).body.room.clues.questions[1], afterPhotoExpiry);

  await visit(setup, guest, "reference", edition.checkpoints[4]);
  const unavailable = (await ask(setup, guest, "photo")).body.room.clues.questions[2];
  const fallback = await host.act(code, "photo-unavailable", { turn: 1, questionId: unavailable.id });
  assert.equal(fallback.body.error, undefined);
  assert.equal(fallback.body.room.clues.questions[2].status, "substituted");
  assert.equal(fallback.body.room.clues.questions[2].answer, "Cabang berbeda");
  assert.deepEqual(fallback.body.room.clues.hand, []);

  time(deadline - 1);
  const capped = (await ask(setup, guest, "radar", { radiusMeters: 1000 })).body.room.clues.questions[3];
  assert.equal(capped.deadline, deadline);
  time(deadline);
  const late = await answer(setup, host, capped, { choiceId: "no" });
  assert.equal(late.body.room.phase, "regroup");
  assert.equal(late.body.room.clues.questions[3].status, "closed");
  assert.equal(late.body.room.clues.questions[3].answer, undefined);
  assert.equal(late.body.room.clues.hand, undefined);
});

test("all objective families are drawn from public board data and retain their own reference inputs", async (context) => {
  const setup = await scenario(context);
  const { host, guest, code, edition, time } = setup;
  const [target, , mBloc, ayodya] = edition.checkpoints;
  await beginSeeking(setup);
  const initial = (await guest.room(code)).body.room.clues;
  assert.ok(initial?.distanceSource.includes("perkiraan"));
  assert.equal(initial.equalToleranceMeters, 100);
  assert.ok(initial.branches[target.id]);
  assert.ok(initial.menu.find(({ family }) => family === "measuring").options.some(({ landmarkId }) => landmarkId === mBloc.id));

  const measuring = (await ask(setup, guest, "measuring", { landmarkId: mBloc.id })).body.room.clues.questions[0];
  assert.equal(measuring.landmarkId, mBloc.id);
  assert.equal(measuring.walkingComparison, undefined);
  const comparison = (await host.room(code)).body.room.clues.questions[0].walkingComparison;
  assert.ok(comparison.firstMeters > 0 && comparison.secondMeters > 0);
  assert.ok(Math.abs(comparison.firstMeters - comparison.secondMeters) <= initial.equalToleranceMeters);
  time(measuring.deadline);
  assert.equal((await guest.room(code)).body.room.clues.questions[0].answer, "Kurang lebih sama");
  assert.equal((await host.room(code)).body.room.clues.questions[0].walkingComparison, undefined);

  await visit(setup, guest, "reference", mBloc);
  await visit(setup, guest, "reference", mBloc);
  const warmer = (await ask(setup, guest, "warmer")).body.room.clues.questions[1];
  assert.equal(warmer.previousReferenceId, edition.start.id);
  assert.equal(warmer.referenceId, mBloc.id);
  await visit(setup, guest, "reference", ayodya);
  assert.equal((await ask(setup, guest, "warmer", {
    referenceId: ayodya.id, previousReferenceId: edition.start.id,
  })).body.error, "clue-reference-changed");
  const warmerComparison = (await host.room(code)).body.room.clues.questions[1].walkingComparison;
  assert.ok(warmerComparison.firstMeters - warmerComparison.secondMeters > initial.equalToleranceMeters);
  time(warmer.deadline);
  assert.equal((await guest.room(code)).body.room.clues.questions[1].answer, "Lebih dekat");

  const nearest = (await ask(setup, guest, "nearest", { radiusMeters: 1500 })).body.room.clues.questions[2];
  assert.equal(nearest.referenceId, ayodya.id);
  assert.ok(nearest.landmarkIds.includes("pasar-mayestik"));
  assert.ok(nearest.landmarkIds.includes(edition.start.id));
  const hiderQuestion = (await host.room(code)).body.room.clues.questions[2];
  assert.ok(hiderQuestion.choices.some(({ id }) => id === "outside"));
  time(nearest.deadline);
  assert.equal((await host.room(code)).body.room.clues.questions[2].answer, edition.start.name);
});

test("accepted clue photos survive regroup and reconnect, and only members can retrieve sanitized bytes before match end", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "kelana-seek-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const databasePath = join(directory, "trial.sqlite");
  const setup = await scenario(context, databasePath);
  const { host, guest, code, edition, time, url, close, options } = setup;
  await beginSeeking(setup);
  const justAsked = await ask(setup, guest, "photo");
  const question = justAsked.body.room.clues?.questions[0];
  assert.ok(question);
  const imagePath = `/api/seek/${code}/photos/${question.id}`;
  const photo = (server, cookie, query = "") => fetch(server + imagePath + query, { headers: { cookie } });
  assert.equal((await photo(url, guest.cookie)).status, 404);

  const original = await sharp({ create: { width: 4, height: 3, channels: 3, background: "#345678" } })
    .withExifMerge({ IFD3: { GPSLatitudeRef: "N", GPSLatitude: "51/1 30/1 20/1" } })
    .jpeg().toBuffer();
  const encoded = original.toString("base64");
  assert.equal((await answer(setup, guest, question, { photo: encoded })).body.error, "hider-only");
  assert.equal((await answer(setup, host, question, { photo: "invalid" })).body.error, "invalid-photo");
  await visit(setup, guest, "reference", edition.checkpoints[4]);
  time(question.deadline - 1);
  const action = { photo: encoded, actionId: "public-photo" };
  const accepted = await answer(setup, host, question, action);
  assert.equal(accepted.body.error, undefined);
  const { questions, hand, draw } = accepted.body.room.clues;
  assert.equal(questions[0].status, "answered");
  assert.equal(questions[0].referenceId, edition.start.id);
  assert.equal(questions[0].photoId, question.id);
  assert.equal(hand.length, 1);
  assert.equal(draw, undefined);
  assert.ok(!JSON.stringify(accepted.body).includes(encoded));
  assert.deepEqual((await answer(setup, host, question, action)).body.room.clues.hand, hand);

  const outsider = client(url);
  await outsider.bootstrap();
  assert.equal((await photo(url, "", `?cookie=${guest.cookie}`)).status, 401);
  assert.equal((await photo(url, outsider.cookie)).status, 403);
  for (const player of [host, guest]) {
    const response = await photo(url, player.cookie);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "image/jpeg");
    assert.equal(response.headers.get("cache-control"), "no-store");
    const sanitized = await sharp(Buffer.from(await response.arrayBuffer())).metadata();
    assert.equal(sanitized.exif, undefined);
    assert.equal(sanitized.format, "jpeg");
  }

  const next = (await ask(setup, guest, "photo")).body.room.clues.questions[1];
  await visit(setup, guest, "investigate", edition.checkpoints[0]);
  assert.equal((await answer(setup, host, next, { photo: encoded })).body.error, "room-phase-changed");
  const regroup = (await guest.room(code)).body.room;
  assert.equal(regroup.clues.questions[1].status, "closed");
  assert.equal(regroup.clues.questions[1].photoId, undefined);
  assert.deepEqual(regroup.turns[0].clues, regroup.clues.questions);
  assert.equal((await photo(url, guest.cookie)).status, 200);
  await checkIn(setup, host, "regroup");
  await checkIn(setup, guest, "regroup");
  await close();
  const restarted = await listen(context, options);
  const reconnectedHost = client(restarted.url, host.cookie);
  const reconnectedGuest = client(restarted.url, guest.cookie);
  assert.equal((await reconnectedGuest.room(code)).body.room.clues, undefined);
  assert.equal((await photo(restarted.url, guest.cookie)).status, 200);
  await reconnectedHost.act(code, "leave", { phase: "head-start", turn: 2 });
  assert.equal((await photo(restarted.url, guest.cookie)).status, 404);
  const archived = (await reconnectedGuest.room(code)).body.room.turns[0].clues;
  assert.equal(archived[0].photoId, undefined);
  assert.equal(archived[0].status, "answered");
  assert.equal(archived[1].status, "closed");

  const database = new DatabaseSync(databasePath);
  try {
    assert.equal(database.prepare("SELECT count(*) AS count FROM seek_photos WHERE code = ?").get(code).count, 0);
  } finally {
    database.close();
  }
});

test("a valid answer can resolve a new clue before a previous draw expires", async (context) => {
  const setup = await scenario(context);
  const { host, guest, time } = setup;
  await beginSeeking(setup);
  time(release + searchMs - 20_000);
  const radar = (await ask(setup, guest, "radar", { radiusMeters: 1000 })).body.room.clues.questions[0];
  const { draw } = (await answer(setup, host, radar, { choiceId: "yes" })).body.room.clues;
  const matching = (await ask(setup, guest, "matching")).body.room.clues.questions[1];
  assert.equal(matching.deadline, draw.deadline);
  const incorrect = await answer(setup, host, matching, { choiceId: "different" });
  assert.equal(incorrect.body.error, "incorrect-clue-answer");
  assert.deepEqual(incorrect.body.room.clues.draw, draw);
  const correct = await answer(setup, host, matching, { choiceId: "same" });
  const { clues } = correct.body.room;
  assert.equal(correct.body.error, undefined);
  assert.equal(clues.questions[1].status, "answered");
  assert.deepEqual(clues.hand, draw.cards.slice(0, 1));
  assert.equal(clues.draw.cards.length, 3);
  assert.ok(clues.draw.cards.every(({ id }) => !draw.cards.some((card) => card.id === id)));
});

function dealNext(databasePath, code, kinds) {
  // Make the sequence deterministic while retaining each room's real, unique card IDs.
  const database = new DatabaseSync(databasePath);
  try {
    const run = JSON.parse(database.prepare("SELECT snapshot FROM seek_rooms WHERE code = ?").get(code).snapshot);
    const { pile } = run.clueState.deck;
    assert.equal(new Set(pile.map(({ id }) => id)).size, 12);
    for (const kind of ["time-bonus", "question-delay", "hand-swap"]) {
      assert.equal(pile.filter((card) => card.kind === kind).length, 4);
    }
    const upcoming = kinds.map((kind) => pile.splice(pile.findIndex((card) => card.kind === kind), 1)[0]);
    pile.push(...upcoming.toReversed());
    database.prepare("UPDATE seek_rooms SET snapshot = ? WHERE code = ?").run(JSON.stringify(run), code);
  } finally {
    database.close();
  }
}

test("delay and hand swap consume once and discovery scores bonuses from the retained and automatically kept cards", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "kelana-seek-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const databasePath = join(directory, "trial.sqlite");
  const setup = await scenario(context, databasePath);
  const { host, guest, code, edition, time } = setup;
  await beginSeeking(setup);
  dealNext(databasePath, code, [
    "question-delay", "hand-swap",
    "hand-swap", "question-delay", "time-bonus",
    "time-bonus", "question-delay",
    "time-bonus", "hand-swap",
  ]);

  const earn = async (family, fields, choiceId) => {
    const asked = await ask(setup, guest, family, fields);
    assert.equal(asked.body.error, undefined);
    const pending = asked.body.room.clues.questions.at(-1);
    return (await answer(setup, host, pending, { choiceId })).body.room.clues.draw;
  };
  const choose = (draw, count = draw.keepCount) => host.act(code, "choose-cards", {
    turn: 1, cardIds: draw.cards.slice(0, count).map(({ id }) => id),
  });
  const radarDraw = await earn("radar", { radiusMeters: 1000 }, "yes");
  const [delayCard] = (await choose(radarDraw)).body.room.clues.hand;
  assert.equal(delayCard.kind, "question-delay");
  const delayAction = { turn: 1, cardId: delayCard.id, actionId: "use-delay" };
  const delayed = await host.act(code, "play-card", delayAction);
  assert.equal(delayed.body.error, undefined);
  assert.equal(delayed.body.room.phaseEndsAt, deadline);
  assert.equal(delayed.body.room.clues.delayUntil, release + 120_000);
  assert.equal((await host.act(code, "play-card", delayAction)).body.error, undefined);
  assert.deepEqual((await host.room(code)).body.room.clues.hand, []);
  assert.equal((await ask(setup, guest, "matching")).body.error, "question-delayed");
  assert.equal((await ask(setup, guest, "radar", { radiusMeters: 1000 })).body.error, undefined);
  assert.equal((await visit(setup, guest, "investigate", edition.checkpoints[1])).body.investigation, "miss");
  await visit(setup, guest, "reference", edition.start);

  time(release + 120_000);
  const nearestDraw = await earn("nearest", { radiusMeters: 1000 }, edition.start.id);
  const [swap, sacrifice] = (await choose(nearestDraw)).body.room.clues.hand;
  assert.equal(swap.kind, "hand-swap");
  assert.equal(sacrifice.kind, "question-delay");
  assert.equal((await host.act(code, "play-card", { turn: 1, cardId: swap.id, discardId: swap.id })).body.error, "invalid-card-discard");
  const swapAction = { turn: 1, cardId: swap.id, discardId: sacrifice.id, actionId: "use-swap" };
  const swapped = await host.act(code, "play-card", swapAction);
  assert.equal(swapped.body.error, undefined);
  assert.deepEqual(swapped.body.room.clues.hand, []);
  const swapDraw = swapped.body.room.clues.draw;
  assert.equal(swapDraw.cards.length, 2);
  assert.deepEqual((await host.act(code, "play-card", swapAction)).body.room.clues.draw, swapDraw);
  const kept = await choose(swapDraw);
  assert.equal(kept.body.room.clues.hand[0].kind, "time-bonus");

  time(deadline - 60_000);
  const unresolved = await earn("radar", { radiusMeters: 1500 }, "yes");
  assert.equal(unresolved.cards[0].kind, "time-bonus");
  const discovered = await visit(setup, guest, "investigate", edition.checkpoints[0]);
  assert.equal(discovered.body.room.phase, "regroup");
  assert.equal(discovered.body.room.turns[0].hidingMs, searchMs - 60_000);
  assert.equal(discovered.body.room.turns[0].bonusMs, 240_000);
  assert.equal(discovered.body.room.turns[0].adjustedMs, searchMs + 180_000);
  assert.equal(discovered.body.room.outcome, null);

  await checkIn(setup, host, "regroup");
  await checkIn(setup, guest, "regroup");
  await visit(setup, guest, "lock", edition.checkpoints[1], { turn: 2 });
  const secondRelease = deadline - 60_000 + headStartMs;
  time(secondRelease);
  const reset = (await guest.room(code)).body.room.clues;
  assert.deepEqual(reset.hand, []);
  assert.deepEqual(reset.questions, []);
  assert.equal(reset.draw, undefined);
  time(secondRelease + searchMs);
  const terminal = (await guest.room(code)).body.room;
  assert.equal(terminal.turns[1].adjustedMs, searchMs);
  assert.equal(terminal.outcome.winner, "host");
});

test("an expired match purges the photo even when both clients are offline", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "kelana-seek-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const databasePath = join(directory, "trial.sqlite");
  const setup = await scenario(context, databasePath);
  const { host, guest, code, time } = setup;
  await beginSeeking(setup);
  const asked = await ask(setup, guest, "photo");
  const question = asked.body.room.clues.questions[0];
  const image = await sharp({ create: { width: 2, height: 2, channels: 3, background: "#345678" } }).jpeg().toBuffer();
  assert.equal((await answer(setup, host, question, { photo: image.toString("base64") })).body.error, undefined);

  const database = new DatabaseSync(databasePath);
  try {
    const count = database.prepare("SELECT count(*) AS count FROM seek_photos WHERE code = ?");
    assert.equal(count.get(code).count, 1);
    time(deadline + regroupMs);
    for (let attempt = 0; count.get(code).count && attempt < 20; attempt++) {
      await pause(100);
    }
    assert.equal(count.get(code).count, 0);
  } finally {
    database.close();
  }
});
