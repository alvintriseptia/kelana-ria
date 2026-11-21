export const defaultSimulatedLocation = import.meta.env.DEV;

let cachedAllowance: boolean | undefined;

export async function isSimulatedLocationAllowed(signal: AbortSignal): Promise<boolean> {
  if (import.meta.env.DEV) return true;
  if (cachedAllowance !== undefined) return cachedAllowance;
  try {
    const response = await fetch("/api/health", {
      cache: "no-store",
      headers: { Accept: "application/json" },
      signal: AbortSignal.any([signal, AbortSignal.timeout(4_000)]),
    });
    if (response.ok) {
      const data = (await response.json()) as { allowSimulatedLocation?: boolean };
      cachedAllowance = Boolean(data.allowSimulatedLocation);
      return cachedAllowance;
    }
  } catch {
    // Offline or unreachable defaults to production behavior (real GPS only).
  }
  return false;
}
