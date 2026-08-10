(function () {
  "use strict";

  const HEADER_SIZE = 256;
  const WMO_MAGIC = "WMO1";
  const INDEX_MAGIC = "WIDX";
  const KEY_ENDPOINT = "https://gruposegel.com/api/media/playback.php";

  let activeObjectUrl = "";
  let activeAbortController = null;
  let fullFileCache = null;
  let activeSourceUrl = "";

  function emit(name, detail = {}) {
    try {
      window.dispatchEvent(new CustomEvent(name, { detail }));
    } catch (_) {}
  }

  function setLoadingProgress(percent, stage) {
    emit("wmo:media-progress", { percent, stage });
  }

  function destroy() {
    if (activeAbortController) {
      try { activeAbortController.abort(); } catch (_) {}
      activeAbortController = null;
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

  async function fetchRange(url, start, end, signal) {
    if (fullFileCache && activeSourceUrl === url) {
      return fullFileCache.slice(start, end + 1);
    }

    const response = await fetch(url, {
      method: "GET",
      mode: "cors",
      credentials: "omit",
      cache: "no-store",
      headers: {
        Range: `bytes=${start}-${end}`
      },
      signal
    });

    if (!response.ok) {
      throw new Error(`WMO media request failed (HTTP ${response.status})`);
    }

    const buffer = await response.arrayBuffer();

    // Some origins ignore Range and answer 200 with the entire object.
    // Cache it once so later chunk reads do not redownload the file.
    if (response.status === 200) {
      fullFileCache = buffer;
      activeSourceUrl = url;
      if (buffer.byteLength < end + 1) {
        throw new Error("WMO source returned an incomplete file");
      }
      return buffer.slice(start, end + 1);
    }

    return buffer;
  }

  async function getPlaybackKey(contentId, signal) {
    if (!window.firebase || !firebase.auth) {
      throw new Error("Firebase Auth is not available");
    }

    const user = firebase.auth().currentUser;
    if (!user) {
      throw new Error("WMO playback requires an authenticated user");
    }

    const idToken = await user.getIdToken(false);

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

    if (!response.ok || !payload || !payload.ok || !payload.key) {
      const reason = payload?.error || `HTTP ${response.status}`;
      throw new Error(`WMO key request failed: ${reason}`);
    }

    const keyBytes = base64ToBytes(payload.key);
    if (keyBytes.byteLength !== 32) {
      throw new Error("WMO key server returned an invalid AES-256 key");
    }

    return crypto.subtle.importKey(
      "raw",
      keyBytes,
      { name: "AES-GCM" },
      false,
      ["decrypt"]
    );
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

    if (version !== 1 || headerSize !== HEADER_SIZE) {
      throw new Error(`Unsupported WMO version ${version}`);
    }
    if ((flags & 1) !== 1) {
      throw new Error("This WMO file is not encrypted as expected");
    }
    if (!chunkCount || !indexOffset || !indexSize) {
      throw new Error("WMO index metadata is missing");
    }

    return { version, flags, contentId, originalSize, chunkSize, chunkCount, indexOffset, indexSize };
  }

  function parseIndex(buffer, expectedChunkCount) {
    const bytes = new Uint8Array(buffer);
    const view = new DataView(buffer);
    if (buffer.byteLength < 12) throw new Error("WMO index is incomplete");
    const magic = new TextDecoder().decode(bytes.slice(0, 4));
    if (magic !== INDEX_MAGIC) throw new Error("Invalid WMO index");
    const version = view.getUint32(4, true);
    const count = view.getUint32(8, true);
    if (version !== 1 || count !== expectedChunkCount) throw new Error("WMO index mismatch");

    const entries = [];
    let offset = 12;
    for (let i = 0; i < count; i++) {
      if (offset + 24 > buffer.byteLength) throw new Error("WMO index entry is incomplete");
      entries.push({
        chunkIndex: view.getUint32(offset, true),
        offset: Number(view.getBigUint64(offset + 4, true)),
        totalLength: view.getUint32(offset + 12, true),
        plainLength: view.getUint32(offset + 16, true)
      });
      offset += 24;
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
    if (encrypted.byteLength !== encryptedLength) {
      throw new Error(`WMO chunk ${entry.chunkIndex} payload is incomplete`);
    }

    // WebCrypto expects AES-GCM ciphertext and its 16-byte tag together.
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

    if (plain.byteLength !== plainLength) {
      throw new Error(`WMO chunk ${entry.chunkIndex} decrypted size mismatch`);
    }
    return new Uint8Array(plain);
  }

  async function load(url, video) {
    destroy();
    if (!window.crypto?.subtle) throw new Error("This browser does not support WebCrypto");
    if (!video) throw new Error("WMO player element is missing");

    activeAbortController = new AbortController();
    const signal = activeAbortController.signal;
    activeSourceUrl = url;

    setLoadingProgress(0, "header");
    const headerBuffer = await fetchRange(url, 0, HEADER_SIZE - 1, signal);
    const header = parseHeader(headerBuffer);

    setLoadingProgress(2, "key");
    const key = await getPlaybackKey(header.contentId, signal);

    setLoadingProgress(4, "index");
    const indexBuffer = await fetchRange(
      url,
      header.indexOffset,
      header.indexOffset + header.indexSize - 1,
      signal
    );
    const entries = parseIndex(indexBuffer, header.chunkCount);

    const plainParts = new Array(entries.length);
    let plainBytes = 0;

    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      const encryptedChunk = await fetchRange(
        url,
        entry.offset,
        entry.offset + entry.totalLength - 1,
        signal
      );
      const plain = await decryptChunk(encryptedChunk, entry, key);
      plainParts[i] = plain;
      plainBytes += plain.byteLength;
      const percent = Math.max(5, Math.min(99, Math.round(((i + 1) / entries.length) * 95)));
      setLoadingProgress(percent, "decrypt");
    }

    if (plainBytes !== header.originalSize) {
      throw new Error("WMO decrypted file size does not match the original media size");
    }

    // WMO Media Engine v1 compatibility path:
    // current WMO Encoder encrypts arbitrary MP4 byte chunks. A regular MP4
    // cannot be safely appended to MediaSource until the encoder emits fMP4
    // segments, so v1 reconstructs the MP4 in memory and never writes it to disk.
    const blob = new Blob(plainParts, { type: "video/mp4" });
    activeObjectUrl = URL.createObjectURL(blob);
    video.src = activeObjectUrl;
    video.load();
    setLoadingProgress(100, "ready");

    return {
      contentId: header.contentId,
      originalSize: header.originalSize,
      chunks: header.chunkCount,
      mode: "memory-blob-v1"
    };
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
    version: "1.0.0",
    keyEndpoint: KEY_ENDPOINT
  };
})();
