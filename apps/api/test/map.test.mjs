import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import * as api from "../dist/index.js";

const SECRET_KEY = "geoapify-secret-map-key-9999";

async function listen(context, server) {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  context.after(
    () =>
      new Promise((resolve, reject) =>
        server.listening ? server.close((err) => (err ? reject(err) : resolve())) : resolve(),
      ),
  );
  return `http://127.0.0.1:${server.address().port}`;
}

test("map endpoints stay in offline-vector mode without credentials and never expose keys", async (context) => {
  const url = await listen(context, api.createSoloServer({ databasePath: ":memory:" }));
  const config = await (await fetch(`${url}/api/map/config`)).json();
  assert.equal(config.mode, "offline-vector");
  assert.equal(config.styleUrl, null);
  assert.equal(config.mapLibreLicenseUrl, "/licenses/maplibre-gl.txt");
  assert.equal(config.tileCreditCost, 0.25);
  assert.equal(config.freeDailyCredits, 3000);

  const styleRes = await fetch(`${url}/api/map/style.json`);
  assert.equal(styleRes.status, 503);

  const usage = await (await fetch(`${url}/api/map/usage`)).json();
  assert.equal(usage.mode, "offline-vector");
  assert.equal(usage.tileRequests, 0);
  assert.equal(usage.totalEstimatedCredits, 0);
});

test("Geoapify vector map proxy rewrites URLs, keeps apiKey server-side, blocks SSRF, and tracks tile+routing credits (§8)", async (context) => {
  let failTile = false;
  let mockOrigin = "";
  const upstream = createServer((req, res) => {
    const reqUrl = new URL(req.url ?? "/", "http://127.0.0.1");
    assert.equal(reqUrl.searchParams.get("apiKey"), SECRET_KEY);
    if (reqUrl.pathname === "/v1/styles/osm-bright/style.json") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          version: 8,
          sprite: `${mockOrigin}/v1/styles/osm-bright/sprite?apiKey=${SECRET_KEY}`,
          glyphs: `${mockOrigin}/v1/styles/osm-bright/fonts/{fontstack}/{range}.pbf?apiKey=${SECRET_KEY}`,
          sources: {
            openmaptiles: {
              type: "vector",
              url: `${mockOrigin}/v1/tilejson/openmaptiles.json?apiKey=${SECRET_KEY}`,
            },
          },
          layers: [],
        }),
      );
      return;
    }
    if (reqUrl.pathname === "/v1/tilejson/openmaptiles.json") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          tiles: [`${mockOrigin}/v1/tile/14/13054/8467.pbf?apiKey=${SECRET_KEY}`],
        }),
      );
      return;
    }
    if (reqUrl.pathname.endsWith(".pbf")) {
      if (failTile) {
        res.writeHead(503);
        res.end("unavailable");
        return;
      }
      res.writeHead(200, { "Content-Type": "application/x-protobuf" });
      res.end(Buffer.from([0x1a, 0x00]));
      return;
    }
    res.writeHead(404);
    res.end();
  });
  mockOrigin = await listen(context, upstream);

  const apiUrl = await listen(
    context,
    api.createSoloServer({
      databasePath: ":memory:",
      mapProxy: {
        geoapifyApiKey: SECRET_KEY,
        geoapifyMapsBaseUrl: mockOrigin,
        getRoutingRequestCount: () => 13,
      },
    }),
  );

  const config = await (await fetch(`${apiUrl}/api/map/config`)).json();
  assert.equal(config.mode, "geoapify-vector");
  assert.equal(config.styleUrl, "/api/map/style.json");
  assert.ok(!JSON.stringify(config).includes(SECRET_KEY));

  // Style JSON rewrites every Geoapify URL through /api/map/asset with zero apiKey leakage.
  const styleText = await (await fetch(`${apiUrl}/api/map/style.json`)).text();
  assert.ok(!styleText.includes(SECRET_KEY), "Style JSON must never leak GEOAPIFY_API_KEY");
  const style = JSON.parse(styleText);
  assert.match(style.sources.openmaptiles.url, /^\/api\/map\/asset\?u=/);
  assert.match(style.sprite, /^\/api\/map\/asset\?u=/);

  // TileJSON proxy also rewrites tile URLs without leaking apiKey.
  const tileJsonText = await (await fetch(`${apiUrl}${style.sources.openmaptiles.url}`)).text();
  assert.ok(!tileJsonText.includes(SECRET_KEY));
  const tileJson = JSON.parse(tileJsonText);
  assert.match(tileJson.tiles[0], /^\/api\/map\/asset\?u=/);

  // Fetch two tiles (1 ok, 1 failing 503) and verify credit telemetry (0.25/tile + 1/routing).
  const okTile = await fetch(`${apiUrl}${tileJson.tiles[0]}`);
  assert.equal(okTile.status, 200);
  failTile = true;
  const badTile = await fetch(`${apiUrl}${tileJson.tiles[0]}`);
  assert.equal(badTile.status, 502);

  // SSRF protection rejects any non-allowlisted host.
  const ssrf1 = await fetch(
    `${apiUrl}/api/map/asset?u=${encodeURIComponent("http://169.254.169.254/latest/meta-data")}`,
  );
  assert.equal(ssrf1.status, 400);
  const ssrf2 = await fetch(
    `${apiUrl}/api/map/asset?u=${encodeURIComponent("https://evil.example/tiles/1/2/3.pbf")}`,
  );
  assert.equal(ssrf2.status, 400);

  const usage = await (await fetch(`${apiUrl}/api/map/usage`)).json();
  assert.equal(usage.mode, "geoapify-vector");
  assert.equal(usage.tileRequests, 2);
  assert.equal(usage.tileFailures, 1);
  assert.equal(usage.estimatedTileCredits, 0.5);
  assert.equal(usage.routingRequests, 13);
  assert.equal(usage.estimatedRoutingCredits, 13);
  assert.equal(usage.totalEstimatedCredits, 13.5);
  assert.equal(usage.freeDailyCredits, 3000);
});
