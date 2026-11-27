import { escapeText } from "./escape-text";
import type { PlayerErrorResolution, PlayerErrorTone } from "./player-errors";
import "./player-toast.css";

export type ToastLayoutMode = "page" | "game";

export interface PlayerToastController {
  show: (resolution: Pick<PlayerErrorResolution, "message" | "tone" | "dedupeKey">) => boolean;
  dismiss: (restoreFocus?: boolean) => void;
  clear: () => void;
  resetDedupe: (dedupeKey?: string) => void;
  setLayout: (mode: ToastLayoutMode, offsetForMapResult?: boolean) => void;
  isVisible: () => boolean;
  destroy: () => void;
}

const toneIcons: Record<PlayerErrorTone, string> = {
  warn: "▲",
  error: "◆",
  info: "●",
};

export function renderInlineAlert(message: string, tone: PlayerErrorTone = "warn", extraAttrs = ""): string {
  const attrs = extraAttrs ? ` ${extraAttrs}` : "";
  return `<p class="pt-inline-alert pt-inline-alert--${tone}" role="alert" aria-atomic="true"${attrs}><span class="pt-inline-alert-mark" aria-hidden="true">${toneIcons[tone]}</span><span>${escapeText(message)}</span></p>`;
}

type ToastMotionApi = Pick<
  typeof import("./game-motion"),
  "motionAllowed" | "animateToastIn" | "animateToastOut"
>;

let cachedToastMotion: ToastMotionApi | null = null;
let loadingToastMotion: Promise<ToastMotionApi | null> | null = null;

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

function loadToastMotion(): Promise<ToastMotionApi | null> {
  if (cachedToastMotion) return Promise.resolve(cachedToastMotion);
  if (!loadingToastMotion) {
    loadingToastMotion = import("./game-motion")
      .then((mod) => {
        cachedToastMotion = mod;
        return mod;
      })
      .catch(() => null);
  }
  return loadingToastMotion;
}

const AUTO_DISMISS_MS = 9000;
const DEDUPE_COOLDOWN_MS = 12_000;

export function createPlayerToast(options: {
  signal: AbortSignal;
  layout?: ToastLayoutMode;
  autoDismissMs?: number;
}): PlayerToastController {
  const { signal } = options;
  const autoDismissMs = options.autoDismissMs ?? AUTO_DISMISS_MS;
  const host = document.createElement("div");
  host.className = "pt-toast-host";
  host.dataset.testid = "player-toast-host";
  host.setAttribute("data-layout", options.layout ?? "page");
  document.body.appendChild(host);

  let activeToast: HTMLElement | null = null;
  let activeKey: string | null = null;
  let dismissTimer: number | undefined;
  let lastTriggerFocus: HTMLElement | null = null;
  const seenKeys = new Map<string, number>();

  function setLayout(mode: ToastLayoutMode, offsetForMapResult = false) {
    host.setAttribute("data-layout", mode);
    host.toggleAttribute("data-map-result", offsetForMapResult);
  }

  function clearTimer() {
    if (dismissTimer !== undefined) {
      window.clearTimeout(dismissTimer);
      dismissTimer = undefined;
    }
  }

  function clearGhosts() {
    host.querySelectorAll(".pt-toast-ghost").forEach((el) => el.remove());
  }

  function spawnExitGhost(source: HTMLElement) {
    if (!cachedToastMotion || !cachedToastMotion.motionAllowed()) return;
    const ghost = source.cloneNode(true) as HTMLElement;
    ghost.classList.add("pt-toast-ghost");
    ghost.removeAttribute("data-testid");
    ghost.removeAttribute("data-toast-key");
    ghost.setAttribute("aria-hidden", "true");
    ghost.style.pointerEvents = "none";
    ghost.querySelectorAll("[role]").forEach((node) => node.removeAttribute("role"));
    ghost.querySelectorAll("button").forEach((btn) => {
      btn.tabIndex = -1;
      btn.setAttribute("disabled", "");
    });
    host.appendChild(ghost);
    void cachedToastMotion.animateToastOut(ghost).finally(() => {
      ghost.remove();
    });
  }

  function removeToast(restoreFocus = false, animateExit = false) {
    clearTimer();
    const wasFocusedInside = Boolean(
      activeToast && document.activeElement && activeToast.contains(document.activeElement),
    );
    if (activeToast) {
      const closing = activeToast;
      activeToast = null;
      if (animateExit && !signal.aborted) {
        spawnExitGhost(closing);
      }
      closing.remove();
    }
    activeKey = null;
    if (restoreFocus && wasFocusedInside && lastTriggerFocus?.isConnected) {
      const target = lastTriggerFocus;
      if (!(target instanceof HTMLButtonElement && target.disabled)) {
        target.focus({ preventScroll: true });
      }
    }
  }

  function show(resolution: Pick<PlayerErrorResolution, "message" | "tone" | "dedupeKey">): boolean {
    if (signal.aborted) return false;
    const now = Date.now();
    const key = resolution.dedupeKey;
    if (activeKey === key && activeToast?.isConnected) {
      return false;
    }
    const lastSeen = seenKeys.get(key);
    if (lastSeen !== undefined && now - lastSeen < DEDUPE_COOLDOWN_MS) {
      return false;
    }
    seenKeys.set(key, now);
    if (document.activeElement instanceof HTMLElement && !host.contains(document.activeElement)) {
      lastTriggerFocus = document.activeElement;
    }
    clearGhosts();
    removeToast(false, false);

    const toastEl = document.createElement("div");
    toastEl.className = `pt-toast pt-toast--${resolution.tone}`;
    toastEl.dataset.testid = "player-toast";
    toastEl.dataset.toastKey = key;
    toastEl.dataset.toastTone = resolution.tone;

    const badge = document.createElement("span");
    badge.className = "pt-toast-badge";
    badge.setAttribute("aria-hidden", "true");
    badge.textContent = toneIcons[resolution.tone];

    const body = document.createElement("span");
    body.className = "pt-toast-body";
    body.setAttribute("role", "alert");
    body.setAttribute("aria-atomic", "true");
    body.textContent = resolution.message;

    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "pt-toast-dismiss";
    closeBtn.setAttribute("aria-label", "Tutup pemberitahuan");
    closeBtn.textContent = "×";
    closeBtn.addEventListener(
      "click",
      () => {
        removeToast(true, true);
      },
      { signal },
    );

    toastEl.append(badge, body, closeBtn);
    host.appendChild(toastEl);
    activeToast = toastEl;
    activeKey = key;

    if (!prefersReducedMotion()) {
      if (cachedToastMotion) {
        cachedToastMotion.animateToastIn(toastEl);
      } else {
        void loadToastMotion().then((mod) => {
          if (!signal.aborted && activeToast === toastEl && toastEl.isConnected) {
            mod?.animateToastIn(toastEl);
          }
        });
      }
    }

    if (autoDismissMs > 0) {
      dismissTimer = window.setTimeout(() => {
        removeToast(false, true);
      }, autoDismissMs);
    }
    return true;
  }

  function resetDedupe(dedupeKey?: string) {
    if (dedupeKey) seenKeys.delete(dedupeKey);
    else seenKeys.clear();
  }

  function destroy() {
    clearGhosts();
    removeToast(false, false);
    seenKeys.clear();
    host.remove();
  }

  document.addEventListener(
    "keydown",
    (event) => {
      if (event.key !== "Escape" || !activeToast) return;
      if (document.querySelector(".sg-room-menu[open]")) return;
      event.preventDefault();
      removeToast(true, true);
    },
    { signal },
  );

  signal.addEventListener("abort", destroy, { once: true });

  return {
    show,
    dismiss: (restoreFocus = true) => removeToast(restoreFocus, true),
    clear: () => {
      clearGhosts();
      removeToast(false, false);
    },
    resetDedupe,
    setLayout,
    isVisible: () => Boolean(activeToast?.isConnected),
    destroy,
  };
}
