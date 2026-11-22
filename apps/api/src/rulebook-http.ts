import { randomBytes } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type {
  ClaimEngineAction,
  ClaimRulebookPack,
  GeoSnapshot,
  HideSeekRulebookPack,
  RulebookFormat,
  SeekEngineAction,
} from "@kelana-ria/contracts";
import { credential, hasJsonBody, isObject, json, requestBody, setCredential } from "./http.js";
import type { MidtransNotificationPayload } from "./midtrans-adapter.js";
import type { PlaySeekCardParams } from "./seek-engine/deck-engine.js";
import type { GeoSeedRequest } from "./seek-engine/geo-seeder.js";
import type { rulebookStore } from "./rulebook-store.js";

const cookieName = "kelana_rulebook";

type Store = ReturnType<typeof rulebookStore>;

export function rulebookHandler(store: Store, now: () => number, secureCookie = false) {
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
      json(response, 200, { role: "public", listings, orders: store.listOrders() });
      return;
    }

    if (request.method === "GET" && path.startsWith("/api/rulebooks/rooms/")) {
      const roomCode = decodeURIComponent(path.slice("/api/rulebooks/rooms/".length));
      const cred = ensureCred(request, response);
      const view = store.viewRoom(roomCode, cred, now());
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
    const raw = await requestBody(request, 512 * 1024);
    if (raw === undefined) return json(response, 413, { error: "invalid-request" });
    let body: unknown;
    try {
      body = JSON.parse(raw);
    } catch {
      return json(response, 400, { error: "invalid-request" });
    }
    if (!isObject(body)) return json(response, 400, { error: "invalid-request" });

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
        const res = store.createFreeRoomFromRulebook(
          String(body.packId ?? ""),
          Number(body.version ?? 1),
          cred,
          String(body.hostName ?? "Host"),
          ts,
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
      if (type === "join-room") {
        const res = store.joinRoom(String(body.roomCode ?? ""), cred, String(body.name ?? "Player"), ts);
        json(response, res.ok ? 200 : 400, res);
        return;
      }
      if (type === "room-action") {
        const res = store.actInRoom(
          String(body.roomCode ?? ""),
          cred,
          body.action as SeekEngineAction | ClaimEngineAction,
          ts,
        );
        json(response, "error" in res && !("room" in res) ? 400 : 200, res);
        return;
      }
      if (type === "play-card") {
        const res = store.playCardInRoom(String(body.roomCode ?? ""), cred, body.params as PlaySeekCardParams, ts);
        json(response, res.ok ? 200 : 400, res);
        return;
      }
      if (type === "deck-action") {
        const res = store.deckActionInRoom(
          String(body.roomCode ?? ""),
          cred,
          (isObject(body.action) ? body.action : {}) as Record<string, unknown>,
          ts,
        );
        json(response, res.ok ? 200 : 400, res);
        return;
      }
    }

    json(response, 404, { error: "not-found" });
  };
}
