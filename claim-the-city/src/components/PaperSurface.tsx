import React from "react";
import { AbsoluteFill } from "remotion";
import { BRAND_COLORS } from "../config/brand";

type PaperSurfaceProps = {
  readonly children: React.ReactNode;
  readonly variant?: "playground" | "memories" | "brand";
};

/**
 * Tactile printed-paper canvas inspired by KR_style_Jakarta_Playground.png
 * and Kelana Ria's #F7F6ED paper shell. Completely deterministic SVG + CSS.
 */
export const PaperSurface: React.FC<PaperSurfaceProps> = ({
  children,
  variant = "playground",
}) => {
  const showDiagonalMint = variant === "playground" || variant === "brand";

  return (
    <AbsoluteFill
      style={{
        backgroundColor: BRAND_COLORS.paper,
        overflow: "hidden",
      }}
    >
      {/* Subtle geometric print paper wash */}
      {showDiagonalMint && (
        <svg
          width="1920"
          height="1080"
          viewBox="0 0 1920 1080"
          style={{ position: "absolute", inset: 0, pointerEvents: "none" }}
        >
          <polygon
            points="1260,0 1920,0 1920,1080 940,1080"
            fill={BRAND_COLORS.mint}
            opacity={variant === "brand" ? 0.55 : 0.72}
          />
          <polygon
            points="0,780 540,1080 0,1080"
            fill={BRAND_COLORS.yellow}
            opacity={variant === "brand" ? 0.14 : 0.12}
          />
          {/* Subtle architectural city-grid lines inspired by Jakarta Playground reference */}
          <g stroke={BRAND_COLORS.line} strokeWidth="1.5" opacity={0.45}>
            <line x1="0" y1="220" x2="1920" y2="160" />
            <line x1="0" y1="620" x2="1920" y2="540" />
            <line x1="0" y1="920" x2="1920" y2="850" />
            <line x1="340" y1="0" x2="420" y2="1080" />
            <line x1="960" y1="0" x2="1030" y2="1080" />
            <line x1="1520" y1="0" x2="1590" y2="1080" />
          </g>
          {/* Dashed transit corridor lines */}
          <path
            d="M 120 1040 Q 640 720 1120 420 T 1860 110"
            fill="none"
            stroke={BRAND_COLORS.catalogLine}
            strokeWidth="2.5"
            strokeDasharray="10 10"
            opacity={0.4}
          />
        </svg>
      )}

      {/* Subtle tactile border frame */}
      <div
        style={{
          position: "absolute",
          inset: 28,
          border: `1.5px solid ${BRAND_COLORS.line}`,
          borderRadius: 20,
          pointerEvents: "none",
        }}
      />

      {children}
    </AbsoluteFill>
  );
};
