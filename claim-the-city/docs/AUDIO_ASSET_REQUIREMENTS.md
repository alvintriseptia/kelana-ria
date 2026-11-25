# Audio Asset Requirements & Shopping List — Claim the City

> **Milestone 3.1 — Audio Preparation & Asset Sourcing Specification**
> **Locked Campaign Picture:** `KelanaRia-RoughCut` (`2,508 frames` / `30 fps` / `83.60s`).
> **Companion Documents:** [`docs/AUDIO_DIRECTION.md`](./AUDIO_DIRECTION.md) · [`docs/SOUND_DESIGN_CUE_SHEET.md`](./SOUND_DESIGN_CUE_SHEET.md).
>
> **Important Sourcing Policy:** No music or third-party sound effects have been downloaded or added in Milestone 3.1. The project owner will select, license, and approve all audio assets prior to Milestone 3.2 integration. Do not introduce copyrighted material without verified commercial usage rights.

---

## 1. Recommended Target Directory & Format Standards

When approved assets are ready for Milestone 3.2, place them under the repository's existing shared `assets/` root (currently no `assets/audio/` folder exists). Because `claim-the-city/remotion.config.ts` already serves `../assets` via `Config.setPublicDir("../assets")`, Remotion will load these files deterministically with zero duplication:

```text
assets/
└── audio/
    ├── LICENSE_RECORDS.md   # Store license IDs, track/SFX sources, and YouTube Content ID clearance codes
    ├── music/
    │   └── KR_BGM_ClaimTheCity_Main.wav
    └── sfx/
        ├── sfx_paper_wipe.wav
        ├── sfx_paper_slide_soft.wav
        ├── sfx_stamp_claim.wav
        ├── ...
```

### Preferred Technical Format
- **Primary Format (Recommended):** Uncompressed **`WAV` (`48 kHz`, `24-bit` or `16-bit` PCM)** — matches the native `48 kHz` audio stream of all 17 footage clips and prevents double-lossy compression artifacts during editing and final AAC mastering.
- **Acceptable Fallback:** High-bitrate **`FLAC`** or **`MP3` (`320 kbps`, `48 kHz` or `44.1 kHz`)** only if a WAV download is unavailable.
- **Channel Layout:** **Stereo** for music and tonal/spatial SFX (`sfx_territory_flip`, `sfx_poin_ganda_activate`, `sfx_round_bell`); **Mono or Stereo** for dry point-source tactile hits (`sfx_stamp_claim`, `sfx_card_deal`, `sfx_wrong_thud`, `sfx_score_flip`, `sfx_timer_sweep`).
- **Dryness Preference:** Prefer **clean, dry, close-miked SFX** with minimal room reverb so cues sit naturally alongside outdoor Jakarta footage and paper graphics.

---

## 2. Mandatory Licensing & Commercial Rights Requirements

This promotional film is produced for **commercial/promotional distribution on the Kelana Ria website and YouTube**. Every selected music track and sound effect MUST satisfy:

1. **Commercial & Promotional Web Usage:** Explicitly permits use in a brand/product promotional film published on an official company website (`kelanaria.id`) and social/video channels (YouTube, plus optional future paid/organic social promos if the license covers online ads).
2. **YouTube Content ID Clearance:** Must include either a **royalty-free / Content-ID-cleared license certificate** or channel allowlisting (e.g., Epidemic Sound, Artlist, Musicbed, AudioJungle/Envato Standard/Broadcast, Pond5, Soundstripe, Splice/Freesound `CC0`) so the Kelana Ria YouTube upload is never muted, demonetized, or hit with third-party copyright claims.
3. **Perpetual / Worldwide Web Distribution:** Avoid time-limited subscription clauses that revoke rights to already-published videos if a subscription ends (confirm "published projects remain cleared forever").
4. **No Restrictive Non-Commercial Licenses:** Avoid `CC BY-NC` (Non-Commercial), `CC BY-ND` (No Derivatives — conflicts with editing/looping/ducking), or "personal/editorial only" audio. If using `CC BY` (Attribution) assets, confirm whether credit requirements are acceptable for a commercial film; **`CC0` or commercial royalty-free licenses are strongly preferred**.
5. **Audit Trail:** Save the license PDF/receipt, track/SFX ID, and author metadata in `assets/audio/LICENSE_RECORDS.md` before final publication.

---

## 3. Music Shopping List (1 Essential Track)

| Suggested Filename | Description | Approx. Duration | Intended Usage (`2,508f`) | Priority | Recommended Search Keywords | Preferred Format | Licensing Requirements |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **`KR_BGM_ClaimTheCity_Main.wav`** | Playful urban indie instrumental with funk & light hip-hop influences (**preferred `105–115 BPM`**, flexible). Warm bass guitar, syncopated dry drums, muted electric guitar, light percussion (shaker/woodblock/claps), playful melodic accents. **No vocals/lyrics.** Wide stereo image leaving center clear for mono dialogue. Prefer tracks with **distinct sections** (sparse intro, groove, breakdown, chorus peak, warm outro/button) or **downloadable stems** (drums/bass/melody/percussion) so one track carries all 3 acts cleanly. | **`1:30 – 2:45`** *(covers `~76s` from `00:07.77` to `01:23.50` with room to edit transitions & clean ending)* | Primary score across entire film: entry (`00:07.77`), map reveal (`00:08.10`), transit groove (`00:13.20`), GBK focus (`00:22.73`), Yellow tension (`00:35.83`), 1-bar drop (`00:43.17`), comeback build (`00:46.03–00:54.07`), peak victory (`00:57.13–01:03.50`), stripped warm reunion (`01:04.13`), montage bloom (`01:16.00`), resolving brand button (`01:20.60–01:23.50`). | **Essential** | `"playful indie funk instrumental"`, `"upbeat urban hip hop groove bass guitar"`, `"feel good funky boom bap instrumental"`, `"chill funk muted guitar playful"`, `"warm neo soul funk upbeat instrumental"`, `"city walk indie groove no vocals"` — **Exclude:** ukulele, corporate, EDM, cinematic, orchestral, trap, vocals | `48 kHz / 24-bit WAV` (stereo; + stems WAV if offered by library) | Commercial/promotional website + YouTube Content ID cleared, perpetual worldwide web rights, no NC/ND restrictions. |

*(Selection Tip: When auditioning candidate tracks, test two things quickly — (a) does the track have a sparser section or bass+guitar-only breakdown that fits the `01:04.13` warung reunion warmly without sounding sad, and (b) does it end on a clean musical chord/button rather than a generic 10-second fade-out?)*

---

## 4. Sound Effects Shopping List (Compact Reusable Kit)

Designed intentionally small (**12 essential core assets + 4 optional polish assets**, with a **10-SFX lean minimum-kit option** in Section 6) by reusing compatible physical board-game sounds consistently across matching gameplay actions.

### 4.1 Essential Tactile SFX (`12` Assets — Covers All 15 Essential Cues)

| # | Suggested Filename | Sound Description | Approx. Duration | Intended Usage (Exact Cues) | Priority | Recommended Search Keywords | Preferred Format | Licensing Requirements |
| ---: | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | **`sfx_paper_wipe.wav`** | Crisp heavyweight printed map / thick paper page-turn sweep (organic, clean, no brittle static). | `0.5 – 0.8s` | `S02→S03` paper-edge transition into illustrated Jakarta map (`00:07.77` / `f233`). | **Essential** | `"paper map unfold"`, `"thick paper page turn fast"`, `"paper wipe transition foley"`, `"heavy cardstock whoosh"` | `48 kHz / 24-bit WAV` (stereo or mono) | Commercial royalty-free / `CC0` (web + YouTube). |
| 2 | **`sfx_paper_slide_soft.wav`** | Short, gentle matte paper/ticket slide across a flat surface (subtle friction, soft attack). | `0.25 – 0.45s` | **Reused 3–5×:** `S06_SH01` Bundaran HI snapshot entry (`f984`), `S07_SH02` opportunity ticket entry (`f1381`) & optional exit (`f1455`), and optional fallback for `S08_MONTAGE` photo settles (`f2268`, `f2292`, `f2316`). | **Essential** | `"paper slip slide table"`, `"photo print slide paper"`, `"cardstock brush soft foley"`, `"ticket paper movement"` | `48 kHz / 24-bit WAV` (mono or stereo) | Commercial royalty-free / `CC0` (web + YouTube). |
| 3 | **`sfx_stamp_claim.wav`** | Confident, dry wooden rubber-stamp ink thud on paper (warm woody body, crisp tactile impact, zero metallic clang). | `0.25 – 0.45s` | **Reused 4×:** `S05_SH04` GBK claim (`00:29.63` / `f889`), `S06_SH01` Bundaran HI Yellow claim (`00:34.93` / `f1048`), `S07_SH02` `BELUM DIKLAIM` stamp (`00:47.00` / `f1410`), `S07_SH04` Sarinah claim (`00:52.63` / `f1579`). | **Essential** | `"rubber stamp ink thud paper"`, `"wooden stamp hit foley"`, `"office rubber stamp press dry"`, `"board game stamp thump"` | `48 kHz / 24-bit WAV` (mono) | Commercial royalty-free / `CC0` (web + YouTube). |
| 4 | **`sfx_tactile_ping.wav`** | Modest, warm single-note organic wood/marimba or soft bell pop — friendly and informative, **not** triumphant or sci-fi. | `0.20 – 0.40s` | **Reused 2×:** `S05_SH01` GBK check-in (`00:23.60` / `f708`, modest non-ownership check-in) & `S07_SH02` Sarinah opportunity alert (`00:45.93` / `f1378` pre-lap, slightly brightened `+1–2 st` in mix). | **Essential** | `"warm marimba single note pop"`, `"organic wood notification soft"`, `"gentle wooden chime ui"`, `"minimal tactile app ping warm"` | `48 kHz / 24-bit WAV` (mono or stereo) | Commercial royalty-free / `CC0` (web + YouTube). |
| 5 | **`sfx_verify_confirm.wav`** | Clean, friendly **two-note** ascending wooden/marimba confirmation chime (distinct from single-note check-in; never loud arcade fanfare). | `0.25 – 0.45s` | `S06_SH01` Bundaran HI photo `TERVERIFIKASI ✓` (`00:34.07` / `f1022`). | **Essential** | `"warm two note confirmation marimba"`, `"organic positive chime wooden"`, `"minimalist success ding warm"`, `"soft kalimba double note"` | `48 kHz / 24-bit WAV` (mono or stereo) | Commercial royalty-free / `CC0` (web + YouTube). |
| 6 | **`sfx_wrong_thud.wav`** | Dry, muted low woodblock or hollow cardboard drop / muted two-beat "nope" knock — grounded and lightly comedic, **never a harsh quiz-show buzzer**. | `0.25 – 0.45s` | `S07_SH01` Yellow Team `JAWABAN SALAH` (`00:43.17` / `f1295`). | **Essential** | `"muted woodblock low knock"`, `"dry wooden error tap soft"`, `"board game wrong move dull thud"`, `"hollow wood knock muted"` | `48 kHz / 24-bit WAV` (mono) | Commercial royalty-free / `CC0` (web + YouTube). |
| 7 | **`sfx_card_deal.wav`** | Crisp physical playing-card flick / thick cardstock slap placed confidently on a tabletop. | `0.25 – 0.45s` | **Reused 3×:** `S03_SH01` `CLAIM THE CITY` title plate (`00:08.30` / `f249`), `S07_SH02` `POIN GANDA` card reveal (`00:49.43` / `f1483`), `S07_SH04` `POIN GANDA` tabletop return (`00:53.60` / `f1608`). | **Essential** | `"playing card snap deal table"`, `"thick cardstock place table"`, `"card flick foley crisp"`, `"board game card slap"` | `48 kHz / 24-bit WAV` (mono) | Commercial royalty-free / `CC0` (web + YouTube). |
| 8 | **`sfx_poin_ganda_activate.wav`** | Signature tactile board-game power-up lock: crisp physical token/card snap layered with a warm acoustic/marimba/chord swell (organic, joyful, zero sci-fi laser/synth zap). | `0.6 – 1.0s` | `S07_SH04` `POIN GANDA` live activation `TERSEDIA → DIAKTIFKAN` (`BOBOT 1 → 2`, `00:54.07` / `f1622`). | **Essential** | `"warm acoustic power up chime"`, `"marimba chord swell positive"`, `"board game bonus activation wood"`, `"organic card unlock chime warm"` | `48 kHz / 24-bit WAV` (stereo) | Commercial royalty-free / `CC0` (web + YouTube). |
| 9 | **`sfx_score_flip.wav`** | Crisp mechanical split-flap board flip or wooden scoreboard tile clack (clean mid-high transient, short tail). | `0.20 – 0.40s` | **Reused 2×:** `S06_SH03_V4` Yellow `1–2` score emphasis (`00:37.03` / `f1111`) & `S07_SH04` Green `2–1` takeover emphasis (`00:55.93` / `f1678`). | **Essential** | `"split flap display flip single"`, `"mechanical scoreboard click"`, `"wooden tile flip clack"`, `"flip clock single click"` | `48 kHz / 24-bit WAV` (mono) | Commercial royalty-free / `CC0` (web + YouTube). |
| 10 | **`sfx_territory_flip.wav`** | Crisp printed-map unfold/snap blended with a warm resonant wooden/acoustic bloom (conveys physical zone capture without dark cinematic bass boom). | `0.7 – 1.2s` | `INT_MATCH_CONCLUSION` Phase 1 full-screen `KR_UI_MAP_SARINAH.png` Sudirman–Thamrin territory transformation (`00:57.27` / `f1718`). | **Essential** | `"paper map snap unfold resonant"`, `"warm acoustic whoosh bloom"`, `"board game territory capture organic"`, `"wood percussion swell positive"` | `48 kHz / 24-bit WAV` (stereo) | Commercial royalty-free / `CC0` (web + YouTube). |
| 11 | **`sfx_timer_sweep.wav`** | Tactile mechanical/wooden tabletop clock ticking that accelerates smoothly (`~1.73s` window) into a crisp stop (or a clean mechanical tick loop we can accelerate smoothly in Milestone 3.2). | `1.8 – 2.5s` *(or clean `0.15s` single tick + loop)* | `INT_MATCH_CONCLUSION` Phase 2 accelerated match clock `102:00 → 00:00` (`00:59.73–01:01.47` / `f1792–f1844`, exact `1.73s`). | **Essential** | `"mechanical clock ticking speed up"`, `"board game timer accelerating"`, `"wooden metronome tick fast"`, `"analog flip clock fast forward"` | `48 kHz / 24-bit WAV` (mono or stereo) | Commercial royalty-free / `CC0` (web + YouTube). |
| 12 | **`sfx_round_bell.wav`** | Warm, decisive brass desk bell / board-game finish chime with clean natural decay — celebratory & unmistakable, **never a harsh siren, horn, or sports buzzer**. | `1.0 – 1.8s` | `INT_MATCH_CONCLUSION` Phase 3 match expiry `00:00 · WAKTU RONDE HABIS` (`01:01.47` / `f1844`) ringing cleanly across `GREEN TEAM MENANG` (`01:01.57` / `f1847`). | **Essential** | `"warm desk bell single ding"`, `"board game finish bell brass"`, `"vintage service bell chime warm"`, `"round end gentle bell"` | `48 kHz / 24-bit WAV` (stereo) | Commercial royalty-free / `CC0` (web + YouTube). |

*(Total essential audio package: **1 primary music track + 12 reusable SFX = 13 files**, reducible to **11 files** using the lean minimum kit in Section 6.)*

### 4.2 Optional Polishing SFX (`4` Assets — Safe to Skip)

| # | Suggested Filename | Sound Description | Approx. Duration | Intended Usage (Optional Cues) | Priority | Recommended Search Keywords | Preferred Format | Licensing Requirements |
| ---: | --- | --- | --- | --- | --- | --- | --- | --- |
| 13 | **`sfx_photo_place.wav`** | Soft matte photograph print gently laid down onto paper notebook pages (warmer and softer than `sfx_card_deal`). | `0.20 – 0.35s` | `S08_MONTAGE` prints settling at `01:15.60` (`f2268`), `01:16.40` (`f2292`), `01:17.20` (`f2316`). *(Can reuse `sfx_paper_slide_soft.wav` instead.)* | **Optional** | `"photo print placed on table"`, `"polaroid paper soft tap"`, `"scrapbook photo lay down foley"` | `48 kHz / 24-bit WAV` (mono) | Commercial royalty-free / `CC0` (web + YouTube). |
| 14 | **`sfx_wood_token_tap.wav`** | Light, dry wooden board-game pawn / token click placed softly on a board. | `0.15 – 0.25s` | Optional subtle micro-accents on `S03_SH01` team tokens (`f287`), `S04` badges (`f400`, `f455`), or `S05_SH02` observation ticks (`f820`, `f844`). | **Optional** | `"wooden chess piece light tap"`, `"board game wooden token place"`, `"wood pawn click soft"` | `48 kHz / 24-bit WAV` (mono) | Commercial royalty-free / `CC0` (web + YouTube). |
| 15 | **`sfx_marker_swipe.wav`** | Subtle dry felt highlighter marker stroke across paper. | `0.25 – 0.40s` | Optional subtle accent on `S07_SH02` `POIN GANDA` yellow swipe (`f1503`) and/or `S09_BRAND` `Mainkan kotamu.` swipe (`f2418`). | **Optional** | `"highlighter marker stroke paper"`, `"felt tip pen underline foley"`, `"marker swipe short dry"` | `48 kHz / 24-bit WAV` (mono) | Commercial royalty-free / `CC0` (web + YouTube). |
| 16 | **`sfx_brand_sting.wav`** | Warm, playful 1.5–2s acoustic/plucked melodic cadence ending cleanly on a resolving chord. | `1.5 – 2.5s` | **Fallback only** for `S09_BRAND` (`01:19.73–01:21.67` / `f2392–f2450`) if the chosen primary music track lacks a clean standalone ending button. | **Optional** | `"warm acoustic logo sting playful"`, `"indie guitar short brand resolve"`, `"marimba acoustic outro chime"` | `48 kHz / 24-bit WAV` (stereo) | Commercial royalty-free + YouTube Content ID cleared. |

---

## 5. Assets Explicitly NOT Required (Already Verified in Source Footage)

Do **not** purchase or download replacements for the following — they already exist naturally in the approved source footage:

- **Selfie Camera Shutter (`01:14.80` / `f2244`, `S08_SH02_V2`):** Authentic compact-camera double mechanical shutter already synced to the white flash (`+29.6 dB` HF spike) and followed by genuine group laughter.
- **Bundaran HI Camera Shutter (`00:32.76–00:32.84` / `f983–f985`, `S06_SH01`):** Authentic phone camera shutter already synced within 1 frame of the photo proof card (`+21.9 dB` HF spike).
- **Warung Ambience (`01:03.67` / `f1910`, `S08_SH01` J-cut):** Already extracted cleanly from `KR_SH08_SH02.mp4` (`0.05–0.65s`).
- **Extra Ambient Soundscapes / Crowd Loops:** The 17 Raw Jakarta clips already supply authentic Jakarta cafe, street, TransJakarta, MRT, GBK, Terowongan Kendal, Sarinah, and warung room tone.

---

## 6. Lean Minimum-Kit Option (If Optimizing Sourcing Time)

If production time is tight, the owner can launch Milestone 3.2 with just **11 total files** (1 music track + 10 essential SFX) without compromising storytelling clarity:
1. `KR_BGM_ClaimTheCity_Main.wav`
2. `sfx_paper_wipe.wav`
3. `sfx_paper_slide_soft.wav` *(also covers montage photo settles)*
4. `sfx_stamp_claim.wav` *(reused across all 4 stamp cues)*
5. `sfx_tactile_ping.wav` *(reused for check-in, opportunity alert, and pitched double-tap verification if `sfx_verify_confirm` is omitted)*
6. `sfx_wrong_thud.wav`
7. `sfx_card_deal.wav` *(reused across title plate + both Poin Ganda entries)*
8. `sfx_poin_ganda_activate.wav` *(also layered with `sfx_paper_wipe` if `sfx_territory_flip` is omitted)*
9. `sfx_score_flip.wav` *(reused for both scoreboard shifts)*
10. `sfx_timer_sweep.wav`
11. `sfx_round_bell.wav`
