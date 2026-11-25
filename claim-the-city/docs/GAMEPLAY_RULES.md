# Authoritative Claim the City Gameplay Rules (v3)

All promotional graphics, interludes, and motion prototypes MUST adhere strictly to these corrected rules. Earlier concepts involving temporary landmark ownership or stealing owned landmarks are deprecated and must never appear.

---

## Core Loop

`Explore → Check-in → Challenge → Claim → Control`

## Ownership & Check-in Rules

- **Check-in** verifies physical presence and unlocks an eligible challenge attempt. It does **not** grant ownership, reserve the landmark exclusively, increase landmark count/weight, or change zone control.
- **Unclaimed until solved:** A landmark stays unclaimed during active attempts, failed answers, and pending photo verification. The first eligible successful completion earns ownership.
- **No ownership stealing:** Do not present a normal claim of an unclaimed landmark as taking ownership from a rival team. In `KR_S07_SH02`, Arga's colloquial line *"Sarinah bisa direbut!"* refers to competing for the open landmark; the UI must explicitly communicate **`Relief Sarinah masih bisa diklaim!`** (`BELUM DIKLAIM`).

## Failed Challenges & Cooldown

When Yellow Team fails the Sarinah challenge (`222`):
- **Sarinah remains unclaimed.** Never show Yellow as owning Sarinah.
- Yellow Team enters the proposed **30:00** campaign retry cooldown (`KR_COMPONENT_COOLDOWN.png`).
- Green Team remains eligible to attempt Sarinah.
- No score or ownership changes occur simply because Yellow fails.

## Zone Control vs. Landmark Count vs. Landmark Weight

- **Primary competitive score** = `Zona dikuasai` (number of zones currently controlled), **not** an accumulated point total.
- Each claimed landmark contributes weight (`Bobot landmark`, base = `1`) to its zone.
- Highest positive weight controls a zone; equal positive weights create a **neutral zone** (`Zona netral`).
- Always label clearly (`Zona dikuasai`, `Bobot landmark`, `Landmark dimiliki / diklaim`).

## Poin Ganda (2×)

- Doubles an eligible **already-claimed** landmark's base weight (`1 → 2`) within its zone.
- Does **not** increase total landmarks owned and does **not** directly award an extra zone.
- Must remain **available in inventory (not activated)** during `KR_S07_SH02`, and only activates **after** Green successfully claims Sarinah in `KR_S07_SH04`.

---

## Authoritative Campaign Match Progression

1. **Opening state before Sarinah:**
   - Green owns **GBK** (Senayan, weight 1) → Senayan: Green.
   - Yellow owns **1 landmark in Blok M** → Blok M: Yellow.
   - Yellow owns **Bundaran HI** (Sudirman–Thamrin, weight 1) → Sudirman–Thamrin: Yellow.
   - **Relief Sarinah** & **Terowongan Kendal** are unclaimed.
   - **Standings:** `Green 1 — Yellow 2` (`Zona dikuasai`).
2. **Yellow fails Sarinah (`222`):** Sarinah stays unclaimed; Yellow gets 30:00 cooldown; Green receives opportunity notice (`Relief Sarinah masih bisa diklaim!`).
3. **Green completes Sarinah (`242`) — exact 9-step order:**
   1. Green solves the observation challenge.
   2. Green becomes the first owner of Relief Sarinah (`KR_COMPONENT_CLAIM_SUCCESS.png`).
   3. Sarinah adds weight `1` for Green.
   4. Sudirman–Thamrin local weights become `Green 1 — Yellow 1` → **Zona netral** (`KR_COMPONENT_ZONE_NEUTRAL.png`).
   5. Overall standings become `Green 1 — Yellow 1`.
   6. Green activates **Poin Ganda** on Relief Sarinah.
   7. Sarinah's weight increases from `1` to `2`.
   8. Sudirman–Thamrin local weights become `Green 2 — Yellow 1` → **Green Team controls Sudirman–Thamrin** (`KR_COMPONENT_ZONE_GREEN.png`).
   9. Overall standings become **`Green 2 — Yellow 1`** (`Zona dikuasai`; both teams still own `2 landmark diklaim`, verified in `KR_COMPONENT_TEAM_STANDINGS.png`).
4. **Match conclusion:** The round timer eventually expires (`Waktu ronde habis`), and Green Team wins `2–1` (`KR_COMPONENT_RESULT.png`). Do not imply the match ends immediately upon activating Poin Ganda.

---

## Release-Review & Field-Verification Considerations

- The proposed **GBK gate-code challenge (`030711`)** and **Sarinah relief-counting challenge (`242` / `222`)** still require physical on-site field verification.
- The **30-minute retry cooldown** is a campaign scenario configuration.
- Do not imply these proposed details are field-verified or publicly released, and never fabricate physical signage or relief photography as authentic puzzle evidence.
- Campaign photographs (`KR_PH01–04`, `KR_S08_PH01`) are fictional story memories within the promotional narrative.
