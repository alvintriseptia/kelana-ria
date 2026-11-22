import type {
  ClaimActiveAttemptView,
  ClaimCardInstance,
  ClaimEngineRoomView,
  ClaimLandmarkState,
  ClaimSanitizedLeafChallenge,
  GeoCoordinate,
  RulebookPlayMode,
} from "@kelana-ria/contracts";
import type { BoardMapHandle, BoardMapUpdateOptions } from "./board-map";
import { getLocation } from "./device-location";
import { fetchMapConfig } from "./map-config";
import { isSimulatedLocationAllowed } from "./runtime-config";
import { escapeText } from "./solo-view";
import "./rulebook-seek-play.css";
import "./rulebook-claim-play.css";

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
  pass: {
    roomCode: string; packId: string; version: number; maxPlayers: number; paid: boolean;
    minPlayers?: number; mode?: RulebookPlayMode;
  };
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

type ClaimPanel = "challenge" | "cards" | "score";
const claimPanels: { id: ClaimPanel; icon: string; name: string }[] = [
  { id: "challenge", icon: "◆", name: "Tantangan" },
  { id: "cards", icon: "▣", name: "Kartu" },
  { id: "score", icon: "◈", name: "Skor" },
];

const cardLabels: Record<ClaimCardInstance["effect"]["primitive"], [string, string]> = {
  scout_challenge: ["Intai", "scout"],
  shield_claim: ["Lindungi", "shield"],
  double_weight: ["Bobot Ganda", "double"],
  swap_challenge: ["Tukar", "swap"],
  instant_lock: ["Kunci Instan", "lock"],
  sabotage_curse: ["Sabotase", "curse"],
};

function landmarkStatus(landmark: ClaimLandmarkState): string {
  if (landmark.status === "locked") return "Terkunci";
  if (landmark.status === "claimed") return "Rentan direbut";
  return "Belum diklaim";
}

function teamName(room: ClaimEngineRoomView, teamId: string): string {
  const names = room.seats.filter(seat => seat.teamId === teamId).map(seat => seat.name);
  return names.length ? names.join(", ") : teamId;
}

function clockLabel(ms: number): string {
  const seconds = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function photoPicker(target: string): string {
  return `<label class="rb-field"><span>Foto bukti (JPEG, PNG, WebP · maks. 2 MB)</span>
    <input data-cg-photo="${escapeText(target)}" type="file" accept="image/jpeg,image/png,image/webp">
  </label>`;
}

export function mountRulebookClaimPlay(root: HTMLElement, onBack: () => void): () => void {
  let allowSandboxCheckout = false;
  let listings: ClaimPublicListing[] = [];
  let roomCode = new URLSearchParams(location.search).get("room") ?? "";
  let live: ClaimRoomPayload | null = null;
  let activeOrderId: string | null = null;
  let statusMsg = "";
  let errorMsg = "";
  let busy = false;
  const lifetime = new AbortController();
  let demoLocation = false;
  let mapFailed = false;
  let claimMapHandle: BoardMapHandle | undefined;
  let claimMapRoomCode = "";
  let claimMapReq = 0;
  let seq = 0;
  let refreshSeq = 0;
  let serverOffset = 0;
  let panel: ClaimPanel = "challenge";
  let folded = false;
  let selectedId = "";
  let selectedCardId = "";
  let selectedRivalId = "";
  let challengeHandId = "";

  function cardTargets(room: ClaimEngineRoomView, card?: ClaimCardInstance): string[] {
    return room.landmarks.filter(lm => {
      const own = lm.ownerTeamId === room.teamId;
      switch (card?.effect.primitive) {
        case "scout_challenge":
          return !room.ownChallengeHand && lm.status !== "locked" && !room.scoutedChallenges[lm.landmarkId] &&
            !room.ownBurnedLandmarks.includes(lm.landmarkId);
        case "shield_claim":
          return !room.isSolo && own && lm.status === "claimed";
        case "instant_lock":
          return own && lm.status === "claimed" &&
            (!room.ownChallengeHand || room.ownActiveAttempt?.landmarkId === lm.landmarkId) &&
            (!room.ownActiveAttempt || room.ownActiveAttempt.landmarkId === lm.landmarkId);
        case "double_weight":
          return own && lm.status === "locked" && !lm.doubleWeighted;
        case "swap_challenge":
          return room.ownActiveAttempt?.landmarkId === lm.landmarkId;
        default:
          return false;
      }
    }).map(lm => lm.landmarkId);
  }

  async function apiJson<T>(path: string, body?: unknown): Promise<T> {
    const res = await fetch(path, {
      method: body === undefined ? "GET" : "POST",
      headers: body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: lifetime.signal,
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
    const data = await apiJson<{ listings?: ClaimPublicListing[]; allowSandboxCheckout?: boolean }>("/api/rulebooks?format=claim-the-city");
    allowSandboxCheckout = data.allowSandboxCheckout === true;
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

  async function refreshRoom(allowInvitePrompt = false, background = false) {
    if (!roomCode) return;
    const req = ++refreshSeq;
    const code = roomCode;
    const data = await apiJson<ClaimRoomPayload & { error?: string }>(
      `/api/rulebooks/rooms/${encodeURIComponent(code)}`,
    );
    if (req !== refreshSeq || code !== roomCode || lifetime.signal.aborted || (background && busy)) return;
    if ("room" in data && data.room) {
      serverOffset = data.room.now - Date.now();
      if (background && live && JSON.stringify({ ...live.room, now: 0 }) === JSON.stringify({ ...data.room, now: 0 })) {
        live = data;
        return;
      }
      if (data.room.outcome && !live?.room.outcome) {
        panel = "score";
        folded = false;
      }
      live = data;
      syncRoomUrl(roomCode);
    } else if (background) {
      return;
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
    const previousAttempt = live?.room.ownActiveAttempt;
    const res = await apiJson<{ room?: ClaimEngineRoomView; error?: string; distanceMeters?: number }>("/api/rulebooks", {
        type: "room-action",
        roomCode,
        action: { actionId: `claim-ui-${Date.now()}-${++seq}`, ...action },
    });
    const errors: Record<string, string> = {
      "outside-radius": "Kamu masih di luar radius check-in.",
      "inaccurate-fix": "Lokasi belum cukup akurat. Coba di area terbuka.",
      "stale-fix": "Data lokasi sudah kedaluwarsa. Coba check-in lagi.",
      "cooldown": "Tunggu hingga percobaan ulang tersedia.",
      "wrong-answer": "Jawaban kurang tepat.",
      "target-curse-limit-reached": "Lawan ini sudah mencapai batas sabotase.",
      "not-enough-players": "Undang pemain lagi sebelum memulai permainan grup.",
      "players-not-ready": "Tunggu sampai semua pemain siap sebelum memulai.",
    };
    if (res.error) {
      errorMsg = (errors[res.error] ?? res.error) +
        (res.distanceMeters !== undefined ? ` Jarak ${Math.round(res.distanceMeters)} m.` : "");
    } else if (action.type === "play-card") {
      selectedCardId = "";
    }
    if (!res.error && action.type === "check-in-landmark" && res.room?.ownActiveAttempt &&
      res.room.ownActiveAttempt.landmarkId !== previousAttempt?.landmarkId) {
      panel = "challenge";
      folded = false;
    }
    await refreshRoom();
  }

  async function submitPhoto(button: HTMLButtonElement) {
    const targetId = button.dataset.landmark ?? button.dataset.curse ?? "";
    const input = Array.from(root.querySelectorAll<HTMLInputElement>("input[data-cg-photo]"))
      .find(element => element.dataset.cgPhoto === targetId);
    const file = input?.files?.[0];
    if (!file || file.size > 2 * 1024 * 1024) {
      throw new Error("Pilih foto dengan ukuran maksimal 2 MB.");
    }
    const photoBase64 = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(",", 2)[1]);
      reader.onerror = () => reject(new Error("Foto tidak bisa dibaca."));
      reader.readAsDataURL(file);
    });
    const res = await apiJson<{ error?: string }>("/api/rulebooks/claim-photo", {
      roomCode,
      actionId: `claim-ui-${Date.now()}-${++seq}`,
      landmarkId: button.dataset.landmark,
      curseInstanceId: button.dataset.curse,
      photoBase64,
    });
    if (res.error) {
      errorMsg = res.error === "invalid-photo" ? "Foto tidak valid. Pilih JPEG, PNG, atau WebP." : res.error;
    }
    await refreshRoom();
  }

  function destroyClaimMap() {
    claimMapReq++;
    claimMapHandle?.destroy();
    claimMapHandle = undefined;
    claimMapRoomCode = "";
  }

  function buildClaimMapState(payload: ClaimRoomPayload): BoardMapUpdateOptions {
    const { room, publicBoard } = payload;
    const stateById = new Map(room.landmarks.map(lm => [lm.landmarkId, lm]));
    const targets = panel === "cards" && !folded
      ? cardTargets(room, room.ownHand.find(card => card.instanceId === selectedCardId))
      : [];
    return {
      start: {
        id: payload.publicBoard.startPoint.id,
        name: payload.publicBoard.startPoint.name,
        latitude: payload.publicBoard.startPoint.latitude,
        longitude: payload.publicBoard.startPoint.longitude,
        x: 50,
        y: 50,
      },
      startLabel: "Awal",
      fitPadding: { top: 145, bottom: 205, left: 34, right: 34 },
      selectedId,
      onSelect: selectLandmark,
      checkpoints: payload.publicBoard.landmarks.map((lm) => {
        const st = stateById.get(lm.id);
        return {
          id: lm.id,
          name: lm.name,
          zone: lm.zoneId,
          latitude: lm.latitude,
          longitude: lm.longitude,
          x: 50,
          y: 50,
          label: st ? `${landmarkStatus(st)}${st.ownerTeamId ? ` · ${teamName(room, st.ownerTeamId)}` : ""}` : lm.name,
          markerText: st?.status === "locked" ? "■" : st?.status === "claimed" ? "◆" : "●",
          markerKind: "landmark",
          selectable: true,
          ownerStyle: st?.ownerTeamId ? (st.ownerTeamId === room.teamId ? "mine" : "rival") : undefined,
          eligible: targets.includes(lm.id),
          statusTag: st?.status ?? "unclaimed",
          dimmed: room.ownBurnedLandmarks.includes(lm.id) || (targets.length > 0 && !targets.includes(lm.id)),
        };
      }),
      labels: room.zones.flatMap(zone => {
        const points = publicBoard.landmarks.filter(lm => lm.zoneId === zone.zoneId);
        if (points.length === 0) return [];
        const controller = zone.controllerTeamId;
        const soloDone = room.landmarks.some(lm => lm.zoneId === zone.zoneId && lm.status === "locked" && lm.ownerTeamId === room.teamId);
        const owner = room.isSolo ? (soloDone ? "Tercapai" : "") : controller ? (controller === room.teamId ? "Kamu" : "Lawan") : "";
        return [{
          id: `zone:${zone.zoneId}`, name: zone.name, x: 50, y: 50,
          latitude: points.reduce((sum, point) => sum + point.latitude, 0) / points.length,
          longitude: points.reduce((sum, point) => sum + point.longitude, 0) / points.length,
          markerText: owner ? `${zone.label} · ${owner}` : zone.label,
          markerKind: "zone",
          ownerStyle: owner ? (owner === "Lawan" ? "rival" : "mine") : undefined,
          label: owner || "Netral",
        }];
      }),
      onError: () => {
        mapFailed = true;
        destroyClaimMap();
        render();
      },
    };
  }

  function selectLandmark(id: string) {
    if (busy) return;
    selectedId = id;
    folded = false;
    if (panel !== "cards" || !selectedCardId) panel = "challenge";
    errorMsg = "";
    render();
  }

  async function syncClaimMapOverlay(host: HTMLElement, payload: ClaimRoomPayload) {
    if (claimMapHandle && claimMapRoomCode === payload.room.code) {
      claimMapHandle.update(buildClaimMapState(payload));
      return;
    }
    const reqId = ++claimMapReq;
    claimMapHandle?.destroy();
    claimMapHandle = undefined;
    claimMapRoomCode = payload.room.code;
    try {
      const [{ mountBoardMap }, mapCfg] = await Promise.all([
        import("./board-map"),
        fetchMapConfig(lifetime.signal),
      ]);
      if (reqId !== claimMapReq || !host.isConnected || !live || live.room.code !== payload.room.code) return;
      const handle = mountBoardMap({
        container: host,
        config: mapCfg,
        ...buildClaimMapState(live),
      });
      if (reqId !== claimMapReq) handle.destroy();
      else claimMapHandle = handle;
    } catch {
      if (reqId !== claimMapReq) return;
      mapFailed = true;
      destroyClaimMap();
      render();
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
                  : allowSandboxCheckout
                    ? `<button type="button" class="primary" data-action="buy-pack" data-pack="${escapeText(item.packId)}" data-version="${item.version}" ${busy ? "disabled" : ""}>Beli Pass Sesi (${escapeText(idr(item.priceIdr))} · Test Payment)</button>`
                    : "<p>Edisi berbayar belum tersedia pada uji publik ini.</p>"
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
            ? `<p role="status">Foto bukti terkirim · Disetujui otomatis dalam <strong data-cg-countdown="${attempt.pendingPhoto.autoApproveAt}">${clockLabel(autoSec * 1000)}</strong>.</p>`
            : `${photoPicker(attempt.landmarkId)}<div class="rb-actions">
                <button type="button" class="primary" data-action="submit-photo" data-landmark="${escapeText(attempt.landmarkId)}">Unggah Foto Bukti</button>
              </div>`
        }`;
    }
    const remainingSec = attempt.timedDeadline
      ? Math.max(0, Math.ceil((attempt.timedDeadline - room.now) / 1000))
      : Math.round(leaf.timeLimitMs / 1000);
    return `<p>${escapeText(leaf.prompt)}</p>
      <p><span class="rb-badge rb-badge-warn">Batas waktu · <strong ${attempt.timedDeadline ? `data-cg-countdown="${attempt.timedDeadline}"` : ""}>${clockLabel(remainingSec * 1000)}</strong></span></p>
      ${
        attempt.timedStartedAt === null
          ? `<button type="button" class="primary" data-action="start-timed" data-landmark="${escapeText(attempt.landmarkId)}">Mulai Timer Tugas</button>`
          : leaf.taskType === "sub_point_gps"
            ? `<button type="button" class="primary" data-action="submit-timed-gps" data-landmark="${escapeText(attempt.landmarkId)}" data-lat="${leaf.subPoint?.latitude ?? 0}" data-lng="${leaf.subPoint?.longitude ?? 0}">Check-in Sub-Titik (${escapeText(leaf.subPoint?.label ?? "Target")})</button>`
            : leaf.taskType === "photo_proof"
              ? `${photoPicker(attempt.landmarkId)}<button type="button" class="primary" data-action="submit-photo" data-landmark="${escapeText(attempt.landmarkId)}">Kirim Foto</button>`
              : `<label class="rb-field"><span>Jawaban Cepat</span><input id="claim-input-answer"></label>
                 <button type="button" class="primary" data-action="submit-input" data-landmark="${escapeText(attempt.landmarkId)}">Kirim Jawaban Cepat</button>`
      }`;
  }

  function renderClaimAlerts(payload: ClaimRoomPayload): string {
    const { room, publicBoard } = payload;
    if (room.phase !== "active") return "";
    const lmMetaById = new Map(publicBoard.landmarks.map(lm => [lm.id, lm]));
    const open = room.landmarks.filter(lm => lm.status === "claimed" && lm.vulnerableAlertAt !== null && lm.ownerTeamId !== room.teamId);
    return `${open.length ? `<div class="cg-notice" role="status" data-testid="open-to-steal-alert">
      <strong>Terbuka untuk direbut!</strong>
      <p>${open.map(lm => escapeText(lmMetaById.get(lm.landmarkId)?.name ?? lm.landmarkId)).join(", ")}</p>
    </div>` : ""}
      ${
        room.pendingRivalPhotoReviews.length > 0
          ? `<div class="rb-card">
              <h3>Tinjauan Foto Tantangan Lawan (${room.pendingRivalPhotoReviews.length})</h3>
              <ul class="rb-list">
                ${room.pendingRivalPhotoReviews
                  .map((rev) => {
                    return `<li>
                      <strong>${escapeText(lmMetaById.get(rev.landmarkId)?.name ?? rev.landmarkId)}</strong>
                      <small>Disetujui otomatis dalam <span data-cg-countdown="${rev.autoApproveAt}">${clockLabel(rev.autoApproveAt - room.now)}</span></small>
                      ${renderPhoto(room.code, rev.photoId)}
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
                    const clear = c.clearCondition;
                    return `<li>
                      <span class="rb-badge rb-badge-danger">${escapeText(c.title)}</span>
                      <p>${escapeText(c.description)}</p>
                      ${clear.type === "gps_detour" ? `<small>Check-in dalam radius ${clear.radiusMeters} m dari lokasi kategori ${escapeText(clear.poiCategory)}.</small>` : ""}
                      ${clear.type === "honor_task" ? `<small>${escapeText(clear.instruction)}</small>` : ""}
                      ${clear.type === "photo_challenge" ? `<small>${escapeText(clear.prompt)}</small>` : ""}
                      ${c.expiresAt ? `<small>Berakhir dalam <span data-cg-countdown="${c.expiresAt}">${clockLabel(c.expiresAt - room.now)}</span></small>` : ""}
                      ${isTarget && c.clearCondition.type === "photo_challenge" && !c.pendingPhoto ? photoPicker(c.curseInstanceId) : ""}
                      ${isCaster && c.pendingPhoto ? renderPhoto(room.code, c.pendingPhoto.photoId) : ""}
                      <div class="rb-actions">
                        ${isTarget && c.clearCondition.type === "gps_detour" ? `<button type="button" class="primary" data-action="clear-curse-gps" data-curse="${escapeText(c.curseInstanceId)}">Check-in Detour GPS</button>` : ""}
                        ${isTarget && c.clearCondition.type === "photo_challenge" && !c.pendingPhoto ? `<button type="button" class="primary" data-action="submit-curse-photo" data-curse="${escapeText(c.curseInstanceId)}">Kirim Foto Bukti</button>` : ""}
                        ${isTarget && c.clearCondition.type === "honor_task" ? `<button type="button" class="primary" data-action="clear-curse-honor" data-curse="${escapeText(c.curseInstanceId)}">Selesaikan Tugas</button>` : ""}
                        ${isCaster && c.pendingPhoto ? `<button type="button" class="primary" data-action="review-curse-photo" data-curse="${escapeText(c.curseInstanceId)}" data-approve="true">Setujui Foto</button>` : ""}
                        ${isCaster && c.pendingPhoto ? `<button type="button" class="secondary" data-action="review-curse-photo" data-curse="${escapeText(c.curseInstanceId)}" data-approve="false">Tolak Foto</button>` : ""}
                      </div>
                    </li>`;
                  })
                  .join("")}
              </ul>
            </div>`
          : ""
      }

`;
  }

  function renderPhoto(code: string, id: string): string {
    return `<img class="cg-proof" alt="Foto bukti untuk ditinjau" src="/api/rulebooks/rooms/${encodeURIComponent(code)}/photos/${encodeURIComponent(id)}">`;
  }

  function renderLobby(payload: ClaimRoomPayload): string {
    const { room, pass } = payload;
    const invite = `${location.origin}/?play=rulebook-claim&room=${encodeURIComponent(room.code)}`;
    const enoughPlayers = !pass.minPlayers || room.seats.length >= pass.minPlayers;
    const isHost = room.seats.some(seat => seat.seatId === room.seatId && seat.isHost);
    return `<section class="rb-shell" aria-label="Ruang Claim the City">
      <div class="rb-card">
        <div class="rb-actions cg-lobby-head">
          <div>
            <div class="rb-badges">
              <span class="rb-badge">Kode: ${escapeText(room.code)}</span>
              <span class="rb-badge">${phaseLabels[room.phase]}</span>
              ${pass.mode ? `<span class="rb-badge">${pass.mode === "solo" ? "Solo" : "Grup"}</span>` : ""}
              ${pass.paid ? '<span class="rb-badge rb-badge-paid">Pass Berbayar</span>' : ""}
            </div>
            <h2>${escapeText(room.packMeta.title)}</h2>
          </div>
          ${renderMore()}
        </div>
        ${statusMsg ? `<p role="status">${escapeText(statusMsg)}</p>` : ""}
        ${errorMsg ? `<p role="alert" class="rb-errors">${escapeText(errorMsg)}</p>` : ""}
        <h3>Kursi Pemain (${room.seats.length}/${pass.maxPlayers})</h3>
        ${pass.mode !== "solo" ? `<p><a href="${escapeText(invite)}" data-testid="invite-link">Tautan undangan ruang ${escapeText(room.code)}</a></p>` : ""}
        <ul class="rb-list">
          ${room.seats.map(seat => `<li><strong>${escapeText(seat.name)}</strong>${seat.isHost ? " · Host" : ""} · ${seat.ready ? "Siap" : "Belum siap"}</li>`).join("")}
        </ul>
        <div class="rb-actions">
          <button type="button" class="secondary" data-action="sim-start-checkin">${demoLocation ? "Simulasikan Check-in Titik Awal" : "Check-in Titik Awal"}</button>
          <button type="button" class="primary" data-action="mark-ready">Tandai Siap</button>
          ${isHost ? `<button type="button" class="primary" data-action="start-match" ${enoughPlayers ? "" : "disabled"}>Mulai Permainan</button>` : ""}
        </div>
        ${!enoughPlayers ? `<p>Undang pemain hingga ruang berisi setidaknya ${pass.minPlayers} pemain.</p>` : ""}
      </div>
    </section>`;
  }

  function renderMore(): string {
    return `<details class="sg-room-menu">
      <summary class="sg-quiet" aria-label="Lainnya">⋯</summary>
      <div class="sg-room-menu-actions">
        <button type="button" data-action="refresh">Muat Ulang Ruang</button>
        <button type="button" data-nav="catalog">Keluar ke Katalog</button>
      </div>
    </details>`;
  }

  function renderLandmark(payload: ClaimRoomPayload): string {
    const { room, publicBoard } = payload;
    const meta = publicBoard.landmarks.find(lm => lm.id === selectedId);
    const lm = room.landmarks.find(lm => lm.landmarkId === selectedId);
    if (!lm || !meta) {
      return `<div class="cg-section-title"><h2>Tantangan</h2></div>
        <p>Pilih landmark di ${mapFailed ? "daftar" : "peta"} untuk melihat status dan check-in.</p>`;
    }
    const escapedId = escapeText(lm.landmarkId);
    const rival = lm.ownerTeamId && lm.ownerTeamId !== room.teamId;
    const shielded = lm.shieldUntil !== null && lm.shieldUntil > room.now;
    const burned = room.ownBurnedLandmarks.includes(lm.landmarkId);
    const cooldown = room.ownCooldowns[lm.landmarkId] ?? 0;
    const scouted = room.scoutedChallenges[lm.landmarkId];
    let blocked = "";
    if (room.ownActiveAttempt) blocked = "Selesaikan tantangan aktif untuk check-in di sini.";
    else if (burned) blocked = "Landmark ini hangus untuk permainanmu.";
    else if (cooldown > room.now) blocked = `Coba lagi dalam <strong data-cg-countdown="${cooldown}">${clockLabel(cooldown - room.now)}</strong>.`;
    else if (rival && shielded) blocked = `Perisai lawan aktif selama <strong data-cg-countdown="${lm.shieldUntil}">${clockLabel(lm.shieldUntil! - room.now)}</strong>.`;
    const canAttempt = room.phase === "active" && lm.status !== "locked";
    const hand = room.ownChallengeHand;
    return `<div class="cg-selected" data-landmark-id="${escapedId}">
      <div class="rb-badges">
        <span class="rb-badge">${escapeText(room.zones.find(zone => zone.zoneId === lm.zoneId)?.label ?? lm.zoneId)}</span>
        <span class="rb-badge">${landmarkStatus(lm)}</span>
        ${lm.ownerTeamId ? `<span class="rb-badge">${escapeText(teamName(room, lm.ownerTeamId))}</span>` : ""}
        ${shielded ? '<span class="rb-badge rb-badge-warn">Perisai aktif</span>' : ""}
        ${lm.doubleWeighted ? '<span class="rb-badge rb-badge-paid">2× Bobot</span>' : ""}
      </div>
      <h2>${escapeText(meta.name)}</h2>
      ${meta.transitSummary ? `<p>${escapeText(meta.transitSummary)}</p>` : ""}
      ${meta.accessNotes ? `<small>${escapeText(meta.accessNotes)}</small>` : ""}
      ${scouted ? `<p>Hasil Intai · <strong>${escapeText(scouted.title)}</strong></p>` : ""}
      ${canAttempt && blocked ? `<p>${blocked}</p>` : ""}
      ${canAttempt && !blocked && hand?.length ? `<label class="rb-field"><span>Pilih tantangan</span><select data-claim-hand>
        ${hand.map(challenge => `<option value="${escapeText(challenge.id)}" ${challengeHandId === challenge.id ? "selected" : ""}>${escapeText(challenge.title)}</option>`).join("")}
      </select></label>` : ""}
      ${canAttempt && !blocked && hand?.length === 0 ? "<p>Belum ada kartu tantangan yang dapat digunakan.</p>" : ""}
      ${canAttempt && !blocked && hand?.length !== 0 ? `<button type="button" class="sg-main" data-action="checkin-landmark" data-landmark="${escapedId}">${rival ? "Check-in &amp; Rebut Landmark" : "Check-in Landmark"}</button>` : ""}
    </div>`;
  }

  function renderCards(room: ClaimEngineRoomView): string {
    if (room.phase !== "active") return "<h2>Kartu</h2><p>Permainan sudah berakhir.</p>";
    const card = room.ownHand.find(item => item.instanceId === selectedCardId);
    if (!card) {
      return `<div class="cg-section-title"><h2>Kartu Taktis</h2><span class="rb-badge">${room.ownHand.length}</span></div>
        ${room.ownHand.length === 0 ? "<p>Kunci atau rebut landmark untuk menarik kartu.</p>" : `<div class="cg-card-stack">
          ${room.ownHand.map(item => {
            const [label, art] = cardLabels[item.effect.primitive];
            return `<button type="button" class="cg-tactic" data-action="select-card" data-instance="${escapeText(item.instanceId)}">
              <span class="cg-card-art sg-reward-art cg-art-${art}" aria-hidden="true"></span>
              <span class="cg-card-copy"><small>${label}</small><strong>${escapeText(item.title)}</strong></span>
            </button>`;
          }).join("")}
        </div>`}`;
    }
    const primitive = card.effect.primitive;
    const rivals = primitive === "sabotage_curse" ? room.seats.filter(seat => seat.teamId !== room.teamId) : [];
    const targets = cardTargets(room, card);
    const targetId = primitive === "swap_challenge" ? room.ownActiveAttempt?.landmarkId : selectedId;
    const chosen = Boolean(targetId && targets.includes(targetId));
    const chosenName = chosen ? live?.publicBoard.landmarks.find(lm => lm.id === targetId)?.name : "";
    const rivalChosen = rivals.some(seat => seat.seatId === selectedRivalId);
    return `<div class="cg-section-title">
      <h2>${escapeText(card.title)}</h2>
      <button type="button" class="sg-quiet" data-action="close-card">Semua kartu</button>
    </div>
    <p>${escapeText(card.description)}</p>
    ${rivals.length ? `<div class="sg-picks" aria-label="Pilih lawan">${rivals.map(seat => `
      <button type="button" class="sg-pick" data-action="select-rival" data-seat="${escapeText(seat.seatId)}"
        aria-pressed="${seat.seatId === selectedRivalId}">${escapeText(seat.name)}</button>`).join("")}</div>` : ""}
    ${chosenName ? `<p>Target <strong>${escapeText(chosenName)}</strong></p>` : ""}
    ${!chosen && !rivals.length ? `<p>${targets.length ? `Pilih pin yang disorot di ${mapFailed ? "daftar" : "peta"}.` : "Belum ada target yang memenuhi syarat."}</p>` : ""}
    <button type="button" class="sg-main" data-action="play-card" data-instance="${escapeText(card.instanceId)}"
      data-landmark="${escapeText(chosen && targetId ? targetId : "")}" data-seat="${escapeText(rivalChosen ? selectedRivalId : "")}"
      ${chosen || rivalChosen ? "" : "disabled"}>Mainkan Kartu</button>`;
  }

  function renderResult(room: ClaimEngineRoomView): string {
    if (!room.outcome) return "";
    const outcome = room.outcome;
    const reasons: Record<typeof outcome.reason, string> = {
      time: "Waktu ronde habis.",
      all_locked: "Semua landmark terkunci.",
      solo_target_met: "Target landmark dan zona tercapai.",
      solo_impossible: "Target solo sudah tidak dapat dicapai.",
      forfeit: "Lawan keluar dari permainan.",
      abandoned: "Ruang sudah tidak aktif.",
      canceled: "Ruang dibatalkan.",
    };
    let title = "Seri!";
    if (outcome.reason === "abandoned" || outcome.reason === "canceled" || (outcome.reason === "forfeit" && !outcome.winnerTeamId)) {
      title = phaseLabels[room.phase];
    }
    else if (room.isSolo) title = outcome.soloWon ? "Menang Solo!" : "Sesi Solo Berakhir";
    else if (outcome.winnerTeamId) title = `Pemenang · ${teamName(room, outcome.winnerTeamId)}`;
    const metrics = [
      ["zonesControlled", "Zona yang dikuasai"],
      ["lockedLandmarks", "Landmark yang terkunci"],
      ["totalLandmarks", "Total landmark"],
    ] as const;
    const [leader, runnerUp] = room.standings;
    const decidingMetric = !room.isSolo && leader?.teamId === outcome.winnerTeamId && runnerUp && outcome.reason !== "forfeit"
      ? metrics.find(([key]) => leader[key] > runnerUp[key])?.[1] : undefined;
    return `<div class="cg-result" data-testid="claim-outcome"><small>Hasil Akhir</small><h2>${escapeText(title)}</h2>
      <p>${reasons[outcome.reason]}${decidingMetric ? ` Penentu kemenangan · ${decidingMetric}.` : ""}</p></div>`;
  }

  function renderScore(room: ClaimEngineRoomView): string {
    const solo = room.soloProgress;
    return `${renderResult(room)}
      ${room.outcome ? "" : "<h2>Skor Ronde</h2>"}
      ${solo ? `<div class="cg-score-grid" aria-label="Target Solo">
        <div><strong>${solo.lockedLandmarks}/${solo.targetLandmarks}</strong><small>Landmark terkunci</small></div>
        <div><strong>${solo.distinctZones}/${solo.targetZones}</strong><small>Zona berbeda</small></div>
      </div>` : `<ul class="rb-list cg-standings" aria-label="Papan Skor Zona">${room.standings.map(score => `<li>
        <strong>${escapeText(teamName(room, score.teamId))}${score.teamId === room.teamId ? " · Kamu" : ""}</strong>
        <small>${score.zonesControlled} zona · ${score.lockedLandmarks} terkunci · ${score.totalLandmarks} total landmark</small>
      </li>`).join("")}</ul>
      <p class="cg-rank-rule">Urutan skor · Zona dikuasai › Landmark terkunci › Total landmark</p>`}
      ${room.outcome ? '<button type="button" class="sg-main" data-nav="catalog">Pilih Papan Lagi</button>' : ""}`;
  }

  function renderFallback(payload: ClaimRoomPayload): string {
    const { room } = payload;
    const card = panel === "cards" && room.ownHand.find(item => item.instanceId === selectedCardId);
    const targets = card ? cardTargets(room, card) : [];
    return `<div class="cg-map-status">
      <p role="status">Peta tidak tersedia.</p>
      <button type="button" class="sg-quiet" data-action="retry-map">Coba Lagi</button>
    </div>
    <ul class="cg-landmark-list" aria-label="Daftar Landmark">${payload.publicBoard.landmarks.map(lm => {
      const state = room.landmarks.find(item => item.landmarkId === lm.id);
      return `<li><button type="button" class="sg-pick" data-action="select-landmark" data-landmark="${escapeText(lm.id)}"
        aria-pressed="${lm.id === selectedId}">${escapeText(lm.name)}<small>${targets.includes(lm.id) ? "Target · " : ""}${state ? landmarkStatus(state) : ""}</small></button></li>`;
    }).join("")}</ul>`;
  }

  function updateClocks() {
    const now = Date.now() + serverOffset;
    for (const clock of root.querySelectorAll<HTMLElement>("[data-cg-countdown]")) {
      const label = clockLabel(Number(clock.dataset.cgCountdown) - now);
      if (clock.textContent !== label) clock.textContent = label;
    }
  }

  function render() {
    if (lifetime.signal.aborted) return;
    if (!live || live.room.phase === "lobby") {
      destroyClaimMap();
      root.innerHTML = live ? renderLobby(live) : renderCatalog();
      return;
    }
    if (!root.querySelector(".cg-game")) {
      root.innerHTML = `<section class="sg-game cg-game" aria-label="Permainan Claim the City">
        <div id="rb-claim-map-host" class="sg-board cg-board"></div>
        <aside class="cg-fallback" aria-label="Papan landmark" hidden></aside>
        <header class="sg-hud cg-hud">
          <div class="sg-role cg-brand"></div>
          <div class="sg-hud-actions"><div class="sg-timer cg-timer" aria-label="Waktu ronde"></div>${renderMore()}</div>
        </header>
        <div class="cg-map-legend" aria-label="Legenda peta">● Belum diklaim <span>◆ Rentan</span> <span>■ Terkunci</span></div>
        <div class="sg-dock cg-dock">
          <div class="cg-drawer-bar"></div>
          <div class="sg-sheet cg-sheet" id="cg-panel"></div>
          <nav class="sg-nav" aria-label="Menu permainan">${claimPanels.map(item => `<button type="button"
            data-action="panel" data-panel="${item.id}"><span class="sg-nav-icon" aria-hidden="true">${item.icon}</span>${item.name}</button>`).join("")}</nav>
        </div>
      </section>`;
    }
    const game = root.querySelector<HTMLElement>(".cg-game")!;
    const { room } = live;
    const brand = game.querySelector<HTMLElement>(".cg-brand")!;
    const boardTitle = room.packMeta.title.replace(/ · Claim the City$/, "");
    const brandHtml = `<span class="sg-role-mark" aria-hidden="true">◆</span>
      <h1>Claim the City <small>${room.isSolo ? "Solo" : "Grup"}</small></h1>
      <p title="${escapeText(boardTitle)}">${escapeText(boardTitle)}</p>
      <span class="sr-only">${phaseLabels[room.phase]}</span>`;
    if (brand.innerHTML !== brandHtml) brand.innerHTML = brandHtml;
    const timer = game.querySelector<HTMLElement>(".cg-timer")!;
    if (room.deadline !== null && room.phase === "active") timer.dataset.cgCountdown = String(room.deadline);
    else {
      delete timer.dataset.cgCountdown;
      timer.textContent = "Selesai";
    }
    const fallback = game.querySelector<HTMLElement>(".cg-fallback")!;
    fallback.hidden = !mapFailed;
    const map = game.querySelector<HTMLElement>("#rb-claim-map-host")!;
    map.hidden = mapFailed;
    game.querySelector<HTMLElement>(".cg-map-legend")!.hidden = mapFailed;
    const bar = game.querySelector<HTMLElement>(".cg-drawer-bar")!;
    const own = room.standings.find(score => score.teamId === room.teamId);
    bar.innerHTML = `<span>${panel === "score" && !folded ? escapeText(room.code) : room.soloProgress
      ? `${room.soloProgress.lockedLandmarks}/${room.soloProgress.targetLandmarks} terkunci`
      : `${own?.zonesControlled ?? 0} zona · ${own?.lockedLandmarks ?? 0} terkunci`}</span>
      <button type="button" class="cg-fold" data-action="fold" aria-controls="cg-panel" aria-expanded="${!folded}">${folded ? "Buka panel ⌃" : "Lihat peta ⌄"}</button>`;
    const sheet = game.querySelector<HTMLElement>(".cg-sheet")!;
    const answer = sheet.querySelector<HTMLInputElement>("#claim-input-answer");
    const checked = sheet.querySelector<HTMLInputElement>('input[name="claim-mcq"]:checked');
    const oldDraftKey = sheet.dataset.draftKey;
    const proofInputs = new Map(Array.from(sheet.querySelectorAll<HTMLInputElement>("input[data-cg-photo]"))
      .map(input => [input.dataset.cgPhoto, input]));
    const draftKey = room.ownActiveAttempt ? JSON.stringify([room.ownActiveAttempt.landmarkId, room.ownActiveAttempt.challenge, room.ownActiveAttempt.currentStep]) : "";
    const restoreId = document.activeElement instanceof HTMLInputElement && sheet.contains(document.activeElement) ? document.activeElement.id : "";
    const selectionStart = answer?.selectionStart;
    const selectionEnd = answer?.selectionEnd;
    const previousScroll = sheet.scrollTop;
    sheet.dataset.draftKey = draftKey;
    sheet.hidden = folded;
    sheet.innerHTML = `${errorMsg ? `<p role="alert" class="rb-errors">${escapeText(errorMsg)}</p>` : ""}
      ${panel === "cards" ? renderCards(room) : panel === "score" ? renderScore(room) : `
        ${room.ownActiveAttempt
          ? renderActiveAttempt(room.ownActiveAttempt, room) + (room.ownActiveAttempt.landmarkId !== selectedId && selectedId ? renderLandmark(live) : "")
          : renderLandmark(live)}
        ${renderClaimAlerts(live)}`}`;
    if (draftKey && draftKey === oldDraftKey) {
      const newAnswer = sheet.querySelector<HTMLInputElement>("#claim-input-answer");
      if (answer && newAnswer) {
        newAnswer.value = answer.value;
        if (restoreId === newAnswer.id) {
          newAnswer.focus({ preventScroll: true });
          if (selectionStart != null && selectionEnd != null) newAnswer.setSelectionRange(selectionStart, selectionEnd);
        }
      }
      if (checked) {
        const radio = Array.from(sheet.querySelectorAll<HTMLInputElement>('input[name="claim-mcq"]')).find(input => input.value === checked.value);
        if (radio) radio.checked = true;
      }
    }
    for (const input of sheet.querySelectorAll<HTMLInputElement>("input[data-cg-photo]")) {
      const original = proofInputs.get(input.dataset.cgPhoto);
      if (original?.files?.length && (draftKey === oldDraftKey || input.dataset.cgPhoto !== room.ownActiveAttempt?.landmarkId)) {
        input.replaceWith(original);
      }
    }
    sheet.scrollTop = previousScroll;
    for (const button of sheet.querySelectorAll<HTMLButtonElement>("button[data-action]")) {
      if (busy) button.disabled = true;
    }
    for (const button of game.querySelectorAll<HTMLButtonElement>("[data-panel]")) {
      button.setAttribute("aria-pressed", String(!folded && button.dataset.panel === panel));
    }
    if (mapFailed) fallback.innerHTML = renderFallback(live);
    else void syncClaimMapOverlay(map, live);
    updateClocks();
  }

  async function locationFix(target?: GeoCoordinate) {
    if (demoLocation && target && live) {
      return { latitude: target.latitude, longitude: target.longitude, accuracy: 10, timestamp: live.room.now };
    }
    return getLocation();
  }

  root.addEventListener("change", event => {
    if (event.target instanceof HTMLSelectElement && event.target.hasAttribute("data-claim-hand")) {
      challengeHandId = event.target.value;
    }
  }, { signal: lifetime.signal });

  root.addEventListener("click", (event) => {
    const btn = (event.target as HTMLElement | null)?.closest<HTMLButtonElement>("button");
    if (!btn || busy) return;
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
      if (live?.pass.mode) return onBack();
      live = null;
      roomCode = "";
      selectedId = selectedCardId = selectedRivalId = challengeHandId = "";
      panel = "challenge";
      mapFailed = false;
      folded = false;
      statusMsg = errorMsg = "";
      refreshSeq++;
      syncRoomUrl("");
      render();
      return;
    }

    const action = btn.dataset.action;
    if (!action) return;
    if (action === "panel") {
      panel = btn.dataset.panel as ClaimPanel;
      folded = false;
    } else if (action === "fold") {
      folded = !folded;
    } else if (action === "select-card") {
      selectedCardId = btn.dataset.instance ?? "";
      selectedId = selectedRivalId = "";
    } else if (action === "close-card") {
      selectedCardId = selectedRivalId = "";
    } else if (action === "select-rival") {
      selectedRivalId = btn.dataset.seat ?? "";
    } else if (action === "select-landmark") {
      selectLandmark(btn.dataset.landmark ?? "");
      return;
    } else if (action === "retry-map") {
      mapFailed = false;
    }
    if (["panel", "fold", "select-card", "close-card", "select-rival", "retry-map"].includes(action)) {
      render();
      const focused = action === "panel" ? root.querySelector<HTMLElement>(`[data-panel="${panel}"]`)
        : action === "fold" ? root.querySelector<HTMLElement>(".cg-fold")
        : action === "select-card" ? root.querySelector<HTMLElement>('[data-action="close-card"]')
        : action === "close-card" ? root.querySelector<HTMLElement>('[data-action="select-card"]')
        : action === "select-rival" ? root.querySelector<HTMLElement>('[data-action="select-rival"][aria-pressed="true"]')
        : null;
      focused?.focus({ preventScroll: true });
      return;
    }

    busy = true;
    root.setAttribute("aria-busy", "true");
    errorMsg = "";
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
        btn.closest("details")?.removeAttribute("open");
        await refreshRoom();
      } else if (action === "sim-start-checkin" && live) {
        await postRoomAction({
          type: "check-in-start",
          fix: await locationFix(live.publicBoard.startPoint),
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
          challengeHandId: root.querySelector<HTMLSelectElement>("[data-claim-hand]")?.value,
          fix: await locationFix(meta),
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
        await submitPhoto(btn);
      } else if (action === "submit-timed-gps" && live) {
        await postRoomAction({
          type: "submit-challenge",
          landmarkId: btn.dataset.landmark,
          fix: await locationFix({
            latitude: Number(btn.dataset.lat ?? 0),
            longitude: Number(btn.dataset.lng ?? 0),
          }),
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
        await postRoomAction({
          type: "play-card",
          cardInstanceId: btn.dataset.instance,
          landmarkId: btn.dataset.landmark || undefined,
          targetSeatId: btn.dataset.seat || undefined,
        });
      } else if (action === "clear-curse-gps" && live) {
        await postRoomAction({
          type: "clear-curse-gps",
          curseInstanceId: btn.dataset.curse,
          fix: await locationFix(),
        });
      } else if (action === "submit-curse-photo") {
        await submitPhoto(btn);
      } else if (action === "review-curse-photo") {
        await postRoomAction({
          type: "review-curse-photo",
          curseInstanceId: btn.dataset.curse,
          approve: btn.dataset.approve === "true",
        });
      } else if (action === "clear-curse-honor") {
        await postRoomAction({ type: "clear-curse-honor", curseInstanceId: btn.dataset.curse });
      }
    })().catch(error => {
      if (!lifetime.signal.aborted) errorMsg = error instanceof Error ? error.message : "Aksi gagal. Coba lagi.";
    }).finally(() => {
      busy = false;
      if (lifetime.signal.aborted) return;
      root.removeAttribute("aria-busy");
      render();
    });
  }, { signal: lifetime.signal });

  void isSimulatedLocationAllowed(lifetime.signal).then(allowed => {
    demoLocation = allowed;
    if (live?.room.phase === "lobby") render();
  });
  void loadCatalog().catch(() => {
    errorMsg = "Katalog belum dapat dimuat. Coba muat ulang halaman.";
    render();
  });
  const clock = window.setInterval(updateClocks, 250);
  const poll = window.setInterval(() => {
    if (!busy && (live?.room.phase === "lobby" || live?.room.phase === "active")) {
      void refreshRoom(false, true).catch(() => {});
    }
  }, 3000);
  return () => {
    lifetime.abort();
    root.removeAttribute("aria-busy");
    window.clearInterval(clock);
    window.clearInterval(poll);
    destroyClaimMap();
  };
}
