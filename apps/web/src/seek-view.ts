import type { DuoSeat, SeekRoom, SeekTurnResult, SoloPoint } from "@kelana-ria/contracts";
import { feedbackMarkup, inviteMarkup, player, roomEntry, seats, type Feedback } from "./multiplayer-room";
import { clueHistory, cluePanels, type ClueDraft } from "./seek-clues";
import { action, escapeText, schematicBoard, wib } from "./solo-view";

export const seekMode = "hide-and-seek";
export const seekPhase = {
  lobby: "Ruang tunggu", "head-start": "Waktu sembunyi", seeking: "Pencarian", regroup: "Berkumpul kembali",
} as const;
const minuteFormat = new Intl.NumberFormat("id-ID", { maximumFractionDigits: 2 });
const minutes = (milliseconds: number) => minuteFormat.format(milliseconds / 60_000);
const otherSeat = (seat: DuoSeat) => seat === "host" ? "guest" : "host";

export function active(room: SeekRoom | undefined) {
  return room?.phase === "head-start" || room?.phase === "seeking" || room?.phase === "regroup";
}

export function pointAction(room: SeekRoom) {
  if (room.phase === "head-start" && room.hider === room.seat && !room.ownLock) return "lock";
  if (room.phase === "seeking" && room.hider !== room.seat && room.canInvestigate) return "investigate";
}

export function needsStart(room: SeekRoom, now: number) {
  return (room.phase === "lobby" && (room.startVerifiedUntil ?? 0) <= now)
    || (room.phase === "seeking" && room.hider !== room.seat && !room.canInvestigate)
    || (room.phase === "regroup" && !room.seats[room.seat].regrouped);
}

function objective(room?: SeekRoom) {
  const edition = room?.edition;
  return `<section class="solo-objective" aria-labelledby="seek-objective-heading">
    <h2 id="seek-objective-heading">Bergantian sembunyi dan mencari</h2>
    <p>Setiap pemain bersembunyi sekali. Skor tertinggi menang. Skor menggabungkan waktu sembunyi sejak pencari dilepas dan bonus kartu. Skor yang sama berakhir seri.</p>
    <p>Mulai di <strong>${escapeText(edition?.start.name ?? "CSW–ASEAN")}</strong>. Edisi simulasi siap pakai bisa dimainkan dari mana saja.</p>
    ${edition ? `<p><strong>${minutes(edition.headStartMs)} menit</strong> untuk sembunyi, <strong>${minutes(edition.searchMs)} menit</strong> untuk mencari setiap giliran, dan <strong>${minutes(edition.regroupMs)} menit</strong> untuk berkumpul kembali.</p>` : ""}
    <p class="solo-edition">${edition ? `Edisi ${escapeText(edition.id)} · ` : ""}Berjalan kaki, MRT, KRL, dan Transjakarta. Perjalanan sungguhan memakai data seluler dan ongkos biasa.</p>
  </section>`;
}

export function entry(code: string, busy: boolean, feedback: Feedback | undefined) {
  return roomEntry("seek", code, busy, feedback, objective());
}

type Controls = {
  now: number;
  busy: boolean;
  locating: boolean;
  startOpen: boolean;
  point?: SoloPoint;
  feedback?: Feedback;
  map: { shown: boolean; failed: boolean; url: string };
  clueDraft: ClueDraft;
};

function seatList(room: SeekRoom, regroup: boolean) {
  return `<ul class="duo-seats" aria-label="Kursi pemain">${seats.map(seat => {
    const member = room.seats[seat];
    const ready = regroup ? member.regrouped : member.ready;
    const status = !member.joined ? "Menunggu teman" : regroup
      ? (ready ? "Sudah kembali" : "Belum kembali") : (ready ? "Siap" : "Belum siap");
    return `<li>
      <div><strong>${player[seat]}</strong><small>${seat === "host" ? "Tuan rumah" : "Tamu"}${seat === room.seat ? " · Kamu" : ""}</small></div>
      <span class="duo-seat-status" data-ready="${ready}">${status}</span>
    </li>`;
  }).join("")}</ul>`;
}

function roleAssignment(room: SeekRoom, busy: boolean) {
  if (room.seat !== "host") return room.firstHider
    ? `<p>${player[room.firstHider]} bersembunyi dulu. ${player[otherSeat(room.firstHider)]} mencari.</p>`
    : "<p>Menunggu tuan rumah memilih siapa yang bersembunyi dulu.</p>";
  return `<fieldset class="seek-role-options" ${busy ? "disabled" : ""}>
    <legend>Siapa yang bersembunyi dulu?</legend>
    ${seats.map(seat => `<label class="solo-choice"><input type="radio" name="first-hider" value="${seat}" data-focus="role-${seat}" ${room.firstHider === seat ? "checked" : ""}>
      <span>${player[seat]}</span></label>`).join("")}
  </fieldset>`;
}

const locationLabels = {
  "check-in": ["Check-in dengan lokasi perangkat", "Simulasikan lokasi di sini"],
  lock: ["Kunci dengan lokasi perangkat", "Simulasikan penguncian di sini"],
  investigate: ["Selidiki dengan lokasi perangkat", "Simulasikan penyelidikan di sini"],
  reference: ["Check-in untuk petunjuk", "Simulasikan check-in untuk petunjuk"],
};

function locationActions({ busy }: Controls, type: keyof typeof locationLabels) {
  const [device, simulated] = locationLabels[type];
  const reference = type === "reference";
  return `${action(device, reference ? "gps-reference" : "gps", reference ? "secondary" : "primary", busy)}
    ${action(simulated, reference ? "simulate-reference" : "simulate", "secondary", busy)}`;
}

const locatingNotice = (controls: Controls) => controls.locating ? '<p role="status">Meminta lokasi perangkat…</p>' : "";

function startActions(room: SeekRoom, controls: Controls) {
  if (!needsStart(room, controls.now)) return "";
  return controls.startOpen ? locatingNotice(controls) + locationActions(controls, "check-in") : action("Check-in di titik awal", "open-start", "primary", controls.busy);
}

function lobby(room: SeekRoom, controls: Controls) {
  const { busy, now, feedback } = controls;
  const verified = !needsStart(room, now);
  const ready = room.seats[room.seat].ready;
  const allReady = seats.every(seat => room.seats[seat].ready);
  return `<div class="solo-main-column">
    ${objective(room)}
    <section class="solo-ticket" aria-labelledby="seek-room-heading">
      <h2 id="seek-room-heading" tabindex="-1">Ruang tunggu</h2>
      ${inviteMarkup(room.code, room.seat === "host", seekMode)}
      ${seatList(room, false)}
      ${roleAssignment(room, busy)}
    </section>
    <section class="solo-ticket" id="seek-action" aria-labelledby="seek-action-heading">
      <span class="solo-start-label">Titik awal</span>
      <h2 id="seek-action-heading" tabindex="-1">${escapeText(room.edition.start.name)}</h2>
      <p>${verified ? "Check-in titik awal terverifikasi." : "Check-in di titik awal sebelum menyatakan siap."}
        ${room.firstHider ? "Tuan rumah memulai setelah kedua pemain siap." : "Peran dipilih sebelum kedua pemain menyatakan siap."}</p>
      ${feedbackMarkup(feedback)}
      <div class="solo-actions">
        ${allReady && room.seat === "host" ? action("Mulai", "start", "primary", busy || !verified) : ""}
        ${verified && room.firstHider && !ready ? action("Saya siap", "ready", "primary", busy) : ""}
        ${ready && verified ? action("Batalkan siap", "unready", "secondary", busy) : ""}
        ${startActions(room, controls)}
      </div>
    </section>
  </div>`;
}

function pointName(room: SeekRoom, id: string) {
  return escapeText(room.edition.checkpoints.find(point => point.id === id)?.name ?? "Titik sembunyi");
}

function pointPanel(room: SeekRoom, controls: Controls) {
  const { point, feedback } = controls;
  const type = pointAction(room);
  if (!point || !type) return "";
  const missed = type === "investigate" && room.ruledOut.includes(point.id);
  const start = point.id === room.edition.start.id;
  const canReference = type === "investigate" && Boolean(room.clues);
  return `<section class="solo-ticket" aria-labelledby="seek-point-heading">
    <div class="solo-section-heading">
      <h2 id="seek-point-heading" tabindex="-1">${escapeText(point.name)}</h2>
      ${action("Tutup", "close-point", "solo-back")}
    </div>
    <p>${start ? "Verifikasi lokasi di titik awal untuk menjadikannya titik acuan lagi."
      : missed ? "Titik ini sudah diselidiki. Kamu bisa check-in lagi untuk mengganti titik acuan petunjuk."
      : type === "lock" ? "Verifikasi lokasi di titik ini untuk menguncinya. Titik yang sudah terkunci tidak bisa diubah."
        : "Verifikasi lokasi untuk menyelidiki titik ini atau menjadikannya titik acuan petunjuk."}</p>
    ${feedbackMarkup(feedback)}
    <div class="solo-actions">${locatingNotice(controls)}
      ${!missed && !start ? locationActions(controls, type) : ""}
      ${canReference ? locationActions(controls, "reference") : ""}
    </div>
  </section>`;
}

function turnHistory(room: SeekRoom) {
  if (!room.turns.length) return "";
  return `<section class="solo-recap" aria-labelledby="seek-recap-heading">
    <h2 id="seek-recap-heading">Riwayat giliran</h2>
    <ol>${room.turns.map(turn => `<li>
      <time datetime="${new Date(turn.at).toISOString()}">${wib(turn.at)}</time>
      <div><strong>Giliran ${turn.turn} · ${player[turn.hider]}</strong><br>
        ${pointName(room, turn.checkpointId)} · ${turn.reason === "found" ? "Ditemukan" : "Waktu habis"}<br>
        Waktu sembunyi <strong>${scoreTime(turn.hidingMs)}</strong><br>
        Bonus kartu <strong>+${scoreTime(turn.bonusMs ?? 0)}</strong><br>
        Skor disesuaikan <strong>${scoreTime(adjustedTime(turn))}</strong></div>
    </li>`).join("")}</ol>
  </section>`;
}

function instructions(room: SeekRoom, controls: Controls) {
  const hiding = room.hider === room.seat;
  const start = escapeText(room.edition.start.name);
  const regroup = room.phase === "regroup";
  const needsCheckIn = needsStart(room, controls.now);
  const point = pointPanel(room, controls);
  let guide: string;
  if (regroup) {
    guide = `Kembali ke ${start} melalui rute pejalan kaki atau transportasi umum. Peran ditukar dan waktu sembunyi berikutnya dimulai setelah kedua pemain check-in.`;
  } else if (room.phase === "head-start") {
    guide = hiding ? "Pilih titik di papan lalu verifikasi lokasi sebelum waktu sembunyi habis."
      : `Tunggu di ${start}. Pelajari papan sambil menunggu waktu pencarian.`;
  } else {
    guide = hiding ? "Tetap di titik sembunyimu sampai ditemukan atau waktu pencarian habis."
      : needsCheckIn ? `Check-in di ${start} untuk membuka penyelidikan dan pertanyaan.` : "Pilih titik di papan untuk check-in atau menyelidiki.";
  }
  return `<div class="solo-main-column" id="seek-action">
    <section class="solo-ticket" aria-labelledby="seek-action-heading">
      <h2 id="seek-action-heading" tabindex="-1">${regroup ? start : hiding ? "Kamu bersembunyi" : "Kamu mencari"}</h2>
      ${hiding && room.ownLock ? `<p class="seek-locked"><strong>Titik sembunyi terkunci</strong><span>${pointName(room, room.ownLock)}</span></p>` : ""}
      ${hiding && room.ownLock && room.phase === "head-start" ? "<p>Tetap di titik ini saat pencarian dimulai.</p>" : `<p>${guide}</p>`}
      ${regroup ? seatList(room, true) : ""}
      ${!point ? feedbackMarkup(controls.feedback) : ""}
      ${needsCheckIn ? `<div class="solo-actions">${startActions(room, controls)}</div>` : ""}
      ${!hiding && room.phase === "seeking" && !needsCheckIn ? `<div class="solo-actions">${action("Lihat daftar titik", "open-board")}</div>` : ""}
    </section>
    ${point}
    ${regroup ? turnHistory(room) : ""}
    ${cluePanels(room, controls.clueDraft, controls.busy)}
  </div>`;
}

function scoreTime(duration: number) {
  const seconds = Math.floor(duration / 1000);
  const milliseconds = duration % 1000;
  return `${Math.floor(seconds / 60)} mnt ${seconds % 60}${milliseconds ? `,${String(milliseconds).padStart(3, "0").replace(/0+$/, "")}` : ""} dtk`;
}

const adjustedTime = (turn: SeekTurnResult) => turn.adjustedMs ?? turn.hidingMs + (turn.bonusMs ?? 0);

function score(room: SeekRoom) {
  return `<dl class="solo-score seek-score" aria-label="Skor waktu sembunyi disesuaikan">${seats.map(seat => {
    const turn = room.turns.find(result => result.hider === seat);
    return `<div><dt>${player[seat]}${seat === room.seat ? ' <span class="duo-you">· Kamu</span>' : ""}</dt>
      <dd>${turn ? scoreTime(adjustedTime(turn)) : "—"}</dd></div>`;
  }).join("")}</dl>`;
}

function progress(room: SeekRoom) {
  const phase = room.phase as keyof typeof seekPhase;
  const label = phase === "head-start" ? "Pencari dilepas"
    : phase === "seeking" ? "Pencarian berakhir" : "Batas berkumpul";
  return `<section class="seek-progress" aria-labelledby="seek-phase-heading">
    <div class="solo-clock">
      <h2 id="seek-phase-heading" tabindex="-1">${seekPhase[phase]}</h2>
      <p>Giliran ${room.turn} dari 2</p>
      <time data-timer></time>
      ${room.phaseEndsAt === null ? "" : `<small>${label} ${wib(room.phaseEndsAt)}</small>`}
    </div>
    ${score(room)}
  </section>`;
}

function board(room: SeekRoom, { point: selected, busy, map }: Controls) {
  const type = pointAction(room);
  const canReference = type === "investigate" && Boolean(room.clues);
  const ruledOut = room.phase === "seeking" && room.hider !== room.seat ? new Set(room.ruledOut) : new Set<string>();
  const labelFor = (id: string) => ruledOut.has(id) ? "Sudah diperiksa" : undefined;
  const startId = escapeText(room.edition.start.id);
  const startName = escapeText(room.edition.start.name);
  const startBranch = room.clues?.branches[room.edition.start.id];
  return `<section class="solo-board" aria-labelledby="seek-board-heading">
    <div class="solo-section-heading">
      <h2 id="seek-board-heading" tabindex="-1">${type === "lock" ? "Pilih titik sembunyi" : type === "investigate" ? "Selidiki titik" : "Titik di papan"}</h2>
      <button class="secondary" type="button" data-action="map" data-focus="map" aria-expanded="${map.shown}" aria-controls="seek-map">${map.shown ? "Tutup peta" : "Lihat peta"}</button>
    </div>
    <div id="seek-map" ${map.shown ? "" : "hidden"}>${!map.shown ? "" : map.failed
      ? `<p class="solo-map-notice" role="status">Peta tidak tersedia. Lanjutkan lewat daftar titik.</p>${action("Muat ulang peta", "retry-map")}`
      : schematicBoard(room.edition, map.url, Boolean(type) && !busy, labelFor)}</div>
    <div class="solo-zone">
      <h3>${canReference ? `<button class="seek-start-point" type="button" data-action="point" data-point="${startId}"
        data-focus="list-${startId}" aria-controls="seek-action" ${busy ? "disabled" : ""}>${startName}</button>` : startName} <small>Titik awal</small>
        ${startBranch ? `<small class="seek-branch">${escapeText(startBranch)}</small>` : ""}</h3>
      <ul>${room.edition.checkpoints.map(point => {
        const id = escapeText(point.id);
        const name = escapeText(point.name);
        const branch = room.clues?.branches[point.id];
        return `<li class="solo-point" data-checkpoint="${id}" ${id === selected?.id ? 'data-selected="true"' : ""}>
          <div class="solo-point-detail">${type && (canReference || !ruledOut.has(point.id))
            ? `<button type="button" data-action="point" data-point="${id}" data-focus="list-${id}" aria-controls="seek-action" ${busy ? "disabled" : ""}>${name}</button>`
            : `<strong>${name}</strong>`}${branch ? `<small class="seek-branch">${escapeText(branch)}</small>` : ""}</div>
          ${ruledOut.has(point.id) ? '<span class="solo-point-state">Sudah diperiksa</span>' : ""}
        </li>`;
      }).join("")}</ul>
    </div>
  </section>`;
}

function result(room: SeekRoom, controls: Controls) {
  const winner = room.outcome?.winner;
  const title = room.phase === "canceled" ? "Ruang dibatalkan" : room.phase === "void" ? "Pertandingan batal"
    : room.phase === "incomplete" ? "Pertandingan belum lengkap" : winner ? `Pemenang: ${player[winner]}` : "Seri";
  const reason = {
    scored: winner ? `${player[winner]} meraih skor waktu sembunyi tertinggi.` : "Kedua pemain meraih skor waktu sembunyi yang sama.",
    "missed-lock": "Waktu sembunyi habis sebelum titik sembunyi dikunci.",
    "regroup-timeout": "Batas berkumpul habis sebelum kedua pemain kembali ke titik awal.",
    forfeit: winner ? `${player[otherSeat(winner)]} keluar dari pertandingan. ${player[winner]} menang.` : "Seorang pemain keluar dari pertandingan.",
    canceled: "Tuan rumah menutup ruang sebelum pertandingan dimulai.",
  };
  return `<div class="solo-result">
    <section class="solo-ticket" aria-labelledby="seek-result-heading">
      <h2 id="seek-result-heading" tabindex="-1">${title}</h2>
      ${room.outcome ? `<p>${reason[room.outcome.reason]}</p><p>${room.startedAt === null ? "" : `Dimulai ${wib(room.startedAt)} · `}Berakhir ${wib(room.outcome.at)}</p>` : ""}
      ${room.turns.length ? score(room) : ""}
      ${feedbackMarkup(controls.feedback)}
      ${action("Main lagi", "replay", "primary", controls.busy)}
    </section>
    ${turnHistory(room)}
    ${clueHistory(room, true)}
  </div>`;
}

export function roomView(room: SeekRoom, controls: Controls, confirmingExit: boolean) {
  if (room.phase !== "lobby" && !active(room)) return result(room, controls);
  const exit = room.phase !== "lobby" ? "Keluar dari pertandingan" : room.seat === "host" ? "Batalkan ruang" : "Keluar dari ruang";
  return `<p class="seek-server-time">Waktu server <time data-server-clock></time></p>
    ${room.phase === "lobby" ? "" : progress(room)}
    <div class="solo-layout">${room.phase === "lobby" ? lobby(room, controls) : instructions(room, controls)}${board(room, controls)}</div>
    <footer class="solo-footer">
      ${confirmingExit ? `<p>${room.phase === "lobby" ? "Keluar dari ruang ini?" : "Jika keluar, temanmu menang."}</p>
        ${action("Ya, keluar", "leave", "secondary", controls.busy)} ${action("Lanjut bermain", "cancel-exit")}`
        : action(exit, "confirm-exit", "secondary", controls.busy)}
    </footer>`;
}
