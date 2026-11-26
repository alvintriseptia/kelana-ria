export type PlayerErrorSurface = "catalog" | "checkout" | "lobby" | "claim" | "seek" | "recap";
export type PlayerErrorPlacement = "toast" | "inline-location" | "inline-field" | "inline-screen";
export type PlayerErrorTone = "warn" | "error" | "info";

export interface PlayerErrorContext {
  surface: PlayerErrorSurface;
  action?: string;
  target?: string;
}

export interface PlayerErrorResolution {
  code: string;
  message: string;
  placement: PlayerErrorPlacement;
  tone: PlayerErrorTone;
  recoverable: boolean;
  staleTarget?: boolean;
  endedPayment?: boolean;
  uncertain?: boolean;
  dedupeKey: string;
}

export class ApiTransportError extends Error {
  readonly code: "network-error" | "server-error";
  readonly status?: number;
  readonly detail?: string;

  constructor(code: "network-error" | "server-error", status?: number, detail?: string) {
    super(code);
    this.name = "ApiTransportError";
    this.code = code;
    this.status = status;
    this.detail = detail;
  }
}

export type PlayerErrorInput =
  | string
  | { code?: string; error?: string; status?: number; detail?: string }
  | Error
  | unknown;

type CatalogEntry = {
  message: string;
  placement: PlayerErrorPlacement;
  tone?: PlayerErrorTone;
  recoverable?: boolean;
  staleTarget?: boolean;
  endedPayment?: boolean;
  uncertain?: boolean;
};

export const OUT_OF_RANGE_CHECKIN_MESSAGE =
  "Kamu masih terlalu jauh dari titik ini. Dekati titiknya, lalu coba lagi.";

const SERVER_FALLBACK_MESSAGE =
  "Terjadi kendala sementara di server. Tunggu sebentar, lalu coba lagi.";

const NETWORK_FALLBACK_MESSAGE =
  "Koneksi terganggu. Periksa jaringanmu, lalu coba lagi.";

const REQUEST_FALLBACK_MESSAGE =
  "Permintaan belum bisa diproses. Muat ulang sebentar, lalu coba lagi.";

const ERROR_CATALOG: Record<string, CatalogEntry> = {
  // Geolocation & GPS verification
  "gps-denied": {
    message: "Izin lokasi ditolak. Aktifkan izin lokasi di pengaturan browser, lalu coba check-in lagi.",
    placement: "inline-location",
    tone: "warn",
  },
  "gps-unsupported": {
    message: "Lokasi tidak tersedia di browser ini. Izinkan akses lokasi atau gunakan browser lain.",
    placement: "inline-location",
    tone: "error",
  },
  "gps-timeout": {
    message: "Permintaan lokasi terlalu lama. Pastikan GPS aktif, lalu coba check-in lagi.",
    placement: "inline-location",
    tone: "warn",
  },
  "gps-unavailable": {
    message: "Lokasi belum ditemukan. Pindah ke area terbuka, lalu coba check-in lagi.",
    placement: "inline-location",
    tone: "warn",
  },
  "outside-radius": {
    message: OUT_OF_RANGE_CHECKIN_MESSAGE,
    placement: "inline-location",
    tone: "warn",
  },
  "outside-detour-poi-radius": {
    message: OUT_OF_RANGE_CHECKIN_MESSAGE,
    placement: "inline-location",
    tone: "warn",
  },
  "inaccurate-fix": {
    message: "Akurasi GPS belum cukup kuat. Pindah ke area lebih terbuka, lalu coba check-in lagi.",
    placement: "inline-location",
    tone: "warn",
  },
  "stale-fix": {
    message: "Data lokasi sudah kedaluwarsa. Perbarui lokasi, lalu coba check-in lagi.",
    placement: "inline-location",
    tone: "warn",
  },
  "invalid-fix": {
    message: "Data lokasi tidak terbaca dengan benar. Perbarui lokasi, lalu coba lagi.",
    placement: "inline-location",
    tone: "warn",
  },
  "location-required": {
    message: "Lokasi diperlukan untuk melanjutkan. Aktifkan GPS, lalu coba check-in lagi.",
    placement: "inline-location",
    tone: "warn",
  },
  "fresh-fix-required": {
    message: "Check-in sebelumnya sudah kedaluwarsa. Check-in ulang di titik ini, lalu lanjutkan.",
    placement: "inline-location",
    tone: "warn",
  },
  "invalid-qa-location": {
    message: "Titik simulasi QA tidak valid. Pilih titik simulasi lain dari daftar.",
    placement: "inline-location",
    tone: "warn",
  },

  // Catalog & checkout / payment
  "pack-unavailable": {
    message: "Edisi ini sudah tidak tersedia. Pilih edisi lain dari katalog.",
    placement: "inline-screen",
    tone: "warn",
    recoverable: false,
  },
  "pack-not-found": {
    message: "Edisi yang dicari tidak ditemukan. Kembali ke katalog untuk memilih edisi lain.",
    placement: "inline-screen",
    tone: "warn",
    recoverable: false,
  },
  "mode-unavailable": {
    message: "Mode ini tidak tersedia untuk edisi ini. Pilih mode lain.",
    placement: "inline-screen",
    tone: "warn",
  },
  "checkout-unavailable": {
    message: "Edisi berbayar belum bisa dibeli pada uji publik ini.",
    placement: "inline-screen",
    tone: "info",
    recoverable: false,
  },
  "sales-paused": {
    message: "Penjualan edisi ini sedang dijeda sementara. Pilih edisi lain dari katalog.",
    placement: "inline-screen",
    tone: "info",
    recoverable: false,
  },
  "payment-required": {
    message: "Edisi ini belum dimiliki. Beli paket terlebih dahulu atau pulihkan dengan Kode Pemulihan untuk membuka ruang.",
    placement: "inline-screen",
    tone: "info",
  },
  "pack-already-owned": {
    message: "Paket ini sudah dimiliki di perangkat ini. Kamu bisa langsung bermain tanpa bayar lagi.",
    placement: "toast",
    tone: "info",
  },
  "entitlement-active-room-exists": {
    message: "Masih ada ruang aktif untuk paket ini. Lanjutkan ruang yang berjalan atau selesaikan dulu sebelum membuat ruang baru.",
    placement: "toast",
    tone: "info",
  },
  "invalid-restore-code": {
    message: "Kode Pemulihan tidak cocok. Periksa kembali format KLR-XXXX-XXXX, lalu coba lagi.",
    placement: "toast",
    tone: "warn",
  },
  "restore-rate-limited": {
    message: "Terlalu banyak percobaan Kode Pemulihan. Tunggu beberapa menit, lalu coba lagi.",
    placement: "toast",
    tone: "warn",
  },
  "pack-is-free": {
    message: "Edisi ini gratis. Langsung tekan tombol mulai tanpa perlu checkout.",
    placement: "inline-screen",
    tone: "info",
  },
  "payment-pending": {
    message: "Pembayaran masih menunggu konfirmasi. Cek status lagi setelah selesai.",
    placement: "inline-screen",
    tone: "info",
  },
  "payment-review": {
    message: "Pembayaran sedang diperiksa. Cek status lagi sebentar.",
    placement: "inline-screen",
    tone: "info",
  },
  "payment-provider-unavailable": {
    message: "Layanan pembayaran belum bisa dihubungi. Tunggu sebentar, lalu cek status lagi.",
    placement: "inline-screen",
    tone: "warn",
    uncertain: true,
  },
  "order-expired": {
    message: "Waktu pembayaran habis. Kamu bisa membuat pesanan baru.",
    placement: "inline-screen",
    tone: "warn",
    endedPayment: true,
  },
  "payment-expire": {
    message: "Waktu pembayaran habis. Kamu bisa membuat pesanan baru.",
    placement: "inline-screen",
    tone: "warn",
    endedPayment: true,
  },
  "payment-cancel": {
    message: "Pembayaran dibatalkan. Kamu bisa membuat pesanan baru.",
    placement: "inline-screen",
    tone: "warn",
    endedPayment: true,
  },
  "payment-deny": {
    message: "Pembayaran ditolak. Coba lagi dengan pesanan baru.",
    placement: "inline-screen",
    tone: "error",
    endedPayment: true,
  },
  "payment-failure": {
    message: "Pembayaran belum berhasil diproses. Coba buat pesanan baru.",
    placement: "inline-screen",
    tone: "error",
    endedPayment: true,
  },
  "order-not-found": {
    message: "Pesanan tidak ditemukan di sesi ini. Periksa kembali atau buat pesanan baru.",
    placement: "inline-screen",
    tone: "warn",
  },
  "amount-or-currency-mismatch": {
    message: "Nominal pembayaran tidak sesuai pesanan. Cek status pembayaran atau buat pesanan baru.",
    placement: "inline-screen",
    tone: "error",
  },
  "invalid-signature": {
    message: "Verifikasi pembayaran gagal divalidasi. Cek status pembayaran lagi sebentar.",
    placement: "inline-screen",
    tone: "error",
  },
  "simulation-unavailable": {
    message: "Simulasi pelunasan tidak tersedia untuk pesanan ini. Selesaikan pembayaran lewat tautan uji.",
    placement: "inline-screen",
    tone: "warn",
  },
  "practice-load-failed": {
    message: "Panduan belum bisa dibuka. Periksa jaringanmu, lalu coba lagi.",
    placement: "toast",
    tone: "warn",
    uncertain: true,
  },

  // Lobby & room membership
  "join-code-required": {
    message: "Masukkan kode ruang terlebih dahulu, lalu tekan Gabung Ruang.",
    placement: "inline-field",
    tone: "warn",
  },
  "room-not-found": {
    message: "Ruang tidak ditemukan. Periksa kembali kode ruang atau buat ruang baru.",
    placement: "inline-screen",
    tone: "warn",
  },
  "room-full": {
    message: "Ruang sudah penuh. Minta Host membuat ruang baru atau pilih edisi lain.",
    placement: "inline-screen",
    tone: "warn",
  },
  "room-already-started": {
    message: "Permainan di ruang ini sudah dimulai. Kamu bisa membuat ruang baru untuk bermain.",
    placement: "inline-screen",
    tone: "warn",
  },
  "not-enough-players": {
    message: "Jumlah pemain belum mencukupi. Undang pemain lain sebelum memulai permainan.",
    placement: "inline-screen",
    tone: "warn",
  },
  "players-not-ready": {
    message: "Belum semua pemain siap. Pastikan semua peserta sudah check-in dan menekan Tandai Siap.",
    placement: "inline-screen",
    tone: "warn",
  },
  "start-unverified": {
    message: "Check-in titik awal belum terverifikasi atau sudah kedaluwarsa. Lakukan check-in titik awal terlebih dahulu.",
    placement: "inline-location",
    tone: "warn",
  },
  "host-only": {
    message: "Hanya Host yang bisa melakukan aksi ini.",
    placement: "inline-screen",
    tone: "info",
  },
  "seat-taken": {
    message: "Kursi pemain sudah terisi. Muat ulang ruang untuk melihat daftar peserta terbaru.",
    placement: "inline-screen",
    tone: "warn",
  },
  "not-a-member": {
    message: "Sesi ini belum terdaftar di ruang tersebut. Masukkan nama lalu gabung lewat kode ruang.",
    placement: "inline-screen",
    tone: "warn",
  },
  "match-finished": {
    message: "Permainan sudah selesai. Buka ringkasan pertandingan untuk melihat hasil akhir.",
    placement: "inline-screen",
    tone: "info",
    recoverable: false,
  },
  "round-finished": {
    message: "Ronde sudah berakhir. Periksa skor akhir atau mulai permainan baru.",
    placement: "inline-screen",
    tone: "info",
    recoverable: false,
  },
  "room-phase-changed": {
    message: "Fase permainan baru saja berubah. Periksa status terbaru di papan, lalu lanjutkan.",
    placement: "toast",
    tone: "info",
  },

  // Field & photo validation
  "input-required": {
    message: "Isi jawaban terlebih dahulu sebelum mengirim.",
    placement: "inline-field",
    tone: "warn",
  },
  "invalid-choice": {
    message: "Pilih salah satu opsi jawaban terlebih dahulu, lalu kirim lagi.",
    placement: "inline-field",
    tone: "warn",
  },
  "wrong-answer": {
    message: "Jawaban belum tepat. Periksa kembali lokasi atau petunjuk, lalu coba lagi saat siap.",
    placement: "inline-field",
    tone: "warn",
  },
  "invalid-found-code": {
    message: "Kode temuan tidak cocok. Pastikan 4 digit dari penyembunyi, lalu kirim lagi.",
    placement: "inline-field",
    tone: "warn",
  },
  "invalid-custom-radius": {
    message: "Masukkan angka radius yang valid dalam meter, lalu coba lagi.",
    placement: "inline-field",
    tone: "warn",
  },
  "incorrect-clue-answer": {
    message: "Jawaban tidak cocok dengan posisi sebenarnya di peta. Pilih jawaban yang sesuai.",
    placement: "inline-field",
    tone: "warn",
  },
  "photo-required": {
    message: "Pilih foto bukti terlebih dahulu sebelum mengunggah.",
    placement: "inline-field",
    tone: "warn",
  },
  "photo-too-large": {
    message: "Ukuran foto terlalu besar. Pilih foto JPEG, PNG, atau WebP maksimal 2 MB.",
    placement: "inline-field",
    tone: "warn",
  },
  "photo-unreadable": {
    message: "Foto tidak dapat dibaca perangkat. Ambil atau pilih foto lain, lalu coba lagi.",
    placement: "inline-field",
    tone: "warn",
  },
  "invalid-photo": {
    message: "Format foto tidak didukung. Pilih foto JPEG, PNG, atau WebP maksimal 2 MB.",
    placement: "inline-field",
    tone: "warn",
  },
  "photo-not-found": {
    message: "Foto bukti sudah tidak tersedia atau telah kedaluwarsa.",
    placement: "toast",
    tone: "info",
  },

  // Stale card targets (Claim the City & Hide & Seek)
  "invalid-shield-target": {
    message: "Target perisai sudah berubah sebelum kartu diproses. Pilih landmark rentan milikmu yang lain, lalu coba lagi.",
    placement: "toast",
    tone: "warn",
    staleTarget: true,
  },
  "invalid-instant-lock-target": {
    message: "Target kunci instan sudah berubah sebelum kartu diproses. Pilih landmark lain yang masih bisa dikunci.",
    placement: "toast",
    tone: "warn",
    staleTarget: true,
  },
  "invalid-double-target": {
    message: "Target bobot ganda sudah berubah sebelum kartu diproses. Pilih landmark terkunci milikmu yang lain.",
    placement: "toast",
    tone: "warn",
    staleTarget: true,
  },
  "invalid-scout-target": {
    message: "Target intai sudah berubah sebelum kartu diproses. Pilih landmark lain yang belum terkunci.",
    placement: "toast",
    tone: "warn",
    staleTarget: true,
  },
  "invalid-curse-target": {
    message: "Target sabotase sudah berubah sebelum kartu diproses. Pilih lawan lain, lalu coba lagi.",
    placement: "toast",
    tone: "warn",
    staleTarget: true,
  },
  "invalid-trap-station": {
    message: "Target stasiun untuk jebakan sudah berubah. Pilih stasiun lain di peta, lalu coba lagi.",
    placement: "toast",
    tone: "warn",
    staleTarget: true,
  },
  "station-already-trapped": {
    message: "Stasiun itu sudah dipasangi jebakan. Pilih stasiun lain di peta, lalu coba lagi.",
    placement: "toast",
    tone: "warn",
    staleTarget: true,
  },
  "landmark-shielded": {
    message: "Target landmark baru saja dilindungi perisai lawan. Pilih landmark lain atau tunggu perisainya berakhir.",
    placement: "toast",
    tone: "warn",
    staleTarget: true,
  },
  "landmark-burned": {
    message: "Landmark ini sudah hangus untuk permainanmu. Pilih landmark lain di peta.",
    placement: "toast",
    tone: "warn",
    staleTarget: true,
  },
  "already-locked": {
    message: "Target ini sudah terkunci sebelum aksimu diproses. Pilih target lain di peta.",
    placement: "toast",
    tone: "warn",
    staleTarget: true,
  },
  "invalid-duplicate-target": {
    message: "Kartu yang ingin digandakan sudah berubah. Pilih kartu lain di tanganmu.",
    placement: "toast",
    tone: "warn",
    staleTarget: true,
  },
  "card-not-in-hand": {
    message: "Kartu itu sudah tidak ada di tanganmu. Pilih kartu lain yang masih tersedia.",
    placement: "toast",
    tone: "warn",
    staleTarget: true,
  },
  "no-active-attempt": {
    message: "Tantangan aktif sudah berubah atau berakhir. Pilih landmark lain untuk melanjutkan.",
    placement: "toast",
    tone: "warn",
    staleTarget: true,
  },
  "no-pending-question": {
    message: "Pertanyaan aktif sudah ditutup sebelum aksimu diproses. Tunggu pertanyaan berikutnya.",
    placement: "toast",
    tone: "warn",
    staleTarget: true,
  },

  // Claim the City brief recoverable actions
  cooldown: {
    message: "Percobaan ulang di landmark ini masih menunggu jeda. Tunggu hitung mundur selesai atau pilih landmark lain.",
    placement: "toast",
    tone: "warn",
  },
  "claims-blocked-by-curse": {
    message: "Klaim landmark sedang diblokir oleh kutukan aktif. Selesaikan kutukanmu terlebih dahulu.",
    placement: "toast",
    tone: "warn",
  },
  "steals-blocked-by-curse": {
    message: "Rebut landmark sedang diblokir oleh kutukan aktif. Selesaikan kutukanmu terlebih dahulu.",
    placement: "toast",
    tone: "warn",
  },
  "target-curse-limit-reached": {
    message: "Lawan ini sudah mencapai batas kutukan aktif. Pilih lawan lain atau simpan kartumu.",
    placement: "toast",
    tone: "warn",
    staleTarget: true,
  },
  "shot-tier-required": {
    message: "Pilih tantangan Standar atau Ekstra dulu sebelum lanjut.",
    placement: "toast",
    tone: "info",
  },
  "shot-tier-already-chosen": {
    message: "Tingkat tantangan sudah dipilih. Lanjutkan menyelesaikan tugas yang tampil.",
    placement: "toast",
    tone: "info",
  },
  "not-call-your-shot": {
    message: "Tantangan ini tidak memakai pilihan Standar/Ekstra. Langsung ikuti instruksi di kartu.",
    placement: "toast",
    tone: "info",
  },
  "not-timed-task": {
    message: "Tantangan ini tidak memiliki timer terpisah. Langsung kirim jawabanmu.",
    placement: "toast",
    tone: "info",
  },
  "timed-task-not-started": {
    message: "Tekan Mulai Timer Tugas terlebih dahulu sebelum mengirim hasil.",
    placement: "toast",
    tone: "warn",
  },
  "timed-task-expired": {
    message: "Waktu tugas habis. Coba lagi nanti atau pilih landmark lain di peta.",
    placement: "toast",
    tone: "warn",
  },
  "photo-review-pending": {
    message: "Foto bukti sudah terkirim dan sedang menunggu tinjauan otomatis atau lawan.",
    placement: "toast",
    tone: "info",
  },
  "no-pending-photo": {
    message: "Foto bukti ini sudah selesai ditinjau.",
    placement: "toast",
    tone: "info",
  },
  "no-pending-curse-photo": {
    message: "Foto bukti kutukan ini sudah selesai ditinjau.",
    placement: "toast",
    tone: "info",
  },
  "challenge-hand-empty": {
    message: "Belum ada kartu tantangan tersedia untuk landmark ini.",
    placement: "toast",
    tone: "warn",
  },
  "challenge-unavailable": {
    message: "Tantangan tersebut sudah tidak tersedia. Pilih tantangan atau landmark lain.",
    placement: "toast",
    tone: "warn",
  },
  "backup-pool-exhausted": {
    message: "Tidak ada tantangan pengganti tersisa untuk ditukar.",
    placement: "toast",
    tone: "warn",
  },
  "unknown-landmark": {
    message: "Landmark yang dipilih tidak ditemukan di papan ini. Pilih titik lain di peta.",
    placement: "toast",
    tone: "warn",
    staleTarget: true,
  },
  "unknown-seat": {
    message: "Pemain target tidak ditemukan di ruang ini. Pilih peserta lain.",
    placement: "toast",
    tone: "warn",
    staleTarget: true,
  },
  "rival-only": {
    message: "Aksi ini hanya bisa dilakukan pada milik lawan.",
    placement: "toast",
    tone: "info",
  },
  "multiplayer-only": {
    message: "Aksi ini hanya tersedia pada permainan grup.",
    placement: "toast",
    tone: "info",
  },

  // Hide & Seek brief recoverable actions
  "hider-only": {
    message: "Aksi ini hanya tersedia untuk Penyembunyi pada giliran ini.",
    placement: "toast",
    tone: "info",
  },
  "seeker-only": {
    message: "Aksi ini hanya tersedia untuk Pencari pada giliran ini.",
    placement: "toast",
    tone: "info",
  },
  "seeking-only": {
    message: "Aksi ini hanya bisa dipakai saat Fase Cari berlangsung.",
    placement: "toast",
    tone: "info",
  },
  "endgame-only": {
    message: "Aksi ini hanya tersedia saat fase Endgame.",
    placement: "toast",
    tone: "info",
  },
  "hider-not-locked": {
    message: "Penyembunyi belum mengunci titik sembunyi. Tunggu hingga lokasi terkunci.",
    placement: "toast",
    tone: "info",
  },
  "hider-relocating": {
    message: "Penyembunyi sedang berpindah zona. Tunggu sebentar lalu coba lagi.",
    placement: "toast",
    tone: "info",
  },
  "already-relocating": {
    message: "Perpindahan zona sudah aktif. Pilih stasiun baru di peta lalu kunci lokasi.",
    placement: "toast",
    tone: "info",
  },
  "move-disabled-in-endgame": {
    message: "Kartu pindah zona tidak dapat dipakai saat Endgame. Gunakan kartu lain.",
    placement: "toast",
    tone: "warn",
  },
  "invalid-anchor-station": {
    message: "Stasiun yang dipilih tidak valid untuk titik sembunyi. Pilih stasiun lain di peta.",
    placement: "toast",
    tone: "warn",
    staleTarget: true,
  },
  "no-reference-station": {
    message: "Titik acuan belum tersedia. Perbarui lokasi check-in terlebih dahulu.",
    placement: "inline-location",
    tone: "warn",
  },
  "question-pending": {
    message: "Masih ada pertanyaan yang menunggu jawaban. Tunggu selesai sebelum mengirim pertanyaan baru.",
    placement: "toast",
    tone: "info",
  },
  "question-already-used": {
    message: "Pertanyaan ini sudah pernah dipakai pada giliran ini. Pilih pertanyaan lain.",
    placement: "toast",
    tone: "warn",
  },
  "question-closed": {
    message: "Pertanyaan ini sudah ditutup. Lanjutkan dengan petunjuk berikutnya.",
    placement: "toast",
    tone: "info",
  },
  "question-delayed": {
    message: "Pertanyaan sedang tertunda sementara oleh kartu lawan. Coba lagi setelah jeda berakhir.",
    placement: "toast",
    tone: "warn",
  },
  "question-family-banned": {
    message: "Kategori petunjuk ini sedang diblokir kutukan. Pilih kategori lain atau hapus kutukan terlebih dahulu.",
    placement: "toast",
    tone: "warn",
  },
  "question-family-disabled": {
    message: "Kategori petunjuk ini tidak aktif pada edisi ini. Pilih kategori lain.",
    placement: "toast",
    tone: "warn",
  },
  "question-unavailable-in-phase": {
    message: "Pertanyaan ini tidak tersedia di fase permainan saat ini. Pilih pertanyaan lain.",
    placement: "toast",
    tone: "warn",
  },
  "questions-blocked": {
    message: "Pertanyaan sedang diblokir oleh kutukan aktif. Selesaikan atau tebus kutukan terlebih dahulu.",
    placement: "toast",
    tone: "warn",
  },
  "no-unused-question-in-family": {
    message: "Semua pertanyaan di kategori ini sudah terpakai. Pilih kategori petunjuk lain.",
    placement: "toast",
    tone: "warn",
  },
  "unknown-question-item": {
    message: "Pilihan pertanyaan sudah berubah. Pilih ulang petunjuk dari daftar.",
    placement: "toast",
    tone: "warn",
  },
  "missing-computed-answer": {
    message: "Jawaban otomatis belum siap. Muat ulang sebentar, lalu coba lagi.",
    placement: "toast",
    tone: "warn",
  },
  "preview-unavailable": {
    message: "Pratinjau belum tersedia untuk titik ini. Perbarui lokasi lalu coba lagi.",
    placement: "inline-location",
    tone: "warn",
  },
  "thermometer-not-started": {
    message: "Tandai Titik A terlebih dahulu sebelum mengirim pertanyaan Termometer.",
    placement: "toast",
    tone: "warn",
  },
  "thermometer-distance-insufficient": {
    message: "Jarak perpindahanmu belum mencapai minimum Termometer. Bergerak lebih jauh, lalu tandai Titik B lagi.",
    placement: "inline-location",
    tone: "warn",
  },
  "draw-pending": {
    message: "Pilih kartu yang ingin disimpan terlebih dahulu sebelum melakukan aksi lain.",
    placement: "toast",
    tone: "info",
  },
  "no-active-draw": {
    message: "Pilihan pengambilan kartu sudah selesai diproses.",
    placement: "toast",
    tone: "info",
  },
  "invalid-draw-selection": {
    message: "Jumlah kartu yang dipilih belum sesuai. Pilih kartu sesuai batas simpan lalu konfirmasi.",
    placement: "toast",
    tone: "warn",
  },
  "hand-limit-discard-required": {
    message: "Kartu di tangan sudah penuh. Buang kartu sesuai batas sebelum simpan kartu baru.",
    placement: "toast",
    tone: "warn",
  },
  "invalid-discard-selection": {
    message: "Pilihan kartu buangan tidak valid. Pilih kartu lain di tanganmu.",
    placement: "toast",
    tone: "warn",
  },
  "time-bonus-not-playable": {
    message: "Kartu bonus waktu otomatis dihitung di akhir giliran dan tidak perlu dimainkan manual.",
    placement: "toast",
    tone: "info",
  },
  "card-not-playable": {
    message: "Kartu ini belum bisa dimainkan sekarang. Periksa kondisi permainan lalu coba lagi.",
    placement: "toast",
    tone: "warn",
  },
  "duplicate-category-disallowed": {
    message: "Jenis kartu tersebut tidak dapat digandakan. Pilih kartu lain di tanganmu.",
    placement: "toast",
    tone: "warn",
    staleTarget: true,
  },
  "duplicate-move-disallowed": {
    message: "Kartu pindah zona tidak dapat digandakan. Pilih kartu lain di tanganmu.",
    placement: "toast",
    tone: "warn",
    staleTarget: true,
  },
  "casting-cost-category-unmet": {
    message: "Syarat kartu pendukung belum terpenuhi untuk memainkan kartu ini.",
    placement: "toast",
    tone: "warn",
  },
  "casting-cost-clue-required": {
    message: "Syarat petunjuk belum terpenuhi untuk memainkan kartu ini.",
    placement: "toast",
    tone: "warn",
  },
  "casting-cost-discard-unmet": {
    message: "Pilih kartu yang perlu dibuang terlebih dahulu untuk memainkan kartu ini.",
    placement: "toast",
    tone: "warn",
  },
  "casting-cost-distance-unmet": {
    message: "Syarat jarak belum terpenuhi untuk memainkan kartu ini.",
    placement: "toast",
    tone: "warn",
  },
  "blocking-curse-limit-reached": {
    message: "Batas kutukan aktif sudah tercapai. Tunggu kutukan sebelumnya selesai.",
    placement: "toast",
    tone: "warn",
  },
  "curse-not-active": {
    message: "Kutukan ini sudah berakhir atau sudah diselesaikan.",
    placement: "toast",
    tone: "info",
  },
  "curse-not-buyable": {
    message: "Kutukan ini tidak bisa ditebus dengan penalti waktu. Selesaikan tugas kutukannya.",
    placement: "toast",
    tone: "info",
  },
  "honor-task-min-duration-unmet": {
    message: "Durasi minimum tugas kutukan belum tercapai. Tunggu sebentar, lalu tekan Selesaikan Tugas lagi.",
    placement: "toast",
    tone: "warn",
  },
  "wrong-clear-method": {
    message: "Gunakan tombol penyelesaian yang sesuai dengan jenis kutukan ini.",
    placement: "toast",
    tone: "warn",
  },
  "unknown-deck-action": {
    message: "Aksi kartu tidak dikenali. Muat ulang panel lalu coba lagi.",
    placement: "toast",
    tone: "warn",
  },

  // QA controls
  "qa-deadline-changed": {
    message: "Fase permainan sudah berubah. Pilih langkah waktu QA lagi.",
    placement: "toast",
    tone: "info",
  },
  "qa-host-only": {
    message: "Hanya Host yang bisa memajukan waktu di ruang QA.",
    placement: "toast",
    tone: "info",
  },
  "qa-no-active-clock": {
    message: "Tidak ada timer aktif pada fase saat ini.",
    placement: "toast",
    tone: "info",
  },
  "qa-room-required": {
    message: "Kontrol waktu ini hanya tersedia di ruang QA.",
    placement: "toast",
    tone: "info",
  },
  "seek-qa-disabled": {
    message: "Mode ruang QA tidak aktif pada server ini.",
    placement: "inline-screen",
    tone: "info",
  },
  "seek-qa-only": {
    message: "Ruang QA hanya tersedia untuk edisi Hide & Seek.",
    placement: "inline-screen",
    tone: "info",
  },

  // Recaps
  "recap-unavailable": {
    message: "Ringkasan pertandingan ini bersifat privat atau belum tersedia di sesi perangkatmu.",
    placement: "inline-screen",
    tone: "info",
  },
  "shared-recap-unavailable": {
    message: "Ringkasan komunitas ini tidak tersedia atau sudah ditarik oleh peserta.",
    placement: "inline-screen",
    tone: "info",
  },

  // Transport, HTTP & generic fallbacks
  "network-error": {
    message: NETWORK_FALLBACK_MESSAGE,
    placement: "toast",
    tone: "warn",
    uncertain: true,
  },
  "server-error": {
    message: SERVER_FALLBACK_MESSAGE,
    placement: "toast",
    tone: "error",
    uncertain: true,
  },
  "invalid-request": {
    message: REQUEST_FALLBACK_MESSAGE,
    placement: "toast",
    tone: "warn",
  },
  "not-found": {
    message: REQUEST_FALLBACK_MESSAGE,
    placement: "toast",
    tone: "warn",
  },
  "method-not-allowed": {
    message: REQUEST_FALLBACK_MESSAGE,
    placement: "toast",
    tone: "warn",
  },
};

export function recordPlayerErrorDiagnostic(
  context: PlayerErrorContext,
  details: { code?: string; status?: number; detail?: unknown },
): void {
  if (typeof console !== "undefined" && typeof console.debug === "function") {
    console.debug("[kelana-ria:error]", {
      surface: context.surface,
      action: context.action,
      target: context.target,
      code: details.code,
      status: details.status,
      detail: details.detail instanceof Error ? details.detail.message : details.detail,
    });
  }
}

function extractRawCode(input: PlayerErrorInput): { code?: string; status?: number; detail?: unknown } {
  if (typeof input === "string") {
    return { code: input.trim() || undefined };
  }
  if (input instanceof ApiTransportError) {
    return { code: input.code, status: input.status, detail: input.detail ?? input.message };
  }
  if (input instanceof Error) {
    const tagged = input as Error & { code?: unknown; status?: unknown; causeDetail?: unknown };
    if (typeof tagged.code === "string") {
      return {
        code: tagged.code,
        status: typeof tagged.status === "number" ? tagged.status : undefined,
        detail: tagged.causeDetail ?? input.message,
      };
    }
    if (input.name === "TypeError" || /fetch|network|offline|load failed/i.test(input.message)) {
      return { code: "network-error", detail: input.message };
    }
    return { code: "server-error", detail: input.message };
  }
  if (input && typeof input === "object") {
    const obj = input as { code?: unknown; error?: unknown; status?: unknown; detail?: unknown };
    const code = typeof obj.code === "string" ? obj.code : typeof obj.error === "string" ? obj.error : undefined;
    const status = typeof obj.status === "number" ? obj.status : undefined;
    return { code, status, detail: obj.detail };
  }
  return { detail: input };
}

export function resolvePlayerError(
  input: PlayerErrorInput,
  context: PlayerErrorContext,
): PlayerErrorResolution {
  const extracted = extractRawCode(input);
  let code = extracted.code ?? "";
  const status = extracted.status;

  if ((!code || !(code in ERROR_CATALOG)) && status !== undefined && status >= 500) {
    code = "server-error";
  }

  recordPlayerErrorDiagnostic(context, { code: extracted.code ?? code, status, detail: extracted.detail });

  let entry = code ? ERROR_CATALOG[code] : undefined;

  if (!entry && code.startsWith("payment-")) {
    entry = {
      message: "Status pembayaran belum selesai. Periksa kembali atau buat pesanan baru.",
      placement: "inline-screen",
      tone: "warn",
      endedPayment: true,
    };
  }

  if (!entry) {
    const isNetwork = code === "network-error";
    const resolvedCode = isNetwork ? "network-error" : "server-error";
    const message = isNetwork ? NETWORK_FALLBACK_MESSAGE : SERVER_FALLBACK_MESSAGE;
    return {
      code: resolvedCode,
      message,
      placement: "toast",
      tone: isNetwork ? "warn" : "error",
      recoverable: true,
      uncertain: true,
      dedupeKey: `${context.surface}:${context.action ?? ""}:${resolvedCode}`,
    };
  }

  let placement = entry.placement;
  if (code === "room-not-found" && context.action === "join-room") {
    placement = "inline-field";
  } else if (code === "invalid-request" && context.action === "join-room") {
    placement = "inline-field";
  }

  return {
    code,
    message: entry.message,
    placement,
    tone: entry.tone ?? "warn",
    recoverable: entry.recoverable ?? true,
    staleTarget: entry.staleTarget,
    endedPayment: entry.endedPayment,
    uncertain: entry.uncertain,
    dedupeKey: `${context.surface}:${context.action ?? ""}:${context.target ?? ""}:${code}`,
  };
}

export async function fetchApiJson<T extends Record<string, unknown>>(
  path: string,
  options: {
    body?: unknown;
    signal?: AbortSignal;
    headers?: Record<string, string>;
    cache?: RequestCache;
  } = {},
): Promise<{ ok: boolean; status: number; data: T; headers: Headers; notModified: boolean }> {
  let response: Response;
  try {
    response = await fetch(path, {
      method: options.body === undefined ? "GET" : "POST",
      headers: {
        Accept: "application/json",
        ...(options.body === undefined ? {} : { "content-type": "application/json" }),
        ...options.headers,
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: options.signal,
      ...(options.cache ? { cache: options.cache } : {}),
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw error;
    }
    throw new ApiTransportError(
      "network-error",
      undefined,
      error instanceof Error ? error.message : String(error),
    );
  }

  if (response.status === 304) {
    return {
      ok: true,
      status: 304,
      data: {} as T,
      headers: response.headers,
      notModified: true,
    };
  }

  let parsed: unknown;
  try {
    parsed = await response.json();
  } catch (error) {
    if (response.status >= 500) {
      throw new ApiTransportError(
        "server-error",
        response.status,
        error instanceof Error ? error.message : "non-json-5xx",
      );
    }
    parsed = { error: "invalid-request" };
  }

  if (response.status >= 500) {
    const serverCode = parsed && typeof parsed === "object" && "error" in parsed && typeof (parsed as { error?: unknown }).error === "string"
      ? (parsed as { error: string }).error
      : "server-error";
    throw new ApiTransportError("server-error", response.status, serverCode);
  }

  const data = (parsed && typeof parsed === "object" ? parsed : {}) as T;
  return { ok: response.ok, status: response.status, data, headers: response.headers, notModified: false };
}
