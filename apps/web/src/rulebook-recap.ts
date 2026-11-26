import type {
  AuthMeReply,
  ClaimMatchRecap,
  PublicClaimMatchRecap,
  PublicMatchRecap,
  PublicRecapMoment,
  PublicSeekMatchRecap,
  RecapPublicShareState,
  RulebookMatchRecap,
  RulebookRecapSummary,
  SeekMatchRecap,
} from "@kelana-ria/contracts";
import {
  fetchAuthMe,
  getCachedAuth,
  onAuthChange,
  openAuthModal,
  renderAccountChip,
} from "./auth-modal";
import { escapeText } from "./escape-text";
import { claimDecidingMetric, claimResultReasons } from "./rulebook-claim-result";
import "./rulebook-recap.css";

const formatLabels = { "claim-the-city": "Claim the City", "hide-and-seek": "Hide & Seek" };
const date = new Intl.DateTimeFormat("id-ID", { dateStyle: "medium", timeStyle: "short" });

const seekReasons: Record<SeekMatchRecap["outcome"]["reason"], string> = {
  scored: "Waktu sembunyi akhir menentukan hasil.",
  missed_lock: "Titik sembunyi belum dikunci saat waktu habis.",
  regroup_timeout: "Waktu berkumpul habis.",
  forfeit: "Seorang pemain mengakhiri permainan lebih awal.",
  canceled: "Ruang dibatalkan.",
};

const seekTurnReason: Record<SeekMatchRecap["turns"][number]["reason"], string> = {
  found: "Ditemukan",
  timeout: "Waktu mencari habis",
  missed_lock: "Titik sembunyi belum dikunci",
  forfeit: "Giliran berakhir lebih awal",
};

function duration(ms: number) {
  const seconds = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function editionHref(packId: string, version: number) {
  return `/?${new URLSearchParams({ edition: packId, version: String(version) }).toString()}`;
}

function sanitizeAlias(raw: string | undefined, fallback: string) {
  const cleaned = (raw ?? "")
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .replace(/\b(?:RC|RB)-[\dA-F]{6}\b/gi, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 32);
  return cleaned || fallback;
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
  const { winnerSeatId, reason } = recap.outcome;
  const title = winnerSeatId ? `Pemenang · ${playerName(recap, winnerSeatId)}`
    : reason === "scored" ? "Seri" : recap.phase === "canceled" ? "Dibatalkan" : "Permainan belum lengkap";
  return `<section class="recap-panel"><h2>${escapeText(title)}</h2><p>${seekReasons[reason]}</p></section>
    ${recap.turns.length ? `<section class="recap-panel"><h2>Giliran sembunyi</h2><ul class="recap-list">
      ${recap.turns.map(turn => `<li><strong>${escapeText(playerName(recap, turn.hiderSeatId))} · ${duration(turn.adjustedMs)}</strong>
        <small>Giliran ${turn.turnNumber} · ${seekTurnReason[turn.reason]} · ${turn.answeredQuestions} pertanyaan dijawab</small>
        <small>Waktu dasar ${duration(turn.rawHidingMs)}${turn.bonusMs + turn.trapBonusMs > 0 ? ` · Bonus ${duration(turn.bonusMs + turn.trapBonusMs)}` : ""}${turn.penaltyMs > 0 ? ` · Penalti ${duration(turn.penaltyMs)}` : ""}</small>
      </li>`).join("")}</ul></section>` : ""}`;
}

function buildPublicPreview(recap: RulebookMatchRecap, draftAliases: Record<string, string>): PublicMatchRecap {
  const resolved: Record<string, string> = {};
  recap.players.forEach((player, index) => {
    const fallback = `Pemain ${index + 1}`;
    resolved[player.seatId] = sanitizeAlias(draftAliases[player.seatId], fallback);
  });
  const base = {
    shareId: "PRATINJAU",
    packId: recap.packId,
    editionVersion: recap.editionVersion,
    title: recap.title,
    completedAt: recap.completedAt,
    publishedAt: recap.completedAt,
    simulated: recap.simulated,
    editionHref: editionHref(recap.packId, recap.editionVersion),
  };
  if (recap.format === "claim-the-city") {
    const teamIds: string[] = [];
    for (const p of recap.players) if (!teamIds.includes(p.teamId)) teamIds.push(p.teamId);
    const teamLabelById = new Map<string, string>();
    teamIds.forEach((teamId, idx) => {
      const members = recap.players.filter(p => p.teamId === teamId).map(p => resolved[p.seatId] ?? `Pemain ${idx + 1}`);
      teamLabelById.set(teamId, members.join(", ") || `Tim ${idx + 1}`);
    });
    const decidingMetric = claimDecidingMetric(recap.standings, recap.outcome, recap.isSolo);
    const moments: PublicRecapMoment[] = recap.highlights.slice(-3).map(event => ({
      label: event.landmark,
      detail: `${event.kind === "stolen" ? "Direbut" : "Dikunci"} · ${event.seatId ? (resolved[event.seatId] ?? "Pemain") : "Pemain"}`,
    }));
    const preview: PublicClaimMatchRecap = {
      ...base,
      format: "claim-the-city",
      isSolo: recap.isSolo,
      outcome: {
        reason: recap.outcome.reason,
        ...(recap.outcome.soloWon !== undefined ? { soloWon: recap.outcome.soloWon } : {}),
        winnerLabel: recap.outcome.winnerTeamId && !recap.isSolo ? (teamLabelById.get(recap.outcome.winnerTeamId) ?? null) : null,
        ...(decidingMetric ? { decidingMetric } : {}),
      },
      ...(recap.soloProgress ? { soloProgress: recap.soloProgress } : {}),
      players: recap.players.map((p, idx) => ({ alias: resolved[p.seatId] ?? `Pemain ${idx + 1}`, teamIndex: teamIds.indexOf(p.teamId) })),
      standings: recap.standings.map((score, idx) => ({
        teamLabel: teamLabelById.get(score.teamId) ?? `Tim ${idx + 1}`,
        zonesControlled: score.zonesControlled,
        lockedLandmarks: score.lockedLandmarks,
        totalLandmarks: score.totalLandmarks,
        isWinner: Boolean(recap.outcome.winnerTeamId && score.teamId === recap.outcome.winnerTeamId),
      })),
      moments,
    };
    return preview;
  }
  const turns = recap.turns.map(turn => ({
    turnNumber: turn.turnNumber,
    hiderAlias: resolved[turn.hiderSeatId] ?? "Pemain",
    rawHidingMs: turn.rawHidingMs,
    bonusMs: turn.bonusMs,
    trapBonusMs: turn.trapBonusMs,
    penaltyMs: turn.penaltyMs,
    adjustedMs: turn.adjustedMs,
    reason: turn.reason,
    answeredQuestions: turn.answeredQuestions,
  }));
  const preview: PublicSeekMatchRecap = {
    ...base,
    format: "hide-and-seek",
    phase: recap.phase,
    outcome: {
      reason: recap.outcome.reason,
      winnerLabel: recap.outcome.winnerSeatId ? (resolved[recap.outcome.winnerSeatId] ?? "Pemain") : null,
    },
    players: recap.players.map((p, idx) => ({ alias: resolved[p.seatId] ?? `Pemain ${idx + 1}` })),
    turns,
    moments: turns.slice(0, 3).map(turn => ({
      label: `Giliran ${turn.turnNumber} · ${turn.hiderAlias}`,
      detail: `${duration(turn.adjustedMs)} · ${seekTurnReason[turn.reason]} · ${turn.answeredQuestions} pertanyaan dijawab`,
    })),
  };
  return preview;
}

function publicOutcomeTitle(recap: PublicMatchRecap) {
  if (recap.format === "claim-the-city") {
    const { outcome } = recap;
    return outcome.winnerLabel && !recap.isSolo ? `Pemenang · ${outcome.winnerLabel}`
      : outcome.soloWon ? "Menang Solo" : outcome.reason === "abandoned" ? "Ditinggalkan"
      : outcome.reason === "canceled" ? "Dibatalkan" : recap.isSolo ? "Sesi Solo Berakhir"
      : outcome.reason === "forfeit" ? "Ronde berakhir" : "Seri";
  }
  return recap.outcome.winnerLabel ? `Pemenang · ${recap.outcome.winnerLabel}`
    : recap.outcome.reason === "scored" ? "Seri" : recap.phase === "canceled" ? "Dibatalkan" : "Permainan belum lengkap";
}

function publicResultSections(recap: PublicMatchRecap, preview = false) {
  const title = publicOutcomeTitle(recap);
  const heading = (text: string) => preview
    ? `<p class="recap-preview-title"><strong>${text}</strong></p>`
    : `<h2>${text}</h2>`;
  if (recap.format === "claim-the-city") {
    return `<section class="recap-panel">
      ${heading(escapeText(title))}
      <p>${claimResultReasons[recap.outcome.reason]}</p>
      ${recap.outcome.decidingMetric ? `<p>Penentu kemenangan · ${escapeText(recap.outcome.decidingMetric)}</p>` : ""}
      ${recap.soloProgress ? `<dl class="recap-targets">
        <div><dt>Landmark terkunci</dt><dd>${recap.soloProgress.lockedLandmarks}/${recap.soloProgress.targetLandmarks}</dd></div>
        <div><dt>Zona berbeda</dt><dd>${recap.soloProgress.distinctZones}/${recap.soloProgress.targetZones}</dd></div>
      </dl>` : `<ul class="recap-list" aria-label="Skor publik">${recap.standings.map(score => `<li>
        <strong>${escapeText(score.teamLabel)}${score.isWinner ? " ★" : ""}</strong>
        <small>${score.zonesControlled} zona · ${score.lockedLandmarks} terkunci · ${score.totalLandmarks} total landmark</small>
      </li>`).join("")}</ul>`}
    </section>
    ${recap.moments.length ? `<section class="recap-panel">${heading("Momen pilihan")}<ul class="recap-list">
      ${recap.moments.map(moment => `<li><strong>${escapeText(moment.label)}</strong><small>${escapeText(moment.detail)}</small></li>`).join("")}
    </ul></section>` : ""}`;
  }
  return `<section class="recap-panel">
    ${heading(escapeText(title))}
    <p>${seekReasons[recap.outcome.reason]}</p>
  </section>
  ${recap.turns.length ? `<section class="recap-panel">${heading("Giliran sembunyi")}<ul class="recap-list">
    ${recap.turns.map(turn => `<li><strong>${escapeText(turn.hiderAlias)} · ${duration(turn.adjustedMs)}</strong>
      <small>Giliran ${turn.turnNumber} · ${seekTurnReason[turn.reason]} · ${turn.answeredQuestions} pertanyaan dijawab</small>
      <small>Waktu dasar ${duration(turn.rawHidingMs)}${turn.bonusMs + turn.trapBonusMs > 0 ? ` · Bonus ${duration(turn.bonusMs + turn.trapBonusMs)}` : ""}${turn.penaltyMs > 0 ? ` · Penalti ${duration(turn.penaltyMs)}` : ""}</small>
    </li>`).join("")}</ul></section>` : ""}`;
}

function recapMeta(recap: Pick<RulebookRecapSummary, "format" | "editionVersion" | "completedAt" | "simulated">) {
  return `${escapeText(formatLabels[recap.format])} · v${recap.editionVersion} · ${date.format(recap.completedAt)}${recap.simulated ? " · QA" : ""}`;
}

export function mountRulebookRecap(
  root: HTMLElement,
  matchId: string | null,
  signal: AbortSignal,
  sharedId: string | null = null,
) {
  if (sharedId) {
    document.title = "Ringkasan komunitas · Kelana Ria";
    function renderShared(content: string, backHref = "/catalog", backLabel = "Katalog") {
      if (signal.aborted) return;
      root.innerHTML = `<article class="recap-shell">
        <a class="recap-back" href="${escapeText(backHref)}">‹ ${escapeText(backLabel)}</a>
        <h1>Ringkasan komunitas</h1>
        ${content}
      </article>`;
    }
    async function loadShared() {
      renderShared('<p role="status">Memuat ringkasan komunitas…</p>');
      try {
        const response = await fetch(`/api/rulebooks/shared/${encodeURIComponent(sharedId!)}`, { signal });
        if (response.status === 404) {
          renderShared('<section class="recap-panel"><p role="status">Ringkasan komunitas ini tidak tersedia atau sudah ditarik oleh peserta.</p></section>');
          return;
        }
        if (!response.ok) throw new Error("shared-load-failed");
        const { recap } = await response.json() as { recap: PublicMatchRecap };
        document.title = `${recap.title} · Ringkasan komunitas · Kelana Ria`;
        renderShared(`
          <header class="recap-panel">
            <div class="recap-head-row">
              <strong>${escapeText(recap.title)}</strong>
              <span class="recap-badge recap-badge-public">● Publik</span>
            </div>
            <p>${recapMeta(recap)}</p>
            <p class="recap-meta-note">Peserta: ${escapeText(recap.players.map(p => p.alias).join(", "))}</p>
            <a class="recap-edition-cta" href="${escapeText(recap.editionHref)}" data-testid="shared-edition-link">Lihat aturan &amp; edisi v${recap.editionVersion} ›</a>
          </header>
          ${publicResultSections(recap, false)}
        `, recap.editionHref, `Edisi v${recap.editionVersion}`);
      } catch {
        renderShared('<p role="alert">Ringkasan komunitas belum bisa dibuka. Periksa koneksi, lalu coba lagi.</p><button type="button" class="secondary" data-recap-retry>Coba lagi</button>');
        root.querySelector<HTMLButtonElement>("[data-recap-retry]")?.addEventListener("click", () => void loadShared(), { once: true, signal });
      }
    }
    void loadShared();
    return;
  }

  const back = matchId ? "/?recaps=1" : "/catalog";
  const title = matchId ? "Ringkasan pertandingan" : "Riwayat pertandingan";
  document.title = `${title} · Kelana Ria`;

  let authState: AuthMeReply | null = getCachedAuth();
  let currentRecap: RulebookMatchRecap | undefined;
  let currentShare: RecapPublicShareState | null = null;
  let draftAliases: Record<string, string> = {};
  let busy = false;
  let statusMessage = "";
  let statusError = false;
  let lastContent = "";

  function defaultAliasesFor(recap: RulebookMatchRecap) {
    const next: Record<string, string> = {};
    recap.players.forEach((player, index) => {
      next[player.seatId] = `Pemain ${index + 1}`;
    });
    return next;
  }

  function renderFrame(content: string) {
    lastContent = content;
    if (!signal.aborted) {
      root.innerHTML = `<article class="recap-shell"><div class="recap-topbar"><a class="recap-back" href="${back}">‹ ${matchId ? "Riwayat" : "Katalog"}</a>${renderAccountChip(authState)}</div>
        <h1>${title}</h1>${content}</article>`;
    }
  }

  function renderPreviewInner(recap: RulebookMatchRecap) {
    const preview = buildPublicPreview(recap, draftAliases);
    return `<div class="recap-preview-head">
        <strong>${escapeText(preview.title)}</strong>
        <span class="recap-badge recap-badge-public">Pratinjau publik</span>
      </div>
      <p class="recap-meta-note">${recapMeta(preview)} · ${escapeText(preview.players.map(p => p.alias).join(", "))}</p>
      ${publicResultSections(preview, true)}`;
  }

  function renderPrivateDetail() {
    if (!currentRecap || signal.aborted) return;
    const recap = currentRecap;
    const isShared = Boolean(currentShare);
    const publicPath = currentShare ? `/?shared=${encodeURIComponent(currentShare.shareId)}` : "";
    const statusMarkup = statusMessage
      ? `<p class="recap-status ${statusError ? "recap-status-error" : ""}" role="${statusError ? "alert" : "status"}" aria-live="polite">${escapeText(statusMessage)}</p>`
      : `<p class="recap-status" role="status" aria-live="polite" hidden></p>`;

    renderFrame(`
      <header class="recap-panel">
        <div class="recap-head-row">
          <strong>${escapeText(recap.title)}</strong>
          <span class="recap-badge ${isShared ? "recap-badge-public" : "recap-badge-private"}" data-testid="recap-visibility-badge">
            ${isShared ? "● Publik · Dibagikan" : "◆ Privat · Hanya peserta"}
          </span>
        </div>
        <p>${recapMeta(recap)}</p>
        <a class="recap-edition-link" href="${escapeText(editionHref(recap.packId, recap.editionVersion))}">Lihat edisi v${recap.editionVersion} ›</a>
      </header>
      ${recap.format === "claim-the-city" ? claimResult(recap) : seekResult(recap)}
      <section class="recap-panel recap-share-card" aria-labelledby="recap-share-heading">
        <div class="recap-head-row">
          <h2 id="recap-share-heading">Bagikan ke komunitas</h2>
          <span class="recap-badge ${isShared ? "recap-badge-public" : "recap-badge-private"}">${isShared ? "Publik" : "Privat"}</span>
        </div>
        <p>${isShared
          ? `Ringkasan ini tampil di halaman edisi v${recap.editionVersion} dan bisa dibuka lewat tautan publik. Jika ditarik, salinan privat tetap aman di Riwayat.`
          : `Ringkasan ini privat. Cek pratinjau dan atur nama alias dulu sebelum dibagikan ke halaman edisi v${recap.editionVersion}.`}</p>
        <p class="recap-privacy-note">Foto bukti, titik sembunyi, detail petunjuk, kode ruang, dan data akun tidak pernah ikut dibagikan.</p>
        ${isShared ? `<div class="recap-shared-bar">
          <a class="recap-public-link" href="${escapeText(publicPath)}" data-testid="public-recap-link">Buka ringkasan publik ›</a>
          <button type="button" class="secondary" data-recap-action="copy-share" ${busy ? "disabled" : ""}>Salin tautan</button>
        </div>` : ""}
        <fieldset class="recap-alias-group" ${busy ? "disabled" : ""}>
          <legend>Nama tampilan publik</legend>
          <div class="recap-alias-presets">
            <button type="button" class="secondary" data-recap-action="use-anon-aliases">Pakai alias anonim</button>
            <button type="button" class="secondary" data-recap-action="use-room-names">Gunakan nama ruang</button>
          </div>
          <div class="recap-alias-fields">
            ${recap.players.map((player, index) => {
              const fallback = `Pemain ${index + 1}`;
              const value = draftAliases[player.seatId] ?? fallback;
              return `<label class="recap-alias-field">
                <span>${escapeText(player.name)} <small>(peserta ${index + 1})</small></span>
                <input type="text" maxlength="32" value="${escapeText(value)}" placeholder="${escapeText(fallback)}" data-alias-seat="${escapeText(player.seatId)}">
              </label>`;
            }).join("")}
          </div>
        </fieldset>
        <section class="recap-preview-box" aria-label="Pratinjau hasil publik" data-testid="public-recap-preview">
          ${renderPreviewInner(recap)}
        </section>
        ${statusMarkup}
        <div class="recap-share-actions">
          <button type="button" class="primary" data-recap-action="publish" ${busy ? "disabled" : ""}>
            ${isShared ? "Perbarui tampilan publik" : "Bagikan ke komunitas"}
          </button>
          ${isShared ? `<button type="button" class="secondary recap-unshare-btn" data-recap-action="unshare" ${busy ? "disabled" : ""}>Tarik dari komunitas</button>` : ""}
        </div>
      </section>
    `);
  }

  async function publishShare() {
    if (!matchId || !currentRecap || busy) return;
    busy = true;
    statusMessage = "";
    statusError = false;
    renderPrivateDetail();
    try {
      const response = await fetch(`/api/rulebooks/recaps/${encodeURIComponent(matchId)}/share`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal,
        body: JSON.stringify({ aliases: draftAliases }),
      });
      if (!response.ok) throw new Error("share-failed");
      const data = await response.json() as {
        recap: RulebookMatchRecap;
        share: RecapPublicShareState;
      };
      if (signal.aborted) return;
      const wasShared = Boolean(currentShare);
      currentRecap = data.recap;
      currentShare = data.share;
      draftAliases = { ...data.share.aliases };
      statusMessage = wasShared
        ? "Tampilan publik diperbarui."
        : "Ringkasan berhasil dibagikan ke komunitas.";
      statusError = false;
    } catch {
      if (!signal.aborted) {
        statusMessage = "Gagal membagikan ringkasan. Periksa koneksi lalu coba lagi.";
        statusError = true;
      }
    } finally {
      if (!signal.aborted) {
        busy = false;
        renderPrivateDetail();
      }
    }
  }

  async function unshare() {
    if (!matchId || !currentRecap || !currentShare || busy) return;
    busy = true;
    statusMessage = "";
    statusError = false;
    renderPrivateDetail();
    try {
      const response = await fetch(`/api/rulebooks/recaps/${encodeURIComponent(matchId)}/unshare`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal,
        body: JSON.stringify({}),
      });
      if (!response.ok) throw new Error("unshare-failed");
      const data = await response.json() as { recap: RulebookMatchRecap; share: null };
      if (signal.aborted) return;
      currentRecap = data.recap;
      currentShare = null;
      statusMessage = "Ringkasan ditarik dari komunitas. Salinan privat tetap tersimpan di Riwayatmu.";
      statusError = false;
    } catch {
      if (!signal.aborted) {
        statusMessage = "Gagal menarik ringkasan. Periksa koneksi lalu coba lagi.";
        statusError = true;
      }
    } finally {
      if (!signal.aborted) {
        busy = false;
        renderPrivateDetail();
      }
    }
  }

  async function copyShareUrl() {
    if (!currentShare) return;
    const shareUrl = new URL(`/?shared=${encodeURIComponent(currentShare.shareId)}`, location.origin).href;
    try {
      await navigator.clipboard.writeText(shareUrl);
      statusMessage = "Tautan ringkasan publik disalin.";
      statusError = false;
    } catch {
      statusMessage = `Salin tautan ini: ${shareUrl}`;
      statusError = false;
    }
    renderPrivateDetail();
  }

  root.addEventListener("input", event => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement) || !target.dataset.aliasSeat || !currentRecap) return;
    draftAliases[target.dataset.aliasSeat] = target.value;
    const previewBox = root.querySelector<HTMLElement>('[data-testid="public-recap-preview"]');
    if (previewBox) previewBox.innerHTML = renderPreviewInner(currentRecap);
  }, { signal });

  root.addEventListener("click", event => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const authBtn = target.closest<HTMLButtonElement>("[data-auth-action]");
    if (authBtn) {
      openAuthModal({
        mode: authBtn.dataset.authAction === "open-account" && authState?.authenticated ? "account" : "signin",
      });
      return;
    }
    if (!currentRecap) return;
    const button = target.closest<HTMLButtonElement>("[data-recap-action]");
    const action = button?.dataset.recapAction;
    if (!action || button?.disabled) return;
    if (action === "use-anon-aliases") {
      draftAliases = defaultAliasesFor(currentRecap);
      statusMessage = "Alias anonim dipilih untuk pratinjau publik.";
      statusError = false;
      renderPrivateDetail();
    } else if (action === "use-room-names") {
      const approved: Record<string, string> = {};
      currentRecap.players.forEach((player, index) => {
        approved[player.seatId] = sanitizeAlias(player.name, `Pemain ${index + 1}`);
      });
      draftAliases = approved;
      statusMessage = "Nama pemain dari ruang dimasukkan ke pratinjau publik.";
      statusError = false;
      renderPrivateDetail();
    } else if (action === "publish") {
      void publishShare();
    } else if (action === "unshare") {
      void unshare();
    } else if (action === "copy-share") {
      void copyShareUrl();
    }
  }, { signal });

  onAuthChange((next) => {
    authState = next;
    void load();
  }, signal);

  if (!authState) {
    void fetchAuthMe(signal).then((fresh) => {
      if (signal.aborted) return;
      authState = fresh;
      if (currentRecap) renderPrivateDetail();
      else if (lastContent) renderFrame(lastContent);
    });
  }

  async function load() {
    renderFrame('<p role="status">Memuat riwayat…</p>');
    try {
      const response = await fetch(`/api/rulebooks/recaps${matchId ? `/${encodeURIComponent(matchId)}` : ""}`, { signal });
      if (response.status === 404 && matchId) {
        currentRecap = undefined;
        renderFrame('<section class="recap-panel"><p role="status">Ringkasan ini bersifat privat dan belum tersedia di sesi perangkatmu.</p></section>');
        return;
      }
      if (!response.ok) throw new Error("recap-load-failed");
      const data = await response.json() as {
        recap?: RulebookMatchRecap;
        share?: RecapPublicShareState | null;
        recaps?: RulebookRecapSummary[];
      };
      if (data.recap) {
        currentRecap = data.recap;
        currentShare = data.share ?? null;
        draftAliases = currentShare ? { ...currentShare.aliases } : defaultAliasesFor(data.recap);
        renderPrivateDetail();
      } else if (data.recaps?.length) {
        currentRecap = undefined;
        renderFrame(`<ul class="recap-list recap-history">${data.recaps.map(item => `<li><a href="/?recap=${encodeURIComponent(item.matchId)}">
          <div class="recap-head-row">
            <strong>${escapeText(item.title)}</strong>
            <span class="recap-badge ${item.shared ? "recap-badge-public" : "recap-badge-private"}">${item.shared ? "Publik" : "Privat"}</span>
          </div>
          <small>${recapMeta(item)}</small></a></li>`).join("")}</ul>`);
      } else {
        currentRecap = undefined;
        renderFrame("<p>Pertandingan yang kamu selesaikan akan muncul di sini.</p>");
      }
    } catch {
      renderFrame('<p role="alert">Riwayat belum bisa dibuka. Periksa koneksi, lalu coba lagi.</p><button type="button" class="secondary" data-recap-retry>Coba lagi</button>');
      root.querySelector<HTMLButtonElement>("[data-recap-retry]")?.addEventListener("click", () => void load(), { once: true, signal });
    }
  }
  void load();
}
