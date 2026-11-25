/**
 * Verified campaign asset registry.
 * Remotion serves ../assets directly via Config.setPublicDir("../assets"),
 * so paths below are relative to the repository's assets/ directory without duplicating media.
 */

export type ShotId =
  | "KR_S01_SH01"
  | "KR_S02_SH01"
  | "KR_S03_SH01"
  | "KR_S04_SH01"
  | "KR_S04_SH02"
  | "KR_S04_SH03"
  | "KR_S04_SH04"
  | "KR_S05_SH01"
  | "KR_S05_SH02"
  | "KR_S05_SH04"
  | "KR_S06_SH01"
  | "KR_S06_SH03_V4"
  | "KR_S07_SH01"
  | "KR_S07_SH02"
  | "KR_S07_SH04"
  | "KR_S08_SH01"
  | "KR_S08_SH02_V2";

export type FootageAsset = {
  readonly shotId: ShotId;
  readonly path: string;
  readonly description: string;
  readonly sourceDurationSec: number;
  readonly width: number;
  readonly height: number;
  readonly sourceFps: number;
  readonly measuredRmsDb: number;
  readonly measuredPeakDb: number;
};

/**
 * Maps canonical storyboard Shot IDs to the actual filenames in assets/footage/.
 * Note: Disk filenames use KR_SH##_SH##.mp4 and omit _V4/_V2 suffixes;
 * visual inspection confirmed KR_SH06_SH03.mp4 (V4 clean pedestrian) and KR_SH08_SH02.mp4 (V2 steady camera).
 */
export const FOOTAGE_ASSETS: Record<ShotId, FootageAsset> = {
  KR_S01_SH01: {
    shotId: "KR_S01_SH01",
    path: "footage/KR_SH01_SH01.mp4",
    description: "Weekend routine at roadside cafe",
    sourceDurationSec: 7.93,
    width: 1920,
    height: 1080,
    sourceFps: 24,
    measuredRmsDb: -27.2,
    measuredPeakDb: -8.4,
  },
  KR_S02_SH01: {
    shotId: "KR_S02_SH01",
    path: "footage/KR_SH02_SH01.mp4",
    description: "Arga introduces the game on his phone",
    sourceDurationSec: 3.92,
    width: 1920,
    height: 1080,
    sourceFps: 24,
    measuredRmsDb: -19.0,
    measuredPeakDb: -1.0,
  },
  KR_S03_SH01: {
    shotId: "KR_S03_SH01",
    path: "footage/KR_SH03_SH01.mp4",
    description: "Claim the City animated paper map",
    sourceDurationSec: 7.93,
    width: 1920,
    height: 1080,
    sourceFps: 24,
    measuredRmsDb: -23.8,
    measuredPeakDb: -4.2,
  },
  KR_S04_SH01: {
    shotId: "KR_S04_SH01",
    path: "footage/KR_SH04_SH01.mp4",
    description: "Green Team walking toward TransJakarta",
    sourceDurationSec: 5.97,
    width: 1920,
    height: 1080,
    sourceFps: 24,
    measuredRmsDb: -21.1,
    measuredPeakDb: -2.3,
  },
  KR_S04_SH02: {
    shotId: "KR_S04_SH02",
    path: "footage/KR_SH04_SH02.mp4",
    description: "Yellow Team walking toward Blok M MRT",
    sourceDurationSec: 5.97,
    width: 1920,
    height: 1080,
    sourceFps: 24,
    measuredRmsDb: -19.1,
    measuredPeakDb: 0.0,
  },
  KR_S04_SH03: {
    shotId: "KR_S04_SH03",
    path: "footage/KR_SH04_SH03.mp4",
    description: "Green Team strategizing inside TransJakarta",
    sourceDurationSec: 7.93,
    width: 1920,
    height: 1080,
    sourceFps: 24,
    measuredRmsDb: -21.6,
    measuredPeakDb: -1.2,
  },
  KR_S04_SH04: {
    shotId: "KR_S04_SH04",
    path: "footage/KR_SH04_SH04.mp4",
    description: "Yellow Team inside MRT; Sari takes window photo",
    sourceDurationSec: 7.93,
    width: 1920,
    height: 1080,
    sourceFps: 24,
    measuredRmsDb: -19.9,
    measuredPeakDb: -2.9,
  },
  KR_S05_SH01: {
    shotId: "KR_S05_SH01",
    path: "footage/KR_SH05_SH01.mp4",
    description: "Green Team arrives at GBK and checks in",
    sourceDurationSec: 7.93,
    width: 1920,
    height: 1080,
    sourceFps: 24,
    measuredRmsDb: -23.9,
    measuredPeakDb: -3.0,
  },
  KR_S05_SH02: {
    shotId: "KR_S05_SH02",
    path: "footage/KR_SH05_SH02.mp4",
    description: "Green Team observes GBK Gate H",
    sourceDurationSec: 7.93,
    width: 1920,
    height: 1080,
    sourceFps: 24,
    measuredRmsDb: -26.7,
    measuredPeakDb: -5.6,
  },
  KR_S05_SH04: {
    shotId: "KR_S05_SH04",
    path: "footage/KR_SH05_SH04.mp4",
    description: "Green Team assembles GBK code and claims landmark",
    sourceDurationSec: 7.93,
    width: 1920,
    height: 1080,
    sourceFps: 24,
    measuredRmsDb: -25.1,
    measuredPeakDb: -4.6,
  },
  KR_S06_SH01: {
    shotId: "KR_S06_SH01",
    path: "footage/KR_SH06_SH01.mp4",
    description: "Yellow Team Bundaran HI photo challenge submission",
    sourceDurationSec: 7.93,
    width: 1920,
    height: 1080,
    sourceFps: 24,
    measuredRmsDb: -20.6,
    measuredPeakDb: -2.6,
  },
  KR_S06_SH03_V4: {
    shotId: "KR_S06_SH03_V4",
    path: "footage/KR_SH06_SH03.mp4",
    description: "Green Team discovers Yellow leads 2-1 at Terowongan Kendal (V4)",
    sourceDurationSec: 7.93,
    width: 1920,
    height: 1080,
    sourceFps: 24,
    measuredRmsDb: -17.5,
    measuredPeakDb: -1.3,
  },
  KR_S07_SH01: {
    shotId: "KR_S07_SH01",
    path: "footage/KR_SH07_SH01.mp4",
    description: "Yellow Team fails Sarinah relief challenge",
    sourceDurationSec: 7.93,
    width: 1920,
    height: 1080,
    sourceFps: 24,
    measuredRmsDb: -21.3,
    measuredPeakDb: -2.4,
  },
  KR_S07_SH02: {
    shotId: "KR_S07_SH02",
    path: "footage/KR_SH07_SH02.mp4",
    description: "Green Team receives Sarinah opportunity at Terowongan Kendal",
    sourceDurationSec: 7.93,
    width: 1920,
    height: 1080,
    sourceFps: 24,
    measuredRmsDb: -18.9,
    measuredPeakDb: -0.4,
  },
  KR_S07_SH04: {
    shotId: "KR_S07_SH04",
    path: "footage/KR_SH07_SH04.mp4",
    description: "Green Team claims Sarinah and activates Poin Ganda",
    sourceDurationSec: 7.93,
    width: 1920,
    height: 1080,
    sourceFps: 24,
    measuredRmsDb: -20.6,
    measuredPeakDb: -0.3,
  },
  KR_S08_SH01: {
    shotId: "KR_S08_SH01",
    path: "footage/KR_SH08_SH01.mp4",
    description: "Warung reunion and playful rematch",
    sourceDurationSec: 7.93,
    width: 1920,
    height: 1080,
    sourceFps: 24,
    measuredRmsDb: -20.0,
    measuredPeakDb: -0.4,
  },
  KR_S08_SH02_V2: {
    shotId: "KR_S08_SH02_V2",
    path: "footage/KR_SH08_SH02.mp4",
    description: "Group selfie at warung with compact digital camera (V2)",
    sourceDurationSec: 7.93,
    width: 1920,
    height: 1080,
    sourceFps: 24,
    measuredRmsDb: -22.9,
    measuredPeakDb: -4.8,
  },
};

export const PHOTO_ASSETS = {
  mrtWindow: {
    id: "KR_PH01_MRT",
    path: "photos/KR_PH01_MRT.jpg",
    width: 2400,
    height: 1792,
    theme: "Perjalanan",
    caption: "MRT Jakarta",
  },
  bundaranHi: {
    id: "KR_PH02_BUNDARAN_HI",
    path: "photos/KR_PH02_BUNDARAN_HI.jpg",
    width: 2400,
    height: 1792,
    theme: "Tantangan",
    caption: "Bundaran HI",
  },
  gbkArga: {
    id: "KR_PH03_GBK",
    path: "photos/KR_PH03_GBK.jpg",
    width: 2400,
    height: 1792,
    theme: "Eksplorasi",
    caption: "Gelora Bung Karno",
  },
  kendalNaya: {
    id: "KR_PH04_KENDAL",
    path: "photos/KR_PH04_KENDAL.jpg",
    width: 2400,
    height: 1792,
    theme: "Momen kecil",
    caption: "Terowongan Kendal",
  },
  warungSelfie: {
    id: "KR_S08_PH01",
    path: "photos/KR_S08_PH01.jpg",
    width: 2752,
    height: 1536,
    theme: "Kebersamaan",
    caption: "Akhir pekan di Jakarta",
  },
} as const;

export const UI_COMPONENTS = {
  opportunity: {
    path: "ui/components/KR_COMPONENT_OPPORTUNITY.png",
    width: 636,
    height: 154,
  },
  poinGanda: {
    path: "ui/components/KR_COMPONENT_POIN_GANDA.png",
    width: 684,
    height: 144,
  },
  checkin: {
    path: "ui/components/KR_COMPONENT_CHECKIN.png",
    width: 684,
    height: 46,
  },
  challenge: {
    path: "ui/components/KR_COMPONENT_CHALLENGE.png",
    width: 684,
    height: 1136,
  },
  claimSuccess: {
    path: "ui/components/KR_COMPONENT_CLAIM_SUCCESS.png",
    width: 684,
    height: 46,
  },
  cooldown: {
    path: "ui/components/KR_COMPONENT_COOLDOWN.png",
    width: 684,
    height: 346,
  },
  zoneNeutral: {
    path: "ui/components/KR_COMPONENT_ZONE_NEUTRAL.png",
    width: 636,
    height: 198,
  },
  zoneGreen: {
    path: "ui/components/KR_COMPONENT_ZONE_GREEN.png",
    width: 636,
    height: 196,
  },
  teamStandings: {
    path: "ui/components/KR_COMPONENT_TEAM_STANDINGS.png",
    width: 684,
    height: 372,
  },
  matchResult: {
    path: "ui/components/KR_COMPONENT_RESULT.png",
    width: 684,
    height: 236,
  },
} as const;

export const UI_MAPS = {
  gbk: {
    path: "ui/maps/KR_UI_MAP_GBK.png",
    width: 780,
    height: 1688,
  },
  /**
   * Shows Jalan Kendal -> Bundaran HI (ST Yellow Team) -> Sarinah (unclaimed dark circle pin).
   * Safe for pre-claim Sudirman-Thamrin geography when cropped to map canvas + attribution.
   */
  bundaranHiCorridor: {
    path: "ui/maps/KR_UI_MAP_BUNDARAN_HI.png",
    width: 780,
    height: 1688,
  },
  /**
   * Post-Poin-Ganda state (Sarinah claimed Green x2, ST Green Team).
   * NEVER display before Green claims Sarinah and activates Poin Ganda.
   */
  sarinahPostPoinGanda: {
    path: "ui/maps/KR_UI_MAP_SARINAH.png",
    width: 780,
    height: 1688,
  },
} as const;

export const UI_SCREENS = {
  scoreYellowLeading: "ui/screens/KR_UI_SCORE_YELLOW_LEADING.png",
  poinGandaInventory: "ui/screens/KR_UI_POIN_GANDA_INVENTORY.png",
  gameBoard: "ui/screens/KR_UI_GAME_BOARD.png",
} as const;

export const BRAND_ASSETS = {
  icon192: "brands/logos/icon-192.png",
  icon512: "brands/logos/icon-512.png",
  maskable512: "brands/logos/maskable-512.png",
  artworkJakarta: "brands/artwork/jakarta.webp",
  artworkSeekRewards: "brands/artwork/seek-rewards.webp",
} as const;
