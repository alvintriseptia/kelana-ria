import { maxBase64Length } from "./seek-photo.js";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type {
  AuthUser,
  ClaimEngineAction,
  ClaimRulebookPack,
  GeoSnapshot,
  HideSeekRulebookPack,
  LocationFix,
  RulebookFormat,
  SeekEngineAction,
  SeekMapPreviewRequest,
} from "@kelana-ria/contracts";
import { credential, hasJsonBody, isObject, json, requestBody, setCredential } from "./http.js";
import type { MidtransNotificationPayload } from "./midtrans-adapter.js";
import type { PlaySeekCardParams } from "./seek-engine/deck-engine.js";
import type { GeoSeedRequest } from "./seek-engine/geo-seeder.js";
import type { RoomStreamEvent, rulebookStore, StoredRulebookRecord } from "./rulebook-store.js";

const cookieName = "kelana_rulebook";
const SSE_KEEPALIVE_MS = 20_000;

type Store = ReturnType<typeof rulebookStore>;
type ResolveUserFn = (request: IncomingMessage, response?: ServerResponse, currentNow?: number) => AuthUser | null;
type RulebookRequestHandler = ((request: IncomingMessage, response: ServerResponse, url: URL) => Promise<void>) & {
  closeStreams: () => void;
};

function studioRecord({ ownerHash: _ownerHash, ...record }: StoredRulebookRecord) {
  return record;
}

function hashKey(value: string) {
  return createHash("sha256").update(value).digest();
}

export function rulebookHandler(
  store: Store, now: () => number, secureCookie = false, allowHideSeekQa = false, allowSandboxCheckout = false,
  reviewerKey = "",
  resolveUser?: ResolveUserFn,
  allowSandboxAuthOtp = false,
): RulebookRequestHandler {
  const configuredReviewer = reviewerKey.trim();
  const reviewerHash = configuredReviewer ? hashKey(configuredReviewer) : undefined;
  const activeSseStreams = new Set<() => void>();

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

  function ensureGuestCred(request: IncomingMessage, response: ServerResponse): string {
    const existing = credential(request, cookieName);
    if (existing) return existing;
    const fresh = randomBytes(32).toString("base64url");
    setCredential(request, response, cookieName, fresh, "/api/rulebooks", secureCookie);
    return fresh;
  }

  function resolveReadCred(request: IncomingMessage, response: ServerResponse, ts: number): string | undefined {
    const user = resolveUser?.(request, response, ts);
    if (user) return `user:${user.userId}`;
    return credential(request, cookieName);
  }

  function resolveWriteCred(request: IncomingMessage, response: ServerResponse, ts: number): string {
    const user = resolveUser?.(request, response, ts);
    if (user) return `user:${user.userId}`;
    return ensureGuestCred(request, response);
  }

  function requireSignedIn(request: IncomingMessage, response: ServerResponse, ts: number): { cred: string; user: AuthUser } | null {
    const user = resolveUser?.(request, response, ts) ?? null;
    if (!user) {
      json(response, 401, { error: "auth-required" });
      return null;
    }
    return { cred: `user:${user.userId}`, user };
  }

  async function handle(request: IncomingMessage, response: ServerResponse, url: URL): Promise<void> {
    const path = url.pathname;
    if (request.method === "GET" && path === "/api/rulebooks/catalog") {
      const ts = now();
      const user = resolveUser?.(request, response, ts) ?? null;
      const member = user ? `user:${user.userId}` : credential(request, cookieName);
      const ownership = member
        ? store.getCallerOwnership(member, ts)
        : { ownedPackIds: [], entitlements: [] };
      json(response, 200, {
        editions: store.listPublicListings(undefined, true),
        sharedRecaps: store.listPublicRecaps(),
        activeRooms: member ? store.listActiveRooms(member, ts) : [],
        ownedPackIds: ownership.ownedPackIds,
        entitlements: ownership.entitlements,
        allowSandboxCheckout,
        auth: {
          authenticated: Boolean(user),
          user,
          allowSandboxOtp: Boolean(allowSandboxAuthOtp),
        },
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
      const member = resolveReadCred(request, response, now());
      return json(response, 200, { recaps: member ? store.listRecaps(member) : [] });
    }
    const recapRoute = /^\/api\/rulebooks\/recaps\/((?:RC|RB)-[\dA-F]{6})$/.exec(path);
    if (request.method === "GET" && recapRoute) {
      const member = resolveReadCred(request, response, now());
      const detail = member ? store.readRecapDetail(recapRoute[1], member) : undefined;
      return detail ? json(response, 200, detail) : json(response, 404, { error: "recap-unavailable" });
    }
    if (request.method === "GET" && path === "/api/rulebooks") {
      const role = url.searchParams.get("role") ?? "public";
      const rawFormat = url.searchParams.get("format");
      const format: RulebookFormat | undefined =
        rawFormat === "hide-and-seek" || rawFormat === "claim-the-city" ? rawFormat : undefined;
      const listings = store.listPublicListings(format);
      const ts = now();
      if (role === "writer") {
        const signedIn = requireSignedIn(request, response, ts);
        if (!signedIn) return;
        const { versions, earnings } = store.creatorStudio(signedIn.cred);
        const ownership = store.getCallerOwnership(signedIn.cred, ts);
        json(response, 200, {
          role,
          listings,
          versions: versions.filter(record => !format || record.format === format).map(studioRecord),
          earnings,
          ownedPackIds: ownership.ownedPackIds,
          entitlements: ownership.entitlements,
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
      const member = resolveReadCred(request, response, ts);
      const ownership = member
        ? store.getCallerOwnership(member, ts)
        : { ownedPackIds: [], entitlements: [] };
      json(response, 200, {
        role: "public",
        listings,
        ownedPackIds: ownership.ownedPackIds,
        entitlements: ownership.entitlements,
        allowHideSeekQa,
        allowSandboxCheckout,
      });
      return;
    }

    const photoRoute = /^\/api\/rulebooks\/rooms\/([\w-]+)\/photos\/([\w-]+)$/.exec(path);
    if (request.method === "GET" && photoRoute) {
      const cred = resolveReadCred(request, response, now());
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

    const eventsRoute = /^\/api\/rulebooks\/rooms\/([\w-]+)\/events$/.exec(path);
    if (request.method === "GET" && eventsRoute) {
      const cred = resolveReadCred(request, response, now());
      if (!cred) return json(response, 404, { error: "room-not-found" });
      const roomCode = decodeURIComponent(eventsRoute[1]);
      let closed = false;
      let keepalive: ReturnType<typeof setInterval> | undefined;
      let unsubscribe: (() => void) | undefined;

      const writeEvent = (event: RoomStreamEvent) => {
        if (closed || response.writableEnded || response.destroyed) return;
        if (event.type === "presence") {
          response.write(`event: presence\ndata: ${JSON.stringify({ positions: event.positions, now: event.now })}\n\n`);
          return;
        }
        response.write(`event: rev\ndata: ${JSON.stringify({ stateRev: event.stateRev, now: event.now })}\n\n`);
      };

      const cleanup = () => {
        if (closed) return;
        closed = true;
        activeSseStreams.delete(cleanup);
        if (keepalive !== undefined) {
          clearInterval(keepalive);
          keepalive = undefined;
        }
        unsubscribe?.();
        unsubscribe = undefined;
        if (!response.writableEnded && !response.destroyed) {
          response.end();
        }
      };

      const sub = store.subscribeRoom(
        roomCode,
        cred,
        now(),
        (event) => writeEvent(event),
        cleanup,
      );
      if (!sub.ok) return json(response, 404, { error: "room-not-found" });
      unsubscribe = sub.unsubscribe;

      request.socket?.setTimeout(0);
      response.writeHead(200, {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      });
      response.flushHeaders?.();
      activeSseStreams.add(cleanup);
      response.write(`retry: 3000\nevent: rev\ndata: ${JSON.stringify({ stateRev: sub.stateRev, now: sub.now })}\n\n`);
      if (sub.presence) {
        response.write(`event: presence\ndata: ${JSON.stringify(sub.presence)}\n\n`);
      }

      keepalive = setInterval(() => {
        if (closed || response.writableEnded || response.destroyed) {
          cleanup();
          return;
        }
        response.write(": keepalive\n\n");
      }, SSE_KEEPALIVE_MS);
      keepalive.unref?.();

      request.on("close", cleanup);
      response.on("close", cleanup);
      response.on("error", cleanup);
      return;
    }

    if (request.method === "GET" && path.startsWith("/api/rulebooks/rooms/")) {
      const roomCode = decodeURIComponent(path.slice("/api/rulebooks/rooms/".length));
      const ts = now();
      const cred = resolveWriteCred(request, response, ts);
      const includeBoard = url.searchParams.get("includeBoard") !== "0";
      const roomNow = store.roomTime(roomCode, ts);
      const view = store.viewRoom(roomCode, cred, roomNow, { includeBoard });
      if (!view) return json(response, 404, { error: "room-not-found" });
      const roleTag = view.format === "hide-and-seek" ? view.room.role : view.room.isSolo ? "solo" : "group";
      const promptTag = view.activity.prompt?.id ?? "";
      const presenceTag =
        view.format === "claim-the-city" && view.room.seatPositions?.length
          ? view.room.seatPositions
              .map((p) => `${p.seatId}:${p.at}:${p.latitude.toFixed(5)}:${p.longitude.toFixed(5)}:${p.source}`)
              .sort()
              .join("|")
          : "";
      const etagDigest = createHash("sha256")
        .update(`${roomCode}:${view.room.seatId}:${roleTag}:${view.stateRev}:${includeBoard ? 1 : 0}:${promptTag}:${presenceTag}`)
        .digest("base64url")
        .slice(0, 22);
      const etag = `"rb-${etagDigest}"`;
      const ifNoneMatch = request.headers["if-none-match"];
      const matched = typeof ifNoneMatch === "string" && ifNoneMatch.split(",").some((part) => {
        const cleaned = part.trim().replace(/^W\//i, "");
        return cleaned === "*" || cleaned === etag;
      });
      if (matched) {
        response.writeHead(304, {
          "Cache-Control": "private, no-cache",
          ETag: etag,
          Vary: "Accept-Encoding",
          "X-Server-Now": String(roomNow),
        });
        response.end();
        return;
      }
      json(response, 200, view, {
        "Cache-Control": "private, no-cache",
        ETag: etag,
        "X-Server-Now": String(roomNow),
      });
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

    const ts = now();

    const presenceRoute = /^\/api\/rulebooks\/rooms\/([^/]+)\/presence$/.exec(path);
    if (presenceRoute) {
      const cred = resolveReadCred(request, response, ts);
      if (!cred) return json(response, 404, { error: "room-not-found" });
      const roomCode = decodeURIComponent(presenceRoute[1]);
      const fix = (isObject(body.fix) ? body.fix : body) as unknown as LocationFix;
      const roomNow = store.roomTime(roomCode, ts);
      const res = store.updateClaimPresence(roomCode, cred, fix, roomNow);
      if (!res.ok) {
        const headers =
          res.status === 429 && res.retryAfterMs !== undefined
            ? { "Retry-After": String(Math.max(1, Math.ceil(res.retryAfterMs / 1000))) }
            : undefined;
        return json(response, res.status, { error: res.error, ...(res.retryAfterMs !== undefined ? { retryAfterMs: res.retryAfterMs } : {}) }, headers);
      }
      return json(response, 200, { ok: true, position: res.position, broadcast: res.broadcast, now: res.now });
    }

    const recapShareRoute = /^\/api\/rulebooks\/recaps\/((?:RC|RB)-[\dA-F]{6})\/(share|unshare)$/.exec(path);
    if (recapShareRoute) {
      const member = resolveReadCred(request, response, ts);
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
        ts,
      );
      return result ? json(response, 200, result) : json(response, 404, { error: "recap-unavailable" });
    }

    if (path === "/api/rulebooks/seek-photo") {
      const { roomCode, questionId, actionId, photoBase64 } = body;
      const cred = resolveReadCred(request, response, ts);
      if (!cred || typeof roomCode !== "string" || typeof questionId !== "string" ||
          typeof actionId !== "string" || actionId.length < 1 || actionId.length > 100 || typeof photoBase64 !== "string") {
        return json(response, 400, { error: "invalid-request" });
      }
      const reply = await store.answerSeekPhoto(roomCode, cred, questionId, actionId, photoBase64, () => store.roomTime(roomCode, now()));
      return json(response, reply.error ? 400 : 200, reply);
    }

    if (path === "/api/rulebooks/claim-photo") {
      const { roomCode, landmarkId, curseInstanceId, actionId, photoBase64 } = body;
      const cred = resolveReadCred(request, response, ts);
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
        ts,
      );
      json(response, res.ok ? 200 : 400, res);
      return;
    }

    if (path === "/api/rulebooks/catalog") {
      const { type, edition, version, mode, requestId } = body;
      if (typeof edition !== "string" || !edition || typeof version !== "number" ||
          !Number.isSafeInteger(version) || version < 1 || (mode !== "solo" && mode !== "group") ||
          typeof requestId !== "string" || !/^[\w-]{16,80}$/.test(requestId)) {
        return json(response, 400, { error: "invalid-request" });
      }
      if (type === "play") {
        const cred = resolveWriteCred(request, response, ts);
        const result = store.createFreeRoomFromRulebook(edition, version, cred, "Host", ts, false, mode, requestId);
        const status = result.ok ? 200 : result.error === "entitlement-active-room-exists" ? 409 : 400;
        return json(response, status, result);
      }
      if (type !== "buy" && type !== "check-payment" && type !== "simulate-payment") {
        return json(response, 400, { error: "invalid-request" });
      }
      const signedIn = requireSignedIn(request, response, ts);
      if (!signedIn) return;
      if (!allowSandboxCheckout) return json(response, 403, { error: "checkout-unavailable" });
      if (type === "buy") {
        const result = await store.createOrder(signedIn.cred, edition, version, ts, mode, requestId);
        const status = result.ok ? 200 : result.error === "pack-already-owned" ? 409 : 400;
        return json(response, status, result);
      }
      const order = store.viewCatalogOrder(signedIn.cred, edition, version, mode, requestId);
      if (!order) return json(response, 404, { error: "order-not-found" });
      if (type === "simulate-payment" && order.paymentMode !== "recorded-sandbox") {
        return json(response, 400, { error: "simulation-unavailable" });
      }
      const settlement = await store.settleVerifiedOrder(order.orderId, signedIn.cred, "Host",
        type === "simulate-payment" ? { transaction_status: "settlement", status_code: "200" } : undefined, ts);
      return json(response, settlement.ok ? 200 : 400, settlement);
    }

    if (path === "/api/rulebooks/question-preview") {
      const { roomCode, family, itemId } = body;
      if (typeof roomCode !== "string" || typeof itemId !== "string" ||
          (family !== "radar" && family !== "matching" && family !== "measuring" && family !== "tentacles")) {
        return json(response, 400, { error: "invalid-request" });
      }
      const cred = resolveWriteCred(request, response, ts);
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
        const signedIn = requireSignedIn(request, response, ts);
        if (!signedIn) return;
        const res = store.cloneOfficialTemplate(
          String(body.templatePackId ?? ""),
          signedIn.cred,
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
        const signedIn = requireSignedIn(request, response, ts);
        if (!signedIn) return;
        const res = store.saveDraft(
          signedIn.cred,
          body.pack as HideSeekRulebookPack | ClaimRulebookPack,
          body.snapshot as GeoSnapshot,
          ts,
          { rehashSnapshot: Boolean(body.rehashSnapshot) },
        );
        json(response, res.ok ? 200 : 400, res.ok ? { ...res, record: studioRecord(res.record) } : res);
        return;
      }
      if (type === "submit-draft") {
        const signedIn = requireSignedIn(request, response, ts);
        if (!signedIn) return;
        const res = store.submitDraft(signedIn.cred, String(body.packId ?? ""), Number(body.version ?? 0), ts);
        json(response, res.ok ? 200 : 400, res.ok ? { ...res, record: studioRecord(res.record) } : res);
        return;
      }
      if (type === "create-order") {
        const signedIn = requireSignedIn(request, response, ts);
        if (!signedIn) return;
        if (!allowSandboxCheckout) return json(response, 403, { error: "checkout-unavailable" });
        const requestId = typeof body.requestId === "string" && /^[\w-]{8,100}$/.test(body.requestId)
          ? body.requestId : undefined;
        const mode = body.mode === "solo" || body.mode === "group" ? body.mode : undefined;
        const res = await store.createOrder(
          signedIn.cred,
          String(body.packId ?? ""),
          Number(body.version ?? 1),
          ts,
          mode,
          requestId,
        );
        const status = res.ok ? 200 : res.error === "pack-already-owned" ? 409 : 400;
        json(response, status, res);
        return;
      }
      if (type === "verify-settlement") {
        const signedIn = requireSignedIn(request, response, ts);
        if (!signedIn) return;
        if (!allowSandboxCheckout) return json(response, 403, { error: "checkout-unavailable" });
        const res = await store.settleVerifiedOrder(
          String(body.orderId ?? ""),
          signedIn.cred,
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

      const cred = resolveWriteCred(request, response, ts);
      if (type === "create-free-room" || type === "create-owned-room") {
        if (body.qa === true && !allowHideSeekQa) return json(response, 403, { error: "seek-qa-disabled" });
        const requestId = typeof body.requestId === "string" && /^[\w-]{8,100}$/.test(body.requestId)
          ? body.requestId : undefined;
        const mode = body.mode === "solo" || body.mode === "group" ? body.mode : undefined;
        const res = type === "create-owned-room"
          ? store.createOwnedRoomFromRulebook(
              String(body.packId ?? ""),
              Number(body.version ?? 1),
              cred,
              String(body.hostName ?? "Host"),
              ts,
              mode,
              requestId,
              body.qa === true,
            )
          : store.createFreeRoomFromRulebook(
              String(body.packId ?? ""),
              Number(body.version ?? 1),
              cred,
              String(body.hostName ?? "Host"),
              ts,
              body.qa === true,
              mode,
              requestId,
            );
        const status = res.ok ? 200 : res.error === "entitlement-active-room-exists" ? 409 : 400;
        json(response, status, res);
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
  }

  return Object.assign(handle, {
    closeStreams: () => {
      for (const close of [...activeSseStreams]) close();
    },
  });
}
