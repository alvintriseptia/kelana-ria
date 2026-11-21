import type { GameBoard, LocationFix, MapConfig, SeekAction, SeekReply, SeekRoom, SoloPoint } from "@kelana-ria/contracts";
import { getLocation } from "./device-location";
import { fetchMapConfig } from "./map-config";
import { boardDisplayName, inviteUrl, pendingEntry, player, roomCodePattern, roomTransport, type EntryAction, type Feedback } from "./multiplayer-room";
import { cluePointName, deliveredRadarCircles, drawSelection, newClueDraft, pendingQuestion, questionFamily, selectedQuestion } from "./seek-clues";
import { active, entry, needsStart, pointAction, roomView, seekMode, seekPhase } from "./seek-view";
import { action, remaining, wib } from "./solo-view";
import "./solo-play.css";
import "./duo-play.css";
import "./seek-play.css";

const apiPath = "/api/seek";
const entryRequests = pendingEntry("kelana-seek-pending-entry");
const mapUrl = new URL("./assets/solo-schematic.webp", import.meta.url).href;
const errors: Record<string, string> = {
  "room-not-found": "Ruang dengan kode ini tidak ditemukan. Periksa kode undangan.",
  "room-full": "Ruang ini sudah penuh atau pertandingan telah ditutup. Minta undangan baru.",
  "room-required": "Kursi untuk perangkat ini belum tersedia. Gabung dengan kode undangan.",
  "room-phase-changed": "Tahap permainan berubah. Periksa status terbaru dan coba lagi.",
  "turn-changed": "Giliran sudah berganti. Periksa status terbaru untuk melanjutkan.",
  "host-only": "Tuan rumah memilih peran dan memulai permainan.",
  "roles-changed": "Peran berubah. Periksa peran terbaru lalu nyatakan siap lagi.",
  "roles-unassigned": "Tuan rumah perlu memilih siapa yang bersembunyi dulu.",
  "players-not-ready": "Kedua pemain harus siap sebelum permainan dimulai.",
  "start-unverified": "Check-in di titik awal untuk melanjutkan.",
  "round-finished": "Pertandingan sudah selesai. Hasil terakhir sudah dimuat.",
  "hider-only": "Hanya pemain yang bersembunyi bisa melakukan tindakan ini.",
  "seeker-only": "Hanya pencari yang bisa melakukan tindakan ini.",
  "already-locked": "Titik sembunyi sudah terkunci.",
  "already-ruled-out": "Titik ini sudah diperiksa. Pilih titik lain.",
  "unknown-checkpoint": "Titik ini tidak tersedia di edisi ini.",
  "invalid-fix": "Lokasi tidak bisa diverifikasi. Coba check-in lagi.",
  "stale-fix": "Data lokasi sudah kedaluwarsa. Coba check-in lagi untuk meminta lokasi baru.",
  "inaccurate-fix": "Lokasi kurang akurat. Cari area terbuka lalu coba lagi.",
  "outside-radius": "Kamu berada di luar radius check-in. Dekati titiknya lalu coba lagi.",
  "incorrect-clue-answer": "Jawaban ini belum cocok dengan data papan. Periksa titik acuan lalu pilih jawaban lagi.",
  "invalid-photo": "Foto tidak bisa diterima. Pilih JPEG, PNG, atau WebP dengan ukuran maksimal 2 MB.",
  "question-closed": "Pertanyaan sudah ditutup. Periksa riwayat petunjuk.",
  "clue-pending": "Tunggu jawaban untuk pertanyaan yang sedang aktif.",
  "clue-reference-changed": "Titik acuan berubah. Periksa titik acuan terbaru lalu kirim pertanyaan lagi.",
  "draw-pending": "Selesaikan pilihan kartu sebelum melanjutkan.",
  "question-delayed": "Jeda pertanyaan masih aktif. Kamu bisa tetap check-in dan menyelidiki.",
  "clue-unavailable": "Jenis pertanyaan ini belum tersedia dari titik acuan saat ini.",
  "invalid-clue-input": "Periksa radius atau landmark yang dipilih.",
  "invalid-card-choice": "Periksa jumlah kartu yang disimpan dan dibuang.",
  "card-not-playable": "Kartu ini belum bisa dimainkan. Periksa pertanyaan, pilihan kartu, atau jeda yang sedang aktif.",
  "invalid-card-discard": "Pilih kartu lain dari tangan untuk dibuang.",
};

type RoomAction = SeekAction extends infer A ? A extends SeekAction ? Omit<A, "actionId"> : never : never;
type RequestAction = (EntryAction | RoomAction) & { actionId: string };
type LocationAction = (point: SoloPoint, fix: LocationFix) => RoomAction;

const clueActions = new Set<RequestAction["type"]>(["ask", "answer-question", "photo-unavailable", "choose-cards", "play-card"]);
const acceptedPhotoTypes = new Set(["image/jpeg", "image/png", "image/webp"]);

function encodePhoto(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      if (typeof reader.result !== "string") return reject(new Error("Foto tidak bisa dibaca."));
      resolve(reader.result.slice(reader.result.indexOf(",") + 1));
    }, { once: true });
    reader.addEventListener("error", () => reject(new Error("Foto tidak bisa dibaca.")), { once: true });
    reader.readAsDataURL(file);
  });
}

export function mountSeekPlay(root: HTMLElement, returnToSetup: () => void) {
  const mount = new AbortController();
  const { signal } = mount;
  const { credential, request } = roomTransport<SeekReply, RequestAction>(apiPath, "kelana-seek-bootstrap");
  const initialParams = new URLSearchParams(location.search);
  const requestedBoard: GameBoard = initialParams.get("board") === "jakarta-wide" ? "jakarta-wide" : "compact";
  let inviteCode = (initialParams.get("room") ?? "").trim().toUpperCase();
  const restored = entryRequests.read(inviteCode);
  let joinInput = restored?.type === "join" ? restored.code : inviteCode;
  let pending: { path: string; action: RequestAction } | undefined = restored ? { path: apiPath, action: restored } : undefined;
  let room: SeekRoom | undefined;
  let serverSampleAt = 0;
  let loading = !restored;
  let busy = false;
  let locating = false;
  let disconnected = false;
  let reading: AbortController | undefined;
  let startOpen = false;
  let confirmingExit = false;
  let selectedId: string | undefined;
  let feedback: Feedback | undefined;
  let clueDraft = newClueDraft();
  let neededStart = false;
  const map = { shown: false, failed: false, vectorMode: false, url: mapUrl };
  let mapConfig: MapConfig | undefined;
  let vectorMap: { destroy: () => void } | undefined;

  root.innerHTML = `<nav class="solo-nav" aria-label="Navigasi simulasi">
    ${action("Kembali ke pilihan", "back", "solo-back")}
    <span class="solo-label">Simulasi</span>
  </nav>
  <header class="solo-header">
    <h1 tabindex="-1" lang="en">Hide &amp; Seek</h1>
    <p><strong id="seek-board-label">${boardDisplayName(requestedBoard)}</strong> · Berdua <span>Edisi siap pakai</span></p>
  </header>
  <p id="seek-announcement" class="sr-only" role="status" aria-atomic="true"></p>
  <div id="seek-connection" class="solo-connection" hidden></div>
  <div id="seek-view"><p role="status">Memuat ruang…</p></div>`;
  const view = root.querySelector<HTMLElement>("#seek-view")!;
  const connection = root.querySelector<HTMLElement>("#seek-connection")!;
  const announcement = root.querySelector<HTMLElement>("#seek-announcement")!;
  const boardLabelEl = root.querySelector<HTMLElement>("#seek-board-label")!;
  root.querySelector<HTMLElement>("h1")!.focus();

  const now = () => room ? room.now + performance.now() - serverSampleAt : Date.now();
  const roomPath = (code: string) => `${apiPath}/${encodeURIComponent(code)}`;
  const focusSelector = (key: string) => `[data-focus="${CSS.escape(key)}"]`;
  const selectedPoint = () => room && [room.edition.start, ...room.edition.checkpoints].find(point => point.id === selectedId);

  function setCode(code: string) {
    inviteCode = joinInput = code;
    const url = new URL(location.href);
    if (code) url.searchParams.set("room", code);
    else url.searchParams.delete("room");
    history.replaceState(history.state, "", url);
  }

  function report(text: string, error = false, clue = false) {
    if (clue) clueDraft.feedback = { text, error };
    else feedback = { text, error };
    announcement.textContent = text;
  }

  function reportError(error: string, distanceMeters?: number, clue = false) {
    const distance = distanceMeters === undefined ? "" : `Jarak ${Math.round(distanceMeters)} m. `;
    report(distance + (errors[error] ?? "Permintaan belum berhasil. Coba lagi."), true, clue);
  }

  function updateClock() {
    if (!room) return;
    const current = now();
    const timer = view.querySelector("[data-timer]");
    const serverClock = view.querySelector("[data-server-clock]");
    const clueWindow = view.querySelector<HTMLElement>("[data-clue-window]");
    const countdown = remaining((room.phaseEndsAt ?? current) - current);
    const localTime = wib(current);
    if (timer && timer.textContent !== countdown) timer.textContent = countdown;
    if (serverClock && serverClock.textContent !== localTime) serverClock.textContent = localTime;
    if (clueWindow) {
      const duration = remaining(Math.min(Number(clueWindow.dataset.clueWindow), (room.phaseEndsAt ?? current) - current));
      if (clueWindow.textContent !== duration) clueWindow.textContent = duration;
    }
  }

  async function resolveMapConfig() {
    if (mapConfig) return mapConfig;
    mapConfig = await fetchMapConfig(signal);
    return mapConfig;
  }

  async function mountVectorMap(state: SeekRoom) {
    const host = root.querySelector<HTMLElement>("#seek-vector-map");
    if (!host || signal.aborted) return;
    try {
      const config = await resolveMapConfig();
      const { mountBoardMap } = await import("./board-map");
      if (signal.aborted || !map.shown || !map.vectorMode || !root.contains(host)) return;
      const type = pointAction(state);
      const canReference = type === "investigate" && Boolean(state.clues);
      const ruledOut = state.phase === "seeking" && state.hider !== state.seat
        ? new Set(state.ruledOut) : new Set<string>();
      const radarCircles = deliveredRadarCircles(state);
      const locked = busy || Boolean(pending);
      vectorMap?.destroy();
      vectorMap = mountBoardMap({
        container: host,
        config,
        start: state.edition.start,
        startSelectable: canReference && !locked,
        checkpoints: state.edition.checkpoints.map(point => {
          const isRuledOut = ruledOut.has(point.id);
          const isOwnLock = state.hider === state.seat && state.ownLock === point.id;
          return {
            ...point,
            claimed: isRuledOut || isOwnLock,
            label: isOwnLock ? "Terkunci" : isRuledOut ? "Sudah diperiksa" : undefined,
            selectable: Boolean(type) && !locked && (canReference || !isRuledOut),
          };
        }),
        selectedId,
        radarCircles,
        onSelectStart() {
          if (!room || busy || pending || !pointAction(room)) return;
          selectedId = room.edition.start.id;
          feedback = undefined;
          paint("#seek-point-heading");
        },
        onSelect(checkpointId) {
          if (!room || busy || pending || !pointAction(room)) return;
          selectedId = checkpointId;
          feedback = undefined;
          paint("#seek-point-heading");
        },
        onError() {
          if (signal.aborted) return;
          map.failed = true;
          map.vectorMode = false;
          paint();
        },
      });
    } catch {
      if (!signal.aborted) {
        map.failed = true;
        map.vectorMode = false;
        paint();
      }
    }
  }

  function paint(focus?: string) {
    if (signal.aborted) return;
    vectorMap?.destroy();
    vectorMap = undefined;
    boardLabelEl.textContent = boardDisplayName(room?.edition.board ?? requestedBoard);
    const focused = document.activeElement as HTMLElement | null;
    const key = focused?.dataset.focus;
    const focusedId = focused && view.contains(focused) ? focused.id : "";
    const wasAnswering = focused?.closest('[aria-labelledby="seek-answer-heading"]');
    const wasChoosingCards = focused?.closest('[aria-labelledby="seek-hand-heading"]');
    const selection = focused instanceof HTMLInputElement && key === "invite-input"
      ? [focused.selectionStart, focused.selectionEnd] : undefined;
    const locked = busy || Boolean(pending);
    connection.hidden = !pending && !disconnected;
    if (!connection.hidden) {
      const notice = pending ? busy ? "Menunggu konfirmasi dari server…"
        : "Belum ada konfirmasi dari server. Coba lagi untuk memeriksa dan mengirim ulang."
        : "Koneksi terputus. Sambungkan kembali untuk memuat status ruang terbaru.";
      const markup = `<p role="status">${notice}</p>${busy ? "" : action("Coba lagi", "retry")}`;
      if (connection.innerHTML !== markup) connection.innerHTML = markup;
    }
    if (room) {
      const current = now();
      neededStart = needsStart(room, current);
      view.innerHTML = roomView(room, { now: current, busy: locked, locating, startOpen, point: selectedPoint(), feedback, map, clueDraft }, confirmingExit);
      if (map.shown && map.vectorMode && !map.failed) void mountVectorMap(room);
    } else {
      view.innerHTML = loading && !disconnected ? '<p role="status">Memuat ruang…</p>' : entry(inviteCode, locked, feedback);
    }
    const join = view.querySelector<HTMLInputElement>("#seek-invite-input");
    if (join) join.value = joinInput;
    updateClock();
    const target = (focus && root.querySelector<HTMLElement>(focus))
      || (key && root.querySelector<HTMLElement>(focusSelector(key)))
      || (focusedId && view.querySelector<HTMLElement>(`#${CSS.escape(focusedId)}`))
      || (key?.startsWith("map-") && root.querySelector<HTMLElement>(focusSelector("map")))
      || ((wasAnswering || wasChoosingCards) && view.querySelector<HTMLElement>("#seek-hand-heading"));
    if (target) target.focus({ preventScroll: !focus });
    if (target === join && selection && join) join.setSelectionRange(selection[0], selection[1]);
  }

  function releasePhoto() {
    if (clueDraft.photo) URL.revokeObjectURL(clueDraft.photo.preview);
    clueDraft.photo = undefined;
    clueDraft.preparingPhoto = false;
  }

  function updateClueDraft(previous: SeekRoom | undefined, next: SeekRoom) {
    const before = pendingQuestion(previous);
    const after = pendingQuestion(next);
    const nextDraw = next.clues?.draw;
    if (before?.id !== after?.id) {
      releasePhoto();
      clueDraft.answer = "";
      clueDraft.feedback = undefined;
      const complete = before && next.clues?.questions.find(question => question.id === before.id);
      announcement.textContent = after ? `${questionFamily[after.family].label}. ${next.hider === next.seat ? "Pertanyaan masuk." : "Menunggu jawaban."}`
        : complete?.status === "timeout" ? "Jawaban otomatis tersedia."
        : complete?.status === "substituted" ? "Foto diganti dengan pencocokan cabang."
        : "Jawaban petunjuk tersedia.";
    }
    const previousDraw = previous?.clues?.draw;
    if (previousDraw?.cards[0]?.id !== nextDraw?.cards[0]?.id) {
      clueDraft.cards = new Set(nextDraw && nextDraw.cards.length === nextDraw.keepCount ? nextDraw.cards.map(card => card.id) : []);
      clueDraft.cardDiscards.clear();
      if (nextDraw) announcement.textContent = `Kartu baru. Pilih ${nextDraw.keepCount} untuk disimpan.`;
    }
    if (previous?.clues?.delayUntil !== next.clues?.delayUntil && next.clues?.delayUntil) {
      announcement.textContent = "Jeda pertanyaan aktif. Check-in dan penyelidikan masih tersedia.";
    }
  }

  function receive(next: SeekRoom | undefined) {
    if (!next || (room?.code === next.code && next.now < room.now)) return { changed: false };
    const previous = room;
    room = next;
    serverSampleAt = performance.now();
    const newRoom = next.code !== previous?.code;
    const transition = newRoom || next.phase !== previous?.phase || next.turn !== previous?.turn;
    const keepExitConfirmation = !newRoom && active(previous) && active(next);
    let focus: string | undefined;
    if (newRoom) setCode(next.code);
    if (transition) {
      selectedId = undefined;
      startOpen = false;
      if (!keepExitConfirmation) confirmingExit = false;
      feedback = undefined;
      releasePhoto();
      clueDraft = newClueDraft();
      if (next.phase === "seeking") updateClueDraft(undefined, next);
      if (next.phase === "lobby") {
        focus = "#seek-room-heading";
      } else if (active(next)) {
        const name = seekPhase[next.phase as keyof typeof seekPhase];
        const role = next.hider === next.seat ? "Kamu bersembunyi." : "Kamu mencari.";
        const score = next.phase === "regroup" ? " Hasil giliran pertama tersedia." : ` ${role}`;
        announcement.textContent = `${name}. Giliran ${next.turn} dari 2.${score}`;
        focus = "#seek-phase-heading";
      } else {
        announcement.textContent = "Pertandingan berakhir. Hasil tersedia.";
        focus = "#seek-result-heading";
      }
    } else if (next.phase === "lobby" && previous) {
      if (next.firstHider && next.roleRevision !== previous.roleRevision) {
        announcement.textContent = `${player[next.firstHider]} bersembunyi dulu.`;
      } else if (JSON.stringify(previous.seats) !== JSON.stringify(next.seats)) {
        announcement.textContent = next.seats.host.ready && next.seats.guest.ready
          ? "Kedua pemain siap." : next.seats.guest.joined ? "Status kesiapan pemain diperbarui." : "Menunggu teman bergabung.";
      }
    } else if (next.phase === "seeking") updateClueDraft(previous, next);
    if (next.ownLock && previous?.ownLock !== next.ownLock) selectedId = undefined;
    return { changed: JSON.stringify(previous && { ...previous, now: 0 }) !== JSON.stringify({ ...next, now: 0 }), focus };
  }

  function cancelRead() {
    reading?.abort();
    reading = undefined;
  }

  async function refresh() {
    if (signal.aborted || busy || pending || reading) return;
    const read = new AbortController();
    reading = read;
    const requestSignal = AbortSignal.any([signal, read.signal]);
    let repaint = loading || disconnected;
    let focus: string | undefined;
    try {
      await credential(requestSignal);
      if (requestSignal.aborted) return;
      disconnected = false;
      if (!inviteCode) return;
      if (!roomCodePattern.test(inviteCode)) {
        setCode("");
        reportError("room-not-found");
        repaint = true;
        return;
      }
      const reply = await request(roomPath(inviteCode), requestSignal);
      if (requestSignal.aborted) return;
      const update = receive(reply.room);
      repaint ||= update.changed;
      focus = update.focus;
      if (reply.error === "room-required") {
        if (room) {
          releasePhoto();
          room = undefined;
          reportError(reply.error);
          repaint = true;
        }
      } else if (reply.error) {
        reportError(reply.error);
        repaint = true;
      }
    } catch {
      if (!requestSignal.aborted) {
        disconnected = true;
        repaint = true;
      }
    } finally {
      if (reading === read) reading = undefined;
      if (!requestSignal.aborted) {
        loading = false;
        if (repaint) paint(focus);
      }
    }
  }

  async function submitPending(reconnect = false, focus?: string) {
    if (!pending || busy || signal.aborted) return;
    const current = pending;
    cancelRead();
    busy = true;
    paint();
    try {
      if (reconnect && room) {
        const snapshot = await request(roomPath(room.code), signal);
        if (signal.aborted) return;
        focus = receive(snapshot.room).focus ?? focus;
      }
      const reply = await request(current.path, signal, current.action);
      if (signal.aborted) return;
      const submitted = current.action;
      if (!reply.room && !reply.error && submitted.type !== "leave") throw new Error("Missing room");
      pending = undefined;
      disconnected = false;
      focus = receive(reply.room).focus ?? focus;
      if (submitted.type === "create" || submitted.type === "join") entryRequests.remember();
      if (reply.error) {
        reportError(reply.error, reply.distanceMeters, clueActions.has(submitted.type));
        if (reply.error === "incorrect-clue-answer") focus = "#seek-answer";
        if (reply.error === "invalid-photo") focus = "#seek-answer-heading";
        if (reply.error === "room-phase-changed" || reply.error === "turn-changed") confirmingExit = false;
        if (reply.error === "room-required" && room) {
          releasePhoto();
          room = undefined;
          focus = "#seek-room-heading";
        }
      } else if (submitted.type === "check-in" && room?.phase === submitted.phase && room.turn === submitted.turn) {
        report("Check-in titik awal berhasil.");
        startOpen = false;
      } else if (submitted.type === "lock" && room?.ownLock) {
        report("Titik sembunyi berhasil dikunci.");
      } else if (submitted.type === "reference" && room?.clues?.referenceId === submitted.checkpointId) {
        report(`Check-in di ${cluePointName(room, submitted.checkpointId)} berhasil. Titik ini menjadi acuan petunjuk.`);
      } else if (submitted.type === "investigate" && reply.investigation === "miss" && room?.phase === "seeking" && room.turn === submitted.turn) {
        report("Penyelidikan selesai. Pilih titik lain.");
      } else if (clueActions.has(submitted.type) && room?.phase === "seeking") {
        if (submitted.type === "ask") {
          report("Pertanyaan dikirim.", false, true);
        } else if (submitted.type === "answer-question") {
          report(room.clues?.draw ? "Jawaban dikirim. Pilih kartu yang ingin disimpan." : "Jawaban dikirim.", false, true);
        } else if (submitted.type === "photo-unavailable") {
          report("Pertanyaan foto diganti dengan pencocokan cabang.", false, true);
        } else if (submitted.type === "choose-cards") {
          report("Pilihan kartu disimpan.", false, true);
        } else if (submitted.type === "play-card") {
          report("Kartu dimainkan.", false, true);
        }
      } else if (submitted.type === "leave" && !reply.room) {
        room = undefined;
        setCode("");
        focus = "#seek-room-heading";
      }
      if (!focus && ["check-in", "ready", "lock", "investigate", "reference"].includes(submitted.type)) {
        focus = selectedPoint() ? "#seek-point-heading" : "#seek-action-heading";
      }
    } catch {
      if (!signal.aborted) disconnected = true;
    } finally {
      busy = false;
      paint(focus);
    }
  }

  function send(submitted: EntryAction | RoomAction, focus?: string) {
    if (busy || pending || signal.aborted) return;
    const actionId = crypto.randomUUID();
    if (submitted.type === "create" || submitted.type === "join") {
      const action = { ...submitted, actionId };
      pending = { path: apiPath, action };
      entryRequests.remember({ roomCode: inviteCode, request: action });
    } else if (room) {
      pending = { path: roomPath(room.code), action: { ...submitted, actionId } };
    } else return;
    if (clueActions.has(submitted.type)) clueDraft.feedback = undefined;
    else feedback = undefined;
    void submitPending(false, focus);
  }

  function locationTarget(state: SeekRoom, reference: boolean): { point: SoloPoint; action: LocationAction } | undefined {
    const { phase, turn } = state;
    if (!reference && startOpen && needsStart(state, now()) && (phase === "lobby" || phase === "seeking" || phase === "regroup")) {
      return { point: state.edition.start, action: (_, fix) => ({ type: "check-in", phase, turn, fix }) };
    }
    const type = pointAction(state);
    const point = selectedPoint();
    if (!point || !type) return;
    if (reference && type === "investigate" && state.clues) {
      return { point, action: ({ id: checkpointId }, fix) => ({ type: "reference", turn, checkpointId, fix }) };
    }
    if (!reference && point.id !== state.edition.start.id && !state.ruledOut.includes(point.id)) {
      return { point, action: ({ id: checkpointId }, fix) => ({ type, turn, checkpointId, fix }) };
    }
  }

  async function locate(simulated: boolean, reference = false) {
    if (!room || busy || pending || signal.aborted) return;
    const { code, turn, phase } = room;
    const target = locationTarget(room, reference);
    if (!target) return;
    cancelRead();
    busy = true;
    locating = !simulated;
    feedback = undefined;
    paint();
    let fix: LocationFix | undefined;
    let focus: string | undefined;
    try {
      const device = simulated ? undefined : await getLocation();
      if (signal.aborted) return;
      locating = false;
      let reply: SeekReply;
      try {
        reply = await request(roomPath(code), signal);
      } catch {
        if (!signal.aborted) disconnected = true;
        return;
      }
      if (signal.aborted) return;
      if (!reply.room) {
        if (reply.error) reportError(reply.error);
        return;
      }
      focus = receive(reply.room).focus;
      disconnected = false;
      if (room.phase !== phase || room.turn !== turn || locationTarget(room, reference)?.point.id !== target.point.id) return;
      // Preserve the location sample's age when the device and server clocks differ.
      const age = device ? Date.now() - device.timestamp : 0;
      if (!Number.isFinite(age) || age < 0) {
        reportError("stale-fix");
        return;
      }
      fix = device ? { ...device, timestamp: Math.floor(reply.room.now - age) }
        : { latitude: target.point.latitude, longitude: target.point.longitude, accuracy: 0, timestamp: reply.room.now };
    } catch (error) {
      if (!signal.aborted) report(error instanceof Error ? error.message : "Check-in gagal. Coba lagi.", true);
    } finally {
      busy = locating = false;
      if (!fix) paint(focus ?? (selectedPoint() ? "#seek-point-heading" : "#seek-action-heading"));
    }
    if (fix) send(target.action(target.point, fix));
  }

  function choosePhoto(file: File | undefined, field: string) {
    if (!file || pendingQuestion(room)?.family !== "photo") return;
    releasePhoto();
    clueDraft.feedback = undefined;
    if (!file.size || file.size > 2 * 1024 * 1024 || (file.type && !acceptedPhotoTypes.has(file.type))) {
      reportError("invalid-photo", undefined, true);
    } else {
      clueDraft.photo = { file, preview: URL.createObjectURL(file) };
    }
    paint(focusSelector(field));
  }

  async function sendPhoto() {
    const question = pendingQuestion(room);
    const chosen = clueDraft.photo;
    if (!room || !chosen || !question || question.family !== "photo" || clueDraft.preparingPhoto || busy || pending) return;
    const turn = room.turn;
    clueDraft.preparingPhoto = true;
    clueDraft.feedback = undefined;
    paint();
    try {
      const photo = await encodePhoto(chosen.file);
      if (signal.aborted || pendingQuestion(room)?.id !== question.id || clueDraft.photo !== chosen) return;
      clueDraft.preparingPhoto = false;
      send({ type: "answer-question", turn, questionId: question.id, photo }, "#seek-hand-heading");
    } catch {
      if (signal.aborted || clueDraft.photo !== chosen) return;
      clueDraft.preparingPhoto = false;
      reportError("invalid-photo", undefined, true);
      paint(focusSelector("photo-file"));
    }
  }

  function askClue() {
    if (!room || room.phase !== "seeking") return;
    const { option, existing } = selectedQuestion(room, clueDraft);
    if (existing) {
      report("Jawaban dibuka kembali.", false, true);
      paint(`#seek-question-${CSS.escape(existing.id)}`);
      return;
    }
    const referenceId = room.clues?.referenceId;
    if (!option || !referenceId) return;
    const { radiusMeters, landmarkId } = option;
    const previousReferenceId = clueDraft.family === "warmer" ? room.clues?.previousReferenceId : undefined;
    send({ type: "ask", turn: room.turn, family: clueDraft.family, referenceId, previousReferenceId, radiusMeters, landmarkId }, "#seek-clue-heading");
  }

  function answerClue(unavailablePhoto: boolean) {
    const question = pendingQuestion(room);
    if (!room || !question) return;
    const turn = room.turn;
    if (unavailablePhoto && question.family === "photo") {
      send({ type: "photo-unavailable", turn, questionId: question.id }, "#seek-hand-heading");
    } else if (!unavailablePhoto && question.choices?.some(choice => choice.id === clueDraft.answer)) {
      send({ type: "answer-question", turn, questionId: question.id, choiceId: clueDraft.answer }, "#seek-hand-heading");
    }
  }

  function keepCards() {
    if (!room) return;
    const { selected, discards, complete } = drawSelection(room, clueDraft);
    if (complete) send({ type: "choose-cards", turn: room.turn, cardIds: selected.map(card => card.id),
      discardIds: discards.length ? discards.map(card => card.id) : undefined }, "#seek-hand-heading");
  }

  async function copy() {
    if (!room) return;
    try {
      await navigator.clipboard.writeText(inviteUrl(seekMode, room.code, room.edition.board).href);
      if (!signal.aborted) report("Tautan undangan disalin.");
    } catch {
      if (!signal.aborted) report("Buka menu tautan undangan untuk menyalinnya.", true);
    }
    paint();
  }

  function reconnect() {
    if (pending) void submitPending(true);
    else void refresh();
  }

  root.addEventListener("click", event => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>("button[data-action]");
    if (!button) return;
    switch (button.dataset.action) {
      case "back": returnToSetup(); break;
      case "retry": reconnect(); break;
      case "create":
      case "replay": send({ type: "create", board: room?.edition.board ?? requestedBoard }); break;
      case "new-room":
        if (busy || pending) return;
        cancelRead();
        setCode("");
        feedback = undefined;
        paint("#seek-room-heading");
        break;
      case "copy": void copy(); break;
      case "map":
        map.shown = !map.shown;
        if (!map.shown) {
          vectorMap?.destroy();
          vectorMap = undefined;
        } else if (!map.vectorMode) {
          void resolveMapConfig().then(config => {
            if (!signal.aborted && map.shown && !map.vectorMode && config.mode === "geoapify-vector") {
              map.vectorMode = true;
              paint();
            }
          });
        }
        paint();
        break;
      case "vector-map":
        map.vectorMode = true;
        map.failed = false;
        paint();
        break;
      case "retry-map":
        map.failed = false;
        paint(focusSelector("map"));
        break;
      case "open-start":
        startOpen = true;
        feedback = undefined;
        paint("#seek-action-heading");
        break;
      case "ready":
      case "unready":
        if (room?.phase === "lobby") {
          send({ type: "ready", ready: button.dataset.action === "ready", roleRevision: room.roleRevision });
        }
        break;
      case "start": send({ type: "start" }); break;
      case "point":
        if (!room || busy || pending || !pointAction(room) || !button.dataset.point) return;
        selectedId = button.dataset.point;
        feedback = undefined;
        paint("#seek-point-heading");
        break;
      case "close-point": {
        const point = selectedPoint();
        selectedId = undefined;
        feedback = undefined;
        paint(point && (room?.clues || !room?.ruledOut.includes(point.id)) ? focusSelector(`list-${point.id}`) : "#seek-board-heading");
        break;
      }
      case "open-board": view.querySelector<HTMLElement>("#seek-board-heading")?.focus(); break;
      case "gps": void locate(false); break;
      case "simulate": void locate(true); break;
      case "gps-reference": void locate(false, true); break;
      case "simulate-reference": void locate(true, true); break;
      case "ask-clue": askClue(); break;
      case "answer-clue": answerClue(false); break;
      case "answer-photo": void sendPhoto(); break;
      case "no-photo": answerClue(true); break;
      case "keep-cards": keepCards(); break;
      case "delay-clues":
      case "swap-card":
        if (room?.phase === "seeking" && button.dataset.card) {
          const cardId = button.dataset.card;
          const discardId = button.dataset.action === "swap-card" ? clueDraft.discard[cardId] : undefined;
          send({ type: "play-card", turn: room.turn, cardId, discardId }, "#seek-hand-heading");
        }
        break;
      case "confirm-exit":
      case "cancel-exit":
        confirmingExit = button.dataset.action === "confirm-exit";
        paint(focusSelector(confirmingExit ? "leave" : "confirm-exit"));
        break;
      case "leave":
        if (room && confirmingExit && (room.phase === "lobby" || room.phase === "head-start" || room.phase === "seeking" || room.phase === "regroup")) {
          send({ type: "leave", phase: room.phase, turn: room.turn });
        }
        break;
    }
  }, { signal });
  root.addEventListener("input", event => {
    if (event.target instanceof HTMLInputElement && event.target.name === "code") joinInput = event.target.value;
  }, { signal });
  root.addEventListener("change", event => {
    const field = event.target;
    if (!(field instanceof HTMLInputElement || field instanceof HTMLSelectElement)) return;
    if (field.name === "first-hider") {
      const hider = field.value;
      if (hider === "host" || hider === "guest") send({ type: "assign", hider }, focusSelector(`role-${hider}`));
      return;
    }
    if (!room || room.phase !== "seeking") return;
    if (field instanceof HTMLInputElement && field.name === "clue-photo") {
      choosePhoto(field.files?.[0], field.dataset.focus ?? "photo-file");
      return;
    }
    switch (field.name) {
      case "clue-family":
        if (!Object.hasOwn(questionFamily, field.value)) return;
        clueDraft.family = field.value as keyof typeof questionFamily;
        clueDraft.input = "";
        break;
      case "clue-input": clueDraft.input = field.value; break;
      case "clue-answer": clueDraft.answer = field.value; break;
      case "discard-card":
        if (field.dataset.card) clueDraft.discard[field.dataset.card] = field.value;
        break;
      case "keep-card":
      case "draw-discard": {
        if (!(field instanceof HTMLInputElement)) return;
        const selection = field.name === "keep-card" ? clueDraft.cards : clueDraft.cardDiscards;
        if (field.checked) selection.add(field.value);
        else selection.delete(field.value);
        if (field.name === "keep-card") clueDraft.cardDiscards.clear();
        break;
      }
      default: return;
    }
    clueDraft.feedback = undefined;
    paint();
  }, { signal });
  root.addEventListener("submit", event => {
    if (!(event.target instanceof HTMLFormElement) || event.target.id !== "seek-join") return;
    event.preventDefault();
    const code = joinInput.trim().toUpperCase();
    if (roomCodePattern.test(code)) send({ type: "join", code });
  }, { signal });
  root.addEventListener("error", event => {
    if (event.target instanceof HTMLImageElement && event.target.closest("#seek-map") && !map.failed) {
      map.failed = true;
      paint();
    }
  }, { capture: true, signal });
  window.addEventListener("online", reconnect, { signal });
  window.addEventListener("offline", () => {
    disconnected = true;
    paint();
  }, { signal });
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) reconnect();
  }, { signal });

  const poll = window.setInterval(() => {
    if (!document.hidden && navigator.onLine && (room?.phase === "lobby" || active(room) || disconnected)) void refresh();
  }, 2500);
  const clock = window.setInterval(() => {
    if (room && neededStart !== needsStart(room, now())) paint();
    else updateClock();
  }, 250);

  if (pending) paint();
  else void refresh();
  return () => {
    vectorMap?.destroy();
    releasePhoto();
    mount.abort();
    window.clearInterval(clock);
    window.clearInterval(poll);
  };
}
