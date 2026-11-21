import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { TLSSocket } from "node:tls";
import { fileURLToPath } from "node:url";
import type { LocationFix, SoloAction, SoloReply } from "@kelana-ria/contracts";
import { soloStore, type SoloStoreOptions } from "./solo-store.js";

export type { GameConfiguration } from "@kelana-ria/contracts";
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
const maxBodyBytes = 16 * 1024;
const defaultDatabasePath = fileURLToPath(new URL("../.data/solo.sqlite", import.meta.url));

function credential(request: IncomingMessage) {
  const match = request.headers.cookie?.match(/(?:^|;\s*)kelana_solo=([A-Za-z0-9_-]{43})(?:;|$)/);
  return match?.[1];
}

function json(
  response: ServerResponse,
  status: number,
  content: SoloReply | { error: string; closedCheckpointId?: string },
) {
  response.writeHead(status, {
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(JSON.stringify(content));
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,100}$/.test(value);
}

function isFix(value: unknown): value is LocationFix {
  return isObject(value) && ["latitude", "longitude", "accuracy", "timestamp"].every((key) =>
    typeof value[key] === "number" && Number.isFinite(value[key]));
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

async function requestBody(request: IncomingMessage) {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request.iterator({ destroyOnReturn: false }) as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > maxBodyBytes) {
      request.resume();
      return undefined;
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

export function createSoloServer({
  databasePath = defaultDatabasePath,
  now = Date.now,
  secureCookie = false,
  ...storeOptions
}: { databasePath?: string; now?: () => number; secureCookie?: boolean } & SoloStoreOptions = {}) {
  const store = soloStore(databasePath, { now, ...storeOptions });
  const server = createServer({ requestTimeout: 15_000 }, async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", "http://localhost");
      const token = credential(request);
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
          const secure = secureCookie || request.socket instanceof TLSSocket;
          response.setHeader("Set-Cookie", `${cookieName}=${session.token}; Path=/api/solo; HttpOnly; SameSite=Strict; Max-Age=2592000${secure ? "; Secure" : ""}`);
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
        if (!/^application\/json(?:\s*;|$)/i.test(request.headers["content-type"] ?? "")) {
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
      console.error("Solo API request failed", error);
      json(response, 500, { error: "server-error" });
    }
  });
  server.on("close", () => store.close());
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
