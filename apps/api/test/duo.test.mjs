import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createSoloServer } from "../dist/index.js";

const initialTime = 1_800_000_000_000;
const deadline = initialTime + 60 * 60 * 1000;
const correctIndexes = [1, 0, 2, 1, 2, 0];

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
  let nextAction = 0;

  async function request(path = "", body) {
    const headers = {};
    if (cookie) headers.cookie = cookie;
    if (body !== undefined) headers["content-type"] = "application/json";
    const response = await fetch(`${url}/api/duo${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const setCookie = response.headers.get("set-cookie");
    if (setCookie) cookie = setCookie.split(";")[0];
    return { status: response.status, setCookie, body: await response.json() };
  }

  return {
    bootstrap: () => request(),
    lobby: (type, fields = {}) => request("", { type, actionId: `action-${++nextAction}`, ...fields }),
    room: (code) => request(`/${code}`),
    challenge: (code, point) => request(`/${code}/challenge?checkpointId=${point.id}`),
    act: (code, type, fields = {}) => request(`/${code}`, { type, actionId: `action-${++nextAction}`, ...fields }),
    get cookie() { return cookie; },
  };
}

async function scenario(context, databasePath = ":memory:") {
  let now = initialTime;
  const options = { databasePath, now: () => now };
  const { url, close } = await listen(context, options);
  const host = client(url);
  const guest = client(url);
  const hostBootstrap = await host.bootstrap();
  assert.equal(hostBootstrap.status, 200, "Duo bootstrap is available");
  assert.deepEqual(hostBootstrap.body, {});
  assert.equal((await guest.bootstrap()).status, 200);
  const created = await host.lobby("create", { actionId: "create-room" });
  assert.equal(created.status, 200);
  const { code, edition } = created.body.room;
  const fix = (point, overrides = {}) => ({
    latitude: point.latitude,
    longitude: point.longitude,
    accuracy: 10,
    timestamp: now,
    ...overrides,
  });
  const join = () => guest.lobby("join", { code: code.toLowerCase(), actionId: "join-room" });
  const checkIn = (player, point, overrides) => player.act(code, "check-in", { checkpointId: point.id, fix: fix(point, overrides) });
  const ready = async (player) => {
    assert.equal((await checkIn(player, edition.start)).body.error, undefined);
    assert.equal((await player.act(code, "ready", { ready: true })).body.error, undefined);
  };
  async function start() {
    assert.equal((await join()).status, 200);
    await ready(host);
    await ready(guest);
    assert.equal((await host.act(code, "start")).body.room.phase, "active");
  }
  async function visit(player, index) {
    const point = edition.checkpoints[index];
    const { body } = await checkIn(player, point);
    assert.equal(body.error, undefined);
    return { checkpointId: point.id, choiceId: body.challenge.choices[correctIndexes[index]].id };
  }
  const claim = async (player, index) => player.act(code, "answer", await visit(player, index));
  return { url, close, options, host, guest, hostBootstrap, code, edition, fix, join, checkIn, ready, start, visit, claim, setTime: (value) => { now = value; } };
}

test("an invite fills just two seats and the same credential recovers its seat", async (context) => {
  const { url, host, guest, hostBootstrap, code, edition, join } = await scenario(context);
  assert.match(hostBootstrap.setCookie, /Path=\/api\/duo(?:;|$)/i);
  assert.match(hostBootstrap.setCookie, /HttpOnly/i);
  assert.match(hostBootstrap.setCookie, /SameSite=(Strict|Lax)/i);
  assert.equal((await host.bootstrap()).setCookie, null);
  assert.equal((await host.lobby("create", { actionId: "create-room" })).body.room.code, code);
  assert.equal((await host.lobby("join", { code })).body.room.seat, "host");
  assert.equal((await join()).body.room.seat, "guest");
  assert.equal((await join()).body.room.code, code);
  assert.equal((await client(url, guest.cookie).room(code)).body.room.seat, "guest");
  const third = client(url);
  assert.equal((await third.room(code)).status, 401);
  assert.equal((await third.lobby("join", { code })).status, 401);
  await third.bootstrap();
  for (const reply of [await third.room(code), await third.act(code, "start"), await third.challenge(code, edition.checkpoints[0])]) {
    assert.equal(reply.status, 403);
    assert.deepEqual(reply.body, { error: "room-required" });
  }
  assert.deepEqual((await third.lobby("join", { code })).body, { error: "room-full" });
  const forged = client(url, `${host.cookie.split("=")[0]}=${"a".repeat(43)}`);
  assert.equal((await forged.lobby("create")).status, 401);
});

test("only the host can start after both verified seats are ready", async (context) => {
  const { host, guest, code, edition, join, checkIn, ready, setTime } = await scenario(context);
  assert.equal((await host.act(code, "start")).body.error, "players-not-ready");
  await join();
  const invalid = await checkIn(host, edition.start, { latitude: 0, longitude: 0 });
  assert.equal(invalid.body.error, "outside-radius");
  assert.ok(invalid.body.distanceMeters > 100);
  assert.equal((await host.act(code, "ready", { ready: true })).body.error, "start-unverified");
  await ready(host);
  await ready(guest);
  assert.equal((await guest.act(code, "start")).body.error, "host-only");
  setTime(initialTime + 30_001);
  assert.equal((await host.act(code, "start")).body.error, "players-not-ready");
  assert.equal((await host.room(code)).body.room.deadline, null);
  setTime(initialTime + 40_000);
  await ready(host);
  await ready(guest);
  const first = await host.act(code, "start", { actionId: "start-once" });
  assert.equal(first.body.room.startedAt, initialTime + 40_000);
  assert.equal(first.body.room.deadline, deadline + 40_000);
  setTime(initialTime + 41_000);
  for (const actionId of ["start-once", "new-tap"]) {
    const retry = await host.act(code, "start", { actionId });
    assert.equal(retry.body.room.startedAt, first.body.room.startedAt);
    assert.equal(retry.body.room.deadline, first.body.room.deadline);
    assert.deepEqual(retry.body.room.events, [{ type: "started", at: initialTime + 40_000 }]);
  }
});

test("two correct submissions assign one owner and a lost acknowledgement reuses the committed claim", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "kelana-duo-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const setup = await scenario(context, join(directory, "trial.sqlite"));
  const { host, guest, code, edition, start, visit, close, options } = setup;
  await start();
  const second = await listen(context, options);
  const rival = client(second.url, guest.cookie);
  const point = edition.checkpoints[0];
  const hostAnswer = await visit(host, 0);
  assert.equal((await rival.challenge(code, point)).body.error, "visit-required");
  assert.deepEqual((await rival.room(code)).body.room.visits, {});
  const guestAnswer = await visit(rival, 0);
  assert.deepEqual(hostAnswer, guestAnswer);
  const entries = [[host, hostAnswer], [rival, guestAnswer]];
  const replies = await Promise.all(entries.map(([player, answer]) =>
    player.act(code, "answer", { ...answer, actionId: "same-client-action-id" })));
  const winner = replies.findIndex(({ body }) => body.error === undefined);
  assert.notEqual(winner, -1);
  const loser = replies[1 - winner].body;
  const owner = ["host", "guest"][winner];
  assert.equal(loser.error, "already-claimed");
  assert.deepEqual(loser.room.owners, { [point.id]: owner });
  assert.equal(loser.room.landmarks[owner], 1);
  assert.deepEqual(loser.room.zones[0], { name: "Blok M", host: Number(owner === "host"), guest: Number(owner === "guest"), owner });
  const events = [{ type: "started", at: initialTime }, { type: "claimed", at: initialTime, seat: owner, checkpointId: point.id }];
  assert.deepEqual(loser.room.events, events);
  await close();
  await second.close();

  const restarted = await listen(context, options);
  const resumedWinner = client(restarted.url, entries[winner][0].cookie);
  const retry = await resumedWinner.act(code, "answer", { ...hostAnswer, actionId: "same-client-action-id" });
  assert.equal(retry.body.error, undefined);
  assert.deepEqual(retry.body.room.events, events);
  const resumedLoser = client(restarted.url, entries[1 - winner][0].cookie);
  const reconnected = await resumedLoser.room(code);
  assert.deepEqual(reconnected.body.room.events, events);
  assert.deepEqual(reconnected.body.room.owners, retry.body.room.owners);
  assert.equal((await resumedLoser.challenge(code, point)).body.error, "already-claimed");
  assert.doesNotMatch(JSON.stringify(reconnected.body.room), /correctChoice|answerKey|choiceId|prompt|accuracy|timestamp/i);
});

test("a zone moves from host control to neutral to guest control while ownership remains fixed", async (context) => {
  const { host, guest, code, edition, start, claim, visit } = await scenario(context);
  await start();
  const [first, second, third] = edition.checkpoints;
  assert.deepEqual((await claim(host, 0)).body.room.zones[0], { name: "Blok M", host: 1, guest: 0, owner: "host" });
  assert.deepEqual((await claim(guest, 1)).body.room.zones[0], { name: "Blok M", host: 1, guest: 1, owner: null });
  const answer = { ...await visit(guest, 2), actionId: "flip-zone" };
  await guest.act(code, "answer", answer);
  const retry = await guest.act(code, "answer", answer);
  assert.deepEqual(retry.body.room.zones[0], { name: "Blok M", host: 1, guest: 2, owner: "guest" });
  const observed = (await host.room(code)).body.room;
  assert.deepEqual(observed.owners, { [first.id]: "host", [second.id]: "guest", [third.id]: "guest" });
  assert.deepEqual(observed.events.map(({ type }) => type), ["started", "claimed", "claimed", "claimed"]);
});

test("only the visiting seat receives its challenge, cooldown and fix feedback", async (context) => {
  const { host, guest, code, edition, start, visit, fix, checkIn, setTime } = await scenario(context);
  await start();
  const point = edition.checkpoints[0];
  assert.equal((await checkIn(host, point, { timestamp: initialTime - 30_001 })).body.error, "stale-fix");
  assert.equal((await checkIn(host, point, { accuracy: 51 })).body.error, "inaccurate-fix");
  const right = await visit(host, 0);
  const opened = await host.challenge(code, point);
  assert.equal(opened.body.challenge.checkpointId, point.id);
  assert.doesNotMatch(JSON.stringify(opened.body.challenge), /correctChoice|answerKey/i);
  const wrong = opened.body.challenge.choices[0].id;
  assert.equal((await host.act(code, "answer", { ...right, choiceId: wrong })).body.error, "wrong-answer");
  const rival = (await guest.room(code)).body;
  assert.deepEqual(rival.room.visits, {});
  assert.deepEqual(rival.room.cooldowns, {});
  assert.equal(rival.challenge, undefined);
  assert.equal((await host.act(code, "answer", right)).body.error, "cooldown");
  setTime(initialTime + 30_001);
  assert.deepEqual((await host.challenge(code, point)).body.challenge, opened.body.challenge);
  assert.equal((await host.act(code, "answer", right)).body.error, "fresh-fix-required");
  assert.equal((await host.act(code, "answer", { ...right, fix: fix(point) })).body.room.owners[point.id], "host");
});

test("at the exact deadline a late claim and exit cannot replace the authoritative result", async (context) => {
  const { url, host, guest, code, start, claim, visit, setTime } = await scenario(context);
  await start();
  await claim(guest, 4);
  setTime(deadline - 1);
  await claim(host, 0);
  await claim(host, 1);
  const attempted = await visit(guest, 2);
  setTime(deadline);
  const late = await guest.act(code, "answer", attempted);
  assert.equal(late.body.error, "round-finished");
  assert.equal(late.body.room.phase, "finished");
  assert.deepEqual(late.body.room.outcome, { winner: "host", reason: "time" });
  assert.deepEqual(late.body.room.events.at(-1), { type: "finished", at: deadline });
  assert.deepEqual(late.body.room.landmarks, { host: 2, guest: 1 });
  const resumed = client(url, host.cookie);
  assert.deepEqual((await resumed.room(code)).body.room.events, late.body.room.events);
  const lateLeave = await resumed.act(code, "leave", { phase: "lobby" });
  assert.equal(lateLeave.body.error, "round-finished");
  assert.deepEqual(lateLeave.body.room.outcome, late.body.room.outcome);
});

test("owning all landmarks finishes once and equal zones and landmarks draw", async (context) => {
  const { host, guest, code, start, claim } = await scenario(context);
  await start();
  for (const index of [0, 1, 4]) await claim(host, index);
  for (const index of [2, 3]) await claim(guest, index);
  const finish = await claim(guest, 5);
  assert.equal(finish.body.room.phase, "finished");
  assert.deepEqual(finish.body.room.outcome, { winner: null, reason: "all-claimed" });
  assert.deepEqual(finish.body.room.zones.map(({ owner }) => owner), [null, null]);
  assert.equal(finish.body.room.events.filter(({ type }) => type === "finished").length, 1);
  assert.deepEqual((await host.room(code)).body.room.outcome, finish.body.room.outcome);
});

test("a player who leaves an active room forfeits even when ahead", async (context) => {
  const { host, guest, code, start, claim } = await scenario(context);
  await start();
  await claim(guest, 0);
  const left = await guest.act(code, "leave", { actionId: "leave-once", phase: "active" });
  const retry = await guest.act(code, "leave", { actionId: "leave-once", phase: "active" });
  assert.deepEqual(left.body.room.outcome, { winner: "host", reason: "forfeit" });
  assert.deepEqual(retry.body.room.events, left.body.room.events);
  assert.deepEqual((await host.room(code)).body.room.outcome, left.body.room.outcome);
});

test("an unqualified leave cannot change a room", async (context) => {
  const { guest, code, start } = await scenario(context);
  await start();
  const leave = await guest.act(code, "leave");
  assert.equal(leave.status, 400);
  assert.equal(leave.body.error, "invalid-request");
  assert.equal((await guest.room(code)).body.room.phase, "active");
});

test("a lobby leave delayed until after Start requires a separate active forfeit", async (context) => {
  const { host, guest, code, join, ready } = await scenario(context);
  await join();
  await ready(host);
  await ready(guest);
  assert.equal((await guest.room(code)).body.room.phase, "lobby");

  const started = (await host.act(code, "start")).body.room;
  const staleLeave = await guest.act(code, "leave", { phase: "lobby" });
  assert.equal(staleLeave.body.error, "room-phase-changed");
  assert.equal(staleLeave.body.room.phase, "active");
  assert.equal(staleLeave.body.room.outcome, null);
  assert.deepEqual(staleLeave.body.room.events, started.events);

  const confirmedForfeit = await guest.act(code, "leave", { phase: "active" });
  assert.equal(confirmedForfeit.body.room.phase, "finished");
  assert.deepEqual(confirmedForfeit.body.room.outcome, { winner: "host", reason: "forfeit" });
});

test("the host can cancel the lobby without a winner", async (context) => {
  const { host, guest, code, join } = await scenario(context);
  await join();
  const canceled = await host.act(code, "leave", { phase: "lobby" });
  assert.equal(canceled.body.room.phase, "canceled");
  assert.deepEqual(canceled.body.room.outcome, { winner: null, reason: "canceled" });
  assert.deepEqual((await guest.room(code)).body.room.events, [{ type: "canceled", at: initialTime, seat: "host" }]);
});

test("controlling more zones wins even with fewer landmarks", async () => {
  const { decideWinner } = await import("../dist/duo-rules.js");
  // Compact has two zones. A three-zone scoring example covers the PRD's 2–1 zone result.
  const zones = [
    { name: "First", host: 1, guest: 0, owner: "host" },
    { name: "Second", host: 1, guest: 0, owner: "host" },
    { name: "Third", host: 0, guest: 3, owner: "guest" },
  ];
  assert.equal(decideWinner(zones, { host: 2, guest: 3 }), "host");
});

test("a released lobby seat can be filled without a stale join or leave taking it back", async (context) => {
  const { url, host, guest, code, join, ready } = await scenario(context);
  await join();
  await ready(host);
  const leave = { actionId: "release-seat", phase: "lobby" };
  assert.deepEqual((await guest.act(code, "leave", leave)).body, {});
  const replacement = client(url);
  await replacement.bootstrap();
  assert.equal((await replacement.lobby("join", { code })).body.room.seat, "guest");
  assert.equal((await join()).status, 403);
  assert.deepEqual((await guest.act(code, "leave", leave)).body, {});
  assert.equal((await replacement.room(code)).body.room.seats.guest.joined, true);
  assert.equal((await host.room(code)).body.room.seats.host.ready, false);
});

test("an offline deadline is committed once by the first reconnected seat", async (context) => {
  const { url, host, guest, code, start, setTime } = await scenario(context);
  await start();
  setTime(deadline + 300_000);
  const resumed = await client(url, guest.cookie).room(code);
  assert.deepEqual(resumed.body.room.outcome, { winner: null, reason: "time" });
  assert.deepEqual(resumed.body.room.events, [
    { type: "started", at: initialTime },
    { type: "finished", at: deadline },
  ]);
  assert.deepEqual((await host.room(code)).body.room.events, resumed.body.room.events);
});

test("retrying after dropping the response body preserves the claim and shows later rival progress", async (context) => {
  const { url, host, guest, code, start, visit, claim } = await scenario(context);
  await start();
  const answer = { type: "answer", actionId: "dropped-response", ...await visit(host, 0) };
  const response = await fetch(`${url}/api/duo/${code}`, {
    method: "POST",
    headers: { cookie: host.cookie, "content-type": "application/json" },
    body: JSON.stringify(answer),
  });
  assert.equal(response.status, 200);
  await response.body.cancel();
  const rivalClaim = (await claim(guest, 1)).body.room;
  const retry = await host.act(code, "answer", answer);
  assert.equal(retry.body.error, undefined);
  assert.deepEqual(retry.body.room.owners, { "taman-literasi": "host", "blok-m-plaza": "guest" });
  assert.deepEqual(retry.body.room.events, rivalClaim.events);
});

test("the losing contender for the last landmark receives its owner and the final score", async (context) => {
  const { host, guest, code, start, visit, claim } = await scenario(context);
  await start();
  for (const index of [0, 1, 2]) await claim(host, index);
  for (const index of [3, 4]) await claim(guest, index);
  const hostAnswer = await visit(host, 5);
  const guestAnswer = await visit(guest, 5);
  const won = await host.act(code, "answer", hostAnswer);
  const lost = await guest.act(code, "answer", guestAnswer);
  assert.equal(lost.body.error, "already-claimed");
  assert.equal(lost.body.room.owners["plaza-senayan"], "host");
  assert.deepEqual(lost.body.room.outcome, { winner: "host", reason: "all-claimed" });
  assert.deepEqual(lost.body.room.events, won.body.room.events);
});
