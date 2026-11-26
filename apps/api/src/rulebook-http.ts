import { maxBase64Length } from "./seek-photo.js";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type {
  ClaimEngineAction,
  ClaimRulebookPack,
  GeoSnapshot,
  HideSeekRulebookPack,
  RulebookFormat,
  SeekEngineAction,
  SeekMapPreviewRequest,
} from "@kelana-ria/contracts";
import { credential, hasJsonBody, isObject, json, requestBody, setCredential } from "./http.js";
import type { MidtransNotificationPayload } from "./midtrans-adapter.js";
import type { PlaySeekCardParams } from "./seek-engine/deck-engine.js";
import type { GeoSeedRequest } from "./seek-engine/geo-seeder.js";
import type { rulebookStore, StoredRulebookRecord } from "./rulebook-store.js";

const cookieName = "kelana_rulebook";

type Store = ReturnType<typeof rulebookStore>;

function studioRecord({ ownerHash: _ownerHash, ...record }: StoredRulebookRecord) {
  return record;
}

function hashKey(value: string) {
  return createHash("sha256").update(value).digest();
}

export function rulebookHandler(
  store: Store, now: () => number, secureCookie = false, allowHideSeekQa = false, allowSandboxCheckout = false,
  reviewerKey = "",
) {
  const configuredReviewer = reviewerKey.trim();
  const reviewerHash = configuredReviewer ? hashKey(configuredReviewer) : undefined;

  function canReview(request: IncomingMessage): boolean {
    const key = /^Bearer (.+)$/i.exec(request.headers.authorization ?? "")?.[1];
    return Boolean(reviewerHash && key && timingSafeEqual(reviewerHash, hashKey(key)));
  }

  function resolveQaFix(action: Record<string, unknown>, roomCode: string, cred: string, ts: number): boolean {
    if (!isObject(action.fix) || !("qaLocationId" in action.fix)) return true;
    if (!allowHideSeekQa || typeof action.fix.qaLocationId !== "string") return false;
    const fix = store.qaLocation(roomCode, cred, action.fix.qaLocationId, ts);
    if (!fix) return false;
    action.fix = fix;
    return true;
  }

  function ensureCred(request: IncomingMessage, response: ServerResponse): string {
    const existing = credential(request, cookieName);
    if (existing) return existing;
    const fresh = randomBytes(32).toString("base64url");
    setCredential(request, response, cookieName, fresh, "/api/rulebooks", secureCookie);
    return fresh;
  }

  return async function handle(request: IncomingMessage, response: ServerResponse, url: URL): Promise<void> {
    const path = url.pathname;
    if (request.method === "GET" && path === "/api/rulebooks/catalog") {
      const member = credential(request, cookieName);
      json(response, 200, {
        editions: store.listPublicListings(undefined, true),
        sharedRecaps: store.listPublicRecaps(),
        activeRooms: member ? store.listActiveRooms(member, now()) : [],
        allowSandboxCheckout,
      });
      return;
    }
    if (request.method === "GET" && path === "/api/rulebooks/shared") {
      const edition = url.searchParams.get("edition") ?? undefined;
      const rawVersion = url.searchParams.get("version");
      let version: number | undefined;
      if (rawVersion !== null) {
        const parsed = Number(rawVersion);
        if (!Number.isSafeInteger(parsed) || parsed < 1) return json(response, 400, { error: "invalid-request" });
        version = parsed;
      }
      return json(response, 200, { recaps: store.listPublicRecaps(edition, version) });
    }
    const sharedRoute = /^\/api\/rulebooks\/shared\/(SR-[\dA-F]{12})$/.exec(path);
    if (request.method === "GET" && sharedRoute) {
      const recap = store.readPublicRecap(sharedRoute[1]);
      return recap ? json(response, 200, { recap }) : json(response, 404, { error: "shared-recap-unavailable" });
    }
    if (request.method === "GET" && path === "/api/rulebooks/recaps") {
      const member = credential(request, cookieName);
      return json(response, 200, { recaps: member ? store.listRecaps(member) : [] });
    }
    const recapRoute = /^\/api\/rulebooks\/recaps\/((?:RC|RB)-[\dA-F]{6})$/.exec(path);
    if (request.method === "GET" && recapRoute) {
      const member = credential(request, cookieName);
      const detail = member ? store.readRecapDetail(recapRoute[1], member) : undefined;
      return detail ? json(response, 200, detail) : json(response, 404, { error: "recap-unavailable" });
    }
    if (request.method === "GET" && path === "/api/rulebooks") {
      const role = url.searchParams.get("role") ?? "public";
      const rawFormat = url.searchParams.get("format");
      const format: RulebookFormat | undefined =
        rawFormat === "hide-and-seek" || rawFormat === "claim-the-city" ? rawFormat : undefined;
      const listings = store.listPublicListings(format);
      if (role === "writer") {
        const { versions, earnings } = store.creatorStudio(ensureCred(request, response));
        json(response, 200, {
          role,
          listings,
          versions: versions.filter(record => !format || record.format === format).map(studioRecord),
          earnings,
          reviewEnabled: Boolean(reviewerHash),
        });
        return;
      }
      if (role === "reviewer") {
        if (!canReview(request)) return json(response, 403, { error: "reviewer-only" });
        const visible = store.listAllVersions().filter(record => !record.isOfficial &&
          (!format || record.format === format) && (record.status === "submitted" || record.status === "published"));
        return json(response, 200, { role, versions: visible.map(studioRecord) });
      }
      json(response, 200, { role: "public", listings, allowHideSeekQa, allowSandboxCheckout });
      return;
    }

    const photoRoute = /^\/api\/rulebooks\/rooms\/([\w-]+)\/photos\/([\w-]+)$/.exec(path);
    if (request.method === "GET" && photoRoute) {
      const cred = credential(request, cookieName);
      const photo = cred && store.viewRoomPhoto(photoRoute[1], cred, photoRoute[2], store.roomTime(photoRoute[1], now()));
      if (!photo) return json(response, 404, { error: "photo-not-found" });
      response.writeHead(200, {
        "Content-Type": "image/jpeg",
        "Content-Length": photo.length,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      });
      response.end(photo);
      return;
    }

    if (request.method === "GET" && path.startsWith("/api/rulebooks/rooms/")) {
      const roomCode = decodeURIComponent(path.slice("/api/rulebooks/rooms/".length));
      const cred = ensureCred(request, response);
      const view = store.viewRoom(roomCode, cred, store.roomTime(roomCode, now()));
      if (!view) return json(response, 404, { error: "room-not-found" });
      json(response, 200, view);
      return;
    }

    if (request.method !== "POST") {
      json(response, 405, { error: "method-not-allowed" });
      return;
    }
    if (!hasJsonBody(request)) {
      json(response, 415, { error: "invalid-request" });
      return;
    }
    const photoUpload = path === "/api/rulebooks/seek-photo" || path === "/api/rulebooks/claim-photo";
    const raw = await requestBody(request, photoUpload ? maxBase64Length + 1024 : 512 * 1024);
    if (raw === undefined) return json(response, 413, { error: "invalid-request" });
    let body: unknown;
    try {
      body = JSON.parse(raw);
    } catch {
      return json(response, 400, { error: "invalid-request" });
    }
    if (!isObject(body)) return json(response, 400, { error: "invalid-request" });

    const recapShareRoute = /^\/api\/rulebooks\/recaps\/((?:RC|RB)-[\dA-F]{6})\/(share|unshare)$/.exec(path);
    if (recapShareRoute) {
      const member = credential(request, cookieName);
      if (!member) return json(response, 404, { error: "recap-unavailable" });
      const [, matchId, action] = recapShareRoute;
      if (action === "unshare") {
        const result = store.unshareRecap(matchId, member);
        return result ? json(response, 200, result) : json(response, 404, { error: "recap-unavailable" });
      }
      const rawAliases = body.aliases;
      if (rawAliases !== undefined && !isObject(rawAliases)) {
        return json(response, 400, { error: "invalid-request" });
      }
      const aliases: Record<string, string> | undefined = rawAliases
        ? Object.fromEntries(
            Object.entries(rawAliases).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
          )
        : undefined;
      if (body.useApprovedRoomNames !== undefined && typeof body.useApprovedRoomNames !== "boolean") {
        return json(response, 400, { error: "invalid-request" });
      }
      const result = store.shareRecap(
        matchId,
        member,
        { aliases, useApprovedRoomNames: body.useApprovedRoomNames === true },
        now(),
      );
      return result ? json(response, 200, result) : json(response, 404, { error: "recap-unavailable" });
    }

    if (path === "/api/rulebooks/seek-photo") {
      const { roomCode, questionId, actionId, photoBase64 } = body;
      const cred = credential(request, cookieName);
      if (!cred || typeof roomCode !== "string" || typeof questionId !== "string" ||
          typeof actionId !== "string" || actionId.length < 1 || actionId.length > 100 || typeof photoBase64 !== "string") {
        return json(response, 400, { error: "invalid-request" });
      }
      const reply = await store.answerSeekPhoto(roomCode, cred, questionId, actionId, photoBase64, () => store.roomTime(roomCode, now()));
      return json(response, reply.error ? 400 : 200, reply);
    }

    if (path === "/api/rulebooks/claim-photo") {
      const { roomCode, landmarkId, curseInstanceId, actionId, photoBase64 } = body;
      const cred = credential(request, cookieName);
      const validId = (id: unknown): id is string => typeof id === "string" && id.length > 0;
      const target = validId(landmarkId) && curseInstanceId === undefined ? { landmarkId }
        : validId(curseInstanceId) && landmarkId === undefined ? { curseInstanceId } : null;
      if (!cred || !validId(roomCode) || !target || !validId(actionId) || actionId.length > 100 || typeof photoBase64 !== "string") {
        return json(response, 400, { error: "invalid-request" });
      }
      const reply = await store.submitClaimPhoto(roomCode, cred, actionId, photoBase64, target, now);
      return json(response, reply.error ? 400 : 200, reply);
    }

    if (path === "/api/rulebooks/midtrans-notification") {
      const payload = body as Partial<MidtransNotificationPayload> & { hostName?: string };
      if (typeof payload.order_id !== "string") return json(response, 400, { error: "invalid-request" });
      const res = await store.settleVerifiedOrder(
        payload.order_id,
        undefined,
        payload.hostName ?? "Host",
        payload,
        now(),
      );
      json(response, res.ok ? 200 : 400, res);
      return;
    }

    const cred = ensureCred(request, response);
    const ts = now();

    if (path === "/api/rulebooks/catalog") {
      const { type, edition, version, mode, requestId } = body;
      if (typeof edition !== "string" || !edition || typeof version !== "number" ||
          !Number.isSafeInteger(version) || version < 1 || (mode !== "solo" && mode !== "group") ||
          typeof requestId !== "string" || !/^[\w-]{16,80}$/.test(requestId)) {
        return json(response, 400, { error: "invalid-request" });
      }
      if (type === "play") {
        const result = store.createFreeRoomFromRulebook(edition, version, cred, "Host", ts, false, mode, requestId);
        return json(response, result.ok ? 200 : 400, result);
      }
      if (type !== "buy" && type !== "check-payment" && type !== "simulate-payment") {
        return json(response, 400, { error: "invalid-request" });
      }
      if (!allowSandboxCheckout) return json(response, 403, { error: "checkout-unavailable" });
      if (type === "buy") {
        const result = await store.createOrder(cred, edition, version, ts, mode, requestId);
        return json(response, result.ok ? 200 : 400, result);
      }
      const order = store.viewCatalogOrder(cred, edition, version, mode, requestId);
      if (!order) return json(response, 404, { error: "order-not-found" });
      if (type === "simulate-payment" && order.paymentMode !== "recorded-sandbox") {
        return json(response, 400, { error: "simulation-unavailable" });
      }
      const settlement = await store.settleVerifiedOrder(order.orderId, cred, "Host",
        type === "simulate-payment" ? { transaction_status: "settlement", status_code: "200" } : undefined, ts);
      return json(response, settlement.ok ? 200 : 400, settlement);
    }

    if (path === "/api/rulebooks/question-preview") {
      const { roomCode, family, itemId } = body;
      if (typeof roomCode !== "string" || typeof itemId !== "string" ||
          (family !== "radar" && family !== "matching" && family !== "measuring" && family !== "tentacles")) {
        return json(response, 400, { error: "invalid-request" });
      }
      const roomTs = store.roomTime(roomCode, ts);
      if (!resolveQaFix(body, roomCode, cred, roomTs)) return json(response, 400, { error: "invalid-qa-location" });
      const reply = store.previewSeekQuestion(roomCode, cred, body as SeekMapPreviewRequest, roomTs);
      return json(response, reply.error ? 400 : 200, reply);
    }

    if (path === "/api/rulebooks/seed-geo") {
      const seeded = await store.seedGeoFromOfficialFixture(body as unknown as GeoSeedRequest);
      json(response, 200, { ok: true, snapshot: seeded });
      return;
    }

    if (path === "/api/rulebooks") {
      const type = body.type;
      if (type === "publish-version" || type === "request-changes" || type === "pause-version") {
        if (!canReview(request)) return json(response, 403, { error: "reviewer-only" });
        const decision = type === "publish-version" ? { action: "publish" as const }
          : type === "request-changes" ? { action: "request-changes" as const, note: String(body.note ?? "") }
          : { action: "pause" as const, reason: String(body.reason ?? "") };
        const res = store.reviewVersion(String(body.packId ?? ""), Number(body.version ?? 0), decision, ts);
        return json(response, res.ok ? 200 : 400, res.ok ? { ...res, record: studioRecord(res.record) } : res);
      }
      if (type === "clone-official") {
        const res = store.cloneOfficialTemplate(
          String(body.templatePackId ?? ""),
          cred,
          {
            packId: String(body.packId ?? ""),
            title: String(body.title ?? ""),
            byline: String(body.byline ?? ""),
            priceIdr: Number(body.priceIdr ?? 0),
          },
          ts,
        );
        json(response, res.ok ? 200 : 400, res.ok ? { ...res, record: studioRecord(res.record) } : res);
        return;
      }
      if (type === "save-draft") {
        const res = store.saveDraft(
          cred,
          body.pack as HideSeekRulebookPack | ClaimRulebookPack,
          body.snapshot as GeoSnapshot,
          ts,
          { rehashSnapshot: Boolean(body.rehashSnapshot) },
        );
        json(response, res.ok ? 200 : 400, res.ok ? { ...res, record: studioRecord(res.record) } : res);
        return;
      }
      if (type === "submit-draft") {
        const res = store.submitDraft(cred, String(body.packId ?? ""), Number(body.version ?? 0), ts);
        json(response, res.ok ? 200 : 400, res.ok ? { ...res, record: studioRecord(res.record) } : res);
        return;
      }
      if (type === "create-free-room") {
        if (body.qa === true && !allowHideSeekQa) return json(response, 403, { error: "seek-qa-disabled" });
        const requestId = typeof body.requestId === "string" && /^[\w-]{8,100}$/.test(body.requestId)
          ? body.requestId : undefined;
        const res = store.createFreeRoomFromRulebook(
          String(body.packId ?? ""),
          Number(body.version ?? 1),
          cred,
          String(body.hostName ?? "Host"),
          ts,
          body.qa === true,
          undefined,
          requestId,
        );
        json(response, res.ok ? 200 : 400, res);
        return;
      }
      if (type === "create-order") {
        if (!allowSandboxCheckout) return json(response, 403, { error: "checkout-unavailable" });
        const requestId = typeof body.requestId === "string" && /^[\w-]{8,100}$/.test(body.requestId)
          ? body.requestId : undefined;
        const res = await store.createOrder(
          cred,
          String(body.packId ?? ""),
          Number(body.version ?? 1),
          ts,
          undefined,
          requestId,
        );
        json(response, res.ok ? 200 : 400, res);
        return;
      }
      if (type === "verify-settlement") {
        if (!allowSandboxCheckout) return json(response, 403, { error: "checkout-unavailable" });
        const res = await store.settleVerifiedOrder(
          String(body.orderId ?? ""),
          cred,
          String(body.hostName ?? "Host"),
          {
            order_id: String(body.orderId ?? ""),
            status_code: typeof body.statusCode === "string" ? body.statusCode : undefined,
            transaction_status: body.transactionStatus as MidtransNotificationPayload["transaction_status"] | undefined,
            gross_amount: typeof body.grossAmount === "string" ? body.grossAmount : undefined,
            currency: typeof body.currency === "string" ? body.currency : undefined,
            signature_key: typeof body.signatureKey === "string" ? body.signatureKey : undefined,
          },
          ts,
        );
        json(response, res.ok ? 200 : 400, res);
        return;
      }
      const roomCode = String(body.roomCode ?? "");
      const roomTs = store.roomTime(roomCode, ts);
      if (type === "seek-qa-advance") {
        if (!allowHideSeekQa) return json(response, 403, { error: "seek-qa-disabled" });
        const { step, actionId, expectedDeadline } = body;
        if ((step !== "minute" && step !== "five-minutes" && step !== "phase-end") ||
            typeof actionId !== "string" || actionId.length < 1 || actionId.length > 100) {
          return json(response, 400, { error: "invalid-request" });
        }
        const res = store.advanceQaClock(roomCode, cred, actionId, step, expectedDeadline, ts);
        return json(response, res.error === "qa-host-only" ? 403 : res.error ? 400 : 200, res);
      }
      if (type === "join-room") {
        const res = store.joinRoom(roomCode, cred, String(body.name ?? "Player"), roomTs);
        json(response, res.ok ? 200 : 400, res);
        return;
      }
      if (type === "room-action") {
        if (!isObject(body.action)) return json(response, 400, { error: "invalid-request" });
        if (!resolveQaFix(body.action, roomCode, cred, roomTs)) return json(response, 400, { error: "invalid-qa-location" });
        const res = store.actInRoom(roomCode, cred, body.action as SeekEngineAction | ClaimEngineAction, roomTs);
        json(response, "error" in res && !("room" in res) ? 400 : 200, res);
        return;
      }
      if (type === "play-card") {
        const actionId = typeof body.actionId === "string" && body.actionId.length > 0 && body.actionId.length <= 100
          ? body.actionId : undefined;
        const res = store.playCardInRoom(roomCode, cred, body.params as PlaySeekCardParams, roomTs, actionId);
        json(response, res.ok ? 200 : 400, res);
        return;
      }
      if (type === "deck-action") {
        const action = isObject(body.action) ? body.action : {};
        if (!resolveQaFix(action, roomCode, cred, roomTs)) return json(response, 400, { error: "invalid-qa-location" });
        const res = store.deckActionInRoom(roomCode, cred, action, roomTs);
        json(response, res.ok ? 200 : 400, res);
        return;
      }
    }

    json(response, 404, { error: "not-found" });
  };
}
