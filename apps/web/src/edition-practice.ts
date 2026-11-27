import type { HideSeekQuestionFamily, RulebookPlayMode } from "@kelana-ria/contracts";
import { clueNames, playerRange, type CatalogEdition } from "./rulebook-catalog";
import { practiceCardFace, practiceDeck } from "./edition-practice-deck";
import { escapeText } from "./escape-text";
import samplePhoto from "./assets/jakarta.webp";
import "./edition-practice.css";

type Scene = {
  title: string;
  text: string;
  action: string;
  label: string;
  testId?: string;
};

type Clue = {
  prompt: string;
  preview: string;
  choices: [string, string];
  sample: string;
  result: string;
};

export type PracticeOptions = {
  fromRoom?: boolean;
  onReady?: () => void;
};

const clues: Record<HideSeekQuestionFamily, Clue> = {
  radar: {
    prompt: "Apakah kamu berada di dalam lingkaran Radar?",
    preview: "Lingkaran ini menunjukkan jangkauan Radar. Kirim pertanyaan untuk tahu apakah penyembunyi ada di dalamnya.",
    choices: ["Ya, di dalam", "Tidak, di luar"],
    sample: "Titik sembunyi latihan ada di dalam lingkaran.",
    result: "Jawaban menunjukkan penyembunyi ada di dalam Radar. Area di luar lingkaran tersisih.",
  },
  thermometer: {
    prompt: "Apakah titik B lebih dekat ke tempat sembunyimu dibanding titik A?",
    preview: "A dan B adalah dua posisi pencari. Periksa jalurnya sebelum meminta perbandingan jarak.",
    choices: ["Lebih hangat", "Lebih dingin"],
    sample: "Titik B lebih dekat ke tempat sembunyi latihan.",
    result: "Lebih hangat berarti titik B lebih dekat. Area yang lebih dekat ke A tersisih.",
  },
  matching: {
    prompt: "Apakah kita berada di area yang sama?",
    preview: "Periksa area tempat pencari berada. Jawaban akan menunjukkan apakah area penyembunyi cocok.",
    choices: ["Ya, sama", "Tidak, berbeda"],
    sample: "Pencari dan titik sembunyi latihan ada di area yang sama.",
    result: "Keduanya berada di area yang sama. Pencarian bisa difokuskan ke area pencari.",
  },
  measuring: {
    prompt: "Apakah kamu lebih dekat ke landmark acuan daripada aku?",
    preview: "Lingkaran mengacu pada jarak pencari ke landmark. Jawaban membandingkannya dengan jarak penyembunyi.",
    choices: ["Ya, lebih dekat", "Tidak, lebih jauh"],
    sample: "Titik sembunyi latihan lebih dekat ke landmark daripada posisi pencari.",
    result: "Penyembunyi lebih dekat ke landmark. Cari di dalam batas jarak pencari.",
  },
  tentacles: {
    prompt: "Taman mana yang paling dekat dengan tempat sembunyimu?",
    preview: "Periksa dua taman latihan di dalam jangkauan pertanyaan.",
    choices: ["Taman A", "Taman B"],
    sample: "Titik sembunyi latihan lebih dekat ke Taman A.",
    result: "Taman A paling dekat. Peta menandai area yang lebih dekat ke Taman A.",
  },
  photo: {
    prompt: "Kirim foto sesuatu yang terlihat dari tempat sembunyi.",
    preview: "Periksa isi permintaan sebelum mengirimnya ke penyembunyi.",
    choices: ["Kirim foto contoh", "Batal mengirim"],
    sample: "Gunakan foto contoh untuk berlatih mengirim bukti.",
    result: "Foto sudah diterima. Pencari menggunakan petunjuk dalam foto untuk memilih tempat berikutnya.",
  },
};
const cardsPerPage = 4;

function enabledClueFamilies(edition: CatalogEdition): HideSeekQuestionFamily[] {
  if (edition.format !== "hide-and-seek") return [];
  const enabled = new Set((edition.questionFamilies ?? []).map(item => item.family));
  return (Object.keys(clues) as HideSeekQuestionFamily[]).filter(family => enabled.has(family));
}

function button(id: string, label: string, style = "primary", extra = "") {
  return `<button type="button" class="${style}" data-practice-action="${id}" ${extra}>${label}</button>`;
}

function mapLabel(text: string) {
  return `<span class="ep-map-label">${text}</span>`;
}

function formatTime(milliseconds: number) {
  const seconds = Math.ceil(milliseconds / 1000);
  if (seconds < 60) return `${seconds} detik`;
  const minutes = Math.floor(seconds / 60);
  return seconds % 60 ? `${minutes} menit ${seconds % 60} detik` : `${minutes} menit`;
}

export function mountEditionPractice(
  dialog: HTMLDialogElement,
  edition: CatalogEdition,
  mode: RulebookPlayMode,
  options?: PracticeOptions,
) {
  const lifetime = new AbortController();
  const seek = edition.format === "hide-and-seek" ? edition : undefined;
  const claim = edition.format === "claim-the-city" ? edition : undefined;
  const families = enabledClueFamilies(edition);
  let family: HideSeekQuestionFamily | undefined = families[0];
  const focusReturn = document.activeElement;
  let step = 0;
  let near = false;
  let choice: number | null = null;
  let message = "";
  let cardPage = 0;
  let flipped: number | undefined;
  let dealing = false;
  let finishedViaReady = false;
  const revealed = new Set<number>();
  const selected = new Set<number>();

  dialog.className = "ep-dialog";
  dialog.setAttribute("aria-labelledby", "edition-practice-title");
  const range = claim?.checkInRadiusMeters
    ? `dalam radius ${claim.checkInRadiusMeters} meter`
    : "dalam radius landmark";
  const players = mode === "solo" ? "1 pemain · Solo" : playerRange(Math.max(2, edition.minPlayers), edition.maxPlayers);
  const duration = claim ? formatTime(claim.durationMs ?? claim.durationMinutes * 60_000) : "";
  const goal = claim && mode === "solo" && claim.soloTargets
    ? `Kunci ${claim.soloTargets.lockedLandmarks} landmark di setidaknya ${claim.soloTargets.distinctZones} zona dalam ${duration}.`
    : `Kuasai zona terbanyak dalam ${duration}. Jika seri, bandingkan landmark terkunci lalu total landmark.`;
  const weights = claim?.claimWeight !== undefined && claim.lockWeight !== undefined
    ? ` Klaim berbobot ${claim.claimWeight} dan kunci berbobot ${claim.lockWeight}.`
    : "";
  const claimResult = mode === "solo" ? "Landmark ini menambah progresmu." : `Tim dengan bobot landmark tertinggi menguasai zona.${weights}`;

  function activeLessonState() {
    const clue = family ? clues[family] : undefined;
    const clueTitle = family ? clueNames[family] : "";
    const deck = practiceDeck(edition, mode, family);
    const handCount = deck ? Math.min(deck.keep, deck.handLimit) : 0;
    const offersChoice = Boolean(deck && deck.draw > handCount);
    const boardLastStep = seek ? (clue ? 5 : 1) : 3;
    const finalStep = boardLastStep + (offersChoice ? 2 : deck ? 1 : 0);
    const boardAction = deck
      ? { action: "open-deck", label: "Lihat kartu latihan" }
      : { action: "ready", label: "Siap Main", testId: "practice-ready-btn" };
    return { clue, clueTitle, deck, handCount, offersChoice, boardLastStep, finalStep, boardAction };
  }

  function claimScene(boardAction: { action: string; label: string; testId?: string }): Scene {
    const claimScenes: Scene[] = [
      { title: "Pilih landmark", text: `${goal} Ketuk pin untuk melihat titik latihan.`, action: "pin", label: "Pilih landmark latihan" },
      { title: "Check-in di dekat titik", text: `Pin menunjukkan nama dan status landmark. Masuk ${range} untuk check-in dan membuka tantangan.`, action: "check", label: "Check-in latihan" },
      { title: "Baca petunjuk", text: "Papan latihan punya dua panah. Ada berapa arah yang bisa kamu pilih?", action: "answer", label: "Kirim jawaban" },
      { title: "Landmark terkunci!", text: `Jawaban tepat. Landmark ini jadi milikmu hingga ronde selesai. ${claimResult}`, ...boardAction },
    ];
    return claimScenes[step] ?? claimScenes[0];
  }

  function seekScene(
    clue: Clue | undefined,
    clueTitle: string,
    boardAction: { action: string; label: string; testId?: string },
  ): Scene {
    if (step === 0) {
      const headStart = formatTime(seek!.headStartMs ?? seek!.headStartMinutes * 60_000);
      const searchLimit = formatTime(seek!.searchLimitMs ?? seek!.searchLimitMinutes * 60_000);
      return {
        title: "Waktunya bersembunyi",
        text: `Penyembunyi punya ${headStart} untuk memilih stasiun sembunyi dan bersiap. Setelah itu pencari mendapat hingga ${searchLimit} untuk mencari.`,
        action: "next", label: "Mulai pencarian latihan",
      };
    }
    if (!clue) return {
      title: "Pencarian dimulai",
      text: "Pencari menelusuri papan dan menyelidiki titik yang mungkin. Setelah berganti peran, waktu sembunyi dibandingkan.",
      action: "ready", label: "Siap Main", testId: "practice-ready-btn",
    };
    if (step === 1) return {
      title: "Pencari · Pilih petunjuk", text: `Saat pencarian aktif, gunakan lokasimu untuk menyiapkan petunjuk. ${clue.prompt}`,
      action: "next", label: "Pratinjau " + clueTitle,
    };
    if (step === 2) return { title: "Pratinjau " + clueTitle, text: clue.preview, action: "next", label: "Kirim pertanyaan" };
    if (step === 3) {
      const deadline = family === "photo" ? seek!.photoResponseMs : seek!.objectiveResponseMs;
      return {
        title: "Menunggu jawaban",
        text: deadline
          ? `Penyembunyi menjawab sendiri dan boleh memakai waktu jawab hingga ${formatTime(deadline)}.`
          : "Penyembunyi menjawab sendiri dalam waktu yang disediakan edisi.",
        action: "next", label: "Mainkan sisi penyembunyi",
      };
    }
    if (step === 4) return {
      title: "Penyembunyi · Jawab " + clueTitle,
      text: `${clue.prompt} ${clue.sample}`,
      action: "answer", label: "Kirim jawaban",
    };
    return {
      title: family === "photo" ? "Foto diterima" : "Area pencarian menyempit",
      text: `${clue.result} Setelah berganti peran, waktu sembunyi akhir terlama menang.`, ...boardAction,
    };
  }

  function renderBoard(boardLastStep: number) {
    const finished = step === boardLastStep;
    const preview = seek && family && step >= 2 && family !== "photo";
    const overlay = preview ? `<div aria-hidden="true" class="ep-overlay ${family} ${finished ? "confirmed" : ""}"></div>` : "";
    const station = claim ? `<div class="ep-point ep-landmark">${step === 0
      ? button("pin", '<span aria-hidden="true">◆</span>', "ep-pin", 'aria-label="Pilih landmark latihan"')
      : `<span class="ep-pin-visual ${finished ? "locked" : ""}" aria-hidden="true">${finished ? "■" : "◆"}</span>`}
      <span class="ep-pin-caption">${finished ? "Terkunci" : "Landmark latihan"}</span>
    </div>` : '<span class="ep-point ep-reference" aria-hidden="true">A</span>';
    const second = seek && preview && (family === "thermometer" || family === "tentacles")
      ? '<span class="ep-point ep-reference ep-end" aria-hidden="true">B</span>' : "";
    const sampleHider = seek && step === 4 ? '<span class="ep-point ep-hider" aria-hidden="true">H</span>' : "";
    const label = !seek ? (finished ? "Landmark terkunci" : "Peta latihan") : !preview
      ? "Peta latihan" : finished ? "Deduksi diterapkan" : step === 2 ? "Pratinjau" : "Jawaban belum diterapkan";
    return `<div class="ep-board${near ? " nearby" : ""}" data-practice-map="${finished && preview ? "deduced" : preview ? "preview" : "board"}" role="region" aria-label="${label}">
      ${overlay}${mapLabel(label)}<span class="ep-track" aria-hidden="true"></span>
      ${claim ? '<span class="ep-position" aria-hidden="true"></span>' : ""}${station}${second}${sampleHider}
    </div>`;
  }

  function renderClueSwitcher() {
    if (!seek || families.length <= 1 || step < 1) return "";
    return `<div class="ep-clue-chips" role="group" aria-label="Pilih jenis petunjuk latihan" data-testid="practice-clue-switcher">
      ${families
        .map(
          (fam) =>
            `<button type="button" class="ep-clue-chip" data-practice-action="select-family" data-family="${fam}" aria-pressed="${fam === family}">${escapeText(clueNames[fam])}</button>`,
        )
        .join("")}
    </div>`;
  }

  function choices(optionsList: [string, string]) {
    return `<div class="ep-options" role="group" aria-label="Pilihan jawaban">${optionsList.map((label, index) =>
      button("choose", label, "secondary", `data-choice="${index}" aria-pressed="${choice === index}"`)).join("")}</div>`;
  }

  function evidence(clue: Clue | undefined) {
    if (claim && step === 2) {
      return `<div class="ep-sign" aria-label="Petunjuk latihan dengan dua panah"><span aria-hidden="true">←</span> Pintu barat <span aria-hidden="true">·</span> Pintu timur <span aria-hidden="true">→</span></div>` +
        choices(["Dua arah", "Tiga arah"]);
    }
    if (claim && step === 3) {
      const targets = claim.soloTargets;
      return `<p class="ep-score" role="status">${mode === "solo" && targets
        ? `1/${targets.lockedLandmarks} landmark terkunci · 1/${targets.distinctZones} zona`
        : "1 zona dikuasai · 1 landmark terkunci"}</p>`;
    }
    if (seek && family === "photo" && (step === 4 || step === 5)) {
      return `<figure class="ep-photo"><img src="${samplePhoto}" alt="Ilustrasi contoh dengan kereta dan tugu" width="800" height="550"><figcaption>Foto contoh</figcaption></figure>` +
        (step === 4 && clue ? choices(clue.choices) : "");
    }
    return seek && step === 4 && clue ? choices(clue.choices) : "";
  }

  function deckScene(
    deck: NonNullable<ReturnType<typeof practiceDeck>>,
    handCount: number,
    offersChoice: boolean,
    finalStep: number,
  ): Scene {
    if (step === finalStep) {
      const text = offersChoice ? "Kartu pilihanmu masuk ke tangan. Buka menu Kartu untuk melihatnya."
        : `${deck.source} Buka menu Kartu saat bermain untuk melihat kartu di tanganmu.`;
      return { title: deck.earns ? "Kartu di tangan" : "Contoh kartu", text, action: "ready", label: "Siap Main", testId: "practice-ready-btn" };
    }
    const limit = deck.keep > handCount ? ` Batas tangan ${deck.handLimit}. Dalam latihan ini, pilih langsung kartu yang masuk ke tangan.` : "";
    const deadline = deck.decisionMs ? ` Saat bermain, kamu punya hingga ${formatTime(deck.decisionMs)} untuk memilih.` : "";
    return {
      title: "Pilih kartu latihan",
      text: `${deck.source} Tarik ${deck.draw} kartu, simpan ${deck.keep}.${limit}${deadline}`,
      action: "confirm-cards", label: `Simpan ${handCount} kartu`,
    };
  }

  function deckEvidence(
    deck: NonNullable<ReturnType<typeof practiceDeck>>,
    handCount: number,
    offersChoice: boolean,
    finalStep: number,
  ) {
    const cards = deck.examples;
    if (step === finalStep) {
      const order = offersChoice ? [...selected].sort((a, b) => a - b) : Array.from({ length: handCount }, (_, index) => index);
      return `<div class="ep-cards ep-hand" role="region" aria-label="${deck.earns ? "Kartu latihan" : "Contoh kartu"}">
        ${order.map(index => practiceCardFace(cards[index % cards.length])).join("")}
      </div>`;
    }
    const start = cardPage * cardsPerPage;
    const cardCount = Math.min(cardsPerPage, deck.draw - start);
    const slots = Array.from({ length: cardCount }, (_, offset) => {
      const index = start + offset;
      const card = cards[index % cards.length];
      const pressed = selected.has(index);
      const data = `data-card="${index}"`;
      return revealed.has(index) ? `<div class="ep-card-slot${flipped === index ? " flipped" : ""}">
        ${practiceCardFace(card)}
        ${button("pick-card", pressed ? "Lepas" : "Pilih", "ep-card-select", `${data} aria-label="${pressed ? "Lepas" : "Pilih"} ${escapeText(card.title)}" aria-pressed="${pressed}" aria-disabled="${!pressed && selected.size === handCount}"`)}
      </div>` : button("flip-card", '<span aria-hidden="true">◆</span>', 'ep-card-back', `${data} aria-label="Balik kartu ${index + 1}"`);
    });
    return `<p class="ep-card-count" role="status">${selected.size}/${handCount} kartu dipilih</p>
      <div class="ep-cards${dealing ? " deal" : ""}" role="group" aria-label="Tawaran kartu">${slots.join("")}</div>
      ${deck.draw > cardsPerPage ? `<div class="ep-card-pages" role="group" aria-label="Halaman tawaran kartu">
        ${button("card-page", "‹ Sebelumnya", "secondary", `data-page="${cardPage - 1}" ${start === 0 ? "disabled" : ""}`)}
        ${button("card-page", "Berikutnya ›", "secondary", `data-page="${cardPage + 1}" ${start + cardsPerPage >= deck.draw ? "disabled" : ""}`)}
      </div>` : ""}`;
  }

  function render(focus?: string) {
    const state = activeLessonState();
    const { clue, clueTitle, deck, handCount, offersChoice, boardLastStep, finalStep, boardAction } = state;
    if (step > finalStep) step = finalStep;
    const inDeck = step > boardLastStep && Boolean(deck);
    const scene = inDeck && deck
      ? deckScene(deck, handCount, offersChoice, finalStep)
      : seek
        ? seekScene(clue, clueTitle, boardAction)
        : claimScene(boardAction);
    const role = seek && clue && step >= 1 ? (step === 4 || inDeck ? "Penyembunyi" : "Pencari") : "";
    const retry = claim && step === 1 && message ? button("approach", "Dekati titik latihan", "secondary") : "";
    const mainDisabled =
      (scene.action === "answer" && choice === null) ||
      (scene.action === "confirm-cards" && selected.size !== handCount);
    const mainExtra = `${mainDisabled ? "disabled" : ""}${scene.testId ? ` data-testid="${scene.testId}"` : ""}`;
    const mainAction = scene.action === "pin" ? "" : button(scene.action, scene.label, "primary", mainExtra.trim());
    const prevBtn = step > 0 ? button("prev", "← Sebelumnya", "secondary", 'data-testid="practice-prev-btn"') : "";
    const replayBtn = step === finalStep ? button("replay", "Ulangi latihan", "secondary") : "";
    const secondaryRow = prevBtn || replayBtn ? `<div class="ep-secondary-row">${prevBtn}${replayBtn}</div>` : "";
    const dotsHtml = Array.from(
      { length: finalStep + 1 },
      (_, idx) => `<span class="ep-dot${idx < step ? " done" : idx === step ? " active" : ""}"></span>`,
    ).join("");

    dialog.innerHTML = `<div class="ep-shell">
      <header class="ep-top">
        ${button("close", options?.fromRoom ? "‹ Kembali ke ruang" : "‹ Detail edisi", "ep-back")}
        ${button("skip", step === finalStep ? "Tutup" : "Lewati latihan", "ep-back")}
      </header>
      <div class="ep-title">
        <p>Latihan · ${escapeText(edition.title)} · v${edition.version}</p>
        <div class="ep-progress" data-testid="practice-progress" aria-label="Langkah ${step + 1} dari ${finalStep + 1}">
          <span class="ep-dots" aria-hidden="true">${dotsHtml}</span>
          <span class="ep-step-count">Langkah ${step + 1}/${finalStep + 1}${role ? " · " + role : ""}</span>
        </div>
      </div>
      ${inDeck ? "" : renderClueSwitcher()}
      ${inDeck ? "" : renderBoard(boardLastStep)}
      <section class="ep-scene" aria-labelledby="edition-practice-title">
        <h2 id="edition-practice-title" tabindex="-1">${scene.title}</h2>
        ${step === 0 ? `<p class="ep-player-count">${players}</p>` : ""}
        <p>${scene.text}</p>
        ${inDeck && deck ? deckEvidence(deck, handCount, offersChoice, finalStep) : evidence(clue)}
      </section>
      ${message ? `<div class="ep-toast"><span role="alert">${message}</span>
        ${button("dismiss", "×", "ep-back", 'aria-label="Tutup pemberitahuan"')}</div>` : ""}
      <div class="ep-actions">${retry}${mainAction}${secondaryRow}</div>
    </div>`;
    flipped = undefined;
    dealing = false;
    if (focus) dialog.querySelector<HTMLElement>(focus)?.focus({ preventScroll: true });
  }

  dialog.addEventListener("close", () => {
    lifetime.abort();
    dialog.replaceChildren();
    if (finishedViaReady && options?.onReady) {
      options.onReady();
      return;
    }
    if (focusReturn instanceof HTMLElement && focusReturn.isConnected) focusReturn.focus();
  }, { once: true, signal: lifetime.signal });

  dialog.addEventListener("click", event => {
    if (!(event.target instanceof Element)) return;
    const control = event.target.closest<HTMLButtonElement>("[data-practice-action]");
    if (!control || control.disabled || control.getAttribute("aria-disabled") === "true") return;
    const action = control.dataset.practiceAction;
    if (action === "close" || action === "finish" || action === "skip") {
      dialog.close();
      return;
    }
    if (action === "ready") {
      finishedViaReady = true;
      dialog.close();
      return;
    }
    let focus = "#edition-practice-title";
    if (action === "select-family") {
      const nextFamily = control.dataset.family as HideSeekQuestionFamily | undefined;
      if (nextFamily && families.includes(nextFamily)) {
        family = nextFamily;
        step = 1;
        choice = null;
        message = "";
        cardPage = 0;
        revealed.clear();
        selected.clear();
        focus = `[data-practice-action="select-family"][data-family="${nextFamily}"]`;
      }
      render(focus);
      return;
    }
    if (action === "prev") {
      step = Math.max(0, step - 1);
      choice = null;
      message = "";
      render(focus);
      return;
    }
    if (action === "choose") {
      choice = Number(control.dataset.choice);
      dialog.querySelectorAll<HTMLButtonElement>('[data-practice-action="choose"]').forEach(option =>
        option.setAttribute("aria-pressed", String(option === control)));
      const submit = dialog.querySelector<HTMLButtonElement>('[data-practice-action="answer"]');
      if (submit) submit.disabled = false;
      return;
    }
    if (action === "flip-card" || action === "pick-card") {
      const index = Number(control.dataset.card);
      if (action === "flip-card") {
        flipped = index;
        revealed.add(index);
      } else if (selected.has(index)) selected.delete(index);
      else selected.add(index);
      focus = `[data-card="${index}"]`;
    } else if (action === "card-page") {
      cardPage = Number(control.dataset.page);
      focus = `[data-card="${cardPage * cardsPerPage}"]`;
    } else if (action === "replay") {
      step = 0;
      near = false;
      choice = null;
      message = "";
      cardPage = 0;
      revealed.clear();
      selected.clear();
    } else if (action === "dismiss") {
      message = "";
      focus = claim && step === 1 ? '[data-practice-action="check"]' : '[data-practice-action="answer"]';
    } else if (action === "approach") {
      near = true;
      message = "";
      focus = '[data-practice-action="check"]';
    } else if (action === "check" && !near) {
      message = "Kamu masih terlalu jauh dari titik ini. Dekati titiknya, lalu coba lagi.";
      focus = '[data-practice-action="check"]';
    } else if (action === "answer" && choice !== 0) {
      message = claim ? "Hitung kembali panah pada papan latihan." : "Periksa posisi atau bukti latihan, lalu pilih jawaban lagi.";
      focus = '[data-practice-action="answer"]';
    } else {
      step++;
      dealing = action === "open-deck";
      choice = null;
      message = "";
    }
    render(focus);
  }, { signal: lifetime.signal });

  render();
  dialog.showModal();
  dialog.querySelector<HTMLElement>("#edition-practice-title")?.focus();
}
