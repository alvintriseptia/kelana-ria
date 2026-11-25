import React from "react";
import { Easing, interpolate, useCurrentFrame } from "remotion";
import { BRAND_COLORS } from "../../config/brand";

export type HighlightSwipeProps = {
  readonly startFrame: number;
  readonly endFrame: number;
  readonly color?: string;
  readonly height?: number;
  readonly bottom?: number;
  readonly children: React.ReactNode;
};

/**
 * Restrained marker-pen highlighter sweep behind display typography,
 * synced deterministically to vocal emphasis.
 */
export const HighlightSwipe: React.FC<HighlightSwipeProps> = ({
  startFrame,
  endFrame,
  color = BRAND_COLORS.yellow,
  height = 20,
  bottom = 6,
  children,
}) => {
  const frame = useCurrentFrame();

  const widthPct = interpolate(frame, [startFrame, endFrame], [0, 100], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.bezier(0.22, 1, 0.36, 1),
  });

  return (
    <span
      style={{
        position: "relative",
        display: "inline-block",
        paddingInline: 6,
        marginInline: -6,
      }}
    >
      <span
        style={{
          position: "absolute",
          left: 0,
          bottom,
          height,
          width: `${widthPct}%`,
          backgroundColor: color,
          borderRadius: 4,
          zIndex: 0,
        }}
      />
      <span style={{ position: "relative", zIndex: 1 }}>{children}</span>
    </span>
  );
};
