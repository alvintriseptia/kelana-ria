import type {
  LocationFix,
  GeoCoordinate,
  SeekBoardPoint,
  SeekPublicBoard,
  HideSeekQuestionFamily,
  SeekDeckHiderView,
  SeekDeckPublicView,
  SeekEngineRoomView,
} from "@kelana-ria/contracts";
import type { mountBoardMap } from "./board-map";
import { escapeText } from "./solo-view";
import { getLocation } from "./device-location";
import { fetchMapConfig } from "./map-config";
import { isSimulatedLocationAllowed } from "./runtime-config";
import { answerText, incomingQuestion, questionDeck, questionNames, questionOptions, rewardCard } from "./seek-game-panels";
import "./rulebook-seek-play.css";

type PublicListing = {
  packId: string;
  version: number;
  format: "hide-and-seek";
  isOfficial: boolean;
  title: string;
  byline: string;
  summary: string;
  cityLabel: string;
  difficulty: string;
  priceIdr: number;
  minPlayers: number;
  maxPlayers: number;
  hidingZoneRadiusMeters: number;
  headStartMinutes: number;
  searchLimitMinutes: number;
  regroupMinutes: number;
  stationCount: number;
  startName: string;
  questionFamilies: { family: string; itemCount: number; drawCount: number; keepCount: number }[];
  deckSummary: { totalCards: number; timeBonuses: number; powerups: number; curses: number; baseHandLimit: number };
};

type RoomPayload = {
  room: SeekEngineRoomView;
  publicBoard: SeekPublicBoard;
  deck: SeekDeckPublicView | SeekDeckHiderView;
  pass: { roomCode: string; packId: string; version: number; maxPlayers: number; paid: boolean };
};

const phaseLabels: Record<SeekEngineRoomView["phase"], string> = {
  lobby: "Ruang Tunggu",
  head_start: "Waktu Sembunyi (Head Start)",
  seeking: "Perburuan Makro",
  endgame: "ENDGAME (Zona Terkunci)",
  regroup: "Berkumpul Kembali",
  finished: "Selesai",
  void: "Batal",
  incomplete: "Tidak Lengkap",
  canceled: "Dibatalkan",
};

const familyLabels: Record<HideSeekQuestionFamily, string> = {
  radar: "Radar",
  thermometer: "Termometer",
  matching: "Kecocokan (Matching)",
  measuring: "Pengukuran (Measuring)",
  tentacles: "Tentacles (POI Terdekat)",
  photo: "Foto",
};

function distanceMeters(start: GeoCoordinate, end: GeoCoordinate): number {
  const radians = Math.PI / 180;
  const latDelta = (end.latitude - start.latitude) * radians;
  const lonDelta = (end.longitude - start.longitude) * radians;
  const squared = Math.sin(latDelta / 2) ** 2 +
    Math.cos(start.latitude * radians) * Math.cos(end.latitude * radians) * Math.sin(lonDelta / 2) ** 2;
  return 12_742_000 * Math.asin(Math.sqrt(Math.min(1, squared)));
}

function idr(amount: number): string {
  return amount === 0 ? "Gratis (Resmi)" : `Rp ${amount.toLocaleString("id-ID")}`;
}

export function mountRulebookSeekPlay(root: HTMLElement, onBack: () => void): () => void {
  let listings: PublicListing[] = [];
  let roomCode = new URLSearchParams(location.search).get("room") ?? "";
  let live: RoomPayload | null = null;
  let activeOrderId: string | null = null;
  let statusMsg = "";
  let errorMsg = "";
  let busy = false;
  let mapFailed = false;
  let mapHandle: ReturnType<typeof mountBoardMap> | undefined;
  let mapTurn = "";
  let focusedThermometer = "";
  let seq = 0;
  const lifecycle = new AbortController();
  type Panel = "ask" | "hand" | "history" | "board";
  let panel: Panel | null = "ask";
  let family: HideSeekQuestionFamily | null = null;
  let option = "";
  let stationId = "";
  let drawKey = "";
  let pendingId = "";
  let answerChoice = "";
  let radiusDraft = "";
  let photoPreview = "";
  let thermometerEnd: LocationFix | undefined;
  let actionPending = false;
  let keepIds = new Set<string>();
  let renderedTurn = "";
  let mapHost: HTMLElement | null = null;
  let mapKey = "";
  let mapRequest = 0;
  let mapConfigRequest: ReturnType<typeof fetchMapConfig> | undefined;
  let pollActive = false;
  let clockBase = performance.now();
  let roomNow = 0;

  function isBoardPhase(room: SeekEngineRoomView) {
    return room.phase === "head_start" || room.phase === "seeking" || room.phase === "endgame";
  }

  function closeMap() {
    mapRequest++;
    mapHandle?.destroy();
    mapHandle = undefined;
    mapHost = null;
    mapKey = "";
  }

  function clockText(milliseconds: number) {
    const seconds = Math.max(0, Math.ceil(milliseconds / 1000));
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
  }

  function updateClock() {
    const room = live?.room;
    if (!room) return;
    const now = roomNow + performance.now() - clockBase;
    root.querySelectorAll<HTMLElement>("[data-deadline]").forEach(element => {
      const text = clockText(Number(element.dataset.deadline) - now);
      if (element.textContent !== text) element.textContent = text;
    });
    const age = root.querySelector<HTMLElement>("#sg-position-age");
    if (age && room.seekerPosition) {
      const seconds = Math.floor(Math.max(0, now - room.seekerPosition.at) / 1000);
      const text = seconds < 10 ? "Baru saja" : seconds < 60 ? `${seconds} dtk lalu` : `${Math.floor(seconds / 60)} mnt lalu`;
      if (age.textContent !== text) age.textContent = text;
    }
  }

  async function locationFix(point?: GeoCoordinate): Promise<LocationFix> {
    const room = live?.room;
    if (room && point && await isSimulatedLocationAllowed(lifecycle.signal)) {
      return { latitude: point.latitude, longitude: point.longitude, accuracy: 10, timestamp: room.now };
    }
    return getLocation();
  }

  async function apiJson<T>(path: string, body?: unknown): Promise<T> {
    const res = await fetch(path, {
      method: body === undefined ? "GET" : "POST",
      headers: body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: lifecycle.signal,
    });
    return (await res.json()) as T;
  }

  function syncRoomUrl(code: string) {
    const url = new URL(location.href);
    url.searchParams.set("play", "rulebook-seek");
    url.searchParams.delete("pack");
    url.searchParams.delete("launch");
    if (code) url.searchParams.set("room", code);
    else url.searchParams.delete("room");
    history.replaceState(history.state, "", url);
  }

  async function loadCatalog() {
    const data = await apiJson<{ listings?: PublicListing[] }>("/api/rulebooks?format=hide-and-seek");
    listings = (data.listings ?? []).filter((l) => l.format === "hide-and-seek");
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
    const code = roomCode;
    const requestAction = seq;
    const data = await apiJson<RoomPayload & { error?: string }>(`/api/rulebooks/rooms/${encodeURIComponent(code)}`);
    if (code !== roomCode || (background && (busy || requestAction !== seq))) return;
    if ("room" in data && data.room) {
      const { now, ...next } = data.room;
      const previous = live;
      const unchanged = previous && JSON.stringify({ ...previous, room: { ...previous.room, now: 0 } }) ===
        JSON.stringify({ ...data, room: { ...next, now: 0 } });
      roomNow = now;
      clockBase = performance.now();
      live = data;
      syncRoomUrl(roomCode);
      if (background && unchanged) return;
    } else if (allowInvitePrompt) {
      statusMsg = `Undangan ruang ${roomCode} terdeteksi. Masukkan namamu lalu tekan Gabung Ruang.`;
      errorMsg = "";
    } else if (!background) {
      errorMsg = data.error ?? "Ruang tidak ditemukan.";
    }
    render();
  }

  async function postRoomAction(action: Record<string, unknown>): Promise<boolean> {
    if (!roomCode) return false;
    busy = true;
    render();
    try {
      const res = await apiJson<{ room?: SeekEngineRoomView; error?: string }>("/api/rulebooks", {
        type: "room-action",
        roomCode,
        action: { actionId: `ui-${Date.now()}-${++seq}`, ...action },
      });
      if (res.error) errorMsg = res.error;
      else errorMsg = "";
      await refreshRoom();
      return !res.error;
    } finally {
      busy = false;
      render();
    }
  }

  async function postDeckAction(action: Record<string, unknown>) {
    if (!roomCode) return;
    busy = true;
    render();
    try {
      const res = await apiJson<{ ok?: boolean; error?: string }>("/api/rulebooks", {
        type: "deck-action",
        roomCode,
        action,
      });
      if (res.error) errorMsg = res.error;
      else errorMsg = "";
      await refreshRoom();
    } finally {
      busy = false;
      render();
    }
  }

  async function postPlayCard(params: Record<string, unknown>) {
    if (!roomCode) return;
    busy = true;
    render();
    try {
      const res = await apiJson<{ ok?: boolean; error?: string }>("/api/rulebooks", {
        type: "play-card",
        roomCode,
        params,
      });
      if (res.error) errorMsg = res.error;
      else errorMsg = "";
      await refreshRoom();
    } finally {
      busy = false;
      render();
    }
  }

  async function mountMapOverlay(host: HTMLElement, { room, publicBoard }: RoomPayload) {
    const current = ++mapRequest;
    const turn = `${room.code}:${room.turnNumber}`;
    const camera = turn === mapTurn ? mapHandle?.getCamera() : undefined;
    mapTurn = turn;
    mapHandle?.destroy();
    mapHandle = undefined;
    try {
      const [{ mountBoardMap }, config] = await Promise.all([
        import("./board-map"),
        mapConfigRequest ??= fetchMapConfig(lifecycle.signal),
      ]);
      if (current !== mapRequest || !host.isConnected) return;
      const point = (p: SeekBoardPoint) => ({ ...p, x: 50, y: 50 });
      const anchor = room.role === "hider" && publicBoard.stations.find(station => station.id === room.ownAnchorStationId);
      const seeker = room.seekerPosition;
      const clues = room.questions.filter(question => question.askedAt >= (room.deductionResetAt ?? 0));
      const pending = clues.find(question => question.status === "pending");
      const overlays = clues.flatMap(question => question.overlay ? [question.overlay] : []);
      const radarCircles = clues.flatMap(question => question.overlay?.type === "circle" ? [{
        id: question.id,
        center: point({ ...question.overlay.center, id: question.id, name: question.label }),
        radiusMeters: question.overlay.radiusMeters,
        inside: question.overlay.inside,
      }] : []);
      const preview = room.role === "hider" && pending?.radarRadiusMeters && pending.privateComputedAnswer
        ? [{ id: pending.id, center: point({ ...pending.referencePoint, id: pending.id, name: pending.label }),
            radiusMeters: pending.radarRadiusMeters, inside: answerChoice === "yes",
            preview: !answerChoice ? "pending" as const : answerChoice === pending.privateComputedAnswer.code ? "correct" as const : "incorrect" as const }]
        : [];
      const lastThermometer = [...clues].reverse().find(question => question.thermometerStart && question.status !== "vetoed");
      const thermometer = room.thermometerStart ? { start: room.thermometerStart, end: thermometerEnd }
        : lastThermometer?.thermometerStart ? { start: lastThermometer.thermometerStart, end: lastThermometer.referencePoint } : undefined;
      const thermKey = thermometer?.end ? JSON.stringify(thermometer) : "";
      const focusPoints = thermometer?.end && thermKey !== focusedThermometer
        ? [thermometer.start, thermometer.end] : undefined;
      focusedThermometer = thermKey;
      const dockTop = root.querySelector(".sg-dock")?.getBoundingClientRect().top ?? host.clientHeight;
      const bottom = focusPoints ? Math.max(164, Math.min(host.clientHeight - 178, host.clientHeight - dockTop + 25))
        : Math.min(228, Math.floor(host.clientHeight / 3));
      const canHide = room.role === "hider" && ((room.phase === "head_start" && !room.ownAnchorStationId) || room.moveZoneUntil !== undefined);
      const candidates = room.candidateStationIds && new Set(room.candidateStationIds);
      const handle = mountBoardMap({
        container: host, config, start: point(room.turnStartPoint), startLabel: "Awal", camera: focusPoints ? undefined : camera, focusPoints,
        fitPadding: { top: 147, bottom, left: 36, right: 45 },
        startSelectable: room.role === "seeker" || (canHide && publicBoard.stations.some(station => station.id === room.turnStartPoint.id)),
        deductionBoundary: publicBoard.boundaryPolygon,
        thermometer,
        checkpoints: [
          ...publicBoard.stations.filter(station => station.id !== room.turnStartPoint.id)
            .map(station => ({ ...point(station), selectable: canHide || room.role === "seeker", dimmed: candidates ? !candidates.has(station.id) : false,
              markerKind: "station" as const, markerText: station.id === room.ownAnchorStationId ? "◆" : "•",
              label: station.id === room.ownAnchorStationId ? "Lokasi terkunci" : undefined })),
          ...(seeker ? [{ ...point({ ...seeker, id: "seeker", name: seeker.seatId === room.seatId ? "Kamu" : "Pencari" }), markerKind: "seeker" as const, markerText: "◎", label: "Check-in" }] : []),
          ...(thermometer ? [{ ...point({ ...thermometer.start, id: "thermometer-a", name: "Titik A" }), markerKind: "thermometer" as const, markerText: "A" }] : []),
          ...(thermometer?.end ? [{ ...point({ ...thermometer.end, id: "thermometer-b", name: "Titik B" }), markerKind: "thermometer" as const, markerText: "B" }] : []),
        ],
        radarCircles: [...radarCircles, ...preview],
        deductionOverlays: overlays.filter(overlay => overlay.type !== "circle"),
        hidingZone: anchor && room.ownHidingZoneRadiusMeters ? { center: anchor, radiusMeters: room.ownHidingZoneRadiusMeters } : undefined,
        onSelect: id => {
          if (busy || actionPending) return;
          stationId = id;
          if (panel === "ask" && family === "thermometer") return;
          panel = "board";
          render();
          root.querySelector<HTMLElement>("#sg-panel-title")?.focus({ preventScroll: true });
        },
        onError: () => queueMicrotask(() => {
          if (current !== mapRequest || mapFailed) return;
          mapFailed = true;
          if (room.role !== "hider" || panel !== "hand" || (!pending && !(live?.deck as SeekDeckHiderView | undefined)?.activeDraw)) {
            panel = "board";
          }
          render();
        }),
      });
      mapHandle = handle;
    } catch {
      if (current !== mapRequest) return;
      mapFailed = true;
      if (room.role !== "hider" || panel !== "hand") panel = "board";
      render();
    }
  }

  function renderCatalog(): string {
    return `<section class="rb-shell" aria-label="Katalog Rulebook Hide & Seek">
      <div class="rb-card">
        <h2>Hide &amp; Seek · Rulebook Packs (2–6 Pemain)</h2>
        <p>Pilih edisi resmi gratis atau paket kreator komunitas berbasis RulebookPack. Semua aturan, zona sembunyi, buku petunjuk, dan dek kartu dimuat dari data paket.</p>
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
          <label class="rb-field"><span>Kode Ruang</span><input id="rb-join-code" placeholder="RB-XXXXXX" value="${escapeText(roomCode)}"></label>
          <label class="rb-field"><span>Nama Pemain</span><input id="rb-join-name" value="Pemain Baru"></label>
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
              <span class="rb-badge">${item.minPlayers}–${item.maxPlayers} pemain</span>
              <span class="rb-badge">Zona ${item.hidingZoneRadiusMeters} m</span>
              <span class="rb-badge">${item.stationCount} stasiun</span>
            </div>
            <h3>${escapeText(item.title)} <small>v${item.version}</small></h3>
            <p>${escapeText(item.summary)}</p>
            <p><small>Oleh ${escapeText(item.byline)} · Mulai: ${escapeText(item.startName)} · Head start ${item.headStartMinutes}m / Cari ${item.searchLimitMinutes}m / Regroup ${item.regroupMinutes}m</small></p>
            <p><small>Dek: ${item.deckSummary.totalCards} kartu (${item.deckSummary.timeBonuses} bonus, ${item.deckSummary.powerups} powerup, ${item.deckSummary.curses} kutukan · batas tangan ${item.deckSummary.baseHandLimit})</small></p>
            <div class="rb-badges">
              ${item.questionFamilies.map((f) => `<span class="rb-badge">${escapeText(f.family)} (${f.itemCount} · ${f.drawCount}/${f.keepCount})</span>`).join("")}
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

  function renderRoom(payload: RoomPayload): string {
    const { room, pass } = payload;
    const isHider = room.role === "hider";


    return `<section class="rb-shell" aria-label="Permainan Hide & Seek">
      <div class="rb-card">
        <div class="rb-badges">
          <span class="rb-badge">Kode: ${escapeText(room.code)}</span>
          <span class="rb-badge">${escapeText(phaseLabels[room.phase])}</span>
          <span class="rb-badge">Giliran ${room.turnNumber}/${room.totalPlannedTurns}</span>
          <span class="rb-badge">Peran: ${escapeText(isHider ? "Penyembunyi (Hider)" : room.role === "seeker" ? "Pencari (Seeker)" : "Lobi")}</span>
          ${pass.paid ? '<span class="rb-badge rb-badge-paid">Pass Berbayar</span>' : '<span class="rb-badge">Resmi Gratis</span>'}
        </div>
        <h2>${escapeText(room.packMeta.title)}</h2>
        ${statusMsg ? `<p role="status">${escapeText(statusMsg)}</p>` : ""}
        ${errorMsg ? `<p role="alert" class="rb-errors">${escapeText(errorMsg)}</p>` : ""}
        <div class="rb-actions">
          <button type="button" class="secondary" data-action="refresh">Muat Ulang State</button>
          <button type="button" class="secondary" data-nav="catalog">Kembali ke Katalog</button>
        </div>
      </div>

      ${
        room.phase === "lobby"
          ? `<div class="rb-card">
              <h3>Kursi Pemain (${room.seats.length}/${pass.maxPlayers})</h3>
              <p><small>Tautan undangan: <a href="${escapeText(`${location.origin}/?play=rulebook-seek&room=${encodeURIComponent(room.code)}`)}" data-testid="invite-link">${escapeText(`${location.origin}/?play=rulebook-seek&room=${room.code}`)}</a></small></p>
              <ul class="rb-list">
                ${room.seats
                  .map(
                    (s) => `<li><strong>${escapeText(s.name)}</strong> (${escapeText(s.seatId)}${s.isHost ? " · Host" : ""}) · ${s.ready ? "Siap" : "Belum siap"}</li>`,
                  )
                  .join("")}
              </ul>
              <div class="rb-actions">
                <button type="button" class="secondary" data-action="sim-start-checkin">Check-in di ${escapeText(room.turnStartPoint.name)}</button>
                <button type="button" class="primary" data-action="mark-ready">Tandai Siap</button>
                <button type="button" class="primary" data-action="start-match">Mulai Permainan</button>
              </div>
            </div>`
          : ""
      }

      ${room.outcome ? `<div class="rb-card">
        <h3>Hasil permainan</h3>
        <p>${escapeText(room.seats.find(seat => seat.seatId === room.outcome?.winnerSeatId)?.name ?? "Tidak ada pemenang")}</p>
        <ul class="rb-list">${room.turns.map(turn => `<li>
          <strong>${escapeText(room.seats.find(seat => seat.seatId === turn.hiderSeatId)?.name ?? "Penyembunyi")}</strong>
          <span>${clockText(turn.adjustedMs)}</span></li>`).join("")}</ul>
      </div>` : ""}

      ${room.phase === "regroup" ? `<div class="rb-card">
        <h3>Berkumpul Kembali</h3>
        ${room.regroupPoint ? `<p>Titik awal berikutnya · ${escapeText(room.regroupPoint.name)}</p>` : ""}
        ${room.phaseEndsAt === null ? "" : `<p>Sisa waktu berkumpul · <span data-deadline="${room.phaseEndsAt}"></span></p>`}
        <button type="button" class="primary" data-action="regroup">Check-in untuk giliran berikutnya</button>
      </div>` : ""}

      <div class="rb-card">
        <h3>Riwayat Petunjuk (${room.questions.length})</h3>
        <ul class="rb-list">
          ${
            room.questions.length === 0
              ? "<li>Belum ada petunjuk yang diajukan pada giliran ini.</li>"
              : room.questions
                  .map(
                    (q) => `<li>
                      <strong>${escapeText(familyLabels[q.family])} · ${escapeText(q.label)}</strong>
                      <small>Status: ${escapeText(q.status)}${q.answerLabel ? ` · Jawaban: ${escapeText(q.answerLabel)}` : ""}</small>
                    </li>`,
                  )
                  .join("")
          }
        </ul>
      </div>
    </section>`;
  }

  function renderCurses({ room, deck }: RoomPayload) {
    const isHider = room.role === "hider";
    return deck.activeCurses.length > 0
          ? `<div class="rb-card">
              <h3>Kutukan Aktif (${deck.activeCurses.length})</h3>
              <ul class="rb-list">
                ${deck.activeCurses
                  .map((c) => {
                    const penalty = c.effectModifiers.find((m) => m.type === "skip_penalty_minutes");
                    const autoApproveSec = c.pendingPhoto
                      ? Math.max(0, Math.ceil((c.pendingPhoto.autoApproveAt - room.now) / 1000))
                      : null;
                    return `<li>
                      <span class="rb-badge rb-badge-danger">${escapeText(c.title)}</span>
                      <p>${escapeText(c.description)}</p>
                      <small>Blokir: ${escapeText(c.blockerType)} · Kondisi hapus: ${escapeText(c.clearCondition.type)}</small>
                      ${
                        c.pendingPhoto
                          ? `<p><small>Foto bukti terkirim · Auto-setuju dalam ${autoApproveSec} dtk</small></p>`
                          : ""
                      }
                      <div class="rb-actions">
                        ${
                          !isHider && c.clearCondition.type === "gps_detour"
                            ? `<button type="button" class="primary" data-action="clear-curse-gps" data-curse="${escapeText(c.curseInstanceId)}">Check-in Detour GPS</button>`
                            : ""
                        }
                        ${
                          !isHider && c.clearCondition.type === "photo_challenge" && !c.pendingPhoto
                            ? `<button type="button" class="primary" data-action="submit-curse-photo" data-curse="${escapeText(c.curseInstanceId)}">Kirim Foto Bukti</button>`
                            : ""
                        }
                        ${
                          !isHider && c.clearCondition.type === "honor_task"
                            ? `<button type="button" class="primary" data-action="clear-curse-honor" data-curse="${escapeText(c.curseInstanceId)}">Selesaikan Tugas</button>`
                            : ""
                        }
                        ${
                          !isHider && penalty && penalty.type === "skip_penalty_minutes"
                            ? `<button type="button" class="secondary" data-action="buyout-curse" data-curse="${escapeText(c.curseInstanceId)}">Buyout (+${penalty.penaltyMinutes} m)</button>`
                            : ""
                        }
                        ${
                          isHider && c.pendingPhoto
                            ? `<button type="button" class="primary" data-action="review-curse-photo" data-curse="${escapeText(c.curseInstanceId)}" data-approve="true">Setujui Foto</button>
                               <button type="button" class="secondary" data-action="review-curse-photo" data-curse="${escapeText(c.curseInstanceId)}" data-approve="false">Tolak Foto</button>`
                            : ""
                        }
                      </div>
                    </li>`;
                  })
                  .join("")}
              </ul>
            </div>`
          : "";
  }

  function renderBoardControls({ room, publicBoard }: RoomPayload) {
    const isHider = room.role === "hider";
    const canHide = isHider && ((room.phase === "head_start" && !room.ownAnchorStationId) || room.moveZoneUntil !== undefined);
    const checkpoints = canHide ? publicBoard.stations : [room.turnStartPoint, ...publicBoard.stations.filter(point => point.id !== room.turnStartPoint.id)];
    const selected = checkpoints.find(station => station.id === stationId);
    const stationList = mapFailed && (canHide || !isHider) ? `<div class="sg-picks" role="group" aria-label="Pilih titik">${checkpoints.map(station =>
      `<button type="button" class="sg-pick" data-action="select-station" data-station="${escapeText(station.id)}" aria-pressed="${station.id === selected?.id}">${escapeText(station.name)}</button>`
    ).join("")}</div>` : "";
    return `<h2 id="sg-panel-title" tabindex="-1">${canHide ? "Pilih tempat sembunyi" : selected ? escapeText(selected.name) : "Check-in"}</h2>
      ${room.phase === "head_start" ? `<p>${isHider ? (canHide ? "Pilih stasiun pada peta, lalu kunci lokasi sebelum pencarian dimulai." : "Lokasi terkunci. Tetap di zona sampai waktu sembunyi habis.") : "Pencarian dimulai saat waktu sembunyi habis."}</p>` : ""}
      ${mapFailed ? '<p role="status">Peta tidak tersedia. Pilih titik dari daftar.</p><button type="button" class="sg-quiet" data-action="retry-map">Muat ulang peta</button>' : ""}
      ${stationList}
      ${canHide && selected ? `<button type="button" class="sg-main" data-action="lock-anchor" data-station="${escapeText(selected.id)}" ${busy ? "disabled" : ""}>Kunci lokasi</button>` : ""}
      ${!isHider && room.phase === "seeking" ? `<button type="button" class="sg-pick" data-action="seeker-check-in" ${busy ? "disabled" : ""}>Perbarui posisi</button>` : ""}
      ${!isHider && room.phase !== "head_start" ? `<button type="button" class="sg-main" data-action="trigger-endgame" data-station="${escapeText(selected?.id ?? "")}" ${busy ? "disabled" : ""}>Check-in turun dari transit</button>` : ""}
      ${isHider && room.phase === "endgame" && room.foundCode ? `<p>Berikan kode saat pencari menemukanmu.</p>
        <div class="rb-found-code" data-testid="hider-found-code">${escapeText(room.foundCode)}</div>
        ${room.hiderFrozen ? "<p>Posisi terkunci</p>" : '<button type="button" class="sg-main" data-action="confirm-freeze">Kunci posisi sekarang</button>'}` : ""}
      ${!isHider && room.phase === "endgame" ? `<div class="rb-field">
        <label for="rb-found-input">Kode temuan 4 digit</label>
        <input id="rb-found-input" inputmode="numeric" maxlength="4" placeholder="1234">
        <button type="button" class="sg-main" data-action="submit-found-code">Konfirmasi temuan</button>
      </div>` : ""}`;
  }

  function renderGamePanel(payload: RoomPayload, deal: boolean): string {
    const { room, deck, publicBoard } = payload;
    if (panel === "board") return renderBoardControls(payload) + renderCurses(payload);
    if (panel === "history") return `<h2 id="sg-panel-title" tabindex="-1">Riwayat petunjuk</h2>
      <ul class="rb-list">${room.questions.length === 0 ? "<li>Belum ada petunjuk.</li>" : [...room.questions].reverse().map(question =>
        `<li><strong>${questionNames[question.family]} · ${escapeText(question.label)}</strong>
        <small>${escapeText(question.answerLabel ? answerText(question.answerLabel) : question.status === "pending" ? "Menunggu jawaban" : "Pertanyaan ditutup")}</small>
        ${question.photoId ? `<img class="sg-clue-photo" src="/api/rulebooks/rooms/${encodeURIComponent(room.code)}/photos/${encodeURIComponent(question.photoId)}" alt="Foto petunjuk" loading="lazy">` : ""}</li>`
      ).join("")}</ul>`;
    const pending = room.questions.find(question => question.status === "pending");
    if (panel === "ask") {
      if (room.phase === "head_start") return '<h2 id="sg-panel-title" tabindex="-1">Tunggu waktu sembunyi</h2>';
      if (pending) return `<h2 id="sg-panel-title" tabindex="-1">Menunggu jawaban</h2>
        <p>${escapeText(pending.label)} · <span data-deadline="${pending.deadline}"></span></p>`;
      if (family) {
        const entries = room.menu.filter(entry => entry.family === family);
        const picked = entries.find(entry => entry.itemId === option);
        const thermometer = family === "thermometer" ? {
          started: room.thermometerStart !== null,
          distance: room.thermometerStart && thermometerEnd ? distanceMeters(room.thermometerStart, thermometerEnd) : undefined,
        } : undefined;
        return questionOptions(family, entries, picked, deck.questionsBlocked || deck.bannedFamilies.includes(family), thermometer, busy);
      }
      return questionDeck(room.menu);
    }
    if (panel !== "hand" || room.role !== "hider") return "";
    const { activeDraw, hand, currentHandLimit } = deck as SeekDeckHiderView;
    if (activeDraw) return `<h2 id="sg-panel-title" tabindex="-1">Pilih kartu untuk disimpan</h2>
      <p class="sg-reward-note">Simpan ${activeDraw.keepCount} dari ${activeDraw.cards.length} · <span data-deadline="${activeDraw.deadline}"></span></p>
      <div class="sg-reward-grid ${deal ? "sg-deal" : ""}" data-count="${activeDraw.cards.length}">
        ${activeDraw.cards.map(card => rewardCard(card,
          `type="button" data-action="choose-draw" data-instance="${escapeText(card.instanceId)}" ${busy ? "disabled" : ""}`,
          keepIds.has(card.instanceId))).join("")}
      </div>
      ${activeDraw.keepCount > 1 ? `<button type="button" class="sg-main" data-action="confirm-draw" ${busy || keepIds.size !== activeDraw.keepCount ? "disabled" : ""}>Simpan ${keepIds.size}/${activeDraw.keepCount} kartu</button>` : ""}`;
    if (pending) {
      const alternatives = hand.filter(card => card.effect.primitive === "veto" || card.effect.primitive === "randomize");
      const extras = alternatives.map(card => `<button type="button" class="sg-pick" data-action="play-card"
        data-instance="${escapeText(card.instanceId)}" data-primitive="${card.effect.primitive}" ${busy ? "disabled" : ""}>${escapeText(card.title)}</button>`).join("")
        + (room.phase === "endgame" ? `<button type="button" class="sg-pick" data-action="cannot-answer" data-qid="${escapeText(pending.id)}" ${busy ? "disabled" : ""}>Tidak bisa menjawab</button>` : "");
      return incomingQuestion(pending, answerChoice, publicBoard.pois, photoPreview, extras, busy) + `<p>Jawab dalam <span data-deadline="${pending.deadline}"></span></p>`;
    }
    return `<h2 id="sg-panel-title" tabindex="-1">Tangan Penyembunyi (${hand.length}/${currentHandLimit})</h2>
      ${hand.length === 0 ? "<p>Jawab pertanyaan untuk mengambil kartu.</p>" : `<div class="sg-reward-grid" data-count="${hand.length}">
        ${hand.map(card => {
          const primitive = card.effect.primitive;
          const canPlay = ["expand_hand", "discard_draw", "duplicate", "time_trap", "move_zone", "curse"].includes(primitive);
          return canPlay ? rewardCard(card, `type="button" data-action="play-card" data-instance="${escapeText(card.instanceId)}" data-primitive="${escapeText(primitive)}" ${busy ? "disabled" : ""}`) : rewardCard(card);
        }).join("")}
      </div>`}`;
  }

  function render() {
    if (lifecycle.signal.aborted) return;
    const room = live?.room;
    if (!live || !room || !isBoardPhase(room)) {
      closeMap();
      renderedTurn = "";
      root.innerHTML = live ? renderRoom(live) : renderCatalog();
      updateClock();
      return;
    }
    const turn = `${room.code}/${room.turnNumber}/${room.role}/${room.phase}`;
    const isHider = room.role === "hider";
    const activeDraw = isHider ? (live.deck as SeekDeckHiderView).activeDraw : null;
    const nextDraw = activeDraw?.cards.map(card => card.instanceId).join(":") ?? "";
    const nextPending = room.questions.find(question => question.status === "pending")?.id ?? "";
    const deal = !busy && nextDraw !== "" && nextDraw !== drawKey;
    const incoming = isHider && nextPending !== "" && nextPending !== pendingId;
    if (renderedTurn !== turn) {
      renderedTurn = turn;
      statusMsg = "";
      panel = room.phase === "head_start" || room.phase === "endgame" ? "board" : isHider ? "hand" : "ask";
      family = null;
      option = "";
      stationId = "";
      thermometerEnd = undefined;
      radiusDraft = "";
    }
    if (deal || incoming) panel = "hand";
    if (!isHider && panel === "ask" && pendingId && !nextPending && room.questions.some(question => question.id === pendingId && (question.answerLabel || question.overlay))) {
      panel = null;
      family = null;
      option = "";
    }
    if (nextDraw !== drawKey) keepIds = new Set();
    if (!busy) drawKey = nextDraw;
    if (pendingId !== nextPending) {
      answerChoice = "";
      photoPreview = "";
    }
    pendingId = nextPending;

    if (!mapHost) {
      root.innerHTML = `<section class="sg-game" aria-label="Jakarta Hide &amp; Seek">
        <div class="sg-board" id="sg-map"></div><div id="sg-controls"></div>
      </section>`;
      mapHost = root.querySelector<HTMLElement>("#sg-map")!;
    }
    const controls = root.querySelector<HTMLElement>("#sg-controls")!;
    root.querySelector<HTMLElement>(".sg-game")!.dataset.role = room.role;
    const focused = document.activeElement instanceof HTMLElement && controls.contains(document.activeElement) ? document.activeElement : null;
    const previousInput = focused instanceof HTMLInputElement ? { id: focused.id, value: focused.value } : null;
    const activeButton = focused instanceof HTMLButtonElement ? focused.dataset : null;
    const selectedNav = isHider ? "hand" : "ask";
    const station = [room.turnStartPoint, ...live.publicBoard.stations].find(item => item.id === room.seekerPosition?.stationId);
    const latest = [...room.questions].reverse().find(question => question.answerLabel && question.overlay &&
      question.askedAt >= (room.deductionResetAt ?? 0));
    controls.innerHTML = `<header class="sg-hud">
      <div class="sg-role">
        <span class="sg-role-mark" aria-hidden="true">${isHider ? "◆" : "◎"}</span>
        <h1>${isHider ? "Penyembunyi" : "Pencari"}</h1><p>${phaseLabels[room.phase]} · ${room.turnNumber}/${room.totalPlannedTurns}</p>
      </div>
      <div class="sg-hud-actions">
        ${room.phaseEndsAt === null ? "" : `<span class="sg-timer" aria-label="${room.phase === "head_start" ? "Waktu hingga pencarian dimulai" : "Sisa waktu"}" data-deadline="${room.phaseEndsAt}"></span>`}
        <button type="button" class="sg-quiet" data-action="refresh" aria-label="Muat ulang permainan" title="Muat ulang permainan">↻</button>
      </div>
    </header>
    ${room.phase !== "head_start" ? `<p class="sg-location">${room.seekerPosition ? `${room.seekerPosition.seatId === room.seatId ? "Kamu" : "Pencari"} · ${station ? escapeText(station.name) : "Check-in terverifikasi"} · <span id="sg-position-age"></span>` : "Belum ada check-in pencari"}</p>` : ""}
    ${latest && panel !== "history" && !mapFailed ? `<p class="sg-map-result" role="status">${questionNames[latest.family]} · ${escapeText(answerText(latest.answerLabel ?? ""))}</p>` : ""}
    <div class="sg-dock">
      ${panel || errorMsg || statusMsg ? `<section class="sg-sheet" aria-label="Panel permainan">
        ${errorMsg ? `<p role="alert" class="rb-errors">${escapeText(errorMsg)}</p>` : ""}
        ${statusMsg ? `<p role="status">${escapeText(statusMsg)}</p>` : ""}
        ${panel ? renderGamePanel(live, deal) : ""}
      </section>` : ""}
      <nav class="sg-nav" aria-label="Aksi permainan">
        <button type="button" data-action="game-panel" data-panel="${selectedNav}" aria-pressed="${panel === selectedNav}"><span class="sg-nav-icon" aria-hidden="true">${isHider ? "▤" : "✦"}</span>${isHider ? `Kartu ${live.deck.hiderHandCount}` : "Tanya"}</button>
        <button type="button" data-action="game-panel" data-panel="history" aria-pressed="${panel === "history"}"><span class="sg-nav-icon" aria-hidden="true">◷</span>Riwayat</button>
        <button type="button" data-action="game-panel" data-panel="board" aria-pressed="${panel === "board"}"><span class="sg-nav-icon" aria-hidden="true">◇</span>Titik</button>
        <button type="button" data-nav="catalog" aria-label="Kembali ke katalog">×</button>
      </nav>
    </div>`;
    if (deal || incoming) {
      controls.querySelector<HTMLElement>("#sg-panel-title")?.focus({ preventScroll: true });
    } else if (previousInput) {
      const input = document.getElementById(previousInput.id);
      if (input instanceof HTMLInputElement) {
        input.value = previousInput.value;
        input.focus({ preventScroll: true });
      }
    } else if (activeButton) {
      const replacement = [...controls.querySelectorAll<HTMLButtonElement>("button")].find(button =>
        !button.disabled && Object.keys(activeButton).length > 0 && Object.keys(activeButton).every(key => button.dataset[key] === activeButton[key]));
      (replacement ?? controls.querySelector<HTMLElement>("#sg-panel-title"))?.focus({ preventScroll: true });
    }
    const radius = controls.querySelector<HTMLInputElement>("#sg-radius");
    if (radius) radius.value = radiusDraft;
    updateClock();
    const nextMapKey = JSON.stringify([room.code, room.turnNumber, room.role, room.phase, room.ownAnchorStationId, room.seekerPosition, room.questions, room.deductionResetAt, room.moveZoneUntil, room.thermometerStart, thermometerEnd, answerChoice]);
    if (mapFailed) {
      if (mapKey) {
        mapRequest++;
        mapHandle?.destroy();
        mapHandle = undefined;
        mapHost.replaceChildren();
        mapKey = "";
      }
    } else if (mapKey !== nextMapKey) {
      mapKey = nextMapKey;
      void mountMapOverlay(mapHost, live);
    }
  }

  root.addEventListener("input", event => {
    if (event.target instanceof HTMLInputElement && event.target.id === "sg-radius") radiusDraft = event.target.value;
  }, { signal: lifecycle.signal });

  root.addEventListener("change", event => {
    if (!(event.target instanceof HTMLInputElement) || event.target.id !== "sg-clue-photo") return;
    const file = event.target.files?.[0];
    const questionId = pendingId;
    photoPreview = "";
    errorMsg = "";
    if (!file || file.size > 2 * 1024 * 1024 || !["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      if (file) errorMsg = "Pilih foto JPEG, PNG, atau WebP dengan ukuran maks. 2 MB.";
      render();
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (questionId !== pendingId || lifecycle.signal.aborted) return;
      photoPreview = String(reader.result ?? "");
      render();
    };
    reader.onerror = () => {
      if (questionId !== pendingId || lifecycle.signal.aborted) return;
      errorMsg = "Foto tidak dapat dibaca. Pilih ulang.";
      render();
    };
    reader.readAsDataURL(file);
  }, { signal: lifecycle.signal });

  root.addEventListener("click", (event) => {
    const btn = (event.target as HTMLElement | null)?.closest<HTMLButtonElement>("button");
    if (!btn || busy || actionPending || btn.disabled) return;

    const nav = btn.dataset.nav;
    if (nav === "back") {
      onBack();
      return;
    }
    if (nav === "studio") {
      const url = new URL(location.href);
      url.searchParams.set("play", "rulebook-studio");
      url.searchParams.delete("room");
      history.pushState({ fromChooser: true }, "", url);
      window.dispatchEvent(new PopStateEvent("popstate"));
      return;
    }
    if (nav === "catalog") {
      live = null;
      drawKey = "";
      pendingId = "";
      statusMsg = "";
      errorMsg = "";
      mapFailed = false;
      roomCode = "";
      syncRoomUrl("");
      render();
      return;
    }

    const action = btn.dataset.action;
    if (!action) return;
    if (action === "game-panel") {
      const next = btn.dataset.panel as Panel;
      panel = next === panel ? null : next;
      render();
      return;
    }
    if (action === "question-family" || action === "question-deck" || action === "question-option" || action === "select-station") {
      if (action === "question-family" || action === "question-deck") {
        family = (btn.dataset.family as HideSeekQuestionFamily | undefined) ?? null;
        option = "";
      }
      if (action === "question-option") option = btn.dataset.item ?? "";
      if (action === "select-station") stationId = btn.dataset.station ?? "";
      if (action === "question-family" || action === "question-deck") radiusDraft = "";
      render();
      return;
    }
    if (action === "choose-answer") {
      answerChoice = btn.dataset.answer ?? "";
      render();
      return;
    }
    if (action === "retry-map") {
      mapConfigRequest = undefined;
      mapFailed = false;
      render();
      return;
    }

    if (actionPending) return;
    actionPending = true;
    root.setAttribute("aria-busy", "true");
    errorMsg = "";
    void (async () => {
      const room = live?.room;
      const pointById = (id: string | undefined) => [room?.turnStartPoint, ...(live?.publicBoard.stations ?? [])].find(point => point?.id === id);
      const seekerPoint = () => pointById(stationId) ?? room?.seekerPosition ?? room?.turnStartPoint;
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
          statusMsg = `Ruang ${roomCode} berhasil dibuat.`;
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
        const codeInput = root.querySelector<HTMLInputElement>("#rb-join-code")?.value.trim() ?? "";
        const nameInput = root.querySelector<HTMLInputElement>("#rb-join-name")?.value.trim() || "Pemain";
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
      } else if (action === "sim-start-checkin") {
        await postRoomAction({ type: "check-in-start", fix: await locationFix(room?.turnStartPoint) });
      } else if (action === "mark-ready") {
        await postRoomAction({ type: "ready", ready: true });
      } else if (action === "start-match") {
        await postRoomAction({ type: "start" });
      } else if (action === "lock-anchor") {
        await postRoomAction({ type: "lock-anchor", stationId: btn.dataset.station, fix: await locationFix(pointById(btn.dataset.station)) });
      } else if (action === "regroup") {
        const fix = room?.regroupPoint ? await locationFix(room.regroupPoint) : undefined;
        await postRoomAction({ type: "regroup-check-in", fix });
      } else if (action === "confirm-freeze") {
        await postRoomAction({ type: "confirm-freeze" });
      } else if (action === "answer-pending") {
        await postRoomAction({ type: "answer-question", questionId: btn.dataset.qid, answerCode: answerChoice });
      } else if (action === "answer-photo") {
        busy = true;
        render();
        try {
          const response = await apiJson<{ error?: string }>("/api/rulebooks/seek-photo", {
            roomCode, questionId: btn.dataset.qid, actionId: crypto.randomUUID(), photoBase64: photoPreview.split(",")[1],
          });
          errorMsg = response.error ?? "";
          await refreshRoom();
        } finally {
          busy = false;
          render();
        }
      } else if (action === "cannot-answer") {
        await postRoomAction({ type: "cannot-answer-endgame", questionId: btn.dataset.qid });
      } else if (action === "trigger-endgame") {
        await postRoomAction({
          type: "seeker-check-in",
          offTransit: true,
          fix: await locationFix(pointById(btn.dataset.station) ?? seekerPoint()),
        });
      } else if (action === "seeker-check-in") {
        await postRoomAction({ type: "seeker-check-in", offTransit: false, fix: await locationFix(seekerPoint()) });
      } else if (action === "start-thermometer") {
        thermometerEnd = undefined;
        await postRoomAction({ type: "start-thermometer", fix: await locationFix(seekerPoint()) });
      } else if (action === "mark-thermometer-end") {
        const fix = await locationFix(seekerPoint());
        thermometerEnd = fix;
        if (!await postRoomAction({ type: "seeker-check-in", offTransit: false, fix })) {
          thermometerEnd = undefined;
          render();
        }
      } else if (action === "ask-clue") {
        const radius = root.querySelector<HTMLInputElement>("#sg-radius");
        if (radius && (!radius.reportValidity() || !Number.isFinite(radius.valueAsNumber))) return;
        const customRadiusMeters = radius?.valueAsNumber;
        const fix = btn.dataset.family === "thermometer" && thermometerEnd ? thermometerEnd : await locationFix(seekerPoint());
        const sent = await postRoomAction({
          type: "ask",
          family: btn.dataset.family,
          itemId: btn.dataset.item,
          ...(customRadiusMeters !== undefined ? { customRadiusMeters } : {}),
          fix,
        });
        if (sent) {
          thermometerEnd = undefined;
          radiusDraft = "";
        }
      } else if (action === "submit-found-code") {
        const code = root.querySelector<HTMLInputElement>("#rb-found-input")?.value.trim() ?? "";
        await postRoomAction({ type: "submit-found-code", code });
      } else if (action === "choose-draw" || action === "confirm-draw") {
        const activeDraw = live?.room.role === "hider" ? (live.deck as SeekDeckHiderView).activeDraw : null;
        if (!activeDraw) return;
        const inst = btn.dataset.instance;
        if (inst && activeDraw.cards.some(card => card.instanceId === inst)) {
          if (keepIds.has(inst)) keepIds.delete(inst);
          else if (keepIds.size < activeDraw.keepCount) keepIds.add(inst);
        }
        if (keepIds.size === activeDraw.keepCount && (activeDraw.keepCount === 1 || action === "confirm-draw")) {
          await postDeckAction({ kind: "choose-draw", keepInstanceIds: [...keepIds] });
        } else {
          render();
        }
      } else if (action === "play-card") {
        const inst = btn.dataset.instance;
        const primitive = btn.dataset.primitive;
        const params: Record<string, unknown> = { cardInstanceId: inst };
        if (primitive === "time_trap") params.targetStationId = pointById(stationId)?.id ?? live?.publicBoard.stations[0]?.id;
        if (primitive === "curse") params.photoId = "sim-curse-cost-photo";
        await postPlayCard(params);
      } else if (action === "clear-curse-gps") {
        await postDeckAction({
          kind: "clear-curse-gps",
          curseInstanceId: btn.dataset.curse,
          fix: await locationFix(seekerPoint()),
        });
      } else if (action === "submit-curse-photo") {
        await postDeckAction({
          kind: "submit-curse-photo",
          curseInstanceId: btn.dataset.curse,
          photoId: `curse-photo-${Date.now()}`,
        });
      } else if (action === "review-curse-photo") {
        await postDeckAction({
          kind: "review-curse-photo",
          curseInstanceId: btn.dataset.curse,
          approve: btn.dataset.approve === "true",
        });
      } else if (action === "clear-curse-honor") {
        await postDeckAction({ kind: "clear-curse-honor", curseInstanceId: btn.dataset.curse });
      } else if (action === "buyout-curse") {
        await postDeckAction({ kind: "buyout-curse", curseInstanceId: btn.dataset.curse });
      }
    })().catch(error => {
      if (lifecycle.signal.aborted) return;
      busy = false;
      errorMsg = error instanceof Error ? error.message : "Koneksi terputus. Coba lagi.";
      render();
    }).finally(() => {
      actionPending = false;
      root.removeAttribute("aria-busy");
    });
  }, { signal: lifecycle.signal });

  const ticker = window.setInterval(updateClock, 1000);
  const poller = window.setInterval(() => {
    if (!live || live.room.outcome || busy || actionPending || pollActive || document.hidden) return;
    pollActive = true;
    void refreshRoom(false, true).catch(() => {}).finally(() => { pollActive = false; });
  }, 3000);
  void loadCatalog().catch(() => {
    if (!lifecycle.signal.aborted) {
      errorMsg = "Katalog belum tersedia. Periksa koneksi lalu coba lagi.";
      render();
    }
  });
  return () => {
    lifecycle.abort();
    root.removeAttribute("aria-busy");
    window.clearInterval(poller);
    window.clearInterval(ticker);
    closeMap();
  };
}
