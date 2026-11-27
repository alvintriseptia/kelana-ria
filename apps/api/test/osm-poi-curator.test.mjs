import assert from "node:assert/strict";
import { test } from "node:test";
import { createOsmPoiCurator, createSoloServer } from "../dist/index.js";

const clock = Date.UTC(2026, 10, 27, 1);
const at = (latitude, longitude) => ({ latitude, longitude });
const boundaryPolygon = [at(52.36, 4.88), at(52.36, 4.92), at(52.39, 4.92), at(52.39, 4.88)];
const request = { boundaryPolygon, categories: ["taman", "museum"] };
const node = (id, latitude, longitude, tags = {}) => ({
  type: "node", id, lat: latitude, lon: longitude, tags: { name: `Local place ${id}`, leisure: "park", ...tags },
});

test("Overpass candidates are point-in-polygon filtered, normalized, deduplicated and attributed", async () => {
  const calls = [];
  const service = createOsmPoiCurator({
    now: () => clock,
    fetchImpl: async (url, options) => {
      calls.push([url, options.body.get("data")]);
      assert.equal(options.method, "POST");
      assert.ok(options.signal);
      return Response.json({ elements: [
        node(1, 52.3751, 4.9051, { access: "yes", wheelchair: "limited", opening_hours: "Mo-Sa 09:00-17:00", email: "hidden@example.test" }),
        node(2, 52.37515, 4.90515),
        node(3, 52.36, 4.90),
        node(4, 52.400, 4.90),
        node(5, 52.377, 4.900, { access: "private" }),
        node(6, 52.377, 4.901, { access: "no" }),
        node(7, 52.377, 4.902, { military: "base" }),
        node(8, 52.377, 4.903, { building: "residential" }),
        { type: "way", id: 19, center: { lat: 52.381, lon: 4.912 }, tags: { name: "Open <Gallery>", tourism: "gallery" } },
      ] });
    },
  });
  const first = await service.curate("creator-id-secret", {
    ...request, startPoint: at(52.374568, 4.905233),
    existingPoints: [at(52.37511, 4.90511)],
    zones: [{ id: "north", centroid: at(52.38, 4.91) }, { id: "south", landmarks: [at(52.372, 4.905)] }],
  });
  assert.equal(first.ok, true);
  assert.equal(first.data.mode, "live");
  assert.deepEqual(first.data.attribution, {
    source: "OpenStreetMap Overpass API", license: "ODbL 1.0",
    retrievedAt: new Date(clock).toISOString(), notice: "© OpenStreetMap contributors (ODbL)",
  });
  const [park, gallery] = first.data.candidates;
  assert.deepEqual(first.data.candidates.map(p => p.osmId), ["node/1", "way/19"]);
  assert.equal(park.category, "taman");
  assert.equal(park.source, "osm-curated");
  assert.equal(park.fieldVerified, false);
  assert.equal(park.distanceFromStartMeters, 60);
  assert.equal(park.alreadyInDraft, true);
  assert.equal(park.suggestedZoneId, "south");
  assert.equal(park.openingHours, "Mo-Sa 09:00-17:00");
  assert.equal(park.wheelchair, "limited");
  assert.equal(park.publicAccessHint, "yes");
  assert.equal(park.tags.email, undefined);
  assert.equal(gallery.category, "museum");
  assert.equal(gallery.name, "Open Gallery");
  assert.equal(gallery.suggestedZoneId, "north");
  assert.match(calls[0][1], /\[out:json\].*poly:/);
  assert.doesNotMatch(calls[0][1], /creator-id-secret|52\.374568|4\.905233|north|south/);

  const cached = await service.curate("separate-creator", { ...request, categories: ["museum", "taman"], limit: 1 });
  assert.equal(cached.data.candidates.length, 1);
  assert.equal(cached.data.candidates[0].alreadyInDraft, false);
  assert.equal(cached.data.candidates[0].distanceFromStartMeters, undefined);
  assert.equal(calls.length, 1);

  const triangle = await service.curate("other", { ...request, boundaryPolygon: [boundaryPolygon[0], boundaryPolygon[2], boundaryPolygon[3]] });
  assert.equal(calls.length, 2);
  assert.deepEqual(triangle.data.candidates, []);
});

test("cache expires, invalid polygons and limits are rejected before contacting Overpass", async () => {
  let now = clock;
  let calls = 0;
  const service = createOsmPoiCurator({ now: () => now, fetchImpl: async () => {
    calls++;
    return Response.json({ elements: [] });
  } });
  for (const [invalid, error] of [
    [{ ...request, limit: 0 }, "invalid-request"],
    [{ ...request, categories: ["unsupported"] }, "invalid-request"],
    [{ ...request, boundaryPolygon: [boundaryPolygon[0], boundaryPolygon[2], boundaryPolygon[1], boundaryPolygon[3]] }, "invalid-request"],
    [{ ...request, boundaryPolygon: [at(0, 0), at(0, 1), at(1, 1), at(1, 0)] }, "poi-area-too-large"],
  ]) assert.deepEqual(await service.curate("creator", invalid), { ok: false, status: 400, error });
  assert.equal(calls, 0);
  await service.curate("creator", request);
  now += 599_999;
  await service.curate("creator", request);
  assert.equal(calls, 1);
  now++;
  await service.curate("creator", request);
  assert.equal(calls, 2);
});

test("Overpass outages and invalid responses fall back to clearly marked deterministic data", async () => {
  for (const fetchImpl of [
    async () => new Response("", { status: 429 }),
    async () => new Response("", { status: 503 }),
    async () => new Response("not-json"),
    async () => Response.json({ elements: [], remark: "query timed out" }),
    async () => { throw new DOMException("timed out", "TimeoutError"); },
  ]) {
    const result = await createOsmPoiCurator({ now: () => clock, fetchImpl }).curate("sample", request);
    assert.equal(result.data.mode, "local-fallback");
    assert.equal(result.data.fallbackReason, "overpass-unavailable");
    assert.ok(result.data.candidates.length > 1);
    assert.ok(result.data.candidates.every(c => c.osmId.startsWith("fixture/") && !c.fieldVerified));
  }
  const fixture = createOsmPoiCurator({ mode: "fixture", now: () => clock, fetchImpl: async () => assert.fail("Fixture mode made an external request") });
  const a = await fixture.curate("creator", request);
  assert.equal(a.data.mode, "recorded-rehearsal");
  assert.equal(a.data.fallbackReason, "fixture-mode");
  assert.deepEqual(await fixture.curate("creator", request), a);
});

test("Studio curator HTTP requires sign-in and rate-limits by account with Retry-After", async t => {
  let now = clock;
  const server = createSoloServer({ databasePath: ":memory:", now: () => now,
    allowSandboxAuthOtp: true, osmPoi: { mode: "fixture" },
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const post = (path, body, cookie) => fetch(origin + path, {
    method: "POST", headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body),
  });
  const signIn = async email => {
    const { challengeId, sandboxCode } = await (await post("/api/auth/request-otp", { email })).json();
    const verified = await post("/api/auth/verify-otp", { challengeId, code: sandboxCode });
    assert.equal(verified.status, 200);
    return verified.headers.getSetCookie()[0].split(";")[0];
  };
  const route = "/api/rulebooks/studio/curate-pois";
  assert.equal((await post(route, request)).status, 401);
  const owner = await signIn("poi-curator@kelana.test");
  assert.equal((await post(route, { ...request, limit: 41 }, owner)).status, 400);
  for (let i = 0; i < 9; i++) {
    const response = await post(route, request, owner);
    assert.equal(response.status, 200);
    assert.equal((await response.json()).mode, "recorded-rehearsal");
  }
  const limited = await post(route, request, owner);
  assert.equal(limited.status, 429);
  assert.equal(limited.headers.get("retry-after"), "60");
  assert.deepEqual(await limited.json(), { error: "rate-limited" });
  const other = await signIn("other-curator@kelana.test");
  assert.equal((await post(route, request, other)).status, 200);
  now += 60_000;
  assert.equal((await post(route, request, owner)).status, 200);
});
