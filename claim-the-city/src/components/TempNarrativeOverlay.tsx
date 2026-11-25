import React from "react";
import { interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { BRAND_COLORS, BRAND_COPY, BRAND_FONTS } from "../config/brand";
import type { TempOverlayKind } from "../config/timeline";

type TempNarrativeOverlayProps = {
  readonly kind: TempOverlayKind;
};

const CardShell: React.FC<{
  readonly position: "top-left" | "top-right" | "right-mid";
  readonly borderColor?: string;
  readonly bgColor?: string;
  readonly opacity?: number;
  readonly children: React.ReactNode;
}> = ({
  position,
  borderColor = BRAND_COLORS.ink,
  bgColor = BRAND_COLORS.paper,
  opacity = 1,
  children,
}) => {
  const posStyle: React.CSSProperties =
    position === "top-left"
      ? { top: 44, left: 52 }
      : position === "top-right"
        ? { top: 44, right: 52 }
        : { top: 112, right: 52, width: 560 };

  return (
    <div
      style={{
        position: "absolute",
        ...posStyle,
        backgroundColor: bgColor,
        border: `2.5px solid ${borderColor}`,
        borderRadius: 14,
        padding: "14px 20px",
        boxShadow: "0 8px 24px rgba(18, 47, 41, 0.22)",
        opacity,
        pointerEvents: "none",
      }}
    >
      {children}
    </div>
  );
};

/**
 * Simple, readable, brand-consistent temporary editorial overlays for Rough Cut V3 (81.80s).
 */
export const TempNarrativeOverlay: React.FC<TempNarrativeOverlayProps> = ({
  kind,
}) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();

  const fadeIn = interpolate(frame, [0, 5], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const fadeOut = interpolate(
    frame,
    [Math.max(5, durationInFrames - 6), durationInFrames],
    [1, 0],
    {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    },
  );
  const opacity = fadeIn * fadeOut;

  if (kind === "s03-title") {
    return (
      <CardShell position="top-left" opacity={opacity}>
        <div
          style={{
            fontFamily: BRAND_FONTS.display,
            fontSize: 64,
            fontWeight: 700,
            lineHeight: 0.94,
            color: BRAND_COLORS.ink,
          }}
        >
          {BRAND_COPY.modeName.toUpperCase()}
        </div>
        <div
          style={{
            marginTop: 8,
            display: "inline-block",
            backgroundColor: BRAND_COLORS.yellow,
            color: BRAND_COLORS.ink,
            fontFamily: BRAND_FONTS.body,
            fontSize: 18,
            fontWeight: 800,
            letterSpacing: "0.14em",
            padding: "4px 10px",
            borderRadius: 5,
          }}
        >
          SATU KOTA. DUA TIM.
        </div>
      </CardShell>
    );
  }

  if (kind === "s04-green-tag" || kind === "s04-yellow-tag") {
    const isGreen = kind === "s04-green-tag";
    return (
      <div
        style={{
          position: "absolute",
          top: 42,
          left: 52,
          backgroundColor: isGreen
            ? BRAND_COLORS.greenTeamBg
            : BRAND_COLORS.yellowTeamBg,
          color: isGreen
            ? BRAND_COLORS.greenTeamText
            : BRAND_COLORS.yellowTeamText,
          border: `2px solid ${BRAND_COLORS.ink}`,
          borderRadius: 10,
          padding: "8px 18px",
          fontFamily: BRAND_FONTS.display,
          fontSize: 30,
          fontWeight: 700,
          letterSpacing: "0.06em",
          lineHeight: 1,
          opacity,
          pointerEvents: "none",
        }}
      >
        {isGreen ? "GREEN TEAM" : "YELLOW TEAM"}
      </div>
    );
  }

  if (kind === "s05-checkin" || kind === "s05-challenge" || kind === "s05-claimed") {
    const config =
      kind === "s05-checkin"
        ? {
            kicker: "LANGKAH 1 · SENAYAN",
            title: "CHECK-IN BERHASIL",
            sub: "Tantangan GBK terbuka (belum dimiliki)",
            accentBg: BRAND_COLORS.mint,
            accentText: BRAND_COLORS.ink,
          }
        : kind === "s05-challenge"
          ? {
              kicker: "LANGKAH 2 · GELORA BUNG KARNO",
              title: "TANTANGAN EKSPLORASI",
              sub: "Menyelesaikan tantangan di lokasi",
              accentBg: BRAND_COLORS.yellow,
              accentText: BRAND_COLORS.ink,
            }
          : {
              kicker: "LANGKAH 3 · SENAYAN",
              title: "LANDMARK DIKLAIM",
              sub: "GBK → Green Team · Zona Senayan dikuasai",
              accentBg: BRAND_COLORS.greenTeamBg,
              accentText: BRAND_COLORS.greenTeamText,
            };

    return (
      <CardShell position="top-right" opacity={opacity}>
        <div
          style={{
            fontFamily: BRAND_FONTS.body,
            fontSize: 13,
            fontWeight: 800,
            letterSpacing: "0.1em",
            color: BRAND_COLORS.muted,
            marginBottom: 4,
          }}
        >
          {config.kicker}
        </div>
        <div
          style={{
            display: "inline-block",
            backgroundColor: config.accentBg,
            color: config.accentText,
            fontFamily: BRAND_FONTS.display,
            fontSize: 38,
            fontWeight: 700,
            lineHeight: 1,
            padding: "5px 12px",
            borderRadius: 7,
            marginBottom: 6,
          }}
        >
          {config.title}
        </div>
        <div
          style={{
            fontFamily: BRAND_FONTS.body,
            fontSize: 16,
            fontWeight: 700,
            color: BRAND_COLORS.ink,
          }}
        >
          {config.sub}
        </div>
      </CardShell>
    );
  }

  // S06_SH01 (trimStart=2.5s, 135f): 3 cleanly distinguishable stages — never grants ownership while pending
  // f0..f44: Bima "Ya, foto aja." + shutter snap (~f46)
  // f45..f81 (1.20s): 1. FOTO TERKIRIM · MENUNGGU VERIFIKASI (Belum dimiliki)
  // f82..f108 (0.90s): 2. FOTO TERVERIFIKASI
  // f109..f135 (0.90s): 3. BUNDARAN HI DIKLAIM YELLOW -> Sudirman-Thamrin dikuasai Yellow Team
  if (kind === "s06-photo-verified") {
    if (frame < 45) {
      return null;
    }
    const localFade =
      interpolate(frame, [45, 50], [0, 1], {
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
      }) * fadeOut;

    const stage = frame < 82 ? 1 : frame < 109 ? 2 : 3;
    const cfg =
      stage === 1
        ? {
            kicker: "LANGKAH 1 · TANTANGAN FOTO BUNDARAN HI",
            title: "FOTO TERKIRIM · MENUNGGU VERIFIKASI",
            sub: "Belum dimiliki · Kepemilikan menunggu hasil verifikasi",
            accentBg: "#E9ECDF",
            accentText: BRAND_COLORS.ink,
          }
        : stage === 2
          ? {
              kicker: "LANGKAH 2 · TANTANGAN FOTO BUNDARAN HI",
              title: "FOTO TERVERIFIKASI ✓",
              sub: "Tantangan Bundaran HI berhasil diselesaikan",
              accentBg: BRAND_COLORS.mint,
              accentText: BRAND_COLORS.teal,
            }
          : {
              kicker: "LANGKAH 3 · KEPEMILIKAN LANDMARK",
              title: "BUNDARAN HI DIKLAIM YELLOW",
              sub: "Zona Sudirman–Thamrin dikuasai Yellow Team",
              accentBg: BRAND_COLORS.yellowTeamBg,
              accentText: BRAND_COLORS.yellowTeamText,
            };

    return (
      <CardShell position="top-right" opacity={localFade}>
        <div
          style={{
            fontFamily: BRAND_FONTS.body,
            fontSize: 13,
            fontWeight: 800,
            letterSpacing: "0.1em",
            color: BRAND_COLORS.muted,
            marginBottom: 5,
          }}
        >
          {cfg.kicker}
        </div>
        <div
          style={{
            display: "inline-block",
            backgroundColor: cfg.accentBg,
            color: cfg.accentText,
            fontFamily: BRAND_FONTS.display,
            fontSize: 36,
            fontWeight: 700,
            lineHeight: 1,
            padding: "5px 12px",
            borderRadius: 7,
            marginBottom: 6,
          }}
        >
          {cfg.title}
        </div>
        <div
          style={{
            fontFamily: BRAND_FONTS.body,
            fontSize: 15,
            fontWeight: 700,
            color: BRAND_COLORS.ink,
          }}
        >
          {cfg.sub}
        </div>
      </CardShell>
    );
  }

  if (kind === "s06-standings-1-2") {
    return (
      <CardShell position="top-right" opacity={opacity}>
        <div
          style={{
            fontFamily: BRAND_FONTS.body,
            fontSize: 13,
            fontWeight: 800,
            letterSpacing: "0.12em",
            color: BRAND_COLORS.muted,
            marginBottom: 8,
            textAlign: "center",
          }}
        >
          ZONA DIKUASAI
        </div>
        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <div
            style={{
              backgroundColor: BRAND_COLORS.greenTeamBg,
              color: BRAND_COLORS.greenTeamText,
              borderRadius: 10,
              padding: "10px 18px",
              textAlign: "center",
              minWidth: 136,
            }}
          >
            <div style={{ fontFamily: BRAND_FONTS.body, fontSize: 13, fontWeight: 700 }}>
              GREEN
            </div>
            <div
              style={{
                fontFamily: BRAND_FONTS.display,
                fontSize: 54,
                fontWeight: 700,
                lineHeight: 0.95,
              }}
            >
              1
            </div>
          </div>
          <div
            style={{
              backgroundColor: BRAND_COLORS.yellowTeamBg,
              color: BRAND_COLORS.yellowTeamText,
              borderRadius: 10,
              padding: "10px 18px",
              textAlign: "center",
              minWidth: 136,
            }}
          >
            <div style={{ fontFamily: BRAND_FONTS.body, fontSize: 13, fontWeight: 700 }}>
              YELLOW
            </div>
            <div
              style={{
                fontFamily: BRAND_FONTS.display,
                fontSize: 54,
                fontWeight: 700,
                lineHeight: 0.95,
              }}
            >
              2
            </div>
          </div>
        </div>
      </CardShell>
    );
  }

  // S07_SH01 (trimStart=3.0s, 120f): wait until Bima groans "Yah, salah!" at f48
  if (kind === "s07-yellow-fail") {
    if (frame < 46) {
      return null;
    }
    const localFade =
      interpolate(frame, [46, 51], [0, 1], {
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
      }) * fadeOut;

    return (
      <CardShell
        position="top-right"
        borderColor={BRAND_COLORS.noticeAccent}
        bgColor={BRAND_COLORS.noticeBg}
        opacity={localFade}
      >
        <div
          style={{
            fontFamily: BRAND_FONTS.body,
            fontSize: 13,
            fontWeight: 800,
            letterSpacing: "0.1em",
            color: BRAND_COLORS.noticeAccent,
            marginBottom: 4,
          }}
        >
          RELIEF SARINAH · YELLOW TEAM
        </div>
        <div
          style={{
            fontFamily: BRAND_FONTS.display,
            fontSize: 40,
            fontWeight: 700,
            lineHeight: 1,
            color: BRAND_COLORS.ink,
            marginBottom: 6,
          }}
        >
          JAWABAN SALAH · COOLDOWN 30:00
        </div>
        <div
          style={{
            fontFamily: BRAND_FONTS.body,
            fontSize: 16,
            fontWeight: 700,
            color: BRAND_COLORS.noticeAccent,
          }}
        >
          Relief Sarinah tetap belum diklaim
        </div>
      </CardShell>
    );
  }

  // S07_SH02 (trimStart=0.3s, 195f):
  // Sequential one-at-a-time temporary beats:
  // f12..112: Opportunity (Belum diklaim)
  // f114..168: Poin Ganda inventory card (Tersedia, Belum aktif)
  // f169..195: Clear as Green Team walks down tunnel
  if (kind === "s07-opportunity-and-card") {
    if (frame < 12 || frame >= 170) {
      return null;
    }
    const isCardPhase = frame >= 114;
    const phaseOpacity = !isCardPhase
      ? interpolate(frame, [12, 17], [0, 1], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        }) *
        interpolate(frame, [108, 113], [1, 0], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        })
      : interpolate(frame, [114, 119], [0, 1], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        }) *
        interpolate(frame, [163, 170], [1, 0], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        });

    if (!isCardPhase) {
      return (
        <CardShell position="right-mid" opacity={phaseOpacity}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: 6,
            }}
          >
            <span
              style={{
                fontFamily: BRAND_FONTS.body,
                fontSize: 13,
                fontWeight: 800,
                letterSpacing: "0.1em",
                color: BRAND_COLORS.noticeAccent,
              }}
            >
              NOTIFIKASI PELUANG
            </span>
            <span
              style={{
                backgroundColor: BRAND_COLORS.noticeBg,
                color: BRAND_COLORS.noticeAccent,
                fontFamily: BRAND_FONTS.body,
                fontSize: 12,
                fontWeight: 800,
                padding: "3px 9px",
                borderRadius: 999,
              }}
            >
              BELUM DIKLAIM
            </span>
          </div>
          <div
            style={{
              fontFamily: BRAND_FONTS.display,
              fontSize: 40,
              fontWeight: 700,
              lineHeight: 1.02,
              color: BRAND_COLORS.ink,
            }}
          >
            Relief Sarinah masih bisa diklaim!
          </div>
          <div
            style={{
              fontFamily: BRAND_FONTS.body,
              fontSize: 15,
              fontWeight: 600,
              color: BRAND_COLORS.muted,
              marginTop: 5,
            }}
          >
            Yellow Team gagal menyelesaikan tantangan
          </div>
        </CardShell>
      );
    }

    return (
      <CardShell
        position="right-mid"
        bgColor={BRAND_COLORS.greenTeamBg}
        opacity={phaseOpacity}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 5,
          }}
        >
          <span
            style={{
              fontFamily: BRAND_FONTS.body,
              fontSize: 13,
              fontWeight: 800,
              letterSpacing: "0.1em",
              color: BRAND_COLORS.lime,
            }}
          >
            KARTU INVENTARIS · TERSEDIA
          </span>
          <span
            style={{
              fontFamily: BRAND_FONTS.body,
              fontSize: 12,
              fontWeight: 700,
              color: BRAND_COLORS.greenTeamText,
              opacity: 0.85,
            }}
          >
            Belum aktif
          </span>
        </div>
        <div
          style={{
            fontFamily: BRAND_FONTS.display,
            fontSize: 44,
            fontWeight: 700,
            lineHeight: 1,
            color: BRAND_COLORS.yellow,
          }}
        >
          POIN GANDA (2×)
        </div>
        <div
          style={{
            fontFamily: BRAND_FONTS.body,
            fontSize: 15,
            marginTop: 5,
            color: BRAND_COLORS.greenTeamText,
            opacity: 0.94,
          }}
        >
          Gandakan bobot landmark setelah klaim berhasil
        </div>
      </CardShell>
    );
  }

  // S07_SH04 (trimStart=2.8s, 150f): Single forward chronological sequence (never repeated afterwards)
  // f0..f13:  Prior standings anchor (Green 1 — Yellow 2, Sarinah belum diklaim)
  // f14..f42: ("Dapet!") Sarinah claimed by Green -> Sudirman-Thamrin Netral -> Green 1 — Yellow 1
  // f43..f92: ("Gue pake Poin Ganda ya.") Poin Ganda activated -> Sarinah weight 1 -> 2
  // f93..f150: ("Yes! Kita unggul!") Green controls Sudirman-Thamrin -> Green 2 — Yellow 1
  const phase = frame < 14 ? 0 : frame < 43 ? 1 : frame < 93 ? 2 : 3;
  const content =
    phase === 0
      ? {
          kicker: "RELIEF SARINAH · BELUM DIKLAIM",
          title: "ZONA DIKUASAI: GREEN 1 — YELLOW 2",
          score: "Sudirman–Thamrin: Yellow Team (Bobot 1)",
          bg: BRAND_COLORS.paper,
          fg: BRAND_COLORS.ink,
          pillBg: BRAND_COLORS.yellowTeamBg,
          pillFg: BRAND_COLORS.yellowTeamText,
        }
      : phase === 1
        ? {
            kicker: "RELIEF SARINAH DIKLAIM GREEN (BOBOT 1)",
            title: "SUDIRMAN–THAMRIN NETRAL",
            score: "ZONA DIKUASAI: GREEN 1 — YELLOW 1",
            bg: BRAND_COLORS.paper,
            fg: BRAND_COLORS.ink,
            pillBg: BRAND_COLORS.mint,
            pillFg: BRAND_COLORS.ink,
          }
        : phase === 2
          ? {
              kicker: "POIN GANDA (2×) DIAKTIFKAN",
              title: "BOBOT SARINAH 1 → 2",
              score: "Bobot Sudirman–Thamrin: Green 2 · Yellow 1",
              bg: BRAND_COLORS.paper,
              fg: BRAND_COLORS.ink,
              pillBg: BRAND_COLORS.yellow,
              pillFg: BRAND_COLORS.ink,
            }
          : {
              kicker: "SUDIRMAN–THAMRIN DIKUASAI GREEN TEAM",
              title: "ZONA DIKUASAI: GREEN 2 — YELLOW 1",
              score: "Kedua tim memiliki 2 landmark diklaim",
              bg: BRAND_COLORS.greenTeamBg,
              fg: BRAND_COLORS.greenTeamText,
              pillBg: BRAND_COLORS.lime,
              pillFg: BRAND_COLORS.uiInk,
            };

  return (
    <CardShell position="top-right" bgColor={content.bg} opacity={opacity}>
      <div
        style={{
          fontFamily: BRAND_FONTS.body,
          fontSize: 13,
          fontWeight: 800,
          letterSpacing: "0.1em",
          color: phase === 3 ? BRAND_COLORS.lime : BRAND_COLORS.teal,
          marginBottom: 4,
        }}
      >
        {content.kicker}
      </div>
      <div
        style={{
          fontFamily: BRAND_FONTS.display,
          fontSize: 40,
          fontWeight: 700,
          lineHeight: 1,
          color: content.fg,
          marginBottom: 8,
        }}
      >
        {content.title}
      </div>
      <div
        style={{
          display: "inline-block",
          backgroundColor: content.pillBg,
          color: content.pillFg,
          fontFamily: BRAND_FONTS.body,
          fontSize: 15,
          fontWeight: 800,
          padding: "5px 12px",
          borderRadius: 7,
        }}
      >
        {content.score}
      </div>
    </CardShell>
  );
};
