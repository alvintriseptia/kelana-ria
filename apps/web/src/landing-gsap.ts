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

function clearPinSpacers(root: HTMLElement) {
  for (const spacer of root.querySelectorAll<HTMLElement>(".pin-spacer")) {
    const child = spacer.firstElementChild;
    if (child) spacer.replaceWith(child);
    else spacer.remove();
  }
}

function resetStoryBeatState(root: HTMLElement, activeIndex = 0) {
  const stage = root.querySelector<HTMLElement>("[data-story-stage]");
  if (stage) stage.dataset.activeBeat = String(activeIndex);
  const cards = root.querySelectorAll<HTMLElement>(".lp-step-card");
  cards.forEach((card, idx) => {
    card.dataset.beatActive = idx === activeIndex ? "true" : "false";
  });
  const nodes = root.querySelectorAll<HTMLElement>("[data-story-dot]");
  nodes.forEach((node, idx) => {
    node.dataset.beatActive = idx <= activeIndex ? "true" : "false";
    node.setAttribute("aria-current", idx === activeIndex ? "step" : "false");
  });
}

function setupPathDraw(path: SVGGeometryElement | null) {
  if (!path || typeof path.getTotalLength !== "function") return 0;
  const length = path.getTotalLength();
  if (!Number.isFinite(length) || length <= 0) return 0;
  path.style.strokeDasharray = `${length}`;
  path.style.strokeDashoffset = `${length}`;
  return length;
}

function setupStorytellingChapters(root: HTMLElement, canPin: boolean) {
  // Chapter 1: Hero route draw, pin pulses, pill entrance, and subtle scroll parallax
  // Keep hero headline, cover image, and primary CTAs immediately visible at opacity: 1 for LCP.
  const hero = root.querySelector<HTMLElement>(".lp-hero");
  if (hero) {
    const heroImg = hero.querySelector<HTMLElement>(".lp-hero-media img");
    const heroPill = hero.querySelector<HTMLElement>(".lp-hero-pill");
    const heroRoute = hero.querySelector<SVGGeometryElement>("[data-hero-route]");
    const heroPins = hero.querySelectorAll<SVGGElement>("[data-hero-pin]");
    const heroHalos = hero.querySelectorAll<SVGCircleElement>("[data-hero-halo]");

    const intro = gsap.timeline({ defaults: { ease: "power2.out" } });
    if (heroPill) {
      intro.fromTo(
        heroPill,
        { y: -8, scale: 0.94 },
        { y: 0, scale: 1, duration: 0.45, clearProps: "transform" },
        0,
      );
    }
    if (heroRoute) {
      const len = setupPathDraw(heroRoute);
      if (len > 0) {
        intro.to(heroRoute, { strokeDashoffset: 0, duration: 1.05, ease: "power2.inOut" }, 0.05);
      }
    }
    if (heroPins.length > 0) {
      intro.fromTo(
        heroPins,
        { scale: 0.72, transformOrigin: "center center" },
        { scale: 1, duration: 0.42, stagger: 0.14, ease: "back.out(2)" },
        0.2,
      );
    }
    if (heroHalos.length > 0) {
      gsap.to(heroHalos, {
        attr: { r: 15 },
        opacity: 0,
        duration: 1.8,
        stagger: 0.45,
        repeat: -1,
        ease: "power1.out",
      });
    }
    if (heroImg) {
      gsap.fromTo(
        heroImg,
        { yPercent: -3, scale: 1.05 },
        {
          yPercent: 6,
          scale: 1.09,
          ease: "none",
          scrollTrigger: {
            trigger: hero,
            start: "top top",
            end: "bottom top",
            scrub: 0.4,
            invalidateOnRefresh: true,
          },
        },
      );
    }
  }

  // Chapter 2: Guided "Cara Bermain" story beats with animated SVG route spine
  const storyStage = root.querySelector<HTMLElement>("[data-story-stage]");
  if (storyStage) {
    const spineFill = storyStage.querySelector<SVGGeometryElement>("[data-story-spine-fill]");
    const cards = Array.from(storyStage.querySelectorAll<HTMLElement>(".lp-step-card"));
    const beat0Route = storyStage.querySelector<SVGGeometryElement>("[data-beat-route]");
    const beat0Pin = storyStage.querySelector<SVGElement>("[data-beat-pin]");
    const beat1Radar = storyStage.querySelector<SVGElement>("[data-beat-radar]");
    const beat1Check = storyStage.querySelector<SVGElement>("[data-beat-check]");
    const beat2Cards = storyStage.querySelectorAll<SVGElement>("[data-beat-card]");

    resetStoryBeatState(root, 0);

    if (spineFill) setupPathDraw(spineFill);
    if (beat0Route) setupPathDraw(beat0Route);

    const storyTl = gsap.timeline({
      defaults: { ease: "power2.out" },
      scrollTrigger: canPin
        ? {
            trigger: storyStage,
            start: "top 16%",
            end: "+=260",
            pin: true,
            pinSpacing: true,
            anticipatePin: 1,
            scrub: 0.45,
            invalidateOnRefresh: true,
            onUpdate: (self) => {
              const idx = self.progress < 0.34 ? 0 : self.progress < 0.68 ? 1 : 2;
              resetStoryBeatState(root, idx);
            },
          }
        : {
            trigger: storyStage,
            start: "top 86%",
            end: "bottom 42%",
            scrub: 0.45,
            invalidateOnRefresh: true,
            onUpdate: (self) => {
              const idx = self.progress < 0.34 ? 0 : self.progress < 0.68 ? 1 : 2;
              resetStoryBeatState(root, idx);
            },
          },
    });

    if (spineFill) {
      storyTl.to(spineFill, { strokeDashoffset: 0, duration: 3, ease: "none" }, 0);
    }
    if (beat0Route) {
      storyTl.to(beat0Route, { strokeDashoffset: 0, duration: 0.8 }, 0.05);
    }
    if (beat0Pin) {
      storyTl.fromTo(
        beat0Pin,
        { y: -10, scale: 0.85, transformOrigin: "center bottom" },
        { y: 0, scale: 1, duration: 0.6, ease: "back.out(1.8)" },
        0.2,
      );
    }
    if (cards[1]) {
      storyTl.fromTo(cards[1], { y: 10 }, { y: 0, duration: 0.7 }, 0.9);
    }
    if (beat1Radar) {
      storyTl.fromTo(
        beat1Radar,
        { scale: 0.65, transformOrigin: "center center" },
        { scale: 1.08, duration: 0.7 },
        1.0,
      );
    }
    if (beat1Check) {
      storyTl.fromTo(
        beat1Check,
        { scale: 0.7, transformOrigin: "center center" },
        { scale: 1, duration: 0.5, ease: "back.out(2)" },
        1.25,
      );
    }
    if (cards[2]) {
      storyTl.fromTo(cards[2], { y: 12 }, { y: 0, duration: 0.7 }, 1.9);
    }
    if (beat2Cards.length > 0) {
      storyTl.fromTo(
        beat2Cards,
        { y: 8, scale: 0.9, transformOrigin: "center bottom" },
        { y: 0, scale: 1, duration: 0.6, stagger: 0.12, ease: "back.out(1.6)" },
        2.05,
      );
    }
  }

  // Chapter 3: Interactive Format Spotlight (Claim the City vs Hide & Seek)
  const spotlight = root.querySelector<HTMLElement>("[data-testid='landing-format-spotlight']");
  if (spotlight) {
    const formatCards = spotlight.querySelectorAll<HTMLElement>(".lp-format-card");
    const formatArts = spotlight.querySelectorAll<HTMLElement>(".lp-format-art");

    if (formatCards.length > 0) {
      gsap.fromTo(
        formatCards,
        { y: 20 },
        {
          y: 0,
          duration: 0.55,
          stagger: 0.12,
          ease: "power2.out",
          clearProps: "transform",
          scrollTrigger: {
            trigger: spotlight,
            start: "top 90%",
            fastScrollEnd: true,
            once: true,
          },
        },
      );
    }

    formatArts.forEach((art, idx) => {
      gsap.fromTo(
        art,
        { y: idx % 2 === 0 ? 8 : -6 },
        {
          y: idx % 2 === 0 ? -6 : 8,
          ease: "none",
          scrollTrigger: {
            trigger: art,
            start: "top bottom",
            end: "bottom top",
            scrub: 0.5,
            invalidateOnRefresh: true,
          },
        },
      );
    });

    const radarRing = spotlight.querySelector<SVGCircleElement>(".lp-format-card--seek .lp-format-art circle[stroke-dasharray]");
    if (radarRing) {
      gsap.to(radarRing, {
        scale: 1.12,
        transformOrigin: "center center",
        duration: 1.5,
        repeat: -1,
        yoyo: true,
        ease: "sine.inOut",
      });
    }
  }

  // Chapter 4: Studio Kreator blueprint route reveal
  const studio = root.querySelector<HTMLElement>("[data-testid='landing-studio-chapter']");
  if (studio) {
    const studioRoute = studio.querySelector<SVGGeometryElement>("[data-studio-route]");
    const studioNodes = studio.querySelectorAll<SVGCircleElement>("[data-studio-node]");
    const studioLen = setupPathDraw(studioRoute);

    const studioTl = gsap.timeline({
      scrollTrigger: {
        trigger: studio,
        start: "top 90%",
        fastScrollEnd: true,
        once: true,
      },
    });
    if (studioRoute && studioLen > 0) {
      studioTl.to(studioRoute, { strokeDashoffset: 0, duration: 0.9, ease: "power2.inOut" }, 0);
    }
    if (studioNodes.length > 0) {
      studioTl.fromTo(
        studioNodes,
        { scale: 0.6, transformOrigin: "center center" },
        { scale: 1, duration: 0.4, stagger: 0.14, ease: "back.out(2)" },
        0.2,
      );
    }
  }
}

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
      canPin: "(prefers-reduced-motion: no-preference) and (min-width: 360px)",
      compactMotion: "(prefers-reduced-motion: no-preference) and (max-width: 359px)",
    },
    (context) => {
      if (reverted || !root.isConnected) return;
      const reducedMotion = Boolean(context.conditions?.reduceMotion);
      const canPin = Boolean(context.conditions?.canPin);
      root.dataset.landingGsap = reducedMotion ? "reduced" : "active";

      if (reducedMotion) {
        clearPinSpacers(root);
        resetStoryBeatState(root, 0);
        setup?.({ gsap, ScrollTrigger, root, reducedMotion: true });
        return;
      }

      setupStorytellingChapters(root, canPin);
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
    clearPinSpacers(root);
    delete root.dataset.landingGsap;
  }

  return { refresh, revert };
}
