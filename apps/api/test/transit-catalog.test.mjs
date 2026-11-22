import assert from "node:assert/strict";
import test from "node:test";
import {
  createSoloServer,
  filterTransitCatalog,
  haversineMeters,
  loadJakartaTransitCatalog,
  normalizeOverpassTransitPayload,
} from "../dist/index.js";

test("built-in Jakarta transit catalog contains valid MRT, LRT, KRL, and Transjakarta stops without <60m duplicates", () => {
  const catalog = loadJakartaTransitCatalog();
  assert.ok(catalog.stations.length >= 40, `Expected >= 40 built-in stops, got ${catalog.stations.length}`);
  assert.match(catalog.attribution, /OpenStreetMap/i);
  assert.match(catalog.attribution, /Transjakarta/i);

  const ids = new Set();
  const modeCounts = { mrt: 0, lrt: 0, krl: 0, transjakarta: 0 };
  for (const st of catalog.stations) {
    assert.equal(ids.has(st.id), false, `Duplicate station id: ${st.id}`);
    ids.add(st.id);
    assert.ok(st.lat >= -6.45 && st.lat <= -6.05, `Lat out of Jakarta bounds: ${st.id} ${st.lat}`);
    assert.ok(st.lng >= 106.65 && st.lng <= 107.05, `Lng out of Jakarta bounds: ${st.id} ${st.lng}`);
    assert.ok(st.mode in modeCounts, `Unexpected mode: ${st.mode}`);
    modeCounts[st.mode] += 1;
  }

  for (const mode of ["mrt", "lrt", "krl", "transjakarta"]) {
    assert.ok(modeCounts[mode] >= 8, `Expected >= 8 stations for ${mode}, got ${modeCounts[mode]}`);
    const sameMode = catalog.stations.filter((s) => s.mode === mode);
    for (let i = 0; i < sameMode.length; i += 1) {
      for (let j = i + 1; j < sameMode.length; j += 1) {
        const dist = haversineMeters(
          { latitude: sameMode[i].lat, longitude: sameMode[i].lng },
          { latitude: sameMode[j].lat, longitude: sameMode[j].lng },
        );
        assert.ok(dist >= 60, `Duplicate ${mode} stops within 60m: ${sameMode[i].id} & ${sameMode[j].id} (${dist.toFixed(1)}m)`);
      }
    }
  }
});

test("normalizeOverpassTransitPayload classifies modes, filters out-of-bounds, and deduplicates stops within 60m", () => {
  const catalog = normalizeOverpassTransitPayload({
    elements: [
      { id: 1, lat: -6.24438, lon: 106.79812, tags: { name: "Blok M BCA", subway: "yes", network: "MRT Jakarta" } },
      // Duplicate entrance 15m away
      { id: 2, lat: -6.24445, lon: 106.7982, tags: { name: "Blok M Gate B", subway: "yes", operator: "MRT Jakarta" } },
      { id: 3, center: { lat: -6.20885, lon: 106.83008 }, tags: { name: "LRT Setiabudi", station: "light_rail" } },
      { id: 4, lat: -6.20238, lon: 106.82348, tags: { name: "Sudirman", railway: "station", operator: "KAI Commuter" } },
      { id: 5, lat: -6.23831, lon: 106.79889, tags: { name: "CSW ASEAN", highway: "bus_stop", network: "Transjakarta" } },
      // Out of bounds (Bandung) must be dropped
      { id: 6, lat: -6.9147, lon: 107.6098, tags: { name: "Bandung", railway: "station" } },
    ],
  });

  assert.equal(catalog.stations.length, 4);
  assert.deepEqual(
    catalog.stations.map((s) => s.mode).sort(),
    ["krl", "lrt", "mrt", "transjakarta"],
  );
  const filtered = filterTransitCatalog(catalog, { modes: ["mrt", "krl"] });
  assert.equal(filtered.stations.length, 2);
});

test("GET /api/transit/jakarta returns cached ETag catalog and supports modes + bbox filtering", async () => {
  const server = createSoloServer({ databasePath: ":memory:" });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const port = server.address().port;
    const base = `http://127.0.0.1:${port}`;

    const fullRes = await fetch(`${base}/api/transit/jakarta`);
    assert.equal(fullRes.status, 200);
    assert.match(fullRes.headers.get("cache-control") ?? "", /max-age=3600/);
    const etag = fullRes.headers.get("etag");
    assert.ok(etag, "Expected ETag header on /api/transit/jakarta");
    const fullBody = await fullRes.json();
    assert.ok(fullBody.stations.length >= 40);

    const notModified = await fetch(`${base}/api/transit/jakarta`, {
      headers: { "if-none-match": etag },
    });
    assert.equal(notModified.status, 304);

    const compactRes = await fetch(`${base}/api/transit/jakarta?modes=mrt,lrt&bbox=106.77,-6.305,106.845,-6.195`);
    assert.equal(compactRes.status, 200);
    const compactBody = await compactRes.json();
    assert.ok(compactBody.stations.length >= 12);
    assert.equal(
      compactBody.stations.every((s) => (s.mode === "mrt" || s.mode === "lrt") && s.lat >= -6.305 && s.lat <= -6.195),
      true,
    );
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
