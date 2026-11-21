import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import type { SoloAction } from "@kelana-ria/contracts";
import { duoHandler } from "./duo-http.js";
import { duoStore } from "./duo-store.js";
import { credential, hasJsonBody, isFix, isId, isObject, json, requestBody, setCredential } from "./http.js";
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
import { defaultCreatorDraft, defaultCreatorTasks } from "./pack-fixture.js";
import { packHandler } from "./pack-http.js";
import { packStore, validatePackVersionForPublication } from "./pack-store.js";
import { seekHandler } from "./seek-http.js";
import { seekStore } from "./seek-store.js";
import { soloStore, type SoloStoreOptions } from "./solo-store.js";

export type { GameConfiguration } from "@kelana-ria/contracts";
export {
  createMidtransAdapterFromEnv,
  createMidtransSandboxAdapter,
  createRecordedMidtransAdapter,
  defaultCreatorDraft,
  defaultCreatorTasks,
  packStore,
  signMidtransNotification,
  validatePackVersionForPublication,
  verifyMidtransSignature,
  type MidtransAdapter,
  type MidtransNotificationPayload,
  type RecordedMidtransAdapter,
  type RedactedMidtransLifecycleEvent,
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
  type CompactBoardCatalog,
  type ReviewedTask,
  type RouteLeg,
  type SoloFixture,
  type WalkingRouteSnapshot,
} from "./solo-fixture.js";
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
  ...storeOptions
}: {
  databasePath?: string;
  now?: () => number;
  secureCookie?: boolean;
  midtrans?: MidtransAdapter;
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
  const seek = seekStore(databasePath);
  const handleSeek = seekHandler(seek, now, secureCookie);
  const handlePacks = packHandler(packs, now, secureCookie);
  const server = createServer({ requestTimeout: 15_000 }, async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", "http://localhost");
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
        const session = await store.session(token, now());
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
        if (!isId(checkpointId)) return json(response, 400, { error: "invalid-request" });
        const reply = token && store.challenge(token, checkpointId, now());
        if (!reply) return json(response, 401, { error: "session-required" });
        json(response, 200, reply);
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/solo") {
        if (!token) return json(response, 401, { error: "session-required" });
        if (!hasJsonBody(request)) {
          return json(response, 415, { error: "invalid-request" });
        }
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
        const reply = await store.act(token, action, receivedAt);
        if (!reply) return json(response, 401, { error: "session-required" });
        json(response, 200, reply);
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
  const server = createSoloServer({
    databasePath: process.env.SOLO_DATABASE_PATH,
    secureCookie: process.env.SOLO_SECURE_COOKIE === "1",
  });
  server.listen(port, host, () => {
    console.log(`Solo API listening on ${host}:${port}`);
  });
}
