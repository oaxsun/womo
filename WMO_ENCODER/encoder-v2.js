const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const https = require("https");
const { spawnSync } = require("child_process");

const REGISTER_URL = "https://gruposegel.com/api/media/register.php";
const REGISTER_TOKEN = process.env.WMO_REGISTER_TOKEN;
const HEADER_SIZE = 256;
const MAGIC_WMO = Buffer.from("WMO1");
const MAGIC_INDEX = Buffer.from("WIDX");
const FORMAT_VERSION = 2;

if (!REGISTER_TOKEN) {
  console.error("ERROR: Missing WMO_REGISTER_TOKEN");
  process.exit(1);
}

const inputFile = process.argv[2];
if (!inputFile || !fs.existsSync(inputFile)) {
  console.error('Usage: node encoder-v2.js "/path/to/video.mp4"');
  process.exit(1);
}

function requireBinary(name) {
  const result = spawnSync(name, ["-version"], { stdio: "ignore" });
  if (result.error || result.status !== 0) {
    throw new Error(`${name} is required. Install FFmpeg first.`);
  }
}

function registerKey(contentId, keyBase64) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({ contentId, key: keyBase64 });
    const url = new URL(REGISTER_URL);
    const req = https.request({
      hostname: url.hostname,
      port: 443,
      path: url.pathname + url.search,
      method: "POST",
      headers: {
        Authorization: `Bearer ${REGISTER_TOKEN}`,
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(payload)
      }
    }, res => {
      let body = "";
      res.on("data", chunk => body += chunk);
      res.on("end", () => {
        let data;
        try { data = JSON.parse(body); }
        catch { return reject(new Error("Invalid Key Server response: " + body)); }
        if (res.statusCode < 200 || res.statusCode >= 300 || !data.ok) {
          return reject(new Error("Key registration failed: " + (data.error || `HTTP ${res.statusCode}`)));
        }
        resolve(data);
      });
    });
    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

function encryptChunk(plainBuffer, chunkIndex, mediaKey) {
  const nonce = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", mediaKey, nonce);
  const aad = Buffer.alloc(4);
  aad.writeUInt32LE(chunkIndex, 0);
  cipher.setAAD(aad);
  const encrypted = Buffer.concat([cipher.update(plainBuffer), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return { nonce, encrypted, authTag };
}

function parsePlaylist(playlistPath) {
  const lines = fs.readFileSync(playlistPath, "utf8").split(/\r?\n/);
  let initName = "init.mp4";
  const segments = [];
  let pendingDuration = null;

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith("#EXT-X-MAP:")) {
      const match = line.match(/URI="([^"]+)"/);
      if (match) initName = match[1];
      continue;
    }
    if (line.startsWith("#EXTINF:")) {
      pendingDuration = Number(line.slice(8).split(",")[0]);
      continue;
    }
    if (!line.startsWith("#") && pendingDuration !== null) {
      segments.push({ file: line, duration: pendingDuration });
      pendingDuration = null;
    }
  }

  if (!segments.length) throw new Error("FFmpeg did not produce any media segments");
  return { initName, segments };
}

function runPackaging(input, tempDir) {
  const playlist = path.join(tempDir, "playlist.m3u8");
  const segmentPattern = path.join(tempDir, "seg_%05d.m4s");
  const args = [
    "-y", "-hide_banner", "-loglevel", "error",
    "-i", input,
    "-map", "0:v:0", "-map", "0:a:0?",
    "-c", "copy",
    "-f", "hls",
    "-hls_time", "4",
    "-hls_playlist_type", "vod",
    "-hls_segment_type", "fmp4",
    "-hls_flags", "independent_segments",
    "-hls_fmp4_init_filename", "init.mp4",
    "-hls_segment_filename", segmentPattern,
    playlist
  ];

  const result = spawnSync("ffmpeg", args, { stdio: "inherit" });
  if (result.status !== 0) {
    throw new Error("FFmpeg could not package this file as fragmented MP4. H.264/AAC MP4 is recommended for WMO v2.");
  }
  return playlist;
}

function appendEncryptedChunk(fd, outputOffset, plain, chunkIndex, mediaKey) {
  const { nonce, encrypted, authTag } = encryptChunk(plain, chunkIndex, mediaKey);
  const chunkHeader = Buffer.alloc(40);
  chunkHeader.writeUInt32LE(chunkIndex, 0);
  chunkHeader.writeUInt32LE(plain.length, 4);
  chunkHeader.writeUInt32LE(encrypted.length, 8);
  nonce.copy(chunkHeader, 12);
  authTag.copy(chunkHeader, 24);

  const start = outputOffset;
  fs.writeSync(fd, chunkHeader, 0, chunkHeader.length, outputOffset);
  outputOffset += chunkHeader.length;
  fs.writeSync(fd, encrypted, 0, encrypted.length, outputOffset);
  outputOffset += encrypted.length;

  return {
    outputOffset,
    entry: {
      chunkIndex,
      offset: start,
      totalLength: chunkHeader.length + encrypted.length,
      plainLength: plain.length
    }
  };
}

async function main() {
  requireBinary("ffmpeg");

  const contentId = crypto.randomUUID();
  const mediaKey = crypto.randomBytes(32);
  const mediaKeyBase64 = mediaKey.toString("base64");
  const originalSize = fs.statSync(inputFile).size;
  const outputFile = path.join(path.dirname(inputFile), path.basename(inputFile, path.extname(inputFile)) + ".wmo");
  const tempOutput = outputFile + ".tmp";
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "wmo-v2-"));

  console.log("\n==============================");
  console.log("      WMO Encoder v2");
  console.log("==============================\n");
  console.log("Input:", inputFile);
  console.log("Content ID:", contentId);
  console.log("Packaging into streamable fMP4 segments...");

  try {
    const playlistPath = runPackaging(inputFile, tempDir);
    const { initName, segments } = parsePlaylist(playlistPath);
    const initPath = path.join(tempDir, initName);
    if (!fs.existsSync(initPath)) throw new Error("Missing fMP4 init segment");

    const header = Buffer.alloc(HEADER_SIZE);
    MAGIC_WMO.copy(header, 0);
    header.writeUInt8(FORMAT_VERSION, 4);
    header.writeUInt8(3, 5); // encrypted + segmented
    header.writeUInt16LE(HEADER_SIZE, 6);
    Buffer.from(contentId.replace(/-/g, ""), "hex").copy(header, 16);
    header.writeBigUInt64LE(BigInt(originalSize), 32);

    const fd = fs.openSync(tempOutput, "w");
    let outputOffset = HEADER_SIZE;
    const index = [];
    let chunkIndex = 0;
    let startTime = 0;
    let totalPackagedPlain = 0;

    try {
      fs.writeSync(fd, header, 0, header.length, 0);

      const initPlain = fs.readFileSync(initPath);
      let result = appendEncryptedChunk(fd, outputOffset, initPlain, chunkIndex, mediaKey);
      outputOffset = result.outputOffset;
      index.push({ ...result.entry, type: 0, startTime: 0, duration: 0 });
      totalPackagedPlain += initPlain.length;
      chunkIndex++;

      for (let i = 0; i < segments.length; i++) {
        const segment = segments[i];
        const segmentPath = path.join(tempDir, segment.file);
        const plain = fs.readFileSync(segmentPath);
        result = appendEncryptedChunk(fd, outputOffset, plain, chunkIndex, mediaKey);
        outputOffset = result.outputOffset;
        index.push({
          ...result.entry,
          type: 1,
          startTime,
          duration: segment.duration
        });
        totalPackagedPlain += plain.length;
        startTime += segment.duration;
        chunkIndex++;
        process.stdout.write(`\rEncrypting segments: ${(((i + 1) / segments.length) * 100).toFixed(1)}%`);
      }
      console.log("");

      const indexOffset = outputOffset;
      const indexHeader = Buffer.alloc(12);
      MAGIC_INDEX.copy(indexHeader, 0);
      indexHeader.writeUInt32LE(FORMAT_VERSION, 4);
      indexHeader.writeUInt32LE(index.length, 8);
      fs.writeSync(fd, indexHeader, 0, indexHeader.length, outputOffset);
      outputOffset += indexHeader.length;

      for (const item of index) {
        const entry = Buffer.alloc(40);
        entry.writeUInt32LE(item.chunkIndex, 0);
        entry.writeUInt8(item.type, 4);
        entry.writeBigUInt64LE(BigInt(item.offset), 8);
        entry.writeUInt32LE(item.totalLength, 16);
        entry.writeUInt32LE(item.plainLength, 20);
        entry.writeDoubleLE(item.startTime, 24);
        entry.writeDoubleLE(item.duration, 32);
        fs.writeSync(fd, entry, 0, entry.length, outputOffset);
        outputOffset += entry.length;
      }

      const indexSize = outputOffset - indexOffset;
      header.writeUInt32LE(0, 40); // byte chunk size is unused in v2
      header.writeUInt32LE(index.length, 44);
      header.writeBigUInt64LE(BigInt(indexOffset), 48);
      header.writeBigUInt64LE(BigInt(indexSize), 56);
      header.writeDoubleLE(startTime, 64);
      header.writeUInt32LE(segments.length, 72);
      fs.writeSync(fd, header, 0, header.length, 0);

      console.log("Registering AES-256 key...");
      await registerKey(contentId, mediaKeyBase64);
      console.log("Key registered successfully.");

      fs.closeSync(fd);
      if (fs.existsSync(outputFile)) fs.unlinkSync(outputFile);
      fs.renameSync(tempOutput, outputFile);

      console.log("\nWMO v2 created:", outputFile);
      console.log("Media segments:", segments.length);
      console.log("Duration:", startTime.toFixed(3), "seconds");
      console.log("Original input size:", originalSize, "bytes");
      console.log("Packaged plaintext:", totalPackagedPlain, "bytes");
      console.log("Encrypted WMO size:", outputOffset, "bytes");
      console.log("\n==============================");
      console.log("           DONE");
      console.log("==============================\n");
    } catch (error) {
      try { fs.closeSync(fd); } catch (_) {}
      throw error;
    }
  } finally {
    try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch (_) {}
    if (fs.existsSync(tempOutput)) {
      try { fs.unlinkSync(tempOutput); } catch (_) {}
    }
  }
}

main().catch(error => {
  console.error("\nWMO ENCODER ERROR");
  console.error(error.message);
  process.exit(1);
});
