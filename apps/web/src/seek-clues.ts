import type { SeekCard, SeekClueMenuItem, SeekQuestion, SeekQuestionFamily, SeekQuestionInput, SeekRoom } from "@kelana-ria/contracts";
import { feedbackMarkup, type Feedback } from "./multiplayer-room";
import { action, escapeText, remaining, wib } from "./solo-view";

export const questionFamily = {
  radar: { label: "Radar", prompt: "Apakah kamu berada di dalam radius dari titik acuan?" },
  photo: { label: "Foto", prompt: "Foto garis atap bangunan umum yang terlihat dari titik sembunyimu." },
  warmer: { label: "Lebih dekat atau lebih jauh", prompt: "Dari dua titik check-in terakhir yang berbeda, di mana pencari lebih dekat?" },
  matching: { label: "Kecocokan", prompt: "Apakah titik kita berada di cabang transit yang sama?" },
  measuring: { label: "Pengukuran", prompt: "Siapa yang lebih dekat ke landmark ini menurut jarak jalan kaki di papan?" },
  nearest: { label: "Landmark terdekat", prompt: "Jika kamu berada di dalam radius, landmark mana yang terdekat denganmu?" },
} satisfies Record<SeekQuestionFamily, { label: string; prompt: string }>;

const cardCopy = {
  "time-bonus": { label: "Bonus waktu", description: "Tetap di tangan hingga akhir giliran untuk menambah 2 menit pada skor." },
  "question-delay": { label: "Jeda pertanyaan", description: "Blokir pertanyaan baru selama 2 menit." },
  "hand-swap": { label: "Tukar tangan", description: "Buang kartu ini dan satu kartu lain. Ambil 2, simpan 1." },
} satisfies Record<SeekCard["kind"], { label: string; description: string }>;

export type ClueDraft = {
  family: SeekQuestionFamily;
  input: string;
  answer: string;
  photo?: { file: File; preview: string };
  preparingPhoto: boolean;
  cards: Set<string>;
  cardDiscards: Set<string>;
  discard: Record<string, string>;
  feedback?: Feedback;
};

export function newClueDraft(): ClueDraft {
  return { family: "radar", input: "", answer: "", preparingPhoto: false, cards: new Set(), cardDiscards: new Set(), discard: {} };
}

export function pendingQuestion(room: SeekRoom | undefined) {
  return room?.clues?.questions.find(question => question.status === "pending");
}

export function cluePointName(room: SeekRoom, id: string) {
  return [room.edition.start, ...room.edition.checkpoints, ...(room.clues?.landmarks ?? [])].find(point => point.id === id)?.name ?? id;
}

function inputValue(input: SeekQuestionInput) {
  if (input.radiusMeters !== undefined && input.landmarkId !== undefined) return `${input.radiusMeters}:${input.landmarkId}`;
  return input.radiusMeters?.toString() ?? input.landmarkId ?? "";
}

export function selectedQuestion(room: SeekRoom, draft: ClueDraft) {
  const clues = room.clues;
  const menu = clues?.menu.find(question => question.family === draft.family);
  const option = menu?.options.length === 1 ? menu.options[0] : menu?.options.find(input => inputValue(input) === draft.input);
  const existing = option && clues?.questions.find(question => question.status !== "pending" && question.status !== "closed"
    && question.family === draft.family && question.referenceId === clues.referenceId
    && (question.family !== "warmer" || question.previousReferenceId === clues.previousReferenceId)
    && question.radiusMeters === option.radiusMeters && question.landmarkId === option.landmarkId);
  return { menu, option, existing };
}

export function drawSelection(room: SeekRoom, draft: ClueDraft) {
  const draw = room.clues?.draw;
  const selected = draw?.cards.filter(card => draft.cards.has(card.id)) ?? [];
  const discardOptions = [...(room.clues?.hand ?? []), ...selected];
  const excess = Math.max(0, discardOptions.length - 3);
  const discards = discardOptions.filter(card => draft.cardDiscards.has(card.id));
  const complete = Boolean(draw && selected.length === draw.keepCount && discards.length === excess);
  return { selected, discardOptions, excess, discards, complete };
}

const rewards = (question: Pick<SeekClueMenuItem, "drawCount" | "keepCount">) =>
  `Ambil ${question.drawCount} kartu, simpan ${question.keepCount}`;
const meters = new Intl.NumberFormat("id-ID", { style: "unit", unit: "meter", unitDisplay: "short" });

function time(timestamp: number) {
  return `<time datetime="${new Date(timestamp).toISOString()}">${wib(timestamp)}</time>`;
}

function questionDetails(room: SeekRoom, question: SeekQuestion) {
  const landmark = question.landmarkId ? room.clues?.menu.find(item => item.family === question.family)?.options
    .find(option => option.landmarkId === question.landmarkId)?.label ?? cluePointName(room, question.landmarkId) : undefined;
  return `<p>Titik acuan <strong>${escapeText(cluePointName(room, question.referenceId))}</strong>
    ${question.previousReferenceId ? ` · Sebelumnya ${escapeText(cluePointName(room, question.previousReferenceId))}` : ""}
    ${question.radiusMeters === undefined ? "" : ` · Radius ${question.radiusMeters} m`}
    ${landmark ? ` · ${escapeText(landmark)}` : ""}</p>
    ${question.landmarkIds?.length ? `<p>Landmark dalam pilihan · ${question.landmarkIds.map(id => escapeText(cluePointName(room, id))).join(", ")}</p>` : ""}`;
}

function questionInputs(room: SeekRoom, menu: SeekClueMenuItem, draft: ClueDraft, busy: boolean) {
  const entries = menu.options.filter(option => inputValue(option));
  if (!entries.length) return "";
  const radius = entries.some(option => option.radiusMeters !== undefined);
  const landmark = entries.some(option => option.landmarkId !== undefined);
  const label = radius && landmark ? "Pilihan pertanyaan" : radius ? "Radius" : "Landmark";
  return `<div class="seek-field"><label for="seek-clue-input">${label}</label>
    <select id="seek-clue-input" name="clue-input" data-focus="clue-input" ${busy ? "disabled" : ""}>
      ${entries.length === 1 ? "" : `<option value="">${radius ? "Pilih radius" : "Pilih landmark"}</option>`}
      ${entries.map(option => {
        const value = inputValue(option);
        const name = option.label ?? (option.landmarkId ? cluePointName(room, option.landmarkId) : `${option.radiusMeters} m`);
        return `<option value="${escapeText(value)}" ${draft.input === value ? "selected" : ""}>${escapeText(name)}</option>`;
      }).join("")}
    </select>
  </div>`;
}

export function clueHistory(room: SeekRoom, showArchives = false) {
  const current = { turn: room.turn, questions: room.clues?.questions ?? [] };
  const history = showArchives ? room.turns.map(result => ({
    turn: result.turn, questions: result.clues ?? (result.turn === room.turn ? current.questions : []),
  })) : [current];
  if (!history.some(group => group.turn === current.turn)) history.push(current);
  const groups = history.map(group => ({ ...group, questions: group.questions.filter(question => question.status !== "pending") }))
    .filter(group => group.questions.length);
  if (!groups.length) return "";
  const status = { answered: "Dijawab", timeout: "Jawaban otomatis", substituted: "Foto diganti dengan pencocokan cabang", closed: "Ditutup", pending: "Menunggu jawaban" };
  const itemHeading = showArchives ? "h4" : "h3";
  return `<section class="solo-ticket seek-clue-history" aria-labelledby="seek-clue-history-heading">
    <h2 id="seek-clue-history-heading">Riwayat petunjuk</h2>
    ${groups.map(({ turn, questions }) => `<div class="seek-clue-turn">
      ${showArchives ? `<h3>Giliran ${turn}</h3>` : ""}
      <ol>${questions.slice().reverse().map(question => `<li id="seek-question-${escapeText(question.id)}" tabindex="-1">
        <div class="seek-clue-row"><${itemHeading}>${questionFamily[question.family].label}</${itemHeading}><span>${status[question.status]}</span></div>
        ${questionDetails(room, question)}
        <p>Dikirim ${time(question.askedAt)}</p>
        ${question.answer ? `<p class="seek-clue-answer"><strong>${escapeText(question.answer)}</strong></p>` : ""}
        ${question.photoId && /^[\w-]+$/.test(question.photoId) && (room.phase === "seeking" || room.phase === "regroup")
          ? `<img class="seek-clue-photo" src="/api/seek/${encodeURIComponent(room.code)}/photos/${encodeURIComponent(question.photoId)}"
            alt="Foto petunjuk dari pemain yang bersembunyi" loading="lazy">` : ""}
      </li>`).join("")}</ol>
    </div>`).join("")}
  </section>`;
}

function seekerPanel(room: SeekRoom, draft: ClueDraft, busy: boolean) {
  const clues = room.clues;
  if (!clues) return "";
  const pending = pendingQuestion(room);
  const { menu, option, existing } = selectedQuestion(room, draft);
  const delayUntil = clues.delayUntil;
  const delayed = delayUntil !== null;
  const blocked = !existing && (busy || !clues.referenceId || !option || Boolean(pending) || delayed);
  const walking = menu?.family === "warmer" || menu?.family === "measuring";
  return `<section class="solo-ticket" aria-labelledby="seek-clue-heading">
    <h2 id="seek-clue-heading" tabindex="-1">Petunjuk</h2>
    ${clues.referenceId ? `<p>Titik acuan <strong>${escapeText(cluePointName(room, clues.referenceId))}</strong></p>`
      : "<p>Check-in di titik awal untuk membuka pertanyaan.</p>"}
    ${pending ? `<div class="seek-clue-state"><strong>Menunggu jawaban · ${questionFamily[pending.family].label}</strong>
      ${questionDetails(room, pending)}<p>Batas jawaban ${time(pending.deadline)}</p></div>` : ""}
    ${delayed ? `<p class="seek-clue-state"><strong>Pertanyaan baru dijeda hingga ${time(delayUntil)}</strong></p>` : ""}
    ${pending || delayed ? "<p>Kamu bisa tetap check-in dan menyelidiki titik.</p>" : ""}
    ${feedbackMarkup(draft.feedback)}
    <fieldset class="seek-question-menu" ${busy ? "disabled" : ""}>
      <legend>Pilih jenis pertanyaan</legend>
      ${clues.menu.map(item => `<label class="seek-choice">
        <input type="radio" name="clue-family" value="${item.family}" data-focus="clue-family-${item.family}"
          aria-label="${questionFamily[item.family].label}" aria-describedby="seek-price-${item.family}${!item.options.length ? ` seek-unavailable-${item.family}` : ""}"
          ${draft.family === item.family ? "checked" : ""}>
        <span><strong>${questionFamily[item.family].label}</strong><small id="seek-price-${item.family}">${rewards(item)}</small>
          ${!item.options.length ? `<small id="seek-unavailable-${item.family}">Belum tersedia</small>` : ""}</span>
      </label>`).join("")}
    </fieldset>
    ${menu ? `<p>${menu.family === "photo" ? "Minta temanmu memotret garis atap bangunan umum dari titik sembunyinya." : questionFamily[menu.family].prompt}</p>
      ${questionInputs(room, menu, draft, busy)}` : ""}
    ${menu?.family === "warmer" && option && clues.previousReferenceId
      ? `<p>Titik acuan sebelumnya <strong>${escapeText(cluePointName(room, clues.previousReferenceId))}</strong></p>` : ""}
    ${walking && option ? `<p>Selisih jarak hingga ${meters.format(clues.equalToleranceMeters)} dianggap sama.</p>` : ""}
    ${option?.landmarkIds?.length ? `<p>Landmark dalam pilihan · ${option.landmarkIds.map(id => escapeText(cluePointName(room, id))).join(", ")}</p>` : ""}
    ${menu && option && !existing ? `<p>Waktu menjawab <strong data-clue-window="${menu.responseMs}">${remaining(menu.responseMs)}</strong> sejak dikirim.</p>` : ""}
    ${menu?.family === "warmer" && !menu.options.length && clues.referenceId ? "<p>Check-in di dua titik yang berbeda untuk membuka pertanyaan ini.</p>" : ""}
    ${existing ? "<p>Jawaban ini sudah tersedia. Buka kembali tanpa memberi kartu baru.</p>" : ""}
    <div class="solo-actions">${action(existing ? "Buka jawaban" : "Kirim pertanyaan", "ask-clue", "primary", blocked)}</div>
  </section>`;
}

function answerPanel(room: SeekRoom, draft: ClueDraft, busy: boolean) {
  const question = pendingQuestion(room);
  if (!question) return "";
  const photo = question.family === "photo";
  const disabled = busy || draft.preparingPhoto;
  const drawing = Boolean(room.clues?.draw);
  const choices = question.choices ?? [];
  const referenceBranch = room.clues?.branches[question.referenceId];
  const ownBranch = room.ownLock && room.clues?.branches[room.ownLock];
  const distance = room.clues && (question.family === "warmer" || question.family === "measuring") ? room.clues : undefined;
  const comparison = question.walkingComparison;
  const [first, second] = question.family === "warmer" ? ["Titik sebelumnya", "Titik acuan"] : ["Pencari", "Kamu"];
  return `<section class="solo-ticket" aria-labelledby="seek-answer-heading">
    <h2 id="seek-answer-heading" tabindex="-1">Pertanyaan masuk</h2>
    <p><strong>${questionFamily[question.family].label}</strong> · Dikirim ${time(question.askedAt)}</p>
    <p>${questionFamily[question.family].prompt}</p>
    ${questionDetails(room, question)}
    ${question.family === "matching" && referenceBranch && ownBranch
      ? `<p>Cabang titik acuan <strong>${escapeText(referenceBranch)}</strong> · Cabang titik sembunyimu <strong>${escapeText(ownBranch)}</strong></p>` : ""}
    ${comparison ? `<p>Jarak jalan kaki · ${first} <strong>${meters.format(comparison.firstMeters)}</strong> ·
      ${second} <strong>${meters.format(comparison.secondMeters)}</strong></p>` : ""}
    ${distance ? `<p>${escapeText(distance.distanceSource)}. Selisih hingga ${meters.format(distance.equalToleranceMeters)} dianggap sama.</p>` : ""}
    <p>Batas jawaban ${time(question.deadline)} · ${rewards(question)}</p>
    ${drawing ? "<p>Jika jawaban diterima, kartu dari pilihan sebelumnya disimpan otomatis.</p>" : ""}
    ${feedbackMarkup(draft.feedback)}
    ${photo ? `<p>Tampilkan bangunan umum saja. Hindari orang yang dapat dikenali. JPEG, PNG, atau WebP, maks. 2 MB.</p>
      <div class="seek-photo-inputs">
        <div class="seek-field"><label for="seek-photo-camera">Ambil foto</label>
          <input id="seek-photo-camera" name="clue-photo" type="file" accept="image/jpeg,image/png,image/webp" capture="environment" data-focus="photo-camera" ${disabled ? "disabled" : ""}>
        </div>
        <div class="seek-field"><label for="seek-photo-file">Pilih foto</label>
          <input id="seek-photo-file" name="clue-photo" type="file" accept="image/jpeg,image/png,image/webp" data-focus="photo-file" ${disabled ? "disabled" : ""}>
        </div>
      </div>
      ${draft.photo ? `<img class="seek-clue-photo" src="${escapeText(draft.photo.preview)}" alt="Pratinjau foto petunjuk">
        <p class="seek-filename">${escapeText(draft.photo.file.name)}</p>` : ""}
      <div class="solo-actions">
        ${action(draft.preparingPhoto ? "Menyiapkan foto…" : "Kirim foto", "answer-photo", "primary", disabled || !draft.photo)}
        ${action("Foto tidak tersedia", "no-photo", "secondary", disabled)}
      </div>` : `<div class="seek-field"><label for="seek-answer">Jawaban</label>
        <select id="seek-answer" name="clue-answer" data-focus="clue-answer" ${busy ? "disabled" : ""}>
          <option value="">Pilih jawaban</option>
          ${choices.map(choice => `<option value="${escapeText(choice.id)}" ${draft.answer === choice.id ? "selected" : ""}>${escapeText(choice.label)}</option>`).join("")}
        </select>
      </div>
      <div class="solo-actions">${action("Kirim jawaban", "answer-clue", "primary", busy || !choices.some(choice => choice.id === draft.answer))}</div>`}
  </section>`;
}

function cardOption(card: SeekCard, cards: SeekCard[]) {
  const label = cardCopy[card.kind].label;
  const matches = cards.filter(option => option.kind === card.kind);
  return matches.length > 1 ? `${label} ${matches.indexOf(card) + 1}` : label;
}

function drawPanel(room: SeekRoom, draft: ClueDraft, busy: boolean) {
  const draw = room.clues?.draw;
  if (!draw) return "";
  const { discardOptions, excess, complete } = drawSelection(room, draft);
  return `<fieldset class="seek-card-draw" ${busy ? "disabled" : ""}>
    <legend>Pilih kartu</legend>
    <p>Simpan ${draw.keepCount} dari ${draw.cards.length} kartu sebelum ${time(draw.deadline)}.</p>
    ${draw.cards.map(card => {
      const id = escapeText(card.id);
      const label = cardOption(card, draw.cards);
      return `<label class="seek-choice">
        <input type="checkbox" name="keep-card" value="${id}" data-focus="keep-${id}" aria-label="${label}" aria-describedby="seek-reward-${id}"
          ${draft.cards.has(card.id) ? "checked" : draft.cards.size >= draw.keepCount ? "disabled" : ""}>
        <span><strong>${label}</strong><small id="seek-reward-${id}">${cardCopy[card.kind].description}</small></span>
      </label>`;
    }).join("")}
    ${excess && draft.cards.size === draw.keepCount ? `<fieldset class="seek-card-draw">
      <legend>Buang ${excess} kartu agar tersisa 3</legend>
      ${discardOptions.map(card => {
        const id = escapeText(card.id);
        return `<label class="seek-choice"><input type="checkbox" name="draw-discard" value="${id}" data-focus="draw-discard-${id}"
          ${draft.cardDiscards.has(card.id) ? "checked" : draft.cardDiscards.size >= excess ? "disabled" : ""}>
          <span>${cardOption(card, discardOptions)} · ${draft.cards.has(card.id) ? "Baru" : "Di tangan"}</span></label>`;
      }).join("")}
    </fieldset>` : ""}
    <div class="solo-actions">${action("Simpan kartu", "keep-cards", "primary", busy || !complete)}</div>
  </fieldset>`;
}

function handPanel(room: SeekRoom, draft: ClueDraft, busy: boolean) {
  const clues = room.clues;
  if (!clues?.hand) return "";
  const { hand, draw } = clues;
  const pending = pendingQuestion(room);
  const playable = !busy && !pending && !draw;
  return `<section class="solo-ticket seek-hand" aria-labelledby="seek-hand-heading">
    <h2 id="seek-hand-heading" tabindex="-1">Kartu pribadi</h2>
    <p><strong>${hand.length} / 3 kartu</strong> · Hanya kamu yang bisa melihatnya.</p>
    ${!pending ? feedbackMarkup(draft.feedback) : ""}
    ${drawPanel(room, draft, busy)}
    ${hand.length ? `<ul class="seek-hand-list">${hand.map(card => {
      const id = escapeText(card.id);
      const copy = cardCopy[card.kind];
      let controls = "";
      if (card.kind === "question-delay") {
        controls = `<button class="secondary" type="button" data-action="delay-clues" data-card="${id}" data-focus="card-${id}"
          ${!playable || clues.delayUntil !== null ? "disabled" : ""}>Tunda pertanyaan</button>`;
      } else if (card.kind === "hand-swap") {
        const options = hand.filter(item => item.id !== card.id);
        controls = `<div class="seek-field"><label for="seek-discard-${id}">Kartu lain untuk dibuang</label>
          <select id="seek-discard-${id}" name="discard-card" data-card="${id}" data-focus="discard-${id}" ${!playable || !options.length ? "disabled" : ""}>
            <option value="">Pilih kartu</option>
            ${options.map(item => `<option value="${escapeText(item.id)}" ${draft.discard[card.id] === item.id ? "selected" : ""}>
              ${cardOption(item, hand)}</option>`).join("")}
          </select>
        </div>
        <button class="secondary" type="button" data-action="swap-card" data-card="${id}" data-focus="card-${id}"
          ${!playable || !options.some(item => item.id === draft.discard[card.id]) ? "disabled" : ""}>Tukar kartu</button>`;
      }
      return `<li><h3>${cardOption(card, hand)}</h3><p>${copy.description}</p>${controls}</li>`;
    }).join("")}</ul>` : "<p>Tangan masih kosong.</p>"}
    ${clues.delayUntil !== null ? `<p>Jeda pertanyaan aktif hingga ${time(clues.delayUntil)}.</p>` : ""}
  </section>`;
}

export function cluePanels(room: SeekRoom, draft: ClueDraft, busy: boolean) {
  if (room.phase !== "seeking") return clueHistory(room);
  return `${room.hider === room.seat ? answerPanel(room, draft, busy) + handPanel(room, draft, busy) : seekerPanel(room, draft, busy)}${clueHistory(room)}`;
}
