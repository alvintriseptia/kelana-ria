import type {
  SoloCheckpoint,
  SoloRouteAttribution,
} from "@kelana-ria/contracts";
import {
  compactCheckpoints,
  compactReviewedTasks,
  compactStart,
  type BoardCatalog,
  type ReviewedTask,
  type SoloFixture,
  type WalkingRouteSnapshot,
} from "./solo-fixture.js";

export const JAKARTA_WIDE_BOARD_VERSION = "jakarta-wide-board-v1";

export const compactCheckpointIdSet: ReadonlySet<string> = new Set(
  Object.keys(compactCheckpoints),
);

// Trial Jakarta-wide checkpoints outside the Compact boundary (PRD §2, §5).
// Coordinates, tasks, and travel timings are prepared QA fixtures pending #14 field calibration.
export const wideOuterCheckpoints: Record<string, SoloCheckpoint> = {
  "dukuh-atas": {
    id: "dukuh-atas",
    name: "Kawasan Dukuh Atas",
    latitude: -6.2008,
    longitude: 106.8228,
    x: 54,
    y: 52,
    zone: "Sudirman–Tanah Abang",
    transit: "MRT Dukuh Atas · KRL Sudirman · Transjakarta Dukuh Atas",
  },
  "bundaran-hi": {
    id: "bundaran-hi",
    name: "Bundaran HI",
    latitude: -6.19496,
    longitude: 106.82304,
    x: 55,
    y: 44,
    zone: "Sudirman–Tanah Abang",
    transit: "MRT Bundaran HI · Transjakarta Bundaran HI",
  },
  "stasiun-tanah-abang": {
    id: "stasiun-tanah-abang",
    name: "Stasiun Tanah Abang",
    latitude: -6.18565,
    longitude: 106.81092,
    x: 34,
    y: 40,
    zone: "Sudirman–Tanah Abang",
    transit: "KRL Tanah Abang",
  },
  "stasiun-manggarai": {
    id: "stasiun-manggarai",
    name: "Stasiun Manggarai",
    latitude: -6.20985,
    longitude: 106.85028,
    x: 80,
    y: 58,
    zone: "Manggarai–Cikini",
    transit: "KRL Manggarai · Transjakarta Manggarai",
  },
  "taman-ismail-marzuki": {
    id: "taman-ismail-marzuki",
    name: "Taman Ismail Marzuki",
    latitude: -6.19002,
    longitude: 106.83965,
    x: 72,
    y: 42,
    zone: "Manggarai–Cikini",
    transit: "KRL Cikini · Transjakarta TIM",
  },
  "monas-gambir": {
    id: "monas-gambir",
    name: "Pelataran Monas–Gambir",
    latitude: -6.17539,
    longitude: 106.82715,
    x: 58,
    y: 30,
    zone: "Jakarta Kota",
    transit: "Transjakarta Monas · KRL Gondangdia",
  },
  "taman-fatahillah": {
    id: "taman-fatahillah",
    name: "Taman Fatahillah, Kota Tua",
    latitude: -6.1352,
    longitude: 106.8133,
    x: 42,
    y: 12,
    zone: "Jakarta Kota",
    transit: "KRL Jakarta Kota · Transjakarta Kota",
  },
  "stasiun-jakarta-kota": {
    id: "stasiun-jakarta-kota",
    name: "Stasiun Jakarta Kota",
    latitude: -6.13756,
    longitude: 106.81461,
    x: 50,
    y: 18,
    zone: "Jakarta Kota",
    transit: "KRL Jakarta Kota · Transjakarta Kota",
  },
};

export const wideCheckpoints: Record<string, SoloCheckpoint> = {
  ...compactCheckpoints,
  ...wideOuterCheckpoints,
};

export const wideOuterReviewedTasks: Record<string, ReviewedTask> = {
  "dukuh-atas": {
    siteId: "dukuh-atas",
    reviewed: true,
    reviewedAt: "2026-11-21",
    challenge: {
      checkpointId: "dukuh-atas",
      prompt:
        "Panel simulasi: jalur pedestrian terowongan menghubungkan stasiun MRT, KRL, dan Transjakarta di bawah jalan raya. Apa fungsi utama terowongan ini?",
      choices: [
        { id: "da-1a", label: "Penghubung pejalan kaki antarmoda" },
        { id: "da-2b", label: "Jalur lintasan mobil pribadi" },
        { id: "da-3c", label: "Dermaga angkutan sungai" },
      ],
    },
    correctChoiceId: "da-1a",
  },
  "bundaran-hi": {
    siteId: "bundaran-hi",
    reviewed: true,
    reviewedAt: "2026-11-21",
    challenge: {
      checkpointId: "bundaran-hi",
      prompt:
        "Panel simulasi: tugu di tengah kolam air mancur menampilkan sepasang patung berdiri menyambut ke arah utara. Apa nama monumen tersebut?",
      choices: [
        { id: "bh-1a", label: "Tugu Selamat Datang" },
        { id: "bh-2b", label: "Menara Syahbandar" },
        { id: "bh-3c", label: "Jembatan Kota Intan" },
      ],
    },
    correctChoiceId: "bh-1a",
  },
  "stasiun-tanah-abang": {
    siteId: "stasiun-tanah-abang",
    reviewed: true,
    reviewedAt: "2026-11-21",
    challenge: {
      checkpointId: "stasiun-tanah-abang",
      prompt:
        "Panel simulasi: papan jalur transit di stasiun menandai lintasan kereta komuter menuju Rangkasbitung dan Cikarang. Moda rel apa yang melintas di sini?",
      choices: [
        { id: "ta-wide-1a", label: "KRL Commuter Line" },
        { id: "ta-wide-2b", label: "Trem pelabuhan" },
        { id: "ta-wide-3c", label: "Kereta gantung taman" },
      ],
    },
    correctChoiceId: "ta-wide-1a",
  },
  "stasiun-manggarai": {
    siteId: "stasiun-manggarai",
    reviewed: true,
    reviewedAt: "2026-11-21",
    challenge: {
      checkpointId: "stasiun-manggarai",
      prompt:
        "Panel simulasi: lantai peron bertingkat memisahkan jalur lingkar dan jalur layang Bogor di satu simpul besar. Peran apa yang dimiliki stasiun ini?",
      choices: [
        { id: "mg-1a", label: "Stasiun transit utama KRL" },
        { id: "mg-2b", label: "Pelabuhan penumpang laut" },
        { id: "mg-3c", label: "Terminal bus antarkota saja" },
      ],
    },
    correctChoiceId: "mg-1a",
  },
  "taman-ismail-marzuki": {
    siteId: "taman-ismail-marzuki",
    reviewed: true,
    reviewedAt: "2026-11-21",
    challenge: {
      checkpointId: "taman-ismail-marzuki",
      prompt:
        "Panel simulasi: kompleks budaya di Cikini memiliki gedung perpustakaan panjang dan ruang pertunjukan seni. Aktivitas apa yang menjadi ciri utama kawasan ini?",
      choices: [
        { id: "tim-1a", label: "Pusat kesenian dan perpustakaan" },
        { id: "tim-2b", label: "Pelabuhan peti kemas" },
        { id: "tim-3c", label: "Lintasan balap sirkuit" },
      ],
    },
    correctChoiceId: "tim-1a",
  },
  "monas-gambir": {
    siteId: "monas-gambir",
    reviewed: true,
    reviewedAt: "2026-11-21",
    challenge: {
      checkpointId: "monas-gambir",
      prompt:
        "Panel simulasi: puncak tugu tinggi di tengah lapangan merdeka berbentuk nyala api berlapis emas. Bentuk apa yang berada di puncaknya?",
      choices: [
        { id: "mn-1a", label: "Lidah api berlapis emas" },
        { id: "mn-2b", label: "Baling-baling kincir angin" },
        { id: "mn-3c", label: "Kubah kaca bundar" },
      ],
    },
    correctChoiceId: "mn-1a",
  },
  "taman-fatahillah": {
    siteId: "taman-fatahillah",
    reviewed: true,
    reviewedAt: "2026-11-21",
    challenge: {
      checkpointId: "taman-fatahillah",
      prompt:
        "Panel simulasi: dari alun-alun menghadap bekas balai kota, detail apa yang terpasang di bagian puncak atap bangunan utama?",
      choices: [
        { id: "tf-1a", label: "Menara kecil beratap kubah lonceng" },
        { id: "tf-2b", label: "Papan skor lampu stadion" },
        { id: "tf-3c", label: "Cerobong asap pabrik baja" },
      ],
    },
    correctChoiceId: "tf-1a",
  },
  "stasiun-jakarta-kota": {
    siteId: "stasiun-jakarta-kota",
    reviewed: true,
    reviewedAt: "2026-11-21",
    challenge: {
      checkpointId: "stasiun-jakarta-kota",
      prompt:
        "Panel simulasi: aula utama stasiun ujung utara beratap lengkung lebar yang menaungi jalur peron. Apa ciri atap aula utamanya?",
      choices: [
        { id: "jk-1a", label: "Atap lengkung lebar di atas aula" },
        { id: "jk-2b", label: "Atap terbuka tanpa kanopi" },
        { id: "jk-3c", label: "Menara kaca bertingkat sepuluh" },
      ],
    },
    correctChoiceId: "jk-1a",
  },
};

export const wideReviewedTasks: Record<string, ReviewedTask> = {
  ...compactReviewedTasks,
  ...wideOuterReviewedTasks,
};

export const wideWalkingSnapshot: WalkingRouteSnapshot = {
  board: "jakarta-wide",
  boardVersion: JAKARTA_WIDE_BOARD_VERSION,
  provider: "Geoapify Routing API",
  retrievedAt: "2026-11-21T09:00:00Z",
  attribution:
    "Geoapify · © OpenStreetMap contributors · Transjakarta GTFS (CC BY 4.0)",
  challengeMs: 3 * 60 * 1000,
  missedConnectionPenaltyMs: 10 * 60 * 1000,
  legs: [
    // From CSW-ASEAN shared start
    { fromId: "csw-asean", toId: "plaza-senayan", mode: "mrt", distanceMeters: 1650, travelMs: 9 * 60_000 },
    { fromId: "csw-asean", toId: "dukuh-atas", mode: "mrt", distanceMeters: 5200, travelMs: 15 * 60_000 },
    { fromId: "csw-asean", toId: "bundaran-hi", mode: "mrt", distanceMeters: 6100, travelMs: 18 * 60_000 },
    { fromId: "csw-asean", toId: "stasiun-tanah-abang", mode: "transjakarta", distanceMeters: 6800, travelMs: 22 * 60_000 },
    { fromId: "csw-asean", toId: "stasiun-manggarai", mode: "transjakarta", distanceMeters: 6700, travelMs: 24 * 60_000 },
    { fromId: "csw-asean", toId: "monas-gambir", mode: "transjakarta", distanceMeters: 7800, travelMs: 25 * 60_000 },
    { fromId: "csw-asean", toId: "taman-fatahillah", mode: "transjakarta", distanceMeters: 12200, travelMs: 34 * 60_000 },
    { fromId: "csw-asean", toId: "stasiun-jakarta-kota", mode: "transjakarta", distanceMeters: 11900, travelMs: 33 * 60_000 },

    // Plaza Senayan <-> Sudirman / Tanah Abang
    { fromId: "plaza-senayan", toId: "dukuh-atas", mode: "mrt", distanceMeters: 3800, travelMs: 12 * 60_000 },
    { fromId: "dukuh-atas", toId: "plaza-senayan", mode: "mrt", distanceMeters: 3800, travelMs: 12 * 60_000 },
    { fromId: "plaza-senayan", toId: "bundaran-hi", mode: "mrt", distanceMeters: 4600, travelMs: 15 * 60_000 },
    { fromId: "bundaran-hi", toId: "plaza-senayan", mode: "mrt", distanceMeters: 4600, travelMs: 15 * 60_000 },

    // Sudirman <-> Bundaran HI <-> Tanah Abang <-> Manggarai
    { fromId: "dukuh-atas", toId: "bundaran-hi", mode: "walk", distanceMeters: 780, travelMs: 10 * 60_000 },
    { fromId: "bundaran-hi", toId: "dukuh-atas", mode: "walk", distanceMeters: 780, travelMs: 10 * 60_000 },
    { fromId: "dukuh-atas", toId: "stasiun-tanah-abang", mode: "krl", distanceMeters: 2300, travelMs: 11 * 60_000 },
    { fromId: "stasiun-tanah-abang", toId: "dukuh-atas", mode: "krl", distanceMeters: 2300, travelMs: 11 * 60_000 },
    { fromId: "dukuh-atas", toId: "stasiun-manggarai", mode: "krl", distanceMeters: 3400, travelMs: 13 * 60_000 },
    { fromId: "stasiun-manggarai", toId: "dukuh-atas", mode: "krl", distanceMeters: 3400, travelMs: 13 * 60_000 },
    { fromId: "bundaran-hi", toId: "monas-gambir", mode: "transjakarta", distanceMeters: 2400, travelMs: 12 * 60_000 },
    { fromId: "monas-gambir", toId: "bundaran-hi", mode: "transjakarta", distanceMeters: 2400, travelMs: 12 * 60_000 },
    { fromId: "stasiun-tanah-abang", toId: "monas-gambir", mode: "transjakarta", distanceMeters: 2200, travelMs: 13 * 60_000 },
    { fromId: "monas-gambir", toId: "stasiun-tanah-abang", mode: "transjakarta", distanceMeters: 2200, travelMs: 13 * 60_000 },

    // Manggarai <-> TIM <-> Monas <-> Kota Tua
    { fromId: "stasiun-manggarai", toId: "taman-ismail-marzuki", mode: "krl", distanceMeters: 2600, travelMs: 14 * 60_000 },
    { fromId: "taman-ismail-marzuki", toId: "stasiun-manggarai", mode: "krl", distanceMeters: 2600, travelMs: 14 * 60_000 },
    { fromId: "taman-ismail-marzuki", toId: "monas-gambir", mode: "transjakarta", distanceMeters: 2500, travelMs: 13 * 60_000 },
    { fromId: "monas-gambir", toId: "taman-ismail-marzuki", mode: "transjakarta", distanceMeters: 2500, travelMs: 13 * 60_000 },
    { fromId: "stasiun-manggarai", toId: "stasiun-jakarta-kota", mode: "krl", distanceMeters: 9200, travelMs: 24 * 60_000 },
    { fromId: "stasiun-jakarta-kota", toId: "stasiun-manggarai", mode: "krl", distanceMeters: 9200, travelMs: 24 * 60_000 },
    { fromId: "monas-gambir", toId: "stasiun-jakarta-kota", mode: "transjakarta", distanceMeters: 4800, travelMs: 18 * 60_000 },
    { fromId: "stasiun-jakarta-kota", toId: "monas-gambir", mode: "transjakarta", distanceMeters: 4800, travelMs: 18 * 60_000 },
    { fromId: "monas-gambir", toId: "taman-fatahillah", mode: "transjakarta", distanceMeters: 5100, travelMs: 19 * 60_000 },
    { fromId: "taman-fatahillah", toId: "monas-gambir", mode: "transjakarta", distanceMeters: 5100, travelMs: 19 * 60_000 },
    { fromId: "stasiun-jakarta-kota", toId: "taman-fatahillah", mode: "walk", distanceMeters: 380, travelMs: 5 * 60_000 },
    { fromId: "taman-fatahillah", toId: "stasiun-jakarta-kota", mode: "walk", distanceMeters: 380, travelMs: 5 * 60_000 },
    { fromId: "bundaran-hi", toId: "stasiun-jakarta-kota", mode: "transjakarta", distanceMeters: 7000, travelMs: 23 * 60_000 },
    { fromId: "stasiun-jakarta-kota", toId: "bundaran-hi", mode: "transjakarta", distanceMeters: 7000, travelMs: 23 * 60_000 },
  ],
};

export const wideRouteAttribution: SoloRouteAttribution = {
  source: "snapshot",
  provider: wideWalkingSnapshot.provider,
  retrievedAt: wideWalkingSnapshot.retrievedAt,
  attribution: wideWalkingSnapshot.attribution,
};

export const wideCatalog: BoardCatalog = {
  board: "jakarta-wide",
  boardVersion: JAKARTA_WIDE_BOARD_VERSION,
  format: "claim-the-city",
  players: 1,
  start: compactStart,
  checkIn: { radiusMeters: 100, maxAccuracyMeters: 50, maxAgeMs: 30_000 },
  cooldownMs: 30_000,
  checkpoints: wideCheckpoints,
  tasks: wideReviewedTasks,
  compactCheckpointIds: compactCheckpointIdSet,
};

function pickWideTasks(ids: string[]) {
  const result: SoloFixture["tasks"] = {};
  for (const id of ids) {
    const task = wideReviewedTasks[id];
    result[id] = {
      siteId: task.siteId,
      reviewed: task.reviewed,
      challenge: task.challenge,
      correctChoiceId: task.correctChoiceId,
    };
  }
  return result;
}

const wideTrialCheckpointIds = [
  "dukuh-atas",
  "bundaran-hi",
  "stasiun-manggarai",
  "taman-fatahillah",
  "stasiun-jakarta-kota",
  "plaza-senayan",
];

// Prepared QA fixture for Jakarta-wide solo Claim (120 min, >=2 approved points outside Compact).
export const wideTrial: SoloFixture = {
  edition: {
    id: "wide-solo-trial-v1",
    board: "jakarta-wide",
    boardVersion: JAKARTA_WIDE_BOARD_VERSION,
    format: "claim-the-city",
    players: 1,
    origin: "prepared",
    durationMs: 120 * 60 * 1000,
    targets: { landmarks: 4, zones: 2 },
    start: compactStart,
    checkpoints: wideTrialCheckpointIds.map((id) => wideCheckpoints[id]),
    routes: wideRouteAttribution,
  },
  checkIn: { radiusMeters: 100, maxAccuracyMeters: 50, maxAgeMs: 30_000 },
  cooldownMs: 30_000,
  tasks: pickWideTasks(wideTrialCheckpointIds),
};

const wideAlternateCheckpointIds = [
  "dukuh-atas",
  "stasiun-tanah-abang",
  "stasiun-manggarai",
  "taman-ismail-marzuki",
  "monas-gambir",
  "taman-fatahillah",
];

export const wideAlternate: SoloFixture = {
  edition: {
    id: "wide-solo-kota-v1",
    board: "jakarta-wide",
    boardVersion: JAKARTA_WIDE_BOARD_VERSION,
    format: "claim-the-city",
    players: 1,
    origin: "prepared",
    durationMs: 120 * 60 * 1000,
    targets: { landmarks: 4, zones: 2 },
    start: compactStart,
    checkpoints: wideAlternateCheckpointIds.map((id) => wideCheckpoints[id]),
    routes: wideRouteAttribution,
  },
  checkIn: { radiusMeters: 100, maxAccuracyMeters: 50, maxAgeMs: 30_000 },
  cooldownMs: 30_000,
  tasks: pickWideTasks(wideAlternateCheckpointIds),
};

export const preparedWideFixtures: SoloFixture[] = [
  wideTrial,
  wideAlternate,
];

export const wideBranches: Record<string, string> = {
  "csw-asean": "MRT Utara–Selatan",
  "plaza-senayan": "MRT Utara–Selatan",
  "dukuh-atas": "MRT Utara–Selatan",
  "bundaran-hi": "MRT Utara–Selatan",
  "stasiun-tanah-abang": "KRL Lingkar Cikarang",
  "stasiun-manggarai": "KRL Bogor–Kota",
  "taman-ismail-marzuki": "KRL Bogor–Kota",
  "monas-gambir": "Transjakarta Koridor 1",
  "taman-fatahillah": "KRL Bogor–Kota",
  "stasiun-jakarta-kota": "KRL Bogor–Kota",
};
