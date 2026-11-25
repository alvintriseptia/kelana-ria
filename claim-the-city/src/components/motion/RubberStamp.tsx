import React from "react";
import { Easing, interpolate, useCurrentFrame } from "remotion";
import { BRAND_COLORS, BRAND_FONTS } from "../../config/brand";

export type RubberStampProps = {
  readonly label: string;
  readonly enterFrame: number;
  readonly tone?: "terracotta" | "green" | "ink";
  readonly rotationDeg?: number;
  readonly fontSize?: number;
  readonly style?: React.CSSProperties;
};

const TONE_MAP = {
  terracotta: {
    color: BRAND_COLORS.noticeAccent,
    borderColor: BRAND_COLORS.noticeAccent,
    backgroundColor: BRAND_COLORS.paper,
  },
  green: {
    color: BRAND_COLORS.greenTeamBg,
    borderColor: BRAND_COLORS.greenTeamBg,
    backgroundColor: BRAND_COLORS.paper,
  },
  ink: {
    color: BRAND_COLORS.ink,
    borderColor: BRAND_COLORS.ink,
    backgroundColor: BRAND_COLORS.paper,
  },
} as const;

/**
 * Tactile Jakarta Playground rubber-stamp impression with crisp non-bouncy physical settle.
 * Reusable across unclaimed notices, cooldowns, and landmark claim confirmations.
 */
export const RubberStamp: React.FC<RubberStampProps> = ({
  label,
  enterFrame,
  tone = "terracotta",
  rotationDeg = -4.5,
  fontSize = 28,
  style,
}) => {
  const frame = useCurrentFrame();

  const opacity = interpolate(frame, [enterFrame, enterFrame + 4], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  if (opacity <= 0.005) {
    return null;
  }

  const settleScale = interpolate(
    frame,
    [enterFrame, enterFrame + 7],
    [1.22, 1],
    {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
      easing: Easing.bezier(0.22, 1, 0.36, 1),
    },
  );

  const palette = TONE_MAP[tone];

  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: palette.backgroundColor,
        border: `3px solid ${palette.borderColor}`,
        borderRadius: 8,
        padding: "5px 14px",
        boxShadow: "0 4px 10px rgba(18, 47, 41, 0.16)",
        opacity,
        scale: `${settleScale}`,
        rotate: `${rotationDeg}deg`,
        ...style,
      }}
    >
      <div
        style={{
          border: `1.5px dashed ${palette.borderColor}`,
          borderRadius: 4,
          padding: "3px 9px",
          color: palette.color,
          fontFamily: BRAND_FONTS.display,
          fontSize,
          fontWeight: 700,
          letterSpacing: "0.08em",
          lineHeight: 0.96,
          whiteSpace: "nowrap",
        }}
      >
        {label}
      </div>
    </div>
  );
};
