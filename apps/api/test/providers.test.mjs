import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import * as api from "../dist/index.js";

const SECRET_ACCOUNT_ID = "cf-acct-secret-99887766";
const SECRET_API_TOKEN = "cf-token-secret-aabbccdd";
const SECRET_GEOAPIFY_KEY = "geo-key-secret-11223344";

async function startMockServer(context, handler) {
  const server = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const bodyText = Buffer.concat(chunks).toString("utf8");
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    await handler(req, res, url, bodyText);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  context.after(
    () =>
      new Promise((resolve, reject) =>
        server.listening ? server.close((err) => (err ? reject(err) : resolve())) : resolve(),
      ),
  );
  return `http://127.0.0.1:${server.address().port}`;
}

test("Workers AI and Geoapify HTTP adapters validate a live edition, preserve attribution, and redact all credentials (§7, A13, A16)", async (context) => {
  const capturedBodies = [];
  const capturedAuthHeaders = [];
  let routingCalls = 0;

  const baseUrl = await startMockServer(context, (req, res, url, bodyText) => {
    if (req.method === "POST" && url.pathname.includes("/ai/run/")) {
      capturedAuthHeaders.push(req.headers.authorization);
      capturedBodies.push(bodyText);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          success: true,
          result: {
            response: [
              "```json",
              JSON.stringify({
                id: "compact-solo-live-kebayoran",
                checkpoints: [
                  "pasar-mayestik",
                  "velbak-kebayoran",
                  "taman-daksa",
                  "taman-ayodya",
                  "plaza-senayan",
                  "stasiun-palmerah",
                ],
                targets: { landmarks: 4, zones: 2 },
                durationMs: 3600000,
              }),
              "```",
            ].join("\n"),
          },
        }),
      );
      return;
    }

    if (req.method === "GET" && url.pathname === "/v1/routing") {
      assert.equal(url.searchParams.get("mode"), "walk");
      assert.equal(url.searchParams.get("apiKey"), SECRET_GEOAPIFY_KEY);
      routingCalls += 1;
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          type: "FeatureCollection",
          features: [
            {
              type: "Feature",
              properties: {
                mode: "walk",
                distance: 520,
                time: 420,
              },
            },
          ],
        }),
      );
      return;
    }

    res.writeHead(404);
    res.end();
  });

  const events = [];
  const fixedNow = 1_795_100_000_000;
  const aiProvider = api.createWorkersAiEditionGenerator({
    accountId: SECRET_ACCOUNT_ID,
    apiToken: SECRET_API_TOKEN,
    baseUrl: `${baseUrl}/client/v4`,
    mode: "recorded-rehearsal",
    now: () => fixedNow,
    onEvent: (event) => events.push(event),
  });
  const routeProvider = api.createGeoapifyWalkingRouteProvider({
    apiKey: SECRET_GEOAPIFY_KEY,
    baseUrl,
    mode: "recorded-rehearsal",
    now: () => fixedNow,
    onEvent: (event) => events.push(event),
  });

  const prepared = await api.prepareSoloFixture({
    aiProvider,
    routeProvider,
    now: () => fixedNow,
  });

  assert.equal(prepared.ok, true);
  assert.equal(prepared.origin, "live");
  assert.equal(prepared.routeSource, "live");
  assert.equal(prepared.attempts, 1);
  assert.equal(prepared.fixture.edition.id, "compact-solo-live-kebayoran");
  assert.equal(prepared.fixture.edition.boardVersion, api.COMPACT_BOARD_VERSION);
  assert.equal(prepared.fixture.edition.routes?.source, "live");
  assert.equal(prepared.fixture.edition.routes?.provider, "Geoapify Routing API");
  assert.match(prepared.fixture.edition.routes?.attribution ?? "", /Geoapify/);
  assert.match(prepared.fixture.edition.routes?.attribution ?? "", /OpenStreetMap/);
  assert.match(prepared.fixture.edition.routes?.attribution ?? "", /Transjakarta GTFS/);
  assert.ok((prepared.fixture.edition.openings?.length ?? 0) >= 2);

  assert.equal(capturedAuthHeaders.length, 1);
  assert.equal(capturedAuthHeaders[0], `Bearer ${SECRET_API_TOKEN}`);
  assert.equal(routingCalls, api.uniqueWalkingPairs(api.compactWalkingSnapshot).length);

  // Prompt boundary: public board catalog only; zero answer keys, player coordinates, or secrets.
  const promptText = capturedBodies[0];
  assert.doesNotMatch(promptText, /correctChoiceId|tl-3f|bp-2f|mb-2e|ta-8e|sm-6e|ps-7b/);
  assert.doesNotMatch(promptText, /-6\.2\d+/);
  assert.ok(!promptText.includes(SECRET_ACCOUNT_ID));
  assert.ok(!promptText.includes(SECRET_API_TOKEN));
  assert.ok(!promptText.includes(SECRET_GEOAPIFY_KEY));

  // Redaction boundary: telemetry events contain zero raw secrets.
  const serializedEvents = JSON.stringify(events);
  assert.ok(!serializedEvents.includes(SECRET_ACCOUNT_ID));
  assert.ok(!serializedEvents.includes(SECRET_API_TOKEN));
  assert.ok(!serializedEvents.includes(SECRET_GEOAPIFY_KEY));
  const aiEvents = events.filter((e) => e.kind === "ai-edition");
  const routeEvents = events.filter((e) => e.kind === "walking-route");
  assert.equal(aiEvents.length, 1);
  assert.equal(aiEvents[0].outcome, "proposal-received");
  assert.match(aiEvents[0].endpoint, /\[REDACTED_ACCOUNT\]/);
  assert.equal(routeEvents.length, routingCalls);
  assert.ok(routeEvents.every((e) => e.outcome === "ok" && e.creditsUsed === 1));
  assert.ok(routeEvents.every((e) => e.endpoint.includes("apiKey=[REDACTED]")));
});

test("Workers AI malformed JSON triggers one retry inside the 15s budget and accepts valid second attempt (A13)", async (context) => {
  let attemptCount = 0;
  const baseUrl = await startMockServer(context, (_req, res) => {
    attemptCount += 1;
    res.writeHead(200, { "Content-Type": "application/json" });
    if (attemptCount === 1) {
      res.end(JSON.stringify({ success: true, result: { response: "Not JSON at all!" } }));
      return;
    }
    res.end(
      JSON.stringify({
        success: true,
        result: {
          choices: [
            {
              message: {
                content: JSON.stringify({
                  id: "compact-solo-retry-ok",
                  checkpoints: [
                    "taman-literasi",
                    "blok-m-plaza",
                    "m-bloc",
                    "taman-ayodya",
                    "stadion-madya",
                    "plaza-senayan",
                  ],
                }),
              },
            },
          ],
        },
      }),
    );
  });

  const events = [];
  const aiProvider = api.createWorkersAiEditionGenerator({
    accountId: SECRET_ACCOUNT_ID,
    apiToken: SECRET_API_TOKEN,
    baseUrl: `${baseUrl}/client/v4`,
    mode: "recorded-rehearsal",
    onEvent: (event) => events.push(event),
  });

  const prepared = await api.prepareSoloFixture({ aiProvider });
  assert.equal(prepared.ok, true);
  assert.equal(prepared.origin, "live");
  assert.equal(prepared.attempts, 2);
  assert.equal(prepared.fixture.edition.id, "compact-solo-retry-ok");
  assert.deepEqual(
    events.map((e) => e.outcome),
    ["invalid-output", "proposal-received"],
  );
});

test("provider HTTP 503 outages and malformed Geoapify payloads fall back to labeled prepared edition and snapshot without affecting an active round (A14, A16)", async (context) => {
  let failAll = true;
  let totalCalls = 0;
  const baseUrl = await startMockServer(context, (_req, res, url) => {
    totalCalls += 1;
    if (failAll) {
      res.writeHead(503, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "service unavailable" }));
      return;
    }
    if (url.pathname === "/v1/routing") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ type: "FeatureCollection", features: [] }));
      return;
    }
    res.writeHead(503);
    res.end();
  });

  const events = [];
  const aiProvider = api.createWorkersAiEditionGenerator({
    accountId: SECRET_ACCOUNT_ID,
    apiToken: SECRET_API_TOKEN,
    baseUrl: `${baseUrl}/client/v4`,
    mode: "recorded-rehearsal",
    onEvent: (event) => events.push(event),
  });
  const routeProvider = api.createGeoapifyWalkingRouteProvider({
    apiKey: SECRET_GEOAPIFY_KEY,
    baseUrl,
    mode: "recorded-rehearsal",
    onEvent: (event) => events.push(event),
  });

  const outage = await api.prepareSoloFixture({ aiProvider, routeProvider });
  assert.equal(outage.ok, true);
  assert.equal(outage.origin, "prepared");
  assert.equal(outage.fallbackReason, "ai-unavailable");
  assert.equal(outage.routeSource, "snapshot");
  assert.equal(outage.fixture.edition.board, "compact");
  assert.equal(outage.fixture.edition.format, "claim-the-city");
  assert.equal(outage.fixture.edition.players, 1);
  assert.equal(outage.fixture.edition.routes?.source, "snapshot");
  assert.ok(events.some((e) => e.kind === "ai-edition" && e.outcome === "http-error" && e.httpStatus === 503));
  assert.ok(events.some((e) => e.kind === "walking-route" && e.outcome === "http-error" && e.httpStatus === 503));

  // Malformed Geoapify GeoJSON falls back to approved snapshot cleanly.
  failAll = false;
  const badGeoEvents = [];
  const badGeoRouteProvider = api.createGeoapifyWalkingRouteProvider({
    apiKey: SECRET_GEOAPIFY_KEY,
    baseUrl,
    mode: "recorded-rehearsal",
    onEvent: (event) => badGeoEvents.push(event),
  });
  const badGeo = await api.prepareSoloFixture({ routeProvider: badGeoRouteProvider });
  assert.equal(badGeo.ok, true);
  assert.equal(badGeo.routeSource, "snapshot");
  assert.equal(badGeoEvents[0].outcome, "invalid-response");

  // Active frozen round makes zero external provider calls during play.
  failAll = true;
  const server = api.createSoloServer({
    databasePath: ":memory:",
    aiProvider,
    routeProvider,
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  context.after(() => new Promise((resolve) => server.close(resolve)));
  const apiUrl = `http://127.0.0.1:${server.address().port}`;

  const bootstrap = await fetch(`${apiUrl}/api/solo`);
  assert.equal(bootstrap.status, 200);
  const cookie = bootstrap.headers.get("set-cookie").split(";")[0];
  const { session } = await bootstrap.json();
  assert.equal(session.edition.origin, "prepared");
  assert.equal(session.edition.fallbackReason, "ai-unavailable");

  const callsBeforePlay = totalCalls;
  const checkIn = await fetch(`${apiUrl}/api/solo`, {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie },
    body: JSON.stringify({
      type: "check-in",
      actionId: "a1",
      sessionId: session.id,
      checkpointId: session.edition.start.id,
      fix: {
        latitude: session.edition.start.latitude,
        longitude: session.edition.start.longitude,
        accuracy: 5,
        timestamp: session.now,
      },
    }),
  });
  assert.equal(checkIn.status, 200);
  const start = await fetch(`${apiUrl}/api/solo`, {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie },
    body: JSON.stringify({ type: "start", actionId: "a2", sessionId: session.id }),
  });
  assert.equal(start.status, 200);
  assert.equal((await start.json()).session.phase, "active");
  assert.equal(totalCalls, callsBeforePlay, "Active session makes zero provider calls");
});

test("createProvidersFromEnv stays unconfigured without credentials and activates live adapters when env vars are set", () => {
  const unconfigured = api.createProvidersFromEnv({});
  assert.equal(unconfigured.aiMode, "unconfigured");
  assert.equal(unconfigured.routeMode, "unconfigured");
  assert.equal(unconfigured.aiProvider, undefined);
  assert.equal(unconfigured.routeProvider, undefined);

  const partialAi = api.createProvidersFromEnv({ CLOUDFLARE_ACCOUNT_ID: SECRET_ACCOUNT_ID });
  assert.equal(partialAi.aiMode, "unconfigured");

  const configured = api.createProvidersFromEnv({
    CLOUDFLARE_ACCOUNT_ID: SECRET_ACCOUNT_ID,
    CLOUDFLARE_API_TOKEN: SECRET_API_TOKEN,
    GEOAPIFY_API_KEY: SECRET_GEOAPIFY_KEY,
  });
  assert.equal(configured.aiMode, "live");
  assert.equal(configured.routeMode, "live");
  assert.equal(typeof configured.aiProvider, "function");
  assert.equal(typeof configured.routeProvider, "function");

  const scrubbed = api.redactUrlCredentials(
    `https://api.geoapify.com/v1/routing?waypoints=-6.23,106.79|-6.24,106.80&mode=walk&apiKey=${SECRET_GEOAPIFY_KEY}`,
    [SECRET_GEOAPIFY_KEY],
  );
  assert.ok(!scrubbed.includes(SECRET_GEOAPIFY_KEY));
  assert.match(scrubbed, /apiKey=\[REDACTED\]/);
});
