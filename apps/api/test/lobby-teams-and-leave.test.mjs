import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import * as api from "../dist/index.js";

const T0 = 1_800_100_000_000;
const REVIEWER_KEY = "reviewer-secret-141";

function makeClient(baseUrl) {
  const cookies = new Map();
  function mergeCookies(res) {
    const rawList = typeof res.headers.getSetCookie === "function"
      ? res.headers.getSetCookie()
      : res.headers.get("set-cookie")
        ? [res.headers.get("set-cookie")]
        : [];
    for (const raw of rawList) {
      const [pair] = raw.split(";");
      const eq = pair.indexOf("=");
      if (eq < 0) continue;
      const name = pair.slice(0, eq).trim();
      const value = pair.slice(eq + 1).trim();
      if (!value || /Max-Age=0/i.test(raw)) cookies.delete(name);
      else cookies.set(name, value);
    }
  }
  function cookieHeader() {
    return [...cookies.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
  }
  return {
    cookieHeader,
    async get(path, extraHeaders = {}) {
      const hdr = cookieHeader();
      const res = await fetch(`${baseUrl}${path}`, {
        headers: { ...(hdr ? { cookie: hdr } : {}), ...extraHeaders },
      });
      mergeCookies(res);
      return { status: res.status, headers: res.headers, body: await res.json() };
    },
    async post(path, body, extraHeaders = {}) {
      const hdr = cookieHeader();
      const res = await fetch(`${baseUrl}${path}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(hdr ? { cookie: hdr } : {}),
          ...extraHeaders,
        },
        body: JSON.stringify(body),
      });
      mergeCookies(res);
      return { status: res.status, headers: res.headers, body: await res.json() };
    },
  };
}

async function signIn(client, email, displayName) {
  const req = await client.post("/api/auth/request-otp", { email });
  assert.equal(req.status, 200, JSON.stringify(req.body));
  const ver = await client.post("/api/auth/verify-otp", {
    challengeId: req.body.challengeId,
    code: req.body.sandboxCode,
    displayName,
  });
  assert.equal(ver.status, 200, JSON.stringify(ver.body));
  return ver.body;
}

async function openSseReader(baseUrl, path, cookieHeader) {
  const controller = new AbortController();
  const res = await fetch(`${baseUrl}${path}`, {
    headers: { cookie: cookieHeader },
    signal: controller.signal,
  });
  assert.equal(res.status, 200);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  async function nextEvent(timeoutMs = 3000) {
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      while (true) {
        const sep = buffer.indexOf("\n\n");
        if (sep >= 0) {
          const chunk = buffer.slice(0, sep);
          buffer = buffer.slice(sep + 2);
          if (chunk.startsWith(":")) continue;
          let event = "message";
          let data = "";
          for (const line of chunk.split("\n")) {
            if (line.startsWith("event:")) event = line.slice(6).trim();
            else if (line.startsWith("data:")) data += line.slice(5).trim();
          }
          return { event, data: data ? JSON.parse(data) : null };
        }
        const { value, done } = await reader.read();
        if (done) return null;
        buffer += decoder.decode(value, { stream: true });
      }
    } finally {
      clearTimeout(timer);
    }
  }
  return {
    nextEvent,
    close() {
      controller.abort();
    },
  };
}

test("monotonic seat IDs avoid seat-taken collision on lobby leave & rejoin in Claim and Seek, and universal join-room normalizes codes with format", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "kelana-lobby-seats-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const clock = { now: T0 };
  const server = api.createSoloServer({
    databasePath: join(dir, "db.sqlite"),
    now: () => clock.now,
    allowSandboxAuthOtp: true,
    allowRulebookSandboxCheckout: true,
    rulebookReviewerKey: REVIEWER_KEY,
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  // Claim 3-player lobby leave & rejoin + universal join-room normalization
  const host = makeClient(baseUrl);
  const g2 = makeClient(baseUrl);
  const g3 = makeClient(baseUrl);
  const g4 = makeClient(baseUrl);

  const createdClaim = await host.post("/api/rulebooks/catalog", {
    type: "play",
    edition: "official-jakarta-compact-claim",
    version: 1,
    mode: "group",
    requestId: "req-claim-monotonic-0001",
  });
  assert.equal(createdClaim.status, 200, JSON.stringify(createdClaim.body));
  const claimCode = createdClaim.body.roomCode;
  assert.match(claimCode, /^RC-/);
  // Anonymous guest defaults to "Host"
  assert.equal(createdClaim.body.room.seats[0].name, "Host");

  // Join g2 using lowercase + spaces to verify universal join-room code normalization & format
  const messyClaimCode = `  ${claimCode.toLowerCase().slice(0, 3)} ${claimCode.toLowerCase().slice(3)}  `;
  const join2 = await g2.post("/api/rulebooks", { type: "join-room", roomCode: messyClaimCode, name: "Budi" });
  assert.equal(join2.status, 200, JSON.stringify(join2.body));
  assert.equal(join2.body.format, "claim-the-city");
  assert.equal(join2.body.roomCode, claimCode);
  assert.equal(join2.body.seatId, "seat-2");

  const join3 = await g3.post("/api/rulebooks", { type: "join-room", roomCode: claimCode, name: "Citra" });
  assert.equal(join3.status, 200);
  assert.equal(join3.body.seatId, "seat-3");

  // seat-2 leaves lobby -> seats are now [seat-1, seat-3] (length 2)
  const leave2 = await g2.post("/api/rulebooks", {
    type: "room-action",
    roomCode: claimCode,
    action: { type: "leave", actionId: "leave-seat-2" },
  });
  assert.equal(leave2.status, 200);
  assert.deepEqual(leave2.body.room.seats.map((s) => s.seatId), ["seat-1", "seat-3"]);

  // g4 joins -> MUST get monotonic seat-4 instead of colliding with seat-3 (seat-taken)
  const join4 = await g4.post("/api/rulebooks", { type: "join-room", roomCode: claimCode, name: "Dina" });
  assert.equal(join4.status, 200, JSON.stringify(join4.body));
  assert.equal(join4.body.seatId, "seat-4");
  assert.deepEqual(join4.body.room.seats.map((s) => s.seatId), ["seat-1", "seat-3", "seat-4"]);

  // Hide & Seek 3-player lobby leave & rejoin + universal join-room normalization
  const seekHost = makeClient(baseUrl);
  const s2 = makeClient(baseUrl);
  const s3 = makeClient(baseUrl);
  const s4 = makeClient(baseUrl);
  const createdSeek = await seekHost.post("/api/rulebooks/catalog", {
    type: "play",
    edition: "official-jakarta-compact-seek",
    version: 2,
    mode: "group",
    requestId: "req-seek-monotonic-0001",
  });
  assert.equal(createdSeek.status, 200, JSON.stringify(createdSeek.body));
  const seekCode = createdSeek.body.roomCode;
  assert.match(seekCode, /^RB-/);

  const messySeekCode = ` ${seekCode.toLowerCase().replace("-", " - ")} `;
  const sj2 = await s2.post("/api/rulebooks", { type: "join-room", roomCode: messySeekCode, name: "Eko" });
  assert.equal(sj2.status, 200, JSON.stringify(sj2.body));
  assert.equal(sj2.body.format, "hide-and-seek");
  assert.equal(sj2.body.roomCode, seekCode);
  assert.equal(sj2.body.seatId, "seat-2");

  const sj3 = await s3.post("/api/rulebooks", { type: "join-room", roomCode: seekCode, name: "Fani" });
  assert.equal(sj3.status, 200);
  assert.equal(sj3.body.seatId, "seat-3");

  const sLeave2 = await s2.post("/api/rulebooks", {
    type: "room-action",
    roomCode: seekCode,
    action: { type: "leave", actionId: "seek-leave-2" },
  });
  assert.equal(sLeave2.status, 200);
  assert.deepEqual(sLeave2.body.room.seats.map((s) => s.seatId), ["seat-1", "seat-3"]);

  const sj4 = await s4.post("/api/rulebooks", { type: "join-room", roomCode: seekCode, name: "Gita" });
  assert.equal(sj4.status, 200, JSON.stringify(sj4.body));
  assert.equal(sj4.body.seatId, "seat-4");
  assert.deepEqual(sj4.body.room.seats.map((s) => s.seatId), ["seat-1", "seat-3", "seat-4"]);
});

test("hostName defaults to signed-in displayName and lobby rename-seat validates names in Claim and Seek", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "kelana-rename-seat-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const clock = { now: T0 };
  const server = api.createSoloServer({
    databasePath: join(dir, "db.sqlite"),
    now: () => clock.now,
    allowSandboxAuthOtp: true,
    allowRulebookSandboxCheckout: true,
    rulebookReviewerKey: REVIEWER_KEY,
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  const host = makeClient(baseUrl);
  await signIn(host, "alvin@kelana.test", "Alvin Senayan");

  // Catalog play defaults hostName to signed-in displayName
  const claimRes = await host.post("/api/rulebooks/catalog", {
    type: "play",
    edition: "official-jakarta-compact-claim",
    version: 1,
    mode: "group",
    requestId: "req-host-displayname-01",
  });
  assert.equal(claimRes.status, 200);
  assert.equal(claimRes.body.room.seats[0].name, "Alvin Senayan");
  const claimCode = claimRes.body.roomCode;

  // rename-seat rejects empty, whitespace, and >32 chars
  const emptyRename = await host.post("/api/rulebooks", {
    type: "room-action",
    roomCode: claimCode,
    action: { type: "rename-seat", name: "   ", actionId: "ren-empty" },
  });
  assert.equal(emptyRename.body.error, "invalid-seat-name");

  const longRename = await host.post("/api/rulebooks", {
    type: "room-action",
    roomCode: claimCode,
    action: { type: "rename-seat", name: "A".repeat(33), actionId: "ren-long" },
  });
  assert.equal(longRename.body.error, "invalid-seat-name");

  const okRename = await host.post("/api/rulebooks", {
    type: "room-action",
    roomCode: claimCode,
    action: { type: "rename-seat", name: "  Kapten   Blok M  ", actionId: "ren-ok" },
  });
  assert.equal(okRename.body.error, undefined);
  assert.equal(okRename.body.room.seats[0].name, "Kapten Blok M");

  // Explicit hostName overrides signed-in displayName in Seek
  const seekRes = await host.post("/api/rulebooks/catalog", {
    type: "play",
    edition: "official-jakarta-compact-seek",
    version: 2,
    mode: "group",
    hostName: "Custom Seek Host",
    requestId: "req-host-custom-seek-01",
  });
  assert.equal(seekRes.status, 200);
  assert.equal(seekRes.body.room.seats[0].name, "Custom Seek Host");
  const seekCode = seekRes.body.roomCode;

  const seekBadRename = await host.post("/api/rulebooks", {
    type: "room-action",
    roomCode: seekCode,
    action: { type: "rename-seat", name: "", actionId: "seek-ren-bad" },
  });
  assert.equal(seekBadRename.body.error, "invalid-seat-name");

  const seekOkRename = await host.post("/api/rulebooks", {
    type: "room-action",
    roomCode: seekCode,
    action: { type: "rename-seat", name: "Pemburu MRT", actionId: "seek-ren-ok" },
  });
  assert.equal(seekOkRename.body.error, undefined);
  assert.equal(seekOkRename.body.room.seats[0].name, "Pemburu MRT");
});

test("Host canceling paid-pack lobby via leave notifies guests over SSE and frees 1-active-room slot immediately", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "kelana-paid-cancel-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const clock = { now: T0 };
  const server = api.createSoloServer({
    databasePath: join(dir, "db.sqlite"),
    now: () => clock.now,
    allowSandboxAuthOtp: true,
    allowRulebookSandboxCheckout: true,
    rulebookReviewerKey: REVIEWER_KEY,
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  const creator = makeClient(baseUrl);
  await signIn(creator, "creator-141@kelana.test", "Kreator 141");
  const cloned = await creator.post("/api/rulebooks", {
    type: "clone-official",
    templatePackId: "official-jakarta-compact-claim",
    packId: "pack-paid-cancel-141",
    title: "Paid Cancel Test",
    byline: "Kreator 141",
    priceIdr: 25_000,
  });
  assert.equal(cloned.status, 200, JSON.stringify(cloned.body));
  assert.equal((await creator.post("/api/rulebooks", { type: "submit-draft", packId: "pack-paid-cancel-141", version: 1 })).status, 200);
  assert.equal(
    (await creator.post(
      "/api/rulebooks",
      { type: "publish-version", packId: "pack-paid-cancel-141", version: 1 },
      { authorization: `Bearer ${REVIEWER_KEY}` },
    )).status,
    200,
  );

  // Buyer buys paid pack in group mode -> settlement defaults hostName to signed-in displayName
  const buyer = makeClient(baseUrl);
  await signIn(buyer, "buyer-141@kelana.test", "Pembeli Grup");
  const reqId = "req-paid-cancel-order-01";
  assert.equal((await buyer.post("/api/rulebooks/catalog", {
    type: "buy",
    edition: "pack-paid-cancel-141",
    version: 1,
    mode: "group",
    requestId: reqId,
  })).status, 200);
  const settled = await buyer.post("/api/rulebooks/catalog", {
    type: "simulate-payment",
    edition: "pack-paid-cancel-141",
    version: 1,
    mode: "group",
    requestId: reqId,
  });
  assert.equal(settled.status, 200, JSON.stringify(settled.body));
  const room1 = settled.body.pass.roomCode;
  const room1View = await buyer.get(`/api/rulebooks/rooms/${room1}`);
  assert.equal(room1View.body.room.seats[0].name, "Pembeli Grup");

  // Guest joins room1 and opens SSE stream
  const guest = makeClient(baseUrl);
  assert.equal((await guest.post("/api/rulebooks", { type: "join-room", roomCode: room1, name: "Tamu SSE" })).status, 200);
  const sse = await openSseReader(baseUrl, `/api/rulebooks/rooms/${room1}/events`, guest.cookieHeader());
  t.after(() => sse.close());
  const initialRev = await sse.nextEvent();
  assert.equal(initialRev.event, "rev");

  // While room1 is active, Host cannot open a 2nd room on the same owned pack
  const blockedSecond = await buyer.post("/api/rulebooks/catalog", {
    type: "play",
    edition: "pack-paid-cancel-141",
    version: 1,
    mode: "group",
    requestId: "req-paid-second-blocked",
  });
  assert.equal(blockedSecond.status, 409);
  assert.equal(blockedSecond.body.error, "entitlement-active-room-exists");

  // Host cancels room1 via lobby leave -> guest receives SSE rev -> sees phase === "canceled"
  const cancelRes = await buyer.post("/api/rulebooks", {
    type: "room-action",
    roomCode: room1,
    action: { type: "leave", actionId: "host-cancel-lobby" },
  });
  assert.equal(cancelRes.status, 200);
  assert.equal(cancelRes.body.room.phase, "canceled");
  assert.equal(cancelRes.body.room.outcome.reason, "canceled");

  const nextRev = await sse.nextEvent();
  assert.equal(nextRev.event, "rev");
  assert.ok(nextRev.data.stateRev > initialRev.data.stateRev);
  const guestViewAfter = await guest.get(`/api/rulebooks/rooms/${room1}`);
  assert.equal(guestViewAfter.body.room.phase, "canceled");

  // Host's 1-active-room entitlement slot is immediately freed and opens room2 cleanly
  const openSecond = await buyer.post("/api/rulebooks/catalog", {
    type: "play",
    edition: "pack-paid-cancel-141",
    version: 1,
    mode: "group",
    requestId: "req-paid-second-allowed",
  });
  assert.equal(openSecond.status, 200, JSON.stringify(openSecond.body));
  assert.ok(openSecond.body.roomCode && openSecond.body.roomCode !== room1);
});

test("dynamic Claim teams (set-team, ready reset, not-enough-teams) and multi-team mid-match leave rules", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "kelana-claim-teams-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const clock = { now: T0 };
  const server = api.createSoloServer({
    databasePath: join(dir, "db.sqlite"),
    now: () => clock.now,
    allowSandboxAuthOtp: true,
    allowRulebookSandboxCheckout: true,
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  const p1 = makeClient(baseUrl);
  const p2 = makeClient(baseUrl);
  const p3 = makeClient(baseUrl);
  const p4 = makeClient(baseUrl);

  const created = await p1.post("/api/rulebooks/catalog", {
    type: "play",
    edition: "official-jakarta-compact-claim",
    version: 1,
    mode: "group",
    hostName: "Andi",
    requestId: "req-claim-teams-0001",
  });
  assert.equal(created.status, 200);
  const roomCode = created.body.roomCode;
  const startPoint = (await p1.get(`/api/rulebooks/rooms/${roomCode}`)).body.publicBoard.startPoint;
  const landmarks = (await p1.get(`/api/rulebooks/rooms/${roomCode}`)).body.publicBoard.landmarks;

  assert.equal((await p2.post("/api/rulebooks", { type: "join-room", roomCode, name: "Bela" })).status, 200);
  assert.equal((await p3.post("/api/rulebooks", { type: "join-room", roomCode, name: "Ciko" })).status, 200);
  assert.equal((await p4.post("/api/rulebooks", { type: "join-room", roomCode, name: "Dewi" })).status, 200);

  // Check in and mark ready for all 4 players
  const startFix = { latitude: startPoint.latitude, longitude: startPoint.longitude, accuracy: 8, timestamp: clock.now };
  for (const [idx, client] of [p1, p2, p3, p4].entries()) {
    await client.post("/api/rulebooks", {
      type: "room-action",
      roomCode,
      action: { type: "check-in-start", fix: startFix, actionId: `ci-${idx}` },
    });
    const rdy = await client.post("/api/rulebooks", {
      type: "room-action",
      roomCode,
      action: { type: "ready", ready: true, actionId: `rdy-${idx}` },
    });
    assert.equal(rdy.body.error, undefined);
  }

  // Non-host trying to move another seat must fail with host-only
  const nonHostMove = await p2.post("/api/rulebooks", {
    type: "room-action",
    roomCode,
    action: { type: "set-team", teamId: "team-1", targetSeatId: "seat-3", actionId: "bad-move" },
  });
  assert.equal(nonHostMove.body.error, "host-only");

  // Put everyone onto the SAME team (team-1): p2 moves self, Host moves seat-1, seat-3, seat-4
  const move2 = await p2.post("/api/rulebooks", {
    type: "room-action",
    roomCode,
    action: { type: "set-team", teamId: "team-1", actionId: "m2-t1" },
  });
  assert.equal(move2.body.error, undefined);
  // Changing teams resets ready across all seats
  assert.ok(move2.body.room.seats.every((s) => s.ready === false), "set-team must reset ready flags");

  for (const [idx, targetSeatId] of ["seat-1", "seat-3", "seat-4"].entries()) {
    const mv = await p1.post("/api/rulebooks", {
      type: "room-action",
      roomCode,
      action: { type: "set-team", teamId: "team-1", targetSeatId, actionId: `host-same-${idx}` },
    });
    assert.equal(mv.body.error, undefined);
  }
  for (const [idx, client] of [p1, p2, p3, p4].entries()) {
    await client.post("/api/rulebooks", {
      type: "room-action",
      roomCode,
      action: { type: "ready", ready: true, actionId: `rdy-same-${idx}` },
    });
  }

  // Starting with all players on 1 team must fail with not-enough-teams
  const startSameTeam = await p1.post("/api/rulebooks", {
    type: "room-action",
    roomCode,
    action: { type: "start", actionId: "start-same-team" },
  });
  assert.equal(startSameTeam.body.error, "not-enough-teams");

  // Now form 3 dynamic teams: team-1 (seat-1, seat-2), team-2 (seat-3), team-3 (seat-4) [2v1v1]
  await p3.post("/api/rulebooks", {
    type: "room-action",
    roomCode,
    action: { type: "set-team", teamId: "team-2", actionId: "p3-t2" },
  });
  await p1.post("/api/rulebooks", {
    type: "room-action",
    roomCode,
    action: { type: "set-team", teamId: "team-3", targetSeatId: "seat-4", actionId: "p1-move-p4-t3" },
  });

  // Re-ready all 4 and start
  for (const [idx, client] of [p1, p2, p3, p4].entries()) {
    await client.post("/api/rulebooks", {
      type: "room-action",
      roomCode,
      action: { type: "ready", ready: true, actionId: `rdy-final-${idx}` },
    });
  }
  const started = await p1.post("/api/rulebooks", {
    type: "room-action",
    roomCode,
    action: { type: "start", actionId: "start-3-teams" },
  });
  assert.equal(started.body.error, undefined);
  assert.equal(started.body.room.phase, "active");

  // seat-4 (team-3) claims landmark 0 and sends presence, then leaves mid-match
  const lm0 = landmarks[0];
  const lmFix = { latitude: lm0.latitude, longitude: lm0.longitude, accuracy: 8, timestamp: clock.now };
  const claim4 = await p4.post("/api/rulebooks", {
    type: "room-action",
    roomCode,
    action: { type: "check-in-landmark", landmarkId: lm0.id, fix: lmFix, actionId: "p4-ci-lm0" },
  });
  assert.equal(claim4.body.error, undefined);

  // Confirm room shows up in p4's active rooms before leaving
  const catBeforeLeave = await p4.get("/api/rulebooks/catalog");
  assert.ok(catBeforeLeave.body.activeRooms.some((r) => r.roomCode === roomCode));

  // seat-4 leaves: 2 active teams remain (team-1 and team-2), so match MUST continue!
  clock.now += 5_000;
  const leave4 = await p4.post("/api/rulebooks", {
    type: "room-action",
    roomCode,
    action: { type: "leave", actionId: "p4-mid-leave" },
  });
  assert.equal(leave4.body.error, undefined);
  assert.equal(leave4.body.room.phase, "active", "Match must continue when >= 2 active teams remain");
  assert.equal(leave4.body.room.outcome, null);
  const seat4View = leave4.body.room.seats.find((s) => s.seatId === "seat-4");
  assert.equal(seat4View.leftAt, clock.now);
  assert.equal(seat4View.name, "Dewi");
  // Team-3's claimed landmark attribution is preserved
  const lm0After = leave4.body.room.landmarks.find((l) => l.landmarkId === lm0.id);
  assert.equal(lm0After.ownerTeamId, "team-3");

  // Departed player is removed from listActiveRooms and blocked from further actions & presence pings
  const catAfterLeave = await p4.get("/api/rulebooks/catalog");
  assert.equal(catAfterLeave.body.activeRooms.some((r) => r.roomCode === roomCode), false);
  const p4BlockedAction = await p4.post("/api/rulebooks", {
    type: "room-action",
    roomCode,
    action: { type: "check-in-landmark", landmarkId: landmarks[1].id, fix: { latitude: landmarks[1].latitude, longitude: landmarks[1].longitude, accuracy: 8, timestamp: clock.now }, actionId: "p4-after-leave" },
  });
  assert.equal(p4BlockedAction.body.error, "player-left");
  const p4Presence = await p4.post(`/api/rulebooks/rooms/${roomCode}/presence`, {
    fix: { latitude: lm0.latitude, longitude: lm0.longitude, accuracy: 8, timestamp: clock.now },
  });
  assert.equal(p4Presence.status, 400);
  assert.equal(p4Presence.body.error, "player-left");

  // Also seat-1 (one of 2 members on team-1) leaves -> team-1 still has seat-2, team-2 still has seat-3 -> 2 active teams remain -> match STILL continues!
  clock.now += 5_000;
  const leave1 = await p1.post("/api/rulebooks", {
    type: "room-action",
    roomCode,
    action: { type: "leave", actionId: "p1-mid-leave" },
  });
  assert.equal(leave1.body.error, undefined);
  assert.equal(leave1.body.room.phase, "active", "Match must continue while team-1 still has seat-2 and team-2 has seat-3");

  // Finally seat-3 (sole member of team-2) leaves -> only 1 active team (team-1) remains -> finishes as forfeit awarding winnerTeamId = "team-1"!
  clock.now += 5_000;
  const leave3 = await p3.post("/api/rulebooks", {
    type: "room-action",
    roomCode,
    action: { type: "leave", actionId: "p3-mid-leave" },
  });
  assert.equal(leave3.body.error, undefined);
  assert.equal(leave3.body.room.phase, "finished");
  assert.equal(leave3.body.room.outcome.reason, "forfeit");
  assert.equal(leave3.body.room.outcome.winnerTeamId, "team-1");

  // Recap preserves all 4 players including departed seats
  const recapRes = await p2.get(`/api/rulebooks/recaps/${roomCode}`);
  assert.equal(recapRes.status, 200);
  assert.equal(recapRes.body.recap.players.length, 4);
  assert.ok(recapRes.body.recap.players.some((p) => p.seatId === "seat-4" && p.name === "Dewi"));
});
