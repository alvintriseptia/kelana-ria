export interface ActiveRoomSnapshot {
  code: string;
  stateRev: number;
}

export interface RoomEventBridgeOptions {
  signal: AbortSignal;
  getActiveRoom: () => ActiveRoomSnapshot | null;
  isBusy: () => boolean;
  onSync: () => Promise<void>;
  heartbeatMs?: number;
  fallbackPollMs?: number;
  reconnectBackoffMs?: number;
}

export interface RoomEventBridge {
  sync: () => void;
  markSynced: () => void;
  destroy: () => void;
  isConnected: () => boolean;
}

const DEFAULT_HEARTBEAT_MS = 15_000;
const DEFAULT_FALLBACK_POLL_MS = 3_000;
const DEFAULT_RECONNECT_BACKOFF_MS = 15_000;

export function createRoomEventBridge(options: RoomEventBridgeOptions): RoomEventBridge {
  const {
    signal,
    getActiveRoom,
    isBusy,
    onSync,
    heartbeatMs = DEFAULT_HEARTBEAT_MS,
    fallbackPollMs = DEFAULT_FALLBACK_POLL_MS,
    reconnectBackoffMs = DEFAULT_RECONNECT_BACKOFF_MS,
  } = options;

  let source: EventSource | null = null;
  let sourceRoomCode = "";
  let connected = false;
  let syncInFlight = false;
  let deferredRev = 0;
  let lastSyncAt = Date.now();
  let nextReconnectAt = 0;
  let networkOnline = typeof navigator === "undefined" ? true : navigator.onLine;
  const isOnline = () => networkOnline && navigator.onLine;

  function closeSource() {
    if (source) {
      source.close();
      source = null;
    }
    sourceRoomCode = "";
    connected = false;
  }

  function triggerSync() {
    if (signal.aborted || syncInFlight || isBusy() || document.hidden || !isOnline()) return;
    if (!getActiveRoom()) return;
    syncInFlight = true;
    lastSyncAt = Date.now();
    void onSync()
      .catch(() => {})
      .finally(() => {
        syncInFlight = false;
        if (signal.aborted) return;
        const active = getActiveRoom();
        if (!active) {
          closeSource();
          deferredRev = 0;
          return;
        }
        if (deferredRev > active.stateRev && !isBusy() && isOnline()) {
          deferredRev = 0;
          triggerSync();
        }
      });
  }

  function ensureStream(forceReconnect = false) {
    if (signal.aborted) {
      closeSource();
      return;
    }
    const active = getActiveRoom();
    if (!active || document.hidden || !isOnline() || typeof EventSource === "undefined") {
      closeSource();
      return;
    }
    if (source && sourceRoomCode === active.code) {
      if (source.readyState !== EventSource.CLOSED && !forceReconnect) {
        return;
      }
      closeSource();
    }
    if (!forceReconnect && Date.now() < nextReconnectAt) {
      return;
    }
    closeSource();
    sourceRoomCode = active.code;
    const url = `/api/rulebooks/rooms/${encodeURIComponent(active.code)}/events`;
    const es = new EventSource(url);
    source = es;

    es.addEventListener("open", () => {
      if (source !== es || signal.aborted) return;
      connected = true;
      nextReconnectAt = 0;
    });

    es.addEventListener("rev", (event) => {
      if (source !== es || signal.aborted) return;
      connected = true;
      nextReconnectAt = 0;
      let rev = 0;
      try {
        const parsed = JSON.parse((event as MessageEvent<string>).data) as { stateRev?: unknown };
        if (typeof parsed.stateRev === "number") rev = parsed.stateRev;
      } catch {
        return;
      }
      const current = getActiveRoom();
      if (!current || current.code !== active.code) {
        closeSource();
        return;
      }
      if (rev > current.stateRev) {
        if (isBusy() || syncInFlight) {
          deferredRev = Math.max(deferredRev, rev);
        } else {
          triggerSync();
        }
      }
    });

    es.addEventListener("error", () => {
      if (source !== es || signal.aborted) return;
      connected = false;
      if (es.readyState === EventSource.CLOSED) {
        closeSource();
        nextReconnectAt = Date.now() + reconnectBackoffMs;
      }
    });
  }

  function sync() {
    ensureStream(false);
    const active = getActiveRoom();
    if (active && deferredRev > active.stateRev && !isBusy() && !syncInFlight && isOnline()) {
      deferredRev = 0;
      triggerSync();
    }
  }

  function markSynced() {
    lastSyncAt = Date.now();
    sync();
  }

  window.addEventListener("online", () => {
    networkOnline = true;
    if (signal.aborted || document.hidden) return;
    nextReconnectAt = 0;
    ensureStream(true);
    triggerSync();
  }, { signal });

  window.addEventListener("offline", () => {
    networkOnline = false;
    closeSource();
  }, { signal });

  document.addEventListener("visibilitychange", () => {
    if (signal.aborted) return;
    if (document.hidden) {
      closeSource();
      return;
    }
    if (isOnline()) {
      nextReconnectAt = 0;
      ensureStream(true);
      triggerSync();
    }
  }, { signal });

  const pollTimer = window.setInterval(() => {
    if (signal.aborted || document.hidden || !isOnline()) return;
    const active = getActiveRoom();
    if (!active) {
      closeSource();
      return;
    }
    if (!source && Date.now() >= nextReconnectAt) {
      ensureStream(false);
    }
    const interval = connected ? heartbeatMs : fallbackPollMs;
    if (!isBusy() && !syncInFlight && Date.now() - lastSyncAt >= interval - 100) {
      triggerSync();
    }
  }, fallbackPollMs);

  function destroy() {
    window.clearInterval(pollTimer);
    closeSource();
  }

  signal.addEventListener("abort", destroy, { once: true });

  return {
    sync,
    markSynced,
    destroy,
    isConnected: () => connected,
  };
}
