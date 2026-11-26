export const defaultSimulatedLocation = import.meta.env.DEV;

const YOUTUBE_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;
const YOUTUBE_HOSTS = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "music.youtube.com",
  "youtube-nocookie.com",
  "www.youtube-nocookie.com",
]);
const DEMO_VIDEO_CACHE_KEY = "kelana-demo-video-id";

type RuntimeHealth = {
  allowSimulatedLocation?: boolean;
  demoVideoYoutubeId?: string | null;
};

let cachedHealth: RuntimeHealth | undefined;
let inflightHealth: Promise<RuntimeHealth | undefined> | undefined;

export function parseYoutubeVideoId(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const trimmed = input.trim();
  if (!trimmed) return null;
  if (YOUTUBE_ID_PATTERN.test(trimmed)) return trimmed;
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
  const host = parsed.hostname.toLowerCase();
  const segments = parsed.pathname.split("/").filter(Boolean);
  let candidate: string | null = null;
  if (host === "youtu.be") {
    candidate = segments.length === 1 ? segments[0] : null;
  } else if (YOUTUBE_HOSTS.has(host)) {
    if (parsed.pathname === "/watch") {
      candidate = parsed.searchParams.get("v");
    } else if (
      segments.length === 2 &&
      (segments[0] === "shorts" || segments[0] === "embed" || segments[0] === "live")
    ) {
      candidate = segments[1];
    }
  }
  return candidate && YOUTUBE_ID_PATTERN.test(candidate) ? candidate : null;
}

export function getBuildTimeDemoVideoYoutubeId(): string | null {
  return parseYoutubeVideoId(import.meta.env.VITE_DEMO_VIDEO_YOUTUBE_ID);
}

export function getCachedDemoVideoYoutubeId(): string | null {
  if (cachedHealth !== undefined) {
    return parseYoutubeVideoId(cachedHealth.demoVideoYoutubeId) ?? getBuildTimeDemoVideoYoutubeId();
  }
  try {
    const stored = sessionStorage.getItem(DEMO_VIDEO_CACHE_KEY);
    const parsed = parseYoutubeVideoId(stored);
    if (parsed) return parsed;
  } catch {
    // Ignore storage errors in private browsing.
  }
  return getBuildTimeDemoVideoYoutubeId();
}

function saveDemoVideoCache(id: string | null) {
  try {
    if (id) sessionStorage.setItem(DEMO_VIDEO_CACHE_KEY, id);
    else sessionStorage.removeItem(DEMO_VIDEO_CACHE_KEY);
  } catch {
    // Ignore storage errors.
  }
}

async function fetchRuntimeHealth(signal: AbortSignal): Promise<RuntimeHealth | undefined> {
  if (cachedHealth !== undefined) return cachedHealth;
  if (!inflightHealth) {
    inflightHealth = (async () => {
      try {
        const response = await fetch("/api/health", {
          cache: "no-store",
          headers: { Accept: "application/json" },
          signal: AbortSignal.any([signal, AbortSignal.timeout(4_000)]),
        });
        if (response.ok) {
          const data = (await response.json()) as RuntimeHealth;
          cachedHealth = data;
          saveDemoVideoCache(parseYoutubeVideoId(data.demoVideoYoutubeId));
          return data;
        }
      } catch {
        // Offline or unreachable defaults to cached / build-time fallback.
      }
      return undefined;
    })().finally(() => {
      inflightHealth = undefined;
    });
  }
  return inflightHealth;
}

export async function isSimulatedLocationAllowed(signal: AbortSignal): Promise<boolean> {
  if (import.meta.env.DEV) return true;
  const health = await fetchRuntimeHealth(signal);
  return Boolean(health?.allowSimulatedLocation);
}

export async function resolveDemoVideoYoutubeId(signal: AbortSignal): Promise<string | null> {
  const health = await fetchRuntimeHealth(signal);
  if (health !== undefined) {
    return parseYoutubeVideoId(health.demoVideoYoutubeId) ?? getBuildTimeDemoVideoYoutubeId();
  }
  return getCachedDemoVideoYoutubeId();
}
