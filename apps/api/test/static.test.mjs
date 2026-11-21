import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createSoloServer } from "../dist/index.js";

test("GET /api/health reports operational modes without leaking secrets", async (t) => {
  const server = createSoloServer({
    databasePath: ":memory:",
    healthMeta: { aiMode: "prepared-fallback", routeMode: "prepared-fallback" },
    mapProxy: { geoapifyApiKey: "secret-key-should-not-leak" },
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => server.close());

  const { port } = server.address();
  const response = await fetch(`http://127.0.0.1:${port}/api/health`);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  const text = await response.text();
  assert.doesNotMatch(text, /secret-key-should-not-leak/);
  const body = JSON.parse(text);
  assert.deepEqual(body, {
    ok: true,
    aiMode: "prepared-fallback",
    routeMode: "prepared-fallback",
    mapMode: "geoapify-vector",
    staticWeb: false,
  });
});

test("single-origin staticDir serves built PWA files with cache headers and blocks path traversal", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "kelana-static-"));
  await mkdir(join(dir, "assets"), { recursive: true });
  await mkdir(join(dir, "licenses"), { recursive: true });
  await writeFile(join(dir, "index.html"), "<!doctype html><title>Kelana Ria</title>");
  await writeFile(join(dir, "sw.js"), "self.addEventListener('install', () => {});");
  await writeFile(join(dir, "manifest.webmanifest"), '{"name":"Kelana Ria"}');
  await writeFile(join(dir, "assets", "app-abc123.js"), "console.log('ok');");
  await writeFile(join(dir, "licenses", "maplibre-gl.txt"), "BSD-3-Clause");
  t.after(() => rm(dir, { recursive: true, force: true }));

  const server = createSoloServer({ databasePath: ":memory:", staticDir: dir });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => server.close());

  const base = `http://127.0.0.1:${server.address().port}`;

  const health = await (await fetch(`${base}/api/health`)).json();
  assert.equal(health.staticWeb, true);

  const rootRes = await fetch(`${base}/`);
  assert.equal(rootRes.status, 200);
  assert.match(rootRes.headers.get("content-type") ?? "", /text\/html/);
  assert.equal(rootRes.headers.get("cache-control"), "no-cache");
  assert.match(await rootRes.text(), /Kelana Ria/);

  const assetRes = await fetch(`${base}/assets/app-abc123.js`);
  assert.equal(assetRes.status, 200);
  assert.match(assetRes.headers.get("content-type") ?? "", /javascript/);
  assert.equal(assetRes.headers.get("cache-control"), "public, max-age=31536000, immutable");

  const swRes = await fetch(`${base}/sw.js`);
  assert.equal(swRes.status, 200);
  assert.equal(swRes.headers.get("cache-control"), "no-cache");

  const manifestRes = await fetch(`${base}/manifest.webmanifest`);
  assert.equal(manifestRes.status, 200);
  assert.match(manifestRes.headers.get("content-type") ?? "", /application\/manifest\+json/);

  const headRes = await fetch(`${base}/licenses/maplibre-gl.txt`, { method: "HEAD" });
  assert.equal(headRes.status, 200);
  assert.equal(await headRes.text(), "");

  const traversal1 = await fetch(`${base}/%2e%2e/package.json`);
  assert.equal(traversal1.status, 404);

  const apiUnknown = await fetch(`${base}/api/does-not-exist`);
  assert.equal(apiUnknown.status, 404);
});
