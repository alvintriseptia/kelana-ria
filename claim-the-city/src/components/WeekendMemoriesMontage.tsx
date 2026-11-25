import React from "react";
import {
  AbsoluteFill,
  Easing,
  Img,
  interpolate,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { PHOTO_ASSETS } from "../config/assets";
import {
  BRAND_COLORS,
  BRAND_FONTS,
  EDITORIAL_SHADOWS,
} from "../config/brand";
import { PaperSurface } from "./PaperSurface";

type MontageSlide = {
  readonly id: string;
  readonly path: string;
  readonly aspectRatio: number;
  readonly theme: string;
  readonly caption: string;
  readonly startFrame: number;
  readonly tiltDeg: number;
  readonly offsetX: number;
  readonly offsetY: number;
  readonly tapeColor: string;
  readonly isHeroSelfie?: boolean;
};

/**
 * Scene 08 Weekend Memories Montage (locked 144 frames / 4.80s).
 * Translates assets/references/- KR_style_Weekend_Memories.png into a restrained,
 * warm tactile notebook spread:
 * - Natural photography color & exact native aspect ratios preserved (zero cropping/damage)
 * - Subtle translucent washi masking-tape tabs & crisp print borders
 * - Strongest visual emphasis & longest hold (2.40s / 72f) on final group selfie KR_S08_PH01
 */
const SLIDES: readonly MontageSlide[] = [
  {
    id: "journey",
    path: PHOTO_ASSETS.mrtWindow.path,
    aspectRatio: PHOTO_ASSETS.mrtWindow.width / PHOTO_ASSETS.mrtWindow.height,
    theme: "Perjalanan",
    caption: "MRT Jakarta",
    startFrame: 0,
    tiltDeg: -1.8,
    offsetX: -28,
    offsetY: 6,
    tapeColor: "rgba(197, 224, 198, 0.85)", // soft Kelana Ria mint tape
  },
  {
    id: "exploration",
    path: PHOTO_ASSETS.gbkArga.path,
    aspectRatio: PHOTO_ASSETS.gbkArga.width / PHOTO_ASSETS.gbkArga.height,
    theme: "Eksplorasi",
    caption: "Gelora Bung Karno",
    startFrame: 24,
    tiltDeg: 1.6,
    offsetX: 26,
    offsetY: -6,
    tapeColor: "rgba(247, 223, 148, 0.85)", // warm brand yellow tape
  },
  {
    id: "moments",
    path: PHOTO_ASSETS.kendalNaya.path,
    aspectRatio: PHOTO_ASSETS.kendalNaya.width / PHOTO_ASSETS.kendalNaya.height,
    theme: "Momen kecil",
    caption: "Terowongan Kendal",
    startFrame: 48,
    tiltDeg: -1.2,
    offsetX: -16,
    offsetY: 8,
    tapeColor: "rgba(232, 212, 184, 0.85)", // warm kraft paper tape
  },
  {
    id: "friendship-final",
    path: PHOTO_ASSETS.warungSelfie.path,
    aspectRatio:
      PHOTO_ASSETS.warungSelfie.width / PHOTO_ASSETS.warungSelfie.height,
    theme: "Kebersamaan",
    caption: "Akhir pekan di Jakarta",
    startFrame: 72,
    tiltDeg: 0,
    offsetX: 0,
    offsetY: 0,
    tapeColor: "rgba(247, 223, 148, 0.9)",
    isHeroSelfie: true,
  },
];

const WashiTapeTab: React.FC<{
  readonly color: string;
  readonly style: React.CSSProperties;
}> = ({ color, style }) => (
  <div
    style={{
      position: "absolute",
      width: 112,
      height: 28,
      backgroundColor: color,
      borderInline: "1px dashed rgba(21, 61, 52, 0.18)",
      boxShadow: "0 2px 6px rgba(18, 47, 41, 0.08)",
      pointerEvents: "none",
      ...style,
    }}
  />
);

export const WeekendMemoriesMontage: React.FC = () => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();

  // Crisp photographic camera flash right at the shutter click (frames 0..9)
  const flashOpacity = interpolate(frame, [0, 2, 10], [0.96, 0.96, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.cubic),
  });

  // Gentle warm dissolve out into Scene 09 Brand Reveal
  const endFadeOpacity = interpolate(
    frame,
    [durationInFrames - 10, durationInFrames],
    [1, 0],
    {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    },
  );

  return (
    <PaperSurface variant="memories">
      {/* Restrained scrapbook spread center crease & subtle paper warmth (no clutter) */}
      <AbsoluteFill style={{ pointerEvents: "none", opacity: endFadeOpacity }}>
        <div
          style={{
            position: "absolute",
            top: 28,
            bottom: 28,
            left: "50%",
            width: 2,
            background:
              "linear-gradient(to bottom, transparent, rgba(82, 103, 92, 0.16) 15%, rgba(82, 103, 92, 0.16) 85%, transparent)",
          }}
        />
      </AbsoluteFill>

      <AbsoluteFill
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          opacity: endFadeOpacity,
        }}
      >
        {SLIDES.map((slide, index) => {
          const localFrame = frame - slide.startFrame;
          if (localFrame < 0) {
            return null;
          }

          const isFirst = index === 0;
          const isFinal = index === SLIDES.length - 1;
          const nextSlideStart =
            index < SLIDES.length - 1
              ? SLIDES[index + 1].startFrame
              : durationInFrames;

          const enterProgress = isFirst
            ? 1
            : interpolate(localFrame, [0, 10], [0, 1], {
                extrapolateLeft: "clamp",
                extrapolateRight: "clamp",
                easing: Easing.bezier(0.16, 1, 0.3, 1),
              });

          const slideOpacity = isFirst
            ? 1
            : interpolate(localFrame, [0, 5], [0, 1], {
                extrapolateLeft: "clamp",
                extrapolateRight: "clamp",
              });

          const settleScale = isFinal
            ? interpolate(
                localFrame,
                [0, 12, durationInFrames - slide.startFrame],
                [0.96, 1, 1.022],
                {
                  extrapolateLeft: "clamp",
                  extrapolateRight: "clamp",
                  easing: Easing.out(Easing.quad),
                },
              )
            : interpolate(enterProgress, [0, 1], [0.96, 1]);

          const translateY = interpolate(
            enterProgress,
            [0, 1],
            [28, slide.offsetY],
          );

          // Generous physical print dimensions preserving exact native aspect ratios
          const photoHeight = slide.isHeroSelfie ? 860 : 790;
          const photoWidth = Math.round(photoHeight * slide.aspectRatio);

          const coveredDim =
            !isFinal && frame >= nextSlideStart
              ? interpolate(
                  frame,
                  [nextSlideStart, nextSlideStart + 8],
                  [1, 0.25],
                  {
                    extrapolateLeft: "clamp",
                    extrapolateRight: "clamp",
                  },
                )
              : 1;

          return (
            <div
              key={slide.id}
              style={{
                position: "absolute",
                backgroundColor: BRAND_COLORS.card,
                padding: slide.isHeroSelfie
                  ? "18px 18px 60px 18px"
                  : "18px 18px 56px 18px",
                borderRadius: 6,
                border: `1.5px solid ${BRAND_COLORS.line}`,
                boxShadow: EDITORIAL_SHADOWS.photoPrint,
                opacity: slideOpacity * coveredDim,
                translate: `${slide.offsetX}px ${translateY}px`,
                scale: `${settleScale}`,
                rotate: `${slide.tiltDeg}deg`,
              }}
            >
              {/* Subtle tactile masking-tape corners inspired by Weekend Memories reference */}
              <WashiTapeTab
                color={slide.tapeColor}
                style={{ top: -11, left: 26, rotate: "-8deg" }}
              />
              <WashiTapeTab
                color={slide.tapeColor}
                style={{ top: -11, right: 26, rotate: "7deg" }}
              />

              <Img
                src={staticFile(slide.path)}
                style={{
                  width: photoWidth,
                  height: photoHeight,
                  objectFit: "contain",
                  display: "block",
                  borderRadius: 2,
                }}
              />

              <div
                style={{
                  position: "absolute",
                  left: 24,
                  right: 24,
                  bottom: 14,
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "baseline",
                }}
              >
                <span
                  style={{
                    fontFamily: BRAND_FONTS.body,
                    fontSize: slide.isHeroSelfie ? 24 : 21,
                    fontWeight: 700,
                    color: BRAND_COLORS.ink,
                  }}
                >
                  {slide.caption}
                </span>
                <span
                  style={{
                    fontFamily: BRAND_FONTS.body,
                    fontSize: 16,
                    fontWeight: 700,
                    letterSpacing: "0.1em",
                    textTransform: "uppercase",
                    color: BRAND_COLORS.muted,
                  }}
                >
                  {slide.theme}
                </span>
              </div>
            </div>
          );
        })}
      </AbsoluteFill>

      {/* Camera shutter flash transition at exact shutter click */}
      {flashOpacity > 0.005 && (
        <AbsoluteFill
          style={{
            backgroundColor: "#FFFEF9",
            opacity: flashOpacity,
            pointerEvents: "none",
          }}
        />
      )}
    </PaperSurface>
  );
};
