import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { defineConfig } from "vite";

const digest = (bytes) => createHash("sha256").update(bytes).digest("base64");

async function writeShellWorker(directory) {
  const read = (path) => readFile(join(directory, path));
  const manifest = JSON.parse(await read(".vite/manifest.json"));
  const app = JSON.parse(await read("manifest.webmanifest"));
  const paths = new Set(["/index.html", "/manifest.webmanifest", ...app.icons.map((icon) => icon.src)]);
  const visited = new Set();

  // Follow only static imports. Optional features download when opened.
  function visit(key) {
    if (visited.has(key)) return;
    visited.add(key);
    const chunk = manifest[key];
    for (const file of [chunk.file, ...(chunk.css ?? []), ...(chunk.assets ?? [])]) {
      paths.add("/" + file);
    }
    for (const dependency of chunk.imports ?? []) visit(dependency);
  }
  visit("index.html");

  const shell = await Promise.all(
    [...paths].filter((path) => !path.endsWith(".map")).sort().map(async (path) => {
      return { path, integrity: "sha256-" + digest(await read(path)) };
    }),
  );
  const version = digest(JSON.stringify(shell));
  const worker = `const prefix = "kelana-ria-shell-";
const cacheName = prefix + ${JSON.stringify(version)};
const shell = ${JSON.stringify(shell, null, 2)};
const paths = new Set(shell.map((file) => file.path));

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(cacheName);
    // Verify the public build bytes before adding the shell atomically.
    const requests = shell.map(({ path, integrity }) => new Request(path, {
      integrity, credentials: "omit", redirect: "error", cache: "no-cache"
    }));
    await cache.addAll(requests);
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((key) => key.startsWith(prefix) && key !== cacheName)
      .map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin ||
      request.headers.has("Authorization") || request.headers.has("Range")) return;

  if (request.mode === "navigate") {
    if (url.pathname !== "/" && url.pathname !== "/index.html") return;
    event.respondWith(fetch(request).catch(async (error) => {
      const cache = await caches.open(cacheName);
      const fallback = await cache.match("/index.html");
      if (!fallback) throw error;
      return fallback;
    }));
  } else if (!url.search && paths.has(url.pathname)) {
    event.respondWith((async () => {
      const cache = await caches.open(cacheName);
      return (await cache.match(url.pathname)) ?? fetch(request);
    })());
  }
});
`;
  await writeFile(join(directory, "sw.js"), worker);
}

export default defineConfig({
  build: { manifest: true, sourcemap: "hidden" },
  plugins: [{
    name: "kelana-shell-worker",
    apply: "build",
    async writeBundle({ dir }) {
      await writeShellWorker(dir);
    },
  }],
});
