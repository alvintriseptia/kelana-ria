export type RoomActivityPanel = "board" | "questions" | "clues" | "cards" | "score" | "review" | "regroup";

export type RoomActivityKind =
  | "role" | "release" | "question" | "answer" | "question-closed" | "draw" | "card"
  | "curse" | "endgame" | "turn-complete" | "round-start" | "claim" | "lock" | "steal"
  | "zone" | "proof" | "vulnerable" | "round-complete";

export type RoomActivityNotice = {
  id: string;
  kind: RoomActivityKind;
  text: string;
  panel: RoomActivityPanel;
  deadline?: number;
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
