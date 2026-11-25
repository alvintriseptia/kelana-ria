# Campaign Asset Manifest & Audit

## Asset-Serving Arrangement

Prepared campaign media lives at the repository root in `../assets/` (already tracked on `campaign/claim-the-city-video`). To avoid duplicating large media files, `claim-the-city/remotion.config.ts` sets:

```ts
Config.setPublicDir("../assets");
```

All compositions load assets deterministically via `staticFile("<relative-path-inside-assets>")`, mapped centrally in [`src/config/assets.ts`](../src/config/assets.ts). Source files in `../assets/` are never modified.

---

## 1. Approved Footage Mapping (17 Clips)

All 17 clips are **1920 × 1080**, **24 fps** (`H.264`), stereo **AAC 48 kHz** audio.
Disk filenames use `KR_SH##_SH##.mp4` rather than `KR_S##_SH##.mp4` and omit `_V4`/`_V2` suffixes. Direct visual inspection confirmed `KR_SH06_SH03.mp4` is the clean V4 take (smooth pedestrian) and `KR_SH08_SH02.mp4` is the clean V2 take (steady compact camera).

| Storyboard Shot ID | Disk File (`assets/footage/`) | Duration | RMS dB | Peak dB | Rough Cut Gain | Notes |
| --- | --- | ---: | ---: | ---: | ---: | --- |
| `KR_S01_SH01` | `KR_SH01_SH01.mp4` | 7.93s | -27.2 | -8.4 | `1.20` | Quietest clip; lifted gently |
| `KR_S02_SH01` | `KR_SH02_SH01.mp4` | 3.92s | -19.0 | -1.0 | `0.92` | Shorter 3.92s clip; kept full |
| `KR_S03_SH01` | `KR_SH03_SH01.mp4` | 7.93s | -23.8 | -4.2 | `1.05` | Animated paper map |
| `KR_S04_SH01` | `KR_SH04_SH01.mp4` | 5.97s | -21.1 | -2.3 | `0.95` | Green walking |
| `KR_S04_SH02` | `KR_SH04_SH02.mp4` | 5.97s | -19.1 | 0.0 | `0.88` | Yellow walking; peaks near 0 dBFS |
| `KR_S04_SH03` | `KR_SH04_SH03.mp4` | 7.93s | -21.6 | -1.2 | `0.95` | Green inside TransJakarta |
| `KR_S04_SH04` | `KR_SH04_SH04.mp4` | 7.93s | -19.9 | -2.9 | `0.92` | Yellow inside MRT |
| `KR_S05_SH01` | `KR_SH05_SH01.mp4` | 7.93s | -23.9 | -3.0 | `1.08` | GBK arrival & check-in |
| `KR_S05_SH02` | `KR_SH05_SH02.mp4` | 7.93s | -26.7 | -5.6 | `1.18` | Quiet clip; lifted gently |
| `KR_S05_SH04` | `KR_SH05_SH04.mp4` | 7.93s | -25.1 | -4.6 | `1.14` | GBK completion (no SH03 video) |
| `KR_S06_SH01` | `KR_SH06_SH01.mp4` | 7.93s | -20.6 | -2.6 | `0.94` | Bundaran HI photo submission |
| `KR_S06_SH03_V4` | `KR_SH06_SH03.mp4` | 7.93s | -17.5 | -1.3 | `0.84` | Confirmed V4; loudest clip |
| `KR_S07_SH01` | `KR_SH07_SH01.mp4` | 7.93s | -21.3 | -2.4 | `0.95` | Yellow fails Sarinah (`222`) |
| `KR_S07_SH02` | `KR_SH07_SH02.mp4` | 7.93s | -18.9 | -0.4 | `0.88` | Prototype source (`0.94` standalone) |
| `KR_S07_SH04` | `KR_SH07_SH04.mp4` | 7.93s | -20.6 | -0.3 | `0.94` | Sarinah claim + Poin Ganda (no SH03 video) |
| `KR_S08_SH01` | `KR_SH08_SH01.mp4` | 7.93s | -20.0 | -0.4 | `0.92` | Warung reunion + laughter |
| `KR_S08_SH02_V2` | `KR_SH08_SH02.mp4` | 7.93s | -22.9 | -4.8 | `1.00` | Confirmed V2; shutter click at `5.75s` |

**Audio spread finding:** Source RMS loudness spans **9.7 dB** (`-27.2 dB` to `-17.5 dB`). Rough cut applies non-destructive per-clip gain multipliers in `src/config/timeline.ts`; proper loudness mastering will be part of the future sound-design pass.

---

## 2. Photographic Memories (5 Photos)

| Photo ID | File (`assets/photos/`) | Dimensions | Aspect | Narrative Role |
| --- | --- | --- | --- | --- |
| `KR_PH01_MRT` | `KR_PH01_MRT.jpg` | 2400 × 1792 | ~4:3 | Journey (Sari's MRT window shot) |
| `KR_PH02_BUNDARAN_HI` | `KR_PH02_BUNDARAN_HI.jpg` | 2400 × 1792 | ~4:3 | Fictional Bundaran HI challenge photo |
| `KR_PH03_GBK` | `KR_PH03_GBK.jpg` | 2400 × 1792 | ~4:3 | Exploration (candid Arga at GBK) |
| `KR_PH04_KENDAL` | `KR_PH04_KENDAL.jpg` | 2400 × 1792 | ~4:3 | Little moments (candid Naya at Kendal) |
| `KR_S08_PH01` | `KR_S08_PH01.jpg` | 2752 × 1536 | ~16:9 | Friendship (final warung group selfie) |

---

## 3. Game UI Assets (v3 Collection — `assets/ui/`)

Verified against `assets/ui/manifest.json` (`version: 3`, `publicOrigin: "https://kelanaria.id"`):
- **29 full screens** (`780 × 1688`, `RGB` opaque).
- **12 isolated components** (natural crop sizes, `RGB` opaque — no alpha channel; apply matching `borderRadius` clipping in overlays).
- **3 map screens** (`780 × 1688`, `RGB` opaque).

### Compliance & Clean-Asset Audit Findings

1. **Simulation notes in full screenshots (do not display uncropped):**
   - `screens/KR_UI_SARINAH_GREEN_DETAIL.png` contains `"Titik GPS pelataran dipakai untuk simulasi. Akses ruang relief belum diverifikasi."`
   - `screens/KR_UI_GBK_SUCCESS.png` contains `"Area Senayan · Titik simulasi"` and `"menunggu verifikasi lapangan."`
   - `components/KR_COMPONENT_INVITATION.png` labels `"Contoh undangan · kode simulasi"` — never present as a live public invite.
2. **State-sensitive map usage:**
   - `maps/KR_UI_MAP_SARINAH.png` already reflects the post-Poin-Ganda state (`■×2`, `ST · Green Team`). **Must not** be used prior to Sarinah claim + Poin Ganda activation.
   - `maps/KR_UI_MAP_BUNDARAN_HI.png` shows the pre-claim Sudirman–Thamrin corridor (`Jalan Kendal` → `Bundaran HI [ST · Yellow Team]` → `Sarinah [unclaimed ●]`). Cropped cleanly to `x: 20..685, y: 120..1360` with required map attribution preserved (`OpenFreeMap · © OpenMapTiles · © OpenStreetMap contributors`).
3. **Isolated components actively integrated in v1:**
   - `KR_COMPONENT_OPPORTUNITY.png` (636 × 154) — `KR-MotionDesign-Test-S07-SH02`
   - `KR_COMPONENT_POIN_GANDA.png` (684 × 144) — `KR-MotionDesign-Test-S07-SH02`
   - `KR_COMPONENT_CLAIM_SUCCESS.png` (684 × 46) — Rough cut S07 turnaround interlude
   - `KR_COMPONENT_ZONE_NEUTRAL.png` (636 × 198) — Rough cut S07 turnaround interlude
   - `KR_COMPONENT_ZONE_GREEN.png` (636 × 196) — Rough cut S07 turnaround interlude
   - `KR_COMPONENT_TEAM_STANDINGS.png` (684 × 372) — Rough cut S07 & S08 interludes
   - `KR_COMPONENT_RESULT.png` (684 × 236) — Rough cut S08 result interlude

---

## 4. Brand & Style References

- **Brand folder:** `assets/brands/` (note plural `brands/`). Includes PNG symbols (`icon-192/512`, `maskable-192/512`), local WOFF2 fonts (`Barlow Condensed` 700 & `DM Sans` variable), SIL OFL 1.1 license files (`assets/brands/licenses/`), CSS source references, and 4 WebP artwork files.
- **Creative references:** `assets/references/KR_style_Raw_Jakarta.png`, `KR_style_Jakarta_Playground.png`, and `- KR_style_Weekend_Memories.png` (note leading `"- "` in filename).
- **Rights reminder (`assets/brands/README.md`):** Confirm logo/artwork publication clearance with the project owner before external distribution and retain OpenFreeMap / OpenMapTiles / OpenStreetMap credits whenever map tiles appear.

---

## 5. Audio & Intentionally Absent Assets

- **Audio (`assets/audio/music/` and `assets/audio/sfx/`):** Acquired & prepared in Milestone 3.2 (**1 primary music track** `KR_BGM_ClaimTheCity_Main.mp3` + **10 lean tactile SFX WAVs** + `48 kHz / 24-bit` working copies under `working/`), excluded from public Git tracking via `assets/audio/.gitignore`. Full technical inventory and objective analysis live in [`docs/AUDIO_ASSET_MANIFEST.md`](./AUDIO_ASSET_MANIFEST.md); verified Mixkit license records live in [`../assets/audio/LICENSE_RECORDS.md`](../../assets/audio/LICENSE_RECORDS.md). Not yet integrated into the composition until Milestone 3.3.
- **Live footage `KR_S05_SH03` and `KR_S07_SH03`:** Intentionally absent per campaign brief; bridged via concise editorial graphic interludes.
