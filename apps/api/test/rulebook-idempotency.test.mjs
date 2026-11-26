import assert from "node:assert/strict";
import test from "node:test";
import * as api from "../dist/index.js";

const T0 = 1_800_000_000_000;

async function startServer(nowRef) {
  const server = api.createSoloServer({
    databasePath: ":memory:",
    now: () => nowRef.now,
    midtrans: api.createRecordedMidtransAdapter(),
    allowRulebookSandboxCheckout: true,
    allowHideSeekQa: true,
    allowSandboxAuthOtp: true,
    rulebookReviewerKey: "test-reviewer-key",
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  return { server, baseUrl };
}

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
    async get(path) {
      const hdr = cookieHeader();
      const res = await fetch(`${baseUrl}${path}`, {
        headers: hdr ? { cookie: hdr } : undefined,
      });
      mergeCookies(res);
      return { status: res.status, body: await res.json() };
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
      return { status: res.status, body: await res.json() };
    },
  };
}

test("POST /api/rulebooks create-free-room and create-order deduplicate retries by requestId", async () => {
  const clock = { now: T0 };
  const { server, baseUrl } = await startServer(clock);
  try {
    const client = makeClient(baseUrl);
    const freeReq = "req-free-room-retry-0001";
    const r1 = await client.post("/api/rulebooks", {
      type: "create-free-room",
      packId: "official-jakarta-compact-claim",
      version: 1,
      hostName: "Raka",
      requestId: freeReq,
    });
    const r2 = await client.post("/api/rulebooks", {
      type: "create-free-room",
      packId: "official-jakarta-compact-claim",
      version: 1,
      hostName: "Raka",
      requestId: freeReq,
    });
    assert.equal(r1.status, 200);
    assert.equal(r2.status, 200);
    assert.equal(r1.body.roomCode, r2.body.roomCode, "Retried create-free-room must not create a second room");

    // Sign in before Studio authoring and paid checkout
    const otpReq = await client.post("/api/auth/request-otp", { email: "idemp@kelana.test" });
    assert.equal(otpReq.status, 200);
    const otpVer = await client.post("/api/auth/verify-otp", {
      challengeId: otpReq.body.challengeId,
      code: otpReq.body.sandboxCode,
    });
    assert.equal(otpVer.status, 200);

    // Publish a paid pack and confirm create-order deduplicates by requestId
    const cloned = await client.post("/api/rulebooks", {
      type: "clone-official",
      templatePackId: "official-jakarta-compact-claim",
      packId: "paid-retry-claim",
      title: "Paid Retry Claim",
      byline: "QA",
      priceIdr: 25_000,
    });
    assert.equal(cloned.status, 200);
    const submitted = await client.post("/api/rulebooks", {
      type: "submit-draft",
      packId: "paid-retry-claim",
      version: 1,
    });
    assert.equal(submitted.status, 200);
    const published = await client.post(
      "/api/rulebooks",
      { type: "publish-version", packId: "paid-retry-claim", version: 1 },
      { authorization: "Bearer test-reviewer-key" },
    );
    assert.equal(published.status, 200);

    const orderReq = "req-paid-order-retry-0001";
    const o1 = await client.post("/api/rulebooks", {
      type: "create-order",
      packId: "paid-retry-claim",
      version: 1,
      requestId: orderReq,
    });
    const o2 = await client.post("/api/rulebooks", {
      type: "create-order",
      packId: "paid-retry-claim",
      version: 1,
      requestId: orderReq,
    });
    assert.equal(o1.status, 200);
    assert.equal(o2.status, 200);
    assert.equal(o1.body.order.orderId, o2.body.order.orderId, "Retried create-order must not create a second order");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("Hide & Seek deck-action and play-card deduplicate retries by actionId without double-applying", async () => {
  const clock = { now: T0 };
  const { server, baseUrl } = await startServer(clock);
  try {
    const hider = makeClient(baseUrl);
    const seeker = makeClient(baseUrl);

    const seekList = await hider.get("/api/rulebooks?format=hide-and-seek");
    const compactSeek = seekList.body.listings.find((item) => item.packId === "official-jakarta-compact-seek");
    assert.ok(compactSeek);

    const created = await hider.post("/api/rulebooks", {
      type: "create-free-room",
      packId: compactSeek.packId,
      version: compactSeek.version,
      hostName: "Hider",
      qa: true,
      requestId: "req-seek-qa-room-0001",
    });
    assert.equal(created.status, 200);
    const code = created.body.roomCode;

    const joined = await seeker.post("/api/rulebooks", { type: "join-room", roomCode: code, name: "Seeker" });
    assert.equal(joined.status, 200);

    const view1 = await hider.get(`/api/rulebooks/rooms/${code}`);
    const startPoint = view1.body.room.turnStartPoint;
    const fix = { latitude: startPoint.latitude, longitude: startPoint.longitude, accuracy: 10, timestamp: clock.now };

    for (const [idx, c] of [hider, seeker].entries()) {
      assert.equal((await c.post("/api/rulebooks", {
        type: "room-action", roomCode: code, action: { type: "check-in-start", actionId: `start-${idx}`, fix },
      })).status, 200);
      assert.equal((await c.post("/api/rulebooks", {
        type: "room-action", roomCode: code, action: { type: "ready", actionId: `ready-${idx}`, ready: true },
      })).status, 200);
    }
    assert.equal((await hider.post("/api/rulebooks", {
      type: "room-action", roomCode: code, action: { type: "start", actionId: "start-match" },
    })).status, 200);

    const headStartView = await hider.get(`/api/rulebooks/rooms/${code}`);
    const anchor = headStartView.body.publicBoard.stations[0];
    assert.equal((await hider.post("/api/rulebooks", {
      type: "room-action",
      roomCode: code,
      action: {
        type: "lock-anchor",
        actionId: "lock-anchor-1",
        stationId: anchor.id,
        fix: { latitude: anchor.latitude, longitude: anchor.longitude, accuracy: 10, timestamp: clock.now },
      },
    })).status, 200);

    // Advance past head start into seeking phase
    assert.equal((await hider.post("/api/rulebooks", {
      type: "seek-qa-advance",
      roomCode: code,
      step: "phase-end",
      expectedDeadline: headStartView.body.room.phaseEndsAt,
      actionId: "qa-end-head-start",
    })).status, 200);

    const seekingSeekerView = await seeker.get(`/api/rulebooks/rooms/${code}`);
    const radarItem = seekingSeekerView.body.room.menu.find((m) => m.family === "radar" && !m.isCustomRadius);
    const seekerFix = { latitude: startPoint.latitude, longitude: startPoint.longitude, accuracy: 10, timestamp: seekingSeekerView.body.room.now };
    assert.equal((await seeker.post("/api/rulebooks", {
      type: "room-action",
      roomCode: code,
      action: { type: "ask", actionId: "ask-radar-1", family: "radar", itemId: radarItem.itemId, fix: seekerFix },
    })).status, 200);

    const hiderPending = await hider.get(`/api/rulebooks/rooms/${code}`);
    const q = hiderPending.body.room.questions.find((item) => item.status === "pending");
    assert.ok(q && q.privateComputedAnswer);
    assert.equal((await hider.post("/api/rulebooks", {
      type: "room-action",
      roomCode: code,
      action: { type: "answer-question", actionId: "ans-1", questionId: q.id, answerCode: q.privateComputedAnswer.code },
    })).status, 200);

    // Hider now has an activeDraw -> replay choose-draw with same actionId must succeed idempotently
    const drawView = await hider.get(`/api/rulebooks/rooms/${code}`);
    const activeDraw = drawView.body.deck.activeDraw;
    assert.ok(activeDraw && activeDraw.cards.length > 0);
    const keepIds = activeDraw.cards.slice(0, activeDraw.keepCount).map((c) => c.instanceId);

    const d1 = await hider.post("/api/rulebooks", {
      type: "deck-action",
      roomCode: code,
      action: { kind: "choose-draw", actionId: "draw-retry-001", keepInstanceIds: keepIds },
    });
    const d2 = await hider.post("/api/rulebooks", {
      type: "deck-action",
      roomCode: code,
      action: { kind: "choose-draw", actionId: "draw-retry-001", keepInstanceIds: keepIds },
    });
    assert.equal(d1.status, 200);
    assert.equal(d2.status, 200);
    assert.equal(d1.body.ok, true);
    assert.equal(d2.body.ok, true);

    // Verify hand has exact kept cards once (not duplicated)
    const afterDraw = await hider.get(`/api/rulebooks/rooms/${code}`);
    assert.equal(afterDraw.body.deck.hand.length, keepIds.length);

    // GET /api/rulebooks/catalog includes activeRooms for both hider and seeker while seeking
    const hiderCat = await hider.get("/api/rulebooks/catalog");
    assert.equal(hiderCat.status, 200);
    assert.equal(hiderCat.body.activeRooms.length, 1);
    assert.equal(hiderCat.body.activeRooms[0].roomCode, code);
    assert.equal(hiderCat.body.activeRooms[0].format, "hide-and-seek");
    assert.equal(hiderCat.body.activeRooms[0].phase, "seeking");
    assert.equal(hiderCat.body.activeRooms[0].role, "hider");

    const seekerCat = await seeker.get("/api/rulebooks/catalog");
    assert.equal(seekerCat.body.activeRooms.length, 1);
    assert.equal(seekerCat.body.activeRooms[0].roomCode, code);
    assert.equal(seekerCat.body.activeRooms[0].phase, "seeking");
    assert.equal(seekerCat.body.activeRooms[0].role, "seeker");

    // Anonymous visitor gets empty activeRooms
    const anon = makeClient(baseUrl);
    const anonCat = await anon.get("/api/rulebooks/catalog");
    assert.deepEqual(anonCat.body.activeRooms, []);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("GET /api/rulebooks/catalog tracks Claim room from lobby to active and clears once finished", async () => {
  const clock = { now: T0 };
  const { server, baseUrl } = await startServer(clock);
  try {
    const player = makeClient(baseUrl);
    const created = await player.post("/api/rulebooks/catalog", {
      type: "play",
      edition: "official-jakarta-compact-claim",
      version: 1,
      mode: "solo",
      requestId: "resume-claim-001",
    });
    assert.equal(created.status, 200);
    const roomCode = created.body.roomCode;
    assert.ok(roomCode);

    const lobbyCat = await player.get("/api/rulebooks/catalog");
    assert.equal(lobbyCat.body.activeRooms.length, 1);
    assert.equal(lobbyCat.body.activeRooms[0].roomCode, roomCode);
    assert.equal(lobbyCat.body.activeRooms[0].format, "claim-the-city");
    assert.equal(lobbyCat.body.activeRooms[0].phase, "lobby");
    assert.equal(lobbyCat.body.activeRooms[0].role, "solo");

    const roomView = await player.get(`/api/rulebooks/rooms/${roomCode}`);
    const startPoint = roomView.body.publicBoard.startPoint;
    await player.post("/api/rulebooks", {
      type: "room-action",
      roomCode,
      action: {
        type: "check-in-start",
        actionId: "resume-start-ci",
        fix: { latitude: startPoint.latitude, longitude: startPoint.longitude, accuracy: 10, timestamp: clock.now },
      },
    });
    await player.post("/api/rulebooks", {
      type: "room-action",
      roomCode,
      action: { type: "ready", actionId: "resume-ready", ready: true },
    });
    await player.post("/api/rulebooks", {
      type: "room-action",
      roomCode,
      action: { type: "start", actionId: "resume-start" },
    });

    const activeCat = await player.get("/api/rulebooks/catalog");
    assert.equal(activeCat.body.activeRooms.length, 1);
    assert.equal(activeCat.body.activeRooms[0].roomCode, roomCode);
    assert.equal(activeCat.body.activeRooms[0].phase, "active");

    // Expire match clock -> room finishes and disappears from activeRooms
    clock.now += 200 * 60_000;
    const finishedCat = await player.get("/api/rulebooks/catalog");
    assert.deepEqual(finishedCat.body.activeRooms, []);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

