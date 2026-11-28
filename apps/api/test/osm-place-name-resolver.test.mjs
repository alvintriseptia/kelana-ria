import assert from "node:assert/strict";
import { test } from "node:test";
import * as osm from "../dist/osm-poi-curator.js";

const point = (latitude, longitude) => ({ latitude, longitude });
const boundaryPolygon = [point(-6.19, 106.81), point(-6.19, 106.84), point(-6.16, 106.84), point(-6.16, 106.81)];
const draft = { boundaryPolygon, cityLabel: "Jakarta" };
const now = Date.UTC(2026, 10, 28);
const nominatim = (name, osm_id, lat = "-6.1754", lon = "106.8272", overrides = {}) => ({
  place_id: osm_id + 1_000_000, osm_type: "node", osm_id, lat, lon, name,
  display_name: `${name}, Jakarta, Indonesia`, category: "tourism", type: "museum",
  address: { city: "Jakarta", country_code: "id" }, ...overrides,
});
const places = (...names) => names.map((name, i) => ({ clientKey: `p${i + 1}`, name }));

test("recorded search classifies exact, outside, misleading and ambiguous names without inventing coordinates", async () => {
  assert.equal(typeof osm.resolvePlaceNamesFromOsm, "function");
  const results = await osm.resolvePlaceNamesFromOsm({
    ...draft,
    places: places("City Museum", "North Museum", "Garden", "Twin Museum", "Closed Museum", "Remote Museum", "Broken Museum"),
    zones: [{ id: "west", centroid: point(-6.18, 106.813) }, { id: "center", landmarks: [point(-6.175, 106.828)] }],
  }, {
    mode: "recorded-rehearsal",
    fetchImpl: async () => assert.fail("Recorded mode must not contact the provider"),
    recordedResults: {
      "City Museum": [nominatim("Museum Kota", 10, undefined, undefined, {
        namedetails: { "name:en": "City Museum" }, extratags: { access: "public", opening_hours: "Tu-Su 09:00-17:00" },
      })],
      "North Museum": [nominatim("North Museum", 11, "-6.15")],
      Garden: [nominatim("Garden Café", 12)],
      "Twin Museum": [nominatim("Twin Museum", 13), nominatim("Twin Museum", 14, "-6.18")],
      "Closed Museum": [nominatim("Closed Museum", 15, undefined, undefined, { extratags: { access: "private" } })],
      "Remote Museum": [nominatim("Remote Museum", 16, "-6.5")],
      "Broken Museum": [nominatim("Broken Museum", 17, "")],
    },
  });
  assert.deepEqual(results[0], {
    clientKey: "p1", name: "City Museum", status: "resolved", latitude: -6.1754, longitude: 106.8272,
    osmId: "node/10", category: "museum", suggestedZoneId: "center", source: "osm-curated", fieldVerified: false,
    accessHint: "public", publicHoursHint: "Tu-Su 09:00-17:00",
  });
  assert.deepEqual(results[1], {
    clientKey: "p2", name: "North Museum", status: "outside_boundary", latitude: -6.15, longitude: 106.8272,
    osmId: "node/11", category: "museum",
  });
  assert.deepEqual(results.slice(2), ["Garden", "Twin Museum", "Closed Museum", "Remote Museum", "Broken Museum"].map((name, i) => ({
    clientKey: `p${i + 3}`, name, status: "unresolved",
  })));
  assert.equal(osm.osmPlaceNameAttribution(now, { mode: "recorded-rehearsal" }).notice, "© OpenStreetMap contributors (ODbL)");
});

test("Nominatim requests use an Indonesian geofence and cache provider results while projecting the current draft", async () => {
  const calls = [];
  let timestamp = now;
  const options = {
    nominatimApiUrl: "https://fixture-nominatim.example.test/",
    now: () => timestamp,
    fetchImpl: async (url, init) => {
      calls.push([new URL(url), init]);
      return Response.json([nominatim("City Museum", 10)]);
    },
  };
  const input = { ...draft, places: places("City Museum"), startPoint: point(-6.170987, 106.831234) };
  const first = await osm.resolvePlaceNamesFromOsm(input, options);
  assert.equal(first[0].status, "resolved");
  const [url, init] = calls[0];
  assert.equal(url.pathname, "/search");
  assert.equal(url.searchParams.get("q"), "City Museum, Jakarta");
  assert.equal(url.searchParams.get("countrycodes"), "id");
  assert.equal(url.searchParams.get("bounded"), "1");
  const viewbox = url.searchParams.get("viewbox").split(",").map(Number);
  assert.ok(viewbox[0] < 106.81 && viewbox[1] > -6.16 && viewbox[2] > 106.84 && viewbox[3] < -6.19);
  assert.doesNotMatch(url.href, /170987|831234/);
  assert.match(new Headers(init.headers).get("user-agent"), /KelanaRia.*github\.com/);
  assert.ok(init.signal);

  timestamp += 599_999;
  const second = await osm.resolvePlaceNamesFromOsm({ ...input, zones: [{ id: "new", centroid: point(-6.175, 106.827) }] }, options);
  assert.equal(second[0].suggestedZoneId, "new");
  assert.equal(calls.length, 1);
  timestamp++;
  await osm.resolvePlaceNamesFromOsm(input, options);
  assert.equal(calls.length, 2);
});

test("default Overpass requests batch at most fifteen names and retain unmatched client keys", async () => {
  const calls = [];
  const results = await osm.resolvePlaceNamesFromOsm({ ...draft, places: places(...Array.from({ length: 16 }, (_, i) => `Museum ${i + 1}`)) }, {
    fetchImpl: async (url, init) => {
      calls.push([url, init]);
      return Response.json({ elements: [
        { type: "way", id: 100, center: { lat: -6.174, lon: 106.827 }, tags: { name: "Museum 1", tourism: "museum" } },
        { type: "node", id: 200, lat: -6.173, lon: 106.828, tags: { name: "Museum 16", tourism: "museum" } },
      ] });
    },
  });
  assert.equal(calls.length, 1);
  const [url, init] = calls[0];
  assert.equal(url, "https://overpass-api.de/api/interpreter");
  assert.equal(init.method, "POST");
  assert.match(init.body.get("data"), /"ISO3166-1"="ID"/);
  assert.match(init.body.get("data"), /Museum 15/);
  assert.doesNotMatch(init.body.get("data"), /Museum 16/);
  assert.equal(results.length, 16);
  assert.equal(results[0].osmId, "way/100");
  assert.deepEqual(results[15], { clientKey: "p16", name: "Museum 16", status: "unresolved" });
});

test("provider failure, malformed JSON and aborts leave names unresolved", async () => {
  const input = { ...draft, places: places("City Museum") };
  const expected = [{ ...input.places[0], status: "unresolved" }];
  for (const fetchImpl of [
    async () => { throw new TypeError("Unavailable"); },
    async () => new Response("", { status: 503 }),
    async () => new Response("not JSON"),
    async () => new Promise(() => {}),
  ]) assert.deepEqual(await osm.resolvePlaceNamesFromOsm(input, { fetchImpl, timeoutMs: 20 }), expected);

  const controller = new AbortController();
  const result = osm.resolvePlaceNamesFromOsm(input, { signal: controller.signal, fetchImpl: async () => new Promise(() => {}) });
  controller.abort();
  assert.deepEqual(await result, expected);
});
