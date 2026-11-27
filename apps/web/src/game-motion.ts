import { animate, press, spring, stagger, type AnimationPlaybackControlsWithThen } from "motion";

export type MotionPresetName = "snappy" | "tactile" | "bouncy" | "dramatic" | "sheet";

export type SpringPreset = {
  readonly type: "spring";
  readonly visualDuration: number;
  readonly bounce: number;
};

/**
 * Shared game-feel spring presets for Kelana Ria's interactive surfaces.
 * Keep durations short and interruptible so rapid mobile taps never feel sluggish.
 */
export const motionPresets: Record<MotionPresetName, SpringPreset> = {
  snappy: { type: "spring", visualDuration: 0.2, bounce: 0.14 },
  tactile: { type: "spring", visualDuration: 0.28, bounce: 0.24 },
  bouncy: { type: "spring", visualDuration: 0.34, bounce: 0.38 },
  dramatic: { type: "spring", visualDuration: 0.44, bounce: 0.26 },
  sheet: { type: "spring", visualDuration: 0.28, bounce: 0.08 },
};

export const motionEaseOut = [0.22, 1, 0.36, 1] as const;

/**
 * Creates a Motion spring generator for custom numeric/keyframe animations.
 */
export function createSpring(preset: MotionPresetName = "tactile") {
  const { visualDuration, bounce } = motionPresets[preset];
  return spring(visualDuration, bounce);
}

export type GameMotionKind = "claim" | "lock" | "steal" | "update" | "role";

type CancelHandle = { stop: () => void };

const activeControls = new WeakMap<Element, CancelHandle>();

function registerControl(element: Element, control: AnimationPlaybackControlsWithThen): CancelHandle {
  activeControls.get(element)?.stop();
  const handle: CancelHandle = {
    stop() {
      try {
        control.stop();
      } catch {
        // Ignore already-finished animation teardown.
      }
    },
  };
  activeControls.set(element, handle);
  void control.finished
    .catch(() => undefined)
    .finally(() => {
      if (activeControls.get(element) === handle) {
        activeControls.delete(element);
      }
    });
  return handle;
}

export function stopElementMotion(element: Element | null | undefined): void {
  if (!element) return;
  activeControls.get(element)?.stop();
  activeControls.delete(element);
}

export function motionAllowed(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

const gameMotionSpecs: Record<
  GameMotionKind,
  {
    keyframes: Record<string, string[] | number[]>;
    duration: number;
  }
> = {
  claim: {
    keyframes: {
      scale: [0.92, 1.07, 1],
      boxShadow: ["0 0 0 2px #087866", "0 0 0 12px rgba(8, 120, 102, 0)"],
    },
    duration: 0.44,
  },
  lock: {
    keyframes: {
      scale: [0.88, 1.1, 1],
      boxShadow: ["0 0 0 3px #31552b", "0 0 0 14px rgba(49, 85, 43, 0)"],
    },
    duration: 0.48,
  },
  steal: {
    keyframes: {
      scale: [0.9, 1.12, 1],
      rotate: [0, -3, 2, 0],
      boxShadow: ["0 0 0 3px #a04a18", "0 0 0 15px rgba(160, 74, 24, 0)"],
    },
    duration: 0.5,
  },
  update: {
    keyframes: {
      scale: [0.97, 1.02, 1],
      backgroundColor: ["#daed9f", "rgba(218, 237, 159, 0)"],
    },
    duration: 0.46,
  },
  role: {
    keyframes: {
      scale: [0.92, 1.06, 1],
      boxShadow: ["0 0 0 2px #075c54", "0 0 0 12px rgba(7, 92, 84, 0)"],
    },
    duration: 0.46,
  },
};

/**
 * Sequence-deduped committed-event feedback for pins, badges, and status panels.
 * Writes `data-game-motion="${kind}:${sequence}"` only when motion is allowed so
 * SSE updates/reconnects never replay the same event and reduced-motion stays quiet.
 */
export function playGameMotion(
  element: HTMLElement | null,
  kind: GameMotionKind,
  sequence: number,
): void {
  if (!element || !motionAllowed()) return;
  const key = `${kind}:${sequence}`;
  if (element.dataset.gameMotion === key) return;
  element.dataset.gameMotion = key;
  const spec = gameMotionSpecs[kind];
  const control = animate(element, spec.keyframes, {
    duration: spec.duration,
    ease: motionEaseOut,
  });
  registerControl(element, control);
}

/**
 * Tactile press-down and spring release for game cards, buttons, and chips.
 * Returns a cleanup callback suitable for Preact `useEffect`.
 */
export function attachPress(
  target: Element | Element[] | NodeListOf<Element> | null | undefined,
  options?: { scale?: number; preset?: MotionPresetName },
): () => void {
  if (!target || !motionAllowed()) return () => undefined;
  const elements = target instanceof Element ? [target] : Array.from(target);
  if (elements.length === 0) return () => undefined;
  const downScale = options?.scale ?? 0.965;
  const preset = motionPresets[options?.preset ?? "snappy"];
  return press(elements, (el) => {
    const down = animate(el, { scale: downScale }, { duration: 0.09, ease: "easeOut" });
    registerControl(el, down);
    return () => {
      const up = animate(el, { scale: 1 }, preset);
      registerControl(el, up);
    };
  });
}

/**
 * Staggered spring entrance for lists, cards, timeline moments, and fact tiles.
 */
export function animateStaggerIn(
  elements: Iterable<Element> | NodeListOf<Element> | null | undefined,
  options?: {
    delayStep?: number;
    startDelay?: number;
    offsetY?: number;
    fromScale?: number;
    preset?: MotionPresetName;
  },
): () => void {
  if (!elements || !motionAllowed()) return () => undefined;
  const list = Array.from(elements).filter((el): el is HTMLElement => el instanceof HTMLElement);
  if (list.length === 0) return () => undefined;
  const offsetY = options?.offsetY ?? 10;
  const fromScale = options?.fromScale ?? 0.97;
  const preset = motionPresets[options?.preset ?? "tactile"];
  const control = animate(
    list,
    {
      opacity: [0, 1],
      y: [offsetY, 0],
      scale: [fromScale, 1],
    },
    {
      ...preset,
      delay: stagger(options?.delayStep ?? 0.045, { startDelay: options?.startDelay ?? 0 }),
    },
  );
  return () => {
    try {
      control.stop();
    } catch {
      // Ignore finished animations.
    }
  };
}

/**
 * Quick spring pop for checkmarks, team chips, lock pins, and readiness pills.
 */
export function animatePop(
  element: HTMLElement | null | undefined,
  options?: { fromScale?: number; preset?: MotionPresetName },
): () => void {
  if (!element || !motionAllowed()) return () => undefined;
  const preset = motionPresets[options?.preset ?? "bouncy"];
  const control = animate(
    element,
    { scale: [options?.fromScale ?? 0.86, 1] },
    preset,
  );
  const handle = registerControl(element, control);
  return () => handle.stop();
}

/**
 * Stormbound-inspired staggered card deal into an offer drawer or hand.
 */
export function animateCardDeal(
  elements: Iterable<Element> | NodeListOf<Element> | null | undefined,
  options?: { delayStep?: number },
): () => void {
  if (!elements || !motionAllowed()) return () => undefined;
  const list = Array.from(elements).filter((el): el is HTMLElement => el instanceof HTMLElement);
  if (list.length === 0) return () => undefined;
  const control = animate(
    list,
    {
      opacity: [0.35, 1],
      x: [-16, 0],
      y: [-10, 0],
      scale: [0.88, 1],
    },
    {
      ...motionPresets.tactile,
      delay: stagger(options?.delayStep ?? 0.055),
    },
  );
  return () => {
    try {
      control.stop();
    } catch {
      // Ignore finished animations.
    }
  };
}

/**
 * Tactile 2.5D card flip reveal for draw offers and practice cards.
 */
export function animateCardFlip(element: HTMLElement | null | undefined): () => void {
  if (!element || !motionAllowed()) return () => undefined;
  const control = animate(
    element,
    {
      transformPerspective: 520,
      rotateY: [-76, 0],
      scale: [0.94, 1],
      opacity: [0.45, 1],
    },
    motionPresets.tactile,
  );
  const handle = registerControl(element, control);
  return () => handle.stop();
}

/**
 * Short horizontal error shake for invalid inputs, out-of-range check-ins, or wrong answers.
 */
export function animateShake(element: HTMLElement | null | undefined): () => void {
  if (!element || !motionAllowed()) return () => undefined;
  const control = animate(
    element,
    { x: [0, -6, 6, -4, 4, -2, 0] },
    { duration: 0.32, ease: "easeOut" },
  );
  const handle = registerControl(element, control);
  return () => handle.stop();
}

/**
 * Interruptible spring slide/scale entrance for dialogs, bottom sheets, and step scenes.
 */
export function animateSheetIn(
  element: HTMLElement | null | undefined,
  options?: { offsetY?: number; fromScale?: number; preset?: MotionPresetName },
): () => void {
  if (!element || !motionAllowed()) return () => undefined;
  const control = animate(
    element,
    {
      opacity: [0, 1],
      y: [options?.offsetY ?? 12, 0],
      scale: [options?.fromScale ?? 0.98, 1],
    },
    motionPresets[options?.preset ?? "sheet"],
  );
  const handle = registerControl(element, control);
  return () => handle.stop();
}

/**
 * Crisp spring entrance for non-blocking player toasts.
 */
export function animateToastIn(element: HTMLElement | null | undefined): () => void {
  if (!element || !motionAllowed()) return () => undefined;
  const control = animate(
    element,
    {
      opacity: [0.75, 1],
      y: [-10, 0],
      scale: [0.96, 1],
    },
    motionPresets.snappy,
  );
  const handle = registerControl(element, control);
  return () => handle.stop();
}

/**
 * Swift visual exit for a detached, aria-hidden toast ghost so live DOM dismissal
 * remains instantaneous for keyboard & assistive-tech workflows.
 */
export function animateToastOut(element: HTMLElement | null | undefined): Promise<void> {
  if (!element || !motionAllowed()) return Promise.resolve();
  const control = animate(
    element,
    {
      opacity: [1, 0],
      y: [0, -8],
      scale: [1, 0.96],
    },
    { duration: 0.14, ease: "easeIn" },
  );
  registerControl(element, control);
  return control.finished.then(() => undefined).catch(() => undefined);
}

/**
 * Smooth numeric count-up for match recap scores and durations.
 * Renders the final formatted value immediately under prefers-reduced-motion.
 */
export function animateCountUp(
  element: HTMLElement | null | undefined,
  from: number,
  to: number,
  format: (value: number) => string,
  durationSec = 0.44,
): () => void {
  if (!element) return () => undefined;
  if (!motionAllowed() || from === to) {
    element.textContent = format(to);
    return () => undefined;
  }
  element.textContent = format(from);
  const control = animate(from, to, {
    duration: durationSec,
    ease: motionEaseOut,
    onUpdate: (latest) => {
      if (element.isConnected) {
        element.textContent = format(latest);
      }
    },
  });
  void control.finished
    .then(() => {
      if (element.isConnected) element.textContent = format(to);
    })
    .catch(() => undefined);
  return () => {
    try {
      control.stop();
    } catch {
      // Ignore finished animations.
    }
  };
}
