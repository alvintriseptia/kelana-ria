import { animate } from "motion";
import { motionAllowed, motionPresets } from "../game-motion";

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
