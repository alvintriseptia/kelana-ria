import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { GeoJSONVT } from "@maplibre/geojson-vt";
import { fromGeojsonVt } from "@maplibre/vt-pbf";
import { validateStyleMin } from "@maplibre/maplibre-gl-style-spec";
import { chromium } from "playwright";
import { createSoloServer } from "../../api/dist/index.js";
import { playerMapStyle } from "../src/player-map-style.ts";

const dist = new URL("../dist/", import.meta.url);
const output = new URL("../qa-results/player-map/", import.meta.url);
const manifest = JSON.parse(await readFile(new URL(".vite/manifest.json", dist), "utf8"));
const bundle = manifest["src/board-map.ts"];
const cities = {
  claim: { name: "Jakarta", fixture: "jakarta", center: [106.798, -6.2411], route: "Jalan Panglima Polim Raya" },
  seek: { name: "Bandung", fixture: "bandung", center: [107.6056, -6.9176], route: "Jalan Braga" },
};
for (const city of Object.values(cities)) {
  const geo = JSON.parse(await readFile(new URL(`./fixtures/map/${city.fixture}-osm.geojson`, import.meta.url), "utf8"));
  city.indexes = Object.fromEntries(["transportation", "landcover", "waterway", "building"].map(name => [name, new GeoJSONVT({
    type: "FeatureCollection",
    features: geo.features.filter(feature => feature.properties.layer === name),
  }, { maxZoom: 17 })]));
  const road = geo.features.find(item => item.properties.name === city.route && item.geometry.coordinates.length > 5);
  assert.ok(road, `Expected a real ${city.route} segment for the fixture walking line`);
  city.walk = road.geometry.coordinates;
}
const feature = (coordinates) => ({ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates } });

const styleFor = (upstream, mode) => ({
  version: 8,
  name: "OSM Bright comparison fixture",
  sources: {
    openmaptiles: { type: "vector", url: `${upstream}/tilejson/${mode}.json` },
    "fixture-route": { type: "geojson", data: feature(cities[mode].walk) },
    ...(mode === "claim" && { "fixture-territory": {
      type: "geojson",
      data: { type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [[
        [106.7949, -6.2427], [106.7992, -6.2428], [106.7991, -6.2393], [106.7952, -6.2392], [106.7949, -6.2427],
      ]] } },
    } }),
  },
  layers: [
    { id: "background", type: "background", paint: { "background-color": "#f8f4ef" } },
    { id: "landcover-grass-park", type: "fill", source: "openmaptiles", "source-layer": "landcover", paint: { "fill-color": "#c4e3aa" } },
    { id: "waterway-river", type: "line", source: "openmaptiles", "source-layer": "waterway", paint: { "line-color": "#71bce4", "line-width": 3 } },
    { id: "building", type: "fill", source: "openmaptiles", "source-layer": "building", minzoom: 14, paint: { "fill-color": "#ece3d9" } },
    { id: "highway-primary-casing", type: "line", source: "openmaptiles", "source-layer": "transportation", filter: ["==", ["get", "class"], "primary"], paint: { "line-width": 6, "line-color": "#dc9962" } },
    { id: "highway-minor", type: "line", source: "openmaptiles", "source-layer": "transportation", filter: ["!=", ["get", "class"], "primary"], paint: { "line-width": 4, "line-color": "#fff" } },
    { id: "highway-primary", type: "line", source: "openmaptiles", "source-layer": "transportation", filter: ["==", ["get", "class"], "primary"], paint: { "line-width": 4, "line-color": "#facd91" } },
    ...(mode === "claim" ? [{ id: "fixture-territory", type: "fill", source: "fixture-territory", paint: { "fill-color": "#417453", "fill-opacity": 0.2 } }] : []),
    { id: "fixture-route", type: "line", source: "fixture-route", paint: { "line-width": 4, "line-color": "#245d46", "line-dasharray": [1, 1] } },
  ],
});

const socket = async server => {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return `http://127.0.0.1:${server.address().port}`;
};
const replyJson = (res, data) => {
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
};
let upstream, mode = "claim";
const tileTransfers = [];
const provider = createServer((req, res) => {
  const url = new URL(req.url, upstream);
  if (url.pathname.endsWith("/style.json")) return replyJson(res, styleFor(upstream, mode));
  if (url.pathname.startsWith("/tilejson/")) return replyJson(res, {
    tilejson: "3.0.0", minzoom: 0, maxzoom: 17, format: "pbf",
    tiles: [`${upstream}/tiles/${mode}/{z}/{x}/{y}.pbf`],
  });
  const tile = /^\/tiles\/(claim|seek)\/(\d+)\/(\d+)\/(\d+)\.pbf$/.exec(url.pathname);
  if (tile) {
    const slices = Object.entries(cities[tile[1]].indexes).map(([name, index]) => [name, index.getTile(...tile.slice(2).map(Number))]);
    const bytes = fromGeojsonVt(Object.fromEntries(slices.filter(([, geoTile]) => geoTile)));
    tileTransfers.push(bytes.byteLength);
    res.writeHead(200, { "Content-Type": "application/x-protobuf" });
    return res.end(bytes);
  }
  res.writeHead(404).end();
});
upstream = await socket(provider);
const style = styleFor(upstream, "claim");
style.sprite = `${upstream}/sprites/sprite`;
style.glyphs = `${upstream}/fonts/{fontstack}/{range}.pbf`;
style.layers.push(...["poi-railway", "poi-level-3"].map(id => ({
  id, type: "symbol", source: "openmaptiles", "source-layer": "poi", minzoom: 12,
  layout: { "text-field": ["get", "name"] },
})));
const themed = playerMapStyle(style);
assert.deepEqual(validateStyleMin(themed), []);
assert.equal(themed.sources, style.sources);
assert.equal(themed.sprite, style.sprite);
assert.equal(themed.glyphs, style.glyphs);
assert.equal(themed.layers.find(layer => layer.id === "fixture-route"), style.layers.find(layer => layer.id === "fixture-route"));
assert.equal(themed.layers.find(layer => layer.id === "poi-railway").minzoom, 12);
assert.equal(themed.layers.find(layer => layer.id === "poi-level-3").minzoom, 16);
assert.equal(themed.layers[0].paint["background-color"], "#f2ebd9");
assert.notEqual(style.layers[0].paint["background-color"], themed.layers[0].paint["background-color"]);

const app = createSoloServer({ databasePath: ":memory:", staticDir: fileURLToPath(dist), mapProxy: {
  geoapifyApiKey: "fixture-map-key", geoapifyMapsBaseUrl: upstream,
} });
const origin = await socket(app);
const browser = await chromium.launch({ channel: "chromium", executablePath: process.env.CHROMIUM_PATH || undefined,
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const report = { evidence: "MapLibre, local OSM vector tile fixture and simulated game overlays", browser: browser.version(), frames: [] };
await mkdir(output, { recursive: true });

function mapPoint(id, name, longitude, latitude, extra = {}) {
  return { id, name, longitude, latitude, x: 50, y: 50, ...extra };
}

async function renderFrame({ theme, width, height, zoom, offline = false }) {
  const label = `${mode}-${theme ?? "baseline"}-${width}-z${zoom}${offline ? "-offline" : ""}`;
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1, reducedMotion: "reduce" });
  try {
    const tileStart = tileTransfers.length;
    const external = [];
    page.on("request", request => { if (new URL(request.url()).origin !== origin) external.push(request.url()); });
    await page.route(`${origin}/map-preview`, r => r.fulfill({ contentType: "text/html", body: `<!doctype html>
      <html lang="id"><meta name="viewport" content="width=device-width,initial-scale=1"><meta charset="utf-8">
      <title>Peta ${cities[mode].name} · Bukti QA</title>${bundle.css.map(css => `<link rel="stylesheet" href="/${css}">`).join("")}
      <style>body{margin:0;background:#f5f6ee;font:14px system-ui;color:#234638;display:grid;grid-template-rows:auto minmax(0,1fr);height:100dvh}header{padding:12px 14px}
      h1,p{margin:0}h1{font-size:1.3rem}header p{margin-top:4px}.board-map-shell{margin:0;border-radius:0}
      .board-map-shell{height:100%;display:grid;grid-template-rows:minmax(0,1fr) auto}
      .board-map-canvas{height:100%}.board-map-attribution{font-size:11px}</style>
      <header><h1>${mode === "claim" ? "Claim the City" : "Hide & Seek"} · ${cities[mode].name}</h1>
      <p>${offline ? "Peta skematis luring" : "Data jalan OpenStreetMap · Petak vektor lokal"}</p>
      <p>${mode === "claim" ? "Simulasi wilayah tim dan rute" : "Simulasi deduksi Radar dan rute"}</p></header>
      <div id="map"></div><script type="module">import { mountBoardMap } from "/${bundle.file}";
      window.mountFixtureMap = mountBoardMap;</script></html>` }));
    await page.goto(`${origin}/map-preview`);
    await page.waitForFunction(() => window.mountFixtureMap);
    await page.evaluate(async ({ center, theme, zoom, offline, start, checkpoints, radarCircles, deductionBoundary }) => {
      const container = document.querySelector("#map");
      const config = await (await fetch("/api/map/config")).json();
      const params = { start, startSelectable: true, startLabel: "Awal", checkpoints, radarCircles, deductionBoundary,
        camera: { center, zoom }, selfLocation: { longitude: center[0] - 0.001, latitude: center[1] + 0.0015, accuracy: 15 },
        onSelect: id => { window.selected = id; } };
      performance.mark("map-start");
      window.handle = window.mountFixtureMap({ ...params, container, config: offline ? { ...config, mode: "offline-vector" } : config, theme });
      window.updateFixtureMap = () => window.handle.update({ ...params, selectedId: checkpoints[0].id });
    }, {
      center: cities[mode].center, theme, zoom, offline,
      start: mode === "claim" ? mapPoint("start", "Blok M", 106.7977, -6.2412) : mapPoint("start", "Balai Kota", 107.609, -6.912),
      checkpoints: mode === "claim" ? [
        mapPoint("park", "Taman Ayodya", 106.7942, -6.2442, { markerKind: "landmark", landmarkArt: "park", selectable: true, label: "Tim 1 · Terkunci", markerText: "◆ ■", statusTag: "locked", colors: { foreground: "#104a40", background: "#eaf5ec" } }),
        mapPoint("library", "Taman Literasi", 106.7985, -6.2447, { markerKind: "landmark", landmarkArt: "park", selectable: true, statusTag: "unclaimed", markerText: "●" }),
        mapPoint("landmark", "M Bloc Space", 106.7981, -6.2394, { markerKind: "landmark", selectable: true, statusTag: "claimed", markerText: "● ◆", dataAttrs: { "data-protected": "true" }, colors: { foreground: "#9f2a3d", background: "#fdf0f2" } }),
        mapPoint("rival", "Pemain B", 106.7998, -6.2432, { markerKind: "rival", selectable: true, markerText: "● PB" }),
      ] : [
        mapPoint("station", "Stasiun Bandung", 107.602, -6.914, { markerKind: "station", selectable: true, markerText: "•" }),
        mapPoint("stop-near", "Halte Stasiun Bandung", 107.60225, -6.91405, { markerKind: "station", selectable: true, markerText: "•" }),
        mapPoint("stop", "Halte Asia Afrika", 107.609, -6.922, { markerKind: "station", selectable: true, markerText: "•", dimmed: true }),
        mapPoint("stop-2", "Halte Braga", 107.6087, -6.918, { markerKind: "station", selectable: true, markerText: "•" }),
      ],
      radarCircles: mode === "seek" ? [{ id: "qa-radar", center: mapPoint("radar", "Braga", 107.607, -6.9189), radiusMeters: 340, inside: false }] : [],
      deductionBoundary: mode === "seek" ? [[107.599, -6.924], [107.613, -6.924], [107.613, -6.911], [107.599, -6.911]]
        .map(([longitude, latitude]) => ({ longitude, latitude })) : undefined,
    });
    await page.locator("[data-map-ready=true]").waitFor();
    const loadMs = await page.evaluate(() => performance.now() - performance.getEntriesByName("map-start")[0].startTime);
    if (!offline) await page.locator(".board-map-attribution").evaluate(el => {
      el.firstChild.textContent = "Peta vektor uji · ";
    });
    const canvas = await page.locator(".maplibregl-canvas").elementHandle();
    const pointId = mode === "claim" ? "park" : "station";
    const pin = page.locator(`button[data-map-point="${pointId}"]`);
    await pin.press("Enter");
    assert.equal(await page.evaluate(() => window.selected), pointId);
    if (theme) {
      assert.ok((await pin.boundingBox()).width >= 44);
      assert.notEqual(await pin.evaluate(pin => getComputedStyle(pin, "::before").backgroundImage), "none");
      if (mode === "seek" && zoom === 15 && !offline) {
        const near = page.locator('button[data-map-point="stop-near"]');
        assert.match(await near.locator(".board-map-token-hit").evaluate(el => el.style.clipPath), /^polygon\(/);
        await near.click({ position: { x: 22, y: 22 } });
        assert.equal(await page.evaluate(() => window.selected), "stop-near");
        await pin.click({ position: { x: 22, y: 22 } });
        assert.equal(await page.evaluate(() => window.selected), pointId);
      }
    }
    await page.evaluate(() => window.updateFixtureMap());
    assert.ok(await canvas.evaluate(el => el === document.querySelector(".maplibregl-canvas")));
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    assert.equal(await page.locator(".board-map-attribution a").count(), offline ? 3 : 4);
    assert.deepEqual(external, []);
    await page.screenshot({ path: fileURLToPath(new URL(`${label}.png`, output)) });
    const counters = await page.evaluate(() => {
      const resources = performance.getEntriesByType("resource");
      const group = collect => resources.filter(collect).reduce((n, r) => n + r.transferSize, 0);
      return { styleBytes: group(r => new URL(r.name).pathname.endsWith("/style.json")),
        jsBytes: group(r => /\.(?:m?js)$/.test(r.name)), cssBytes: group(r => /\.css$/.test(r.name)),
        heapBytes: performance.memory?.usedJSHeapSize ?? null };
    });
    const tileBytes = tileTransfers.slice(tileStart);
    assert.equal(tileBytes.some(bytes => bytes > 0), !offline);
    const mapCenter = await page.locator(".board-map-canvas").boundingBox();
    const perfSample = page.evaluate(() => new Promise(resolve => {
      const times = [];
      const frame = now => {
        times.push(now);
        if (times.length < 24) requestAnimationFrame(frame);
        else {
          const gaps = times.slice(1).map((time, i) => time - times[i]).sort((a, b) => a - b);
          resolve(Math.round(gaps[Math.floor(gaps.length * 0.95)]));
        }
      };
      requestAnimationFrame(frame);
    }));
    await page.mouse.move(mapCenter.x + mapCenter.width / 2, mapCenter.y + mapCenter.height / 2);
    await page.mouse.down();
    await page.mouse.move(mapCenter.x + mapCenter.width / 2 + 32, mapCenter.y + mapCenter.height / 2 - 24, { steps: 12 });
    await page.mouse.up();
    const panFrameP95Ms = await perfSample;
    report.frames.push({ label, loadMs: Math.round(loadMs), tileRequests: tileBytes.length,
      tileBytes: tileBytes.reduce((sum, bytes) => sum + bytes, 0), panFrameP95Ms, ...counters });
  } finally {
    await page.close();
  }
}

try {
  for (const next of ["claim", "seek"]) {
    mode = next;
    for (const spec of [{ width: 390, height: 844, zoom: 15 }, { width: 320, height: 640, zoom: 13.6 }]) {
      await renderFrame(spec);
      await renderFrame({ ...spec, theme: "player" });
    }
    await renderFrame({ width: 320, height: 640, zoom: 15, theme: "player", offline: true });
  }
  const usage = await (await fetch(`${origin}/api/map/usage`)).json();
  assert.equal(usage.tileFailures, 0);
  for (const baseline of report.frames.filter(frame => frame.label.includes("-baseline-"))) {
    const after = report.frames.find(frame => frame.label === baseline.label.replace("-baseline-", "-player-"));
    assert.equal(after.tileRequests, baseline.tileRequests, `Tile request count changed in ${baseline.label}`);
    assert.equal(after.tileBytes, baseline.tileBytes, `Tile response bytes changed in ${baseline.label}`);
  }
  report.usage = usage;
  console.table(report.frames);
} finally {
  await writeFile(new URL("report.json", output), JSON.stringify(report, null, 2) + "\n");
  await browser.close();
  await new Promise(resolve => app.close(resolve));
  await new Promise(resolve => provider.close(resolve));
}
