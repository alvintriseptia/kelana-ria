import type { DuoAction, DuoReply, DuoRoom, LocationFix, SoloChallenge, SoloPoint } from "@kelana-ria/contracts";
import { getLocation } from "./device-location";
import { board, checkpointPanel, entry, inviteUrl, lobby, player, result, score } from "./duo-view";
import { action, remaining, wib } from "./solo-view";
import "./solo-play.css";
import "./duo-play.css";

const apiPath = "/api/duo";
const pendingEntryKey = "kelana-duo-pending-entry";
const roomCodePattern = /^[0-9A-F]{8}$/;
const mapUrl = new URL("./assets/solo-schematic.webp", import.meta.url).href;
const errors: Record<string, string> = {
  "room-not-found": "Ruang dengan kode ini tidak ditemukan. Periksa kode undangan.",
  "room-full": "Ruang ini sudah penuh atau ronde telah ditutup. Minta undangan baru.",
  "room-required": "Kursi untuk perangkat ini belum tersedia. Gabung dengan kode undangan.",
  "room-phase-changed": "Status ronde berubah. Periksa status terbaru sebelum memilih keluar lagi.",
  "host-only": "Hanya tuan rumah yang bisa memulai ronde.",
  "players-not-ready": "Kedua pemain harus siap sebelum ronde dimulai.",
  "start-unverified": "Verifikasi titik awal belum berlaku. Check-in di titik awal lalu nyatakan siap.",
  "round-finished": "Ronde sudah selesai. Hasil terakhir sudah dimuat.",
  "unknown-checkpoint": "Landmark ini tidak tersedia di edisi ini.",
  "already-claimed": "Tantangan ditutup karena landmark sudah diklaim.",
  "visit-required": "Lakukan check-in di landmark ini untuk membuka tantangan.",
  "fresh-fix-required": "Posisi perlu diverifikasi ulang untuk menyelesaikan tantangan ini.",
  "wrong-answer": "Jawaban belum tepat. Coba lagi setelah jeda.",
  cooldown: "Tunggu hingga waktu mencoba lagi selesai.",
  "invalid-choice": "Pilihan jawaban tidak tersedia. Pilih lagi.",
  "invalid-fix": "Lokasi tidak bisa diverifikasi. Coba check-in lagi.",
  "stale-fix": "Data lokasi sudah kedaluwarsa. Coba check-in lagi untuk meminta lokasi baru.",
  "inaccurate-fix": "Lokasi kurang akurat. Cari area terbuka lalu coba lagi.",
  "outside-radius": "Kamu berada di luar radius check-in. Dekati titiknya lalu coba lagi.",
  "invalid-request": "Permintaan belum berhasil. Periksa pilihanmu dan coba lagi.",
  "pass-required": "Ruang berbayar ini menunggu tuan rumah membuka sesi dengan pass yang lunas.",
  "pass-already-bound": "Pass sesi ini sudah terikat ke ruang lain dan tidak dapat digunakan ulang.",
  "invalid-pass": "Pass sesi tidak valid atau belum lunas.",
};

type EntryAction = { type: "create" } | { type: "join"; code: string; passId?: string };
type EntryRequest = EntryAction & { actionId: string };
type RoundAction = DuoAction extends infer A ? A extends DuoAction ? Omit<A, "actionId"> : never : never;
type RequestAction = (EntryAction | RoundAction) & { actionId: string };
type Pending = { path: string; action: RequestAction };

function readEntryRequest(roomCode: string): EntryRequest | undefined {
  try {
    const saved = JSON.parse(sessionStorage.getItem(pendingEntryKey) ?? "null");
    const request = saved?.request;
    if (saved?.roomCode !== roomCode || typeof request?.actionId !== "string" || !/^[0-9a-f-]{36}$/.test(request.actionId)) return;
    const { actionId, type } = request;
    if (type === "create") return { actionId, type };
    if (type === "join" && typeof request.code === "string" && roomCodePattern.test(request.code)) {
      return typeof request.passId === "string" && request.passId
        ? { actionId, type, code: request.code, passId: request.passId }
        : { actionId, type, code: request.code };
    }
  } catch {
    // Browsers can restrict session storage. The current page can still retry in memory.
  }
}

function rememberEntryRequest(entry?: { roomCode: string; request: EntryRequest }) {
  try {
    if (entry) sessionStorage.setItem(pendingEntryKey, JSON.stringify(entry));
    else sessionStorage.removeItem(pendingEntryKey);
  } catch {
    // The request remains available in memory if storage is unavailable.
  }
}

async function fetchReply(path: string, signal: AbortSignal, body?: RequestAction): Promise<DuoReply> {
  const response = await fetch(path, {
    method: body ? "POST" : "GET",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    credentials: "same-origin",
    cache: "no-store",
    signal: AbortSignal.any([signal, AbortSignal.timeout(10_000)]),
  });
  if (response.status >= 500) throw new Error(`HTTP ${response.status}`);
  const reply: DuoReply = await response.json();
  if (!response.ok && !reply.error) throw new Error(`HTTP ${response.status}`);
  return reply;
}

export function mountDuoPlay(root: HTMLElement, returnToSetup: () => void) {
  const mount = new AbortController();
  const { signal } = mount;
  let room: DuoRoom | undefined;
  const initialParams = new URLSearchParams(location.search);
  let inviteCode = (initialParams.get("room") ?? "").trim().toUpperCase();
  let pendingPassId = (initialParams.get("pass") ?? "").trim();
  const restored = readEntryRequest(inviteCode);
  let joinInput = restored?.type === "join" ? restored.code : inviteCode;
  let established = false;
  let loading = !restored;
  let serverSampleAt = 0;
  let selectedId: string | undefined;
  let startOpen = false;
  let choiceId = "";
  let challenge: SoloChallenge | undefined;
  let feedback: { text: string; error?: boolean } | undefined;
  let disconnected = false;
  let busy = false;
  let seekingLocation = false;
  let pending: Pending | undefined = restored ? { path: apiPath, action: restored } : undefined;
  let reading: AbortController | undefined;
  let confirmingExit = false;
  let mapShown = false;
  let mapFailed = false;
  let eligibility = "";

  root.innerHTML = `<nav class="solo-nav" aria-label="Navigasi simulasi">
    ${action("Kembali ke pilihan", "back", "solo-back")}
    <span class="solo-label">Simulasi</span>
  </nav>
  <header class="solo-header">
    <h1 id="duo-title" tabindex="-1" lang="en">Claim the City</h1>
    <p>Jakarta (Compact) · Berdua <span>Edisi siap pakai</span></p>
  </header>
  <p id="duo-announcement" class="sr-only" role="status" aria-atomic="true"></p>
  <div id="duo-connection" class="solo-connection" hidden></div>
  <div id="duo-view"><p role="status">Memuat ruang…</p></div>`;

  const view = root.querySelector<HTMLElement>("#duo-view")!;
  const connection = root.querySelector<HTMLElement>("#duo-connection")!;
  const announcement = root.querySelector<HTMLElement>("#duo-announcement")!;
  root.querySelector<HTMLElement>("#duo-title")!.focus();

  function now() {
    return room ? room.now + performance.now() - serverSampleAt : Date.now();
  }

  function roomPath(code: string) {
    return `${apiPath}/${encodeURIComponent(code)}`;
  }

  function setCode(code: string) {
    inviteCode = joinInput = code;
    const url = new URL(location.href);
    if (code) url.searchParams.set("room", code);
    else url.searchParams.delete("room");
    url.searchParams.delete("pass");
    history.replaceState(history.state, "", url);
  }

  function selectedPoint() {
    return room?.phase === "lobby" && startOpen ? room.edition.start
      : room?.edition.checkpoints.find(point => point.id === selectedId);
  }

  function selectPoint(id?: string) {
    selectedId = id;
    challenge = undefined;
    choiceId = "";
    feedback = undefined;
  }

  function report(text: string, error = false) {
    feedback = { text, error };
    announcement.textContent = text;
  }

  function reportError(error: string, distanceMeters?: number) {
    const distance = distanceMeters === undefined ? "" : `Jarak ${Math.round(distanceMeters)} m. `;
    report(distance + (errors[error] ?? "Permintaan belum berhasil. Coba lagi."), true);
  }

  function eligibilityState() {
    if (room?.phase === "lobby") return String((room.startVerifiedUntil ?? 0) > now());
    return selectedId && room?.phase === "active"
      ? `${room.visits[selectedId] > now()}:${room.cooldowns[selectedId] > now()}` : "";
  }

  function renderRoom(state: DuoRoom, locked: boolean) {
    const boardMarkup = board(state, selectedId, { shown: mapShown, failed: mapFailed, url: mapUrl });
    if (state.phase === "finished" || state.phase === "canceled") {
      return `${result(state, locked)}${state.phase === "finished" ? `<div class="duo-final-board">${boardMarkup}</div>` : ""}`;
    }
    const active = state.phase === "active";
    const deadline = state.deadline;
    const progress = active && deadline !== null ? `<section class="solo-progress" aria-label="Waktu dan skor">
      <div class="solo-clock">
        <p>Sisa waktu</p>
        <span role="timer" aria-label="Sisa waktu" data-timer></span>
        <small>Berakhir <time datetime="${new Date(deadline).toISOString()}">${wib(deadline)}</time></small>
      </div>
      ${score(state)}
    </section>` : "";
    const panels = active
      ? checkpointPanel(state, selectedPoint(), challenge, choiceId, now(), locked, seekingLocation, feedback)
      : lobby(state, now(), startOpen, locked, seekingLocation, feedback);
    const exit = active ? "Keluar dari ronde" : state.seat === "host" ? "Batalkan ruang" : "Keluar dari ruang";
    return `${progress}
      <div class="solo-layout">${panels}${boardMarkup}</div>
      <footer class="solo-footer">
        ${confirmingExit
          ? `<p>${active ? "Keluar sekarang memberi kemenangan kepada pemain lain." : "Tutup kursimu di ruang tunggu?"}</p>
             ${active && state.startedAt !== null ? '<p>Waktu berjalan <span data-elapsed></span> · Sisa waktu <span data-remaining></span></p>' : ""}
             ${action(active || state.seat === "guest" ? "Ya, keluar" : "Ya, batalkan", "leave", "secondary", locked)}
             ${action("Kembali ke ronde", "cancel-exit")}`
          : action(exit, "confirm-exit", "solo-back", locked)}
      </footer>`;
  }

  function paint(focus?: string) {
    if (signal.aborted) return;
    const focused = document.activeElement as HTMLElement | null;
    const key = focused?.dataset.focus;
    const focusWasInView = view.contains(focused);
    const selection = focused instanceof HTMLInputElement && key === "invite-input"
      ? [focused.selectionStart, focused.selectionEnd] : undefined;
    const locked = busy || Boolean(pending);
    connection.hidden = !pending && !disconnected;
    if (!connection.hidden) {
      const warning = pending ? busy ? "Menunggu konfirmasi dari server…"
        : "Belum ada konfirmasi dari server. Coba lagi untuk memeriksa dan mengirim ulang."
        : "Koneksi terputus. Sambungkan kembali untuk memuat status ruang terbaru.";
      connection.innerHTML = `<p role="status">${warning}</p>${busy ? "" : action("Coba lagi", "retry")}`;
    }
    view.innerHTML = room ? renderRoom(room, locked)
      : loading && !disconnected ? '<p role="status">Memuat ruang…</p>' : entry(inviteCode, locked, feedback);
    const join = root.querySelector<HTMLInputElement>("#duo-invite-input");
    if (join) join.value = joinInput;
    eligibility = eligibilityState();
    updateClock();
    let target = focus ? root.querySelector<HTMLElement>(focus) : undefined;
    if (!target && key) target = root.querySelector<HTMLElement>(`[data-focus="${CSS.escape(key)}"]`);
    if (!target && key?.startsWith("map-")) target = root.querySelector<HTMLElement>('[data-focus="map"]');
    if (!target && key && focusWasInView && room?.phase === "active" && (key.startsWith("choice-") || key.startsWith("list-") || key === "answer")) {
      target = root.querySelector<HTMLElement>("#duo-action-heading");
    }
    target?.focus({ preventScroll: !focus });
    if (target === join && selection && join) join.setSelectionRange(selection[0], selection[1]);
  }

  function updateClock() {
    if (!room) return;
    const current = now();
    const values: Record<string, number> = {
      timer: (room.deadline ?? current) - current,
      remaining: (room.deadline ?? current) - current,
      elapsed: current - (room.startedAt ?? current),
      cooldown: (selectedId ? room.cooldowns[selectedId] ?? current : current) - current,
    };
    for (const [key, duration] of Object.entries(values)) {
      const node = view.querySelector(`[data-${key}]`);
      if (!node) continue;
      const text = key === "cooldown" ? `Coba lagi dalam ${remaining(duration)}.` : remaining(duration);
      if (node.textContent !== text) node.textContent = text;
    }
  }

  function receive(reply: DuoReply) {
    const next = reply.room;
    if (!next) return { changed: false };
    const previous = room;
    // Delayed responses should never rewind public progress on an established room.
    if (previous?.code === next.code && (previous.events.length > next.events.length || previous.now > next.now)) {
      return { changed: false };
    }
    const before = previous && { ...previous, now: 0 };
    const changed = JSON.stringify(before) !== JSON.stringify({ ...next, now: 0 });
    room = next;
    serverSampleAt = performance.now();
    let focus: string | undefined;
    if (next.code !== previous?.code) {
      setCode(next.code);
      focus = "#duo-room-heading";
    }
    if (next.phase !== previous?.phase) {
      selectPoint();
      startOpen = confirmingExit = false;
      if (next.phase === "active") {
        announcement.textContent = "Ronde dimulai. Pilih landmark untuk check-in.";
        if (previous) focus = "#duo-action-heading";
      } else if (next.phase !== "lobby") {
        announcement.textContent = "Ronde selesai. Hasil permainan tersedia.";
        focus = "#duo-result-heading";
      }
    } else if (previous?.events.length !== next.events.length) {
      const claim = next.events.at(-1);
      const point = next.edition.checkpoints.find(point => point.id === claim?.checkpointId);
      const zone = next.zones.find(zone => zone.name === point?.zone);
      if (claim?.type === "claimed" && claim.seat && point && zone) {
        announcement.textContent = `${player[claim.seat]} mengklaim ${point.name}. ${zone.name} ${zone.owner ? `dikuasai ${player[zone.owner]}` : "netral"}.`;
      }
    } else if (next.phase === "lobby" && previous && JSON.stringify(previous.seats) !== JSON.stringify(next.seats)) {
      announcement.textContent = next.seats.host.ready && next.seats.guest.ready
        ? "Kedua pemain siap." : next.seats.guest.joined ? "Status kesiapan pemain diperbarui." : "Menunggu teman bergabung.";
    }
    if (selectedId && next.owners[selectedId]) challenge = undefined;
    if (selectedId && reply.challenge?.checkpointId === selectedId && next.phase === "active" && !next.owners[selectedId]) challenge = reply.challenge;
    return { changed, focus };
  }

  async function credential(requestSignal: AbortSignal) {
    if (established) return;
    const read = () => fetchReply(apiPath, requestSignal);
    const reply = navigator.locks ? await navigator.locks.request("kelana-duo-bootstrap", { signal: requestSignal }, read) : await read();
    if (reply.error) throw new Error(reply.error);
    established = true;
  }

  async function request(path: string, requestSignal: AbortSignal, body?: RequestAction) {
    await credential(requestSignal);
    let reply = await fetchReply(path, requestSignal, body);
    if (reply.error === "session-required") {
      established = false;
      await credential(requestSignal);
      reply = await fetchReply(path, requestSignal, body);
    }
    return reply;
  }

  function cancelRead() {
    reading?.abort();
    reading = undefined;
  }

  async function refresh(checkpointId?: string) {
    if (signal.aborted || busy || pending) return;
    if (checkpointId) cancelRead();
    if (reading) return;
    const read = new AbortController();
    reading = read;
    const requestSignal = AbortSignal.any([signal, read.signal]);
    let focus: string | undefined;
    let repaint = loading || disconnected || Boolean(checkpointId);
    let autoClaimPass = "";
    try {
      await credential(requestSignal);
      if (requestSignal.aborted) return;
      disconnected = false;
      if (inviteCode) {
        if (!roomCodePattern.test(inviteCode)) {
          setCode("");
          reportError("room-not-found");
          repaint = true;
          return;
        }
        const path = roomPath(inviteCode);
        const reply = await request(checkpointId ? `${path}/challenge?${new URLSearchParams({ checkpointId })}` : path, requestSignal);
        if (requestSignal.aborted) return;
        if (reply.room) {
          pendingPassId = "";
          const update = receive(reply);
          focus = update.focus;
          repaint ||= update.changed;
        } else if (!room && reply.error === "room-required" && pendingPassId) {
          autoClaimPass = pendingPassId;
          pendingPassId = "";
        } else if (room && reply.error === "room-required") {
          room = undefined;
          selectPoint();
          repaint = true;
        }
        if (reply.error && (checkpointId || reply.error !== "room-required")) {
          reportError(reply.error);
          repaint = true;
        }
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
        if (autoClaimPass) send({ type: "join", code: inviteCode, passId: autoClaimPass });
        else if (repaint) paint(focus);
      }
    }
  }

  async function submitPending(reconnect = false) {
    if (!pending || busy || signal.aborted) return;
    const current = pending;
    cancelRead();
    busy = true;
    paint();
    let focus: string | undefined;
    try {
      if (reconnect && room) {
        const snapshot = await request(roomPath(room.code), signal);
        if (signal.aborted) return;
        focus = receive(snapshot).focus;
      }
      const reply = await request(current.path, signal, current.action);
      if (signal.aborted) return;
      const { action: submitted } = current;
      if (!reply.room && !reply.error && submitted.type !== "leave") throw new Error("Missing room");
      pending = undefined;
      disconnected = false;
      focus = receive(reply).focus ?? focus;
      if (submitted.type === "create" || submitted.type === "join") rememberEntryRequest();
      if (reply.error) {
        reportError(reply.error, reply.distanceMeters);
        if (reply.error === "room-phase-changed") confirmingExit = false;
        if (reply.error === "wrong-answer") choiceId = "";
        if (reply.error === "visit-required") challenge = undefined;
      } else if (submitted.type === "check-in") {
        const distance = reply.distanceMeters === undefined ? "" : `Jarak ${Math.round(reply.distanceMeters)} m. `;
        if (room?.phase === "lobby") report(`${distance}Check-in titik awal berhasil.`);
        else if (reply.challenge) report(`${distance}Check-in berhasil. Tantangan terbuka.`);
      } else if (submitted.type === "answer" && room?.phase === "active") {
        const point = room.edition.checkpoints.find(point => point.id === submitted.checkpointId);
        if (point) report(`${point.name} diklaim oleh ${player[room.seat]}.`);
      } else if (submitted.type === "leave" && !reply.room) {
        room = undefined;
        setCode("");
        selectPoint();
        confirmingExit = startOpen = false;
        focus = "#duo-room-heading";
      }
      if (["check-in", "answer", "ready"].includes(submitted.type) && !focus) focus = "#duo-action-heading";
    } catch {
      if (!signal.aborted) disconnected = true;
    } finally {
      busy = false;
      paint(focus);
    }
  }

  function send(request: EntryAction | RoundAction) {
    if (busy || pending || signal.aborted) return;
    const actionId = crypto.randomUUID();
    if (request.type === "create" || request.type === "join") {
      const action = { ...request, actionId };
      pending = { path: apiPath, action };
      rememberEntryRequest({ roomCode: inviteCode, request: action });
    } else if (room) {
      pending = { path: roomPath(room.code), action: { ...request, actionId } };
    } else return;
    feedback = undefined;
    void submitPending();
  }

  async function locate(point: SoloPoint, simulated: boolean, answer?: string) {
    if (!room || busy || pending || signal.aborted) return;
    cancelRead();
    busy = true;
    seekingLocation = !simulated;
    feedback = undefined;
    paint();
    let fix: LocationFix | undefined;
    let focus: string | undefined;
    try {
      const device = simulated ? undefined : await getLocation();
      if (signal.aborted) return;
      seekingLocation = false;
      let snapshot: DuoReply;
      try {
        snapshot = await request(roomPath(room.code), signal);
      } catch {
        if (!signal.aborted) disconnected = true;
        return;
      }
      if (signal.aborted) return;
      if (!snapshot.room) {
        if (snapshot.error) reportError(snapshot.error);
        return;
      }
      focus = receive(snapshot).focus;
      disconnected = false;
      if (selectedPoint()?.id !== point.id || snapshot.room.owners[point.id]) return;
      // Preserve sample age when the browser and server clocks differ.
      const age = device ? Date.now() - device.timestamp : 0;
      if (!Number.isFinite(age) || age < 0) {
        reportError("stale-fix");
        return;
      }
      fix = device
        ? { ...device, timestamp: Math.floor(snapshot.room.now - age) }
        : { latitude: point.latitude, longitude: point.longitude, accuracy: 0, timestamp: snapshot.room.now };
    } catch (error) {
      if (!signal.aborted) report(error instanceof Error ? error.message : "Check-in gagal. Coba lagi.", true);
    } finally {
      busy = seekingLocation = false;
      if (!fix) paint(focus ?? "#duo-action-heading");
    }
    if (fix) send(answer ? { type: "answer", checkpointId: point.id, choiceId: answer, fix } : { type: "check-in", checkpointId: point.id, fix });
  }

  async function copy() {
    if (!room) return;
    try {
      await navigator.clipboard.writeText(inviteUrl(room.code).href);
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
    const point = selectedPoint();
    switch (button.dataset.action) {
      case "back": returnToSetup(); break;
      case "retry": reconnect(); break;
      case "create":
      case "replay": send({ type: "create" }); break;
      case "new-room":
        cancelRead();
        setCode("");
        feedback = undefined;
        paint("#duo-room-heading");
        break;
      case "copy": void copy(); break;
      case "map":
        mapShown = !mapShown;
        paint();
        break;
      case "retry-map":
        mapFailed = false;
        paint('[data-focus="map"]');
        break;
      case "open-start":
        startOpen = true;
        feedback = undefined;
        paint("#duo-action-heading");
        break;
      case "ready": send({ type: "ready", ready: true }); break;
      case "unready": send({ type: "ready", ready: false }); break;
      case "start": send({ type: "start" }); break;
      case "point": {
        if (busy || pending || room?.phase !== "active") return;
        const id = button.dataset.point;
        selectPoint(id);
        paint("#duo-action-heading");
        if (id && Object.hasOwn(room.visits, id)) void refresh(id);
        break;
      }
      case "close-point":
        selectPoint();
        paint(point && !room?.owners[point.id] ? `[data-focus="list-${CSS.escape(point.id)}"]` : "#duo-board-heading");
        break;
      case "gps": if (point) void locate(point, false); break;
      case "simulate": if (point) void locate(point, true); break;
      case "confirm-exit":
      case "cancel-exit":
        confirmingExit = button.dataset.action === "confirm-exit";
        paint(`[data-focus="${confirmingExit ? "leave" : "confirm-exit"}"]`);
        break;
      case "leave":
        if (confirmingExit && (room?.phase === "lobby" || room?.phase === "active")) {
          send({ type: "leave", phase: room.phase });
        }
        break;
    }
  }, { signal });

  root.addEventListener("input", event => {
    if (event.target instanceof HTMLInputElement && event.target.name === "code") joinInput = event.target.value;
  }, { signal });

  root.addEventListener("change", event => {
    if (event.target instanceof HTMLInputElement && event.target.name === "choice") choiceId = event.target.value;
  }, { signal });

  root.addEventListener("submit", event => {
    if (!(event.target instanceof HTMLFormElement)) return;
    event.preventDefault();
    if (event.target.id === "duo-join") {
      const code = joinInput.trim().toUpperCase();
      if (roomCodePattern.test(code)) send({ type: "join", code });
    } else if (event.target.id === "duo-challenge" && room?.phase === "active" && choiceId) {
      const point = selectedPoint();
      if (!point || room.cooldowns[point.id] > now() || room.owners[point.id]) return;
      if (room.visits[point.id] > now()) send({ type: "answer", checkpointId: point.id, choiceId });
      else void locate(point, false, choiceId);
    }
  }, { signal });

  root.addEventListener("error", event => {
    if (event.target instanceof HTMLImageElement && event.target.closest("#duo-map") && !mapFailed) {
      mapFailed = true;
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
    if (!document.hidden && navigator.onLine && (room?.phase === "lobby" || room?.phase === "active" || disconnected)) void refresh();
  }, 2500);
  const clock = window.setInterval(() => {
    if (eligibility !== eligibilityState()) paint();
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
