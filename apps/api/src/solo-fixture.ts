import type { SoloChallenge, SoloEdition } from "@kelana-ria/contracts";

export type SoloFixture = {
  edition: SoloEdition;
  checkIn: { radiusMeters: number; maxAccuracyMeters: number; maxAgeMs: number };
  cooldownMs: number;
  tasks: Record<string, { challenge: SoloChallenge; correctChoiceId: string }>;
};

// Pins, observations, and timing are prepared QA data for simulated play.
export const compactTrial: SoloFixture = {
  edition: {
    id: "compact-solo-trial-v1",
    durationMs: 60 * 60 * 1000,
    targets: { landmarks: 4, zones: 2 },
    start: { id: "csw-asean", name: "CSW–ASEAN", latitude: -6.23831, longitude: 106.79889, x: 43, y: 54 },
    checkpoints: [
      { id: "taman-literasi", name: "Taman Literasi", latitude: -6.24363, longitude: 106.80074, x: 74, y: 77, zone: "Blok M", transit: "MRT Blok M" },
      { id: "blok-m-plaza", name: "Blok M Plaza", latitude: -6.2446, longitude: 106.79748, x: 47, y: 83, zone: "Blok M", transit: "MRT Blok M" },
      { id: "m-bloc", name: "M Bloc Space", latitude: -6.24094, longitude: 106.79912, x: 63, y: 63, zone: "Blok M", transit: "MRT ASEAN" },
      { id: "taman-ayodya", name: "Taman Ayodya", latitude: -6.24459, longitude: 106.79173, x: 24, y: 76, zone: "Blok M", transit: "MRT Blok M" },
      { id: "stadion-madya", name: "Stadion Madya", latitude: -6.21852, longitude: 106.80121, x: 64, y: 20, zone: "Senayan", transit: "Transjakarta Gelora Bung Karno" },
      { id: "plaza-senayan", name: "Plaza Senayan", latitude: -6.22559, longitude: 106.7995, x: 46, y: 37, zone: "Senayan", transit: "MRT Senayan" },
    ],
  },
  checkIn: { radiusMeters: 100, maxAccuracyMeters: 50, maxAgeMs: 30_000 },
  cooldownMs: 30_000,
  tasks: {
    "taman-literasi": {
      challenge: {
        checkpointId: "taman-literasi",
        prompt: "Panel simulasi: deretan kursi mengitari panggung seperti bulan sabit. Bagaimana susunan kursinya?",
        choices: [
          { id: "tl-8d", label: "Barisan lurus" },
          { id: "tl-3f", label: "Setengah lingkaran" },
          { id: "tl-5b", label: "Lingkaran penuh" },
        ],
      },
      correctChoiceId: "tl-3f",
    },
    "blok-m-plaza": {
      challenge: {
        checkpointId: "blok-m-plaza",
        prompt: "Panel simulasi: papan di dekat pintu masuk menunjukkan empat sisi sama panjang dan empat sudut siku-siku. Bentuk apa yang terlihat?",
        choices: [
          { id: "bp-2f", label: "Persegi" },
          { id: "bp-4a", label: "Segitiga" },
          { id: "bp-7e", label: "Lingkaran" },
        ],
      },
      correctChoiceId: "bp-2f",
    },
    "m-bloc": {
      challenge: {
        checkpointId: "m-bloc",
        prompt: "Panel simulasi: dari ambang pintu terlihat mural dengan matahari, awan, dan dua layang-layang. Berapa layang-layang yang terlihat?",
        choices: [
          { id: "mb-9a", label: "Satu" },
          { id: "mb-7c", label: "Tiga" },
          { id: "mb-2e", label: "Dua" },
        ],
      },
      correctChoiceId: "mb-2e",
    },
    "taman-ayodya": {
      challenge: {
        checkpointId: "taman-ayodya",
        prompt: "Panel simulasi: di tepi kolam, papan penunjuk jalan bergambar hewan bersayap dan berparuh. Hewan apa yang tergambar?",
        choices: [
          { id: "ta-5c", label: "Kucing" },
          { id: "ta-8e", label: "Burung" },
          { id: "ta-3a", label: "Ikan" },
        ],
      },
      correctChoiceId: "ta-8e",
    },
    "stadion-madya": {
      challenge: {
        checkpointId: "stadion-madya",
        prompt: "Panel simulasi: papan di gerbang menampilkan atlet dengan satu kaki terangkat, lengan terayun, dan garis finis di depannya. Olahraga apa yang ditampilkan?",
        choices: [
          { id: "sm-1c", label: "Renang" },
          { id: "sm-4f", label: "Panahan" },
          { id: "sm-6e", label: "Lari" },
        ],
      },
      correctChoiceId: "sm-6e",
    },
    "plaza-senayan": {
      challenge: {
        checkpointId: "plaza-senayan",
        prompt: "Panel simulasi: jam di atas pintu menunjukkan jarum pendek di angka tiga dan jarum panjang di angka dua belas. Pukul berapa yang ditunjukkan?",
        choices: [
          { id: "ps-7b", label: "03.00" },
          { id: "ps-5e", label: "06.00" },
          { id: "ps-2a", label: "12.00" },
        ],
      },
      correctChoiceId: "ps-7b",
    },
  },
};
