import type { LocationFix, SeekAction, SeekReply, SeekRoom, SoloPoint } from "@kelana-ria/contracts";
import { getLocation } from "./device-location";
import { inviteUrl, pendingEntry, player, roomCodePattern, roomTransport, type EntryAction, type Feedback } from "./multiplayer-room";
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
  "hider-only": "Hanya pemain yang bersembunyi bisa mengunci titik.",
  "seeker-only": "Hanya pencari yang bisa menyelidiki titik.",
  "already-locked": "Titik sembunyi sudah terkunci.",
  "already-ruled-out": "Titik ini sudah diperiksa. Pilih titik lain.",
  "unknown-checkpoint": "Titik ini tidak tersedia di edisi ini.",
  "invalid-fix": "Lokasi tidak bisa diverifikasi. Coba check-in lagi.",
  "stale-fix": "Data lokasi sudah kedaluwarsa. Coba check-in lagi untuk meminta lokasi baru.",
  "inaccurate-fix": "Lokasi kurang akurat. Cari area terbuka lalu coba lagi.",
  "outside-radius": "Kamu berada di luar radius check-in. Dekati titiknya lalu coba lagi.",
};

type RoomAction = SeekAction extends infer A ? A extends SeekAction ? Omit<A, "actionId"> : never : never;
type RequestAction = (EntryAction | RoomAction) & { actionId: string };
type LocationAction = (point: SoloPoint, fix: LocationFix) => RoomAction;

export function mountSeekPlay(root: HTMLElement, returnToSetup: () => void) {
  const mount = new AbortController();
  const { signal } = mount;
  const { credential, request } = roomTransport<SeekReply, RequestAction>(apiPath, "kelana-seek-bootstrap");
  let inviteCode = (new URLSearchParams(location.search).get("room") ?? "").trim().toUpperCase();
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
  let neededStart = false;
  const map = { shown: false, failed: false, url: mapUrl };

  root.innerHTML = `<nav class="solo-nav" aria-label="Navigasi simulasi">
    ${action("Kembali ke pilihan", "back", "solo-back")}
    <span class="solo-label">Simulasi</span>
  </nav>
  <header class="solo-header">
    <h1 tabindex="-1" lang="en">Hide &amp; Seek</h1>
    <p>Jakarta (Compact) · Berdua <span>Edisi siap pakai</span></p>
  </header>
  <p id="seek-announcement" class="sr-only" role="status" aria-atomic="true"></p>
  <div id="seek-connection" class="solo-connection" hidden></div>
  <div id="seek-view"><p role="status">Memuat ruang…</p></div>`;
  const view = root.querySelector<HTMLElement>("#seek-view")!;
  const connection = root.querySelector<HTMLElement>("#seek-connection")!;
  const announcement = root.querySelector<HTMLElement>("#seek-announcement")!;
  root.querySelector<HTMLElement>("h1")!.focus();

  const now = () => room ? room.now + performance.now() - serverSampleAt : Date.now();
  const roomPath = (code: string) => `${apiPath}/${encodeURIComponent(code)}`;
  const focusSelector = (key: string) => `[data-focus="${CSS.escape(key)}"]`;
  const selectedPoint = () => room?.edition.checkpoints.find(point => point.id === selectedId);

  function setCode(code: string) {
    inviteCode = joinInput = code;
    const url = new URL(location.href);
    if (code) url.searchParams.set("room", code);
    else url.searchParams.delete("room");
    history.replaceState(history.state, "", url);
  }

  function report(text: string, error = false) {
    feedback = { text, error };
    announcement.textContent = text;
  }

  function reportError(error: string, distanceMeters?: number) {
    const distance = distanceMeters === undefined ? "" : `Jarak ${Math.round(distanceMeters)} m. `;
    report(distance + (errors[error] ?? "Permintaan belum berhasil. Coba lagi."), true);
  }

  function updateClock() {
    if (!room) return;
    const current = now();
    const timer = view.querySelector("[data-timer]");
    const serverClock = view.querySelector("[data-server-clock]");
    const countdown = remaining((room.phaseEndsAt ?? current) - current);
    const localTime = wib(current);
    if (timer && timer.textContent !== countdown) timer.textContent = countdown;
    if (serverClock && serverClock.textContent !== localTime) serverClock.textContent = localTime;
  }

  function paint(focus?: string) {
    if (signal.aborted) return;
    const focused = document.activeElement as HTMLElement | null;
    const key = focused?.dataset.focus;
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
      view.innerHTML = roomView(room, { now: current, busy: locked, locating, startOpen, point: selectedPoint(), feedback, map }, confirmingExit);
    } else {
      view.innerHTML = loading && !disconnected ? '<p role="status">Memuat ruang…</p>' : entry(inviteCode, locked, feedback);
    }
    const join = view.querySelector<HTMLInputElement>("#seek-invite-input");
    if (join) join.value = joinInput;
    updateClock();
    const target = (focus && root.querySelector<HTMLElement>(focus))
      || (key && root.querySelector<HTMLElement>(focusSelector(key)))
      || (key?.startsWith("map-") && root.querySelector<HTMLElement>(focusSelector("map")));
    if (target) target.focus({ preventScroll: !focus });
    if (target === join && selection && join) join.setSelectionRange(selection[0], selection[1]);
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
    }
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
        reportError(reply.error, reply.distanceMeters);
        if (reply.error === "room-phase-changed" || reply.error === "turn-changed") confirmingExit = false;
        if (reply.error === "room-required" && room) {
          room = undefined;
          focus = "#seek-room-heading";
        }
      } else if (submitted.type === "check-in" && room?.phase === submitted.phase && room.turn === submitted.turn) {
        report("Check-in titik awal berhasil.");
        startOpen = false;
      } else if (submitted.type === "lock" && room?.ownLock) {
        report("Titik sembunyi berhasil dikunci.");
      } else if (submitted.type === "investigate" && reply.investigation === "miss" && room?.phase === "seeking" && room.turn === submitted.turn) {
        report("Penyelidikan selesai. Pilih titik lain.");
      } else if (submitted.type === "leave" && !reply.room) {
        room = undefined;
        setCode("");
        focus = "#seek-room-heading";
      }
      if (!focus && ["check-in", "ready", "lock", "investigate"].includes(submitted.type)) focus = "#seek-point-heading, #seek-action-heading";
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
    feedback = undefined;
    void submitPending(false, focus);
  }

  function locationTarget(state: SeekRoom): { point: SoloPoint; action: LocationAction } | undefined {
    const { phase, turn } = state;
    if (startOpen && needsStart(state, now()) && (phase === "lobby" || phase === "seeking" || phase === "regroup")) {
      return { point: state.edition.start, action: (_, fix) => ({ type: "check-in", phase, turn, fix }) };
    }
    const type = pointAction(state);
    const point = selectedPoint();
    if (type && point && !state.ruledOut.includes(point.id)) {
      return { point, action: ({ id: checkpointId }, fix) => ({ type, turn, checkpointId, fix }) };
    }
  }

  async function locate(simulated: boolean) {
    if (!room || busy || pending || signal.aborted) return;
    const { code, turn, phase } = room;
    const target = locationTarget(room);
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
      if (room.phase !== phase || room.turn !== turn || locationTarget(room)?.point.id !== target.point.id) return;
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
      if (!fix) paint(focus ?? "#seek-point-heading, #seek-action-heading");
    }
    if (fix) send(target.action(target.point, fix));
  }

  async function copy() {
    if (!room) return;
    try {
      await navigator.clipboard.writeText(inviteUrl(seekMode, room.code).href);
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
      case "replay": send({ type: "create" }); break;
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
        paint(point && !room?.ruledOut.includes(point.id) ? focusSelector(`list-${point.id}`) : "#seek-board-heading");
        break;
      }
      case "gps": void locate(false); break;
      case "simulate": void locate(true); break;
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
    if (!(event.target instanceof HTMLInputElement) || event.target.name !== "first-hider") return;
    const hider = event.target.value;
    if (hider === "host" || hider === "guest") send({ type: "assign", hider }, focusSelector(`role-${hider}`));
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
    mount.abort();
    window.clearInterval(clock);
    window.clearInterval(poll);
  };
}
