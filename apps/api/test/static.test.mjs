import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createSoloServer, parseYoutubeVideoId } from "../dist/index.js";

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
    allowSimulatedLocation: false,
    demoVideoYoutubeId: null,
  });
});

test("parseYoutubeVideoId and /api/health strictly parse DEMO_VIDEO_YOUTUBE_ID", async (t) => {
  assert.equal(parseYoutubeVideoId("dQw4w9WgXcQ"), "dQw4w9WgXcQ");
  assert.equal(parseYoutubeVideoId("  abc_123-XYZ  "), "abc_123-XYZ");
  assert.equal(parseYoutubeVideoId("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=12s"), "dQw4w9WgXcQ");
  assert.equal(parseYoutubeVideoId("https://m.youtube.com/watch?v=dQw4w9WgXcQ"), "dQw4w9WgXcQ");
  assert.equal(parseYoutubeVideoId("https://youtu.be/dQw4w9WgXcQ?si=sharetoken"), "dQw4w9WgXcQ");
  assert.equal(parseYoutubeVideoId("https://www.youtube.com/shorts/dQw4w9WgXcQ"), "dQw4w9WgXcQ");
  assert.equal(parseYoutubeVideoId("https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ"), "dQw4w9WgXcQ");

  // Reject malformed, unsafe, non-YouTube, or wrong-length values
  for (const invalid of [
    "",
    "   ",
    null,
    undefined,
    12345678901,
    "short123",
    "tooLongVideoId123",
    "bad!char$12",
    "javascript:alert(1)",
    "https://evil.example/watch?v=dQw4w9WgXcQ",
    "https://youtu.be/dQw4w9WgXcQ/extra",
    "https://www.youtube.com/watch?v=bad<script>",
    "ftp://youtu.be/dQw4w9WgXcQ",
  ]) {
    assert.equal(parseYoutubeVideoId(invalid), null, `Expected invalid value to yield null: ${String(invalid)}`);
  }

  const validServer = createSoloServer({
    databasePath: ":memory:",
    demoVideoYoutubeId: "https://youtu.be/K3lAnA_R1a0?si=demo",
  });
  validServer.listen(0, "127.0.0.1");
  await once(validServer, "listening");
  t.after(() => validServer.close());
  const validHealth = await (await fetch(`http://127.0.0.1:${validServer.address().port}/api/health`)).json();
  assert.equal(validHealth.demoVideoYoutubeId, "K3lAnA_R1a0");

  const invalidServer = createSoloServer({
    databasePath: ":memory:",
    demoVideoYoutubeId: "https://evil.example/watch?v=K3lAnA_R1a0",
  });
  invalidServer.listen(0, "127.0.0.1");
  await once(invalidServer, "listening");
  t.after(() => invalidServer.close());
  const invalidHealth = await (await fetch(`http://127.0.0.1:${invalidServer.address().port}/api/health`)).json();
  assert.equal(invalidHealth.demoVideoYoutubeId, null);
});

test("single-origin staticDir serves built PWA files on / and /catalog with cache headers and blocks path traversal", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "kelana-static-"));
  await mkdir(join(dir, "assets"), { recursive: true });
  await mkdir(join(dir, "licenses"), { recursive: true });
  await writeFile(join(dir, "index.html"), "<!doctype html><title>Kelana Ria</title>");
  await writeFile(join(dir, "sw.js"), "self.addEventListener('install', () => {});");
  await writeFile(join(dir, "manifest.webmanifest"), '{"name":"Kelana Ria","start_url":"/catalog"}');
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

  for (const spaPath of ["/", "/catalog", "/catalog?edition=official-jakarta-compact-claim&version=1"]) {
    const res = await fetch(`${base}${spaPath}`);
    assert.equal(res.status, 200, `Expected 200 for ${spaPath}`);
    assert.match(res.headers.get("content-type") ?? "", /text\/html/);
    assert.equal(res.headers.get("cache-control"), "no-cache");
    assert.match(await res.text(), /Kelana Ria/);
  }

  const catalogHead = await fetch(`${base}/catalog`, { method: "HEAD" });
  assert.equal(catalogHead.status, 200);
  assert.equal(catalogHead.headers.get("cache-control"), "no-cache");
  assert.equal(await catalogHead.text(), "");

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

  // Verify the committed PWA manifest launches installed users straight into /catalog
  const webManifestPath = fileURLToPath(new URL("../../web/public/manifest.webmanifest", import.meta.url));
  const webManifest = JSON.parse(await readFile(webManifestPath, "utf8"));
  assert.equal(webManifest.start_url, "/catalog");
  assert.equal(webManifest.scope, "/");
});
