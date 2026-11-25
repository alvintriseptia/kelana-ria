import React from "react";
import {
  AbsoluteFill,
  Easing,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { BRAND_COLORS, BRAND_COPY, BRAND_FONTS } from "../../config/brand";
import { S07_SH02_V2_CUES } from "../../config/motionPrototypeS07SH02";
import {
  ChallengeFailureCard,
  ChallengeProgressRibbon,
  ChallengeUnlockCard,
  CheckInSuccessSlip,
  PhotoVerificationProofCard,
} from "./ChallengeFeedbackOverlay";
import { EditorialScoreboard } from "./EditorialScoreboard";
import { HighlightSwipe } from "./HighlightSwipe";
import { OpportunityDispatchCard } from "./OpportunityDispatchCard";
import { OwnershipStampCard } from "./OwnershipStampCard";
import { TacticalGameCard } from "./TacticalGameCard";
import { TeamIdentifierBadge } from "./TeamIdentifierBadge";

/**
 * S02_SH01 (96f) — Restrained paper-edge transition bridging Arga's smartphone intro
 * into S03's illustrated paper map without fabricating anything on the physical phone screen.
 */
const S02PaperTransition: React.FC = () => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();

  const start = durationInFrames - 10;
  if (frame < start) {
    return null;
  }

  const progress = interpolate(frame, [start, durationInFrames], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.in(Easing.cubic),
  });

  return (
    <AbsoluteFill style={{ pointerEvents: "none", overflow: "hidden" }}>
      <div
        style={{
          position: "absolute",
          inset: 0,
          backgroundColor: BRAND_COLORS.paper,
          borderLeft: `6px solid ${BRAND_COLORS.ink}`,
          translate: `${interpolate(progress, [0, 1], [1920, 0])}px 0px`,
          opacity: interpolate(progress, [0, 0.25, 1], [0, 0.92, 0.96]),
        }}
      />
    </AbsoluteFill>
  );
};

/**
 * S03_SH01 (213f / 7.10s) — Confident Claim the City game-mode & objective reveal anchored
 * inside the open cream park center of the illustrated Jakarta paper map:
 *   f6..f28:   CLAIM THE CITY / SATU KOTA. DUA TIM.
 *   f62..f76:  GREEN TEAM VS YELLOW TEAM (synced to Bima: "Ini rebutan wilayah gitu?")
 *   f124..f138: KUASAI ZONA TERBANYAK. + concise win condition (synced to Arga: "Iya. Siapa yang dapat paling banyak.")
 */
const S03ClaimTheCityReveal: React.FC = () => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();

  // Gentle opening release from S02 paper wipe (f0..f8)
  const wipeRelease = interpolate(frame, [0, 8], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.cubic),
  });

  const titleEnter = interpolate(frame, [6, 20], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.bezier(0.16, 1, 0.3, 1),
  });
  const exitOpacity = interpolate(
    frame,
    [durationInFrames - 12, durationInFrames],
    [1, 0],
    {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    },
  );

  const subEnter = interpolate(frame, [16, 28], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.bezier(0.16, 1, 0.3, 1),
  });

  // Contrasting Green & Yellow team tokens enter cleanly on Bima's "Ini rebutan wilayah gitu?" (f62)
  const teamsEnter = interpolate(frame, [62, 76], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.bezier(0.16, 1, 0.3, 1),
  });

  // Objective strip enters cleanly on Arga's "Iya. Siapa yang dapat paling banyak." (f124)
  const objectiveEnter = interpolate(frame, [124, 138], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.bezier(0.16, 1, 0.3, 1),
  });

  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      {wipeRelease > 0.01 && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            backgroundColor: BRAND_COLORS.paper,
            opacity: wipeRelease,
          }}
        />
      )}

      {/* Centered editorial game-mode lockup resting inside the open park center of the map */}
      <div
        style={{
          position: "absolute",
          top: 132,
          left: 430,
          width: 1060,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          textAlign: "center",
          opacity: exitOpacity,
        }}
      >
        {/* Main Title Plate — tactile printed banner, crisp over animated map */}
        <div
          style={{
            backgroundColor: "rgba(247, 246, 237, 0.95)",
            border: `4px solid ${BRAND_COLORS.ink}`,
            borderRadius: 20,
            padding: "18px 46px 20px",
            boxShadow: "10px 10px 0px #153D34",
            opacity: titleEnter,
            translate: `0px ${interpolate(titleEnter, [0, 1], [24, 0])}px`,
            rotate: "-0.8deg",
          }}
        >
          <div
            style={{
              fontFamily: BRAND_FONTS.display,
              fontSize: 118,
              fontWeight: 700,
              lineHeight: 0.9,
              letterSpacing: "-0.01em",
              color: BRAND_COLORS.ink,
            }}
          >
            <HighlightSwipe
              startFrame={16}
              endFrame={30}
              color={BRAND_COLORS.yellow}
              height={25}
              bottom={8}
            >
              {BRAND_COPY.modeName.toUpperCase()}
            </HighlightSwipe>
          </div>
        </div>

        {/* Subhead pill: SATU KOTA. DUA TIM. */}
        <div
          style={{
            marginTop: -12,
            backgroundColor: BRAND_COLORS.yellow,
            color: BRAND_COLORS.ink,
            border: `3px solid ${BRAND_COLORS.ink}`,
            borderRadius: 10,
            padding: "8px 26px",
            boxShadow: "5px 5px 0px #153D34",
            fontFamily: BRAND_FONTS.body,
            fontSize: 23,
            fontWeight: 800,
            letterSpacing: "0.16em",
            opacity: subEnter,
            translate: `0px ${interpolate(subEnter, [0, 1], [14, 0])}px`,
            rotate: "0.8deg",
          }}
        >
          SATU KOTA. DUA TIM.
        </div>

        {/* Contrasting Green & Yellow board-game team tokens */}
        {teamsEnter > 0.01 && (
          <div
            style={{
              marginTop: 22,
              display: "inline-flex",
              alignItems: "center",
              gap: 18,
              opacity: teamsEnter,
              translate: `0px ${interpolate(teamsEnter, [0, 1], [18, 0])}px`,
            }}
          >
            <div
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 10,
                backgroundColor: BRAND_COLORS.greenTeamBg,
                color: BRAND_COLORS.greenTeamText,
                border: `3px solid ${BRAND_COLORS.ink}`,
                borderRadius: 12,
                padding: "9px 22px",
                boxShadow: "6px 6px 0px #153D34",
                fontFamily: BRAND_FONTS.display,
                fontSize: 36,
                fontWeight: 700,
                letterSpacing: "0.05em",
                lineHeight: 0.95,
                rotate: "-1.5deg",
              }}
            >
              <span
                style={{
                  width: 12,
                  height: 12,
                  backgroundColor: BRAND_COLORS.lime,
                  rotate: "45deg",
                  display: "inline-block",
                }}
              />
              GREEN TEAM
            </div>

            <div
              style={{
                backgroundColor: BRAND_COLORS.paper,
                color: BRAND_COLORS.ink,
                border: `2.5px solid ${BRAND_COLORS.ink}`,
                borderRadius: 999,
                padding: "6px 14px",
                fontFamily: BRAND_FONTS.display,
                fontSize: 27,
                fontWeight: 700,
                lineHeight: 1,
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
                border: `3px solid ${BRAND_COLORS.ink}`,
                borderRadius: 12,
                padding: "9px 22px",
                boxShadow: "6px 6px 0px #153D34",
                fontFamily: BRAND_FONTS.display,
                fontSize: 36,
                fontWeight: 700,
                letterSpacing: "0.05em",
                lineHeight: 0.95,
                rotate: "1.5deg",
              }}
            >
              <span
                style={{
                  width: 12,
                  height: 12,
                  backgroundColor: BRAND_COLORS.ink,
                  rotate: "45deg",
                  display: "inline-block",
                }}
              />
              YELLOW TEAM
            </div>
          </div>
        )}

        {/* Milestone 4.1 Objective Card — establishes zone-control win condition without rulebook clutter */}
        {objectiveEnter > 0.01 && (
          <div
            style={{
              marginTop: 22,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              backgroundColor: "rgba(247, 246, 237, 0.96)",
              border: `3.5px solid ${BRAND_COLORS.ink}`,
              borderRadius: 16,
              padding: "12px 28px 14px",
              boxShadow: "7px 7px 0px #075C54",
              opacity: objectiveEnter,
              translate: `0px ${interpolate(objectiveEnter, [0, 1], [18, 0])}px`,
              rotate: "-0.4deg",
            }}
          >
            <div
              style={{
                backgroundColor: BRAND_COLORS.ink,
                color: BRAND_COLORS.yellow,
                borderRadius: 8,
                padding: "5px 18px",
                fontFamily: BRAND_FONTS.display,
                fontSize: 44,
                fontWeight: 700,
                letterSpacing: "0.04em",
                lineHeight: 0.96,
              }}
            >
              KUASAI ZONA TERBANYAK.
            </div>
            <div
              style={{
                marginTop: 8,
                fontFamily: BRAND_FONTS.body,
                fontSize: 20,
                fontWeight: 800,
                color: BRAND_COLORS.ink,
                letterSpacing: "-0.01em",
              }}
            >
              Tim dengan zona terbanyak saat waktu habis menang
            </div>
          </div>
        )}
      </div>
    </AbsoluteFill>
  );
};

/**
 * S07_SH04 Beat 3 (f102..f150) — Coherent Sudirman-Thamrin takeover & 2-1 score lock.
 * Enters immediately after Poin Ganda activation (Bobot 1 -> 2) right as Naya celebrates
 * ("Yes! Kita unggul!" + fist bump). Territory ownership and 2-1 zone standings appear
 * 100% coherently together (eliminating V1's transient 1-1 vs Green-map mismatch),
 * handing off cleanly into the full-screen map territory transformation at 00:57.13.
 */
const S07GreenLeadTakeoverCard: React.FC = () => {
  const frame = useCurrentFrame();

  if (frame < 102) {
    return null;
  }

  const enterProgress = interpolate(frame, [102, 113], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.bezier(0.16, 1, 0.3, 1),
  });
  const enterOpacity = interpolate(frame, [102, 107], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const translateX = interpolate(enterProgress, [0, 1], [54, 0]);

  return (
    <div
      style={{
        width: 504,
        backgroundColor: BRAND_COLORS.paper,
        border: `3.5px solid ${BRAND_COLORS.ink}`,
        borderRadius: 20,
        padding: "16px 18px 18px",
        boxShadow: "9px 9px 0px #075C54",
        opacity: enterOpacity,
        translate: `${translateX}px 0px`,
        rotate: "-0.9deg",
      }}
    >
      {/* Coherent Zone Takeover Banner */}
      <div
        style={{
          backgroundColor: BRAND_COLORS.greenTeamBg,
          color: BRAND_COLORS.greenTeamText,
          border: `3px solid ${BRAND_COLORS.ink}`,
          borderRadius: 14,
          padding: "12px 16px 14px",
          marginBottom: 14,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 4,
          }}
        >
          <span
            style={{
              fontFamily: BRAND_FONTS.body,
              fontSize: 15,
              fontWeight: 800,
              letterSpacing: "0.09em",
              color: BRAND_COLORS.lime,
            }}
          >
            BOBOT GREEN 2 · YELLOW 1
          </span>
          <span
            style={{
              backgroundColor: BRAND_COLORS.yellow,
              color: BRAND_COLORS.ink,
              fontFamily: BRAND_FONTS.display,
              fontSize: 26,
              fontWeight: 700,
              lineHeight: 0.95,
              padding: "3px 10px",
              borderRadius: 7,
            }}
          >
            2× AKTIF
          </span>
        </div>

        <div
          style={{
            fontFamily: BRAND_FONTS.display,
            fontSize: 54,
            fontWeight: 700,
            lineHeight: 0.94,
            letterSpacing: "-0.01em",
            whiteSpace: "nowrap",
          }}
        >
          SUDIRMAN–THAMRIN
        </div>
        <div
          style={{
            fontFamily: BRAND_FONTS.body,
            fontSize: 19,
            fontWeight: 800,
            color: BRAND_COLORS.yellow,
            marginTop: 4,
          }}
        >
          DIKUASAI GREEN TEAM
        </div>
      </div>

      {/* Coherent 2-1 Zone Scoreboard (always synchronized with Green zone control) */}
      <EditorialScoreboard
        greenZones={2}
        yellowZones={1}
        title="ZONA DIKUASAI"
        footerNote="Kedua tim memiliki 2 landmark diklaim"
        highlightTeam="green"
        emphasizeFrame={114}
        compact
        style={{
          boxShadow: "none",
          borderWidth: 2.5,
          padding: "12px 14px 13px",
        }}
      />
    </div>
  );
};

/**
 * Master Milestone 2 Motion Graphics Overlay router for all live-action footage segments
 * in KelanaRia-RoughCut (locked 83.60s / 2,508f timeline).
 * Replaces temporary Milestone 1.1 editorial badges with cohesive Jakarta Playground motion graphics.
 */
export const CampaignSceneOverlays: React.FC<{
  readonly segmentId: string;
}> = ({ segmentId }) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();

  // S01 — Weekend routine: pure Raw Jakarta, zero graphics
  if (segmentId === "S01_SH01") {
    return null;
  }

  // S02 — Something different: restrained paper-edge wipe only (no fabricated phone screen)
  if (segmentId === "S02_SH01") {
    return <S02PaperTransition />;
  }

  // S03 — Claim the City title & contrasting team introduction
  if (segmentId === "S03_SH01") {
    return <S03ClaimTheCityReveal />;
  }

  // S04 — Transportation: identify Green (SH01) & Yellow (SH02) cleanly; keep SH03 & SH04 pure Raw Jakarta
  if (segmentId === "S04_SH01") {
    return (
      <div style={{ position: "absolute", top: 46, left: 54, pointerEvents: "none" }}>
        <TeamIdentifierBadge
          team="green"
          enterStart={4}
          exitStart={durationInFrames - 8}
          exitEnd={durationInFrames}
        />
      </div>
    );
  }
  if (segmentId === "S04_SH02") {
    return (
      <div style={{ position: "absolute", top: 46, left: 54, pointerEvents: "none" }}>
        <TeamIdentifierBadge
          team="yellow"
          enterStart={4}
          exitStart={durationInFrames - 8}
          exitEnd={durationInFrames}
        />
      </div>
    );
  }
  if (segmentId === "S04_SH03" || segmentId === "S04_SH04") {
    return null;
  }

  // S05 — GBK 7-Step Progression:
  //   SH01 (207f): Step 2 Check-in (f26..f116, non-ownership) -> Step 3 Challenge Unlock (f132..f202)
  //   SH02 (201f): Step 4 Physical Gate B/F/H exploration (H ✓ ticks live at f105 on Naya's discovery)
  //   SH04 (213f): Steps 5-6 Clue Assembly -> Challenge Complete (f10..f160) -> Step 7 Distinct Landmark Claim (f164..f213)
  if (segmentId === "S05_SH01") {
    return (
      <AbsoluteFill style={{ pointerEvents: "none" }}>
        <div style={{ position: "absolute", top: 56, right: 56 }}>
          <CheckInSuccessSlip
            landmarkName="STADION UTAMA GBK"
            enterStart={26}
            exitStart={108}
            exitEnd={118}
          />
        </div>
        <div style={{ position: "absolute", top: 56, right: 56 }}>
          <ChallengeUnlockCard
            enterStart={132}
            exitStart={durationInFrames - 10}
            exitEnd={durationInFrames}
          />
        </div>
      </AbsoluteFill>
    );
  }
  if (segmentId === "S05_SH02") {
    return (
      <div style={{ position: "absolute", top: 48, left: 54, pointerEvents: "none" }}>
        <ChallengeProgressRibbon
          enterStart={6}
          exitStart={durationInFrames - 10}
          exitEnd={durationInFrames}
          mode="explore-h"
          hFoundFrame={105}
        />
      </div>
    );
  }
  if (segmentId === "S05_SH04") {
    // Anchored in pure open grey sky between Gate F sign (left) and Arga/Naya (right)
    return (
      <AbsoluteFill style={{ pointerEvents: "none" }}>
        <div style={{ position: "absolute", top: 48, left: 444 }}>
          <ChallengeProgressRibbon
            enterStart={10}
            exitStart={154}
            exitEnd={162}
            mode="solve-all"
          />
        </div>
        <div style={{ position: "absolute", top: 48, left: 444 }}>
          <OwnershipStampCard
            landmarkTitle="GELORA BUNG KARNO"
            team="green"
            landmarkDeltaLabel="+1 LANDMARK"
            consequenceLine="ZONA SENAYAN · GREEN TEAM"
            consequenceTone="green"
            enterStart={164}
            enterEnd={174}
            stampStart={170}
            exitStart={durationInFrames - 8}
            exitEnd={durationInFrames}
            width={540}
          />
        </div>
      </AbsoluteFill>
    );
  }

  // S06 — Yellow takes the lead: Photo Proof (KR_PH02_BUNDARAN_HI) + Editorial Zone Scoreboard
  // Restored 1.20s Sari setup in S06_SH01 shifts native shutter by +36f (local f80)
  if (segmentId === "S06_SH01") {
    return (
      <div style={{ position: "absolute", top: 88, right: 54, pointerEvents: "none" }}>
        <PhotoVerificationProofCard frameOffset={36} />
      </div>
    );
  }
  if (segmentId === "S06_SH03_V4") {
    const enterProgress = interpolate(frame, [14, 26], [0, 1], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
      easing: Easing.bezier(0.16, 1, 0.3, 1),
    });
    const opacity =
      interpolate(frame, [14, 20], [0, 1], {
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
      }) *
      interpolate(frame, [156, 168], [1, 0], {
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
      });

    if (opacity <= 0.005) {
      return null;
    }

    return (
      <div
        style={{
          position: "absolute",
          top: 136,
          right: 54,
          pointerEvents: "none",
          opacity,
          translate: `${interpolate(enterProgress, [0, 1], [54, 0])}px 0px`,
          rotate: "1deg",
        }}
      >
        <EditorialScoreboard
          kicker="BEBERAPA SAAT KEMUDIAN"
          title="ZONA DIKUASAI"
          greenZones={1}
          yellowZones={2}
          footerNote="Yellow Team memimpin sementara"
          highlightTeam="yellow"
          emphasizeFrame={36}
        />
      </div>
    );
  }

  // S07A — Yellow fails at Sarinah (unclaimed; clear of Bima & Sari's reactions)
  if (segmentId === "S07_SH01") {
    return (
      <div style={{ position: "absolute", top: 44, right: 52, pointerEvents: "none" }}>
        <ChallengeFailureCard
          enterStart={46}
          exitStart={durationInFrames - 8}
          exitEnd={durationInFrames}
        />
      </div>
    );
  }

  // S07B — Exact approved Milestone 1.2 V2 Motion Design Prototype integration
  if (segmentId === "S07_SH02") {
    return (
      <AbsoluteFill style={{ pointerEvents: "none" }}>
        <div style={{ position: "absolute", top: 292, right: 68 }}>
          <OpportunityDispatchCard
            zoneLabel="SUDIRMAN–THAMRIN"
            landmarkTitle="SARINAH"
            opportunityLine="MASIH BISA DIKLAIM!"
            contextNote="Yellow Team gagal menyelesaikan tantangan."
            stampLabel="BELUM DIKLAIM"
            enterStart={S07_SH02_V2_CUES.beatAEnterStart}
            enterEnd={S07_SH02_V2_CUES.beatAEnterEnd}
            highlightStart={S07_SH02_V2_CUES.beatAHighlightStart}
            highlightEnd={S07_SH02_V2_CUES.beatAHighlightEnd}
            stampStart={S07_SH02_V2_CUES.beatAStampStart}
            exitStart={S07_SH02_V2_CUES.beatAExitStart}
            exitEnd={S07_SH02_V2_CUES.beatAExitEnd}
          />
        </div>

        <div style={{ position: "absolute", top: 214, right: 92 }}>
          <TacticalGameCard
            categoryLabel="KARTU TAKTIS"
            availabilityLabel="TERSEDIA"
            cardTitle="POIN GANDA"
            multiplierBadge="2×"
            teamLabel="GREEN TEAM"
            statusFooterLabel="BELUM AKTIF"
            atlasCell={{ col: 1, row: 1 }}
            enterStart={S07_SH02_V2_CUES.beatBEnterStart}
            enterEnd={S07_SH02_V2_CUES.beatBEnterEnd}
            emphasisStart={S07_SH02_V2_CUES.beatBHighlightStart}
            emphasisEnd={S07_SH02_V2_CUES.beatBHighlightEnd}
            commitFrame={S07_SH02_V2_CUES.beatBGasCommit}
            exitStart={S07_SH02_V2_CUES.beatBExitStart}
            exitEnd={S07_SH02_V2_CUES.beatBExitEnd}
          />
        </div>
      </AbsoluteFill>
    );
  }

  // S07C & S07D — Signature Sequential Comeback (Strictly Chronological, Zero State Mismatch)
  // Beat 1 (f12..f43):  Sarinah Claimed (+1) -> Sudirman-Thamrin Netral (1-1)
  // Beat 2 (f44..f103): Poin Ganda Card live activation (TERSEDIA -> DIAKTIFKAN, Bobot 1 -> 2)
  // Beat 3 (f102..f150): Coherent Sudirman-Thamrin Green takeover + 2-1 score lock on fist bump,
  //                      handing seamlessly into the full-screen map territory flip at 00:57.13
  if (segmentId === "S07_SH04") {
    return (
      <AbsoluteFill style={{ pointerEvents: "none" }}>
        {/* S07C — First Ownership of Sarinah & Neutral Zone State (distinct from Poin Ganda) */}
        <div style={{ position: "absolute", top: 248, right: 50 }}>
          <OwnershipStampCard
            landmarkTitle="RELIEF SARINAH"
            team="green"
            landmarkDeltaLabel="+1 LANDMARK"
            consequenceLine="SUDIRMAN–THAMRIN NETRAL · 1 — 1"
            consequenceTone="neutral"
            enterStart={12}
            enterEnd={20}
            stampStart={15}
            exitStart={38}
            exitEnd={44}
            width={514}
          />
        </div>

        {/* S07D Beat 1 — Approved Poin Ganda Card live state transition: TERSEDIA -> DIAKTIFKAN */}
        <div style={{ position: "absolute", top: 186, right: 72 }}>
          <TacticalGameCard
            categoryLabel="KARTU TAKTIS"
            availabilityLabel="TERSEDIA"
            cardTitle="POIN GANDA"
            multiplierBadge="2×"
            teamLabel="GREEN TEAM"
            statusFooterLabel="BELUM AKTIF"
            atlasCell={{ col: 1, row: 1 }}
            enterStart={44}
            enterEnd={53}
            emphasisStart={58}
            emphasisEnd={70}
            activationFrame={58}
            activatedBadgeLabel="DIAKTIFKAN"
            activatedFooterLabel="BOBOT SARINAH: 1 → 2"
            commitFrame={92}
            exitStart={95}
            exitEnd={103}
            width={420}
          />
        </div>

        {/* S07D Beat 2 — Coherent Green Takeover & 2-1 Score Lock (clear of fist bump) */}
        <div style={{ position: "absolute", top: 214, right: 50 }}>
          <S07GreenLeadTakeoverCard />
        </div>
      </AbsoluteFill>
    );
  }

  // S08 Reunion & Selfie: zero competitive graphics (pure friendship)
  return null;
};
