import type { ClaimEngineRoomView, ClaimZoneStanding } from "@kelana-ria/contracts";
import { teamVisual } from "../lobby-ui";
import { orderedTeamIds } from "./types";

export function claimZoneOwnership(room: ClaimEngineRoomView, zone: ClaimZoneStanding, teams: string[]) {
  if (room.isSolo) {
    const reached = room.landmarks.some(landmark =>
      landmark.zoneId === zone.zoneId && landmark.status === "locked" && landmark.ownerTeamId === room.teamId,
    );
    return reached
      ? { state: "controlled", label: "Tercapai", visual: teamVisual(0) }
      : { state: "unclaimed", label: "Belum tercapai" };
  }
  const index = teams.indexOf(zone.controllerTeamId ?? "");
  if (index >= 0) {
    const visual = teamVisual(index);
    return { state: "controlled", label: `Dikuasai ${visual.label}`, visual };
  }
  return Object.values(zone.weightsByTeam).some(weight => weight > 0)
    ? { state: "tied", label: "Seri" }
    : { state: "unclaimed", label: "Belum dikuasai" };
}

export function ClaimZoneList({ room }: { room: ClaimEngineRoomView }) {
  const teams = orderedTeamIds(room.seats);
  return (
    <>
      <h3>Kepemilikan Zona</h3>
      <ul class="rb-list cg-zone-list" aria-label="Kepemilikan Zona">
        {room.zones.map(zone => {
          const { state, label, visual } = claimZoneOwnership(room, zone, teams);
          return (
            <li key={zone.zoneId} data-zone-id={zone.zoneId}>
              <strong>{zone.name}</strong>
              <span class="cg-zone-badge" data-zone-state={state} style={visual && {
                color: visual.accent, backgroundColor: visual.bg,
              }}>
                {visual && !room.isSolo && <span aria-hidden="true">{visual.shape} </span>}
                {label}
              </span>
            </li>
          );
        })}
      </ul>
    </>
  );
}
