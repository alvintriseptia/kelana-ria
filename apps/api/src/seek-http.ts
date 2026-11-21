import type { IncomingMessage, ServerResponse } from "node:http";
import type { SeekAction } from "@kelana-ria/contracts";
import { credential, hasJsonBody, isFix, isId, isObject, json, parseLobbyAction, requestBody, setCredential } from "./http.js";
import type { seekStore } from "./seek-store.js";

const lobbyPath = "/api/seek";
const cookieName = "kelana_seek";

function parseRoomAction(value: unknown): SeekAction | undefined {
  if (!isObject(value) || !isId(value.actionId)) return undefined;
  const { type, actionId, hider, ready, roleRevision, phase, turn, checkpointId, fix } = value;
  if (type === "start") return { type, actionId };
  if (type === "assign" && (hider === "host" || hider === "guest")) return { type, actionId, hider };
  if (type === "ready" && typeof ready === "boolean" &&
      typeof roleRevision === "number" && Number.isSafeInteger(roleRevision) && roleRevision >= 0) {
    return { type, actionId, ready, roleRevision };
  }
  if (turn !== 1 && turn !== 2) return undefined;
  const checkInPhase = phase === "lobby" || phase === "seeking" || phase === "regroup";
  if (type === "leave" && (checkInPhase || phase === "head-start")) return { type, actionId, phase, turn };
  if (!isFix(fix)) return undefined;
  if (type === "check-in" && checkInPhase) return { type, actionId, phase, turn, fix };
  if ((type === "lock" || type === "investigate") && isId(checkpointId)) {
    return { type, actionId, turn, checkpointId, fix };
  }
  return undefined;
}

export function seekHandler(store: ReturnType<typeof seekStore>, now: () => number, secureCookie: boolean) {
  return async (request: IncomingMessage, response: ServerResponse, url: URL) => {
    const isLobby = url.pathname === lobbyPath;
    const code = url.pathname.match(/^\/api\/seek\/([0-9a-f]{8})$/i)?.[1].toUpperCase();
    if (!isLobby && !code) return json(response, 404, { error: "not-found" });

    const token = credential(request, cookieName);
    if (isLobby && request.method === "GET") {
      const nextToken = store.bootstrap(token);
      if (nextToken) setCredential(request, response, cookieName, nextToken, lobbyPath, secureCookie);
      return json(response, 200, {});
    }
    if (!token) return json(response, 401, { error: "session-required" });

    if (code && request.method === "GET") {
      const reply = store.get(token, code, now());
      return json(response, reply.status, reply.body);
    }
    if (request.method !== "POST") return json(response, 404, { error: "not-found" });
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
