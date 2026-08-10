WMO Media Engine server files

Upload these files to:
  public_html/api/media/

Required:
  playback.php  - returns the AES media key after Firebase Auth validation
  media.php     - authenticated Archive.org byte/range bridge for .wmo files

Keep these existing private files unchanged:
  /home/gyu5la0fbzjq/private/data/config.php
  /home/gyu5la0fbzjq/private/data/media.db

Why media.php exists:
Safari blocks JavaScript fetch() when archive.org redirects a download URL to an ia*.archive.org host without matching CORS headers. media.php follows that redirect server-side and returns the requested bytes to Womo with CORS enabled.

Security:
- media.php requires a valid Firebase ID token.
- media.php only accepts HTTPS URLs on archive.org / *.archive.org.
- media.php only proxies paths ending in .wmo.
- Range requests are forwarded, preparing WMO for progressive playback later.
