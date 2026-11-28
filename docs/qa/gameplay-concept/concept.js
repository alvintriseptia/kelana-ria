// The fixture runs entirely in this page. It uses no API, location permission, or public tiles.
const byId = id => document.getElementById(id);
const game = document.querySelector(".game");
const more = document.querySelector(".more");
const sheet = byId("sheet");
const tabs = byId("tabs");
const reduce = matchMedia("(prefers-reduced-motion: reduce)");

const landmarks = [
  { id: "terrace", name: "Anjungan Sungai Sagara dan Jalur Pejalan Kaki", short: "Anjungan Sagara", zone: "Teras Pesisir", x: 29, y: 37, meters: 28 },
  { id: "archive", name: "Rumah Arsip Pesisir", short: "Rumah Arsip", zone: "Teras Pesisir", x: 40, y: 22, meters: 110 },
  { id: "garden", name: "Taman Baca Pasar Timur", short: "Taman Baca", zone: "Lorong Pasar", x: 81, y: 48, meters: 240 },
  { id: "market", name: "Balai Pasar Timur", short: "Balai Pasar", zone: "Lorong Pasar", x: 75, y: 70, meters: 340 },
];
const stations = [
  { id: "ferry", name: "Halte Penyeberangan Pesisir", short: "Halte Pesisir", x: 29, y: 39 },
  { id: "crossing", name: "Stasiun Jembatan Sagara", short: "Stasiun Sagara", x: 69, y: 25 },
  { id: "park", name: "Taman Baca Pasar Timur", short: "Taman Baca", x: 81, y: 58 },
];
const claimCards = [
  { id: "scout", name: "Intai Tantangan", text: "Lihat tantangan di landmark yang belum terkunci.", x: 0, y: 0 },
  { id: "weight", name: "Bobot Ganda", text: "Gandakan bobot landmark terkunci milik timmu.", x: 50, y: 100 },
  { id: "shield", name: "Perisai Klaim", text: "Lindungi landmark rentan milik timmu.", x: 50, y: 0 },
];
const seekCards = [
  { id: "bonus", name: "Tambah Waktu", text: "+1 menit pada skor waktu sembunyi.", x: 0, y: 0 },
  { id: "veto", name: "Veto", text: "Batalkan pertanyaan yang menunggu jawaban.", x: 50, y: 0 },
  { id: "random", name: "Acak Pertanyaan", text: "Ganti pertanyaan aktif dengan pertanyaan lain.", x: 100, y: 0 },
];
const claimTabs = [["landmark", "◆", "Tantangan"], ["cards", "▣", "Kartu"], ["score", "◈", "Skor"]];
const seekTabs = [["history", "◷", "Riwayat"], ["points", "◇", "Titik"]];
const descriptions = {
  neutral: ["●", "Belum diklaim"], locked: ["■", "Terkunci · Tim Anda"],
  vulnerable: ["◆", "Rentan · Tim Anda"], rival: ["▲", "Terkunci · Lawan"], station: ["◇", "Titik"],
};
const start = new URLSearchParams(location.search);
let state;
let lastPointSet = "";
let nextEvent = 0;
const seenEffects = new Set();

function reset(mode, role = "seeker") {
  const reduced = state?.reduced ?? false;
  state = {
    mode, role, reduced, panel: mode === "claim" ? "landmark" : role === "hider" ? "cards" : "ask",
    boardList: false, mapFailed: false, selected: mode === "claim" ? "terrace" : null,
    rejectNext: false, offline: false, busy: null, notice: "", tone: "", history: [],
    attempt: false, challengeChoice: null, locked: false, doubled: false, card: null,
    hand: [], offer: null, dealt: null, inspecting: false, expired: false, shielded: null, scouted: null,
    radius: 1000, question: role === "hider" ? "waiting" : "ready", answer: null, revealCode: false,
    deadline: Date.now() + (mode === "claim" ? 1470 : 1120) * 1000,
  };
  lastPointSet = "";
  byId("map-fx").replaceChildren();
  render();
}

const choice = (key, id, name, selected, disabled = false) =>
  `<button data-action="${key}" data-value="${id}" aria-pressed="${selected}" ${disabled ? "disabled" : ""}>${name}</button>`;
const mainAction = (action, label, disabled = false) =>
  `<button class="action" data-action="${action}" ${disabled || state.offline || state.busy ? "disabled" : ""}>${label}</button>`;
const tile = (label, title, icon, art = "") =>
  `<div class="sheet-head"><span class="tile ${art}" aria-hidden="true">${icon}</span><div><small>${label}</small><h2 id="sheet-title" tabindex="-1">${title}</h2></div><button data-action="fold" aria-label="Lipat panel permainan">⌄</button></div>`;

function pointKind(id) {
  if (state.mode === "seek") return "station";
  if (id === "archive" || (id === "terrace" && state.locked)) return "locked";
  if (id === "garden") return "vulnerable";
  if (id === "market") return "rival";
  return "neutral";
}

function renderBoard() {
  const claim = state.mode === "claim";
  const points = claim ? landmarks : stations;
  if (lastPointSet !== state.mode) {
    lastPointSet = state.mode;
    byId("map-points").innerHTML = points.map(point =>
      `<button class="pin" data-action="pick-point" data-value="${point.id}" style="--x:${point.x}%;--y:${point.y}%"><span aria-hidden="true"></span><span class="pin-label" aria-hidden="true">${point.short}</span></button>`,
    ).join("") + '<span class="you"><b aria-hidden="true">◇</b><span>Anda</span></span>';
  }
  const you = byId("map-points").querySelector(".you");
  if (you) you.hidden = !claim && state.role === "hider";
  for (const [index, pin] of [...byId("map-points").querySelectorAll(".pin")].entries()) {
    const point = points[index];
    const kind = pointKind(point.id);
    pin.dataset.kind = kind;
    pin.firstElementChild.textContent = descriptions[kind][0];
    pin.setAttribute("aria-label", `${point.name} · ${descriptions[kind][1]}`);
    pin.setAttribute("aria-pressed", String(point.id === state.selected));
    const ownCard = state.inspecting && state.hand.at(-1);
    pin.classList.toggle("legal-target", Boolean(ownCard && canTarget(ownCard, point.id)));
  }
  byId("zones").toggleAttribute("hidden", !claim);
  byId("west-label").hidden = !claim;
  byId("east-label").hidden = !claim;
  byId("zone-west").dataset.state = "owned";
  byId("zone-east").dataset.state = "contested";
  byId("map").hidden = state.boardList || state.mapFailed;
  byId("board-list").hidden = !byId("map").hidden;
  const boardList = byId("board-list");
  const scroll = boardList.scrollTop;
  if (!boardList.hidden) {
    boardList.innerHTML = points.map(point => {
      const kind = pointKind(point.id);
      return `<button data-action="pick-point" data-value="${point.id}" aria-pressed="${state.selected === point.id}"><span>${descriptions[kind][0]} ${point.name}</span><small>${claim ? descriptions[kind][1].split(" ·")[0] : "Titik"}</small></button>`;
    }).join("");
    boardList.scrollTop = scroll;
  }
  const view = byId("view-button");
  view.disabled = state.mapFailed;
  view.textContent = state.mapFailed ? "Daftar" : state.boardList ? "Peta" : "Daftar";
  const radar = byId("radar");
  const seeker = !claim && state.role === "seeker";
  radar.toggleAttribute("hidden", !seeker || (state.question === "ready" && state.panel !== "ask"));
  radar.dataset.state = state.question === "answered" ? "confirmed"
    : state.question === "waiting" || state.busy?.action === "ask" ? "pending" : "preview";
  const scale = state.radius / 1000;
  radar.firstElementChild.setAttribute("rx", String(Math.round(98 * scale)));
  radar.firstElementChild.setAttribute("ry", String(Math.round(103 * scale)));
  byId("map-status").textContent = state.mapFailed ? "Peta tidak tersedia · pilih dari daftar" : claim
    ? state.selected ? "Landmark dipilih" : "Pilih landmark"
    : seeker ? state.question === "answered" ? "Jawaban diterima · area tersingkir"
      : state.question === "waiting" ? "Menunggu jawaban" : state.panel === "ask" ? "Pratinjau · Radar" : "Pilih pertanyaan"
      : "Titik publik";
  byId("legend").textContent = claim ? "● Bebas · ◆ Rentan · ■ Terkunci · ▲ Lawan"
    : seeker ? state.question === "answered" ? "▨ Area tersingkir" : "◌ Pratinjau · ◇ Titik" : "◇ Titik publik";
}

function render() {
  const focus = document.activeElement;
  const focusGroup = [sheet, tabs, byId("board-list")].find(node => node.contains(focus));
  const focusAction = focusGroup && focus.dataset.action;
  const focusValue = focusGroup && focus.dataset.value;
  const scroll = sheet.scrollTop;
  const claim = state.mode === "claim";
  const hider = !claim && state.role === "hider";
  game.dataset.mode = state.mode;
  game.dataset.role = state.role;
  game.dataset.reduced = String(state.reduced);
  byId("reduced").checked = state.reduced;
  byId("role-mark").textContent = claim || hider ? "◆" : "◎";
  byId("role").textContent = claim ? "Claim the City" : hider ? "Penyembunyi" : "Pencari";
  byId("phase").textContent = claim ? "Grup · Permainan aktif" : "Pencarian · Giliran 1 dari 2";
  byId("clock-label").textContent = claim ? "Ronde" : "Waktu";
  byId("goal").textContent = claim ? "Kuasai zona terbanyak" : hider ? "Pertahankan lokasi sembunyi" : "Persempit area. Temukan lokasi sembunyi.";
  byId("progress").innerHTML = claim
    ? `<span><strong>${state.locked ? 2 : 1}</strong>Terkunci</span><span><strong>1</strong>Zona</span>` : "";
  byId("switch-role").hidden = claim;
  byId("switch-role").textContent = hider ? "Lihat sebagai Pencari" : "Lihat sebagai Penyembunyi";
  byId("connection-toggle").textContent = state.offline ? "Sambungkan ulang" : "Simulasi luring";
  byId("map-error").textContent = state.mapFailed ? "Pulihkan peta latihan" : "Simulasi peta gagal";
  byId("expire").hidden = !state.offer || (!claim && !hider);
  renderClock();
  renderBoard();

  const panels = claim ? claimTabs : [
    [hider ? "cards" : "ask", hider ? "▤" : "✦", hider ? `Kartu ${state.hand.length}` : "Tanya"],
    ...seekTabs,
    ...(hider && state.question !== "ready" ? [["code", "#", "Kode"]] : []),
  ];
  tabs.innerHTML = panels.map(([id, icon, label]) =>
    `<button data-action="tab" data-value="${id}" aria-pressed="${state.panel === id}"><span aria-hidden="true">${icon}</span>${label}${claim && id === "cards" && state.offer ? "<small>1</small>" : ""}</button>`,
  ).join("");

  sheet.hidden = !state.panel;
  sheet.setAttribute("aria-busy", String(Boolean(state.busy)));
  if (state.panel === "landmark") sheet.innerHTML = claimPoint();
  else if (state.panel === "cards") sheet.innerHTML = hand();
  else if (state.panel === "ask" && !hider) sheet.innerHTML = question();
  else if (state.panel === "score") sheet.innerHTML = scorePanel();
  else if (state.panel === "history") sheet.innerHTML = tile("Pencarian", "Riwayat", "◷") + (state.history.length
    ? `<ul class="history">${state.history.map(item => `<li>${item}</li>`).join("")}</ul>`
    : "<p>Belum ada pertanyaan yang dijawab.</p>");
  else if (state.panel === "points") sheet.innerHTML = tile("Papan", "Titik publik", "◇")
    + `<div class="point-menu">${stations.map(item => choice("pick-point", item.id, item.name, state.selected === item.id)).join("")}</div>`;
  else if (state.panel === "code" && hider) sheet.innerHTML = tile("Khusus Penyembunyi", "Kode temuan", "#")
    + (state.revealCode ? '<p class="secret" aria-label="Kode latihan 2641">2641</p>' : mainAction("show-code", "Tampilkan kode latihan"));
  else sheet.replaceChildren();

  sheet.scrollTop = scroll;
  if (focusGroup && focusAction) {
    const next = [...focusGroup.querySelectorAll("[data-action]")].find(node =>
      node.dataset.action === focusAction && node.dataset.value === focusValue);
    if (next && !next.disabled) next.focus({ preventScroll: true });
  }
  const message = byId("announcement");
  message.hidden = !state.notice;
  message.dataset.tone = state.tone;
  if (message.textContent !== state.notice) message.textContent = state.notice;
}

function claimPoint() {
  const point = landmarks.find(item => item.id === state.selected);
  if (!point) return tile("Papan", "Pilih landmark", "◆") + "<p>Buka pin di peta atau pilih lewat daftar.</p>";
  const kind = pointKind(point.id);
  if (state.attempt) return tile("Check-in diterima · Pilihan Ganda", "Amati anjungan", "◆")
    + "<p>Bagian mana yang memberi naungan di atas jalur umum?</p>"
    + `<div class="control-row">${choice("challenge-choice", "roof", "Atap lengkung", state.challengeChoice === "roof", Boolean(state.busy))}${choice("challenge-choice", "rail", "Pagar besi", state.challengeChoice === "rail", Boolean(state.busy))}</div>`
    + mainAction("challenge", state.busy?.action === "challenge" ? "Memeriksa jawaban…" : "Kirim jawaban", !state.challengeChoice);
  const locked = kind === "locked";
  return tile(point.zone, point.name, descriptions[kind][0])
    + `<div class="chip-list"><span class="chip">${descriptions[kind][1]}</span><span class="chip ${point.meters > 50 ? "caution" : ""}">${point.meters} m · jangkauan 50 m</span></div>`
    + (state.shielded === point.id ? '<span class="chip">◇ Perlindungan aktif</span>' : "")
    + (state.scouted === point.id ? '<p>Pratinjau: amati bentuk naungan di atas pintu umum.</p>' : "")
    + (locked ? mainAction("tab-cards", state.offer ? "Buka kartu hadiah" : "Lihat Kartu") : mainAction("check",
      state.busy?.action === "check" ? "Memeriksa check-in…" : point.meters > 50 ? "Di luar jangkauan" : "Check-in di Anjungan Sagara",
      point.meters > 50));
}

function question() {
  const head = tile("Tanya", "Radar", "", "art-radar");
  if (state.question === "answered") {
    return head + '<div class="chip-list"><span class="chip">✓ Jawaban diterima · Di luar</span></div><p>Coretan menandai area yang bisa disisihkan. Lanjutkan pencarian di luar area itu.</p>'
      + mainAction("tab-history", "Lihat riwayat");
  }
  const waiting = state.question === "waiting";
  return head + (waiting ? "<p>Radar sudah dikirim. Tunggu jawaban Penyembunyi.</p>"
    : '<p>Apakah Penyembunyi berada di dalam radius ini?</p>')
    + (waiting ? "" : `<div class="control-row" role="group" aria-label="Radius Radar">${[500, 1000, 1500].map(radius =>
      choice("radius", radius, `${radius.toLocaleString("id-ID")} m`, state.radius === radius, Boolean(state.busy))).join("")}</div>`)
    + `<div class="chip-list"><span class="chip">${waiting ? "Menunggu jawaban" : "◌ Pratinjau wilayah"}</span><span class="chip">Hadiah · Ambil 3, simpan 1</span></div>`
    + mainAction("ask", state.busy?.action === "ask" ? "Mengirim pertanyaan…" : waiting ? "Sudah dikirim" : "Kirim pertanyaan", waiting);
}

function hand() {
  const claim = state.mode === "claim";
  const cards = claim ? claimCards : seekCards;
  if (!claim && state.question === "waiting") {
    return tile("Kartu · Pertanyaan masuk", "Jawab Radar", "", "art-radar")
      + `<p>Apakah kamu berada dalam radius ${state.radius.toLocaleString("id-ID")} m dari titik Pencari?</p>`
      + `<div class="control-row" role="group" aria-label="Jawaban Radar">${choice("answer-choice", "inside", "Di dalam", state.answer === "inside", Boolean(state.busy))}${choice("answer-choice", "outside", "Di luar", state.answer === "outside", Boolean(state.busy))}</div>`
      + (state.answer === "inside" ? '<p class="chip caution">Jawaban ini tidak cocok. Periksa lagi sebelum mengirim.</p>' : "")
      + mainAction("answer", state.busy?.action === "answer" ? "Mengirim jawaban…" : "Kirim jawaban", state.answer !== "outside");
  }
  if (state.offer) {
    const deal = state.dealt !== state.offer.id && motionOn();
    state.dealt = state.offer.id;
    return tile(claim ? "Kartu · Hadiah landmark" : "Kartu · Hadiah jawaban", "Pilih satu kartu hadiah", "▣")
      + `<div class="chip-list"><span class="chip">Simpan ${state.card ? 1 : 0}/1</span>${state.offer.deadline ? '<span class="chip" id="offer-time"></span>' : ""}</div>`
      + `<div class="option-list">${cards.map((card, index) =>
        `<button class="offer-card ${deal ? "deal" : ""}" data-action="choose-card" data-value="${card.id}" aria-pressed="${state.card === card.id}" style="--index:${index};--art-x:${card.x}%;--art-y:${card.y}%" ${state.busy ? "disabled" : ""}><span class="art" aria-hidden="true"></span><span><strong>${card.name}</strong><span>${card.text}</span></span></button>`
      ).join("")}</div>`
      + mainAction("keep", state.busy?.action === "keep" ? "Menyimpan kartu…" : "Simpan 1 kartu", !state.card);
  }
  const item = cards.find(card => card.id === state.hand.at(-1));
  const head = tile("Tangan Anda", "Kartu", "▣");
  if (!item) return head + `<p>${state.expired ? "Pilihan kartu telah kedaluwarsa. Ikuti hasil ronde." : claim ? "Kunci landmark untuk mendapat tawaran kartu." : "Jawab pertanyaan untuk mendapat kartu."}</p>`;
  const card = `<div class="kept-card"><span class="art" aria-hidden="true" style="--art-x:${item.x}%;--art-y:${item.y}%"></span><div><strong>${item.name}</strong><p>${item.text}</p></div></div>`;
  if (!claim) return head + card + "<p>Simpan di tangan. Gunakan kartu dari panel ini saat syaratnya terpenuhi.</p>";
  if (!state.inspecting) return head + card + mainAction("inspect-card", "Pilih target");
  const point = landmarks.find(point => point.id === state.selected);
  const allowed = canTarget(item.id, point?.id);
  return tile("Kartu · Pilih target", item.name, "▣") + card
    + `<div class="chip-list"><span class="chip ${allowed ? "" : "caution"}">${allowed ? "✓ " + point.short : "Pilih landmark yang memenuhi syarat di peta"}</span></div>`
    + mainAction("cast", state.busy?.action === "cast" ? "Memainkan kartu…" : "Mainkan kartu", !allowed);
}

function canTarget(card, point) {
  if (!point) return false;
  const kind = pointKind(point);
  return card === "weight" ? kind === "locked" && !state.doubled
    : card === "shield" ? kind === "vulnerable" : kind === "neutral" || kind === "vulnerable";
}

function scorePanel() {
  return tile("Grup", "Skor dan zona", "◈") +
    `<div class="score-row"><span>■ Teras Pesisir · Tim Anda</span><strong>${state.doubled ? 3 : state.locked ? 2 : 1}</strong></div>
    <div class="score-row"><span>◆ Lorong Pasar · Sengketa</span><strong>1–1</strong></div>`;
}

function renderClock() {
  const format = remaining => {
    const seconds = Math.max(0, Math.ceil(remaining / 1000));
    return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
  };
  byId("clock").textContent = format(state.deadline - Date.now());
  const offer = byId("offer-time");
  if (offer && state.offer?.deadline) offer.textContent = "Sisa " + format(state.offer.deadline - Date.now());
}

function motionOn() {
  return !state.reduced && !reduce.matches;
}

function confirmedEffect(event, text) {
  const key = `${event}:${nextEvent}`;
  if (seenEffects.has(key)) return;
  seenEffects.add(key);
  if (!motionOn()) return;
  const effect = document.createElement("span");
  effect.className = "board-delta";
  effect.dataset.effect = key;
  effect.textContent = text;
  byId("map-fx").replaceChildren(effect);
  effect.addEventListener("animationend", () => effect.remove(), { once: true });
}

function notify(text, tone = "") {
  state.notice = text;
  state.tone = tone;
}

function openPanel(panel) {
  state.panel = panel;
  sheet.scrollTop = 0;
  render();
  renderClock();
  byId("sheet-title")?.focus({ preventScroll: true });
}

function fold() {
  const old = state.panel;
  state.panel = null;
  render();
  tabs.querySelector(`[data-value="${old}"]`)?.focus();
}

function commit(action, waiting, result) {
  if (state.busy || state.offline) return;
  const session = state;
  const pending = { action, sequence: ++nextEvent, reject: state.rejectNext };
  state.rejectNext = false;
  state.busy = pending;
  notify(waiting, "pending");
  render();
  setTimeout(() => {
    if (session !== state || state.busy !== pending || state.offline) return;
    state.busy = null;
    if (pending.reject) {
      notify("Aksi ditolak dalam simulasi. Periksa pilihanmu lalu coba lagi.", "error");
      render();
      sheet.querySelector(`[data-action="${action}"]:enabled`)?.focus({ preventScroll: true });
      return;
    }
    result();
    render();
    renderClock();
    if (document.activeElement === document.body) byId("sheet-title")?.focus({ preventScroll: true });
  }, 750);
}

function expireOffer() {
  if (!state.offer) return;
  state.offer = null;
  state.card = null;
  state.expired = true;
  if (state.busy?.action === "keep") state.busy = null;
  notify("Tawaran kartu sudah kedaluwarsa.", "error");
  render();
}

game.addEventListener("click", event => {
  const button = event.target.closest("button[data-action]");
  if (!button || button.disabled) return;
  const { action, value } = button.dataset;
  if (button.closest(".menu")) {
    more.open = false;
    more.querySelector("summary").focus();
  }
  switch (action) {
    case "start-claim": reset("claim"); break;
    case "start-seek": reset("seek"); break;
    case "reset": reset(state.mode, state.role); break;
    case "switch-role":
      state.role = state.role === "seeker" ? "hider" : "seeker";
      state.revealCode = false;
      notify("");
      openPanel(state.role === "hider" ? "cards" : "ask");
      break;
    case "reject":
      state.rejectNext = true;
      notify("Simulasi · Aksi berikutnya akan ditolak.", "error");
      render();
      break;
    case "connection":
      if (state.offline) {
        state.offline = false;
        notify("Tersambung kembali. Status ronde dipulihkan.");
      } else {
        state.offline = true;
        state.busy = null;
        notify("Luring · pilihan tersimpan. Sambungkan ulang dari menu.", "error");
      }
      render();
      break;
    case "map-error":
      state.mapFailed = !state.mapFailed;
      state.boardList = state.mapFailed;
      render();
      break;
    case "map-view":
      state.boardList = !state.boardList;
      render();
      break;
    case "expire": expireOffer(); break;
    case "tab":
      if (state.panel === value) fold();
      else openPanel(value);
      break;
    case "tab-cards": openPanel("cards"); break;
    case "tab-history": openPanel("history"); break;
    case "fold": fold(); break;
    case "pick-point": {
      if (state.mode === "claim" && (state.attempt || state.busy)) return;
      state.selected = value;
      const panel = state.mode === "seek" ? "points" : state.inspecting ? "cards" : "landmark";
      openPanel(panel);
      break;
    }
    case "check":
      commit(action, "Menunggu konfirmasi check-in…", () => {
        state.attempt = true;
        notify("Check-in diterima. Tantangan terbuka.");
      });
      break;
    case "challenge-choice":
      state.challengeChoice = value;
      render();
      break;
    case "challenge":
      if (state.challengeChoice !== "roof") {
        notify("Jawaban belum tepat. Amati bagian yang menaungi jalur.", "error");
        render();
        return;
      }
      commit(action, "Menunggu hasil tantangan…", () => {
        state.locked = true;
        state.attempt = false;
        state.offer = { id: nextEvent };
        notify("■ Anjungan Sagara terkunci · Kartu hadiah tersedia.");
        confirmedEffect("lock", "+1 landmark");
      });
      break;
    case "radius":
      state.radius = Number(value);
      render();
      break;
    case "ask":
      commit(action, "Memeriksa pengiriman Radar…", () => {
        state.question = "waiting";
        notify("Pertanyaan dikirim. Menunggu jawaban Penyembunyi.");
      });
      break;
    case "answer-choice":
      state.answer = value;
      render();
      break;
    case "answer":
      commit(action, "Menunggu konfirmasi jawaban…", () => {
        state.question = "answered";
        state.history.push(`Radar · ${state.radius.toLocaleString("id-ID")} m · Di luar`);
        state.offer = { id: nextEvent, deadline: Date.now() + 45_000 };
        notify("Jawaban dikirim · Kartu hadiah tersedia.");
      });
      break;
    case "choose-card":
      state.card = state.card === value ? null : value;
      render();
      renderClock();
      break;
    case "keep":
      commit(action, "Menunggu konfirmasi kartu…", () => {
        state.hand.push(state.card);
        state.offer = null;
        state.card = null;
        notify("✓ Kartu disimpan di tangan Anda.");
        confirmedEffect("keep", "Kartu disimpan");
      });
      break;
    case "show-code":
      state.revealCode = true;
      render();
      break;
    case "inspect-card":
      state.inspecting = true;
      state.selected = null;
      render();
      byId("sheet-title").focus();
      break;
    case "cast":
      commit(action, "Memeriksa target kartu…", () => {
        const card = state.hand.pop();
        state.inspecting = false;
        if (card === "weight") state.doubled = true;
        if (card === "shield") state.shielded = state.selected;
        if (card === "scout") state.scouted = state.selected;
        notify(card === "weight" ? "Bobot landmark dikonfirmasi · Skor zona diperbarui."
          : card === "shield" ? "Perlindungan landmark dikonfirmasi." : "Pratinjau tantangan tersedia di landmark.");
        confirmedEffect("cast", "Kartu dimainkan");
      });
      break;
  }
});

game.addEventListener("keydown", event => {
  if (event.key !== "Escape") return;
  if (more.open) {
    more.open = false;
    more.querySelector("summary").focus();
  } else if (state.panel) fold();
});

byId("reduced").addEventListener("change", event => {
  state.reduced = event.currentTarget.checked;
  byId("map-fx").replaceChildren();
  render();
  renderClock();
});
reduce.addEventListener("change", () => byId("map-fx").replaceChildren());
setInterval(() => {
  if (state.offer?.deadline && state.offer.deadline <= Date.now()) expireOffer();
  renderClock();
}, 200);

reset(start.get("mode") === "seek" ? "seek" : "claim", start.get("role") === "hider" ? "hider" : "seeker");
