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
import { useSignal } from "@preact/signals";
import { useEffect } from "preact/hooks";
import { fetchAuthMe, getCachedAuth, onAuthChange, openAuthModal } from "./auth-modal";
import { claimDecidingMetric, claimResultReasons } from "./rulebook-claim-result";
import { AccountChip } from "./ui/AccountChip";
import { mountPreact } from "./ui/mount";
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
  return recap.players.find((player) => player.seatId === seatId)?.name ?? "Pemain";
}

function recapMeta(
  recap: Pick<RulebookRecapSummary, "format" | "editionVersion" | "completedAt" | "simulated">,
) {
  return `${formatLabels[recap.format]} · v${recap.editionVersion} · ${date.format(recap.completedAt)}${recap.simulated ? " · QA" : ""}`;
}

function defaultAliasesFor(recap: RulebookMatchRecap) {
  const next: Record<string, string> = {};
  recap.players.forEach((player, index) => {
    next[player.seatId] = `Pemain ${index + 1}`;
  });
  return next;
}

function buildPublicPreview(
  recap: RulebookMatchRecap,
  draftAliases: Record<string, string>,
): PublicMatchRecap {
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
      const members = recap.players
        .filter((p) => p.teamId === teamId)
        .map((p) => resolved[p.seatId] ?? `Pemain ${idx + 1}`);
      teamLabelById.set(teamId, members.join(", ") || `Tim ${idx + 1}`);
    });
    const decidingMetric = claimDecidingMetric(recap.standings, recap.outcome, recap.isSolo);
    const moments: PublicRecapMoment[] = recap.highlights.slice(-3).map((event) => ({
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
        winnerLabel:
          recap.outcome.winnerTeamId && !recap.isSolo
            ? (teamLabelById.get(recap.outcome.winnerTeamId) ?? null)
            : null,
        ...(decidingMetric ? { decidingMetric } : {}),
      },
      ...(recap.soloProgress ? { soloProgress: recap.soloProgress } : {}),
      players: recap.players.map((p, idx) => ({
        alias: resolved[p.seatId] ?? `Pemain ${idx + 1}`,
        teamIndex: teamIds.indexOf(p.teamId),
      })),
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
  const turns = recap.turns.map((turn) => ({
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
      winnerLabel: recap.outcome.winnerSeatId
        ? (resolved[recap.outcome.winnerSeatId] ?? "Pemain")
        : null,
    },
    players: recap.players.map((p, idx) => ({
      alias: resolved[p.seatId] ?? `Pemain ${idx + 1}`,
    })),
    turns,
    moments: turns.slice(0, 3).map((turn) => ({
      label: `Giliran ${turn.turnNumber} · ${turn.hiderAlias}`,
      detail: `${duration(turn.adjustedMs)} · ${seekTurnReason[turn.reason]} · ${turn.answeredQuestions} pertanyaan dijawab`,
    })),
  };
  return preview;
}

function publicOutcomeTitle(recap: PublicMatchRecap) {
  if (recap.format === "claim-the-city") {
    const { outcome } = recap;
    return outcome.winnerLabel && !recap.isSolo
      ? `Pemenang · ${outcome.winnerLabel}`
      : outcome.soloWon
        ? "Menang Solo"
        : outcome.reason === "abandoned"
          ? "Ditinggalkan"
          : outcome.reason === "canceled"
            ? "Dibatalkan"
            : recap.isSolo
              ? "Sesi Solo Berakhir"
              : outcome.reason === "forfeit"
                ? "Ronde berakhir"
                : "Seri";
  }
  return recap.outcome.winnerLabel
    ? `Pemenang · ${recap.outcome.winnerLabel}`
    : recap.outcome.reason === "scored"
      ? "Seri"
      : recap.phase === "canceled"
        ? "Dibatalkan"
        : "Permainan belum lengkap";
}

function ClaimResultPanels({ recap }: { recap: ClaimMatchRecap }) {
  const { outcome, soloProgress, standings } = recap;
  const teamName = (id: string) =>
    recap.players
      .filter((player) => player.teamId === id)
      .map((player) => player.name)
      .join(", ") || id;
  const winner = outcome.winnerTeamId;
  const title =
    winner && !recap.isSolo
      ? `Pemenang · ${teamName(winner)}`
      : outcome.soloWon
        ? "Menang Solo"
        : outcome.reason === "abandoned"
          ? "Ditinggalkan"
          : outcome.reason === "canceled"
            ? "Dibatalkan"
            : recap.isSolo
              ? "Sesi Solo Berakhir"
              : outcome.reason === "forfeit"
                ? "Ronde berakhir"
                : "Seri";
  const tiebreak = claimDecidingMetric(standings, outcome, recap.isSolo);

  return (
    <>
      <section class="recap-panel" data-recap-outcome>
        <h2>{title}</h2>
        <p>{claimResultReasons[outcome.reason]}</p>
        {tiebreak && <p>Penentu kemenangan · {tiebreak}</p>}
        {soloProgress ? (
          <dl class="recap-targets">
            <div>
              <dt>Landmark terkunci</dt>
              <dd>
                {soloProgress.lockedLandmarks}/{soloProgress.targetLandmarks}
              </dd>
            </div>
            <div>
              <dt>Zona berbeda</dt>
              <dd>
                {soloProgress.distinctZones}/{soloProgress.targetZones}
              </dd>
            </div>
          </dl>
        ) : (
          <ul class="recap-list" aria-label="Skor ronde">
            {standings.map((score) => (
              <li key={score.teamId}>
                <strong>{teamName(score.teamId)}</strong>
                <small>
                  {score.zonesControlled} zona · {score.lockedLandmarks} terkunci ·{" "}
                  {score.totalLandmarks} total landmark
                </small>
              </li>
            ))}
          </ul>
        )}
      </section>
      {recap.highlights.length > 0 && (
        <section class="recap-panel" data-recap-moments>
          <h2>Momen penting</h2>
          <ul class="recap-list">
            {recap.highlights.map((event, idx) => (
              <li key={`${event.landmark}-${idx}`}>
                <strong>{event.landmark}</strong>
                <small>
                  {event.kind === "stolen" ? "Direbut" : "Dikunci"} ·{" "}
                  {playerName(recap, event.seatId)}
                </small>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

function SeekResultPanels({ recap }: { recap: SeekMatchRecap }) {
  const { winnerSeatId, reason } = recap.outcome;
  const title = winnerSeatId
    ? `Pemenang · ${playerName(recap, winnerSeatId)}`
    : reason === "scored"
      ? "Seri"
      : recap.phase === "canceled"
        ? "Dibatalkan"
        : "Permainan belum lengkap";

  return (
    <>
      <section class="recap-panel" data-recap-outcome>
        <h2>{title}</h2>
        <p>{seekReasons[reason]}</p>
      </section>
      {recap.turns.length > 0 && (
        <section class="recap-panel" data-recap-moments>
          <h2>Giliran sembunyi</h2>
          <ul class="recap-list">
            {recap.turns.map((turn) => (
              <li key={turn.turnNumber}>
                <strong>
                  {playerName(recap, turn.hiderSeatId)} · {duration(turn.adjustedMs)}
                </strong>
                <small>
                  Giliran {turn.turnNumber} · {seekTurnReason[turn.reason]} ·{" "}
                  {turn.answeredQuestions} pertanyaan dijawab
                </small>
                <small>
                  Waktu dasar {duration(turn.rawHidingMs)}
                  {turn.bonusMs + turn.trapBonusMs > 0
                    ? ` · Bonus ${duration(turn.bonusMs + turn.trapBonusMs)}`
                    : ""}
                  {turn.penaltyMs > 0 ? ` · Penalti ${duration(turn.penaltyMs)}` : ""}
                </small>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

function PublicResultPanels({
  recap,
  preview = false,
}: {
  recap: PublicMatchRecap;
  preview?: boolean;
}) {
  const title = publicOutcomeTitle(recap);
  const renderHeading = (text: string) =>
    preview ? (
      <p class="recap-preview-title">
        <strong>{text}</strong>
      </p>
    ) : (
      <h2>{text}</h2>
    );

  if (recap.format === "claim-the-city") {
    return (
      <>
        <section class="recap-panel" data-recap-outcome={!preview ? "" : undefined}>
          {renderHeading(title)}
          <p>{claimResultReasons[recap.outcome.reason]}</p>
          {recap.outcome.decidingMetric && (
            <p>Penentu kemenangan · {recap.outcome.decidingMetric}</p>
          )}
          {recap.soloProgress ? (
            <dl class="recap-targets">
              <div>
                <dt>Landmark terkunci</dt>
                <dd>
                  {recap.soloProgress.lockedLandmarks}/{recap.soloProgress.targetLandmarks}
                </dd>
              </div>
              <div>
                <dt>Zona berbeda</dt>
                <dd>
                  {recap.soloProgress.distinctZones}/{recap.soloProgress.targetZones}
                </dd>
              </div>
            </dl>
          ) : (
            <ul class="recap-list" aria-label="Skor publik">
              {recap.standings.map((score, idx) => (
                <li key={`${score.teamLabel}-${idx}`}>
                  <strong>
                    {score.teamLabel}
                    {score.isWinner ? " ★" : ""}
                  </strong>
                  <small>
                    {score.zonesControlled} zona · {score.lockedLandmarks} terkunci ·{" "}
                    {score.totalLandmarks} total landmark
                  </small>
                </li>
              ))}
            </ul>
          )}
        </section>
        {recap.moments.length > 0 && (
          <section class="recap-panel" data-recap-moments={!preview ? "" : undefined}>
            {renderHeading("Momen pilihan")}
            <ul class="recap-list">
              {recap.moments.map((moment, idx) => (
                <li key={`${moment.label}-${idx}`}>
                  <strong>{moment.label}</strong>
                  <small>{moment.detail}</small>
                </li>
              ))}
            </ul>
          </section>
        )}
      </>
    );
  }

  return (
    <>
      <section class="recap-panel" data-recap-outcome={!preview ? "" : undefined}>
        {renderHeading(title)}
        <p>{seekReasons[recap.outcome.reason]}</p>
      </section>
      {recap.turns.length > 0 && (
        <section class="recap-panel" data-recap-moments={!preview ? "" : undefined}>
          {renderHeading("Giliran sembunyi")}
          <ul class="recap-list">
            {recap.turns.map((turn) => (
              <li key={turn.turnNumber}>
                <strong>
                  {turn.hiderAlias} · {duration(turn.adjustedMs)}
                </strong>
                <small>
                  Giliran {turn.turnNumber} · {seekTurnReason[turn.reason]} ·{" "}
                  {turn.answeredQuestions} pertanyaan dijawab
                </small>
                <small>
                  Waktu dasar {duration(turn.rawHidingMs)}
                  {turn.bonusMs + turn.trapBonusMs > 0
                    ? ` · Bonus ${duration(turn.bonusMs + turn.trapBonusMs)}`
                    : ""}
                  {turn.penaltyMs > 0 ? ` · Penalti ${duration(turn.penaltyMs)}` : ""}
                </small>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

function SharedRecapView({ sharedId, signal }: { sharedId: string; signal: AbortSignal }) {
  const stateSig = useSignal<
    | { kind: "loading" }
    | { kind: "not-found" }
    | { kind: "error" }
    | { kind: "ready"; recap: PublicMatchRecap }
  >({ kind: "loading" });

  async function loadShared() {
    stateSig.value = { kind: "loading" };
    try {
      const response = await fetch(`/api/rulebooks/shared/${encodeURIComponent(sharedId)}`, {
        signal,
      });
      if (signal.aborted) return;
      if (response.status === 404) {
        stateSig.value = { kind: "not-found" };
        return;
      }
      if (!response.ok) throw new Error("shared-load-failed");
      const { recap } = (await response.json()) as { recap: PublicMatchRecap };
      if (signal.aborted) return;
      document.title = `${recap.title} · Ringkasan komunitas · Kelana Ria`;
      stateSig.value = { kind: "ready", recap };
    } catch {
      if (!signal.aborted) stateSig.value = { kind: "error" };
    }
  }

  useEffect(() => {
    document.title = "Ringkasan komunitas · Kelana Ria";
    void loadShared();
  }, [sharedId]);

  const current = stateSig.value;
  const backHref = current.kind === "ready" ? current.recap.editionHref : "/catalog";
  const backLabel = current.kind === "ready" ? `Edisi v${current.recap.editionVersion}` : "Katalog";

  return (
    <article class="recap-shell">
      <a class="recap-back" href={backHref}>
        ‹ {backLabel}
      </a>
      <h1>Ringkasan komunitas</h1>
      {current.kind === "loading" && <p role="status">Memuat ringkasan komunitas…</p>}
      {current.kind === "not-found" && (
        <section class="recap-panel">
          <p role="status">
            Ringkasan komunitas ini tidak tersedia atau sudah ditarik oleh peserta.
          </p>
        </section>
      )}
      {current.kind === "error" && (
        <>
          <p role="alert">Ringkasan komunitas belum bisa dibuka. Periksa koneksi, lalu coba lagi.</p>
          <button
            type="button"
            class="secondary"
            data-recap-retry
            onClick={() => void loadShared()}
          >
            Coba lagi
          </button>
        </>
      )}
      {current.kind === "ready" && (
        <>
          <header class="recap-panel">
            <div class="recap-head-row">
              <strong>{current.recap.title}</strong>
              <span class="recap-badge recap-badge-public">● Publik</span>
            </div>
            <p>{recapMeta(current.recap)}</p>
            <p class="recap-meta-note">
              Peserta: {current.recap.players.map((p) => p.alias).join(", ")}
            </p>
            <a
              class="recap-edition-cta"
              href={current.recap.editionHref}
              data-testid="shared-edition-link"
            >
              Lihat aturan &amp; edisi v{current.recap.editionVersion} ›
            </a>
          </header>
          <PublicResultPanels recap={current.recap} />
        </>
      )}
    </article>
  );
}

function PrivateRecapApp({ matchId, signal }: { matchId: string | null; signal: AbortSignal }) {
  const back = matchId ? "/?recaps=1" : "/catalog";
  const title = matchId ? "Ringkasan pertandingan" : "Riwayat pertandingan";

  const authSig = useSignal<AuthMeReply | null>(getCachedAuth());
  const loadStateSig = useSignal<
    | { kind: "loading" }
    | { kind: "not-found" }
    | { kind: "error" }
    | { kind: "empty" }
    | { kind: "list"; recaps: RulebookRecapSummary[] }
    | { kind: "detail"; recap: RulebookMatchRecap }
  >({ kind: "loading" });
  const shareSig = useSignal<RecapPublicShareState | null>(null);
  const draftAliasesSig = useSignal<Record<string, string>>({});
  const busySig = useSignal(false);
  const statusSig = useSignal<{ message: string; error: boolean }>({ message: "", error: false });

  async function load() {
    loadStateSig.value = { kind: "loading" };
    try {
      const response = await fetch(
        `/api/rulebooks/recaps${matchId ? `/${encodeURIComponent(matchId)}` : ""}`,
        { signal },
      );
      if (signal.aborted) return;
      if (response.status === 404 && matchId) {
        loadStateSig.value = { kind: "not-found" };
        return;
      }
      if (!response.ok) throw new Error("recap-load-failed");
      const data = (await response.json()) as {
        recap?: RulebookMatchRecap;
        share?: RecapPublicShareState | null;
        recaps?: RulebookRecapSummary[];
      };
      if (signal.aborted) return;
      if (data.recap) {
        shareSig.value = data.share ?? null;
        draftAliasesSig.value = data.share
          ? { ...data.share.aliases }
          : defaultAliasesFor(data.recap);
        loadStateSig.value = { kind: "detail", recap: data.recap };
      } else if (data.recaps?.length) {
        loadStateSig.value = { kind: "list", recaps: data.recaps };
      } else {
        loadStateSig.value = { kind: "empty" };
      }
    } catch {
      if (!signal.aborted) loadStateSig.value = { kind: "error" };
    }
  }

  async function publishShare() {
    if (!matchId || loadStateSig.value.kind !== "detail" || busySig.value) return;
    busySig.value = true;
    statusSig.value = { message: "", error: false };
    try {
      const response = await fetch(`/api/rulebooks/recaps/${encodeURIComponent(matchId)}/share`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal,
        body: JSON.stringify({ aliases: draftAliasesSig.value }),
      });
      if (!response.ok) throw new Error("share-failed");
      const data = (await response.json()) as {
        recap: RulebookMatchRecap;
        share: RecapPublicShareState;
      };
      if (signal.aborted) return;
      const wasShared = Boolean(shareSig.value);
      loadStateSig.value = { kind: "detail", recap: data.recap };
      shareSig.value = data.share;
      draftAliasesSig.value = { ...data.share.aliases };
      statusSig.value = {
        message: wasShared
          ? "Tampilan publik diperbarui."
          : "Ringkasan berhasil dibagikan ke komunitas.",
        error: false,
      };
    } catch {
      if (!signal.aborted) {
        statusSig.value = {
          message: "Gagal membagikan ringkasan. Periksa koneksi lalu coba lagi.",
          error: true,
        };
      }
    } finally {
      if (!signal.aborted) busySig.value = false;
    }
  }

  async function unshare() {
    if (!matchId || loadStateSig.value.kind !== "detail" || !shareSig.value || busySig.value) return;
    busySig.value = true;
    statusSig.value = { message: "", error: false };
    try {
      const response = await fetch(`/api/rulebooks/recaps/${encodeURIComponent(matchId)}/unshare`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal,
        body: JSON.stringify({}),
      });
      if (!response.ok) throw new Error("unshare-failed");
      const data = (await response.json()) as { recap: RulebookMatchRecap; share: null };
      if (signal.aborted) return;
      loadStateSig.value = { kind: "detail", recap: data.recap };
      shareSig.value = null;
      statusSig.value = {
        message: "Ringkasan ditarik dari komunitas. Salinan privat tetap tersimpan di Riwayatmu.",
        error: false,
      };
    } catch {
      if (!signal.aborted) {
        statusSig.value = {
          message: "Gagal menarik ringkasan. Periksa koneksi lalu coba lagi.",
          error: true,
        };
      }
    } finally {
      if (!signal.aborted) busySig.value = false;
    }
  }

  async function copyShareUrl() {
    const share = shareSig.value;
    if (!share) return;
    const shareUrl = new URL(`/?shared=${encodeURIComponent(share.shareId)}`, location.origin).href;
    try {
      await navigator.clipboard.writeText(shareUrl);
      statusSig.value = { message: "Tautan ringkasan publik disalin.", error: false };
    } catch {
      statusSig.value = { message: `Salin tautan ini: ${shareUrl}`, error: false };
    }
  }

  useEffect(() => {
    document.title = `${title} · Kelana Ria`;
    onAuthChange((next) => {
      authSig.value = next;
      void load();
    }, signal);
    if (!authSig.value) {
      void fetchAuthMe(signal).then((fresh) => {
        if (!signal.aborted) authSig.value = fresh;
      });
    }
    void load();
  }, [matchId]);

  const current = loadStateSig.value;
  const share = shareSig.value;
  const isShared = Boolean(share);
  const publicPath = share ? `/?shared=${encodeURIComponent(share.shareId)}` : "";
  const status = statusSig.value;

  return (
    <article class="recap-shell">
      <div class="recap-topbar">
        <a class="recap-back" href={back}>
          ‹ {matchId ? "Riwayat" : "Katalog"}
        </a>
        <AccountChip
          auth={authSig.value}
          onOpenAccount={() => openAuthModal({ mode: "account" })}
          onOpenAuth={() => openAuthModal({ mode: "signin" })}
        />
      </div>
      <h1>{title}</h1>

      {current.kind === "loading" && <p role="status">Memuat riwayat…</p>}
      {current.kind === "not-found" && (
        <section class="recap-panel">
          <p role="status">Ringkasan ini bersifat privat dan belum tersedia di sesi perangkatmu.</p>
        </section>
      )}
      {current.kind === "empty" && <p>Pertandingan yang kamu selesaikan akan muncul di sini.</p>}
      {current.kind === "error" && (
        <>
          <p role="alert">Riwayat belum bisa dibuka. Periksa koneksi, lalu coba lagi.</p>
          <button type="button" class="secondary" data-recap-retry onClick={() => void load()}>
            Coba lagi
          </button>
        </>
      )}
      {current.kind === "list" && (
        <ul class="recap-list recap-history">
          {current.recaps.map((item) => (
            <li key={item.matchId}>
              <a href={`/?recap=${encodeURIComponent(item.matchId)}`}>
                <div class="recap-head-row">
                  <strong>{item.title}</strong>
                  <span
                    class={`recap-badge ${item.shared ? "recap-badge-public" : "recap-badge-private"}`}
                  >
                    {item.shared ? "Publik" : "Privat"}
                  </span>
                </div>
                <small>{recapMeta(item)}</small>
              </a>
            </li>
          ))}
        </ul>
      )}
      {current.kind === "detail" && (() => {
        const recap = current.recap;
        const preview = buildPublicPreview(recap, draftAliasesSig.value);
        return (
          <>
            <header class="recap-panel">
              <div class="recap-head-row">
                <strong>{recap.title}</strong>
                <span
                  class={`recap-badge ${isShared ? "recap-badge-public" : "recap-badge-private"}`}
                  data-testid="recap-visibility-badge"
                >
                  {isShared ? "● Publik · Dibagikan" : "◆ Privat · Hanya peserta"}
                </span>
              </div>
              <p>{recapMeta(recap)}</p>
              <a class="recap-edition-link" href={editionHref(recap.packId, recap.editionVersion)}>
                Lihat edisi v{recap.editionVersion} ›
              </a>
            </header>

            {recap.format === "claim-the-city" ? (
              <ClaimResultPanels recap={recap} />
            ) : (
              <SeekResultPanels recap={recap} />
            )}

            <section class="recap-panel recap-share-card" aria-labelledby="recap-share-heading">
              <div class="recap-head-row">
                <h2 id="recap-share-heading">Bagikan ke komunitas</h2>
                <span
                  class={`recap-badge ${isShared ? "recap-badge-public" : "recap-badge-private"}`}
                >
                  {isShared ? "Publik" : "Privat"}
                </span>
              </div>
              <p>
                {isShared
                  ? `Ringkasan ini tampil di halaman edisi v${recap.editionVersion} dan bisa dibuka lewat tautan publik. Jika ditarik, salinan privat tetap aman di Riwayat.`
                  : `Ringkasan ini privat. Cek pratinjau dan atur nama alias dulu sebelum dibagikan ke halaman edisi v${recap.editionVersion}.`}
              </p>
              <p class="recap-privacy-note">
                Foto bukti, titik sembunyi, detail petunjuk, kode ruang, dan data akun tidak pernah
                ikut dibagikan.
              </p>

              {isShared && (
                <div class="recap-shared-bar">
                  <a class="recap-public-link" href={publicPath} data-testid="public-recap-link">
                    Buka ringkasan publik ›
                  </a>
                  <button
                    type="button"
                    class="secondary"
                    data-recap-action="copy-share"
                    disabled={busySig.value}
                    onClick={() => void copyShareUrl()}
                  >
                    Salin tautan
                  </button>
                </div>
              )}

              <fieldset class="recap-alias-group" disabled={busySig.value}>
                <legend>Nama tampilan publik</legend>
                <div class="recap-alias-presets">
                  <button
                    type="button"
                    class="secondary"
                    data-recap-action="use-anon-aliases"
                    onClick={() => {
                      draftAliasesSig.value = defaultAliasesFor(recap);
                      statusSig.value = {
                        message: "Alias anonim dipilih untuk pratinjau publik.",
                        error: false,
                      };
                    }}
                  >
                    Pakai alias anonim
                  </button>
                  <button
                    type="button"
                    class="secondary"
                    data-recap-action="use-room-names"
                    onClick={() => {
                      const approved: Record<string, string> = {};
                      recap.players.forEach((player, index) => {
                        approved[player.seatId] = sanitizeAlias(player.name, `Pemain ${index + 1}`);
                      });
                      draftAliasesSig.value = approved;
                      statusSig.value = {
                        message: "Nama pemain dari ruang dimasukkan ke pratinjau publik.",
                        error: false,
                      };
                    }}
                  >
                    Gunakan nama ruang
                  </button>
                </div>
                <div class="recap-alias-fields">
                  {recap.players.map((player, index) => {
                    const fallback = `Pemain ${index + 1}`;
                    const value = draftAliasesSig.value[player.seatId] ?? fallback;
                    return (
                      <label key={player.seatId} class="recap-alias-field">
                        <span>
                          {player.name} <small>(peserta {index + 1})</small>
                        </span>
                        <input
                          type="text"
                          maxLength={32}
                          value={value}
                          placeholder={fallback}
                          data-alias-seat={player.seatId}
                          onInput={(event) => {
                            draftAliasesSig.value = {
                              ...draftAliasesSig.value,
                              [player.seatId]: event.currentTarget.value,
                            };
                          }}
                        />
                      </label>
                    );
                  })}
                </div>
              </fieldset>

              <section
                class="recap-preview-box"
                aria-label="Pratinjau hasil publik"
                data-testid="public-recap-preview"
              >
                <div class="recap-preview-head">
                  <strong>{preview.title}</strong>
                  <span class="recap-badge recap-badge-public">Pratinjau publik</span>
                </div>
                <p class="recap-meta-note">
                  {recapMeta(preview)} · {preview.players.map((p) => p.alias).join(", ")}
                </p>
                <PublicResultPanels recap={preview} preview />
              </section>

              <p
                class={`recap-status ${status.error ? "recap-status-error" : ""}`}
                role={status.error ? "alert" : "status"}
                aria-live="polite"
                hidden={!status.message}
              >
                {status.message}
              </p>

              <div class="recap-share-actions">
                <button
                  type="button"
                  class="primary"
                  data-recap-action="publish"
                  disabled={busySig.value}
                  onClick={() => void publishShare()}
                >
                  {isShared ? "Perbarui tampilan publik" : "Bagikan ke komunitas"}
                </button>
                {isShared && (
                  <button
                    type="button"
                    class="secondary recap-unshare-btn"
                    data-recap-action="unshare"
                    disabled={busySig.value}
                    onClick={() => void unshare()}
                  >
                    Tarik dari komunitas
                  </button>
                )}
              </div>
            </section>
          </>
        );
      })()}
    </article>
  );
}

export function mountRulebookRecap(
  root: HTMLElement,
  matchId: string | null,
  signal: AbortSignal,
  sharedId: string | null = null,
) {
  const unmount = mountPreact(root, () =>
    sharedId ? (
      <SharedRecapView sharedId={sharedId} signal={signal} />
    ) : (
      <PrivateRecapApp matchId={matchId} signal={signal} />
    ),
  );
  signal.addEventListener("abort", unmount, { once: true });
}
