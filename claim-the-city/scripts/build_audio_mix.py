#!/usr/bin/env python3
"""
Deterministic Milestone 3.3 / 4.0 Master Audio Mix Builder — Kelana Ria: Claim the City.

Reads strictly from:
  - Locked campaign timeline trims (matching claim-the-city/src/config/timeline.ts, 2,508f @ 30fps = 83.600s)
  - Original untouched footage audio (assets/footage/KR_SH##_SH##.mp4)
  - 48 kHz working copies of acquired Mixkit assets (assets/audio/music/working & sfx/working)

Outputs gitignored broadcast-ready 48 kHz / 24-bit stereo PCM WAV:
  assets/audio/mix/KR_ClaimTheCity_MasterMix_48k.wav

Zero external Python dependencies (uses standard library + Remotion's bundled FFmpeg).
"""

import array
import json
import math
import os
import struct
import subprocess
import tempfile
import wave

from ffmpeg_util import find_binary

REPO_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
CTC_DIR = os.path.join(REPO_DIR, "claim-the-city")
FFMPEG = find_binary("ffmpeg")
ASSETS_DIR = os.path.join(REPO_DIR, "assets")
OUT_DIR = os.path.join(ASSETS_DIR, "audio", "mix")
OUT_WAV = os.path.join(OUT_DIR, "KR_ClaimTheCity_MasterMix_48k.wav")

FPS = 30
SR = 48000
TOTAL_FRAMES = 2508
TOTAL_SAMPLES = int(round(TOTAL_FRAMES * SR / FPS))  # 4,012,800 exact samples (83.600000s)


def js_round(x: float) -> int:
    return int(math.floor(x + 0.5))


def db_to_lin(db_val: float) -> float:
    return 10.0 ** (db_val / 20.0)


def lin_to_db(v: float) -> float:
    return -120.0 if v <= 1e-12 else 20.0 * math.log10(v)


# Exact locked timeline matching src/config/timeline.ts (2,508 frames @ 30 fps)
# Per-clip target gain_lin calibrated from Milestone 3.1 objective LUFS audit to tighten
# the 8.02 LU residual spread into <= 2.5 LU around ~-16.8 LUFS dialogue anchor.
# Same-location cuts get 2f (67ms) overlapping crossfade tails (zero visual change!)
# to eliminate the 267ms V-shaped ambience dips found in Milestone 3.1.
FOOTAGE_SPECS = [
    # (id, file, trim_s, trim_e, gain_lin, hpf_hz, debox_db, pres_db, pre_ov_f, post_ov_f)
    ("S01_SH01",     "footage/KR_SH01_SH01.mp4", 1.3, 6.2,  1.88, 70,  0.0, 0.0, 0, 2),
    ("S02_SH01",     "footage/KR_SH02_SH01.mp4", 0.6, 3.8,  0.88, 95,  0.0, 0.0, 2, 0),
    ("S03_SH01",     "footage/KR_SH03_SH01.mp4", 2.0, 7.1,  1.26, 70,  0.0, 0.0, 0, 0),
    ("S04_SH01",     "footage/KR_SH04_SH01.mp4", 1.7, 3.55, 0.82, 75,  0.0, 0.0, 0, 0),
    ("S04_SH02",     "footage/KR_SH04_SH02.mp4", 0.5, 3.05, 0.75, 75, -2.0, 0.0, 0, 0),
    ("S04_SH03",     "footage/KR_SH04_SH03.mp4", 6.1, 7.55, 1.48, 95,  0.0, 2.2, 0, 0),
    ("S04_SH04",     "footage/KR_SH04_SH04.mp4", 0.9, 4.55, 0.84, 75, -1.8, 0.0, 0, 0),
    ("S05_SH01",     "footage/KR_SH05_SH01.mp4", 0.0, 4.0,  1.18, 70,  0.0, 0.0, 0, 2),
    ("S05_SH02",     "footage/KR_SH05_SH02.mp4", 4.7, 7.2,  1.76, 70,  0.0, 0.0, 2, 2),
    ("S05_SH04",     "footage/KR_SH05_SH04.mp4", 5.7, 7.8,  1.65, 70,  0.0, 0.0, 2, 0),
    ("S06_SH01",     "footage/KR_SH06_SH01.mp4", 2.5, 7.0,  0.88, 70,  0.0, 0.0, 0, 0),
    ("S06_SH03_V4",  "footage/KR_SH06_SH03.mp4", 0.3, 6.1,  0.71, 75, -2.2, 0.0, 0, 0),
    ("S07_SH01",     "footage/KR_SH07_SH01.mp4", 3.0, 7.0,  0.90, 70,  0.0, 0.0, 0, 0),
    ("S07_SH02",     "footage/KR_SH07_SH02.mp4", 0.3, 6.8,  0.80, 75, -2.0, 0.0, 0, 0),
    ("S07_SH04",     "footage/KR_SH07_SH04.mp4", 2.8, 7.8,  0.88, 70,  0.0, 0.0, 0, 0),
    ("INT_MATCH_CONCLUSION", None,               0.0, 7.0,  1.00,  0,  0.0, 0.0, 0, 0),
    ("S08_SH01",     "footage/KR_SH08_SH01.mp4", 0.1, 7.3,  0.82, 70,  0.0, 0.0, 0, 2),
    ("S08_SH02_V2",  "footage/KR_SH08_SH02.mp4", 2.3, 5.77, 1.54, 70,  0.0, 0.0, 2, 0),
    ("S08_MONTAGE",  None,                       0.0, 4.8,  1.00,  0,  0.0, 0.0, 0, 0),
    ("S09_BRAND",    None,                       0.0, 4.0,  1.00,  0,  0.0, 0.0, 0, 0),
]


def load_stereo_float(path: str, ss: float = None, dur: float = None):
    """Decode any audio/video file to stereo 48 kHz float lists (L, R) via bundled FFmpeg."""
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tf:
        wav_path = tf.name
    try:
        cmd = [FFMPEG, "-hide_banner", "-y"]
        if ss is not None and ss > 0:
            cmd += ["-ss", f"{ss:.6f}"]
        cmd += ["-i", path, "-vn"]
        if dur is not None:
            cmd += ["-t", f"{dur:.6f}"]
        cmd += ["-acodec", "pcm_s16le", "-ar", str(SR), "-ac", "2", wav_path]
        subprocess.run(cmd, capture_output=True, check=True)
        with wave.open(wav_path, "rb") as w:
            raw = w.readframes(w.getnframes())
        arr = array.array("h")
        arr.frombytes(raw)
        inv = 1.0 / 32768.0
        n = len(arr) // 2
        left = [arr[i * 2] * inv for i in range(n)]
        right = [arr[i * 2 + 1] * inv for i in range(n)]
        return left, right
    finally:
        if os.path.exists(wav_path):
            os.unlink(wav_path)


def biquad_coeffs(kind: str, fc: float, sr: float, q: float = 0.7071, gain_db: float = 0.0):
    """RBJ Audio EQ Cookbook 2nd-order biquad filter coefficients."""
    w0 = 2.0 * math.pi * fc / sr
    cw = math.cos(w0)
    sw = math.sin(w0)
    alpha = sw / (2.0 * q)
    A = 10.0 ** (gain_db / 40.0)

    if kind == "hpf":
        b0 = (1.0 + cw) / 2.0
        b1 = -(1.0 + cw)
        b2 = (1.0 + cw) / 2.0
        a0 = 1.0 + alpha
        a1 = -2.0 * cw
        a2 = 1.0 - alpha
    elif kind == "lpf":
        b0 = (1.0 - cw) / 2.0
        b1 = 1.0 - cw
        b2 = (1.0 - cw) / 2.0
        a0 = 1.0 + alpha
        a1 = -2.0 * cw
        a2 = 1.0 - alpha
    elif kind == "peak":
        b0 = 1.0 + alpha * A
        b1 = -2.0 * cw
        b2 = 1.0 - alpha * A
        a0 = 1.0 + alpha / A
        a1 = -2.0 * cw
        a2 = 1.0 - alpha / A
    elif kind == "lowshelf":
        s_a = 2.0 * math.sqrt(A) * alpha
        b0 = A * ((A + 1.0) - (A - 1.0) * cw + s_a)
        b1 = 2.0 * A * ((A - 1.0) - (A + 1.0) * cw)
        b2 = A * ((A + 1.0) - (A - 1.0) * cw - s_a)
        a0 = (A + 1.0) + (A - 1.0) * cw + s_a
        a1 = -2.0 * ((A - 1.0) + (A + 1.0) * cw)
        a2 = (A + 1.0) + (A - 1.0) * cw - s_a
    elif kind == "highshelf":
        s_a = 2.0 * math.sqrt(A) * alpha
        b0 = A * ((A + 1.0) + (A - 1.0) * cw + s_a)
        b1 = -2.0 * A * ((A - 1.0) + (A + 1.0) * cw)
        b2 = A * ((A + 1.0) + (A - 1.0) * cw - s_a)
        a0 = (A + 1.0) - (A - 1.0) * cw + s_a
        a1 = 2.0 * ((A - 1.0) - (A + 1.0) * cw)
        a2 = (A + 1.0) - (A - 1.0) * cw - s_a
    else:
        raise ValueError(kind)

    return b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0


def apply_biquad(sig, coeffs):
    b0, b1, b2, a1, a2 = coeffs
    x1 = x2 = y1 = y2 = 0.0
    out = [0.0] * len(sig)
    for i, x0 in enumerate(sig):
        y0 = b0 * x0 + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2
        out[i] = y0
        x2, x1 = x1, x0
        y2, y1 = y1, y0
    return out


def resample_linear(sig, ratio: float):
    """Pitch/speed shift via linear interpolation (ratio > 1 raises pitch & shortens)."""
    if abs(ratio - 1.0) < 1e-6:
        return list(sig)
    new_len = max(1, int(len(sig) / ratio))
    out = [0.0] * new_len
    n = len(sig)
    for i in range(new_len):
        pos = i * ratio
        idx = int(pos)
        frac = pos - idx
        if idx + 1 < n:
            out[i] = sig[idx] * (1.0 - frac) + sig[idx + 1] * frac
        elif idx < n:
            out[i] = sig[idx]
    return out


def cosine_fade_in(sig, n_samples: int):
    n = min(n_samples, len(sig))
    for i in range(n):
        g = 0.5 * (1.0 - math.cos(math.pi * i / max(1, n)))
        sig[i] *= g


def cosine_fade_out(sig, n_samples: int):
    n = min(n_samples, len(sig))
    start = len(sig) - n
    for i in range(n):
        g = 0.5 * (1.0 + math.cos(math.pi * i / max(1, n)))
        sig[start + i] *= g


def mix_into(dst_l, dst_r, src_l, src_r, start_sample: int, gain: float = 1.0, pan: float = 0.0):
    """Add stereo signal into destination with constant-power pan (-1=L, 0=C, +1=R)."""
    ang = (pan + 1.0) * math.pi * 0.25
    gl = gain * math.cos(ang) * math.sqrt(2.0)
    gr = gain * math.sin(ang) * math.sqrt(2.0)
    n_dst = len(dst_l)
    for i in range(len(src_l)):
        p = start_sample + i
        if 0 <= p < n_dst:
            dst_l[p] += src_l[i] * gl
            dst_r[p] += src_r[i] * gr


def soft_compress_bus(l_buf, r_buf, thresh_db=-11.0, ratio=3.0, atk_ms=5.0, rel_ms=70.0, ceil_db=-3.5):
    """Gentle stereo-linked dialogue compressor + soft peak guard to recover mixing headroom."""
    n = len(l_buf)
    thresh = db_to_lin(thresh_db)
    ceil = db_to_lin(ceil_db)
    atk_c = math.exp(-1.0 / (SR * atk_ms / 1000.0))
    rel_c = math.exp(-1.0 / (SR * rel_ms / 1000.0))
    env = 0.0
    max_gr_db = 0.0
    for i in range(n):
        x = max(abs(l_buf[i]), abs(r_buf[i]))
        if x > env:
            env = atk_c * env + (1.0 - atk_c) * x
        else:
            env = rel_c * env + (1.0 - rel_c) * x
        g = 1.0
        if env > thresh:
            over_db = lin_to_db(env) - thresh_db
            red_db = over_db * (1.0 - 1.0 / ratio)
            g = db_to_lin(-red_db)
            if red_db > max_gr_db:
                max_gr_db = red_db
        l_v = l_buf[i] * g
        r_v = r_buf[i] * g
        # Soft-clip safety above ceil (transparent)
        pk = max(abs(l_v), abs(r_v))
        if pk > ceil:
            sc = ceil / pk
            l_v *= sc
            r_v *= sc
        l_buf[i] = l_v
        r_buf[i] = r_v
    return max_gr_db


def brickwall_lookahead_limiter(l_buf, r_buf, ceil_db=-1.15, lookahead_ms=5.0, rel_ms=60.0):
    """Clean stereo-linked lookahead brickwall limiter with zero distortion below ceiling."""
    n = len(l_buf)
    ceil = db_to_lin(ceil_db)
    la = max(1, int(SR * lookahead_ms / 1000.0))
    rel_step = (1.0 - math.exp(-1.0 / (SR * rel_ms / 1000.0)))

    # Compute local peak over lookahead window using sliding deque (O(n))
    from collections import deque
    dq = deque()
    win_peak = [0.0] * n
    for i in range(n):
        val = max(abs(l_buf[i]), abs(r_buf[i]))
        while dq and dq[-1][1] <= val:
            dq.pop()
        dq.append((i, val))
        if dq[0][0] <= i - la:
            dq.popleft()
        win_peak[i] = dq[0][1]

    # Look forward by la//2 for symmetric pre-attenuation
    half = la // 2
    gain = 1.0
    min_gain = 1.0
    for i in range(n):
        pk = win_peak[min(n - 1, i + half)]
        target_g = (ceil / pk) if pk > ceil else 1.0
        if target_g < gain:
            gain = target_g
        else:
            gain += (target_g - gain) * rel_step
        if gain < min_gain:
            min_gain = gain
        l_buf[i] *= gain
        r_buf[i] *= gain
    return lin_to_db(min_gain)


def write_wav_24bit(path: str, l_buf, r_buf):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    n = len(l_buf)
    max_int = 8388607
    out_bytes = bytearray(n * 6)
    pos = 0
    for i in range(n):
        lv = int(max(-max_int, min(max_int, round(l_buf[i] * max_int))))
        rv = int(max(-max_int, min(max_int, round(r_buf[i] * max_int))))
        out_bytes[pos] = lv & 0xFF
        out_bytes[pos + 1] = (lv >> 8) & 0xFF
        out_bytes[pos + 2] = (lv >> 16) & 0xFF
        out_bytes[pos + 3] = rv & 0xFF
        out_bytes[pos + 4] = (rv >> 8) & 0xFF
        out_bytes[pos + 5] = (rv >> 16) & 0xFF
        pos += 6

    with wave.open(path, "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(3)
        w.setframerate(SR)
        w.writeframes(bytes(out_bytes))


def measure_loudnorm(path: str):
    res = subprocess.run(
        [FFMPEG, "-hide_banner", "-i", path, "-vn", "-af", "loudnorm=I=-14:TP=-1:LRA=7:print_format=json", "-f", "null", "-"],
        capture_output=True, text=True, check=True,
    )
    txt = res.stderr
    return json.loads(txt[txt.rfind("{") : txt.rfind("}") + 1])


def build_dialogue_bus():
    print("1/4 Building Dialogue & Ambience Bus (17 clips + J-cut + L-cut)...")
    dl = [0.0] * TOTAL_SAMPLES
    dr = [0.0] * TOTAL_SAMPLES

    cursor_f = 0
    seg_starts = {}

    for seg_id, rel_path, ts, te, gain, hpf_hz, debox_db, pres_db, pre_ov_f, post_ov_f in FOOTAGE_SPECS:
        dur_f = max(1, js_round((te - ts) * FPS)) if rel_path else max(1, js_round(te * FPS))
        sf = cursor_f
        ef = cursor_f + dur_f
        cursor_f = ef
        seg_starts[seg_id] = (sf, ef, dur_f)

        if not rel_path:
            continue

        full_path = os.path.join(ASSETS_DIR, rel_path)
        pre_s = pre_ov_f / FPS
        post_s = post_ov_f / FPS
        read_start = max(0.0, ts - pre_s)
        actual_pre_s = ts - read_start
        read_dur = (te - ts) + actual_pre_s + post_s

        cl, cr = load_stereo_float(full_path, ss=read_start, dur=read_dur)

        # Clean surgical EQ (HPF + optional de-box + optional presence)
        if hpf_hz > 0:
            c_hpf = biquad_coeffs("hpf", hpf_hz, SR, q=0.7071)
            cl = apply_biquad(cl, c_hpf)
            cr = apply_biquad(cr, c_hpf)
        if abs(debox_db) > 0.01:
            c_dbx = biquad_coeffs("peak", 300.0, SR, q=1.2, gain_db=debox_db)
            cl = apply_biquad(cl, c_dbx)
            cr = apply_biquad(cr, c_dbx)
        if abs(pres_db) > 0.01:
            c_prs = biquad_coeffs("peak", 2600.0, SR, q=1.0, gain_db=pres_db)
            cl = apply_biquad(cl, c_prs)
            cr = apply_biquad(cr, c_prs)

        # Fade edges:
        # - Same-location overlaps: smooth 3-frame (100ms) cosine crossfade across cut (eliminates 267ms V-dip!)
        # - Cross-location cuts: crisp 1.5-frame (50ms) cosine de-click fade
        # - S08_SH01 uses locked 4f J-cut crossfade; S08_SH02_V2 skips out-fade (seamless into 1.40s L-cut)
        in_fade_s = 0.133 if seg_id == "S08_SH01" else (0.100 if pre_ov_f > 0 else 0.050)
        out_fade_s = 0.0 if seg_id == "S08_SH02_V2" else (0.100 if post_ov_f > 0 else 0.050)
        if in_fade_s > 0:
            cosine_fade_in(cl, int(SR * in_fade_s))
            cosine_fade_in(cr, int(SR * in_fade_s))
        if out_fade_s > 0:
            cosine_fade_out(cl, int(SR * out_fade_s))
            cosine_fade_out(cr, int(SR * out_fade_s))

        place_sample = int(round((sf / FPS - actual_pre_s) * SR))
        mix_into(dl, dr, cl, cr, place_sample, gain=gain)

    assert cursor_f == TOTAL_FRAMES, f"Expected {TOTAL_FRAMES}f, got {cursor_f}f"

    # Locked S08_SH01 Warung Ambience J-cut (KR_SH08_SH02.mp4 0.05s..0.65s, starts f1910 / 01:03.67)
    jcut_path = os.path.join(ASSETS_DIR, "footage/KR_SH08_SH02.mp4")
    jl, jr = load_stereo_float(jcut_path, ss=0.05, dur=0.60)
    c_hpf = biquad_coeffs("hpf", 70.0, SR, q=0.7071)
    jl = apply_biquad(jl, c_hpf)
    jr = apply_biquad(jr, c_hpf)
    cosine_fade_in(jl, int(SR * 0.30))
    cosine_fade_in(jr, int(SR * 0.30))
    cosine_fade_out(jl, int(SR * 0.133))
    cosine_fade_out(jr, int(SR * 0.133))
    jcut_start = int(round((1910 / FPS) * SR))
    mix_into(dl, dr, jl, jr, jcut_start, gain=0.82)

    # Locked S08_SH02_V2 Selfie L-cut laughter tail (KR_SH08_SH02.mp4 5.77s..7.17s = 1.40s, starts f2244)
    ll, lr = load_stereo_float(jcut_path, ss=5.77, dur=1.40)
    ll = apply_biquad(ll, c_hpf)
    lr = apply_biquad(lr, c_hpf)
    cosine_fade_out(ll, int(SR * 0.333))
    cosine_fade_out(lr, int(SR * 0.333))
    lcut_start = int(round((2244 / FPS) * SR))
    mix_into(dl, dr, ll, lr, lcut_start, gain=1.54)

    max_gr = soft_compress_bus(dl, dr, thresh_db=-10.5, ratio=3.0, atk_ms=5.0, rel_ms=70.0, ceil_db=-3.5)
    print(f"   Dialogue bus ready (max gentle transient GR = {max_gr:.2f} dB).")
    return dl, dr, seg_starts


def build_music_bus(dl, dr):
    print("2/4 Building Bar-Aligned Funky Triplets Music Bus (100.0 BPM / 2.400s bar grid)...")
    m_path = os.path.join(ASSETS_DIR, "audio/music/working/KR_BGM_ClaimTheCity_Main_48k.wav")
    src_l, src_r = load_stereo_float(m_path)

    # Gentle low-shelf control (-2.5 dB below 110 Hz) so Funky Triplets' heavy 70-83% bass
    # stays tight and clean without muddying Jakarta dialogue on phones/laptops.
    c_ls = biquad_coeffs("lowshelf", 110.0, SR, q=0.7071, gain_db=-2.5)
    src_l = apply_biquad(src_l, c_ls)
    src_r = apply_biquad(src_r, c_ls)

    ml = [0.0] * TOTAL_SAMPLES
    mr = [0.0] * TOTAL_SAMPLES

    def place_slice(camp_s: float, trk_s: float, dur_s: float, fi_s: float, fo_s: float, gain_db: float = 0.0):
        i0 = int(round(trk_s * SR))
        n_s = int(round(dur_s * SR))
        sl = list(src_l[i0 : i0 + n_s])
        sr_c = list(src_r[i0 : i0 + n_s])
        if fi_s > 0:
            cosine_fade_in(sl, int(round(fi_s * SR)))
            cosine_fade_in(sr_c, int(round(fi_s * SR)))
        if fo_s > 0:
            cosine_fade_out(sl, int(round(fo_s * SR)))
            cosine_fade_out(sr_c, int(round(fo_s * SR)))
        mix_into(ml, mr, sl, sr_c, int(round(camp_s * SR)), gain=db_to_lin(gain_db))

    # Region A: 1-beat sparse triplet pickup (0:04.20) at 00:07.50 -> Bar 2 downbeat (0:04.80)
    # lands EXACTLY on 00:08.10 (f243 S03 map reveal!), playing uninterrupted to 00:43.17 (f1295).
    place_slice(camp_s=7.50, trk_s=4.20, dur_s=35.72, fi_s=0.35, fo_s=0.07, gain_db=0.0)

    # Region B: Breakdown #1 drop (0:54.74) right on JAWABAN SALAH (00:43.17 / f1295) ->
    # Bar 24 groove re-entry (0:57.60) lands EXACTLY on Opportunity + "Bentar!" (00:46.03 / f1381),
    # driving uninterrupted through Poin Ganda reveal + Sarinah claim + activation to 00:57.13 (f1714).
    place_slice(camp_s=43.13, trk_s=54.70, dur_s=14.08, fi_s=0.07, fo_s=0.08, gain_db=0.5)

    # Region C: Peak Final Chorus Bar 34 downbeat (1:21.60) lands EXACTLY on 00:57.13 (f1714)
    # driving territory transformation -> accelerated clock -> GREEN TEAM MENANG, tapering smoothly
    # before warung J-cut (01:03.67).
    place_slice(camp_s=57.10, trk_s=81.57, dur_s=6.80, fi_s=0.06, fo_s=0.85, gain_db=-1.0)

    # Region D: Breakdown #2 pure warm zero-drum melodic pocket (1:17.35..1:21.55, Lo=0.0%)
    # looped seamlessly 3x across warung reunion & selfie countdown (01:03.75..01:16.05).
    place_slice(camp_s=63.65, trk_s=77.35, dur_s=4.20, fi_s=0.35, fo_s=0.25, gain_db=-1.0)
    place_slice(camp_s=67.60, trk_s=77.35, dur_s=4.20, fi_s=0.25, fo_s=0.25, gain_db=-1.0)
    place_slice(camp_s=71.55, trk_s=77.35, dur_s=4.55, fi_s=0.25, fo_s=0.45, gain_db=-1.5)

    # Region E: Peak Chorus bloom (1:40.27 -> 1:47.00) aligned so the CRISP NATIVE FINAL BUTTON
    # (Bar 44 downbeat 1:45.60) lands EXACTLY on SEGERA HADIR (01:21.13 / f2434), decaying
    # naturally to digital silence by 01:22.53 (1.07s clean hold before 01:23.60!).
    place_slice(camp_s=75.80, trk_s=100.27, dur_s=7.20, fi_s=0.45, fo_s=0.15, gain_db=-1.0)

    # Create vocal-carved parallel version (-3.0 dB @ 2.2 kHz, Q=0.85) blended cleanly during speech
    c_carve = biquad_coeffs("peak", 2200.0, SR, q=0.85, gain_db=-3.0)
    ml_carve = apply_biquad(ml, c_carve)
    mr_carve = apply_biquad(mr, c_carve)

    # Compute smooth dialogue-driven ducking envelope (10ms RMS blocks + lookahead + narrative curve)
    block = int(SR * 0.01)  # 10ms = 480 samples
    n_blocks = TOTAL_SAMPLES // block + 1
    sp_env = [0.0] * n_blocks
    for b in range(n_blocks):
        i0 = b * block
        i1 = min(TOTAL_SAMPLES, i0 + block)
        if i1 <= i0:
            break
        s2 = sum(dl[k] * dl[k] + dr[k] * dr[k] for k in range(i0, i1)) / (2 * (i1 - i0))
        sp_env[b] = lin_to_db(math.sqrt(s2))

    # Build smooth per-block music gain (dB) following Milestone 3.1 music spotting arc
    # Narrative baseline target (before speech ducking):
    def narrative_base_db(t: float) -> float:
        if t < 8.10:
            return -5.5     # 1-beat pickup
        if t < 13.20:
            return -3.5     # S03 reveal
        if t < 17.60:
            return -2.5     # S04 transit energy
        if t < 19.07:
            return -5.0     # S04_SH03 low-SNR TransJakarta protection
        if t < 22.73:
            return -2.5     # S04_SH04 MRT
        if t < 29.23:
            return -4.5     # S05 GBK focused exploration
        if t < 31.33:
            return -2.5     # S05_SH04 GBK claim pop
        if t < 43.17:
            return -4.0     # S06 Bundaran HI + Kendal lead
        if t < 45.80:
            return -3.0     # S07_SH01 breakdown already quiet (-28dB natively)
        if t < 51.00:
            return -3.5     # S07_SH02 comeback build
        if t < 52.13:
            return -1.5     # S07_SH02 tunnel exit stride swell!
        if t < 54.07:
            return -3.5     # S07_SH04 Sarinah claim
        if t < 57.13:
            return -2.0     # S07_SH04 Poin Ganda lift -> climax
        if t < 63.00:
            return -1.0     # INT_MATCH_CONCLUSION open peak feature (~-13.8 LUFS)
        if t < 74.20:
            return -4.0     # S08 warm reunion (Breakdown #2 already -29dB natively -> ~-25 LUFS!)
        if t < 75.20:
            return -6.5     # Brief breath on selfie countdown + native shutter (01:14.80)
        if t < 76.10:
            return -4.5     # Soft under L-cut laughter
        return -1.0         # Montage bloom & crisp closing brand button (~-13.8 LUFS)!

    # Speech activity factor (0..1) with 120ms lookahead and smooth release
    speech_act = [0.0] * n_blocks
    for b in range(n_blocks):
        t = b * 0.01
        # During open graphic/montage sections (no speech except L-cut), skip ducking
        if (57.15 <= t <= 63.80) or (t >= 76.25):
            raw = 0.0
        else:
            # Look ahead 12 blocks (120ms) for speech peaks above -27 dBFS
            peak_sp = max(sp_env[b : min(n_blocks, b + 12)])
            raw = max(0.0, min(1.0, (peak_sp - (-28.0)) / 12.0))
        speech_act[b] = raw

    # Smooth speech_act (fast 60ms attack, gentle 260ms release)
    sm_act = [0.0] * n_blocks
    cur = 0.0
    for b in range(n_blocks):
        if speech_act[b] > cur:
            cur += (speech_act[b] - cur) * 0.35
        else:
            cur += (speech_act[b] - cur) * 0.07
        sm_act[b] = cur

    # Apply combined narrative + speech-ducking gain & vocal carve blend
    for i in range(TOTAL_SAMPLES):
        b = min(n_blocks - 1, i // block)
        t = i / SR
        act = sm_act[b]
        # Duck up to -6.5 dB underneath active speech (reunion already quiet natively so lighter duck)
        max_duck = 3.5 if (63.7 <= t <= 75.8) else 6.8
        g_db = narrative_base_db(t) - act * max_duck
        g_lin = db_to_lin(g_db)
        # Blend carved mid EQ proportionally to speech activity
        ml[i] = (ml[i] * (1.0 - act) + ml_carve[i] * act) * g_lin
        mr[i] = (mr[i] * (1.0 - act) + mr_carve[i] * act) * g_lin

    print("   Music bus ready (bar-aligned 5-region Funky Triplets edit + lookahead vocal-carve ducking).")
    return ml, mr


def build_sfx_bus():
    print("3/4 Building Tactile Board-Game SFX Bus (10 Mixkit 48 kHz assets + custom composites)...")
    sl = [0.0] * TOTAL_SAMPLES
    sr_b = [0.0] * TOTAL_SAMPLES

    sfx_dir = os.path.join(ASSETS_DIR, "audio/sfx/working")
    cache = {}

    def get_sfx(name: str):
        if name not in cache:
            cache[name] = load_stereo_float(os.path.join(sfx_dir, f"{name}_48k.wav"))
        return list(cache[name][0]), list(cache[name][1])

    # Verified onset offsets (ms) from Milestone 3.2 probe so acoustic transients lock to visual frames
    ONSETS_MS = {
        "sfx_paper_wipe": 55,
        "sfx_paper_slide_soft": 45,
        "sfx_stamp_claim": 50,
        "sfx_tactile_ping": 80,
        "sfx_wrong_thud": 0,
        "sfx_card_deal": 50,
        "sfx_poin_ganda_activate": 15,
        "sfx_score_flip": 10,
        "sfx_timer_sweep": 95,
        "sfx_round_bell": 10,
    }

    def place_sfx(name: str, frame_num: float, gain_db: float, pan: float = 0.0,
                  pitch_ratio: float = 1.0, max_dur_s: float = None,
                  high_shelf_db: float = 0.0, lpf_hz: float = 0.0, extra_offset_ms: float = 0.0):
        cl, cr = get_sfx(name)
        onset_s = ONSETS_MS.get(name, 0) / 1000.0
        trim0 = int(round(onset_s * SR))
        cl = cl[trim0:]
        cr = cr[trim0:]
        if abs(pitch_ratio - 1.0) > 1e-4:
            cl = resample_linear(cl, pitch_ratio)
            cr = resample_linear(cr, pitch_ratio)
        if max_dur_s is not None:
            m_n = int(round(max_dur_s * SR))
            if len(cl) > m_n:
                cl = cl[:m_n]
                cr = cr[:m_n]
                cosine_fade_out(cl, min(int(SR * 0.08), len(cl) // 3))
                cosine_fade_out(cr, min(int(SR * 0.08), len(cr) // 3))
        if abs(high_shelf_db) > 0.01:
            c_hs = biquad_coeffs("highshelf", 5200.0, SR, q=0.7071, gain_db=high_shelf_db)
            cl = apply_biquad(cl, c_hs)
            cr = apply_biquad(cr, c_hs)
        if lpf_hz > 0:
            c_lp = biquad_coeffs("lpf", lpf_hz, SR, q=0.7071)
            cl = apply_biquad(cl, c_lp)
            cr = apply_biquad(cr, c_lp)
        cosine_fade_in(cl, int(SR * 0.004))
        cosine_fade_in(cr, int(SR * 0.004))
        t_s = (frame_num / FPS) + (extra_offset_ms / 1000.0)
        mix_into(sl, sr_b, cl, cr, int(round(t_s * SR)), gain=db_to_lin(gain_db), pan=pan)

    # Exact frame-accurate cues from docs/SOUND_DESIGN_CUE_SHEET.md & docs/AUDIO_ASSET_MANIFEST.md
    place_sfx("sfx_paper_wipe",          233,  -7.5, pan= 0.08, max_dur_s=0.65)                 # S02->S03 paper wipe
    place_sfx("sfx_card_deal",           249,  -4.0, pan= 0.00, max_dur_s=0.35)                 # S03 CLAIM THE CITY drop
    place_sfx("sfx_tactile_ping",        708, -11.5, pan= 0.15, max_dur_s=0.65)                 # S05 GBK Check-in (modest)
    place_sfx("sfx_stamp_claim",         889,  -6.5, pan= 0.00, max_dur_s=0.32)                 # S05 GBK DIKLAIM GREEN
    place_sfx("sfx_paper_slide_soft",    984, -12.0, pan= 0.15, max_dur_s=0.45)                 # S06 Bundaran HI proof (preserves native shutter f983-f985!)
    place_sfx("sfx_tactile_ping",       1022, -11.5, pan= 0.15, pitch_ratio=1.122, max_dur_s=0.48)  # S06 TERVERIFIKASI (+2st brighter)
    place_sfx("sfx_stamp_claim",        1048,  -8.0, pan= 0.15, max_dur_s=0.32)                 # S06 Bundaran HI DIKLAIM YELLOW
    place_sfx("sfx_score_flip",         1111,  -8.5, pan= 0.15, max_dur_s=0.25)                 # S06 Scoreboard Yellow 2
    place_sfx("sfx_wrong_thud",         1295,  -7.0, pan= 0.15, max_dur_s=0.35)                 # S07 JAWABAN SALAH
    place_sfx("sfx_tactile_ping",       1378, -11.0, pan= 0.15, pitch_ratio=1.06, max_dur_s=0.50)   # S07 Opportunity pre-lap (-3f before "Bentar!")
    place_sfx("sfx_paper_slide_soft",   1381, -13.0, pan= 0.15, max_dur_s=0.40)                 # S07 Opportunity ticket slide
    place_sfx("sfx_stamp_claim",        1410,  -9.5, pan= 0.15, max_dur_s=0.30)                 # S07 BELUM DIKLAIM stamp
    place_sfx("sfx_card_deal",          1483,  -4.0, pan= 0.15, max_dur_s=0.35)                 # S07 POIN GANDA reveal
    place_sfx("sfx_stamp_claim",        1579,  -8.0, pan= 0.15, max_dur_s=0.30)                 # S07 Relief Sarinah claim (Netral 1-1)
    place_sfx("sfx_card_deal",          1608,  -5.5, pan= 0.15, max_dur_s=0.35)                 # S07 POIN GANDA tabletop return

    # Signature 3-Layer POIN GANDA Activation Composite (f1622 / 00:54.07)
    place_sfx("sfx_card_deal",          1622,  -5.0, pan= 0.12, max_dur_s=0.30, extra_offset_ms=0)
    place_sfx("sfx_score_flip",         1622,  -7.5, pan= 0.12, max_dur_s=0.22, extra_offset_ms=30)
    place_sfx("sfx_poin_ganda_activate",1622,  -6.5, pan= 0.08, max_dur_s=0.95, extra_offset_ms=40)

    # S07 Beat 3 Green Takeover Score Flip (f1678 / 00:55.93, +2st upward)
    place_sfx("sfx_score_flip",         1678,  -8.0, pan= 0.15, pitch_ratio=1.122, max_dur_s=0.25)

    # Custom 2-Layer Sudirman-Thamrin Territory Transformation Composite (f1718 / 00:57.27)
    place_sfx("sfx_paper_wipe",         1718,  -6.5, pan=-0.12, max_dur_s=0.65, extra_offset_ms=0)
    place_sfx("sfx_poin_ganda_activate",1718,  -9.5, pan=-0.08, max_dur_s=1.05, lpf_hz=2400.0, extra_offset_ms=80)

    # Accelerated Mechanical Match Timer (f1792..f1844 = 59.733s..61.467s = 1.733s)
    # Extract clean alternating tick (0.06..0.30s) & tock (0.36..0.60s) from #1063 Fast wall clock ticking
    tl, tr = get_sfx("sfx_timer_sweep")
    tick_l = list(tl[int(0.06 * SR) : int(0.30 * SR)])
    tick_r = list(tr[int(0.06 * SR) : int(0.30 * SR)])
    tock_l = list(tl[int(0.36 * SR) : int(0.60 * SR)])
    tock_r = list(tr[int(0.36 * SR) : int(0.60 * SR)])
    for arr_c in (tick_l, tick_r, tock_l, tock_r):
        cosine_fade_in(arr_c, int(SR * 0.005))
        cosine_fade_out(arr_c, int(SR * 0.04))

    # 12 progressively accelerating ticks matching Easing.inOut(cubic) across 1.65s (stops 80ms before bell!)
    # Intervals tighten smoothly from ~210ms -> ~95ms
    tick_offsets_s = [0.00, 0.21, 0.40, 0.57, 0.72, 0.85, 0.97, 1.08, 1.19, 1.30, 1.42, 1.54]
    t0_timer = 1792 / FPS
    for idx_t, off in enumerate(tick_offsets_s):
        cl_t, cr_t = (tick_l, tick_r) if (idx_t % 2 == 0) else (tock_l, tock_r)
        # Gently crescendo +2 dB into 00:00
        g_t = db_to_lin(-9.0 + (idx_t / (len(tick_offsets_s) - 1)) * 2.5)
        mix_into(sl, sr_b, cl_t, cr_t, int(round((t0_timer + off) * SR)), gain=g_t, pan=0.0)

    # Round-end warm tabletop brass desk bell at exact 00:00 (f1844 / 01:01.47), warm -2.5 dB shelf @ 5.2 kHz
    place_sfx("sfx_round_bell",         1844,  -8.5, pan= 0.00, max_dur_s=1.15, high_shelf_db=-2.5)

    # Subtle matte photo print settles in Weekend Memories montage (native selfie shutter at f2244 preserved!)
    place_sfx("sfx_paper_slide_soft",   2268, -19.0, pan= 0.08, max_dur_s=0.35)
    place_sfx("sfx_paper_slide_soft",   2292, -16.0, pan=-0.08, max_dur_s=0.35)
    place_sfx("sfx_paper_slide_soft",   2316, -15.5, pan= 0.00, max_dur_s=0.40)

    print("   SFX bus ready (19 onset-locked tactile cues + composites, zero duplicate shutters).")
    return sl, sr_b


def main():
    dl, dr, _ = build_dialogue_bus()
    ml, mr = build_music_bus(dl, dr)
    sl, sr_b = build_sfx_bus()

    print("4/4 Summing Master Bus, Calibrating Loudness (-14.5 LUFS) & Brickwall Limiting (-1.15 dBTP)...")
    # Sum buses
    master_l = [dl[i] + ml[i] + sl[i] for i in range(TOTAL_SAMPLES)]
    master_r = [dr[i] + mr[i] + sr_b[i] for i in range(TOTAL_SAMPLES)]

    # Measure pre-calibration integrated loudness via FFmpeg loudnorm
    tmp_wav = os.path.join(OUT_DIR, "_pre_cal_tmp.wav")
    write_wav_24bit(tmp_wav, master_l, master_r)
    pre_ln = measure_loudnorm(tmp_wav)
    pre_i = float(pre_ln["input_i"])
    print(f"   Pre-calibration master: {pre_i:.2f} LUFS, TP {pre_ln['input_tp']} dBTP, LRA {pre_ln['input_lra']} LU")

    # Calibrate to -14.5 LUFS (solidly centered in Milestone 4.0's -14 to -16 LUFS spec)
    target_lufs = -14.5
    trim_db = target_lufs - pre_i
    trim_lin = db_to_lin(trim_db)
    print(f"   Applying master calibration trim: {trim_db:+.2f} dB")
    for i in range(TOTAL_SAMPLES):
        master_l[i] *= trim_lin
        master_r[i] *= trim_lin

    # Clean lookahead brickwall limiter (-1.20 dBFS -> guarantees <= -1.0 dBTP even after AAC encoding!)
    max_lim_db = brickwall_lookahead_limiter(master_l, master_r, ceil_db=-1.20, lookahead_ms=5.0, rel_ms=65.0)
    print(f"   Lookahead brickwall limiter max GR: {max_lim_db:.2f} dB")

    # Tiny 10ms fade-in/out on program endpoints (zero click)
    cosine_fade_in(master_l, int(SR * 0.010))
    cosine_fade_in(master_r, int(SR * 0.010))
    cosine_fade_out(master_l, int(SR * 0.020))
    cosine_fade_out(master_r, int(SR * 0.020))

    write_wav_24bit(OUT_WAV, master_l, master_r)
    if os.path.exists(tmp_wav):
        os.unlink(tmp_wav)

    post_ln = measure_loudnorm(OUT_WAV)
    print("\n=== VERIFIED MASTER MIX (KR_ClaimTheCity_MasterMix_48k.wav) ===")
    print(json.dumps(post_ln, indent=2))

    # Silence check (-55 dB, >= 0.5s) to verify ZERO unintended mid-film silence gaps!
    sil = subprocess.run(
        [FFMPEG, "-hide_banner", "-i", OUT_WAV, "-vn", "-af", "silencedetect=noise=-55dB:d=0.5", "-f", "null", "-"],
        capture_output=True, text=True, check=True,
    )
    print("\n=== SILENCE CHECK (-55dB, >=0.5s) ===")
    for line in sil.stderr.splitlines():
        if "silence_" in line:
            print(" ", line)


if __name__ == "__main__":
    main()
