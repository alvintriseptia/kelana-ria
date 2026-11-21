import type { MapConfig } from "@kelana-ria/contracts";

export const offlineMapConfig: MapConfig = {
  mode: "offline-vector",
  styleUrl: null,
  attribution: "Geoapify · © OpenStreetMap contributors · Transjakarta GTFS (CC BY 4.0)",
  mapLibreLicenseUrl: "/licenses/maplibre-gl.txt",
  tileCreditCost: 0.25,
  routingCreditCost: 1,
  freeDailyCredits: 3000,
};

export async function fetchMapConfig(signal: AbortSignal): Promise<MapConfig> {
  try {
    const response = await fetch("/api/map/config", {
      cache: "no-store",
      headers: { Accept: "application/json" },
      signal: AbortSignal.any([signal, AbortSignal.timeout(4_000)]),
    });
    if (response.ok) return (await response.json()) as MapConfig;
  } catch {
    // Offline or unconfigured falls back cleanly to offline-vector / schematic.
  }
  return offlineMapConfig;
}
