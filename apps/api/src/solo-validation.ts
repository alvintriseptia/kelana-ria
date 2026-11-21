import type {
  GameBoard,
  SoloChallenge,
  SoloCheckpoint,
  SoloEdition,
  SoloOpeningSummary,
  SoloRouteAttribution,
} from "@kelana-ria/contracts";
import {
  compactCatalog,
  compactWalkingSnapshot,
  preparedCompactFixtures,
  type CompactBoardCatalog,
  type RouteLeg,
  type SoloFixture,
  type WalkingRouteSnapshot,
} from "./solo-fixture.js";

export type ProposedSoloEdition = {
  id?: string;
  board?: string;
  boardVersion?: string;
  format?: string;
  players?: number;
  durationMs?: number;
  targets?: { landmarks: number; zones: number };
  start?: { id: string };
  checkpoints?: Array<
    | string
    | {
        id: string;
        zone?: string;
        taskId?: string;
        challenge?: SoloChallenge;
        correctChoiceId?: string;
        reviewed?: boolean;
      }
  >;
  tasks?: SoloFixture["tasks"];
};

export type ValidationResult =
  | {
      ok: true;
      fixture: SoloFixture;
      openings: SoloOpeningSummary[];
      routes: SoloRouteAttribution;
    }
  | {
      ok: false;
      error:
        | "invalid-configuration"
        | "stale-board"
        | "invalid-duration"
        | "invalid-start"
        | "unknown-checkpoint"
        | "duplicate-checkpoint"
        | "invalid-zone-membership"
        | "checkpoint-closed"
        | "unsupported-challenge"
        | "wrong-site-task"
        | "unreviewed-answer"
        | "insufficient-wide-checkpoints"
        | "single-landmark-target"
        | "insufficient-zones"
        | "requires-all-landmarks"
        | "missing-route-data"
        | "nonexistent-route"
        | "unreachable-target"
        | "single-viable-opening";
      checkpointId?: string;
      closedCheckpointId?: string;
    };

export function toSoloCandidate(
  input: SoloFixture | ProposedSoloEdition,
  catalog: CompactBoardCatalog = compactCatalog,
): SoloFixture | ValidationResult {
  if ("edition" in input && input.edition && typeof input.edition === "object") {
    return input as SoloFixture;
  }
  const proposal = input as ProposedSoloEdition;
  const board = proposal.board ?? catalog.board;
  const format = proposal.format ?? catalog.format;
  const players = proposal.players ?? catalog.players;
  if (
    board !== catalog.board ||
    format !== catalog.format ||
    players !== catalog.players
  ) {
    return { ok: false, error: "invalid-configuration" };
  }
  const boardVersion = proposal.boardVersion ?? catalog.boardVersion;
  if (boardVersion !== catalog.boardVersion) {
    return { ok: false, error: "stale-board" };
  }
  if (
    proposal.start &&
    proposal.start.id !== catalog.start.id
  ) {
    return { ok: false, error: "invalid-start" };
  }
  if (!Array.isArray(proposal.checkpoints) || proposal.checkpoints.length === 0) {
    return { ok: false, error: "unknown-checkpoint" };
  }

  const checkpoints: SoloCheckpoint[] = [];
  const tasks: SoloFixture["tasks"] = { ...(proposal.tasks ?? {}) };

  for (const item of proposal.checkpoints) {
    const id = typeof item === "string" ? item : item?.id;
    if (typeof id !== "string" || !id) {
      return { ok: false, error: "unknown-checkpoint" };
    }
    const catalogPoint = catalog.checkpoints[id];
    if (!catalogPoint) {
      return { ok: false, error: "unknown-checkpoint", checkpointId: id };
    }
    const zone =
      typeof item === "object" && item.zone !== undefined
        ? item.zone
        : catalogPoint.zone;
    checkpoints.push({ ...catalogPoint, zone });

    if (!tasks[id]) {
      if (typeof item === "object" && item.taskId) {
        const assignedTask = catalog.tasks[item.taskId];
        if (!assignedTask) {
          return { ok: false, error: "unsupported-challenge", checkpointId: id };
        }
        tasks[id] = {
          siteId: assignedTask.siteId,
          reviewed: item.reviewed ?? assignedTask.reviewed,
          challenge: item.challenge ?? assignedTask.challenge,
          correctChoiceId: item.correctChoiceId ?? assignedTask.correctChoiceId,
        };
      } else if (typeof item === "object" && item.challenge) {
        tasks[id] = {
          siteId: item.challenge.checkpointId,
          reviewed: item.reviewed,
          challenge: item.challenge,
          correctChoiceId: item.correctChoiceId ?? "",
        };
      } else if (catalog.tasks[id]) {
        const defaultTask = catalog.tasks[id];
        tasks[id] = {
          siteId: defaultTask.siteId,
          reviewed: defaultTask.reviewed,
          challenge: defaultTask.challenge,
          correctChoiceId: defaultTask.correctChoiceId,
        };
      }
    }
  }

  return {
    edition: {
      id: proposal.id ?? `${catalog.board}-solo-generated`,
      board: catalog.board,
      boardVersion,
      format: "claim-the-city",
      players: catalog.players,
      durationMs:
        proposal.durationMs ??
        (catalog.board === "jakarta-wide" ? 120 : 60) * 60 * 1000,
      targets: proposal.targets ?? { landmarks: 4, zones: 2 },
      start: catalog.start,
      checkpoints,
    },
    checkIn: { ...catalog.checkIn },
    cooldownMs: catalog.cooldownMs,
    tasks,
  };
}

export function validateSoloFixture(
  input: SoloFixture | ProposedSoloEdition,
  {
    catalog = compactCatalog,
    routes = compactWalkingSnapshot,
    closedCheckpoints = [],
    routeSource = "snapshot",
  }: {
    catalog?: CompactBoardCatalog;
    routes?: WalkingRouteSnapshot | null;
    closedCheckpoints?: Iterable<string>;
    routeSource?: "live" | "snapshot";
  } = {},
): ValidationResult {
  const closed = new Set(closedCheckpoints);
  const converted = toSoloCandidate(input, catalog);
  if ("ok" in converted) return converted;
  const candidate = converted;
  const { edition } = candidate;

  const board = edition.board ?? catalog.board;
  const format = edition.format ?? catalog.format;
  const players = edition.players ?? catalog.players;
  if (
    board !== catalog.board ||
    format !== catalog.format ||
    players !== catalog.players
  ) {
    return { ok: false, error: "invalid-configuration" };
  }
  if (
    edition.boardVersion !== undefined &&
    edition.boardVersion !== catalog.boardVersion
  ) {
    return { ok: false, error: "stale-board" };
  }
  if (!Number.isFinite(edition.durationMs) || edition.durationMs <= 0) {
    return { ok: false, error: "invalid-duration" };
  }
  if (
    !edition.start ||
    edition.start.id !== catalog.start.id ||
    edition.checkpoints.some((point) => point.id === catalog.start.id)
  ) {
    return { ok: false, error: "invalid-start" };
  }
  if (!Array.isArray(edition.checkpoints) || edition.checkpoints.length === 0) {
    return { ok: false, error: "unknown-checkpoint" };
  }

  const seen = new Set<string>();
  const canonicalCheckpoints: SoloCheckpoint[] = [];
  const normalizedTasks: SoloFixture["tasks"] = {};

  for (const point of edition.checkpoints) {
    if (!point || typeof point.id !== "string") {
      return { ok: false, error: "unknown-checkpoint" };
    }
    if (seen.has(point.id)) {
      return {
        ok: false,
        error: "duplicate-checkpoint",
        checkpointId: point.id,
      };
    }
    seen.add(point.id);

    const catalogPoint = catalog.checkpoints[point.id];
    if (!catalogPoint) {
      return {
        ok: false,
        error: "unknown-checkpoint",
        checkpointId: point.id,
      };
    }
    if (!point.zone || point.zone !== catalogPoint.zone) {
      return {
        ok: false,
        error: "invalid-zone-membership",
        checkpointId: point.id,
      };
    }
    if (closed.has(point.id)) {
      return {
        ok: false,
        error: "checkpoint-closed",
        checkpointId: point.id,
        closedCheckpointId: point.id,
      };
    }

    const assignedTask = candidate.tasks?.[point.id];
    const catalogTask = catalog.tasks[point.id];
    if (
      !assignedTask ||
      !assignedTask.challenge ||
      typeof assignedTask.challenge.prompt !== "string" ||
      !assignedTask.challenge.prompt.trim() ||
      !Array.isArray(assignedTask.challenge.choices) ||
      assignedTask.challenge.choices.length < 2
    ) {
      return {
        ok: false,
        error: "unsupported-challenge",
        checkpointId: point.id,
      };
    }

    const taskSiteId =
      assignedTask.siteId ?? assignedTask.challenge.checkpointId;
    if (
      !catalogTask ||
      taskSiteId !== point.id ||
      assignedTask.challenge.checkpointId !== point.id ||
      assignedTask.challenge.prompt !== catalogTask.challenge.prompt
    ) {
      return {
        ok: false,
        error: "wrong-site-task",
        checkpointId: point.id,
      };
    }

    const hasValidChoice = assignedTask.challenge.choices.some(
      (choice) => choice.id === assignedTask.correctChoiceId,
    );
    if (
      assignedTask.reviewed === false ||
      !catalogTask.reviewed ||
      !assignedTask.correctChoiceId ||
      assignedTask.correctChoiceId !== catalogTask.correctChoiceId ||
      !hasValidChoice
    ) {
      return {
        ok: false,
        error: "unreviewed-answer",
        checkpointId: point.id,
      };
    }

    canonicalCheckpoints.push({ ...catalogPoint });
    normalizedTasks[point.id] = {
      siteId: catalogTask.siteId,
      reviewed: true,
      challenge: {
        checkpointId: catalogTask.challenge.checkpointId,
        prompt: catalogTask.challenge.prompt,
        choices: catalogTask.challenge.choices.map((c) => ({ ...c })),
      },
      correctChoiceId: catalogTask.correctChoiceId,
    };
  }

  if (catalog.board === "jakarta-wide" && catalog.compactCheckpointIds) {
    const outsideCompactCount = canonicalCheckpoints.filter(
      (point) => !catalog.compactCheckpointIds!.has(point.id),
    ).length;
    if (outsideCompactCount < 2) {
      return { ok: false, error: "insufficient-wide-checkpoints" };
    }
  }

  if (!edition.targets || edition.targets.landmarks < 2) {
    return { ok: false, error: "single-landmark-target" };
  }
  const distinctZones = new Set(canonicalCheckpoints.map((point) => point.zone));
  if (edition.targets.zones < 2 || distinctZones.size < edition.targets.zones) {
    return { ok: false, error: "insufficient-zones" };
  }
  if (canonicalCheckpoints.length <= edition.targets.landmarks) {
    return { ok: false, error: "requires-all-landmarks" };
  }

  if (
    !routes ||
    !Array.isArray(routes.legs) ||
    routes.legs.length === 0 ||
    !routes.provider ||
    !routes.attribution
  ) {
    return { ok: false, error: "missing-route-data" };
  }
  if (
    routes.board !== catalog.board ||
    routes.boardVersion !== catalog.boardVersion
  ) {
    return { ok: false, error: "stale-board" };
  }

  const activeById = new Map(
    canonicalCheckpoints.map((point) => [point.id, point]),
  );
  const outgoing = new Map<string, RouteLeg[]>();
  for (const leg of routes.legs) {
    if (
      (leg.fromId === catalog.start.id || activeById.has(leg.fromId)) &&
      activeById.has(leg.toId) &&
      leg.fromId !== leg.toId &&
      Number.isFinite(leg.travelMs) &&
      leg.travelMs > 0
    ) {
      const list = outgoing.get(leg.fromId) ?? [];
      list.push(leg);
      outgoing.set(leg.fromId, list);
    }
  }

  const startLegs = outgoing.get(catalog.start.id) ?? [];
  if (startLegs.length === 0) {
    return { ok: false, error: "nonexistent-route" };
  }

  // Evaluate feasible multi-stop winning plans that leave at least 1 active landmark unvisited
  // and remain completable within durationMs even with one missed connection penalty.
  const maxStops = Math.min(
    edition.targets.landmarks + 1,
    canonicalCheckpoints.length - 1,
  );
  const bestByOpening = new Map<string, SoloOpeningSummary>();
  let anyGraphPathReachedTargets = false;

  function search(
    currentId: string,
    visited: string[],
    zones: Set<string>,
    elapsedMs: number,
  ) {
    if (
      visited.length >= edition.targets.landmarks &&
      zones.size >= edition.targets.zones
    ) {
      anyGraphPathReachedTargets = true;
      const withMissedConnectionMs =
        elapsedMs + routes!.missedConnectionPenaltyMs;
      const unvisitedCount = canonicalCheckpoints.length - visited.length;
      if (withMissedConnectionMs <= edition.durationMs && unvisitedCount >= 1) {
        const firstCheckpointId = visited[0]!;
        const existing = bestByOpening.get(firstCheckpointId);
        if (
          !existing ||
          withMissedConnectionMs < existing.withMissedConnectionMs
        ) {
          bestByOpening.set(firstCheckpointId, {
            firstCheckpointId,
            stops: [...visited],
            zones: [...zones],
            estimatedDurationMs: elapsedMs,
            withMissedConnectionMs,
            unvisitedCount,
          });
        }
      }
    }
    if (visited.length >= maxStops) return;

    const legs = outgoing.get(currentId) ?? [];
    for (const leg of legs) {
      if (visited.includes(leg.toId)) continue;
      const targetPoint = activeById.get(leg.toId);
      if (!targetPoint) continue;
      const nextZones = new Set(zones);
      nextZones.add(targetPoint.zone);
      search(
        leg.toId,
        [...visited, leg.toId],
        nextZones,
        elapsedMs + leg.travelMs + routes!.challengeMs,
      );
    }
  }

  search(catalog.start.id, [], new Set(), 0);

  const openings = [...bestByOpening.values()];
  if (openings.length === 0) {
    return {
      ok: false,
      error: anyGraphPathReachedTargets
        ? "unreachable-target"
        : "nonexistent-route",
    };
  }
  if (openings.length < 2) {
    return { ok: false, error: "single-viable-opening" };
  }

  const routeAttribution: SoloRouteAttribution = {
    source: routeSource,
    provider: routes.provider,
    retrievedAt: routes.retrievedAt,
    attribution: routes.attribution,
  };

  const validatedFixture: SoloFixture = {
    edition: {
      id: edition.id,
      board: catalog.board,
      boardVersion: catalog.boardVersion,
      format: "claim-the-city",
      players: catalog.players,
      origin: edition.origin ?? "prepared",
      fallbackReason: edition.fallbackReason,
      durationMs: edition.durationMs,
      targets: { ...edition.targets },
      start: { ...catalog.start },
      checkpoints: canonicalCheckpoints,
      routes: routeAttribution,
      openings,
    },
    checkIn: { ...candidate.checkIn },
    cooldownMs: candidate.cooldownMs,
    tasks: normalizedTasks,
  };

  return {
    ok: true,
    fixture: validatedFixture,
    openings,
    routes: routeAttribution,
  };
}

export function isFreshSoloEdition(
  candidate: SoloEdition,
  previous?: SoloEdition,
): boolean {
  if (!previous) return true;
  const candidateIds = candidate.checkpoints
    .map((point) => point.id)
    .sort()
    .join(",");
  const previousIds = previous.checkpoints
    .map((point) => point.id)
    .sort()
    .join(",");
  return candidateIds !== previousIds;
}

export type EditionGeneratorRequest = {
  board: GameBoard;
  boardVersion: string;
  format: "claim-the-city";
  players: 1 | 2;
  attempt: 1 | 2;
  previousEditionId?: string;
  remainingBudgetMs: number;
};

export type EditionGenerator = (
  request: EditionGeneratorRequest,
) =>
  | ProposedSoloEdition
  | SoloFixture
  | Promise<ProposedSoloEdition | SoloFixture>;

export type RouteSnapshotProvider = (request: {
  board: GameBoard;
  boardVersion: string;
}) => WalkingRouteSnapshot | Promise<WalkingRouteSnapshot>;

export type PrepareEditionResult =
  | {
      ok: true;
      fixture: SoloFixture;
      origin: "live" | "prepared";
      fallbackReason?: string;
      attempts: number;
      routeSource: "live" | "snapshot";
    }
  | {
      ok: false;
      error: string;
      closedCheckpointId?: string;
      attempts: number;
    };

export async function prepareSoloFixture({
  catalog = compactCatalog,
  snapshotRoutes = compactWalkingSnapshot,
  fallbacks = preparedCompactFixtures,
  closedCheckpoints = [],
  previousEdition,
  aiProvider,
  routeProvider,
  budgetMs = 15_000,
  now = Date.now,
}: {
  catalog?: CompactBoardCatalog;
  snapshotRoutes?: WalkingRouteSnapshot | null;
  fallbacks?: SoloFixture[];
  closedCheckpoints?: Iterable<string>;
  previousEdition?: SoloEdition;
  aiProvider?: EditionGenerator;
  routeProvider?: RouteSnapshotProvider;
  budgetMs?: number;
  now?: () => number;
} = {}): Promise<PrepareEditionResult> {
  const closed = new Set(closedCheckpoints);
  const startTime = now();

  // 1. Resolve walking-route table (live provider if available, else approved snapshot).
  let activeRoutes: WalkingRouteSnapshot | null = null;
  let routeSource: "live" | "snapshot" = "snapshot";

  if (routeProvider) {
    try {
      const liveRoutes = await routeProvider({
        board: catalog.board,
        boardVersion: catalog.boardVersion,
      });
      if (
        liveRoutes &&
        liveRoutes.board === catalog.board &&
        liveRoutes.boardVersion === catalog.boardVersion &&
        Array.isArray(liveRoutes.legs) &&
        liveRoutes.legs.length > 0
      ) {
        activeRoutes = liveRoutes;
        routeSource = "live";
      }
    } catch {
      // Fall back to approved walking-route snapshot (A14).
    }
  }
  if (!activeRoutes && snapshotRoutes) {
    activeRoutes = snapshotRoutes;
    routeSource = "snapshot";
  }

  // 2. Try AI provider within the 15-second total budget, with at most 1 retry on invalid output.
  let attempts = 0;
  let fallbackReason: string | undefined;

  if (aiProvider) {
    for (const attempt of [1, 2] as const) {
      const elapsed = now() - startTime;
      const remainingBudgetMs = budgetMs - elapsed;
      if (remainingBudgetMs <= 0) {
        fallbackReason = "ai-timeout";
        break;
      }
      attempts = attempt;
      let rawCandidate: ProposedSoloEdition | SoloFixture;
      try {
        // Strictly public board metadata — never player coordinates or room secrets.
        const request: EditionGeneratorRequest = Object.freeze({
          board: catalog.board,
          boardVersion: catalog.boardVersion,
          format: catalog.format,
          players: catalog.players,
          attempt,
          previousEditionId: previousEdition?.id,
          remainingBudgetMs,
        });
        rawCandidate = await aiProvider(request);
      } catch {
        fallbackReason = "ai-unavailable";
        break;
      }
      if (now() - startTime > budgetMs) {
        fallbackReason = "ai-timeout";
        break;
      }

      const validated = validateSoloFixture(rawCandidate, {
        catalog,
        routes: activeRoutes,
        closedCheckpoints: closed,
        routeSource,
      });
      if (!validated.ok) {
        fallbackReason = validated.error;
        continue;
      }
      if (
        previousEdition &&
        !isFreshSoloEdition(validated.fixture.edition, previousEdition)
      ) {
        fallbackReason = "repeat-edition";
        continue;
      }

      const liveFixture: SoloFixture = {
        ...validated.fixture,
        edition: {
          ...validated.fixture.edition,
          origin: "live",
          fallbackReason: undefined,
        },
      };
      return {
        ok: true,
        fixture: liveFixture,
        origin: "live",
        attempts,
        routeSource,
      };
    }
  }

  // 3. Same-configuration prepared fallback (board: compact, format: claim-the-city, players: 1).
  const sameConfigFallbacks = fallbacks.filter(
    (fb) =>
      (fb.edition.board ?? "compact") === catalog.board &&
      (fb.edition.format ?? "claim-the-city") === catalog.format &&
      (fb.edition.players ?? 1) === catalog.players,
  );

  // Prefer a fresh prepared edition when previousEdition is supplied.
  const orderedFallbacks = previousEdition
    ? [
        ...sameConfigFallbacks.filter((fb) =>
          isFreshSoloEdition(fb.edition, previousEdition),
        ),
        ...sameConfigFallbacks.filter(
          (fb) => !isFreshSoloEdition(fb.edition, previousEdition),
        ),
      ]
    : sameConfigFallbacks;

  let lastError = fallbackReason ?? "edition-unavailable";
  let lastClosedCheckpointId: string | undefined;

  for (const fb of orderedFallbacks) {
    const validated = validateSoloFixture(fb, {
      catalog,
      routes: activeRoutes,
      closedCheckpoints: closed,
      routeSource,
    });
    if (validated.ok) {
      const preparedFixture: SoloFixture = {
        ...validated.fixture,
        edition: {
          ...validated.fixture.edition,
          origin: "prepared",
          fallbackReason,
        },
      };
      return {
        ok: true,
        fixture: preparedFixture,
        origin: "prepared",
        fallbackReason,
        attempts,
        routeSource,
      };
    }
    lastError = validated.error;
    if (validated.closedCheckpointId) {
      lastClosedCheckpointId = validated.closedCheckpointId;
    }
  }

  return {
    ok: false,
    error: lastError,
    closedCheckpointId: lastClosedCheckpointId,
    attempts,
  };
}
