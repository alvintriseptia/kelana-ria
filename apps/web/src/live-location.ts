import type { GeoCoordinate, LocationFix } from "@kelana-ria/contracts";
import { escapeText } from "./escape-text";
import "./live-location.css";

export type LiveLocationStatus = "prompt" | "requesting" | "watching" | "denied" | "unavailable";

export type ProximityState = "none" | "ready" | "low-accuracy" | "out-of-range";

export type ProximityEvaluation = {
  state: ProximityState;
  distanceMeters?: number;
  accuracyMeters?: number;
  label: string;
};

export function haversineMeters(a: GeoCoordinate, b: GeoCoordinate): number {
  const rad = Math.PI / 180;
  const dLat = (b.latitude - a.latitude) * rad;
  const dLng = (b.longitude - a.longitude) * rad;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.latitude * rad) * Math.cos(b.latitude * rad) * Math.sin(dLng / 2) ** 2;
  return 12_742_000 * Math.asin(Math.sqrt(Math.min(1, s)));
}

export function formatDistanceShort(meters: number): string {
  const rounded = Math.max(0, Math.round(meters));
  if (rounded < 1000) return `~${rounded} m`;
  return `~${(rounded / 1000).toFixed(1).replace(".", ",")} km`;
}

export function googleMapsDirectionsUrl(coord: GeoCoordinate): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(`${coord.latitude},${coord.longitude}`)}`;
}

export function evaluateCheckInProximity(
  fix: LocationFix | null,
  target: GeoCoordinate,
  checkInRadiusMeters: number,
  maxGpsAccuracyMeters: number,
): ProximityEvaluation {
  if (!fix) return { state: "none", label: "" };
  const distanceMeters = Math.max(0, Math.round(haversineMeters(fix, target)));
  const accuracyMeters = Number.isFinite(fix.accuracy) ? Math.max(0, Math.round(fix.accuracy)) : 0;
  const radius = Math.max(1, Math.round(checkInRadiusMeters));
  const maxAcc = Math.max(1, Math.round(maxGpsAccuracyMeters));

  if (accuracyMeters > maxAcc) {
    return {
      state: "low-accuracy",
      distanceMeters,
      accuracyMeters,
      label: `⚠ Akurasi GPS ±${accuracyMeters} m · pindah ke area terbuka (≤ ${maxAcc} m)`,
    };
  }
  if (distanceMeters <= radius) {
    return {
      state: "ready",
      distanceMeters,
      accuracyMeters,
      label: `✓ Dalam jangkauan (${distanceMeters} m)`,
    };
  }
  return {
    state: "out-of-range",
    distanceMeters,
    accuracyMeters,
    label: `◎ ${distanceMeters} m lagi · butuh ≤ ${radius} m`,
  };
}

export function renderDirectionsLink(
  coord: GeoCoordinate,
  opts?: { label?: string; testId?: string; className?: string },
): string {
  const label = opts?.label ?? "Arah di Google Maps";
  const testIdAttr = opts?.testId ? ` data-testid="${escapeText(opts.testId)}"` : "";
  const extraClass = opts?.className ? ` ${opts.className}` : "";
  return `<a class="loc-directions-link${extraClass}" href="${escapeText(googleMapsDirectionsUrl(coord))}" target="_blank" rel="noopener noreferrer"${testIdAttr}><span aria-hidden="true">↗</span> ${escapeText(label)}</a>`;
}

export function renderDistanceMeter(opts: {
  fix: LocationFix | null;
  target: GeoCoordinate;
  checkInRadiusMeters: number;
  maxGpsAccuracyMeters: number;
  status: LiveLocationStatus;
  testId?: string;
  showEnableChip?: boolean;
}): { html: string; proximity: ProximityEvaluation } {
  const proximity = evaluateCheckInProximity(
    opts.fix,
    opts.target,
    opts.checkInRadiusMeters,
    opts.maxGpsAccuracyMeters,
  );
  const testIdAttr = opts.testId ? ` data-testid="${escapeText(opts.testId)}"` : "";
  if (proximity.state !== "none") {
    return {
      proximity,
      html: `<div class="loc-meter loc-meter--${proximity.state}" data-proximity-state="${proximity.state}" role="status"${testIdAttr}>${escapeText(proximity.label)}</div>`,
    };
  }
  if (!opts.showEnableChip) {
    return { proximity, html: "" };
  }
  if (opts.status === "requesting" || opts.status === "watching") {
    return {
      proximity,
      html: `<div class="loc-meter loc-meter--pending" data-proximity-state="pending" role="status"${testIdAttr}>◎ Mencari posisi GPS…</div>`,
    };
  }
  if (opts.status === "denied") {
    return {
      proximity,
      html: `<div class="loc-meter-row">
        <span class="loc-meter loc-meter--low-accuracy" data-proximity-state="denied" role="status"${testIdAttr}>⚠ Izin lokasi ditolak</span>
        <button type="button" class="loc-enable-chip" data-loc-action="enable-live-location">◎ Coba Lagi</button>
      </div>`,
    };
  }
  if (opts.status === "unavailable") {
    return { proximity, html: "" };
  }
  return {
    proximity,
    html: `<button type="button" class="loc-enable-chip" data-loc-action="enable-live-location" data-testid="enable-live-location-btn">◎ Aktifkan Lokasi</button>`,
  };
}

export function renderStartPointCard(opts: {
  startPoint: GeoCoordinate & { name: string; accessNotes?: string };
  fix: LocationFix | null;
  checkInRadiusMeters: number;
  maxGpsAccuracyMeters: number;
  status: LiveLocationStatus;
  mapExpanded: boolean;
  mapHostId: string;
}): { html: string; proximity: ProximityEvaluation } {
  const meter = renderDistanceMeter({
    fix: opts.fix,
    target: opts.startPoint,
    checkInRadiusMeters: opts.checkInRadiusMeters,
    maxGpsAccuracyMeters: opts.maxGpsAccuracyMeters,
    status: opts.status,
    testId: "lobby-distance-meter",
    showEnableChip: true,
  });
  const html = `<section class="loc-start-card" aria-label="Titik Awal" data-testid="lobby-start-card">
    <div class="loc-start-head">
      <div class="loc-start-title-wrap">
        <span class="loc-start-eyebrow">Titik Awal</span>
        <strong class="loc-start-name">${escapeText(opts.startPoint.name)}</strong>
        ${opts.startPoint.accessNotes ? `<small class="loc-start-notes">${escapeText(opts.startPoint.accessNotes)}</small>` : ""}
      </div>
    </div>
    ${meter.html}
    <div class="loc-start-actions">
      ${renderDirectionsLink(opts.startPoint, { testId: "lobby-directions-link" })}
      <button type="button" class="secondary loc-map-toggle" data-loc-action="toggle-start-map" data-testid="lobby-start-map-toggle" aria-expanded="${opts.mapExpanded}">
        ${opts.mapExpanded ? "Tutup Peta" : "Peta Titik Awal"}
      </button>
    </div>
    ${opts.mapExpanded ? `<div id="${escapeText(opts.mapHostId)}" class="loc-mini-map" data-testid="lobby-start-minimap"></div>` : ""}
  </section>`;
  return { html, proximity: meter.proximity };
}

export type LiveLocationWatcher = {
  checkPermissionAndAutoStart: () => void;
  start: () => void;
  stop: () => void;
  getFix: () => LocationFix | null;
  getStatus: () => LiveLocationStatus;
  setManualFix: (fix: LocationFix) => void;
};

export function createLiveLocationWatcher(options: {
  signal: AbortSignal;
  onFix: (fix: LocationFix) => void;
  onStatusChange?: (status: LiveLocationStatus) => void;
}): LiveLocationWatcher {
  const supported =
    typeof navigator !== "undefined" &&
    typeof navigator.geolocation?.watchPosition === "function";

  let status: LiveLocationStatus = supported ? "prompt" : "unavailable";
  let watchId: number | null = null;
  let wanted = false;
  let latestFix: LocationFix | null = null;
  let permissionChecked = false;

  function setStatus(next: LiveLocationStatus) {
    if (status === next) return;
    status = next;
    options.onStatusChange?.(next);
  }

  function clearActiveWatch() {
    if (watchId !== null && typeof navigator !== "undefined" && typeof navigator.geolocation?.clearWatch === "function") {
      try {
        navigator.geolocation.clearWatch(watchId);
      } catch {
        // Ignore clearWatch errors on mocked geolocation objects.
      }
    }
    watchId = null;
  }

  function attachWatch() {
    if (options.signal.aborted || !wanted || watchId !== null) return;
    if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
    if (typeof navigator === "undefined" || typeof navigator.geolocation?.watchPosition !== "function") {
      setStatus("unavailable");
      return;
    }
    setStatus(latestFix ? "watching" : "requesting");
    try {
      watchId = navigator.geolocation.watchPosition(
        (pos) => {
          if (options.signal.aborted) return;
          const fix: LocationFix = {
            latitude: pos.coords.latitude,
            longitude: pos.coords.longitude,
            accuracy: Number.isFinite(pos.coords.accuracy) && pos.coords.accuracy >= 0 ? pos.coords.accuracy : 10,
            timestamp: Number.isFinite(pos.timestamp) && pos.timestamp > 0 ? pos.timestamp : Date.now(),
          };
          latestFix = fix;
          setStatus("watching");
          options.onFix(fix);
        },
        (err) => {
          if (options.signal.aborted) return;
          if (err && typeof err.code === "number" && err.code === 1) {
            wanted = false;
            clearActiveWatch();
            setStatus("denied");
          }
        },
        { enableHighAccuracy: true, maximumAge: 5_000, timeout: 15_000 },
      );
    } catch {
      watchId = null;
      setStatus("unavailable");
    }
  }

  function start() {
    if (options.signal.aborted) return;
    if (typeof navigator === "undefined" || typeof navigator.geolocation?.watchPosition !== "function") {
      setStatus("unavailable");
      return;
    }
    wanted = true;
    attachWatch();
  }

  function stop() {
    wanted = false;
    clearActiveWatch();
    if (status === "watching" || status === "requesting") {
      setStatus("prompt");
    }
  }

  function checkPermissionAndAutoStart() {
    if (permissionChecked || options.signal.aborted) return;
    if (typeof navigator === "undefined" || typeof navigator.geolocation?.watchPosition !== "function") {
      setStatus("unavailable");
      return;
    }
    permissionChecked = true;
    const perms = (navigator as Navigator & {
      permissions?: {
        query?: (desc: PermissionDescriptor) => Promise<PermissionStatus>;
      };
    }).permissions;
    if (!perms || typeof perms.query !== "function") return;
    void perms
      .query({ name: "geolocation" as PermissionName })
      .then((permStatus) => {
        if (options.signal.aborted) return;
        const applyState = () => {
          if (options.signal.aborted) return;
          if (permStatus.state === "granted") {
            start();
          } else if (permStatus.state === "denied") {
            wanted = false;
            clearActiveWatch();
            setStatus("denied");
          }
        };
        applyState();
        const onChange = () => applyState();
        if (typeof permStatus.addEventListener === "function") {
          permStatus.addEventListener("change", onChange, { signal: options.signal });
        }
      })
      .catch(() => {
        // Older Safari or restricted browsers may reject permissions.query("geolocation").
      });
  }

  if (typeof document !== "undefined") {
    document.addEventListener(
      "visibilitychange",
      () => {
        if (options.signal.aborted) return;
        if (document.visibilityState === "hidden") {
          clearActiveWatch();
          return;
        }
        if (wanted) attachWatch();
      },
      { signal: options.signal },
    );
  }

  options.signal.addEventListener(
    "abort",
    () => {
      wanted = false;
      clearActiveWatch();
    },
    { once: true },
  );

  return {
    checkPermissionAndAutoStart,
    start,
    stop,
    getFix: () => latestFix,
    getStatus: () => status,
    setManualFix(fix: LocationFix) {
      latestFix = fix;
      options.onFix(fix);
    },
  };
}
