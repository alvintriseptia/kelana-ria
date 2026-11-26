import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import * as api from "../dist/index.js";

const T0 = 1_800_200_000_000;
const REVIEWER_KEY = "reviewer-143";

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
      const res = await fetch(`${baseUrl}${path}`, { headers: hdr ? { cookie: hdr } : {} });
      mergeCookies(res);
      return { status: res.status, body: await res.json() };
    },
    async post(path, body, extraHeaders = {}) {
      const hdr = cookieHeader();
      const res = await fetch(`${baseUrl}${path}`, {
        method: "POST",
        headers: { "content-type": "application/json", ...(hdr ? { cookie: hdr } : {}), ...extraHeaders },
        body: JSON.stringify(body),
      });
      mergeCookies(res);
      return { status: res.status, body: await res.json() };
    },
  };
}

async function startServer() {
  const dir = mkdtempSync(join(tmpdir(), "kelana-board-thresholds-"));
  const dbPath = join(dir, "test.sqlite");
  let clock = T0;
  const server = api.createSoloServer({
    databasePath: dbPath,
    now: () => clock,
    allowSandboxAuthOtp: true,
    allowRulebookSandboxCheckout: true,
    rulebookReviewerKey: REVIEWER_KEY,
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;
  return {
    baseUrl,
    async close() {
      await new Promise((resolve) => server.close(resolve));
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

test("ClaimPublicBoard and SeekPublicBoard expose data-driven checkInRadiusMeters and maxGpsAccuracyMeters from pack geography", async () => {
  const srv = await startServer();
  try {
    const host = makeClient(srv.baseUrl);
    const catalog = await host.get("/api/rulebooks/catalog");
    assert.equal(catalog.status, 200);

    const claimEdition = catalog.body.editions.find((e) => e.format === "claim-the-city" && e.isOfficial && e.priceIdr === 0);
    const seekEdition = catalog.body.editions.find((e) => e.format === "hide-and-seek" && e.isOfficial && e.priceIdr === 0);
    assert.ok(claimEdition, "Expected official free Claim edition");
    assert.ok(seekEdition, "Expected official free Hide & Seek edition");

    const claimCreated = await host.post("/api/rulebooks", {
      type: "create-free-room",
      packId: claimEdition.packId,
      version: claimEdition.version,
      mode: "solo",
      hostName: "Alvin",
    });
    assert.equal(claimCreated.status, 200);
    const claimRoom = await host.get(`/api/rulebooks/rooms/${claimCreated.body.roomCode}`);
    assert.equal(claimRoom.status, 200);
    assert.equal(typeof claimRoom.body.publicBoard.checkInRadiusMeters, "number");
    assert.equal(typeof claimRoom.body.publicBoard.maxGpsAccuracyMeters, "number");
    assert.ok(claimRoom.body.publicBoard.checkInRadiusMeters > 0);
    assert.ok(claimRoom.body.publicBoard.maxGpsAccuracyMeters > 0);

    const seekCreated = await host.post("/api/rulebooks", {
      type: "create-free-room",
      packId: seekEdition.packId,
      version: seekEdition.version,
      hostName: "Alvin",
    });
    assert.equal(seekCreated.status, 200);
    const seekRoom = await host.get(`/api/rulebooks/rooms/${seekCreated.body.roomCode}`);
    assert.equal(seekRoom.status, 200);
    assert.equal(typeof seekRoom.body.publicBoard.checkInRadiusMeters, "number");
    assert.equal(typeof seekRoom.body.publicBoard.maxGpsAccuracyMeters, "number");
    assert.ok(seekRoom.body.publicBoard.checkInRadiusMeters > 0);
    assert.ok(seekRoom.body.publicBoard.maxGpsAccuracyMeters > 0);

    // Custom creator pack with non-default thresholds proves values come from pack geography, never hardcoded
    const creator = makeClient(srv.baseUrl);
    const otpReq = await creator.post("/api/auth/request-otp", { email: "creator143@example.com" });
    assert.equal(otpReq.status, 200, JSON.stringify(otpReq.body));
    const otpVerify = await creator.post("/api/auth/verify-otp", {
      challengeId: otpReq.body.challengeId,
      code: otpReq.body.sandboxCode,
      displayName: "Creator143",
    });
    assert.equal(otpVerify.status, 200, JSON.stringify(otpVerify.body));

    const cloned = await creator.post("/api/rulebooks", {
      type: "clone-official",
      templatePackId: claimEdition.packId,
      packId: "custom-thresholds-143",
      title: "Custom Thresholds 143",
      byline: "Creator143",
      priceIdr: 0,
    });
    assert.equal(cloned.status, 200, JSON.stringify(cloned.body));
    const draftPack = structuredClone(cloned.body.record.pack);
    const draftGeo = structuredClone(cloned.body.record.snapshot);
    draftPack.geography.checkInRadiusMeters = 75;
    draftPack.geography.maxGpsAccuracyMeters = 85;

    const saved = await creator.post("/api/rulebooks", {
      type: "save-draft",
      pack: draftPack,
      snapshot: draftGeo,
    });
    assert.equal(saved.status, 200, JSON.stringify(saved.body));
    assert.equal((await creator.post("/api/rulebooks", { type: "submit-draft", packId: "custom-thresholds-143", version: 1 })).status, 200);
    assert.equal(
      (await creator.post(
        "/api/rulebooks",
        { type: "publish-version", packId: "custom-thresholds-143", version: 1 },
        { authorization: `Bearer ${REVIEWER_KEY}` },
      )).status,
      200,
    );

    const customCreated = await creator.post("/api/rulebooks", {
      type: "create-free-room",
      packId: "custom-thresholds-143",
      version: 1,
      mode: "solo",
      hostName: "Creator143",
    });
    assert.equal(customCreated.status, 200, JSON.stringify(customCreated.body));
    const customRoom = await creator.get(`/api/rulebooks/rooms/${customCreated.body.roomCode}`);
    assert.equal(customRoom.status, 200);
    assert.equal(customRoom.body.publicBoard.checkInRadiusMeters, 75);
    assert.equal(customRoom.body.publicBoard.maxGpsAccuracyMeters, 85);
  } finally {
    await srv.close();
  }
});
