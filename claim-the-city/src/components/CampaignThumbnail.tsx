import React from "react";
import { AbsoluteFill, Img, staticFile } from "remotion";
import { PHOTO_ASSETS } from "../config/assets";
import { BRAND_COLORS, BRAND_COPY, BRAND_FONTS, useBrandFonts } from "../config/brand";
import { BrandLockup } from "./BrandLockup";
import { PaperSurface } from "./PaperSurface";

/**
 * Milestone 4.0 Campaign Thumbnail (1920 x 1080) — Jakarta Playground editorial poster direction.
 * Uses strictly existing approved campaign photography (KR_S08_PH01 group photo with natural
 * Green & Yellow team wardrobe) and official Kelana Ria brand assets.
 * Designed for high contrast and instant legibility at small mobile/YouTube thumbnail sizes.
 */
export const CampaignThumbnail: React.FC = () => {
  useBrandFonts();

  return (
    <PaperSurface variant="playground">
      {/* Subtle diagonal warm-yellow accent band behind right photo stage */}
      <div
        style={{
          position: "absolute",
          top: -80,
          right: -60,
          width: 980,
          height: 1260,
          backgroundColor: BRAND_COLORS.mint,
          borderLeft: `4px solid ${BRAND_COLORS.ink}`,
          rotate: "-3deg",
        }}
      />

      <AbsoluteFill
        style={{
          display: "flex",
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "62px 76px",
          gap: 44,
        }}
      >
        {/* LEFT COLUMN — Official Brand Identity, Monumental Editorial Title & Team Tokens */}
        <div
          style={{
            width: 780,
            display: "flex",
            flexDirection: "column",
            alignItems: "flex-start",
            justifyContent: "center",
            flexShrink: 0,
            zIndex: 2,
          }}
        >
          {/* Official Kelana Ria Brand Lockup */}
          <div
            style={{
              backgroundColor: BRAND_COLORS.card,
              border: `3.5px solid ${BRAND_COLORS.ink}`,
              borderRadius: 16,
              padding: "12px 24px",
              boxShadow: "7px 7px 0px #153D34",
              marginBottom: 42,
            }}
          >
            <BrandLockup iconSize={62} fontSize={62} gap={18} />
          </div>

          {/* Monumental Primary Title: CLAIM THE CITY (readable even at 240px width) */}
          <div
            style={{
              fontFamily: BRAND_FONTS.display,
              fontSize: 212,
              fontWeight: 700,
              lineHeight: 0.86,
              letterSpacing: "-0.02em",
              color: BRAND_COLORS.ink,
              textTransform: "uppercase",
              marginBottom: 28,
            }}
          >
            <div>CLAIM</div>
            <div style={{ position: "relative", display: "inline-block", marginTop: 6 }}>
              <span
                style={{
                  position: "absolute",
                  left: -10,
                  right: -10,
                  bottom: 10,
                  height: 46,
                  backgroundColor: BRAND_COLORS.yellow,
                  borderRadius: 6,
                  zIndex: 0,
                }}
              />
              <span style={{ position: "relative", zIndex: 1 }}>THE CITY</span>
            </div>
          </div>

          {/* Clear Green vs Yellow Team Board-Game Tokens (crisp single-line) */}
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 14,
              marginBottom: 36,
            }}
          >
            <div
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 10,
                backgroundColor: BRAND_COLORS.greenTeamBg,
                color: BRAND_COLORS.greenTeamText,
                border: `4px solid ${BRAND_COLORS.ink}`,
                borderRadius: 14,
                padding: "13px 22px",
                boxShadow: "6px 6px 0px #153D34",
                fontFamily: BRAND_FONTS.display,
                fontSize: 46,
                fontWeight: 700,
                letterSpacing: "0.04em",
                lineHeight: 1,
                whiteSpace: "nowrap",
                rotate: "-1.5deg",
              }}
            >
              <span
                style={{
                  width: 14,
                  height: 14,
                  backgroundColor: BRAND_COLORS.lime,
                  rotate: "45deg",
                  display: "inline-block",
                  flexShrink: 0,
                }}
              />
              GREEN TEAM
            </div>

            <div
              style={{
                backgroundColor: BRAND_COLORS.paper,
                color: BRAND_COLORS.ink,
                border: `3.5px solid ${BRAND_COLORS.ink}`,
                borderRadius: 999,
                padding: "10px 16px",
                fontFamily: BRAND_FONTS.display,
                fontSize: 36,
                fontWeight: 700,
                lineHeight: 1,
                whiteSpace: "nowrap",
                boxShadow: "4px 4px 0px #153D34",
              }}
            >
              VS
            </div>

            <div
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 10,
                backgroundColor: BRAND_COLORS.yellowTeamBg,
                color: BRAND_COLORS.yellowTeamText,
                border: `4px solid ${BRAND_COLORS.ink}`,
                borderRadius: 14,
                padding: "13px 22px",
                boxShadow: "6px 6px 0px #153D34",
                fontFamily: BRAND_FONTS.display,
                fontSize: 46,
                fontWeight: 700,
                letterSpacing: "0.04em",
                lineHeight: 1,
                whiteSpace: "nowrap",
                rotate: "1.5deg",
              }}
            >
              <span
                style={{
                  width: 14,
                  height: 14,
                  backgroundColor: BRAND_COLORS.ink,
                  rotate: "45deg",
                  display: "inline-block",
                  flexShrink: 0,
                }}
              />
              YELLOW TEAM
            </div>
          </div>

          {/* Concise Brand Tagline */}
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 16,
              fontFamily: BRAND_FONTS.body,
              fontSize: 38,
              fontWeight: 800,
              color: BRAND_COLORS.ink,
              letterSpacing: "-0.015em",
            }}
          >
            <span>{BRAND_COPY.tagline}</span>
            <span
              style={{
                backgroundColor: BRAND_COLORS.ink,
                color: BRAND_COLORS.yellow,
                fontFamily: BRAND_FONTS.display,
                fontSize: 34,
                fontWeight: 700,
                letterSpacing: "0.1em",
                padding: "6px 18px",
                borderRadius: 10,
                lineHeight: 1,
              }}
            >
              JAKARTA
            </span>
          </div>
        </div>

        {/* RIGHT STAGE — Human-Centered Approved Photography with Layered Board-Game Paper Cards */}
        <div
          style={{
            position: "relative",
            width: 960,
            height: 820,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
            zIndex: 2,
          }}
        >
          {/* Back decorative board-game card (Yellow Team accent sheet) */}
          <div
            style={{
              position: "absolute",
              width: 896,
              height: 642,
              backgroundColor: BRAND_COLORS.yellow,
              border: `5px solid ${BRAND_COLORS.ink}`,
              borderRadius: 24,
              boxShadow: "10px 10px 0px #153D34",
              rotate: "3.4deg",
              transform: "translate(14px, -10px)",
            }}
          />

          {/* Mid decorative board-game card (Green Team accent sheet) */}
          <div
            style={{
              position: "absolute",
              width: 896,
              height: 642,
              backgroundColor: BRAND_COLORS.greenTeamBg,
              border: `5px solid ${BRAND_COLORS.ink}`,
              borderRadius: 24,
              rotate: "-3.6deg",
              transform: "translate(-16px, 14px)",
            }}
          />

          {/* Primary Hero Group Photograph — All 4 Friends in Green & Yellow Team Outfits */}
          <div
            style={{
              position: "relative",
              width: 896,
              backgroundColor: BRAND_COLORS.card,
              border: `5px solid ${BRAND_COLORS.ink}`,
              borderRadius: 22,
              padding: "16px 16px 24px",
              boxShadow: "14px 14px 0px #153D34",
              rotate: "-0.8deg",
            }}
          >
            {/* Washi tape top accents */}
            <div
              style={{
                position: "absolute",
                top: -16,
                left: 60,
                width: 136,
                height: 32,
                backgroundColor: "rgba(255, 206, 85, 0.92)",
                border: "2px solid rgba(21, 61, 52, 0.35)",
                rotate: "-6deg",
              }}
            />
            <div
              style={{
                position: "absolute",
                top: -16,
                right: 60,
                width: 136,
                height: 32,
                backgroundColor: "rgba(217, 241, 129, 0.92)",
                border: "2px solid rgba(21, 61, 52, 0.35)",
                rotate: "5deg",
              }}
            />

            <div
              style={{
                width: "100%",
                aspectRatio: "16 / 9.8",
                overflow: "hidden",
                borderRadius: 12,
                border: `3px solid ${BRAND_COLORS.ink}`,
              }}
            >
              <Img
                src={staticFile(PHOTO_ASSETS.warungSelfie.path)}
                style={{
                  width: "100%",
                  height: "100%",
                  objectFit: "cover",
                  objectPosition: "50% 62%",
                  display: "block",
                }}
              />
            </div>

            {/* Clean editorial print footer */}
            <div
              style={{
                marginTop: 14,
                paddingInline: 8,
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
              }}
            >
              <span
                style={{
                  fontFamily: BRAND_FONTS.display,
                  fontSize: 38,
                  fontWeight: 700,
                  letterSpacing: "0.06em",
                  color: BRAND_COLORS.ink,
                  lineHeight: 1,
                }}
              >
                SATU KOTA. DUA TIM.
              </span>
              <span
                style={{
                  backgroundColor: BRAND_COLORS.yellow,
                  color: BRAND_COLORS.ink,
                  border: `2.5px solid ${BRAND_COLORS.ink}`,
                  borderRadius: 8,
                  padding: "4px 14px",
                  fontFamily: BRAND_FONTS.display,
                  fontSize: 30,
                  fontWeight: 700,
                  letterSpacing: "0.08em",
                  lineHeight: 1,
                }}
              >
                {BRAND_COPY.closingCta}
              </span>
            </div>
          </div>
        </div>
      </AbsoluteFill>
    </PaperSurface>
  );
};
