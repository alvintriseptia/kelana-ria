export type RoomActivityPanel = "board" | "questions" | "clues" | "cards" | "score" | "review" | "regroup";

export type RoomActivityKind =
  | "role" | "release" | "question" | "answer" | "photo-clue" | "question-closed" | "draw" | "card"
  | "curse" | "turn-complete" | "round-start" | "claim" | "lock" | "steal"
  | "zone" | "proof" | "vulnerable" | "round-complete";

export type RoomActivityNotice = {
  id: string;
  kind: RoomActivityKind;
  text: string;
  panel: RoomActivityPanel;
  deadline?: number;
  clueIndex?: number;
  landmarkId?: string;
  zoneId?: string;
};

export type RoomActivityEvent = RoomActivityNotice & {
  sequence: number;
  at: number;
  turn?: number;
  alert?: true;
  mapChange?: true;
};

export type RoomActivityFeed = {
  sequence: number;
  events: RoomActivityEvent[];
  prompt: RoomActivityNotice | null;
};
