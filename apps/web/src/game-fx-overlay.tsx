import { signal, type Signal } from "@preact/signals";
import { animate } from "motion";
import { useEffect, useRef } from "preact/hooks";
import { motionAllowed, motionEaseOut, motionPresets } from "./game-motion";
import { mountPreact } from "./ui/mount";
import "./game-fx-overlay.css";

export type GameFxTone = "claim" | "lock" | "steal" | "zone" | "time" | "role" | "danger";

export type GameFxDeltaItem = {
  id: string;
  key: string;
  kind: "delta";
  label: string;
  tone: GameFxTone;
  xPct: number;
  yPct: number;
  durationMs: number;
};

export type GameFxStampItem = {
  id: string;
  key: string;
  kind: "stamp";
  label: string;
  badge: string;
  tone: GameFxTone;
  xPct: number;
  yPct: number;
  durationMs: number;
};

export type GameFxBannerItem = {
  id: string;
  key: string;
  kind: "banner";
  title: string;
  subtitle?: string;
  badge: string;
  tone: GameFxTone;
  durationMs: number;
};

export type GameFxItem = GameFxDeltaItem | GameFxStampItem | GameFxBannerItem;

export interface GameFxController {
  readonly items: Signal<GameFxItem[]>;
  emitDelta: (
    key: string,
    options: {
      label: string;
      tone?: GameFxTone;
      xPct?: number;
      yPct?: number;
      durationMs?: number;
    },
  ) => boolean;
  emitStamp: (
    key: string,
    options: {
      label: string;
      badge?: string;
      tone?: GameFxTone;
      xPct?: number;
      yPct?: number;
      durationMs?: number;
    },
  ) => boolean;
  emitBanner: (
    key: string,
    options: {
      title: string;
      subtitle?: string;
      badge?: string;
      tone?: GameFxTone;
      durationMs?: number;
    },
  ) => boolean;
  seedSeen: (keys: Iterable<string>) => void;
  hasSeen: (key: string) => boolean;
  clear: () => void;
  destroy: () => void;
}

const DEFAULT_BADGES: Record<GameFxTone, string> = {
  claim: "◆",
  lock: "■",
  steal: "⚡",
  zone: "★",
  time: "⏱",
  role: "◎",
  danger: "▲",
};

const MAX_ACTIVE_ITEMS = 6;

function clampPct(value: number | undefined, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.max(16, Math.min(84, value));
}

export function createGameFxController(): GameFxController {
  const items = signal<GameFxItem[]>([]);
  const seen = new Set<string>();
  const timers = new Map<string, number>();
  let nextId = 0;
  let destroyed = false;

  function removeItem(id: string) {
    const timer = timers.get(id);
    if (timer !== undefined) {
      window.clearTimeout(timer);
      timers.delete(id);
    }
    items.value = items.value.filter((item) => item.id !== id);
  }

  function enqueue(item: GameFxItem): boolean {
    if (destroyed) return false;
    if (seen.has(item.key)) return false;
    seen.add(item.key);
    if (!motionAllowed()) return false;

    const current = items.value;
    // Keep banners single-slot so rapid phase transitions replace cleanly instead of stacking walls.
    const trimmed =
      item.kind === "banner"
        ? current.filter((existing) => existing.kind !== "banner")
        : current.slice(-(MAX_ACTIVE_ITEMS - 1));
    items.value = [...trimmed, item];

    const timer = window.setTimeout(() => {
      removeItem(item.id);
    }, item.durationMs);
    timers.set(item.id, timer);
    return true;
  }

  function clear() {
    for (const timer of timers.values()) {
      window.clearTimeout(timer);
    }
    timers.clear();
    items.value = [];
  }

  return {
    items,
    emitDelta(key, options) {
      const tone = options.tone ?? "claim";
      return enqueue({
        id: `gfx-d-${++nextId}`,
        key,
        kind: "delta",
        label: options.label,
        tone,
        xPct: clampPct(options.xPct, 50),
        yPct: clampPct(options.yPct, 42),
        durationMs: options.durationMs ?? 1050,
      });
    },
    emitStamp(key, options) {
      const tone = options.tone ?? "lock";
      return enqueue({
        id: `gfx-s-${++nextId}`,
        key,
        kind: "stamp",
        label: options.label,
        badge: options.badge ?? DEFAULT_BADGES[tone],
        tone,
        xPct: clampPct(options.xPct, 50),
        yPct: clampPct(options.yPct, 38),
        durationMs: options.durationMs ?? 1200,
      });
    },
    emitBanner(key, options) {
      const tone = options.tone ?? "role";
      return enqueue({
        id: `gfx-b-${++nextId}`,
        key,
        kind: "banner",
        title: options.title,
        subtitle: options.subtitle,
        badge: options.badge ?? DEFAULT_BADGES[tone],
        tone,
        durationMs: options.durationMs ?? 1900,
      });
    },
    seedSeen(keys) {
      for (const key of keys) seen.add(key);
    },
    hasSeen(key) {
      return seen.has(key);
    },
    clear,
    destroy() {
      destroyed = true;
      clear();
      seen.clear();
    },
  };
}

function DeltaFxNode({ item }: { item: GameFxDeltaItem }) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || !motionAllowed()) return;
    const totalSec = Math.max(0.65, item.durationMs / 1000);
    const control = animate(
      el,
      {
        opacity: [0, 1, 1, 0],
        y: [14, -8, -28, -42],
        scale: [0.76, 1.08, 1, 0.94],
      },
      {
        duration: totalSec,
        times: [0, 0.18, 0.72, 1],
        ease: motionEaseOut,
      },
    );
    return () => {
      try {
        control.stop();
      } catch {
        // Ignore completed animation.
      }
    };
  }, [item.id]);

  return (
    <div
      ref={ref}
      class={`gfx-delta gfx-delta--${item.tone}`}
      data-fx-kind="delta"
      data-fx-key={item.key}
      style={{ left: `${item.xPct}%`, top: `${item.yPct}%` }}
    >
      {item.label}
    </div>
  );
}

function StampFxNode({ item }: { item: GameFxStampItem }) {
  const stampRef = useRef<HTMLDivElement | null>(null);
  const ringRef = useRef<HTMLSpanElement | null>(null);

  useEffect(() => {
    const el = stampRef.current;
    const ring = ringRef.current;
    if (!el || !motionAllowed()) return;
    const totalSec = Math.max(0.8, item.durationMs / 1000);
    const enter = animate(
      el,
      {
        opacity: [0, 1],
        scale: [0.68, 1],
        y: [8, 0],
      },
      motionPresets.bouncy,
    );
    const ringAnim = ring
      ? animate(
          ring,
          { scale: [0.95, 1.48], opacity: [0.65, 0] },
          { duration: 0.56, ease: motionEaseOut },
        )
      : null;
    const fadeTimer = window.setTimeout(() => {
      if (el.isConnected) {
        animate(el, { opacity: 0, y: -12, scale: 0.94 }, { duration: 0.22, ease: "easeIn" });
      }
    }, Math.max(450, (totalSec - 0.24) * 1000));

    return () => {
      window.clearTimeout(fadeTimer);
      try {
        enter.stop();
        ringAnim?.stop();
      } catch {
        // Ignore completed animation.
      }
    };
  }, [item.id]);

  return (
    <div
      ref={stampRef}
      class={`gfx-stamp gfx-stamp--${item.tone}`}
      data-fx-kind="stamp"
      data-fx-key={item.key}
      style={{ left: `${item.xPct}%`, top: `${item.yPct}%` }}
    >
      <span ref={ringRef} class="gfx-stamp-ring" />
      <span class="gfx-stamp-badge">{item.badge}</span>
      <span>{item.label}</span>
    </div>
  );
}

function BannerFxNode({ item }: { item: GameFxBannerItem }) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || !motionAllowed()) return;
    const enter = animate(
      el,
      {
        opacity: [0, 1],
        y: [-16, 0],
        scale: [0.92, 1],
      },
      motionPresets.dramatic,
    );
    const fadeTimer = window.setTimeout(() => {
      if (el.isConnected) {
        animate(el, { opacity: 0, y: -10, scale: 0.97 }, { duration: 0.22, ease: "easeIn" });
      }
    }, Math.max(700, item.durationMs - 240));
    return () => {
      window.clearTimeout(fadeTimer);
      try {
        enter.stop();
      } catch {
        // Ignore completed animation.
      }
    };
  }, [item.id]);

  return (
    <div
      ref={ref}
      class={`gfx-banner gfx-banner--${item.tone}`}
      data-fx-kind="banner"
      data-fx-key={item.key}
    >
      <span class="gfx-banner-badge">{item.badge}</span>
      <div class="gfx-banner-copy">
        <strong class="gfx-banner-title">{item.title}</strong>
        {item.subtitle && <span class="gfx-banner-sub">{item.subtitle}</span>}
      </div>
    </div>
  );
}

/**
 * Persistent SSE-safe overlay mounted once inside active game shells.
 * Strictly non-interactive (`pointer-events: none`, `aria-hidden="true"`) so
 * animations never steal taps, block HUD controls, or spam assistive tech.
 */
export function GameFxOverlay({ controller }: { controller: GameFxController }) {
  const active = controller.items.value;
  const banners = active.filter((item): item is GameFxBannerItem => item.kind === "banner");
  const floating = active.filter((item): item is GameFxDeltaItem | GameFxStampItem => item.kind !== "banner");

  return (
    <div class="gfx-overlay" data-testid="game-fx-overlay" aria-hidden="true">
      {banners.length > 0 && (
        <div class="gfx-banner-stack">
          {banners.map((item) => (
            <BannerFxNode key={item.id} item={item} />
          ))}
        </div>
      )}
      {floating.map((item) =>
        item.kind === "delta" ? (
          <DeltaFxNode key={item.id} item={item} />
        ) : (
          <StampFxNode key={item.id} item={item} />
        ),
      )}
    </div>
  );
}

/**
 * Imperative mount helper for attaching the persistent Preact GameFxOverlay once
 * inside a host element outside re-rendered HUD/dock subtrees.
 */
export function mountGameFxOverlay(container: HTMLElement): {
  controller: GameFxController;
  unmount: () => void;
} {
  const controller = createGameFxController();
  const unmountPreact = mountPreact(container, () => <GameFxOverlay controller={controller} />);
  return {
    controller,
    unmount() {
      controller.destroy();
      unmountPreact();
    },
  };
}
