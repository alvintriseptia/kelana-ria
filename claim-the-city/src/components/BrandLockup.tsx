import React from "react";
import { Img, staticFile } from "remotion";
import { BRAND_ASSETS } from "../config/assets";
import { BRAND_COLORS, BRAND_COPY, BRAND_FONTS } from "../config/brand";

type BrandLockupProps = {
  readonly iconSize?: number;
  readonly fontSize?: number;
  readonly gap?: number;
  readonly color?: string;
};

/**
 * Authoritative Kelana Ria masthead lockup.
 * Matches assets/brands/source-reference/masthead-lockup.html and style.css:
 * icon symbol + live text "Kelana Ria" in Barlow Condensed 700, line-height 1, letter-spacing -0.035em.
 */
export const BrandLockup: React.FC<BrandLockupProps> = ({
  iconSize = 84,
  fontSize = 78,
  gap = 24,
  color = BRAND_COLORS.ink,
}) => {
  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap,
      }}
    >
      <Img
        src={staticFile(BRAND_ASSETS.icon512)}
        style={{
          width: iconSize,
          height: iconSize,
          borderRadius: Math.round(iconSize * 0.2),
          display: "block",
          boxShadow: "0 4px 14px rgba(19, 62, 53, 0.16)",
        }}
      />
      <span
        style={{
          fontFamily: BRAND_FONTS.display,
          fontWeight: 700,
          fontSize,
          lineHeight: 1,
          letterSpacing: "-0.035em",
          color,
        }}
      >
        {BRAND_COPY.brandName}
      </span>
    </div>
  );
};
