import type { ClaimCardEffect, CurseClearCondition, HideSeekCardEffect } from "@kelana-ria/contracts";
import { cardCategoryLabels, familyLabels } from "./seek/types";

export type CardRules = {
  timing: string;
  effect: string;
  target?: string;
  cost?: string;
  ends?: string;
};

const claimTiming = "Saat pertandingan berlangsung.";
const seekTiming = "Saat pencarian berlangsung dan pilihan hadiah sudah diselesaikan.";
const spendCard = "Kartu ini dibuang setelah dipakai.";

function duration(ms: number): string {
  const seconds = Math.ceil(ms / 1_000);
  const minutes = Math.floor(seconds / 60);
  const remaining = seconds % 60;
  if (!minutes) return `${seconds} detik`;
  return remaining ? `${minutes} menit ${remaining} detik` : `${minutes} menit`;
}

function curseClearText(clear: CurseClearCondition): string {
  switch (clear.type) {
    case "timer":
      return `Otomatis setelah ${duration(clear.durationMs)}.`;
    case "next_n_questions":
      return `Setelah ${clear.count} pertanyaan berikutnya dijawab.`;
    case "gps_detour":
      return `Check-in dalam radius ${clear.radiusMeters} meter dari lokasi berkategori ${clear.poiCategory}.`
        + (clear.fallbackTimerMs ? ` Kutukan juga berakhir setelah ${duration(clear.fallbackTimerMs)}.` : "");
    case "photo_challenge":
      return `Kirim foto sesuai tugas “${clear.prompt}”. Foto perlu disetujui lawan atau akan disetujui otomatis setelah ${duration(clear.autoApproveMs)}.`;
    case "honor_task":
      return `Selesaikan dan konfirmasi tugas “${clear.instruction}”.`
        + (clear.minDurationMs ? ` Konfirmasi tersedia setelah ${duration(clear.minDurationMs)}.` : "");
  }
}

export function claimCardRules(card: ClaimCardEffect): CardRules {
  switch (card.primitive) {
    case "scout_challenge":
      return {
        timing: claimTiming,
        target: "Landmark yang belum terkunci dan punya tantangan.",
        effect: "Lihat pratinjau tantangan di landmark itu.",
        cost: spendCard,
      };
    case "shield_claim":
      return {
        timing: "Saat pertandingan grup berlangsung.",
        target: "Landmark rentan yang dikuasai timmu.",
        effect: "Lawan tidak bisa mulai merebut landmark yang dilindungi.",
        ends: `Perlindungan berlangsung ${duration(card.durationMs)}.`,
        cost: spendCard,
      };
    case "double_weight":
      return {
        timing: claimTiming,
        target: "Landmark terkunci milik timmu yang bobotnya belum digandakan.",
        effect: "Gandakan bobot dasar landmark untuk perhitungan skor zona.",
        cost: spendCard,
      };
    case "swap_challenge":
      return {
        timing: "Saat kamu punya tantangan aktif dan masih ada tantangan cadangan.",
        target: "Tantangan aktifmu.",
        effect: "Ganti tantangan aktif dengan tantangan cadangan.",
        cost: spendCard,
      };
    case "instant_lock":
      return {
        timing: claimTiming,
        target: "Landmark rentan yang dikuasai timmu.",
        effect: "Kunci landmark langsung tanpa menyelesaikan tantangannya.",
        cost: spendCard,
      };
    case "sabotage_curse": {
      const action = { block_claims: "mengklaim landmark", block_steals: "merebut landmark", block_both: "mengklaim atau merebut landmark" }[card.blockerType];
      return {
        timing: "Saat pertandingan grup berlangsung.",
        target: "Pemain lawan yang masih bermain dan belum memiliki kutukan aktif.",
        effect: `Lawan yang ditargetkan tidak bisa ${action} sampai kutukan lepas.`,
        ends: curseClearText(card.clearCondition),
        cost: spendCard,
      };
    }
  }
}

export function seekCardRules(card: HideSeekCardEffect): CardRules {
  switch (card.primitive) {
    case "time_bonus": {
      const bonus = card.minutes !== undefined
        ? `${card.minutes} menit` : `${card.percentOfRawTime}% dari waktu sembunyi sebelum bonus`;
      return {
        timing: "Simpan di tangan hingga giliran sembunyi berakhir.",
        effect: `Tambahkan ${bonus} ke skor waktu sembunyi.`,
      };
    }
    case "veto":
      return {
        timing: "Saat pertanyaan menunggu jawaban dan pilihan hadiah sudah diselesaikan.",
        target: "Pertanyaan aktif pencari.",
        effect: "Batalkan pertanyaan itu sehingga tidak perlu dijawab.",
        cost: spendCard,
      };
    case "randomize":
      return {
        timing: "Saat pertanyaan menunggu jawaban, pilihan hadiah sudah diselesaikan, dan ada pertanyaan pengganti.",
        target: "Pertanyaan aktif pencari.",
        effect: "Ganti secara acak dengan pertanyaan yang belum dipakai dari kategori yang sama.",
        cost: spendCard,
      };
    case "duplicate": {
      const categories = card.targetCategories?.map(category => cardCategoryLabels[category]).join(", ");
      const allowedMove = card.allowDuplicateMove ? " Kartu Pindah Zona juga dapat disalin jika sesuai kategori." : " Kartu Pindah Zona dikecualikan.";
      return {
        timing: "Saat pencarian berlangsung tanpa pertanyaan atau pilihan hadiah yang tertunda.",
        target: `Satu kartu lain di tanganmu.${categories ? ` Kategori yang diizinkan meliputi ${categories}.` : ""}${allowedMove}`,
        effect: "Tambahkan salinan kartu pilihan ke tanganmu.",
        cost: spendCard,
      };
    }
    case "expand_hand":
      return {
        timing: seekTiming,
        effect: `Tambah batas kartu di tangan sebanyak ${card.extraSlots} hingga giliran berakhir.`,
        cost: spendCard,
      };
    case "discard_draw":
      return {
        timing: "Saat pencarian berlangsung tanpa pertanyaan atau pilihan hadiah yang tertunda.",
        target: "Kartu lain di tanganmu.",
        effect: `Tarik hingga ${card.drawCount} kartu dan simpan hingga ${card.keepCount} sesuai sisa dek dan batas tangan.`,
        cost: `Buang kartu ini dan ${card.discardCount} kartu lain dari tanganmu.`,
      };
    case "time_trap":
      return {
        timing: seekTiming,
        target: "Stasiun di papan selain stasiun sembunyimu, yang belum punya jebakan aktif.",
        effect: `Tambahkan ${card.bonusMinutes} menit ke skor waktu sembunyi saat pencari check-in di stasiun itu.`,
        ends: "Jebakan berlaku sekali selama giliran ini.",
        cost: spendCard,
      };
    case "move_zone":
      return {
        timing: "Saat pencarian berlangsung, pilihan hadiah sudah selesai, dan kamu belum sedang pindah.",
        effect: card.revealOldStation ? "Pindah ke stasiun sembunyi baru. Stasiun lama diperlihatkan ke pencari." : "Pindah ke stasiun sembunyi baru.",
        ends: `Kunci stasiun sembunyi baru dalam ${duration(card.travelWindowMs)}.`,
        cost: card.discardHand ? "Buang semua kartu di tanganmu, termasuk kartu ini." : spendCard,
      };
    case "curse": {
      const { blockerType, castingCosts, clearCondition, effectModifiers } = card.curse;
      const blocking = {
        none: "",
        block_questions: "Pencari tidak bisa mengirim pertanyaan baru.",
        block_transit: "Pencari tidak bisa memakai transportasi.",
        block_both: "Pencari tidak bisa mengirim pertanyaan baru atau memakai transportasi.",
        block_steals: "",
        block_claims: "",
      }[blockerType];
      const modifiers = (effectModifiers ?? []).flatMap(modifier => {
        switch (modifier.type) {
          case "inflate_question_draws":
            return [`Setiap jawaban yang menghasilkan kartu memberi penyembunyi ${modifier.extraDraws} tarikan ekstra.`];
          case "ban_question_family":
            return [`Pencari tidak bisa memakai kategori ${familyLabels[modifier.family]}.`];
          case "skip_penalty_minutes":
            return [`Pencari bisa melepas kutukan dengan menambahkan ${modifier.penaltyMinutes} menit ke skor waktu sembunyi.`];
        }
      });
      const costs = castingCosts.flatMap(cost => {
        switch (cost.type) {
          case "none":
            return [];
          case "discard_cards": {
            const category = cost.category && cost.category !== "any" ? ` kategori ${cardCategoryLabels[cost.category]}` : "";
            return [`Buang ${cost.count} kartu lain${category} dari tanganmu.`];
          }
          case "seeker_min_distance":
            return [`Pencari harus berjarak minimal ${cost.meters} meter dari stasiun sembunyimu.`];
          case "seeker_max_distance":
            return [`Pencari harus berjarak maksimal ${cost.meters} meter dari stasiun sembunyimu.`];
          case "reveal_clue":
            return [`Ungkapkan petunjuk “${cost.detail}” kepada pencari.`];
        }
      });
      return {
        timing: seekTiming,
        target: "Pencari pada giliran ini.",
        effect: [blocking, ...modifiers].filter(Boolean).join(" ") || "Berikan tugas kutukan kepada pencari.",
        ends: curseClearText(clearCondition),
        cost: [spendCard, ...costs].join(" "),
      };
    }
  }
}
