import type {
  GameBoard,
  SoloChallenge,
  SoloCheckpoint,
  SoloEdition,
  SoloPoint,
  SoloRouteAttribution,
} from "@kelana-ria/contracts";

export type ReviewedTask = {
  siteId: string;
  reviewed: boolean;
  reviewedAt: string;
  challenge: SoloChallenge;
  correctChoiceId: string;
};

export type SoloFixture = {
  edition: SoloEdition;
  checkIn: { radiusMeters: number; maxAccuracyMeters: number; maxAgeMs: number };
  cooldownMs: number;
  tasks: Record<string, { challenge: SoloChallenge; correctChoiceId: string; siteId?: string; reviewed?: boolean }>;
};

export type RouteLeg = {
  fromId: string;
  toId: string;
  mode: "walk" | "mrt" | "krl" | "transjakarta";
  distanceMeters: number;
  travelMs: number;
};

export type WalkingRouteSnapshot = {
  board: GameBoard;
  boardVersion: string;
  provider: string;
  retrievedAt: string;
  attribution: string;
  challengeMs: number;
  missedConnectionPenaltyMs: number;
  legs: RouteLeg[];
};

export type BoardCatalog = {
  board: GameBoard;
  boardVersion: string;
  format: "claim-the-city";
  players: 1 | 2;
  start: SoloPoint;
  checkIn: { radiusMeters: number; maxAccuracyMeters: number; maxAgeMs: number };
  cooldownMs: number;
  checkpoints: Record<string, SoloCheckpoint>;
  tasks: Record<string, ReviewedTask>;
  compactCheckpointIds?: ReadonlySet<string>;
};

export type CompactBoardCatalog = BoardCatalog;

export const COMPACT_BOARD_VERSION = "compact-board-v1";

export const compactStart: SoloPoint = {
  id: "csw-asean",
  name: "CSW–ASEAN",
  latitude: -6.23831,
  longitude: 106.79889,
  x: 43,
  y: 54,
};

export const compactCheckpoints: Record<string, SoloCheckpoint> = {
  "taman-literasi": {
    id: "taman-literasi",
    name: "Taman Literasi",
    latitude: -6.24363,
    longitude: 106.80074,
    x: 74,
    y: 77,
    zone: "Blok M",
    transit: "MRT Blok M",
  },
  "blok-m-plaza": {
    id: "blok-m-plaza",
    name: "Blok M Plaza",
    latitude: -6.2446,
    longitude: 106.79748,
    x: 47,
    y: 83,
    zone: "Blok M",
    transit: "MRT Blok M",
  },
  "m-bloc": {
    id: "m-bloc",
    name: "M Bloc Space",
    latitude: -6.24094,
    longitude: 106.79912,
    x: 63,
    y: 63,
    zone: "Blok M",
    transit: "MRT ASEAN",
  },
  "taman-ayodya": {
    id: "taman-ayodya",
    name: "Taman Ayodya",
    latitude: -6.24459,
    longitude: 106.79173,
    x: 24,
    y: 76,
    zone: "Blok M",
    transit: "MRT Blok M",
  },
  "stadion-madya": {
    id: "stadion-madya",
    name: "Stadion Madya",
    latitude: -6.21852,
    longitude: 106.80121,
    x: 64,
    y: 20,
    zone: "Senayan",
    transit: "Transjakarta Gelora Bung Karno",
  },
  "plaza-senayan": {
    id: "plaza-senayan",
    name: "Plaza Senayan",
    latitude: -6.22559,
    longitude: 106.7995,
    x: 46,
    y: 37,
    zone: "Senayan",
    transit: "MRT Senayan",
  },
  "pasar-mayestik": {
    id: "pasar-mayestik",
    name: "Pasar Mayestik",
    latitude: -6.2418,
    longitude: 106.7905,
    x: 20,
    y: 66,
    zone: "Kebayoran",
    transit: "Transjakarta Mayestik",
  },
  "velbak-kebayoran": {
    id: "velbak-kebayoran",
    name: "Simpul Velbak–Kebayoran",
    latitude: -6.2374,
    longitude: 106.7826,
    x: 14,
    y: 52,
    zone: "Kebayoran",
    transit: "KRL Kebayoran · Transjakarta Velbak",
  },
  "taman-daksa": {
    id: "taman-daksa",
    name: "Taman Daksa",
    latitude: -6.2356,
    longitude: 106.8065,
    x: 82,
    y: 50,
    zone: "Kebayoran",
    transit: "Transjakarta Rawa Barat",
  },
  "stasiun-palmerah": {
    id: "stasiun-palmerah",
    name: "Stasiun Palmerah",
    latitude: -6.2072,
    longitude: 106.7975,
    x: 38,
    y: 12,
    zone: "Senayan",
    transit: "KRL Palmerah",
  },
};

export const compactReviewedTasks: Record<string, ReviewedTask> = {
  "taman-literasi": {
    siteId: "taman-literasi",
    reviewed: true,
    reviewedAt: "2026-11-20",
    challenge: {
      checkpointId: "taman-literasi",
      prompt:
        "Panel simulasi: deretan kursi mengitari panggung seperti bulan sabit. Bagaimana susunan kursinya?",
      choices: [
        { id: "tl-8d", label: "Barisan lurus" },
        { id: "tl-3f", label: "Setengah lingkaran" },
        { id: "tl-5b", label: "Lingkaran penuh" },
      ],
    },
    correctChoiceId: "tl-3f",
  },
  "blok-m-plaza": {
    siteId: "blok-m-plaza",
    reviewed: true,
    reviewedAt: "2026-11-20",
    challenge: {
      checkpointId: "blok-m-plaza",
      prompt:
        "Panel simulasi: papan di dekat pintu masuk menunjukkan empat sisi sama panjang dan empat sudut siku-siku. Bentuk apa yang terlihat?",
      choices: [
        { id: "bp-2f", label: "Persegi" },
        { id: "bp-4a", label: "Segitiga" },
        { id: "bp-7e", label: "Lingkaran" },
      ],
    },
    correctChoiceId: "bp-2f",
  },
  "m-bloc": {
    siteId: "m-bloc",
    reviewed: true,
    reviewedAt: "2026-11-20",
    challenge: {
      checkpointId: "m-bloc",
      prompt:
        "Panel simulasi: dari ambang pintu terlihat mural dengan matahari, awan, dan dua layang-layang. Berapa layang-layang yang terlihat?",
      choices: [
        { id: "mb-9a", label: "Satu" },
        { id: "mb-7c", label: "Tiga" },
        { id: "mb-2e", label: "Dua" },
      ],
    },
    correctChoiceId: "mb-2e",
  },
  "taman-ayodya": {
    siteId: "taman-ayodya",
    reviewed: true,
    reviewedAt: "2026-11-20",
    challenge: {
      checkpointId: "taman-ayodya",
      prompt:
        "Panel simulasi: di tepi kolam, papan penunjuk jalan bergambar hewan bersayap dan berparuh. Hewan apa yang tergambar?",
      choices: [
        { id: "ta-5c", label: "Kucing" },
        { id: "ta-8e", label: "Burung" },
        { id: "ta-3a", label: "Ikan" },
      ],
    },
    correctChoiceId: "ta-8e",
  },
  "stadion-madya": {
    siteId: "stadion-madya",
    reviewed: true,
    reviewedAt: "2026-11-20",
    challenge: {
      checkpointId: "stadion-madya",
      prompt:
        "Panel simulasi: papan di gerbang menampilkan atlet dengan satu kaki terangkat, lengan terayun, dan garis finis di depannya. Olahraga apa yang ditampilkan?",
      choices: [
        { id: "sm-1c", label: "Renang" },
        { id: "sm-4f", label: "Panahan" },
        { id: "sm-6e", label: "Lari" },
      ],
    },
    correctChoiceId: "sm-6e",
  },
  "plaza-senayan": {
    siteId: "plaza-senayan",
    reviewed: true,
    reviewedAt: "2026-11-20",
    challenge: {
      checkpointId: "plaza-senayan",
      prompt:
        "Panel simulasi: jam di atas pintu menunjukkan jarum pendek di angka tiga dan jarum panjang di angka dua belas. Pukul berapa yang ditunjukkan?",
      choices: [
        { id: "ps-7b", label: "03.00" },
        { id: "ps-5e", label: "06.00" },
        { id: "ps-2a", label: "12.00" },
      ],
    },
    correctChoiceId: "ps-7b",
  },
  "pasar-mayestik": {
    siteId: "pasar-mayestik",
    reviewed: true,
    reviewedAt: "2026-11-20",
    challenge: {
      checkpointId: "pasar-mayestik",
      prompt:
        "Panel simulasi: di atas kanopi pintu timur terpasang deretan huruf timbul nama pasar. Di mana posisi huruf timbul tersebut?",
      choices: [
        { id: "pm-1a", label: "Di atas kanopi masuk utama" },
        { id: "pm-2b", label: "Di dasar kolam parkir bawah" },
        { id: "pm-3c", label: "Di belakang pagar rel kereta" },
      ],
    },
    correctChoiceId: "pm-1a",
  },
  "velbak-kebayoran": {
    siteId: "velbak-kebayoran",
    reviewed: true,
    reviewedAt: "2026-11-20",
    challenge: {
      checkpointId: "velbak-kebayoran",
      prompt:
        "Panel simulasi: koridor layang menghubungkan halte bus dan stasiun KRL dengan atap melengkung. Apa fungsi jembatan ini?",
      choices: [
        { id: "vk-1a", label: "Jalur khusus kendaraan barang" },
        { id: "vk-2b", label: "Penghubung pejalan kaki antarmoda" },
        { id: "vk-3c", label: "Dermaga penyeberangan sungai" },
      ],
    },
    correctChoiceId: "vk-2b",
  },
  "taman-daksa": {
    siteId: "taman-daksa",
    reviewed: true,
    reviewedAt: "2026-11-20",
    challenge: {
      checkpointId: "taman-daksa",
      prompt:
        "Panel simulasi: lintasan jalan kaki di tengah taman berbentuk melingkar mengelilingi pepohonan. Apa bentuk lintasannya?",
      choices: [
        { id: "td-1a", label: "Jalur melingkar" },
        { id: "td-2b", label: "Tangga spiral menara" },
        { id: "td-3c", label: "Terowongan lurus" },
      ],
    },
    correctChoiceId: "td-1a",
  },
  "stasiun-palmerah": {
    siteId: "stasiun-palmerah",
    reviewed: true,
    reviewedAt: "2026-11-20",
    challenge: {
      checkpointId: "stasiun-palmerah",
      prompt:
        "Panel simulasi: lantai concourse layang di atas rel menghubungkan pintu barat dan timur stasiun. Apa yang dihubungkan concourse tersebut?",
      choices: [
        { id: "sp-1a", label: "Pintu barat dan pintu timur" },
        { id: "sp-2b", label: "Terminal feri dan bandara" },
        { id: "sp-3c", label: "Dua gedung parkir bawah tanah" },
      ],
    },
    correctChoiceId: "sp-1a",
  },
};

export const compactWalkingSnapshot: WalkingRouteSnapshot = {
  board: "compact",
  boardVersion: COMPACT_BOARD_VERSION,
  provider: "Geoapify Routing API",
  retrievedAt: "2026-11-20T09:00:00Z",
  attribution:
    "Geoapify · © OpenStreetMap contributors · Transjakarta GTFS (CC BY 4.0)",
  challengeMs: 3 * 60 * 1000,
  missedConnectionPenaltyMs: 6 * 60 * 1000,
  legs: [
    // From CSW-ASEAN start to candidate opening checkpoints
    { fromId: "csw-asean", toId: "m-bloc", mode: "walk", distanceMeters: 340, travelMs: 5 * 60_000 },
    { fromId: "csw-asean", toId: "taman-literasi", mode: "walk", distanceMeters: 620, travelMs: 8 * 60_000 },
    { fromId: "csw-asean", toId: "blok-m-plaza", mode: "walk", distanceMeters: 710, travelMs: 9 * 60_000 },
    { fromId: "csw-asean", toId: "taman-ayodya", mode: "walk", distanceMeters: 980, travelMs: 12 * 60_000 },
    { fromId: "csw-asean", toId: "plaza-senayan", mode: "mrt", distanceMeters: 1650, travelMs: 9 * 60_000 },
    { fromId: "csw-asean", toId: "stadion-madya", mode: "transjakarta", distanceMeters: 2350, travelMs: 12 * 60_000 },
    { fromId: "csw-asean", toId: "pasar-mayestik", mode: "walk", distanceMeters: 960, travelMs: 11 * 60_000 },
    { fromId: "csw-asean", toId: "velbak-kebayoran", mode: "transjakarta", distanceMeters: 1820, travelMs: 8 * 60_000 },
    { fromId: "csw-asean", toId: "taman-daksa", mode: "walk", distanceMeters: 890, travelMs: 10 * 60_000 },
    { fromId: "csw-asean", toId: "stasiun-palmerah", mode: "transjakarta", distanceMeters: 3500, travelMs: 14 * 60_000 },

    // Intra-Blok M and Blok M <-> Senayan legs
    { fromId: "m-bloc", toId: "taman-literasi", mode: "walk", distanceMeters: 360, travelMs: 5 * 60_000 },
    { fromId: "taman-literasi", toId: "m-bloc", mode: "walk", distanceMeters: 360, travelMs: 5 * 60_000 },
    { fromId: "taman-literasi", toId: "blok-m-plaza", mode: "walk", distanceMeters: 380, travelMs: 5 * 60_000 },
    { fromId: "blok-m-plaza", toId: "taman-literasi", mode: "walk", distanceMeters: 380, travelMs: 5 * 60_000 },
    { fromId: "blok-m-plaza", toId: "taman-ayodya", mode: "walk", distanceMeters: 640, travelMs: 8 * 60_000 },
    { fromId: "taman-ayodya", toId: "blok-m-plaza", mode: "walk", distanceMeters: 640, travelMs: 8 * 60_000 },
    { fromId: "m-bloc", toId: "taman-ayodya", mode: "walk", distanceMeters: 910, travelMs: 11 * 60_000 },
    { fromId: "taman-ayodya", toId: "m-bloc", mode: "walk", distanceMeters: 910, travelMs: 11 * 60_000 },
    { fromId: "taman-literasi", toId: "plaza-senayan", mode: "mrt", distanceMeters: 2100, travelMs: 10 * 60_000 },
    { fromId: "plaza-senayan", toId: "taman-literasi", mode: "mrt", distanceMeters: 2100, travelMs: 10 * 60_000 },
    { fromId: "blok-m-plaza", toId: "plaza-senayan", mode: "mrt", distanceMeters: 2200, travelMs: 10 * 60_000 },
    { fromId: "plaza-senayan", toId: "blok-m-plaza", mode: "mrt", distanceMeters: 2200, travelMs: 10 * 60_000 },
    { fromId: "m-bloc", toId: "plaza-senayan", mode: "mrt", distanceMeters: 1800, travelMs: 9 * 60_000 },
    { fromId: "plaza-senayan", toId: "m-bloc", mode: "mrt", distanceMeters: 1800, travelMs: 9 * 60_000 },
    { fromId: "plaza-senayan", toId: "stadion-madya", mode: "walk", distanceMeters: 820, travelMs: 10 * 60_000 },
    { fromId: "stadion-madya", toId: "plaza-senayan", mode: "walk", distanceMeters: 820, travelMs: 10 * 60_000 },
    { fromId: "stadion-madya", toId: "m-bloc", mode: "transjakarta", distanceMeters: 2500, travelMs: 12 * 60_000 },
    { fromId: "m-bloc", toId: "stadion-madya", mode: "transjakarta", distanceMeters: 2500, travelMs: 12 * 60_000 },

    // Kebayoran / Mayestik / Daksa / Palmerah legs
    { fromId: "pasar-mayestik", toId: "velbak-kebayoran", mode: "walk", distanceMeters: 980, travelMs: 11 * 60_000 },
    { fromId: "velbak-kebayoran", toId: "pasar-mayestik", mode: "walk", distanceMeters: 980, travelMs: 11 * 60_000 },
    { fromId: "pasar-mayestik", toId: "taman-ayodya", mode: "walk", distanceMeters: 420, travelMs: 6 * 60_000 },
    { fromId: "taman-ayodya", toId: "pasar-mayestik", mode: "walk", distanceMeters: 420, travelMs: 6 * 60_000 },
    { fromId: "taman-ayodya", toId: "taman-daksa", mode: "transjakarta", distanceMeters: 1650, travelMs: 10 * 60_000 },
    { fromId: "taman-daksa", toId: "taman-ayodya", mode: "transjakarta", distanceMeters: 1650, travelMs: 10 * 60_000 },
    { fromId: "taman-daksa", toId: "plaza-senayan", mode: "mrt", distanceMeters: 1450, travelMs: 8 * 60_000 },
    { fromId: "plaza-senayan", toId: "taman-daksa", mode: "mrt", distanceMeters: 1450, travelMs: 8 * 60_000 },
    { fromId: "velbak-kebayoran", toId: "stasiun-palmerah", mode: "krl", distanceMeters: 3700, travelMs: 10 * 60_000 },
    { fromId: "stasiun-palmerah", toId: "velbak-kebayoran", mode: "krl", distanceMeters: 3700, travelMs: 10 * 60_000 },
    { fromId: "stasiun-palmerah", toId: "plaza-senayan", mode: "transjakarta", distanceMeters: 2100, travelMs: 10 * 60_000 },
    { fromId: "plaza-senayan", toId: "stasiun-palmerah", mode: "transjakarta", distanceMeters: 2100, travelMs: 10 * 60_000 },
  ],
};

export const compactRouteAttribution: SoloRouteAttribution = {
  source: "snapshot",
  provider: compactWalkingSnapshot.provider,
  retrievedAt: compactWalkingSnapshot.retrievedAt,
  attribution: compactWalkingSnapshot.attribution,
};

export const compactCatalog: CompactBoardCatalog = {
  board: "compact",
  boardVersion: COMPACT_BOARD_VERSION,
  format: "claim-the-city",
  players: 1,
  start: compactStart,
  checkIn: { radiusMeters: 100, maxAccuracyMeters: 50, maxAgeMs: 30_000 },
  cooldownMs: 30_000,
  checkpoints: compactCheckpoints,
  tasks: compactReviewedTasks,
};

function pickTasks(ids: string[]) {
  const result: SoloFixture["tasks"] = {};
  for (const id of ids) {
    const task = compactReviewedTasks[id];
    result[id] = {
      siteId: task.siteId,
      reviewed: task.reviewed,
      challenge: task.challenge,
      correctChoiceId: task.correctChoiceId,
    };
  }
  return result;
}

const trialCheckpointIds = [
  "taman-literasi",
  "blok-m-plaza",
  "m-bloc",
  "taman-ayodya",
  "stadion-madya",
  "plaza-senayan",
];

// Pins, observations, and timing are prepared QA data for simulated play.
export const compactTrial: SoloFixture = {
  edition: {
    id: "compact-solo-trial-v1",
    board: "compact",
    boardVersion: COMPACT_BOARD_VERSION,
    format: "claim-the-city",
    players: 1,
    origin: "prepared",
    durationMs: 60 * 60 * 1000,
    targets: { landmarks: 4, zones: 2 },
    start: compactStart,
    checkpoints: trialCheckpointIds.map((id) => compactCheckpoints[id]),
    routes: compactRouteAttribution,
    openings: [
      {
        firstCheckpointId: "m-bloc",
        stops: ["m-bloc", "taman-literasi", "blok-m-plaza", "plaza-senayan"],
        zones: ["Blok M", "Senayan"],
        estimatedDurationMs: 37 * 60_000,
        withMissedConnectionMs: 43 * 60_000,
        unvisitedCount: 2,
      },
      {
        firstCheckpointId: "plaza-senayan",
        stops: ["plaza-senayan", "stadion-madya", "m-bloc", "taman-literasi"],
        zones: ["Senayan", "Blok M"],
        estimatedDurationMs: 48 * 60_000,
        withMissedConnectionMs: 54 * 60_000,
        unvisitedCount: 2,
      },
    ],
  },
  checkIn: { radiusMeters: 100, maxAccuracyMeters: 50, maxAgeMs: 30_000 },
  cooldownMs: 30_000,
  tasks: pickTasks(trialCheckpointIds),
};

const alternateCheckpointIds = [
  "pasar-mayestik",
  "velbak-kebayoran",
  "taman-daksa",
  "taman-ayodya",
  "plaza-senayan",
  "stasiun-palmerah",
];

export const compactAlternate: SoloFixture = {
  edition: {
    id: "compact-solo-kebayoran-v1",
    board: "compact",
    boardVersion: COMPACT_BOARD_VERSION,
    format: "claim-the-city",
    players: 1,
    origin: "prepared",
    durationMs: 60 * 60 * 1000,
    targets: { landmarks: 4, zones: 2 },
    start: compactStart,
    checkpoints: alternateCheckpointIds.map((id) => compactCheckpoints[id]),
    routes: compactRouteAttribution,
    openings: [
      {
        firstCheckpointId: "velbak-kebayoran",
        stops: ["velbak-kebayoran", "pasar-mayestik", "taman-ayodya", "stasiun-palmerah"],
        zones: ["Kebayoran", "Senayan"],
        estimatedDurationMs: 47 * 60_000,
        withMissedConnectionMs: 53 * 60_000,
        unvisitedCount: 2,
      },
      {
        firstCheckpointId: "taman-daksa",
        stops: ["taman-daksa", "plaza-senayan", "stasiun-palmerah", "velbak-kebayoran"],
        zones: ["Kebayoran", "Senayan"],
        estimatedDurationMs: 50 * 60_000,
        withMissedConnectionMs: 56 * 60_000,
        unvisitedCount: 2,
      },
    ],
  },
  checkIn: { radiusMeters: 100, maxAccuracyMeters: 50, maxAgeMs: 30_000 },
  cooldownMs: 30_000,
  tasks: pickTasks(alternateCheckpointIds),
};

export const preparedCompactFixtures: SoloFixture[] = [
  compactTrial,
  compactAlternate,
];
