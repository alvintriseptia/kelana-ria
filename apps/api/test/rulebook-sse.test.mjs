import assert from "node:assert/strict";
import http from "node:http";
import { test } from "node:test";
import sharp from "sharp";
import * as api from "../dist/index.js";

const T0 = 1_800_000_000_000;

async function sampleJpegBase64() {
  const buf = await sharp({ create: { width: 16, height: 12, channels: 3, background: "#2a6e5b" } }).jpeg().toBuffer();
  return buf.toString("base64");
}

async function startServer(clockRef) {
  const server = api.createSoloServer({
    databasePath: ":memory:",
    now: () => clockRef.now,
    midtrans: api.createRecordedMidtransAdapter(),
    allowRulebookSandboxCheckout: true,
    allowHideSeekQa: true,
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  return { server, port, baseUrl: `http://127.0.0.1:${port}` };
}

function makeClient(baseUrl) {
  let cookie = "";
  return {
    get cookie() {
      return cookie;
    },
    async get(path, extraHeaders = {}) {
      const res = await fetch(`${baseUrl}${path}`, {
        headers: { ...(cookie ? { cookie } : {}), ...extraHeaders },
      });
      const setCookie = res.headers.get("set-cookie");
      if (setCookie) cookie = setCookie.split(";")[0];
      const text = await res.text();
      return {
        status: res.status,
        headers: res.headers,
        body: text ? JSON.parse(text) : null,
      };
    },
    async post(path, body) {
      const res = await fetch(`${baseUrl}${path}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(cookie ? { cookie } : {}),
        },
        body: JSON.stringify(body),
      });
      const setCookie = res.headers.get("set-cookie");
      if (setCookie) cookie = setCookie.split(";")[0];
      const text = await res.text();
      return {
        status: res.status,
        headers: res.headers,
        body: text ? JSON.parse(text) : null,
      };
    },
  };
}

function openSseStream(port, path, cookie = "") {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: "127.0.0.1",
        port,
        path,
        method: "GET",
        headers: {
          Accept: "text/event-stream",
          ...(cookie ? { Cookie: cookie } : {}),
        },
      },
      (res) => {
        const events = [];
        const rawFrames = [];
        const waiters = [];
        let buffer = "";
        let ended = false;
        let endResolve;
        const endedPromise = new Promise((r) => {
          endResolve = r;
        });

        const notifyWaiters = () => {
          for (let i = waiters.length - 1; i >= 0; i -= 1) {
            const waiter = waiters[i];
            const match = events.find(waiter.predicate);
            if (match) {
              waiters.splice(i, 1);
              clearTimeout(waiter.timer);
              waiter.resolve(match);
            }
          }
        };

        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          buffer += chunk;
          let idx;
          while ((idx = buffer.indexOf("\n\n")) !== -1) {
            const frame = buffer.slice(0, idx);
            buffer = buffer.slice(idx + 2);
            rawFrames.push(frame);
            const lines = frame.split("\n");
            let eventName = "message";
            const dataLines = [];
            for (const line of lines) {
              if (line.startsWith("event:")) eventName = line.slice(6).trim();
              else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
            }
            if (dataLines.length > 0) {
              const rawData = dataLines.join("\n");
              let parsed = null;
              try {
                parsed = JSON.parse(rawData);
              } catch {
                parsed = rawData;
              }
              events.push({ event: eventName, data: parsed, rawFrame: frame, receivedAt: Date.now() });
              notifyWaiters();
            }
          }
        });
        res.on("end", () => {
          ended = true;
          endResolve();
        });
        res.on("close", () => {
          ended = true;
          endResolve();
        });

        resolve({
          status: res.statusCode,
          headers: res.headers,
          events,
          rawFrames,
          endedPromise,
          isEnded: () => ended,
          waitForEvent(predicate, timeoutMs = 2000) {
            const existing = events.find(predicate);
            if (existing) return Promise.resolve(existing);
            return new Promise((resEv, rejEv) => {
              const timer = setTimeout(() => {
                const idx = waiters.findIndex((w) => w.resolve === resEv);
                if (idx !== -1) waiters.splice(idx, 1);
                rejEv(new Error(`Timed out waiting for SSE event after ${timeoutMs}ms (got ${events.length} events)`));
              }, timeoutMs);
              waiters.push({ predicate, resolve: resEv, timer });
            });
          },
          close() {
            req.destroy();
          },
        });
      },
    );
    req.on("error", (err) => {
      if (err.code === "ECONNRESET") return;
      reject(err);
    });
    req.end();
  });
}

test("SSE rejects unauthenticated and non-member requests without leaking room existence", async () => {
  const clock = { now: T0 };
  const { server, port, baseUrl } = await startServer(clock);
  try {
    const host = makeClient(baseUrl);
    const outsider = makeClient(baseUrl);

    const created = await host.post("/api/rulebooks", {
      type: "create-free-room",
      packId: "official-jakarta-compact-claim",
      version: 1,
      hostName: "Host",
      mode: "group",
    });
    assert.equal(created.status, 200);
    const roomCode = created.body.roomCode;

    // Issue a valid guest cookie for outsider by creating an unrelated free room (not a member of roomCode)
    await outsider.post("/api/rulebooks", {
      type: "create-free-room",
      packId: "official-jakarta-compact-claim",
      version: 1,
      hostName: "Outsider",
      mode: "solo",
    });
    assert.ok(outsider.cookie.includes("kelana_rulebook="));

    const unauth = await fetch(`${baseUrl}/api/rulebooks/rooms/${roomCode}/events`);
    assert.equal(unauth.status, 404);
    assert.equal(unauth.headers.get("set-cookie"), null, "Unauthenticated SSE rejection must not set cookie");
    const unauthBody = await unauth.json();

    const nonMember = await fetch(`${baseUrl}/api/rulebooks/rooms/${roomCode}/events`, {
      headers: { cookie: outsider.cookie },
    });
    assert.equal(nonMember.status, 404);
    const nonMemberBody = await nonMember.json();

    const missingRoom = await fetch(`${baseUrl}/api/rulebooks/rooms/RC-FFFFFF/events`, {
      headers: { cookie: outsider.cookie },
    });
    assert.equal(missingRoom.status, 404);
    const missingBody = await missingRoom.json();

    assert.deepEqual(unauthBody, { error: "room-not-found" });
    assert.deepEqual(nonMemberBody, missingBody, "Non-member and missing room responses must be indistinguishable");

    // Verify authenticated member DOES connect with proper SSE headers
    const hostStream = await openSseStream(port, `/api/rulebooks/rooms/${roomCode}/events`, host.cookie);
    try {
      assert.equal(hostStream.status, 200);
      assert.match(hostStream.headers["content-type"] ?? "", /^text\/event-stream/i);
      assert.equal(hostStream.headers["cache-control"], "no-cache, no-transform");
      assert.equal(hostStream.headers["connection"], "keep-alive");
      assert.equal(hostStream.headers["x-accel-buffering"], "no");
      const initial = await hostStream.waitForEvent((ev) => ev.event === "rev");
      assert.equal(typeof initial.data.stateRev, "number");
      assert.equal(initial.data.now, T0);
    } finally {
      hostStream.close();
    }
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("Claim the City two-seat SSE pushes immediate rev updates on join, ready, start, and landmark claim", async () => {
  const clock = { now: T0 };
  const { server, port, baseUrl } = await startServer(clock);
  try {
    const p1 = makeClient(baseUrl);
    const p2 = makeClient(baseUrl);

    const created = await p1.post("/api/rulebooks", {
      type: "create-free-room",
      packId: "official-jakarta-compact-claim",
      version: 1,
      hostName: "Ayu",
      mode: "group",
    });
    const roomCode = created.body.roomCode;
    const initialBoard = (await p1.get(`/api/rulebooks/rooms/${roomCode}`)).body.publicBoard;

    const p1Stream = await openSseStream(port, `/api/rulebooks/rooms/${roomCode}/events`, p1.cookie);
    try {
      const initEv = await p1Stream.waitForEvent((ev) => ev.event === "rev");
      const rev0 = initEv.data.stateRev;

      // Seat 2 joins -> P1 receives immediate rev push (< 500ms)
      const joinSentAt = Date.now();
      const joined = await p2.post("/api/rulebooks", { type: "join-room", roomCode, name: "Budi" });
      assert.equal(joined.status, 200);
      const joinEv = await p1Stream.waitForEvent((ev) => ev.data.stateRev > rev0);
      assert.ok(joinEv.receivedAt - joinSentAt < 500, "Join SSE notification must arrive immediately");

      const p2Stream = await openSseStream(port, `/api/rulebooks/rooms/${roomCode}/events`, p2.cookie);
      try {
        await p2Stream.waitForEvent((ev) => ev.event === "rev");

        // Check in & ready both players, start match
        for (const [idx, client] of [p1, p2].entries()) {
          await client.post("/api/rulebooks", {
            type: "room-action",
            roomCode,
            action: {
              type: "check-in-start",
              actionId: `start-checkin-${idx}`,
              fix: {
                latitude: initialBoard.startPoint.latitude,
                longitude: initialBoard.startPoint.longitude,
                accuracy: 10,
                timestamp: clock.now,
              },
            },
          });
          await client.post("/api/rulebooks", {
            type: "room-action",
            roomCode,
            action: { type: "ready", ready: true, actionId: `ready-${idx}` },
          });
        }

        const beforeStartRev = p2Stream.events.at(-1).data.stateRev;
        const startSentAt = Date.now();
        const started = await p1.post("/api/rulebooks", {
          type: "room-action",
          roomCode,
          action: { type: "start", actionId: "start-claim" },
        });
        assert.equal(started.status, 200);
        const startEv = await p2Stream.waitForEvent((ev) => ev.data.stateRev > beforeStartRev);
        assert.ok(startEv.receivedAt - startSentAt < 500, "Match start SSE notification must arrive immediately");

        // P1 checks in landmark -> P2 gets immediate SSE rev update
        const lm = initialBoard.landmarks[0];
        const beforeClaimRev = p2Stream.events.at(-1).data.stateRev;
        const claimSentAt = Date.now();
        const claimRes = await p1.post("/api/rulebooks", {
          type: "room-action",
          roomCode,
          action: {
            type: "check-in-landmark",
            landmarkId: lm.id,
            actionId: "claim-lm-0",
            fix: { latitude: lm.latitude, longitude: lm.longitude, accuracy: 10, timestamp: clock.now },
          },
        });
        assert.equal(claimRes.status, 200);
        const claimEv = await p2Stream.waitForEvent((ev) => ev.data.stateRev > beforeClaimRev);
        assert.ok(claimEv.receivedAt - claimSentAt < 500, "Claim SSE notification must arrive immediately");
      } finally {
        p2Stream.close();
      }
    } finally {
      p1Stream.close();
    }
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("Hide & Seek SSE pushes clue, photo, deck, and QA clock updates without leaking hider secrets", async () => {
  const clock = { now: T0 };
  const { server, port, baseUrl } = await startServer(clock);
  try {
    const hider = makeClient(baseUrl);
    const seeker = makeClient(baseUrl);

    const listingsRes = await hider.get("/api/rulebooks?format=hide-and-seek");
    const compactSeek = listingsRes.body.listings.find((l) => l.packId === "official-jakarta-compact-seek");
    assert.ok(compactSeek, "Expected official-jakarta-compact-seek listing");

    const created = await hider.post("/api/rulebooks", {
      type: "create-free-room",
      packId: compactSeek.packId,
      version: compactSeek.version,
      hostName: "Hider",
      qa: true,
    });
    assert.equal(created.status, 200);
    const roomCode = created.body.roomCode;
    await seeker.post("/api/rulebooks", { type: "join-room", roomCode, name: "Seeker" });

    for (const [idx, client] of [hider, seeker].entries()) {
      await client.post("/api/rulebooks", {
        type: "room-action",
        roomCode,
        action: { type: "check-in-start", actionId: `seek-start-${idx}`, fix: { qaLocationId: "csw-asean" } },
      });
      await client.post("/api/rulebooks", {
        type: "room-action",
        roomCode,
        action: { type: "ready", ready: true, actionId: `seek-ready-${idx}` },
      });
    }
    await hider.post("/api/rulebooks", {
      type: "room-action",
      roomCode,
      action: { type: "start", actionId: "seek-go" },
    });

    const hiderStream = await openSseStream(port, `/api/rulebooks/rooms/${roomCode}/events`, hider.cookie);
    const seekerStream = await openSseStream(port, `/api/rulebooks/rooms/${roomCode}/events`, seeker.cookie);
    try {
      const seekerInit = await seekerStream.waitForEvent((ev) => ev.event === "rev");
      await hiderStream.waitForEvent((ev) => ev.event === "rev");

      // 1. Hider locks secret anchor station -> Seeker receives rev event with ZERO secret anchor/found-code leak
      const lockRes = await hider.post("/api/rulebooks", {
        type: "room-action",
        roomCode,
        action: { type: "lock-anchor", stationId: "mrt-blok-m", actionId: "lock-blok-m", fix: { qaLocationId: "mrt-blok-m" } },
      });
      assert.equal(lockRes.status, 200);
      assert.equal(lockRes.body.error, undefined, JSON.stringify(lockRes.body));
      const afterLockEv = await seekerStream.waitForEvent((ev) => ev.data.stateRev > seekerInit.data.stateRev);
      const hiderView = (await hider.get(`/api/rulebooks/rooms/${roomCode}`)).body;
      assert.equal(hiderView.room.ownAnchorStationId, "mrt-blok-m");

      // 2. Host advances QA clock to phase-end (entering seeking phase) -> Seeker receives immediate SSE update with advanced timestamp
      const qaRes = await hider.post("/api/rulebooks", {
        type: "seek-qa-advance",
        roomCode,
        step: "phase-end",
        expectedDeadline: hiderView.room.phaseEndsAt,
        actionId: "qa-to-seeking",
      });
      assert.equal(qaRes.status, 200);
      assert.equal(qaRes.body.error, undefined, JSON.stringify(qaRes.body));
      const afterQaEv = await seekerStream.waitForEvent((ev) => ev.data.stateRev > afterLockEv.data.stateRev);
      assert.ok(afterQaEv.data.now > T0, "QA clock jump SSE event must carry advanced room timestamp");

      // 3. Seeker asks a photo clue -> Hider receives immediate SSE update
      const seekerView = (await seeker.get(`/api/rulebooks/rooms/${roomCode}`)).body;
      const photoItem = seekerView.room.menu.find((entry) => entry.family === "photo" && entry.availableInCurrentPhase);
      assert.ok(photoItem, "Expected available photo question item");
      const hiderRevBeforeAsk = hiderStream.events.at(-1).data.stateRev;
      const askRes = await seeker.post("/api/rulebooks", {
        type: "room-action",
        roomCode,
        action: {
          type: "ask",
          family: "photo",
          itemId: photoItem.itemId,
          actionId: "ask-photo-1",
          fix: { qaLocationId: "csw-asean" },
        },
      });
      assert.equal(askRes.status, 200);
      assert.equal(askRes.body.error, undefined, JSON.stringify(askRes.body));
      const afterAskEv = await hiderStream.waitForEvent((ev) => ev.data.stateRev > hiderRevBeforeAsk);
      const hiderAfterAsk = (await hider.get(`/api/rulebooks/rooms/${roomCode}`)).body;
      const pendingQ = hiderAfterAsk.room.questions.find((q) => q.status === "pending");
      assert.ok(pendingQ, "Expected pending photo question");

      // 4. Hider uploads photo answer -> Seeker receives immediate SSE update + Hider gets draw batch
      const invalidPhoto = await hider.post("/api/rulebooks/seek-photo", {
        roomCode, questionId: pendingQ.id, actionId: "invalid-photo", photoBase64: "YmFk",
      });
      assert.ok(invalidPhoto.status >= 400);
      const beforePhoto = (await seeker.get(`/api/rulebooks/rooms/${roomCode}`)).body.activity;
      assert.equal(beforePhoto.events.some(event => event.kind === "photo-clue"), false);
      const seekerRevBeforePhoto = seekerStream.events.at(-1).data.stateRev;
      const photoRes = await hider.post("/api/rulebooks/seek-photo", {
        roomCode,
        questionId: pendingQ.id,
        actionId: "answer-photo-1",
        photoBase64: await sampleJpegBase64(),
      });
      assert.equal(photoRes.status, 200);
      assert.equal(photoRes.body.error, undefined, JSON.stringify(photoRes.body));
      const afterPhotoEv = await seekerStream.waitForEvent((ev) => ev.data.stateRev > seekerRevBeforePhoto);
      assert.ok(afterPhotoEv.data.stateRev > seekerRevBeforePhoto);

      const getPhotoNotices = async client => (await client.get(`/api/rulebooks/rooms/${roomCode}`)).body.activity.events
        .filter(event => event.kind === "photo-clue");
      const notices = await getPhotoNotices(seeker);
      assert.equal(notices.length, 1);
      assert.equal(notices[0].clueIndex, hiderAfterAsk.room.questions.findIndex(q => q.id === pendingQ.id));
      assert.equal(notices[0].panel, "clues");
      assert.equal(notices[0].alert, true);
      assert.equal(JSON.stringify(notices).includes(pendingQ.id), false, "Exclude attachment IDs from notices");
      assert.deepEqual(await getPhotoNotices(hider), []);
      assert.deepEqual(await getPhotoNotices(seeker), notices, "A repeated read keeps the same sequence");

      // 5. Seeker asks a Radar clue (draw 2, keep 1) -> Hider answers -> resolves choose-draw via deck-action -> Seeker receives SSE update without leaking card identities
      const radarItem = seekerView.room.menu.find((entry) => entry.family === "radar" && entry.availableInCurrentPhase && !entry.isCustomRadius);
      assert.ok(radarItem, "Expected available radar question item");
      const hiderRevBeforeRadar = hiderStream.events.at(-1).data.stateRev;
      const askRadarRes = await seeker.post("/api/rulebooks", {
        type: "room-action",
        roomCode,
        action: {
          type: "ask",
          family: "radar",
          itemId: radarItem.itemId,
          actionId: "ask-radar-1",
          fix: { qaLocationId: "csw-asean" },
        },
      });
      assert.equal(askRadarRes.status, 200);
      assert.equal(askRadarRes.body.error, undefined, JSON.stringify(askRadarRes.body));
      await hiderStream.waitForEvent((ev) => ev.data.stateRev > hiderRevBeforeRadar);
      const hiderAfterRadar = (await hider.get(`/api/rulebooks/rooms/${roomCode}`)).body;
      const radarQ = hiderAfterRadar.room.questions.find((q) => q.status === "pending");
      assert.ok(radarQ && radarQ.privateComputedAnswer?.code, "Expected pending radar question with privateComputedAnswer");

      const seekerRevBeforeRadarAnswer = seekerStream.events.at(-1).data.stateRev;
      const ansRadarRes = await hider.post("/api/rulebooks", {
        type: "room-action",
        roomCode,
        action: {
          type: "answer-question",
          questionId: radarQ.id,
          answerCode: radarQ.privateComputedAnswer.code,
          actionId: "answer-radar-1",
        },
      });
      assert.equal(ansRadarRes.status, 200);
      assert.equal(ansRadarRes.body.error, undefined, JSON.stringify(ansRadarRes.body));
      const afterRadarAnsEv = await seekerStream.waitForEvent((ev) => ev.data.stateRev > seekerRevBeforeRadarAnswer);

      const hiderWithDraw = (await hider.get(`/api/rulebooks/rooms/${roomCode}`)).body;
      const activeDraw = hiderWithDraw.deck.activeDraw;
      assert.ok(activeDraw && activeDraw.cards.length > 0, "Expected active draw batch for hider");
      const keepIds = activeDraw.cards.slice(0, activeDraw.keepCount).map((c) => c.instanceId);
      const deckRes = await hider.post("/api/rulebooks", {
        type: "deck-action",
        roomCode,
        action: { kind: "choose-draw", actionId: "choose-draw-1", keepInstanceIds: keepIds },
      });
      assert.equal(deckRes.status, 200);
      assert.equal(deckRes.body.error, undefined, JSON.stringify(deckRes.body));
      await seekerStream.waitForEvent((ev) => ev.data.stateRev > afterRadarAnsEv.data.stateRev);

      // Assert zero leakage of private hider anchor, found code, or hider card IDs/titles in ANY seeker SSE frame
      const allSeekerWire = seekerStream.rawFrames.join("\n");
      assert.equal(allSeekerWire.includes("mrt-blok-m"), false, "SSE stream must never leak hider anchor station");
      if (hiderView.room.foundCode) {
        assert.equal(allSeekerWire.includes(hiderView.room.foundCode), false, "SSE stream must never leak hider found code");
      }
      for (const card of [...hiderWithDraw.deck.hand, ...activeDraw.cards]) {
        assert.equal(allSeekerWire.includes(card.instanceId), false, "SSE stream must never leak hider card IDs");
        assert.equal(allSeekerWire.includes(card.title), false, "SSE stream must never leak hider card titles");
      }
      assert.ok(afterAskEv.data.stateRev > hiderRevBeforeAsk);
    } finally {
      hiderStream.close();
      seekerStream.close();
    }
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("server.close() cleanly terminates all active SSE streams without hanging", async () => {
  const clock = { now: T0 };
  const { server, port, baseUrl } = await startServer(clock);
  const host = makeClient(baseUrl);
  const created = await host.post("/api/rulebooks", {
    type: "create-free-room",
    packId: "official-jakarta-compact-claim",
    version: 1,
    hostName: "Host",
    mode: "group",
  });
  const roomCode = created.body.roomCode;

  const s1 = await openSseStream(port, `/api/rulebooks/rooms/${roomCode}/events`, host.cookie);
  const s2 = await openSseStream(port, `/api/rulebooks/rooms/${roomCode}/events`, host.cookie);
  await Promise.all([
    s1.waitForEvent((ev) => ev.event === "rev"),
    s2.waitForEvent((ev) => ev.event === "rev"),
  ]);

  const closeStarted = Date.now();
  await Promise.race([
    new Promise((resolve) => server.close(resolve)),
    new Promise((_, reject) => setTimeout(() => reject(new Error("server.close() hung with active SSE streams")), 2000)),
  ]);
  await Promise.all([s1.endedPromise, s2.endedPromise]);
  assert.ok(Date.now() - closeStarted < 1500, "server.close() should complete promptly");
  assert.equal(s1.isEnded(), true);
  assert.equal(s2.isEnded(), true);
});
