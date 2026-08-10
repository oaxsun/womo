# WMO key migration to Cloudflare

Current key API: `https://womo-media-api.jmnz-music.workers.dev`

- New Encoder registrations use `POST /register` and Cloudflare D1.
- Womo Web playback uses `POST /playback` with the Firebase ID token in the Authorization header.
- Womo Web now requests WMO keys exclusively from Cloudflare `/playback`; there is no cPanel key fallback.
- `media.php` remains on cPanel as the Archive.org Range bridge for now.
- Once legacy keys are migrated to D1, the fallback can be removed.
