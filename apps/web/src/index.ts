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
let unmountPlay: (() => void) | undefined;
let navigation = 0;
let routeEvents = new AbortController();

function selection(): GameConfiguration {
  const area = board.value === "jakarta-wide" ? "jakarta-wide" : "compact";
  if (duo.checked && hide.checked) return { board: area, players: 2, format: "hide-and-seek" };
  return { board: area, players: duo.checked ? 2 : 1, format: "claim-the-city" };
}

function update(writeUrl = false) {
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
    ? "Bergantian sembunyi dan mencari. Pemain dengan waktu sembunyi terlama setelah penyesuaian skor menang." : goal;
  document.getElementById("summary-time")!.textContent = duration;
  document.getElementById("summary-players")!.textContent = game.players === 1 ? "Solo" : "Berdua";
  document.getElementById("summary-board")!.textContent = board.selectedOptions[0]!.textContent;
  const playable = !wide && !seeking;
  playButton.hidden = !playable;
  playButton.textContent = game.players === 2 ? "Coba simulasi berdua" : "Coba simulasi";
  document.getElementById("summary-travel")!.hidden = playable;
  document.getElementById("summary-note")!.textContent = playable
    ? "Coba edisi simulasi dengan lokasi virtual. Kamu bisa bermain dari mana saja."
    : "Pratinjau pengaturan. Sesi permainan belum tersedia.";
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
  restoreSelection();
  const mode = new URLSearchParams(location.search).get("play");
  const playing = mode === "solo-claim" || mode === "duo-claim";
  setup.hidden = playing;
  play.hidden = !playing;
  if (!playing) {
    document.title = "Pilih permainan · Kelana Ria";
    play.replaceChildren();
    if (wasPlaying) form.querySelector<HTMLButtonElement>('button[type="submit"]')?.focus();
    return;
  }
  if (summary.open) summary.close();
  document.title = "Claim the City · Kelana Ria";
  const heading = `<h1 lang="en">Claim the City</h1><p class="intro">Jakarta (Compact) · ${mode === "duo-claim" ? "Berdua" : "Solo"} · Edisi siap pakai · Simulasi</p>`;
  play.innerHTML = `${heading}<p role="status">Membuka simulasi…</p>`;
  try {
    const mount = mode === "duo-claim"
      ? (await import("./duo-play")).mountDuoPlay
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
  url.searchParams.set("play", selection().players === 2 ? "duo-claim" : "solo-claim");
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
