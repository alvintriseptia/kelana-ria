import type { HideSeekQuestionFamily, RulebookPlayMode } from "@kelana-ria/contracts";
import type { CatalogEdition } from "./rulebook-catalog";
import { escapeText } from "./escape-text";
import samplePhoto from "./assets/jakarta.webp";
import "./edition-practice.css";

type Scene = {
  title: string;
  text: string;
  action: string;
  label: string;
};

type Clue = {
  title: string;
  prompt: string;
  preview: string;
  choices: [string, string];
  sample: string;
  result: string;
};

const clues: Record<HideSeekQuestionFamily, Clue> = {
  radar: {
    title: "Radar",
    prompt: "Apakah kamu berada di dalam lingkaran Radar?",
    preview: "Lingkaran ini menunjukkan jangkauan Radar. Kirim pertanyaan untuk tahu apakah penyembunyi ada di dalamnya.",
    choices: ["Ya, di dalam", "Tidak, di luar"],
    sample: "Titik sembunyi latihan ada di dalam lingkaran.",
    result: "Jawaban menunjukkan penyembunyi ada di dalam Radar. Area di luar lingkaran tersisih.",
  },
  thermometer: {
    title: "Termometer",
    prompt: "Apakah titik B lebih dekat ke tempat sembunyimu dibanding titik A?",
    preview: "A dan B adalah dua posisi pencari. Periksa jalurnya sebelum meminta perbandingan jarak.",
    choices: ["Lebih hangat", "Lebih dingin"],
    sample: "Titik B lebih dekat ke tempat sembunyi latihan.",
    result: "Lebih hangat berarti titik B lebih dekat. Area yang lebih dekat ke A tersisih.",
  },
  matching: {
    title: "Pencocokan",
    prompt: "Apakah kita berada di area yang sama?",
    preview: "Periksa area tempat pencari berada. Jawaban akan menunjukkan apakah area penyembunyi cocok.",
    choices: ["Ya, sama", "Tidak, berbeda"],
    sample: "Pencari dan titik sembunyi latihan ada di area yang sama.",
    result: "Keduanya berada di area yang sama. Pencarian bisa difokuskan ke area pencari.",
  },
  measuring: {
    title: "Pengukuran",
    prompt: "Apakah kamu lebih dekat ke landmark acuan daripada aku?",
    preview: "Lingkaran mengacu pada jarak pencari ke landmark. Jawaban membandingkannya dengan jarak penyembunyi.",
    choices: ["Ya, lebih dekat", "Tidak, lebih jauh"],
    sample: "Titik sembunyi latihan lebih dekat ke landmark daripada posisi pencari.",
    result: "Penyembunyi lebih dekat ke landmark. Cari di dalam batas jarak pencari.",
  },
  tentacles: {
    title: "Tentakel",
    prompt: "Taman mana yang paling dekat dengan tempat sembunyimu?",
    preview: "Periksa dua taman latihan di dalam jangkauan pertanyaan.",
    choices: ["Taman A", "Taman B"],
    sample: "Titik sembunyi latihan lebih dekat ke Taman A.",
    result: "Taman A paling dekat. Peta menandai area yang lebih dekat ke Taman A.",
  },
  photo: {
    title: "Foto",
    prompt: "Kirim foto sesuatu yang terlihat dari tempat sembunyi.",
    preview: "Periksa isi permintaan sebelum mengirimnya ke penyembunyi.",
    choices: ["Kirim foto contoh", "Batal mengirim"],
    sample: "Gunakan foto contoh untuk berlatih mengirim bukti.",
    result: "Foto sudah diterima. Pencari menggunakan petunjuk dalam foto untuk memilih tempat berikutnya.",
  },
};

function firstClue(edition: CatalogEdition): HideSeekQuestionFamily | undefined {
  if (edition.format !== "hide-and-seek") return undefined;
  const enabled = new Set((edition.questionFamilies ?? []).map(item => item.family));
  return (Object.keys(clues) as HideSeekQuestionFamily[]).find(family => enabled.has(family));
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

export function mountEditionPractice(dialog: HTMLDialogElement, edition: CatalogEdition, mode: RulebookPlayMode) {
  const lifetime = new AbortController();
  const seek = edition.format === "hide-and-seek" ? edition : undefined;
  const claim = edition.format === "claim-the-city" ? edition : undefined;
  const family = firstClue(edition);
  const clue = family ? clues[family] : undefined;
  const finalStep = seek ? (clue ? 5 : 1) : 3;
  const focusReturn = document.activeElement;
  let step = 0;
  let near = false;
  let choice: number | null = null;
  let message = "";

  dialog.className = "ep-dialog";
  dialog.setAttribute("aria-labelledby", "edition-practice-title");
  const range = claim?.checkInRadiusMeters
    ? `dalam radius ${claim.checkInRadiusMeters} meter`
    : "dalam radius landmark";
  const goal = claim && mode === "solo" && claim.soloTargets
    ? `Kunci ${claim.soloTargets.lockedLandmarks} landmark di setidaknya ${claim.soloTargets.distinctZones} zona dalam ${claim.durationMinutes} menit.`
    : claim ? `Kuasai zona terbanyak dalam ${claim.durationMinutes} menit. Jika seri, bandingkan landmark terkunci lalu total landmark.` : "";
  const claimScenes: Scene[] = [
    { title: "Pilih landmark", text: `${goal} Ketuk pin untuk melihat titik latihan.`, action: "pin", label: "Pilih landmark latihan" },
    { title: "Check-in di dekat titik", text: `Check-in berhasil ${range}. Setelah itu kamu bisa membuka tantangan.`, action: "check", label: "Check-in latihan" },
    { title: "Baca petunjuk", text: "Papan latihan punya dua panah. Ada berapa arah yang bisa kamu pilih?", action: "answer", label: "Kirim jawaban" },
    { title: "Landmark terkunci!", text: "Jawaban tepat. Pin berubah bentuk dan landmark menambah progres zonamu.", action: "finish", label: "Kembali ke edisi" },
  ];

  function seekScene(): Scene {
    if (step === 0) return {
      title: "Waktunya bersembunyi",
      text: `Penyembunyi punya ${seek!.headStartMinutes} menit untuk bersiap. Setelah itu pencari mendapat hingga ${seek!.searchLimitMinutes} menit untuk mencari.`,
      action: "next", label: "Mulai pencarian latihan",
    };
    if (!clue) return {
      title: "Pencarian dimulai",
      text: "Pencari menelusuri papan dan menyelidiki titik yang mungkin. Setelah berganti peran, waktu sembunyi dibandingkan.",
      action: "finish", label: "Kembali ke edisi",
    };
    if (step === 1) return { title: "Pencari · Pilih petunjuk", text: clue.prompt, action: "next", label: "Pratinjau " + clue.title };
    if (step === 2) return { title: "Pratinjau " + clue.title, text: clue.preview, action: "next", label: "Kirim pertanyaan" };
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
      title: "Penyembunyi · Jawab " + clue.title,
      text: `${clue.prompt} ${clue.sample}`,
      action: "answer", label: "Kirim jawaban",
    };
    return {
      title: family === "photo" ? "Foto diterima" : "Area pencarian menyempit",
      text: clue.result, action: "finish", label: "Kembali ke edisi",
    };
  }

  function renderBoard() {
    const finished = step === finalStep;
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

  function choices(options: [string, string]) {
    return `<div class="ep-options" role="group" aria-label="Pilihan jawaban">${options.map((label, index) =>
      button("choose", label, "secondary", `data-choice="${index}" aria-pressed="${choice === index}"`)).join("")}</div>`;
  }

  function evidence() {
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

  function render(focus?: string) {
    const scene = seek ? seekScene() : claimScenes[step];
    const role = seek && clue && step >= 1 ? (step === 4 ? "Penyembunyi" : "Pencari") : "";
    const retry = claim && step === 1 && message ? button("approach", "Dekati titik latihan", "secondary") : "";
    const mainAction = scene.action === "pin" ? "" : button(scene.action, scene.label, "primary",
      scene.action === "answer" && choice === null ? "disabled" : "");
    dialog.innerHTML = `<div class="ep-shell">
      <header class="ep-top">
        ${button("close", "‹ Detail edisi", "ep-back")}
        ${button("skip", step === finalStep ? "Tutup" : "Lewati latihan", "ep-back")}
      </header>
      <div class="ep-title">
        <p>Latihan · ${escapeText(edition.title)} · v${edition.version}</p>
        <p aria-label="Langkah ${step + 1} dari ${finalStep + 1}">${step + 1}/${finalStep + 1}${role ? " · " + role : ""}</p>
      </div>
      ${renderBoard()}
      <section class="ep-scene" aria-labelledby="edition-practice-title">
        <h2 id="edition-practice-title" tabindex="-1">${scene.title}</h2>
        <p>${scene.text}</p>
        ${evidence()}
      </section>
      ${message ? `<div class="ep-toast"><span role="alert">${message}</span>
        ${button("dismiss", "×", "ep-back", 'aria-label="Tutup pemberitahuan"')}</div>` : ""}
      <div class="ep-actions">${retry}${mainAction}${step === finalStep ? button("replay", "Ulangi latihan", "secondary") : ""}</div>
    </div>`;
    if (focus) dialog.querySelector<HTMLElement>(focus)?.focus({ preventScroll: true });
  }

  dialog.addEventListener("close", () => {
    lifetime.abort();
    dialog.replaceChildren();
    if (focusReturn instanceof HTMLElement && focusReturn.isConnected) focusReturn.focus();
  }, { once: true, signal: lifetime.signal });

  dialog.addEventListener("click", event => {
    if (!(event.target instanceof Element)) return;
    const control = event.target.closest<HTMLButtonElement>("[data-practice-action]");
    if (!control || control.disabled) return;
    const action = control.dataset.practiceAction;
    if (action === "close" || action === "finish" || action === "skip") {
      dialog.close();
      return;
    }
    let focus = "#edition-practice-title";
    if (action === "choose") {
      choice = Number(control.dataset.choice);
      dialog.querySelectorAll<HTMLButtonElement>('[data-practice-action="choose"]').forEach(option =>
        option.setAttribute("aria-pressed", String(option === control)));
      const submit = dialog.querySelector<HTMLButtonElement>('[data-practice-action="answer"]');
      if (submit) submit.disabled = false;
      return;
    }
    if (action === "replay") {
      step = 0;
      near = false;
      choice = null;
      message = "";
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
      choice = null;
      message = "";
    }
    render(focus);
  }, { signal: lifetime.signal });

  render();
  dialog.showModal();
  dialog.querySelector<HTMLElement>("#edition-practice-title")?.focus();
}
