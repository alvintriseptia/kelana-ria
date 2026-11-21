import type { LocationFix, SoloAction, SoloChallenge, SoloPoint, SoloReply, SoloSession } from "@kelana-ria/contracts";
import { action, checkpointList, escapeText, remaining, result, schematic, score, wib } from "./solo-view";
import { getLocation } from "./device-location";
import "./solo-play.css";

const apiPath = "/api/solo";
const mapUrl = new URL("./assets/solo-schematic.webp", import.meta.url);
const errors: Record<string, string> = {
  "outside-radius": "Kamu berada di luar radius check-in. Dekati titiknya lalu coba lagi.",
  "inaccurate-fix": "Lokasi kurang akurat. Cari area terbuka lalu coba lagi.",
  "stale-fix": "Data lokasi sudah kedaluwarsa. Coba check-in lagi untuk meminta lokasi baru.",
  "invalid-fix": "Lokasi tidak bisa diverifikasi. Coba check-in lagi.",
  "start-unverified": "Verifikasi titik awal sudah kedaluwarsa. Check-in ulang untuk memulai.",
  "visit-required": "Lakukan check-in di landmark ini untuk membuka tantangan.",
  "fresh-fix-required": "Kirim lokasi baru untuk menyelesaikan tantangan ini.",
  "cooldown": "Tunggu hingga waktu mencoba lagi selesai.",
  "wrong-answer": "Jawaban belum tepat. Coba lagi setelah jeda.",
  "already-claimed": "Landmark ini sudah diklaim.",
  "round-finished": "Sesi sudah selesai. Hasil terakhir sudah dimuat.",
  "run-in-progress": "Sesi masih berlangsung.",
  "unknown-checkpoint": "Landmark ini tidak tersedia di edisi ini.",
  "invalid-choice": "Pilihan jawaban tidak tersedia. Pilih lagi.",
  "stale-session": "Sesi sudah berubah. Permainan terbaru sudah dimuat.",
};

async function requestSession(signal: AbortSignal, action?: SoloAction, checkpointId?: string): Promise<SoloReply> {
  const endpoint = checkpointId
    ? `${apiPath}/challenge?${new URLSearchParams({ checkpointId })}` : apiPath;
  const response = await fetch(endpoint, {
    method: action ? "POST" : "GET",
    headers: action ? { "Content-Type": "application/json" } : undefined,
    body: action ? JSON.stringify(action) : undefined,
    cache: "no-store",
    credentials: "same-origin",
    signal: AbortSignal.any([signal, AbortSignal.timeout(10_000)]),
  });
  const reply: SoloReply = await response.json();
  if (!reply.session || response.status >= 500) throw new Error(`HTTP ${response.status}`);
  return reply;
}

export function mountSoloPlay(root: HTMLElement, returnToSetup: () => void) {
  const mount = new AbortController();
  const { signal } = mount;
  let session: SoloSession | undefined;
  let serverSampleAt = 0;
  let nextDeadlineSync = 0;
  let selectedId: string | undefined;
  let choiceId = "";
  let challenge: SoloChallenge | undefined;
  let feedback = "";
  let feedbackType = "";
  let previousPhase: SoloSession["phase"] | undefined;
  let busy = false;
  let seekingLocation = false;
  let pending: SoloAction | undefined;
  let disconnected = false;
  let mapShown = false;
  let mapFailed = false;
  let mapRequest: AbortController | undefined;
  let mapImage: string | undefined;
  let confirmingAbandon = false;
  let eligibility = "";

  root.innerHTML = `<nav class="solo-nav" aria-label="Navigasi simulasi">
    ${action("Kembali ke pilihan", "back", "solo-back")}
    <span class="solo-label">Simulasi</span>
  </nav>
  <header class="solo-header">
    <h1 id="solo-title" tabindex="-1" lang="en">Claim the City</h1>
    <p>Jakarta (Compact) · Solo <span>Edisi siap pakai</span></p>
  </header>
  <p class="sr-only" role="status" id="solo-announcement"></p>
  <div id="solo-connection" class="solo-connection" hidden></div>
  <div id="solo-view"><p role="status">Memuat sesi…</p></div>`;

  const view = root.querySelector<HTMLElement>("#solo-view")!;
  const connection = root.querySelector<HTMLElement>("#solo-connection")!;
  const announcement = root.querySelector<HTMLElement>("#solo-announcement")!;
  root.querySelector<HTMLElement>("#solo-title")!.focus();

  function estimatedNow() {
    return session ? session.now + performance.now() - serverSampleAt : Date.now();
  }

  function selectedPoint(): SoloPoint | undefined {
    if (session?.edition.start.id === selectedId) return session?.edition.start;
    return session?.edition.checkpoints.find(point => point.id === selectedId);
  }

  function setSelected(id?: string) {
    selectedId = id;
    history.replaceState({ ...history.state, soloSelection: session && id ? { sessionId: session.id, id } : undefined }, "");
    challenge = undefined;
    choiceId = "";
    feedback = "";
    feedbackType = "";
  }

  function showFeedback(message: string, type = "") {
    feedback = message;
    feedbackType = type;
  }

  function reportError(error: unknown) {
    showFeedback(error instanceof Error ? error.message : "Check-in gagal. Coba lagi.", "error");
  }

  function eligibilityState() {
    if (!session) return "";
    const now = estimatedNow();
    const start = (session.startVerifiedUntil ?? 0) > now;
    const visit = selectedId ? session.visits[selectedId] > now : false;
    const cooldown = selectedId ? session.cooldowns[selectedId] > now : false;
    return `${session.phase}:${start}:${visit}:${cooldown}`;
  }

  function board(state: SoloSession) {
    return `<section class="solo-board" aria-labelledby="solo-board-heading">
      <div class="solo-section-heading">
        <h2 id="solo-board-heading">${state.phase === "active" ? "Pilih landmark" : "Landmark di papan"}</h2>
        <button class="secondary" type="button" data-action="map" data-focus="map" aria-expanded="${mapShown}" aria-controls="solo-map-content">${mapShown ? "Tutup peta" : "Lihat peta"}</button>
      </div>
      <div id="solo-map-content" ${mapShown ? "" : "hidden"}>${mapShown ? mapImage ? schematic(state, mapImage) : mapFailed
        ? `<p class="solo-map-notice" role="status">Peta tidak tersedia. Lanjutkan lewat daftar landmark.</p>${action("Muat ulang peta", "retry-map")}`
        : '<p class="solo-map-notice" role="status">Memuat peta…</p>' : ""}</div>
      ${checkpointList(state, selectedId)}
    </section>`;
  }

  function briefing(state: SoloSession) {
    const { start, durationMs, targets, id } = state.edition;
    const ready = (state.startVerifiedUntil ?? 0) > estimatedNow();
    return `<div class="solo-layout solo-briefing">
      <div class="solo-main-column">
        <section class="solo-objective" aria-labelledby="solo-brief-heading">
          <h2 id="solo-brief-heading">Misi kamu</h2>
          <p>Klaim <strong>${targets.landmarks} landmark</strong> di setidaknya <strong>${targets.zones} zona</strong> dalam <strong>${Math.round(durationMs / 60_000)} menit</strong>.</p>
          <p>Check-in lalu jawab satu tantangan untuk mengklaim landmark. Sesi ini memakai titik dan tantangan uji untuk bermain dari mana saja.</p>
          <p class="solo-edition">Edisi ${escapeText(id)} · Berjalan kaki, MRT, KRL, dan Transjakarta adalah pilihan perjalanan dalam aturan permainan.</p>
        </section>
        <section class="solo-ticket" id="solo-action" aria-labelledby="solo-action-heading">
          <span class="solo-start-label">Titik awal</span>
          <h2 id="solo-action-heading" tabindex="-1">${escapeText(start.name)}</h2>
          <p>${ready ? "Titik awal terverifikasi. Waktu mulai saat kamu menekan Mulai." : "Verifikasi posisi di titik awal. Hitung mundur masih berhenti."}</p>
          ${feedbackMarkup()}
          <div class="solo-actions">
            ${ready ? action("Mulai", "start", "primary", busy || !!pending) : ""}
            ${selectedId === start.id ? locationActions(ready) : action("Check-in di titik awal", "open-start", ready ? "secondary" : "primary", busy || !!pending)}
          </div>
        </section>
      </div>
      ${board(state)}
    </div>`;
  }

  function feedbackMarkup() {
    return `<p class="solo-feedback ${feedbackType ? `solo-feedback-${feedbackType}` : ""}" ${feedback ? "" : "hidden"}>${escapeText(feedback)}</p>`;
  }

  function locationActions(verified = false) {
    return `${seekingLocation ? '<p role="status">Meminta lokasi perangkat…</p>' : ""}
      ${action("Check-in", "gps", verified ? "secondary" : "primary", busy || !!pending)}
      ${action("Simulasikan lokasi di sini", "simulate", "secondary", busy || !!pending)}`;
  }

  function checkpointAction(state: SoloSession) {
    const point = selectedPoint();
    if (!point) return `<section class="solo-ticket solo-instructions" id="solo-action" aria-labelledby="solo-action-heading">
      <h2 id="solo-action-heading" tabindex="-1">Check-in dan klaim</h2>
      <p>Pilih landmark untuk verifikasi lokasi dan membuka tantangan. Klaim dihitung setelah jawaban benar.</p>
      ${feedbackMarkup()}
    </section>`;
    const freshVisit = state.visits[point.id] > estimatedNow();
    const cooldown = Math.max(0, (state.cooldowns[point.id] ?? 0) - estimatedNow());
    const available = challenge?.checkpointId === point.id ? challenge : undefined;
    return `<section class="solo-ticket" id="solo-action" aria-labelledby="solo-action-heading">
      <div class="solo-section-heading">
        <h2 id="solo-action-heading" tabindex="-1">${escapeText(point.name)}</h2>
        ${action("Tutup", "close-point", "solo-back")}
      </div>
      ${feedbackMarkup()}
      ${available ? `<form id="solo-challenge">
        <fieldset>
          <legend>${escapeText(available.prompt)}</legend>
          ${available.choices.map(choice => `<label class="solo-choice">
            <input type="radio" name="choice" value="${escapeText(choice.id)}" data-focus="choice-${escapeText(choice.id)}" ${choice.id === choiceId ? "checked" : ""} required>
            <span>${escapeText(choice.label)}</span>
          </label>`).join("")}
        </fieldset>
        ${cooldown > 0 ? '<p class="solo-cooldown" data-cooldown></p>' : ""}
        ${!freshVisit ? "<p>Posisi perlu diverifikasi lagi. Kirim jawaban untuk meminta lokasi perangkat, atau perbarui lokasi dengan simulasi.</p>" : ""}
        <button class="primary" type="submit" data-focus="answer" ${busy || cooldown > 0 || pending ? "disabled" : ""}>Kirim jawaban</button>
      </form>` : `<p>Lakukan check-in di ${escapeText(point.name)} untuk membuka tantangan.</p>`}
      ${!available || !freshVisit ? `<div class="solo-actions">${locationActions(!!available)}</div>` : ""}
    </section>`;
  }

  function active(state: SoloSession) {
    return `<section class="solo-progress" aria-label="Waktu dan skor">
      <div class="solo-clock">
        <p>Sisa waktu</p>
        <span role="timer" aria-label="Sisa waktu" data-timer></span>
        <small data-wib></small>
        <small>Berakhir ${wib(state.deadline!)}</small>
      </div>
      ${score(state)}
    </section>
    <div class="solo-layout solo-live">
      <div class="solo-main-column">${checkpointAction(state)}</div>
      ${board(state)}
    </div>
    <footer class="solo-footer">
      ${confirmingAbandon ? `<p>Hentikan sesi sekarang?</p>${action("Ya, hentikan sesi", "abandon", "secondary", busy || !!pending)} ${action("Lanjut bermain", "cancel-exit")}`
        : action("Hentikan sesi", "confirm-exit", "solo-back")}
    </footer>`;
  }

  function paint(focus?: string) {
    if (signal.aborted) return;
    const focused = (document.activeElement as HTMLElement | null)?.dataset.focus;
    connection.hidden = !disconnected && !pending;
    if (!connection.hidden) {
      connection.innerHTML = pending
        ? `<p role="status">${busy ? "Menunggu konfirmasi dari server…" : "Belum ada konfirmasi dari server. Sambungkan kembali untuk memeriksa dan mencoba ulang."}</p>`
        : '<p role="status">Koneksi terputus. Sambungkan kembali untuk memuat status sesi terbaru.</p>';
      if (!busy) connection.insertAdjacentHTML("beforeend", action("Coba lagi", "retry"));
    }
    if (!session) {
      view.innerHTML = disconnected ? "" : '<p role="status">Memuat sesi…</p>';
    } else {
      const phaseChanged = previousPhase !== session.phase;
      view.innerHTML = session.phase === "briefing" ? briefing(session) : session.phase === "active" ? active(session) : result(session);
      if (phaseChanged && previousPhase) focus = session.phase === "won" || session.phase === "lost" || session.phase === "abandoned"
        ? "#solo-result-heading" : "#solo-title";
      previousPhase = session.phase;
      eligibility = eligibilityState();
      updateClock();
    }
    if (focus) root.querySelector<HTMLElement>(focus)?.focus();
    else if (focused) root.querySelector<HTMLElement>(`[data-focus="${CSS.escape(focused)}"]:not(:disabled)`)?.focus({ preventScroll: true });
  }

  function updateClock() {
    if (!session) return;
    const now = estimatedNow();
    const countdown = root.querySelector("[data-timer]");
    if (countdown && session.deadline !== null) updateText(countdown, remaining(session.deadline - now));
    const localTime = root.querySelector("[data-wib]");
    if (localTime) updateText(localTime, `Sekarang ${wib(now)}`);
    const cooldown = root.querySelector("[data-cooldown]");
    if (cooldown && selectedId) updateText(cooldown, `Coba lagi dalam ${Math.max(0, Math.ceil((session.cooldowns[selectedId] - now) / 1000))} detik.`);
  }

  function updateText(element: Element, text: string) {
    if (element.textContent !== text) element.textContent = text;
  }

  function receive(reply: SoloReply) {
    const before = session;
    session = reply.session;
    serverSampleAt = performance.now();
    if (!before) {
      const saved = history.state?.soloSelection;
      if (saved?.sessionId === session.id && session.phase === "active" && session.edition.checkpoints.some(point => point.id === saved.id)) {
        selectedId = saved.id;
      }
    } else if (before.id !== session.id || before.phase !== session.phase) {
      setSelected();
      confirmingAbandon = false;
    }
    if (reply.challenge?.checkpointId === selectedId) challenge = reply.challenge;
    if (selectedId && session.claimed.includes(selectedId)) setSelected();
    if (before && (before.phase !== session.phase || before.claimed.length !== session.claimed.length || before.zones.length !== session.zones.length)) {
      announcement.textContent = session.phase === "active"
        ? `${session.claimed.length} landmark diklaim di ${session.zones.length} zona.`
        : "Status sesi diperbarui.";
    }
  }

  async function reloadChallenge() {
    if (!selectedId || session?.phase !== "active" || challenge || !Object.hasOwn(session.visits, selectedId)) return;
    const reply = await requestSession(signal, undefined, selectedId);
    if (!signal.aborted) receive(reply);
  }

  async function submitPending() {
    const request = pending;
    if (!request) return;
    const reply = await requestSession(signal, request);
    if (signal.aborted) return;
    pending = undefined;
    disconnected = false;
    receive(reply);
    const distance = reply.distanceMeters === undefined ? "" : `Jarak ${Math.round(reply.distanceMeters)} m. `;
    if (reply.error) {
      const message = errors[reply.error] ?? "Permintaan belum berhasil. Coba lagi.";
      showFeedback(distance + message, "error");
      announcement.textContent = distance + message;
      if (reply.error === "wrong-answer") choiceId = "";
      if (reply.error === "visit-required") challenge = undefined;
    } else if (request.type === "check-in") {
      const message = distance + (request.checkpointId === session?.edition.start.id ? "Check-in titik awal berhasil." : "Check-in berhasil. Tantangan terbuka.");
      showFeedback(message, "success");
      announcement.textContent = message;
    } else if (request.type === "answer" && session?.phase === "active") {
      const name = session.edition.checkpoints.find(point => point.id === request.checkpointId)?.name;
      showFeedback(name ? `${name} diklaim.` : "Landmark diklaim.", "success");
    }
  }

  async function sync(retry = false) {
    if (busy || signal.aborted) return;
    busy = true;
    paint();
    try {
      const read = () => requestSession(signal);
      const reply = !session && navigator.locks
        ? await navigator.locks.request("kelana-solo-bootstrap", { signal }, read)
        : await read();
      if (signal.aborted) return;
      receive(reply);
      disconnected = false;
      if (retry) await submitPending();
      await reloadChallenge();
    } catch {
      disconnected = true;
    } finally {
      busy = false;
      paint();
    }
  }

  type PlayerAction = SoloAction extends infer A ? A extends SoloAction ? Omit<A, "actionId" | "sessionId"> : never : never;

  async function send(request: PlayerAction) {
    if (!session || pending || busy || signal.aborted) return;
    pending = { ...request, actionId: crypto.randomUUID(), sessionId: session.id };
    busy = true;
    showFeedback("");
    paint();
    try {
      await submitPending();
    } catch {
      disconnected = true;
    } finally {
      busy = false;
      paint(request.type === "check-in" || request.type === "answer" ? "#solo-action-heading" : undefined);
    }
  }

  async function locatePoint(point: SoloPoint, simulated: boolean, answer?: string) {
    if (busy || pending) return;
    busy = true;
    seekingLocation = !simulated;
    showFeedback("");
    paint();
    let fix: LocationFix | undefined;
    try {
      let deviceFix: LocationFix | undefined;
      if (!simulated) {
        try {
          deviceFix = await getLocation();
        } catch (error) {
          reportError(error);
          if (!signal.aborted) announcement.textContent = feedback;
          return;
        }
      }
      if (signal.aborted || selectedId !== point.id) return;
      const reply = await requestSession(signal);
      if (signal.aborted) return;
      receive(reply);
      disconnected = false;
      if (selectedId !== point.id) return;

      if (deviceFix) {
        // Keep the sample's age while translating the device clock to the server epoch.
        const age = Date.now() - deviceFix.timestamp;
        if (!Number.isFinite(age) || age < 0) {
          showFeedback(errors["stale-fix"], "error");
          announcement.textContent = feedback;
          return;
        }
        fix = { ...deviceFix, timestamp: Math.floor(reply.session.now - age) };
      } else {
        fix = { latitude: point.latitude, longitude: point.longitude, accuracy: 0, timestamp: reply.session.now };
      }
    } catch {
      disconnected = true;
    } finally {
      busy = seekingLocation = false;
      if (!fix) paint("#solo-action-heading");
    }
    if (!fix || signal.aborted) return;
    if (answer) await send({ type: "answer", checkpointId: point.id, choiceId: answer, fix });
    else await send({ type: "check-in", checkpointId: point.id, fix });
  }

  async function loadMap() {
    if (mapImage || mapRequest) return;
    mapRequest = new AbortController();
    const request = mapRequest;
    mapFailed = false;
    paint();
    try {
      const response = await fetch(mapUrl, { signal: AbortSignal.any([signal, request.signal, AbortSignal.timeout(8_000)]) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const url = URL.createObjectURL(await response.blob());
      try {
        const image = new Image();
        image.src = url;
        await image.decode();
        if (signal.aborted || request.signal.aborted) return;
        mapImage = url;
      } finally {
        if (mapImage !== url) URL.revokeObjectURL(url);
      }
    } catch {
      if (!request.signal.aborted && !signal.aborted) mapFailed = true;
    } finally {
      if (mapRequest === request) {
        mapRequest = undefined;
        paint();
      }
    }
  }

  root.addEventListener("click", event => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>("button[data-action]");
    if (!button) return;
    const point = selectedPoint();
    switch (button.dataset.action) {
      case "back": returnToSetup(); break;
      case "retry": void sync(true); break;
      case "map":
        mapShown = !mapShown;
        if (!mapShown) {
          mapRequest?.abort();
          mapRequest = undefined;
        } else if (!mapImage) {
          void loadMap();
          return;
        }
        paint();
        break;
      case "retry-map": void loadMap(); break;
      case "open-start":
        setSelected(session?.edition.start.id);
        paint('#solo-action-heading');
        break;
      case "point":
        if (busy || pending) return;
        setSelected(button.dataset.point);
        paint("#solo-action-heading");
        if (selectedId && session && Object.hasOwn(session.visits, selectedId)) void sync();
        break;
      case "close-point": {
        setSelected();
        paint(point ? `[data-focus="list-${CSS.escape(point.id)}"]` : "#solo-board-heading");
        break;
      }
      case "gps": if (point) void locatePoint(point, false); break;
      case "simulate": if (point) void locatePoint(point, true); break;
      case "start": void send({ type: "start" }); break;
      case "replay": void send({ type: "replay" }); break;
      case "abandon": void send({ type: "abandon" }); break;
      case "confirm-exit":
      case "cancel-exit":
        confirmingAbandon = !confirmingAbandon;
        paint(`[data-focus="${confirmingAbandon ? "abandon" : "confirm-exit"}"]`);
        break;
    }
  }, { signal });

  root.addEventListener("change", event => {
    if (event.target instanceof HTMLInputElement && event.target.name === "choice") choiceId = event.target.value;
  }, { signal });

  root.addEventListener("submit", event => {
    if (!(event.target instanceof HTMLFormElement) || event.target.id !== "solo-challenge") return;
    event.preventDefault();
    if (!session || !choiceId) return;
    const point = selectedPoint();
    if (!point || session.cooldowns[point.id] > estimatedNow()) return;
    if (session.visits[point.id] > estimatedNow()) void send({ type: "answer", checkpointId: point.id, choiceId });
    else void locatePoint(point, false, choiceId);
  }, { signal });

  window.addEventListener("online", () => void sync(true), { signal });
  window.addEventListener("offline", () => {
    disconnected = true;
    paint();
  }, { signal });
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) void sync(true);
  }, { signal });
  const clock = window.setInterval(() => {
    if (!session) return;
    if (eligibility !== eligibilityState()) paint();
    else updateClock();
    const now = estimatedNow();
    if (session.phase === "active" && session.deadline !== null && now >= session.deadline && now >= nextDeadlineSync) {
      nextDeadlineSync = now + 2_000;
      if (!disconnected) void sync();
    }
  }, 250);
  void sync();

  return () => {
    mount.abort();
    window.clearInterval(clock);
    if (mapImage) URL.revokeObjectURL(mapImage);
  };
}
