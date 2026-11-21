import type { IncomingMessage, ServerResponse } from "node:http";
import type {
  PackAction,
  PackDraftPayload,
  PackRole,
  PackTaskInput,
} from "@kelana-ria/contracts";
import {
  credential,
  hasJsonBody,
  isId,
  isObject,
  json,
  requestBody,
  setCredential,
} from "./http.js";
import type { packStore } from "./pack-store.js";

const packPath = "/api/packs";

function cookieNameForRole(role: PackRole) {
  return `kelana_pack_${role}`;
}

function parseRole(value: string | null): PackRole {
  if (value === "writer" || value === "reviewer") return value;
  return "public";
}

function readPackToken(request: IncomingMessage, preferredRole?: PackRole): string | undefined {
  if (preferredRole) {
    const exact = credential(request, cookieNameForRole(preferredRole));
    if (exact) return exact;
  }
  for (const role of ["writer", "reviewer", "public"] as const) {
    const token = credential(request, cookieNameForRole(role));
    if (token) return token;
  }
  return credential(request, "kelana_pack");
}

function parseTaskInput(value: unknown): PackTaskInput | undefined {
  if (!isObject(value) || !isId(value.checkpointId)) return undefined;
  if (typeof value.question !== "string" || typeof value.verificationNotes !== "string") {
    return undefined;
  }
  if (!isId(value.correctChoiceId) || !Array.isArray(value.choices)) {
    return undefined;
  }
  const choices: { id: string; label: string }[] = [];
  for (const item of value.choices) {
    if (!isObject(item) || !isId(item.id) || typeof item.label !== "string") {
      return undefined;
    }
    choices.push({ id: item.id, label: item.label });
  }
  return {
    checkpointId: value.checkpointId,
    question: value.question,
    choices,
    correctChoiceId: value.correctChoiceId,
    verificationNotes: value.verificationNotes,
  };
}

function parseDraftPayload(value: unknown): PackDraftPayload | undefined {
  if (!isObject(value)) return undefined;
  if (typeof value.byline !== "string" || typeof value.title !== "string") {
    return undefined;
  }
  if (value.format !== "claim-the-city" || value.board !== "compact") {
    return undefined;
  }
  if (
    !Array.isArray(value.supportedPlayers) ||
    !value.supportedPlayers.every((p) => p === 1 || p === 2)
  ) {
    return undefined;
  }
  if (typeof value.priceIdr !== "number" || !Number.isFinite(value.priceIdr)) {
    return undefined;
  }
  if (!Array.isArray(value.tasks)) return undefined;
  const tasks: PackTaskInput[] = [];
  for (const rawTask of value.tasks) {
    const parsed = parseTaskInput(rawTask);
    if (!parsed) return undefined;
    tasks.push(parsed);
  }
  const packId =
    typeof value.packId === "string" && isId(value.packId)
      ? value.packId
      : undefined;
  return {
    packId,
    byline: value.byline,
    title: value.title,
    format: "claim-the-city",
    board: "compact",
    supportedPlayers: value.supportedPlayers as (1 | 2)[],
    priceIdr: value.priceIdr,
    tasks,
  };
}

function parsePackAction(value: unknown): PackAction | undefined {
  if (!isObject(value) || !isId(value.actionId)) return undefined;
  const { type, actionId } = value;

  if (type === "save-draft") {
    const draft = parseDraftPayload(value.draft);
    return draft ? { type, actionId, draft } : undefined;
  }

  if (!isId(value.packId) || typeof value.version !== "number" || !Number.isInteger(value.version)) {
    return undefined;
  }
  const packId = value.packId;
  const version = value.version;

  if (type === "submit-draft" || type === "publish-version") {
    return { type, actionId, packId, version };
  }
  if (type === "request-changes" && typeof value.note === "string") {
    return { type, actionId, packId, version, note: value.note };
  }
  if (
    type === "report-closure" &&
    isId(value.checkpointId) &&
    typeof value.reason === "string"
  ) {
    return {
      type,
      actionId,
      packId,
      version,
      checkpointId: value.checkpointId,
      reason: value.reason,
    };
  }
  if (type === "pause-version" && typeof value.reason === "string") {
    return { type, actionId, packId, version, reason: value.reason };
  }
  if (type === "create-order" && (value.players === 1 || value.players === 2)) {
    return { type, actionId, packId, version, players: value.players };
  }
  return undefined;
}

export function packHandler(
  store: ReturnType<typeof packStore>,
  now: () => number,
  secureCookie: boolean,
) {
  return async (request: IncomingMessage, response: ServerResponse, url: URL) => {
    if (url.pathname !== packPath) {
      return json(response, 404, { error: "not-found" });
    }
    const roleParam = url.searchParams.get("role");
    const preferredRole = roleParam ? parseRole(roleParam) : undefined;

    if (request.method === "GET") {
      const requestedRole = preferredRole ?? "public";
      const existingToken = readPackToken(request, requestedRole);
      const result = store.bootstrap(existingToken, requestedRole);
      if (result.token) {
        setCredential(
          request,
          response,
          cookieNameForRole(result.role),
          result.token,
          packPath,
          secureCookie,
        );
      }
      return json(response, 200, result.body);
    }

    if (request.method !== "POST") {
      return json(response, 404, { error: "not-found" });
    }

    const token = readPackToken(request, preferredRole);
    if (!token) {
      return json(response, 401, { error: "session-required" });
    }
    if (!hasJsonBody(request)) {
      return json(response, 415, { error: "invalid-request" });
    }
    const body = await requestBody(request);
    const receivedAt = now();
    if (body === undefined) {
      return json(response, 413, { error: "invalid-request" });
    }
    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(body);
    } catch {
      return json(response, 400, { error: "invalid-request" });
    }
    const action = parsePackAction(parsedJson);
    if (!action) {
      return json(response, 400, { error: "invalid-request" });
    }
    const reply = store.act(token, action, receivedAt);
    return json(response, reply.status, reply.body);
  };
}
