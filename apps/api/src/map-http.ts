import type { IncomingMessage, ServerResponse } from "node:http";
import type { MapConfig, MapUsageSummary } from "@kelana-ria/contracts";
import { json } from "./http.js";
import {
  GEOAPIFY_FREE_DAILY_CREDITS,
  GEOAPIFY_ROUTING_CREDIT_COST,
  GEOAPIFY_TILE_CREDIT_COST,
  GEOAPIFY_WALKING_ATTRIBUTION,
} from "./provider-adapters.js";

const DEFAULT_GEOAPIFY_MAPS_BASE_URL = "https://maps.geoapify.com";
const ALLOWED_GEOAPIFY_HOSTS = new Set([
  "maps.geoapify.com",
  "tiles.geoapify.com",
  "api.geoapify.com",
]);

export type MapProxyOptions = {
  geoapifyApiKey?: string;
  geoapifyMapsBaseUrl?: string;
  fetchImpl?: typeof fetch;
  getRoutingRequestCount?: () => number;
};

function stripApiKey(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl);
    parsed.searchParams.delete("apiKey");
    parsed.searchParams.delete("apikey");
    return parsed.toString();
  } catch {
    return rawUrl;
  }
}

function isAllowedUpstream(rawUrl: string, extraOrigin?: string): URL | undefined {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return undefined;
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return undefined;
  if (extraOrigin && parsed.origin === extraOrigin) return parsed;
  if (parsed.protocol === "https:" && ALLOWED_GEOAPIFY_HOSTS.has(parsed.hostname)) {
    return parsed;
  }
  return undefined;
}

function isTileAsset(parsed: URL): boolean {
  return /\.(?:pbf|mvt|png|webp|jpg|jpeg)(?:$|\?)/i.test(parsed.pathname) ||
    /\/(?:tiles?|v1\/tile)\//i.test(parsed.pathname);
}

function encodeProxyParam(rawUrl: string): string {
  const normalized = rawUrl.replace(/%7B/gi, "{").replace(/%7D/gi, "}");
  return encodeURIComponent(normalized).replace(/%7B/gi, "{").replace(/%7D/gi, "}");
}

function rewriteStyleJson(
  style: Record<string, unknown>,
  proxyPrefix: string,
  extraOrigin?: string,
): Record<string, unknown> {
  const rewriteUrl = (value: unknown): unknown => {
    if (typeof value !== "string") return value;
    // Preserve MapLibre template placeholders like {z}/{x}/{y} or {fontstack}/{range}.
    const probe = value.replace(/%7B/gi, "{").replace(/%7D/gi, "}").replace(/\{[^}]+\}/g, "0");
    if (!isAllowedUpstream(probe, extraOrigin)) return value;
    const clean = stripApiKey(value);
    return `${proxyPrefix}?u=${encodeProxyParam(clean)}`;
  };

  const cloned = structuredClone(style);
  if (typeof cloned.sprite === "string") {
    cloned.sprite = rewriteUrl(cloned.sprite);
  }
  if (typeof cloned.glyphs === "string") {
    cloned.glyphs = rewriteUrl(cloned.glyphs);
  }
  if (cloned.sources && typeof cloned.sources === "object") {
    for (const source of Object.values(cloned.sources as Record<string, unknown>)) {
      if (!source || typeof source !== "object") continue;
      const src = source as Record<string, unknown>;
      if (typeof src.url === "string") src.url = rewriteUrl(src.url);
      if (Array.isArray(src.tiles)) {
        src.tiles = src.tiles.map((tile) => rewriteUrl(tile));
      }
    }
  }
  return cloned;
}

export function mapHandler(options: MapProxyOptions = {}) {
  const apiKey = options.geoapifyApiKey?.trim() || "";
  const mapsBaseUrl = (options.geoapifyMapsBaseUrl?.trim() || DEFAULT_GEOAPIFY_MAPS_BASE_URL).replace(/\/$/, "");
  const fetchImpl = options.fetchImpl ?? fetch;
  const extraOrigin = (() => {
    try {
      return new URL(mapsBaseUrl).origin;
    } catch {
      return undefined;
    }
  })();

  let tileRequests = 0;
  let tileFailures = 0;

  function config(): MapConfig {
    const live = Boolean(apiKey);
    return {
      mode: live ? "geoapify-vector" : "offline-vector",
      styleUrl: live ? "/api/map/style.json" : null,
      attribution: GEOAPIFY_WALKING_ATTRIBUTION,
      mapLibreLicenseUrl: "/licenses/maplibre-gl.txt",
      tileCreditCost: GEOAPIFY_TILE_CREDIT_COST,
      routingCreditCost: GEOAPIFY_ROUTING_CREDIT_COST,
      freeDailyCredits: GEOAPIFY_FREE_DAILY_CREDITS,
    };
  }

  function usage(): MapUsageSummary {
    const routingRequests = options.getRoutingRequestCount?.() ?? 0;
    const estimatedTileCredits = Number((tileRequests * GEOAPIFY_TILE_CREDIT_COST).toFixed(2));
    const estimatedRoutingCredits = routingRequests * GEOAPIFY_ROUTING_CREDIT_COST;
    return {
      mode: apiKey ? "geoapify-vector" : "offline-vector",
      tileRequests,
      tileFailures,
      estimatedTileCredits,
      routingRequests,
      estimatedRoutingCredits,
      totalEstimatedCredits: Number((estimatedTileCredits + estimatedRoutingCredits).toFixed(2)),
      freeDailyCredits: GEOAPIFY_FREE_DAILY_CREDITS,
    };
  }

  return async (request: IncomingMessage, response: ServerResponse, url: URL) => {
    if (request.method !== "GET") return json(response, 405, { error: "method-not-allowed" });

    if (url.pathname === "/api/map/config") {
      return json(response, 200, config());
    }

    if (url.pathname === "/api/map/usage") {
      return json(response, 200, usage());
    }

    if (url.pathname === "/api/map/style.json") {
      if (!apiKey) return json(response, 503, { error: "map-provider-unconfigured" });
      try {
        const upstream = await fetchImpl(
          `${mapsBaseUrl}/v1/styles/osm-bright/style.json?apiKey=${encodeURIComponent(apiKey)}`,
          { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(8_000) },
        );
        if (!upstream.ok) {
          tileFailures += 1;
          return json(response, 502, { error: "map-provider-unavailable" });
        }
        const style = (await upstream.json()) as Record<string, unknown>;
        const rewritten = rewriteStyleJson(style, "/api/map/asset", extraOrigin);
        return json(response, 200, rewritten);
      } catch {
        tileFailures += 1;
        return json(response, 502, { error: "map-provider-unavailable" });
      }
    }

    const assetMatch = url.pathname.match(/^\/api\/map\/asset((?:@\dx)?\.(?:json|png))?$/);
    if (assetMatch) {
      if (!apiKey) return json(response, 503, { error: "map-provider-unconfigured" });
      const rawTarget = url.searchParams.get("u");
      if (!rawTarget) return json(response, 400, { error: "invalid-map-asset" });
      const parsed = isAllowedUpstream(rawTarget, extraOrigin);
      if (!parsed) return json(response, 400, { error: "invalid-map-asset" });
      if (assetMatch[1]) {
        parsed.pathname += assetMatch[1];
      }

      parsed.searchParams.set("apiKey", apiKey);
      const countsAsTile = isTileAsset(parsed);
      try {
        const upstream = await fetchImpl(parsed.toString(), {
          signal: AbortSignal.timeout(8_000),
        });
        if (countsAsTile) tileRequests += 1;
        if (!upstream.ok) {
          if (countsAsTile) tileFailures += 1;
          return json(response, 502, { error: "map-provider-unavailable" });
        }
        const contentType = upstream.headers.get("content-type") ?? "application/octet-stream";
        if (/json/i.test(contentType)) {
          // Rewrite TileJSON URLs inside Geoapify source definitions so apiKey stays server-side.
          const data = (await upstream.json()) as Record<string, unknown>;
          if (Array.isArray(data.tiles)) {
            data.tiles = data.tiles.map((tile) =>
              typeof tile === "string" &&
              isAllowedUpstream(tile.replace(/%7B/gi, "{").replace(/%7D/gi, "}").replace(/\{[^}]+\}/g, "0"), extraOrigin)
                ? `/api/map/asset?u=${encodeProxyParam(stripApiKey(tile))}`
                : tile,
            );
          }
          return json(response, 200, data);
        }
        const bytes = Buffer.from(await upstream.arrayBuffer());
        response.writeHead(200, {
          "Cache-Control": "public, max-age=300",
          "Content-Type": contentType,
          "Content-Length": bytes.byteLength,
          "X-Content-Type-Options": "nosniff",
        });
        response.end(bytes);
        return;
      } catch {
        if (countsAsTile) tileFailures += 1;
        return json(response, 502, { error: "map-provider-unavailable" });
      }
    }

    return json(response, 404, { error: "not-found" });
  };
}
