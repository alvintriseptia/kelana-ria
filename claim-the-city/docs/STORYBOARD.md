# Master Campaign Storyboard — Rough Cut V4 (Final Match Conclusion Pacing)

- **Composition ID:** `KelanaRia-RoughCut` (`1920 × 1080`, `30 fps`)
- **Revised Runtime Requirement:** Preferred **`75–85s`** (~84s natural V4 expansion; 90s suggested max), superseding the earlier 60-second constraint.
- **Dynamically Calculated Runtime:** **`83.60s` (`1m 23.60s` / `2,508 frames`)**
- **Single Active Timeline:** [`src/config/timeline.ts`](../src/config/timeline.ts)
- **Archived Timelines:**
  - Extended assembly (`140.10s` / `4,203f`): [`src/config/timeline.extended-140s.backup.ts`](../src/config/timeline.extended-140s.backup.ts)
  - Compressed V1 (`60.00s` / `1,800f`): [`src/config/timeline.60s-v1.backup.ts`](../src/config/timeline.60s-v1.backup.ts)
  - Pacing refinement V2 (`82.00s` / `2,460f`): [`src/config/timeline.82s-v2.backup.ts`](../src/config/timeline.82s-v2.backup.ts)
  - Editorial correction V3 (`81.80s` / `2,454f`): [`src/config/timeline.82s-v3.backup.ts`](../src/config/timeline.82s-v3.backup.ts)

---

## Scene Duration Summary (V4)

| Scene | Title | V3 Duration | V4 Duration | Frames (`30 fps`) | Timeline Window |
| --- | --- | ---: | ---: | ---: | --- |
| `S01` | Weekend routine | 4.90s | **4.90s** | `147f` | `00:00.00 – 00:04.90` |
| `S02` | Game introduction | 3.20s | **3.20s** | `96f` | `00:04.90 – 00:08.10` |
| `S03` | Claim the City | 5.10s | **5.10s** | `153f` | `00:08.10 – 00:13.20` |
| `S04` | Transportation | 9.53s | **9.53s** | `286f` | `00:13.20 – 00:22.73` |
| `S05` | GBK challenge | 8.60s | **8.60s** | `258f` | `00:22.73 – 00:31.33` |
| `S06` | Competitive tension | 10.30s | **10.30s** | `309f` | `00:31.33 – 00:41.63` |
| `S07` | Tactical comeback (live-action) | 15.50s | **15.50s** | `465f` | `00:41.63 – 00:57.13` |
| `S07–S08` | Match conclusion (`INT_MATCH_CONCLUSION`) | 5.20s | **7.00s** | `210f` | `00:57.13 – 01:04.13` |
| `S08` | Weekend Memories (warung + montage) | 15.47s | **15.47s** | `464f` | `01:04.13 – 01:19.60` |
| `S09` | Brand reveal | 4.00s | **4.00s** | `120f` | `01:19.60 – 01:23.60` |
| **Total** | | **81.80s** | **83.60s** | **`2,508f`** | **`00:00.00 – 01:23.60`** |

*(All scenes outside `INT_MATCH_CONCLUSION` and the `S08_SH01` warung J-cut remain byte-for-byte identical to V3.)*

---

## V4 Continuous Match Conclusion & Warung Transition (`00:57.13 – 01:04.50`)

- **Single Continuous Canvas (`INT_MATCH_CONCLUSION`, `7.00s` / `210f` | `00:57.13 – 01:04.13`):** Replaces separate V3 slide interludes (`INT_S07_LEAD_LOCK` + `INT_S08_RESULT`) with one cohesive canvas anchored by a persistent top bar (`CLAIM THE CITY`, live status badge, and real app-style `SISA WAKTU` match clock):
  1. **Phase 1 — Green Takes the Lead (`f0–f74`, `~2.50s` | `00:57.13 – 00:59.60`):** Holds `ZONA DIKUASAI: GREEN 2 — YELLOW 1` with `KR_COMPONENT_ZONE_GREEN.png` (`Sudirman–Thamrin · Green Team · Bobot Green 2 · Yellow 1`) and clock steady at `102:00`.
  2. **Phase 2 — Continuous Passage of Match Time (`f75–f134`, `~2.00s` | `00:59.63 – 01:01.60`):** Smoothly crossfades into an accelerated tabular match clock counting down `102:00 → 00:00` (`f78–f130`, `Easing.inOut(Easing.cubic)`) with a deterministic round-progress bar (`32% → 100%`) and calm `Green 2 Zona — Yellow 1 Zona` strip so taking the lead never implies immediate game expiry.
  3. **Phase 3 — Unified Match Expiry & Victory Announcement (`f135–f210`, `~2.50s` | `01:01.63 – 01:04.13`):** Unifies `00:00 · WAKTU RONDE HABIS` header and prominent `PEMENANG · GREEN TEAM` announcement (`Penentu kemenangan · Zona yang dikuasai`) with readable `GREEN TEAM (2)` / `YELLOW TEAM (1)` zone scoreboxes (`2 landmark` per team).
- **Natural Warung Reunion J-Cut (`S08_SH01`, visual cut at `01:04.13`):** Pre-rolls `0.47s` (`14f`) of clean warung room/street ambience (`KR_SH08_SH02.mp4` `0.05s–0.65s`, zero speech) beginning at `01:03.67` with a `4f` (`0.13s`) crossfade across the cut into `S08_SH01`, easing naturally into Naya's *"Minggu depan main lagi, yuk."*
