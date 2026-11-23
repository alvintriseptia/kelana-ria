import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createSoloServer, rulebookStore } from "../dist/index.js";

const start = 1_800_000_000_000;
const host = "h".repeat(43);
const guest = "g".repeat(43);
const third = "t".repeat(43);
const outsider = "o".repeat(43);
let sequence = 0;

const fix = ({ latitude, longitude }, timestamp) => ({ latitude, longitude, timestamp, accuracy: 5 });

function act(store, code, player, at, action) {
  const reply = store.actInRoom(code, player, { actionId: `recap-${++sequence}`, ...action }, at);
  assert.equal(reply.error, undefined, JSON.stringify(action));
  return reply.room;
}

function startMatch(store, format, members) {
  const claim = format === "claim";
  const packId = `official-jakarta-compact-${format}`;
  const edition = store.listPublicListings().find(item => item.packId === packId);
  const created = store.createFreeRoomFromRulebook(
    packId, edition.version, host, "Pemain A", start, false, members.length ? "group" : "solo",
  );
  assert.ok(created.ok, created.error);
  const { roomCode } = created;
  for (const [credential, name] of members) assert.ok(store.joinRoom(roomCode, credential, name, start).ok);
  const point = store.viewRoom(roomCode, host, start).publicBoard.startPoint;
  for (const credential of [host, ...members.map(([key]) => key)]) {
    act(store, roomCode, credential, start, { type: "check-in-start", fix: fix(point, start) });
    act(store, roomCode, credential, start, { type: "ready", ready: true });
  }
  const room = act(store, roomCode, host, start, { type: "start" });
  assert.equal(room.phase, claim ? "active" : "head_start");
  return { roomCode, room };
}

function seekTurn(store, code, hider, seeker, at, answer = false) {
  const before = store.viewRoom(code, hider, at);
  const anchor = before.publicBoard.stations[0];
  act(store, code, hider, at, { type: "lock-anchor", stationId: anchor.id, fix: fix(anchor, at) });
  const seeking = store.viewRoom(code, seeker, before.room.releaseAt).room;
  assert.equal(seeking.phase, "seeking");
  if (answer) {
    const askAt = seeking.now + 1000;
    const questionRoom = act(store, code, seeker, askAt, {
      type: "ask", family: "radar", itemId: "rad-500m", fix: fix(before.publicBoard.startPoint, askAt),
    });
    act(store, code, hider, askAt, { type: "answer-question", questionId: questionRoom.questions[0].id });
  }
  return store.viewRoom(code, hider, seeking.phaseEndsAt).room;
}

test("private rulebook recaps persist authoritative results exactly once and survive restart", async t => {
  const dir = mkdtempSync(join(tmpdir(), "kelana-recaps-"));
  const databasePath = join(dir, "matches.sqlite");
  let server;
  t.after(async () => {
    if (server?.listening) await new Promise(resolve => server.close(resolve));
    rmSync(dir, { recursive: true, force: true });
  });
  const store = rulebookStore(databasePath);
  let solo, group, seek, incomplete, finishedGroup, lastTurn;
  try {
    solo = startMatch(store, "claim", []);
    assert.equal(store.readRecap(solo.roomCode, host), undefined);
    const soloEnd = store.viewRoom(solo.roomCode, host, solo.room.deadline).room;
    const soloRecap = store.readRecap(solo.roomCode, host);
    assert.equal(soloRecap.isSolo, true);
    assert.deepEqual(soloRecap.soloProgress, soloEnd.soloProgress);
    assert.equal(soloRecap.outcome.soloWon, false);
    assert.equal(soloRecap.completedAt, soloEnd.outcome.at);
    assert.equal(soloRecap.editionVersion, 1);

    group = startMatch(store, "claim", [[guest, "Pemain B"], [third, "Pemain C"]]);
    const { landmarks } = store.viewRoom(group.roomCode, host, start).publicBoard;
    for (const [player, id] of [[host, "m-bloc"], [guest, "blok-m-plaza"]]) {
      act(store, group.roomCode, player, start + 1000, {
        type: "check-in-landmark", landmarkId: id, fix: fix(landmarks.find(lm => lm.id === id), start + 1000),
      });
    }
    act(store, group.roomCode, host, start + 2000, { type: "submit-challenge", landmarkId: "m-bloc", inputValue: "2" });
    finishedGroup = store.viewRoom(group.roomCode, host, group.room.deadline).room;
    const groupRecap = store.readRecap(group.roomCode, guest);
    assert.equal(groupRecap.outcome.winnerTeamId, finishedGroup.outcome.winnerTeamId);
    assert.equal(groupRecap.standings[0].zonesControlled, 0);
    assert.equal(groupRecap.standings[0].lockedLandmarks, 1);
    assert.equal(groupRecap.highlights[0].landmark, "M Bloc Space");
    assert.ok(store.readRecap(group.roomCode, third));
    assert.equal(store.readRecap(group.roomCode, outsider), undefined);
    assert.equal(store.viewRoom(group.roomCode, host, group.room.deadline + 1000).room.outcome.at, groupRecap.completedAt);
    assert.equal(store.listRecaps(host).filter(item => item.matchId === group.roomCode).length, 1);
    const tied = startMatch(store, "claim", [[guest, "Pemain B"]]);
    store.viewRoom(tied.roomCode, host, tied.room.deadline);
    assert.equal(store.readRecap(tied.roomCode, guest).outcome.winnerTeamId, null);

    const forfeited = startMatch(store, "claim", [[guest, "Pemain B"]]);
    const leave = { type: "leave", actionId: "leave-and-reopen-recap" };
    const left = store.actInRoom(forfeited.roomCode, guest, leave, start + 1000);
    assert.equal(left.room.outcome.reason, "forfeit");
    assert.deepEqual(store.actInRoom(forfeited.roomCode, guest, leave, start + 2000).room.outcome, left.room.outcome);
    assert.equal(store.listRecaps(guest).filter(item => item.matchId === forfeited.roomCode).length, 1);
    assert.equal(store.readRecap(forfeited.roomCode, guest).outcome.winnerTeamId, left.room.outcome.winnerTeamId);

    seek = startMatch(store, "seek", [[guest, "Pemain B"]]);
    const regroup = seekTurn(store, seek.roomCode, host, guest, start + 1000, true);
    assert.equal(regroup.phase, "regroup");
    const regroupAt = regroup.now + 1000;
    for (const player of [host, guest]) {
      act(store, seek.roomCode, player, regroupAt, { type: "regroup-check-in", fix: fix(regroup.regroupPoint, regroupAt) });
    }
    lastTurn = seekTurn(store, seek.roomCode, guest, host, regroupAt + 1000);
    assert.equal(lastTurn.phase, "finished");
    const seekRecap = store.readRecap(seek.roomCode, host);
    assert.equal(seekRecap.turns.length, 2);
    assert.equal(seekRecap.turns[0].answeredQuestions, 1);
    assert.deepEqual(seekRecap.turns.map(turn => turn.adjustedMs), lastTurn.turns.map(turn => turn.adjustedMs));

    incomplete = startMatch(store, "seek", [[guest, "Pemain B"]]);
    const pending = seekTurn(store, incomplete.roomCode, host, guest, start + 1000);
    store.viewRoom(incomplete.roomCode, host, pending.phaseEndsAt);
    assert.equal(store.readRecap(incomplete.roomCode, guest).phase, "incomplete");
    assert.equal(store.readRecap(incomplete.roomCode, guest).outcome.reason, "regroup_timeout");
  } finally {
    store.close();
  }

  server = createSoloServer({ databasePath });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}/api/rulebooks`;
  const fetchFor = (path, credential) => fetch(base + path, { headers: { cookie: `kelana_rulebook=${credential}` } });
  assert.equal((await fetchFor(`/rooms/${seek.roomCode}`, host)).status, 404);
  assert.equal((await fetchFor(`/recaps/${group.roomCode}`, outsider)).status, 404);
  assert.deepEqual((await (await fetchFor("/recaps", outsider)).json()).recaps, []);
  const list = (await (await fetchFor("/recaps", guest)).json()).recaps;
  assert.equal(list.filter(item => item.matchId === group.roomCode).length, 1);
  assert.equal(list.some(item => item.matchId === solo.roomCode), false);
  const restored = (await (await fetchFor(`/recaps/${seek.roomCode}`, guest)).json()).recap;
  assert.equal(restored.completedAt, lastTurn.outcome.at);
  assert.equal(restored.outcome.winnerSeatId, lastTurn.outcome.winnerSeatId);
  assert.doesNotMatch(JSON.stringify(restored), /latitude|longitude|anchorStationId|foundCode|privateComputedAnswer|photoId|overlay|cardId|credentialHash/);
});
