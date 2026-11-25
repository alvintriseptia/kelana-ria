import React from "react";
import {
  AbsoluteFill,
  Easing,
  interpolate,
  useCurrentFrame,
} from "remotion";
import { BRAND_COLORS, BRAND_COPY, BRAND_FONTS } from "../config/brand";
import { BrandLockup } from "./BrandLockup";
import { HighlightSwipe } from "./motion/HighlightSwipe";
import { PaperSurface } from "./PaperSurface";

/**
 * Scene 09 — Confident, memorable Kelana Ria brand reveal (locked 4.00s / 120 frames).
 * Increases actual Kelana Ria lockup scale by +34% (icon 158px, wordmark 150px) and
 * gives "Mainkan kotamu." stronger editorial prominence while preserving the official
 * identity, typography, palette, and SEGERA HADIR CTA.
 */
export const BrandRevealScene: React.FC = () => {
  const frame = useCurrentFrame();

  const lockupOpacity = interpolate(frame, [4, 20], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.bezier(0.16, 1, 0.3, 1),
  });
  const lockupY = interpolate(frame, [4, 24], [24, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.bezier(0.16, 1, 0.3, 1),
  });

  const taglineOpacity = interpolate(frame, [22, 36], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const taglineY = interpolate(frame, [22, 38], [16, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.bezier(0.16, 1, 0.3, 1),
  });

  const ctaOpacity = interpolate(frame, [46, 60], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const ctaY = interpolate(frame, [46, 62], [14, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.bezier(0.16, 1, 0.3, 1),
  });

  return (
    <PaperSurface variant="brand">
      <AbsoluteFill
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          textAlign: "center",
          gap: 32,
        }}
      >
        <div
          style={{
            opacity: lockupOpacity,
            translate: `0px ${lockupY}px`,
          }}
        >
          <BrandLockup iconSize={158} fontSize={150} gap={38} />
        </div>

        <div
          style={{
            fontFamily: BRAND_FONTS.body,
            fontSize: 64,
            fontWeight: 700,
            color: BRAND_COLORS.ink,
            letterSpacing: "-0.025em",
            lineHeight: 1.08,
            opacity: taglineOpacity,
            translate: `0px ${taglineY}px`,
          }}
        >
          <HighlightSwipe
            startFrame={30}
            endFrame={46}
            color={BRAND_COLORS.yellow}
            height={22}
            bottom={5}
          >
            {BRAND_COPY.tagline}
          </HighlightSwipe>
        </div>

        <div
          style={{
            marginTop: 14,
            opacity: ctaOpacity,
            translate: `0px ${ctaY}px`,
          }}
        >
          <div
            style={{
              display: "inline-block",
              backgroundColor: BRAND_COLORS.ink,
              color: BRAND_COLORS.yellow,
              border: `3.5px solid ${BRAND_COLORS.ink}`,
              fontFamily: BRAND_FONTS.display,
              fontSize: 44,
              fontWeight: 700,
              letterSpacing: "0.14em",
              padding: "14px 44px",
              borderRadius: 14,
              boxShadow: "7px 7px 0px #075C54",
            }}
          >
            {BRAND_COPY.closingCta}
          </div>
        </div>
      </AbsoluteFill>
    </PaperSurface>
  );
};
