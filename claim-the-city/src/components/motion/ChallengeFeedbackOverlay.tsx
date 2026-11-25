import React from "react";
import { Easing, Img, interpolate, staticFile, useCurrentFrame } from "remotion";
import { PHOTO_ASSETS } from "../../config/assets";
import {
  BRAND_COLORS,
  BRAND_FONTS,
  EDITORIAL_SHADOWS,
} from "../../config/brand";
import { RubberStamp } from "./RubberStamp";

/**
 * S05_SH01 Beat 1 — GBK Check-in Slip (mobile-first hierarchy in right sky negative space).
 * Check-in strictly unlocks the challenge and NEVER grants ownership.
 */
export const CheckInSuccessSlip: React.FC<{
  readonly landmarkName: string;
  readonly enterStart: number;
  readonly exitStart: number;
  readonly exitEnd: number;
}> = ({ landmarkName, enterStart, exitStart, exitEnd }) => {
  const frame = useCurrentFrame();

  const enterProgress = interpolate(frame, [enterStart, enterStart + 12], [0, 1], {
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
    interpolate(frame, [enterStart, enterStart + 5], [0, 1], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    }) *
    interpolate(frame, [exitStart, exitEnd], [1, 0], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    });

  if (opacity <= 0.005) {
    return null;
  }

  const translateX =
    interpolate(enterProgress, [0, 1], [54, 0]) +
    interpolate(exitProgress, [0, 1], [0, 48]);

  return (
    <div
      style={{
        width: 528,
        backgroundColor: BRAND_COLORS.paper,
        border: `3.5px solid ${BRAND_COLORS.ink}`,
        borderRadius: 18,
        padding: "18px 24px 20px",
        boxShadow: "8px 8px 0px #153D34",
        opacity,
        translate: `${translateX}px 0px`,
        rotate: "-1deg",
      }}
    >
      {/* Dominant primary message */}
      <div
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 12,
          backgroundColor: BRAND_COLORS.mint,
          border: `2.5px solid ${BRAND_COLORS.teal}`,
          borderRadius: 10,
          padding: "6px 16px",
          marginBottom: 12,
        }}
      >
        <span
          style={{
            fontFamily: BRAND_FONTS.display,
            fontSize: 48,
            fontWeight: 700,
            lineHeight: 0.96,
            color: BRAND_COLORS.teal,
            letterSpacing: "0.02em",
            whiteSpace: "nowrap",
          }}
        >
          ✓ CHECK-IN BERHASIL
        </span>
      </div>

      {/* Clear landmark identifier */}
      <div
        style={{
          fontFamily: BRAND_FONTS.display,
          fontSize: 48,
          fontWeight: 700,
          lineHeight: 0.96,
          color: BRAND_COLORS.ink,
          marginBottom: 12,
        }}
      >
        {landmarkName}
      </div>

      {/* Single crisp non-ownership rule line (mobile readable) */}
      <div
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 10,
          paddingTop: 10,
          borderTop: `2px dashed ${BRAND_COLORS.line}`,
          width: "100%",
          fontFamily: BRAND_FONTS.body,
          fontSize: 21,
          fontWeight: 800,
          color: BRAND_COLORS.muted,
        }}
      >
        <span
          style={{
            width: 12,
            height: 12,
            borderRadius: "50%",
            backgroundColor: BRAND_COLORS.pinUnclaimed,
            display: "inline-block",
            flexShrink: 0,
          }}
        />
        <span>Tantangan terbuka · Belum dimiliki</span>
      </div>
    </div>
  );
};

/**
 * S05_SH01 Beat 2 — GBK Challenge Unlock Card synced to Arga's
 * "Oh, disuruh nyari kode di tiga gate." Strictly non-ownership (challenge active only).
 */
export const ChallengeUnlockCard: React.FC<{
  readonly enterStart: number;
  readonly exitStart: number;
  readonly exitEnd: number;
}> = ({ enterStart, exitStart, exitEnd }) => {
  const frame = useCurrentFrame();

  const enterProgress = interpolate(frame, [enterStart, enterStart + 12], [0, 1], {
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
    interpolate(frame, [enterStart, enterStart + 5], [0, 1], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    }) *
    interpolate(frame, [exitStart, exitEnd], [1, 0], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    });

  if (opacity <= 0.005) {
    return null;
  }

  const translateX =
    interpolate(enterProgress, [0, 1], [54, 0]) +
    interpolate(exitProgress, [0, 1], [0, 48]);

  return (
    <div
      style={{
        width: 548,
        backgroundColor: BRAND_COLORS.ink,
        color: BRAND_COLORS.paper,
        border: `3.5px solid ${BRAND_COLORS.yellow}`,
        borderRadius: 18,
        padding: "18px 24px 20px",
        boxShadow: "8px 8px 0px #075C54",
        opacity,
        translate: `${translateX}px 0px`,
        rotate: "-0.8deg",
      }}
    >
      <div
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 10,
          backgroundColor: BRAND_COLORS.yellow,
          color: BRAND_COLORS.ink,
          borderRadius: 8,
          padding: "4px 13px",
          marginBottom: 12,
          fontFamily: BRAND_FONTS.body,
          fontSize: 16,
          fontWeight: 800,
          letterSpacing: "0.1em",
        }}
      >
        TANTANGAN TERBUKA · GBK
      </div>

      <div
        style={{
          fontFamily: BRAND_FONTS.display,
          fontSize: 56,
          fontWeight: 700,
          lineHeight: 0.94,
          letterSpacing: "0.015em",
          color: BRAND_COLORS.paper,
          marginBottom: 12,
        }}
      >
        CARI KODE DI 3 GATE
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          paddingTop: 10,
          borderTop: "2px dashed rgba(247, 246, 237, 0.28)",
          fontFamily: BRAND_FONTS.body,
          fontSize: 19,
          fontWeight: 800,
          color: BRAND_COLORS.lime,
        }}
      >
        <span>Target: Gate B · F · H</span>
        <span style={{ color: "rgba(247, 246, 237, 0.78)", fontSize: 17 }}>
          Belum dimiliki
        </span>
      </div>
    </div>
  );
};

/**
 * S05_SH02 & S05_SH04 — Bold challenge observation ribbon built for mobile readability.
 * Tracks physical Gate B / F / H exploration and completion without exposing unverified numeric codes.
 */
export const ChallengeProgressRibbon: React.FC<{
  readonly enterStart?: number;
  readonly exitStart: number;
  readonly exitEnd: number;
  readonly mode?: "explore-h" | "solve-all";
  readonly hFoundFrame?: number;
}> = ({
  enterStart = 4,
  exitStart,
  exitEnd,
  mode = "explore-h",
  hFoundFrame = 105,
}) => {
  const frame = useCurrentFrame();

  const enterProgress = interpolate(frame, [enterStart, enterStart + 10], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.bezier(0.16, 1, 0.3, 1),
  });
  const opacity =
    interpolate(frame, [enterStart, enterStart + 5], [0, 1], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    }) *
    interpolate(frame, [exitStart, exitEnd], [1, 0], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    });

  if (opacity <= 0.005) {
    return null;
  }

  const translateX = interpolate(enterProgress, [0, 1], [-36, 0]);

  const gates: readonly { readonly id: "B" | "F" | "H"; readonly checked: boolean }[] =
    mode === "explore-h"
      ? [
          { id: "B", checked: false },
          { id: "F", checked: false },
          { id: "H", checked: frame >= hFoundFrame },
        ]
      : [
          { id: "B", checked: frame >= 84 },
          { id: "F", checked: frame >= 108 },
          { id: "H", checked: frame >= 132 },
        ];

  const isSolved = mode === "solve-all" && frame >= 146;

  return (
    <div
      style={{
        display: "inline-flex",
        flexDirection: "column",
        gap: 12,
        backgroundColor: BRAND_COLORS.ink,
        color: BRAND_COLORS.paper,
        border: `3.5px solid ${isSolved ? BRAND_COLORS.lime : BRAND_COLORS.yellow}`,
        borderRadius: 16,
        padding: "16px 24px 18px",
        boxShadow: "7px 7px 0px #075C54",
        opacity,
        translate: `${translateX}px 0px`,
      }}
    >
      {/* Dominant mobile-first headline */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 16,
        }}
      >
        <div
          style={{
            fontFamily: BRAND_FONTS.display,
            fontSize: 54,
            fontWeight: 700,
            lineHeight: 0.9,
            letterSpacing: "0.02em",
            color: isSolved ? BRAND_COLORS.lime : BRAND_COLORS.yellow,
          }}
        >
          {isSolved ? "✓ TANTANGAN SELESAI" : "TANTANGAN GBK"}
        </div>
      </div>

      {/* High-contrast tactile Gate B / F / H observation steps (zero unverified numeric gate codes) */}
      <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
        <span
          style={{
            fontFamily: BRAND_FONTS.body,
            fontSize: 20,
            fontWeight: 800,
            letterSpacing: "0.04em",
            color: BRAND_COLORS.paper,
          }}
        >
          {mode === "solve-all" ? "SUSUN KODE" : "EKSPLORASI"}
        </span>

        <div style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
          {gates.map((gate) => {
            const active = gate.checked;
            return (
              <div
                key={gate.id}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 6,
                  minWidth: 72,
                  height: 38,
                  backgroundColor: active
                    ? BRAND_COLORS.lime
                    : "rgba(247, 246, 237, 0.16)",
                  color: active ? BRAND_COLORS.uiInk : BRAND_COLORS.paper,
                  border: active
                    ? `2px solid ${BRAND_COLORS.ink}`
                    : "2px solid rgba(247, 246, 237, 0.35)",
                  borderRadius: 999,
                  paddingInline: 14,
                  fontFamily: BRAND_FONTS.display,
                  fontSize: 28,
                  fontWeight: 700,
                  lineHeight: 1,
                }}
              >
                <span>GATE {gate.id}</span>
                {active && <span>✓</span>}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

/**
 * S06_SH01 — Physical Bundaran HI photo proof snapshot using actual KR_PH02_BUNDARAN_HI.jpg.
 * Enforces strict chronological verification anchored cleanly to the native camera shutter
 * (offsettable via frameOffset when clip lead-in changes):
 *   +44..+81:  FOTO TERKIRIM · MENUNGGU VERIFIKASI (Belum dimiliki)
 *   +82..+107: TERVERIFIKASI ✓
 *   +108..+135: DIKLAIM · YELLOW TEAM (+1 LANDMARK)
 */
export const PhotoVerificationProofCard: React.FC<{
  readonly frameOffset?: number;
}> = ({ frameOffset = 0 }) => {
  const rawFrame = useCurrentFrame();
  const frame = rawFrame - frameOffset;

  if (frame < 44) {
    return null;
  }

  const enterProgress = interpolate(frame, [44, 55], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.bezier(0.16, 1, 0.3, 1),
  });
  const exitOpacity = interpolate(frame, [126, 132], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const enterOpacity = interpolate(frame, [44, 49], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const opacity = enterOpacity * exitOpacity;
  if (opacity <= 0.005) {
    return null;
  }

  const translateY = interpolate(enterProgress, [0, 1], [38, 0]);
  const rotate = interpolate(enterProgress, [0, 1], [4, 1.8]);

  const stage = frame < 82 ? 1 : frame < 108 ? 2 : 3;

  return (
    <div
      style={{
        position: "relative",
        width: 468,
        backgroundColor: BRAND_COLORS.card,
        border: `3px solid ${BRAND_COLORS.ink}`,
        borderRadius: 16,
        padding: "14px 14px 18px",
        boxShadow: "8px 8px 0px #153D34",
        opacity,
        translate: `0px ${translateY}px`,
        rotate: `${rotate}deg`,
      }}
    >
      {/* Supplied KR_PH02_BUNDARAN_HI photograph in natural 4:3 print framing */}
      <div
        style={{
          position: "relative",
          width: "100%",
          aspectRatio: "4 / 3",
          overflow: "hidden",
          borderRadius: 9,
          border: `2px solid ${BRAND_COLORS.ink}`,
          marginBottom: 14,
        }}
      >
        <Img
          src={staticFile(PHOTO_ASSETS.bundaranHi.path)}
          style={{
            width: "100%",
            height: "100%",
            objectFit: "cover",
            display: "block",
          }}
        />

        {/* Sequential status stamp on the photograph — never grants ownership while pending */}
        {stage === 2 && (
          <RubberStamp
            label="TERVERIFIKASI ✓"
            enterFrame={82 + frameOffset}
            tone="green"
            rotationDeg={-4}
            fontSize={30}
            style={{
              position: "absolute",
              bottom: 14,
              right: 14,
              boxShadow: EDITORIAL_SHADOWS.subtlePrint,
            }}
          />
        )}

        {stage === 3 && (
          <RubberStamp
            label="DIKLAIM · YELLOW"
            enterFrame={108 + frameOffset}
            tone="ink"
            rotationDeg={-4.5}
            fontSize={30}
            style={{
              position: "absolute",
              bottom: 14,
              right: 14,
              backgroundColor: BRAND_COLORS.yellowTeamBg,
              boxShadow: EDITORIAL_SHADOWS.subtlePrint,
            }}
          />
        )}
      </div>

      {/* Concise status footer under snapshot */}
      {stage === 1 && (
        <div>
          <div
            style={{
              display: "inline-block",
              backgroundColor: "#EBEFE4",
              color: BRAND_COLORS.ink,
              border: `2px solid ${BRAND_COLORS.ink}`,
              fontFamily: BRAND_FONTS.display,
              fontSize: 34,
              fontWeight: 700,
              letterSpacing: "0.03em",
              lineHeight: 1,
              padding: "5px 12px",
              borderRadius: 8,
            }}
          >
            MENUNGGU VERIFIKASI
          </div>
          <div
            style={{
              marginTop: 7,
              fontFamily: BRAND_FONTS.body,
              fontSize: 16,
              fontWeight: 700,
              color: BRAND_COLORS.muted,
            }}
          >
            Foto Bundaran HI terkirim · Belum dimiliki
          </div>
        </div>
      )}

      {stage === 2 && (
        <div>
          <div
            style={{
              fontFamily: BRAND_FONTS.display,
              fontSize: 40,
              fontWeight: 700,
              letterSpacing: "0.02em",
              lineHeight: 0.96,
              color: BRAND_COLORS.ink,
            }}
          >
            BUNDARAN HI
          </div>
          <div
            style={{
              marginTop: 4,
              fontFamily: BRAND_FONTS.body,
              fontSize: 17,
              fontWeight: 700,
              color: BRAND_COLORS.teal,
            }}
          >
            Tantangan foto berhasil diselesaikan
          </div>
        </div>
      )}

      {stage === 3 && (
        <div>
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 10,
              backgroundColor: BRAND_COLORS.yellowTeamBg,
              color: BRAND_COLORS.yellowTeamText,
              border: `2.5px solid ${BRAND_COLORS.ink}`,
              fontFamily: BRAND_FONTS.display,
              fontSize: 36,
              fontWeight: 700,
              letterSpacing: "0.03em",
              lineHeight: 1,
              padding: "6px 14px",
              borderRadius: 8,
            }}
          >
            <span>BUNDARAN HI</span>
            <span style={{ fontSize: 22 }}>· +1 LANDMARK</span>
          </div>
          <div
            style={{
              marginTop: 7,
              fontFamily: BRAND_FONTS.body,
              fontSize: 16,
              fontWeight: 700,
              color: BRAND_COLORS.ink,
            }}
          >
            Yellow Team menguasai Sudirman–Thamrin
          </div>
        </div>
      )}
    </div>
  );
};

/**
 * S07_SH01 — Restrained terracotta failure card synchronized to Bima's "Yah, salah!" (f46).
 * Derived from KR_COMPONENT_COOLDOWN.png; strictly keeps Sarinah UNCLAIMED.
 */
export const ChallengeFailureCard: React.FC<{
  readonly enterStart: number;
  readonly exitStart: number;
  readonly exitEnd: number;
}> = ({ enterStart, exitStart, exitEnd }) => {
  const frame = useCurrentFrame();

  const enterProgress = interpolate(frame, [enterStart, enterStart + 10], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.bezier(0.16, 1, 0.3, 1),
  });
  const opacity =
    interpolate(frame, [enterStart, enterStart + 5], [0, 1], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    }) *
    interpolate(frame, [exitStart, exitEnd], [1, 0], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    });

  if (opacity <= 0.005) {
    return null;
  }

  const translateX = interpolate(enterProgress, [0, 1], [48, 0]);

  return (
    <div
      style={{
        position: "relative",
        width: 500,
        backgroundColor: BRAND_COLORS.noticeBg,
        border: `3px solid ${BRAND_COLORS.noticeAccent}`,
        borderLeft: `9px solid ${BRAND_COLORS.noticeAccent}`,
        borderRadius: 16,
        padding: "16px 22px 18px",
        boxShadow: "7px 7px 0px #153D34",
        opacity,
        translate: `${translateX}px 0px`,
        rotate: "-1deg",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 8,
        }}
      >
        <span
          style={{
            fontFamily: BRAND_FONTS.body,
            fontSize: 14,
            fontWeight: 800,
            letterSpacing: "0.1em",
            textTransform: "uppercase",
            color: BRAND_COLORS.noticeAccent,
          }}
        >
          RELIEF SARINAH · YELLOW TEAM
        </span>
        <span
          style={{
            backgroundColor: BRAND_COLORS.paper,
            color: BRAND_COLORS.ink,
            border: `2px solid ${BRAND_COLORS.noticeAccent}`,
            fontFamily: BRAND_FONTS.display,
            fontSize: 22,
            fontWeight: 700,
            letterSpacing: "0.05em",
            padding: "2px 10px",
            borderRadius: 7,
            lineHeight: 1.05,
          }}
        >
          COOLDOWN 30:00
        </span>
      </div>

      <div
        style={{
          fontFamily: BRAND_FONTS.display,
          fontSize: 66,
          fontWeight: 700,
          lineHeight: 0.92,
          color: BRAND_COLORS.ink,
        }}
      >
        JAWABAN SALAH
      </div>

      <div
        style={{
          marginTop: 10,
          display: "inline-flex",
          alignItems: "center",
          gap: 8,
          backgroundColor: BRAND_COLORS.paper,
          border: `2px solid ${BRAND_COLORS.noticeAccent}`,
          borderRadius: 8,
          padding: "5px 12px",
          fontFamily: BRAND_FONTS.display,
          fontSize: 30,
          fontWeight: 700,
          letterSpacing: "0.04em",
          color: BRAND_COLORS.noticeAccent,
          lineHeight: 1,
        }}
      >
        <span
          style={{
            width: 11,
            height: 11,
            borderRadius: "50%",
            backgroundColor: BRAND_COLORS.pinUnclaimed,
            display: "inline-block",
          }}
        />
        SARINAH BELUM DIKLAIM
      </div>
    </div>
  );
};
