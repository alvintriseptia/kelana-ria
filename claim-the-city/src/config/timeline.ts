import { FOOTAGE_ASSETS, type ShotId } from "./assets";

export const CAMPAIGN_FPS = 30;
export const CAMPAIGN_WIDTH = 1920;
export const CAMPAIGN_HEIGHT = 1080;

export type InterludeKind = "match-conclusion-v4";

export type TempOverlayKind =
  | "s03-title"
  | "s04-green-tag"
  | "s04-yellow-tag"
  | "s05-checkin"
  | "s05-challenge"
  | "s05-claimed"
  | "s06-photo-verified"
  | "s06-standings-1-2"
  | "s07-yellow-fail"
  | "s07-opportunity-and-card"
  | "s07-claim-and-poin-ganda";

export type JCutAmbienceConfig = {
  readonly shotId: ShotId;
  readonly sourceStartSec: number;
  readonly durationSec: number;
  readonly volume: number;
};

export type TimelineSegmentInput =
  | {
      readonly id: string;
      readonly sceneId: string;
      readonly sceneTitle: string;
      readonly kind: "footage";
      readonly shotId: ShotId;
      readonly trimStartSec: number;
      readonly trimEndSec: number;
      readonly volume: number;
      readonly dialogueNotes: string;
      readonly graphicCues: readonly string[];
      readonly productionNotes: string;
      /** Simple temporary narrative overlay for editorial clarity in Rough Cut V4. */
      readonly tempOverlay?: TempOverlayKind;
      /** Optional J-cut ambience audio pre-rolled before the visual cut. */
      readonly jCutAmbience?: JCutAmbienceConfig;
      /** Optional L-cut audio tail extending past trimEndSec into the following segment. */
      readonly audioCarryOverSec?: number;
      /** Short smoothed audio fade duration in frames (default: 4 frames = 133ms). */
      readonly audioFadeFrames?: number;
    }
  | {
      readonly id: string;
      readonly sceneId: string;
      readonly sceneTitle: string;
      readonly kind: "interlude";
      readonly interludeKind: InterludeKind;
      readonly durationSec: number;
      readonly label: string;
      readonly graphicCues: readonly string[];
      readonly productionNotes: string;
    }
  | {
      readonly id: string;
      readonly sceneId: string;
      readonly sceneTitle: string;
      readonly kind: "montage";
      readonly durationSec: number;
      readonly label: string;
      readonly graphicCues: readonly string[];
      readonly productionNotes: string;
    }
  | {
      readonly id: string;
      readonly sceneId: string;
      readonly sceneTitle: string;
      readonly kind: "brand-reveal";
      readonly durationSec: number;
      readonly label: string;
      readonly graphicCues: readonly string[];
      readonly productionNotes: string;
    };

export type ComputedTimelineSegment = TimelineSegmentInput & {
  readonly startFrame: number;
  readonly durationInFrames: number;
  readonly trimStartFrames: number;
  readonly assetPath?: string;
};

/**
 * Active Master Campaign Timeline — Milestone 4.1 Narrative Clarity Correction (99.67s / 2,990f @ 30 fps).
 * Reopened selectively from the approved 83.60s Milestone 4.0 lock exclusively to restore:
 *   - Correction A: Complete S03_SH01 paper-map opening & breathing room after Arga's objective explanation.
 *   - Correction B: Complete S05 GBK Q&A ("Challenge-nya apaan?" -> "Oh, disuruh nyari kode di tiga gate."),
 *                   Gate B/F/H physical exploration, and clue resolution prior to distinct landmark claim.
 *   - Continuity audit: S06_SH01 Sari's photo setup ("Dari sini dapat nih.") before Bima's reply, plus
 *                       clean 0.20–0.25s vocal-tail breathing room on S04_SH01/SH02/SH04 and S06_SH03_V4.
 *
 * Archived timelines:
 * - src/config/timeline.extended-140s.backup.ts (140.10s / 4,203f)
 * - src/config/timeline.60s-v1.backup.ts (60.00s / 1,800f)
 * - src/config/timeline.82s-v2.backup.ts (82.00s / 2,460f)
 * - src/config/timeline.82s-v3.backup.ts (81.80s / 2,454f)
 * - src/config/timeline.83.6s-m4.backup.ts (83.60s / 2,508f — approved Milestone 4.0 lock)
 */
export const ROUGHCUT_SEGMENTS_INPUT: readonly TimelineSegmentInput[] = [
  // SCENE 01 — Weekend routine (4.90s / 147f)
  {
    id: "S01_SH01",
    sceneId: "S01",
    sceneTitle: "Weekend routine",
    kind: "footage",
    shotId: "KR_S01_SH01",
    trimStartSec: 1.3,
    trimEndSec: 6.2,
    volume: 1.2,
    dialogueNotes:
      '[1.4s quiet cafe boredom] | Naya: "Abis ini ke mana?" (2.7-3.4s) | Bima: "Ya... ke mana lagi?" (4.3-5.7s) | [0.5s beat]',
    graphicCues: ["None — raw establishing routine"],
    productionNotes: "Unchanged from M4.0.",
  },

  // SCENE 02 — Game introduction (3.20s / 96f)
  {
    id: "S02_SH01",
    sceneId: "S02",
    sceneTitle: "Game introduction",
    kind: "footage",
    shotId: "KR_S02_SH01",
    trimStartSec: 0.6,
    trimEndSec: 3.8,
    volume: 0.92,
    dialogueNotes:
      'Arga: "Eh, lihat deh." (1.0-1.7s) | Naya: "Apaan?" (2.9-3.4s)',
    graphicCues: ["None — preserve physical phone naturally without screen insert"],
    productionNotes: "Unchanged from M4.0.",
  },

  // SCENE 03 — Claim the City (7.10s / 213f) — Milestone 4.1 Correction A (+2.00s)
  {
    id: "S03_SH01",
    sceneId: "S03",
    sceneTitle: "Claim the City",
    kind: "footage",
    shotId: "KR_S03_SH01",
    trimStartSec: 0.6,
    trimEndSec: 7.7,
    volume: 1.05,
    dialogueNotes:
      '[2.0s animated paper-map unfold w/ native paper rustle 1.2-1.5s] | Bima: "Ini rebutan wilayah gitu?" (2.6-4.35s) | Arga: "Iya. Siapa yang dapat paling banyak." (4.8-6.95s) | [0.75s clean landing beat]',
    graphicCues: [
      'Enhanced paper-map reveal: "CLAIM THE CITY / SATU KOTA. DUA TIM. / KUASAI ZONA TERBANYAK. / Tim dengan zona terbanyak saat waktu habis menang"',
    ],
    productionNotes:
      "M4.1 Correction A: Restored 0.6-7.7s (+2.00s) so Arga's explanation never cuts off abruptly after 'banyak' (6.95s) and the enhanced objective graphic reads cleanly.",
    tempOverlay: "s03-title",
  },

  // SCENE 04 — Transportation (10.13s / 305f) — Preserved montage + 0.20s clean vocal tails on SH01/SH02/SH04
  {
    id: "S04_SH01",
    sceneId: "S04",
    sceneTitle: "Transportation",
    kind: "footage",
    shotId: "KR_S04_SH01",
    trimStartSec: 1.7,
    trimEndSec: 3.75,
    volume: 0.95,
    dialogueNotes: 'Arga: "Yang deket dulu aja ya?" (1.9-2.8s) | Naya: "Boleh." (3.1-3.5s) | [0.25s clean tail before omitted "Yang mana?" at 4.1s]',
    graphicCues: ["Team badge: GREEN TEAM"],
    productionNotes: "M4.1 continuity tail (+0.20s) prevents abrupt vocal cut on 'Boleh.' while omitting unanswered 'Yang mana?'.",
    tempOverlay: "s04-green-tag",
  },
  {
    id: "S04_SH02",
    sceneId: "S04",
    sceneTitle: "Transportation",
    kind: "footage",
    shotId: "KR_S04_SH02",
    trimStartSec: 0.5,
    trimEndSec: 3.25,
    volume: 0.88,
    dialogueNotes:
      'Sari: "Kita mau ke mana dulu?" (0.6-1.5s) | Bima: "Udah, ikut gua aja." (1.8-3.0s) | [0.25s clean tail]',
    graphicCues: ["Team badge: YELLOW TEAM"],
    productionNotes: "M4.1 continuity tail (+0.20s) prevents abrupt vocal cut on 'aja.' (still 0.25s before next banter).",
    tempOverlay: "s04-yellow-tag",
  },
  {
    id: "S04_SH03",
    sceneId: "S04",
    sceneTitle: "Transportation",
    kind: "footage",
    shotId: "KR_S04_SH03",
    trimStartSec: 6.1,
    trimEndSec: 7.55,
    volume: 0.95,
    dialogueNotes: 'Arga: "Oke, gas." (6.6-7.3s) inside TransJakarta',
    graphicCues: ["Pure Raw Jakarta"],
    productionNotes: "Unchanged from M4.0.",
    tempOverlay: "s04-green-tag",
  },
  {
    id: "S04_SH04",
    sceneId: "S04",
    sceneTitle: "Transportation",
    kind: "footage",
    shotId: "KR_S04_SH04",
    trimStartSec: 0.9,
    trimEndSec: 4.75,
    volume: 0.92,
    dialogueNotes:
      'Sari: "Eh, bagus juga ya dari sini." (1.0-2.6s) [camera snap] | Bima: "Lo malah foto-foto." (3.4-4.5s) | [0.25s clean tail]',
    graphicCues: ["Pure Raw Jakarta"],
    productionNotes: "M4.1 continuity tail (+0.20s) prevents abrupt cut on 'foto-foto.' (still 0.25s before Sari's next line).",
    tempOverlay: "s04-yellow-tag",
  },

  // SCENE 05 — GBK challenge (20.70s / 621f) — Milestone 4.1 Correction B (+12.10s)
  {
    id: "S05_SH01",
    sceneId: "S05",
    sceneTitle: "GBK challenge",
    kind: "footage",
    shotId: "KR_S05_SH01",
    trimStartSec: 0.0,
    trimEndSec: 6.9,
    volume: 1.08,
    dialogueNotes:
      'Arga: "Bentar, gue check-in dulu." (0.1-1.45s) | [1.55s check-in beat] | Naya: "Challenge-nya apaan?" (3.0-3.95s) | Arga: "Oh, disuruh nyari kode di tiga gate." (4.5-6.4s) | [0.5s walk-in]',
    graphicCues: [
      "Step 2 (0.87-3.87s): CHECK-IN BERHASIL · STADION UTAMA GBK (Belum dimiliki)",
      "Step 3 (4.40-6.80s): TANTANGAN TERBUKA · CARI KODE DI 3 GATE (Target: B · F · H)",
    ],
    productionNotes:
      "M4.1 Correction B: Restored Arga's complete challenge explanation (+2.90s) after Naya's question.",
    tempOverlay: "s05-checkin",
  },
  {
    id: "S05_SH02",
    sceneId: "S05",
    sceneTitle: "GBK challenge",
    kind: "footage",
    shotId: "KR_S05_SH02",
    trimStartSec: 0.0,
    trimEndSec: 6.7,
    volume: 1.18,
    dialogueNotes:
      'Arga: "B, F, sama H." (0.05-1.95s) | [looks up at Gate H sign] | Naya: "Lah, ini udah H!" (3.15-4.4s) | Naya: "Abis ini lewat sini aja." (4.8-5.8s) | [0.9s walk toward stadium ring]',
    graphicCues: [
      "Step 4 (0.20-6.63s): TANTANGAN GBK · GATE B · F · H tracker (H ✓ ticks live on Naya's Gate H discovery at 3.5s)",
    ],
    productionNotes:
      "M4.1 Correction B: Restored full Gate B, F, H physical exploration conversation (+4.20s).",
    tempOverlay: "s05-challenge",
  },
  {
    id: "S05_SH04",
    sceneId: "S05",
    sceneTitle: "GBK challenge",
    kind: "footage",
    shotId: "KR_S05_SH04",
    trimStartSec: 0.4,
    trimEndSec: 7.5,
    volume: 1.14,
    dialogueNotes:
      'Naya: "Urutannya B, F, H kan?" (0.6-2.55s) | Arga: "Berarti nol tiga, nol tujuh, sebelas." (3.15-5.75s) | Naya: "Nah, dapat!" (5.9-6.95s) | [0.55s celebratory turn]',
    graphicCues: [
      "Steps 5-6 (0.33-5.40s local): TANTANGAN GBK · GATE B ✓ · F ✓ · H ✓ -> TANTANGAN SELESAI (no unverified digits displayed as factual signage)",
      "Step 7 (5.47-7.10s local): Distinct LANDMARK DIKLAIM · GELORA BUNG KARNO · GREEN TEAM (+1 LANDMARK · ZONA SENAYAN)",
    ],
    productionNotes:
      "M4.1 Correction B + continuity fix (+5.00s): Eliminates previous 5.7s mid-word clip on 'sebelas' and restores full clue assembly & distinct challenge-complete -> landmark-claim progression.",
    tempOverlay: "s05-claimed",
  },

  // SCENE 06 — Competitive tension (11.67s / 350f) — Continuity fix on SH01 (+1.10s) & clean tail on SH03 (+0.25s)
  {
    id: "S06_SH01",
    sceneId: "S06",
    sceneTitle: "Competitive tension",
    kind: "footage",
    shotId: "KR_S06_SH01",
    trimStartSec: 1.3,
    trimEndSec: 6.9,
    volume: 0.94,
    dialogueNotes:
      'Sari: "Dari sini dapat nih." (1.5-2.35s) | Bima: "Ya, foto aja." (2.6-3.5s) | [native shutter 3.95s] | Sari: "Udah, gue kirim ya." (5.2-6.3s) | [0.6s quiet settle]',
    graphicCues: [
      "3-stage sequential verification anchored to native shutter (local f80): 1. Menunggu verifikasi (Belum dimiliki) -> 2. Terverifikasi -> 3. Bundaran HI diklaim Yellow",
    ],
    productionNotes:
      "M4.1 continuity fix (+1.10s): Restores Sari's setup ('Dari sini dapat nih.') so Bima's reply ('Ya, foto aja.') is no longer orphaned.",
    tempOverlay: "s06-photo-verified",
  },
  {
    id: "S06_SH03_V4",
    sceneId: "S06",
    sceneTitle: "Competitive tension",
    kind: "footage",
    shotId: "KR_S06_SH03_V4",
    trimStartSec: 0.3,
    trimEndSec: 6.35,
    volume: 0.84,
    dialogueNotes:
      'Naya: "Eh, mereka udah dua zona!" (0.5-2.2s) | Arga: "Serius? Kita baru satu?" (2.5-4.0s) | Naya: "Iya! Ayo, harus ngejar nih." (4.3-6.05s) | [0.3s clean step]',
    graphicCues: ["Editorial scoreboard: ZONA DIKUASAI · GREEN 1 — YELLOW 2"],
    productionNotes: "M4.1 continuity tail (+0.25s) prevents abrupt vocal cut on 'ngejar nih.'",
    tempOverlay: "s06-standings-1-2",
  },

  // SCENE 07 — Tactical comeback (15.50s live + continuous conclusion bridge — UNCHANGED)
  {
    id: "S07_SH01",
    sceneId: "S07",
    sceneTitle: "Tactical comeback",
    kind: "footage",
    shotId: "KR_S07_SH01",
    trimStartSec: 3.0,
    trimEndSec: 7.0,
    volume: 0.95,
    dialogueNotes:
      'Sari: "Yang duduk juga dihitung kan?" (3.1-4.3s) | Bima: "Yah, salah!" (4.6-5.8s) | [1.2s exasperated reaction]',
    graphicCues: [
      "Temp notice (enters at 1.5s on 'Yah, salah!'): JAWABAN SALAH · Cooldown 30:00 · Relief Sarinah tetap belum diklaim",
    ],
    productionNotes: "Unchanged from V3.",
    tempOverlay: "s07-yellow-fail",
  },
  {
    id: "S07_SH02",
    sceneId: "S07",
    sceneTitle: "Tactical comeback",
    kind: "footage",
    shotId: "KR_S07_SH02",
    trimStartSec: 0.3,
    trimEndSec: 6.8,
    volume: 0.88,
    dialogueNotes:
      '[0.4s phone notice] | Arga: "Bentar! Sarinah bisa direbut!" | Naya: "Deket dong dari sini!" | Arga: "Kita masih punya Poin Ganda!" | Naya: "Gas!" | [1.0s brisk tunnel exit stride]',
    graphicCues: [
      "Sequential temp beats: Opportunity (Belum diklaim) -> Poin Ganda Tersedia (Belum aktif) -> clear on stride",
    ],
    productionNotes: "Unchanged from V3.",
    tempOverlay: "s07-opportunity-and-card",
  },
  {
    id: "S07_SH04",
    sceneId: "S07",
    sceneTitle: "Tactical comeback",
    kind: "footage",
    shotId: "KR_S07_SH04",
    trimStartSec: 2.8,
    trimEndSec: 7.8,
    volume: 0.94,
    dialogueNotes:
      '[0.4s Sarinah establish] | Arga: "Dapet!" (3.3-3.6s) | "Gue pake Poin Ganda ya." (4.2-5.1s) | Naya: "Yes! Kita unggul!" + fist bump (5.9-7.8s)',
    graphicCues: [
      "Single chronological progression: Green 1-Yellow 2 -> Sarinah diklaim / Netral (1-1) -> Poin Ganda 2x (Bobot 1->2) -> Green 2-Yellow 1",
    ],
    productionNotes: "Unchanged from V3.",
    tempOverlay: "s07-claim-and-poin-ganda",
  },

  // CONTINUOUS MATCH CONCLUSION SEQUENCE (7.00s / 210f | 00:57.13 - 01:04.13)
  {
    id: "INT_MATCH_CONCLUSION",
    sceneId: "S07–S08",
    sceneTitle: "Match conclusion",
    kind: "interlude",
    interludeKind: "match-conclusion-v4",
    durationSec: 7.0,
    label: "Continuous lead hold (2.5s) -> accelerated clock 102:00 to 00:00 (2.0s) -> unified expiry & Green victory (2.5s)",
    graphicCues: [
      "0.0-2.5s: Green takes lead (2-1 Zona dikuasai, clock at 102:00)",
      "2.5-4.5s: Continuous accelerated match clock 102:00 -> 00:00 (passage of time)",
      "4.5-7.0s: Unified WAKTU RONDE HABIS + PEMENANG GREEN TEAM (Green 2 Zona — Yellow 1 Zona)",
    ],
    productionNotes:
      "V4 fix: Replaces separate short slide cuts with one continuous graphical progression on a single canvas.",
  },

  // SCENE 08 — Weekend Memories (15.47s live/montage + 0.60s J-cut warung ambience)
  {
    id: "S08_SH01",
    sceneId: "S08",
    sceneTitle: "Weekend Memories",
    kind: "footage",
    shotId: "KR_S08_SH01",
    trimStartSec: 0.1,
    trimEndSec: 7.3,
    volume: 0.92,
    jCutAmbience: {
      shotId: "KR_S08_SH02_V2",
      sourceStartSec: 0.05,
      durationSec: 0.6,
      volume: 0.85,
    },
    dialogueNotes:
      '[0.60s warung ambience J-cut] | Naya: "Minggu depan main lagi, yuk." (0.3-1.3s) | Bima: "Gas. Tapi gue mau rematch." (2.4-4.3s) | Sari: "Masih nggak terima ya?" (5.2-6.1s) + full group laughter (6.2-7.3s)',
    graphicCues: ["None — warm unencumbered friendship"],
    productionNotes:
      "V4 fix: Authentic 0.60s warung ambience pre-roll (KR_SH08_SH02.mp4 0.05-0.65s, pure street/warung sound with zero speech) eases gently into Naya's opening line.",
  },
  {
    id: "S08_SH02_V2",
    sceneId: "S08",
    sceneTitle: "Weekend Memories",
    kind: "footage",
    shotId: "KR_S08_SH02_V2",
    trimStartSec: 2.3,
    trimEndSec: 5.77,
    audioCarryOverSec: 1.4,
    volume: 1.0,
    dialogueNotes:
      'Bima/Arga: "Gue masuk nggak?" (2.5-2.9s) | Sari: "Satu... dua... tiga." (3.8-5.6s) | [SHUTTER CLICK at 5.75s] | L-cut carries 1.40s post-shutter laughter into montage',
    graphicCues: ["Shutter flash at 5.77s bridging cleanly into photographic memories"],
    productionNotes: "Unchanged from V2.",
  },
  {
    id: "S08_MONTAGE",
    sceneId: "S08",
    sceneTitle: "Weekend Memories",
    kind: "montage",
    durationSec: 4.8,
    label: "Larger, immersive Weekend Memories photographic montage",
    graphicCues: [
      "Flash -> KR_PH01_MRT (0.80s) -> KR_PH03_GBK (0.80s) -> KR_PH04_KENDAL (0.80s) -> KR_S08_PH01 hero selfie hold (2.40s, largest print scale)",
    ],
    productionNotes:
      "V3 fix: Larger print display scale preserving native aspect ratios with strongest visual emphasis and 2.40s hold on final group selfie.",
  },

  // SCENE 09 — Brand reveal (4.00s / 120f)
  {
    id: "S09_BRAND",
    sceneId: "S09",
    sceneTitle: "Brand reveal",
    kind: "brand-reveal",
    durationSec: 4.0,
    label: "Kelana Ria Brand Reveal",
    graphicCues: ['Official lockup + "Mainkan kotamu." + "SEGERA HADIR"'],
    productionNotes: "Unchanged from V2.",
  },
];

export const buildRoughCutTimeline = (
  fps: number = CAMPAIGN_FPS,
): {
  readonly segments: readonly ComputedTimelineSegment[];
  readonly totalDurationInFrames: number;
  readonly totalDurationSec: number;
} => {
  let cursor = 0;
  const segments: ComputedTimelineSegment[] = ROUGHCUT_SEGMENTS_INPUT.map((seg) => {
    if (seg.kind === "footage") {
      const asset = FOOTAGE_ASSETS[seg.shotId];
      const trimStartFrames = Math.round(seg.trimStartSec * fps);
      const durationInFrames = Math.max(
        1,
        Math.round((seg.trimEndSec - seg.trimStartSec) * fps),
      );
      const computed: ComputedTimelineSegment = {
        ...seg,
        startFrame: cursor,
        durationInFrames,
        trimStartFrames,
        assetPath: asset.path,
      };
      cursor += durationInFrames;
      return computed;
    }

    const durationInFrames = Math.max(1, Math.round(seg.durationSec * fps));
    const computed: ComputedTimelineSegment = {
      ...seg,
      startFrame: cursor,
      durationInFrames,
      trimStartFrames: 0,
    };
    cursor += durationInFrames;
    return computed;
  });

  return {
    segments,
    totalDurationInFrames: cursor,
    totalDurationSec: Number((cursor / fps).toFixed(2)),
  };
};

export const ROUGHCUT_TIMELINE = buildRoughCutTimeline(CAMPAIGN_FPS);

/**
 * Exact cue frame markers (at 30 fps) for KR-MotionDesign-Test-S07-SH02.
 * Unchanged from Milestone 1.0.
 */
export const S07_SH02_CUES = {
  totalFrames: Math.round(FOOTAGE_ASSETS.KR_S07_SH02.sourceDurationSec * CAMPAIGN_FPS), // 238 frames
  locationTagEnter: 8,
  beat01OpportunityEnter: 20, // 0.67s — right as Arga exclaims "Bentar!"
  beat01StampPunch: 50, // 1.67s — right on "Sarinah bisa direbut!"
  beat02MapEnter: 86, // 2.87s — right as Naya responds "Deket dong dari sini!"
  beat02RouteDrawStart: 92,
  beat02RouteDrawEnd: 116,
  beat03CardEnter: 125, // 4.17s — right as Arga begins "Kita masih punya..."
  beat03HighlightSweep: 144, // 4.80s — right on vocal emphasis "Poin Ganda!"
  beat04ActionPulse: 168, // 5.60s — right on Naya's "Gas!"
  beat04ExitStart: 176, // 5.87s — characters pivot and stride down tunnel
  beat04ExitComplete: 198, // 6.60s — frame fully clear for Raw Jakarta exit
  representativeStills: {
    notificationIntro: 26, // 0.87s
    opportunityVisible: 64, // 2.13s
    mapLocationDetail: 108, // 3.60s
    poinGandaReveal: 154, // 5.13s
    resolvedComposition: 212, // 7.07s
  },
} as const;
