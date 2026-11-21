import {
  compactCatalog,
  compactWalkingSnapshot,
  type CompactBoardCatalog,
  type RouteLeg,
  type WalkingRouteSnapshot,
} from "./solo-fixture.js";
import type {
  EditionGenerator,
  EditionGeneratorRequest,
  ProposedSoloEdition,
  RouteSnapshotProvider,
} from "./solo-validation.js";

export const DEFAULT_CLOUDFLARE_AI_MODEL = "@cf/zai-org/glm-4.7-flash";
export const DEFAULT_CLOUDFLARE_AI_BASE_URL = "https://api.cloudflare.com/client/v4";
export const DEFAULT_GEOAPIFY_BASE_URL = "https://api.geoapify.com";
export const GEOAPIFY_WALKING_ATTRIBUTION =
  "Geoapify · © OpenStreetMap contributors · Transjakarta GTFS (CC BY 4.0)";
export const GEOAPIFY_ROUTING_CREDIT_COST = 1;
export const GEOAPIFY_TILE_CREDIT_COST = 0.25;
export const GEOAPIFY_FREE_DAILY_CREDITS = 3_000;
export const WORKERS_AI_FREE_DAILY_NEURONS = 10_000;

export type ProviderEvidenceMode = "live" | "recorded-rehearsal";

export type RedactedAiEvidenceEvent = {
  kind: "ai-edition";
  mode: ProviderEvidenceMode;
  provider: "Cloudflare Workers AI";
  model: string;
  board: "compact";
  boardVersion: string;
  format: "claim-the-city";
  players: 1;
  endpoint: string;
  attempt: 1 | 2;
  requestedAt: string;
  completedAt: string;
  durationMs: number;
  httpStatus: number | null;
  outcome: "proposal-received" | "invalid-output" | "http-error" | "timeout" | "network-error";
  editionId: string | null;
  checkpointCount: number | null;
  errorCode?: string;
  redacted: true;
};

export type RedactedRouteEvidenceEvent = {
  kind: "walking-route";
  mode: ProviderEvidenceMode;
  provider: "Geoapify Routing API";
  board: "compact";
  boardVersion: string;
  fromId: string;
  toId: string;
  endpoint: string;
  requestedAt: string;
  completedAt: string;
  durationMs: number;
  httpStatus: number | null;
  distanceMeters: number | null;
  travelMs: number | null;
  creditsUsed: number;
  attribution: string;
  outcome: "ok" | "invalid-response" | "http-error" | "timeout" | "network-error";
  errorCode?: string;
  redacted: true;
};

export type RedactedProviderEvent = RedactedAiEvidenceEvent | RedactedRouteEvidenceEvent;

export function redactUrlCredentials(rawUrl: string, secrets: string[] = []): string {
  let sanitized = rawUrl;
  try {
    const parsed = new URL(rawUrl);
    for (const key of ["apiKey", "apikey", "key", "token", "access_token"]) {
      if (parsed.searchParams.has(key)) {
        parsed.searchParams.set(key, "[REDACTED]");
      }
    }
    parsed.pathname = parsed.pathname.replace(
      /\/accounts\/[^/]+\//,
      "/accounts/[REDACTED_ACCOUNT]/",
    );
    sanitized = parsed.toString().replace(/%5BREDACTED%5D/g, "[REDACTED]");
  } catch {
    sanitized = rawUrl
      .replace(/([?&](?:apiKey|apikey|key|token|access_token)=)[^&]+/gi, "$1[REDACTED]")
      .replace(/\/accounts\/[^/]+\//g, "/accounts/[REDACTED_ACCOUNT]/");
  }
  for (const secret of secrets) {
    if (secret) {
      sanitized = sanitized.split(secret).join("[REDACTED]");
    }
  }
  return sanitized;
}

/**
 * Builds a strictly public board prompt for Cloudflare Workers AI.
 * Never includes player coordinates, device credentials, room secrets, or answer keys.
 */
export function buildPublicEditionPrompt(
  catalog: CompactBoardCatalog,
  request: EditionGeneratorRequest,
): { system: string; user: string } {
  const publicCatalog = {
    board: catalog.board,
    boardVersion: catalog.boardVersion,
    format: catalog.format,
    players: catalog.players,
    startId: catalog.start.id,
    durationMs: 60 * 60 * 1000,
    targets: { landmarks: 4, zones: 2 },
    checkpoints: Object.values(catalog.checkpoints).map((point) => ({
      id: point.id,
      zone: point.zone,
    })),
    previousEditionId: request.previousEditionId ?? null,
    attempt: request.attempt,
  };

  return {
    system: [
      "You design a Jakarta Compact solo Claim the City game edition from an approved public catalog.",
      "Return ONLY valid JSON with shape: {\"id\": string, \"checkpoints\": string[], \"targets\": {\"landmarks\": 4, \"zones\": 2}, \"durationMs\": 3600000}.",
      "Use ONLY checkpoint IDs listed in the catalog. Pick 6 distinct checkpoints across at least 2 zones so multiple opening routes reach 4 landmarks in 2 zones within 60 minutes while leaving at least 1 checkpoint unvisited.",
      "Do not invent IDs, coordinates, rules, or challenges.",
    ].join(" "),
    user: JSON.stringify(publicCatalog),
  };
}

function extractJsonObject(rawText: string): Record<string, unknown> | undefined {
  const trimmed = rawText.trim();
  const unfenced = trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();

  const candidates = [unfenced];
  const firstBrace = unfenced.indexOf("{");
  const lastBrace = unfenced.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    candidates.push(unfenced.slice(firstBrace, lastBrace + 1));
  }

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as unknown;
      if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // Try next slice.
    }
  }
  return undefined;
}

export function parseWorkersAiEditionResponse(
  payload: unknown,
  request: EditionGeneratorRequest,
): ProposedSoloEdition | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  const envelope = payload as Record<string, unknown>;
  if (envelope.success === false) return undefined;

  let content: unknown;
  const result = envelope.result as Record<string, unknown> | undefined;
  if (result && typeof result === "object") {
    if (result.response !== undefined) {
      content = result.response;
    } else if (Array.isArray(result.choices) && result.choices.length > 0) {
      const firstChoice = result.choices[0] as Record<string, unknown> | undefined;
      const message = firstChoice?.message as Record<string, unknown> | undefined;
      content = message?.content ?? firstChoice?.text;
    }
  } else if (Array.isArray(envelope.choices) && envelope.choices.length > 0) {
    const firstChoice = envelope.choices[0] as Record<string, unknown> | undefined;
    const message = firstChoice?.message as Record<string, unknown> | undefined;
    content = message?.content ?? firstChoice?.text;
  } else if (envelope.checkpoints !== undefined) {
    content = envelope;
  }

  let parsed: Record<string, unknown> | undefined;
  if (typeof content === "string") {
    parsed = extractJsonObject(content);
  } else if (content && typeof content === "object" && !Array.isArray(content)) {
    parsed = content as Record<string, unknown>;
  }
  if (!parsed) return undefined;

  const checkpoints = Array.isArray(parsed.checkpoints)
    ? (parsed.checkpoints as ProposedSoloEdition["checkpoints"])
    : undefined;
  if (!checkpoints || checkpoints.length === 0) return undefined;

  const rawId =
    typeof parsed.id === "string" && /^[A-Za-z0-9_-]{3,80}$/.test(parsed.id.trim())
      ? parsed.id.trim()
      : `compact-solo-ai-a${request.attempt}`;

  const rawTargets = parsed.targets as Record<string, unknown> | undefined;
  const targets =
    rawTargets &&
    typeof rawTargets.landmarks === "number" &&
    typeof rawTargets.zones === "number"
      ? { landmarks: rawTargets.landmarks, zones: rawTargets.zones }
      : { landmarks: 4, zones: 2 };

  const durationMs =
    typeof parsed.durationMs === "number" && Number.isFinite(parsed.durationMs)
      ? parsed.durationMs
      : 60 * 60 * 1000;

  return {
    id: rawId,
    board: typeof parsed.board === "string" ? parsed.board : request.board,
    boardVersion:
      typeof parsed.boardVersion === "string" ? parsed.boardVersion : request.boardVersion,
    format: typeof parsed.format === "string" ? parsed.format : request.format,
    players: typeof parsed.players === "number" ? parsed.players : request.players,
    durationMs,
    targets,
    checkpoints,
  };
}

export function parseGeoapifyWalkingResponse(
  payload: unknown,
): { distanceMeters: number; travelMs: number } | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  const collection = payload as Record<string, unknown>;
  if (!Array.isArray(collection.features) || collection.features.length === 0) {
    return undefined;
  }
  const firstFeature = collection.features[0] as Record<string, unknown> | undefined;
  const properties = firstFeature?.properties as Record<string, unknown> | undefined;
  if (!properties) return undefined;

  const distance = properties.distance;
  const timeSeconds = properties.time;
  if (
    typeof distance !== "number" ||
    !Number.isFinite(distance) ||
    distance <= 0 ||
    typeof timeSeconds !== "number" ||
    !Number.isFinite(timeSeconds) ||
    timeSeconds <= 0
  ) {
    return undefined;
  }
  return {
    distanceMeters: Math.round(distance),
    travelMs: Math.round(timeSeconds * 1000),
  };
}

function isAbortOrTimeout(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === "TimeoutError" || error.name === "AbortError")
  );
}

export function createWorkersAiEditionGenerator({
  accountId,
  apiToken,
  model = DEFAULT_CLOUDFLARE_AI_MODEL,
  baseUrl = DEFAULT_CLOUDFLARE_AI_BASE_URL,
  catalog = compactCatalog,
  mode = "live",
  fetchImpl = fetch,
  now = Date.now,
  onEvent,
}: {
  accountId: string;
  apiToken: string;
  model?: string;
  baseUrl?: string;
  catalog?: CompactBoardCatalog;
  mode?: ProviderEvidenceMode;
  fetchImpl?: typeof fetch;
  now?: () => number;
  onEvent?: (event: RedactedAiEvidenceEvent) => void;
}): EditionGenerator {
  const cleanBase = baseUrl.replace(/\/$/, "");
  const encodedModel = model
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  const endpointUrl = `${cleanBase}/accounts/${encodeURIComponent(accountId)}/ai/run/${encodedModel}`;
  const redactedEndpoint = redactUrlCredentials(endpointUrl, [accountId, apiToken]);

  return async (request: EditionGeneratorRequest): Promise<ProposedSoloEdition> => {
    const startedAt = now();
    const prompt = buildPublicEditionPrompt(catalog, request);
    const timeoutMs = Math.max(100, Math.floor(request.remainingBudgetMs));

    let response: Response;
    try {
      response = await fetchImpl(endpointUrl, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiToken}`,
        },
        body: JSON.stringify({
          messages: [
            { role: "system", content: prompt.system },
            { role: "user", content: prompt.user },
          ],
          temperature: 0.2,
          max_tokens: 400,
        }),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      const completedAt = now();
      onEvent?.({
        kind: "ai-edition",
        mode,
        provider: "Cloudflare Workers AI",
        model,
        board: request.board,
        boardVersion: request.boardVersion,
        format: request.format,
        players: request.players,
        endpoint: redactedEndpoint,
        attempt: request.attempt,
        requestedAt: new Date(startedAt).toISOString(),
        completedAt: new Date(completedAt).toISOString(),
        durationMs: Math.max(0, completedAt - startedAt),
        httpStatus: null,
        outcome: isAbortOrTimeout(error) ? "timeout" : "network-error",
        editionId: null,
        checkpointCount: null,
        errorCode: isAbortOrTimeout(error) ? "timeout" : "network-error",
        redacted: true,
      });
      throw new Error(
        isAbortOrTimeout(error)
          ? "Cloudflare Workers AI timed out"
          : "Cloudflare Workers AI request failed",
      );
    }

    const completedAt = now();
    if (!response.ok) {
      onEvent?.({
        kind: "ai-edition",
        mode,
        provider: "Cloudflare Workers AI",
        model,
        board: request.board,
        boardVersion: request.boardVersion,
        format: request.format,
        players: request.players,
        endpoint: redactedEndpoint,
        attempt: request.attempt,
        requestedAt: new Date(startedAt).toISOString(),
        completedAt: new Date(completedAt).toISOString(),
        durationMs: Math.max(0, completedAt - startedAt),
        httpStatus: response.status,
        outcome: "http-error",
        editionId: null,
        checkpointCount: null,
        errorCode: `http-${response.status}`,
        redacted: true,
      });
      throw new Error(`Cloudflare Workers AI returned HTTP ${response.status}`);
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      payload = undefined;
    }

    const parsed = parseWorkersAiEditionResponse(payload, request);
    if (!parsed) {
      onEvent?.({
        kind: "ai-edition",
        mode,
        provider: "Cloudflare Workers AI",
        model,
        board: request.board,
        boardVersion: request.boardVersion,
        format: request.format,
        players: request.players,
        endpoint: redactedEndpoint,
        attempt: request.attempt,
        requestedAt: new Date(startedAt).toISOString(),
        completedAt: new Date(completedAt).toISOString(),
        durationMs: Math.max(0, completedAt - startedAt),
        httpStatus: response.status,
        outcome: "invalid-output",
        editionId: null,
        checkpointCount: null,
        errorCode: "malformed-json",
        redacted: true,
      });
      // Return an invalid empty proposal so prepareSoloFixture triggers its single retry inside the 15s budget.
      return {
        id: `invalid-ai-attempt-${request.attempt}`,
        board: request.board,
        boardVersion: request.boardVersion,
        format: request.format,
        players: request.players,
        checkpoints: [],
      };
    }

    onEvent?.({
      kind: "ai-edition",
      mode,
      provider: "Cloudflare Workers AI",
      model,
      board: request.board,
      boardVersion: request.boardVersion,
      format: request.format,
      players: request.players,
      endpoint: redactedEndpoint,
      attempt: request.attempt,
      requestedAt: new Date(startedAt).toISOString(),
      completedAt: new Date(completedAt).toISOString(),
      durationMs: Math.max(0, completedAt - startedAt),
      httpStatus: response.status,
      outcome: "proposal-received",
      editionId: parsed.id ?? null,
      checkpointCount: parsed.checkpoints?.length ?? null,
      redacted: true,
    });
    return parsed;
  };
}

export function uniqueWalkingPairs(snapshot: WalkingRouteSnapshot): Array<[string, string]> {
  const seen = new Set<string>();
  const pairs: Array<[string, string]> = [];
  for (const leg of snapshot.legs) {
    if (leg.mode !== "walk") continue;
    const canonical =
      leg.fromId < leg.toId ? `${leg.fromId}|${leg.toId}` : `${leg.toId}|${leg.fromId}`;
    if (seen.has(canonical)) continue;
    seen.add(canonical);
    pairs.push([leg.fromId, leg.toId]);
  }
  return pairs;
}

export function createGeoapifyWalkingRouteProvider({
  apiKey,
  baseUrl = DEFAULT_GEOAPIFY_BASE_URL,
  catalog = compactCatalog,
  baseSnapshot = compactWalkingSnapshot,
  pairs,
  mode = "live",
  timeoutMs = 8_000,
  fetchImpl = fetch,
  now = Date.now,
  onEvent,
}: {
  apiKey: string;
  baseUrl?: string;
  catalog?: CompactBoardCatalog;
  baseSnapshot?: WalkingRouteSnapshot;
  pairs?: Array<[string, string]>;
  mode?: ProviderEvidenceMode;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  now?: () => number;
  onEvent?: (event: RedactedRouteEvidenceEvent) => void;
}): RouteSnapshotProvider {
  const cleanBase = baseUrl.replace(/\/$/, "");
  const pointById = (id: string) =>
    id === catalog.start.id ? catalog.start : catalog.checkpoints[id];

  return async ({ board, boardVersion }): Promise<WalkingRouteSnapshot> => {
    if (board !== catalog.board || boardVersion !== catalog.boardVersion) {
      throw new Error(`Unsupported board ${board}@${boardVersion}`);
    }

    const targetPairs = pairs ?? uniqueWalkingPairs(baseSnapshot);
    const refreshed = new Map<string, { distanceMeters: number; travelMs: number }>();

    for (const [fromId, toId] of targetPairs) {
      const from = pointById(fromId);
      const to = pointById(toId);
      if (!from || !to) {
        throw new Error(`Unknown walking route endpoint: ${fromId} -> ${toId}`);
      }

      const waypoints = `${from.latitude},${from.longitude}|${to.latitude},${to.longitude}`;
      const requestUrl = `${cleanBase}/v1/routing?waypoints=${encodeURIComponent(waypoints)}&mode=walk&apiKey=${encodeURIComponent(apiKey)}`;
      const redactedEndpoint = redactUrlCredentials(requestUrl, [apiKey]);
      const startedAt = now();

      let response: Response;
      try {
        response = await fetchImpl(requestUrl, {
          method: "GET",
          headers: { Accept: "application/json" },
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (error) {
        const completedAt = now();
        onEvent?.({
          kind: "walking-route",
          mode,
          provider: "Geoapify Routing API",
          board,
          boardVersion,
          fromId,
          toId,
          endpoint: redactedEndpoint,
          requestedAt: new Date(startedAt).toISOString(),
          completedAt: new Date(completedAt).toISOString(),
          durationMs: Math.max(0, completedAt - startedAt),
          httpStatus: null,
          distanceMeters: null,
          travelMs: null,
          creditsUsed: 0,
          attribution: "© Geoapify · © OpenStreetMap contributors",
          outcome: isAbortOrTimeout(error) ? "timeout" : "network-error",
          errorCode: isAbortOrTimeout(error) ? "timeout" : "network-error",
          redacted: true,
        });
        throw new Error(
          isAbortOrTimeout(error)
            ? `Geoapify walking route timed out for ${fromId} -> ${toId}`
            : `Geoapify walking route failed for ${fromId} -> ${toId}`,
        );
      }

      const completedAt = now();
      if (!response.ok) {
        onEvent?.({
          kind: "walking-route",
          mode,
          provider: "Geoapify Routing API",
          board,
          boardVersion,
          fromId,
          toId,
          endpoint: redactedEndpoint,
          requestedAt: new Date(startedAt).toISOString(),
          completedAt: new Date(completedAt).toISOString(),
          durationMs: Math.max(0, completedAt - startedAt),
          httpStatus: response.status,
          distanceMeters: null,
          travelMs: null,
          creditsUsed: 0,
          attribution: "© Geoapify · © OpenStreetMap contributors",
          outcome: "http-error",
          errorCode: `http-${response.status}`,
          redacted: true,
        });
        throw new Error(`Geoapify Routing API returned HTTP ${response.status}`);
      }

      let payload: unknown;
      try {
        payload = await response.json();
      } catch {
        payload = undefined;
      }

      const parsed = parseGeoapifyWalkingResponse(payload);
      if (!parsed) {
        onEvent?.({
          kind: "walking-route",
          mode,
          provider: "Geoapify Routing API",
          board,
          boardVersion,
          fromId,
          toId,
          endpoint: redactedEndpoint,
          requestedAt: new Date(startedAt).toISOString(),
          completedAt: new Date(completedAt).toISOString(),
          durationMs: Math.max(0, completedAt - startedAt),
          httpStatus: response.status,
          distanceMeters: null,
          travelMs: null,
          creditsUsed: GEOAPIFY_ROUTING_CREDIT_COST,
          attribution: "© Geoapify · © OpenStreetMap contributors",
          outcome: "invalid-response",
          errorCode: "invalid-geojson",
          redacted: true,
        });
        throw new Error(`Geoapify returned invalid walking route for ${fromId} -> ${toId}`);
      }

      onEvent?.({
        kind: "walking-route",
        mode,
        provider: "Geoapify Routing API",
        board,
        boardVersion,
        fromId,
        toId,
        endpoint: redactedEndpoint,
        requestedAt: new Date(startedAt).toISOString(),
        completedAt: new Date(completedAt).toISOString(),
        durationMs: Math.max(0, completedAt - startedAt),
        httpStatus: response.status,
        distanceMeters: parsed.distanceMeters,
        travelMs: parsed.travelMs,
        creditsUsed: GEOAPIFY_ROUTING_CREDIT_COST,
        attribution: "© Geoapify · © OpenStreetMap contributors",
        outcome: "ok",
        redacted: true,
      });

      refreshed.set(`${fromId}|${toId}`, parsed);
      refreshed.set(`${toId}|${fromId}`, parsed);
    }

    const updatedLegs: RouteLeg[] = baseSnapshot.legs.map((leg) => {
      if (leg.mode !== "walk") return { ...leg };
      const fresh = refreshed.get(`${leg.fromId}|${leg.toId}`);
      if (!fresh) return { ...leg };
      return {
        ...leg,
        distanceMeters: fresh.distanceMeters,
        travelMs: fresh.travelMs,
      };
    });

    return {
      ...baseSnapshot,
      board: catalog.board,
      boardVersion: catalog.boardVersion,
      provider: "Geoapify Routing API",
      retrievedAt: new Date(now()).toISOString(),
      attribution: GEOAPIFY_WALKING_ATTRIBUTION,
      legs: updatedLegs,
    };
  };
}

export function createProvidersFromEnv(
  env: Record<string, string | undefined> = process.env,
  options: {
    catalog?: CompactBoardCatalog;
    baseSnapshot?: WalkingRouteSnapshot;
    fetchImpl?: typeof fetch;
    now?: () => number;
    onEvent?: (event: RedactedProviderEvent) => void;
  } = {},
): {
  aiProvider?: EditionGenerator;
  routeProvider?: RouteSnapshotProvider;
  aiMode: "live" | "unconfigured";
  routeMode: "live" | "unconfigured";
  events: RedactedProviderEvent[];
} {
  const events: RedactedProviderEvent[] = [];
  const record = (event: RedactedProviderEvent) => {
    events.push(event);
    options.onEvent?.(event);
  };

  const accountId = env.CLOUDFLARE_ACCOUNT_ID?.trim();
  const apiToken = env.CLOUDFLARE_API_TOKEN?.trim();
  const geoapifyApiKey = env.GEOAPIFY_API_KEY?.trim();

  const aiProvider =
    accountId && apiToken
      ? createWorkersAiEditionGenerator({
          accountId,
          apiToken,
          model: env.CLOUDFLARE_AI_MODEL?.trim() || DEFAULT_CLOUDFLARE_AI_MODEL,
          baseUrl: env.CLOUDFLARE_AI_BASE_URL?.trim() || DEFAULT_CLOUDFLARE_AI_BASE_URL,
          catalog: options.catalog,
          mode: "live",
          fetchImpl: options.fetchImpl,
          now: options.now,
          onEvent: record,
        })
      : undefined;

  const routeProvider = geoapifyApiKey
    ? createGeoapifyWalkingRouteProvider({
        apiKey: geoapifyApiKey,
        baseUrl: env.GEOAPIFY_ROUTING_BASE_URL?.trim() || DEFAULT_GEOAPIFY_BASE_URL,
        catalog: options.catalog,
        baseSnapshot: options.baseSnapshot,
        mode: "live",
        fetchImpl: options.fetchImpl,
        now: options.now,
        onEvent: record,
      })
    : undefined;

  return {
    aiProvider,
    routeProvider,
    aiMode: aiProvider ? "live" : "unconfigured",
    routeMode: routeProvider ? "live" : "unconfigured",
    events,
  };
}
