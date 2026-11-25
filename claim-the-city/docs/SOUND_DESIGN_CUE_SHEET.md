# Sound Design Cue Sheet — Kelana Ria: *Claim the City* (Milestone 4.1 — `99.67s` / `2,990f`)

> **Timeline Reference:** Active Milestone 4.1 narrative-clarity revision (`2,990 frames` @ `30 fps` = `99.67s` / `01:39.67`).  
> **Previous Archived Cue Sheet:** [`docs/SOUND_DESIGN_CUE_SHEET.83.6s-m4.backup.md`](./SOUND_DESIGN_CUE_SHEET.83.6s-m4.backup.md) (`2,508f` / `83.60s`).  
> **Sonic Identity:** Tactile *Jakarta Playground* tabletop/board-game foley (paper, rubber stamp, card deal, subtle organic marimba ping, mechanical wall clock, warm desk bell). Zero sci-fi lasers, zero arcade bleeps, zero duplicate camera shutters.

---

## 1. Preserved Native Footage Audio Cues (Never Replaced or Duplicated)

| Event | Segment | Global Frame & Time | Source Moment | Handling in Mix (`scripts/build_audio_mix.py`) |
| --- | --- | --- | --- | --- |
| **Paper map subtle rustle** | `S03_SH01` | `f261–f270` (`00:08.70–00:09.00`) | `KR_SH03_SH01.mp4` `1.20–1.50s` | Newly restored with `0.60s` lead-in; kept natural under music groove |
| **Bundaran HI camera shutter** | `S06_SH01` | `f1460–f1462` (`00:48.67–00:48.73`) | `KR_SH06_SH01.mp4` `3.95s` | Preserved raw; zero synthetic shutter layered (`sfx_paper_slide_soft` slips in cleanly at `f1461`) |
| **Warung ambience J-cut** | `S08_SH01` | `f2392–f2410` (`01:19.73–01:20.33`) | `KR_SH08_SH02.mp4` `0.05–0.65s` | Dynamic `14f` pre-roll + `4f` crossfade bridging match conclusion into warung reunion |
| **Selfie shutter + L-cut laughter** | `S08_SH02_V2` → `S08_MONTAGE` | `f2726–f2768` (`01:30.87–01:32.27`) | `KR_SH08_SH02.mp4` `5.75s` + `5.77–7.17s` | Native double shutter + `1.40s` group laughter L-cut preserved seamlessly into Weekend Memories montage |

---

## 2. Phrase-Aligned Musical Arrangement (`Funky Triplets` — Michael Ramir C., Mixkit `#1141`, `100.0 BPM` / `2.400s` Bar Grid)

| Region | Campaign Window | Track Source Window | Musical Role & Phrase Justification |
| --- | --- | --- | --- |
| **Region A1** | `00:07.50 – 00:36.90` (`29.46s`) | `0:04.20 – 0:33.66` (`B02–B13`, 12 full bars) | `1`-beat pickup (`0:04.20`) lands Bar 2 downbeat (`0:04.80`) dead-on `S03_SH01` map reveal (`00:08.10` / `f243`), playing 12 uninterrupted bars through `S03`, `S04`, `S05_SH01` Q&A, and `S05_SH02` Gate H discovery. |
| **Region A2** | `00:36.88 – 00:59.27` (`22.44s`) | `0:24.00 – 0:46.44` (`B10–B19`) | Exact **4-bar phrase repeat** (`Bar 14 → Bar 10` downbeat at `00:36.90`) extending the conversational groove seamlessly across `S05_SH04` GBK solve/claim, `S06_SH01` Bundaran HI, and `S06_SH03` Kendal lead into `JAWABAN SALAH`. |
| **Region B** | `00:59.19 – 01:13.27` (`14.08s`) | `0:54.70 – 1:08.78` (`Breakdown #1` → `B24–B28`) | Clean Breakdown #1 drop on `JAWABAN SALAH` (`00:59.23` / `f1777`); Bar 24 groove re-entry (`0:57.60`) lands dead-on Opportunity + *"Bentar!"* (`01:02.10` / `f1863`), driving through `POIN GANDA` & Sarinah comeback. |
| **Region C** | `01:13.17 – 01:19.97` (`6.80s`) | `1:21.57 – 1:28.37` (`B34–B36` Peak Chorus) | Peak Chorus downbeat (`1:21.60`) lands dead-on `INT_MATCH_CONCLUSION` (`01:13.20` / `f2196`), energizing the map flip, accelerated clock, and `GREEN TEAM MENANG`, tapering into the warung J-cut (`01:19.73`). |
| **Region D** | `01:19.71 – 01:32.16` (`3×` loop) | `1:17.35 – 1:21.55` (`Breakdown #2`, zero drums) | Warm zero-drum melodic pocket looped `3×` across the warung reunion (`S08_SH01–SH02`) with gentle breath on the selfie countdown & shutter (`01:30.87`). |
| **Region E** | `01:31.87 – 01:39.07` (`7.20s`) | `1:40.27 – 1:47.47` (`B42–B44` Final Chorus) | Blooms cleanly after L-cut laughter through Weekend Memories montage so the track's **native final button (`1:45.60`)** hits dead-on `SEGERA HADIR` (`01:37.20` / `f2916`), decaying cleanly to digital silence (`01:38.58–01:39.67`). |

---

## 3. Onset-Locked Tactile SFX Cues (`23` Placements Using `10` Mixkit Assets)

*(All timestamps are derived dynamically from `seg_starts` in `scripts/build_audio_mix.py` and onset-trimmed per Milestone 3.2 acoustic measurements.)*

| # | Global Frame | Timecode | Segment + Local Frame | Visual Event | SFX Asset (`working/*_48k.wav`) | Level / Treatment |
| ---: | ---: | --- | --- | --- | --- | --- |
| 1 | `f233` | `00:07.77` | `S02_SH01` (`-10f` to S03) | Paper-edge wipe into map | `sfx_paper_wipe` (`#1105`) | `-7.5 dB`, pan `+0.08`, `0.65s` |
| 2 | `f249` | `00:08.30` | `S03_SH01` `+6f` | `CLAIM THE CITY` title banner drop | `sfx_card_deal` (`#2002`) | `-4.0 dB`, center, `0.35s` |
| 3 | `f367` | `00:12.23` | `S03_SH01` `+124f` | `KUASAI ZONA TERBANYAK` objective reveal *(new M4.1)* | `sfx_paper_slide_soft` (`#1530`) | `-13.0 dB` (subtle under Arga), center |
| 4 | `f786` | `00:26.20` | `S05_SH01` `+26f` | `✓ CHECK-IN BERHASIL` (modest non-ownership) | `sfx_tactile_ping` (`#1107`) | `-11.5 dB`, pan `+0.15`, `0.60s` |
| 5 | `f892` | `00:29.73` | `S05_SH01` `+132f` | `TANTANGAN TERBUKA · CARI KODE DI 3 GATE` *(new M4.1)* | `sfx_card_deal` (`#2002`) | `-9.5 dB`, pan `+0.15`, `0.32s` |
| 6 | `f1072` | `00:35.73` | `S05_SH02` `+105f` | `GATE H ✓` discovery tick (*"Lah, ini udah H!"*) *(new M4.1)* | `sfx_tactile_ping` (`#1107`) | `-13.0 dB`, pan `-0.15`, `+2st` |
| 7 | `f1314` | `00:43.80` | `S05_SH04` `+146f` | `✓ TANTANGAN SELESAI` completion chime *(new M4.1)* | `sfx_tactile_ping` (`#1107`) | `-12.0 dB`, center, `+2st` |
| 8 | `f1338` | `00:44.60` | `S05_SH04` `+170f` | Distinct `GELORA BUNG KARNO · DIKLAIM GREEN` stamp | `sfx_stamp_claim` (`#2182`) | `-6.5 dB`, center, `0.32s` |
| 9 | `f1461` | `00:48.70` | `S06_SH01` `+80f` | Bundaran HI proof card enters *(preserves native shutter!)* | `sfx_paper_slide_soft` (`#1530`) | `-12.0 dB`, pan `+0.15`, `0.45s` |
| 10 | `f1499` | `00:49.97` | `S06_SH01` `+118f` | `TERVERIFIKASI ✓` stamp | `sfx_tactile_ping` (`#1107`) | `-11.5 dB`, pan `+0.15`, `+2st` |
| 11 | `f1525` | `00:50.83` | `S06_SH01` `+144f` | `BUNDARAN HI · DIKLAIM YELLOW` stamp | `sfx_stamp_claim` (`#2182`) | `-8.0 dB`, pan `+0.15`, `0.32s` |
| 12 | `f1585` | `00:52.83` | `S06_SH03_V4` `+36f` | Scoreboard Yellow `2` emphasis | `sfx_score_flip` (`#2857`) | `-8.5 dB`, pan `+0.15`, `0.25s` |
| 13 | `f1777` | `00:59.23` | `S07_SH01` `+46f` | `JAWABAN SALAH` failure card | `sfx_wrong_thud` (`#2569`) | `-7.0 dB`, pan `+0.15`, `0.35s` |
| 14 | `f1860` | `01:02.00` | `S07_SH02` `+9f` | Sarinah Opportunity pre-lap (`-3f` before *"Bentar!"*) | `sfx_tactile_ping` (`#1107`) | `-11.0 dB`, pan `+0.15`, `+1st` |
| 15 | `f1863` | `01:02.10` | `S07_SH02` `+12f` | Sarinah Opportunity dispatch ticket slide | `sfx_paper_slide_soft` (`#1530`) | `-13.0 dB`, pan `+0.15`, `0.40s` |
| 16 | `f1892` | `01:03.07` | `S07_SH02` `+41f` | `BELUM DIKLAIM` stamp | `sfx_stamp_claim` (`#2182`) | `-9.5 dB`, pan `+0.15`, `0.30s` |
| 17 | `f1965` | `01:05.50` | `S07_SH02` `+114f` | `POIN GANDA · TERSEDIA` card deal | `sfx_card_deal` (`#2002`) | `-4.0 dB`, pan `+0.15`, `0.35s` |
| 18 | `f2061` | `01:08.70` | `S07_SH04` `+15f` | `RELIEF SARINAH` claimed (`Netral 1–1`) | `sfx_stamp_claim` (`#2182`) | `-8.0 dB`, pan `+0.15`, `0.30s` |
| 19 | `f2090` | `01:09.67` | `S07_SH04` `+44f` | `POIN GANDA` card tabletop return | `sfx_card_deal` (`#2002`) | `-5.5 dB`, pan `+0.15`, `0.35s` |
| 20 | `f2104` | `01:10.13` | `S07_SH04` `+58f` | **3-Layer `POIN GANDA` Activation (`1 → 2`)** | `sfx_card_deal` (`+0ms`) + `sfx_score_flip` (`+30ms`) + `sfx_poin_ganda_activate` (`+40ms`) | `-5.0 / -7.5 / -6.5 dB`, signature hero stack |
| 21 | `f2160` | `01:12.00` | `S07_SH04` `+114f` | Green Takeover `2–1` score lock | `sfx_score_flip` (`#2857`) | `-8.0 dB`, pan `+0.15`, `+2st` |
| 22 | `f2200` | `01:13.33` | `INT_MATCH` `+4f` | **2-Layer Sudirman–Thamrin Territory Flip** | `sfx_paper_wipe` (`+0ms`) + `sfx_poin_ganda_activate` (`+80ms`, LPF `2.4 kHz`) | `-6.5 / -9.5 dB`, pan `-0.12/-0.08` |
| 23a | `f2274–f2326` | `01:15.80–01:17.53` | `INT_MATCH` `+78..+130f` | Accelerated Match Timer (`102:00 → 00:00`) | `sfx_timer_sweep` (`#1063`, 12 accelerating tick-tocks) | `-9.0 → -6.5 dB` crescendo, center |
| 23b | `f2326` | `01:17.53` | `INT_MATCH` `+130f` | `00:00 · WAKTU RONDE HABIS` / `GREEN TEAM MENANG` | `sfx_round_bell` (`#931`, `-2.5 dB` warm shelf @ `5.2 kHz`) | `-8.5 dB`, center, `1.15s` |
| 23c | `f2750, f2774, f2798` | `01:31.67, 01:32.47, 01:33.27` | `S08_MONTAGE` `+24,+48,+72f` | Weekend Memories matte print settles | `sfx_paper_slide_soft` (`#1530`) | `-19.0 / -16.0 / -15.5 dB` |
