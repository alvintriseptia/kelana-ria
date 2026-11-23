import type { ClaimMatchRecap, RulebookMatchRecap, RulebookRecapSummary, SeekMatchRecap } from "@kelana-ria/contracts";
import { escapeText } from "./escape-text";
import { claimDecidingMetric, claimResultReasons } from "./rulebook-claim-result";
import "./rulebook-recap.css";

const formatLabels = { "claim-the-city": "Claim the City", "hide-and-seek": "Hide & Seek" };
const date = new Intl.DateTimeFormat("id-ID", { dateStyle: "medium", timeStyle: "short" });

function duration(ms: number) {
  const seconds = Math.ceil(ms / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function playerName(recap: RulebookMatchRecap, seatId?: string | null) {
  return recap.players.find(player => player.seatId === seatId)?.name ?? "Pemain";
}

function claimResult(recap: ClaimMatchRecap) {
  const { outcome, soloProgress, standings } = recap;
  const teamName = (id: string) => recap.players.filter(player => player.teamId === id).map(player => player.name).join(", ") || id;
  const winner = outcome.winnerTeamId;
  const title = winner && !recap.isSolo ? `Pemenang · ${teamName(winner)}`
    : outcome.soloWon ? "Menang Solo" : outcome.reason === "abandoned" ? "Ditinggalkan"
    : outcome.reason === "canceled" ? "Dibatalkan" : recap.isSolo ? "Sesi Solo Berakhir" : outcome.reason === "forfeit" ? "Ronde berakhir" : "Seri";
  const tiebreak = claimDecidingMetric(standings, outcome, recap.isSolo);
  return `<section class="recap-panel"><h2>${escapeText(title)}</h2><p>${claimResultReasons[outcome.reason]}</p>
    ${tiebreak ? `<p>Penentu kemenangan · ${tiebreak}</p>` : ""}
    ${soloProgress ? `<dl class="recap-targets">
      <div><dt>Landmark terkunci</dt><dd>${soloProgress.lockedLandmarks}/${soloProgress.targetLandmarks}</dd></div>
      <div><dt>Zona berbeda</dt><dd>${soloProgress.distinctZones}/${soloProgress.targetZones}</dd></div>
    </dl>` : `<ul class="recap-list" aria-label="Skor ronde">${standings.map(score => `<li>
      <strong>${escapeText(teamName(score.teamId))}</strong><small>${score.zonesControlled} zona · ${score.lockedLandmarks} terkunci · ${score.totalLandmarks} total landmark</small>
    </li>`).join("")}</ul>`}
    </section>
    ${recap.highlights.length ? `<section class="recap-panel"><h2>Momen penting</h2><ul class="recap-list">
      ${recap.highlights.map(event => `<li><strong>${escapeText(event.landmark)}</strong>
        <small>${event.kind === "stolen" ? "Direbut" : "Dikunci"} · ${escapeText(playerName(recap, event.seatId))}</small></li>`).join("")}
    </ul></section>` : ""}`;
}

function seekResult(recap: SeekMatchRecap) {
  const reasons: Record<SeekMatchRecap["outcome"]["reason"], string> = {
    scored: "Waktu sembunyi akhir menentukan hasil.", missed_lock: "Titik sembunyi belum dikunci saat waktu habis.",
    regroup_timeout: "Waktu berkumpul habis.", forfeit: "Seorang pemain mengakhiri permainan lebih awal.", canceled: "Ruang dibatalkan.",
  };
  const turnReason: Record<SeekMatchRecap["turns"][number]["reason"], string> = {
    found: "Ditemukan", timeout: "Waktu mencari habis", missed_lock: "Titik sembunyi belum dikunci", forfeit: "Giliran berakhir lebih awal",
  };
  const { winnerSeatId, reason } = recap.outcome;
  const title = winnerSeatId ? `Pemenang · ${playerName(recap, winnerSeatId)}`
    : reason === "scored" ? "Seri" : recap.phase === "canceled" ? "Dibatalkan" : "Permainan belum lengkap";
  return `<section class="recap-panel"><h2>${escapeText(title)}</h2><p>${reasons[reason]}</p></section>
    ${recap.turns.length ? `<section class="recap-panel"><h2>Giliran sembunyi</h2><ul class="recap-list">
      ${recap.turns.map(turn => `<li><strong>${escapeText(playerName(recap, turn.hiderSeatId))} · ${duration(turn.adjustedMs)}</strong>
        <small>Giliran ${turn.turnNumber} · ${turnReason[turn.reason]} · ${turn.answeredQuestions} pertanyaan dijawab</small>
        <small>Waktu dasar ${duration(turn.rawHidingMs)}${turn.bonusMs + turn.trapBonusMs > 0 ? ` · Bonus ${duration(turn.bonusMs + turn.trapBonusMs)}` : ""}${turn.penaltyMs > 0 ? ` · Penalti ${duration(turn.penaltyMs)}` : ""}</small>
      </li>`).join("")}</ul></section>` : ""}`;
}

function recapMeta(recap: RulebookRecapSummary) {
  return `${escapeText(formatLabels[recap.format])} · v${recap.editionVersion} · ${date.format(recap.completedAt)}${recap.simulated ? " · QA" : ""}`;
}

export function mountRulebookRecap(root: HTMLElement, matchId: string | null, signal: AbortSignal) {
  const back = matchId ? '/?recaps=1' : '/';
  const title = matchId ? "Ringkasan pertandingan" : "Riwayat pertandingan";
  document.title = `${title} · Kelana Ria`;
  function render(content: string) {
    if (!signal.aborted) root.innerHTML = `<article class="recap-shell"><a class="recap-back" href="${back}">‹ ${matchId ? "Riwayat" : "Katalog"}</a>
      <h1>${title}</h1>${content}</article>`;
  }
  async function load() {
    render('<p role="status">Memuat riwayat…</p>');
    try {
      const response = await fetch(`/api/rulebooks/recaps${matchId ? `/${encodeURIComponent(matchId)}` : ""}`, { signal });
      if (response.status === 404 && matchId) {
        render('<p role="status">Ringkasan ini belum tersedia di sesi perangkatmu.</p>');
        return;
      }
      if (!response.ok) throw new Error("recap-load-failed");
      const { recap, recaps } = await response.json() as { recap?: RulebookMatchRecap; recaps?: RulebookRecapSummary[] };
      if (recap) {
        render(`<header class="recap-panel"><strong>${escapeText(recap.title)}</strong><p>${recapMeta(recap)}</p></header>
          ${recap.format === "claim-the-city" ? claimResult(recap) : seekResult(recap)}`);
      } else if (recaps?.length) {
        render(`<ul class="recap-list recap-history">${recaps.map(item => `<li><a href="/?recap=${encodeURIComponent(item.matchId)}">
          <strong>${escapeText(item.title)}</strong><small>${recapMeta(item)}</small></a></li>`).join("")}</ul>`);
      } else render("<p>Pertandingan yang kamu selesaikan akan muncul di sini.</p>");
    } catch {
      render('<p role="alert">Riwayat belum bisa dibuka. Periksa koneksi, lalu coba lagi.</p><button type="button" class="secondary" data-recap-retry>Coba lagi</button>');
      root.querySelector<HTMLButtonElement>("[data-recap-retry]")?.addEventListener("click", () => void load(), { once: true, signal });
    }
  }
  void load();
}
