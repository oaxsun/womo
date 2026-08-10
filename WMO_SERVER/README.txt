WMO Media Engine v1 - server requirement

Replace the current public_html/api/media/playback.php with the playback.php in this folder.
The only functional change is CORS/preflight support for https://womo.oaxsun.tech, required because Womo Web calls the key endpoint from the browser.

Keep private/data/config.php and private/data/media.db exactly where they are.
Do not move them into public_html.
