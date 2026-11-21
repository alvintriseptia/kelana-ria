import { randomUUID } from "node:crypto";
import type { SeekClueChoice, SeekClueMenuItem, SeekClueView, SeekQuestion, SeekQuestionFamily, SeekQuestionInput, SoloPoint } from "@kelana-ria/contracts";
import { compactCatalog, compactWalkingSnapshot } from "./solo-fixture.js";
import { distanceBetween } from "./solo-rules.js";
import { newSeekDeck, type SeekDeck } from "./seek-deck.js";

const minute = 60_000;
const radii = [500, 1000, 1500, 2500, 4000];
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

  const walkingMeters: ClueBoard["walkingMeters"] = Object.fromEntries(landmarks.map(({ id }) => [id, { [id]: 0 }]));
  // The prepared Compact snapshot has a disconnected walking graph. These two modeled
  // connectors complete the trial table. Transit legs are excluded from walking clues.
  const walkingLegs = [
    ...compactWalkingSnapshot.legs.filter(({ mode }) => mode === "walk"),
    { fromId: start.id, toId: "plaza-senayan", distanceMeters: 1850 },
    { fromId: "plaza-senayan", toId: "stasiun-palmerah", distanceMeters: 2600 },
  ];
  for (const { fromId, toId, distanceMeters } of walkingLegs) {
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
  return {
    branches, equalToleranceMeters, landmarks, points, hidingIds, nearestIds, walkingMeters,
    distanceSource: "Snapshot perjalanan Compact · perkiraan jalur pejalan kaki untuk simulasi",
  };
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
  const allBranches = referenceId && [referenceId, ...board.hidingIds].every((id) => board.branches[id]);
  const walkingHistory = referenceId && previousReferenceId &&
    hasWalkingDistances(board, [referenceId, previousReferenceId], board.hidingIds);
  const walkFrom = referenceId ? [referenceId, ...board.hidingIds] : [];
  const options: Record<SeekQuestionFamily, SeekClueMenuItem["options"]> = {
    radar: referenceId ? radii.map((radiusMeters) => ({ radiusMeters })) : [],
    photo: allBranches ? [{}] : [],
    warmer: walkingHistory ? [{}] : [],
    matching: allBranches ? [{}] : [],
    measuring: referenceId ? board.landmarks
      .filter(({ id }) => hasWalkingDistances(board, walkFrom, [id]))
      .map(({ id, name }) => ({ landmarkId: id, label: name })) : [],
    nearest: referenceId ? radii
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
