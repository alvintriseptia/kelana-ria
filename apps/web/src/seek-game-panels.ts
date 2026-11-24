import type {
  HideSeekQuestionFamily,
  SeekCardInstance,
  SeekDrawBatch,
  SeekEngineMenuEntry,
  SeekEngineQuestion,
  SeekPublicBoard,
} from "@kelana-ria/contracts";
import { escapeText } from "./solo-view";

export const questionNames: Record<HideSeekQuestionFamily, string> = {
  radar: "Radar",
  matching: "Cocokkan",
  measuring: "Bandingkan",
  thermometer: "Termometer",
  tentacles: "Tempat terdekat",
  photo: "Foto",
};

const descriptions: Record<HideSeekQuestionFamily, string> = {
  radar: "Cari dalam radius",
  matching: "Cari ciri yang sama",
  measuring: "Siapa lebih dekat?",
  thermometer: "Mendekat atau menjauh?",
  tentacles: "Cari tempat di sekitar",
  photo: "Minta petunjuk visual",
};

export function rewardLabel(batches: SeekDrawBatch[]): string {
  const draw = batches.reduce((sum, batch) => sum + batch.drawCount, 0);
  const keep = batches.reduce((sum, batch) => sum + batch.keepCount, 0);
  return draw > 0 ? `Ambil ${draw} · Simpan ${keep}` : "Tanpa kartu";
}

export function questionArt(family: HideSeekQuestionFamily): string {
  return `<span aria-hidden="true" class="sg-art sg-art-${family}"></span>`;
}

export function questionDeck(menu: SeekEngineMenuEntry[]): string {
  const families = (Object.keys(questionNames) as HideSeekQuestionFamily[])
    .filter(family => menu.some(entry => entry.family === family));
  return `<h2 id="sg-panel-title" tabindex="-1">Pilih petunjuk</h2>
    <div class="sg-question-grid">${families.map(family => {
      const options = menu.filter(entry => entry.family === family);
      const available = options.find(entry => entry.availableInCurrentPhase && !entry.lockedSingleUse);
      return `<button type="button" class="sg-question-card" data-action="question-family" data-family="${family}">
        ${questionArt(family)}
        <span class="sg-question-text"><strong>${questionNames[family]}</strong>
        <small>${escapeText(available ? rewardLabel(available.drawBatches) : "Lihat pilihan")}</small></span>
      </button>`;
    }).join("")}</div>`;
}

export function questionOptions(
  family: HideSeekQuestionFamily,
  entries: SeekEngineMenuEntry[],
  selected: SeekEngineMenuEntry | undefined,
  blocked: boolean,
  thermometer: { started: boolean; distance?: number } | undefined,
  busy: boolean,
  preview?: { content: string; ready: boolean; validUntil?: number },
): string {
  const startThermometer = thermometer && !thermometer.started;
  const canSend = !blocked && !busy && selected?.availableInCurrentPhase && !selected.lockedSingleUse &&
    (!thermometer || (thermometer.distance ?? 0) >= (selected.minTravelMeters ?? Infinity)) && (preview?.ready ?? true);
  return `<div class="sg-detail-title">
      ${questionArt(family)}
      <div><h2 id="sg-panel-title" tabindex="-1">${questionNames[family]}</h2><p>${descriptions[family]}</p></div>
      <button type="button" class="sg-quiet" data-action="question-deck">Semua kartu</button>
    </div>
    <div class="sg-picks" role="group" aria-label="Pilihan petunjuk">${entries.map(entry => {
      const disabled = !entry.availableInCurrentPhase || entry.lockedSingleUse;
      return `<button type="button" class="sg-pick" data-action="question-option" data-item="${escapeText(entry.itemId)}" aria-pressed="${selected?.itemId === entry.itemId}" ${disabled ? "disabled" : ""}>${escapeText(entry.isCustomRadius ? "Radius sendiri" : entry.label)}</button>`;
    }).join("")}</div>
    ${thermometer ? `<p>${thermometer.started ? (thermometer.distance === undefined
      ? "Titik A tersimpan. Berpindah, lalu tandai titik B." : `A → B · ${Math.round(thermometer.distance)} m garis lurus`)
      : "Tandai titik A. Bergerak sesuai jarak minimum, lalu tandai titik B."}${selected?.minTravelMeters ? ` Minimum ${selected.minTravelMeters} m.` : ""}</p>` : ""}
    ${selected?.prompt ? `<p>${escapeText(selected.prompt)}</p>` : ""}
    ${selected?.isCustomRadius ? `<label class="rb-field">Radius (meter)<input id="sg-radius" type="number" min="1" inputmode="numeric" required></label>` : ""}
    ${preview?.content ?? ""}
    ${selected ? `<p class="sg-reward-note">${rewardLabel(selected.drawBatches)}${selected.nextRepeatMultiplier > 1 ? ` · ${selected.nextRepeatMultiplier}× biaya` : ""}</p>` : ""}
    ${thermometer ? `<button type="button" class="${startThermometer ? "sg-main" : "sg-pick"}" data-action="${startThermometer ? "start-thermometer" : "mark-thermometer-end"}" ${busy || blocked || !selected ? "disabled" : ""}>${startThermometer ? "Tandai titik A" : "Tandai titik B"}</button>` : ""}
    ${startThermometer ? "" : `<button type="button" class="sg-main" data-action="ask-clue" data-family="${family}" data-item="${escapeText(selected?.itemId ?? "")}" ${preview?.validUntil === undefined ? "" : `data-preview-until="${preview.validUntil}"`} ${canSend ? "" : "disabled"}>Kirim pertanyaan</button>`}`;
}

const answers: Record<string, string> = {
  Yes: "Ya, di dalam radar",
  No: "Tidak, di luar radar",
  Same: "Sama",
  Different: "Berbeda",
  Hotter: "Lebih dekat",
  Colder: "Lebih jauh",
  Equal: "Sama jauh",
  "Seeker closer": "Pencari lebih dekat",
  "Hider closer": "Penyembunyi lebih dekat",
  "Photo delivered": "Foto diterima",
  "Outside radius": "Di luar radius",
};

export function answerText(label: string): string {
  return answers[label] ?? label;
}

const objectiveChoices = {
  radar: [["yes", "Di dalam"], ["no", "Di luar"]],
  thermometer: [["hotter", "Lebih dekat"], ["colder", "Lebih jauh"], ["equal", "Sama jauh"]],
  matching: [["same", "Sama"], ["different", "Berbeda"]],
  measuring: [["seeker_closer", "Pencari lebih dekat"], ["hider_closer", "Penyembunyi lebih dekat"], ["equal", "Sama jauh"]],
};

export function incomingQuestion(
  question: SeekEngineQuestion, selected: string, pois: SeekPublicBoard["pois"], photoPreview: string, extras: string, busy: boolean,
): string {
  const answer = question.privateComputedAnswer;
  const choices = question.family === "photo" ? [] : question.family === "tentacles"
    ? [["outside", "Di luar radius"], ...(answer?.overlay.type === "voronoi"
        ? answer.overlay.candidatePoiIds.map(id => [id, pois.find(poi => poi.id === id)?.name ?? id])
        : []), ...(answer?.code.includes("|") ? [[answer.code, answer.label]] : [])]
    : objectiveChoices[question.family];
  return `<div class="sg-detail-title">
      ${questionArt(question.family)}
      <div><p class="sg-kicker">Pertanyaan masuk</p><h2 id="sg-panel-title" tabindex="-1">${escapeText(question.label)}</h2></div>
    </div>
    ${question.prompt && question.prompt !== question.label ? `<p>${escapeText(question.prompt)}</p>` : ""}
    <p class="sg-reward-note">${rewardLabel(question.drawBatches)}</p>
    ${question.family === "photo" ? `<p>Foto tempat umum. Hindari orang yang dapat dikenali. JPEG, PNG, atau WebP, maks. 2 MB.</p>
      <label class="rb-field">Ambil atau pilih foto<input id="sg-clue-photo" type="file" accept="image/jpeg,image/png,image/webp" ${busy ? "disabled" : ""}></label>
      ${photoPreview ? `<img class="sg-clue-photo" src="${escapeText(photoPreview)}" alt="Pratinjau foto petunjuk">` : ""}
      <button type="button" class="sg-main" data-action="answer-photo" data-qid="${escapeText(question.id)}" ${busy || !photoPreview ? "disabled" : ""}>Kirim foto</button>`
      : `<div class="sg-picks" role="group" aria-label="Jawaban">${choices.map(([code, label]) => `<button type="button" class="sg-pick" data-action="choose-answer" data-answer="${escapeText(code)}" aria-pressed="${selected === code}">${escapeText(label)}</button>`).join("")}</div>
        ${selected && answer ? `<p class="sg-answer-check" data-correct="${selected === answer.code}" role="status">${selected === answer.code ? "✓ Jawaban cocok dengan peta" : "✕ Jawaban belum cocok dengan peta"}</p>` : ""}
        <button type="button" class="sg-main" data-action="answer-pending" data-qid="${escapeText(question.id)}" ${busy || !answer || selected !== answer.code ? "disabled" : ""}>Kirim jawaban</button>`}
    <div class="sg-picks">${extras}</div>`;
}

const categories: Record<SeekCardInstance["category"], string> = {
  time_bonus: "Bonus waktu",
  powerup: "Powerup",
  curse: "Kutukan",
};

export function rewardCard(card: SeekCardInstance, attributes = "", selected = false): string {
  const kind = card.effect.primitive === "discard_draw" || card.effect.primitive === "duplicate" ? "swap" : card.category;
  const tag = attributes ? "button" : "article";
  return `<${tag} ${attributes} class="sg-reward-card" ${attributes ? `aria-pressed="${selected}"` : ""}>
    <span class="sg-reward-art sg-reward-${kind}" aria-hidden="true"></span>
    <span class="sg-reward-copy"><small>${categories[card.category]}</small>
      <strong>${escapeText(card.title)}</strong>
      <span>${escapeText(card.description)}</span></span>
  </${tag}>`;
}
