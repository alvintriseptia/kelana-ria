import type { ClaimChallengePrimitive, StudioAiSuggestRequest, StudioObservationPattern, StudioPoiCategory } from "@kelana-ria/contracts";

type ClaimRequest = Extract<StudioAiSuggestRequest, { format: "claim-the-city" }>;

const features: Record<StudioPoiCategory, string> = {
  taman: "denah jalur atau penanda pada pintu taman",
  monumen: "bentuk relief atau keterangan pada monumen",
  museum: "penanda atau bentuk arsitektur di bagian luar museum",
  pasar: "penanda pintu masuk atau susunan lorong pasar",
  ruang_publik: "penanda arah atau akses di ruang publik",
  ibadah: "penanda akses yang terlihat dari jalur umum",
  perpustakaan: "penanda masuk atau papan layanan permanen",
  kuliner_ikon: "penanda tetap atau bentuk bangunan yang terlihat dari jalan",
};

const observations: Record<StudioObservationPattern, { title: string; task: string; review: string }> = {
  see_and_explain: { title: "Fungsi penanda", task: "amati petunjuk visual yang memperjelas fungsinya", review: "Catat ciri yang membuktikan fungsi penanda tersebut." },
  compare_features: { title: "Bandingkan ciri", task: "bandingkan bentuk atau susunan dua bagian yang terlihat", review: "Catat dua bagian yang benar-benar terlihat dari satu tempat." },
  read_connection: { title: "Ikuti arah", task: "baca arah yang ditunjukkan menuju akses atau jalur berikutnya", review: "Cek bahwa arah dan akses yang ditunjukkan masih berlaku." },
  record_detail: { title: "Catat detail", task: "amati satu detail yang tetap dan sebutkan cirinya", review: "Catat ciri yang stabil dan dapat diperiksa ulang." },
};

function uniqueLabels(existing: string[] | undefined) {
  const normalize = (label: string) => label.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
  const used = new Set(existing?.map(normalize));
  return (base: string) => {
    const stem = base.slice(0, 113).trimEnd();
    let candidate = stem;
    for (let suffix = 2; used.has(normalize(candidate)); suffix++) {
      candidate = `${stem} (${suffix})`;
    }
    used.add(normalize(candidate));
    return candidate;
  };
}

function claimTemplate(request: ClaimRequest, index: number) {
  const { landmark, pattern, primitive } = request;
  const observation = observations[pattern];
  const feature = features[landmark.osmCategory ?? "ruang_publik"];
  const viewpoints = [
    "dari titik masuk yang boleh dilalui pejalan kaki",
    "dari sisi jalur umum",
    "dari papan petunjuk tetap yang bisa dibaca pengunjung",
  ];
  const prompt = `Di ${landmark.name}, pilih ${feature} yang terlihat ${viewpoints[index]} dan ${observation.task}.`;
  const verifyAnswer = ["Isi jawaban setelah cek lapangan"];
  const input = {
    primitive: "observation_input", inputMode: "text", prompt, acceptedAnswers: verifyAnswer,
  } as const;
  const photo = {
    primitive: "photo_proof", prompt: `${prompt} Foto bagian yang diamati tanpa merekam wajah.`,
    verificationMode: "rival_or_timeout", autoApproveMs: 120_000,
  } as const;
  const locationTip = `Cari ${feature} dari area yang bisa diakses publik.`;
  let payload: ClaimChallengePrimitive;
  switch (primitive) {
    case "observation_mcq":
      payload = {
        primitive, prompt: `${prompt} Apa yang paling terlihat pada penanda itu?`,
        choices: [
          { id: "a", label: "Simbol atau gambar" },
          { id: "b", label: "Tulisan atau angka" },
          { id: "c", label: "Bentuk atau tekstur" },
        ],
        correctChoiceId: "a",
      };
      break;
    case "observation_input":
      payload = input;
      break;
    case "photo_proof":
      payload = photo;
      break;
    case "timed_micro_task":
      payload = {
        primitive, prompt, timeLimitMs: 180_000, taskType: "observation_input", acceptedAnswers: verifyAnswer,
      };
      break;
    case "call_your_shot":
      payload = {
        primitive, theme: observation.title, standardTask: input, boldTask: photo, boldReward: { bonusWeight: 1 },
      };
      break;
    case "multi_step":
      payload = { primitive, steps: [input, photo] };
      break;
  }
  return {
    payload,
    hint: locationTip,
    learningExplanation: "Penanda tetap menunjukkan fungsi tempat atau membantu orang menemukan jalur yang tepat.",
    estimatedSeconds: primitive === "multi_step" || primitive === "timed_micro_task" ? 180 : 90,
    verificationNotes: "Sesuaikan tugas dengan ciri yang terlihat di lapangan. Ganti kunci jawaban contoh jika tugas memakai jawaban.",
    verificationChecklist: [
      `Pastikan ${feature} ada di ${landmark.name} dan bisa diamati dari area publik.`,
      observation.review,
      "Catat jawaban yang benar atau contoh foto, lalu uji waktu dari titik masuk.",
    ],
  };
}

export function studioAiTemplates(request: StudioAiSuggestRequest): unknown[] {
  const count = request.count ?? 3;
  if (request.format === "claim-the-city") {
    const label = uniqueLabels(request.existingTitles);
    return Array.from({ length: count }, (_, index) => ({
      ...claimTemplate(request, index), title: label(`${observations[request.pattern].title} di ${request.landmark.name}`),
    }));
  }

  const label = uniqueLabels(request.existingLabels);
  const categories = request.availablePoiCategories ?? [];
  const pois = request.poiSamples ?? [];
  return Array.from({ length: count }, (_, index) => {
    const category = categories[index % categories.length];
    const poi = pois[index % pois.length];
    switch (request.targetFamily) {
      case "photo": {
        const details = ["penanda arah tetap", "pola pada permukaan bangunan", "bentuk pembatas jalur"];
        const detail = details[index];
        return {
          label: label(`Foto ${detail}`),
          prompt: `Dari area publik di sekitarmu, foto ${detail}. Hindari wajah orang, nomor rumah, dan nama stasiun.`,
          phase: "seeking",
          verificationNotes: "Pilih ciri tetap yang bisa terlihat jelas tanpa bergerak ke tempat berbahaya.",
          verificationChecklist: [
            `Pastikan ${detail} mudah ditemukan dari area publik dekat setiap pilihan tempat bersembunyi.`,
            "Ambil foto latihan dan cek bahwa wajah, alamat, dan nama stasiun tidak terlihat.",
          ],
        };
      }
      case "matching":
        return { label: label(`Apakah ${category} terdekat kita sama?`), matchType: "nearest_poi", poiCategory: category };
      case "measuring":
        return poi
          ? { label: label(`Siapa lebih dekat ke ${poi.name}?`), targetType: "named_poi", poiId: poi.id }
          : { label: label(`Siapa lebih dekat ke ${category}?`), targetType: "poi_category", poiCategory: category };
      case "tentacles": {
        const radiusMeters = [400, 600, 800][index];
        return { label: label(`${category} terdekat dalam ${radiusMeters} meter`), poiCategory: category, radiusMeters };
      }
    }
  });
}
