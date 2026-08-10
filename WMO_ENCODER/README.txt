WMO Encoder v2 - segmented streaming format
============================================

Requirements:
- Node.js
- FFmpeg available in Terminal (`ffmpeg -version`)
- WMO_REGISTER_TOKEN loaded as an environment variable

Usage:
1) cd into this folder
2) read -s WMO_REGISTER_TOKEN
3) export WMO_REGISTER_TOKEN
4) node encoder-v2.js "/path/to/movie.mp4"

The encoder uses FFmpeg to package the source as fragmented MP4 (fMP4) segments,
then encrypts the init segment and every media segment independently with
AES-256-GCM. One .wmo file is produced.

Recommended source for v2: MP4 with H.264 video + AAC audio.
The original MP4 is never overwritten.

WMO v1 files remain supported by Womo Web, but use the old full-file-in-memory
compatibility path. New files should be encoded with encoder-v2.js.
