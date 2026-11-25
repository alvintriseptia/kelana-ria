# Final Delivery Report — Kelana Ria: *Claim the City* Promotional Film

> **Project:** Kelana Ria — *Claim the City* Promotional Film (Indonesian)  
> **Repository / Branch:** `alvintriseptia/kelana-ria` · `campaign/claim-the-city-video`  
> **Workspace:** `claim-the-city/` (Remotion `4.0.547`)  
> **Completion Scope:** Milestone 3.3 (Audio Integration & Mastering) + Milestone 4.0 (Final Finishing, QA & Multi-Platform Delivery), completed end-to-end under explicit project owner authorization.  
> **Release Status:** **FINAL EXPORTS READY FOR OWNER REVIEW — NOT YET AUTHORIZED FOR PUBLIC DISTRIBUTION** (see [Section 9: Outstanding Release-Review Blockers](#9-outstanding-release-review-blockers)).

---

## 1. Locked Master Specification

All approved Milestone 1.1 editorial timing, Milestone 2 Jakarta Playground motion graphics, and Milestone 3.2/3.3 audio assets were preserved without editorial alteration, frame-rate conversion, aggressive color LUTs, or newly generated footage/photos:

| Parameter | Verified Master Value |
| --- | --- |
| **Composition ID** | `KelanaRia-RoughCut` (`claim-the-city/src/Root.tsx`) |
| **Resolution / Aspect Ratio** | `1920 × 1080` · `16:9` landscape |
| **Frame Rate** | `30 fps` constant (`30/1`, zero frame-rate conversion) |
| **Exact Frame Count** | **`2,508` frames** |
| **Exact Runtime** | **`83.600` seconds** (`01:23.60`) |
| **Color Standard** | SDR Rec. 709 (`color_space=bt709`, `color_transfer=bt709`, `color_primaries=bt709`) |
| **Master Audio Format** | `48 kHz` / `24-bit` Stereo Uncompressed PCM (`pcm_s24le`, `4,012,800` exact samples) |
| **Master Loudness / True Peak** | **`-14.55 LUFS`** · **`-1.12 dBTP`** · **`4.10 LU` LRA** |
| **Preserved Prototype** | `KR-MotionDesign-Test-S07-SH02` (`1920 × 1080`, `30 fps`, `195` frames / `6.50s`) intact |

---

## 2. Final Delivery Inventory (`renders/final/`)

All compressed deliverables (`YouTube.mp4`, `Web.mp4`, `Web_720p.mp4`) were encoded **directly from the Apple ProRes 422 archival master (`KR_ClaimTheCity_Master.mov`)** to avoid generational lossy video compression. All files in `renders/` remain excluded from Git tracking via `claim-the-city/.gitignore`.

| Delivery File | Purpose | Resolution / FPS / Frames | Video Codec / Profile / Bitrate | Audio Codec / Spec | Color & Container | Exact File Size |
| --- | --- | --- | --- | --- | --- | --- |
| `renders/final/KR_ClaimTheCity_Master.mov` | Archival Master | `1920 × 1080` · `30 fps` · `2,508f` (`83.600s`) | Apple ProRes 422 Standard (`prores` Profile `2`, 10-bit `yuv422p10le`), `140.85 Mbps` (from lossless PNG frames) | Uncompressed `24-bit` Stereo PCM (`pcm_s24le`), `48 kHz`, `2,304 kbps`, `4,012,800` samples | BT.709 SDR · MOV `+faststart` (`moov@20 < mdat@26334`) | **`1,426.71 MiB`** (`1,496,012,837 B`) |
| `renders/final/KR_ClaimTheCity_YouTube.mp4` | YouTube High-Bitrate Upload | `1920 × 1080` · `30 fps` · `2,508f` (`83.600s`) | H.264 High L4.1 (`libx264`, `yuv420p`), 2-pass VBR **`15.96 Mbps`** (target `12–20 Mbps`, max `20 Mbps`) | FDK-AAC LC (`libfdk_aac`), `48 kHz` Stereo, **`320.0 kbps`** | BT.709 SDR · MP4 `+faststart` (`moov@32 < mdat@88256`) | **`162.37 MiB`** (`170,260,780 B`) |
| `renders/final/KR_ClaimTheCity_Web.mp4` | Website Primary 1080p Embed | `1920 × 1080` · `30 fps` · `2,508f` (`83.600s`) | H.264 High L4.1 (`libx264`, `yuv420p`), **CRF `25`**, `3.48 Mbps` (capped `6 Mbps`) | FDK-AAC LC (`libfdk_aac`), `48 kHz` Stereo, **`192.0 kbps`** | BT.709 SDR · MP4 `+faststart` (`moov@32 < mdat@88231`) | **`36.66 MiB`** (`38,437,857 B`) |
| `renders/final/KR_ClaimTheCity_Web_720p.mp4` | Optional Lightweight Mobile / 4G Web Companion | `1280 × 720` · `30 fps` · `2,508f` (`83.600s`) | H.264 High L3.1 (`libx264`, `yuv420p`, Lanczos scale), **CRF `24`**, `2.16 Mbps` | FDK-AAC LC (`libfdk_aac`), `48 kHz` Stereo, **`128.0 kbps`** | BT.709 SDR · MP4 `+faststart` (`moov@32 < mdat@88006`) | **`22.89 MiB`** (`24,006,041 B`) |
| `renders/final/KR_ClaimTheCity_ID.srt` | Indonesian Subtitles (YouTube / Players) | `34` cues · `00:00:01,400–00:01:14,730` | SubRip UTF-8 (separate track, not burned in) | N/A | Max `36` chars/line · `0` overlaps | **`1,902 B`** (`1.9 KiB`) |
| `renders/final/KR_ClaimTheCity_ID.vtt` | Indonesian Subtitles (HTML5 WebVTT) | `34` cues · `00:00:01.400–00:01:14.730` | WebVTT UTF-8 (separate track, not burned in) | N/A | Max `36` chars/line · `0` overlaps | **`1,817 B`** (`1.8 KiB`) |
| `renders/final/KR_ClaimTheCity_Thumbnail.jpg` | YouTube & Website Poster Thumbnail | `1920 × 1080` (`16:9`) | JPEG (`mjpeg`, Quality `94`), rendered from `KR-ClaimTheCity-Thumbnail` still | N/A | Approved warung group photo (`KR_S08_PH01.jpg`) + official Kelana Ria lockup | **`330.5 KiB`** (`338,430 B`) |

---

## 3. Audio Integration & Independent Loudness Verification (Milestone 3.3 + 4.0)

### 3.1 Master Mix Pipeline (`claim-the-city/scripts/build_audio_mix.py`)
The mastered `48 kHz / 24-bit` stereo mix (`assets/audio/mix/KR_ClaimTheCity_MasterMix_48k.wav`, gitignored) is mounted directly in `KelanaRiaRoughCut.tsx` (`useMasterAudioMix: true` default, with raw clip fallback preserved when `useMasterAudioMix={false}`) and combines three cleaned buses:
1. **Dialogue & Natural Ambience Bus:** All 17 locked live-action clips + warung J-cut ambience (`f1910–f1928`) + post-shutter warung L-cut laughter (`f2244–f2286`). Resolved prior Milestone 3.1 defects: tightened clip loudness spread from `8.02 LU` to balanced conversational consistency, applied 2nd-order RBJ biquad HPFs (`95 Hz` on `S02_SH01` / `S04_SH03`, `70–75 Hz` elsewhere), subtle de-box EQ (`-1.8` to `-2.2 dB @ 300 Hz`) on enclosed tunnel/cabin clips, gentle `+2.2 dB @ 2.6 kHz` vocal clarity lift on `S04_SH03`, `2f` (`67 ms`) overlapping cosine crossfades on same-location cuts (`S01→S02`, `S05_SH01→SH02→SH04`, `S08_SH01→SH02`) to remove V-dips, and gentle `3:1` transient taming (`3.92 dB` max GR). Native Bundaran HI (`f983–f985`) and warung selfie (`f2244–f2247`) camera shutters remain untouched.
2. **Bar-Aligned Music Bus (`Funky Triplets` — Michael Ramir C., Mixkit `#1141`, verified `100.0 BPM` / `2.400s` bar grid):** Five bar-aligned regions synced to locked visual hits: pickup at `00:07.50` landing Bar 2 downbeat on `00:08.10` (`f243`), Breakdown #1 musical drop on `JAWABAN SALAH` (`00:43.17` / `f1295`), Bar 24 groove re-entry on Sarinah opportunity (`00:46.03` / `f1381`), Peak Chorus Bar 34 on Sudirman–Thamrin lead (`00:57.13` / `f1714`), zero-drum Breakdown #2 melodic pocket looped seamlessly across the warung reunion (`01:03.65–01:16.05`), and Peak Chorus landing the track's native final button (`1:45.60`) cleanly on `SEGERA HADIR` (`01:21.13` / `f2434`), decaying cleanly to silence by `01:22.50`. Lookahead dialogue-driven ducking + dynamic `-3 dB @ 2.2 kHz` vocal-pocket carve preserves effortless dialogue intelligibility.
3. **Tactile Board-Game SFX Bus:** All 19 onset-locked cues using the 10 verified Mixkit WAV assets (`48 kHz / 24-bit` working copies), including custom 3-layer `POIN GANDA` activation composite (`f1622`), 2-layer Sudirman–Thamrin territory-capture composite (`f1718`), 12 progressively accelerating clock ticks across `1.65s` (`f1792–f1844`), and warm-shelved round-expiry desk bell (`f1844`). Zero duplicate camera shutters were added.
4. **Master Bus Limiting:** Calibrated via lookahead brickwall limiter (`-1.20 dBFS` ceiling, `-2.36 dB` max GR — zero audible pumping).

### 3.2 Independent Per-File Loudness, True Peak & Silence Verification
Every final delivery file was measured **independently** using FFmpeg EBU R128 (`loudnorm`) and `silencedetect` (`-55 dB`, `>= 0.5s`):

| File | Integrated Loudness (`I`) | True Peak (`TP`) | Loudness Range (`LRA`) | Mid-Film Silence Gaps (`0–82.5s`) | Ending Silence Hold | Target Status (`-14` to `-16 LUFS`, `<= -1.0 dBTP`) |
| --- | --- | --- | --- | --- | --- | --- |
| `KR_ClaimTheCity_MasterMix_48k.wav` | **`-14.55 LUFS`** | **`-1.12 dBTP`** | `4.10 LU` | `0` (None) | `82.50–83.60s` (`1.10s`) | **PASS** |
| `KR_ClaimTheCity_Master.mov` | **`-14.55 LUFS`** | **`-1.12 dBTP`** | `4.10 LU` | `0` (None) | `82.50–83.60s` (`1.10s`) | **PASS** |
| `KR_ClaimTheCity_YouTube.mp4` (`320k` AAC) | **`-14.58 LUFS`** | **`-1.09 dBTP`** | `4.10 LU` | `0` (None) | `82.50–83.61s` (`1.10s`) | **PASS** |
| `KR_ClaimTheCity_Web.mp4` (`192k` AAC) | **`-14.58 LUFS`** | **`-1.12 dBTP`** | `4.10 LU` | `0` (None) | `82.51–83.61s` (`1.10s`) | **PASS** |
| `KR_ClaimTheCity_Web_720p.mp4` (`128k` AAC) | **`-14.59 LUFS`** | **`-1.07 dBTP`** | `4.10 LU` | `0` (None) | `82.50–83.61s` (`1.10s`) | **PASS** |

### 3.3 Per-Segment Loudness Progression (`KR_ClaimTheCity_MasterMix_48k.wav`)
| Story Section | Time Range | Integrated Loudness | True Peak | LRA |
| --- | --- | --- | --- | --- |
| 01. Opening Dialogue (`S01–S02`) | `00.0–08.1s` | `-15.72 LUFS` | `-1.12 dBTP` | `1.90 LU` |
| 02. Claim the City Paper Map (`S03`) | `08.1–13.7s` | `-14.70 LUFS` | `-1.13 dBTP` | `1.30 LU` |
| 03. Transportation Montage (`S04`) | `13.7–23.0s` | `-14.77 LUFS` | `-1.13 dBTP` | `1.20 LU` |
| 04. GBK Check-in & Claim (`S05`) | `23.0–31.3s` | `-15.42 LUFS` | `-1.19 dBTP` | `1.40 LU` |
| 05. Bundaran HI, Kendal & Wrong (`S06–S07_SH01`) | `31.3–46.0s` | `-14.72 LUFS` | `-1.17 dBTP` | `1.60 LU` |
| 06. Sarinah Comeback & Poin Ganda (`S07_SH02–SH04`) | `46.0–57.1s` | `-13.63 LUFS` | `-1.18 dBTP` | `2.10 LU` |
| 07. Map Lead, Clock & Victory (`INT_MATCH`) | `57.1–63.6s` | `-13.69 LUFS` | `-2.14 dBTP` | `0.90 LU` |
| 08. Warung Reunion (`S08_SH01–SH02`) | `63.6–75.0s` | `-15.23 LUFS` | `-1.16 dBTP` | `3.70 LU` |
| 09. Weekend Montage & Brand Reveal (`S08_MONTAGE–S09`) | `75.0–82.6s` | `-13.32 LUFS` | `-1.14 dBTP` | `1.90 LU` |

---

## 4. Final Quality Assurance Results

All technical and visual checks were executed against the final exported deliverables (`scripts/qa_final_deliveries.py` + direct visual inspection):

- **Frame & Sync Integrity:** Exact `2,508` frames (`83.600s` @ `30/1` CFR) confirmed across `Master.mov`, `YouTube.mp4`, `Web.mp4`, and `Web_720p.mp4`. Exact `4,012,800` PCM audio samples (`83.600000s`) confirmed in `Master.mov`.
- **Missing Media / Black Frame Scan:** FFmpeg `blackdetect` (`d=0.15:pix_th=0.05`) returned **0 black-frame events** on `KR_ClaimTheCity_Web.mp4`.
- **No Dev Overlays or Placeholders:** Confirmed `showPlaceholders: false` and `showDevShotSlate: false` in `src/Root.tsx` and verified visually across 14 sampled timeline frames (`f45`, `f300`, `f740`, `f835`, `f1035`, `f1140`, `f1510`, `f1638`, `f1744`, `f1818`, `f1882`, `f2040`, `f2340`, `f2478`).
- **Web CRF Evaluation (`24` vs `25` + `720p` Companion):**
  - 1080p **CRF 24** produced `41.64 MiB` (`3.98 Mbps` video); 1080p **CRF 25** produced **`36.66 MiB`** (`3.48 Mbps` video).
  - Direct side-by-side 1:1 inspection of Terowongan Kendal dark shadows (`f1140`), Sarinah carved relief & fine text (`f1638`), paper textures, maps (`f300`, `f1744`), and faces (`f45`, `f1035`, `f2040`) showed **CRF 25** to be visually indistinguishable from CRF 24 with zero dark macroblocking, zero typography ringing, and crisp OpenFreeMap/OSM credit legibility while saving `~5 MiB`. **CRF 25** was selected for `KR_ClaimTheCity_Web.mp4`.
  - Because richly detailed handheld Jakarta street footage keeps 1080p web delivery at `36.66 MiB`, an optional lightweight **`720p` companion (`KR_ClaimTheCity_Web_720p.mp4`, `22.89 MiB`, CRF `24`, `128k` AAC)** was also encoded directly from `Master.mov` and visually verified (`f1638` fine text remains sharp).
- **Mobile & Small-Size Readability:** Simulated `360px`-wide viewing of dense graphic moments (`f835`, `f1510`, `f1744`, `f1882`) confirmed all primary headlines, scoreboards, and team indicators remain clear.
- **Thumbnail Visual QA:** Inspected `KR_ClaimTheCity_Thumbnail.jpg` at full `1920 × 1080` and `320 × 180` small preview; polished Green vs Yellow pills to crisp single-line badges, replaced partially occluded background photo prints with clean layered Green/Yellow board-game cards, and confirmed safe bottom-right clearance for YouTube's duration badge.
- **Code & Repo Hygiene:** `npm run lint` (`eslint src && tsc`) passed with 0 errors; `npm run compositions` verified all 3 registered entries (`KelanaRia-RoughCut`, `KR-MotionDesign-Test-S07-SH02`, `KR-ClaimTheCity-Thumbnail`); zero modifications to original files in `assets/footage/`, `assets/photos/`, `assets/ui/`, `assets/brands/`, or `assets/references/`.

---

## 5. Subtitle Verification Status (`KR_ClaimTheCity_ID.srt` & `.vtt`)

- **Format & Technical Validation (PASS):** Both UTF-8 files (`KR_ClaimTheCity_ID.srt` and `KR_ClaimTheCity_ID.vtt`) contain `34` dialogue cues spanning `00:00:01.400–00:01:14.730`, strictly monotonic with `0` timestamp overlaps, `1–2` lines per cue, and maximum line length `36` characters (well within the `<= 42` character readability standard).
- **Editorial Source & Honesty Disclosure:** Cues were authored in natural colloquial Jakarta Indonesian and synchronized directly to the locked dialogue timecode annotations in `claim-the-city/src/config/timeline.ts` and `docs/AUDIO_DIRECTION.md`. Subtitles are delivered exclusively as separate accessibility tracks (never burned into the video masters).
- **Requires Native-Speaker Human Verification Before Publish:** Because automated speech-to-text / human audio monitoring was not available in this headless VM, a native Indonesian reviewer must listen through `KR_ClaimTheCity_Web.mp4` with subtitles enabled to confirm exact word-for-word spoken fidelity, subtle filler particles, and consistent colloquial pronoun spelling (for example, Cue 9 currently reflects `timeline.ts` as *"Udah, ikut gua aja."* while Cues 13, 18, 28, 31, and 33 use *"gue"*).

---

## 6. Licensing, Attribution & Non-Redistribution Status

| Asset Category | Source & License | Verification Status & Mandatory Obligations |
| --- | --- | --- |
| **Primary Music (`Funky Triplets`)** | Michael Ramir C. · Mixkit `#1141` · [Mixkit Stock Music Free License](https://mixkit.co/license/modal/musicFree/) | **Verified for commercial web/YouTube promo video.** Strictly **PROHIBITED** inside video games / the Kelana Ria app itself, on TV/radio broadcast, or on CDs/DVDs. Do **not** register on YouTube Content ID or redistribute raw audio. Retain [`assets/audio/LICENSE_RECORDS.md`](../../assets/audio/LICENSE_RECORDS.md); forward any automated YouTube Content ID claim to `team@mixkit.co`. |
| **Sound Effects (`10` Tactile WAVs)** | Mixkit (Envato) · [Mixkit Sound Effects Free License](https://mixkit.co/license/modal/sfxFree/) | **Verified for commercial web/YouTube promo End Product.** Prohibited from standalone redistribution, source packaging, or Content ID registration. |
| **Git Stock-Audio Isolation** | `assets/audio/.gitignore` | **Verified (`git status -uall ../assets/audio/`):** Zero raw stock MP3/WAV or mixed WAV files are tracked in Git; only `.gitignore` and `LICENSE_RECORDS.md` are trackable. |
| **Typefaces (`Barlow Condensed`, `DM Sans`)** | Fontsource 5.3.0 · SIL Open Font License 1.1 | License notices preserved intact in `assets/brands/licenses/barlow-condensed.txt` and `assets/brands/licenses/dm-sans.txt`. |
| **Map Imagery Attribution** | OpenFreeMap / OpenMapTiles / OpenStreetMap | Required credit (`Peta: OpenFreeMap · © OpenMapTiles · © OpenStreetMap contributors`) preserved on-screen in map graphics (`src/config/brand.ts`, `src/components/InterludePlaceholder.tsx`). |
| **Kelana Ria Logo & Game Artwork** | `assets/brands/` handoff (`commit 3cd9547`) | **Clearance Confirmation Required:** Per `assets/brands/README.md`, repository inclusion does not itself grant external publication rights; owner must confirm provenance/release clearance prior to external publication. |
| **Live-Action Footage & Cast Photos** | `assets/footage/`, `assets/photos/` | Preserved untouched; owner remains responsible for any required talent/location release records. |

---

## 7. Known Limitations

1. **No Subjective Audio Playback Monitoring in Execution Environment:** This remote Linux VM has no audio output hardware for subjective listening. All audio balancing, ducking, EQ, limiting, loudness (`-14.55` to `-14.59 LUFS`), true peak (`-1.07` to `-1.12 dBTP`), and silence checks were verified objectively via Python DSP metrics and FFmpeg `loudnorm`/`silencedetect`. **A mandatory human headphone + mobile-speaker listen-through is required before public launch** (particularly checking music energy vs dialogue clarity in `S01–S02`, `S04_SH03`, `S07_SH02`, `S07_SH04`, and the `S08_SH01` warung reunion).
2. **Subtitle Ear-Check Pending:** See [Section 5](#5-subtitle-verification-status-kr_claimthecity_idsrt--vtt).
3. **Simulated UI & Unverified On-Site Field Clues:** Per `assets/ui/manifest.json`, UI captures are simulated examples and physical on-site field details for GBK and Sarinah remain unverified.
4. **No Warranty Against Automated YouTube Content ID Claims:** Royalty-free licensing (`Mixkit musicFree` / `sfxFree`) authorizes commercial promo use under Mixkit's terms but does **not** guarantee immunity from third-party or automated Content ID matching.

---

## 8. Website & YouTube Integration Recommendations

### 8.1 Kelana Ria Website (`https://kelanaria.id`)
Serve `KR_ClaimTheCity_Web.mp4` (desktop / high-DPI) and `KR_ClaimTheCity_Web_720p.mp4` (mobile / constrained connections) from a CDN or object storage with `Accept-Ranges: bytes` enabled and long-lived immutable cache headers (`Cache-Control: public, max-age=31536000, immutable`). Both files are already `+faststart` optimized (`moov` atom at front).

Recommended responsive HTML5 embed (avoid `autoplay` with sound; load metadata only until user interaction):

```html
<video
  controls
  playsinline
  preload="metadata"
  poster="/media/claim-the-city/KR_ClaimTheCity_Thumbnail.jpg"
  width="1920"
  height="1080"
>
  <source
    src="/media/claim-the-city/KR_ClaimTheCity_Web.mp4"
    type="video/mp4"
    media="(min-width: 900px)"
  />
  <source
    src="/media/claim-the-city/KR_ClaimTheCity_Web_720p.mp4"
    type="video/mp4"
  />
  <source
    src="/media/claim-the-city/KR_ClaimTheCity_Web.mp4"
    type="video/mp4"
  />
  <track
    kind="subtitles"
    src="/media/claim-the-city/KR_ClaimTheCity_ID.vtt"
    srclang="id"
    label="Bahasa Indonesia"
    default
  />
</video>
```

*(Note: If deploying an adaptive player such as HLS/DASH later, transcode from `KR_ClaimTheCity_Master.mov` rather than from `Web.mp4`.)*

### 8.2 YouTube Upload Workflow
1. Upload **`renders/final/KR_ClaimTheCity_YouTube.mp4`** (`15.96 Mbps` H.264 High, `320 kbps` AAC, `-14.58 LUFS`, `-1.09 dBTP`) directly to YouTube Studio as **Unlisted** first.
2. Upload **`renders/final/KR_ClaimTheCity_Thumbnail.jpg`** as the custom thumbnail.
3. Upload **`renders/final/KR_ClaimTheCity_ID.srt`** under *Subtitles → Indonesian* (after completing the human subtitle ear-check).
4. Wait for YouTube's automated Copyright / Content ID check to complete while still **Unlisted**:
   - **Never** enroll the video's audio in Content ID or any rights-management system.
   - If an automated music claim appears on `Funky Triplets`, do not panic — follow Mixkit's license procedure by keeping [`assets/audio/LICENSE_RECORDS.md`](../../assets/audio/LICENSE_RECORDS.md) on hand and forwarding the claim details to `team@mixkit.co` before switching visibility to **Public**.

---

## 9. Outstanding Release-Review Blockers

> **Important:** Completing this final export milestone does **not** authorize public publication or distribution. Resolve and sign off on all four items below before switching YouTube to Public or deploying to `https://kelanaria.id`:

- [ ] **1. Human Subjective Audio Review:** Producer/owner listen-through of `KR_ClaimTheCity_YouTube.mp4` or `KR_ClaimTheCity_Web.mp4` on both headphones and smartphone speakers to approve dialogue clarity, music balance, ducking smoothness, SFX levels, and transition continuity.
- [ ] **2. Native Indonesian Subtitle Verification:** Line-by-line ear-check of `KR_ClaimTheCity_ID.srt` and `KR_ClaimTheCity_ID.vtt` against spoken audio (including `gua`/`gue` preference in Cue 9).
- [ ] **3. Brand Logo & Artwork Publication Clearance:** Confirm provenance and external publication authorization for Kelana Ria brand logos and game illustrations per `assets/brands/README.md` (and retain SIL OFL 1.1 font notices in `assets/brands/licenses/`).
- [ ] **4. On-Site Field Clue Verification (Product/Campaign Sign-Off):** Confirm whether the unverified GBK (`030711`) and Sarinah (`242` / `222`) challenge clues noted in `assets/ui/manifest.json` require physical field verification or disclaimer framing prior to external campaign launch.
