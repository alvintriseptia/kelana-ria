import type { IncomingMessage, ServerResponse } from "node:http";
import type { DuoAction } from "@kelana-ria/contracts";
import type { duoStore } from "./duo-store.js";
import { credential, hasJsonBody, isFix, isId, isObject, json, parseLobbyAction, requestBody, setCredential } from "./http.js";

const lobbyPath = "/api/duo";
const cookieName = "kelana_duo";

function parseRoomAction(value: unknown): DuoAction | undefined {
  if (!isObject(value) || !isId(value.actionId)) return undefined;
  const { type, actionId, phase, ready, checkpointId, choiceId, fix } = value;
  if (type === "start") return { type, actionId };
  if (type === "leave" && (phase === "lobby" || phase === "active")) return { type, actionId, phase };
  if (type === "ready" && typeof ready === "boolean") return { type, actionId, ready };
  if (!isId(checkpointId)) return undefined;
  if (type === "check-in" && isFix(fix)) return { type, actionId, checkpointId, fix };
  if (type === "answer" && isId(choiceId) && (fix === undefined || isFix(fix))) {
    return { type, actionId, checkpointId, choiceId, fix };
  }
  return undefined;
}

export function duoHandler(store: ReturnType<typeof duoStore>, now: () => number, secureCookie: boolean) {
  return async (request: IncomingMessage, response: ServerResponse, url: URL) => {
    const isLobby = url.pathname === lobbyPath;
    const roomPath = url.pathname.match(/^\/api\/duo\/([0-9A-Fa-f]{8})(\/challenge)?$/);
    if (!isLobby && !roomPath) return json(response, 404, { error: "not-found" });

    const token = credential(request, cookieName);
    if (isLobby && request.method === "GET") {
      const nextToken = store.bootstrap(token);
      if (nextToken) setCredential(request, response, cookieName, nextToken, lobbyPath, secureCookie);
      return json(response, 200, {});
    }
    if (!token) return json(response, 401, { error: "session-required" });

    const code = roomPath?.[1].toUpperCase();
    const hasChallenge = roomPath?.[2] !== undefined;
    if (code && request.method === "GET") {
      const checkpointId = hasChallenge ? url.searchParams.get("checkpointId") : undefined;
      if (hasChallenge && !isId(checkpointId)) return json(response, 400, { error: "invalid-request" });
      const reply = store.get(token, code, now(), checkpointId ?? undefined);
      return json(response, reply.status, reply.body);
    }
    if (request.method !== "POST" || hasChallenge) return json(response, 404, { error: "not-found" });
    if (!hasJsonBody(request)) return json(response, 415, { error: "invalid-request" });
    const body = await requestBody(request);
    const receivedAt = now();
    if (body === undefined) return json(response, 413, { error: "invalid-request" });
    let value: unknown;
    try {
      value = JSON.parse(body);
    } catch {
      return json(response, 400, { error: "invalid-request" });
    }

    if (code) {
      const action = parseRoomAction(value);
      if (!action) return json(response, 400, { error: "invalid-request" });
      const reply = store.act(token, code, action, receivedAt);
      return json(response, reply.status, reply.body);
    }
    const action = parseLobbyAction(value);
    if (!action) return json(response, 400, { error: "invalid-request" });
    const reply = store.lobby(token, action, receivedAt);
    return json(response, reply.status, reply.body);
  };
}
