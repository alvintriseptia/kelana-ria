#!/usr/bin/env python3
"""Cross-platform FFmpeg / FFprobe resolver for Remotion bundled binaries (macOS, Linux, Windows)."""
import glob
import os
import shutil
import subprocess

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
CTC_DIR = os.path.dirname(SCRIPT_DIR)


def find_binary(name: str) -> str:
    """Locate Remotion's bundled ffmpeg/ffprobe for the current OS, or fall back to PATH."""
    exe_names = [f"{name}.exe", name] if os.name == "nt" else [name]
    for exe in exe_names:
        pattern = os.path.join(CTC_DIR, "node_modules", "@remotion", "compositor-*", exe)
        matches = sorted(glob.glob(pattern))
        for m in matches:
            if os.path.isfile(m) and os.access(m, os.X_OK):
                return m
    found = shutil.which(name)
    if found:
        return found
    raise FileNotFoundError(
        f"Could not locate '{name}'. Run 'npm ci' inside claim-the-city/ or install FFmpeg on PATH."
    )


def pick_aac_encoder(ffmpeg_bin: str) -> str:
    """Prefer libfdk_aac when compiled into FFmpeg, otherwise fall back to standard aac."""
    try:
        out = subprocess.check_output(
            [ffmpeg_bin, "-hide_banner", "-encoders"],
            stderr=subprocess.STDOUT,
            text=True,
        )
        if "libfdk_aac" in out:
            return "libfdk_aac"
    except Exception:
        pass
    return "aac"
