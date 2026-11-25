import { FOOTAGE_ASSETS, type ShotId } from "./assets";

export const CAMPAIGN_FPS = 30;
export const CAMPAIGN_WIDTH = 1920;
export const CAMPAIGN_HEIGHT = 1080;
export const TARGET_CAMPAIGN_FRAMES = 1800; // Exactly 60.00 seconds at 30 fps

export type InterludeKind = "sarinah-turnaround-60s" | "match-result-60s";

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
      /** Simple temporary narrative overlay for editorial clarity in the 60s rough cut. */
      readonly tempOverlay?: TempOverlayKind;
      /** Optional L-cut audio tail extending past trimEndSec into the following segment. */
      readonly audioCarryOverSec?: number;
      /** Audio edge fade duration in frames (default: 3 frames = 100ms). */
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
 * Active Master Campaign Timeline — Milestone 1.1 (60-Second Editorial Rough Cut).
 * Total duration: exactly 1,800 frames (60.00s at 30 fps), including Scene 09 Brand Reveal.
 * Extended 140.10s assembly is archived in src/config/timeline.extended-140s.backup.ts.
 */
export const ROUGHCUT_SEGMENTS_INPUT: readonly TimelineSegmentInput[] = [
  // SCENE 01 — Weekend routine (4.00s / 120f | 00:00.00 - 00:04.00)
  {
    id: "S01_SH01",
    sceneId: "S01",
    sceneTitle: "Weekend routine",
    kind: "footage",
    shotId: "KR_S01_SH01",
    trimStartSec: 2.0,
    trimEndSec: 6.0,
    volume: 1.2,
    dialogueNotes:
      'Naya: "Abis ini ke mana?" (2.7-3.4s) | Bima: "Ya... ke mana lagi?" (4.3-5.7s)',
    graphicCues: ["None — raw establishing routine"],
    productionNotes:
      "Trims opening silence to 0.6s setup beat and cuts before trailing motorbike rev at 6.4s.",
  },

  // SCENE 02 — Game introduction (3.00s / 90f | 00:04.00 - 00:07.00)
  {
    id: "S02_SH01",
    sceneId: "S02",
    sceneTitle: "Game introduction",
    kind: "footage",
    shotId: "KR_S02_SH01",
    trimStartSec: 0.8,
    trimEndSec: 3.8,
    volume: 0.92,
    dialogueNotes:
      'Arga: "Eh, lihat deh." (1.0-1.7s) | Naya: "Apaan?" (2.9-3.4s)',
    graphicCues: ["None — physical phone shown naturally without screen insert"],
    productionNotes: "Tight entry as Arga lifts phone; keeps both lines cleanly.",
  },

  // SCENE 03 — Claim the City (4.50s / 135f | 00:07.00 - 00:11.50)
  {
    id: "S03_SH01",
    sceneId: "S03",
    sceneTitle: "Claim the City",
    kind: "footage",
    shotId: "KR_S03_SH01",
    trimStartSec: 2.5,
    trimEndSec: 7.0,
    volume: 1.05,
    dialogueNotes:
      'Bima: "Ini rebutan wilayah gitu?" (2.6-4.3s) | Arga: "Iya. Siapa yang dapat paling banyak." (4.8-6.9s)',
    graphicCues: ['Temporary title: "CLAIM THE CITY / SATU KOTA. DUA TIM."'],
    productionNotes:
      "Enters on animated paper map just before Bima speaks; conveys premise cleanly without rule lecture.",
    tempOverlay: "s03-title",
  },

  // SCENE 04 — Transportation Parallel Montage (6.10s / 183f | 00:11.50 - 00:17.60)
  {
    id: "S04_SH01",
    sceneId: "S04",
    sceneTitle: "Transportation",
    kind: "footage",
    shotId: "KR_S04_SH01",
    trimStartSec: 0.0,
    trimEndSec: 1.3,
    volume: 0.9,
    dialogueNotes: "Natural Jakarta street walk (pre-dialogue action beat)",
    graphicCues: ["Temporary team badge: GREEN TEAM"],
    productionNotes: "Rhythmic opener establishing Green Team heading to TransJakarta.",
    tempOverlay: "s04-green-tag",
  },
  {
    id: "S04_SH02",
    sceneId: "S04",
    sceneTitle: "Transportation",
    kind: "footage",
    shotId: "KR_S04_SH02",
    trimStartSec: 1.6,
    trimEndSec: 3.1,
    volume: 0.88,
    dialogueNotes: 'Bima: "Udah, ikut gua aja." (1.8-2.9s)',
    graphicCues: ["Temporary team badge: YELLOW TEAM"],
    productionNotes:
      "Parallel cut to Yellow Team approaching Blok M MRT; concise spontaneous beat.",
    tempOverlay: "s04-yellow-tag",
  },
  {
    id: "S04_SH03",
    sceneId: "S04",
    sceneTitle: "Transportation",
    kind: "footage",
    shotId: "KR_S04_SH03",
    trimStartSec: 6.1,
    trimEndSec: 7.6,
    volume: 0.95,
    dialogueNotes: 'Arga: "Oke, gas." (6.6-7.3s) inside moving TransJakarta',
    graphicCues: ["Temporary team badge: GREEN TEAM · TransJakarta"],
    productionNotes: "Crisp strategic nod inside TransJakarta; omits mid-bus chatter.",
    tempOverlay: "s04-green-tag",
  },
  {
    id: "S04_SH04",
    sceneId: "S04",
    sceneTitle: "Transportation",
    kind: "footage",
    shotId: "KR_S04_SH04",
    trimStartSec: 0.9,
    trimEndSec: 2.7,
    volume: 0.92,
    dialogueNotes: 'Sari: "Eh, bagus juga ya dari sini." (1.0-2.5s) raising camera',
    graphicCues: ["Temporary team badge: YELLOW TEAM · MRT Jakarta"],
    productionNotes:
      "Plants Sari's compact digital camera photographing Jakarta from MRT window.",
    tempOverlay: "s04-yellow-tag",
  },

  // SCENE 05 — GBK challenge (6.00s / 180f | 00:17.60 - 00:23.60)
  {
    id: "S05_SH01",
    sceneId: "S05",
    sceneTitle: "GBK challenge",
    kind: "footage",
    shotId: "KR_S05_SH01",
    trimStartSec: 0.0,
    trimEndSec: 2.3,
    volume: 1.08,
    dialogueNotes: 'Arga: "Bentar, gue check-in dulu." (0.1-1.4s)',
    graphicCues: ["Temp badge: 1. CHECK-IN BERHASIL -> Tantangan terbuka"],
    productionNotes:
      "Check-in beat only; omits follow-up gate explanation. Check-in does not grant ownership.",
    tempOverlay: "s05-checkin",
  },
  {
    id: "S05_SH02",
    sceneId: "S05",
    sceneTitle: "GBK challenge",
    kind: "footage",
    shotId: "KR_S05_SH02",
    trimStartSec: 5.8,
    trimEndSec: 7.4,
    volume: 1.15,
    dialogueNotes: "Natural GBK exploration stride (omits gate-by-gate lecture)",
    graphicCues: ["Temp badge: 2. TANTANGAN · Eksplorasi GBK"],
    productionNotes:
      "Action cutaway moving around Gelora Bung Karno without spotlighting unverified gate codes.",
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
    dialogueNotes: 'Naya: "Nah, dapet!" (5.9-6.9s) + celebration',
    graphicCues: ["Temp badge: 3. LANDMARK DIKLAIM · GBK -> Green Team"],
    productionNotes:
      "Cuts cleanly after unverified code recitation directly into claim completion.",
    tempOverlay: "s05-claimed",
  },

  // SCENE 06 — Competitive tension / Yellow takes the lead (6.90s / 207f | 00:23.60 - 00:30.50)
  {
    id: "S06_SH01",
    sceneId: "S06",
    sceneTitle: "Competitive tension",
    kind: "footage",
    shotId: "KR_S06_SH01",
    trimStartSec: 3.6,
    trimEndSec: 6.7,
    volume: 0.94,
    dialogueNotes:
      '[photo snap ~4.1s] | Sari: "Udah, gue kirim ya." (5.2-6.2s)',
    graphicCues: [
      "Temp two-beat status: Foto terkirim (Menunggu verifikasi) -> Terverifikasi · Bundaran HI diklaim Yellow",
    ],
    productionNotes:
      "Communicates verification before ownership without a separate multi-screen workflow.",
    tempOverlay: "s06-photo-verified",
  },
  {
    id: "S06_SH03_V4",
    sceneId: "S06",
    sceneTitle: "Competitive tension",
    kind: "footage",
    shotId: "KR_S06_SH03_V4",
    trimStartSec: 0.4,
    trimEndSec: 4.2,
    volume: 0.84,
    dialogueNotes:
      'Naya: "Eh, mereka udah dua zona!" (0.5-2.1s) | Arga: "Serius? Kita baru satu?" (2.5-4.0s)',
    graphicCues: ["Temp scoreboard: ZONA DIKUASAI · GREEN 1 — YELLOW 2"],
    productionNotes:
      "Confirmed clean V4 take; cuts cleanly in 4.1-4.2s pause right before Naya's next line.",
    tempOverlay: "s06-standings-1-2",
  },

  // SCENE 07 — Tactical comeback (14.80s / 444f | 00:30.50 - 00:45.30)
  {
    id: "S07_SH01",
    sceneId: "S07",
    sceneTitle: "Tactical comeback",
    kind: "footage",
    shotId: "KR_S07_SH01",
    trimStartSec: 4.4,
    trimEndSec: 7.0,
    volume: 0.95,
    dialogueNotes: 'Bima: "Yah, salah!" (4.6-5.8s) + exasperated reaction',
    graphicCues: [
      "Temp notice: JAWABAN SALAH · Cooldown 30:00 · Sarinah tetap belum diklaim",
    ],
    productionNotes:
      "Starts in clean silence at 4.4s after Sari's question; Yellow never owns Sarinah.",
    tempOverlay: "s07-yellow-fail",
  },
  {
    id: "S07_SH02",
    sceneId: "S07",
    sceneTitle: "Tactical comeback",
    kind: "footage",
    shotId: "KR_S07_SH02",
    trimStartSec: 0.6,
    trimEndSec: 6.0,
    volume: 0.88,
    dialogueNotes:
      'Arga: "Bentar! Sarinah bisa direbut!" | Naya: "Deket dong dari sini!" | Arga: "Kita masih punya Poin Ganda!" | Naya: "Gas!"',
    graphicCues: [
      "Temp Beat 1: Relief Sarinah masih bisa diklaim! (Belum diklaim)",
      "Temp Beat 2: Kartu tersedia · Poin Ganda (2x) · Belum aktif",
    ],
    productionNotes:
      "Single unbroken 5.40s take avoids visual jump cuts while retaining all 4 iconic lines. Uses simple temporary cards here (standalone dossier prototype stays untouched).",
    tempOverlay: "s07-opportunity-and-card",
  },
  {
    id: "S07_SH04",
    sceneId: "S07",
    sceneTitle: "Tactical comeback",
    kind: "footage",
    shotId: "KR_S07_SH04",
    trimStartSec: 3.0,
    trimEndSec: 7.7,
    volume: 0.94,
    dialogueNotes:
      'Arga: "Dapet!" (3.3-3.6s) | "Gue pake Poin Ganda ya." (4.2-5.1s) | Naya: "Yes! Kita unggul!" + fist bump (5.9-7.4s)',
    graphicCues: [
      "Temp 3-beat sync: Sarinah diklaim (Netral 1-1) -> Poin Ganda 2x aktif -> Sudirman-Thamrin Green (2-1)",
    ],
    productionNotes:
      "Omits unverified relief count recitation and travel interlude; enters cleanly on claim payoff.",
    tempOverlay: "s07-claim-and-poin-ganda",
  },
  {
    id: "INT_S07_TURNAROUND",
    sceneId: "S07",
    sceneTitle: "Tactical comeback",
    kind: "interlude",
    interludeKind: "sarinah-turnaround-60s",
    durationSec: 2.1,
    label: "Temp scoreboard flip: Netral 1-1 -> Poin Ganda 2x -> Green 2 - Yellow 1",
    graphicCues: [
      "Temp progression: Green 1 - Yellow 1 (Netral) -> Poin Ganda 2x (Bobot 1->2) -> ZONA DIKUASAI Green 2 - Yellow 1",
    ],
    productionNotes:
      "Concise 2.10s editorial clarity beat locking in zone control vs. landmark weight.",
  },

  // SCENE 08 — Weekend Memories (10.90s / 327f | 00:45.30 - 00:56.20)
  {
    id: "INT_S08_RESULT",
    sceneId: "S08",
    sceneTitle: "Weekend Memories",
    kind: "interlude",
    interludeKind: "match-result-60s",
    durationSec: 1.4,
    label: "Match expiry & final result: Green Team wins 2-1 controlled zones",
    graphicCues: ["Waktu ronde habis · Pemenang Green Team (2-1 Zona dikuasai)"],
    productionNotes:
      "Explicitly establishes match expiry by timer before cutting to warung reunion.",
  },
  {
    id: "S08_SH01",
    sceneId: "S08",
    sceneTitle: "Weekend Memories",
    kind: "footage",
    shotId: "KR_S08_SH01",
    trimStartSec: 0.2,
    trimEndSec: 4.5,
    volume: 0.92,
    dialogueNotes:
      'Naya: "Minggu depan main lagi, yuk." (0.3-1.3s) | Bima: "Gas. Tapi gue mau rematch." (2.4-4.3s)',
    graphicCues: ["None — warm unencumbered friendship moment"],
    productionNotes:
      "Retains core friendship/rematch exchange cleanly; natural group laughter follows in SH02 L-cut.",
  },
  {
    id: "S08_SH02_V2",
    sceneId: "S08",
    sceneTitle: "Weekend Memories",
    kind: "footage",
    shotId: "KR_S08_SH02_V2",
    trimStartSec: 3.7,
    trimEndSec: 5.77,
    audioCarryOverSec: 1.4,
    volume: 1.0,
    dialogueNotes:
      'Sari: "Satu... dua... tiga." (3.8-5.6s) | [SHUTTER CLICK at 5.75s] | Natural laughter carries 1.40s into photo montage',
    graphicCues: ["Shutter flash at 5.77s bridging cleanly into photographic montage"],
    productionNotes:
      "Confirmed steady V2 take. L-cut preserves genuine post-shutter laughter over opening photos.",
  },
  {
    id: "S08_MONTAGE",
    sceneId: "S08",
    sceneTitle: "Weekend Memories",
    kind: "montage",
    durationSec: 3.1333, // Exactly 94 frames at 30 fps
    label: "Concise Weekend Memories photographic montage",
    graphicCues: [
      "Flash -> KR_PH01_MRT (14f) -> KR_PH03_GBK (14f) -> KR_PH04_KENDAL (14f) -> KR_S08_PH01 hero selfie hold (52f / 1.73s)",
    ],
    productionNotes:
      "Selected 4-photo emotional arc preserving original aspect ratios and giving the final group selfie the longest hold.",
  },

  // SCENE 09 — Brand reveal (3.80s / 114f | 00:56.20 - 01:00.00)
  {
    id: "S09_BRAND",
    sceneId: "S09",
    sceneTitle: "Brand reveal",
    kind: "brand-reveal",
    durationSec: 3.8,
    label: "Kelana Ria Brand Reveal",
    graphicCues: ['Official lockup + "Mainkan kotamu." + "SEGERA HADIR"'],
    productionNotes:
      "Unhurried reading time ending cleanly at exactly 1,800 frames (60.00s).",
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
