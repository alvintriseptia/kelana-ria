import { Audio, Video } from "@remotion/media";
import React from "react";
import {
  AbsoluteFill,
  interpolate,
  Sequence,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { BrandRevealScene } from "../components/BrandRevealScene";
import { InterludePlaceholder } from "../components/InterludePlaceholder";
import { CampaignSceneOverlays } from "../components/motion/CampaignSceneOverlays";
import { WeekendMemoriesMontage } from "../components/WeekendMemoriesMontage";
import { FOOTAGE_ASSETS } from "../config/assets";
import { BRAND_COLORS, BRAND_FONTS, useBrandFonts } from "../config/brand";
import { buildRoughCutTimeline } from "../config/timeline";

export type RoughCutProps = {
  /** Shows DEV PLACEHOLDER banners on graphic interludes (keep false for clean review exports). */
  readonly showPlaceholders: boolean;
  /** Shows a top-right shot slate in dev previews (keep false for clean review exports). */
  readonly showDevShotSlate: boolean;
  /** Uses the mastered 48 kHz stereo mix (dialogue + Funky Triplets + tactile SFX) when true. */
  readonly useMasterAudioMix?: boolean;
};

/**
 * Isolated frame-subscribed video clip so short edge audio fades avoid clicks or abrupt cuts.
 */
const SmoothedFootageClip: React.FC<{
  readonly src: string;
  readonly trimBefore: number;
  readonly durationInFrames: number;
  readonly baseVolume: number;
  readonly fadeFrames: number;
  readonly skipInFade?: boolean;
  readonly skipOutFade?: boolean;
  readonly muted?: boolean;
}> = ({
  src,
  trimBefore,
  durationInFrames,
  baseVolume,
  fadeFrames,
  skipInFade = false,
  skipOutFade = false,
  muted = false,
}) => {
  const frame = useCurrentFrame();
  const safeFade = Math.min(fadeFrames, Math.floor(durationInFrames / 4));

  const fadeIn =
    !skipInFade && safeFade > 0
      ? interpolate(frame, [0, safeFade], [0, 1], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        })
      : 1;

  const fadeOut =
    !skipOutFade && safeFade > 0
      ? interpolate(
          frame,
          [durationInFrames - safeFade, durationInFrames],
          [1, 0],
          {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          },
        )
      : 1;

  return (
    <Video
      src={src}
      trimBefore={trimBefore}
      durationInFrames={durationInFrames}
      volume={muted ? 0 : baseVolume * fadeIn * fadeOut}
      muted={muted}
      objectFit="cover"
      style={{
        width: "100%",
        height: "100%",
      }}
    />
  );
};

/**
 * Isolated J-cut ambience audio lead fading in cleanly before the visual cut.
 */
const AudioJCutLead: React.FC<{
  readonly src: string;
  readonly trimBefore: number;
  readonly durationInFrames: number;
  readonly baseVolume: number;
  readonly crossfadeFrames: number;
}> = ({ src, trimBefore, durationInFrames, baseVolume, crossfadeFrames }) => {
  const frame = useCurrentFrame();
  const fadeIn = interpolate(
    frame,
    [0, Math.min(10, Math.max(1, durationInFrames - crossfadeFrames))],
    [0, 1],
    {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    },
  );
  const fadeOut =
    crossfadeFrames > 0
      ? interpolate(
          frame,
          [Math.max(0, durationInFrames - crossfadeFrames), durationInFrames],
          [1, 0],
          {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          },
        )
      : 1;

  return (
    <Audio
      src={src}
      trimBefore={trimBefore}
      durationInFrames={durationInFrames}
      volume={baseVolume * fadeIn * fadeOut}
    />
  );
};

/**
 * Isolated L-cut audio tail with gentle fade-out into the following visual montage.
 */
const AudioCarryTail: React.FC<{
  readonly src: string;
  readonly trimBefore: number;
  readonly durationInFrames: number;
  readonly baseVolume: number;
}> = ({ src, trimBefore, durationInFrames, baseVolume }) => {
  const frame = useCurrentFrame();
  const fadeOut = interpolate(
    frame,
    [Math.max(0, durationInFrames - 10), durationInFrames],
    [1, 0],
    {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    },
  );

  return (
    <Audio
      src={src}
      trimBefore={trimBefore}
      durationInFrames={durationInFrames}
      volume={baseVolume * fadeOut}
    />
  );
};

const DevShotSlate: React.FC<{
  readonly sceneId: string;
  readonly label: string;
}> = ({ sceneId, label }) => (
  <div
    style={{
      position: "absolute",
      bottom: 24,
      left: 34,
      backgroundColor: "rgba(18, 47, 41, 0.78)",
      color: BRAND_COLORS.paper,
      fontFamily: BRAND_FONTS.body,
      fontSize: 14,
      fontWeight: 700,
      padding: "5px 12px",
      borderRadius: 7,
      letterSpacing: "0.04em",
      pointerEvents: "none",
    }}
  >
    <span style={{ color: BRAND_COLORS.yellow, marginRight: 8 }}>{sceneId}</span>
    <span>{label}</span>
  </div>
);

/**
 * Deliverable 1 (Milestone 1.1) — Rough Cut V4 (83.60s / 2,508 frames @ 30 fps).
 * Driven deterministically from src/config/timeline.ts.
 */
export const KelanaRiaRoughCut: React.FC<RoughCutProps> = ({
  showPlaceholders,
  showDevShotSlate,
  useMasterAudioMix = true,
}) => {
  useBrandFonts();
  const { fps } = useVideoConfig();
  const { segments } = buildRoughCutTimeline(fps);

  return (
    <AbsoluteFill style={{ backgroundColor: BRAND_COLORS.paper }}>
      {/* Mastered 48 kHz stereo mix (leveled dialogue + bar-aligned Funky Triplets + tactile SFX) */}
      {useMasterAudioMix && (
        <Audio src={staticFile("audio/mix/KR_ClaimTheCity_MasterMix_48k.wav")} />
      )}

      {segments.map((segment) => {
        if (segment.kind === "footage" && segment.assetPath) {
          const carryFrames = segment.audioCarryOverSec
            ? Math.round(segment.audioCarryOverSec * fps)
            : 0;
          const jCutFrames = segment.jCutAmbience
            ? Math.round(segment.jCutAmbience.durationSec * fps)
            : 0;
          const fadeFrames = segment.audioFadeFrames ?? 4;
          const jCutCrossfade = Math.min(
            fadeFrames,
            Math.floor(jCutFrames / 3),
          );

          return (
            <React.Fragment key={segment.id}>
              {/* J-cut pre-rolls authentic room ambience just before the visual cut (baked into master mix when active) */}
              {!useMasterAudioMix && segment.jCutAmbience && jCutFrames > 0 && (
                <Sequence
                  name={`${segment.id} J-Cut Ambience`}
                  from={Math.max(0, segment.startFrame - (jCutFrames - jCutCrossfade))}
                  durationInFrames={jCutFrames}
                >
                  <AudioJCutLead
                    src={staticFile(FOOTAGE_ASSETS[segment.jCutAmbience.shotId].path)}
                    trimBefore={Math.round(segment.jCutAmbience.sourceStartSec * fps)}
                    durationInFrames={jCutFrames}
                    baseVolume={segment.jCutAmbience.volume}
                    crossfadeFrames={jCutCrossfade}
                  />
                </Sequence>
              )}

              <Sequence
                name={`${segment.sceneId} · ${segment.shotId}`}
                from={segment.startFrame}
                durationInFrames={segment.durationInFrames}
              >
                <SmoothedFootageClip
                  src={staticFile(segment.assetPath)}
                  trimBefore={segment.trimStartFrames}
                  durationInFrames={segment.durationInFrames}
                  baseVolume={segment.volume}
                  fadeFrames={fadeFrames}
                  skipOutFade={carryFrames > 0}
                  muted={useMasterAudioMix}
                />
                <CampaignSceneOverlays segmentId={segment.id} />
                {showDevShotSlate && (
                  <DevShotSlate
                    sceneId={segment.sceneId}
                    label={segment.shotId}
                  />
                )}
              </Sequence>

              {/* L-cut preserves post-shutter group laughter cleanly into the opening montage (baked into master mix when active) */}
              {!useMasterAudioMix && carryFrames > 0 && (
                <Sequence
                  name={`${segment.id} L-Cut Audio`}
                  from={segment.startFrame + segment.durationInFrames}
                  durationInFrames={carryFrames}
                >
                  <AudioCarryTail
                    src={staticFile(segment.assetPath)}
                    trimBefore={segment.trimStartFrames + segment.durationInFrames}
                    durationInFrames={carryFrames}
                    baseVolume={segment.volume}
                  />
                </Sequence>
              )}
            </React.Fragment>
          );
        }

        if (segment.kind === "interlude") {
          return (
            <Sequence
              key={segment.id}
              name={`${segment.sceneId} · ${segment.id}`}
              from={segment.startFrame}
              durationInFrames={segment.durationInFrames}
            >
              <InterludePlaceholder
                kind={segment.interludeKind}
                sceneId={segment.sceneId}
                label={segment.label}
                showPlaceholderBadge={showPlaceholders}
              />
            </Sequence>
          );
        }

        if (segment.kind === "montage") {
          return (
            <Sequence
              key={segment.id}
              name={`${segment.sceneId} · Weekend Memories Montage`}
              from={segment.startFrame}
              durationInFrames={segment.durationInFrames}
            >
              <WeekendMemoriesMontage />
              {showDevShotSlate && (
                <DevShotSlate sceneId={segment.sceneId} label="S08_MONTAGE" />
              )}
            </Sequence>
          );
        }

        return (
          <Sequence
            key={segment.id}
            name={`${segment.sceneId} · Brand Reveal`}
            from={segment.startFrame}
            durationInFrames={segment.durationInFrames}
          >
            <BrandRevealScene />
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
};
