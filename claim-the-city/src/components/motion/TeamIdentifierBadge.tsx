import React from "react";
import { Easing, interpolate, useCurrentFrame } from "remotion";
import { BRAND_COLORS, BRAND_FONTS } from "../../config/brand";

export type TeamIdentifierBadgeProps = {
  readonly team: "green" | "yellow";
  readonly enterStart?: number;
  readonly exitStart: number;
  readonly exitEnd: number;
  readonly subtitle?: string;
  readonly style?: React.CSSProperties;
};

/**
 * Concise, tactile board-game team identifier without a heavy paper container box.
 * Uses distinct team color + explicit text label + geometric game token marker.
 */
export const TeamIdentifierBadge: React.FC<TeamIdentifierBadgeProps> = ({
  team,
  enterStart = 4,
  exitStart,
  exitEnd,
  subtitle,
  style,
}) => {
  const frame = useCurrentFrame();

  const enterProgress = interpolate(frame, [enterStart, enterStart + 10], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.bezier(0.16, 1, 0.3, 1),
  });
  const exitProgress = interpolate(frame, [exitStart, exitEnd], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.bezier(0.7, 0, 0.84, 0),
  });

  const opacity =
    interpolate(frame, [enterStart, enterStart + 5], [0, 1], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    }) *
    interpolate(frame, [exitStart, exitEnd], [1, 0], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    });

  if (opacity <= 0.005) {
    return null;
  }

  const translateX =
    interpolate(enterProgress, [0, 1], [-28, 0]) +
    interpolate(exitProgress, [0, 1], [0, -24]);

  const isGreen = team === "green";
  const bg = isGreen ? BRAND_COLORS.greenTeamBg : BRAND_COLORS.yellowTeamBg;
  const fg = isGreen ? BRAND_COLORS.greenTeamText : BRAND_COLORS.yellowTeamText;
  const pipColor = isGreen ? BRAND_COLORS.lime : BRAND_COLORS.ink;

  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 12,
        backgroundColor: bg,
        color: fg,
        border: `3px solid ${BRAND_COLORS.ink}`,
        borderRadius: 12,
        padding: "10px 20px 10px 16px",
        boxShadow: "6px 6px 0px #153D34",
        opacity,
        translate: `${translateX}px 0px`,
        rotate: isGreen ? "-1deg" : "1deg",
        ...style,
      }}
    >
      <span
        style={{
          width: 12,
          height: 12,
          backgroundColor: pipColor,
          rotate: "45deg",
          display: "inline-block",
          flexShrink: 0,
        }}
      />
      <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
        <span
          style={{
            fontFamily: BRAND_FONTS.display,
            fontSize: 40,
            fontWeight: 700,
            letterSpacing: "0.04em",
            lineHeight: 0.94,
          }}
        >
          {isGreen ? "GREEN TEAM" : "YELLOW TEAM"}
        </span>
        {subtitle && (
          <span
            style={{
              fontFamily: BRAND_FONTS.body,
              fontSize: 15,
              fontWeight: 800,
              letterSpacing: "0.06em",
              opacity: 0.88,
            }}
          >
            {subtitle}
          </span>
        )}
      </div>
    </div>
  );
};
