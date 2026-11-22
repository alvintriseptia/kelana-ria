#!/usr/bin/env node
import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { JAKARTA_BOUNDS, normalizeOverpassTransitPayload } from "../apps/api/dist/transit-catalog.js";

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const outFile = path.join(root, "apps/api/data/jakarta-transit.json");
const dryRun = process.argv.includes("--dry-run");

const bbox = `${JAKARTA_BOUNDS.minLat},${JAKARTA_BOUNDS.minLng},${JAKARTA_BOUNDS.maxLat},${JAKARTA_BOUNDS.maxLng}`;
const query = `
[out:json][timeout:25];
(
  node["railway"="station"](${bbox});
  way["railway"="station"](${bbox});
  node["railway"="halt"](${bbox});
  node["public_transport"="station"]["subway"="yes"](${bbox});
  node["public_transport"="station"]["light_rail"="yes"](${bbox});
  node["highway"="bus_stop"]["network"~"Transjakarta",i](${bbox});
  node["public_transport"="platform"]["operator"~"Transjakarta",i](${bbox});
);
out center tags;
`.trim();

const endpoint = process.env.OVERPASS_URL || "https://overpass-api.de/api/interpreter";

const response = await fetch(endpoint, {
  method: "POST",
  headers: {
    "content-type": "application/x-www-form-urlencoded;charset=UTF-8",
    accept: "application/json",
    "user-agent": "kelana-ria-transit-sync/1.0 (https://github.com/alvintriseptia/kelana-ria)",
  },
  body: `data=${encodeURIComponent(query)}`,
  signal: AbortSignal.timeout(30_000),
});

if (!response.ok) {
  throw new Error(`Overpass API HTTP ${response.status}`);
}

const raw = await response.json();
const catalog = normalizeOverpassTransitPayload(raw);

if (dryRun) {
  console.log(JSON.stringify({ count: catalog.stations.length, sample: catalog.stations.slice(0, 5) }, null, 2));
} else {
  mkdirSync(path.dirname(outFile), { recursive: true });
  writeFileSync(outFile, `${JSON.stringify(catalog, null, 2)}\n`, "utf8");
  console.log(`Synced ${catalog.stations.length} Jakarta transit stations -> ${outFile}`);
}
