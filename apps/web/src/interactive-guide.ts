import "./interactive-guide.css";

export type GuideTrack = "hide-and-seek" | "claim-the-city" | "safety";

type SpotQuizItem = {
  id: string;
  question: string;
  allow: boolean;
  reason: string;
};

type QuestionFamilyInfo = {
  id: string;
  name: string;
  cost: string;
  rule: string;
  svg: string;
};

const SPOT_QUIZ: SpotQuizItem[] = [
  {
    id: "lift",
    question: "1/3 · Bolehkah bersembunyi di dalam lift stasiun?",
    allow: false,
    reason: "Dilarang Keras! Lift, tangga darurat, atau area sempit yang hanya dilalui tidak boleh dipakai.",
  },
  {
    id: "cafe",
    question: "2/3 · Duduk santai di kafe stasiun yang buka hingga akhir sesi?",
    allow: true,
    reason: "Boleh (Kategori C)! Area usaha terbuka tanpa tiket masuk dan pelanggan boleh menetap.",
  },
  {
    id: "park",
    question: "3/3 · Taman kota / plaza terbuka <= 3 m dari jalur Google Maps?",
    allow: true,
    reason: "Boleh (Kategori A/B)! Taman publik terbuka bebas halangan sah dan aman untuk kedua tim.",
  },
];

const QUESTION_FAMILIES: QuestionFamilyInfo[] = [
  {
    id: "radar",
    name: "Radar",
    cost: "Draw 2, Keep 1 · Ulang: 1× → 2× → 3×",
    rule: "Apakah Penyembunyi berada dalam radius R meter dari posisi Pencari? Lingkaran menggambar area sah di peta.",
    svg: `<svg viewBox="0 0 280 96" aria-hidden="true"><rect width="280" height="96" fill="#eef6f2"/><circle cx="140" cy="48" r="36" fill="#0f766e" fill-opacity=".14" stroke="#0f766e" stroke-width="2" stroke-dasharray="4 3"/><circle cx="140" cy="48" r="18" fill="none" stroke="#0f766e" stroke-width="1.5"/><circle cx="140" cy="48" r="5" fill="#153d34"/><circle cx="164" cy="38" r="5" fill="#d97706"/><text x="15" y="20" font-size="11" font-weight="700" fill="#153d34">Ya = Di dalam · Tidak = Di luar</text></svg>`,
  },
  {
    id: "thermometer",
    name: "Termometer",
    cost: "Draw 2, Keep 1 · Min tempuh X m",
    rule: "Bandingkan titik awal (A) dan titik akhir (B): apakah Pencari makin hangat (mendekat) atau dingin?",
    svg: `<svg viewBox="0 0 280 96" aria-hidden="true"><rect width="280" height="96" fill="#fdf4f6"/><line x1="56" y1="54" x2="215" y2="54" stroke="#9f214b" stroke-width="3" stroke-dasharray="5 3"/><circle cx="56" cy="54" r="10" fill="#153d34"/><text x="56" y="58" text-anchor="middle" font-size="10" font-weight="700" fill="#fff">A</text><circle cx="215" cy="54" r="10" fill="#9f214b"/><text x="215" y="58" text-anchor="middle" font-size="10" font-weight="700" fill="#fff">B</text><text x="140" y="24" text-anchor="middle" font-size="11" font-weight="700" fill="#9f214b">Garis Bisektor membelah area!</text></svg>`,
  },
  {
    id: "matching",
    name: "Matching",
    cost: "Draw 3, Keep 1 · Ulang: 1× → 2× → 3×",
    rule: "Apakah atributmu (jalur MRT/KRL/TJ, kecamatan, mal/taman terdekat) sama dengan Pencari?",
    svg: `<svg viewBox="0 0 280 96" aria-hidden="true"><rect width="280" height="96" fill="#eef4fa"/><rect x="34" y="28" width="84" height="40" rx="8" fill="#fff" stroke="#255d9f" stroke-width="2"/><text x="76" y="52" text-anchor="middle" font-size="11" font-weight="700" fill="#255d9f">Pencari</text><rect x="162" y="28" width="84" height="40" rx="8" fill="#fff" stroke="#0f766e" stroke-width="2"/><text x="204" y="52" text-anchor="middle" font-size="11" font-weight="700" fill="#0f766e">Hider</text><path d="M118 48h44" stroke="#153d34" stroke-width="2.5"/><text x="140" y="20" text-anchor="middle" font-size="11" font-weight="700" fill="#153d34">Voronoi POI / Kecamatan</text></svg>`,
  },
  {
    id: "measuring",
    name: "Measuring",
    cost: "Draw 3, Keep 1 · Jarak POI",
    rule: "Siapa lebih dekat ke patokan (taman, stasiun MRT, Monas, atau Bundaran HI)?",
    svg: `<svg viewBox="0 0 280 96" aria-hidden="true"><rect width="280" height="96" fill="#fef9ed"/><rect x="28" y="64" width="224" height="14" rx="4" fill="#ffce55" stroke="#153d34"/><path d="M60 64v8M95 64v5M130 64v8M165 64v5M200 64v8" stroke="#153d34"/><circle cx="140" cy="36" r="14" fill="#153d34"/><text x="140" y="40" text-anchor="middle" font-size="10" font-weight="700" fill="#fff">POI</text></svg>`,
  },
  {
    id: "tentacles",
    name: "Tentacles",
    cost: "Draw 4, Keep 2 · Wajib dlm radius",
    rule: "Beri tahu POI terdekat milikmu bila kamu berada di dalam jangkauan R meter dari Pencari.",
    svg: `<svg viewBox="0 0 280 96" aria-hidden="true"><rect width="280" height="96" fill="#f4f0fa"/><circle cx="140" cy="48" r="34" fill="#6745a8" fill-opacity=".12" stroke="#6745a8" stroke-dasharray="3 3"/><line x1="140" y1="48" x2="96" y2="28" stroke="#6745a8" stroke-width="2"/><line x1="140" y1="48" x2="188" y2="30" stroke="#6745a8" stroke-width="2"/><line x1="140" y1="48" x2="178" y2="70" stroke="#6745a8" stroke-width="2"/><circle cx="140" cy="48" r="6" fill="#6745a8"/><circle cx="96" cy="28" r="4" fill="#0f766e"/><circle cx="188" cy="30" r="4" fill="#0f766e"/><circle cx="178" cy="70" r="4" fill="#0f766e"/></svg>`,
  },
  {
    id: "photo",
    name: "Foto",
    cost: "Draw 1, Keep 1 · Tanpa wajah orang",
    rule: "Kirim bukti foto lingkungan terbuka sesuai permintaan. Di Endgame, boleh jawab 'Tidak bisa menjawab' jika stasiun tak terjangkau.",
    svg: `<svg viewBox="0 0 280 96" aria-hidden="true"><rect width="280" height="96" fill="#eef4f0"/><rect x="88" y="22" width="104" height="58" rx="10" fill="#fff" stroke="#153d34" stroke-width="2"/><rect x="118" y="14" width="44" height="10" rx="4" fill="#ffce55" stroke="#153d34"/><circle cx="140" cy="51" r="16" fill="#bce7f0" stroke="#153d34" stroke-width="2"/><circle cx="140" cy="51" r="6" fill="#153d34"/></svg>`,
  },
];

const ZONE_CYCLE = [
  {
    state: "neutral",
    badge: "Netral (Zona Start · 0 Poin)",
    desc: "Semua tim bebas melintas. Tidak bisa diklaim sepanjang waktu reguler, namun dibuka saat Tiebreaker!",
  },
  {
    state: "unclaimed",
    badge: "Belum Diklaim (0 Poin)",
    desc: "Selesaikan Travel Challenge sebelum masuk jalan kaki (atau naik transit), lalu klaim gratis begitu tiba di dalam zona.",
  },
  {
    state: "claimed",
    badge: "Diklaim / Rentan (1 Poin · Bisa Direbut!)",
    desc: "Pemilik mendapat +1 poin. Lawan BISA merebutnya bila menyelesaikan Tantangan Zona lebih dulu sebelum dikunci!",
  },
  {
    state: "locked",
    badge: "Terkunci (1 Poin · Aman Permanen)",
    desc: "Kunci zona via Tantangan Zona (atau jika semua lawan gagal menantang). Tidak dapat direbut lagi!",
  },
] as const;

export function mountInteractiveGuide(
  dialog: HTMLDialogElement,
  initialTrack: GuideTrack = "hide-and-seek",
) {
  const found = dialog.querySelector<HTMLElement>("#guide-interactive");
  if (!found) return { setTrack() {} };
  const container: HTMLElement = found;

  let track: GuideTrack = initialTrack;
  let slideIdx = 0;
  let scaleChoice: "small" | "medium" | "large" = "small";
  let phaseChoice: 0 | 1 | 2 = 0;
  let quizIdx = 0;
  let quizAnswer: boolean | null = null;
  let famChoice = "radar";
  let zoneStateIdx = 0;

  function slidesForTrack(): number {
    if (track === "hide-and-seek") return 6;
    if (track === "claim-the-city") return 4;
    return 2;
  }

  function renderHideSeekSlide(): string {
    if (slideIdx === 0) {
      const scaleInfo =
        scaleChoice === "small"
          ? { title: "Small (S)", duration: "4–8 jam", area: "50–100 stasiun · 25–250 km²", example: "Cocok untuk Jakarta (Compact) · zona 400 m." }
          : scaleChoice === "medium"
            ? { title: "Medium (M)", duration: "~1 hari", area: "100–500 stasiun · 250–2.500 km²", example: "Cocok untuk Jakarta (Wide) hingga Jabodetabek." }
            : { title: "Large (L)", duration: "2–4 hari", area: "500+ stasiun · 2.500+ km²", example: "Lintas wilayah/negara; wajib P3K, senter & power bank." };
      return `<article class="ig-slide" data-testid="ig-slide">
        <div class="ig-art">
          <svg viewBox="0 0 320 110" aria-hidden="true">
            <rect width="320" height="110" fill="#eef6f1"/>
            <circle cx="70" cy="56" r="24" fill="${scaleChoice === "small" ? "#ffce55" : "#fff"}" stroke="#153d34" stroke-width="2"/>
            <text x="70" y="60" text-anchor="middle" font-size="12" font-weight="700" fill="#153d34">SMALL</text>
            <circle cx="160" cy="56" r="34" fill="${scaleChoice === "medium" ? "#ffce55" : "#fff"}" stroke="#153d34" stroke-width="2"/>
            <text x="160" y="60" text-anchor="middle" font-size="12" font-weight="700" fill="#153d34">MEDIUM</text>
            <circle cx="252" cy="56" r="44" fill="${scaleChoice === "large" ? "#ffce55" : "#fff"}" stroke="#153d34" stroke-width="2"/>
            <text x="252" y="60" text-anchor="middle" font-size="12" font-weight="700" fill="#153d34">LARGE</text>
          </svg>
        </div>
        <h3>1 · Skala Papan &amp; Persiapan</h3>
        <div class="ig-pill-row">
          <button type="button" class="ig-pill-btn" data-ig-scale="small" aria-pressed="${scaleChoice === "small"}">Small</button>
          <button type="button" class="ig-pill-btn" data-ig-scale="medium" aria-pressed="${scaleChoice === "medium"}">Medium</button>
          <button type="button" class="ig-pill-btn" data-ig-scale="large" aria-pressed="${scaleChoice === "large"}">Large</button>
        </div>
        <div class="ig-badges">
          <span class="ig-badge">${scaleInfo.title}</span>
          <span class="ig-badge">${scaleInfo.duration}</span>
          <span class="ig-badge">${scaleInfo.area}</span>
        </div>
        <p>${scaleInfo.example}</p>
        <p><small>Sepakati sebelum mulai: titik &amp; jam start, durasi sembunyi, batas area, radius zona, dan moda transit sah.</small></p>
      </article>`;
    }

    if (slideIdx === 1) {
      const phases = [
        {
          name: "1. Sembunyi (Head Start)",
          hider: "Naik transit & kunci 1 Stasiun Jangkar (ada rute jalan kaki ke pusat zona). Tidak boleh pindah zona setelah terkunci.",
          seeker: "Tetap di titik awal & lakukan riset peta. Dilarang mengintip keberangkatan Hider!",
        },
        {
          name: "2. Perburuan (Seeking)",
          hider: "Diam di dalam zona sembunyi (TANPA transit), jawab pertanyaan jujur tepat waktu, tarik & mainkan kartu.",
          seeker: "Wajib bagikan lokasi live, naik transit umum, dan ajukan 6 keluarga petunjuk untuk menyempitkan zona.",
        },
        {
          name: "3. Endgame (2 m + Kode)",
          hider: "Beku di 1 tempat sembunyi publik saat Seeker masuk zona & turun transit. 'Tidak bisa menjawab' sah utk foto stasiun tak terjangkau.",
          seeker: "Endgame permanen walau keluar zona. Tangkap dlm jarak <= 2 meter, identifikasi Hider, & masukkan Kode 4 Digit!",
        },
      ] as const;
      const active = phases[phaseChoice];
      return `<article class="ig-slide" data-testid="ig-slide">
        <div class="ig-art">
          <svg viewBox="0 0 320 96" aria-hidden="true">
            <rect width="320" height="96" fill="#eef6f1"/>
            <line x1="56" y1="46" x2="264" y2="46" stroke="#8cab9d" stroke-width="4"/>
            <circle cx="56" cy="46" r="18" fill="${phaseChoice === 0 ? "#ffce55" : "#fff"}" stroke="#153d34" stroke-width="2"/>
            <text x="56" y="50" text-anchor="middle" font-size="11" font-weight="700" fill="#153d34">1</text>
            <circle cx="160" cy="46" r="18" fill="${phaseChoice === 1 ? "#ffce55" : "#fff"}" stroke="#153d34" stroke-width="2"/>
            <text x="160" y="50" text-anchor="middle" font-size="11" font-weight="700" fill="#153d34">2</text>
            <circle cx="264" cy="46" r="18" fill="${phaseChoice === 2 ? "#0f766e" : "#fff"}" stroke="#153d34" stroke-width="2"/>
            <text x="264" y="50" text-anchor="middle" font-size="11" font-weight="700" fill="${phaseChoice === 2 ? "#fff" : "#153d34"}">3</text>
            <text x="56" y="80" text-anchor="middle" font-size="10" font-weight="700" fill="#153d34">Sembunyi</text>
            <text x="160" y="80" text-anchor="middle" font-size="10" font-weight="700" fill="#153d34">Cari</text>
            <text x="264" y="80" text-anchor="middle" font-size="10" font-weight="700" fill="#153d34">Endgame</text>
          </svg>
        </div>
        <h3>2 · ${active.name}</h3>
        <div class="ig-pill-row">
          <button type="button" class="ig-pill-btn" data-ig-phase="0" aria-pressed="${phaseChoice === 0}">1. Sembunyi</button>
          <button type="button" class="ig-pill-btn" data-ig-phase="1" aria-pressed="${phaseChoice === 1}">2. Cari</button>
          <button type="button" class="ig-pill-btn" data-ig-phase="2" aria-pressed="${phaseChoice === 2}">3. Endgame</button>
        </div>
        <ul class="ig-list">
          <li><strong>Penyembunyi:</strong> ${active.hider}</li>
          <li><strong>Pencari:</strong> ${active.seeker}</li>
        </ul>
      </article>`;
    }

    if (slideIdx === 2) {
      const q = SPOT_QUIZ[quizIdx];
      const answered = quizAnswer !== null;
      const isRight = answered && quizAnswer === q.allow;
      return `<article class="ig-slide" data-testid="ig-slide">
        <h3>3 · Tempat Sembunyi Sah (Spot A/B/C)</h3>
        <div class="ig-badges">
          <span class="ig-badge">A: Jalan/Trotoar &lt;=3 m</span>
          <span class="ig-badge">B: Taman/Plaza Terbuka</span>
          <span class="ig-badge">C: Kafe/Konkor Stasiun</span>
        </div>
        <div class="ig-badges">
          <span class="ig-badge ig-badge-danger">Dilarang: Tempat sampah/lemari, ruang ibadah, RS/klinik, sekolah, polisi/damkar, playground, lift, 18+/berbayar</span>
        </div>
        <div class="ig-quiz-box" data-testid="ig-spot-quiz">
          <strong>Mini-Latihan Tempat Sembunyi:</strong>
          <p>${q.question}</p>
          <div class="ig-pill-row">
            <button type="button" class="ig-pill-btn" data-ig-quiz="yes" aria-pressed="${quizAnswer === true}">Boleh</button>
            <button type="button" class="ig-pill-btn" data-ig-quiz="no" aria-pressed="${quizAnswer === false}">Dilarang Keras</button>
            <button type="button" class="ig-pill-btn" data-ig-quiz-next="1">Soal Berikutnya ↻</button>
          </div>
          ${
            answered
              ? `<div class="ig-quiz-feedback" data-ok="${isRight}" data-testid="ig-quiz-feedback">${isRight ? "Benar!" : "Kurang tepat —"} ${q.reason}</div>`
              : ""
          }
        </div>
      </article>`;
    }

    if (slideIdx === 3) {
      const fam = QUESTION_FAMILIES.find((f) => f.id === famChoice) ?? QUESTION_FAMILIES[0];
      return `<article class="ig-slide" data-testid="ig-slide">
        <div class="ig-art">${fam.svg}</div>
        <h3>4 · 6 Keluarga Pertanyaan &amp; Foto Pra-Ambil</h3>
        <div class="ig-family-grid">
          ${QUESTION_FAMILIES.map(
            (f) => `<button type="button" class="ig-family-btn" data-ig-fam="${f.id}" aria-pressed="${f.id === fam.id}">${f.name}</button>`,
          ).join("")}
        </div>
        <div class="ig-badges">
          <span class="ig-badge">${fam.cost}</span>
          <span class="ig-badge ig-badge-warn">Telat (Non-Foto): Wajib Diam!</span>
        </div>
        <p>${fam.rule}</p>
        <p><small><strong>Foto Pra-Ambil:</strong> boleh disiapkan setelah mengunci zona (bukan Endgame), asal lokasi tetap terbuka untuk umum saat dikirim &amp; kartu Kutukan sudah di tangan.</small></p>
      </article>`;
    }

    if (slideIdx === 4) {
      return `<article class="ig-slide" data-testid="ig-slide">
        <div class="ig-art">
          <svg viewBox="0 0 320 96" aria-hidden="true">
            <rect width="320" height="96" fill="#f5f8f5"/>
            <rect x="12" y="20" width="66" height="56" rx="8" fill="#153d34"/><text x="45" y="46" text-anchor="middle" font-size="10" font-weight="700" fill="#fff">1. DEK</text><text x="45" y="60" text-anchor="middle" font-size="8" fill="#c5ee69">Tertutup</text>
            <rect x="88" y="20" width="72" height="56" rx="8" fill="#ffce55" stroke="#153d34"/><text x="124" y="46" text-anchor="middle" font-size="10" font-weight="700" fill="#153d34">2. TANGAN</text><text x="124" y="60" text-anchor="middle" font-size="8" fill="#153d34">Maks 5–6</text>
            <rect x="170" y="20" width="66" height="56" rx="8" fill="#eef4f0" stroke="#8cab9d"/><text x="203" y="46" text-anchor="middle" font-size="10" font-weight="700" fill="#153d34">3. BUANG</text><text x="203" y="60" text-anchor="middle" font-size="8" fill="#52675c">Kocok lagi</text>
            <rect x="246" y="20" width="62" height="56" rx="8" fill="#fee2e2" stroke="#ef4444"/><text x="277" y="46" text-anchor="middle" font-size="10" font-weight="700" fill="#991b1b">4. KELUAR</text><text x="277" y="60" text-anchor="middle" font-size="8" fill="#991b1b">Removed</text>
          </svg>
        </div>
        <h3>5 · Dek Kartu &amp; Batas Tangan (2 Menit)</h3>
        <div class="ig-badges">
          <span class="ig-badge">Bonus Waktu</span>
          <span class="ig-badge">Power Up</span>
          <span class="ig-badge ig-badge-danger">Kutukan (Casting Cost + Hapus)</span>
        </div>
        <ul class="ig-list">
          <li><strong>Bonus Waktu:</strong> Otomatis menambah skor akhir jika tersisa di tangan saat ditemukan.</li>
          <li><strong>Kutukan (Curse):</strong> Wajib beri tahu Seeker saat melempar &amp; memenuhi biaya lempar; tidak boleh curi start sebelum punya kartunya.</li>
          <li><strong>Batas Tangan:</strong> Lebih dari 5–6 kartu? Buang/mainkan dalam <strong>2 menit</strong> (atau dibuang acak). Selama berlebih, dilarang tarik kartu atau jawab pertanyaan!</li>
        </ul>
      </article>`;
    }

    return `<article class="ig-slide" data-testid="ig-slide">
      <h3>6 · Perlengkapan &amp; Rotasi Ronde</h3>
      <div class="ig-badges">
        <span class="ig-badge">Wajib: Kuota + Kartu Transit + Dek/Dadu</span>
        <span class="ig-badge ig-badge-warn">Sesi Panjang: Power Bank, Air, Senter, P3K</span>
      </div>
      <ul class="ig-list">
        <li><strong>Rotasi Ronde:</strong> Saat Hider ditemukan (+Kode Temuan), clock berhenti dan giliran bertukar dari stasiun temuan atau titik awal sesuai aturan paket.</li>
        <li><strong>Skala Jakarta:</strong> Pemenang ditentukan oleh total waktu sembunyi + kartu Bonus Waktu terlama setelah semua pemain mendapat giliran.</li>
      </ul>
    </article>`;
  }

  function renderClaimSlide(): string {
    if (slideIdx === 0) {
      const z = ZONE_CYCLE[zoneStateIdx];
      return `<article class="ig-slide" data-testid="ig-slide">
        <div class="ig-art">
          <svg viewBox="0 0 320 92" aria-hidden="true">
            <rect width="320" height="92" fill="#f4f8f5"/>
            <rect x="20" y="20" width="62" height="52" rx="8" fill="${zoneStateIdx === 0 ? "#ffce55" : "#e5e7eb"}" stroke="#153d34"/><text x="51" y="50" text-anchor="middle" font-size="10" font-weight="700" fill="#153d34">Netral</text>
            <rect x="92" y="20" width="66" height="52" rx="8" fill="${zoneStateIdx === 1 ? "#ffce55" : "#fff"}" stroke="#153d34"/><text x="125" y="50" text-anchor="middle" font-size="10" font-weight="700" fill="#153d34">Unclaimed</text>
            <rect x="168" y="20" width="64" height="52" rx="8" fill="${zoneStateIdx === 2 ? "#fef3c7" : "#fff"}" stroke="#b45309" stroke-dasharray="4 2" stroke-width="2"/><text x="200" y="50" text-anchor="middle" font-size="10" font-weight="700" fill="#92400e">Claimed</text>
            <rect x="242" y="20" width="62" height="52" rx="8" fill="${zoneStateIdx === 3 ? "#0f766e" : "#eef4f0"}" stroke="#0f766e" stroke-width="2"/><text x="273" y="50" text-anchor="middle" font-size="10" font-weight="700" fill="${zoneStateIdx === 3 ? "#fff" : "#0f766e"}">Locked 🔒</text>
          </svg>
        </div>
        <h3>1 · Status Zona Interaktif (Klaim → Kunci → Rebut)</h3>
        <div class="ig-cycle-card">
          <button type="button" class="ig-cycle-tile" data-state="${z.state}" data-testid="ig-zone-cycle-btn" data-ig-cycle="1">
            <span>${z.badge}</span>
            <span>Ketuk Ubah ↻</span>
          </button>
          <p data-testid="ig-zone-cycle-desc">${z.desc}</p>
        </div>
        <div class="ig-badges">
          <span class="ig-badge">Solo: Kunci Target Zona</span>
          <span class="ig-badge">Grup: 2–6 Pemain (Kompak Tim)</span>
        </div>
      </article>`;
    }

    if (slideIdx === 1) {
      return `<article class="ig-slide" data-testid="ig-slide">
        <div class="ig-art">
          <svg viewBox="0 0 320 92" aria-hidden="true">
            <rect width="320" height="92" fill="#eef6f2"/>
            <rect x="16" y="16" width="136" height="60" rx="10" fill="#fff" stroke="#0f766e" stroke-width="2"/>
            <text x="84" y="40" text-anchor="middle" font-size="11" font-weight="700" fill="#0f766e">Tantangan Zona</text>
            <text x="84" y="58" text-anchor="middle" font-size="9" fill="#153d34">Harus turun &amp; jalan kaki!</text>
            <rect x="168" y="16" width="136" height="60" rx="10" fill="#fff" stroke="#255d9f" stroke-width="2"/>
            <text x="236" y="40" text-anchor="middle" font-size="11" font-weight="700" fill="#255d9f">Travel Challenge</text>
            <text x="236" y="58" text-anchor="middle" font-size="9" fill="#153d34">Lintas zona / naik bus/KA</text>
          </svg>
        </div>
        <h3>2 · Tantangan Zona vs Perjalanan &amp; Transit</h3>
        <ul class="ig-list">
          <li><strong>Turun Penuh dari Kendaraan:</strong> Dilarang klaim atau mulai Tantangan Zona di atas bus/kereta (kendaraan berhenti tetap dianggap naik transit!).</li>
          <li><strong>Sekali Jalan (One-Go):</strong> Tantangan Zona selesai utuh tanpa jeda; batal/keluar zona = gagal. Jika <strong>semua tim lawan gagal</strong> di satu zona, zona itu otomatis Terkunci untuk pemilik!</li>
          <li><strong>Moda Sah:</strong> Hanya jalan kaki &amp; transportasi umum (MRT/LRT/KRL/Transjakarta). Sepeda, skuter, taksi, &amp; mobil pribadi dilarang.</li>
        </ul>
      </article>`;
    }

    if (slideIdx === 2) {
      return `<article class="ig-slide" data-testid="ig-slide">
        <h3>3 · 6 Primitif Tantangan &amp; Dek Taktis</h3>
        <div class="ig-badges">
          <span class="ig-badge">MCQ</span>
          <span class="ig-badge">Isian</span>
          <span class="ig-badge">Bukti Foto</span>
          <span class="ig-badge">Tugas Bertimer</span>
          <span class="ig-badge">Call Your Shot</span>
          <span class="ig-badge">2-Langkah</span>
        </div>
        <ul class="ig-list">
          <li><strong>Call Your Shot:</strong> Pilih rute aman (Standar) atau berisiko tinggi (Bold +1 Bobot / tarik kartu taktis)!</li>
          <li><strong>Kartu Taktis:</strong> <em>Intip Tantangan</em>, <em>Perisai Klaim</em>, <em>Bobot 2×</em>, <em>Tukar Tantangan</em>, <em>Kunci Instan</em>, &amp; <em>Kutukan Sabotase</em>.</li>
        </ul>
      </article>`;
    }

    return `<article class="ig-slide" data-testid="ig-slide">
      <h3>4 · Penalti Veto, Freeze, Istirahat &amp; Tiebreaker</h3>
      <div class="ig-badges">
        <span class="ig-badge ig-badge-danger">Veto: 10 m (Travel) / 15 m (Zona)</span>
        <span class="ig-badge ig-badge-warn">Freeze: Diam di Lokasi</span>
        <span class="ig-badge">Rest: Jam Dijeda</span>
      </div>
      <ul class="ig-list">
        <li><strong>Veto Period:</strong> Dilarang klaim zona, mulai tantangan, atau naik transit sampai masa penalti habis.</li>
        <li><strong>Rest Period:</strong> Seluruh timer (termasuk Veto/Freeze) berhenti sementara; wajib kembali ke posisi awal sebelum lanjut.</li>
        <li><strong>Tiebreaker Seri:</strong> Zona Start Netral berubah menjadi <em>Belum Diklaim</em>! Tim seri berpacu menjadi yang pertama mengunci zona start untuk menang.</li>
      </ul>
    </article>`;
  }

  function renderSafetySlide(): string {
    if (slideIdx === 0) {
      return `<article class="ig-slide" data-testid="ig-slide">
        <h3>1 · Keselamatan Ruang Publik &amp; Transportasi</h3>
        <div class="ig-badges">
          <span class="ig-badge">Hanya Area Publik Gratis</span>
          <span class="ig-badge ig-badge-warn">No Taksi / Kendaraan Pribadi</span>
        </div>
        <ul class="ig-list">
          <li>Utamakan keselamatan pejalan kaki, patuhi rambu &amp; aturan pengelola stasiun/taman.</li>
          <li>Jangan masuk properti privat, area berbayar/18+, sekolah, klinik, atau tempat berbahaya demi skor.</li>
          <li>Jika diminta meninggalkan suatu lokasi, segera pindah secara sopan lalu laporkan perubahan ke tim/wasit.</li>
        </ul>
      </article>`;
    }

    return `<article class="ig-slide" data-testid="ig-slide">
      <h3>2 · Kejujuran, Privasi Foto &amp; GPS</h3>
      <ul class="ig-list">
        <li>Kelana Ria hanya meminta GPS saat verifikasi check-in / aksi permainan, tidak pernah saat melihat katalog.</li>
        <li>Hindari memotret wajah orang lain atau data pribadi saat mengirim Bukti Foto atau Foto Pertanyaan.</li>
        <li>Siapkan paket data seluler, saldo kartu uang elektronik transportasi, serta power bank sebelum sesi dimulai.</li>
      </ul>
    </article>`;
  }

  function render() {
    const total = slidesForTrack();
    if (slideIdx >= total) slideIdx = 0;

    const slideHtml =
      track === "hide-and-seek"
        ? renderHideSeekSlide()
        : track === "claim-the-city"
          ? renderClaimSlide()
          : renderSafetySlide();

    container.innerHTML = `
      <div class="ig-tabs" role="tablist" aria-label="Pilih topik panduan">
        <button type="button" class="ig-tab" role="tab" data-ig-track="hide-and-seek" aria-selected="${track === "hide-and-seek"}">Hide &amp; Seek</button>
        <button type="button" class="ig-tab" role="tab" data-ig-track="claim-the-city" aria-selected="${track === "claim-the-city"}">Claim / Land Grab</button>
        <button type="button" class="ig-tab" role="tab" data-ig-track="safety" aria-selected="${track === "safety"}">Keamanan &amp; Etika</button>
      </div>

      <div class="ig-progress">
        <span data-testid="ig-step-label">Langkah ${slideIdx + 1}/${total}</span>
        <div class="ig-dots" aria-hidden="true">
          ${Array.from({ length: total }, (_, i) => `<span class="ig-dot" aria-current="${i === slideIdx ? "step" : "false"}"></span>`).join("")}
        </div>
      </div>

      ${slideHtml}

      <div class="ig-nav">
        <button type="button" data-ig-nav="prev" ${slideIdx === 0 ? "disabled" : ""}>← Sebelumnya</button>
        <button type="button" class="ig-nav-next" data-ig-nav="next" ${slideIdx >= total - 1 ? "disabled" : ""}>Lanjut →</button>
      </div>
    `;
  }

  container.addEventListener("click", (event) => {
    const btn = (event.target as HTMLElement | null)?.closest<HTMLButtonElement>("button");
    if (!btn) return;
    if (btn.dataset.igTrack) {
      track = btn.dataset.igTrack as GuideTrack;
      slideIdx = 0;
      render();
      return;
    }
    if (btn.dataset.igNav === "prev" && slideIdx > 0) {
      slideIdx -= 1;
      render();
      return;
    }
    if (btn.dataset.igNav === "next" && slideIdx < slidesForTrack() - 1) {
      slideIdx += 1;
      render();
      return;
    }
    if (btn.dataset.igScale === "small" || btn.dataset.igScale === "medium" || btn.dataset.igScale === "large") {
      scaleChoice = btn.dataset.igScale;
      render();
      return;
    }
    if (btn.dataset.igPhase !== undefined) {
      phaseChoice = Number(btn.dataset.igPhase) as 0 | 1 | 2;
      render();
      return;
    }
    if (btn.dataset.igQuiz === "yes" || btn.dataset.igQuiz === "no") {
      quizAnswer = btn.dataset.igQuiz === "yes";
      render();
      return;
    }
    if (btn.dataset.igQuizNext) {
      quizIdx = (quizIdx + 1) % SPOT_QUIZ.length;
      quizAnswer = null;
      render();
      return;
    }
    if (btn.dataset.igFam) {
      famChoice = btn.dataset.igFam;
      render();
      return;
    }
    if (btn.dataset.igCycle) {
      zoneStateIdx = (zoneStateIdx + 1) % ZONE_CYCLE.length;
      render();
    }
  });

  render();

  return {
    setTrack(nextTrack: GuideTrack) {
      track = nextTrack;
      slideIdx = 0;
      render();
    },
  };
}
