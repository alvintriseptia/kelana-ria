import { FOOTAGE_ASSETS, type ShotId } from "./assets";

export const CAMPAIGN_FPS = 30;
export const CAMPAIGN_WIDTH = 1920;
export const CAMPAIGN_HEIGHT = 1080;

export type InterludeKind = "sarinah-turnaround-v2" | "match-result-v2";

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
      /** Simple temporary narrative overlay for editorial clarity in Rough Cut V2. */
      readonly tempOverlay?: TempOverlayKind;
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
 * Active Master Campaign Timeline — Milestone 1.1 Refinement (Rough Cut V2, ~82s).
 * Balances natural conversational rhythm, character reactions, sequential gameplay clarity,
 * and emotional breathing room without reverting to the 140s extended assembly.
 *
 * Archived timelines:
 * - src/config/timeline.extended-140s.backup.ts (140.10s / 4,203f)
 * - src/config/timeline.60s-v1.backup.ts (60.00s / 1,800f)
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
    productionNotes:
      "Restores +0.90s of quiet weekend repetition before Naya speaks and brief hangtime after Bima, cutting before the scooter rev at 6.4s.",
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
    productionNotes: "Preserves concise curiosity beat with slightly softer phone-lift entry.",
  },

  // SCENE 03 — Claim the City (5.10s / 153f)
  {
    id: "S03_SH01",
    sceneId: "S03",
    sceneTitle: "Claim the City",
    kind: "footage",
    shotId: "KR_S03_SH01",
    trimStartSec: 2.0,
    trimEndSec: 7.1,
    volume: 1.05,
    dialogueNotes:
      '[0.6s paper-map reveal] | Bima: "Ini rebutan wilayah gitu?" (2.6-4.3s) | Arga: "Iya. Siapa yang dapat paling banyak." (4.8-6.9s)',
    graphicCues: ['Temp title: "CLAIM THE CITY / SATU KOTA. DUA TIM."'],
    productionNotes:
      "Restores +0.60s lead/tail over the animated paper map so title and premise register comfortably.",
    tempOverlay: "s03-title",
  },

  // SCENE 04 — Transportation (9.57s / 287f)
  {
    id: "S04_SH01",
    sceneId: "S04",
    sceneTitle: "Transportation",
    kind: "footage",
    shotId: "KR_S04_SH01",
    trimStartSec: 1.7,
    trimEndSec: 3.55,
    volume: 0.95,
    dialogueNotes: 'Arga: "Yang deket dulu aja ya?" (1.9-2.7s) | Naya: "Boleh." (3.1-3.4s)',
    graphicCues: ["Temp badge: GREEN TEAM"],
    productionNotes:
      "Restores Green Team's calm planning exchange approaching TransJakarta; cuts in 3.55-4.0s pause.",
    tempOverlay: "s04-green-tag",
  },
  {
    id: "S04_SH02",
    sceneId: "S04",
    sceneTitle: "Transportation",
    kind: "footage",
    shotId: "KR_S04_SH02",
    trimStartSec: 0.5,
    trimEndSec: 3.05,
    volume: 0.88,
    dialogueNotes:
      'Sari: "Kita mau ke mana dulu?" (0.6-1.4s) | Bima: "Udah, ikut gua aja." (1.8-2.9s)',
    graphicCues: ["Temp badge: YELLOW TEAM"],
    productionNotes:
      "Restores Sari's setup question so Bima's spontaneous reply lands naturally in front of Blok M MRT.",
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
    graphicCues: ["Temp badge: GREEN TEAM"],
    productionNotes: "Crisp collaborative beat inside moving TransJakarta bus.",
    tempOverlay: "s04-green-tag",
  },
  {
    id: "S04_SH04",
    sceneId: "S04",
    sceneTitle: "Transportation",
    kind: "footage",
    shotId: "KR_S04_SH04",
    trimStartSec: 0.9,
    trimEndSec: 4.55,
    volume: 0.92,
    dialogueNotes:
      'Sari: "Eh, bagus juga ya dari sini." (1.0-2.5s) [camera snap] | Bima: "Lo malah foto-foto." (3.4-4.4s)',
    graphicCues: ["Temp badge: YELLOW TEAM"],
    productionNotes:
      "Restores Bima's playful reaction to Sari photographing Jakarta from the MRT window, letting the moment breathe spontaneously.",
    tempOverlay: "s04-yellow-tag",
  },

  // SCENE 05 — GBK challenge (8.60s / 258f)
  {
    id: "S05_SH01",
    sceneId: "S05",
    sceneTitle: "GBK challenge",
    kind: "footage",
    shotId: "KR_S05_SH01",
    trimStartSec: 0.0,
    trimEndSec: 4.0,
    volume: 1.08,
    dialogueNotes:
      'Arga: "Bentar, gue check-in dulu." (0.1-1.4s) | [1.5s phone beat] | Naya: "Challenge-nya apaan?" (3.0-3.9s)',
    graphicCues: ["Temp badge: 1. CHECK-IN BERHASIL -> Tantangan GBK terbuka (belum dimiliki)"],
    productionNotes:
      "Restores natural phone pause + Naya's curiosity while omitting the lengthy gate explanation that follows at 4.5s.",
    tempOverlay: "s05-checkin",
  },
  {
    id: "S05_SH02",
    sceneId: "S05",
    sceneTitle: "GBK challenge",
    kind: "footage",
    shotId: "KR_S05_SH02",
    trimStartSec: 4.7,
    trimEndSec: 7.2,
    volume: 1.18,
    dialogueNotes:
      'Naya: "Abis ini lewat sini aja." (4.8-5.7s) + physical walk toward stadium ring (5.8-7.2s)',
    graphicCues: ["Temp badge: 2. TANTANGAN EKSPLORASI · GBK"],
    productionNotes:
      "Restores active decision and physical movement around GBK without centering unverified gate codes.",
    tempOverlay: "s05-challenge",
  },
  {
    id: "S05_SH04",
    sceneId: "S05",
    sceneTitle: "GBK challenge",
    kind: "footage",
    shotId: "KR_S05_SH04",
    trimStartSec: 5.7,
    trimEndSec: 7.8,
    volume: 1.14,
    dialogueNotes: 'Naya: "Nah, dapet!" (5.9-6.9s) + celebratory turn (7.0-7.8s)',
    graphicCues: ["Temp badge: 3. LANDMARK DIKLAIM · GBK -> Green Team (Senayan)"],
    productionNotes: "Distinct payoff event cleanly separated from check-in and exploration.",
    tempOverlay: "s05-claimed",
  },

  // SCENE 06 — Competitive tension (9.90s / 297f)
  {
    id: "S06_SH01",
    sceneId: "S06",
    sceneTitle: "Competitive tension",
    kind: "footage",
    shotId: "KR_S06_SH01",
    trimStartSec: 2.5,
    trimEndSec: 6.6,
    volume: 0.94,
    dialogueNotes:
      'Bima: "Ya, foto aja." (2.6-3.4s) | [shutter ~4.1s] | Sari: "Udah, gue kirim ya." (5.2-6.2s)',
    graphicCues: [
      "Temp sequential status: Foto terkirim · Menunggu verifikasi (1.5-2.8s) -> Terverifikasi · Bundaran HI diklaim Yellow (2.9-4.1s)",
    ],
    productionNotes:
      "Restores framing/encouragement beat before shutter snap for strong visual continuity and readable verification-before-claim timing.",
    tempOverlay: "s06-photo-verified",
  },
  {
    id: "S06_SH03_V4",
    sceneId: "S06",
    sceneTitle: "Competitive tension",
    kind: "footage",
    shotId: "KR_S06_SH03_V4",
    trimStartSec: 0.3,
    trimEndSec: 6.1,
    volume: 0.84,
    dialogueNotes:
      'Naya: "Eh, mereka udah dua zona!" (0.5-2.1s) | Arga: "Serius? Kita baru satu?" (2.5-4.0s) | Naya: "Iya! Ayo, harus ngejar nih." (4.3-6.0s)',
    graphicCues: ["Temp scoreboard: ZONA DIKUASAI · GREEN 1 — YELLOW 2"],
    productionNotes:
      "Restores Naya's rallying reaction (confirmed clean V4 take) and gives generous reading time on the 1-2 deficit.",
    tempOverlay: "s06-standings-1-2",
  },

  // SCENE 07 — Tactical comeback (19.30s / 579f — highest-priority refinement)
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
      "Temp notice (enters cleanly at 1.6s on 'Yah, salah!'): JAWABAN SALAH · Cooldown 30:00 · Relief Sarinah tetap belum diklaim",
    ],
    productionNotes:
      "Restores Sari's humorous doubt and full reaction beat after failure. Sarinah stays strictly unclaimed.",
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
      "Sequential temp beats (never stacked simultaneously): 0.4-3.7s Opportunity (Belum diklaim) -> 3.8-5.7s Poin Ganda Tersedia (Belum aktif) -> 5.7-6.5s clear on stride",
    ],
    productionNotes:
      "Restores natural notice reaction and physical walk down Terowongan Kendal to earn the transition to Sarinah.",
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
      '[0.4s Sarinah location establish] | Arga: "Dapet!" (3.3-3.6s) | "Gue pake Poin Ganda ya." (4.2-5.1s) | Naya: "Yes! Kita unggul!" + fist bump (5.9-7.8s)',
    graphicCues: [
      "Sequential temp sync: 0.4-1.4s Sarinah diklaim Green -> 1.5-3.1s Poin Ganda 2x aktif (Bobot 1->2) -> 3.2-5.0s Sudirman-Thamrin Green (2-1)",
    ],
    productionNotes:
      "Gives establishing glimpse of Sarinah relief before Arga's 'Dapet!' and lets the celebration fist bump breathe.",
    tempOverlay: "s07-claim-and-poin-ganda",
  },
  {
    id: "INT_S07_TURNAROUND",
    sceneId: "S07",
    sceneTitle: "Tactical comeback",
    kind: "interlude",
    interludeKind: "sarinah-turnaround-v2",
    durationSec: 3.8,
    label: "Sequential tactical turnaround: Neutral 1-1 -> Poin Ganda 2x -> Green 2-1",
    graphicCues: [
      "Phase 1 (0.0-1.8s): Relief Sarinah diklaim (Bobot 1) -> Sudirman-Thamrin Netral -> Zona dikuasai: Green 1 - Yellow 1",
      "Phase 2 (1.8-3.8s): Poin Ganda 2x aktif (Bobot 1->2) -> Sudirman-Thamrin Green -> Zona dikuasai: Green 2 - Yellow 1 (2 landmark/tim)",
    ],
    productionNotes:
      "Two unhurried sequential stages (no simultaneous overload) guaranteeing clear comprehension of zone control vs. landmark weight.",
  },

  // SCENE 08 — Weekend Memories (17.47s / 524f — emotional payoff)
  {
    id: "INT_S08_RESULT",
    sceneId: "S08",
    sceneTitle: "Weekend Memories",
    kind: "interlude",
    interludeKind: "match-result-v2",
    durationSec: 2.2,
    label: "Sequential match expiry -> Winner announcement",
    graphicCues: [
      "Beat 1 (0.0-0.8s): WAKTU RONDE HABIS (match expiry registers first)",
      "Beat 2 (0.8-2.2s): Pemenang · Green Team (2-1 Zona dikuasai)",
    ],
    productionNotes:
      "Clearly separates match expiry from taking the lead before cutting to the warung reunion.",
  },
  {
    id: "S08_SH01",
    sceneId: "S08",
    sceneTitle: "Weekend Memories",
    kind: "footage",
    shotId: "KR_S08_SH01",
    trimStartSec: 0.1,
    trimEndSec: 7.3,
    volume: 0.92,
    dialogueNotes:
      'Naya: "Minggu depan main lagi, yuk." (0.3-1.3s) | Bima: "Gas. Tapi gue mau rematch." (2.4-4.3s) | Sari: "Masih nggak terima ya?" (5.2-6.1s) + full group laughter (6.2-7.3s)',
    graphicCues: ["None — warm unencumbered friendship"],
    productionNotes:
      "Restores Sari's playful tease and the friends' genuine warung laughter (omitted in 60s V1).",
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
    productionNotes:
      "Restores playful group huddle before countdown so the shutter moment feels earned.",
  },
  {
    id: "S08_MONTAGE",
    sceneId: "S08",
    sceneTitle: "Weekend Memories",
    kind: "montage",
    durationSec: 4.6,
    label: "Weekend Memories photographic montage (comfortable holds)",
    graphicCues: [
      "Flash -> KR_PH01_MRT (0.80s) -> KR_PH03_GBK (0.80s) -> KR_PH04_KENDAL (0.80s) -> KR_S08_PH01 hero selfie hold (2.20s)",
    ],
    productionNotes:
      "Every memory gets comfortable reading hold; mandatory final group selfie holds longest (2.20s).",
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
    productionNotes: "Unhurried, memorable closing hold.",
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
