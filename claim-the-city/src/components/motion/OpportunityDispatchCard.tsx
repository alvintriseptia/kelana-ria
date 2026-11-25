import React from "react";
import { Easing, interpolate, useCurrentFrame } from "remotion";
import {
  BRAND_COLORS,
  BRAND_FONTS,
  EDITORIAL_SHADOWS,
} from "../../config/brand";
import { HighlightSwipe } from "./HighlightSwipe";
import { RubberStamp } from "./RubberStamp";

export type OpportunityDispatchCardProps = {
  readonly zoneLabel: string;
  readonly landmarkTitle: string;
  readonly opportunityLine: string;
  readonly contextNote: string;
  readonly stampLabel: string;
  readonly enterStart: number;
  readonly enterEnd: number;
  readonly highlightStart: number;
  readonly highlightEnd: number;
  readonly stampStart: number;
  readonly exitStart: number;
  readonly exitEnd: number;
  readonly rotationDeg?: number;
};

/**
 * Tactile printed-paper dispatch ticket for gameplay opportunity events.
 * Authoritative copy is derived directly from KR_COMPONENT_OPPORTUNITY.png
 * ("Relief Sarinah masih bisa diklaim! / Yellow Team gagal menyelesaikan tantangan.")
 * with bold editorial hierarchy built for both 1080p and mobile readability.
 */
export const OpportunityDispatchCard: React.FC<
  OpportunityDispatchCardProps
> = ({
  zoneLabel,
  landmarkTitle,
  opportunityLine,
  contextNote,
  stampLabel,
  enterStart,
  enterEnd,
  highlightStart,
  highlightEnd,
  stampStart,
  exitStart,
  exitEnd,
  rotationDeg = -1.2,
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
    interpolate(frame, [enterStart, enterStart + 6], [0, 1], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    }) *
    interpolate(frame, [exitStart + 1, exitEnd], [1, 0], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    });

  if (opacity <= 0.005) {
    return null;
  }

  const translateX =
    interpolate(enterProgress, [0, 1], [64, 0]) +
    interpolate(exitProgress, [0, 1], [0, 72]);
  const translateY =
    interpolate(enterProgress, [0, 1], [12, 0]) +
    interpolate(exitProgress, [0, 1], [0, -16]);
  const rotate =
    interpolate(enterProgress, [0, 1], [rotationDeg + 1.4, rotationDeg]) +
    interpolate(exitProgress, [0, 1], [0, -1.2]);

  return (
    <div
      style={{
        position: "relative",
        width: 536,
        backgroundColor: BRAND_COLORS.paper,
        backgroundImage:
          "linear-gradient(to right, rgba(21, 61, 52, 0.045) 1px, transparent 1px), linear-gradient(to bottom, rgba(21, 61, 52, 0.045) 1px, transparent 1px)",
        backgroundSize: "28px 28px",
        border: `3px solid ${BRAND_COLORS.ink}`,
        borderRadius: 18,
        boxShadow: "8px 8px 0px #153D34",
        padding: "16px 22px 20px",
        opacity,
        translate: `${translateX}px ${translateY}px`,
        rotate: `${rotate}deg`,
      }}
    >
      {/* Top terracotta dispatch rail (matches official .cg-notice accent) */}
      <div
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 9,
          backgroundColor: BRAND_COLORS.noticeBg,
          borderLeft: `5px solid ${BRAND_COLORS.noticeAccent}`,
          borderRadius: 8,
          padding: "7px 12px",
          marginBottom: 16,
        }}
      >
        {/* Official unclaimed landmark circle pin signifier (#475954) */}
        <span
          style={{
            width: 13,
            height: 13,
            borderRadius: "50%",
            backgroundColor: BRAND_COLORS.pinUnclaimed,
            border: "2px solid #F6FBF7",
            boxShadow: `0 0 0 1.5px ${BRAND_COLORS.pinUnclaimed}`,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
          }}
        >
          <span
            style={{
              width: 3.5,
              height: 3.5,
              borderRadius: "50%",
              backgroundColor: "#FFFFFF",
            }}
          />
        </span>
        <span
          style={{
            fontFamily: BRAND_FONTS.body,
            fontSize: 15,
            fontWeight: 800,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            color: BRAND_COLORS.ink,
            lineHeight: 1,
          }}
        >
          {zoneLabel}
        </span>
      </div>

      {/* Prominent landmark headline + clear opportunity statement */}
      <div style={{ paddingInline: 4 }}>
        <div
          style={{
            fontFamily: BRAND_FONTS.display,
            fontSize: 112,
            fontWeight: 700,
            lineHeight: 0.9,
            letterSpacing: "-0.015em",
            color: BRAND_COLORS.ink,
          }}
        >
          <HighlightSwipe
            startFrame={highlightStart}
            endFrame={highlightEnd}
            color={BRAND_COLORS.yellow}
            height={23}
            bottom={6}
          >
            {landmarkTitle}
          </HighlightSwipe>
        </div>

        <div
          style={{
            fontFamily: BRAND_FONTS.display,
            fontSize: 50,
            fontWeight: 700,
            lineHeight: 1.0,
            letterSpacing: "0.015em",
            color: BRAND_COLORS.teal,
            marginTop: 8,
          }}
        >
          {opportunityLine}
        </div>
      </div>

      {/* Tactile perforated ticket rule + single authoritative product context line */}
      <div
        style={{
          marginTop: 18,
          paddingTop: 14,
          paddingInline: 4,
          borderTop: `2px dashed ${BRAND_COLORS.line}`,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 10,
        }}
      >
        <span
          style={{
            fontFamily: BRAND_FONTS.body,
            fontSize: 20,
            fontWeight: 600,
            lineHeight: 1.25,
            color: BRAND_COLORS.muted,
            whiteSpace: "nowrap",
          }}
        >
          {contextNote}
        </span>

        {/* Subtle restrained handwritten directional accent */}
        <svg
          width="26"
          height="19"
          viewBox="0 0 28 20"
          fill="none"
          style={{ flexShrink: 0, opacity: 0.85 }}
        >
          <path
            d="M3 14 C10 11 16 10 24 6"
            stroke={BRAND_COLORS.noticeAccent}
            strokeWidth="2.8"
            strokeLinecap="round"
          />
          <path
            d="M17 4 L25 6 L21 13"
            stroke={BRAND_COLORS.noticeAccent}
            strokeWidth="2.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>

      {/* Hand-applied terracotta rubber stamp reinforcing unclaimed status */}
      <RubberStamp
        label={stampLabel}
        enterFrame={stampStart}
        tone="terracotta"
        rotationDeg={-4.5}
        fontSize={29}
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
