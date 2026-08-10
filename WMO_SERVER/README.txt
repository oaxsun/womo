WMO Media Server v2
===================

Upload/replace these files in cPanel:
  public_html/api/media/playback.php
  public_html/api/media/media.php

Keep your existing:
  public_html/api/media/register.php
  private/data/config.php
  private/data/media.db

No new config keys are required. v2 reuses register_token internally as the
HMAC signing secret for short-lived media bridge tokens.

Why v2 changes both PHP files:
- playback.php still verifies Firebase Auth once and returns the AES key.
- It also returns a 2-hour mediaToken.
- media.php validates that mediaToken locally for segment/range requests, so a
  movie does not cause hundreds of Firebase Auth REST calls while streaming.

The media bridge remains restricted to HTTPS archive.org/*.archive.org URLs
whose path ends in .wmo.
