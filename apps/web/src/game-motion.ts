const motions = {
  claim: [
    { boxShadow: "0 0 0 2px #087866" },
    { boxShadow: "0 0 0 11px #08786600" },
  ],
  lock: [
    { boxShadow: "0 0 0 3px #31552b" },
    { boxShadow: "0 0 0 12px #31552b00" },
  ],
  steal: [
    { boxShadow: "0 0 0 3px #a04a18" },
    { boxShadow: "0 0 0 13px #a04a1800" },
  ],
  update: [
    { backgroundColor: "#daed9f" },
    { backgroundColor: "#daed9f00" },
  ],
  role: [
    { boxShadow: "0 0 0 2px #075c54" },
    { boxShadow: "0 0 0 10px #075c5400" },
  ],
} satisfies Record<string, Keyframe[]>;

const active = new WeakMap<HTMLElement, Animation>();

export function motionAllowed(): boolean {
  return !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function playGameMotion(element: HTMLElement | null, kind: keyof typeof motions, sequence: number) {
  if (!element || !motionAllowed() || !element.animate) return;
  const key = `${kind}:${sequence}`;
  if (element.dataset.gameMotion === key) return;
  active.get(element)?.cancel();
  element.dataset.gameMotion = key;
  active.set(element, element.animate(motions[kind], { duration: 480, easing: "ease-out" }));
}
