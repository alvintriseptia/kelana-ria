import React from "react";
import {
  AbsoluteFill,
  Easing,
  Img,
  interpolate,
  staticFile,
  useCurrentFrame,
} from "remotion";
import { UI_MAPS } from "../config/assets";
import { BRAND_COLORS, BRAND_COPY, BRAND_FONTS } from "../config/brand";
import type { InterludeKind } from "../config/timeline";
import { HighlightSwipe } from "./motion/HighlightSwipe";
import { PaperSurface } from "./PaperSurface";

type InterludePlaceholderProps = {
  readonly kind: InterludeKind;
  readonly sceneId: string;
  readonly label: string;
  readonly showPlaceholderBadge: boolean;
};

const formatMatchClock = (totalSeconds: number): string => {
  const clamped = Math.max(0, Math.round(totalSeconds));
  const mins = Math.floor(clamped / 60);
  const secs = clamped % 60;
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
};

/**
 * S08 Match Conclusion — Continuous 7.00s (210-frame) open-canvas Jakarta Playground sequence.
 * Eliminates nested presentation-slide boxes in favor of confident graphic scale,
 * architectural typography, dominant controlled-zone numerals, and negative-space composition:
 *  - Phase 1 (f0..f74  / 0.0-2.5s): Full-screen Sudirman-Thamrin territory transformation
 *            (actual KR_UI_MAP_SARINAH.png + restrained x2 highlight + BOBOT 1->2 + GREEN 2 - YELLOW 1, clock at 102:00)
 *  - Phase 2 (f75..f134 / 2.5-4.5s): Monumental open-canvas accelerated clock 102:00 -> 00:00 + progress rail
 *  - Phase 3 (f135..f210 / 4.5-7.0s): Unified 00:00 · WAKTU RONDE HABIS + GREEN TEAM MENANG + monumental 2 - 1 ZONA
 */
export const InterludePlaceholder: React.FC<InterludePlaceholderProps> = () => {
  const frame = useCurrentFrame();

  const overallFadeIn = interpolate(frame, [0, 6], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  // Match clock accelerates deterministically from 102:00 down to 00:00 across f78..f130
  const clockProgress = interpolate(frame, [78, 130], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.inOut(Easing.cubic),
  });
  const remainingMatchSec = interpolate(clockProgress, [0, 1], [102 * 60, 0]);
  const clockDisplay = formatMatchClock(remainingMatchSec);
  const isExpired = frame >= 130;

  // Smooth continuous crossfades on one unified canvas
  const phase1Opacity = interpolate(frame, [66, 76], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const phase2Opacity =
    interpolate(frame, [72, 82], [0, 1], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    }) *
    interpolate(frame, [128, 137], [1, 0], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    });

  const phase3Opacity = interpolate(frame, [133, 143], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const phase3Lift = interpolate(frame, [133, 145], [18, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.bezier(0.16, 1, 0.3, 1),
  });

  // Hide top-right mini clock during Phase 2 so only the monumental center clock commands attention
  const topClockOpacity =
    interpolate(frame, [70, 78], [1, 0], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    }) +
    interpolate(frame, [131, 139], [0, 1], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    });

  // Restrained territory highlight radiating from verified Sarinah [x2] pin (323.5, 128.3)
  const mapPulseRadius = interpolate(frame, [4, 34], [26, 112], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.bezier(0.16, 1, 0.3, 1),
  });
  const mapPulseOpacity = interpolate(frame, [4, 14, 34], [0, 0.85, 0.22], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const weightTagScale = interpolate(frame, [8, 18], [0.88, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.bezier(0.22, 1, 0.36, 1),
  });
  const territoryWashOpacity = interpolate(frame, [4, 24], [0, 0.24], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  // Round progress bar (150:00 round -> 102:00 = 32% elapsed -> 00:00 = 100%)
  const elapsedPct = interpolate(clockProgress, [0, 1], [32, 100]);

  const headerStatusText =
    frame < 75
      ? "GREEN TEAM MEMIMPIN"
      : frame < 130
        ? "PERTANDINGAN BERLANJUT"
        : "WAKTU RONDE HABIS";

  // Pixel-verified map geometry on KR_UI_MAP_SARINAH.png (780x1688):
  // Crop x:30..750 (w=720), y:635..1395 -> viewport 648x684 (scale = 0.90)
  // Sarinah [x2] pin center = (323.5, 128.3), ST · Green Team = (274.5, 540.5), Bundaran HI = (621)
  const mapVpW = 648;
  const mapVpH = 684;
  const mapScale = mapVpW / 720;
  const mapImgW = Math.round(UI_MAPS.sarinahPostPoinGanda.width * mapScale);
  const mapImgH = Math.round(UI_MAPS.sarinahPostPoinGanda.height * mapScale);
  const mapImgLeft = Math.round(-30 * mapScale);
  const mapImgTop = Math.round(-635 * mapScale);

  return (
    <PaperSurface variant="playground">
      <AbsoluteFill style={{ opacity: overallFadeIn }}>
        {/* Minimal Persistent Top Anchor (no bulky chrome) */}
        <div
          style={{
            position: "absolute",
            top: 48,
            left: 88,
            right: 88,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <div style={{ display: "inline-flex", alignItems: "center", gap: 16 }}>
            <div
              style={{
                backgroundColor: BRAND_COLORS.ink,
                color: BRAND_COLORS.paper,
                fontFamily: BRAND_FONTS.display,
                fontSize: 34,
                fontWeight: 700,
                letterSpacing: "0.05em",
                padding: "7px 18px",
                borderRadius: 10,
                lineHeight: 1,
                boxShadow: "4px 4px 0px #075C54",
              }}
            >
              CLAIM THE CITY
            </div>
            <span
              style={{
                fontFamily: BRAND_FONTS.body,
                fontSize: 17,
                fontWeight: 800,
                letterSpacing: "0.14em",
                color: isExpired ? BRAND_COLORS.noticeAccent : BRAND_COLORS.teal,
              }}
            >
              {headerStatusText}
            </span>
          </div>

          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 12,
              backgroundColor: isExpired ? BRAND_COLORS.ink : BRAND_COLORS.card,
              color: isExpired ? BRAND_COLORS.yellow : BRAND_COLORS.ink,
              border: `2.5px solid ${BRAND_COLORS.ink}`,
              borderRadius: 12,
              padding: "7px 20px",
              boxShadow: "4px 4px 0px #153D34",
              opacity: topClockOpacity,
            }}
          >
            <span
              style={{
                fontFamily: BRAND_FONTS.body,
                fontSize: 14,
                fontWeight: 800,
                letterSpacing: "0.1em",
                opacity: 0.82,
              }}
            >
              SISA WAKTU
            </span>
            <span
              style={{
                fontFamily: BRAND_FONTS.display,
                fontSize: 42,
                fontWeight: 700,
                lineHeight: 1,
                fontVariantNumeric: "tabular-nums",
                minWidth: 96,
                textAlign: "right",
              }}
            >
              {clockDisplay}
            </span>
          </div>
        </div>

        {/* PHASE 1 (0.0s - 2.5s): Full-Screen Territory Transformation (Green Leads 2-1, 102:00) */}
        {phase1Opacity > 0.005 && (
          <AbsoluteFill
            style={{
              display: "flex",
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "126px 88px 68px",
              gap: 64,
              opacity: phase1Opacity,
            }}
          >
            {/* Left: Physical Printed Map Sheet using ACTUAL KR_UI_MAP_SARINAH.png */}
            <div style={{ position: "relative", flexShrink: 0 }}>
              <div
                style={{
                  position: "relative",
                  width: mapVpW,
                  height: mapVpH,
                  overflow: "hidden",
                  borderRadius: 18,
                  border: `4px solid ${BRAND_COLORS.ink}`,
                  boxShadow: "11px 11px 0px #075C54",
                  backgroundColor: "#EEF2EE",
                }}
              >
                <Img
                  src={staticFile(UI_MAPS.sarinahPostPoinGanda.path)}
                  style={{
                    position: "absolute",
                    left: mapImgLeft,
                    top: mapImgTop,
                    width: mapImgW,
                    height: mapImgH,
                  }}
                />

                {/* Restrained territory emerald wash & x2 pin highlight halo (no invented street geometry) */}
                <svg
                  width={mapVpW}
                  height={mapVpH}
                  viewBox={`0 0 ${mapVpW} ${mapVpH}`}
                  style={{ position: "absolute", inset: 0, pointerEvents: "none" }}
                >
                  <defs>
                    <radialGradient
                      id="sarinahTerritoryWash"
                      cx="323.5"
                      cy="128.3"
                      r="360"
                      gradientUnits="userSpaceOnUse"
                    >
                      <stop offset="0%" stopColor="#075C54" stopOpacity="0.45" />
                      <stop offset="55%" stopColor="#075C54" stopOpacity="0.16" />
                      <stop offset="100%" stopColor="#075C54" stopOpacity="0" />
                    </radialGradient>
                  </defs>
                  <rect
                    width={mapVpW}
                    height={mapVpH}
                    fill="url(#sarinahTerritoryWash)"
                    opacity={territoryWashOpacity}
                  />
                  <circle
                    cx="323.5"
                    cy="128.3"
                    r={mapPulseRadius}
                    fill="none"
                    stroke={BRAND_COLORS.yellow}
                    strokeWidth="5"
                    opacity={mapPulseOpacity}
                  />
                  <circle
                    cx="323.5"
                    cy="128.3"
                    r={Math.max(36, mapPulseRadius * 0.58)}
                    fill="none"
                    stroke={BRAND_COLORS.greenTeamBg}
                    strokeWidth="3.5"
                    strokeDasharray="8 7"
                    opacity={mapPulseOpacity}
                  />
                </svg>
              </div>

              {/* Tactile Landmark Weight Badge anchored cleanly to top-right corner of map sheet */}
              <div
                style={{
                  position: "absolute",
                  top: -20,
                  right: -18,
                  backgroundColor: BRAND_COLORS.yellow,
                  color: BRAND_COLORS.ink,
                  border: `3.5px solid ${BRAND_COLORS.ink}`,
                  borderRadius: 14,
                  padding: "8px 20px",
                  boxShadow: "6px 6px 0px #153D34",
                  fontFamily: BRAND_FONTS.display,
                  fontSize: 40,
                  fontWeight: 700,
                  letterSpacing: "0.03em",
                  lineHeight: 1,
                  rotate: "2.5deg",
                  scale: `${weightTagScale}`,
                }}
              >
                SARINAH · BOBOT 1 → 2
              </div>

              {/* Required map provider & OpenStreetMap attribution */}
              <div
                style={{
                  marginTop: 12,
                  fontFamily: BRAND_FONTS.body,
                  fontSize: 13.5,
                  fontWeight: 600,
                  color: BRAND_COLORS.muted,
                }}
              >
                {BRAND_COPY.mapAttributionShort}
              </div>
            </div>

            {/* Right: Open-Canvas Editorial Typography & Dominant Zone Scoreboard (NO outer slide box) */}
            <div
              style={{
                flex: 1,
                display: "flex",
                flexDirection: "column",
                alignItems: "flex-start",
              }}
            >
              <div
                style={{
                  display: "inline-block",
                  backgroundColor: BRAND_COLORS.yellow,
                  color: BRAND_COLORS.ink,
                  border: `2.5px solid ${BRAND_COLORS.ink}`,
                  borderRadius: 8,
                  padding: "6px 16px",
                  fontFamily: BRAND_FONTS.body,
                  fontSize: 18,
                  fontWeight: 800,
                  letterSpacing: "0.12em",
                  marginBottom: 16,
                }}
              >
                POIN GANDA 2× AKTIF · BOBOT GREEN 2 — YELLOW 1
              </div>

              <div
                style={{
                  fontFamily: BRAND_FONTS.display,
                  fontSize: 108,
                  fontWeight: 700,
                  lineHeight: 0.9,
                  color: BRAND_COLORS.ink,
                  letterSpacing: "-0.015em",
                }}
              >
                SUDIRMAN–THAMRIN
              </div>

              <div
                style={{
                  marginTop: 10,
                  fontFamily: BRAND_FONTS.display,
                  fontSize: 56,
                  fontWeight: 700,
                  lineHeight: 0.96,
                  color: BRAND_COLORS.teal,
                  marginBottom: 38,
                }}
              >
                <HighlightSwipe
                  startFrame={10}
                  endFrame={26}
                  color={BRAND_COLORS.lime}
                  height={18}
                  bottom={4}
                >
                  DIKUASAI GREEN TEAM
                </HighlightSwipe>
              </div>

              {/* Bold Dominant Controlled-Zone Score Row (consistent Green-left / Yellow-right) */}
              <div
                style={{
                  fontFamily: BRAND_FONTS.body,
                  fontSize: 16,
                  fontWeight: 800,
                  letterSpacing: "0.14em",
                  color: BRAND_COLORS.muted,
                  marginBottom: 12,
                }}
              >
                ZONA DIKUASAI
              </div>

              <div
                style={{
                  width: "100%",
                  display: "grid",
                  gridTemplateColumns: "1fr auto 1fr",
                  alignItems: "center",
                  gap: 20,
                }}
              >
                <div
                  style={{
                    backgroundColor: BRAND_COLORS.greenTeamBg,
                    color: BRAND_COLORS.greenTeamText,
                    border: `4px solid ${BRAND_COLORS.ink}`,
                    borderRadius: 20,
                    padding: "20px 28px",
                    boxShadow: "8px 8px 0px #153D34",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                  }}
                >
                  <div>
                    <div
                      style={{
                        fontFamily: BRAND_FONTS.body,
                        fontSize: 20,
                        fontWeight: 800,
                        letterSpacing: "0.08em",
                        color: BRAND_COLORS.lime,
                      }}
                    >
                      GREEN TEAM
                    </div>
                    <div
                      style={{
                        fontFamily: BRAND_FONTS.body,
                        fontSize: 17,
                        fontWeight: 600,
                        marginTop: 4,
                        opacity: 0.9,
                      }}
                    >
                      2 landmark
                    </div>
                  </div>
                  <div
                    style={{
                      fontFamily: BRAND_FONTS.display,
                      fontSize: 142,
                      fontWeight: 700,
                      lineHeight: 0.82,
                      color: BRAND_COLORS.yellow,
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    2
                  </div>
                </div>

                <div
                  style={{
                    fontFamily: BRAND_FONTS.display,
                    fontSize: 64,
                    fontWeight: 700,
                    color: BRAND_COLORS.muted,
                    lineHeight: 1,
                  }}
                >
                  —
                </div>

                <div
                  style={{
                    backgroundColor: BRAND_COLORS.yellowTeamBg,
                    color: BRAND_COLORS.yellowTeamText,
                    border: `3.5px solid ${BRAND_COLORS.ink}`,
                    borderRadius: 20,
                    padding: "20px 28px",
                    boxShadow: "8px 8px 0px #153D34",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                  }}
                >
                  <div>
                    <div
                      style={{
                        fontFamily: BRAND_FONTS.body,
                        fontSize: 20,
                        fontWeight: 800,
                        letterSpacing: "0.08em",
                      }}
                    >
                      YELLOW TEAM
                    </div>
                    <div
                      style={{
                        fontFamily: BRAND_FONTS.body,
                        fontSize: 17,
                        fontWeight: 600,
                        marginTop: 4,
                        opacity: 0.85,
                      }}
                    >
                      2 landmark
                    </div>
                  </div>
                  <div
                    style={{
                      fontFamily: BRAND_FONTS.display,
                      fontSize: 142,
                      fontWeight: 700,
                      lineHeight: 0.82,
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    1
                  </div>
                </div>
              </div>
            </div>
          </AbsoluteFill>
        )}

        {/* PHASE 2 (2.5s - 4.5s): Monumental Open-Canvas Accelerated Clock (102:00 -> 00:00) */}
        {phase2Opacity > 0.005 && (
          <AbsoluteFill
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              padding: "120px 120px 60px",
              opacity: phase2Opacity,
            }}
          >
            <div
              style={{
                fontFamily: BRAND_FONTS.body,
                fontSize: 22,
                fontWeight: 800,
                letterSpacing: "0.2em",
                color: BRAND_COLORS.muted,
                marginBottom: 14,
              }}
            >
              SISA WAKTU RONDE
            </div>

            {/* Giant architectural tabular clock straight on open paper canvas */}
            <div
              style={{
                fontFamily: BRAND_FONTS.display,
                fontSize: 268,
                fontWeight: 700,
                lineHeight: 0.84,
                color: isExpired ? BRAND_COLORS.noticeAccent : BRAND_COLORS.ink,
                fontVariantNumeric: "tabular-nums",
                letterSpacing: "0.015em",
                marginBottom: 34,
              }}
            >
              {clockDisplay}
            </div>

            {/* Crisp full-width round progress rail */}
            <div
              style={{
                width: "100%",
                maxWidth: 1020,
                height: 22,
                backgroundColor: BRAND_COLORS.mint,
                border: `3.5px solid ${BRAND_COLORS.ink}`,
                borderRadius: 999,
                overflow: "hidden",
                boxShadow: "6px 6px 0px #153D34",
                marginBottom: 34,
              }}
            >
              <div
                style={{
                  width: `${elapsedPct}%`,
                  height: "100%",
                  backgroundColor: isExpired
                    ? BRAND_COLORS.yellow
                    : BRAND_COLORS.greenTeamBg,
                }}
              />
            </div>

            {/* Clean open standings anchor underneath clock */}
            <div
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 20,
                fontFamily: BRAND_FONTS.display,
                fontSize: 44,
                fontWeight: 700,
                letterSpacing: "0.04em",
                lineHeight: 1,
              }}
            >
              <span
                style={{
                  backgroundColor: BRAND_COLORS.greenTeamBg,
                  color: BRAND_COLORS.greenTeamText,
                  border: `3px solid ${BRAND_COLORS.ink}`,
                  padding: "8px 22px",
                  borderRadius: 10,
                }}
              >
                GREEN 2 ZONA
              </span>
              <span style={{ color: BRAND_COLORS.muted }}>—</span>
              <span
                style={{
                  backgroundColor: BRAND_COLORS.yellowTeamBg,
                  color: BRAND_COLORS.yellowTeamText,
                  border: `3px solid ${BRAND_COLORS.ink}`,
                  padding: "8px 22px",
                  borderRadius: 10,
                }}
              >
                YELLOW 1 ZONA
              </span>
            </div>
          </AbsoluteFill>
        )}

        {/* PHASE 3 (4.5s - 7.0s): Open-Canvas Unified Expiry + Monumental Victory Result */}
        {phase3Opacity > 0.005 && (
          <AbsoluteFill
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              padding: "110px 104px 56px",
              opacity: phase3Opacity,
              translate: `0px ${phase3Lift}px`,
            }}
          >
            {/* Unified Expiry Header Tag */}
            <div
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 16,
                backgroundColor: BRAND_COLORS.ink,
                color: BRAND_COLORS.yellow,
                border: `3px solid ${BRAND_COLORS.ink}`,
                borderRadius: 12,
                padding: "10px 28px",
                boxShadow: "6px 6px 0px #075C54",
                fontFamily: BRAND_FONTS.display,
                fontSize: 44,
                fontWeight: 700,
                letterSpacing: "0.08em",
                lineHeight: 1,
                marginBottom: 24,
              }}
            >
              <span>00:00</span>
              <span style={{ opacity: 0.45 }}>·</span>
              <span>WAKTU RONDE HABIS</span>
            </div>

            {/* Commanding Open-Canvas Victory Headline */}
            <div
              style={{
                fontFamily: BRAND_FONTS.display,
                fontSize: 138,
                fontWeight: 700,
                lineHeight: 0.9,
                color: BRAND_COLORS.ink,
                letterSpacing: "-0.015em",
                marginBottom: 16,
                textAlign: "center",
              }}
            >
              <HighlightSwipe
                startFrame={140}
                endFrame={156}
                color={BRAND_COLORS.yellow}
                height={28}
                bottom={8}
              >
                GREEN TEAM MENANG
              </HighlightSwipe>
            </div>

            {/* Prominent Score Callout: 2 - 1 ZONA */}
            <div
              style={{
                fontFamily: BRAND_FONTS.display,
                fontSize: 54,
                fontWeight: 700,
                letterSpacing: "0.1em",
                color: BRAND_COLORS.teal,
                lineHeight: 1,
                marginBottom: 38,
              }}
            >
              2 — 1 ZONA
            </div>

            {/* Monumental Controlled-Zone Score Row Directly on Canvas (NO nested white slide box) */}
            <div
              style={{
                width: "100%",
                maxWidth: 1180,
                display: "grid",
                gridTemplateColumns: "1fr auto 1fr",
                alignItems: "center",
                gap: 28,
              }}
            >
              {/* GREEN TEAM — Left */}
              <div
                style={{
                  backgroundColor: BRAND_COLORS.greenTeamBg,
                  color: BRAND_COLORS.greenTeamText,
                  border: `4px solid ${BRAND_COLORS.ink}`,
                  borderRadius: 22,
                  padding: "26px 38px",
                  boxShadow: "10px 10px 0px #153D34",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                }}
              >
                <div>
                  <div
                    style={{
                      fontFamily: BRAND_FONTS.display,
                      fontSize: 48,
                      fontWeight: 700,
                      letterSpacing: "0.03em",
                      lineHeight: 0.95,
                      color: BRAND_COLORS.lime,
                    }}
                  >
                    GREEN TEAM
                  </div>
                  <div
                    style={{
                      fontFamily: BRAND_FONTS.body,
                      fontSize: 20,
                      fontWeight: 700,
                      marginTop: 8,
                    }}
                  >
                    Arga · Naya
                  </div>
                  <div
                    style={{
                      fontFamily: BRAND_FONTS.body,
                      fontSize: 17,
                      fontWeight: 600,
                      opacity: 0.82,
                      marginTop: 2,
                    }}
                  >
                    2 landmark diklaim
                  </div>
                </div>
                <div
                  style={{
                    fontFamily: BRAND_FONTS.display,
                    fontSize: 184,
                    fontWeight: 700,
                    lineHeight: 0.8,
                    color: BRAND_COLORS.yellow,
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  2
                </div>
              </div>

              <div
                style={{
                  fontFamily: BRAND_FONTS.display,
                  fontSize: 80,
                  fontWeight: 700,
                  color: BRAND_COLORS.muted,
                  lineHeight: 1,
                }}
              >
                —
              </div>

              {/* YELLOW TEAM — Right */}
              <div
                style={{
                  backgroundColor: BRAND_COLORS.yellowTeamBg,
                  color: BRAND_COLORS.yellowTeamText,
                  border: `4px solid ${BRAND_COLORS.ink}`,
                  borderRadius: 22,
                  padding: "26px 38px",
                  boxShadow: "10px 10px 0px #153D34",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                }}
              >
                <div>
                  <div
                    style={{
                      fontFamily: BRAND_FONTS.display,
                      fontSize: 48,
                      fontWeight: 700,
                      letterSpacing: "0.03em",
                      lineHeight: 0.95,
                    }}
                  >
                    YELLOW TEAM
                  </div>
                  <div
                    style={{
                      fontFamily: BRAND_FONTS.body,
                      fontSize: 20,
                      fontWeight: 700,
                      marginTop: 8,
                    }}
                  >
                    Bima · Sari
                  </div>
                  <div
                    style={{
                      fontFamily: BRAND_FONTS.body,
                      fontSize: 17,
                      fontWeight: 600,
                      opacity: 0.8,
                      marginTop: 2,
                    }}
                  >
                    2 landmark diklaim
                  </div>
                </div>
                <div
                  style={{
                    fontFamily: BRAND_FONTS.display,
                    fontSize: 184,
                    fontWeight: 700,
                    lineHeight: 0.8,
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  1
                </div>
              </div>
            </div>
          </AbsoluteFill>
        )}
      </AbsoluteFill>
    </PaperSurface>
  );
};
