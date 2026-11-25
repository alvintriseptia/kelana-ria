import { loadFont } from "@remotion/fonts";
import { useEffect, useState } from "react";
import { staticFile, useDelayRender } from "remotion";

/**
 * Authoritative Kelana Ria brand identity tokens.
 * Sourced directly from assets/brands/README.md and assets/brands/source-reference/*.css.
 */
export const BRAND_COLORS = {
  // Shell and masthead (style.css)
  paper: "#F7F6ED",
  card: "#FFFEF7",
  ink: "#153D34",
  muted: "#52675C",
  line: "#C4CEBB",
  yellow: "#FFCE55",

  // Logo artwork
  logoDarkGreen: "#133E35",

  // Catalog (rulebook-catalog.css)
  forest: "#104A40",
  mint: "#E5F2E5",
  catalogLine: "#87AA9B",
  lime: "#D9F181",

  // Game UI (rulebook-seek-play.css & rulebook-claim-play.css)
  uiInk: "#122F29",
  teal: "#075C54",
  sky: "#BCE7F0",
  cloud: "#F6FBF7",
  leaf: "#C5EE69",
  edge: "#8CAB9D",
  tacticCardBg: "#EAF4EE",
  scoreBg: "#E6F2E8",

  // Claim team treatments (rulebook-claim-play.css)
  greenTeamBg: "#075C54",
  greenTeamText: "#FFFFFF",
  yellowTeamBg: "#F4D572",
  yellowTeamText: "#3C2D06",

  // Opportunity / failure notice & pin tokens (rulebook-claim-play.css)
  noticeBg: "#FBECDC",
  noticeAccent: "#B65C35",
  pinUnclaimed: "#475954",
  pinSelectedRing: "#EAAA34",
  pinEligibleRing: "#A8DB34",
} as const;

export const BRAND_FONTS = {
  display: '"Barlow Condensed", sans-serif',
  body: '"DM Sans", sans-serif',
} as const;

export const BRAND_COPY = {
  brandName: "Kelana Ria",
  modeName: "Claim the City",
  tagline: "Mainkan kotamu.",
  closingCta: "SEGERA HADIR",
  publicOrigin: "https://kelanaria.id",
  mapAttributionShort:
    "Peta: OpenFreeMap · © OpenMapTiles · © OpenStreetMap contributors",
  mapAttributionFull:
    "Peta vektor langsung · OpenFreeMap · © OpenMapTiles · © OpenStreetMap contributors · Transjakarta GTFS (CC BY 4.0) · MapLibre GL JS",
} as const;

/**
 * Shared Jakarta Playground tactile card styling helpers.
 */
export const EDITORIAL_SHADOWS = {
  inkOffset: "6px 6px 0px #153D34",
  greenOffset: "6px 6px 0px #075C54",
  subtlePrint: "0 10px 28px rgba(18, 47, 41, 0.18)",
  photoPrint: "0 14px 36px rgba(18, 47, 41, 0.22)",
} as const;

let brandFontsPromise: Promise<void> | null = null;

export const ensureBrandFontsLoaded = (): Promise<void> => {
  if (!brandFontsPromise) {
    brandFontsPromise = Promise.all([
      loadFont({
        family: "Barlow Condensed",
        url: staticFile("brands/fonts/barlow-condensed-latin-700-normal.woff2"),
        format: "woff2",
        weight: "700",
        style: "normal",
        display: "block",
      }),
      loadFont({
        family: "DM Sans",
        url: staticFile("brands/fonts/dm-sans-latin-wght-normal.woff2"),
        format: "woff2",
        weight: "100 1000",
        style: "normal",
        display: "block",
      }),
    ]).then(() => undefined);
  }
  return brandFontsPromise;
};

/**
 * Blocks Remotion frame rendering until official local Kelana Ria fonts finish loading.
 */
export const useBrandFonts = (): void => {
  const { delayRender, continueRender, cancelRender } = useDelayRender();
  const [handle] = useState(() => delayRender("Loading Kelana Ria brand fonts"));

  useEffect(() => {
    let settled = false;
    ensureBrandFontsLoaded()
      .then(() => {
        if (!settled) {
          settled = true;
          continueRender(handle);
        }
      })
      .catch((err: unknown) => {
        if (!settled) {
          settled = true;
          cancelRender(err);
        }
      });
  }, [handle, continueRender, cancelRender]);
};
