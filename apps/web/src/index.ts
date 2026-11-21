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
    ? "Klaim 4 tempat di setidaknya 2 zona sebelum waktu habis."
    : "Kuasai lebih banyak zona daripada lawan dengan mengklaim tempat di setiap zona.";
  const duration = seeking
    ? `Hingga ${wide ? 6 : 3} jam + waktu berkumpul kembali`
    : `${wide ? 120 : 60} menit`;
  document.getElementById("extent")!.textContent = wide
    ? "Jangkauan lebih luas hingga Manggarai dan Jakarta Kota."
    : "Sekitar Blok M, Senayan, dan Palmerah.";
  document.getElementById("claim-objective")!.textContent = goal;
  document.getElementById("duration")!.textContent = duration;
  document.getElementById("summary-format")!.textContent = seeking ? "Hide & Seek" : "Claim the City";
  document.getElementById("summary-goal")!.textContent = seeking
    ? "Bergantian sembunyi dan mencari. Pemain dengan waktu sembunyi terlama menang." : goal;
  document.getElementById("summary-time")!.textContent = duration;
  document.getElementById("summary-players")!.textContent = game.players === 1 ? "Solo" : "Berdua";
  document.getElementById("summary-board")!.textContent = board.selectedOptions[0]!.textContent;
  playButton.hidden = false;
  packsButton.hidden = wide || seeking;
  playButton.textContent = seeking ? "Coba simulasi Hide & Seek" : game.players === 2 ? "Coba simulasi berdua" : "Coba simulasi";
  document.getElementById("summary-travel")!.hidden = true;
  document.getElementById("summary-note")!.textContent =
    "Coba edisi simulasi dengan lokasi virtual. Kamu bisa bermain dari mana saja.";
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
  const playing = mode === "solo-claim" || mode === "duo-claim" || seeking || mode === "creator-packs";
  setup.hidden = playing;
  play.hidden = !playing;
  if (!playing) {
    document.title = "Pilih permainan · Kelana Ria";
    play.replaceChildren();
    if (unsupportedSeek) {
      feedback.textContent = "Simulasi Hide & Seek tersedia untuk dua pemain di Jakarta (Compact) atau Jakarta (Wide). Pilih pengaturan itu untuk bermain.";
      feedback.classList.remove("sr-only");
    }
    if (wasPlaying) form.querySelector<HTMLButtonElement>('button[type="submit"]')?.focus();
    return;
  }
  if (summary.open) summary.close();
  const format = seeking ? "Hide & Seek" : "Claim the City";
  const boardLabel = params.get("board") === "jakarta-wide" ? "Jakarta (Wide)" : "Jakarta (Compact)";
  document.title = mode === "creator-packs" ? "Paket Kreator · Kelana Ria" : `${format} · Kelana Ria`;
  const heading = mode === "creator-packs"
    ? '<h1>Paket Kreator Jakarta</h1><p class="intro">Jakarta (Compact) · Claim the City · Tinjauan &amp; Katalog</p>'
    : `<h1 lang="en">${format}</h1><p class="intro">${boardLabel} · ${mode === "solo-claim" ? "Solo" : "Berdua"} · Edisi siap pakai · Simulasi</p>`;
  play.innerHTML = `${heading}<p role="status">Membuka simulasi…</p>`;
  try {
    const mount = seeking ? (await import("./seek-play")).mountSeekPlay
      : mode === "creator-packs" ? (await import("./pack-play")).mountPackPlay
      : mode === "duo-claim" ? (await import("./duo-play")).mountDuoPlay
      : (await import("./solo-play")).mountSoloPlay;
    if (currentNavigation === navigation) unmountPlay = mount(play, returnToSetup);
  } catch {
    if (currentNavigation !== navigation) return;
    play.innerHTML = `${heading}
      <p class="intro" role="alert">Simulasi belum bisa dibuka. Periksa koneksi lalu coba lagi.</p>
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
document.getElementById("guide-open")!.addEventListener("click", () => guide.showModal());
playButton.addEventListener("click", () => {
  const url = new URL(location.href);
  const game = selection();
  url.searchParams.set("play", game.format === "hide-and-seek" ? "hide-and-seek" : game.players === 2 ? "duo-claim" : "solo-claim");
  history.pushState({ fromChooser: true }, "", url);
  void showRoute();
});
packsButton.addEventListener("click", () => {
  const url = new URL(location.href);
  url.searchParams.set("play", "creator-packs");
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
