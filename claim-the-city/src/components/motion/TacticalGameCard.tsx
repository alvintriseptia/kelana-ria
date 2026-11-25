import React from "react";
import { Easing, Img, interpolate, staticFile, useCurrentFrame } from "remotion";
import { BRAND_ASSETS } from "../../config/assets";
import { BRAND_COLORS, BRAND_FONTS } from "../../config/brand";
import { HighlightSwipe } from "./HighlightSwipe";

export type TacticalCardAtlasCell = {
  /** 0-based column in the 3x2 seek-rewards.webp atlas (Poin Ganda = 1). */
  readonly col: 0 | 1 | 2;
  /** 0-based row in the 3x2 seek-rewards.webp atlas (Poin Ganda = 1). */
  readonly row: 0 | 1;
};

export type TacticalGameCardProps = {
  readonly categoryLabel: string;
  readonly availabilityLabel: string;
  readonly cardTitle: string;
  readonly multiplierBadge: string;
  readonly teamLabel: string;
  readonly statusFooterLabel: string;
  readonly atlasCell: TacticalCardAtlasCell;
  readonly enterStart: number;
  readonly enterEnd: number;
  readonly emphasisStart: number;
  readonly emphasisEnd: number;
  readonly commitFrame: number;
  readonly exitStart: number;
  readonly exitEnd: number;
  readonly rotationDeg?: number;
  readonly width?: number;
  /** Optional frame where card transitions live from TERSEDIA/BELUM AKTIF -> DIAKTIFKAN. */
  readonly activationFrame?: number;
  readonly activatedBadgeLabel?: string;
  readonly activatedFooterLabel?: string;
};

/**
 * Physical collectible urban board-game card component for Claim the City tactical items.
 * Renders the authentic supplied artwork cell from assets/brands/artwork/seek-rewards.webp
 * (.cg-art-double -> col 1, row 1 for Poin Ganda) inside printed cardstock framing.
 */
export const TacticalGameCard: React.FC<TacticalGameCardProps> = ({
  categoryLabel,
  availabilityLabel,
  cardTitle,
  multiplierBadge,
  teamLabel,
  statusFooterLabel,
  atlasCell,
  enterStart,
  enterEnd,
  emphasisStart,
  emphasisEnd,
  commitFrame,
  exitStart,
  exitEnd,
  rotationDeg = 2.1,
  width = 430,
  activationFrame,
  activatedBadgeLabel = "DIAKTIFKAN",
  activatedFooterLabel = "BOBOT SARINAH: 1 → 2",
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

  const isActivated =
    activationFrame !== undefined && frame >= activationFrame;

  const activationPunch =
    activationFrame !== undefined
      ? interpolate(
          frame,
          [activationFrame, activationFrame + 5, activationFrame + 12],
          [1, 1.035, 1],
          {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: Easing.bezier(0.22, 1, 0.36, 1),
          },
        )
      : 1;

  // Subtle decisive lift when Naya commits ("Gas!") leading naturally into exit
  const commitLift = interpolate(
    frame,
    [commitFrame, commitFrame + 5],
    [0, -5],
    {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
      easing: Easing.bezier(0.22, 1, 0.36, 1),
    },
  );

  // Crisp non-bouncy placement on table (no excessive spin or bounce)
  const translateX =
    interpolate(enterProgress, [0, 1], [34, 0]) +
    interpolate(exitProgress, [0, 1], [0, 68]);
  const translateY =
    interpolate(enterProgress, [0, 1], [48, 0]) +
    commitLift +
    interpolate(exitProgress, [0, 1], [0, -18]);
  const rotate =
    interpolate(enterProgress, [0, 1], [rotationDeg + 2.4, rotationDeg]) +
    interpolate(exitProgress, [0, 1], [0, 1.8]);

  // Tactile non-bouncy multiplier emblem emphasis synced to "...Poin Ganda!" or activation
  const badgeScale =
    interpolate(frame, [emphasisStart, emphasisStart + 8], [0.9, 1], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
      easing: Easing.bezier(0.22, 1, 0.36, 1),
    }) *
    (activationFrame !== undefined
      ? interpolate(
          frame,
          [activationFrame, activationFrame + 4, activationFrame + 10],
          [1, 1.12, 1.04],
          {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: Easing.bezier(0.22, 1, 0.36, 1),
          },
        )
      : 1);

  // Overscan atlas crop by 2% per cell to cleanly eliminate 1px neighbor seams
  const imgLeftPct = -(atlasCell.col * 102 + 1);
  const imgTopPct = -(atlasCell.row * 102 + 1);

  return (
    <div
      style={{
        position: "relative",
        width,
        backgroundColor: isActivated ? "#FFFDF2" : BRAND_COLORS.card,
        border: `3.5px solid ${BRAND_COLORS.ink}`,
        borderRadius: 22,
        padding: 12,
        boxShadow: isActivated
          ? "10px 10px 0px #153D34"
          : "9px 9px 0px #075C54",
        opacity,
        translate: `${translateX}px ${translateY}px`,
        rotate: `${rotate}deg`,
        scale: `${activationPunch}`,
      }}
    >
      {/* Inner physical playing-card print border */}
      <div
        style={{
          border: `1.5px solid ${BRAND_COLORS.catalogLine}`,
          borderRadius: 14,
          backgroundColor: BRAND_COLORS.paper,
          overflow: "visible",
          display: "flex",
          flexDirection: "column",
        }}
      >
        {/* Green Team card masthead strip */}
        <div
          style={{
            backgroundColor: BRAND_COLORS.greenTeamBg,
            color: BRAND_COLORS.greenTeamText,
            borderTopLeftRadius: 12,
            borderTopRightRadius: 12,
            padding: "10px 16px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              fontFamily: BRAND_FONTS.body,
              fontSize: 15,
              fontWeight: 800,
              letterSpacing: "0.1em",
              textTransform: "uppercase",
              color: BRAND_COLORS.mint,
            }}
          >
            <span
              style={{
                width: 8,
                height: 8,
                backgroundColor: BRAND_COLORS.lime,
                rotate: "45deg",
                display: "inline-block",
              }}
            />
            {categoryLabel}
          </span>

          <span
            style={{
              backgroundColor: isActivated
                ? BRAND_COLORS.yellow
                : BRAND_COLORS.lime,
              color: BRAND_COLORS.uiInk,
              border: `2px solid ${BRAND_COLORS.uiInk}`,
              fontFamily: BRAND_FONTS.display,
              fontSize: 25,
              fontWeight: 700,
              letterSpacing: "0.06em",
              padding: "4px 14px 3px",
              borderRadius: 999,
              lineHeight: 0.96,
            }}
          >
            {isActivated ? activatedBadgeLabel : availabilityLabel}
          </span>
        </div>

        {/* Card body */}
        <div style={{ padding: "14px 16px 16px" }}>
          {/* Framed official Poin Ganda tactical artwork + overlapping 2x seal */}
          <div style={{ position: "relative", marginBottom: 22 }}>
            <div
              style={{
                position: "relative",
                width: "100%",
                height: 248,
                overflow: "hidden",
                borderRadius: 12,
                border: `2.5px solid ${BRAND_COLORS.ink}`,
                backgroundColor: BRAND_COLORS.cloud,
              }}
            >
              <Img
                src={staticFile(BRAND_ASSETS.artworkSeekRewards)}
                style={{
                  position: "absolute",
                  left: `${imgLeftPct}%`,
                  top: `${imgTopPct}%`,
                  width: "306%",
                  height: "204%",
                  maxWidth: "none",
                  display: "block",
                }}
              />
            </div>

            {/* Bold physical multiplier token overlapping bottom-right of artwork */}
            <div
              style={{
                position: "absolute",
                right: -8,
                bottom: -20,
                backgroundColor: BRAND_COLORS.yellow,
                color: BRAND_COLORS.ink,
                border: `3.5px solid ${BRAND_COLORS.ink}`,
                borderRadius: 14,
                padding: "6px 18px 8px",
                boxShadow: "5px 5px 0px #153D34",
                fontFamily: BRAND_FONTS.display,
                fontSize: 72,
                fontWeight: 700,
                lineHeight: 0.88,
                letterSpacing: "-0.02em",
                rotate: "-5.5deg",
                scale: `${badgeScale}`,
              }}
            >
              {multiplierBadge}
            </div>
          </div>

          {/* Dominant card title with restrained brand-yellow highlighter accent */}
          <div style={{ paddingLeft: 2, marginBottom: 14 }}>
            <div
              style={{
                fontFamily: BRAND_FONTS.display,
                fontSize: 80,
                fontWeight: 700,
                lineHeight: 0.92,
                letterSpacing: "-0.015em",
                color: BRAND_COLORS.ink,
              }}
            >
              <HighlightSwipe
                startFrame={emphasisStart}
                endFrame={emphasisEnd}
                color={BRAND_COLORS.yellow}
                height={20}
                bottom={5}
              >
                {cardTitle}
              </HighlightSwipe>
            </div>
          </div>

          {/* Concise cardstock footer confirming inventory or activated weight-change state */}
          <div
            style={{
              borderTop: `1.5px dashed ${BRAND_COLORS.edge}`,
              paddingTop: 11,
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              fontFamily: BRAND_FONTS.body,
              fontSize: 16,
              fontWeight: 800,
              letterSpacing: "0.07em",
              textTransform: "uppercase",
            }}
          >
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 7,
                color: BRAND_COLORS.muted,
              }}
            >
              <span
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: 3,
                  backgroundColor: BRAND_COLORS.greenTeamBg,
                  display: "inline-block",
                }}
              />
              {teamLabel}
            </span>
            <span
              style={
                isActivated
                  ? {
                      backgroundColor: BRAND_COLORS.yellow,
                      color: BRAND_COLORS.ink,
                      padding: "3px 9px",
                      borderRadius: 6,
                      border: `1.5px solid ${BRAND_COLORS.ink}`,
                    }
                  : { color: BRAND_COLORS.teal }
              }
            >
              {isActivated ? activatedFooterLabel : statusFooterLabel}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};
