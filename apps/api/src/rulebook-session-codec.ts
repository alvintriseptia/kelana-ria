import { randomInt } from "node:crypto";
import type {
  ClaimEngineActionReply,
  ClaimRulebookPack,
  ClaimSeatPosition,
  GeoSnapshot,
  HideSeekRulebookPack,
  SeekEngineActionReply,
} from "@kelana-ria/contracts";
import type { ClaimEngineMatch } from "./claim-engine/claim-engine.js";
import type { ClaimTacticalDeckState } from "./claim-engine/tactical-deck.js";
import { createRoomActivity, type RoomActivitySnapshot } from "./rulebook-activity.js";
import type { RulebookRoomPass } from "./rulebook-store.js";
import type { SeekDeckEngineState } from "./seek-engine/deck-engine.js";
import type { SeekEngineMatch } from "./seek-engine/seek-engine.js";

export type LiveSeekSession = {
  format: "hide-and-seek";
  pass: RulebookRoomPass;
  match: SeekEngineMatch;
  photos: Map<string, Buffer>;
  deck: SeekDeckEngineState;
  appliedDeckActions: Map<string, { ok: boolean; error?: string; [key: string]: unknown }>;
  activity: ReturnType<typeof createRoomActivity>;
  qa?: { offsetMs: number; advances: Set<string> };
  recapSaved?: boolean;
  stateRev: number;
};

export type LiveClaimSession = {
  format: "claim-the-city";
  pass: RulebookRoomPass;
  match: ClaimEngineMatch;
  photos: Map<string, Buffer>;
  seatPositions: Map<string, ClaimSeatPosition>;
  activity: ReturnType<typeof createRoomActivity>;
  qa?: { offsetMs: number; advances: Set<string> };
  recapSaved?: boolean;
  stateRev: number;
};

export type LiveSession = LiveSeekSession | LiveClaimSession;

type SerializedClaimSeat = Omit<ClaimEngineMatch["seats"][number], "burnedLandmarks" | "scoutedLandmarkIds"> & {
  burnedLandmarks: string[];
  scoutedLandmarkIds: string[];
};

type SerializedClaimMatch = Omit<ClaimEngineMatch, "pack" | "snapshot" | "seats" | "deck" | "appliedActions" | "rngInt"> & {
  seats: SerializedClaimSeat[];
  deck: Omit<ClaimTacticalDeckState, "rngInt">;
  appliedActions: [string, Omit<ClaimEngineActionReply, "room">][];
};

type SerializedSeekMatch = Omit<SeekEngineMatch, "pack" | "snapshot" | "appliedActions" | "generateFoundCode"> & {
  appliedActions: [string, Omit<SeekEngineActionReply, "room">][];
};

type SerializedSeekDeck = Omit<SeekDeckEngineState, "rngInt">;

export type SerializedLiveClaimSession = {
  format: "claim-the-city";
  pass: RulebookRoomPass;
  match: SerializedClaimMatch;
  activity: RoomActivitySnapshot;
  qa?: { offsetMs: number; advances: string[] };
  recapSaved: boolean;
  stateRev: number;
};

export type SerializedLiveSeekSession = {
  format: "hide-and-seek";
  pass: RulebookRoomPass;
  match: SerializedSeekMatch;
  deck: SerializedSeekDeck;
  appliedDeckActions: [string, { ok: boolean; error?: string; [key: string]: unknown }][];
  activity: RoomActivitySnapshot;
  qa?: { offsetMs: number; advances: string[] };
  recapSaved: boolean;
  stateRev: number;
};

export type SerializedLiveSession = SerializedLiveClaimSession | SerializedLiveSeekSession;

const defaultRngInt = (maxExclusive: number) => randomInt(0, maxExclusive);
const defaultFoundCode = () => String(randomInt(0, 10_000)).padStart(4, "0");

export function serializeLiveSession(session: LiveSession): SerializedLiveSession {
  if (session.format === "claim-the-city") {
    const { pack: _pack, snapshot: _snapshot, seats, deck, appliedActions, rngInt: _rng, ...matchRest } = session.match;
    const { rngInt: _deckRng, ...deckRest } = deck;
    return {
      format: "claim-the-city",
      pass: session.pass,
      match: {
        ...matchRest,
        seats: seats.map(({ burnedLandmarks, scoutedLandmarkIds, ...seat }) => ({
          ...seat,
          burnedLandmarks: [...burnedLandmarks],
          scoutedLandmarkIds: [...scoutedLandmarkIds],
        })),
        deck: deckRest,
        appliedActions: [...appliedActions.entries()],
      },
      activity: session.activity.snapshot(),
      ...(session.qa ? { qa: { offsetMs: session.qa.offsetMs, advances: [...session.qa.advances] } } : {}),
      recapSaved: Boolean(session.recapSaved),
      stateRev: session.stateRev,
    };
  }

  const { pack: _pack, snapshot: _snapshot, appliedActions, generateFoundCode: _gen, ...matchRest } = session.match;
  const { rngInt: _deckRng, ...deckRest } = session.deck;
  return {
    format: "hide-and-seek",
    pass: session.pass,
    match: {
      ...matchRest,
      appliedActions: [...appliedActions.entries()],
    },
    deck: deckRest,
    appliedDeckActions: [...session.appliedDeckActions.entries()],
    activity: session.activity.snapshot(),
    ...(session.qa ? { qa: { offsetMs: session.qa.offsetMs, advances: [...session.qa.advances] } } : {}),
    recapSaved: Boolean(session.recapSaved),
    stateRev: session.stateRev,
  };
}

export function deserializeLiveSession(
  raw: SerializedLiveSession,
  pack: ClaimRulebookPack | HideSeekRulebookPack,
  snapshot: GeoSnapshot,
  photos: Map<string, Buffer>,
): LiveSession {
  const stateRev = typeof raw.stateRev === "number" && Number.isSafeInteger(raw.stateRev) && raw.stateRev >= 1
    ? raw.stateRev
    : 1;

  if (raw.format === "claim-the-city") {
    const match: ClaimEngineMatch = {
      ...raw.match,
      pack: pack as ClaimRulebookPack,
      snapshot,
      seats: raw.match.seats.map(({ burnedLandmarks, scoutedLandmarkIds, ...seat }) => ({
        ...seat,
        burnedLandmarks: new Set(burnedLandmarks),
        scoutedLandmarkIds: new Set(scoutedLandmarkIds),
      })),
      deck: {
        ...raw.match.deck,
        rewardOffersBySeat: raw.match.deck.rewardOffersBySeat ?? {},
        rngInt: defaultRngInt,
      },
      appliedActions: new Map(raw.match.appliedActions),
      rngInt: defaultRngInt,
    };
    return {
      format: "claim-the-city",
      pass: raw.pass,
      match,
      photos,
      seatPositions: new Map(),
      activity: createRoomActivity(raw.activity),
      ...(raw.qa ? { qa: { offsetMs: raw.qa.offsetMs, advances: new Set(raw.qa.advances) } } : {}),
      recapSaved: Boolean(raw.recapSaved),
      stateRev,
    };
  }

  const match: SeekEngineMatch = {
    ...raw.match,
    pack: pack as HideSeekRulebookPack,
    snapshot,
    phase: String(raw.match.phase) === "endgame" ? "seeking" : raw.match.phase,
    usedFoundCodes: raw.match.usedFoundCodes ?? (raw.match.foundCode ? [raw.match.foundCode] : []),
    foundCodeAttempts: raw.match.foundCodeAttempts ?? [],
    appliedActions: new Map(raw.match.appliedActions.map(([key, saved]) => {
      const { endgameTriggered: _oldProximitySignal, ...reply } = saved as typeof saved & { endgameTriggered?: boolean };
      return [key, reply];
    })),
    generateFoundCode: defaultFoundCode,
  };
  const deck: SeekDeckEngineState = {
    ...raw.deck,
    rngInt: defaultRngInt,
  };
  return {
    format: "hide-and-seek",
    pass: raw.pass,
    match,
    photos,
    deck,
    appliedDeckActions: new Map(raw.appliedDeckActions),
    activity: createRoomActivity(raw.activity),
    ...(raw.qa ? { qa: { offsetMs: raw.qa.offsetMs, advances: new Set(raw.qa.advances) } } : {}),
    recapSaved: Boolean(raw.recapSaved),
    stateRev,
  };
}
