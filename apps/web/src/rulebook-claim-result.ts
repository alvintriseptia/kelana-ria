import type { ClaimEngineOutcome, ClaimTeamScore } from "@kelana-ria/contracts";

export const claimResultReasons: Record<ClaimEngineOutcome["reason"], string> = {
  time: "Waktu ronde habis.",
  all_locked: "Semua landmark terkunci.",
  solo_target_met: "Target landmark dan zona tercapai.",
  solo_impossible: "Target solo sudah tidak dapat dicapai.",
  forfeit: "Lawan keluar dari permainan.",
  abandoned: "Ruang sudah tidak aktif.",
  canceled: "Ruang dibatalkan.",
};

const rankingMetrics = [
  ["zonesControlled", "Zona yang dikuasai"],
  ["lockedLandmarks", "Landmark yang terkunci"],
  ["totalLandmarks", "Total landmark"],
] as const;

export function claimDecidingMetric(
  standings: ClaimTeamScore[], outcome: Pick<ClaimEngineOutcome, "reason" | "winnerTeamId">, isSolo: boolean,
) {
  const [leader, runnerUp] = standings;
  if (isSolo || leader?.teamId !== outcome.winnerTeamId || !runnerUp || outcome.reason === "forfeit") return undefined;
  return rankingMetrics.find(([key]) => leader[key] > runnerUp[key])?.[1];
}
