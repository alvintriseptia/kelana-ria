# Audio Direction & Technical Audio Audit — Claim the City (`83.60s` / `2,508f`)

> **Milestone 3.1 — Audio Direction, Technical Audit & Music Spotting**
> **Locked Master Picture:** `renders/KR_Campaign_MotionGraphics_V2.mp4` (**Approved**, locked at **`2,508 frames`**, **`30 fps`**, **`83.60s`**, `1920 × 1080`).
> **Scope:** Audio preparation, objective signal audit, music direction, and music spotting only. No visual timing, footage trims, motion graphics, or audio mix files are modified in this milestone.

---

## 1. Sonic Philosophy — Urban Playfulness in Sound

The audio identity mirrors the campaign's three approved visual pillars (**Raw Jakarta**, **Jakarta Playground**, **Weekend Memories**) without turning the film into a generic tech ad or noisy arcade montage:

1. **Dialogue & Human Chemistry Lead Always:** Arga, Naya, Bima, and Sari's casual Jakarta Indonesian banter, laughter, and ambient street presence are the emotional spine of the film. Music and SFX frame their reactions — never compete with them.
2. **Playful Competition, Zero Aggression:** *Claim the City* is friends turning familiar Jakarta streets into a shared board game. Competition should feel energetic, clever, and rhythmic — never hostile, cinematic-thriller dark, or e-sports intense.
3. **Tactile & Physical Over Futuristic UI:** Every graphic sound should evoke physical tabletop materials — printed paper maps, thick cardstock, dry rubber-stamp ink, wooden tokens, mechanical split-flaps, and warm desk bells — avoiding glossy sci-fi whooshes, laser pings, or arcade buzzers.
4. **Restraint Creates Impact:** Silence, brief musical drops, and raw Jakarta ambience make the game reveal (`00:08.10`), the Sarinah comeback (`00:46.03–00:57.13`), and the warung reunion (`01:04.13`) land emotionally. Not every visual transition or graphic requires a musical hit or sound effect.

---

## 2. Music Direction & Track Selection Brief

### Primary Musical Style
- **Genre:** Playful urban indie instrumental with funk and light hip-hop influences (think warm groove-driven indie-funk / crisp lofi-adjacent boom-bap bounce with acoustic warmth — energetic, modern, and human).
- **Suggested Tempo Range:** **`105–115 BPM`** *(selection preference, not a rigid lock — tracks between ~100–120 BPM with a lively half-time/pocket feel can also work cleanly)*.
- **Track Structure Preference:** **One primary music track** capable of carrying the film's full 3-act emotional arc (`~76 seconds` of musical coverage from `00:07.77` to `01:23.50`). Prefer a source track of **at least `1:30–2:30`** with distinct arrangement sections (sparse intro, main rhythmic groove, stripped-back breakdown/bridge, energetic chorus/lift, warm resolving outro) — or stem splits (drums / bass / guitars-keys / percussion) so Milestone 3.2 can shape intensity cleanly without harsh volume pumping.

### Desired Instrumentation
- **Warm bass guitar** (round, melodic pocket anchoring the groove without sub-bass mud below 50 Hz).
- **Syncopated drums** (tight dry snare/rimshot, crisp organic hi-hat, playful kick bounce — never stadium-rock or club-EDM heavy).
- **Muted electric guitar** (funky percussive chord stabs / palm-muted rhythm sitting cleanly in the stereo sides).
- **Light percussion** (shaker, tambourine, woodblock, hand claps, or congas adding sunlit urban momentum).
- **Playful melodic accents** (short Rhodes/Wurlitzer, marimba, clavinet, or plucked guitar motifs that leave the `800 Hz–3.5 kHz` vocal center open).

### Desired Emotional Characteristics
- Playful, adventurous, youthful, warm, competitive without aggression, and grounded/authentic rather than overly cinematic.

### Explicitly Avoid
- Corporate ukulele / whistle / handclap "startup explainer" music.
- Aggressive EDM, dubstep risers, trap hi-hat barrages, or harsh synth drops.
- Epic orchestral trailer brass, braaams, or dramatic cinematic percussion.
- Excessive sentimentality, melodramatic piano ballads, or tearjerker strings during the ending.
- Prominent vocals, sung lyrics, or vocal chops that fight Indonesian dialogue intelligibility.

### Stereo Separation Advantage (Critical Technical Note)
Objective correlation analysis confirmed all 17 source footage clips are **dual-mono (`L === R`, correlation `+1.000`)**. Selecting a music track with **natural stereo width** (guitars, keys, and light percussion spread left/right; kick/bass centered) allows dialogue to sit cleanly in the center pocket with far less masking and lighter ducking.

---

## 3. Independent Technical Audio Audit (`KR_Campaign_MotionGraphics_V2.mp4`)

> **Methodology & Transparency Notice:** This remote Linux workspace does not support reliable human audio playback monitoring. **No subjective listening is claimed.** All findings below were measured objectively using Remotion's bundled FFmpeg (`loudnorm` EBU R128, `silencedetect`), `ffprobe`, and sample-accurate 48 kHz / 16 kHz PCM analysis (`RMS`, true/sample peak, L/R correlation, 10th/95th percentile noise-floor/speech SNR, 80 ms boundary dip checks, and 256/512-point FFT spectral & transient detection), cross-referenced against the locked dialogue notes in [`src/config/timeline.ts`](../src/config/timeline.ts). Specific items requiring a quick human ear verification are explicitly flagged in Section 6.

### 3.1 Master Stream & Loudness Verification
Independent FFmpeg `loudnorm` and PCM audit of `renders/KR_Campaign_MotionGraphics_V2.mp4`:

| Metric | Independently Measured Value | Notes |
| --- | --- | --- |
| Container / Stream | `AAC (LC)` · `48,000 Hz` · `2 ch (stereo)` · `125.4 kb/s` | Matches all 17 source clips (`48 kHz` AAC). |
| Total Duration | `83.605s` audio (`83.600s` / `2,508f` video @ `30 fps`) | Exact locked runtime. |
| **Integrated Loudness** | **`-16.70 LUFS`** | Independently confirms owner's `~-16.7 LUFS` figure. |
| **True Peak** | **`-0.80 dBTP`** | Independently confirms owner's `~-0.8 dBTP` figure; occurs at **`00:52.86` (`f1586`, `S07_SH04`)**. |
| Loudness Range (`LRA`) | **`6.60 LU`** | Moderate overall, but masks an **`8.02 LU`** clip-to-clip live-action spread. |
| Program RMS / Crest Factor | `-21.21 dBFS` / `20.41 dB` | High transient peaks relative to dialogue body. |
| Hard Clipped Samples | `0` (`0 / 4,013,040` frames) | Raw `S04_SH02` exceeded 0 dBTP (`+0.09 dBTP`), currently tamed to `-1.09 dBTP` by `vol=0.88`. |
| Stereo Correlation (`L/R`) | **`+1.000`** (`L === R` identically across all 17 clips) | Dual-mono source recordings inside stereo containers. |
| **Available Mixing Headroom** | **`0.20 dB`** to `-1.0 dBTP` (**insufficient**) | **Critical:** Dialogue peaks hit `-0.80 dBTP`, leaving virtually zero summing headroom for music/SFX without pre-trimming or peak control. |

### 3.2 Complete Per-Segment Loudness, Gain, Floor, SNR & Spectral Audit (`2,508f`)

| Segment | Frames (`30 fps`) | Time Window | Current Gain (`timeline.ts`) | Raw Trim LUFS / TP | V2 Master LUFS / TP | Noise Floor (p10) | Speech Peak (p95) | Est. SNR | Low `<180 Hz` / Speech `0.5–3.2 kHz` | Key Dialogue & Audio Notes |
| --- | --- | --- | ---: | --- | --- | ---: | ---: | ---: | --- | --- |
| `S01_SH01` | `f0–f147` | `00:00.00–00:04.90` | `1.20` (`+1.58 dB`) | `-24.21` / `-8.37` | **`-22.68`** / `-6.82` | `-33.0 dB` | `-20.7 dB` | `12.3 dB` | `12.8%` / `56.5%` | **Quietest clip.** Naya *"Abis ini ke mana?"*, Bima *"Ya... ke mana lagi?"*. Cafe ambience sits high relative to soft dialogue; `+3.5–4.5 dB` lift headroom available. |
| `S02_SH01` | `f147–f243` | `00:04.90–00:08.10` | `0.92` (`-0.72 dB`) | `-15.63` / `-0.90` | `-16.42` / **`-1.65`** | **`-26.7 dB`** | `-13.3 dB` | `13.4 dB` | **`23.9%`** / `58.1%` | Arga *"Eh, lihat deh."*, Naya *"Apaan?"*. **Highest ambient floor & low-end rumble (`23.9% < 180 Hz`)**; `+6.3 dB` ambient jump from `S01_SH01`. |
| `S03_SH01` | `f243–f396` | `00:08.10–00:13.20` | `1.05` (`+0.42 dB`) | `-18.92` / `-4.01` | `-18.54` / `-3.64` | `-47.2 dB` | `-15.8 dB` | `31.4 dB` | `5.3%` / `40.6%` | Bima & Arga rule exchange over map. Very clean low floor (`-20.5 dB` drop from `S02`). No existing paper SFX detected. |
| `S04_SH01` | `f396–f451` | `00:13.20–00:15.03` | `0.95` (`-0.45 dB`) | `-14.77` / `-2.19` | `-15.25` / `-2.66` | `-35.3 dB` | `-13.7 dB` | `21.7 dB` | `17.9%` / `30.5%` | Arga *"Yang deket dulu aja ya?"*, Naya *"Boleh."* Street ambience jumps `+11.9 dB` from `S03`. |
| `S04_SH02` | `f451–f528` | `00:15.03–00:17.60` | `0.88` (`-1.11 dB`) | `-13.98` / **`+0.09`** | `-15.12` / **`-1.09`** | `-34.0 dB` | `-12.5 dB` | `21.5 dB` | `4.5%` / `21.2%` | Sari & Bima (*"Udah, ikut gua aja."*). Raw source had `+0.09 dBTP` inter-sample peak; dense `180–500 Hz` low-mid (`74.1%`). |
| `S04_SH03` | `f528–f572` | `00:17.60–00:19.07` | `0.95` (`-0.45 dB`) | `-20.67` / `-2.29` | **`-21.18`** / `-2.75` | `-31.2 dB` | `-18.8 dB` | **`12.4 dB`** | **`21.9%`** / `55.9%` | **Intelligibility risk.** Arga *"Oke, gas."* drops `-6.1 LU` from `S04_SH02` under TransJakarta bus engine rumble (`21.9% < 180 Hz`). Needs HPF + `+3 dB` lift. |
| `S04_SH04` | `f572–f682` | `00:19.07–00:22.73` | `0.92` (`-0.72 dB`) | `-14.94` / `-2.81` | `-15.71` / `-3.55` | `-34.4 dB` | `-14.1 dB` | `20.3 dB` | `2.9%` / `35.3%` | Sari & Bima inside MRT. Jumps `+5.5 LU` from `S04_SH03`. No clear shutter spike detected in `00:20.80–00:21.50` pause (ear-check needed). |
| `S05_SH01` | `f682–f802` | `00:22.73–00:26.73` | `1.08` (`+0.67 dB`) | `-18.20` / `-2.94` | `-17.56` / `-2.28` | `-47.9 dB` | `-16.7 dB` | `31.1 dB` | `2.8%` / `68.8%` | Arga check-in + `1.5s` dead-quiet phone pocket (`00:24.25–00:25.70`, `-47.5 dB`) + Naya *"Challenge-nya apaan?"*. No existing check-in chime. |
| `S05_SH02` | `f802–f877` | `00:26.73–00:29.23` | `1.18` (`+1.44 dB`) | `-22.18` / `-11.17` | **`-20.73`** / `-9.71` | `-42.0 dB` | `-22.0 dB` | `20.0 dB` | `2.3%` / `71.0%` | **Quiet clip.** Naya *"Abis ini lewat sini aja."* + walk. Clean, `9.7 dB` peak headroom — safe to lift `+3.5–4.5 dB`. |
| `S05_SH04` | `f877–f940` | `00:29.23–00:31.33` | `1.14` (`+1.14 dB`) | `-21.14` / `-8.24` | **`-20.04`** / `-7.14` | `-44.0 dB` | `-19.7 dB` | `24.3 dB` | `0.9%` / `76.0%` | **Quiet clip.** Naya *"Nah, dapet!"*. Clean voice band, `7.1 dB` peak headroom — safe to lift `+3.0–3.5 dB`. |
| `S06_SH01` | `f940–f1075` | `00:31.33–00:35.83` | `0.94` (`-0.54 dB`) | `-15.43` / `-2.13` | `-15.98` / `-2.67` | `-40.4 dB` | `-15.4 dB` | `25.0 dB` | `7.3%` / `29.8%` | Bima & Sari Bundaran HI photo. **Existing camera shutter verified at `00:32.76–00:32.84` (`f983–f985`, `pk -6.4 dB`, HF `+21.9 dB`).** |
| `S06_SH03_V4` | `f1075–f1249` | `00:35.83–00:41.63` | `0.84` (`-1.51 dB`) | `-13.17` / `-1.21` | **`-14.70`** / `-2.78` | `-37.0 dB` | `-11.9 dB` | `25.1 dB` | `1.0%` / `51.5%` | **Loudest clip.** Rapid 3-line dialogue at Terowongan Kendal; slightly warm/boxy tunnel `180–500 Hz` (`47.0%`). |
| `S07_SH01` | `f1249–f1369` | `00:41.63–00:45.63` | `0.95` (`-0.45 dB`) | `-15.60` / `-2.26` | `-16.08` / `-2.73` | `-40.2 dB` | `-14.7 dB` | `25.5 dB` | `0.3%` / `60.7%` | Sari & Bima (*"Yah, salah!"*) + `1.2s` quiet exasperation (`00:44.50–00:45.55`, `-40 dB`). No existing wrong-answer sound. |
| `S07_SH02` | `f1369–f1564` | `00:45.63–00:52.13` | `0.88` (`-1.11 dB`) | `-14.58` / `-0.28` | `-15.60` / **`-1.36`** | `-35.5 dB` | `-13.8 dB` | `21.7 dB` | `2.7%` / `55.6%` | Fast 4-line comeback dialogue. Peak `-1.36 dBTP` on *"Bentar!"* (`00:46.20`). No existing phone notification ping in `00:45.63–00:46.00`. |
| `S07_SH04` | `f1564–f1714` | `00:52.13–00:57.13` | `0.94` (`-0.54 dB`) | `-15.48` / `-0.19` | `-15.87` / **`-0.80`** | `-41.9 dB` | `-14.5 dB` | `27.4 dB` | `1.7%` / `70.1%` | **Master peak owner (`-0.80 dBTP` at `00:52.86`, Arga *"Dapet!"*).** Clean `0.7s` quiet pocket (`00:54.55–00:55.20`) before Naya's *"Yes! Kita unggul!"*. No native game SFX. |
| `INT_MATCH_CONCLUSION` | `f1714–f1924` | `00:57.13–01:04.13` | `1.00` | — | `-37.83`* / `-24.56`* | **`-120.0 dB`** | `-61.3 dB` | — | *(J-cut only)* | **AUDIO GAP #1:** `6.57s` complete digital silence (`00:57.13–01:03.70`) until locked warung J-cut fades in at `01:03.67` (`f1910`). |
| `S08_SH01` | `f1924–f2140` | `01:04.13–01:11.33` | `0.92` (`-0.72 dB`) | `-14.79` / `-0.36` | `-15.53` / **`-1.14`** | `-42.4 dB` | `-13.9 dB` | `28.4 dB` | `4.5%` / `73.2%` | Clean warung reunion + full group laughter peaking `-1.14 dBTP` at `01:10.60`. J-cut boundary at `f1924` crossfades smoothly (`-34.5 dB`). |
| `S08_SH02_V2` | `f2140–f2244` | `01:11.33–01:14.80` | `1.00` (`0.00 dB`) | `-20.58` / `-8.67` | **`-20.60`** / `-8.74` | `-39.4 dB` | `-18.5 dB` | `20.9 dB` | `4.2%` / `68.2%` | **Quiet drop (`-5.1 LU` below `S08_SH01`).** Sari *"Satu... dua... tiga."* Clean `8.7 dB` peak headroom — lift `+3.5–4.0 dB` to match `S08_SH01`. |
| `S08_MONTAGE` | `f2244–f2388` | `01:14.80–01:19.60` | `1.00` | — | `-16.86`* / `-4.94`* | **`-120.0 dB`** | `-18.5 dB` | — | *(L-cut only)* | **Existing mechanical selfie shutter verified at `01:14.80–01:14.92` (`f2244–f2247`, HF `+29.6 dB`)** + `1.40s` L-cut laughter (`01:14.80–01:16.20`), then **AUDIO GAP #2 begins at `01:16.20`**. |
| `S09_BRAND` | `f2388–f2508` | `01:19.60–01:23.60` | `1.00` | — | **`-inf`** / **`-inf`** | **`-120.0 dB`** | `-120.0 dB` | — | *(silent)* | **AUDIO GAP #2 (cont.):** Total **`7.41s`** complete digital silence (`01:16.20–01:23.605`) across late montage and entire Brand Reveal. |

*\*`INT_MATCH_CONCLUSION` and `S08_MONTAGE` non-infinite readings reflect only the `0.47s` warung J-cut tail (`f1910–f1924`) and `1.40s` selfie L-cut tail (`f2244–f2286`).*

### 3.3 Existing Audio Discontinuities, Ambience Shifts & Reusable Sounds

1. **Sequential Non-Overlapping Cut Dips (`267 ms` V-Shaped Ambience Holes):**
   In [`src/compositions/KelanaRiaRoughCut.tsx`](../src/compositions/KelanaRiaRoughCut.tsx), `SmoothedFootageClip` applies a `4-frame` (`133 ms`) linear fade-out at the end of clip $N$ and a `4-frame` fade-in at the start of clip $N+1$ inside sequential (non-overlapping) `<Sequence>` blocks. Objective 80 ms boundary checks show ambient energy dipping to **`-40.8 dB` to `-58.4 dB`** right at **every live-action cut** (most noticeably across same-location cuts like `S01→S02` at `f147`, `S05_SH01→SH02` at `f802` dropping to `-58.4 dB`, and `S08_SH01→SH02` at `f2140` dropping to `-51.8 dB`).
   - *Contrast:* At `f1924` (`INT_MATCH_CONCLUSION → S08_SH01`), the `4f` overlapping J-cut crossfade holds smoothly at `-34.5 dB` with zero hole.
   - *Milestone 3.2 Fix:* Keep the locked visual cuts untouched, reduce non-overlapping edge fades to `1–2 frames` (`33–67 ms`, enough to prevent zero-crossing clicks without audible pumping) or use subtle `2–3f` audio-only pre/post-roll overlaps on same-location cuts (`S01→S02`, `S05_SH01→SH02→SH04`, `S08_SH01→SH02`), and let the music bed naturally bridge cross-location transitions.
2. **Major Ambient Floor Steps:**
   - `f147` (`00:04.90`, `S01→S02`, same cafe): **`+6.3 dB`** ambient jump + **`+6.26 LU`** dialogue loudness jump.
   - `f243` (`00:08.10`, `S02→S03`, cafe → map): **`-20.5 dB`** floor drop (ideally masked by `sfx_paper_wipe` + music entrance).
   - `f396` (`00:13.20`, `S03→S04`, map → street): **`+11.9 dB`** floor jump (naturally bridged by drum/percussion lift).
   - `f682` (`00:22.73`, `S04_SH04→S05_SH01`, MRT → GBK plaza): **`-13.5 dB`** floor drop.
   - `f1714` (`00:57.13`, `S07_SH04→INT_MATCH_CONCLUSION`): **`-78.1 dB`** drop into **`6.57s`** complete silence (solved by full music + territory/timer SFX).
   - `f2286` (`01:16.20`, L-cut end → `S09_BRAND`): **`7.41s`** complete silence (solved by warm montage music lift + brand resolve).
3. **Verified Existing Sounds to Preserve (Do NOT Duplicate):**
   - **Bundaran HI Camera Shutter (`S06_SH01`, `00:32.76–00:32.84` / `f983–f985`):** Sharp native shutter (`pk -6.4 dBFS`, HF energy `+21.9 dB` jump, `zcr ~3.1 kHz`) already aligned within 1 frame of `PhotoVerificationProofCard` (`f984`). **Preserve intact — do not stack a second shutter.**
   - **Warung Compact-Camera Selfie Shutter (`S08_SH02_V2 → S08_MONTAGE`, `01:14.80–01:14.92` / `f2244–f2247`):** Authentic double mechanical click (HF `+29.6 dB` jump) aligned to frame 0 of the white camera flash, immediately followed by `1.40s` L-cut group laughter (`01:14.80–01:16.20`). **Preserve intact — do not duplicate.**
   - **Warung Reunion J-Cut Ambience (`01:03.67–01:04.27` / `f1910–f1928`):** Authentic speech-free warung room tone pre-rolling `0.47s` ahead of `S08_SH01`. **Preserve intact.**
4. **Confirmed Absent in Source Recordings:**
   - Zero native phone notification chimes, check-in ticks, failure buzzers, card activation sounds, or paper-map rustles were detected in non-speech pockets (`S03_SH01` `00:08.10–00:08.70`, `S05_SH01` `00:24.25–00:25.70`, `S07_SH01` `00:44.50–00:45.55`, `S07_SH02` `00:45.63–00:46.00`, `S07_SH04` `00:54.55–00:55.20`).
   - `S04_SH04` MRT window snap pause (`00:20.80–00:21.50`) showed no distinct shutter spike in FFT/RMS analysis (flagged for human ear verification; `S04_SH04` is pure Raw Jakarta with no overlay, so adding an artificial shutter is unnecessary unless desired).

---

## 4. Music Spotting Plan (Exact Locked `2,508f` Cue Map)

One primary playful urban indie-funk / light hip-hop track shaped dynamically across a **3-Act Emotional Arc**:
- **Act 0 — Raw Setup (`00:00.00–00:07.77`):** Dry ambient reality.
- **Act 1 & 2 — Playful City Groove & Comeback (`00:07.77–01:03.50`):** Rhythmic energy rising through transit, shifting to focused exploration, tightening at Yellow's lead, dropping cleanly on Yellow's fail, and peaking at the Sarinah Poin Ganda victory.
- **Act 3 — Warm Friendship & Brand Resolution (`01:03.80–01:23.50`):** Stripped-back warmth for the warung reunion, swelling affectionately over Weekend Memories after laughter fades, resolving cleanly on `Kelana Ria — Mainkan kotamu.`

| # | Narrative / Musical Cue | Time (`MM:SS.ss`) | Exact Frame | Music Behavior & Arrangement Direction | Target Music Level (under Dialogue / Open) |
| ---: | --- | --- | ---: | --- | --- |
| — | *Opening silence (`S01_SH01`–`S02_SH01`)* | `00:00.00–00:07.77` | `f0–f233` | **No music.** Preserve dry cafe boredom and Arga's *"Eh, lihat deh."* / Naya's *"Apaan?"* so the jump into play feels immediate and fresh. | Silent (`-inf`) |
| 1 | **Initial music entrance** | **`00:07.77`** | **`f233`** | **1-beat rhythmic pickup** (light muted guitar/rimshot or bass slide) entering softly on the paper-edge wipe right after *"Apaan?"* ends (`f231`). *(Optional alt: bare bass pulse from `00:05.90` / `f177` only if track has a sparse 2s intro.)* | Fade in `-26 → -20 LUFS` |
| 2 | **Game-mode reveal** (`CLAIM THE CITY`) | **`00:08.10–00:08.30`** | **`f243–f249`** | **Primary groove lands on downbeat** as paper map opens (`f243`) and `CLAIM THE CITY` title hits (`f249`). Keep arrangement light (bass + muted guitar + subtle rim/shaker) and ducked cleanly under Bima & Arga (`00:08.70–00:13.00`). | `-19 LUFS` intro → duck **`-24 LUFS`** under dialogue |
| 3 | **Transportation montage** (`S04_SH01–SH04`) | **`00:13.20–00:22.73`** | **`f396–f682`** | **Groove opens up!** Full syncopated drum kit + upbeat percussion stride across the 4 transit cuts, lifting briefly in dialogue gaps (`00:14.9–00:15.2`, `00:17.5–00:18.0`, `00:20.7–00:21.5`) and ducking extra during `S04_SH03` (`00:18.0–00:18.9`) to protect Arga's quiet *"Oke, gas."* | **`-19 to -22 LUFS`** (duck **`-25 LUFS`** on `S04_SH03`) |
| 4 | **GBK exploration → Successful GBK claim** | `00:22.73` → **`00:29.63`** | `f682` → **`f889`** | Pull percussion slightly back during GBK check-in & walk (`00:22.73–00:29.23`, keeping quiet clips `S05_SH02`/`S05_SH04` ultra-clear). At **`00:29.63` (`f889`)**, add a **bright playful melodic accent/chord pop** synced to *"Nah, dapet!"* & `+1 LANDMARK`. | **`-23 to -25 LUFS`** under GBK → brief **`-19 LUFS`** pop at `f889` |
| 5 | **Yellow Team lead** (`S06_SH01` → `S06_SH03_V4`) | `00:31.33` → **`00:35.83`** (`f1111` accent) | `f940` → **`f1075`** (`f1111`) | Steady curious pulse through Bundaran HI photo (`00:31.33–00:35.83`). At **`00:35.83` (`f1075`)** (Kendal cut) & **`00:37.03` (`f1111`)** (`GREEN 1 — YELLOW 2`), tighten the rhythm (punchier syncopated bass/hi-hat urgency — competitive, never dark) while staying well below the dense 3-line dialogue. | **`-23 to -25 LUFS`** under rapid Kendal dialogue |
| 6 | **Failed Sarinah challenge** (`JAWABAN SALAH`) | **`00:43.17`** (`f1295–f1369`) | **`f1295`** | **Clean 1-bar musical drop / pause!** Cut drums & melodic layers right on Bima's *"Yah, salah!"* (`f1295`), leaving dry space or a single muted bass decay across the `1.2s` exasperated beat (`00:44.45–00:45.63`). High comedic clarity and tension reset! | **Drop out / `-32 LUFS` bare decay** (`2.4s` pocket) |
| 7 | **Opportunity notification** (`SARINAH MASIH BISA DIKLAIM!`) | **`00:46.03`** | **`f1381`** | **Sparse rhythmic re-entry** (crisp hi-hat / muted guitar chug / warm bass pickup) on Arga's *"Bentar!"* — signaling gears turning without stepping on his delivery. | **`-25 LUFS`** rising to **`-23 LUFS`** |
| 8 | **Poin Ganda reveal** (`POIN GANDA · 2×`) | **`00:49.43`** (`f1528` launch) | **`f1483`** (`f1528`) | **Momentum build** as the tactical card deals in (`f1483`) and Arga says *"...Poin Ganda!"* (`f1503`). Land a **crisp drum pickup/fill on Naya's *"Gas!"* (`00:50.93` / `f1528`)**, swelling into the brisk `1.0s` dialogue-free tunnel exit stride (`00:51.10–00:52.13`). | `-23 LUFS` → swell **`-17 LUFS`** on tunnel stride |
| 9 | **Successful Sarinah claim** (`Netral 1–1`) | **`00:52.63`** | **`f1579`** | Confident, driving groove holds cleanly under Arga's *"Dapet!"* (`f1579`) — **save the full climax for Poin Ganda** so the neutral `1–1` beat feels like step one of the two-step punch! | **`-22 LUFS`** under dialogue |
| 10 | **Poin Ganda activation** (`DIAKTIFKAN · 1→2`) | **`00:54.07`** | **`f1622`** | **Energetic pre-climax lift!** Begin harmonic/percussive build right on `DIAKTIFKAN` (`f1622`), swelling smoothly through the `0.7s` quiet pocket (`00:54.55–00:55.20`) and blooming on Naya's *"Yes! Kita unggul!"* + fist bump (`00:55.53–00:56.70`). | `-22 LUFS` → rise **`-18 LUFS`** into `f1714` |
| 11 | **Territory transformation** (`INT_MATCH_CONCLUSION` Ph. 1) | **`00:57.13–00:59.60`** | **`f1714–f1788`** | **Full-energy instrumental peak!** Zero dialogue here — let the funky, joyous main groove shine at full width (`KR_UI_MAP_SARINAH.png` emerald `×2` transformation & `GREEN 2 — YELLOW 1`). | **`-14.5 to -15.5 LUFS`** (open feature) |
| 12 | **Match timer expiry** (`102:00 → 00:00`) | `00:59.73` → **`01:01.47`** | `f1792` → **`f1844`** | **Playful rhythmic build / subtle percussion roll** riding beneath the `1.73s` accelerated clock (`f1792–f1844`), hitting a crisp **downbeat stop/chime landing** right on `00:00` (`f1844`). | **`-15.5 LUFS`** (carved slightly around timer ticks) |
| 13 | **Victory announcement** (`GREEN TEAM MENANG`) | **`01:01.57–01:03.67`** | **`f1847–f1910`** | **Bright celebratory chord resolution / 1-bar victory vamp** (`01:01.57–01:03.00`), then **smoothly strip drums & energy out (`01:03.00–01:03.80`)** so competitive tension ends cleanly as the warung J-cut ambience enters at `01:03.67` (`f1910`). | `-15.5 LUFS` → taper **`-26 LUFS`** by `f1918` |
| 14 | **Reunion** (`S08_SH01` & `S08_SH02_V2`) | **`01:04.13–01:14.80`** | **`f1924–f2244`** | **Warm, stripped-back friendship pocket.** Drop snappy competitive percussion; keep soft warm bass + relaxed muted guitar / electric piano chords tucked gently behind warung banter, laughter, and *"Satu... dua... tiga."* Briefly breathe/thin slightly (`-2 dB`) right at the selfie countdown (`01:14.30–01:14.80`) so the authentic camera shutter pops clearly! | **`-25 to -27 LUFS`** (warm understated bed) |
| 15 | **Photo montage** (`S08_MONTAGE`) | **`01:14.80–01:19.60`** | **`f2244–f2388`** | Hold warm bed under L-cut laughter (`01:14.80–01:16.00`), then **bloom smoothly into the full warm melodic theme** (`01:16.00–01:19.60`) as laughter fades out (`01:16.20`) and the Kendal print (`01:16.40`) & hero group selfie (`01:17.20`) take center stage — joyful, affectionate, never overly sentimental! | `-24 LUFS` (`f2244–f2278`) → bloom **`-15.5 LUFS`** (`f2286–f2388`) |
| 16 | **Closing brand reveal** (`Kelana Ria · Mainkan kotamu.`) | **`01:19.60–01:23.60`** | **`f2388–f2508`** | **Confident final musical cadence / playful button** resolving cleanly across `Mainkan kotamu.` (`01:20.60` / `f2418`) and `SEGERA HADIR` (`01:21.13` / `f2434`), with a natural acoustic/bass ring-out tail decaying gently to silence by **`01:23.35–01:23.50` (`f2500–f2505`)** (zero abrupt cut at `f2508`). | **`-15.5 LUFS`** → clean natural decay to `-inf` by `f2505` |

---

## 5. Mixing Architecture, Loudness Targets & Risk Mitigation (For Milestone 3.2)

### 5.1 Recommended Final Master Targets (Website + YouTube Delivery)
- **Integrated Loudness:** **`-14.0 LUFS` (±0.5 LU)** — matches YouTube's `-14 LUFS` normalization ceiling (prevents YouTube turn-down while staying loud, clear, and punchy on mobile phones and the Kelana Ria website).
- **Dialogue Target Anchor:** **`-16.0 to -17.0 LUFS`** across all spoken clips (tightening the current **`8.02 LU`** residual clip spread down to **`≤ 2.5 LU`**).
- **Maximum True Peak:** **`-1.0 dBTP`** (hard brickwall true-peak limiter ceiling, preventing AAC/MP4 codec overshoots on web/mobile playback).
- **Loudness Range (`LRA`):** **`5.0–7.5 LU`** (preserves dynamic lift between quiet cafe opening, conversational scenes, and open graphic/montage peaks without feeling over-compressed).

### 5.2 Key Mixing Issues to Resolve in Milestone 3.2
1. **Peak Headroom Recovery (`-0.80 dBTP` Bottleneck):**
   - Current V2 dialogue peaks hit `-0.80 dBTP` (`S07_SH04` *"Dapet!"*), `-1.09 dBTP` (`S04_SH02`), `-1.14 dBTP` (`S08_SH01`), and `-1.36 dBTP` (`S07_SH02`).
   - **Action:** Apply clean per-clip dialogue pre-leveling + gentle bus peak control (`~2–3 dB` soft limiting/compression on dialogue transients) so the dialogue bus peaks around `-4 to -5 dBFS` before summing with music and SFX, then finalize with a `-1.0 dBTP` master true-peak limiter.
2. **Per-Clip Dialogue Re-Leveling (Fixing the `8.02 LU` Spread):**
   - **Priority lifts:** `S01_SH01` (`+3.5 to +4.5 dB` — currently `-22.68 LUFS`, `6.3 LU` below `S02_SH01`), `S04_SH03` (`+3.0 to +3.5 dB` + high-pass filter — currently `-21.18 LUFS` with `12.4 dB` SNR), `S05_SH02` (`+3.5 to +4.0 dB`), `S05_SH04` (`+2.5 to +3.5 dB`), `S08_SH02_V2` (`+3.5 to +4.0 dB` — currently `-20.60 LUFS`, `5.1 LU` below `S08_SH01`).
   - **Gentle trims:** `S06_SH03_V4` (`-1.5 dB`), `S04_SH02` (`-1.0 dB`), `S04_SH01` (`-1.0 dB`), `S07_SH02` (`-0.5 to -1.0 dB`).
3. **High-Pass Filtering & Vocal Clarity EQ:**
   - Apply a clean `80–100 Hz` high-pass filter on dialogue clips with strong low-end rumble — especially **`S02_SH01`** (`23.9% < 180 Hz` roadside traffic) and **`S04_SH03`** (`21.9% < 180 Hz` TransJakarta bus engine) — plus a gentle `-2 dB` cut around `250–350 Hz` on boxy tunnel/cabin clips (`S04_SH02`, `S04_SH04`, `S06_SH03_V4`, `S07_SH02`) to clear space for the warm funk bass guitar.
   - Carve a subtle `1.5–2.5 dB` mid-channel dip (`1.5–3.5 kHz`) in the music bus during dialogue passages rather than relying solely on heavy broadband ducking.
4. **Eliminating Cut-Boundary V-Dips (`267 ms` Pumping):**
   - Replace the current non-overlapping `4f` (`133 ms`) linear edge fades between adjacent footage clips with tighter `1–2f` de-click fades (`33–67 ms`) — or brief `3f` overlapping audio crossfades on same-location edits (`S01→S02`, `S05_SH01→SH02→SH04`, `S08_SH01→SH02`) — keeping all visual cut frames 100% locked!

---

## 6. Remaining Limitations & Items for Human Ear Check

1. **No Subjective Listening in This Environment:** Because audio playback cannot be monitored directly in this remote Linux sandbox, exact timbre judgments (e.g., whether `S04_SH03`'s TransJakarta engine rumble obscures Arga's *"Oke, gas."*, whether `S06_SH03_V4` tunnel acoustics sound harsh, or whether `S04_SH04` has any quiet shutter click during Sari's speech) should be spot-checked by the project owner on headphones and a phone speaker.
2. **Offline Audio Processing vs. Remotion Runtime Mixing:** Remotion's `<Audio>` component supports frame-accurate volume envelopes, trimming, and pitch/playbackRate, but does not provide built-in parametric EQ, multiband ducking, or brickwall true-peak limiting. For Milestone 3.2, we recommend preparing a clean pre-processed dialogue/SFX/music stem workflow (using FFmpeg's `loudnorm` / `volume` / `adelay` or lightweight pre-leveled audio stems synced deterministically in Remotion, plus verifying final render loudness via FFmpeg `loudnorm`). *(Note: Remotion's bundled FFmpeg includes `volume`, `adelay`, `atrim`, `apad`, `atempo`, `pan`, and `loudnorm`, while EQ/high-pass filters are not compiled into the bundled binary — if surgical HPF/EQ on `S02_SH01`/`S04_SH03` is needed in Milestone 3.2, we can either install standard `ffmpeg` via `apt` or perform clean linear-phase FIR filtering in Python before final muxing.)*
3. **No Audio Assets in Repository Yet:** `assets/audio/` does not currently exist; Milestone 3.2 is paused cleanly until the project owner approves and supplies the selected music and SFX assets listed in [`docs/AUDIO_ASSET_REQUIREMENTS.md`](./AUDIO_ASSET_REQUIREMENTS.md).
