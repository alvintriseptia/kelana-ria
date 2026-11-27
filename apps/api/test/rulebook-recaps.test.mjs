import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createSoloServer, rulebookStore } from "../dist/index.js";
import { TEST_ADMIN } from "./auth-client.mjs";

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

test("community recap sharing is private by default, strips private fields, supports unshare, and isolates edition versions", async t => {
  const dir = mkdtempSync(join(tmpdir(), "kelana-shared-recaps-"));
  const databasePath = join(dir, "shared.sqlite");
  let server;
  t.after(async () => {
    if (server?.listening) await new Promise(resolve => server.close(resolve));
    rmSync(dir, { recursive: true, force: true });
  });

  const creator = "c".repeat(43);
  const store = rulebookStore(databasePath);
  let claimV1Code, claimV2Code, seekCode;
  const customPackId = "komunitas-blok-m-claim";
  try {
    // Publish v1 of a custom creator edition and complete a match on v1.
    const clonedV1 = store.cloneOfficialTemplate("official-jakarta-compact-claim", creator, {
      packId: customPackId, title: "Edisi Komunitas Blok M", byline: "Tim Komunitas", priceIdr: 0,
    }, start);
    assert.ok(clonedV1.ok, clonedV1.error);
    assert.ok(store.submitDraft(creator, customPackId, 1, start).ok);
    assert.ok(store.reviewVersion(customPackId, 1, { action: "publish" }, TEST_ADMIN, start).ok);

    const createdV1 = store.createFreeRoomFromRulebook(customPackId, 1, host, "Rahasia Host", start, false, "group");
    assert.ok(createdV1.ok, createdV1.error);
    claimV1Code = createdV1.roomCode;
    assert.ok(store.joinRoom(claimV1Code, guest, "Rahasia Guest", start).ok);
    const boardV1 = store.viewRoom(claimV1Code, host, start).publicBoard;
    for (const member of [host, guest]) {
      act(store, claimV1Code, member, start, { type: "check-in-start", fix: fix(boardV1.startPoint, start) });
      act(store, claimV1Code, member, start, { type: "ready", ready: true });
    }
    const startedV1 = act(store, claimV1Code, host, start, { type: "start" });
    const lm = boardV1.landmarks.find(item => item.id === "m-bloc") ?? boardV1.landmarks[0];
    act(store, claimV1Code, host, start + 1000, { type: "check-in-landmark", landmarkId: lm.id, fix: fix(lm, start + 1000) });
    act(store, claimV1Code, host, start + 2000, { type: "submit-challenge", landmarkId: lm.id, inputValue: "2" });
    store.viewRoom(claimV1Code, host, startedV1.deadline);

    // Publish v2 of the SAME packId and complete a match on v2.
    const clonedV2 = store.cloneOfficialTemplate("official-jakarta-compact-claim", creator, {
      packId: customPackId, title: "Edisi Komunitas Blok M Rev 2", byline: "Tim Komunitas", priceIdr: 0,
    }, start + 5000);
    assert.ok(clonedV2.ok, clonedV2.error);
    assert.equal(clonedV2.record.version, 2);
    assert.ok(store.submitDraft(creator, customPackId, 2, start + 5000).ok);
    assert.ok(store.reviewVersion(customPackId, 2, { action: "publish" }, TEST_ADMIN, start + 5000).ok);

    const createdV2 = store.createFreeRoomFromRulebook(customPackId, 2, host, "Nama Ruang V2", start + 6000, false, "solo");
    assert.ok(createdV2.ok, createdV2.error);
    claimV2Code = createdV2.roomCode;
    const boardV2 = store.viewRoom(claimV2Code, host, start + 6000).publicBoard;
    act(store, claimV2Code, host, start + 6000, { type: "check-in-start", fix: fix(boardV2.startPoint, start + 6000) });
    act(store, claimV2Code, host, start + 6000, { type: "ready", ready: true });
    const startedV2 = act(store, claimV2Code, host, start + 6000, { type: "start" });
    store.viewRoom(claimV2Code, host, startedV2.deadline);

    // Also finish a Hide & Seek match on official compact seek.
    const seek = startMatch(store, "seek", [[guest, "Sembunyi Rahasia"]]);
    seekCode = seek.roomCode;
    const regroup = seekTurn(store, seekCode, host, guest, start + 1000, true);
    const regroupAt = regroup.now + 1000;
    for (const member of [host, guest]) {
      act(store, seekCode, member, regroupAt, { type: "regroup-check-in", fix: fix(regroup.regroupPoint, regroupAt) });
    }
    seekTurn(store, seekCode, guest, host, regroupAt + 1000);
  } finally {
    store.close();
  }

  server = createSoloServer({ databasePath });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}/api/rulebooks`;
  const get = (path, cred) => fetch(base + path, cred ? { headers: { cookie: `kelana_rulebook=${cred}` } } : undefined);
  const post = (path, body, cred) => fetch(base + path, {
    method: "POST",
    headers: { "content-type": "application/json", ...(cred ? { cookie: `kelana_rulebook=${cred}` } : {}) },
    body: JSON.stringify(body),
  });

  // Private by default: visitor cannot open private recap, public list is empty, outsider cannot publish.
  assert.equal((await get(`/recaps/${claimV1Code}`)).status, 404);
  assert.equal((await get(`/recaps/${claimV1Code}`, outsider)).status, 404);
  assert.deepEqual((await (await get("/shared")).json()).recaps, []);
  assert.equal((await post(`/recaps/${claimV1Code}/share`, {}, outsider)).status, 404);
  const privateDetail = await (await get(`/recaps/${claimV1Code}`, host)).json();
  assert.equal(privateDetail.share, null);
  assert.equal(privateDetail.publicRecap, null);

  // Participant shares v1 with default anonymous aliases (room names must NOT leak!).
  const sharedV1Res = await post(`/recaps/${claimV1Code}/share`, {}, host);
  assert.equal(sharedV1Res.status, 200);
  const sharedV1 = await sharedV1Res.json();
  assert.match(sharedV1.share.shareId, /^SR-[\dA-F]{12}$/);
  assert.equal(sharedV1.publicRecap.editionVersion, 1);
  assert.equal(sharedV1.publicRecap.editionHref, `/?edition=${customPackId}&version=1`);
  assert.deepEqual(sharedV1.publicRecap.players.map(p => p.alias), ["Pemain 1", "Pemain 2"]);

  // Visitor reads the public recap and catalog without any cookie.
  const visitorV1 = await (await get(`/shared/${sharedV1.share.shareId}`)).json();
  const v1Json = JSON.stringify(visitorV1);
  assert.equal(visitorV1.recap.shareId, sharedV1.share.shareId);
  assert.doesNotMatch(v1Json, /Rahasia Host|Rahasia Guest/);
  assert.equal(v1Json.includes(claimV1Code), false, "Public payload must never include room code / matchId");
  assert.doesNotMatch(v1Json, /matchId|seatId|teamId|credentialHash|latitude|longitude|photoId|anchorStationId|foundCode|cardId/);

  // Publish v2 with a custom alias attempting to embed a room code -> room code is stripped.
  const v2Recap = (await (await get(`/recaps/${claimV2Code}`, host)).json()).recap;
  const v2Seat = v2Recap.players[0].seatId;
  const sharedV2 = await (await post(`/recaps/${claimV2Code}/share`, {
    aliases: { [v2Seat]: `Penjelajah ${claimV2Code} Jaya` },
  }, host)).json();
  assert.equal(sharedV2.publicRecap.editionVersion, 2);
  assert.equal(sharedV2.publicRecap.editionHref, `/?edition=${customPackId}&version=2`);
  assert.equal(sharedV2.publicRecap.players[0].alias, "Penjelajah Jaya");
  assert.equal(JSON.stringify(sharedV2.publicRecap).includes(claimV2Code), false);

  // Edition version isolation: v1 and v2 list ONLY their respective shared matches.
  const v1List = (await (await get(`/shared?edition=${customPackId}&version=1`)).json()).recaps;
  const v2List = (await (await get(`/shared?edition=${customPackId}&version=2`)).json()).recaps;
  assert.deepEqual(v1List.map(item => item.shareId), [sharedV1.share.shareId]);
  assert.deepEqual(v2List.map(item => item.shareId), [sharedV2.share.shareId]);
  assert.equal(v1List[0].editionHref, `/?edition=${customPackId}&version=1`);
  assert.equal(v2List[0].editionHref, `/?edition=${customPackId}&version=2`);

  // Edition with no shared matches returns an empty list gracefully.
  assert.deepEqual((await (await get("/shared?edition=official-jakarta-wide-claim&version=1")).json()).recaps, []);

  // Share Hide & Seek recap and confirm zero private clue / hiding location / photo / credential fields.
  const sharedSeek = await (await post(`/recaps/${seekCode}/share`, { useApprovedRoomNames: true }, guest)).json();
  const seekPublic = await (await get(`/shared/${sharedSeek.share.shareId}`)).json();
  const seekJson = JSON.stringify(seekPublic);
  assert.equal(seekPublic.recap.format, "hide-and-seek");
  assert.equal(seekPublic.recap.turns.length, 2);
  assert.equal(seekPublic.recap.turns[0].answeredQuestions, 1);
  assert.equal(seekJson.includes(seekCode), false);
  assert.doesNotMatch(seekJson, /matchId|seatId|hiderSeatId|credentialHash|latitude|longitude|anchorStationId|foundCode|photoId|overlay|cardId|privateComputedAnswer/);

  // Catalog endpoint exposes sharedRecaps for edition pages without extra requests.
  const catalog = await (await get("/catalog")).json();
  assert.equal(catalog.sharedRecaps.filter(r => r.packId === customPackId && r.editionVersion === 1).length, 1);
  assert.equal(catalog.sharedRecaps.filter(r => r.packId === customPackId && r.editionVersion === 2).length, 1);

  // Outsider cannot unshare; participant unshares -> disappears from public link & edition list, private recap stays intact!
  assert.equal((await post(`/recaps/${claimV1Code}/unshare`, {}, outsider)).status, 404);
  const unshared = await (await post(`/recaps/${claimV1Code}/unshare`, {}, guest)).json();
  assert.equal(unshared.share, null);
  assert.equal((await get(`/shared/${sharedV1.share.shareId}`)).status, 404);
  assert.deepEqual((await (await get(`/shared?edition=${customPackId}&version=1`)).json()).recaps, []);
  const stillPrivate = await (await get(`/recaps/${claimV1Code}`, host)).json();
  assert.equal(stillPrivate.recap.matchId, claimV1Code);
  assert.equal(stillPrivate.share, null);

  // Re-sharing generates a brand-new shareId so the previously revoked link remains dead.
  const reshared = await (await post(`/recaps/${claimV1Code}/share`, {}, host)).json();
  assert.notEqual(reshared.share.shareId, sharedV1.share.shareId);
  assert.equal((await get(`/shared/${sharedV1.share.shareId}`)).status, 404);
  assert.equal((await get(`/shared/${reshared.share.shareId}`)).status, 200);
});

test("Seek activity restores the current deadline and keeps old question events scoped through a turn change", () => {
  const store = rulebookStore(":memory:");
  try {
    const { roomCode, room: headStart } = startMatch(store, "seek", [[guest, "Pemain B"], [third, "Pemain C"]]);
    const board = store.viewRoom(roomCode, host, start).publicBoard;
    const anchor = board.stations[0];
    act(store, roomCode, host, start, { type: "lock-anchor", stationId: anchor.id, fix: fix(anchor, start) });
    const seeking = store.viewRoom(roomCode, guest, headStart.releaseAt).room;
    const askedAt = seeking.now + 1000;
    const questionAction = {
      type: "ask", family: "radar", itemId: "rad-500m", fix: fix(board.startPoint, askedAt),
      actionId: "activity-radar",
    };
    const first = store.actInRoom(roomCode, guest, questionAction, askedAt);
    assert.equal(first.error, undefined);
    const { deadline } = first.room.questions[0];
    const pending = store.viewRoom(roomCode, host, askedAt).activity;
    assert.equal(pending.prompt.kind, "question");
    assert.equal(pending.prompt.deadline, deadline);
    assert.equal(store.viewRoom(roomCode, guest, askedAt).activity.prompt, null);
    assert.equal(store.viewRoom(roomCode, third, askedAt).activity.events.some(event => event.kind === "question"), false);
    assert.equal(store.viewRoom(roomCode, outsider, askedAt), undefined);
    store.actInRoom(roomCode, guest, questionAction, askedAt);
    assert.deepEqual(store.viewRoom(roomCode, host, askedAt).activity, pending);
    assert.doesNotMatch(JSON.stringify(pending), /"photoId"|"answerCode"|"anchorStationId"|"overlay"|"referencePoint"/);

    const warning = store.viewRoom(roomCode, host, deadline - 20_000).activity;
    assert.match(warning.prompt.text, /hampir habis/);
    assert.notEqual(warning.prompt.id, pending.prompt.id);
    assert.equal(warning.sequence, pending.sequence);
    const expired = store.viewRoom(roomCode, host, deadline).activity;
    assert.equal(expired.prompt, null);
    assert.equal(expired.events.filter(event => event.kind === "question-closed").length, 1);
    const seeker = store.viewRoom(roomCode, guest, deadline).activity;
    assert.equal(seeker.events.find(event => event.kind === "question-closed").alert, true);
    assert.equal(store.viewRoom(roomCode, third, deadline).activity.events.some(event => event.kind === "question-closed"), false);

    const regroup = store.viewRoom(roomCode, guest, seeking.phaseEndsAt);
    assert.equal(regroup.activity.prompt.panel, "regroup");
    for (const player of [host, guest, third]) {
      act(store, roomCode, player, seeking.phaseEndsAt, {
        type: "regroup-check-in", fix: fix(regroup.room.regroupPoint, seeking.phaseEndsAt),
      });
    }
    const nextTurn = store.viewRoom(roomCode, guest, seeking.phaseEndsAt);
    assert.equal(nextTurn.room.role, "hider");
    assert.equal(nextTurn.activity.prompt.kind, "role");
    assert.equal(nextTurn.activity.events.filter(event => event.kind === "question-closed").length, 1);
    assert.equal(store.viewRoom(roomCode, host, seeking.phaseEndsAt).activity.prompt, null);
  } finally {
    store.close();
  }
});
