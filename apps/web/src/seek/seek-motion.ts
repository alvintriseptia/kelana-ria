import { animate } from "motion";
import { motionAllowed, motionEaseOut, motionPresets } from "../game-motion";

// Cards in flight are decorative backs. The real cards remain keyboard operable.
export function animateSeekDraw(
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

export type SeekCardFlight = { start: DOMRect; kept: boolean };

export function animateSeekCardFlights(
  host: HTMLElement,
  target: HTMLElement | null,
  flights: SeekCardFlight[],
): () => void {
  if (!motionAllowed() || !flights.length) return () => {};
  const destination = target?.getBoundingClientRect();
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  let remaining = flights.length;
  const cleanups = flights.map(({ start, kept }, index) => {
    const ghost = document.createElement("span");
    ghost.className = "sg-card-flight sg-offer-back";
    ghost.setAttribute("aria-hidden", "true");
    ghost.textContent = "◆";
    Object.assign(ghost.style, {
      top: `${start.top}px`, left: `${start.left}px`,
      width: `${start.width}px`, height: `${start.height}px`,
    });
    host.append(ghost);
    const x = kept && destination ? destination.left + (destination.width - start.width) / 2 - start.left : 0;
    const y = kept && destination ? destination.top + (destination.height - start.height) / 2 - start.top : 22;
    const control = animate(ghost, { x, y, scale: kept ? 0.22 : 0.86, opacity: 0 }, {
      ...motionPresets.tactile, delay: index * 0.03,
    });
    const remove = () => {
      ghost.remove();
      if (--remaining === 0) reduced.removeEventListener("change", stop);
    };
    void control.finished.then(remove, remove);
    return () => { control.stop(); ghost.remove(); };
  });
  const stop = () => {
    reduced.removeEventListener("change", stop);
    cleanups.forEach(cleanup => cleanup());
  };
  reduced.addEventListener("change", stop);
  return stop;
}
