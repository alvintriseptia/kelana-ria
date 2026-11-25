import React from "react";
import { Easing, interpolate, useCurrentFrame } from "remotion";
import {
  BRAND_COLORS,
  BRAND_FONTS,
  EDITORIAL_SHADOWS,
} from "../../config/brand";
import { HighlightSwipe } from "./HighlightSwipe";
import { RubberStamp } from "./RubberStamp";

export type OwnershipStampCardProps = {
  readonly zoneLabel?: string;
  readonly landmarkTitle: string;
  readonly team: "green" | "yellow";
  readonly landmarkDeltaLabel?: string;
  readonly consequenceLine?: string;
  readonly consequenceTone?: "green" | "neutral" | "yellow";
  readonly enterStart: number;
  readonly enterEnd: number;
  readonly stampStart: number;
  readonly exitStart: number;
  readonly exitEnd: number;
  readonly rotationDeg?: number;
  readonly width?: number;
};

/**
 * Consistent landmark acquisition stamp card reused across GBK (S05_SH04)
 * and Relief Sarinah (S07_SH04 Beat 1), clearly communicating +1 LANDMARK
 * without conflating landmark count with controlled zone count.
 */
export const OwnershipStampCard: React.FC<OwnershipStampCardProps> = ({
  zoneLabel,
  landmarkTitle,
  team,
  landmarkDeltaLabel = "+1 LANDMARK",
  consequenceLine,
  consequenceTone = "green",
  enterStart,
  enterEnd,
  stampStart,
  exitStart,
  exitEnd,
  rotationDeg = -1.1,
  width = 528,
}) => {
  const frame = useCurrentFrame();

  const enterProgress = interpolate(frame, [enterStart, enterEnd], [0, 1], {
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

  const translateY =
    interpolate(enterProgress, [0, 1], [28, 0]) +
    interpolate(exitProgress, [0, 1], [0, -18]);
  const translateX = interpolate(exitProgress, [0, 1], [0, 44]);

  const isGreen = team === "green";
  const consequenceBg =
    consequenceTone === "neutral"
      ? BRAND_COLORS.mint
      : consequenceTone === "yellow"
        ? BRAND_COLORS.yellowTeamBg
        : BRAND_COLORS.greenTeamBg;
  const consequenceFg =
    consequenceTone === "neutral"
      ? BRAND_COLORS.ink
      : consequenceTone === "yellow"
        ? BRAND_COLORS.yellowTeamText
        : BRAND_COLORS.greenTeamText;

  return (
    <div
      style={{
        position: "relative",
        width,
        backgroundColor: BRAND_COLORS.paper,
        backgroundImage:
          "linear-gradient(to right, rgba(21, 61, 52, 0.045) 1px, transparent 1px), linear-gradient(to bottom, rgba(21, 61, 52, 0.045) 1px, transparent 1px)",
        backgroundSize: "26px 26px",
        border: `3.5px solid ${BRAND_COLORS.ink}`,
        borderRadius: 18,
        padding: "18px 24px 20px",
        boxShadow: isGreen ? "8px 8px 0px #075C54" : "8px 8px 0px #153D34",
        opacity,
        translate: `${translateX}px ${translateY}px`,
        rotate: `${rotationDeg}deg`,
      }}
    >
      {/* Top landmark delta pill (bold for mobile readability, clear of top-right stamp) */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          marginBottom: 14,
        }}
      >
        <span
          style={{
            backgroundColor: isGreen
              ? BRAND_COLORS.greenTeamBg
              : BRAND_COLORS.yellowTeamBg,
            color: isGreen
              ? BRAND_COLORS.greenTeamText
              : BRAND_COLORS.yellowTeamText,
            fontFamily: BRAND_FONTS.display,
            fontSize: 28,
            fontWeight: 700,
            letterSpacing: "0.05em",
            lineHeight: 1,
            padding: "5px 14px",
            borderRadius: 8,
          }}
        >
          {landmarkDeltaLabel}
        </span>
      </div>

      {/* Optional concise zone eyebrow */}
      {zoneLabel && (
        <div
          style={{
            fontFamily: BRAND_FONTS.body,
            fontSize: 15,
            fontWeight: 800,
            letterSpacing: "0.1em",
            textTransform: "uppercase",
            color: BRAND_COLORS.muted,
            marginBottom: 4,
          }}
        >
          {zoneLabel}
        </div>
      )}

      {/* Prominent single-line landmark title */}
      <div
        style={{
          fontFamily: BRAND_FONTS.display,
          fontSize: 66,
          fontWeight: 700,
          lineHeight: 0.94,
          color: BRAND_COLORS.ink,
          letterSpacing: "-0.01em",
          whiteSpace: "nowrap",
        }}
      >
        <HighlightSwipe
          startFrame={stampStart}
          endFrame={stampStart + 10}
          color={isGreen ? BRAND_COLORS.lime : BRAND_COLORS.yellow}
          height={18}
          bottom={4}
        >
          {landmarkTitle}
        </HighlightSwipe>
      </div>

      {/* Bold territory consequence strip */}
      {consequenceLine && (
        <div
          style={{
            marginTop: 14,
            backgroundColor: consequenceBg,
            color: consequenceFg,
            border: `2.5px solid ${BRAND_COLORS.ink}`,
            borderRadius: 10,
            padding: "9px 15px",
            fontFamily: BRAND_FONTS.body,
            fontSize: 21,
            fontWeight: 800,
            letterSpacing: "0.02em",
            lineHeight: 1.15,
          }}
        >
          {consequenceLine}
        </div>
      )}

      {/* Authoritative ownership stamp */}
      <RubberStamp
        label={isGreen ? "DIKLAIM · GREEN" : "DIKLAIM · YELLOW"}
        enterFrame={stampStart}
        tone={isGreen ? "green" : "ink"}
        rotationDeg={-4}
        fontSize={30}
        style={{
          position: "absolute",
          top: -24,
          right: 12,
          boxShadow: EDITORIAL_SHADOWS.subtlePrint,
        }}
      />
    </div>
  );
};
