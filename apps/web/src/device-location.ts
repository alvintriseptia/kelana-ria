import type { LocationFix } from "@kelana-ria/contracts";

export type LocationErrorCode = "gps-denied" | "gps-timeout" | "gps-unavailable" | "gps-unsupported";

const locationMessages: Record<LocationErrorCode, string> = {
  "gps-unsupported": "Lokasi tidak tersedia di browser ini. Izinkan akses lokasi atau gunakan browser lain.",
  "gps-denied": "Izin lokasi ditolak. Aktifkan izin lokasi di pengaturan browser, lalu coba check-in lagi.",
  "gps-timeout": "Permintaan lokasi terlalu lama. Pastikan GPS aktif, lalu coba check-in lagi.",
  "gps-unavailable": "Lokasi belum ditemukan. Pindah ke area terbuka, lalu coba check-in lagi.",
};

export class LocationError extends Error {
  readonly code: LocationErrorCode;
  readonly causeDetail?: string;

  constructor(code: LocationErrorCode, causeDetail?: string) {
    super(locationMessages[code]);
    this.name = "LocationError";
    this.code = code;
    this.causeDetail = causeDetail;
  }
}

export function getLocation(): Promise<LocationFix> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new LocationError("gps-unsupported"));
      return;
    }
    navigator.geolocation.getCurrentPosition(({ coords, timestamp }) => resolve({
      latitude: coords.latitude, longitude: coords.longitude, accuracy: coords.accuracy, timestamp,
    }), error => {
      const code: LocationErrorCode = error.code === 1
        ? "gps-denied"
        : error.code === 3
          ? "gps-timeout"
          : "gps-unavailable";
      reject(new LocationError(code, typeof error.message === "string" ? error.message : undefined));
    }, {
      enableHighAccuracy: true, maximumAge: 0, timeout: 10_000,
    });
  });
}
