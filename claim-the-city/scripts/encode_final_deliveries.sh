#!/usr/bin/env bash
# Milestone 4.0 — Encode YouTube & Website delivery versions directly from KR_ClaimTheCity_Master.mov
# Preserves locked 1920x1080 @ 30 fps (2,508 frames / 83.60s), BT.709 SDR, and mastered 48 kHz stereo audio.
# Avoids generational lossy re-encoding by sourcing exclusively from the ProRes 422 archival master.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${PROJECT_DIR}"

FFMPEG="$(ls "${PROJECT_DIR}"/node_modules/@remotion/compositor-*/ffmpeg 2>/dev/null | head -n 1 || command -v ffmpeg)"
AAC_CODEC="$("${FFMPEG}" -hide_banner -encoders 2>/dev/null | grep -q libfdk_aac && echo libfdk_aac || echo aac)"
MASTER="renders/final/KR_ClaimTheCity_Master.mov"
YOUTUBE_OUT="renders/final/KR_ClaimTheCity_YouTube.mp4"
WEB_OUT="renders/final/KR_ClaimTheCity_Web.mp4"
WEB_720_OUT="renders/final/KR_ClaimTheCity_Web_720p.mp4"
WEB_CRF="${WEB_CRF:-25}"
PASSLOG="/tmp/kr_yt_2pass"

if [[ ! -f "${MASTER}" ]]; then
  echo "ERROR: Archival master not found at ${MASTER}" >&2
  exit 1
fi

echo "=== 1/3 Encoding YouTube Delivery (2-pass VBR 16 Mbps [12-20 Mbps], H.264 High, 320k FDK-AAC) ==="
rm -f "${PASSLOG}"*

"${FFMPEG}" -y -hide_banner -loglevel warning \
  -i "${MASTER}" \
  -c:v libx264 -preset slow -profile:v high -level:v 4.1 -pix_fmt yuv420p \
  -b:v 16M -maxrate 20M -bufsize 32M \
  -g 60 -keyint_min 30 -bf 2 \
  -colorspace bt709 -color_primaries bt709 -color_trc bt709 \
  -pass 1 -passlogfile "${PASSLOG}" \
  -an -f mp4 /dev/null

"${FFMPEG}" -y -hide_banner -loglevel warning \
  -i "${MASTER}" \
  -c:v libx264 -preset slow -profile:v high -level:v 4.1 -pix_fmt yuv420p \
  -b:v 16M -maxrate 20M -bufsize 32M \
  -g 60 -keyint_min 30 -bf 2 \
  -colorspace bt709 -color_primaries bt709 -color_trc bt709 \
  -pass 2 -passlogfile "${PASSLOG}" \
  -c:a "${AAC_CODEC}" -b:a 320k -ar 48000 -ac 2 \
  -movflags +faststart \
  "${YOUTUBE_OUT}"

rm -f "${PASSLOG}"*
echo "Created ${YOUTUBE_OUT}"

echo "=== 2/3 Encoding Website 1080p Delivery (CRF ${WEB_CRF}, H.264 High, 192k FDK-AAC, +faststart) ==="
"${FFMPEG}" -y -hide_banner -loglevel warning \
  -i "${MASTER}" \
  -c:v libx264 -preset medium -profile:v high -level:v 4.1 -pix_fmt yuv420p \
  -crf "${WEB_CRF}" -maxrate 6M -bufsize 12M \
  -g 60 -keyint_min 30 -bf 2 \
  -colorspace bt709 -color_primaries bt709 -color_trc bt709 \
  -c:a "${AAC_CODEC}" -b:a 192k -ar 48000 -ac 2 \
  -movflags +faststart \
  "${WEB_OUT}"

echo "Created ${WEB_OUT}"

echo "=== 3/3 Encoding Website 720p Companion (CRF 24, H.264 High, 128k FDK-AAC, +faststart) ==="
"${FFMPEG}" -y -hide_banner -loglevel warning \
  -i "${MASTER}" \
  -vf "scale=1280:720:flags=lanczos" \
  -c:v libx264 -preset medium -profile:v high -level:v 3.1 -pix_fmt yuv420p \
  -crf 24 -maxrate 3.5M -bufsize 7M \
  -g 60 -keyint_min 30 -bf 2 \
  -colorspace bt709 -color_primaries bt709 -color_trc bt709 \
  -c:a "${AAC_CODEC}" -b:a 128k -ar 48000 -ac 2 \
  -movflags +faststart \
  "${WEB_720_OUT}"

echo "Created ${WEB_720_OUT}"
ls -lh "${MASTER}" "${YOUTUBE_OUT}" "${WEB_OUT}" "${WEB_720_OUT}"
