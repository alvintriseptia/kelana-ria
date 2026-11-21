import type { IncomingMessage, ServerResponse } from "node:http";
import type { SeekAction, SeekQuestionFamily } from "@kelana-ria/contracts";
import { credential, hasJsonBody, isFix, isId, isObject, json, parseLobbyAction, requestBody, setCredential } from "./http.js";
import { maxBase64Length } from "./seek-photo.js";
import type { seekStore } from "./seek-store.js";

const lobbyPath = "/api/seek";
const cookieName = "kelana_seek";
const maxActionBytes = 16 * 1024;
const clueFamilies: ReadonlySet<string> = new Set<SeekQuestionFamily>(["radar", "photo", "warmer", "matching", "measuring", "nearest"]);

function isClueFamily(value: unknown): value is SeekQuestionFamily {
  return typeof value === "string" && clueFamilies.has(value);
}

function isCardList(value: unknown): value is string[] {
  return Array.isArray(value) && value.length <= 3 && value.every(isId);
}

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
  const { family, radiusMeters, landmarkId, referenceId, previousReferenceId, questionId, choiceId, photo,
    cardIds, discardIds, cardId, discardId } = value;
  if (type === "ask" && isClueFamily(family) &&
      (radiusMeters === undefined || typeof radiusMeters === "number" && Number.isSafeInteger(radiusMeters)) &&
      (landmarkId === undefined || isId(landmarkId)) &&
      (referenceId === undefined || isId(referenceId)) &&
      (previousReferenceId === undefined || family === "warmer" && isId(previousReferenceId))) {
    return { type, actionId, turn, family, radiusMeters, landmarkId, referenceId, previousReferenceId };
  }
  if (type === "answer-question" && isId(questionId)) {
    if (isId(choiceId) && photo === undefined) return { type, actionId, turn, questionId, choiceId };
    if (typeof photo === "string" && choiceId === undefined) return { type, actionId, turn, questionId, photo };
    return undefined;
  }
  if (type === "photo-unavailable" && isId(questionId)) return { type, actionId, turn, questionId };
  if (type === "choose-cards" && isCardList(cardIds) && (discardIds === undefined || isCardList(discardIds))) {
    return { type, actionId, turn, cardIds, discardIds };
  }
  if (type === "play-card" && isId(cardId) && (discardId === undefined || isId(discardId))) {
    return { type, actionId, turn, cardId, discardId };
  }
  if (!isFix(fix)) return undefined;
  if (type === "check-in" && checkInPhase) return { type, actionId, phase, turn, fix };
  if ((type === "lock" || type === "investigate") && isId(checkpointId)) {
    return { type, actionId, turn, checkpointId, fix };
  }
  if (type === "reference" && isId(checkpointId)) return { type, actionId, turn, checkpointId, fix };
  return undefined;
}

export function seekHandler(store: ReturnType<typeof seekStore>, now: () => number, secureCookie: boolean) {
  return async (request: IncomingMessage, response: ServerResponse, url: URL) => {
    const isLobby = url.pathname === lobbyPath;
    const path = url.pathname.match(/^\/api\/seek\/([0-9a-f]{8})(?:\/photos\/([a-z0-9_-]{1,100}))?$/i);
    const code = path?.[1].toUpperCase();
    const questionId = path?.[2];
    if (!isLobby && !code) return json(response, 404, { error: "not-found" });

    const token = credential(request, cookieName);
    if (isLobby && request.method === "GET") {
      const nextToken = store.bootstrap(token);
      if (nextToken) setCredential(request, response, cookieName, nextToken, lobbyPath, secureCookie);
      return json(response, 200, {});
    }
    if (!token) return json(response, 401, { error: "session-required" });

    if (code && request.method === "GET") {
      const receivedAt = now();
      const reply = await store.ordered(code, () => questionId === undefined
        ? store.get(token, code, receivedAt)
        : store.photo(token, code, questionId, receivedAt));
      if ("photo" in reply) {
        response.writeHead(200, {
          "Cache-Control": "no-store",
          "Content-Type": "image/jpeg",
          "Content-Length": reply.photo.byteLength,
          "Cross-Origin-Resource-Policy": "same-origin",
          "X-Content-Type-Options": "nosniff",
        });
        return response.end(reply.photo);
      }
      return json(response, reply.status, reply.body);
    }
    if (request.method !== "POST" || questionId !== undefined) return json(response, 404, { error: "not-found" });
    if (!hasJsonBody(request)) return json(response, 415, { error: "invalid-request" });
    const body = await requestBody(request, code ? maxBase64Length + maxActionBytes : maxActionBytes);
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
      if ((action.type !== "answer-question" || action.photo === undefined) && Buffer.byteLength(body) > maxActionBytes) {
        return json(response, 413, { error: "invalid-request" });
      }
      const reply = await store.ordered(code, () => store.act(token, code, action, receivedAt));
      return json(response, reply.status, reply.body);
    }
    const action = parseLobbyAction(value);
    if (!action) return json(response, 400, { error: "invalid-request" });
    const room = store.lobbyRoom(token, action);
    const reply = room
      ? await store.ordered(room, () => store.lobby(token, action, receivedAt))
      : store.lobby(token, action, receivedAt);
    return json(response, reply.status, reply.body);
  };
}
