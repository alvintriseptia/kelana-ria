# Claim the City challenge research

Desk review for [issue #85](https://github.com/alvintriseptia/kelana-ria/issues/85), 23 November 2026. The sample cards are editor and field-test material. Their answers, location access, signage, and time estimates still require the checks in [the field protocol](../qa/field-calibration-protocol.md#3-claim-the-city-question-comparison-a17-a21).

## What the official packs offer today

Both v1 packs assign one authored challenge per landmark in `per_landmark` mode. Compact has 10 landmarks and uses 4 multiple-choice questions, 3 typed or numeric answers, and 3 photo proofs. Wide has 17 landmarks and uses 5 multiple-choice questions, 5 typed answers, 3 photo proofs, 2 Standard/Bold choices, 1 timed task, and 1 two-step task. The 7 shared landmarks reuse identical challenges. Each pack also has the same three backup templates, two generic photo proofs and one transit-operator input. Each Standard/Bold pair offers a choice inside one authored challenge. [Compact pack](../../apps/api/packs/official/official-jakarta-compact-claim.pack.json) · [Wide pack](../../apps/api/packs/official/official-jakarta-wide-claim.pack.json)

| Landmark ID | Compact / Wide variants | Current task and likely evidence |
| --- | --- | --- |
| `taman-literasi` | 1 / 1 | Identify amfiteater seating shape by looking at the seating. |
| `blok-m-plaza` | 1 / 1 | Identify a façade marker from the MRT approach. The marker can change with a renovation. |
| `m-bloc` | 1 / 1 | Count kites on a specific mural. An artwork change or partial view can invalidate the answer. |
| `taman-ayodya` | 1 / — | Photograph either a name board or a pond edge. The task verifies a feature with little interpretation. |
| `pasar-mayestik` | 1 / — | Photograph a market or bus-stop sign. Visibility and wording can change. |
| `taman-mataram` | 1 / — | Transcribe the first word on a specific sign. Replacement or another entrance may change the evidence. |
| `plaza-senayan` | 1 / 1 | Identify the direction to rail transit. It relies on a consistent starting orientation and route evidence. |
| `stadion-madya` | 1 / 1 | Photograph the exterior gate sign. Verify the street view and avoid event queues. |
| `velbak-kebayoran` | 1 / 1 | Name the two connected transit modes. It is answerable from memory without reading the interchange. |
| `stasiun-palmerah` | 1 / 1 | Type a westbound KRL destination as the line name. It depends on transit vocabulary and current naming. |
| `dukuh-atas` | — / 1 | Identify the pedestrian link's role or take a Bold photo of a mural or direction sign. |
| `bundaran-hi` | — / 1 | Photograph a monument silhouette from a sidewalk. View, weather and crowding affect feasibility. |
| `sarinah` | — / 1 | Type the building name. The task reduces to reading branding or recalling the name in the prompt. |
| `tanah-abang` | — / 1 | Select the rail lines that meet at the station. Useful transit knowledge, with no required observational evidence. |
| `taman-suropati` | — / 1 | Walk to a second point within five minutes. GPS, pace and access influence the result. |
| `taman-ismail-marzuki` | — / 1 | Photograph one of two exterior façades. The task verifies presence and leaves the architecture open to interpretation. |
| `stasiun-manggarai` | — / 1 | Type the name of the station joining two KRL lines. The landmark title may give it away. |
| `monas-gambir` | — / 1 | Identify what the shape at the top represents or submit a Bold photo of the monument. Visibility and symbolic knowledge are separate demands. |
| `taman-fatahillah` | — / 1 | Identify the building's former use, then photograph a historic façade. The first step depends on interpretation or historical signage. |
| `stasiun-jakarta-kota` | — / 1 | Recall a four-letter nickname. History can enrich the reveal, while the nickname itself may be unfamiliar to visitors. |

The biggest content gap is the lack of a reviewed second option at each landmark. If a player encounters the same challenge again or a sign disappears, the primary assignment has little variety. Photo alternatives can improve visual access when the camera is optional in the replacement path. As a graded task, a photo adds upload and approval time that needs to be measured separately from observation time.

## Patterns worth prototyping

| Pattern | Player interaction | Design tradeoff |
| --- | --- | --- |
| **See and explain** | Locate one stable feature, then choose which explanation fits what is visible. | A short evidence-to-inference question teaches more than naming the shape alone. Check sightlines and use two plausible alternatives. |
| **Compare features** | Compare two parts of a building or public space and identify what stayed the same or changed. | A comparison can make history legible without trivia. Name the two features precisely and avoid exact counts on decorations. |
| **Read a connection** | Use a sign or simple diagram to infer which nearby destinations can be reached through one route. | A sign helps players make a real travel decision. Use the physical connection as the learning goal so a sign update can be handled by an equivalent cue. |
| **Record one detail** | Point out or optionally frame the detail that supports the answer. | Photos work well as an optional memory aid. A required upload adds network, privacy and review friction and should add a meaningful observation. |

Harvard's See, Think, Wonder routine separates direct observation from interpretation and invites learners to explain the evidence behind their interpretation. For a live timed challenge, use an observable detail and a bounded inference for scoring, then offer one short fact after the answer. Smithsonian's object-based adaptation shows how a follow-up can guide attention without giving the answer. [Harvard Project Zero](https://pz.harvard.edu/resources/see-think-wonder) · [Smithsonian adaptation](https://www.si.edu/object/see-think-wonder%3ASCLDA_2052)

EarthCache visits teach a topic through a feature the visitor can examine. The creator guidelines favor comparisons and evidence that requires looking at the place, and discourage simple transcription or research from home. Borrow the observation and source-review pattern for competitive play. A learning task may have a text or diagram equivalent after GPS check-in where vision, crowds or access make the primary cue difficult. [Geocaching EarthCache guidelines, §§4.2–4.4](https://www.geocaching.com/help/index.php?id=19&pg=kb.printer.friendly#earthcaches)

## Sample cards for Compact

These are authored Bahasa Indonesia prototypes for the existing multiple-choice primitive. The review answer and source are for the creator and reviewer. Reveal the short explanation after the attempt. Keep the peer and public preview limited to the clue and choices. Fallbacks use the same check-in and award as the primary prompt after equivalent difficulty is measured.

### Taman Literasi Blok M · Undakan untuk menonton

| Element | Prototype |
| --- | --- |
| **Task** | Lihat baris tempat duduk yang menghadap area pertunjukan. Pilih susunan yang membantu orang di baris belakang melihat panggung. |
| **Choices** | A. Baris belakang lebih tinggi daripada baris depan. B. Semua baris sejajar di permukaan datar. C. Baris belakang lebih rendah daripada baris depan. |
| **Answer and rubric** | A. The player should point to the rise between rows and explain how it helps a view over the row in front. The server can grade the choice. Use the explanation in field observation. |
| **Hint** | Bandingkan tinggi baris yang paling dekat dan yang paling jauh dari panggung. |
| **Learning reveal** | Undakan membuat baris belakang lebih tinggi. Penonton bisa melihat area pertunjukan dari beberapa baris. |
| **Proposed vantage and time** | A level area on the open side of Plaza Kabaresi with a clear view across the seating. Stay beyond the seating and event flow. Estimated 40–60 seconds after check-in. |
| **Fallback** | After GPS check-in, offer a text equivalent of an original side-profile diagram: spot A is level with the viewing area, spot B one step higher, spot C two steps higher. Ask which two positions give the rear audience a higher sightline and use the same reveal. |
| **Evidence** | Jakarta Smart City documents an outdoor amfiteater in the plaza. The current Compact pack describes stepped seating. Check that the seating arrangement described in the task is visible from a step-free path. [Jakarta Smart City](https://smartcity.jakarta.go.id/id/blog/jatuh-hati-taman-literasi-martha-christina-tiahahu/) |

### M Bloc Space · Balkon yang tetap dipakai

| Element | Prototype |
| --- | --- |
| **Task** | Di sisi lobi M Bloc, bandingkan dua unit toko yang berdampingan. Bagian bangunan mana yang masih tampak menyambung di atas pintu toko? |
| **Choices** | A. Kanopi lantai dasar. B. Balkon lantai atas. C. Papan nama toko. |
| **Answer and rubric** | B. From the selected outer view, the two units should have an adjoining upper balcony. The player should describe what the balcony joins. |
| **Hint** | Lihat satu tingkat di atas nama toko. |
| **Learning reveal** | Dua unit ini dulunya bagian dari deretan rumah dinas Peruri. Balkon yang menyambung menunjukkan bagaimana bentuk rumah lama masih bisa terlihat saat ruangnya dipakai sebagai toko. |
| **Proposed vantage and time** | The wide public pedestrian frontage beside the main lobby. Choose a verified pair visible from the same point without entering a tenant or crossing a vehicle entrance. Estimated 45–70 seconds after check-in. |
| **Fallback** | Use an original text-and-line drawing of two adjacent units from that view. It describes two distinct street-level doors and one upper horizontal platform connecting the bays. Ask which feature joins the units above the entrances. |
| **Evidence** | The project owner describes two-storey former employee houses, while the field-based architecture paper describes their adjoining balconies and documents the frontage changes in figures 11–13. A recent relaunch makes checking the chosen pair important. [Peruri project description](https://www.peruri.co.id/press-release/m-bloc-dari-gudang-produksi-uang-menuju-ruang-kreatif-generasi-milenial-2) · [Prianggara and Pratiwi, Arsitektura](https://jurnal.uns.ac.id/Arsitektura/article/download/71864/40493) · [Peruri relaunch](https://www.peruri.co.id/press-release/peruri-sebagai-pemilik-lahan-dukung-peluncuran-wajah-baru-m-bloc-space) |

### Skywalk Velbak–Kebayoran · Pindah dari bus ke kereta

| Element | Prototype |
| --- | --- |
| **Task** | Bayangkan kamu turun dari bus di Velbak dan ingin pindah ke kereta. Lihat petunjuk arah dari area pejalan kaki. Tujuan mana yang perlu kamu ikuti? |
| **Choices** | A. Halte Pasar Kebayoran Lama. B. Halte Velbak. C. Stasiun Kebayoran. |
| **Answer and rubric** | C. The player should identify the station destination and describe a rail symbol, direction, or name on the observed sign that supports their choice. The two bus destinations serve as comparison choices. |
| **Hint** | Cari tujuan yang bertanda stasiun atau Commuter Line. |
| **Learning reveal** | Skywalk menghubungkan kereta di Stasiun Kebayoran dengan dua halte Transjakarta. Jembatan ini memudahkan perpindahan antara bus dan kereta. |
| **Proposed vantage and time** | A wide, public approach to the Velbak end of the bridge, outside paid barriers. Confirm the initial sign and a step-free sidewalk or landing before selecting the exact point. Estimated 45–75 seconds after check-in. |
| **Fallback** | Present a text route card after check-in. From Velbak, route A reaches a Commuter Line station, and route B continues to another Transjakarta stop. Use destination names as selectable answers so the player still interprets a real interchange. |
| **Evidence** | Jakarta Smart City identifies the two bus stops and the railway station as connected destinations. Confirm the wording, visibility and accessibility of the sign before use. [Jakarta Smart City](https://smartcity.jakarta.go.id/id/blog/menjelajahi-skywalk-kebayoran-lama/) · [DKI Jakarta Secretariat](https://biroumum.jakarta.go.id/news_web/detailnews/pj-gubernur-heru-terima-penghargaan-apresiasi-tokoh-indonesia-untuk-percepatan-infrastruktur) |

## Desk review scores and field decisions

Score each dimension from 0 to 2. A 0 denotes a material gap, a 1 means a plausible design with a condition to check, and a 2 means the wording and sources support the task for desk review. **Answer clarity** asks whether one answer follows from the cue. **Local relevance** asks whether explaining it teaches something distinctive at the point. **Accessibility** checks a plausible step-free view and an equivalent text option. **Comparable effort** checks that the steps have similar estimated search and answer time across variants.

| Candidate | Answer clarity | Local relevance | Accessibility | Comparable effort | Field decision still needed |
| --- | --- | --- | --- | --- | --- |
| Taman Literasi | 2 | 2 | 1 | 1 | Verify stepped rows from a ground-level view during ordinary hours and during an event. |
| M Bloc | 1 | 2 | 1 | 1 | Mark the exact pair of visibly joined units and check that crowds, signage or the canopy do not hide the balcony. |
| Velbak | 1 | 2 | 1 | 1 | Record the exact station name and rail symbol visible outside paid access. Verify the approach and access to a useful fallback. |

Use the [field question comparison](../qa/field-calibration-protocol.md#3-claim-the-city-question-comparison-a17-a21) to compare the current prompt, a sample card and its fallback. Revise candidates with ambiguous evidence, a location that requires unsafe positioning, or substantially different effort across variants. Review the result with [issue #14](https://github.com/alvintriseptia/kelana-ria/issues/14). Use the same evidence, hint, fallback, review date and learning-reveal fields in creator previews under [issue #90](https://github.com/alvintriseptia/kelana-ria/issues/90).
