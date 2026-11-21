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
import type {
  MidtransNotificationPayload,
  MidtransTransactionStatus,
} from "./midtrans-adapter.js";
import type { packStore } from "./pack-store.js";

const packPath = "/api/packs";
const webhookPath = "/api/packs/midtrans-notification";
const lifecyclePath = "/api/packs/lifecycle";

const validTransactionStatuses = new Set<MidtransTransactionStatus>([
  "pending",
  "settlement",
  "capture",
  "expire",
  "cancel",
  "deny",
]);

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

  if (type === "checkout-return") {
    return isId(value.orderId) ? { type, actionId, orderId: value.orderId } : undefined;
  }

  if (type === "verify-settlement") {
    if (!isId(value.orderId)) return undefined;
    const status = value.transactionStatus;
    if (
      status !== undefined &&
      status !== "pending" &&
      status !== "settlement" &&
      status !== "expire" &&
      status !== "cancel" &&
      status !== "deny"
    ) {
      return undefined;
    }
    if (value.statusCode !== undefined && typeof value.statusCode !== "string") return undefined;
    if (value.grossAmount !== undefined && typeof value.grossAmount !== "string") return undefined;
    if (value.currency !== undefined && typeof value.currency !== "string") return undefined;
    if (value.signatureKey !== undefined && typeof value.signatureKey !== "string") return undefined;
    return {
      type,
      actionId,
      orderId: value.orderId,
      ...(value.statusCode !== undefined ? { statusCode: value.statusCode } : {}),
      ...(status !== undefined ? { transactionStatus: status } : {}),
      ...(value.grossAmount !== undefined ? { grossAmount: value.grossAmount } : {}),
      ...(value.currency !== undefined ? { currency: value.currency } : {}),
      ...(value.signatureKey !== undefined ? { signatureKey: value.signatureKey } : {}),
    };
  }

  if (type === "redeem-pass") {
    if (
      !isId(value.passId) ||
      typeof value.roomCode !== "string" ||
      !/^[0-9a-f]{8}$/i.test(value.roomCode)
    ) {
      return undefined;
    }
    return {
      type,
      actionId,
      passId: value.passId,
      roomCode: value.roomCode.toUpperCase(),
    };
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

function parseMidtransNotification(value: unknown): MidtransNotificationPayload | undefined {
  if (!isObject(value)) return undefined;
  if (
    !isId(value.order_id) ||
    typeof value.status_code !== "string" ||
    typeof value.gross_amount !== "string" ||
    typeof value.signature_key !== "string" ||
    typeof value.transaction_status !== "string" ||
    !validTransactionStatuses.has(value.transaction_status as MidtransTransactionStatus)
  ) {
    return undefined;
  }
  if (value.currency !== undefined && typeof value.currency !== "string") return undefined;
  if (
    value.fraud_status !== undefined &&
    value.fraud_status !== "accept" &&
    value.fraud_status !== "challenge" &&
    value.fraud_status !== "deny"
  ) {
    return undefined;
  }
  if (value.payment_type !== undefined && typeof value.payment_type !== "string") return undefined;
  return {
    order_id: value.order_id,
    status_code: value.status_code,
    gross_amount: value.gross_amount,
    transaction_status: value.transaction_status as MidtransTransactionStatus,
    signature_key: value.signature_key,
    ...(value.currency !== undefined ? { currency: value.currency } : {}),
    ...(value.fraud_status !== undefined ? { fraud_status: value.fraud_status } : {}),
    ...(value.payment_type !== undefined ? { payment_type: value.payment_type } : {}),
  };
}

export function packHandler(
  store: ReturnType<typeof packStore>,
  now: () => number,
  secureCookie: boolean,
) {
  return async (request: IncomingMessage, response: ServerResponse, url: URL) => {
    if (url.pathname === webhookPath) {
      if (request.method !== "POST") return json(response, 404, { error: "not-found" });
      if (!hasJsonBody(request)) return json(response, 415, { error: "invalid-request" });
      const body = await requestBody(request);
      const receivedAt = now();
      if (body === undefined) return json(response, 413, { error: "invalid-request" });
      let parsedJson: unknown;
      try {
        parsedJson = JSON.parse(body);
      } catch {
        return json(response, 400, { error: "invalid-request" });
      }
      const payload = parseMidtransNotification(parsedJson);
      if (!payload) return json(response, 400, { error: "invalid-request" });
      const reply = await store.handleMidtransNotification(payload, receivedAt);
      return json(response, reply.status, reply.body);
    }

    if (url.pathname === lifecyclePath) {
      if (request.method !== "GET") return json(response, 404, { error: "not-found" });
      const orderId = url.searchParams.get("orderId");
      if (!isId(orderId)) return json(response, 400, { error: "invalid-request" });
      const reviewerToken = readPackToken(request, "reviewer");
      if (!reviewerToken) return json(response, 401, { error: "session-required" });
      const check = store.bootstrap(reviewerToken, "reviewer", now());
      if (check.token) return json(response, 403, { error: "forbidden-role" });
      return json(response, 200, {
        orderId,
        events: store.redactedLifecycle(orderId),
      });
    }

    if (url.pathname !== packPath) {
      return json(response, 404, { error: "not-found" });
    }
    const roleParam = url.searchParams.get("role");
    const preferredRole = roleParam ? parseRole(roleParam) : undefined;

    if (request.method === "GET") {
      const requestedRole = preferredRole ?? "public";
      const existingToken = readPackToken(request, requestedRole);
      const result = store.bootstrap(existingToken, requestedRole, now());
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
    const reply = await store.act(token, action, receivedAt);
    return json(response, reply.status, reply.body);
  };
}
