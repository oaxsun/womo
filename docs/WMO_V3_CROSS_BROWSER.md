# WMO v3 cross-browser playback

WMO v3 separates H.264 video and AAC audio into independent encrypted fMP4 tracks.
The web engine attaches them to separate MediaSource SourceBuffers. This avoids the
muxed fMP4 append failures seen on Chrome/Windows while retaining Safari support.

Resume was also changed so the target range is buffered before applying currentTime.
The player uses the duration stored in the WMO header as a fallback when Safari
reports an infinite/temporary MediaSource duration, so progress is still saved.

WMO v1/v2 remain readable. For reliable Chrome/Windows playback, regenerate old
v2 titles with WMO Encoder Local v0.3.0 to produce v3 files.
