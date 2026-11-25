#!/usr/bin/env python3
"""
Cross-platform End-to-End Final Delivery Builder — Kelana Ria: Claim the City.

Reproduces all Milestone 3.3 & Milestone 4.0 outputs locally on macOS, Linux, or Windows:
  1. Fetches the 11 verified Mixkit audio assets & prepares 48 kHz WAV working copies (skipped if present)
  2. Builds the deterministic 48 kHz / 24-bit mastered audio mix (KR_ClaimTheCity_MasterMix_48k.wav)
  3. Renders renders/final/KR_ClaimTheCity_Thumbnail.jpg (1920x1080)
  4. Copies Indonesian subtitles (KR_ClaimTheCity_ID.srt & .vtt) into renders/final/
  5. Renders renders/final/KR_ClaimTheCity_Master.mov (ProRes 422 10-bit BT.709 + 24-bit/48kHz PCM)
  6. Encodes YouTube.mp4 (2-pass 16M VBR), Web.mp4 (1080p CRF 25), and Web_720p.mp4 directly from Master.mov
  7. Runs independent QA verification (scripts/qa_final_deliveries.py)

Usage:
  python3 scripts/build_all_final.py              # Full archival Master.mov + YouTube + Web + 720p + Thumbnail + Subtitles
  python3 scripts/build_all_final.py --fast-mp4   # Skip 1.4 GiB Master.mov; render crisp 1080p Web MP4 directly via Remotion
"""
import argparse
import os
import shutil
import subprocess
import sys
import tempfile

from ffmpeg_util import find_binary, pick_aac_encoder

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
CTC_DIR = os.path.dirname(SCRIPT_DIR)
REPO_DIR = os.path.dirname(CTC_DIR)
FINAL_DIR = os.path.join(CTC_DIR, "renders", "final")
SUBTITLES_DIR = os.path.join(CTC_DIR, "subtitles")
MASTER_WAV = os.path.join(REPO_DIR, "assets", "audio", "mix", "KR_ClaimTheCity_MasterMix_48k.wav")


def run(cmd, cwd=CTC_DIR):
    print(f"\n> {' '.join(cmd)}")
    subprocess.check_call(cmd, cwd=cwd)


def npx_cmd():
    return "npx.cmd" if os.name == "nt" else "npx"


def main():
    parser = argparse.ArgumentParser(description="Build Claim the City final deliverables locally.")
    parser.add_argument(
        "--fast-mp4",
        action="store_true",
        help="Fast local mode: skip 1.4 GiB ProRes Master.mov and render KR_ClaimTheCity_Web.mp4 directly via Remotion.",
    )
    parser.add_argument(
        "--rebuild-audio",
        action="store_true",
        help="Force rebuilding KR_ClaimTheCity_MasterMix_48k.wav even if it already exists.",
    )
    parser.add_argument(
        "--skip-qa",
        action="store_true",
        help="Skip running qa_final_deliveries.py at the end.",
    )
    args = parser.parse_args()

    os.makedirs(FINAL_DIR, exist_ok=True)
    ffmpeg_bin = find_binary("ffmpeg")
    aac_enc = pick_aac_encoder(ffmpeg_bin)
    npx = npx_cmd()

    print(f"Using FFmpeg: {ffmpeg_bin} (AAC encoder: {aac_enc})")

    # Step 1: Fetch Mixkit stock audio + 48 kHz working copies
    run([sys.executable, os.path.join(SCRIPT_DIR, "fetch_mixkit_audio.py")])

    # Step 2: Build deterministic 48 kHz / 24-bit mastered audio mix
    if args.rebuild_audio or not os.path.isfile(MASTER_WAV):
        run([sys.executable, os.path.join(SCRIPT_DIR, "build_audio_mix.py")])
    else:
        print(f"\n[ok] Using existing mastered audio mix: {MASTER_WAV} (pass --rebuild-audio to force rebuild)")

    # Step 3: Copy tracked Indonesian subtitle files into renders/final/
    for fname in ("KR_ClaimTheCity_ID.srt", "KR_ClaimTheCity_ID.vtt"):
        src = os.path.join(SUBTITLES_DIR, fname)
        dst = os.path.join(FINAL_DIR, fname)
        if os.path.isfile(src):
            shutil.copy2(src, dst)
            print(f"[ok] Copied {fname} -> renders/final/{fname}")

    # Step 4: Render 1920x1080 Campaign Thumbnail
    run([
        npx, "remotion", "still",
        "KR-ClaimTheCity-Thumbnail",
        os.path.join("renders", "final", "KR_ClaimTheCity_Thumbnail.jpg"),
        "--image-format=jpeg", "--jpeg-quality=94", "--overwrite",
    ])

    if args.fast_mp4:
        # Fast direct MP4 render via Remotion (skips 1.4 GiB ProRes archival master)
        run([
            npx, "remotion", "render",
            "KelanaRia-RoughCut",
            os.path.join("renders", "final", "KR_ClaimTheCity_Web.mp4"),
            "--codec=h264", "--crf=25", "--color-space=bt709",
            "--audio-bitrate=192k", "--overwrite",
        ])
    else:
        # Step 5: Render Apple ProRes 422 archival master (lossless PNG frames -> ProRes 422 BT.709)
        tmp_prores = os.path.join(FINAL_DIR, "_prores_video_only.mov")
        master_mov = os.path.join(FINAL_DIR, "KR_ClaimTheCity_Master.mov")
        run([
            npx, "remotion", "render",
            "KelanaRia-RoughCut",
            tmp_prores,
            "--codec=prores", "--prores-profile=standard",
            "--color-space=bt709", "--image-format=png",
            "--muted", "--overwrite",
        ])

        # Remux ProRes video (-c:v copy, zero video re-encoding) + 24-bit / 48 kHz PCM master audio
        run([
            ffmpeg_bin, "-y", "-hide_banner", "-loglevel", "warning",
            "-i", tmp_prores,
            "-i", MASTER_WAV,
            "-map", "0:v:0", "-map", "1:a:0",
            "-c:v", "copy",
            "-c:a", "pcm_s24le", "-ar", "48000", "-ac", "2",
            "-color_primaries", "bt709", "-color_trc", "bt709", "-colorspace", "bt709",
            "-movflags", "+faststart",
            master_mov,
        ])
        os.remove(tmp_prores)

        # Step 6a: Encode YouTube master (2-pass VBR 16 Mbps [12-20 Mbps], H.264 High, 320k AAC)
        yt_mp4 = os.path.join(FINAL_DIR, "KR_ClaimTheCity_YouTube.mp4")
        passlog = os.path.join(tempfile.gettempdir(), "kr_yt_2pass")
        null_sink = "NUL" if os.name == "nt" else "/dev/null"
        run([
            ffmpeg_bin, "-y", "-hide_banner", "-loglevel", "warning",
            "-i", master_mov,
            "-c:v", "libx264", "-preset", "slow", "-profile:v", "high", "-level:v", "4.1",
            "-pix_fmt", "yuv420p", "-b:v", "16M", "-maxrate", "20M", "-bufsize", "32M",
            "-g", "60", "-keyint_min", "30", "-bf", "2",
            "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709",
            "-pass", "1", "-passlogfile", passlog, "-an", "-f", "mp4", null_sink,
        ])
        run([
            ffmpeg_bin, "-y", "-hide_banner", "-loglevel", "warning",
            "-i", master_mov,
            "-c:v", "libx264", "-preset", "slow", "-profile:v", "high", "-level:v", "4.1",
            "-pix_fmt", "yuv420p", "-b:v", "16M", "-maxrate", "20M", "-bufsize", "32M",
            "-g", "60", "-keyint_min", "30", "-bf", "2",
            "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709",
            "-pass", "2", "-passlogfile", passlog,
            "-c:a", aac_enc, "-b:a", "320k", "-ar", "48000", "-ac", "2",
            "-movflags", "+faststart", yt_mp4,
        ])

        # Step 6b: Encode Website 1080p delivery (CRF 25, H.264 High, 192k AAC)
        web_mp4 = os.path.join(FINAL_DIR, "KR_ClaimTheCity_Web.mp4")
        run([
            ffmpeg_bin, "-y", "-hide_banner", "-loglevel", "warning",
            "-i", master_mov,
            "-c:v", "libx264", "-preset", "medium", "-profile:v", "high", "-level:v", "4.1",
            "-pix_fmt", "yuv420p", "-crf", "25", "-maxrate", "6M", "-bufsize", "12M",
            "-g", "60", "-keyint_min", "30", "-bf", "2",
            "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709",
            "-c:a", aac_enc, "-b:a", "192k", "-ar", "48000", "-ac", "2",
            "-movflags", "+faststart", web_mp4,
        ])

        # Step 6c: Encode Website 720p lightweight companion (CRF 24, H.264 High, 128k AAC)
        web_720 = os.path.join(FINAL_DIR, "KR_ClaimTheCity_Web_720p.mp4")
        run([
            ffmpeg_bin, "-y", "-hide_banner", "-loglevel", "warning",
            "-i", master_mov,
            "-vf", "scale=1280:720:flags=lanczos",
            "-c:v", "libx264", "-preset", "medium", "-profile:v", "high", "-level:v", "3.1",
            "-pix_fmt", "yuv420p", "-crf", "24", "-maxrate", "3.5M", "-bufsize", "7M",
            "-g", "60", "-keyint_min", "30", "-bf", "2",
            "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709",
            "-c:a", aac_enc, "-b:a", "128k", "-ar", "48000", "-ac", "2",
            "-movflags", "+faststart", web_720,
        ])

    # Step 7: Run QA suite
    if not args.skip_qa:
        run([sys.executable, os.path.join(SCRIPT_DIR, "qa_final_deliveries.py")])

    print(f"\nDone! Final deliverables are located in: {FINAL_DIR}")


if __name__ == "__main__":
    main()
