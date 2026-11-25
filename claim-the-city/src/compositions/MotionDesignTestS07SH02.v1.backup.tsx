import { Video } from "@remotion/media";
import React from "react";
import {
  AbsoluteFill,
  Easing,
  Img,
  interpolate,
  staticFile,
  useCurrentFrame,
} from "remotion";
import { FOOTAGE_ASSETS, UI_COMPONENTS, UI_MAPS } from "../config/assets";
import {
  BRAND_COLORS,
  BRAND_COPY,
  BRAND_FONTS,
  EDITORIAL_SHADOWS,
  useBrandFonts,
} from "../config/brand";
import { S07_SH02_CUES } from "../config/timeline";

export type MotionDesignTestProps = {
  readonly footageVolume: number;
};

/**
 * Quiet editorial location badge anchored top-left in negative space (clear of characters).
 * Resolves completely by f202 so the closing stride returns to pure Raw Jakarta.
 */
const LocationLedgerBadge: React.FC = () => {
  const frame = useCurrentFrame();

  const enterOpacity = interpolate(
    frame,
    [S07_SH02_CUES.locationTagEnter, S07_SH02_CUES.locationTagEnter + 12],
    [0, 1],
    {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
      easing: Easing.bezier(0.16, 1, 0.3, 1),
    },
  );
  const exitOpacity = interpolate(frame, [188, 200], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const enterY = interpolate(
    frame,
    [S07_SH02_CUES.locationTagEnter, S07_SH02_CUES.locationTagEnter + 14],
    [-14, 0],
    {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
      easing: Easing.bezier(0.16, 1, 0.3, 1),
    },
  );

  const opacity = enterOpacity * exitOpacity;
  if (opacity <= 0.005) {
    return null;
  }

  return (
    <div
      style={{
        position: "absolute",
        top: 44,
        left: 52,
        display: "inline-flex",
        alignItems: "center",
        gap: 12,
        backgroundColor: BRAND_COLORS.paper,
        border: `2px solid ${BRAND_COLORS.ink}`,
        borderRadius: 12,
        padding: "9px 16px 9px 10px",
        boxShadow: "4px 4px 0px #153D34",
        opacity,
        translate: `0px ${enterY}px`,
      }}
    >
      <div
        style={{
          backgroundColor: BRAND_COLORS.greenTeamBg,
          color: BRAND_COLORS.greenTeamText,
          fontFamily: BRAND_FONTS.display,
          fontWeight: 700,
          fontSize: 22,
          letterSpacing: "0.04em",
          padding: "4px 10px",
          borderRadius: 7,
          lineHeight: 1,
        }}
      >
        GREEN TEAM
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
        <span
          style={{
            fontFamily: BRAND_FONTS.body,
            fontSize: 15,
            fontWeight: 800,
            color: BRAND_COLORS.ink,
            lineHeight: 1.15,
          }}
        >
          Terowongan Kendal
        </span>
        <span
          style={{
            fontFamily: BRAND_FONTS.body,
            fontSize: 12,
            fontWeight: 600,
            color: BRAND_COLORS.muted,
            lineHeight: 1.15,
          }}
        >
          Zona dikuasai: Green 1 — Yellow 2
        </span>
      </div>
    </div>
  );
};

/**
 * Beat 01 — Opportunity notification folio using actual KR_COMPONENT_OPPORTUNITY.png
 * plus tactile "BELUM DIKLAIM" rubber stamp synchronized with Arga's line.
 */
const OpportunityFolioCard: React.FC = () => {
  const frame = useCurrentFrame();

  const enterStart = S07_SH02_CUES.beat01OpportunityEnter;
  const exitStart = S07_SH02_CUES.beat04ExitStart;

  const enterProgress = interpolate(frame, [enterStart, enterStart + 14], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.bezier(0.16, 1, 0.3, 1),
  });
  const exitProgress = interpolate(frame, [exitStart, exitStart + 14], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.bezier(0.7, 0, 0.84, 0),
  });

  const opacity =
    interpolate(frame, [enterStart, enterStart + 8], [0, 1], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    }) *
    interpolate(frame, [exitStart + 2, exitStart + 14], [1, 0], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    });

  if (opacity <= 0.005) {
    return null;
  }

  const translateX =
    interpolate(enterProgress, [0, 1], [68, 0]) +
    interpolate(exitProgress, [0, 1], [0, 48]);
  const translateY = interpolate(exitProgress, [0, 1], [0, -24]);

  // Crisp rubber-stamp settle at f50 ("Sarinah bisa direbut!")
  const stampStart = S07_SH02_CUES.beat01StampPunch;
  const stampOpacity = interpolate(frame, [stampStart, stampStart + 4], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const stampScale = interpolate(
    frame,
    [stampStart, stampStart + 8],
    [1.3, 1],
    {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
      easing: Easing.bezier(0.22, 1, 0.36, 1),
    },
  );

  // Subtle confirmation micro-pulse on Naya's "Gas!" (f168)
  const gasPulse = interpolate(
    frame,
    [
      S07_SH02_CUES.beat04ActionPulse,
      S07_SH02_CUES.beat04ActionPulse + 3,
      S07_SH02_CUES.beat04ActionPulse + 7,
    ],
    [1, 1.014, 1],
    {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    },
  );

  return (
    <div
      style={{
        position: "relative",
        width: "100%",
        backgroundColor: BRAND_COLORS.paper,
        border: `2.5px solid ${BRAND_COLORS.ink}`,
        borderRadius: 18,
        padding: "13px 16px 15px",
        boxShadow: EDITORIAL_SHADOWS.inkOffset,
        opacity,
        translate: `${translateX}px ${translateY}px`,
        scale: `${gasPulse}`,
      }}
    >
      {/* Editorial notice header bar matching .cg-notice terracotta accent */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          backgroundColor: BRAND_COLORS.noticeBg,
          borderLeft: `4px solid ${BRAND_COLORS.noticeAccent}`,
          borderRadius: 8,
          padding: "7px 12px",
          marginBottom: 11,
        }}
      >
        <div style={{ display: "inline-flex", alignItems: "center", gap: 9 }}>
          <span
            style={{
              width: 10,
              height: 10,
              borderRadius: "50%",
              backgroundColor: BRAND_COLORS.pinUnclaimed,
              border: "2px solid #FFFFFF",
              boxShadow: "0 0 0 1.5px #475954",
              display: "inline-block",
            }}
          />
          <span
            style={{
              fontFamily: BRAND_FONTS.body,
              fontSize: 13,
              fontWeight: 800,
              letterSpacing: "0.1em",
              textTransform: "uppercase",
              color: BRAND_COLORS.ink,
            }}
          >
            NOTIFIKASI PELUANG · SUDIRMAN–THAMRIN
          </span>
        </div>
      </div>

      {/* Actual supplied v3 UI notification component cleanly clipped without double border */}
      <div
        style={{
          borderRadius: 20,
          overflow: "hidden",
          backgroundColor: BRAND_COLORS.cloud,
          boxShadow: "0 3px 10px rgba(18, 47, 41, 0.08)",
        }}
      >
        <Img
          src={staticFile(UI_COMPONENTS.opportunity.path)}
          style={{
            width: "100%",
            height: "auto",
            display: "block",
          }}
        />
      </div>

      {/* Rubber-stamp editorial badge reinforcing unclaimed rule — zero text collision */}
      {stampOpacity > 0.01 && (
        <div
          style={{
            position: "absolute",
            top: -15,
            right: 18,
            backgroundColor: BRAND_COLORS.paper,
            border: `3px solid ${BRAND_COLORS.noticeAccent}`,
            borderRadius: 8,
            padding: "5px 13px",
            color: BRAND_COLORS.noticeAccent,
            fontFamily: BRAND_FONTS.display,
            fontSize: 24,
            fontWeight: 700,
            letterSpacing: "0.08em",
            lineHeight: 1,
            boxShadow: "0 4px 10px rgba(18, 47, 41, 0.16)",
            opacity: stampOpacity,
            scale: `${stampScale}`,
            rotate: "-3.5deg",
          }}
        >
          BELUM DIKLAIM
        </div>
      )}
    </div>
  );
};

/**
 * Beat 02 (Left panel) — Authentic Sudirman-Thamrin corridor map excerpt from
 * KR_UI_MAP_BUNDARAN_HI.png showing Kendal -> Bundaran HI (Yellow) -> Sarinah (unclaimed)
 * with curved hand-drawn dashed ink route & preserved OpenFreeMap/OSM attribution.
 */
const CorridorMapCard: React.FC = () => {
  const frame = useCurrentFrame();

  const enterStart = S07_SH02_CUES.beat02MapEnter;
  const exitStart = S07_SH02_CUES.beat04ExitStart + 4;

  const enterProgress = interpolate(frame, [enterStart, enterStart + 14], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.bezier(0.16, 1, 0.3, 1),
  });
  const exitProgress = interpolate(frame, [exitStart, exitStart + 14], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.bezier(0.7, 0, 0.84, 0),
  });

  const opacity =
    interpolate(frame, [enterStart, enterStart + 8], [0, 1], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    }) *
    interpolate(frame, [exitStart + 2, exitStart + 14], [1, 0], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    });

  if (opacity <= 0.005) {
    return null;
  }

  const translateY =
    interpolate(enterProgress, [0, 1], [34, 0]) +
    interpolate(exitProgress, [0, 1], [0, 26]);
  const translateX = interpolate(exitProgress, [0, 1], [0, 40]);

  // Curved hand-drawn ink trajectory skirting cleanly west of Bundaran HI badge
  const pathLength = 395;
  const dashOffset = interpolate(
    frame,
    [S07_SH02_CUES.beat02RouteDrawStart, S07_SH02_CUES.beat02RouteDrawEnd],
    [pathLength, 0],
    {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
      easing: Easing.bezier(0.22, 1, 0.36, 1),
    },
  );

  // Subtle expanding pulse around unclaimed Sarinah pin once route reaches top
  const targetRingOpacity = interpolate(frame, [110, 120], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const targetRingScale = interpolate(
    frame,
    [110, 128, 155],
    [0.78, 1.08, 1],
    {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
      easing: Easing.bezier(0.16, 1, 0.3, 1),
    },
  );

  // Exact verified pixel mapping for KR_UI_MAP_BUNDARAN_HI.png (780x1688):
  // Clean crop window x:20..685 (w=665), y:120..1360 (h=1240) -> viewport 236x440 (ratio 0.536)
  const vpW = 236;
  const vpH = 440;
  const scale = vpW / 665;
  const imgW = Math.round(UI_MAPS.bundaranHiCorridor.width * scale);
  const imgH = Math.round(UI_MAPS.bundaranHiCorridor.height * scale);
  const imgLeft = Math.round(-20 * scale);
  const imgTop = Math.round(-120 * scale);

  // Verified pin positions inside 236x440:
  // Sarinah (462,230) -> (157, 39)
  // Bundaran HI (389,775) -> (131, 232)
  // Kendal (372,1200) -> (125, 383)

  return (
    <div
      style={{
        width: 260,
        backgroundColor: BRAND_COLORS.card,
        border: `2.5px solid ${BRAND_COLORS.ink}`,
        borderRadius: 16,
        padding: "10px 10px 9px",
        boxShadow: EDITORIAL_SHADOWS.inkOffset,
        display: "flex",
        flexDirection: "column",
        gap: 8,
        opacity,
        translate: `${translateX}px ${translateY}px`,
      }}
    >
      <div
        style={{
          position: "relative",
          width: vpW,
          height: vpH,
          overflow: "hidden",
          borderRadius: 10,
          border: `1.5px solid ${BRAND_COLORS.line}`,
          backgroundColor: "#EEF2EE",
        }}
      >
        <Img
          src={staticFile(UI_MAPS.bundaranHiCorridor.path)}
          style={{
            position: "absolute",
            left: imgLeft,
            top: imgTop,
            width: imgW,
            height: imgH,
          }}
        />

        {/* Hand-drawn Jakarta Playground ink route overlay */}
        <svg
          width={vpW}
          height={vpH}
          viewBox={`0 0 ${vpW} ${vpH}`}
          style={{ position: "absolute", inset: 0 }}
        >
          {/* Origin indicator ring at Terowongan Kendal */}
          <circle
            cx="125"
            cy="383"
            r="15"
            fill="rgba(7, 92, 84, 0.18)"
            stroke={BRAND_COLORS.greenTeamBg}
            strokeWidth="2.5"
          />

          {/* Curved dashed ink route skirting neatly around ST · Yellow Team label */}
          <path
            d="M 116 370 C 90 325 78 272 80 226 C 82 162 104 106 144 55"
            fill="none"
            stroke={BRAND_COLORS.greenTeamBg}
            strokeWidth="4.2"
            strokeLinecap="round"
            strokeDasharray="9 8"
            strokeDashoffset={dashOffset}
          />

          {/* Directional arrowhead pointing cleanly into Sarinah */}
          <path
            d="M 131 58 L 146 52 L 144 69"
            fill="none"
            stroke={BRAND_COLORS.greenTeamBg}
            strokeWidth="3.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            opacity={targetRingOpacity}
          />

          {/* Unclaimed target emphasis ring on Relief Sarinah */}
          <g
            style={{
              transformOrigin: "157px 39px",
              opacity: targetRingOpacity,
              scale: `${targetRingScale}`,
            }}
          >
            <circle
              cx="157"
              cy="39"
              r="18"
              fill="none"
              stroke={BRAND_COLORS.noticeAccent}
              strokeWidth="3.2"
            />
          </g>
        </svg>

        {/* Clean single-line editorial map tags — zero label collisions */}
        <div
          style={{
            position: "absolute",
            top: 29,
            left: 56,
            backgroundColor: BRAND_COLORS.ink,
            color: BRAND_COLORS.yellow,
            fontFamily: BRAND_FONTS.body,
            fontSize: 11,
            fontWeight: 800,
            letterSpacing: "0.06em",
            padding: "3px 8px",
            borderRadius: 6,
            boxShadow: "0 2px 6px rgba(18, 47, 41, 0.25)",
          }}
        >
          SARINAH
        </div>

        <div
          style={{
            position: "absolute",
            top: 373,
            left: 26,
            backgroundColor: BRAND_COLORS.greenTeamBg,
            color: "#FFFFFF",
            fontFamily: BRAND_FONTS.body,
            fontSize: 11,
            fontWeight: 800,
            letterSpacing: "0.06em",
            padding: "3px 8px",
            borderRadius: 6,
            boxShadow: "0 2px 6px rgba(18, 47, 41, 0.25)",
          }}
        >
          KENDAL
        </div>
      </div>

      {/* Required map attribution preserved legibly */}
      <div
        style={{
          fontFamily: BRAND_FONTS.body,
          fontSize: 10.5,
          fontWeight: 600,
          color: BRAND_COLORS.muted,
          lineHeight: 1.25,
          paddingInline: 2,
        }}
      >
        {BRAND_COPY.mapAttributionShort}
      </div>
    </div>
  );
};

/**
 * Beat 02 (Right-upper panel) — Concise corridor summary card matching Naya's "Deket dong dari sini!".
 */
const LocationContextCard: React.FC = () => {
  const frame = useCurrentFrame();

  const enterStart = S07_SH02_CUES.beat02MapEnter + 4;
  const exitStart = S07_SH02_CUES.beat04ExitStart + 4;

  const enterProgress = interpolate(frame, [enterStart, enterStart + 12], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.bezier(0.16, 1, 0.3, 1),
  });
  const exitProgress = interpolate(frame, [exitStart, exitStart + 14], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.bezier(0.7, 0, 0.84, 0),
  });

  const opacity =
    interpolate(frame, [enterStart, enterStart + 8], [0, 1], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    }) *
    interpolate(frame, [exitStart + 2, exitStart + 14], [1, 0], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    });

  if (opacity <= 0.005) {
    return null;
  }

  const translateX =
    interpolate(enterProgress, [0, 1], [44, 0]) +
    interpolate(exitProgress, [0, 1], [0, 52]);

  return (
    <div
      style={{
        width: "100%",
        backgroundColor: BRAND_COLORS.paper,
        border: `2.5px solid ${BRAND_COLORS.ink}`,
        borderRadius: 16,
        padding: "14px 16px 15px",
        boxShadow: EDITORIAL_SHADOWS.inkOffset,
        opacity,
        translate: `${translateX}px 0px`,
      }}
    >
      <div
        style={{
          fontFamily: BRAND_FONTS.body,
          fontSize: 12,
          fontWeight: 800,
          letterSpacing: "0.12em",
          textTransform: "uppercase",
          color: BRAND_COLORS.teal,
          marginBottom: 4,
        }}
      >
        ZONA SUDIRMAN–THAMRIN
      </div>
      <div
        style={{
          fontFamily: BRAND_FONTS.display,
          fontSize: 38,
          fontWeight: 700,
          lineHeight: 0.96,
          color: BRAND_COLORS.ink,
          marginBottom: 11,
        }}
      >
        KENDAL → RELIEF SARINAH
      </div>

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 7,
          borderTop: `1.5px dashed ${BRAND_COLORS.line}`,
          paddingTop: 9,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            fontFamily: BRAND_FONTS.body,
            fontSize: 13.5,
          }}
        >
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              fontWeight: 700,
              color: BRAND_COLORS.ink,
            }}
          >
            <span
              style={{
                width: 10,
                height: 10,
                borderRadius: "50%",
                backgroundColor: BRAND_COLORS.pinUnclaimed,
                display: "inline-block",
              }}
            />
            Relief Sarinah
          </span>
          <span
            style={{
              fontWeight: 800,
              color: BRAND_COLORS.noticeAccent,
              fontSize: 12.5,
            }}
          >
            Belum diklaim
          </span>
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            fontFamily: BRAND_FONTS.body,
            fontSize: 13.5,
          }}
        >
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              fontWeight: 700,
              color: BRAND_COLORS.ink,
            }}
          >
            <span
              style={{
                width: 10,
                height: 10,
                borderRadius: 2,
                backgroundColor: BRAND_COLORS.yellowTeamBg,
                border: `1.5px solid ${BRAND_COLORS.yellowTeamText}`,
                display: "inline-block",
              }}
            />
            Bundaran HI
          </span>
          <span
            style={{
              fontWeight: 700,
              color: BRAND_COLORS.muted,
              fontSize: 12.5,
            }}
          >
            Yellow Team · Bobot 1
          </span>
        </div>
      </div>
    </div>
  );
};

/**
 * Beat 03 (Right-lower panel) — Poin Ganda tactical card reveal using actual
 * KR_COMPONENT_POIN_GANDA.png, clearly labeled as AVAILABLE IN INVENTORY (not activated).
 */
const PoinGandaTacticalCard: React.FC = () => {
  const frame = useCurrentFrame();

  const enterStart = S07_SH02_CUES.beat03CardEnter;
  const exitStart = S07_SH02_CUES.beat04ExitStart + 7;

  const enterProgress = interpolate(frame, [enterStart, enterStart + 14], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.bezier(0.16, 1, 0.3, 1),
  });
  const exitProgress = interpolate(frame, [exitStart, exitStart + 14], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.bezier(0.7, 0, 0.84, 0),
  });

  const opacity =
    interpolate(frame, [enterStart, enterStart + 8], [0, 1], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    }) *
    interpolate(frame, [exitStart + 2, exitStart + 14], [1, 0], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    });

  if (opacity <= 0.005) {
    return null;
  }

  const translateY =
    interpolate(enterProgress, [0, 1], [44, 0]) +
    interpolate(exitProgress, [0, 1], [0, 34]);
  const translateX = interpolate(exitProgress, [0, 1], [0, 42]);
  const cardRotate = interpolate(enterProgress, [0, 1], [1.5, -0.6]);

  // Highlighter sweep synced exactly to Arga's vocal emphasis "Poin Ganda!" (f144)
  const highlightWidthPct = interpolate(
    frame,
    [S07_SH02_CUES.beat03HighlightSweep, S07_SH02_CUES.beat03HighlightSweep + 11],
    [0, 100],
    {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
      easing: Easing.bezier(0.22, 1, 0.36, 1),
    },
  );

  // Subtle tactile confirmation on Naya's "Gas!" (f168)
  const gasPulse = interpolate(
    frame,
    [
      S07_SH02_CUES.beat04ActionPulse,
      S07_SH02_CUES.beat04ActionPulse + 3,
      S07_SH02_CUES.beat04ActionPulse + 7,
    ],
    [1, 1.018, 1],
    {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    },
  );

  return (
    <div
      style={{
        width: "100%",
        flex: 1,
        backgroundColor: BRAND_COLORS.tacticCardBg,
        border: `2.5px solid ${BRAND_COLORS.greenTeamBg}`,
        borderRadius: 18,
        overflow: "hidden",
        boxShadow: EDITORIAL_SHADOWS.greenOffset,
        display: "flex",
        flexDirection: "column",
        opacity,
        translate: `${translateX}px ${translateY}px`,
        rotate: `${cardRotate}deg`,
        scale: `${gasPulse}`,
      }}
    >
      {/* Green Team inventory header bar */}
      <div
        style={{
          backgroundColor: BRAND_COLORS.greenTeamBg,
          color: BRAND_COLORS.greenTeamText,
          padding: "10px 15px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <span
          style={{
            fontFamily: BRAND_FONTS.body,
            fontSize: 12.5,
            fontWeight: 800,
            letterSpacing: "0.1em",
            textTransform: "uppercase",
          }}
        >
          INVENTARIS · KARTU TAKTIS
        </span>
        <span
          style={{
            backgroundColor: BRAND_COLORS.lime,
            color: BRAND_COLORS.uiInk,
            fontFamily: BRAND_FONTS.body,
            fontSize: 11.5,
            fontWeight: 800,
            letterSpacing: "0.06em",
            padding: "4px 10px",
            borderRadius: 999,
          }}
        >
          TERSEDIA (1)
        </span>
      </div>

      {/* Main card content */}
      <div
        style={{
          padding: "15px 15px 13px",
          display: "flex",
          flexDirection: "column",
          gap: 12,
          flex: 1,
          justifyContent: "space-between",
        }}
      >
        {/* Editorial title with animated #FFCE55 yellow highlighter accent */}
        <div>
          <div
            style={{
              position: "relative",
              display: "inline-block",
              paddingInline: 5,
            }}
          >
            <div
              style={{
                position: "absolute",
                left: 0,
                bottom: 4,
                height: 16,
                width: `${highlightWidthPct}%`,
                backgroundColor: BRAND_COLORS.yellow,
                borderRadius: 4,
                zIndex: 0,
              }}
            />
            <span
              style={{
                position: "relative",
                zIndex: 1,
                fontFamily: BRAND_FONTS.display,
                fontSize: 44,
                fontWeight: 700,
                lineHeight: 1,
                color: BRAND_COLORS.ink,
                letterSpacing: "-0.01em",
              }}
            >
              POIN GANDA (2×)
            </span>
          </div>
        </div>

        {/* Actual supplied v3 isolated Poin Ganda component */}
        <div
          style={{
            backgroundColor: BRAND_COLORS.cloud,
            border: `1.5px solid ${BRAND_COLORS.edge}`,
            borderRadius: 12,
            padding: "9px 10px",
            boxShadow: "0 3px 10px rgba(18, 47, 41, 0.08)",
          }}
        >
          <Img
            src={staticFile(UI_COMPONENTS.poinGanda.path)}
            style={{
              width: "100%",
              height: "auto",
              display: "block",
              borderRadius: 6,
            }}
          />
        </div>

        {/* Explicit rule-accurate inventory footer: NOT activated yet */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            borderTop: `1.5px dashed ${BRAND_COLORS.edge}`,
            paddingTop: 9,
            fontFamily: BRAND_FONTS.body,
            fontSize: 12.5,
            fontWeight: 700,
            color: BRAND_COLORS.teal,
          }}
        >
          <span>Siap dipakai setelah klaim berhasil</span>
          <span
            style={{
              color: BRAND_COLORS.muted,
              fontWeight: 600,
              fontSize: 11.5,
            }}
          >
            Belum aktif
          </span>
        </div>
      </div>
    </div>
  );
};

/**
 * Deliverable 2 — KR-MotionDesign-Test-S07-SH02
 * Polished motion-design prototype built around the natural framing and dialogue
 * of KR_SH07_SH02.mp4 (Arga & Naya at Terowongan Kendal).
 */
export const MotionDesignTestS07SH02: React.FC<MotionDesignTestProps> = ({
  footageVolume,
}) => {
  useBrandFonts();

  return (
    <AbsoluteFill style={{ backgroundColor: BRAND_COLORS.uiInk }}>
      {/* Raw Jakarta live-action foundation — untouched framing, color, dialogue & ambient audio */}
      <Video
        src={staticFile(FOOTAGE_ASSETS.KR_S07_SH02.path)}
        volume={footageVolume}
        objectFit="cover"
        style={{
          width: "100%",
          height: "100%",
        }}
      />

      {/* Quiet top-left editorial location badge */}
      <LocationLedgerBadge />

      {/* Right-side Jakarta Playground editorial dossier cleanly clear of Naya's right sleeve */}
      <div
        style={{
          position: "absolute",
          top: 94,
          right: 40,
          width: 696,
          display: "flex",
          flexDirection: "column",
          gap: 18,
          pointerEvents: "none",
        }}
      >
        {/* Row 1: Beat 01 — Opportunity notification */}
        <OpportunityFolioCard />

        {/* Row 2: Beat 02 Corridor Map (Left) + Context & Beat 03 Poin Ganda (Right) */}
        <div
          style={{
            display: "flex",
            gap: 18,
            alignItems: "stretch",
            height: 504,
          }}
        >
          <CorridorMapCard />

          <div
            style={{
              flex: 1,
              display: "flex",
              flexDirection: "column",
              gap: 16,
            }}
          >
            <LocationContextCard />
            <PoinGandaTacticalCard />
          </div>
        </div>
      </div>
    </AbsoluteFill>
  );
};
