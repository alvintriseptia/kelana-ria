import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import type { GameBoard, SoloAction } from "@kelana-ria/contracts";
import { duoHandler } from "./duo-http.js";
import { duoStore } from "./duo-store.js";
import { credential, hasJsonBody, isFix, isGameBoard, isId, isObject, json, requestBody, setCredential } from "./http.js";
import {
  createMidtransAdapterFromEnv,
  createMidtransSandboxAdapter,
  createRecordedMidtransAdapter,
  signMidtransNotification,
  verifyMidtransSignature,
  type MidtransAdapter,
  type MidtransNotificationPayload,
  type RecordedMidtransAdapter,
  type RedactedMidtransLifecycleEvent,
} from "./midtrans-adapter.js";
import { mapHandler, type MapProxyOptions } from "./map-http.js";
import { defaultCreatorDraft, defaultCreatorTasks } from "./pack-fixture.js";
import { packHandler } from "./pack-http.js";
import { packStore, validatePackVersionForPublication } from "./pack-store.js";
import { seekHandler } from "./seek-http.js";
import { seekStore } from "./seek-store.js";
import { staticHandler } from "./static-http.js";
import {
  buildPublicEditionPrompt,
  createGeoapifyWalkingRouteProvider,
  createProvidersFromEnv,
  createWorkersAiEditionGenerator,
  DEFAULT_CLOUDFLARE_AI_BASE_URL,
  DEFAULT_CLOUDFLARE_AI_MODEL,
  DEFAULT_GEOAPIFY_BASE_URL,
  GEOAPIFY_FREE_DAILY_CREDITS,
  GEOAPIFY_ROUTING_CREDIT_COST,
  GEOAPIFY_TILE_CREDIT_COST,
  GEOAPIFY_WALKING_ATTRIBUTION,
  parseGeoapifyWalkingResponse,
  parseWorkersAiEditionResponse,
  redactUrlCredentials,
  uniqueWalkingPairs,
  WORKERS_AI_FREE_DAILY_NEURONS,
  type ProviderEvidenceMode,
  type RedactedAiEvidenceEvent,
  type RedactedProviderEvent,
  type RedactedRouteEvidenceEvent,
} from "./provider-adapters.js";
import { soloStore, type SoloStoreOptions } from "./solo-store.js";

export type { GameBoard, GameConfiguration } from "@kelana-ria/contracts";
export {
  buildPublicEditionPrompt,
  createGeoapifyWalkingRouteProvider,
  createMidtransAdapterFromEnv,
  createMidtransSandboxAdapter,
  createProvidersFromEnv,
  createRecordedMidtransAdapter,
  createWorkersAiEditionGenerator,
  DEFAULT_CLOUDFLARE_AI_BASE_URL,
  DEFAULT_CLOUDFLARE_AI_MODEL,
  DEFAULT_GEOAPIFY_BASE_URL,
  defaultCreatorDraft,
  defaultCreatorTasks,
  GEOAPIFY_FREE_DAILY_CREDITS,
  GEOAPIFY_ROUTING_CREDIT_COST,
  GEOAPIFY_TILE_CREDIT_COST,
  GEOAPIFY_WALKING_ATTRIBUTION,
  packStore,
  parseGeoapifyWalkingResponse,
  parseWorkersAiEditionResponse,
  redactUrlCredentials,
  signMidtransNotification,
  uniqueWalkingPairs,
  validatePackVersionForPublication,
  verifyMidtransSignature,
  WORKERS_AI_FREE_DAILY_NEURONS,
  type MidtransAdapter,
  type MidtransNotificationPayload,
  type ProviderEvidenceMode,
  type RecordedMidtransAdapter,
  type RedactedAiEvidenceEvent,
  type RedactedMidtransLifecycleEvent,
  type RedactedProviderEvent,
  type RedactedRouteEvidenceEvent,
};
export {
  COMPACT_BOARD_VERSION,
  compactAlternate,
  compactCatalog,
  compactCheckpoints,
  compactReviewedTasks,
  compactRouteAttribution,
  compactStart,
  compactTrial,
  compactWalkingSnapshot,
  preparedCompactFixtures,
  type BoardCatalog,
  type CompactBoardCatalog,
  type ReviewedTask,
  type RouteLeg,
  type SoloFixture,
  type WalkingRouteSnapshot,
} from "./solo-fixture.js";
export {
  compactCheckpointIdSet,
  JAKARTA_WIDE_BOARD_VERSION,
  preparedWideFixtures,
  wideAlternate,
  wideBranches,
  wideCatalog,
  wideCheckpoints,
  wideOuterCheckpoints,
  wideOuterReviewedTasks,
  wideReviewedTasks,
  wideRouteAttribution,
  wideTrial,
  wideWalkingSnapshot,
} from "./wide-fixture.js";
export {
  compactDuoTrial,
  duoFixtureForBoard,
  wideDuoTrial,
} from "./duo-rules.js";
export {
  compactSeekTrial,
  seekFixtureForBoard,
  wideSeekTrial,
} from "./seek-rules.js";
export {
  computeGeoSnapshotHash,
  haversineMeters,
  isValidCoordinate,
  pointInPolygon,
  validateHideSeekRulebook,
} from "./seek-engine/rulebook-validator.js";
export {
  isFreshSoloEdition,
  prepareSoloFixture,
  toSoloCandidate,
  validateSoloFixture,
  type EditionGenerator,
  type EditionGeneratorRequest,
  type PrepareEditionResult,
  type ProposedSoloEdition,
  type RouteSnapshotProvider,
  type ValidationResult,
} from "./solo-validation.js";

const cookieName = "kelana_solo";
const defaultDatabasePath = fileURLToPath(new URL("../.data/solo.sqlite", import.meta.url));

function parseBoardParam(url: URL): GameBoard | "invalid" | undefined {
  const raw = url.searchParams.get("board");
  if (raw === null) return undefined;
  return isGameBoard(raw) ? raw : "invalid";
}

function parseAction(value: unknown): SoloAction | undefined {
  if (!isObject(value) || !isId(value.actionId) || !isId(value.sessionId)) return undefined;
  const { type, actionId, sessionId, checkpointId, choiceId, fix, freshEdition } = value;
  const identity = { actionId, sessionId };
  if (type === "start" || type === "abandon") return { type, ...identity };
  if (type === "replay") {
    if (freshEdition !== undefined && typeof freshEdition !== "boolean") return undefined;
    return freshEdition === undefined ? { type, ...identity } : { type, freshEdition, ...identity };
  }
  if (!isId(checkpointId)) return undefined;
  if (type === "check-in" && isFix(fix)) return { type, checkpointId, fix, ...identity };
  if (type === "answer" && isId(choiceId) && (fix === undefined || isFix(fix))) {
    return { type, checkpointId, choiceId, fix, ...identity };
  }
  return undefined;
}

export function createSoloServer({
  databasePath = defaultDatabasePath,
  now = Date.now,
  secureCookie = false,
  midtrans,
  mapProxy,
  staticDir,
  healthMeta,
  allowSimulatedLocation = false,
  ...storeOptions
}: {
  databasePath?: string;
  now?: () => number;
  secureCookie?: boolean;
  midtrans?: MidtransAdapter;
  mapProxy?: MapProxyOptions;
  staticDir?: string;
  healthMeta?: { aiMode: string; routeMode: string };
  allowSimulatedLocation?: boolean;
} & SoloStoreOptions = {}) {
  const store = soloStore(databasePath, { now, ...storeOptions });
  const duo = duoStore(databasePath);
  const packs = packStore(databasePath, {
    catalog: storeOptions.catalog,
    routes: storeOptions.snapshotRoutes,
    closedCheckpoints: storeOptions.closedCheckpoints,
    midtrans,
    unlockPaidRoom: duo.createPaidRoom,
  });
  const handleDuo = duoHandler(duo, now, secureCookie);
  const seek = seekStore(databasePath, now);
  const handleSeek = seekHandler(seek, now, secureCookie);
  const handlePacks = packHandler(packs, now, secureCookie);
  const handleMap = mapHandler(mapProxy);
  const handleStatic = staticDir ? staticHandler(staticDir) : undefined;
  const mapMode = mapProxy?.geoapifyApiKey?.trim() ? "geoapify-vector" : "offline-vector";
  const server = createServer({ requestTimeout: 15_000 }, async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", "http://localhost");
      if (request.method === "GET" && url.pathname === "/api/health") {
        json(response, 200, {
          ok: true,
          aiMode: healthMeta?.aiMode ?? "prepared-fallback",
          routeMode: healthMeta?.routeMode ?? "prepared-fallback",
          mapMode,
          staticWeb: Boolean(handleStatic),
          allowSimulatedLocation: Boolean(allowSimulatedLocation),
        });
        return;
      }
      if (url.pathname === "/api/map" || url.pathname.startsWith("/api/map/")) {
        return await handleMap(request, response, url);
      }
      if (url.pathname === "/api/duo" || url.pathname.startsWith("/api/duo/")) {
        return await handleDuo(request, response, url);
      }
      if (url.pathname === "/api/seek" || url.pathname.startsWith("/api/seek/")) {
        return await handleSeek(request, response, url);
      }
      if (url.pathname === "/api/packs" || url.pathname.startsWith("/api/packs/")) {
        return await handlePacks(request, response, url);
      }
      const token = credential(request, cookieName);
      if (request.method === "GET" && url.pathname === "/api/solo") {
        const requestedRunId = url.searchParams.get("sessionId");
        if (requestedRunId !== null) {
          if (!isId(requestedRunId)) return json(response, 400, { error: "invalid-request" });
          const archived = store.runById(requestedRunId, now());
          if (!archived) return json(response, 404, { error: "not-found" });
          json(response, 200, archived);
          return;
        }
        const board = parseBoardParam(url);
        if (board === "invalid") return json(response, 400, { error: "invalid-request" });
        const session = await store.session(token, now(), board ?? "compact");
        if ("error" in session) {
          json(response, 409, {
            error: session.error,
            closedCheckpointId: session.closedCheckpointId,
          });
          return;
        }
        if (session.token) {
          setCredential(request, response, cookieName, session.token, "/api/solo", secureCookie);
        }
        json(response, 200, session.reply);
        return;
      }
      if (request.method === "GET" && url.pathname === "/api/solo/challenge") {
        const checkpointId = url.searchParams.get("checkpointId");
        const board = parseBoardParam(url);
        if (!isId(checkpointId) || board === "invalid") return json(response, 400, { error: "invalid-request" });
        const reply = token && store.challenge(token, checkpointId, now(), board ?? "compact");
        if (!reply) return json(response, 401, { error: "session-required" });
        json(response, 200, reply);
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/solo") {
        if (!token) return json(response, 401, { error: "session-required" });
        if (!hasJsonBody(request)) {
          return json(response, 415, { error: "invalid-request" });
        }
        const board = parseBoardParam(url);
        if (board === "invalid") return json(response, 400, { error: "invalid-request" });
        const body = await requestBody(request);
        const receivedAt = now();
        if (body === undefined) return json(response, 413, { error: "invalid-request" });
        let action: SoloAction | undefined;
        try {
          action = parseAction(JSON.parse(body));
        } catch {
          return json(response, 400, { error: "invalid-request" });
        }
        if (!action) return json(response, 400, { error: "invalid-request" });
        const reply = await store.act(token, action, receivedAt, board);
        if (!reply) return json(response, 401, { error: "session-required" });
        json(response, 200, reply);
        return;
      }
      if (handleStatic && (await handleStatic(request, response, url))) {
        return;
      }
      json(response, 404, { error: "not-found" });
    } catch (error) {
      if (request.aborted) return;
      console.error("Game API request failed", error);
      json(response, 500, { error: "server-error" });
    }
  });
  server.on("close", () => {
    seek.close();
    packs.close();
    duo.close();
    store.close();
  });
  return server;
}

if (import.meta.main) {
  const host = process.env.HOST ?? "127.0.0.1";
  const port = Number(process.env.PORT ?? 8787);
  const providers = createProvidersFromEnv(process.env);
  const defaultWebDist = fileURLToPath(new URL("../../web/dist", import.meta.url));
  const staticDir = process.env.WEB_DIST_DIR || (process.env.SERVE_WEB === "1" ? defaultWebDist : undefined);
  const allowSimulatedLocation =
    process.env.ALLOW_SIMULATED_LOCATION === "1" || process.env.NODE_ENV === "development";
  const server = createSoloServer({
    databasePath: process.env.SOLO_DATABASE_PATH,
    secureCookie: process.env.SOLO_SECURE_COOKIE === "1",
    aiProvider: providers.aiProvider,
    routeProvider: providers.routeProvider,
    staticDir,
    allowSimulatedLocation,
    healthMeta: { aiMode: providers.aiMode, routeMode: providers.routeMode },
    mapProxy: {
      geoapifyApiKey: process.env.GEOAPIFY_API_KEY,
      geoapifyMapsBaseUrl: process.env.GEOAPIFY_MAPS_BASE_URL,
      getRoutingRequestCount: () =>
        providers.events.filter((event) => event.kind === "walking-route" && event.creditsUsed > 0).length,
    },
  });
  server.listen(port, host, () => {
    console.log(
      `Kelana Ria server listening on http://${host}:${port} (ai=${providers.aiMode}, routes=${providers.routeMode}, web=${staticDir ? "enabled" : "api-only"}, qaSim=${allowSimulatedLocation})`,
    );
  });
}
