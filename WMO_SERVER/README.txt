WMO SERVER v2.1 (CORS-simple transport fix)

Upload these files to:
  public_html/api/media/

- playback.php
- media.php

Keep your existing:
- register.php
- /home/gyu5la0fbzjq/private/data/config.php
- /home/gyu5la0fbzjq/private/data/media.db

This revision avoids browser OPTIONS preflight for normal WMO playback by using
CORS-simple text/plain POST requests. This is useful on shared cPanel hosting
where OPTIONS can be blocked or return HTTP 500.

MIGRATION NOTE (2026-08-10):
- New encryption keys are registered in Cloudflare D1 via womo-media-api.
- playback.php is no longer used by Womo Web for keys. Cloudflare /playback is the only key source.
- media.php remains temporarily required only as the Archive.org byte-range bridge.
- media.php remains required as the Archive.org byte-range bridge.
