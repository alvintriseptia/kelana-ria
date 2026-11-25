import { FOOTAGE_ASSETS, type ShotId } from "./assets";

export const CAMPAIGN_FPS = 30;
export const CAMPAIGN_WIDTH = 1920;
export const CAMPAIGN_HEIGHT = 1080;

export type InterludeKind =
  | "gbk-code-bridge"
  | "bundaran-hi-standings"
  | "kendal-to-sarinah-map"
  | "sarinah-turnaround"
  | "match-result-bridge";

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
      readonly trimConfidence: "verified" | "review-recommended";
      /** Optional audio tail (in seconds) that extends past trimEndSec into the next segment. */
      readonly audioCarryOverSec?: number;
      /** Optional editorial title beat displayed over Scene 03 map reveal. */
      readonly showScene03EditorialTitle?: boolean;
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
 * Editable Master Rough Cut Timeline.
 * All sequence start frames and total duration are derived automatically from this array.
 * Trim points are based on direct visual and audio inspection of all 17 approved clips.
 */
export const ROUGHCUT_SEGMENTS_INPUT: readonly TimelineSegmentInput[] = [
  // SCENE 01 — Weekend routine
  {
    id: "S01_SH01",
    sceneId: "S01",
    sceneTitle: "Weekend routine",
    kind: "footage",
    shotId: "KR_S01_SH01",
    trimStartSec: 0.4,
    trimEndSec: 6.5,
    volume: 1.2,
    dialogueNotes:
      'Naya: "Abis ini ke mana?" (~2.5-3.9s) | Bima: "Ya... ke mana lagi?" (~4.1-5.8s)',
    graphicCues: ["None — raw establishing dialogue"],
    productionNotes:
      "Preserves natural boredom beat before dialogue; trims trailing motorbike drone after 6.5s. Source audio is quiet (-27.2 dB RMS), lifted gently to 1.20.",
    trimConfidence: "verified",
  },

  // SCENE 02 — Something different
  {
    id: "S02_SH01",
    sceneId: "S02",
    sceneTitle: "Something different",
    kind: "footage",
    shotId: "KR_S02_SH01",
    trimStartSec: 0.0,
    trimEndSec: 3.9,
    volume: 0.92,
    dialogueNotes: 'Arga: "Eh, lihat deh." (~1.2-2.2s) | Naya: "Apaan?" (~3.0-3.7s)',
    graphicCues: ["None — preserve physical phone naturally without screen insert"],
    productionNotes: "Full 3.92s clip preserved to protect both lines and hand gesture.",
    trimConfidence: "verified",
  },

  // SCENE 03 — Claim the City
  {
    id: "S03_SH01",
    sceneId: "S03",
    sceneTitle: "Claim the City",
    kind: "footage",
    shotId: "KR_S03_SH01",
    trimStartSec: 0.3,
    trimEndSec: 7.6,
    volume: 1.05,
    dialogueNotes:
      'Bima: "Ini rebutan wilayah gitu?" (~2.5-4.3s) | Arga: "Iya. Siapa yang dapat paling banyak." (~4.4-7.0s)',
    graphicCues: [
      'Editorial title overlay: "CLAIM THE CITY / SATU KOTA. DUA TIM."',
    ],
    productionNotes:
      "Builds on the supplied animated paper map. Trims only tiny lead/tail silence.",
    trimConfidence: "verified",
    showScene03EditorialTitle: true,
  },

  // SCENE 04 — Different routes, same city
  {
    id: "S04_SH01",
    sceneId: "S04",
    sceneTitle: "Different routes, same city",
    kind: "footage",
    shotId: "KR_S04_SH01",
    trimStartSec: 0.3,
    trimEndSec: 5.1,
    volume: 0.95,
    dialogueNotes:
      'Arga: "Yang deket dulu aja ya?" (~1.5-2.8s) | Naya: "Boleh. Yang mana?" (~3.0-4.4s)',
    graphicCues: ["Pending: subtle Green Team identity tag"],
    productionNotes: "Tightens trailing walk after dialogue concludes.",
    trimConfidence: "verified",
  },
  {
    id: "S04_SH02",
    sceneId: "S04",
    sceneTitle: "Different routes, same city",
    kind: "footage",
    shotId: "KR_S04_SH02",
    trimStartSec: 0.2,
    trimEndSec: 5.7,
    volume: 0.88,
    dialogueNotes:
      'Sari: "Kita mau ke mana dulu?" | Bima: "Udah, ikut gua aja." | Sari: "Yakin lo?" | Bima: "Aman." (~0.5-5.3s)',
    graphicCues: ["Pending: subtle Yellow Team identity tag"],
    productionNotes: "Preserves full rapid-fire banter approaching Blok M MRT.",
    trimConfidence: "verified",
  },
  {
    id: "S04_SH03",
    sceneId: "S04",
    sceneTitle: "Different routes, same city",
    kind: "footage",
    shotId: "KR_S04_SH03",
    trimStartSec: 0.2,
    trimEndSec: 7.6,
    volume: 0.95,
    dialogueNotes:
      'Naya: "Eh, ini sekalian aja." | Arga: "Oh iya, searah." | Naya: "Biar nggak bolak-balik." | Arga: "Oke, gas." (~0.6-7.3s)',
    graphicCues: ["Pending: minimal route/team cadence accent"],
    productionNotes: "Full conversational flow preserved inside TransJakarta.",
    trimConfidence: "verified",
  },
  {
    id: "S04_SH04",
    sceneId: "S04",
    sceneTitle: "Different routes, same city",
    kind: "footage",
    shotId: "KR_S04_SH04",
    trimStartSec: 0.4,
    trimEndSec: 6.8,
    volume: 0.92,
    dialogueNotes:
      'Sari: "Eh, bagus juga ya dari sini." | Bima: "Lo malah foto-foto." | Sari: "Bentar doang, ih." (~1.0-6.2s)',
    graphicCues: ["Plants Sari's compact camera motif paid off in Scene 08"],
    productionNotes:
      "Preserves camera snap through MRT window and Sari's smile; trims silent tail after 6.8s.",
    trimConfidence: "verified",
  },

  // SCENE 05 — Check-in, challenge, claim (GBK)
  {
    id: "S05_SH01",
    sceneId: "S05",
    sceneTitle: "Check-in, challenge, claim",
    kind: "footage",
    shotId: "KR_S05_SH01",
    trimStartSec: 0.0,
    trimEndSec: 7.3,
    volume: 1.08,
    dialogueNotes:
      'Arga: "Bentar, gue check-in dulu." | Naya: "Challenge-nya apaan?" | Arga: "Oh, disuruh nyari kode di tiga gate." (~0.2-6.9s)',
    graphicCues: ["Pending: Check-in berhasil -> Tantangan tersedia overlay"],
    productionNotes: "Dialogue begins immediately at 0.2s; kept from 0.0s.",
    trimConfidence: "verified",
  },
  {
    id: "S05_SH02",
    sceneId: "S05",
    sceneTitle: "Check-in, challenge, claim",
    kind: "footage",
    shotId: "KR_S05_SH02",
    trimStartSec: 0.0,
    trimEndSec: 6.8,
    volume: 1.18,
    dialogueNotes:
      'Arga: "B, F, sama H." (~0.0-2.1s) | Naya: "Lah, ini udah H. Abis ini lewat sini aja." (~2.9-6.0s)',
    graphicCues: ["Pending: Gate B / F / H observation tracker"],
    productionNotes:
      "Quiet source (-26.7 dB RMS), lifted to 1.18. Trims silent walk tail after 6.8s.",
    trimConfidence: "verified",
  },
  {
    id: "INT_S05_SH03",
    sceneId: "S05",
    sceneTitle: "Check-in, challenge, claim",
    kind: "interlude",
    interludeKind: "gbk-code-bridge",
    durationSec: 2.4,
    label: "Editorial bridge (missing SH03): GBK Gate B · F · H progression",
    graphicCues: [
      "Proposed code assembly 03 - 07 - 11 (leading zeros preserved)",
      "Field-verification note documented; no fictional signage claims",
    ],
    productionNotes:
      "Replaces absent SH03 live footage with concise Jakarta Playground progression card.",
  },
  {
    id: "S05_SH04",
    sceneId: "S05",
    sceneTitle: "Check-in, challenge, claim",
    kind: "footage",
    shotId: "KR_S05_SH04",
    trimStartSec: 0.3,
    trimEndSec: 7.5,
    volume: 1.14,
    dialogueNotes:
      'Naya: "Urutannya B, F, H kan?" | Arga: "Berarti 03, 07, 11." | Naya: "Nah, dapet!" (~0.5-7.0s)',
    graphicCues: ["Pending: GBK landmark claimed (+1 landmark, Senayan -> Green Team)"],
    productionNotes: "Preserves complete code readout and celebratory reaction.",
    trimConfidence: "verified",
  },

  // SCENE 06 — Competitive tension
  {
    id: "S06_SH01",
    sceneId: "S06",
    sceneTitle: "Competitive tension",
    kind: "footage",
    shotId: "KR_S06_SH01",
    trimStartSec: 0.5,
    trimEndSec: 7.1,
    volume: 0.94,
    dialogueNotes:
      'Sari: "Dari sini dapet nih." | Bima: "Ya, foto aja." | [shutter] | Sari: "Udah, gue kirim ya." (~1.2-6.6s)',
    graphicCues: [
      "Pending: Foto terkirim -> Menunggu verifikasi -> Terverifikasi -> Diklaim",
    ],
    productionNotes: "Preserves capture + submission lines cleanly.",
    trimConfidence: "verified",
  },
  {
    id: "INT_S06_STANDINGS",
    sceneId: "S06",
    sceneTitle: "Competitive tension",
    kind: "interlude",
    interludeKind: "bundaran-hi-standings",
    durationSec: 3.2,
    label: "Editorial bridge: Bundaran HI verification & 1-2 Zone Standings",
    graphicCues: [
      "Photo verification flow (fictional story photo KR_PH02_BUNDARAN_HI)",
      "Overall standings: Green 1 - Yellow 2 (Zona dikuasai)",
    ],
    productionNotes:
      "Establishes passage of time and Yellow's 2-zone lead before Terowongan Kendal.",
  },
  {
    id: "S06_SH03_V4",
    sceneId: "S06",
    sceneTitle: "Competitive tension",
    kind: "footage",
    shotId: "KR_S06_SH03_V4",
    trimStartSec: 0.2,
    trimEndSec: 7.1,
    volume: 0.84,
    dialogueNotes:
      'Naya: "Eh, mereka udah dua zona!" | Arga: "Serius? Kita baru satu?" | Naya: "Iya! Ayo, harus ngejar nih." (~0.4-6.3s)',
    graphicCues: ["Pending: Scoreboard cue (Green 1 - Yellow 2 Zona dikuasai)"],
    productionNotes:
      "Confirmed clean V4 take (KR_SH06_SH03.mp4). Loudest clip (-17.5 dB RMS), attenuated gently to 0.84.",
    trimConfidence: "verified",
  },

  // SCENE 07 — Tactical comeback
  {
    id: "S07_SH01",
    sceneId: "S07",
    sceneTitle: "Tactical comeback",
    kind: "footage",
    shotId: "KR_S07_SH01",
    trimStartSec: 0.0,
    trimEndSec: 7.2,
    volume: 0.95,
    dialogueNotes:
      'Bima: "Dua, dua, dua. Udah nih." | Sari: "Yang duduk juga dihitung kan?" | Bima: "Yah, salah!" (~0.2-5.8s)',
    graphicCues: [
      "Pending: KR_COMPONENT_COOLDOWN (Jawaban salah, 30:00 cooldown, Sarinah tetap belum diklaim)",
    ],
    productionNotes:
      "Preserves exasperated beat after failure. Never show Yellow owning Sarinah.",
    trimConfidence: "verified",
  },
  {
    id: "S07_SH02",
    sceneId: "S07",
    sceneTitle: "Tactical comeback",
    kind: "footage",
    shotId: "KR_S07_SH02",
    trimStartSec: 0.0,
    trimEndSec: 7.93,
    volume: 0.88,
    dialogueNotes:
      'Arga: "Bentar! Sarinah bisa direbut!" (0.7-2.5s) | Naya: "Deket dong dari sini!" (2.9-3.9s) | Arga: "Kita masih punya Poin Ganda!" (4.1-5.3s) | Naya: "Gas!" (5.6-5.8s)',
    graphicCues: [
      "Prototype built in standalone composition KR_MotionDesign_Test_S07_SH02",
      "KR_COMPONENT_OPPORTUNITY + Corridor Map + KR_COMPONENT_POIN_GANDA (available, not activated)",
    ],
    productionNotes:
      "Full 7.93s preserved so all 4 beats and their exit stride play cleanly.",
    trimConfidence: "verified",
  },
  {
    id: "INT_S07_SH03",
    sceneId: "S07",
    sceneTitle: "Tactical comeback",
    kind: "interlude",
    interludeKind: "kendal-to-sarinah-map",
    durationSec: 2.2,
    label: "Editorial map bridge (missing SH03): Kendal -> Relief Sarinah",
    graphicCues: [
      "Real KR_UI_MAP_BUNDARAN_HI corridor excerpt + OpenFreeMap/OSM attribution",
      "No invented travel time; Sarinah remains unclaimed",
    ],
    productionNotes: "Concise geographical transition replacing absent SH03 travel footage.",
  },
  {
    id: "S07_SH04",
    sceneId: "S07",
    sceneTitle: "Tactical comeback",
    kind: "footage",
    shotId: "KR_S07_SH04",
    trimStartSec: 0.0,
    trimEndSec: 7.8,
    volume: 0.94,
    dialogueNotes:
      'Naya: "Dua, empat, dua. Coba!" (0.2-2.2s) | Arga: "Dapet! Gue pake Poin Ganda ya." (3.0-5.5s) | Naya: "Yes! Kita unggul!" + fist bump (5.7-7.7s)',
    graphicCues: [
      "Pending: synchronized claim -> neutral 1-1 -> Poin Ganda 2x -> Green leads 2-1 overlays",
    ],
    productionNotes:
      "Full celebration and fist bump preserved; followed by concise tactical breakdown interlude.",
    trimConfidence: "verified",
  },
  {
    id: "INT_S07_TURNAROUND",
    sceneId: "S07",
    sceneTitle: "Tactical comeback",
    kind: "interlude",
    interludeKind: "sarinah-turnaround",
    durationSec: 4.4,
    label: "Editorial tactical breakdown: Exact 9-step Sarinah & Poin Ganda flip",
    graphicCues: [
      "Step 1-5: KR_COMPONENT_CLAIM_SUCCESS + KR_COMPONENT_ZONE_NEUTRAL (Bobot 1-1, Skor 1-1)",
      "Step 6-9: Poin Ganda 2x -> KR_COMPONENT_ZONE_GREEN (Bobot 2-1) -> KR_COMPONENT_TEAM_STANDINGS (Green 2 - Yellow 1 Zona dikuasai)",
    ],
    productionNotes:
      "Ensures audiences clearly follow landmark weight vs. controlled zones without cluttering SH04.",
  },

  // SCENE 08 — Weekend Memories
  {
    id: "INT_S08_RESULT",
    sceneId: "S08",
    sceneTitle: "Weekend Memories",
    kind: "interlude",
    interludeKind: "match-result-bridge",
    durationSec: 3.0,
    label: "Passage of time & Match Result: Green wins 2-1 controlled zones",
    graphicCues: [
      "KR_COMPONENT_RESULT (Waktu ronde habis · Pemenang Green Team)",
      "KR_COMPONENT_TEAM_STANDINGS (2 vs 1 Zona dikuasai; 2 landmark diklaim each)",
    ],
    productionNotes:
      "Explicitly communicates timer expiry rather than instant win on Sarinah claim.",
  },
  {
    id: "S08_SH01",
    sceneId: "S08",
    sceneTitle: "Weekend Memories",
    kind: "footage",
    shotId: "KR_S08_SH01",
    trimStartSec: 0.0,
    trimEndSec: 7.9,
    volume: 0.92,
    dialogueNotes:
      'Naya: "Minggu depan main lagi, yuk." | Bima: "Gas. Tapi gue mau rematch." | Sari: "Masih nggak terima ya?" + laughter (~0.2-7.8s)',
    graphicCues: ["None — warm unencumbered friendship moment"],
    productionNotes: "Preserves entire natural laughter through end of clip.",
    trimConfidence: "verified",
  },
  {
    id: "S08_SH02_V2",
    sceneId: "S08",
    sceneTitle: "Weekend Memories",
    kind: "footage",
    shotId: "KR_S08_SH02_V2",
    trimStartSec: 0.0,
    trimEndSec: 5.77,
    audioCarryOverSec: 1.43,
    volume: 1.0,
    dialogueNotes:
      'Sari: "Rapet dikit!" (0.7s) | "Gue masuk nggak?" (2.5s) | "Satu... dua... tiga." (3.8-5.7s) | [SHUTTER CLICK at 5.75s] | Group laughter (6.3-7.1s)',
    graphicCues: [
      "Shutter flash triggered at 5.77s (frame 173); post-shutter laugh audio carries 1.43s into photo reveal",
    ],
    productionNotes:
      "Confirmed steady V2 take (KR_SH08_SH02.mp4). Exact shutter transient measured at 5.70-5.80s.",
    trimConfidence: "verified",
  },
  {
    id: "S08_MONTAGE",
    sceneId: "S08",
    sceneTitle: "Weekend Memories",
    kind: "montage",
    durationSec: 7.6,
    label: "Weekend Memories photographic montage",
    graphicCues: [
      "Flash reveal of KR_S08_PH01 -> KR_PH01_MRT -> KR_PH03_GBK -> KR_PH02_BUNDARAN_HI -> KR_PH04_KENDAL -> Hero hold on KR_S08_PH01",
    ],
    productionNotes:
      "Original aspect ratios preserved; faces unobstructed; longest visual hold on final group selfie.",
  },

  // SCENE 09 — Brand reveal
  {
    id: "S09_BRAND",
    sceneId: "S09",
    sceneTitle: "Brand reveal",
    kind: "brand-reveal",
    durationSec: 4.5,
    label: "Kelana Ria Brand Reveal",
    graphicCues: ['Official lockup + "Mainkan kotamu." + "SEGERA HADIR"'],
    productionNotes:
      "Restrained tactile paper reveal; no narration, no invented release dates or app store badges.",
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
 * Exact cue frame markers (at 30 fps) for KR_MotionDesign_Test_S07_SH02,
 * derived from 100ms audio envelope + visual inspection of KR_SH07_SH02.mp4.
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
