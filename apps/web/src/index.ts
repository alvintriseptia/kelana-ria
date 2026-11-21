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
  if (writeUrl) {
    const url = new URL(location.href);
    url.searchParams.set("players", String(game.players));
    url.searchParams.set("format", game.format);
    url.searchParams.set("board", game.board);
    history.replaceState(null, "", url);
  }
}

const params = new URLSearchParams(location.search);
duo.checked = params.get("players") === "2";
solo.checked = !duo.checked;
hide.checked = params.get("format") === "hide-and-seek";
claim.checked = !hide.checked;
board.value = params.get("board") === "jakarta-wide" ? "jakarta-wide" : "compact";
update(["format", "players", "board"].some(key => params.has(key)));
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
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(error => console.warn("PWA offline setup:", error));
  });
}
