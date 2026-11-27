import type { LocationFix } from "@kelana-ria/contracts";
import type { Signal } from "@preact/signals";
import {
  evaluateCheckInProximity,
  formatDistanceShort,
  haversineMeters,
  type LiveLocationStatus,
} from "../live-location";
import { DirectionsLink, DistanceMeter } from "../ui/LocationWidgets";
import { SeekCursesCard, SeekSlotAlert } from "./SeekShared";
import { qaPoint, type SeekInlineError, type SeekRoomPayload } from "./types";

export function SeekBoardPanel({
  payload,
  stationId,
  qaStationId,
  mapFailed,
  selfFix,
  liveLocationStatus,
  foundCodeDraftSig,
  inlineError,
  busy,
  onEnableLocation,
  onRetryMap,
  onSelectStation,
  onLockAnchor,
  onSeekerCheckIn,
  onTriggerEndgame,
  onConfirmFreeze,
  onSubmitFoundCode,
  onClearCurseGps,
  onSubmitCursePhoto,
  onClearCurseHonor,
  onBuyoutCurse,
  onReviewCursePhoto,
}: {
  payload: SeekRoomPayload;
  stationId: string;
  qaStationId: string;
  mapFailed: boolean;
  selfFix: LocationFix | null;
  liveLocationStatus: LiveLocationStatus;
  foundCodeDraftSig: Signal<string>;
  inlineError: SeekInlineError;
  busy: boolean;
  onEnableLocation: () => void;
  onRetryMap: () => void;
  onSelectStation: (stationId: string) => void;
  onLockAnchor: (stationId: string) => void;
  onSeekerCheckIn: () => void;
  onTriggerEndgame: (stationId: string) => void;
  onConfirmFreeze: () => void;
  onSubmitFoundCode: () => void;
  onClearCurseGps: (curseId: string) => void;
  onSubmitCursePhoto: (curseId: string) => void;
  onClearCurseHonor: (curseId: string) => void;
  onBuyoutCurse: (curseId: string) => void;
  onReviewCursePhoto: (curseId: string, approve: boolean) => void;
}) {
  const { room, publicBoard } = payload;
  const isHider = room.role === "hider";
  const canHide =
    isHider &&
    ((room.phase === "head_start" && !room.ownAnchorStationId) ||
      room.moveZoneUntil !== undefined);
  const checkpoints = canHide
    ? publicBoard.stations
    : [
        room.turnStartPoint,
        ...publicBoard.stations.filter((point) => point.id !== room.turnStartPoint.id),
      ];
  const selectedId = stationId || (payload.qa ? qaPoint(payload, qaStationId).id : "");
  const selected = checkpoints.find((station) => station.id === selectedId);
  const ownAnchor =
    isHider && room.ownAnchorStationId
      ? publicBoard.stations.find((station) => station.id === room.ownAnchorStationId)
      : undefined;
  const focusStation = selected ?? ownAnchor ?? room.turnStartPoint;
  const proximity = focusStation
    ? evaluateCheckInProximity(
        selfFix,
        focusStation,
        publicBoard.checkInRadiusMeters,
        publicBoard.maxGpsAccuracyMeters,
      )
    : null;
  const readyClass = proximity?.state === "ready" ? " loc-btn-ready" : "";

  return (
    <>
      <h2 id="sg-panel-title" tabIndex={-1}>
        {canHide ? "Pilih tempat sembunyi" : selected ? selected.name : "Check-in"}
      </h2>

      {room.phase === "head_start" && (
        <p>
          {isHider
            ? canHide
              ? "Pilih stasiun pada peta, lalu kunci lokasi sebelum pencarian dimulai."
              : "Lokasi terkunci. Tetap di zona sampai waktu sembunyi habis."
            : "Pencarian dimulai saat waktu sembunyi habis."}
        </p>
      )}

      {focusStation && (
        <div class="cg-selected-meta-actions">
          <DistanceMeter
            fix={selfFix}
            target={focusStation}
            checkInRadiusMeters={publicBoard.checkInRadiusMeters}
            maxGpsAccuracyMeters={publicBoard.maxGpsAccuracyMeters}
            status={liveLocationStatus}
            testId="seek-station-distance-meter"
            showEnableChip
            onEnableLocation={onEnableLocation}
          />
          <DirectionsLink coord={focusStation} testId="seek-station-directions-link" />
        </div>
      )}

      {mapFailed && (
        <>
          <p role="status">Peta tidak tersedia. Pilih titik dari daftar.</p>
          <button
            type="button"
            class="sg-quiet"
            data-action="retry-map"
            disabled={busy}
            onClick={onRetryMap}
          >
            Muat ulang peta
          </button>
        </>
      )}

      {mapFailed && (canHide || !isHider) && (
        <div class="sg-picks" role="group" aria-label="Pilih titik">
          {checkpoints.map((station) => {
            const dist = selfFix
              ? ` · ${formatDistanceShort(haversineMeters(selfFix, station))}`
              : "";
            return (
              <button
                key={station.id}
                type="button"
                class="sg-pick"
                data-action="select-station"
                data-station={station.id}
                aria-pressed={station.id === selected?.id ? "true" : "false"}
                disabled={busy}
                onClick={() => onSelectStation(station.id)}
              >
                {station.name}
                {dist}
              </button>
            );
          })}
        </div>
      )}

      <SeekSlotAlert error={inlineError} slot="board-checkin" />

      {canHide && selected && (
        <button
          type="button"
          class={`sg-main${readyClass}`}
          data-action="lock-anchor"
          data-station={selected.id}
          disabled={busy}
          onClick={() => onLockAnchor(selected.id)}
        >
          Kunci lokasi
        </button>
      )}

      {!isHider && room.phase === "seeking" && (
        <button
          type="button"
          class={`sg-pick${readyClass}`}
          data-action="seeker-check-in"
          disabled={busy}
          onClick={onSeekerCheckIn}
        >
          Perbarui posisi
        </button>
      )}

      {!isHider && room.phase !== "head_start" && (
        <button
          type="button"
          class={`sg-main${readyClass}`}
          data-action="trigger-endgame"
          data-station={selected?.id ?? ""}
          disabled={busy}
          onClick={() => onTriggerEndgame(selected?.id ?? "")}
        >
          Check-in turun dari transit
        </button>
      )}

      {isHider && room.phase === "endgame" && room.foundCode && (
        <>
          <p>Berikan kode saat pencari menemukanmu.</p>
          <div class="rb-found-code" data-testid="hider-found-code">
            {room.foundCode}
          </div>
          {room.hiderFrozen ? (
            <p>Posisi terkunci</p>
          ) : (
            <button
              type="button"
              class="sg-main"
              data-action="confirm-freeze"
              disabled={busy}
              onClick={onConfirmFreeze}
            >
              Kunci posisi sekarang
            </button>
          )}
        </>
      )}

      {!isHider && room.phase === "endgame" && (
        <div class="rb-field">
          <label for="rb-found-input">Kode temuan 4 digit</label>
          <input
            id="rb-found-input"
            inputMode="numeric"
            maxLength={4}
            placeholder="1234"
            value={foundCodeDraftSig.value}
            onInput={(event) => {
              foundCodeDraftSig.value = event.currentTarget.value;
            }}
          />
          <SeekSlotAlert error={inlineError} slot="found-code" />
          <button
            type="button"
            class="sg-main"
            data-action="submit-found-code"
            disabled={busy}
            onClick={onSubmitFoundCode}
          >
            Konfirmasi temuan
          </button>
        </div>
      )}

      <SeekCursesCard
        payload={payload}
        inlineError={inlineError}
        busy={busy}
        onClearGps={onClearCurseGps}
        onSubmitPhoto={onSubmitCursePhoto}
        onClearHonor={onClearCurseHonor}
        onBuyout={onBuyoutCurse}
        onReviewPhoto={onReviewCursePhoto}
      />
    </>
  );
}
