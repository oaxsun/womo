# WMO Cloudflare Media Bridge Trial

Version: Womo Web `1.1108.1200`

This build moves the `.wmo` byte-range bridge from GoDaddy/cPanel to:

`https://womo-media-api.jmnz-music.workers.dev/media`

The AES key flow remains Cloudflare `/playback` + D1.

## Request aggregation

WMO files keep their ~4-second encrypted segments. The player now requests up to 12 consecutive segments as one contiguous byte range for each track. At ~4 seconds per segment this is roughly 48 seconds per Worker media request, while individual segments remain independently encrypted and independently appendable after the response is split locally.

For WMO v3, video and audio tracks are stored in separate contiguous regions, so each track is batched independently.

## Revert

No `.wmo` needs to be regenerated. To return to the GoDaddy bridge, redeploy the previous Womo Web build (`1.1108.1135`) and the previous Worker API if desired. Archive files and D1 keys are unchanged.
