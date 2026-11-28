import { animate } from "motion";
import type { ComponentChildren } from "preact";
import { useLayoutEffect, useRef } from "preact/hooks";
import { animatePop, motionAllowed, motionEaseOut, motionPresets } from "../game-motion";

// Cards in flight are decorative backs. The real cards remain keyboard operable.
function animateRewardDraw(
  back: HTMLElement,
  face: HTMLElement,
  source: HTMLElement | null,
  index: number,
): () => void {
  if (!motionAllowed()) return () => {};
  const target = back.getBoundingClientRect();
  const origin = source?.getBoundingClientRect();
  const x = origin ? origin.left + (origin.width - target.width) / 2 - target.left : 0;
  const y = origin ? origin.top + (origin.height - target.height) / 2 - target.top : 22;
  const delay = index * 0.055;
  const deal = 0.23;
  const flip = 0.14;
  const control = animate([
    [back, { x: [x, 0], y: [y, 0], scale: [0.55, 1] }, { ...motionPresets.tactile, duration: deal, at: delay }],
    [back, { transformPerspective: 520, rotateY: [0, 90], opacity: [1, 0] }, { duration: flip, at: delay + deal, ease: "easeIn" }],
    [face, { opacity: [0, 0] }, { duration: delay + deal + flip, at: 0 }],
    [face, { transformPerspective: 520, rotateY: [-90, 0], opacity: [0, 1] }, { duration: flip, ease: motionEaseOut, at: delay + deal + flip }],
  ]);
  return () => {
    control.stop();
    face.style.removeProperty("opacity");
    face.style.removeProperty("transform");
    back.style.removeProperty("opacity");
    back.style.removeProperty("transform");
  };
}

export function RewardDrawCard({ children, index, deal, selected, sourcePanel, onPresented }: {
  children: ComponentChildren;
  index: number;
  deal: number | string | null;
  selected: boolean;
  sourcePanel: "hand" | "cards";
  onPresented?: () => void;
}) {
  const offer = useRef<HTMLDivElement>(null);
  const face = useRef<HTMLDivElement>(null);
  const back = useRef<HTMLSpanElement>(null);
  const previousSelection = useRef(selected);
  const initialDeal = useRef(deal).current;

  useLayoutEffect(() => {
    if (index === 0) onPresented?.();
    const node = offer.current;
    if (initialDeal === null || !face.current || !back.current || !node || !motionAllowed()) return;
    node.dataset.gameMotion = `draw:${initialDeal}`;
    const source = node.closest(".sg-dock")?.querySelector<HTMLElement>(`[data-panel="${sourcePanel}"]`) ?? null;
    const stop = animateRewardDraw(back.current, face.current, source, index);
    const preference = matchMedia("(prefers-reduced-motion: reduce)");
    preference.addEventListener("change", stop, { once: true });
    return () => {
      preference.removeEventListener("change", stop);
      stop();
    };
  }, []);

  useLayoutEffect(() => {
    if (selected === previousSelection.current) return;
    previousSelection.current = selected;
    return animatePop(offer.current, { fromScale: selected ? 0.94 : 1.03, preset: "bouncy" });
  }, [selected]);

  return <div ref={offer} class="sg-offer">
    <div ref={face} class="sg-offer-face">{children}</div>
    <span ref={back} hidden={initialDeal === null} class="sg-offer-back" aria-hidden="true">◆</span>
  </div>;
}
