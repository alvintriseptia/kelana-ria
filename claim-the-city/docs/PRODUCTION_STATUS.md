# Production Status — Claim the City Promotional Film

## Milestone 3.3 & Milestone 4.0 Complete: Mastered Audio Integrated & Final Delivery Exports Verified

| Area | Status | Notes |
| --- | --- | --- |
| Branch & project isolation | Complete | Exclusively on `campaign/claim-the-city-video`, self-contained in `claim-the-city/`, original footage/photos/UI/brand/reference assets untouched. |
| Locked Visual Composition (`KelanaRia-RoughCut`) | **LOCKED & VERIFIED** | Preserved identically at **`2,508 frames`**, **`30 fps`**, **`83.600s`**, **`1920 × 1080`**, BT.709 SDR. Zero visual, editorial, or timeline changes. |
| Approved Standalone Prototype (`KR-MotionDesign-Test-S07-SH02`) | Preserved | Unchanged at **`6.50s` (`195 frames` @ `30 fps`, `1920 × 1080`)**. |
| Milestone 3.3 — Master Audio Mix (`KR_ClaimTheCity_MasterMix_48k.wav`) | Complete & Integrated | Built deterministically via `scripts/build_audio_mix.py` (`48 kHz / 24-bit` stereo PCM, `4,012,800` samples, **`-14.55 LUFS`**, **`-1.12 dBTP`**, **`4.10 LU` LRA**, zero mid-film silence gaps) and integrated in `KelanaRiaRoughCut.tsx` (`useMasterAudioMix: true`). Gitignored under `assets/audio/mix/`. |
| Archival Master (`renders/final/KR_ClaimTheCity_Master.mov`) | Exported & Verified | `1,426.71 MiB` (`1.39 GiB`), Apple ProRes 422 Standard (`yuv422p10le`, `140.85 Mbps` from lossless PNG frames), uncompressed `48 kHz / 24-bit` Stereo PCM (`pcm_s24le`), BT.709, `+faststart`, **`-14.55 LUFS` / `-1.12 dBTP`**. |
| YouTube Master (`renders/final/KR_ClaimTheCity_YouTube.mp4`) | Exported & Verified | `162.37 MiB`, encoded directly from `Master.mov` — H.264 High L4.1 2-pass VBR **`15.96 Mbps`**, `320 kbps` FDK-AAC `48 kHz` Stereo, BT.709, `+faststart`, **`-14.58 LUFS` / `-1.09 dBTP`**. |
| Website 1080p Embed (`renders/final/KR_ClaimTheCity_Web.mp4`) | Exported & Visually QA'd | `36.66 MiB`, encoded directly from `Master.mov` — H.264 High L4.1 **CRF `25`** (`3.48 Mbps`, visually verified vs CRF 24 on fine text, maps, faces & dark Terowongan Kendal), `192 kbps` FDK-AAC `48 kHz` Stereo, BT.709, `+faststart`, **`-14.58 LUFS` / `-1.12 dBTP`**, `0` black frames. |
| Website 720p Companion (`renders/final/KR_ClaimTheCity_Web_720p.mp4`) | Exported & Verified | `22.89 MiB`, optional lightweight mobile/4G companion encoded directly from `Master.mov` — `1280 × 720`, `30 fps`, CRF `24` (`2.16 Mbps`), `128 kbps` FDK-AAC, BT.709, `+faststart`, **`-14.59 LUFS` / `-1.07 dBTP`**. |
| Indonesian Subtitles (`KR_ClaimTheCity_ID.srt` & `.vtt`) | Exported & Syntax-Verified | `34` colloquial Jakarta Indonesian cues synchronized to locked `timeline.ts` timings (`0` overlaps, max `36` chars/line, separate tracks — not burned in). |
| Campaign Thumbnail (`KR_ClaimTheCity_Thumbnail.jpg`) | Exported & Visually QA'd | `330.5 KiB`, `1920 × 1080` JPEG rendered from `KR-ClaimTheCity-Thumbnail` still (`CampaignThumbnail.tsx`) using approved `KR_S08_PH01.jpg` + official Kelana Ria brand lockup; verified at full resolution and `320px` small preview. |
| Final Delivery Report & Compliance Audit | Complete | Documented in [`docs/FINAL_DELIVERY.md`](./FINAL_DELIVERY.md) and [`../assets/audio/LICENSE_RECORDS.md`](../../assets/audio/LICENSE_RECORDS.md). |

---

## Release Gate — Owner Sign-Off Required Before Public Distribution

Production and export are complete, but **final export does not authorize external/public publication**. Complete the four release-review items tracked in [`docs/FINAL_DELIVERY.md`](./FINAL_DELIVERY.md#9-outstanding-release-review-blockers) before publishing:
1. **Human Subjective Audio Review** on headphones and mobile/laptop speakers (VM has no audio playback monitoring).
2. **Native Indonesian Subtitle Ear-Check** of `KR_ClaimTheCity_ID.srt` and `KR_ClaimTheCity_ID.vtt` against spoken audio.
3. **Brand Logo & Artwork Publication Clearance** confirmation per `assets/brands/README.md`.
4. **GBK / Sarinah Field Clue Verification** confirmation per `assets/ui/manifest.json` (plus keeping `assets/audio/LICENSE_RECORDS.md` on file for YouTube Content ID support via `team@mixkit.co` and never embedding `Funky Triplets` inside the Kelana Ria game application).
