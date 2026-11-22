import type {
  ClaimActiveAttemptView,
  ClaimEngineRoomView,
  ClaimSanitizedLeafChallenge,
  GeoCoordinate,
  MapConfig,
} from "@kelana-ria/contracts";
import { escapeText } from "./solo-view";
import "./rulebook-seek-play.css";

type ClaimPublicListing = {
  packId: string;
  version: number;
  format: "claim-the-city";
  isOfficial: boolean;
  title: string;
  byline: string;
  summary: string;
  cityLabel: string;
  difficulty: string;
  priceIdr: number;
  minPlayers: number;
  maxPlayers: number;
  teamMode: string;
  durationMinutes: number;
  soloTargets: { lockedLandmarks: number; distinctZones: number } | null;
  startName: string;
  zones: { id: string; name: string; label: string; landmarkCount: number }[];
  landmarkCount: number;
  challengePrimitives: string[];
  tacticalDeckSummary: { enabled: boolean; totalCards: number; maxHandSize: number };
};

type PublicLandmark = {
  id: string;
  name: string;
  zoneId: string;
  latitude: number;
  longitude: number;
  transitSummary: string;
  accessNotes: string;
};

type ClaimRoomPayload = {
  format: "claim-the-city";
  room: ClaimEngineRoomView;
  publicBoard: {
    startPoint: GeoCoordinate & { id: string; name: string };
    landmarks: PublicLandmark[];
  };
  pass: { roomCode: string; packId: string; version: number; maxPlayers: number; paid: boolean };
};

const phaseLabels: Record<ClaimEngineRoomView["phase"], string> = {
  lobby: "Ruang Tunggu",
  active: "Permainan Aktif",
  finished: "Selesai",
  abandoned: "Ditinggalkan",
  canceled: "Dibatalkan",
};

function idr(amount: number): string {
  return amount === 0 ? "Gratis (Resmi)" : `Rp ${amount.toLocaleString("id-ID")}`;
}

function getActiveLeaf(attempt: ClaimActiveAttemptView): ClaimSanitizedLeafChallenge | null {
  const payload = attempt.challenge.payload;
  if (payload.primitive === "call_your_shot") {
    return payload.activeTask ?? null;
  }
  if (payload.primitive === "multi_step") {
    return payload.steps[attempt.currentStep] ?? null;
  }
  return payload;
}

export function mountRulebookClaimPlay(root: HTMLElement, onBack: () => void): () => void {
  let listings: ClaimPublicListing[] = [];
  let roomCode = new URLSearchParams(location.search).get("room") ?? "";
  let live: ClaimRoomPayload | null = null;
  let activeOrderId: string | null = null;
  let statusMsg = "";
  let errorMsg = "";
  let busy = false;
  let showMap = true;
  let mapFailed = false;
  let mapCleanup: (() => void) | undefined;
  let seq = 0;

  async function apiJson<T>(path: string, body?: unknown): Promise<T> {
    const res = await fetch(path, {
      method: body === undefined ? "GET" : "POST",
      headers: body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return (await res.json()) as T;
  }

  function syncRoomUrl(code: string) {
    const url = new URL(location.href);
    url.searchParams.set("play", "rulebook-claim");
    url.searchParams.delete("pack");
    url.searchParams.delete("launch");
    if (code) url.searchParams.set("room", code);
    else url.searchParams.delete("room");
    history.replaceState(history.state, "", url);
  }

  async function loadCatalog() {
    const data = await apiJson<{ listings?: ClaimPublicListing[] }>("/api/rulebooks?format=claim-the-city");
    listings = (data.listings ?? []).filter((l) => l.format === "claim-the-city");
    const params = new URLSearchParams(location.search);
    const launchPackId = params.get("pack");
    const shouldLaunch = params.get("launch") === "1";
    if (!roomCode && shouldLaunch && launchPackId) {
      const target = listings.find((l) => l.packId === launchPackId && l.priceIdr === 0);
      if (target) {
        const res = await apiJson<{ ok?: boolean; roomCode?: string; error?: string }>("/api/rulebooks", {
          type: "create-free-room",
          packId: target.packId,
          version: target.version,
          hostName: "Tuan Rumah",
        });
        if (res.ok && res.roomCode) {
          roomCode = res.roomCode;
          statusMsg = `Ruang ${roomCode} siap dimainkan.`;
          await refreshRoom();
          return;
        }
      }
    }
    if (roomCode) {
      await refreshRoom(true);
    } else {
      render();
    }
  }

  async function refreshRoom(allowInvitePrompt = false) {
    if (!roomCode) return;
    const data = await apiJson<ClaimRoomPayload & { error?: string }>(
      `/api/rulebooks/rooms/${encodeURIComponent(roomCode)}`,
    );
    if ("room" in data && data.room) {
      live = data;
      errorMsg = "";
      syncRoomUrl(roomCode);
    } else if (allowInvitePrompt) {
      statusMsg = `Undangan ruang ${roomCode} terdeteksi. Masukkan namamu lalu tekan Gabung Ruang.`;
      errorMsg = "";
    } else {
      errorMsg = data.error ?? "Ruang tidak ditemukan.";
    }
    render();
  }

  async function postRoomAction(action: Record<string, unknown>) {
    if (!roomCode) return;
    busy = true;
    render();
    try {
      const res = await apiJson<{ room?: ClaimEngineRoomView; error?: string }>("/api/rulebooks", {
        type: "room-action",
        roomCode,
        action: { actionId: `claim-ui-${Date.now()}-${++seq}`, ...action },
      });
      if (res.error) errorMsg = res.error;
      else errorMsg = "";
      await refreshRoom();
    } finally {
      busy = false;
      render();
    }
  }

  async function mountMapOverlay(host: HTMLElement, payload: ClaimRoomPayload) {
    mapCleanup?.();
    mapCleanup = undefined;
    try {
      const [{ mountBoardMap }, mapCfg] = await Promise.all([
        import("./board-map"),
        apiJson<MapConfig>("/api/map/config"),
      ]);
      const stateById = new Map(payload.room.landmarks.map((l) => [l.landmarkId, l]));
      const handle = mountBoardMap({
        container: host,
        config: mapCfg,
        start: {
          id: payload.publicBoard.startPoint.id,
          name: payload.publicBoard.startPoint.name,
          latitude: payload.publicBoard.startPoint.latitude,
          longitude: payload.publicBoard.startPoint.longitude,
          x: 50,
          y: 50,
        },
        checkpoints: payload.publicBoard.landmarks.map((lm) => {
          const st = stateById.get(lm.id);
          const statusTag =
            st?.status === "locked" ? "locked" : st?.status === "claimed" ? "claimed" : "unclaimed";
          return {
            id: lm.id,
            name: lm.name,
            zone: lm.zoneId,
            latitude: lm.latitude,
            longitude: lm.longitude,
            x: 50,
            y: 50,
            claimed: st?.status === "locked",
            statusTag,
            dimmed: payload.room.ownBurnedLandmarks.includes(lm.id),
          };
        }),
        onError: () => {
          mapFailed = true;
          render();
        },
      });
      mapCleanup = handle.destroy;
    } catch {
      mapFailed = true;
    }
  }

  function renderCatalog(): string {
    return `<section class="rb-shell" aria-label="Katalog Rulebook Claim the City">
      <div class="rb-card">
        <h2>Claim the City · Rulebook Packs (1–6 Pemain)</h2>
        <p>Perebutan wilayah berbasis Klaim → Kunci → Rebut dengan tantangan tersembunyi multi-primitif dan dek kartu taktis. Semua papan, zona, dan aturan dimuat dari data RulebookPack.</p>
        <div class="rb-actions">
          <button type="button" class="secondary" data-nav="studio">Buka Studio Kreator</button>
          <button type="button" class="secondary" data-nav="back">Kembali ke Beranda</button>
        </div>
        ${statusMsg ? `<p role="status">${escapeText(statusMsg)}</p>` : ""}
        ${errorMsg ? `<p role="alert" class="rb-errors">${escapeText(errorMsg)}</p>` : ""}
      </div>

      <div class="rb-card">
        <h3>Gabung Ruang dengan Kode Undangan</h3>
        <div class="rb-grid-2">
          <label class="rb-field"><span>Kode Ruang</span><input id="rb-claim-join-code" placeholder="RC-XXXXXX" value="${escapeText(roomCode)}"></label>
          <label class="rb-field"><span>Nama Pemain</span><input id="rb-claim-join-name" value="Penantang"></label>
        </div>
        <div class="rb-actions">
          <button type="button" class="primary" data-action="join-room" ${busy ? "disabled" : ""}>Gabung Ruang</button>
        </div>
      </div>

      ${listings
        .map(
          (item) => `<article class="rb-card" data-pack-id="${escapeText(item.packId)}">
            <div class="rb-badges">
              <span class="rb-badge ${item.priceIdr > 0 ? "rb-badge-paid" : ""}">${escapeText(idr(item.priceIdr))}</span>
              <span class="rb-badge">${escapeText(item.cityLabel)}</span>
              <span class="rb-badge">${item.minPlayers}–${item.maxPlayers} pemain (${escapeText((item.teamMode ?? "ffa").toUpperCase())})</span>
              <span class="rb-badge">${item.zones.length} zona · ${item.landmarkCount} landmark</span>
              <span class="rb-badge">${item.durationMinutes} menit</span>
            </div>
            <h3>${escapeText(item.title)} <small>v${item.version}</small></h3>
            <p>${escapeText(item.summary)}</p>
            <p><small>Oleh ${escapeText(item.byline)} · Mulai: ${escapeText(item.startName)}${item.soloTargets ? ` · Target Solo: ${item.soloTargets.lockedLandmarks} kunci di ${item.soloTargets.distinctZones} zona` : ""}</small></p>
            <p><small>Dek Taktis: ${item.tacticalDeckSummary.enabled ? `${item.tacticalDeckSummary.totalCards} kartu (maks. tangan ${item.tacticalDeckSummary.maxHandSize})` : "Nonaktif"} · Primitif: ${escapeText(item.challengePrimitives.join(", "))}</small></p>
            <div class="rb-badges">
              ${item.zones.map((z) => `<span class="rb-badge">${escapeText(z.label)} · ${escapeText(z.name)} (${z.landmarkCount})</span>`).join("")}
            </div>
            <div class="rb-actions">
              ${
                item.priceIdr === 0
                  ? `<button type="button" class="primary" data-action="start-free" data-pack="${escapeText(item.packId)}" data-version="${item.version}" ${busy ? "disabled" : ""}>Buat Ruang Gratis</button>`
                  : `<button type="button" class="primary" data-action="buy-pack" data-pack="${escapeText(item.packId)}" data-version="${item.version}" ${busy ? "disabled" : ""}>Beli Pass Sesi (${escapeText(idr(item.priceIdr))} · Test Payment)</button>`
              }
            </div>
          </article>`,
        )
        .join("")}

      ${
        activeOrderId
          ? `<div class="rb-card">
              <h3>Pelunasan Midtrans Sandbox (Test Payment)</h3>
              <p>Order <code>${escapeText(activeOrderId)}</code> menunggu verifikasi pelunasan.</p>
              <button type="button" class="primary" data-action="settle-order" data-order="${escapeText(activeOrderId)}" ${busy ? "disabled" : ""}>Simulasikan Pelunasan Midtrans</button>
            </div>`
          : ""
      }
    </section>`;
  }

  function renderActiveAttempt(attempt: ClaimActiveAttemptView, room: ClaimEngineRoomView): string {
    const payload = attempt.challenge.payload;
    const leaf = getActiveLeaf(attempt);
    const swapCard = room.ownHand.find((c) => c.effect.primitive === "swap_challenge");
    const lmName = live?.publicBoard.landmarks.find((l) => l.id === attempt.landmarkId)?.name ?? attempt.landmarkId;

    return `<div class="rb-card" data-testid="active-challenge-modal">
      <div class="rb-badges">
        <span class="rb-badge">${attempt.isStealAttempt ? "⚡ Upaya Rebut & Kunci" : "🔓 Tantangan Kunci Landmark"}</span>
        <span class="rb-badge">${escapeText(payload.primitive)}</span>
        ${payload.primitive === "multi_step" ? `<span class="rb-badge">Langkah ${attempt.currentStep + 1}/2</span>` : ""}
      </div>
      <h3>${escapeText(attempt.challenge.title)} · ${escapeText(lmName)}</h3>

      ${
        payload.primitive === "call_your_shot" && !payload.chosenTier
          ? `<p>Tema: <strong>${escapeText(payload.theme)}</strong>. Pilih tingkat risiko tantanganmu:</p>
             <div class="rb-actions">
               <button type="button" class="secondary" data-action="choose-shot-tier" data-landmark="${escapeText(attempt.landmarkId)}" data-tier="standard">Standar (Aman)</button>
               <button type="button" class="primary" data-action="choose-shot-tier" data-landmark="${escapeText(attempt.landmarkId)}" data-tier="bold">Berani / Bold (+Hadiah Taktis)</button>
             </div>`
          : leaf
            ? renderLeafChallenge(leaf, attempt, room)
            : ""
      }

      <div class="rb-actions">
        ${
          swapCard
            ? `<button type="button" class="secondary" data-action="play-card" data-instance="${escapeText(swapCard.instanceId)}" data-primitive="swap_challenge" data-landmark="${escapeText(attempt.landmarkId)}">Tukar Tantangan (Swap)</button>`
            : ""
        }
        <button type="button" class="secondary" data-action="bail-challenge" data-landmark="${escapeText(attempt.landmarkId)}">Menyerah / Bail (${room.isSolo ? "Hanguskan Landmark" : "Buka untuk Direbut!"})</button>
      </div>
    </div>`;
  }

  function renderLeafChallenge(
    leaf: ClaimSanitizedLeafChallenge,
    attempt: ClaimActiveAttemptView,
    room: ClaimEngineRoomView,
  ): string {
    if (leaf.primitive === "observation_mcq") {
      return `<p>${escapeText(leaf.prompt)}</p>
        <div class="rb-list" role="radiogroup" aria-label="Pilihan jawaban">
          ${leaf.choices
            .map(
              (c, idx) => `<label><input type="radio" name="claim-mcq" value="${escapeText(c.id)}" ${idx === 0 ? "checked" : ""}> ${escapeText(c.label)}</label>`,
            )
            .join("")}
        </div>
        <div class="rb-actions">
          <button type="button" class="primary" data-action="submit-mcq" data-landmark="${escapeText(attempt.landmarkId)}">Kirim Jawaban MCQ</button>
        </div>`;
    }
    if (leaf.primitive === "observation_input") {
      return `<p>${escapeText(leaf.prompt)}</p>
        <label class="rb-field">
          <span>Jawaban (${leaf.inputMode === "number" ? "Angka" : "Teks"})</span>
          <input id="claim-input-answer" inputmode="${leaf.inputMode === "number" ? "numeric" : "text"}" placeholder="Ketik jawaban pengamatan">
        </label>
        <div class="rb-actions">
          <button type="button" class="primary" data-action="submit-input" data-landmark="${escapeText(attempt.landmarkId)}">Kirim Jawaban</button>
        </div>`;
    }
    if (leaf.primitive === "photo_proof") {
      const autoSec = attempt.pendingPhoto
        ? Math.max(0, Math.ceil((attempt.pendingPhoto.autoApproveAt - room.now) / 1000))
        : Math.round(leaf.autoApproveMs / 1000);
      return `<p>${escapeText(leaf.prompt)}</p>
        ${
          attempt.pendingPhoto
            ? `<p role="status">Foto bukti terkirim · Auto-setuju dalam ${autoSec} detik.</p>`
            : `<div class="rb-actions">
                <button type="button" class="primary" data-action="submit-photo" data-landmark="${escapeText(attempt.landmarkId)}">Unggah Foto Bukti (${escapeText(leaf.verificationMode)})</button>
              </div>`
        }`;
    }
    const remainingSec = attempt.timedDeadline
      ? Math.max(0, Math.ceil((attempt.timedDeadline - room.now) / 1000))
      : Math.round(leaf.timeLimitMs / 1000);
    return `<p>${escapeText(leaf.prompt)}</p>
      <p><span class="rb-badge rb-badge-warn">Batas waktu: ${remainingSec} dtk</span></p>
      ${
        attempt.timedStartedAt === null
          ? `<button type="button" class="primary" data-action="start-timed" data-landmark="${escapeText(attempt.landmarkId)}">Mulai Timer Tugas</button>`
          : leaf.taskType === "sub_point_gps"
            ? `<button type="button" class="primary" data-action="submit-timed-gps" data-landmark="${escapeText(attempt.landmarkId)}" data-lat="${leaf.subPoint?.latitude ?? 0}" data-lng="${leaf.subPoint?.longitude ?? 0}">Check-in Sub-Titik (${escapeText(leaf.subPoint?.label ?? "Target")})</button>`
            : leaf.taskType === "photo_proof"
              ? `<button type="button" class="primary" data-action="submit-photo" data-landmark="${escapeText(attempt.landmarkId)}">Kirim Foto Sebelum Habis Waktu</button>`
              : `<label class="rb-field"><span>Jawaban Cepat</span><input id="claim-input-answer"></label>
                 <button type="button" class="primary" data-action="submit-input" data-landmark="${escapeText(attempt.landmarkId)}">Kirim Jawaban Cepat</button>`
      }`;
  }

  function renderRoom(payload: ClaimRoomPayload): string {
    const { room, publicBoard, pass } = payload;
    const lmMetaById = new Map(publicBoard.landmarks.map((l) => [l.id, l]));
    const openToStealLandmarks = room.landmarks.filter(
      (l) => l.status === "claimed" && l.vulnerableAlertAt !== null && l.ownerTeamId !== room.teamId,
    );
    const remainingMin =
      room.deadline !== null ? Math.max(0, Math.ceil((room.deadline - room.now) / 60_000)) : null;

    return `<section class="rb-shell" aria-label="Permainan Claim the City">
      <div class="rb-card">
        <div class="rb-badges">
          <span class="rb-badge">Kode: ${escapeText(room.code)}</span>
          <span class="rb-badge">${escapeText(phaseLabels[room.phase])}</span>
          <span class="rb-badge">${room.isSolo ? "Mode Solo" : `Tim ${escapeText(room.teamId)}`}</span>
          ${remainingMin !== null ? `<span class="rb-badge">Sisa ${remainingMin} m</span>` : ""}
          ${pass.paid ? '<span class="rb-badge rb-badge-paid">Pass Berbayar</span>' : '<span class="rb-badge">Resmi Gratis</span>'}
        </div>
        <h2>${escapeText(room.packMeta.title)}</h2>
        ${
          room.soloProgress
            ? `<p><strong>Progres Solo:</strong> ${room.soloProgress.lockedLandmarks}/${room.soloProgress.targetLandmarks} landmark terkunci · ${room.soloProgress.distinctZones}/${room.soloProgress.targetZones} zona berbeda</p>`
            : ""
        }
        ${statusMsg ? `<p role="status">${escapeText(statusMsg)}</p>` : ""}
        ${errorMsg ? `<p role="alert" class="rb-errors">${escapeText(errorMsg)}</p>` : ""}
        <div class="rb-actions">
          <button type="button" class="secondary" data-action="refresh">Muat Ulang State</button>
          <button type="button" class="secondary" data-action="toggle-map">${showMap ? "Sembunyikan Peta" : "Tampilkan Peta"}</button>
          <button type="button" class="secondary" data-nav="catalog">Kembali ke Katalog</button>
        </div>
      </div>

      ${
        room.outcome
          ? `<div class="rb-card" data-testid="claim-outcome">
              <h3>Hasil Akhir · ${escapeText(room.outcome.reason)}</h3>
              <p>${room.isSolo ? (room.outcome.soloWon ? "Menang Solo! Target kunci tercapai." : "Sesi Solo berakhir.") : room.outcome.winnerTeamId ? `Pemenang: ${escapeText(room.outcome.winnerTeamId)}` : "Seri!"}</p>
            </div>`
          : ""
      }

      ${
        openToStealLandmarks.length > 0
          ? `<div class="rb-card" role="status" data-testid="open-to-steal-alert">
              <span class="rb-badge rb-badge-danger">⚡ Terbuka untuk direbut! (Open to steal!)</span>
              <p>${openToStealLandmarks.map((l) => escapeText(lmMetaById.get(l.landmarkId)?.name ?? l.landmarkId)).join(", ")} gagal dikunci lawan dan sedang rentan direbut.</p>
            </div>`
          : ""
      }

      ${
        room.phase === "lobby"
          ? `<div class="rb-card">
              <h3>Kursi Pemain (${room.seats.length}/${pass.maxPlayers})</h3>
              <p><small>Tautan undangan: <a href="${escapeText(`${location.origin}/?play=rulebook-claim&room=${encodeURIComponent(room.code)}`)}" data-testid="invite-link">${escapeText(`${location.origin}/?play=rulebook-claim&room=${room.code}`)}</a></small></p>
              <ul class="rb-list">
                ${room.seats
                  .map(
                    (s) => `<li><strong>${escapeText(s.name)}</strong> (${escapeText(s.seatId)}${s.isHost ? " · Host" : ""}) · ${s.ready ? "Siap" : "Belum siap"}</li>`,
                  )
                  .join("")}
              </ul>
              <div class="rb-actions">
                <button type="button" class="secondary" data-action="sim-start-checkin">Simulasikan Check-in Titik Awal</button>
                <button type="button" class="primary" data-action="mark-ready">Tandai Siap</button>
                <button type="button" class="primary" data-action="start-match">Mulai Permainan</button>
              </div>
            </div>`
          : ""
      }

      ${
        showMap && !mapFailed && room.phase !== "lobby"
          ? `<div class="rb-card"><h3>Peta Wilayah (Belum Diklaim / Rentan / Terkunci)</h3><div id="rb-claim-map-host" class="rb-map-host"></div></div>`
          : mapFailed
            ? `<div class="rb-card"><p role="status">Tile peta tidak tersedia — daftar zona dan landmark tetap dapat digunakan penuh.</p></div>`
            : ""
      }

      ${
        room.phase !== "lobby"
          ? `<div class="rb-card">
              <h3>Papan Skor Zona</h3>
              <ul class="rb-list">
                ${room.zones
                  .map((z) => {
                    const scorePairs = Object.entries(z.weightsByTeam)
                      .map(([team, weight]) => `${team}: ${weight}`)
                      .join(" · ");
                    return `<li>
                      <strong>${escapeText(z.label)} · ${escapeText(z.name)}</strong>
                      <span class="rb-badge">${z.controllerTeamId ? `Dikuasai ${escapeText(z.controllerTeamId)}` : "Netral"}</span>
                      <small>${escapeText(scorePairs || "Belum ada bobot")}</small>
                    </li>`;
                  })
                  .join("")}
              </ul>
            </div>`
          : ""
      }

      ${room.ownActiveAttempt ? renderActiveAttempt(room.ownActiveAttempt, room) : ""}

      ${
        room.pendingRivalPhotoReviews.length > 0
          ? `<div class="rb-card">
              <h3>Tinjauan Foto Tantangan Lawan (${room.pendingRivalPhotoReviews.length})</h3>
              <ul class="rb-list">
                ${room.pendingRivalPhotoReviews
                  .map((rev) => {
                    const sec = Math.max(0, Math.ceil((rev.autoApproveAt - room.now) / 1000));
                    return `<li>
                      <strong>${escapeText(lmMetaById.get(rev.landmarkId)?.name ?? rev.landmarkId)}</strong> · Bukti <code>${escapeText(rev.photoId)}</code> (auto-setuju ${sec} dtk)
                      <div class="rb-actions">
                        <button type="button" class="primary" data-action="review-rival-photo" data-seat="${escapeText(rev.attemptOwnerSeatId)}" data-landmark="${escapeText(rev.landmarkId)}" data-approve="true">Setujui Foto</button>
                        <button type="button" class="secondary" data-action="review-rival-photo" data-seat="${escapeText(rev.attemptOwnerSeatId)}" data-landmark="${escapeText(rev.landmarkId)}" data-approve="false">Tolak Foto</button>
                      </div>
                    </li>`;
                  })
                  .join("")}
              </ul>
            </div>`
          : ""
      }

      ${
        room.activeCurses.length > 0
          ? `<div class="rb-card">
              <h3>Kutukan Sabotase Aktif (${room.activeCurses.length})</h3>
              <ul class="rb-list">
                ${room.activeCurses
                  .map((c) => {
                    const isTarget = c.targetSeatId === room.seatId;
                    const isCaster = c.casterSeatId === room.seatId;
                    return `<li>
                      <span class="rb-badge rb-badge-danger">${escapeText(c.title)}</span>
                      <small>Target: ${escapeText(c.targetSeatId)} · Blokir: ${escapeText(c.blockerType)} · Hapus: ${escapeText(c.clearCondition.type)}</small>
                      <div class="rb-actions">
                        ${isTarget && c.clearCondition.type === "gps_detour" ? `<button type="button" class="primary" data-action="clear-curse-gps" data-curse="${escapeText(c.curseInstanceId)}">Check-in Detour GPS</button>` : ""}
                        ${isTarget && c.clearCondition.type === "photo_challenge" && !c.pendingPhoto ? `<button type="button" class="primary" data-action="submit-curse-photo" data-curse="${escapeText(c.curseInstanceId)}">Kirim Foto Bukti</button>` : ""}
                        ${isTarget && c.clearCondition.type === "honor_task" ? `<button type="button" class="primary" data-action="clear-curse-honor" data-curse="${escapeText(c.curseInstanceId)}">Selesaikan Tugas</button>` : ""}
                        ${isCaster && c.pendingPhoto ? `<button type="button" class="primary" data-action="review-curse-photo" data-curse="${escapeText(c.curseInstanceId)}" data-approve="true">Setujui Foto</button>` : ""}
                      </div>
                    </li>`;
                  })
                  .join("")}
              </ul>
            </div>`
          : ""
      }

      ${
        room.phase === "active"
          ? `<div class="rb-card">
              <h3>Dek Kartu Taktis (${room.ownHand.length})</h3>
              <ul class="rb-list">
                ${
                  room.ownHand.length === 0
                    ? "<li>Belum ada kartu taktis. Kunci atau rebut landmark untuk menarik kartu.</li>"
                    : room.ownHand
                        .map(
                          (card) => `<li>
                            <strong>${escapeText(card.title)}</strong> <span class="rb-badge">${escapeText(card.effect.primitive)}</span>
                            <small>${escapeText(card.description)}</small>
                            ${
                              card.effect.primitive !== "swap_challenge"
                                ? `<button type="button" class="secondary" data-action="play-card" data-instance="${escapeText(card.instanceId)}" data-primitive="${escapeText(card.effect.primitive)}">Mainkan Kartu</button>`
                                : ""
                            }
                          </li>`,
                        )
                        .join("")
                }
              </ul>
            </div>`
          : ""
      }

      ${
        room.phase !== "lobby"
          ? `<div class="rb-card">
              <h3>Daftar Landmark &amp; Aksi Check-in (${room.landmarks.length})</h3>
              <ul class="rb-list">
                ${room.landmarks
                  .map((lm) => {
                    const meta = lmMetaById.get(lm.landmarkId);
                    const burned = room.ownBurnedLandmarks.includes(lm.landmarkId);
                    const shielded = lm.shieldUntil !== null && lm.shieldUntil > room.now;
                    const statusBadge =
                      lm.status === "locked"
                        ? "🔒 Terkunci"
                        : lm.status === "claimed"
                          ? "◐ Rentan Direbut"
                          : "○ Belum Diklaim";
                    const scouted = room.scoutedChallenges[lm.landmarkId];
                    const canCheckIn = room.phase === "active" && lm.status !== "locked" && !burned;
                    return `<li data-landmark-id="${escapeText(lm.landmarkId)}">
                      <div><strong>${escapeText(meta?.name ?? lm.landmarkId)}</strong> <small>(${escapeText(meta?.transitSummary ?? lm.zoneId)})</small></div>
                      <div class="rb-badges">
                        <span class="rb-badge">${statusBadge}</span>
                        ${lm.ownerTeamId ? `<span class="rb-badge">Pemilik: ${escapeText(lm.ownerTeamId)}</span>` : ""}
                        ${shielded ? '<span class="rb-badge rb-badge-warn">🛡 Perisai Aktif</span>' : ""}
                        ${lm.doubleWeighted ? '<span class="rb-badge rb-badge-paid">2x Bobot</span>' : ""}
                        ${burned ? '<span class="rb-badge rb-badge-danger">Hangus (Burned)</span>' : ""}
                      </div>
                      ${scouted ? `<small>Hasil Scout: ${escapeText(scouted.title)} (${escapeText(scouted.payload.primitive)})</small>` : ""}
                      ${
                        canCheckIn
                          ? `<button type="button" class="primary" data-action="checkin-landmark" data-landmark="${escapeText(lm.landmarkId)}">${lm.status === "claimed" && lm.ownerTeamId !== room.teamId ? "Check-in & Rebut Landmark" : "Simulasikan Check-in Landmark"}</button>`
                          : ""
                      }
                    </li>`;
                  })
                  .join("")}
              </ul>
            </div>`
          : ""
      }
    </section>`;
  }

  function render() {
    root.innerHTML = live ? renderRoom(live) : renderCatalog();
    if (live && showMap && !mapFailed && live.room.phase !== "lobby") {
      const host = root.querySelector<HTMLElement>("#rb-claim-map-host");
      if (host) void mountMapOverlay(host, live);
    }
  }

  root.addEventListener("click", (event) => {
    const btn = (event.target as HTMLElement | null)?.closest<HTMLButtonElement>("button");
    if (!btn) return;
    const nav = btn.dataset.nav;
    if (nav === "back") return onBack();
    if (nav === "studio") {
      const url = new URL(location.href);
      url.searchParams.set("play", "rulebook-studio");
      url.searchParams.set("format", "claim-the-city");
      url.searchParams.delete("room");
      history.pushState({ fromChooser: true }, "", url);
      window.dispatchEvent(new PopStateEvent("popstate"));
      return;
    }
    if (nav === "catalog") {
      live = null;
      roomCode = "";
      syncRoomUrl("");
      render();
      return;
    }

    const action = btn.dataset.action;
    if (!action) return;

    void (async () => {
      if (action === "start-free") {
        busy = true;
        render();
        const res = await apiJson<{ ok?: boolean; roomCode?: string; error?: string }>("/api/rulebooks", {
          type: "create-free-room",
          packId: btn.dataset.pack,
          version: Number(btn.dataset.version ?? 1),
          hostName: "Tuan Rumah",
        });
        busy = false;
        if (res.ok && res.roomCode) {
          roomCode = res.roomCode;
          statusMsg = `Ruang Claim ${roomCode} berhasil dibuat.`;
          await refreshRoom();
        } else {
          errorMsg = res.error ?? "Gagal membuat ruang.";
          render();
        }
      } else if (action === "buy-pack") {
        busy = true;
        render();
        const res = await apiJson<{ ok?: boolean; order?: { orderId: string }; error?: string }>("/api/rulebooks", {
          type: "create-order",
          packId: btn.dataset.pack,
          version: Number(btn.dataset.version ?? 1),
        });
        busy = false;
        if (res.ok && res.order) {
          activeOrderId = res.order.orderId;
          statusMsg = `Order ${activeOrderId} dibuat (Test Payment).`;
        } else {
          errorMsg = res.error ?? "Gagal membuat pesanan.";
        }
        render();
      } else if (action === "settle-order") {
        busy = true;
        render();
        const res = await apiJson<{ ok?: boolean; pass?: { roomCode: string }; error?: string }>("/api/rulebooks", {
          type: "verify-settlement",
          orderId: btn.dataset.order,
          transactionStatus: "settlement",
          statusCode: "200",
          currency: "IDR",
          hostName: "Tuan Rumah",
        });
        busy = false;
        if (res.ok && res.pass) {
          activeOrderId = null;
          roomCode = res.pass.roomCode;
          statusMsg = `Pembayaran lunas! Ruang ${roomCode} terbuka.`;
          await refreshRoom();
        } else {
          errorMsg = res.error ?? "Verifikasi gagal.";
          render();
        }
      } else if (action === "join-room") {
        const codeInput = root.querySelector<HTMLInputElement>("#rb-claim-join-code")?.value.trim() ?? "";
        const nameInput = root.querySelector<HTMLInputElement>("#rb-claim-join-name")?.value.trim() || "Penantang";
        const res = await apiJson<{ ok?: boolean; error?: string }>("/api/rulebooks", {
          type: "join-room",
          roomCode: codeInput,
          name: nameInput,
        });
        if (res.ok) {
          roomCode = codeInput;
          await refreshRoom();
        } else {
          errorMsg = res.error ?? "Gagal bergabung.";
          render();
        }
      } else if (action === "refresh") {
        await refreshRoom();
      } else if (action === "toggle-map") {
        showMap = !showMap;
        render();
      } else if (action === "sim-start-checkin" && live) {
        const sp = live.publicBoard.startPoint;
        await postRoomAction({
          type: "check-in-start",
          fix: { latitude: sp.latitude, longitude: sp.longitude, accuracy: 10, timestamp: live.room.now },
        });
      } else if (action === "mark-ready") {
        await postRoomAction({ type: "ready", ready: true });
      } else if (action === "start-match") {
        await postRoomAction({ type: "start" });
      } else if (action === "checkin-landmark" && live) {
        const lmId = btn.dataset.landmark ?? "";
        const meta = live.publicBoard.landmarks.find((l) => l.id === lmId);
        if (!meta) return;
        await postRoomAction({
          type: "check-in-landmark",
          landmarkId: lmId,
          fix: { latitude: meta.latitude, longitude: meta.longitude, accuracy: 10, timestamp: live.room.now },
        });
      } else if (action === "choose-shot-tier") {
        await postRoomAction({
          type: "choose-shot-tier",
          landmarkId: btn.dataset.landmark,
          tier: btn.dataset.tier,
        });
      } else if (action === "start-timed") {
        await postRoomAction({ type: "start-timed-task", landmarkId: btn.dataset.landmark });
      } else if (action === "submit-mcq") {
        const choiceId = root.querySelector<HTMLInputElement>('input[name="claim-mcq"]:checked')?.value ?? "";
        await postRoomAction({ type: "submit-challenge", landmarkId: btn.dataset.landmark, choiceId });
      } else if (action === "submit-input") {
        const inputValue = root.querySelector<HTMLInputElement>("#claim-input-answer")?.value.trim() ?? "";
        await postRoomAction({ type: "submit-challenge", landmarkId: btn.dataset.landmark, inputValue });
      } else if (action === "submit-photo") {
        await postRoomAction({
          type: "submit-challenge",
          landmarkId: btn.dataset.landmark,
          photoId: `claim-photo-${Date.now()}`,
        });
      } else if (action === "submit-timed-gps" && live) {
        await postRoomAction({
          type: "submit-challenge",
          landmarkId: btn.dataset.landmark,
          fix: {
            latitude: Number(btn.dataset.lat ?? 0),
            longitude: Number(btn.dataset.lng ?? 0),
            accuracy: 10,
            timestamp: live.room.now,
          },
        });
      } else if (action === "bail-challenge") {
        await postRoomAction({ type: "bail-challenge", landmarkId: btn.dataset.landmark });
      } else if (action === "review-rival-photo") {
        await postRoomAction({
          type: "review-challenge-photo",
          targetSeatId: btn.dataset.seat,
          landmarkId: btn.dataset.landmark,
          approve: btn.dataset.approve === "true",
        });
      } else if (action === "play-card" && live) {
        const primitive = btn.dataset.primitive;
        const payloadAction: Record<string, unknown> = {
          type: "play-card",
          cardInstanceId: btn.dataset.instance,
        };
        if (primitive === "scout_challenge") {
          const target = live.room.landmarks.find((l) => l.status !== "locked");
          if (target) payloadAction.landmarkId = target.landmarkId;
        } else if (primitive === "shield_claim" || primitive === "instant_lock") {
          const target = live.room.landmarks.find((l) => l.status === "claimed" && l.ownerTeamId === live!.room.teamId);
          if (target) payloadAction.landmarkId = target.landmarkId;
        } else if (primitive === "double_weight") {
          const target = live.room.landmarks.find((l) => l.ownerTeamId === live!.room.teamId && !l.doubleWeighted);
          if (target) payloadAction.landmarkId = target.landmarkId;
        } else if (primitive === "swap_challenge") {
          payloadAction.landmarkId = btn.dataset.landmark;
        } else if (primitive === "sabotage_curse") {
          const rival = live.room.seats.find((s) => s.seatId !== live!.room.seatId);
          if (rival) payloadAction.targetSeatId = rival.seatId;
        }
        await postRoomAction(payloadAction);
      } else if (action === "clear-curse-gps" && live) {
        const sp = live.publicBoard.startPoint;
        await postRoomAction({
          type: "clear-curse-gps",
          curseInstanceId: btn.dataset.curse,
          fix: { latitude: sp.latitude, longitude: sp.longitude, accuracy: 10, timestamp: live.room.now },
        });
      } else if (action === "submit-curse-photo") {
        await postRoomAction({
          type: "submit-curse-photo",
          curseInstanceId: btn.dataset.curse,
          photoId: `curse-photo-${Date.now()}`,
        });
      } else if (action === "review-curse-photo") {
        await postRoomAction({
          type: "review-curse-photo",
          curseInstanceId: btn.dataset.curse,
          approve: btn.dataset.approve === "true",
        });
      } else if (action === "clear-curse-honor") {
        await postRoomAction({ type: "clear-curse-honor", curseInstanceId: btn.dataset.curse });
      }
    })();
  });

  void loadCatalog();
  return () => {
    mapCleanup?.();
  };
}
