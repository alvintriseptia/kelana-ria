import { randomUUID } from "node:crypto";
import type { GameBoard, SeekClueChoice, SeekClueMenuItem, SeekClueView, SeekQuestion, SeekQuestionFamily, SeekQuestionInput, SoloPoint } from "@kelana-ria/contracts";
import { compactCatalog, compactWalkingSnapshot } from "./solo-fixture.js";
import { distanceBetween } from "./solo-rules.js";
import { newSeekDeck, type SeekDeck } from "./seek-deck.js";
import { wideBranches, wideCheckpoints, wideWalkingSnapshot } from "./wide-fixture.js";

const minute = 60_000;
const compactRadii = [500, 1000, 1500, 2500, 4000];
const wideRadii = [1000, 2500, 5000, 8000, 12000];
const equalToleranceMeters = 100;
const equalWalking = { id: "equal", label: "Kurang lebih sama" };
const yes = { id: "yes", label: "Ya" };
const no = { id: "no", label: "Tidak" };
const warmer = { id: "warmer", label: "Lebih dekat" };
const colder = { id: "colder", label: "Lebih jauh" };
const same = { id: "same", label: "Cabang sama" };
const different = { id: "different", label: "Cabang berbeda" };
const seeker = { id: "seeker", label: "Pencari lebih dekat" };
const hider = { id: "hider", label: "Penyembunyi lebih dekat" };
const outside = { id: "outside", label: "Di luar lingkaran" };

const prices: Record<SeekQuestionFamily, [draw: number, keep: number]> = {
  radar: [2, 1],
  photo: [1, 1],
  warmer: [2, 1],
  matching: [3, 1],
  measuring: [3, 1],
  nearest: [3, 2],
};

export type ClueBoard = Pick<SeekClueView, "branches" | "distanceSource" | "equalToleranceMeters" | "landmarks"> & {
  points: Record<string, SoloPoint>;
  hidingIds: string[];
  nearestIds: string[];
  walkingMeters: Record<string, Record<string, number>>;
  radii?: number[];
};

export type SeekClueState = {
  referenceId?: string;
  previousReferenceId?: string;
  questions: SeekQuestion[];
  delayUntil: number | null;
  deck: SeekDeck;
};

export function newSeekClueState(): SeekClueState {
  return { questions: [], delayUntil: null, deck: newSeekDeck() };
}

function allPairsShortest(landmarks: SoloPoint[], legs: { fromId: string; toId: string; distanceMeters: number }[], points: Record<string, SoloPoint>) {
  const walkingMeters: ClueBoard["walkingMeters"] = Object.fromEntries(landmarks.map(({ id }) => [id, { [id]: 0 }]));
  for (const { fromId, toId, distanceMeters } of legs) {
    if (!points[fromId] || !points[toId]) continue;
    const meters = Math.min(walkingMeters[fromId][toId] ?? Infinity, distanceMeters);
    walkingMeters[fromId][toId] = meters;
    walkingMeters[toId][fromId] = meters;
  }
  for (const { id: via } of landmarks) {
    for (const { id: from } of landmarks) {
      for (const { id: to } of landmarks) {
        const distance = (walkingMeters[from][via] ?? Infinity) + (walkingMeters[via][to] ?? Infinity);
        if (distance < (walkingMeters[from][to] ?? Infinity)) walkingMeters[from][to] = distance;
      }
    }
  }
  return walkingMeters;
}

export function compactClueBoard(start: SoloPoint, hidingPoints: SoloPoint[]): ClueBoard {
  const hidingIds = hidingPoints.map(({ id }) => id);
  const landmarks = [
    start,
    ...hidingPoints,
    ...Object.values(compactCatalog.checkpoints).filter(({ id }) => !hidingIds.includes(id)),
  ].map(({ id, name, latitude, longitude, x, y }) => ({ id, name, latitude, longitude, x, y }));
  const points = Object.fromEntries(landmarks.map((point) => [point.id, point]));
  const nearestIds = landmarks.filter(({ id }) => !hidingIds.includes(id)).map(({ id }) => id);
  const mrt = "MRT Utara–Selatan";
  const branches: Record<string, string> = {
    "csw-asean": mrt,
    "taman-literasi": mrt,
    "blok-m-plaza": mrt,
    "m-bloc": mrt,
    "taman-ayodya": mrt,
    "stadion-madya": "Transjakarta Koridor 1",
    "plaza-senayan": mrt,
    "pasar-mayestik": "Transjakarta Koridor 8",
    "velbak-kebayoran": "KRL Rangkasbitung",
    "taman-daksa": "Transjakarta Koridor 6",
    "stasiun-palmerah": "KRL Rangkasbitung",
  };

  // The prepared Compact snapshot has a disconnected walking graph. These two modeled
  // connectors complete the trial table. Transit legs are excluded from walking clues.
  const walkingLegs = [
    ...compactWalkingSnapshot.legs.filter(({ mode }) => mode === "walk"),
    { fromId: start.id, toId: "plaza-senayan", distanceMeters: 1850 },
    { fromId: "plaza-senayan", toId: "stasiun-palmerah", distanceMeters: 2600 },
  ];
  const walkingMeters = allPairsShortest(landmarks, walkingLegs, points);
  return {
    branches, equalToleranceMeters, landmarks, points, hidingIds, nearestIds, walkingMeters,
    radii: compactRadii,
    distanceSource: "Snapshot perjalanan Compact · perkiraan jalur pejalan kaki untuk simulasi",
  };
}

export function wideClueBoard(start: SoloPoint, hidingPoints: SoloPoint[]): ClueBoard {
  const hidingIds = hidingPoints.map(({ id }) => id);
  const widePoolIds = [
    "dukuh-atas", "bundaran-hi", "stasiun-tanah-abang", "stasiun-manggarai",
    "taman-ismail-marzuki", "monas-gambir", "taman-fatahillah", "stasiun-jakarta-kota", "plaza-senayan",
  ];
  const extras = widePoolIds
    .filter((id) => !hidingIds.includes(id))
    .map((id) => wideCheckpoints[id])
    .filter(Boolean);
  const landmarks = [start, ...hidingPoints, ...extras]
    .map(({ id, name, latitude, longitude, x, y }) => ({ id, name, latitude, longitude, x, y }));
  const points = Object.fromEntries(landmarks.map((point) => [point.id, point]));
  const nearestIds = landmarks.filter(({ id }) => !hidingIds.includes(id)).map(({ id }) => id);
  const branches: Record<string, string> = Object.fromEntries(
    landmarks.map(({ id }) => [id, wideBranches[id] ?? "MRT Utara–Selatan"]),
  );

  // Use stored walking legs plus modeled street-walking connectors across Jakarta-wide for simulation clues.
  const walkingLegs = [
    ...wideWalkingSnapshot.legs.filter(({ mode }) => mode === "walk"),
    { fromId: start.id, toId: "plaza-senayan", distanceMeters: 1850 },
    { fromId: "plaza-senayan", toId: "dukuh-atas", distanceMeters: 3900 },
    { fromId: "dukuh-atas", toId: "stasiun-tanah-abang", distanceMeters: 2400 },
    { fromId: "dukuh-atas", toId: "stasiun-manggarai", distanceMeters: 3500 },
    { fromId: "bundaran-hi", toId: "monas-gambir", distanceMeters: 2450 },
    { fromId: "stasiun-manggarai", toId: "taman-ismail-marzuki", distanceMeters: 2700 },
    { fromId: "taman-ismail-marzuki", toId: "monas-gambir", distanceMeters: 2550 },
    { fromId: "monas-gambir", toId: "stasiun-jakarta-kota", distanceMeters: 4900 },
  ];
  const walkingMeters = allPairsShortest(landmarks, walkingLegs, points);
  return {
    branches, equalToleranceMeters, landmarks, points, hidingIds, nearestIds, walkingMeters,
    radii: wideRadii,
    distanceSource: "Snapshot perjalanan Jakarta-wide · perkiraan jalur pejalan kaki untuk simulasi",
  };
}

export function clueBoardFor(board: GameBoard, start: SoloPoint, hidingPoints: SoloPoint[]): ClueBoard {
  return board === "jakarta-wide"
    ? wideClueBoard(start, hidingPoints)
    : compactClueBoard(start, hidingPoints);
}

export function recordSeekReference(state: SeekClueState, id: string) {
  if (state.referenceId === id) return;
  state.previousReferenceId = state.referenceId;
  state.referenceId = id;
}

function inRadius(board: ClueBoard, centerId: string, radius: number, ids: string[]) {
  return ids.filter((id) => distanceBetween(board.points[centerId], board.points[id]) <= radius);
}

function walkingDistance(board: ClueBoard, from: string, to: string) {
  return board.walkingMeters[from]?.[to];
}

function hasWalkingDistances(board: ClueBoard, fromIds: string[], toIds: string[]) {
  return fromIds.every((fromId) => toIds.every((toId) => walkingDistance(board, fromId, toId) !== undefined));
}

function nearestChoice(board: ClueBoard, centerId: string, radius: number, landmarkIds: string[], targetId: string): SeekClueChoice {
  if (distanceBetween(board.points[centerId], board.points[targetId]) > radius) return outside;
  const landmarks = landmarkIds.map((id) => board.points[id]);
  const distances = landmarks.map((point) => distanceBetween(board.points[targetId], point));
  const closest = Math.min(...distances);
  const tied = landmarks.filter((_, index) => Math.abs(distances[index] - closest) <= 0.000001);
  return {
    id: tied.map(({ id }) => id).join("_"),
    label: tied.map(({ name }) => name).join(" · "),
  };
}

export function seekClueMenu(board: ClueBoard, state: SeekClueState): SeekClueMenuItem[] {
  const { referenceId, previousReferenceId } = state;
  const boardRadii = board.radii ?? compactRadii;
  const allBranches = referenceId && [referenceId, ...board.hidingIds].every((id) => board.branches[id]);
  const walkingHistory = referenceId && previousReferenceId &&
    hasWalkingDistances(board, [referenceId, previousReferenceId], board.hidingIds);
  const walkFrom = referenceId ? [referenceId, ...board.hidingIds] : [];
  const options: Record<SeekQuestionFamily, SeekClueMenuItem["options"]> = {
    radar: referenceId ? boardRadii.map((radiusMeters) => ({ radiusMeters })) : [],
    photo: allBranches ? [{}] : [],
    warmer: walkingHistory ? [{}] : [],
    matching: allBranches ? [{}] : [],
    measuring: referenceId ? board.landmarks
      .filter(({ id }) => hasWalkingDistances(board, walkFrom, [id]))
      .map(({ id, name }) => ({ landmarkId: id, label: name })) : [],
    nearest: referenceId ? boardRadii
      .map((radiusMeters) => ({ radiusMeters, landmarkIds: inRadius(board, referenceId, radiusMeters, board.nearestIds) }))
      .filter(({ radiusMeters, landmarkIds }) => landmarkIds.length > 0 &&
        inRadius(board, referenceId, radiusMeters, board.hidingIds).length > 0) : [],
  };
  return (Object.keys(prices) as SeekQuestionFamily[]).map((family) => {
    const [drawCount, keepCount] = prices[family];
    return { family, drawCount, keepCount, responseMs: (family === "photo" ? 4 : 2) * minute, options: options[family] };
  });
}

function sameInput(left: SeekQuestionInput, right: SeekQuestionInput) {
  return left.radiusMeters === right.radiusMeters && left.landmarkId === right.landmarkId;
}

function publicChoices(board: ClueBoard, question: SeekQuestion): SeekClueChoice[] | undefined {
  switch (question.family) {
    case "radar": return [yes, no];
    case "warmer": return [warmer, colder, equalWalking];
    case "matching": return [same, different];
    case "measuring": return [seeker, hider, equalWalking];
    case "nearest": {
      // Generate every possible answer from the public hiding candidates.
      const choices = new Map<string, SeekClueChoice>([[outside.id, outside]]);
      for (const targetId of board.hidingIds) {
        const choice = nearestChoice(board, question.referenceId, question.radiusMeters!, question.landmarkIds!, targetId);
        choices.set(choice.id, choice);
      }
      return [...choices.values()];
    }
    case "photo": return undefined;
  }
}

export function seekQuestionRequest(
  board: ClueBoard, state: SeekClueState, family: SeekQuestionFamily, input: SeekQuestionInput, now: number, turnDeadline: number,
) {
  const { referenceId, previousReferenceId } = state;
  const menu = seekClueMenu(board, state).find((item) => item.family === family)!;
  if (!referenceId || !menu.options.length) return { error: "clue-unavailable" };
  const option = menu.options.find((option) => sameInput(option, input));
  if (!option) return { error: "invalid-clue-input" };

  const previous = family === "warmer" ? previousReferenceId : undefined;
  if (state.questions.some((question) => question.family === family && question.referenceId === referenceId &&
      question.previousReferenceId === previous && sameInput(question, input))) return {};
  if (state.questions.some(({ status }) => status === "pending")) return { error: "clue-pending" };
  if (state.delayUntil !== null) return { error: "question-delayed" };

  const { radiusMeters, landmarkId } = input;
  const question: SeekQuestion = {
    id: randomUUID(), family, referenceId, previousReferenceId: previous, radiusMeters, landmarkId,
    landmarkIds: option.landmarkIds,
    askedAt: now, deadline: Math.min(turnDeadline, now + menu.responseMs),
    drawCount: menu.drawCount, keepCount: menu.keepCount, status: "pending",
  };
  question.choices = publicChoices(board, question);
  state.questions.push(question);
  return {};
}

export function seekWalkingComparison(board: ClueBoard, question: SeekQuestion, targetId: string): SeekQuestion["walkingComparison"] {
  if (question.family === "warmer") return {
    firstMeters: walkingDistance(board, question.previousReferenceId!, targetId)!,
    secondMeters: walkingDistance(board, question.referenceId, targetId)!,
  };
  if (question.family === "measuring") return {
    firstMeters: walkingDistance(board, question.referenceId, question.landmarkId!)!,
    secondMeters: walkingDistance(board, targetId, question.landmarkId!)!,
  };
}

export function seekObjectiveAnswer(board: ClueBoard, question: SeekQuestion, targetId: string): SeekClueChoice {
  const { family, referenceId, radiusMeters, landmarkIds } = question;
  const margin = board.equalToleranceMeters;
  switch (family) {
    case "radar":
      return distanceBetween(board.points[referenceId], board.points[targetId]) <= radiusMeters! ? yes : no;
    case "photo": // The objective photo substitute uses the original reference.
    case "matching":
      return board.branches[referenceId] === board.branches[targetId] ? same : different;
    case "warmer": {
      const { firstMeters, secondMeters } = seekWalkingComparison(board, question, targetId)!;
      const improvement = firstMeters - secondMeters;
      return Math.abs(improvement) <= margin ? equalWalking : improvement > 0 ? warmer : colder;
    }
    case "measuring": {
      const { firstMeters, secondMeters } = seekWalkingComparison(board, question, targetId)!;
      const improvement = secondMeters - firstMeters;
      return Math.abs(improvement) <= margin ? equalWalking : improvement > 0 ? seeker : hider;
    }
    case "nearest":
      return nearestChoice(board, referenceId, radiusMeters!, landmarkIds!, targetId);
  }
}

export function expireSeekQuestion(board: ClueBoard, state: SeekClueState, targetId: string, through: number) {
  const pending = state.questions.find(({ status }) => status === "pending");
  if (!pending || pending.deadline > through) return false;
  pending.answer = seekObjectiveAnswer(board, pending, targetId).label;
  pending.status = pending.family === "photo" ? "substituted" : "timeout";
  return true;
}
