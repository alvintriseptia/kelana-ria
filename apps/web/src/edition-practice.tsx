import type { HideSeekQuestionFamily, RulebookPlayMode } from "@kelana-ria/contracts";
import { useSignal } from "@preact/signals";
import { render } from "preact";
import { useEffect, useRef } from "preact/hooks";
import {
  cardKindNames,
  clueNames,
  playerRange,
  type CatalogEdition,
  type PracticeCardExample,
} from "./rulebook-catalog";
import {
  animateCardDeal,
  animateCardFlip,
  animatePop,
  animateShake,
  animateSheetIn,
  attachPress,
} from "./game-motion";
import { practiceDeck } from "./edition-practice-deck";
import { questionRepeatRules } from "./seek/types";
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
    preview:
      "Lingkaran ini menunjukkan jangkauan Radar. Kirim pertanyaan untuk tahu apakah penyembunyi ada di dalamnya.",
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
    preview:
      "Lingkaran mengacu pada jarak pencari ke landmark. Jawaban membandingkannya dengan jarak penyembunyi.",
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
    result:
      "Foto sudah diterima. Pencari menggunakan petunjuk dalam foto untuk memilih tempat berikutnya.",
  },
};
const cardsPerPage = 4;

function enabledClueFamilies(edition: CatalogEdition): HideSeekQuestionFamily[] {
  if (edition.format !== "hide-and-seek") return [];
  const enabled = new Set((edition.questionFamilies ?? []).map((item) => item.family));
  return (Object.keys(clues) as HideSeekQuestionFamily[]).filter((family) => enabled.has(family));
}

function formatTime(milliseconds: number) {
  const seconds = Math.ceil(milliseconds / 1000);
  if (seconds < 60) return `${seconds} detik`;
  const minutes = Math.floor(seconds / 60);
  return seconds % 60 ? `${minutes} menit ${seconds % 60} detik` : `${minutes} menit`;
}

function PracticeCardFace({ card }: { card: PracticeCardExample }) {
  return (
    <div class={`ep-card-face ${card.kind}`}>
      <span class="ep-card-mark" aria-hidden="true">
        {card.kind === "time_bonus" ? "◷" : card.kind === "curse" ? "✦" : "◆"}
      </span>
      <small>{cardKindNames[card.kind]}</small>
      <strong>{card.title}</strong>
      <p>{card.description}</p>
    </div>
  );
}

function EditionPracticeView({
  dialog,
  edition,
  mode,
  options,
  onMarkReady,
}: {
  dialog: HTMLDialogElement;
  edition: CatalogEdition;
  mode: RulebookPlayMode;
  options?: PracticeOptions;
  onMarkReady: () => void;
}) {
  const seek = edition.format === "hide-and-seek" ? edition : undefined;
  const claim = edition.format === "claim-the-city" ? edition : undefined;
  const families = enabledClueFamilies(edition);

  const familySig = useSignal<HideSeekQuestionFamily | undefined>(families[0]);
  const stepSig = useSignal(0);
  const nearSig = useSignal(false);
  const choiceSig = useSignal<number | null>(null);
  const messageSig = useSignal("");
  const cardPageSig = useSignal(0);
  const flippedSig = useSignal<number | undefined>(undefined);
  const dealingSig = useSignal(false);
  const revealedSig = useSignal<number[]>([]);
  const selectedSig = useSignal<number[]>([]);

  const titleRef = useRef<HTMLHeadingElement | null>(null);
  const shellRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<HTMLElement | null>(null);
  const dotsRef = useRef<HTMLSpanElement | null>(null);
  const boardRef = useRef<HTMLDivElement | null>(null);
  const cardsRef = useRef<HTMLDivElement | null>(null);
  const toastRef = useRef<HTMLDivElement | null>(null);
  const hasMountedRef = useRef(false);
  const lastSelectedCardRef = useRef<number | null>(null);

  useEffect(() => {
    titleRef.current?.focus();
    const stopIn = animateSheetIn(shellRef.current, { offsetY: 14, fromScale: 0.97, preset: "sheet" });
    hasMountedRef.current = true;
    return stopIn;
  }, []);

  const focusSelector = (selector: string) => {
    queueMicrotask(() => {
      dialog.querySelector<HTMLElement>(selector)?.focus({ preventScroll: true });
    });
  };

  const range = claim?.checkInRadiusMeters
    ? `dalam radius ${claim.checkInRadiusMeters} meter`
    : "dalam radius landmark";
  const players =
    mode === "solo"
      ? "1 pemain · Solo"
      : playerRange(Math.max(2, edition.minPlayers), edition.maxPlayers);
  const duration = claim ? formatTime(claim.durationMs ?? claim.durationMinutes * 60_000) : "";
  const goal =
    claim && mode === "solo" && claim.soloTargets
      ? `Kunci ${claim.soloTargets.lockedLandmarks} landmark di setidaknya ${claim.soloTargets.distinctZones} zona dalam ${duration}.`
      : `Kuasai zona terbanyak dalam ${duration}. Jika seri, bandingkan landmark terkunci lalu total landmark.`;
  const weights =
    claim?.claimWeight !== undefined && claim.lockWeight !== undefined
      ? ` Klaim berbobot ${claim.claimWeight} dan kunci berbobot ${claim.lockWeight}.`
      : "";
  const claimResultText =
    mode === "solo"
      ? "Landmark ini menambah progresmu."
      : `Tim dengan bobot landmark tertinggi menguasai zona.${weights}`;

  const family = familySig.value;
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

  const step = Math.min(stepSig.value, finalStep);
  const inDeck = step > boardLastStep && Boolean(deck);
  const revealedSet = new Set(revealedSig.value);
  const selectedSet = new Set(selectedSig.value);

  function getScene(): Scene {
    if (inDeck && deck) {
      if (step === finalStep) {
        const text = offersChoice
          ? "Kartu pilihanmu masuk ke tangan. Buka menu Kartu untuk melihatnya."
          : `${deck.source} Buka menu Kartu saat bermain untuk melihat kartu di tanganmu.`;
        return {
          title: deck.earns ? "Kartu di tangan" : "Contoh kartu",
          text,
          action: "ready",
          label: "Siap Main",
          testId: "practice-ready-btn",
        };
      }
      const limit =
        deck.keep > handCount
          ? ` Batas tangan ${deck.handLimit}. Dalam latihan ini, pilih langsung kartu yang masuk ke tangan.`
          : "";
      const deadline = deck.decisionMs
        ? ` Saat bermain, kamu punya hingga ${formatTime(deck.decisionMs)} untuk memilih.`
        : "";
      return {
        title: "Pilih kartu latihan",
        text: `${deck.source} Tarik ${deck.draw} kartu, simpan ${deck.keep}.${limit}${deadline}`,
        action: "confirm-cards",
        label: `Simpan ${handCount} kartu`,
      };
    }

    if (seek) {
      if (step === 0) {
        const headStart = formatTime(seek.headStartMs ?? seek.headStartMinutes * 60_000);
        const searchLimit = formatTime(seek.searchLimitMs ?? seek.searchLimitMinutes * 60_000);
        return {
          title: "Waktunya bersembunyi",
          text: `Penyembunyi punya ${headStart} untuk memilih stasiun sembunyi dan bersiap. Setelah itu pencari mendapat hingga ${searchLimit} untuk mencari.`,
          action: "next",
          label: "Mulai pencarian latihan",
        };
      }
      if (!clue) {
        return {
          title: "Pencarian dimulai",
          text: "Pencari menelusuri papan dan menyelidiki titik yang mungkin. Setelah berganti peran, waktu sembunyi dibandingkan.",
          action: "ready",
          label: "Siap Main",
          testId: "practice-ready-btn",
        };
      }
      if (step === 1) {
        return {
          title: "Pencari · Pilih petunjuk",
          text: `Gunakan lokasimu untuk menyiapkan petunjuk. ${questionRepeatRules[seek.repeatCostMode]} ${clue.prompt}`,
          action: "next",
          label: "Pratinjau " + clueTitle,
        };
      }
      if (step === 2) {
        return {
          title: "Pratinjau " + clueTitle,
          text: clue.preview,
          action: "next",
          label: "Kirim pertanyaan",
        };
      }
      if (step === 3) {
        const deadline = family === "photo" ? seek.photoResponseMs : seek.objectiveResponseMs;
        return {
          title: "Menunggu jawaban",
          text: deadline
            ? `Penyembunyi menjawab sendiri dan boleh memakai waktu jawab hingga ${formatTime(deadline)}.`
            : "Penyembunyi menjawab sendiri dalam waktu yang disediakan edisi.",
          action: "next",
          label: "Mainkan sisi penyembunyi",
        };
      }
      if (step === 4) {
        return {
          title: "Penyembunyi · Jawab " + clueTitle,
          text: `${clue.prompt} ${clue.sample}`,
          action: "answer",
          label: "Kirim jawaban",
        };
      }
      return {
        title: family === "photo" ? "Foto diterima" : "Area pencarian menyempit",
        text: `${clue.result} Setelah berganti peran, waktu sembunyi akhir terlama menang.`,
        ...boardAction,
      };
    }

    const claimScenes: Scene[] = [
      {
        title: "Pilih landmark",
        text: `${goal} Ketuk pin untuk melihat titik latihan.`,
        action: "pin",
        label: "Pilih landmark latihan",
      },
      {
        title: "Check-in di dekat titik",
        text: `Pin menunjukkan nama dan status landmark. Masuk ${range} untuk check-in dan membuka tantangan.`,
        action: "check",
        label: "Check-in latihan",
      },
      {
        title: "Baca petunjuk",
        text: "Papan latihan punya dua panah. Ada berapa arah yang bisa kamu pilih?",
        action: "answer",
        label: "Kirim jawaban",
      },
      {
        title: "Landmark terkunci!",
        text: `Jawaban tepat. Landmark ini jadi milikmu hingga ronde selesai. ${claimResultText}`,
        ...boardAction,
      },
    ];
    return claimScenes[step] ?? claimScenes[0];
  }

  const scene = getScene();
  const role = seek && clue && step >= 1 ? (step === 4 || inDeck ? "Penyembunyi" : "Pencari") : "";
  const mainDisabled =
    (scene.action === "answer" && choiceSig.value === null) ||
    (scene.action === "confirm-cards" && selectedSet.size !== handCount);

  function handleAction(action: string) {
    if (action === "close" || action === "finish" || action === "skip") {
      dialog.close();
      return;
    }
    if (action === "ready") {
      onMarkReady();
      dialog.close();
      return;
    }
    flippedSig.value = undefined;
    dealingSig.value = false;

    if (action === "prev") {
      stepSig.value = Math.max(0, step - 1);
      choiceSig.value = null;
      messageSig.value = "";
      focusSelector("#edition-practice-title");
      return;
    }
    if (action === "replay") {
      stepSig.value = 0;
      nearSig.value = false;
      choiceSig.value = null;
      messageSig.value = "";
      cardPageSig.value = 0;
      revealedSig.value = [];
      selectedSig.value = [];
      focusSelector("#edition-practice-title");
      return;
    }
    if (action === "dismiss") {
      messageSig.value = "";
      focusSelector(
        claim && step === 1 ? '[data-practice-action="check"]' : '[data-practice-action="answer"]',
      );
      return;
    }
    if (action === "approach") {
      nearSig.value = true;
      messageSig.value = "";
      focusSelector('[data-practice-action="check"]');
      return;
    }
    if (action === "check" && !nearSig.value) {
      messageSig.value = "Kamu masih terlalu jauh dari titik ini. Dekati titiknya, lalu coba lagi.";
      focusSelector('[data-practice-action="check"]');
      return;
    }
    if (action === "answer" && choiceSig.value !== 0) {
      messageSig.value = claim
        ? "Hitung kembali panah pada papan latihan."
        : "Periksa posisi atau bukti latihan, lalu pilih jawaban lagi.";
      focusSelector('[data-practice-action="answer"]');
      return;
    }
    stepSig.value = step + 1;
    dealingSig.value = action === "open-deck";
    choiceSig.value = null;
    messageSig.value = "";
    focusSelector("#edition-practice-title");
  }

  const finished = step === boardLastStep;
  const preview = Boolean(seek && family && step >= 2 && family !== "photo");
  const boardLabel = !seek
    ? finished
      ? "Landmark terkunci"
      : "Peta latihan"
    : !preview
      ? "Peta latihan"
      : finished
        ? "Deduksi diterapkan"
        : step === 2
          ? "Pratinjau"
          : "Jawaban belum diterapkan";

  const renderChoices = (optionsList: [string, string]) => (
    <div class="ep-options" role="group" aria-label="Pilihan jawaban">
      {optionsList.map((label, index) => (
        <button
          key={label}
          type="button"
          class="secondary"
          data-practice-action="choose"
          data-choice={index}
          aria-pressed={choiceSig.value === index}
          onClick={() => {
            choiceSig.value = index;
          }}
        >
          {label}
        </button>
      ))}
    </div>
  );

  const renderDeckEvidence = () => {
    if (!deck) return null;
    const cards = deck.examples;
    if (step === finalStep) {
      const order = offersChoice
        ? [...selectedSig.value].sort((a, b) => a - b)
        : Array.from({ length: handCount }, (_, idx) => idx);
      return (
        <div
          ref={cardsRef}
          class="ep-cards ep-hand"
          role="region"
          aria-label={deck.earns ? "Kartu latihan" : "Contoh kartu"}
        >
          {order.map((index) => (
            <PracticeCardFace key={index} card={cards[index % cards.length]} />
          ))}
        </div>
      );
    }
    const start = cardPageSig.value * cardsPerPage;
    const cardCount = Math.min(cardsPerPage, deck.draw - start);
    return (
      <>
        <p class="ep-card-count" role="status">
          {selectedSet.size}/{handCount} kartu dipilih
        </p>
        <div
          ref={cardsRef}
          class={`ep-cards${dealingSig.value ? " deal" : ""}`}
          role="group"
          aria-label="Tawaran kartu"
        >
          {Array.from({ length: cardCount }, (_, offset) => {
            const index = start + offset;
            const card = cards[index % cards.length];
            const pressed = selectedSet.has(index);
            const isOverLimit = !pressed && selectedSet.size === handCount;
            if (revealedSet.has(index)) {
              return (
                <div
                  key={index}
                  data-card-slot={index}
                  class={`ep-card-slot${flippedSig.value === index ? " flipped" : ""}`}
                >
                  <PracticeCardFace card={card} />
                  <button
                    type="button"
                    class="ep-card-select"
                    data-practice-action="pick-card"
                    data-card={index}
                    aria-label={`${pressed ? "Lepas" : "Pilih"} ${card.title}`}
                    aria-pressed={pressed}
                    aria-disabled={isOverLimit}
                    onClick={() => {
                      if (isOverLimit) return;
                      flippedSig.value = undefined;
                      dealingSig.value = false;
                      const next = new Set(selectedSig.value);
                      if (next.has(index)) {
                        next.delete(index);
                        lastSelectedCardRef.current = null;
                      } else {
                        next.add(index);
                        lastSelectedCardRef.current = index;
                      }
                      selectedSig.value = [...next];
                      focusSelector(`[data-card="${index}"]`);
                    }}
                  >
                    {pressed ? "Lepas" : "Pilih"}
                  </button>
                </div>
              );
            }
            return (
              <button
                key={index}
                type="button"
                class="ep-card-back"
                data-practice-action="flip-card"
                data-card={index}
                aria-label={`Balik kartu ${index + 1}`}
                onClick={() => {
                  flippedSig.value = index;
                  dealingSig.value = false;
                  const next = new Set(revealedSig.value);
                  next.add(index);
                  revealedSig.value = [...next];
                  focusSelector(`[data-card="${index}"]`);
                }}
              >
                <span aria-hidden="true">◆</span>
              </button>
            );
          })}
        </div>
        {deck.draw > cardsPerPage && (
          <div class="ep-card-pages" role="group" aria-label="Halaman tawaran kartu">
            <button
              type="button"
              class="secondary"
              data-practice-action="card-page"
              data-page={cardPageSig.value - 1}
              disabled={start === 0}
              onClick={() => {
                const nextPage = cardPageSig.value - 1;
                cardPageSig.value = nextPage;
                focusSelector(`[data-card="${nextPage * cardsPerPage}"]`);
              }}
            >
              ‹ Sebelumnya
            </button>
            <button
              type="button"
              class="secondary"
              data-practice-action="card-page"
              data-page={cardPageSig.value + 1}
              disabled={start + cardsPerPage >= deck.draw}
              onClick={() => {
                const nextPage = cardPageSig.value + 1;
                cardPageSig.value = nextPage;
                focusSelector(`[data-card="${nextPage * cardsPerPage}"]`);
              }}
            >
              Berikutnya ›
            </button>
          </div>
        )}
      </>
    );
  };

  useEffect(() => {
    const buttons = shellRef.current?.querySelectorAll(
      ".ep-actions button, .ep-options button, .ep-clue-chip, .ep-card-back, .ep-card-select, .ep-pin",
    );
    return attachPress(buttons, { scale: 0.96, preset: "snappy" });
  }, [step, family, inDeck, cardPageSig.value, revealedSig.value.length]);

  useEffect(() => {
    if (!hasMountedRef.current) return;
    const stopScene = animateSheetIn(sceneRef.current, {
      offsetY: 8,
      fromScale: 0.99,
      preset: "snappy",
    });
    const activeDot = dotsRef.current?.querySelector<HTMLElement>(".ep-dot.active");
    const stopDot = animatePop(activeDot, { fromScale: 0.72, preset: "bouncy" });
    return () => {
      stopScene();
      stopDot();
    };
  }, [step, family]);

  useEffect(() => {
    if (!hasMountedRef.current || !family) return;
    const chip = shellRef.current?.querySelector<HTMLElement>(
      `.ep-clue-chip[data-family="${family}"]`,
    );
    return animatePop(chip, { fromScale: 0.9, preset: "snappy" });
  }, [family]);

  useEffect(() => {
    if (inDeck) return;
    const overlay = boardRef.current?.querySelector<HTMLElement>(".ep-overlay");
    const lockedPin = boardRef.current?.querySelector<HTMLElement>(".ep-pin-visual.locked");
    const stopOverlay = overlay
      ? animatePop(overlay, { fromScale: 0.92, preset: "tactile" })
      : () => undefined;
    const stopPin = lockedPin
      ? animatePop(lockedPin, { fromScale: 0.72, preset: "bouncy" })
      : () => undefined;
    return () => {
      stopOverlay();
      stopPin();
    };
  }, [inDeck, preview, finished, family]);

  useEffect(() => {
    if (!inDeck || !cardsRef.current) return;
    if (!dealingSig.value && step !== finalStep) return;
    return animateCardDeal(cardsRef.current.children);
  }, [inDeck, dealingSig.value, step, finalStep, cardPageSig.value]);

  useEffect(() => {
    const idx = flippedSig.value;
    if (idx === undefined || !cardsRef.current) return;
    const face = cardsRef.current.querySelector<HTMLElement>(
      `[data-card-slot="${idx}"] .ep-card-face`,
    );
    return animateCardFlip(face);
  }, [flippedSig.value]);

  useEffect(() => {
    const picked = lastSelectedCardRef.current;
    if (picked === null || !cardsRef.current) return;
    lastSelectedCardRef.current = null;
    const slot = cardsRef.current.querySelector<HTMLElement>(`[data-card-slot="${picked}"]`);
    return animatePop(slot, { fromScale: 0.94, preset: "snappy" });
  }, [selectedSig.value]);

  useEffect(() => {
    if (!messageSig.value) return;
    return animateShake(toastRef.current);
  }, [messageSig.value]);

  return (
    <div ref={shellRef} class="ep-shell">
      <header class="ep-top">
        <button
          type="button"
          class="ep-back"
          data-practice-action="close"
          onClick={() => handleAction("close")}
        >
          {options?.fromRoom ? "‹ Kembali ke ruang" : "‹ Detail edisi"}
        </button>
        <button
          type="button"
          class="ep-back"
          data-practice-action="skip"
          onClick={() => handleAction("skip")}
        >
          {step === finalStep ? "Tutup" : "Lewati latihan"}
        </button>
      </header>

      <div class="ep-title">
        <p>
          Latihan · {edition.title} · v{edition.version}
        </p>
        <div
          class="ep-progress"
          data-testid="practice-progress"
          aria-label={`Langkah ${step + 1} dari ${finalStep + 1}`}
        >
          <span ref={dotsRef} class="ep-dots" aria-hidden="true">
            {Array.from({ length: finalStep + 1 }, (_, idx) => (
              <span
                key={idx}
                class={`ep-dot${idx < step ? " done" : idx === step ? " active" : ""}`}
              />
            ))}
          </span>
          <span class="ep-step-count">
            Langkah {step + 1}/{finalStep + 1}
            {role ? ` · ${role}` : ""}
          </span>
        </div>
      </div>

      {!inDeck && seek && families.length > 1 && step >= 1 && (
        <div
          class="ep-clue-chips"
          role="group"
          aria-label="Pilih jenis petunjuk latihan"
          data-testid="practice-clue-switcher"
        >
          {families.map((fam) => (
            <button
              key={fam}
              type="button"
              class="ep-clue-chip"
              data-practice-action="select-family"
              data-family={fam}
              aria-pressed={fam === family}
              onClick={() => {
                familySig.value = fam;
                stepSig.value = 1;
                choiceSig.value = null;
                messageSig.value = "";
                cardPageSig.value = 0;
                revealedSig.value = [];
                selectedSig.value = [];
                focusSelector(`[data-practice-action="select-family"][data-family="${fam}"]`);
              }}
            >
              {clueNames[fam]}
            </button>
          ))}
        </div>
      )}

      {!inDeck && (
        <div
          ref={boardRef}
          class={`ep-board${nearSig.value ? " nearby" : ""}`}
          data-practice-map={finished && preview ? "deduced" : preview ? "preview" : "board"}
          role="region"
          aria-label={boardLabel}
        >
          {preview && family && (
            <div aria-hidden="true" class={`ep-overlay ${family} ${finished ? "confirmed" : ""}`} />
          )}
          <span class="ep-map-label">{boardLabel}</span>
          <span class="ep-track" aria-hidden="true" />
          {claim && <span class="ep-position" aria-hidden="true" />}
          {claim ? (
            <div class="ep-point ep-landmark">
              {step === 0 ? (
                <button
                  type="button"
                  class="ep-pin"
                  data-practice-action="pin"
                  aria-label="Pilih landmark latihan"
                  onClick={() => handleAction("pin")}
                >
                  <span aria-hidden="true">◆</span>
                </button>
              ) : (
                <span class={`ep-pin-visual ${finished ? "locked" : ""}`} aria-hidden="true">
                  {finished ? "■" : "◆"}
                </span>
              )}
              <span class="ep-pin-caption">{finished ? "Terkunci" : "Landmark latihan"}</span>
            </div>
          ) : (
            <span class="ep-point ep-reference" aria-hidden="true">
              A
            </span>
          )}
          {seek && preview && (family === "thermometer" || family === "tentacles") && (
            <span class="ep-point ep-reference ep-end" aria-hidden="true">
              B
            </span>
          )}
          {seek && step === 4 && (
            <span class="ep-point ep-hider" aria-hidden="true">
              H
            </span>
          )}
        </div>
      )}

      <section ref={sceneRef} class="ep-scene" aria-labelledby="edition-practice-title">
        <h2 ref={titleRef} id="edition-practice-title" tabIndex={-1}>
          {scene.title}
        </h2>
        {step === 0 && <p class="ep-player-count">{players}</p>}
        <p>{scene.text}</p>
        {inDeck && deck ? (
          renderDeckEvidence()
        ) : claim && step === 2 ? (
          <>
            <div class="ep-sign" aria-label="Petunjuk latihan dengan dua panah">
              <span aria-hidden="true">←</span> Pintu barat <span aria-hidden="true">·</span> Pintu
              timur <span aria-hidden="true">→</span>
            </div>
            {renderChoices(["Dua arah", "Tiga arah"])}
          </>
        ) : claim && step === 3 ? (
          <p class="ep-score" role="status">
            {mode === "solo" && claim.soloTargets
              ? `1/${claim.soloTargets.lockedLandmarks} landmark terkunci · 1/${claim.soloTargets.distinctZones} zona`
              : "1 zona dikuasai · 1 landmark terkunci"}
          </p>
        ) : seek && family === "photo" && (step === 4 || step === 5) ? (
          <>
            <figure class="ep-photo">
              <img
                src={samplePhoto}
                alt="Ilustrasi contoh dengan kereta dan tugu"
                width={800}
                height={550}
              />
              <figcaption>Foto contoh</figcaption>
            </figure>
            {step === 4 && clue && renderChoices(clue.choices)}
          </>
        ) : seek && step === 4 && clue ? (
          renderChoices(clue.choices)
        ) : null}
      </section>

      {messageSig.value && (
        <div ref={toastRef} class="ep-toast">
          <span role="alert">{messageSig.value}</span>
          <button
            type="button"
            class="ep-back"
            data-practice-action="dismiss"
            aria-label="Tutup pemberitahuan"
            onClick={() => handleAction("dismiss")}
          >
            ×
          </button>
        </div>
      )}

      <div class="ep-actions">
        {claim && step === 1 && messageSig.value && (
          <button
            type="button"
            class="secondary"
            data-practice-action="approach"
            onClick={() => handleAction("approach")}
          >
            Dekati titik latihan
          </button>
        )}
        {scene.action !== "pin" && (
          <button
            type="button"
            class="primary"
            data-practice-action={scene.action}
            data-testid={scene.testId}
            disabled={mainDisabled}
            onClick={() => handleAction(scene.action)}
          >
            {scene.label}
          </button>
        )}
        {(step > 0 || step === finalStep) && (
          <div class="ep-secondary-row">
            {step > 0 && (
              <button
                type="button"
                class="secondary"
                data-practice-action="prev"
                data-testid="practice-prev-btn"
                onClick={() => handleAction("prev")}
              >
                ← Sebelumnya
              </button>
            )}
            {step === finalStep && (
              <button
                type="button"
                class="secondary"
                data-practice-action="replay"
                onClick={() => handleAction("replay")}
              >
                Ulangi latihan
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export function mountEditionPractice(
  dialog: HTMLDialogElement,
  edition: CatalogEdition,
  mode: RulebookPlayMode,
  options?: PracticeOptions,
) {
  const focusReturn = document.activeElement;
  let finishedViaReady = false;

  dialog.className = "ep-dialog";
  dialog.setAttribute("aria-labelledby", "edition-practice-title");

  const onClose = () => {
    render(null, dialog);
    dialog.replaceChildren();
    if (finishedViaReady && options?.onReady) {
      options.onReady();
      return;
    }
    if (focusReturn instanceof HTMLElement && focusReturn.isConnected) {
      focusReturn.focus();
    }
  };

  dialog.addEventListener("close", onClose, { once: true });

  render(
    <EditionPracticeView
      dialog={dialog}
      edition={edition}
      mode={mode}
      options={options}
      onMarkReady={() => {
        finishedViaReady = true;
      }}
    />,
    dialog,
  );
  dialog.showModal();
}
