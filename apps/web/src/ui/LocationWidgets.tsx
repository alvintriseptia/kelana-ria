import type { GeoCoordinate, LocationFix } from "@kelana-ria/contracts";
import {
  evaluateCheckInProximity,
  googleMapsDirectionsUrl,
  type LiveLocationStatus,
  type ProximityEvaluation,
} from "../live-location";
import { MapHost } from "./MapHost";
import "../live-location.css";

export function DirectionsLink({
  coord,
  label = "Arah di Google Maps",
  testId,
  className,
}: {
  coord: GeoCoordinate;
  label?: string;
  testId?: string;
  className?: string;
}) {
  return (
    <a
      class={`loc-directions-link${className ? ` ${className}` : ""}`}
      href={googleMapsDirectionsUrl(coord)}
      target="_blank"
      rel="noopener noreferrer"
      data-testid={testId}
    >
      <span aria-hidden="true">↗</span> {label}
    </a>
  );
}

export function DistanceMeter({
  fix,
  target,
  checkInRadiusMeters,
  maxGpsAccuracyMeters,
  status,
  testId,
  showEnableChip = true,
  onEnableLocation,
}: {
  fix: LocationFix | null;
  target: GeoCoordinate;
  checkInRadiusMeters: number;
  maxGpsAccuracyMeters: number;
  status: LiveLocationStatus;
  testId?: string;
  showEnableChip?: boolean;
  onEnableLocation: () => void;
}) {
  const proximity: ProximityEvaluation = evaluateCheckInProximity(
    fix,
    target,
    checkInRadiusMeters,
    maxGpsAccuracyMeters,
  );
  if (proximity.state !== "none") {
    return (
      <div
        class={`loc-meter loc-meter--${proximity.state}`}
        data-proximity-state={proximity.state}
        role="status"
        data-testid={testId}
      >
        {proximity.label}
      </div>
    );
  }
  if (!showEnableChip || status === "unavailable") return null;
  if (status === "requesting" || status === "watching") {
    return (
      <div
        class="loc-meter loc-meter--pending"
        data-proximity-state="pending"
        role="status"
        data-testid={testId}
      >
        ◎ Mencari posisi GPS…
      </div>
    );
  }
  if (status === "denied") {
    return (
      <div class="loc-meter-row">
        <span
          class="loc-meter loc-meter--low-accuracy"
          data-proximity-state="denied"
          role="status"
          data-testid={testId}
        >
          ⚠ Izin lokasi ditolak
        </span>
        <button
          type="button"
          class="loc-enable-chip"
          data-loc-action="enable-live-location"
          onClick={onEnableLocation}
        >
          ◎ Coba Lagi
        </button>
      </div>
    );
  }
  return (
    <button
      type="button"
      class="loc-enable-chip"
      data-loc-action="enable-live-location"
      data-testid="enable-live-location-btn"
      onClick={onEnableLocation}
    >
      ◎ Aktifkan Lokasi
    </button>
  );
}

export function StartPointCard({
  startPoint,
  fix,
  checkInRadiusMeters,
  maxGpsAccuracyMeters,
  status,
  mapExpanded,
  mapHostId,
  onEnableLocation,
  onToggleMap,
  onMountMiniMap,
}: {
  startPoint: GeoCoordinate & { name: string; accessNotes?: string };
  fix: LocationFix | null;
  checkInRadiusMeters: number;
  maxGpsAccuracyMeters: number;
  status: LiveLocationStatus;
  mapExpanded: boolean;
  mapHostId: string;
  onEnableLocation: () => void;
  onToggleMap: () => void;
  onMountMiniMap: (container: HTMLElement) => (() => void) | void;
}) {
  return (
    <section class="loc-start-card" aria-label="Titik Awal" data-testid="lobby-start-card">
      <div class="loc-start-head">
        <div class="loc-start-title-wrap">
          <span class="loc-start-eyebrow">Titik Awal</span>
          <strong class="loc-start-name">{startPoint.name}</strong>
          {startPoint.accessNotes && (
            <small class="loc-start-notes">{startPoint.accessNotes}</small>
          )}
        </div>
      </div>
      <DistanceMeter
        fix={fix}
        target={startPoint}
        checkInRadiusMeters={checkInRadiusMeters}
        maxGpsAccuracyMeters={maxGpsAccuracyMeters}
        status={status}
        testId="lobby-distance-meter"
        showEnableChip
        onEnableLocation={onEnableLocation}
      />
      <div class="loc-start-actions">
        <DirectionsLink coord={startPoint} testId="lobby-directions-link" />
        <button
          type="button"
          class="secondary loc-map-toggle"
          data-loc-action="toggle-start-map"
          data-testid="lobby-start-map-toggle"
          aria-expanded={mapExpanded}
          onClick={onToggleMap}
        >
          {mapExpanded ? "Tutup Peta" : "Peta Titik Awal"}
        </button>
      </div>
      {mapExpanded && (
        <MapHost
          id={mapHostId}
          className="loc-mini-map"
          testId="lobby-start-minimap"
          onMount={onMountMiniMap}
        />
      )}
    </section>
  );
}
