# Firebase playback position source of truth

Version: `1.1308.2003`

- Exact playback position is read directly from Firebase on every player open.
- Movies/concerts read `users/{uid}/continueWatching/{type_id}`.
- Episodes read `users/{uid}/episodeProgress/{seriesId_S{season}_E{episodeNumber}_{episodeId}}`.
- `positionSeconds`, `durationSeconds`, `positionUpdatedAt`, `progress`, and server `updatedAt` are written together during normal progress saves.
- Exact seconds are never written to localStorage/IndexedDB by Womo Web.
- Legacy local key `womo_playback_positions_v1` is deleted on load and never read.
- Continue Watching and episode percentage caches may remain local for UI rendering only.
- Shuffle neither reads nor writes playback progress.
