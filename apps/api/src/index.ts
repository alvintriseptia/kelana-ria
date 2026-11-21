import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import type { SoloAction } from "@kelana-ria/contracts";
import { duoHandler } from "./duo-http.js";
import { duoStore } from "./duo-store.js";
import { credential, hasJsonBody, isFix, isId, isObject, json, requestBody, setCredential } from "./http.js";
import { seekHandler } from "./seek-http.js";
import { seekStore } from "./seek-store.js";
import { soloStore } from "./solo-store.js";

export type { GameConfiguration } from "@kelana-ria/contracts";

const cookieName = "kelana_solo";
const defaultDatabasePath = fileURLToPath(new URL("../.data/solo.sqlite", import.meta.url));

function parseAction(value: unknown): SoloAction | undefined {
  if (!isObject(value) || !isId(value.actionId) || !isId(value.sessionId)) return undefined;
  const { type, actionId, sessionId, checkpointId, choiceId, fix } = value;
  const identity = { actionId, sessionId };
  if (type === "start" || type === "abandon" || type === "replay") return { type, ...identity };
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
}: { databasePath?: string; now?: () => number; secureCookie?: boolean } = {}) {
  const store = soloStore(databasePath);
  const duo = duoStore(databasePath);
  const handleDuo = duoHandler(duo, now, secureCookie);
  const seek = seekStore(databasePath);
  const handleSeek = seekHandler(seek, now, secureCookie);
  const server = createServer({ requestTimeout: 15_000 }, async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", "http://localhost");
      if (url.pathname === "/api/duo" || url.pathname.startsWith("/api/duo/")) {
        return await handleDuo(request, response, url);
      }
      if (url.pathname === "/api/seek" || url.pathname.startsWith("/api/seek/")) {
        return await handleSeek(request, response, url);
      }
      const token = credential(request, cookieName);
      if (request.method === "GET" && url.pathname === "/api/solo") {
        const session = store.session(token, now());
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
        const reply = store.act(token, action, receivedAt);
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
