import type { PackDraftPayload, PackTaskInput } from "@kelana-ria/contracts";

export const defaultCreatorTasks: PackTaskInput[] = [
  {
    checkpointId: "taman-literasi",
    question:
      "Amati balkon amfiteater Taman Literasi dari sisi utara. Bagaimana bentuk susunan undakan tempat duduknya?",
    choices: [
      { id: "c1", label: "Melengkung setengah lingkaran menghadap panggung" },
      { id: "c2", label: "Memanjang lurus sejajar jalan raya" },
      { id: "c3", label: "Menara bertingkat tiga dengan atap kubah" },
    ],
    correctChoiceId: "c1",
    verificationNotes:
      "Balkon utara dapat diakses publik tanpa tiket pukul 07.00–22.00 WIB dari pintu barat MRT Blok M.",
  },
  {
    checkpointId: "blok-m-plaza",
    question:
      "Di pelataran masuk utama Blok M Plaza dari arah koridor MRT, bentuk geometri apa yang tampak pada penanda fasad pintu masuk?",
    choices: [
      { id: "c1", label: "Bidang persegi empat simetris" },
      { id: "c2", label: "Segitiga lancip kembar" },
      { id: "c3", label: "Kubah bundar berjeruji" },
    ],
    correctChoiceId: "c1",
    verificationNotes:
      "Terlihat jelas dari trotoar publik Jalan Bulungan tanpa harus masuk ke area komersial dalam gedung.",
  },
  {
    checkpointId: "m-bloc",
    question:
      "Dari pelataran depan M Bloc Space di Jalan Panglima Polim, berapa gambar layang-layang pada mural fasad depan?",
    choices: [
      { id: "c1", label: "Satu layang-layang" },
      { id: "c2", label: "Dua layang-layang" },
      { id: "c3", label: "Empat layang-layang" },
    ],
    correctChoiceId: "c2",
    verificationNotes:
      "Mural menghadap trotoar pejalan kaki antara Stasiun MRT ASEAN dan Blok M.",
  },
  {
    checkpointId: "taman-ayodya",
    question:
      "Perhatikan papan penunjuk jalur di tepi kolam Taman Ayodya. Siluet satwa apa yang terpasang di atas papan arah?",
    choices: [
      { id: "c1", label: "Burung bersayap" },
      { id: "c2", label: "Kucing duduk" },
      { id: "c3", label: "Kura-kura air" },
    ],
    correctChoiceId: "c1",
    verificationNotes:
      "Taman kota terbuka setiap hari; papan berada di jalur pedestrian sisi timur kolam.",
  },
  {
    checkpointId: "stadion-madya",
    question:
      "Di gerbang barat Stadion Madya Senayan, relief atlet pada papan gerbang menggambarkan cabang olahraga apa?",
    choices: [
      { id: "c1", label: "Lari lintasan" },
      { id: "c2", label: "Renang indah" },
      { id: "c3", label: "Balap sepeda" },
    ],
    correctChoiceId: "c1",
    verificationNotes:
      "Dapat diamati dari jalur pedestrian luar gerbang barat tanpa memasuki tribun stadion.",
  },
  {
    checkpointId: "plaza-senayan",
    question:
      "Hadap jam besar di pelataran utama Plaza Senayan pada panel uji. Pukul berapa posisi jarum yang ditampilkan pada penanda?",
    choices: [
      { id: "c1", label: "03.00" },
      { id: "c2", label: "06.00" },
      { id: "c3", label: "09.00" },
    ],
    correctChoiceId: "c1",
    verificationNotes:
      "Terlihat dari pelataran pejalan kaki terbuka dari arah Halte dan Stasiun MRT Senayan.",
  },
];

export const defaultCreatorDraft: PackDraftPayload = {
  packId: "pack-selatan-compact",
  byline: "Raka Pratama · Kolektif Jelajah Selatan",
  title: "Jejak Transit Kebayoran & Senayan",
  format: "claim-the-city",
  board: "compact",
  supportedPlayers: [1, 2],
  priceIdr: 25_000,
  tasks: defaultCreatorTasks,
};
