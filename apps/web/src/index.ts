import type { GameConfiguration } from "@kelana-ria/contracts";
import copy from "./locales/id.json" with { type: "json" };

export type { GameConfiguration } from "@kelana-ria/contracts";

const form = document.querySelector<HTMLFormElement>("#chooser")!;
const board = document.querySelector<HTMLSelectElement>("#board")!;
const hide = form.querySelector<HTMLInputElement>('[value="hide-and-seek"]')!;
const claim = form.querySelector<HTMLInputElement>('[value="claim-the-city"]')!;
const solo = form.querySelector<HTMLInputElement>('[value="1"]')!;
const duo = form.querySelector<HTMLInputElement>('[value="2"]')!;
const summary = document.querySelector<HTMLDialogElement>("#summary")!;
const guide = document.querySelector<HTMLDialogElement>("#guide")!;
const feedback = document.getElementById("feedback")!;
const setup = document.getElementById("setup")!;
const play = document.getElementById("play")!;
const playButton = document.querySelector<HTMLButtonElement>("#summary-play")!;
const packsButton = document.querySelector<HTMLButtonElement>("#summary-packs")!;
const studioButton = document.querySelector<HTMLButtonElement>("#chooser-studio")!;
let unmountPlay: (() => void) | undefined;
let navigation = 0;
let routeEvents = new AbortController();

function selection(): GameConfiguration {
  const area = board.value === "jakarta-wide" ? "jakarta-wide" : "compact";
  if (duo.checked && hide.checked) return { board: area, players: 2, format: "hide-and-seek" };
  return { board: area, players: duo.checked ? 2 : 1, format: "claim-the-city" };
}

function update(writeUrl = false) {
  feedback.classList.add("sr-only");
  hide.disabled = solo.checked;
  if (hide.disabled && hide.checked) {
    claim.checked = true;
    feedback.textContent = "Hide & Seek perlu dua pemain. Claim the City dipilih untuk solo.";
  } else {
    feedback.textContent = "";
  }

  const game = selection();
  const wide = game.board === "jakarta-wide";
  const seeking = game.format === "hide-and-seek";
  const goal = game.players === 1
    ? `Kunci ${wide ? 6 : 4} landmark di setidaknya ${wide ? 3 : 2} zona sebelum waktu habis.`
    : "Kuasai zona terbanyak dengan Klaim–Kunci–Rebut dan kartu taktis.";
  const duration = seeking
    ? `Hingga ${wide ? 6 : 3} jam + waktu berkumpul kembali`
    : `${wide ? 180 : 90} menit`;
  document.getElementById("extent")!.textContent = wide
    ? "Jangkauan lebih luas hingga Manggarai dan Jakarta Kota."
    : "Sekitar Blok M, Senayan, dan Palmerah.";
  document.getElementById("claim-objective")!.textContent = goal;
  document.getElementById("duration")!.textContent = duration;
  document.getElementById("summary-format")!.textContent = seeking ? "Hide & Seek" : "Claim the City";
  document.getElementById("summary-goal")!.textContent = seeking
    ? "Bergantian sembunyi dan mencari dengan zona sembunyi, dek kartu & Endgame. Waktu sembunyi terlama menang." : goal;
  document.getElementById("summary-time")!.textContent = duration;
  document.getElementById("summary-players")!.textContent = game.players === 1 ? "Solo" : "Grup (2–6)";
  document.getElementById("summary-board")!.textContent = board.selectedOptions[0]!.textContent;
  playButton.hidden = false;
  packsButton.hidden = false;
  playButton.textContent = seeking ? "Main Hide & Seek" : game.players === 2 ? "Main Grup (2–6)" : "Main Solo";
  document.getElementById("summary-travel")!.hidden = false;
  document.getElementById("summary-note")!.textContent =
    "Gratis dimainkan di Jakarta dengan GPS perangkat.";
  if (writeUrl) {
    const url = new URL(location.href);
    url.searchParams.set("players", String(game.players));
    url.searchParams.set("format", game.format);
    url.searchParams.set("board", game.board);
    history.replaceState(history.state, "", url);
  }
}

function restoreSelection() {
  const params = new URLSearchParams(location.search);
  duo.checked = params.get("players") === "2";
  solo.checked = !duo.checked;
  hide.checked = params.get("format") === "hide-and-seek";
  claim.checked = !hide.checked;
  board.value = params.get("board") === "jakarta-wide" ? "jakarta-wide" : "compact";
  update(["format", "players", "board"].some(key => params.has(key)));
}

function returnToSetup() {
  if (history.state?.fromChooser) {
    history.back();
    return;
  }
  const url = new URL(location.href);
  url.searchParams.delete("play");
  url.searchParams.delete("room");
  url.searchParams.delete("pack");
  url.searchParams.delete("launch");
  history.replaceState(null, "", url);
  void showRoute();
}

async function showRoute() {
  const currentNavigation = ++navigation;
  const wasPlaying = !play.hidden;
  routeEvents.abort();
  routeEvents = new AbortController();
  unmountPlay?.();
  unmountPlay = undefined;
  const url = new URL(location.href);
  const params = url.searchParams;
  const requestedSeek = params.get("play") === "hide-and-seek";
  const rawBoard = params.get("board");
  const validBoard = rawBoard === null || rawBoard === "compact" || rawBoard === "jakarta-wide";
  const unsupportedSeek = requestedSeek && (
    (params.has("players") && params.get("players") !== "2") ||
    !validBoard ||
    (params.has("format") && params.get("format") !== "hide-and-seek")
  );
  if (unsupportedSeek) {
    params.delete("play");
    params.delete("room");
    history.replaceState(null, "", url);
  } else if (requestedSeek) {
    params.set("players", "2");
    params.set("format", "hide-and-seek");
    params.set("board", rawBoard === "jakarta-wide" ? "jakarta-wide" : "compact");
    history.replaceState(history.state, "", url);
  }
  restoreSelection();
  const mode = params.get("play");
  const seeking = mode === "hide-and-seek";
  const rulebookSeek = mode === "rulebook-seek";
  const rulebookClaim = mode === "rulebook-claim";
  const rulebookStudio = mode === "rulebook-studio";
  const playing =
    mode === "solo-claim" ||
    mode === "duo-claim" ||
    seeking ||
    mode === "creator-packs" ||
    rulebookSeek ||
    rulebookClaim ||
    rulebookStudio;
  setup.hidden = playing;
  play.hidden = !playing;
  if (!playing) {
    document.title = "Pilih permainan · Kelana Ria";
    play.replaceChildren();
    if (unsupportedSeek) {
      feedback.textContent = "Hide & Seek tersedia untuk dua pemain di Jakarta (Compact) atau Jakarta (Wide). Pilih pengaturan itu untuk bermain.";
      feedback.classList.remove("sr-only");
    }
    if (wasPlaying) form.querySelector<HTMLButtonElement>('button[type="submit"]')?.focus();
    return;
  }
  if (summary.open) summary.close();
  const format = seeking || rulebookSeek ? "Hide & Seek" : "Claim the City";
  const boardLabel = params.get("board") === "jakarta-wide" ? "Jakarta (Wide)" : "Jakarta (Compact)";
  document.title =
    mode === "creator-packs"
      ? "Paket Kreator · Kelana Ria"
      : rulebookStudio
        ? "Studio Rulebook · Kelana Ria"
        : `${format} · Kelana Ria`;
  const heading = mode === "creator-packs"
    ? '<h1>Paket Kreator Jakarta</h1><p class="intro">Jakarta (Compact) · Claim the City · Tinjauan &amp; Katalog</p>'
    : rulebookStudio
      ? '<h1>Studio Rulebook</h1><p class="intro">Hide &amp; Seek &amp; Claim the City · Authoring &amp; Tinjauan Paket Komunitas</p>'
      : rulebookSeek
        ? '<h1 lang="en">Hide &amp; Seek · Rulebook</h1><p class="intro">2–6 Pemain · Zona Sembunyi, Endgame &amp; Dek Kartu</p>'
        : rulebookClaim
          ? '<h1 lang="en">Claim the City · Rulebook</h1><p class="intro">1–6 Pemain · Klaim–Kunci–Rebut &amp; Dek Taktis</p>'
          : `<h1 lang="en">${format}</h1><p class="intro">${boardLabel} · ${mode === "solo-claim" ? "Solo" : "Berdua"} · Gratis</p>`;
  play.innerHTML = `${heading}<p role="status">Membuka permainan…</p>`;
  try {
    const mount = seeking ? (await import("./seek-play")).mountSeekPlay
      : rulebookSeek ? (await import("./rulebook-seek-play")).mountRulebookSeekPlay
      : rulebookClaim ? (await import("./rulebook-claim-play")).mountRulebookClaimPlay
      : rulebookStudio ? (await import("./rulebook-studio")).mountRulebookStudio
      : mode === "creator-packs" ? (await import("./pack-play")).mountPackPlay
      : mode === "duo-claim" ? (await import("./duo-play")).mountDuoPlay
      : (await import("./solo-play")).mountSoloPlay;
    if (currentNavigation === navigation) unmountPlay = mount(play, returnToSetup);
  } catch {
    if (currentNavigation !== navigation) return;
    play.innerHTML = `${heading}
      <p class="intro" role="alert">Permainan belum bisa dibuka. Periksa koneksi lalu coba lagi.</p>
      <button id="play-reload" class="secondary" type="button">Coba lagi</button>
      <button id="play-back" class="secondary" type="button">Kembali ke pilihan</button>`;
    const { signal } = routeEvents;
    const retry = () => location.reload();
    play.querySelector<HTMLButtonElement>("#play-reload")!.addEventListener("click", retry, { signal });
    play.querySelector<HTMLButtonElement>("#play-back")!.addEventListener("click", returnToSetup, { signal });
    window.addEventListener("online", retry, { once: true, signal });
  }
}

for (const [key, value] of Object.entries(copy)) {
  document.querySelectorAll<HTMLElement>(`[data-copy="${key}"]`).forEach(el => { el.textContent = value; });
}
form.addEventListener("change", () => update(true));
board.addEventListener("change", () => update(true));
form.addEventListener("submit", event => {
  event.preventDefault();
  summary.showModal();
});
let guideHandle:
  | { setTrack: (track: "hide-and-seek" | "claim-the-city" | "safety") => void }
  | undefined;
document.getElementById("guide-open")!.addEventListener("click", () => {
  const track = selection().format;
  guide.showModal();
  if (guideHandle) {
    guideHandle.setTrack(track);
  } else {
    void import("./interactive-guide").then(({ mountInteractiveGuide }) => {
      guideHandle = mountInteractiveGuide(guide, track);
    });
  }
});
playButton.addEventListener("click", () => {
  const url = new URL(location.href);
  const game = selection();
  const wide = game.board === "jakarta-wide";
  const seeking = game.format === "hide-and-seek";
  const packId = seeking
    ? wide
      ? "official-jakarta-wide-seek"
      : "official-jakarta-compact-seek"
    : wide
      ? "official-jakarta-wide-claim"
      : "official-jakarta-compact-claim";
  url.searchParams.set("play", seeking ? "rulebook-seek" : "rulebook-claim");
  url.searchParams.set("pack", packId);
  url.searchParams.set("launch", "1");
  url.searchParams.delete("room");
  history.pushState({ fromChooser: true }, "", url);
  void showRoute();
});
packsButton.addEventListener("click", () => {
  const url = new URL(location.href);
  const game = selection();
  url.searchParams.set("play", game.format === "hide-and-seek" ? "rulebook-seek" : "rulebook-claim");
  url.searchParams.delete("pack");
  url.searchParams.delete("launch");
  url.searchParams.delete("room");
  history.pushState({ fromChooser: true }, "", url);
  void showRoute();
});
studioButton.addEventListener("click", () => {
  const url = new URL(location.href);
  const game = selection();
  url.searchParams.set("play", "rulebook-studio");
  url.searchParams.set("format", game.format);
  url.searchParams.delete("pack");
  url.searchParams.delete("launch");
  url.searchParams.delete("room");
  history.pushState({ fromChooser: true }, "", url);
  void showRoute();
});
window.addEventListener("popstate", () => void showRoute());
void showRoute();
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(error => console.warn("PWA offline setup:", error));
  });
}
