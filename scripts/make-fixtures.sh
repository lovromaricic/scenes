#!/usr/bin/env bash
# Generates the small test media used by the Playwright tests (needs ffmpeg).
# Each clip is a solid colour (easy to check in the preview) with a moving test pattern in one
# corner and a sine tone, so both picture and sound can be verified.
set -euo pipefail
cd "$(dirname "$0")/../e2e/fixtures"

clip() { # name colour seconds tone vcodec acodec ext
	local name=$1 color=$2 secs=$3 tone=$4 vcodec=$5 acodec=$6 ext=$7
	ffmpeg -y -loglevel error \
		-f lavfi -i "color=c=${color}:s=640x360:r=30:d=${secs}" \
		-f lavfi -i "testsrc2=s=160x90:r=30:d=${secs}" \
		-f lavfi -i "sine=frequency=${tone}:sample_rate=48000:duration=${secs}" \
		-filter_complex "[0:v][1:v]overlay=16:16,format=yuv420p[v]" \
		-map "[v]" -map 2:a -shortest \
		$vcodec $acodec "${name}.${ext}"
}

H264="-c:v libx264 -preset veryfast -profile:v high -g 30 -crf 28"
AAC="-c:a aac -b:a 64k"
clip red red 4 440 "$H264" "$AAC" mp4
clip green 0x00ff00 3 660 "$H264" "$AAC" mp4
clip blue blue 3 880 "-c:v libvpx-vp9 -b:v 200k -g 30 -deadline realtime -cpu-used 8" "-c:a libopus -b:a 48k" webm

# A longer clip whose colour changes every second (for scrubbing accuracy), with sparse keyframes.
ffmpeg -y -loglevel error \
	-f lavfi -i "color=c=red:s=640x360:r=30:d=1" -f lavfi -i "color=c=0x00ff00:s=640x360:r=30:d=1" \
	-f lavfi -i "color=c=blue:s=640x360:r=30:d=1" -f lavfi -i "color=c=white:s=640x360:r=30:d=1" \
	-f lavfi -i "color=c=black:s=640x360:r=30:d=1" -f lavfi -i "color=c=yellow:s=640x360:r=30:d=1" \
	-filter_complex "[0:v][1:v][2:v][3:v][4:v][5:v]concat=n=6:v=1:a=0,format=yuv420p[v]" \
	-map "[v]" -c:v libx264 -preset veryfast -g 150 -crf 28 steps.mp4

ffmpeg -y -loglevel error -f lavfi -i "color=c=yellow:s=800x600:d=1" -frames:v 1 yellow.jpg

# "Music": a 12s 220 Hz tone (the clips use 440/660/880 Hz, so the mix can be told apart).
ffmpeg -y -loglevel error -f lavfi -i "sine=frequency=220:sample_rate=48000:duration=12" -c:a aac -b:a 64k music.m4a
printf 'Not a video.\n' > notes.txt
ls -la
