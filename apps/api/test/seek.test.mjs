import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
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
    turn: 1, hider: "host", checkpointId: firstTarget.id, hidingMs: searchMs - 1, reason: "found", at: deadline - 1,
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
    { turn: 2, hider: "guest", checkpointId: secondTarget.id, hidingMs: searchMs, reason: "timeout", at: secondDeadline },
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
    turn: 1, hider: "host", checkpointId: target.id, hidingMs: searchMs, reason: "timeout", at: deadline,
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
    turn: 1, hider: "guest", checkpointId: target.id, hidingMs: searchMs, reason: "timeout", at: deadline,
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
