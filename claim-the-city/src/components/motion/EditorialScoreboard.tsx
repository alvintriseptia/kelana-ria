import React from "react";
import { Easing, interpolate, useCurrentFrame } from "remotion";
import { BRAND_COLORS, BRAND_FONTS } from "../../config/brand";

export type EditorialScoreboardProps = {
  readonly greenZones: number;
  readonly yellowZones: number;
  readonly kicker?: string;
  readonly title?: string;
  readonly footerNote?: string;
  readonly highlightTeam?: "green" | "yellow" | "none";
  readonly emphasizeFrame?: number;
  readonly compact?: boolean;
  readonly style?: React.CSSProperties;
};

/**
 * Recognizable Kelana Ria editorial zone scoreboard.
 * Always keeps GREEN TEAM on the left (#075C54) and YELLOW TEAM on the right (#F4D572),
 * using bold condensed numerals and explicit text labels for mobile legibility.
 */
export const EditorialScoreboard: React.FC<EditorialScoreboardProps> = ({
  greenZones,
  yellowZones,
  kicker,
  title = "ZONA DIKUASAI",
  footerNote,
  highlightTeam = "none",
  emphasizeFrame,
  compact = false,
  style,
}) => {
  const frame = useCurrentFrame();

  const emphasisScale =
    emphasizeFrame !== undefined
      ? interpolate(
          frame,
          [emphasizeFrame, emphasizeFrame + 4, emphasizeFrame + 10],
          [1, 1.07, 1],
          {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: Easing.bezier(0.22, 1, 0.36, 1),
          },
        )
      : 1;

  const numFontSize = compact ? 74 : 96;
  const boxMinWidth = compact ? 156 : 196;
  const boxPadding = compact ? "12px 18px" : "16px 24px";

  return (
    <div
      style={{
        backgroundColor: BRAND_COLORS.paper,
        backgroundImage:
          "linear-gradient(to right, rgba(21, 61, 52, 0.04) 1px, transparent 1px), linear-gradient(to bottom, rgba(21, 61, 52, 0.04) 1px, transparent 1px)",
        backgroundSize: "24px 24px",
        border: `3px solid ${BRAND_COLORS.ink}`,
        borderRadius: 18,
        padding: compact ? "14px 16px 15px" : "18px 22px 20px",
        boxShadow: "8px 8px 0px #153D34",
        ...style,
      }}
    >
      {kicker && (
        <div
          style={{
            fontFamily: BRAND_FONTS.body,
            fontSize: compact ? 13 : 15,
            fontWeight: 800,
            letterSpacing: "0.14em",
            textTransform: "uppercase",
            color: BRAND_COLORS.noticeAccent,
            textAlign: "center",
            marginBottom: 4,
          }}
        >
          {kicker}
        </div>
      )}

      <div
        style={{
          fontFamily: BRAND_FONTS.display,
          fontSize: compact ? 30 : 36,
          fontWeight: 700,
          letterSpacing: "0.08em",
          color: BRAND_COLORS.ink,
          textAlign: "center",
          lineHeight: 1,
          marginBottom: compact ? 12 : 14,
        }}
      >
        {title}
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr auto 1fr",
          alignItems: "center",
          gap: compact ? 10 : 14,
        }}
      >
        {/* GREEN TEAM — Always Left */}
        <div
          style={{
            backgroundColor: BRAND_COLORS.greenTeamBg,
            color: BRAND_COLORS.greenTeamText,
            border:
              highlightTeam === "green"
                ? `3.5px solid ${BRAND_COLORS.yellow}`
                : `2.5px solid ${BRAND_COLORS.ink}`,
            borderRadius: 14,
            padding: boxPadding,
            minWidth: boxMinWidth,
            textAlign: "center",
            scale: highlightTeam === "green" ? `${emphasisScale}` : "1",
          }}
        >
          <div
            style={{
              fontFamily: BRAND_FONTS.body,
              fontSize: compact ? 14 : 16,
              fontWeight: 800,
              letterSpacing: "0.1em",
              color: BRAND_COLORS.lime,
              marginBottom: 4,
            }}
          >
            GREEN TEAM
          </div>
          <div
            style={{
              fontFamily: BRAND_FONTS.display,
              fontSize: numFontSize,
              fontWeight: 700,
              lineHeight: 0.88,
              color:
                highlightTeam === "green"
                  ? BRAND_COLORS.yellow
                  : BRAND_COLORS.greenTeamText,
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {greenZones}
          </div>
        </div>

        <div
          style={{
            fontFamily: BRAND_FONTS.display,
            fontSize: compact ? 42 : 52,
            fontWeight: 700,
            color: BRAND_COLORS.muted,
            lineHeight: 1,
          }}
        >
          —
        </div>

        {/* YELLOW TEAM — Always Right */}
        <div
          style={{
            backgroundColor: BRAND_COLORS.yellowTeamBg,
            color: BRAND_COLORS.yellowTeamText,
            border:
              highlightTeam === "yellow"
                ? `3.5px solid ${BRAND_COLORS.ink}`
                : `2.5px solid ${BRAND_COLORS.ink}`,
            borderRadius: 14,
            padding: boxPadding,
            minWidth: boxMinWidth,
            textAlign: "center",
            scale: highlightTeam === "yellow" ? `${emphasisScale}` : "1",
          }}
        >
          <div
            style={{
              fontFamily: BRAND_FONTS.body,
              fontSize: compact ? 14 : 16,
              fontWeight: 800,
              letterSpacing: "0.1em",
              marginBottom: 4,
            }}
          >
            YELLOW TEAM
          </div>
          <div
            style={{
              fontFamily: BRAND_FONTS.display,
              fontSize: numFontSize,
              fontWeight: 700,
              lineHeight: 0.88,
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {yellowZones}
          </div>
        </div>
      </div>

      {footerNote && (
        <div
          style={{
            marginTop: compact ? 10 : 12,
            paddingTop: compact ? 8 : 10,
            borderTop: `1.5px dashed ${BRAND_COLORS.line}`,
            fontFamily: BRAND_FONTS.body,
            fontSize: compact ? 15 : 17,
            fontWeight: 700,
            color: BRAND_COLORS.muted,
            textAlign: "center",
          }}
        >
          {footerNote}
        </div>
      )}
    </div>
  );
};
