#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# MoneyMart — generate the HLS streams the stream room plays.
#
# The stream room had nothing to play. Every live stream carried `hlsUrl: ""`, so
# "real HLS video in the stream room" — a stated requirement — was not met: the
# player only ever showed a poster image with an offline notice.
#
# This produces genuine HLS (an m3u8 playlist plus MPEG-TS segments) from ffmpeg,
# served by the API at /media/hls/<name>/index.m3u8.
#
# THE CONTENT IS DELIBERATELY ABSTRACT. It is a branded broadcast loop built from
# the MoneyMart palette — a moving gradient with animated gold banding — not
# footage of a real auction, and not a test card either. Nothing here pretends to
# be a real sale, which is the point: the stream ROOM and the HLS PIPELINE are what
# is being delivered and verified. A real event supplies its own encoder output.
#
# Segments are 2 seconds with a forced keyframe on every segment boundary, which is
# what lets a player start quickly and what an ad break or a late join depends on.
#
# Usage: bash scripts/generate-hls.sh [output-root]
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

ROOT="${1:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/services/api/media/hls}"
DURATION=24
FPS=25
GOP=50            # 2s at 25fps — one keyframe per segment
SEGMENT=2

if ! command -v ffmpeg >/dev/null 2>&1; then
  echo "ffmpeg is required to generate the HLS streams." >&2
  exit 1
fi

mkdir -p "$ROOT"

# name|colour-a|colour-b|accent
VARIANT_SPECS=(
  "main|0x0D1B2A|0x1C1C1E|0xF5A623"
  "gold|0x1C1C1E|0x0D1B2A|0xFFC85C"
  "mint|0x0D1B2A|0x12233A|0x00D4A1"
)

render() {
  local name="$1" col_a="$2" col_b="$3" accent="$4"
  local dir="$ROOT/$name"
  rm -rf "$dir"
  mkdir -p "$dir"

  # `gradients` animates between the two brand colours; the two `drawbox` bands give
  # a slow broadcast sweep plus a fixed gold rule along the bottom.
  ffmpeg -hide_banner -loglevel error -y \
    -f lavfi -i "gradients=size=1280x720:rate=${FPS}:duration=${DURATION}:c0=${col_a}:c1=${col_b}:x0=0:y0=0:x1=1280:y1=720:speed=0.02" \
    -f lavfi -i "sine=frequency=110:duration=${DURATION}" \
    -filter_complex "\
[0:v]drawbox=x=0:y=660:w=1280:h=6:color=${accent}@0.85:t=fill,\
drawbox=x='mod(t*180\,1600)-320':y=0:w=320:h=720:color=${accent}@0.06:t=fill,\
drawbox=x=0:y=0:w=1280:h=3:color=${accent}@0.5:t=fill[vid]" \
    -map "[vid]" -map 1:a \
    -c:v libx264 -preset veryfast -profile:v main -pix_fmt yuv420p \
    -g "$GOP" -keyint_min "$GOP" -sc_threshold 0 \
    -c:a aac -b:a 96k -ac 2 -ar 44100 \
    -f hls -hls_time "$SEGMENT" -hls_playlist_type vod \
    -hls_segment_filename "$dir/seg%03d.ts" \
    "$dir/index.m3u8"

  local size
  size=$(du -sh "$dir" | cut -f1)
  echo "  $name  $size  $(ls "$dir"/*.ts 2>/dev/null | wc -l | tr -d ' ') segments"
}

echo "Generating HLS into $ROOT"
for spec in "${VARIANT_SPECS[@]}"; do
  IFS='|' read -r name a b accent <<< "$spec"
  render "$name" "$a" "$b" "$accent"
done

echo
echo "Playlists:"
find "$ROOT" -name index.m3u8 | sort | sed 's/^/  /'
