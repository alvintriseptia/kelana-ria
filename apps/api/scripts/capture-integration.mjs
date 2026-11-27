import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as api from "../dist/index.js";

const rootDir = fileURLToPath(new URL("../", import.meta.url));
const args = process.argv.slice(2);
const requireLive = args.includes("--require-live");
const outIndex = args.indexOf("--out");
const outPath =
  outIndex >= 0 && args[outIndex + 1]
    ? resolve(process.cwd(), args[outIndex + 1])
    : resolve(rootDir, ".data/integration-evidence.json");

const accountId = process.env.CLOUDFLARE_ACCOUNT_ID?.trim();
const apiToken = process.env.CLOUDFLARE_API_TOKEN?.trim();
const geoapifyApiKey = process.env.GEOAPIFY_API_KEY?.trim();
const model = process.env.CLOUDFLARE_AI_MODEL?.trim() || api.DEFAULT_CLOUDFLARE_AI_MODEL;

const missingEnv = [];
if (!accountId) missingEnv.push("CLOUDFLARE_ACCOUNT_ID");
if (!apiToken) missingEnv.push("CLOUDFLARE_API_TOKEN");
if (!geoapifyApiKey) missingEnv.push("GEOAPIFY_API_KEY");

const isLive = missingEnv.length === 0;
if (requireLive && !isLive) {
  console.error(
    `Missing required live provider credentials: ${missingEnv.join(", ")}. Set them in the environment and retry.`,
  );
  process.exit(1);
}

const mode = isLive ? "live" : "recorded-rehearsal";
const secretsToGuard = [accountId, apiToken, geoapifyApiKey].filter(Boolean);
const { catalog: defaultCatalog, snapshot: defaultSnapshot } = api.getDefaultProviderAssets();
const sampleCheckpoints = Object.keys(defaultCatalog.checkpoints).slice(0, 6);

async function startRehearsalServer() {
  const snapshotByPair = new Map();
  for (const leg of defaultSnapshot.legs) {
    if (leg.mode !== "walk") continue;
    const from = leg.fromId === defaultCatalog.start.id ? defaultCatalog.start : defaultCatalog.checkpoints[leg.fromId];
    const to = leg.toId === defaultCatalog.start.id ? defaultCatalog.start : defaultCatalog.checkpoints[leg.toId];
    if (!from || !to) continue;
    const key = `${from.latitude},${from.longitude}|${to.latitude},${to.longitude}`;
    snapshotByPair.set(key, leg);
  }

  let failMode = false;
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    if (failMode) {
      res.writeHead(503, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "rehearsed-provider-outage" }));
      return;
    }
    if (req.method === "POST" && url.pathname.includes("/ai/run/")) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          success: true,
          result: {
            response: JSON.stringify({
              id: `${defaultCatalog.packId}-rehearsal-v1`,
              checkpoints: sampleCheckpoints,
              targets: defaultCatalog.targets,
              durationMs: defaultCatalog.durationMs,
            }),
          },
        }),
      );
      return;
    }
    if (req.method === "GET" && url.pathname === "/v1/routing") {
      const waypoints = url.searchParams.get("waypoints") ?? "";
      const leg = snapshotByPair.get(waypoints);
      const distance = leg?.distanceMeters ?? 650;
      const time = Math.round((leg?.travelMs ?? 480_000) / 1000);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          type: "FeatureCollection",
          features: [
            {
              type: "Feature",
              properties: { mode: "walk", distance, time },
            },
          ],
        }),
      );
      return;
    }
    res.writeHead(404);
    res.end();
  });

  await new Promise((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
  return {
    baseUrl: `http://127.0.0.1:${server.address().port}`,
    setFailMode: (next) => {
      failMode = next;
    },
    close: () => new Promise((resolveClose) => server.close(resolveClose)),
  };
}

const rehearsal = await startRehearsalServer();
try {
  const captureEvents = [];
  const aiProvider = isLive
    ? api.createWorkersAiEditionGenerator({
        accountId,
        apiToken,
        model,
        baseUrl: process.env.CLOUDFLARE_AI_BASE_URL?.trim() || api.DEFAULT_CLOUDFLARE_AI_BASE_URL,
        mode: "live",
        onEvent: (event) => captureEvents.push(event),
      })
    : api.createWorkersAiEditionGenerator({
        accountId: "rehearsal-account",
        apiToken: "rehearsal-token",
        model,
        baseUrl: `${rehearsal.baseUrl}/client/v4`,
        mode: "recorded-rehearsal",
        onEvent: (event) => captureEvents.push(event),
      });

  const routeProvider = isLive
    ? api.createGeoapifyWalkingRouteProvider({
        apiKey: geoapifyApiKey,
        baseUrl: process.env.GEOAPIFY_ROUTING_BASE_URL?.trim() || api.DEFAULT_GEOAPIFY_BASE_URL,
        mode: "live",
        onEvent: (event) => captureEvents.push(event),
      })
    : api.createGeoapifyWalkingRouteProvider({
        apiKey: "rehearsal-geoapify-key",
        baseUrl: rehearsal.baseUrl,
        mode: "recorded-rehearsal",
        onEvent: (event) => captureEvents.push(event),
      });

  const captured = await api.prepareProviderEdition({
    aiProvider,
    routeProvider,
  });

  // Always rehearse an outage against a deterministic 503 stub (A14, A16).
  const outageEvents = [];
  rehearsal.setFailMode(true);
  const outageAi = api.createWorkersAiEditionGenerator({
    accountId: "rehearsal-outage-account",
    apiToken: "rehearsal-outage-token",
    model,
    baseUrl: `${rehearsal.baseUrl}/client/v4`,
    mode: "recorded-rehearsal",
    onEvent: (event) => outageEvents.push(event),
  });
  const outageRoutes = api.createGeoapifyWalkingRouteProvider({
    apiKey: "rehearsal-outage-key",
    baseUrl: rehearsal.baseUrl,
    mode: "recorded-rehearsal",
    onEvent: (event) => outageEvents.push(event),
  });
  const outage = await api.prepareProviderEdition({
    aiProvider: outageAi,
    routeProvider: outageRoutes,
  });

  const routingCreditsUsed = captureEvents
    .filter((event) => event.kind === "walking-route")
    .reduce((sum, event) => sum + event.creditsUsed, 0);

  const report = {
    capturedAt: new Date().toISOString(),
    mode,
    liveCredentialsPresent: isLive,
    missingCredentials: missingEnv,
    packId: defaultCatalog.packId,
    board: defaultCatalog.board,
    boardVersion: defaultCatalog.boardVersion,
    format: defaultCatalog.format,
    players: defaultCatalog.players,
    quotasAndRights: {
      cloudflareWorkersAi: {
        model,
        license: "MIT (zai-org/GLM-4.7-Flash)",
        freeAllocation: `${api.WORKERS_AI_FREE_DAILY_NEURONS} neurons/day (confirm Workers Free vs Workers Paid model eligibility at capture time)`,
        privacyBoundary: "Public board catalog IDs and zones only; zero player coordinates, credentials, room secrets, or answer keys.",
      },
      geoapify: {
        freeDailyCredits: api.GEOAPIFY_FREE_DAILY_CREDITS,
        routingCreditCost: api.GEOAPIFY_ROUTING_CREDIT_COST,
        tileCreditCost: api.GEOAPIFY_TILE_CREDIT_COST,
        attribution: api.GEOAPIFY_WALKING_ATTRIBUTION,
        termsNote: "Commercial use with Geoapify and OpenStreetMap attribution; confirm production free-tier and stored-route terms before public launch.",
      },
      transjakartaGtfs: {
        license: "CC BY 4.0",
        attribution: "Transjakarta GTFS (CC BY 4.0) with modifications indicated",
      },
    },
    captureResult: captured.ok
      ? {
          ok: true,
          origin: captured.origin,
          routeSource: captured.routeSource,
          attempts: captured.attempts,
          editionId: captured.edition.id,
          checkpoints: captured.edition.checkpoints.map((c) => c.id),
          routeAttribution: captured.edition.routes,
          routingCreditsUsed,
          redactedEvents: captureEvents,
        }
      : {
          ok: false,
          error: captured.error,
          attempts: captured.attempts,
          redactedEvents: captureEvents,
        },
    outageRehearsal: outage.ok
      ? {
          ok: true,
          origin: outage.origin,
          fallbackReason: outage.fallbackReason,
          routeSource: outage.routeSource,
          editionId: outage.edition.id,
          configuration: {
            board: outage.edition.board,
            format: outage.edition.format,
            players: outage.edition.players,
          },
          routeAttribution: outage.edition.routes,
          redactedEvents: outageEvents,
        }
      : {
          ok: false,
          error: outage.error,
          redactedEvents: outageEvents,
        },
  };

  const serialized = JSON.stringify(report, null, 2) + "\n";
  for (const secret of secretsToGuard) {
    assert.ok(!serialized.includes(secret), "Refusing to write unredacted credential to evidence file");
  }

  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, serialized, "utf8");

  console.log(
    `Integration evidence written to ${outPath} (mode=${mode}, captureOk=${report.captureResult.ok}, routingCredits=${routingCreditsUsed}, outageFallback=${report.outageRehearsal.ok ? report.outageRehearsal.origin : "failed"})`,
  );
  if (!captured.ok || !outage.ok) {
    process.exitCode = 1;
  }
} finally {
  await rehearsal.close();
}
