import { Video } from "@remotion/media";
import React from "react";
import {
  AbsoluteFill,
  interpolate,
  staticFile,
  useCurrentFrame,
} from "remotion";
import { OpportunityDispatchCard } from "../components/motion/OpportunityDispatchCard";
import { TacticalGameCard } from "../components/motion/TacticalGameCard";
import { BRAND_COLORS, useBrandFonts } from "../config/brand";
import {
  S07_SH02_LOCKED_EXCERPT,
  S07_SH02_V2_CUES,
} from "../config/motionPrototypeS07SH02";

export type MotionDesignTestProps = {
  readonly footageVolume: number;
};

/**
 * Isolated video layer using the exact locked Rough Cut V4 trim points (0.30s -> 6.80s)
 * and gentle 4-frame edge fades so audio matches the locked campaign timeline cleanly.
 */
const LockedExcerptFootage: React.FC<{
  readonly baseVolume: number;
}> = ({ baseVolume }) => {
  const frame = useCurrentFrame();
  const { trimStartFrames, durationInFrames, audioFadeFrames, assetPath } =
    S07_SH02_LOCKED_EXCERPT;

  const fadeIn = interpolate(frame, [0, audioFadeFrames], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const fadeOut = interpolate(
    frame,
    [durationInFrames - audioFadeFrames, durationInFrames],
    [1, 0],
    {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    },
  );

  return (
    <Video
      src={staticFile(assetPath)}
      trimBefore={trimStartFrames}
      durationInFrames={durationInFrames}
      volume={baseVolume * fadeIn * fadeOut}
      objectFit="cover"
      style={{
        width: "100%",
        height: "100%",
      }}
    />
  );
};

/**
 * Milestone 1.2 Refined Prototype — KR-MotionDesign-Test-S07-SH02 (V2)
 * Built on the exact locked 6.50s (195-frame) campaign excerpt from Scene 07 SH02
 * (00:45.63 - 00:52.13 in KelanaRia-RoughCut).
 *
 * Principle: "Show the event, not the entire interface."
 * Two strictly sequential graphic beats anchored cleanly in right-side tunnel negative space:
 *  - Beat A (f012 - f098): Editorial Opportunity Dispatch ("SARINAH MASIH BISA DIKLAIM!")
 *  - Open live-action breath (f098 - f114): Naya's reaction takes undivided focus
 *  - Beat B (f114 - f176): Physical Tactical Game Card ("POIN GANDA · 2x · TERSEDIA")
 *  - Resolution (f176 - f195): Pure Raw Jakarta tunnel exit stride
 */
export const MotionDesignTestS07SH02: React.FC<MotionDesignTestProps> = ({
  footageVolume,
}) => {
  useBrandFonts();

  return (
    <AbsoluteFill style={{ backgroundColor: BRAND_COLORS.uiInk }}>
      {/* Untouched Raw Jakarta live-action footage & original dialogue/environmental audio */}
      <LockedExcerptFootage baseVolume={footageVolume} />

      {/* Beat A — Opportunity (right tunnel negative space, clear of Arga, phone & Naya) */}
      <div
        style={{
          position: "absolute",
          top: 292,
          right: 68,
          pointerEvents: "none",
        }}
      >
        <OpportunityDispatchCard
          zoneLabel="SUDIRMAN–THAMRIN"
          landmarkTitle="SARINAH"
          opportunityLine="MASIH BISA DIKLAIM!"
          contextNote="Yellow Team gagal menyelesaikan tantangan."
          stampLabel="BELUM DIKLAIM"
          enterStart={S07_SH02_V2_CUES.beatAEnterStart}
          enterEnd={S07_SH02_V2_CUES.beatAEnterEnd}
          highlightStart={S07_SH02_V2_CUES.beatAHighlightStart}
          highlightEnd={S07_SH02_V2_CUES.beatAHighlightEnd}
          stampStart={S07_SH02_V2_CUES.beatAStampStart}
          exitStart={S07_SH02_V2_CUES.beatAExitStart}
          exitEnd={S07_SH02_V2_CUES.beatAExitEnd}
        />
      </div>

      {/* Beat B — Strategy: Physical Poin Ganda game card (strictly after Beat A resolves) */}
      <div
        style={{
          position: "absolute",
          top: 214,
          right: 92,
          pointerEvents: "none",
        }}
      >
        <TacticalGameCard
          categoryLabel="KARTU TAKTIS"
          availabilityLabel="TERSEDIA"
          cardTitle="POIN GANDA"
          multiplierBadge="2×"
          teamLabel="GREEN TEAM"
          statusFooterLabel="BELUM AKTIF"
          atlasCell={{ col: 1, row: 1 }}
          enterStart={S07_SH02_V2_CUES.beatBEnterStart}
          enterEnd={S07_SH02_V2_CUES.beatBEnterEnd}
          emphasisStart={S07_SH02_V2_CUES.beatBHighlightStart}
          emphasisEnd={S07_SH02_V2_CUES.beatBHighlightEnd}
          commitFrame={S07_SH02_V2_CUES.beatBGasCommit}
          exitStart={S07_SH02_V2_CUES.beatBExitStart}
          exitEnd={S07_SH02_V2_CUES.beatBExitEnd}
        />
      </div>
    </AbsoluteFill>
  );
};
