(function () {
  "use strict";

  const HEADER_SIZE = 256;
  const WMO_MAGIC = "WMO1";
  const INDEX_MAGIC = "WIDX";
  const KEY_ENDPOINT = "https://womo-media-api.jmnz-music.workers.dev/playback";
  const MEDIA_ENDPOINT = "https://gruposegel.com/api/media/media.php";
  const START_BUFFER_SECONDS = 12;
  const TARGET_BUFFER_SECONDS = 30;

  let activeObjectUrl = "";
  let activeAbortController = null;
  let fullFileCache = null;
  let activeSourceUrl = "";
  let activeStreamCleanup = null;

  function emit(name, detail = {}) {
    try { window.dispatchEvent(new CustomEvent(name, { detail })); } catch (_) {}
  }

  function setLoadingProgress(percent, stage) {
    emit("wmo:media-progress", { percent, stage });
  }

  function resetMediaOnly(video) {
    if (activeStreamCleanup) {
      try { activeStreamCleanup(); } catch (_) {}
      activeStreamCleanup = null;
    }
    if (activeObjectUrl) {
      try { URL.revokeObjectURL(activeObjectUrl); } catch (_) {}
      activeObjectUrl = "";
    }
    if (video) {
      try { video.pause(); } catch (_) {}
      try { video.removeAttribute("src"); video.load(); } catch (_) {}
    }
  }

  function destroy() {
    if (activeAbortController) {
      try { activeAbortController.abort(); } catch (_) {}
      activeAbortController = null;
    }
    if (activeStreamCleanup) {
      try { activeStreamCleanup(); } catch (_) {}
      activeStreamCleanup = null;
    }
    if (activeObjectUrl) {
      try { URL.revokeObjectURL(activeObjectUrl); } catch (_) {}
      activeObjectUrl = "";
    }
    fullFileCache = null;
    activeSourceUrl = "";
  }

  function uuidBytesToString(bytes) {
    const hex = Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("");
    return [
      hex.slice(0, 8),
      hex.slice(8, 12),
      hex.slice(12, 16),
      hex.slice(16, 20),
      hex.slice(20, 32)
    ].join("-");
  }

  function base64ToBytes(value) {
    const raw = atob(value);
    const out = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
  }

  async function getFirebaseIdToken(forceRefresh = false) {
    if (!window.firebase || !firebase.auth) throw new Error("Firebase Auth is not available");
    const user = firebase.auth().currentUser;
    if (!user) throw new Error("WMO playback requires an authenticated user");
    return user.getIdToken(forceRefresh);
  }

  async function fetchRange(url, start, end, signal, authToken) {
    if (fullFileCache && activeSourceUrl === url) {
      return fullFileCache.slice(start, end + 1);
    }

    // Use a CORS-simple POST to avoid cPanel/WAF preflight failures.
    // The PHP bridge applies the byte Range upstream to Archive.org.
    const token = authToken || await getFirebaseIdToken(false);
    const response = await fetch(MEDIA_ENDPOINT, {
      method: "POST",
      mode: "cors",
      credentials: "omit",
      cache: "no-store",
      headers: {
        "Content-Type": "text/plain;charset=UTF-8"
      },
      body: JSON.stringify({
        url,
        start,
        end,
        token
      }),
      signal
    });

    if (!response.ok) throw new Error(`WMO media request failed (HTTP ${response.status})`);
    const buffer = await response.arrayBuffer();

    if (response.status === 200) {
      fullFileCache = buffer;
      activeSourceUrl = url;
      if (buffer.byteLength < end + 1) throw new Error("WMO source returned an incomplete file");
      return buffer.slice(start, end + 1);
    }

    return buffer;
  }

  async function requestCloudflarePlayback(contentId, idToken, signal) {
    const response = await fetch(KEY_ENDPOINT, {
      method: "POST",
      mode: "cors",
      credentials: "omit",
      cache: "no-store",
      headers: {
        "Authorization": `Bearer ${idToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ contentId }),
      signal
    });
    let payload = null;
    try { payload = await response.json(); } catch (_) {}
    return { response, payload };
  }

  async function getPlaybackSession(contentId, signal) {
    const idToken = await getFirebaseIdToken(false);
    const { response, payload } = await requestCloudflarePlayback(contentId, idToken, signal);

    if (!response.ok || !payload || !payload.ok || !payload.key) {
      const reason = payload?.error || `HTTP ${response.status}`;
      throw new Error(`WMO key request failed: ${reason}`);
    }

    const keyBytes = base64ToBytes(payload.key);
    if (keyBytes.byteLength !== 32) throw new Error("WMO key server returned an invalid AES-256 key");

    const key = await crypto.subtle.importKey(
      "raw",
      keyBytes,
      { name: "AES-GCM" },
      false,
      ["decrypt"]
    );

    return {
      key,
      mediaToken: String(payload.mediaToken || "")
    };
  }

  function parseHeader(buffer) {
    if (buffer.byteLength < HEADER_SIZE) throw new Error("WMO header is incomplete");
    const bytes = new Uint8Array(buffer);
    const view = new DataView(buffer);
    const magic = new TextDecoder().decode(bytes.slice(0, 4));
    if (magic !== WMO_MAGIC) throw new Error("Unsupported WMO file");

    const version = view.getUint8(4);
    const flags = view.getUint8(5);
    const headerSize = view.getUint16(6, true);
    const contentId = uuidBytesToString(bytes.slice(16, 32));
    const originalSize = Number(view.getBigUint64(32, true));
    const chunkSize = view.getUint32(40, true);
    const chunkCount = view.getUint32(44, true);
    const indexOffset = Number(view.getBigUint64(48, true));
    const indexSize = Number(view.getBigUint64(56, true));
    const duration = version >= 2 ? view.getFloat64(64, true) : 0;
    const mediaSegmentCount = version >= 2 ? view.getUint32(72, true) : 0;
    const audioSegmentCount = version >= 3 ? view.getUint32(76, true) : 0;

    if ((version !== 1 && version !== 2 && version !== 3) || headerSize !== HEADER_SIZE) {
      throw new Error(`Unsupported WMO version ${version}`);
    }
    if ((flags & 1) !== 1) throw new Error("This WMO file is not encrypted as expected");
    if (!chunkCount || !indexOffset || !indexSize) throw new Error("WMO index metadata is missing");

    return {
      version, flags, contentId, originalSize, chunkSize, chunkCount,
      indexOffset, indexSize, duration, mediaSegmentCount, audioSegmentCount
    };
  }

  function parseIndex(buffer, header) {
    const bytes = new Uint8Array(buffer);
    const view = new DataView(buffer);
    if (buffer.byteLength < 12) throw new Error("WMO index is incomplete");
    const magic = new TextDecoder().decode(bytes.slice(0, 4));
    if (magic !== INDEX_MAGIC) throw new Error("Invalid WMO index");
    const version = view.getUint32(4, true);
    const count = view.getUint32(8, true);
    if (version !== header.version || count !== header.chunkCount) throw new Error("WMO index mismatch");

    const entries = [];
    let offset = 12;

    if (version === 1) {
      for (let i = 0; i < count; i++) {
        if (offset + 24 > buffer.byteLength) throw new Error("WMO index entry is incomplete");
        entries.push({
          chunkIndex: view.getUint32(offset, true),
          type: 1,
          offset: Number(view.getBigUint64(offset + 4, true)),
          totalLength: view.getUint32(offset + 12, true),
          plainLength: view.getUint32(offset + 16, true),
          startTime: 0,
          duration: 0
        });
        offset += 24;
      }
      return entries;
    }

    for (let i = 0; i < count; i++) {
      if (offset + 40 > buffer.byteLength) throw new Error("WMO v2 index entry is incomplete");
      entries.push({
        chunkIndex: view.getUint32(offset, true),
        type: view.getUint8(offset + 4),
        offset: Number(view.getBigUint64(offset + 8, true)),
        totalLength: view.getUint32(offset + 16, true),
        plainLength: view.getUint32(offset + 20, true),
        startTime: view.getFloat64(offset + 24, true),
        duration: view.getFloat64(offset + 32, true)
      });
      offset += 40;
    }
    return entries;
  }

  async function decryptChunk(buffer, entry, key) {
    if (buffer.byteLength < 40) throw new Error(`WMO chunk ${entry.chunkIndex} is incomplete`);
    const bytes = new Uint8Array(buffer);
    const view = new DataView(buffer);
    const storedIndex = view.getUint32(0, true);
    const plainLength = view.getUint32(4, true);
    const encryptedLength = view.getUint32(8, true);
    if (storedIndex !== entry.chunkIndex || plainLength !== entry.plainLength) {
      throw new Error(`WMO chunk ${entry.chunkIndex} metadata mismatch`);
    }

    const nonce = bytes.slice(12, 24);
    const authTag = bytes.slice(24, 40);
    const encrypted = bytes.slice(40, 40 + encryptedLength);
    if (encrypted.byteLength !== encryptedLength) throw new Error(`WMO chunk ${entry.chunkIndex} payload is incomplete`);

    const ciphertextWithTag = new Uint8Array(encryptedLength + 16);
    ciphertextWithTag.set(encrypted, 0);
    ciphertextWithTag.set(authTag, encryptedLength);

    const aad = new Uint8Array(4);
    new DataView(aad.buffer).setUint32(0, entry.chunkIndex, true);

    const plain = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: nonce,
        additionalData: aad,
        tagLength: 128
      },
      key,
      ciphertextWithTag
    );

    if (plain.byteLength !== plainLength) throw new Error(`WMO chunk ${entry.chunkIndex} decrypted size mismatch`);
    return new Uint8Array(plain);
  }

  function findAscii(bytes, text) {
    const target = Array.from(text, c => c.charCodeAt(0));
    outer: for (let i = 0; i <= bytes.length - target.length; i++) {
      for (let j = 0; j < target.length; j++) if (bytes[i + j] !== target[j]) continue outer;
      return i;
    }
    return -1;
  }

  function detectMp4Mime(initBytes) {
    const avcC = findAscii(initBytes, "avcC");
    const hvcC = findAscii(initBytes, "hvcC");
    const hev1 = findAscii(initBytes, "hev1");
    const hvc1 = findAscii(initBytes, "hvc1");
    const mp4a = findAscii(initBytes, "mp4a");
    const codecs = [];

    if (avcC >= 0 && avcC + 8 < initBytes.length) {
      const profile = initBytes[avcC + 5].toString(16).padStart(2, "0");
      const compat = initBytes[avcC + 6].toString(16).padStart(2, "0");
      const level = initBytes[avcC + 7].toString(16).padStart(2, "0");
      codecs.push(`avc1.${profile}${compat}${level}`);
    } else if (hvcC >= 0 || hvc1 >= 0 || hev1 >= 0) {
      // Safari may support HEVC while Chrome/Windows often does not. Keep a
      // precise codec label so MediaSource can reject it cleanly instead of
      // failing later during appendBuffer.
      codecs.push(hvc1 >= 0 ? "hvc1" : "hev1");
    }
    if (mp4a >= 0) codecs.push("mp4a.40.2");

    const precise = codecs.length ? `video/mp4; codecs="${codecs.join(", ")}"` : "";
    const MS = window.MediaSource || window.ManagedMediaSource;
    if (precise && MS && typeof MS.isTypeSupported === "function") {
      try {
        if (MS.isTypeSupported(precise)) return precise;
      } catch (_) {}
      throw new Error(`WMO codec is not supported by this browser (${precise})`);
    }
    if (precise) return precise;
    try {
      if (!MS || typeof MS.isTypeSupported !== "function" || MS.isTypeSupported("video/mp4")) return "video/mp4";
    } catch (_) {}
    throw new Error("This browser cannot play the codecs inside this WMO file");
  }

  function waitForLoadedMetadata(video, signal) {
    return new Promise((resolve, reject) => {
      if (video.readyState >= 1 && Number.isFinite(video.duration)) return resolve();
      const onLoaded = () => cleanup(resolve);
      const onError = () => cleanup(() => reject(new Error("WMO media metadata failed to load")));
      const onAbort = () => cleanup(() => reject(new DOMException("Aborted", "AbortError")));
      function cleanup(done) {
        video.removeEventListener("loadedmetadata", onLoaded);
        video.removeEventListener("error", onError);
        if (signal) signal.removeEventListener("abort", onAbort);
        done();
      }
      video.addEventListener("loadedmetadata", onLoaded, { once: true });
      video.addEventListener("error", onError, { once: true });
      if (signal) signal.addEventListener("abort", onAbort, { once: true });
    });
  }

  function resolveStartTime(options, duration) {
    const explicit = Number(options?.startTime);
    if (Number.isFinite(explicit) && explicit >= 0) return Math.min(explicit, Math.max(0, duration - 0.05));
    const progress = Number(options?.startProgress);
    if (Number.isFinite(progress) && progress > 0 && progress < 98 && duration > 0) {
      return Math.min((progress / 100) * duration, Math.max(0, duration - 0.05));
    }
    return 0;
  }

  function waitForSourceOpen(mediaSource, signal) {
    return new Promise((resolve, reject) => {
      if (mediaSource.readyState === "open") return resolve();
      const onOpen = () => cleanup(resolve);
      const onError = () => cleanup(() => reject(new Error("MediaSource failed to open")));
      const onAbort = () => cleanup(() => reject(new DOMException("Aborted", "AbortError")));
      function cleanup(done) {
        mediaSource.removeEventListener("sourceopen", onOpen);
        mediaSource.removeEventListener("sourceclose", onError);
        if (signal) signal.removeEventListener("abort", onAbort);
        done();
      }
      mediaSource.addEventListener("sourceopen", onOpen, { once: true });
      mediaSource.addEventListener("sourceclose", onError, { once: true });
      if (signal) signal.addEventListener("abort", onAbort, { once: true });
    });
  }

  function appendBuffer(sourceBuffer, bytes, signal, label = "media") {
    return new Promise((resolve, reject) => {
      const onEnd = () => cleanup(resolve);
      const onError = () => cleanup(() => reject(new Error(`WMO ${label} SourceBuffer append failed`)));
      const onAbort = () => cleanup(() => reject(new DOMException("Aborted", "AbortError")));
      function cleanup(done) {
        sourceBuffer.removeEventListener("updateend", onEnd);
        sourceBuffer.removeEventListener("error", onError);
        if (signal) signal.removeEventListener("abort", onAbort);
        done();
      }
      sourceBuffer.addEventListener("updateend", onEnd, { once: true });
      sourceBuffer.addEventListener("error", onError, { once: true });
      if (signal) signal.addEventListener("abort", onAbort, { once: true });
      try { sourceBuffer.appendBuffer(bytes); }
      catch (error) {
        cleanup(() => reject(new Error(`WMO ${label} append threw: ${error?.name || "Error"}: ${error?.message || error}`)));
      }
    });
  }

  function bufferedEndAt(sourceBuffer, time) {
    try {
      const ranges = sourceBuffer.buffered;
      for (let i = 0; i < ranges.length; i++) {
        const start = ranges.start(i);
        const end = ranges.end(i);
        if (time >= start - 0.25 && time <= end + 0.25) return end;
      }
    } catch (_) {}
    return time;
  }

  function isTimeBuffered(sourceBuffer, time) {
    return bufferedEndAt(sourceBuffer, time) > time + 0.05;
  }

  function findMediaEntryIndex(mediaEntries, time) {
    if (!mediaEntries.length) return -1;
    let lo = 0;
    let hi = mediaEntries.length - 1;
    let best = 0;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (mediaEntries[mid].startTime <= time + 0.001) {
        best = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    return Math.min(best, mediaEntries.length - 1);
  }

  async function loadV1Memory(url, video, header, entries, session, signal, options = {}) {
    const plainParts = new Array(entries.length);
    let plainBytes = 0;
    const authToken = session.mediaToken || await getFirebaseIdToken(false);

    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      const encryptedChunk = await fetchRange(url, entry.offset, entry.offset + entry.totalLength - 1, signal, authToken);
      const plain = await decryptChunk(encryptedChunk, entry, session.key);
      plainParts[i] = plain;
      plainBytes += plain.byteLength;
      const percent = Math.max(5, Math.min(99, Math.round(((i + 1) / entries.length) * 95)));
      setLoadingProgress(percent, "decrypt");
    }

    if (plainBytes !== header.originalSize) throw new Error("WMO decrypted file size does not match the original media size");
    const blob = new Blob(plainParts, { type: "video/mp4" });
    activeObjectUrl = URL.createObjectURL(blob);
    video.src = activeObjectUrl;
    video.load();
    await waitForLoadedMetadata(video, signal);
    const startTime = resolveStartTime(options, Number(video.duration || 0));
    if (startTime > 0) {
      try { video.currentTime = startTime; } catch (_) {}
    }
    setLoadingProgress(100, "ready");
    return { contentId: header.contentId, originalSize: header.originalSize, chunks: header.chunkCount, mode: "memory-blob-v1", startTime };
  }


  function detectVideoMime(initBytes) {
    const avcC = findAscii(initBytes, "avcC");
    if (avcC < 0 || avcC + 8 >= initBytes.length) throw new Error("WMO video init segment does not contain AVC configuration");
    const profile = initBytes[avcC + 5].toString(16).padStart(2, "0");
    const compat = initBytes[avcC + 6].toString(16).padStart(2, "0");
    const level = initBytes[avcC + 7].toString(16).padStart(2, "0");
    const mime = `video/mp4; codecs="avc1.${profile}${compat}${level}"`;
    const MS = window.MediaSource || window.ManagedMediaSource;
    if (MS && typeof MS.isTypeSupported === "function" && !MS.isTypeSupported(mime)) {
      throw new Error(`WMO video codec is not supported by this browser (${mime})`);
    }
    return mime;
  }

  function detectAudioMime(initBytes) {
    if (findAscii(initBytes, "mp4a") < 0) throw new Error("WMO audio init segment does not contain AAC audio");
    const mime = 'audio/mp4; codecs="mp4a.40.2"';
    const MS = window.MediaSource || window.ManagedMediaSource;
    if (MS && typeof MS.isTypeSupported === "function" && !MS.isTypeSupported(mime)) {
      throw new Error(`WMO audio codec is not supported by this browser (${mime})`);
    }
    return mime;
  }

  function bufferAhead(sourceBuffer, time) {
    return Math.max(0, bufferedEndAt(sourceBuffer, time) - time);
  }

  async function loadV3Stream(url, video, header, entries, session, signal, options = {}) {
    const MS = window.MediaSource || window.ManagedMediaSource;
    if (!MS) throw new Error("This browser does not support MediaSource streaming");

    const videoInit = entries.find(e => e.type === 0);
    const videoEntries = entries.filter(e => e.type === 1).sort((a,b) => a.startTime - b.startTime);
    const audioInit = entries.find(e => e.type === 2);
    const audioEntries = entries.filter(e => e.type === 3).sort((a,b) => a.startTime - b.startTime);
    if (!videoInit || !videoEntries.length) throw new Error("WMO v3 is missing its video track");

    const authToken = session.mediaToken || await getFirebaseIdToken(false);
    setLoadingProgress(5, "init");
    const videoInitPlain = await decryptChunk(
      await fetchRange(url, videoInit.offset, videoInit.offset + videoInit.totalLength - 1, signal, authToken),
      videoInit, session.key
    );
    const audioInitPlain = audioInit ? await decryptChunk(
      await fetchRange(url, audioInit.offset, audioInit.offset + audioInit.totalLength - 1, signal, authToken),
      audioInit, session.key
    ) : null;

    const videoMime = detectVideoMime(videoInitPlain);
    const audioMime = audioInitPlain ? detectAudioMime(audioInitPlain) : "";
    const mediaSource = new MS();
    activeObjectUrl = URL.createObjectURL(mediaSource);
    video.src = activeObjectUrl;
    video.load();
    await waitForSourceOpen(mediaSource, signal);

    const videoBuffer = mediaSource.addSourceBuffer(videoMime);
    const audioBuffer = audioInitPlain ? mediaSource.addSourceBuffer(audioMime) : null;
    try { videoBuffer.mode = "segments"; } catch (_) {}
    try { if (audioBuffer) audioBuffer.mode = "segments"; } catch (_) {}
    await appendBuffer(videoBuffer, videoInitPlain, signal, "video init");
    if (audioBuffer) await appendBuffer(audioBuffer, audioInitPlain, signal, "audio init");

    if (Number.isFinite(header.duration) && header.duration > 0) {
      try { mediaSource.duration = header.duration; } catch (_) {}
    }

    const desiredStart = resolveStartTime(options, Number(header.duration || 0));
    let destroyed = false;
    let filling = false;
    let initialReady = false;
    let firstReadyResolve, firstReadyReject;
    const firstReady = new Promise((resolve,reject) => { firstReadyResolve=resolve; firstReadyReject=reject; });

    async function appendEntry(sb, entry, label) {
      const encrypted = await fetchRange(url, entry.offset, entry.offset + entry.totalLength - 1, signal, authToken);
      const plain = await decryptChunk(encrypted, entry, session.key);
      await appendBuffer(sb, plain, signal, label);
    }

    async function ensureTrackBuffered(sb, list, time, targetAhead, label) {
      if (!sb || !list.length) return;
      let guard = 0;
      let idx = findMediaEntryIndex(list, time);
      if (idx < 0) idx = 0;
      while (!destroyed && !signal.aborted && guard++ < 20) {
        if (bufferAhead(sb, time) >= targetAhead) break;
        while (idx < list.length) {
          const entry = list[idx];
          const probe = entry.startTime + Math.max(0.04, Math.min(entry.duration * 0.5, 0.4));
          if (!isTimeBuffered(sb, probe)) break;
          idx++;
        }
        if (idx >= list.length) break;
        await appendEntry(sb, list[idx], label);
        idx++;
      }
    }

    async function fillBuffer(forceTime = null) {
      if (filling || destroyed || signal.aborted || mediaSource.readyState !== "open") return;
      filling = true;
      try {
        // On initial resume, do not trust video.currentTime before the target
        // range exists. Safari may clamp an early seek back to zero.
        const baseTime = Number.isFinite(forceTime) ? forceTime : (Number.isFinite(video.currentTime) ? video.currentTime : 0);
        const target = initialReady ? TARGET_BUFFER_SECONDS : START_BUFFER_SECONDS;
        await ensureTrackBuffered(videoBuffer, videoEntries, baseTime, target, "video");
        if (audioBuffer) await ensureTrackBuffered(audioBuffer, audioEntries, baseTime, target, "audio");

        const vAhead = bufferAhead(videoBuffer, baseTime);
        const aAhead = audioBuffer ? bufferAhead(audioBuffer, baseTime) : vAhead;
        const readyAhead = Math.min(vAhead, aAhead);

        if (!initialReady && readyAhead > 0.25) {
          initialReady = true;
          if (desiredStart > 0) {
            try { video.currentTime = desiredStart; } catch (_) {}
          }
          setLoadingProgress(100, "ready");
          firstReadyResolve();
        }
      } catch (error) {
        if (!initialReady) firstReadyReject(error);
        else console.error("WMO v3 background buffer failed", error);
      } finally {
        filling = false;
      }
    }

    const onSeeking = () => fillBuffer(Number(video.currentTime || 0)).catch(() => {});
    const onTime = () => fillBuffer(null).catch(() => {});
    video.addEventListener("seeking", onSeeking);
    video.addEventListener("timeupdate", onTime);
    video.addEventListener("waiting", onTime);
    video.addEventListener("playing", onTime);

    activeStreamCleanup = () => {
      destroyed = true;
      video.removeEventListener("seeking", onSeeking);
      video.removeEventListener("timeupdate", onTime);
      video.removeEventListener("waiting", onTime);
      video.removeEventListener("playing", onTime);
      try { if (mediaSource.readyState === "open" && !videoBuffer.updating && (!audioBuffer || !audioBuffer.updating)) mediaSource.endOfStream(); } catch (_) {}
    };

    setLoadingProgress(8, "stream");
    await fillBuffer(desiredStart);
    await firstReady;

    return {
      contentId: header.contentId,
      originalSize: header.originalSize,
      chunks: header.chunkCount,
      mediaSegments: videoEntries.length,
      audioSegments: audioEntries.length,
      duration: header.duration,
      mode: "media-source-v3-split-tracks",
      videoMime, audioMime,
      startTime: desiredStart
    };
  }

  async function loadV2Stream(url, video, header, entries, session, signal, options = {}) {
    const MS = window.MediaSource || window.ManagedMediaSource;
    if (!MS) throw new Error("This browser does not support MediaSource streaming");

    const initEntry = entries.find(entry => entry.type === 0);
    const mediaEntries = entries.filter(entry => entry.type === 1).sort((a, b) => a.startTime - b.startTime);
    if (!initEntry || !mediaEntries.length) throw new Error("WMO v2 is missing its init or media segments");

    const authToken = session.mediaToken || await getFirebaseIdToken(false);
    setLoadingProgress(5, "init");
    const initEncrypted = await fetchRange(url, initEntry.offset, initEntry.offset + initEntry.totalLength - 1, signal, authToken);
    const initPlain = await decryptChunk(initEncrypted, initEntry, session.key);
    const mime = detectMp4Mime(initPlain);

    const mediaSource = new MS();
    activeObjectUrl = URL.createObjectURL(mediaSource);
    video.src = activeObjectUrl;
    video.load();
    await waitForSourceOpen(mediaSource, signal);

    const sourceBuffer = mediaSource.addSourceBuffer(mime);
    try { sourceBuffer.mode = "segments"; } catch (_) {}
    await appendBuffer(sourceBuffer, initPlain, signal);

    if (Number.isFinite(header.duration) && header.duration > 0) {
      try { mediaSource.duration = header.duration; } catch (_) {}
    }

    const desiredStart = resolveStartTime(options, Number(header.duration || 0));
    let initialBufferTime = desiredStart;

    let filling = false;
    let destroyed = false;
    let firstReadyResolved = false;
    let firstReadyResolve;
    let firstReadyReject;
    const firstReady = new Promise((resolve, reject) => {
      firstReadyResolve = resolve;
      firstReadyReject = reject;
    });

    async function fetchAndAppend(entry) {
      const encrypted = await fetchRange(url, entry.offset, entry.offset + entry.totalLength - 1, signal, authToken);
      const plain = await decryptChunk(encrypted, entry, session.key);
      await appendBuffer(sourceBuffer, plain, signal);
    }

    async function fillBuffer() {
      if (filling || destroyed || signal.aborted || mediaSource.readyState !== "open") return;
      filling = true;
      try {
        let guard = 0;
        while (!destroyed && !signal.aborted && guard++ < 30) {
          const currentTime = !firstReadyResolved && Number.isFinite(initialBufferTime)
            ? initialBufferTime
            : (Number.isFinite(video.currentTime) ? video.currentTime : 0);
          const end = bufferedEndAt(sourceBuffer, currentTime);
          const ahead = Math.max(0, end - currentTime);

          if (ahead >= TARGET_BUFFER_SECONDS) break;

          let index = findMediaEntryIndex(mediaEntries, currentTime);
          if (index < 0) index = 0;

          while (index < mediaEntries.length) {
            const entry = mediaEntries[index];
            const probe = entry.startTime + Math.max(0.05, Math.min(entry.duration * 0.5, 0.5));
            if (!isTimeBuffered(sourceBuffer, probe)) break;
            index++;
          }

          if (index >= mediaEntries.length) break;
          await fetchAndAppend(mediaEntries[index]);

          const afterEnd = bufferedEndAt(sourceBuffer, currentTime);
          const afterAhead = Math.max(0, afterEnd - currentTime);
          const totalDuration = header.duration || mediaEntries[mediaEntries.length - 1].startTime + mediaEntries[mediaEntries.length - 1].duration;
          const percent = totalDuration > 0 ? Math.min(99, Math.round((afterEnd / totalDuration) * 100)) : 10;
          setLoadingProgress(percent, "stream");

          if (!firstReadyResolved && (afterAhead >= START_BUFFER_SECONDS || index === mediaEntries.length - 1)) {
            firstReadyResolved = true;
            if (desiredStart > 0) {
              try { video.currentTime = desiredStart; } catch (_) {}
            }
            initialBufferTime = null;
            setLoadingProgress(100, "ready");
            firstReadyResolve();
          }
        }
      } catch (error) {
        if (!firstReadyResolved) firstReadyReject(error);
        else console.error("WMO background buffer failed", error);
      } finally {
        filling = false;
      }
    }

    const scheduleFill = () => { fillBuffer().catch(() => {}); };
    const onSeeking = () => scheduleFill();
    const onTimeUpdate = () => scheduleFill();
    const onWaiting = () => scheduleFill();
    const onPlaying = () => scheduleFill();

    video.addEventListener("seeking", onSeeking);
    video.addEventListener("timeupdate", onTimeUpdate);
    video.addEventListener("waiting", onWaiting);
    video.addEventListener("playing", onPlaying);

    activeStreamCleanup = () => {
      destroyed = true;
      video.removeEventListener("seeking", onSeeking);
      video.removeEventListener("timeupdate", onTimeUpdate);
      video.removeEventListener("waiting", onWaiting);
      video.removeEventListener("playing", onPlaying);
      try {
        if (mediaSource.readyState === "open" && !sourceBuffer.updating) mediaSource.endOfStream();
      } catch (_) {}
    };

    setLoadingProgress(8, "stream");
    scheduleFill();
    await firstReady;

    return {
      contentId: header.contentId,
      originalSize: header.originalSize,
      chunks: header.chunkCount,
      mediaSegments: mediaEntries.length,
      duration: header.duration,
      mode: "media-source-v2",
      mime,
      startTime: desiredStart
    };
  }

  async function loadV2Memory(url, video, header, entries, session, signal, options = {}, cause = null) {
    resetMediaOnly(video);
    const initEntry = entries.find(entry => entry.type === 0);
    const mediaEntries = entries.filter(entry => entry.type === 1).sort((a, b) => a.startTime - b.startTime);
    if (!initEntry || !mediaEntries.length) throw cause || new Error("WMO v2 is missing its init or media segments");

    const authToken = session.mediaToken || await getFirebaseIdToken(false);
    const ordered = [initEntry, ...mediaEntries];
    const plainParts = [];
    for (let i = 0; i < ordered.length; i++) {
      const entry = ordered[i];
      const encrypted = await fetchRange(url, entry.offset, entry.offset + entry.totalLength - 1, signal, authToken);
      plainParts.push(await decryptChunk(encrypted, entry, session.key));
      setLoadingProgress(Math.min(99, 10 + Math.round(((i + 1) / ordered.length) * 88)), "compat");
    }

    const blob = new Blob(plainParts, { type: "video/mp4" });
    activeObjectUrl = URL.createObjectURL(blob);
    video.src = activeObjectUrl;
    video.load();
    await waitForLoadedMetadata(video, signal);
    const startTime = resolveStartTime(options, Number(video.duration || header.duration || 0));
    if (startTime > 0) {
      try { video.currentTime = startTime; } catch (_) {}
    }
    setLoadingProgress(100, "ready");
    return {
      contentId: header.contentId,
      originalSize: header.originalSize,
      chunks: header.chunkCount,
      mediaSegments: mediaEntries.length,
      duration: header.duration,
      mode: "memory-blob-v2-compat",
      startTime,
      fallbackReason: cause ? String(cause.message || cause) : ""
    };
  }

  async function load(url, video, options = {}) {
    destroy();
    if (!window.crypto?.subtle) throw new Error("This browser does not support WebCrypto");
    if (!video) throw new Error("WMO player element is missing");

    activeAbortController = new AbortController();
    const signal = activeAbortController.signal;
    activeSourceUrl = url;

    setLoadingProgress(0, "header");
    const firebaseToken = await getFirebaseIdToken(false);
    const headerBuffer = await fetchRange(url, 0, HEADER_SIZE - 1, signal, firebaseToken);
    const header = parseHeader(headerBuffer);
    try {
      if (Number.isFinite(header.duration) && header.duration > 0) video.dataset.wmoDuration = String(header.duration);
      else delete video.dataset.wmoDuration;
    } catch (_) {}

    setLoadingProgress(2, "key");
    const session = await getPlaybackSession(header.contentId, signal);

    setLoadingProgress(4, "index");
    const indexAuth = session.mediaToken || firebaseToken;
    const indexBuffer = await fetchRange(url, header.indexOffset, header.indexOffset + header.indexSize - 1, signal, indexAuth);
    const entries = parseIndex(indexBuffer, header);

    if (header.version === 3) {
      return loadV3Stream(url, video, header, entries, session, signal, options);
    }
    if (header.version === 2) {
      try {
        return await loadV2Stream(url, video, header, entries, session, signal, options);
      } catch (error) {
        if (signal.aborted || error?.name === "AbortError") throw error;
        console.warn("WMO MediaSource mode failed; using compatibility memory fallback.", error);
        return loadV2Memory(url, video, header, entries, session, signal, options, error);
      }
    }
    return loadV1Memory(url, video, header, entries, session, signal, options);
  }

  function isWmoUrl(url) {
    try {
      const parsed = new URL(url, window.location.href);
      return /\.wmo$/i.test(parsed.pathname);
    } catch (_) {
      return /\.wmo(?:$|[?#])/i.test(String(url || ""));
    }
  }

  window.WmoMediaEngine = {
    load,
    destroy,
    isWmoUrl,
    version: "3.0.0",
    keyProvider: "cloudflare-d1",
    keyEndpoint: KEY_ENDPOINT,
    mediaEndpoint: MEDIA_ENDPOINT
  };
})();
