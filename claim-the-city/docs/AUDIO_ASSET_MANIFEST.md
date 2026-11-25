# Audio Asset Manifest, Music Analysis & Preparation Report (Milestone 3.2)

> **Locked Visual Master:** `renders/KR_Campaign_MotionGraphics_V2.mp4` (`2,508 frames` · `30 fps` · `83.60s` · `1920 × 1080`) — untouched.
> **License Records:** [`../assets/audio/LICENSE_RECORDS.md`](../../assets/audio/LICENSE_RECORDS.md)
> **Git Isolation:** Raw stock audio under `assets/audio/music/` and `assets/audio/sfx/` is gitignored via `assets/audio/.gitignore` to prevent redistribution in source packages.
> **Evaluation Methodology Notice:** This remote Linux workspace does not support reliable human audio playback monitoring. **All findings below are strictly objective signal measurements** (FFmpeg `loudnorm`, `ffprobe`, PCM RMS/peak/onset/correlation, spectral band distribution, and onset-flux autocorrelation). **Subjective sound quality assessment** (human headphone/speaker auditioning of musical feel, tonal taste, and individual SFX timbre) remains required before locking Milestone 3.3 final mix.

---

## 1. Acquired Audio Asset Inventory & Verification

All **11 downloaded originals** (`1` primary music track + `10` lean tactile SFX) were acquired directly from official Mixkit URLs on `2026-11-25`, verified valid and 100% decodable via `ffprobe` and full FFmpeg decode passes, and preserved untouched. Because the locked campaign footage and Remotion render pipeline operate at **`48,000 Hz`** while all 11 Mixkit downloads are native **`44,100 Hz`**, clean zero-processing **`48 kHz / 24-bit` stereo PCM WAV working copies** were prepared inside `music/working/` and `sfx/working/`.

> **Format Fidelity Note:** Converting `KR_BGM_ClaimTheCity_Main.mp3` (`256 kb/s` MP3) to `KR_BGM_ClaimTheCity_Main_48k.wav` does **not** improve source audio quality or recover lossy compression detail. It provides sample-rate alignment (`48 kHz`) and deterministic, frame-accurate uncompressed seeking for Milestone 3.3 editing without repeated lossy decode drift. No EQ, compression, trimming, or loudness processing was applied.

### 1.1 Primary Music Track (`1` Asset)

| Asset Role | Local Path (Original / 48 kHz Working Copy) | Mixkit Title & ID | Original Specs | 48 kHz Working Specs | Duration | Loudness / True Peak | Decode Valid |
| --- | --- | --- | --- | --- | ---: | --- | --- |
| **Primary Soundtrack** | `assets/audio/music/KR_BGM_ClaimTheCity_Main.mp3`<br>`assets/audio/music/working/KR_BGM_ClaimTheCity_Main_48k.wav` | `Funky Triplets` by Michael Ramir C. (`#1141`) | `MP3` · `44.1 kHz` · `2 ch` · `256 kb/s` (`3.47 MB`) | `pcm_s24le` · `48 kHz` · `2 ch` · `24-bit` (`31.24 MB`) | **`108.513s`** (`1:48.51`; `108.481s` PCM) | **`-15.13 LUFS`** / **`-3.87 dBTP`** (`LRA 6.00 LU`) | Pass |

### 1.2 Lean Tactile Sound Effects Kit (`10` Assets)

| Local Filename (`assets/audio/sfx/`) | Working Copy (`sfx/working/`) | Mixkit Title (`#ID`) | Original PCM Specs | Duration | Onset / Peak / Active | LUFS / True Peak | Spectral Profile (Lo `<300` / Mid `0.3–2.5k` / Hi `>2.5k`) | Campaign Cue Mapping (`2,508f`) |
| --- | --- | --- | --- | ---: | --- | --- | --- | --- |
| `sfx_paper_wipe.wav` | `sfx_paper_wipe_48k.wav` | `Big paper page turn` (`#1105`) | `16-bit 44.1kHz 2ch` (`147 KB`) | `0.831s` | `60 ms` / `324 ms` / `627 ms` | `-21.85` / `-4.94` | `2.0%` / **`77.8%`** / `20.2%` (`cent 1606 Hz`) | `S02→S03` paper wipe (`f233`), + territory flip Layer 1 (`f1718`) |
| `sfx_paper_slide_soft.wav` | `sfx_paper_slide_soft_48k.wav` | `Paper slide` (`#1530`) | `16-bit 44.1kHz 2ch` (`193 KB`) | `1.094s` | `47 ms` / `357 ms` / `368 ms` | `-24.47` / `-0.59` | `24.7%` / **`58.9%`** / `16.4%` (`cent 1710 Hz`) | Bundaran HI snapshot (`f984`), Sarinah ticket (`f1381`), optional montage settles (`f2268–f2316`) |
| `sfx_stamp_claim.wav` | `sfx_stamp_claim_48k.wav` | `Wood hard hit` (`#2182`) | `16-bit 44.1kHz 2ch` (`75 KB`) | `0.417s` | `55 ms` / `57 ms` / `144 ms` | `-20.15` / `-1.93` | `19.7%` / **`78.2%`** / `2.1%` (`dom 431 Hz`) | Recurring landmark stamps: GBK (`f889`), Bundaran HI (`f1048`), `BELUM DIKLAIM` (`f1410`), Sarinah (`f1579`) |
| `sfx_tactile_ping.wav` | `sfx_tactile_ping_48k.wav` | `Page forward single chime` (`#1107`) | `16-bit 44.1kHz 2ch` (`298 KB`) | `1.689s` | `87 ms` / `312 ms` / `660 ms` | `-15.87` / `-5.00` | `1.3%` / **`94.0%`** / `4.7%` (`430–882 Hz`) | GBK check-in (`f708`), Sarinah opportunity pre-lap (`f1378`), Bundaran HI verification (`f1022`) |
| `sfx_wrong_thud.wav` | `sfx_wrong_thud_48k.wav` | `Negative tone interface tap` (`#2569`) | `16-bit 44.1kHz 2ch` (`222 KB`) | `1.255s` | `0 ms` / `60 ms` / `176 ms` | `-20.78` / `-3.09` | **`79.2%`** / `20.4%` / `0.4%` (`cent 278 Hz`) | Yellow Team `JAWABAN SALAH` (`f1295`) — restrained muted low tap |
| `sfx_card_deal.wav` | `sfx_card_deal_48k.wav` | `Poker card flick` (`#2002`) | `16-bit 44.1kHz 2ch` (`240 KB`) | `1.336s` | `53 ms` / `196 ms` / `211 ms` | `-32.13` / `-4.58` | `8.9%` / **`77.5%`** / `13.6%` (`cent 1280 Hz`) | `CLAIM THE CITY` banner (`f249`), `POIN GANDA` reveal (`f1483`) & play (`f1608`), + activation Layer 1 (`f1622`) |
| `sfx_poin_ganda_activate.wav` | `sfx_poin_ganda_activate_48k.wav` | `Tile game reveal` (`#960`) | `16-bit 44.1kHz 2ch` (`383 KB`) | `2.171s` | `17 ms` / `145 ms` / `922 ms` | `-17.08` / `-2.00` | `36.0%` / **`63.3%`** / `0.7%` (`215→775→1055 Hz`) | Warm ascending tonal layer for `POIN GANDA` activation composite (`f1622`) + territory bloom Layer 2 (`f1718`) |
| `sfx_score_flip.wav` | `sfx_score_flip_48k.wav` | `Gear fast lock tap` (`#2857`) | `16-bit 44.1kHz 2ch` (`201 KB`) | `1.138s` | `12 ms` / `96 ms` / `150 ms` | `-23.33` / `-0.91` | `0.4%` / **`91.0%`** / `8.6%` (`cent 1922 Hz`) | Scoreboard updates (`f1111`, `f1678`) + mechanical confirmation Layer 2 of `POIN GANDA` (`f1622`) |
| `sfx_timer_sweep.wav` | `sfx_timer_sweep_48k.wav` | `Fast wall clock ticking` (`#1063`) | `24-bit 44.1kHz 2ch` (`657 KB`) | `2.481s` | `100 ms` / `2193 ms` / `2152 ms` | `-19.14` / `-1.63` | `3.2%` / **`85.2%`** / `11.6%` (`8` ticks @ `0.30s`) | Accelerated match clock `102:00 → 00:00` (`f1792–f1844`, `1.73s`) |
| `sfx_round_bell.wav` | `sfx_round_bell_48k.wav` | `Service bell` (`#931`) | `16-bit 44.1kHz 2ch` (`208 KB`) | `1.179s` | `13 ms` / `37 ms` / `311 ms` | `-16.71` / `-0.51` | `4.3%` / `26.4%` / `69.3%` (`cent 4506 Hz`) | Match expiry `00:00 · WAKTU RONDE HABIS` (`f1844`) ringing into `GREEN TEAM MENANG` (`f1847`) |

*(Preserved Native Footage Sounds — ZERO Redundant Downloads: Bundaran HI phone shutter at `f983–f985`, warung selfie double shutter + `1.40s` L-cut laughter at `f2244–f2286`, and warung ambience J-cut at `f1910–f1928` remain untouched in original footage.)*

---

## 2. Objective Music Analysis — `Funky Triplets` (`KR_BGM_ClaimTheCity_Main.mp3`)

### 2.1 Technical & Spectral Characteristics
- **Actual Duration:** **`108.513s`** (`01:48.51` container; `0.025s` MP3 encoder delay; `108.481s` decoded PCM; active audio ends cleanly at **`107.00s`**, followed by `1.48s` trailing digital silence).
- **Sample Rate & Channels:** `44,100 Hz`, `2 ch` stereo (`256 kb/s` MP3).
- **Loudness & Headroom:** Integrated **`-15.13 LUFS`**, True Peak **`-3.87 dBTP`**, Loudness Range **`6.00 LU`**, program RMS `-17.17 dBFS`. Generous `3.87 dB` true-peak headroom — cleanly mastered without brickwall distortion.
- **Stereo Width (`L/R` Correlation):** **`+0.914`** (Mid RMS `-17.36 dB`, Side RMS `-30.82 dB`, Side-to-Mid `-13.46 dB`). **Important Milestone 3.3 Mixing Insight:** Because the rhythm section sits relatively centered (`+0.914`) AND carries substantial low-end energy (**`70–83%` of total energy sits `< 200 Hz`** during full groove), Milestone 3.3 should apply clean `80–100 Hz` HPF on rumbly dialogue (`S02_SH01`, `S04_SH03`) and subtle `1.2–3.2 kHz` dialogue-presence carving + careful level ducking on the music bus whenever dialogue speaks.
- **Estimated Tempo (Verified Beat Grid — NOT Assumed):**
  - Onset-flux autocorrelation peaks sharply at **`~99.4–100.0 BPM`** (verified across full `44-bar` grid: Bar 2 downbeat = **`4.805s`**, Bar 24 re-entry = **`57.60s`**, Bar 34 re-entry = **`81.605s`**, Bar 44 final button = **`105.60s`** → **`2.400s` per 4/4 bar = `100.00 BPM`**), with strong **triplet-subdivision harmonics** at `~66.7 BPM` (`2/3×`) and `~133.3 BPM` (`4/3×`), matching the track's title (*Funky Triplets*).
  - **Comparison vs. Original Preference (`105–115 BPM`):** At **`100.0 BPM`**, the track sits ~5 BPM more relaxed than the original `105–115 BPM` target. Objectively, its crisp triplet subdivision and relaxed-positive Mixkit tagging (`Contemporary R&B / Funk / Relaxed / Positive / Bass / Drums / Melodic / Lifestyle`) suit a conversational `83.6s` narrative film well without rushing Jakarta Indonesian dialogue.

### 2.2 Verified Musical Structure & Exact Bar-Aligned Edit Points (`2.400s` / Bar @ `100 BPM`)

| Track Window | Bars (`4/4`) | RMS / Spectral Balance | Objective Section Character | Campaign Editing Utility (For Milestone 3.3) |
| --- | --- | --- | --- | --- |
| **`0:00.00 – 0:04.80`** | `Bars 0–2` (`4.80s`) | `-26.2 to -27.6 dB` · `Lo 1.6% / Mid 74% / Hi 24%` | **Sparse Intro (zero bass/kick):** Light mid-high melodic/percussive pulse setting the triplet feel. | Ideal `1–2 beat` pickup (`0:04.20–0:04.80`) on `S02` paper wipe (`00:07.77`) OR gentle `2-bar` intro if desired. |
| **`0:04.80 – 0:52.80`** | `Bars 2–22` (`48.00s`) | `-16.0 to -18.6 dB` · `Lo 70–81% / Mid 17–26%` | **Main Groove A (full bass + syncopated drums):** Consistent funky bounce with gentle phrase lifts at `0:14–0:20` (`-16.0 dB`) and `0:36–0:40` (`-16.4 dB`). | Maps straight across **`S03` reveal (`00:08.10`) → `S04` transit → `S05` GBK → `S06` Yellow lead** (`35.1s` span = `~14.6` bars; plenty of clean 4-bar cut options). |
| **`0:52.80 – 0:57.60`** | `Bars 22–24` (`4.80s`) | `-28.0 dB` (`0:54–0:56`) · `Lo 4.0% / Mid 81.6%` | **Natural Breakdown #1:** Bass & drums drop out cleanly (`0:54–0:56`), light percussion pickup (`0:56.7–0:57.5`), full groove slams back in at **`0:57.60`**. | **Ready-made drop & comeback launch!** Align `0:54.0` drop onto `S07_SH01` `JAWABAN SALAH` (`00:43.17`) and `0:57.60` re-entry onto `S07_SH02` opportunity (`00:46.03`) or `Gas!` (`00:50.93`)! |
| **`0:57.60 – 1:16.80`** | `Bars 24–32` (`19.20s`) | `-16.5 to -18.2 dB` · `Lo 66–75% / Mid 21–31%` | **Main Groove B (richer mid-band melody):** Slightly fuller upper-mid harmonic presence (`Mid 23–35%`, `Hi 5–8%`) than Groove A. | Drives **`S07_SH02` comeback & `S07_SH04` Sarinah + Poin Ganda activation** smoothly into the climax! |
| **`1:16.80 – 1:21.60`** | `Bars 32–34` (`4.80s`) | **`-28.5 to -33.2 dB`** · **`Lo 0.0% / Mid 97.1%`** | **Natural Breakdown #2 (pure melodic/chordal pocket):** Double accent at `1:16.8/1:17.1`, then **ZERO drums and ZERO sub-bass** (`1:17.3–1:21.5`), followed by full groove return at **`1:21.60`**. | **Built-in warung reunion bed!** Cleanly loops/extends (`2–3×` on exact bar boundaries) beneath `S08_SH01`–`S08_SH02_V2` (`01:04.13–01:14.80`) with zero competitive percussion! |
| **`1:21.60 – 1:45.60`** | `Bars 34–44` (`24.00s`) | **`-15.0 to -16.6 dB`** · `Lo 68–84% / Hi 5–10%` | **Peak Final Chorus (loudest, brightest groove):** `+1.5 to +2.0 dB` fuller energy and brightest harmonic lift (`Hi` up to `9.8%`). | Feeds BOTH **`INT_MATCH_CONCLUSION` peak (`00:57.13–01:03.50`)** AND the **Weekend Memories montage bloom (`01:16.00–01:19.60`)** straight into the final button! |
| **`1:45.60 – 1:47.00`** | `Bar 44` (`1.40s` tail) | `-10.3 dB` hit (`1:45.60`) → `-40 dB` (`1:46.30`) → `-120 dB` (`1:47.10`) | **Clean Native Musical Button Ending:** Crisp final downbeat hit on `1:45.60` with natural `~1.35s` ring-out & final subtle release click at `1:46.7–1:46.9`, hitting digital silence at `1:47.10`. | **Resolves `S09_BRAND` naturally!** Align `1:45.60` button right onto `Mainkan kotamu.` (`01:20.60`) / `SEGERA HADIR` (`01:21.13`), decaying naturally to silence well before `01:23.60`! |

### 2.3 Verdict: Can `Funky Triplets` Support the Locked `83.60s` Film?
**Yes — objectively strong structural fit.** Its `108.51s` runtime exceeds the `75.73s` music window (`00:07.77–01:23.50`) by `32.8s`, and its exact `2.400s` (`100.0 BPM`) bar grid provides **all 5 structural ingredients needed without synthetic looping or stem hacks**: (1) sparse zero-bass intro, (2) driving funky groove, (3) two built-in zero-drum breakdowns for `S07_SH01` failure and `S08` warung reunion, (4) a brighter `+1.5 dB` final chorus for victory and montage bloom, and (5) a crisp standalone button ending for `Kelana Ria — Mainkan kotamu.`.

---

## 3. Custom Composite Sound-Design Blueprints (For Milestone 3.3 Mixing)

To preserve a cohesive physical board-game vocabulary using the lean `10-SFX` kit (zero extra assets needed):

1. **Signature `POIN GANDA` Activation (`00:54.07` / `f1622`, `S07_SH04` Beat 2):**
   - **Layer 1 (`+0 ms` / `f1622`):** `sfx_card_deal_48k.wav` (`#2002 Poker card flick`, onset-aligned at `53 ms`, `-4 dB` trim) — physical card snap.
   - **Layer 2 (`+30 ms` / `f1623`):** `sfx_score_flip_48k.wav` (`#2857 Gear fast lock tap`, `-5 dB` trim) — crisp mechanical confirmation lock.
   - **Layer 3 (`+40 ms` / `f1623`):** `sfx_poin_ganda_activate_48k.wav` (`#960 Tile game reveal`, `0 dB` lead, soft fade-out at `0.95s`) — warm organic wooden/ascending tonal flourish (`215→775→1055 Hz`).
2. **Sudirman–Thamrin Territory Transformation (`00:57.27` / `f1718`, `INT_MATCH_CONCLUSION` Ph. 1):**
   - **Layer 1 (`+0 ms` / `f1718`):** `sfx_paper_wipe_48k.wav` (`#1105 Big paper page turn`) — crisp physical map unfold/snap.
   - **Layer 2 (`+80 ms` / `f1720`):** `sfx_poin_ganda_activate_48k.wav` (`#960` warm tonal tail, `-4 dB`, slight gentle low-pass warmth) — resonant board-capture bloom radiating from the Sarinah `×2` pin.
3. **Bundaran HI Photo Verification (`00:34.07` / `f1022`, `S06_SH01` Stage 2):**
   - Use `sfx_tactile_ping_48k.wav` (`#1107 Page forward single chime`) gently tucked (`-16 dB`), optionally slightly brighter (`+2 semitones` / `playbackRate ≈ 1.12`) than `S05_SH01` check-in (`f708`) so viewers intuitively distinguish check-in vs. verified confirmation while keeping a unified tonal palette.
4. **Accelerated Match Clock (`00:59.73–01:01.47` / `f1792–f1844`, `1.73s`):**
   - `sfx_timer_sweep_48k.wav` (`#1063 Fast wall clock ticking`) contains `8` clean alternating tick-tock pulses (`0.30s` intervals). In Milestone 3.3, slice and progressively shorten inter-tick spacing across `1.73s` to mirror `InterludePlaceholder.tsx`'s exact `Easing.inOut(Easing.cubic)` countdown curve stopping precisely on `f1844` (`01:01.47`) right as `sfx_round_bell_48k.wav` (`#931`) strikes.

---

## 4. Missing Asset Report, Subjective Ear-Check List & Remaining Blockers

### 4.1 Missing Assets
- **Essential Assets Missing:** **`0`**. All `1` approved primary music track and all `10` lean tactile SFX requested in Milestone 3.2 have been acquired, license-verified, decoded, and prepared at `48 kHz`.
- **Intentionally Omitted (Not Missing):** Replacement camera shutters (native shutters verified at `f983–f985` and `f2244–f2247`), extra Jakarta ambience loops, and optional Milestone 3.1 polish extras (wood pawn taps, marker swipes, separate brand sting — `Funky Triplets` provides its own clean button ending at `1:45.60`).

### 4.2 Mandatory Human Subjective Auditioning Checklist (Before Milestone 3.3 Final Lock)
Because this remote Linux environment cannot monitor audio playback reliably, the project owner should perform a quick 2-minute headphone check on the acquired files and flag any subjective swaps before Milestone 3.3 final mixing:
1. **`KR_BGM_ClaimTheCity_Main.mp3` (`Funky Triplets`):** Confirm the `100 BPM` triplet funk feel and melodic character match the playful Jakarta tone (and confirm Breakdown #2 `1:17–1:21` feels warm for the warung reunion).
2. **`sfx_round_bell.wav` (`#931 Service bell`):** Confirm the tabletop brass bell isn't overly bright (`cent 4506 Hz`, `0.31s` active). *Pre-vetted warmer Mixkit backup if desired:* `#3109 Relaxing bell chime` (`https://mixkit.co/free-sound-effects/bell/`, `0.92s` warm sustain, `cent 3556 Hz`).
3. **`sfx_stamp_claim.wav` (`#2182 Wood hard hit`):** Confirm dry wooden impact reads cleanly like a physical rubber stamp. *Pre-vetted Mixkit backup:* `#558 Tribal dry drum` (`https://mixkit.co/free-sound-effects/tap/`).
4. **`sfx_wrong_thud.wav` (`#2569 Negative tone interface tap`):** Confirm the low muted drum tap (`cent 278 Hz`) feels tactile and non-synthetic. *Pre-vetted Mixkit backup:* `#558 Tribal dry drum` or `#2324 Negative guitar tone`.
5. **`sfx_poin_ganda_activate.wav` (`#960 Tile game reveal`):** Confirm its ascending tonal bloom (`215→775→1055 Hz`) feels organic rather than TV game-show. *Pre-vetted Mixkit backups:* `#2820 Magic marimba` (`https://mixkit.co/free-sound-effects/notification/`) or `#2319 Happy guitar chords` (`https://mixkit.co/free-sound-effects/instrument/`).

### 4.3 Technical Prep Blocker Reminder for Milestone 3.3
- **Dialogue EQ / HPF Tooling:** As noted in [`docs/AUDIO_DIRECTION.md`](./AUDIO_DIRECTION.md), Remotion's bundled FFmpeg includes `loudnorm`, `volume`, `adelay`, `atrim`, `atempo`, `apad`, and `pan`, but omits parametric EQ / `highpass` filters. During Milestone 3.3, dialogue HPF (`80–100 Hz` on `S02_SH01`/`S04_SH03`) and subtle `1.5–3 kHz` music vocal-carve EQ will either use system `ffmpeg` (installed via `apt-get` if permitted) or clean linear-phase FIR filtering in Python before final stem mixdown.
- **Original Dialogue Issues Preserved Unchanged:** Per Milestone 3.2 scope, no dialogue re-leveling, transient limiting (`-0.80 dBTP` headroom recovery), or `267 ms` cut V-dip smoothing were applied yet; all remain queued cleanly for Milestone 3.3.
