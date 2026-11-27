import type { GeoCoordinate, LocationFix } from "@kelana-ria/contracts";
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
