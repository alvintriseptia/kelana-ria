import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import * as api from "../dist/index.js";

const initialTime = 1_800_000_000_000;
const duration = 60 * 60 * 1000;
const correctIndexes = [1, 0, 2, 1, 2, 0];

async function listen(context, options) {
  assert.equal(typeof api.createSoloServer, "function", "the workspace exports its Solo HTTP server");
  const server = api.createSoloServer(options);
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
  let session;
  let nextAction = 0;
  async function request(path, body) {
    const headers = {};
    if (cookie) headers.cookie = cookie;
    if (body !== undefined) headers["content-type"] = "application/json";
    const response = await fetch(`${url}${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const setCookie = response.headers.get("set-cookie");
    if (setCookie) cookie = setCookie.split(";")[0];
    const data = await response.json();
    if (data.session) session = data.session;
    return { ...data, status: response.status, setCookie };
  }
  return {
    get: () => request("/api/solo"),
    challenge: (point) => request(`/api/solo/challenge?checkpointId=${point.id}`),
    post: (type, fields = {}) => request("/api/solo", {
      type,
      actionId: `action-${++nextAction}`,
      sessionId: session?.id,
      ...fields,
    }),
    get session() { return session; },
    get cookie() { return cookie; },
  };
}

async function scenario(context) {
  let now = initialTime;
  const { url } = await listen(context, { databasePath: ":memory:", now: () => now });
  const player = client(url);
  await player.get();
  function fix(point, overrides = {}) {
    return { latitude: point.latitude, longitude: point.longitude, accuracy: 12, timestamp: now, ...overrides };
  }
  function checkIn(point, overrides, fields) {
    return player.post("check-in", { checkpointId: point.id, fix: fix(point, overrides), ...fields });
  }
  function checkpoint(index) { return player.session.edition.checkpoints[index]; }
  async function start() {
    assert.equal((await checkIn(player.session.edition.start)).error, undefined);
    const outcome = await player.post("start");
    assert.equal(outcome.session.phase, "active");
    return outcome;
  }
  async function claim(index, fields) {
    const point = checkpoint(index);
    const visit = await checkIn(point);
    assert.equal(visit.error, undefined);
    const choiceId = visit.challenge.choices[correctIndexes[index]].id;
    return player.post("answer", { checkpointId: point.id, choiceId, ...fields });
  }
  return { url, player, fix, checkIn, checkpoint, start, claim, setTime: (value) => { now = value; } };
}

test("a private browser credential resumes its briefing without exposing answer keys", async (context) => {
  const { url } = await listen(context, { databasePath: ":memory:", now: () => initialTime });
  const first = client(url);
  const result = await first.get();
  assert.equal(result.status, 200);
  assert.match(result.setCookie, /HttpOnly/i);
  assert.match(result.setCookie, /SameSite=(Strict|Lax)/i);
  assert.equal(result.session.phase, "briefing");
  assert.equal(result.session.deadline, null);
  assert.deepEqual(result.session.edition.targets, { landmarks: 4, zones: 2 });
  assert.equal(result.session.edition.checkpoints.length, 6);
  assert.doesNotMatch(JSON.stringify(result.session), /correctChoice|answerKey|prompt|choiceId/i);
  assert.equal((await first.challenge(first.session.edition.checkpoints[0])).challenge, undefined);
  assert.equal((await client(url, first.cookie).get()).session.id, result.session.id);
  assert.notEqual((await client(url).get()).session.id, result.session.id);
});

test("a confirmed start is required and duplicate Start retains the original deadline", async (context) => {
  const { player, checkIn, setTime } = await scenario(context);
  const startPin = player.session.edition.start;
  const rejected = await checkIn(startPin, { latitude: 0, longitude: 0 });
  assert.equal(rejected.error, "outside-radius");
  assert.ok(rejected.distanceMeters > 100);
  assert.equal((await player.post("start")).error, "start-unverified");
  assert.equal(player.session.deadline, null);
  assert.deepEqual(player.session.events, []);
  await checkIn(startPin, { accuracy: 50, timestamp: initialTime - 30_000 });
  const active = await player.post("start", { actionId: "start-once" });
  assert.equal(active.session.startedAt, initialTime);
  assert.equal(active.session.deadline, initialTime + duration);
  setTime(initialTime + 1000);
  for (const actionId of ["start-once", "another-start-tap"]) {
    const duplicate = await player.post("start", { actionId });
    assert.equal(duplicate.session.deadline, initialTime + duration);
    assert.deepEqual(duplicate.session.events, [{ type: "started", at: initialTime }]);
  }
});

test("location rejection creates no visit and an expired visit needs a fresh fix on answer", async (context) => {
  const { player, checkIn, checkpoint, start, fix, setTime } = await scenario(context);
  await start();
  const point = checkpoint(0);
  for (const [changes, code] of [
    [{ timestamp: initialTime - 30_001 }, "stale-fix"],
    [{ timestamp: initialTime + 1 }, "stale-fix"],
    [{ accuracy: 51 }, "inaccurate-fix"],
    [{ latitude: 0, longitude: 0 }, "outside-radius"],
    [{ latitude: -100 }, "invalid-fix"],
  ]) {
    const rejected = await checkIn(point, changes);
    assert.equal(rejected.error, code);
    assert.equal(rejected.challenge, undefined);
    assert.deepEqual(rejected.session.visits, {});
    assert.deepEqual(rejected.session.claimed, []);
  }
  assert.equal((await player.challenge(point)).error, "visit-required");
  const { challenge } = await checkIn(point);
  assert.equal(challenge.checkpointId, point.id);
  assert.doesNotMatch(JSON.stringify(challenge), /correctChoice|answerKey/i);
  setTime(initialTime + 30_001);
  assert.deepEqual((await player.challenge(point)).challenge, challenge);
  const answer = { checkpointId: point.id, choiceId: challenge.choices[1].id };
  assert.equal((await player.post("answer", answer)).error, "fresh-fix-required");
  assert.equal((await player.post("answer", { ...answer, fix: fix(point, { accuracy: 51 }) })).error, "inaccurate-fix");
  assert.deepEqual((await player.post("answer", { ...answer, fix: fix(point) })).session.claimed, [point.id]);
});

test("wrong answers enforce a 30-second cooldown and duplicated acknowledgments do not claim twice", async (context) => {
  const { player, checkpoint, checkIn, start, fix, setTime } = await scenario(context);
  await start();
  const point = checkpoint(0);
  const { challenge } = await checkIn(point);
  const wrong = { checkpointId: point.id, choiceId: challenge.choices[0].id, actionId: "wrong" };
  const wrongAnswer = await player.post("answer", wrong);
  assert.equal(wrongAnswer.error, "wrong-answer");
  assert.deepEqual(wrongAnswer.session.claimed, []);
  assert.equal(wrongAnswer.session.cooldowns[point.id], initialTime + 30_000);
  setTime(initialTime + 29_999);
  assert.equal((await player.post("answer", wrong)).session.cooldowns[point.id], initialTime + 30_000);
  const right = { checkpointId: point.id, choiceId: challenge.choices[1].id, actionId: "claim-once" };
  assert.equal((await player.post("answer", { ...right, actionId: "still-cooling" })).error, "cooldown");
  setTime(initialTime + 30_000);
  await Promise.all([player.post("answer", { ...right, fix: fix(point) }), player.post("answer", right)]);
  const retry = await player.post("answer", right);
  assert.deepEqual(retry.session.claimed, [point.id]);
  assert.equal(retry.error, undefined);
  assert.equal(retry.session.events.filter(({ type }) => type === "claimed").length, 1);
});

test("the fourth claim wins across two zones and a completed result survives an API restart", async (context) => {
  let now = initialTime;
  const directory = await mkdtemp(join(tmpdir(), "kelana-solo-"));
  context.after(() => rm(directory, { force: true, recursive: true }));
  const options = { databasePath: join(directory, "solo.sqlite"), now: () => now };
  const first = await listen(context, options);
  const player = client(first.url);
  const { session } = await player.get();
  const fix = (point) => ({ latitude: point.latitude, longitude: point.longitude, timestamp: now, accuracy: 6 });
  const checkIn = (point) => player.post("check-in", { checkpointId: point.id, fix: fix(point) });
  await checkIn(session.edition.start);
  await player.post("start");
  for (const index of [0, 1, 4, 2]) {
    const point = session.edition.checkpoints[index];
    const { challenge } = await checkIn(point);
    await player.post("answer", { checkpointId: point.id, choiceId: challenge.choices[correctIndexes[index]].id });
  }
  assert.equal(player.session.phase, "won");
  assert.equal(player.session.claimed.length, 4);
  assert.deepEqual(player.session.zones, ["Blok M", "Senayan"]);
  const events = player.session.events;
  await first.close();
  now += duration + 10_000;
  const second = await listen(context, options);
  const resumed = client(second.url, player.cookie);
  assert.deepEqual((await resumed.get()).session.events, events);
  assert.equal(resumed.session.phase, "won");
  assert.equal(resumed.session.id, session.id);
  assert.equal((await resumed.post("abandon", { actionId: "late-abandon" })).session.phase, "won");
});

test("four claims in Blok M stay active and a fifth from Senayan a millisecond before expiry wins", async (context) => {
  const { player, start, claim, setTime } = await scenario(context);
  await start();
  for (let index = 0; index < 4; index++) await claim(index);
  assert.equal(player.session.claimed.length, 4);
  assert.deepEqual(player.session.zones, ["Blok M"]);
  assert.equal(player.session.phase, "active");
  setTime(initialTime + duration - 1);
  const { session } = await claim(4, { actionId: "winning-claim" });
  assert.equal(session.phase, "won");
  assert.equal(session.events.at(-1).at, initialTime + duration - 1);
  setTime(initialTime + duration);
  const { session: retried } = await player.post("answer", { actionId: "winning-claim", checkpointId: "stadion-madya", choiceId: "any-choice" });
  assert.deepEqual(retried.events, session.events);
  assert.equal(retried.phase, "won");
});

test("expiry takes precedence at the exact deadline and late actions cannot overwrite a loss", async (context) => {
  const { url, player, start, claim, checkIn, checkpoint, setTime } = await scenario(context);
  await start();
  for (let index = 0; index < 4; index++) await claim(index);
  setTime(initialTime + duration - 1);
  const point = checkpoint(4);
  const { challenge } = await checkIn(point);
  setTime(initialTime + duration);
  const { session } = await player.post("answer", { checkpointId: point.id, choiceId: challenge.choices[2].id });
  assert.equal(session.phase, "lost");
  assert.equal(session.claimed.length, 4);
  assert.deepEqual(session.events.at(-1), { type: "expired", at: initialTime + duration });
  const connected = client(url, player.cookie);
  assert.deepEqual((await connected.get()).session, session);
  assert.deepEqual((await connected.post("abandon", { actionId: "late-abandon" })).session.events, session.events);
});

test("abandonment can be replayed once and stale tabs cannot abandon the new round", async (context) => {
  const { player, start } = await scenario(context);
  await start();
  const original = player.session.id;
  const abandoned = await player.post("abandon");
  assert.equal(abandoned.session.phase, "abandoned");
  assert.equal(abandoned.session.events.at(-1).type, "abandoned");
  const replay = { actionId: "replay-once", sessionId: original };
  const { session } = await player.post("replay", replay);
  assert.notEqual(session.id, original);
  assert.equal(session.phase, "briefing");
  assert.equal(session.deadline, null);
  assert.deepEqual(session.events, []);
  assert.deepEqual(session.edition, abandoned.session.edition);
  assert.equal((await player.post("replay", replay)).session.id, session.id);
  const stale = await player.post("abandon", { sessionId: original });
  assert.equal(stale.error, "stale-session");
  assert.equal(stale.session.id, session.id);
  assert.equal(stale.session.phase, "briefing");
});

test("a delayed location check cannot replace a newer verification", async (context) => {
  const { player, checkIn, checkpoint, setTime } = await scenario(context);
  const startPin = player.session.edition.start;
  await checkIn(startPin);
  await checkIn(startPin, { timestamp: initialTime - 20_000 });
  setTime(initialTime + 20_000);
  assert.equal((await player.post("start")).session.phase, "active");
  const point = checkpoint(0);
  await checkIn(point);
  const { challenge } = await checkIn(point, { timestamp: initialTime });
  setTime(initialTime + 40_000);
  const answer = await player.post("answer", { checkpointId: point.id, choiceId: challenge.choices[1].id });
  assert.deepEqual(answer.session.claimed, [point.id]);
});

test("a reconnect after an offline deadline commits expiry once", async (context) => {
  const { url, player, start, setTime } = await scenario(context);
  await start();
  setTime(initialTime + duration + 60_000);
  const reconnected = client(url, player.cookie);
  const { session } = await reconnected.get();
  assert.equal(session.phase, "lost");
  assert.deepEqual(session.events, [
    { type: "started", at: initialTime },
    { type: "expired", at: initialTime + duration },
  ]);
  assert.deepEqual((await reconnected.get()).session.events, session.events);
});
