import type { LocationFix } from "@kelana-ria/contracts";

export function getLocation(): Promise<LocationFix> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error("Lokasi tidak tersedia di browser ini. Gunakan lokasi simulasi atau coba browser lain."));
      return;
    }
    navigator.geolocation.getCurrentPosition(({ coords, timestamp }) => resolve({
      latitude: coords.latitude, longitude: coords.longitude, accuracy: coords.accuracy, timestamp,
    }), error => reject(new Error(error.code === 1
      ? "Izin lokasi ditolak. Izinkan lokasi di pengaturan browser lalu coba lagi."
      : error.code === 3
        ? "Permintaan lokasi terlalu lama. Coba check-in lagi."
        : "Lokasi belum ditemukan. Coba pindah ke area terbuka lalu check-in lagi.")), {
      enableHighAccuracy: true, maximumAge: 0, timeout: 10_000,
    });
  });
}
