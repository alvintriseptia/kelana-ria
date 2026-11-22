import { maxBase64Length } from "./seek-photo.js";
import { randomBytes } from "node:crypto";
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
import type { rulebookStore } from "./rulebook-store.js";

const cookieName = "kelana_rulebook";

type Store = ReturnType<typeof rulebookStore>;

export function rulebookHandler(store: Store, now: () => number, secureCookie = false, allowHideSeekQa = false) {
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
    if (request.method === "GET" && path === "/api/rulebooks") {
      const role = url.searchParams.get("role") ?? "public";
      const rawFormat = url.searchParams.get("format");
      const format: RulebookFormat | undefined =
        rawFormat === "hide-and-seek" || rawFormat === "claim-the-city" ? rawFormat : undefined;
      const listings = store.listPublicListings(format);
      if (role === "writer" || role === "reviewer") {
        json(response, 200, {
          role,
          listings,
          versions: store.listAllVersions(),
          orders: store.listOrders(),
          earnings: store.listEarnings(),
        });
        return;
      }
      json(response, 200, { role: "public", listings, orders: store.listOrders(), allowHideSeekQa });
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
        `webhook:${payload.order_id}`,
        payload.hostName ?? "Host",
        payload,
        now(),
      );
      json(response, res.ok ? 200 : 400, res);
      return;
    }

    const cred = ensureCred(request, response);
    const ts = now();

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
        json(response, res.ok ? 200 : 400, res);
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
        json(response, res.ok ? 200 : 400, res);
        return;
      }
      if (type === "submit-draft") {
        const res = store.submitDraft(cred, String(body.packId ?? ""), Number(body.version ?? 0), ts);
        json(response, res.ok ? 200 : 400, res);
        return;
      }
      if (type === "request-changes") {
        const res = store.reviewVersion(String(body.packId ?? ""), Number(body.version ?? 0), { action: "request-changes", note: String(body.note ?? "") }, ts);
        json(response, res.ok ? 200 : 400, res);
        return;
      }
      if (type === "publish-version") {
        const res = store.reviewVersion(String(body.packId ?? ""), Number(body.version ?? 0), { action: "publish" }, ts);
        json(response, res.ok ? 200 : 400, res);
        return;
      }
      if (type === "pause-version") {
        const res = store.reviewVersion(String(body.packId ?? ""), Number(body.version ?? 0), { action: "pause", reason: String(body.reason ?? "") }, ts);
        json(response, res.ok ? 200 : 400, res);
        return;
      }
      if (type === "create-free-room") {
        if (body.qa === true && !allowHideSeekQa) return json(response, 403, { error: "seek-qa-disabled" });
        const res = store.createFreeRoomFromRulebook(
          String(body.packId ?? ""),
          Number(body.version ?? 1),
          cred,
          String(body.hostName ?? "Host"),
          ts,
          body.qa === true,
        );
        json(response, res.ok ? 200 : 400, res);
        return;
      }
      if (type === "create-order") {
        const res = await store.createOrder(cred, String(body.packId ?? ""), Number(body.version ?? 1), ts);
        json(response, res.ok ? 200 : 400, res);
        return;
      }
      if (type === "verify-settlement") {
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
        const res = store.playCardInRoom(roomCode, cred, body.params as PlaySeekCardParams, roomTs);
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
