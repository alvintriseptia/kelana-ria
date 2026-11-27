import type {
  AdminAccountSummary,
  ClaimCardEffect,
  ClaimChallengeItem,
  ClaimChallengePrimitive,
  ClaimRulebookPack,
  CurseClearCondition,
  GeoCoordinate,
  GeoSnapshot,
  HideSeekCardEffect,
  HideSeekQuestionFamily,
  HideSeekRulebookPack,
  RulebookFormat,
  RulebookReviewAuditEntry,
  RulebookValidationIssue,
} from "@kelana-ria/contracts";
import { escapeText } from "./escape-text";
import { formatHeroCardSvg, questionFamilyTileMeta, renderGameCardPreviewHtml } from "./studio-assets";
import { resolveValidationJump } from "./studio-dry-run";
import { isClaimStudioPack, type StudioValidationState, type StudioVersionRecord } from "./studio-types";
import "./studio-admin-review.css";

export type AdminReviewRecord = StudioVersionRecord & {
  updatedAt: number;
  validation: StudioValidationState;
  auditLog: RulebookReviewAuditEntry[];
};

type ReviewStatus = "submitted" | "published" | "paused";

export type AdminReviewState = {
  status: ReviewStatus | "all";
  format: RulebookFormat | "all";
  expanded: Set<string>;
  manageOpen: boolean;
  admins?: AdminAccountSummary[];
  busy: boolean;
  adminError: string;
};

export type AdminReviewPending = {
  action: RulebookReviewAuditEntry["action"] | "revoke";
  name: string;
};

const statuses = {
  submitted: "Menunggu Tinjauan",
  published: "Terbit",
  paused: "Dijeda",
  all: "Semua",
};

const formats = {
  all: "Semua",
  "claim-the-city": "Claim the City",
  "hide-and-seek": "Hide & Seek",
};

const auditActions: Record<RulebookReviewAuditEntry["action"], string> = {
  publish: "Terbit",
  "request-changes": "Minta Revisi",
  pause: "Dijeda",
  resume: "Aktifkan Kembali",
};

const challengeKinds: Record<ClaimChallengePrimitive["primitive"], string> = {
  observation_mcq: "Pilihan Ganda",
  observation_input: "Isian Teks atau Angka",
  photo_proof: "Bukti Foto",
  timed_micro_task: "Tugas Cepat",
  call_your_shot: "Standar dan Ekstra",
  multi_step: "Dua Langkah",
};

const yesNo = (value: boolean) => value ? "Ya" : "Tidak";
const meters = (value: number) => `${value} m`;

function duration(ms: number) {
  if (ms >= 60_000 && ms % 60_000 === 0) return `${ms / 60_000} menit`;
  return `${ms / 1000} detik`;
}

const jakartaDate = new Intl.DateTimeFormat("id-ID", {
  day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Jakarta",
});
const jakartaDateTime = new Intl.DateTimeFormat("id-ID", {
  day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
  timeZone: "Asia/Jakarta",
});

function timeTag(timestamp: number, withTime = false) {
  const date = new Date(timestamp);
  if (Number.isNaN(date.valueOf())) return "—";
  const label = withTime ? `${jakartaDateTime.format(date)} WIB` : jakartaDate.format(date);
  return `<time datetime="${date.toISOString()}">${escapeText(label)}</time>`;
}

type Fact = [label: string, value: string | number | undefined];

function facts(rows: Fact[]) {
  return `<dl class="admin-review-facts">${rows
    .filter(([, value]) => value !== undefined && value !== "")
    .map(([label, value]) => `<div><dt>${escapeText(label)}</dt><dd>${escapeText(String(value))}</dd></div>`)
    .join("")}</dl>`;
}

function coordinates(point: GeoCoordinate) {
  return `${point.latitude}, ${point.longitude}`;
}

function renderLocation(point: GeoCoordinate & { name: string; publicHours?: string; accessNotes?: string }, rows: Fact[] = []) {
  return `<li><strong>${escapeText(point.name)}</strong>${facts([
    ...rows,
    ["Jam Buka Umum", point.publicHours],
    ["Catatan Akses", point.accessNotes],
    ["Koordinat", coordinates(point)],
  ])}</li>`;
}

function renderClaimLocations(pack: ClaimRulebookPack, snapshot: GeoSnapshot) {
  const { zones, landmarks } = pack.geography;
  return `<h5>Titik Awal</h5><ul class="admin-review-list">${renderLocation(snapshot.startPoint)}</ul>
    ${zones.map(zone => `<section>
      <h5>Zona ${escapeText(zone.name)} <span class="rb-badge">${escapeText(zone.label)}</span></h5>
      <ul class="admin-review-list">${landmarks.filter(landmark => landmark.zoneId === zone.id).map(landmark => renderLocation(landmark, [
        ["Transit", landmark.transitSummary],
        ["Waktu Tempuh", landmark.estimatedTravelFromStartMs === undefined ? undefined : duration(landmark.estimatedTravelFromStartMs)],
        ["Waktu Tantangan", landmark.estimatedChallengeMs === undefined ? undefined : duration(landmark.estimatedChallengeMs)],
      ])).join("") || "<li>Belum ada landmark.</li>"}</ul>
    </section>`).join("")}`;
}

function renderSeekLocations(snapshot: GeoSnapshot) {
  return `<h5>Titik Awal</h5><ul class="admin-review-list">${renderLocation(snapshot.startPoint)}</ul>
    <h5>Stasiun</h5><ul class="admin-review-list">${snapshot.stations.map(station => renderLocation(station, [
      ["Jalur Transit", station.transitLines.join(", ")],
      ["Bisa Jadi Titik Sembunyi", yesNo(station.eligibleHidingAnchor)],
      ["Waktu Tempuh", station.estimatedTravelFromStartMs === undefined ? undefined : duration(station.estimatedTravelFromStartMs)],
      ...Object.entries(station.attributes ?? {}),
    ])).join("") || "<li>Belum ada stasiun.</li>"}</ul>
    <h5>Titik Minat (POI)</h5><ul class="admin-review-list">${snapshot.pois.map(poi => {
      const { publicHours, accessNotes, ...attributes } = poi.attributes ?? {};
      return renderLocation({ ...poi, publicHours, accessNotes }, [["Kategori", poi.category], ...Object.entries(attributes)]);
    }).join("") || "<li>Belum ada titik minat.</li>"}</ul>`;
}

function renderSession(record: AdminReviewRecord) {
  const { pack } = record;
  const { geography, session } = pack;
  const transit = { walk: "Jalan kaki", mrt: "MRT", krl: "KRL", transjakarta: "Transjakarta", lrt: "LRT", other: "Lainnya" };
  const common: Fact[] = [
    ["Pemain", `${session.minPlayers}–${session.maxPlayers} pemain`],
    ["Wajib Lapor di Titik Awal", yesNo(session.requireStartCheckIn)],
    ["Radius Lapor Lokasi", meters(geography.checkInRadiusMeters)],
    ["Akurasi GPS Maksimal", meters(geography.maxGpsAccuracyMeters)],
    ["Usia Data GPS Maksimal", duration(geography.maxGpsFixAgeMs)],
    ["Moda yang Diizinkan", geography.allowedTransitModes.map(mode => transit[mode]).join(", ")],
  ];

  let rules: Fact[];
  if (isClaimStudioPack(pack)) {
    const fail = { cooldown_ms: "Tunggu sebelum mencoba lagi", burned_for_player: "Landmark terkunci bagi pemain" };
    const tracking = { off: "Nonaktif", last_checkin: "Lokasi lapor terakhir", periodic_gps: "GPS berkala" };
    rules = [
      ["Mode", pack.session.teamMode === "teams" ? "Tim" : "Bebas"],
      ["Durasi Sesi", duration(pack.session.durationMs)],
      ["Target Solo", pack.session.soloTargets && `${pack.session.soloTargets.lockedLandmarks} landmark di ${pack.session.soloTargets.distinctZones} zona`],
      ["Pelacakan Lawan", pack.session.opponentTracking && tracking[pack.session.opponentTracking.mode]],
      ["Jeda Pelacakan", pack.session.opponentTracking?.intervalMs === undefined ? undefined : duration(pack.session.opponentTracking.intervalMs)],
      ["Bobot Klaim", pack.claiming.claimWeight],
      ["Bobot Kunci", pack.claiming.lockWeight],
      ["Langsung Terkunci Saat Direbut", yesNo(pack.claiming.stealLocksImmediately)],
      ["Jika Tantangan Gagal (Grup)", fail[pack.claiming.multiplayerFailPolicy]],
      ["Jika Tantangan Gagal (Solo)", fail[pack.claiming.soloFailPolicy]],
      ["Jeda Setelah Gagal", duration(pack.claiming.failCooldownMs)],
      ["Umumkan Percobaan Gagal", yesNo(pack.claiming.broadcastFailAlert)],
    ];
  } else {
    const regroup = {
      previous_hiding_station: "Stasiun sembunyi sebelumnya",
      last_play_checkpoint: "Pos terakhir",
      shared_start: "Titik awal",
      anywhere_ready: "Di lokasi masing-masing",
    };
    const missedLock = {
      void_turn: "Giliran dibatalkan",
      auto_lock_nearest_station: "Kunci di stasiun terdekat",
      forfeit_turn: "Giliran gugur",
    };
    rules = [
      ["Giliran", pack.session.turnMode === "everyone_hides_once" ? "Semua sembunyi sekali" : pack.session.fixedTurnCount],
      ["Kumpul Kembali", regroup[pack.session.regroupPolicy]],
      ["Jika Gagal Mengunci Lokasi", missedLock[pack.session.missedLockPolicy]],
      ["Radius Sembunyi", meters(pack.geography.hidingZoneRadiusMeters)],
      ["Batas Jarak dari Jalur", meters(pack.session.maxPathOffsetMeters)],
      ["Waktu Sembunyi", duration(pack.timers.headStartMs)],
      ["Batas Waktu Mencari", duration(pack.timers.searchLimitMs)],
      ["Batas Waktu Kumpul Kembali", duration(pack.timers.regroupLimitMs)],
      ["Waktu Menjawab Pertanyaan", duration(pack.timers.objectiveResponseMs)],
      ["Waktu Menjawab Foto", duration(pack.timers.photoResponseMs)],
      ["Waktu Memilih Kartu", duration(pack.timers.drawDecisionMs)],
      ["Jeda Akhir Permainan", `${pack.session.endgameFreezeGraceSec} detik`],
    ];
  }

  return `<p>${escapeText(pack.meta.summary)}</p>${facts([...common, ...rules])}`;
}

function renderChallengePayload(payload: ClaimChallengePrimitive): string {
  if (payload.primitive === "call_your_shot") {
    return `${facts([
      ["Tema", payload.theme],
      ["Bonus Poin Ekstra", payload.boldReward.bonusWeight],
      ["Ambil Kartu", payload.boldReward.drawTacticalCard === undefined ? undefined : yesNo(payload.boldReward.drawTacticalCard)],
    ])}<div class="admin-review-challenge-steps">
      <div><strong>Standar</strong>${renderChallengePayload(payload.standardTask)}</div>
      <div><strong>Ekstra</strong>${renderChallengePayload(payload.boldTask)}</div>
    </div>`;
  }
  if (payload.primitive === "multi_step") {
    return `<ol class="admin-review-challenge-steps">${payload.steps.map(step => `<li>${renderChallengePayload(step)}</li>`).join("")}</ol>`;
  }

  const rows: Fact[] = [["Instruksi", payload.prompt]];
  switch (payload.primitive) {
    case "observation_mcq": {
      const answer = payload.choices.find(choice => choice.id === payload.correctChoiceId);
      rows.push(["Pilihan", payload.choices.map(choice => choice.label).join(" · ")], ["Kunci Jawaban", answer?.label ?? payload.correctChoiceId]);
      break;
    }
    case "observation_input":
    case "timed_micro_task":
      if (payload.numericRange) rows.push(["Kunci Jawaban", `${payload.numericRange.min}–${payload.numericRange.max}`]);
      if (payload.acceptedAnswers?.length) rows.push(["Kunci Jawaban", payload.acceptedAnswers.join(" · ")]);
      if (payload.primitive === "observation_input") {
        rows.push(["Isian", payload.inputMode === "number" ? "Angka" : "Teks"]);
      } else {
        const tasks = { sub_point_gps: "Datangi Titik GPS", observation_input: "Isian", photo_proof: "Bukti Foto" };
        rows.push(["Jenis Tugas", tasks[payload.taskType]], ["Batas Waktu", duration(payload.timeLimitMs)]);
        if (payload.subPoint) rows.push(
          ["Titik Tujuan", payload.subPoint.label], ["Koordinat Tujuan", coordinates(payload.subPoint)], ["Radius Tujuan", meters(payload.subPoint.radiusMeters)],
        );
        if (payload.autoApproveMs !== undefined) rows.push(["Setujui Foto Otomatis", duration(payload.autoApproveMs)]);
      }
      break;
    case "photo_proof":
      rows.push(["Pemeriksaan Foto", payload.verificationMode === "honor_submit" ? "Diterima saat dikirim" : "Penilaian lawan atau otomatis"], ["Setujui Foto Otomatis", duration(payload.autoApproveMs)]);
      break;
  }
  return facts(rows);
}

function renderClaimChallenges(pack: ClaimRulebookPack) {
  const { challenges } = pack;
  const landmarks = new Map(pack.geography.landmarks.map(landmark => [landmark.id, landmark.name]));
  const groups: [string, ClaimChallengeItem[]][] = [
    ...Object.entries(challenges.landmarkChallenges).map(([id, items]): [string, ClaimChallengeItem[]] => [landmarks.get(id) ?? id, items]),
    ["Tantangan Cadangan", challenges.backupPool],
    ["Tantangan di Tangan", challenges.challengeHandPool ?? []],
  ];
  return `${facts([
    ["Mode Tantangan", challenges.challengeMode === "per_landmark" ? "Per Landmark" : "Kartu di Tangan"],
    ["Batas Tantangan di Tangan", challenges.challengeHandSize],
  ])}${groups.filter(([, items]) => items.length).map(([name, items]) => `<section>
    <h5>${escapeText(name)}</h5>
    <ul class="admin-review-list">${items.map(item => `<li>
      <strong>${escapeText(item.title)}</strong> <span class="rb-badge">${challengeKinds[item.payload.primitive]}</span>
      ${renderChallengePayload(item.payload)}
      ${facts([
        ["Petunjuk", item.hint],
        ["Penjelasan Jawaban", item.learningExplanation],
        ["Catatan Verifikasi Kreator", item.verificationNotes],
        ["Diperiksa Kreator", item.reviewed ? item.reviewedAt || "Ya" : "Tidak"],
        ["Perkiraan Durasi", item.estimatedSeconds === undefined ? undefined : duration(item.estimatedSeconds * 1000)],
      ])}
    </li>`).join("")}</ul>
  </section>`).join("")}`;
}

type SeekFamily = NonNullable<HideSeekRulebookPack["investigationBook"]["families"][HideSeekQuestionFamily]>;
type SeekQuestion = SeekFamily["items"][number];
const phases = { seeking: "Mencari", endgame: "Akhir Permainan", both: "Semua Fase" };

function renderQuestion(item: SeekQuestion, pois: Map<string, string>) {
  const rows: Fact[] = [];
  if ("prompt" in item) rows.push(
    ["Instruksi Foto", item.prompt],
    ["Fase", phases[item.phase]],
    ["Catatan Verifikasi Kreator", item.verificationNotes],
    ["Diperiksa di Lokasi", item.fieldVerified ? item.fieldVerifiedAt || "Ya" : "Tidak"],
  );
  if ("radiusMeters" in item) rows.push(["Radius", meters(item.radiusMeters)]);
  if ("minTravelMeters" in item) rows.push(["Jarak Tempuh Minimal", meters(item.minTravelMeters)]);
  if ("poiCategory" in item) rows.push(["Kategori Titik Minat", item.poiCategory]);
  if ("attributeKey" in item) rows.push(["Atribut Stasiun", item.attributeKey]);
  if ("poiId" in item && item.poiId) rows.push(["Titik Minat", pois.get(item.poiId) ?? item.poiId]);
  if ("matchType" in item) {
    const matches = { transit_line: "Jalur transit", station_name_length: "Panjang nama stasiun", station_attribute: "Atribut stasiun", nearest_poi: "Titik minat terdekat" };
    rows.push(["Cocokkan", matches[item.matchType]]);
  }
  if ("targetType" in item) rows.push(["Bandingkan Jarak ke", item.targetType === "poi_category" ? "Kategori titik minat" : "Titik minat tertentu"]);
  return `<li><strong>${escapeText(item.label)}</strong>${facts(rows)}</li>`;
}

function renderSeekQuestions(pack: HideSeekRulebookPack, snapshot: GeoSnapshot) {
  const { families, repeatCostMode, tieToleranceMeters } = pack.investigationBook;
  const repeat = { escalating_multiplier: "Biaya naik", single_use_locked: "Sekali pakai", flat: "Biaya tetap" };
  const pois = new Map(snapshot.pois.map(poi => [poi.id, poi.name]));
  return `${facts([["Pertanyaan Berulang", repeat[repeatCostMode]], ["Toleransi Jarak Seri", meters(tieToleranceMeters)]])}
    ${(Object.keys(families) as HideSeekQuestionFamily[]).map(key => {
      const family = families[key];
      if (!family) return "";
      return `<section>
        <h5>${escapeText(questionFamilyTileMeta(key).short)} <span class="rb-badge">${family.enabled ? "Aktif" : "Nonaktif"}</span></h5>
        ${facts([
          ["Ambil Kartu", family.drawCount],
          ["Simpan Kartu", family.keepCount],
          ["Fase", family.availableInPhases.map(phase => phases[phase]).join(", ")],
          ["Waktu Menjawab", family.responseMs === undefined ? undefined : duration(family.responseMs)],
          ["Bisa Mengatur Radius", "allowCustomRadius" in family && family.allowCustomRadius !== undefined ? yesNo(family.allowCustomRadius) : undefined],
        ])}
        <ul class="admin-review-list">${family.items.map(item => renderQuestion(item, pois)).join("") || "<li>Belum ada pertanyaan.</li>"}</ul>
      </section>`;
    }).join("")}`;
}

const cardEffectLabels: Record<(ClaimCardEffect | HideSeekCardEffect)["primitive"], string> = {
  scout_challenge: "Intip Tantangan",
  shield_claim: "Perisai Klaim",
  double_weight: "Poin Ganda",
  swap_challenge: "Ganti Tantangan",
  instant_lock: "Kunci Instan",
  sabotage_curse: "Kutukan",
  time_bonus: "Bonus Waktu",
  veto: "Batalkan Pertanyaan",
  randomize: "Acak Pertanyaan",
  duplicate: "Duplikasi Kartu",
  expand_hand: "Tambah Slot Kartu",
  discard_draw: "Buang dan Ambil Kartu",
  time_trap: "Perangkap Waktu",
  move_zone: "Pindah Zona",
  curse: "Kutukan",
};

const curseBlockers = {
  none: "Tidak ada",
  block_questions: "Pertanyaan",
  block_transit: "Transit",
  block_both: "Pertanyaan dan transit",
  block_steals: "Perebutan",
  block_claims: "Klaim",
};

const cardCategories = { time_bonus: "Bonus Waktu", powerup: "Kartu Aksi", curse: "Kutukan", any: "Semua Jenis" };

function curseClearFacts(condition: CurseClearCondition): Fact[] {
  switch (condition.type) {
    case "timer":
      return [["Cara Menghapus", "Tunggu waktu habis"], ["Waktu", duration(condition.durationMs)]];
    case "next_n_questions":
      return [["Cara Menghapus", "Jawab pertanyaan"], ["Jumlah Pertanyaan", condition.count]];
    case "gps_detour":
      return [["Cara Menghapus", "Datangi titik minat"], ["Kategori", condition.poiCategory], ["Radius Tujuan", meters(condition.radiusMeters)], ["Waktu Cadangan", condition.fallbackTimerMs === undefined ? undefined : duration(condition.fallbackTimerMs)]];
    case "photo_challenge":
      return [["Cara Menghapus", "Kirim foto"], ["Instruksi Foto", condition.prompt], ["Setujui Foto Otomatis", duration(condition.autoApproveMs)]];
    case "honor_task":
      return [["Cara Menghapus", "Selesaikan tugas"], ["Instruksi", condition.instruction], ["Durasi Minimal", condition.minDurationMs === undefined ? undefined : duration(condition.minDurationMs)]];
  }
}

function cardEffectFacts(effect: ClaimCardEffect | HideSeekCardEffect): Fact[] {
  switch (effect.primitive) {
    case "shield_claim":
      return [["Lama Perlindungan", duration(effect.durationMs)]];
    case "sabotage_curse":
      return [["Blokir", effect.blockerType === "block_both" ? "Klaim dan perebutan" : curseBlockers[effect.blockerType]], ...curseClearFacts(effect.clearCondition)];
    case "time_bonus":
      return [["Bonus Menit", effect.minutes], ["Persentase Waktu Awal", effect.percentOfRawTime === undefined ? undefined : `${effect.percentOfRawTime}%`]];
    case "duplicate":
      return [["Jenis yang Bisa Disalin", effect.targetCategories?.map(category => cardCategories[category]).join(", ")], ["Bisa Menyalin Pindah Zona", effect.allowDuplicateMove === undefined ? undefined : yesNo(effect.allowDuplicateMove)]];
    case "expand_hand":
      return [["Slot Tambahan", effect.extraSlots]];
    case "discard_draw":
      return [["Kartu Dibuang", effect.discardCount], ["Kartu Diambil", effect.drawCount], ["Kartu Disimpan", effect.keepCount]];
    case "time_trap":
      return [["Bonus Menit", effect.bonusMinutes]];
    case "move_zone":
      return [["Waktu Pindah", duration(effect.travelWindowMs)], ["Ungkap Stasiun Lama", yesNo(effect.revealOldStation)], ["Buang Semua Kartu", yesNo(effect.discardHand)]];
    case "curse": {
      const { castingCosts, blockerType, effectModifiers, clearCondition } = effect.curse;
      const costs = castingCosts.map(cost => {
        switch (cost.type) {
          case "none": return "Tanpa syarat";
          case "discard_cards": return `Buang ${cost.count} kartu (${cardCategories[cost.category ?? "any"]})`;
          case "seeker_min_distance": return `Jarak minimal pencari ${meters(cost.meters)}`;
          case "seeker_max_distance": return `Jarak maksimal pencari ${meters(cost.meters)}`;
          case "reveal_clue": return `Ungkap ${cost.clueType === "photo_prompt" ? "foto" : "atribut"}: ${cost.detail}`;
        }
      });
      const modifiers = effectModifiers?.map(modifier => {
        switch (modifier.type) {
          case "inflate_question_draws": return `Tambah ${modifier.extraDraws} kartu yang diambil`;
          case "ban_question_family": return `Blokir pertanyaan ${questionFamilyTileMeta(modifier.family).short}`;
          case "skip_penalty_minutes": return `Penalti ${modifier.penaltyMinutes} menit jika dilewati`;
        }
      });
      return [["Syarat Pemakaian", costs.join(" · ")], ["Blokir", curseBlockers[blockerType]], ["Efek Tambahan", modifiers?.join(" · ")], ...curseClearFacts(clearCondition)];
    }
    default:
      return [];
  }
}

function renderDeck(pack: AdminReviewRecord["pack"]) {
  const claim = isClaimStudioPack(pack);
  const cards = claim ? pack.tacticalDeck.cards : pack.deck.cards;
  const settings: Fact[] = claim ? [
    ["Kartu Permainan Aktif", yesNo(pack.tacticalDeck.enabled)],
    ["Kartu Maksimal di Tangan", pack.tacticalDeck.maxHandSize],
    ["Kutukan Aktif Maksimal per Target", pack.tacticalDeck.maxActiveCursesPerTarget],
    ["Ambil Saat Mengunci", yesNo(pack.tacticalDeck.drawTriggers.onLock)],
    ["Ambil Saat Merebut", yesNo(pack.tacticalDeck.drawTriggers.onSteal)],
    ["Ambil Saat Menjawab Tantangan Ekstra", yesNo(pack.tacticalDeck.drawTriggers.onBoldChallenge)],
  ] : [
    ["Kartu Maksimal di Tangan", pack.deck.baseHandLimit],
    ["Kutukan Pemblokir Aktif Maksimal", pack.deck.maxActiveBlockingCurses],
  ];
  return `${facts(settings)}${cards.length ? `<ul class="admin-review-deck">${cards.map(card => {
    const effect = cardEffectFacts(card.effect);
    return `<li>${renderGameCardPreviewHtml({
      variant: "category" in card ? card.category : card.effect.primitive === "sabotage_curse" ? "curse" : "tactical",
      categoryLabel: "category" in card ? cardCategories[card.category] : undefined,
      title: card.title,
      subtitle: card.description,
      copies: card.copies,
      chips: [{ label: cardEffectLabels[card.effect.primitive] }],
    })}${effect.length ? facts(effect) : ""}</li>`;
  }).join("")}</ul>` : "<p>Belum ada kartu di dek.</p>"}`;
}

function renderAudit(auditLog: RulebookReviewAuditEntry[]) {
  return `<section aria-label="Riwayat Tinjauan" data-testid="admin-audit-trail">
    <h4>Riwayat Tinjauan</h4>
    ${auditLog.length ? `<ol class="admin-review-timeline">${[...auditLog].sort((a, b) => a.createdAt - b.createdAt).map(entry => `<li>
      <div class="admin-review-audit-head"><strong>${auditActions[entry.action]}</strong>${timeTag(entry.createdAt, true)}</div>
      <p>${escapeText(entry.adminDisplayName)} <small>${escapeText(entry.adminEmail)}</small></p>
      ${entry.note ? `<p class="admin-review-audit-note">${escapeText(entry.note)}</p>` : ""}
    </li>`).join("")}</ol>` : "<p>Belum ada riwayat tinjauan.</p>"}
  </section>`;
}

const validationTerms: Record<string, string> = {
  ...challengeKinds,
  sabotage_curse: cardEffectLabels.sabotage_curse,
  drawCount: "kartu diambil",
  keepCount: "kartu disimpan",
};

function renderValidationIssue(issue: RulebookValidationIssue, record: AdminReviewRecord) {
  const { pack } = record;
  let description: string;
  let language = "id";
  if (issue.code === "single-landmark-zone" && isClaimStudioPack(pack)) {
    const zoneId = /"([^"]+)"/.exec(issue.message)?.[1];
    const zone = pack.geography.zones.find(item => item.id === zoneId);
    description = zone ? `Zona ${zone.name} hanya memiliki satu landmark.` : "Salah satu zona hanya memiliki satu landmark.";
  } else if (issue.code === "low-anchor-station-count") {
    const count = record.snapshot.stations.filter(station => station.eligibleHidingAnchor).length;
    description = `Hanya ${count} stasiun yang bisa menjadi titik sembunyi. Tambahkan pilihan agar petunjuk lebih beragam.`;
  } else {
    language = "en";
    description = issue.message.replace(/\b\w+\b/g, word => Object.hasOwn(validationTerms, word) ? validationTerms[word] : word);
  }
  const target = resolveValidationJump(issue.path, record.format);
  return `<li><strong>${issue.severity === "error" ? "Perlu diperbaiki" : "Peringatan"} · ${escapeText(target.label)}</strong>
    <p lang="${language}">${escapeText(description)}</p>
  </li>`;
}

export function renderAdminInspection(record: AdminReviewRecord): string {
  const { pack, snapshot, validation } = record;
  const issues = [...validation.errors, ...(validation.warnings ?? [])];
  return `<div class="admin-review-inspection">
    <section><h4>Validasi Paket</h4>
      ${issues.length
        ? `<ul class="admin-review-list">${issues.map(issue => renderValidationIssue(issue, record)).join("")}</ul>`
        : "<p>Paket lolos validasi.</p>"}
    </section>
    <section><h4>Aturan Sesi &amp; Waktu</h4>${renderSession(record)}</section>
    <section><h4>Lokasi</h4>${isClaimStudioPack(pack) ? renderClaimLocations(pack, snapshot) : renderSeekLocations(snapshot)}</section>
    ${isClaimStudioPack(pack)
      ? `<section><h4>Tantangan</h4>${renderClaimChallenges(pack)}</section>`
      : `<section><h4>Pertanyaan &amp; Petunjuk</h4>${renderSeekQuestions(pack, snapshot)}</section>`}
    <section><h4>Dek Kartu</h4>${renderDeck(pack)}</section>
    ${renderAudit(record.auditLog)}
  </div>`;
}

function itemCounts({ pack, snapshot }: AdminReviewRecord): string[] {
  if (isClaimStudioPack(pack)) {
    const { landmarkChallenges, backupPool, challengeHandPool } = pack.challenges;
    const challengeCount = Object.values(landmarkChallenges).reduce((total, items) => total + items.length, 0)
      + backupPool.length + (challengeHandPool?.length ?? 0);
    const cardCount = pack.tacticalDeck.cards.reduce((total, card) => total + card.copies, 0);
    return [`${pack.geography.zones.length} zona`, `${pack.geography.landmarks.length} landmark`, `${challengeCount} tantangan`, `${cardCount} kartu`];
  }
  const clueCount = Object.values(pack.investigationBook.families).reduce((total, family) => total + (family?.items.length ?? 0), 0);
  const cardCount = pack.deck.cards.reduce((total, card) => total + card.copies, 0);
  return [`${snapshot.stations.length} stasiun`, `${snapshot.pois.length} titik minat`, `${clueCount} petunjuk`, `${cardCount} kartu`];
}

function renderSubmission(record: AdminReviewRecord, state: AdminReviewState) {
  const { format, pack, packId, status, validation, version } = record;
  const key = `${packId}@${version}`;
  const expanded = state.expanded.has(key);
  const meta = pack.meta;
  const errors = validation.errors.length;
  const warnings = validation.warnings?.length ?? 0;
  const validatorClass = validation.ok ? warnings ? "rb-badge-warn" : "rb-badge-owned" : "rb-badge-danger";
  const validatorLabel = validation.ok ? warnings ? `Valid · ${warnings} peringatan` : "Valid" : `Belum valid · ${errors} masalah`;
  const price = meta.priceIdr > 0 ? `Rp ${meta.priceIdr.toLocaleString("id-ID")}` : "Gratis";
  const target = `data-pack="${escapeText(packId)}" data-version="${version}"${state.busy ? " disabled" : ""}`;
  return `<article class="rb-card admin-review-pack" data-admin-pack="${escapeText(packId)}" data-version="${version}">
    <header class="admin-review-pack-head">
      <div class="admin-review-pack-art" aria-hidden="true">${formatHeroCardSvg(format)}</div>
      <div>
        <h3>${escapeText(meta.title)}</h3>
        <p>Oleh ${escapeText(meta.byline)} · ${escapeText(meta.cityLabel)}</p>
        <span class="admin-review-version">v${version} · Diperbarui ${timeTag(record.updatedAt)}</span>
      </div>
    </header>
    <div class="rb-badges" aria-label="Rincian paket">
      <span class="rb-badge">${escapeText(formats[format])}</span>
      <span class="rb-badge${meta.priceIdr > 0 ? " rb-badge-paid" : ""}">${price}</span>
      <span class="rb-badge admin-review-status" data-status="${escapeText(status)}">${statuses[status as ReviewStatus]}</span>
      <span class="rb-badge ${validatorClass}">Validasi · ${validatorLabel}</span>
    </div>
    <ul class="admin-review-counts" aria-label="Isi paket">${itemCounts(record).map(label => `<li>${label}</li>`).join("")}</ul>
    <details class="admin-review-inspect" data-admin-inspect="${escapeText(key)}"${expanded ? " open" : ""}>
      <summary>Periksa Paket</summary>
      ${expanded ? renderAdminInspection(record) : ""}
    </details>
    <div class="admin-review-actions">
      <button type="button" class="primary" data-action="admin-playtest" ${target}>Uji Coba (Admin QA)</button>
      ${status === "submitted" ? `<button type="button" class="secondary" data-action="publish" ${target}>Terbitkan ke Katalog</button>
        <button type="button" class="secondary" data-action="request-changes" ${target}>Minta Revisi</button>` : ""}
      ${status === "published" ? `<button type="button" class="secondary" data-action="pause" ${target}>Jeda Penjualan</button>` : ""}
      ${status === "paused" ? `<button type="button" class="secondary" data-action="resume" ${target}>Aktifkan Kembali</button>` : ""}
    </div>
  </article>`;
}

function renderAdminRoster({ admins, manageOpen, busy, adminError }: AdminReviewState) {
  return `<section class="admin-review-roster" aria-label="Kelola Admin">
    <button type="button" class="secondary admin-review-manage" data-action="admin-manage" aria-expanded="${manageOpen}" aria-controls="admin-review-roster">Kelola Admin</button>
    <div id="admin-review-roster"${manageOpen ? "" : " hidden"}>
      ${manageOpen ? `${adminError ? `<p class="rb-banner-error" role="alert">${escapeText(adminError)}</p>` : ""}
      ${!admins && !adminError ? "<p role=\"status\">Memuat daftar admin…</p>" : ""}
      <form class="admin-review-grant" data-admin-grant>
        <label class="rb-field"><span>Email Akun</span><input type="email" name="email" autocomplete="email" required></label>
        <button type="submit" class="primary"${busy ? " disabled" : ""}>Tambah Admin</button>
      </form>
      <ul class="admin-review-accounts">${(admins ?? []).map(admin => {
        const locked = admin.isEnvBootstrapped || admins?.length === 1;
        return `<li data-admin-email="${escapeText(admin.email)}">
          <div><strong>${escapeText(admin.displayName)}</strong><small>${escapeText(admin.email)}</small>
            ${admin.isEnvBootstrapped ? '<span class="rb-badge">Bawaan Server</span>' : ""}
          </div>
          <button type="button" class="secondary" data-action="admin-revoke" data-email="${escapeText(admin.email)}"${locked || busy ? " disabled" : ""}>Cabut Akses</button>
        </li>`;
      }).join("")}</ul>` : ""}
    </div>
  </section>`;
}

export function renderAdminReview(records: AdminReviewRecord[], state: AdminReviewState): string {
  const matchingFormat = records.filter(record => state.format === "all" || record.format === state.format);
  const matchingStatus = matchingFormat.filter(record => state.status === "all" || record.status === state.status);
  return `<div class="admin-review">
    <section class="admin-review-filters" aria-label="Filter paket">
      <div class="studio-section-tabs admin-review-status-tabs" role="group" aria-label="Status Paket">
        ${(["submitted", "published", "paused", "all"] as const).map(status => {
          const count = status === "all" ? matchingFormat.length : matchingFormat.filter(record => record.status === status).length;
          return `<button type="button" data-admin-status="${status}" aria-pressed="${state.status === status}">${statuses[status]} <span class="admin-review-tab-count">${count}</span></button>`;
        }).join("")}
      </div>
      <div class="admin-review-format-tabs" role="group" aria-label="Format Paket">
        ${(Object.keys(formats) as AdminReviewState["format"][]).map(format =>
          `<button type="button" data-admin-format="${format}" aria-pressed="${state.format === format}">${escapeText(formats[format])}</button>`,
        ).join("")}
      </div>
    </section>
    ${renderAdminRoster(state)}
    <section class="admin-review-results" aria-label="Daftar paket">
      ${matchingStatus.length ? matchingStatus.map(record => renderSubmission(record, state)).join("") : '<p class="rb-card" role="status">Belum ada paket dengan filter ini.</p>'}
    </section>
  </div>`;
}

export function renderAdminReviewDialog({ action, name }: AdminReviewPending): string {
  const titles = {
    publish: "Terbitkan ke Katalog",
    "request-changes": "Minta Revisi",
    pause: "Jeda Penjualan",
    resume: "Aktifkan Kembali",
    revoke: "Cabut Akses",
  };
  const prompts = {
    publish: `Terbitkan “${name}” agar pemain bisa menemukannya di katalog.`,
    "request-changes": `Kreator “${name}” akan menerima catatan revisi ini.`,
    pause: `Jeda penjualan “${name}” di katalog.`,
    resume: `Tampilkan kembali “${name}” di katalog.`,
    revoke: `Cabut akses Panel Admin untuk ${name}.`,
  };
  const noteLabel = action === "request-changes" ? "Catatan Revisi" : action === "pause" ? "Alasan Jeda" : "";
  return `<dialog class="admin-review-dialog" data-admin-dialog aria-labelledby="admin-review-dialog-title" aria-describedby="admin-review-dialog-description">
    <form data-admin-confirm>
      <h3 id="admin-review-dialog-title">${titles[action]}</h3>
      <p id="admin-review-dialog-description">${escapeText(prompts[action])}</p>
      ${noteLabel ? `<label class="rb-field"><span>${noteLabel}</span><textarea name="note" rows="4" required autofocus></textarea></label>` : ""}
      <p class="admin-review-dialog-error" role="alert" data-admin-dialog-error hidden></p>
      <div class="admin-review-actions">
        <button type="button" class="secondary" data-action="admin-cancel"${noteLabel ? "" : " autofocus"}>Batal</button>
        <button type="submit" class="primary">${titles[action]}</button>
      </div>
    </form>
  </dialog>`;
}
