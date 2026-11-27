import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

let registered = false;

function ensurePluginsRegistered() {
  if (registered) return;
  gsap.registerPlugin(ScrollTrigger);
  registered = true;
}

export type LandingGsapContextArgs = {
  gsap: typeof gsap;
  ScrollTrigger: typeof ScrollTrigger;
  root: HTMLElement;
  reducedMotion: boolean;
};

export type LandingGsapSetup = (args: LandingGsapContextArgs) => void;

export type LandingGsapHandle = {
  refresh: () => void;
  revert: () => void;
};

export function mountLandingGsap(
  root: HTMLElement,
  setup?: LandingGsapSetup,
): LandingGsapHandle {
  ensurePluginsRegistered();

  let reverted = false;
  let refreshRaf = 0;

  const ctx = gsap.context(() => {}, root);
  const mm = gsap.matchMedia(root);

  mm.add(
    {
      reduceMotion: "(prefers-reduced-motion: reduce)",
      allowMotion: "(prefers-reduced-motion: no-preference)",
    },
    (context) => {
      if (reverted || !root.isConnected) return;
      const reducedMotion = Boolean(context.conditions?.reduceMotion);
      root.dataset.landingGsap = reducedMotion ? "reduced" : "active";

      if (reducedMotion) {
        for (const spacer of root.querySelectorAll<HTMLElement>(".pin-spacer")) {
          const child = spacer.firstElementChild;
          if (child) spacer.replaceWith(child);
          else spacer.remove();
        }
        setup?.({ gsap, ScrollTrigger, root, reducedMotion: true });
        return;
      }

      setup?.({ gsap, ScrollTrigger, root, reducedMotion: false });
    },
  );

  function refresh() {
    if (reverted || !root.isConnected) return;
    if (refreshRaf) cancelAnimationFrame(refreshRaf);
    refreshRaf = requestAnimationFrame(() => {
      refreshRaf = 0;
      if (reverted || !root.isConnected) return;
      ScrollTrigger.refresh();
    });
  }

  function revert() {
    if (reverted) return;
    reverted = true;
    if (refreshRaf) {
      cancelAnimationFrame(refreshRaf);
      refreshRaf = 0;
    }
    mm.revert();
    ctx.revert();
    for (const trigger of ScrollTrigger.getAll()) {
      const triggerEl = trigger.trigger;
      const pinEl = trigger.pin;
      const insideRoot =
        (triggerEl instanceof Node && root.contains(triggerEl)) ||
        (pinEl instanceof Node && root.contains(pinEl));
      if (insideRoot) {
        trigger.kill(true);
      }
    }
    for (const spacer of root.querySelectorAll<HTMLElement>(".pin-spacer")) {
      const child = spacer.firstElementChild;
      if (child) spacer.replaceWith(child);
      else spacer.remove();
    }
    delete root.dataset.landingGsap;
  }

  return { refresh, revert };
}
