import { CAMPAIGN_FPS, ROUGHCUT_TIMELINE } from "./timeline";

const lockedS07Sh02Segment = ROUGHCUT_TIMELINE.segments.find(
  (segment) => segment.id === "S07_SH02",
);

if (
  !lockedS07Sh02Segment ||
  lockedS07Sh02Segment.kind !== "footage" ||
  !lockedS07Sh02Segment.assetPath
) {
  throw new Error(
    "Locked S07_SH02 footage segment not found in ROUGHCUT_TIMELINE.",
  );
}

/**
 * Exact source trim, duration, and audio level pulled directly from the locked
 * Milestone 1.1 Rough Cut V4 timeline (00:45.63 - 00:52.13 in KelanaRia-RoughCut).
 * Source file: assets/footage/KR_SH07_SH02.mp4 (0.30s -> 6.80s = 6.50s / 195 frames @ 30 fps).
 */
export const S07_SH02_LOCKED_EXCERPT = {
  shotId: lockedS07Sh02Segment.shotId,
  assetPath: lockedS07Sh02Segment.assetPath,
  trimStartSec: lockedS07Sh02Segment.trimStartSec,
  trimEndSec: lockedS07Sh02Segment.trimEndSec,
  trimStartFrames: lockedS07Sh02Segment.trimStartFrames, // 9 frames (0.30s)
  durationInFrames: lockedS07Sh02Segment.durationInFrames, // 195 frames (6.50s)
  durationSec: Number(
    (lockedS07Sh02Segment.durationInFrames / CAMPAIGN_FPS).toFixed(2),
  ),
  volume: lockedS07Sh02Segment.volume, // 0.88
  audioFadeFrames: lockedS07Sh02Segment.audioFadeFrames ?? 4,
  campaignStartSec: Number(
    (lockedS07Sh02Segment.startFrame / CAMPAIGN_FPS).toFixed(2),
  ), // 45.63s
  campaignEndSec: Number(
    (
      (lockedS07Sh02Segment.startFrame +
        lockedS07Sh02Segment.durationInFrames) /
      CAMPAIGN_FPS
    ).toFixed(2),
  ), // 52.13s
} as const;

/**
 * Exact frame choreography (30 fps, relative to locked 195f / 6.50s excerpt)
 * verified against audio RMS peaks and live-action character positions.
 *
 * Verified dialogue timeline inside locked 6.50s excerpt (t=0.00s == source 0.30s):
 *  - 0.00s - 0.37s (f000 - f011): Arga looks down at phone, registers notification
 *  - 0.40s - 0.77s (f012 - f023): Arga: "Bentar!" (peak at 0.60s / f018)
 *  - 1.30s - 2.20s (f039 - f066): Arga: "Sarinah bisa direbut!" (peak at 2.10s / f063)
 *  - 2.60s - 3.57s (f078 - f107): Naya: "Deket dong dari sini!" (peak at 2.90s / f087)
 *  - 3.80s - 4.45s (f114 - f134): Arga: "Kita masih punya..."
 *  - 4.50s - 5.05s (f135 - f152): Arga: "...Poin Ganda!" (peak at 4.90s / f147)
 *  - 5.30s - 5.55s (f159 - f167): Naya: "Gas!" (pivots toward tunnel exit)
 *  - 5.55s - 6.50s (f167 - f195): Both stride briskly down Terowongan Kendal
 */
export const S07_SH02_V2_CUES = {
  totalFrames: S07_SH02_LOCKED_EXCERPT.durationInFrames, // 195 frames (6.50s)

  // Beat A — Opportunity ("SARINAH MASIH BISA DIKLAIM!")
  beatAEnterStart: 12, // 0.40s — Arga exclaims "Bentar!"
  beatAEnterEnd: 24, // 0.80s — crisp non-bouncy paper settle
  beatAHighlightStart: 38, // 1.27s — synced to Arga beginning "Sarinah..."
  beatAHighlightEnd: 49, // 1.63s — yellow underline finishes across SARINAH
  beatAStampStart: 41, // 1.37s — crisp "BELUM DIKLAIM" terracotta rubber stamp
  beatAExitStart: 86, // 2.87s — clears cleanly as Naya reacts ("Deket dong dari sini!")
  beatAExitEnd: 98, // 3.27s — fully cleared; 16-frame clean reaction breath before Beat B

  // Beat B — Strategy ("POIN GANDA · 2x · TERSEDIA")
  beatBEnterStart: 114, // 3.80s — Arga begins "Kita masih punya..."
  beatBEnterEnd: 128, // 4.27s — confident tabletop card placement
  beatBHighlightStart: 134, // 4.47s — Arga lands "...Poin Ganda!"
  beatBHighlightEnd: 145, // 4.83s — highlighter sweep + 2x emblem emphasis settle
  beatBGasCommit: 159, // 5.30s — subtle decisive lift on Naya's "Gas!"
  beatBExitStart: 163, // 5.43s — smooth departure as Naya pivots to walk
  beatBExitEnd: 176, // 5.87s — completely clear for closing Raw Jakarta tunnel stride

  // Representative review stills requested for Milestone 1.2
  representativeStills: {
    opportunityGraphic: 56, // 1.87s — Beat A fully settled with stamp & highlight on "Sarinah bisa direbut!"
    opportunityToCardTransition: 91, // 3.03s — Beat A clearing mid-exit while Naya reacts (no card stacking)
    tacticalCardReveal: 148, // 4.93s — Beat B fully revealed with 2x emblem & highlight on "...Poin Ganda!"
    finalResolvedFootage: 185, // 6.17s — 100% pure live-action tunnel exit stride
  },
} as const;

/**
 * Documented sound-design cue points for future Milestone 2 audio pass.
 * No final SFX or music are injected in Milestone 1.2.
 */
export const S07_SH02_SFX_CUE_NOTES = [
  {
    frame: 12,
    timeSec: 0.4,
    cue: "Soft tactile phone ping / crisp paper ticket slide-in on Arga's 'Bentar!'",
  },
  {
    frame: 41,
    timeSec: 1.37,
    cue: "Restrained dry rubber-stamp thud on 'BELUM DIKLAIM' synced to 'Sarinah'",
  },
  {
    frame: 86,
    timeSec: 2.87,
    cue: "Subtle paper brush-away as Opportunity ticket clears for Naya's reaction",
  },
  {
    frame: 114,
    timeSec: 3.8,
    cue: "Crisp physical cardstock flick/deal as Poin Ganda card enters on 'Kita masih punya...'",
  },
  {
    frame: 134,
    timeSec: 4.47,
    cue: "Warm felt marker stroke / tactile badge lock on '...Poin Ganda!'",
  },
  {
    frame: 163,
    timeSec: 5.43,
    cue: "Light card tuck-away on Naya's 'Gas!' returning cleanly to tunnel ambience",
  },
] as const;
