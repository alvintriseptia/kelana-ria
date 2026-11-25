#!/usr/bin/env python3
"""
Download the 11 verified Mixkit audio assets recorded in assets/audio/LICENSE_RECORDS.md
and prepare 48 kHz / 24-bit WAV working copies locally (gitignored per Mixkit license terms).
"""
import os
import subprocess
import urllib.request
from ffmpeg_util import find_binary

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
REPO_DIR = os.path.abspath(os.path.join(SCRIPT_DIR, "..", ".."))
AUDIO_DIR = os.path.join(REPO_DIR, "assets", "audio")

MUSIC_ASSETS = [
    (
        "music/KR_BGM_ClaimTheCity_Main.mp3",
        "music/working/KR_BGM_ClaimTheCity_Main_48k.wav",
        "https://assets.mixkit.co/music/1141/1141.mp3",
    ),
]

SFX_ASSETS = [
    ("sfx/sfx_paper_wipe.wav", "sfx/working/sfx_paper_wipe_48k.wav", "https://assets.mixkit.co/active_storage/sfx/1105/1105.wav"),
    ("sfx/sfx_paper_slide_soft.wav", "sfx/working/sfx_paper_slide_soft_48k.wav", "https://assets.mixkit.co/active_storage/sfx/1530/1530.wav"),
    ("sfx/sfx_stamp_claim.wav", "sfx/working/sfx_stamp_claim_48k.wav", "https://assets.mixkit.co/active_storage/sfx/2182/2182.wav"),
    ("sfx/sfx_tactile_ping.wav", "sfx/working/sfx_tactile_ping_48k.wav", "https://assets.mixkit.co/active_storage/sfx/1107/1107.wav"),
    ("sfx/sfx_wrong_thud.wav", "sfx/working/sfx_wrong_thud_48k.wav", "https://assets.mixkit.co/active_storage/sfx/2569/2569.wav"),
    ("sfx/sfx_card_deal.wav", "sfx/working/sfx_card_deal_48k.wav", "https://assets.mixkit.co/active_storage/sfx/2002/2002.wav"),
    ("sfx/sfx_poin_ganda_activate.wav", "sfx/working/sfx_poin_ganda_activate_48k.wav", "https://assets.mixkit.co/active_storage/sfx/960/960.wav"),
    ("sfx/sfx_score_flip.wav", "sfx/working/sfx_score_flip_48k.wav", "https://assets.mixkit.co/active_storage/sfx/2857/2857.wav"),
    ("sfx/sfx_timer_sweep.wav", "sfx/working/sfx_timer_sweep_48k.wav", "https://assets.mixkit.co/active_storage/sfx/1063/1063.wav"),
    ("sfx/sfx_round_bell.wav", "sfx/working/sfx_round_bell_48k.wav", "https://assets.mixkit.co/active_storage/sfx/931/931.wav"),
]


def download(url: str, dest: str) -> None:
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    if os.path.isfile(dest) and os.path.getsize(dest) > 4096:
        print(f"  [ok] {os.path.relpath(dest, AUDIO_DIR)} already exists")
        return
    print(f"  [dl] {os.path.relpath(dest, AUDIO_DIR)} <- {url}")
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=60) as resp, open(dest, "wb") as out:
        out.write(resp.read())


def convert_to_48k(ffmpeg_bin: str, src: str, dst: str) -> None:
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    if os.path.isfile(dst) and os.path.getsize(dst) > 4096:
        return
    print(f"  [48k] {os.path.relpath(dst, AUDIO_DIR)}")
    subprocess.check_call([
        ffmpeg_bin, "-y", "-hide_banner", "-loglevel", "error",
        "-i", src,
        "-ar", "48000", "-ac", "2", "-c:a", "pcm_s24le",
        dst,
    ])


def main() -> None:
    ffmpeg_bin = find_binary("ffmpeg")
    print(f"Fetching & preparing 11 verified Mixkit audio assets (FFmpeg: {ffmpeg_bin})...")
    for orig_rel, work_rel, url in MUSIC_ASSETS + SFX_ASSETS:
        orig_path = os.path.join(AUDIO_DIR, orig_rel)
        work_path = os.path.join(AUDIO_DIR, work_rel)
        download(url, orig_path)
        convert_to_48k(ffmpeg_bin, orig_path, work_path)
    print("All 11 Mixkit assets & 48 kHz working copies are ready.")


if __name__ == "__main__":
    main()
