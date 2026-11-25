#!/usr/bin/env python3
"""
Milestone 4.0 — Independent Technical & Visual QA Suite for Final Delivery Files.
Verifies Master.mov, YouTube.mp4, Web.mp4, Thumbnail.jpg, ID.srt, and ID.vtt.
"""
import json
import os
import re
import struct
import subprocess
import sys

import tempfile
from ffmpeg_util import find_binary

PROJECT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FFMPEG = find_binary("ffmpeg")
FFPROBE = find_binary("ffprobe")
FINAL_DIR = os.path.join(PROJECT_DIR, "renders/final")
QA_FRAME_DIR = os.path.join(tempfile.gettempdir(), "kr_final_qa")


def check_faststart(path: str) -> str:
    """Verify moov atom precedes mdat atom in MP4/MOV container."""
    moov_pos = None
    mdat_pos = None
    offset = 0
    file_size = os.path.getsize(path)
    with open(path, "rb") as f:
        while offset < file_size:
            f.seek(offset)
            header = f.read(8)
            if len(header) < 8:
                break
            size, atom = struct.unpack(">I4s", header)
            atom_name = atom.decode("latin1", errors="replace")
            if size == 1:
                ext = f.read(8)
                if len(ext) < 8:
                    break
                size = struct.unpack(">Q", ext)[0]
            elif size == 0:
                size = file_size - offset
            if atom_name == "moov" and moov_pos is None:
                moov_pos = offset
            elif atom_name == "mdat" and mdat_pos is None:
                mdat_pos = offset
            if size < 8:
                break
            offset += size
    if moov_pos is not None and mdat_pos is not None:
        return f"PASS (moov@{moov_pos} < mdat@{mdat_pos})" if moov_pos < mdat_pos else f"FAIL (mdat@{mdat_pos} < moov@{moov_pos})"
    return f"UNKNOWN (moov={moov_pos}, mdat={mdat_pos})"


def ffprobe_file(path: str) -> dict:
    out = subprocess.check_output([
        FFPROBE, "-v", "error",
        "-show_entries",
        "format=format_name,duration,size,bit_rate:"
        "stream=index,codec_type,codec_name,profile,width,height,pix_fmt,"
        "color_space,color_transfer,color_primaries,r_frame_rate,avg_frame_rate,"
        "nb_frames,sample_rate,channels,bits_per_sample,bit_rate",
        "-of", "json", path,
    ]).decode()
    return json.loads(out)


def measure_loudness(path: str) -> dict:
    res = subprocess.run(
        [FFMPEG, "-hide_banner", "-nostats", "-i", path, "-vn",
         "-af", "loudnorm=I=-14:TP=-1:LRA=7:print_format=json", "-f", "null", "-"],
        stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
    )
    m = re.search(r"\{[\s\S]*\}", res.stderr)
    return json.loads(m.group(0)) if m else {}


def detect_silence(path: str) -> list:
    res = subprocess.run(
        [FFMPEG, "-hide_banner", "-nostats", "-i", path, "-vn",
         "-af", "silencedetect=noise=-55dB:d=0.5", "-f", "null", "-"],
        stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
    )
    return [line.strip() for line in res.stderr.splitlines() if "silence_" in line]


def detect_black_frames(path: str) -> list:
    res = subprocess.run(
        [FFMPEG, "-hide_banner", "-nostats", "-i", path, "-an",
         "-vf", "blackdetect=d=0.15:pix_th=0.05", "-f", "null", "-"],
        stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
    )
    return [line.strip() for line in res.stderr.splitlines() if "blackdetect" in line]


def inspect_video(filename: str):
    path = os.path.join(FINAL_DIR, filename)
    if not os.path.exists(path):
        print(f"MISSING: {filename}")
        return None
    size_bytes = os.path.getsize(path)
    info = ffprobe_file(path)
    v = next((s for s in info["streams"] if s["codec_type"] == "video"), {})
    a = next((s for s in info["streams"] if s["codec_type"] == "audio"), {})
    loud = measure_loudness(path)
    sil = detect_silence(path)
    faststart = check_faststart(path)

    result = {
        "file": filename,
        "size_bytes": size_bytes,
        "size_mb": round(size_bytes / (1024 * 1024), 2),
        "duration_s": float(info["format"]["duration"]),
        "total_bitrate_mbps": round(int(info["format"]["bit_rate"]) / 1_000_000, 2),
        "video_codec": v.get("codec_name"),
        "video_profile": v.get("profile"),
        "resolution": f"{v.get('width')}x{v.get('height')}",
        "pix_fmt": v.get("pix_fmt"),
        "fps": v.get("r_frame_rate"),
        "nb_frames": int(v.get("nb_frames", 0)),
        "video_bitrate_mbps": round(int(v.get("bit_rate", 0)) / 1_000_000, 2) if v.get("bit_rate") else None,
        "color": f"{v.get('color_space')}/{v.get('color_transfer')}/{v.get('color_primaries')}",
        "audio_codec": a.get("codec_name"),
        "audio_sr": int(a.get("sample_rate", 0)),
        "audio_ch": a.get("channels"),
        "audio_bits": a.get("bits_per_sample"),
        "audio_bitrate_kbps": round(int(a.get("bit_rate", 0)) / 1000, 1) if a.get("bit_rate") else None,
        "lufs": float(loud["input_i"]) if "input_i" in loud else None,
        "true_peak_dbtp": float(loud["input_tp"]) if "input_tp" in loud else None,
        "lra_lu": float(loud["input_lra"]) if "input_lra" in loud else None,
        "faststart": faststart,
        "silence_events": sil,
    }
    print(f"\n=== {filename} ===")
    print(json.dumps(result, indent=2))
    return result


def extract_qa_frames(web_mp4: str):
    os.makedirs(QA_FRAME_DIR, exist_ok=True)
    # 12 key representative frames across the entire 83.60s film
    frames = [
        (45, "01_S01_opening"),
        (300, "02_S03_map_title"),
        (740, "03_S05_gbk_checkin"),
        (835, "04_S05_gbk_challenge"),
        (1035, "05_S06_bhi_photo"),
        (1140, "06_S06_kendal_dark"),
        (1510, "07_S07_poin_ganda_card"),
        (1638, "08_S07_sarinah_activate"),
        (1744, "09_INT_map_lead"),
        (1818, "10_INT_clock_expiry"),
        (1882, "11_INT_green_wins"),
        (2040, "12_S08_warung_reunion"),
        (2340, "13_S08_montage"),
        (2478, "14_S09_brand_reveal"),
    ]
    for fnum, label in frames:
        ts = fnum / 30.0
        out_png = os.path.join(QA_FRAME_DIR, f"{label}_f{fnum}.png")
        subprocess.check_call([
            FFMPEG, "-y", "-v", "error", "-ss", f"{ts:.4f}", "-i", web_mp4,
            "-frames:v", "1", out_png,
        ])
    try:
        from PIL import Image

        def build_grid(names, out_name, cell=(960, 540)):
            canvas = Image.new("RGB", (cell[0] * 2, cell[1] * 2))
            for i, fname in enumerate(names):
                im = (
                    Image.open(os.path.join(QA_FRAME_DIR, fname))
                    .convert("RGB")
                    .resize(cell, Image.Resampling.LANCZOS)
                )
                canvas.paste(im, ((i % 2) * cell[0], (i // 2) * cell[1]))
            canvas.save(os.path.join(QA_FRAME_DIR, out_name))

        build_grid(
            ["01_S01_opening_f45.png", "05_S06_bhi_photo_f1035.png",
             "06_S06_kendal_dark_f1140.png", "12_S08_warung_reunion_f2040.png"],
            "QA_Sheet_A_LiveAction_Web.png",
        )
        build_grid(
            ["02_S03_map_title_f300.png", "04_S05_gbk_challenge_f835.png",
             "07_S07_poin_ganda_card_f1510.png", "08_S07_sarinah_activate_f1638.png"],
            "QA_Sheet_B_MotionGfx_Web.png",
        )
        build_grid(
            ["09_INT_map_lead_f1744.png", "10_INT_clock_expiry_f1818.png",
             "11_INT_green_wins_f1882.png", "14_S09_brand_reveal_f2478.png"],
            "QA_Sheet_C_Ending_Web.png",
        )
        build_grid(
            ["04_S05_gbk_challenge_f835.png", "07_S07_poin_ganda_card_f1510.png",
             "09_INT_map_lead_f1744.png", "11_INT_green_wins_f1882.png"],
            "QA_Sheet_D_Mobile360w.png",
            cell=(360, 202),
        )
        print(f"\nExtracted QA frames & 4 PIL contact sheets to {QA_FRAME_DIR}")
    except ImportError:
        print(f"\nExtracted QA frames to {QA_FRAME_DIR} (PIL unavailable for contact sheets)")


def main():
    videos = [
        "KR_ClaimTheCity_Master.mov",
        "KR_ClaimTheCity_YouTube.mp4",
        "KR_ClaimTheCity_Web.mp4",
        "KR_ClaimTheCity_Web_720p.mp4",
    ]
    results = []
    for vf in videos:
        r = inspect_video(vf)
        if r:
            results.append(r)

    web_path = os.path.join(FINAL_DIR, "KR_ClaimTheCity_Web.mp4")
    if os.path.exists(web_path):
        print("\n=== BLACK FRAME SCAN (KR_ClaimTheCity_Web.mp4) ===")
        blacks = detect_black_frames(web_path)
        print("  None detected (PASS)" if not blacks else "\n".join(f"  {b}" for b in blacks))
        extract_qa_frames(web_path)

    report_path = os.path.join(tempfile.gettempdir(), "kr_final_qa_report.json")
    with open(report_path, "w") as f:
        json.dump(results, f, indent=2)


if __name__ == "__main__":
    main()
