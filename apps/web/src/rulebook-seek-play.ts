import type {
  GeoCoordinate,
  HideSeekQuestionFamily,
  MapConfig,
  SeekDeckHiderView,
  SeekDeckPublicView,
  SeekDeductionOverlay,
  SeekEngineRoomView,
} from "@kelana-ria/contracts";
import { escapeText } from "./solo-view";
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

  async function loadCatalog() {
    const data = await apiJson<{ listings?: PublicListing[] }>("/api/rulebooks?format=hide-and-seek");
    listings = (data.listings ?? []).filter((l) => l.format === "hide-and-seek");
    if (roomCode) {
      await refreshRoom();
    } else {
      render();
    }
  }

  async function refreshRoom() {
    if (!roomCode) return;
    const data = await apiJson<RoomPayload & { error?: string }>(`/api/rulebooks/rooms/${encodeURIComponent(roomCode)}`);
    if ("room" in data && data.room) {
      live = data;
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
      const res = await apiJson<{ room?: SeekEngineRoomView; error?: string }>("/api/rulebooks", {
        type: "room-action",
        roomCode,
        action: { actionId: `ui-${Date.now()}-${++seq}`, ...action },
      });
      if (res.error) errorMsg = res.error;
      else errorMsg = "";
      await refreshRoom();
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

  async function mountMapOverlay(host: HTMLElement, room: SeekEngineRoomView) {
    mapCleanup?.();
    mapCleanup = undefined;
    try {
      const [{ mountBoardMap }, mapCfg] = await Promise.all([
        import("./board-map"),
        apiJson<MapConfig>("/api/map/config"),
      ]);
      const overlays: SeekDeductionOverlay[] = room.questions
        .filter((q) => q.overlay)
        .map((q) => q.overlay!);
      const eliminated = new Set<string>();
      for (const ov of overlays) {
        if (ov.type === "station_filter") {
          for (const id of ov.eliminatedStationIds) eliminated.add(id);
        }
      }
      const center: GeoCoordinate = room.regroupPoint ?? { latitude: -6.23831, longitude: 106.79889 };
      const handle = mountBoardMap({
        container: host,
        config: mapCfg,
        start: { id: "start", name: "Titik Mulai", latitude: center.latitude, longitude: center.longitude, x: 50, y: 50 },
        checkpoints: [],
        deductionOverlays: overlays,
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
    const { room, deck, pass } = payload;
    const isHider = room.role === "hider";
    const hiderDeck = isHider ? (deck as SeekDeckHiderView) : null;
    const pendingQ = room.questions.find((q) => q.status === "pending");

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
          <button type="button" class="secondary" data-action="toggle-map">${showMap ? "Sembunyikan Peta" : "Tampilkan Peta"}</button>
          <button type="button" class="secondary" data-nav="catalog">Kembali ke Katalog</button>
        </div>
      </div>

      ${
        room.phase === "lobby"
          ? `<div class="rb-card">
              <h3>Kursi Pemain (${room.seats.length}/${pass.maxPlayers})</h3>
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
          ? `<div class="rb-card"><h3>Peta Deduksi &amp; Overlay</h3><div id="rb-map-host" class="rb-map-host"></div></div>`
          : mapFailed
            ? `<div class="rb-card"><p role="status">Tile peta tidak tersedia — daftar deduksi dan kontrol teks tetap dapat digunakan penuh.</p></div>`
            : ""
      }

      ${
        deck.activeCurses.length > 0
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
          : ""
      }

      ${
        isHider && hiderDeck?.activeDraw
          ? `<div class="rb-card">
              <h3>Pilih Kartu Tarikan (Simpan ${hiderDeck.activeDraw.keepCount} dari ${hiderDeck.activeDraw.cards.length})</h3>
              <ul class="rb-list">
                ${hiderDeck.activeDraw.cards
                  .map(
                    (card) => `<li>
                      <strong>${escapeText(card.title)}</strong> <span class="rb-badge">${escapeText(card.category)}</span>
                      <small>${escapeText(card.description)}</small>
                      <button type="button" class="primary" data-action="choose-draw" data-instance="${escapeText(card.instanceId)}">Simpan Kartu Ini</button>
                    </li>`,
                  )
                  .join("")}
              </ul>
            </div>`
          : ""
      }

      ${
        isHider && room.phase === "endgame" && room.foundCode
          ? `<div class="rb-card">
              <h3>ENDGAME · Tetap di Tempat!</h3>
              <p>Berikan kode temuan 4 digit ini saat pencari menemukanmu secara langsung:</p>
              <div class="rb-found-code" data-testid="hider-found-code">${escapeText(room.foundCode)}</div>
              ${room.hiderFrozen ? '<span class="rb-badge">Posisi sudah terkunci diam</span>' : '<button type="button" class="primary" data-action="confirm-freeze">Kunci Posisi Sekarang</button>'}
            </div>`
          : ""
      }

      ${
        isHider && room.phase === "head_start"
          ? `<div class="rb-card">
              <h3>Kunci Stasiun Jangkar (Zona ${room.ownHidingZoneRadiusMeters ?? 400} m)</h3>
              <label class="rb-field"><span>ID Stasiun</span><input id="rb-lock-station" value="mrt-blok-m"></label>
              <button type="button" class="primary" data-action="lock-anchor">Simulasikan Kunci Stasiun</button>
            </div>`
          : ""
      }

      ${
        isHider && pendingQ
          ? `<div class="rb-card">
              <h3>Pertanyaan Masuk · ${escapeText(familyLabels[pendingQ.family])}</h3>
              <p><strong>${escapeText(pendingQ.label)}</strong> ${pendingQ.prompt ? `— ${escapeText(pendingQ.prompt)}` : ""}</p>
              ${pendingQ.privateComputedAnswer ? `<p>Jawaban terhitung server: <strong>${escapeText(pendingQ.privateComputedAnswer.label)}</strong></p>` : ""}
              <div class="rb-actions">
                <button type="button" class="primary" data-action="answer-pending" data-qid="${escapeText(pendingQ.id)}">Kirim Jawaban &amp; Ambil Kartu</button>
                ${
                  hiderDeck?.hand.find((c) => c.effect.primitive === "veto")
                    ? `<button type="button" class="secondary" data-action="play-card" data-instance="${escapeText(hiderDeck.hand.find((c) => c.effect.primitive === "veto")!.instanceId)}" data-primitive="veto">Veto Pertanyaan</button>`
                    : ""
                }
                ${
                  hiderDeck?.hand.find((c) => c.effect.primitive === "randomize")
                    ? `<button type="button" class="secondary" data-action="play-card" data-instance="${escapeText(hiderDeck.hand.find((c) => c.effect.primitive === "randomize")!.instanceId)}" data-primitive="randomize">Acak Pertanyaan</button>`
                    : ""
                }
                ${room.phase === "endgame" ? `<button type="button" class="secondary" data-action="cannot-answer" data-qid="${escapeText(pendingQ.id)}">Tidak Bisa Menjawab (Endgame)</button>` : ""}
              </div>
            </div>`
          : ""
      }

      ${
        isHider && hiderDeck
          ? `<div class="rb-card">
              <h3>Tangan Penyembunyi (${hiderDeck.hand.length}/${hiderDeck.currentHandLimit})</h3>
              <ul class="rb-list">
                ${
                  hiderDeck.hand.length === 0
                    ? "<li>Belum ada kartu. Jawab pertanyaan pencari untuk mengambil kartu.</li>"
                    : hiderDeck.hand
                        .map((card) => {
                          const p = card.effect.primitive;
                          const canPlayNow =
                            p === "expand_hand" ||
                            p === "discard_draw" ||
                            p === "duplicate" ||
                            p === "time_trap" ||
                            p === "move_zone" ||
                            p === "curse";
                          return `<li>
                            <strong>${escapeText(card.title)}</strong> <span class="rb-badge">${escapeText(card.category)}</span>
                            <small>${escapeText(card.description)}</small>
                            ${
                              canPlayNow
                                ? `<div class="rb-actions"><button type="button" class="secondary" data-action="play-card" data-instance="${escapeText(card.instanceId)}" data-primitive="${escapeText(p)}">Mainkan Kartu</button></div>`
                                : ""
                            }
                          </li>`;
                        })
                        .join("")
                }
              </ul>
            </div>`
          : ""
      }

      ${
        !isHider && (room.phase === "seeking" || room.phase === "endgame")
          ? `<div class="rb-card">
              <h3>Buku Investigasi Pencari</h3>
              <div class="rb-actions">
                <button type="button" class="secondary" data-action="trigger-endgame">Check-in Off-Transit (Cek Zona Endgame)</button>
                <button type="button" class="secondary" data-action="start-thermometer">Mulai Termometer</button>
              </div>
              <ul class="rb-list">
                ${room.menu
                  .slice(0, 12)
                  .map(
                    (m) => `<li>
                      <div><strong>${escapeText(familyLabels[m.family])}</strong> · ${escapeText(m.label)}</div>
                      <div class="rb-badges">
                        <span class="rb-badge">${m.nextRepeatMultiplier}x biaya</span>
                        ${m.useCount > 0 ? `<span class="rb-badge rb-badge-warn">Dipakai ${m.useCount}x</span>` : ""}
                      </div>
                      <button type="button" class="secondary" data-action="ask-clue" data-family="${escapeText(m.family)}" data-item="${escapeText(m.itemId)}" ${!m.availableInCurrentPhase || m.lockedSingleUse ? "disabled" : ""}>Tanyakan Petunjuk</button>
                    </li>`,
                  )
                  .join("")}
              </ul>
              ${
                room.phase === "endgame"
                  ? `<div class="rb-field">
                      <label for="rb-found-input">Masukkan Kode Temuan 4 Digit</label>
                      <input id="rb-found-input" inputmode="numeric" maxlength="4" placeholder="1234">
                      <button type="button" class="primary" data-action="submit-found-code">Konfirmasi Menemukan Penyembunyi</button>
                    </div>`
                  : ""
              }
            </div>`
          : ""
      }

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

  function render() {
    root.innerHTML = live ? renderRoom(live) : renderCatalog();
    if (live && showMap && !mapFailed && live.room.phase !== "lobby") {
      const host = root.querySelector<HTMLElement>("#rb-map-host");
      if (host) void mountMapOverlay(host, live.room);
    }
  }

  root.addEventListener("click", (event) => {
    const btn = (event.target as HTMLElement | null)?.closest<HTMLButtonElement>("button");
    if (!btn) return;

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
      roomCode = "";
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
      } else if (action === "toggle-map") {
        showMap = !showMap;
        render();
      } else if (action === "sim-start-checkin") {
        const ts = live?.room.now ?? Date.now();
        await postRoomAction({
          type: "check-in-start",
          fix: { latitude: -6.23831, longitude: 106.79889, accuracy: 10, timestamp: ts },
        });
      } else if (action === "mark-ready") {
        await postRoomAction({ type: "ready", ready: true });
      } else if (action === "start-match") {
        await postRoomAction({ type: "start" });
      } else if (action === "lock-anchor") {
        const ts = live?.room.now ?? Date.now();
        const stId = root.querySelector<HTMLInputElement>("#rb-lock-station")?.value.trim() || "mrt-blok-m";
        await postRoomAction({
          type: "lock-anchor",
          stationId: stId,
          fix: { latitude: -6.24438, longitude: 106.79812, accuracy: 10, timestamp: ts },
        });
      } else if (action === "confirm-freeze") {
        await postRoomAction({ type: "confirm-freeze" });
      } else if (action === "answer-pending") {
        await postRoomAction({ type: "answer-question", questionId: btn.dataset.qid, photoId: "sim-photo-1" });
      } else if (action === "cannot-answer") {
        await postRoomAction({ type: "cannot-answer-endgame", questionId: btn.dataset.qid });
      } else if (action === "trigger-endgame") {
        const ts = live?.room.now ?? Date.now();
        await postRoomAction({
          type: "seeker-check-in",
          offTransit: true,
          fix: { latitude: -6.24438, longitude: 106.79812, accuracy: 10, timestamp: ts },
        });
      } else if (action === "start-thermometer") {
        const ts = live?.room.now ?? Date.now();
        await postRoomAction({
          type: "start-thermometer",
          fix: { latitude: -6.23831, longitude: 106.79889, accuracy: 10, timestamp: ts },
        });
      } else if (action === "ask-clue") {
        const ts = live?.room.now ?? Date.now();
        await postRoomAction({
          type: "ask",
          family: btn.dataset.family,
          itemId: btn.dataset.item,
          fix: { latitude: -6.23831, longitude: 106.79889, accuracy: 10, timestamp: ts },
        });
      } else if (action === "submit-found-code") {
        const code = root.querySelector<HTMLInputElement>("#rb-found-input")?.value.trim() ?? "";
        await postRoomAction({ type: "submit-found-code", code });
      } else if (action === "choose-draw") {
        const inst = btn.dataset.instance;
        const activeDraw = live?.room.role === "hider" ? (live.deck as SeekDeckHiderView).activeDraw : null;
        if (inst && activeDraw) {
          const keepIds = [inst];
          for (const c of activeDraw.cards) {
            if (keepIds.length < activeDraw.keepCount && c.instanceId !== inst) keepIds.push(c.instanceId);
          }
          await postDeckAction({ kind: "choose-draw", keepInstanceIds: keepIds });
        }
      } else if (action === "play-card") {
        const inst = btn.dataset.instance;
        const primitive = btn.dataset.primitive;
        const params: Record<string, unknown> = { cardInstanceId: inst };
        if (primitive === "time_trap") params.targetStationId = "mrt-senayan";
        if (primitive === "curse") params.photoId = "sim-curse-cost-photo";
        await postPlayCard(params);
      } else if (action === "clear-curse-gps") {
        const ts = live?.room.now ?? Date.now();
        await postDeckAction({
          kind: "clear-curse-gps",
          curseInstanceId: btn.dataset.curse,
          fix: { latitude: -6.23831, longitude: 106.79889, accuracy: 10, timestamp: ts },
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
    })();
  });

  void loadCatalog();
  return () => {
    mapCleanup?.();
  };
}
