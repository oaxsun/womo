const firebaseConfig = {
  apiKey: "AIzaSyBGUUoYmYNcQk_T7QvDUKwZmNh-nHOwENY",
  authDomain: "womo-5d922.firebaseapp.com",
  projectId: "womo-5d922",
  storageBucket: "womo-5d922.firebasestorage.app",
  messagingSenderId: "760499593073",
  appId: "1:760499593073:web:c1a8605da3f0892e53a0d0",
  measurementId: "G-7VP6S1N7S7"
};

firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();

const SESSION_TTL_MS = 10 * 60 * 1000;
let sessionRef = null;
let unsubscribeSession = null;
let currentHls = null;
let lastCommandId = "";

function $(id) { return document.getElementById(id); }
function makeCode() { return String(Math.floor(100000 + Math.random() * 900000)); }
function setStatus(text, paired = false) {
  const el = $("tvStatus");
  if (!el) return;
  el.textContent = text;
  el.classList.toggle("is-paired", Boolean(paired));
}
function showMessage(text) {
  const el = $("tvPlayerMessage");
  if (!el) return;
  el.textContent = text;
  el.classList.add("show");
  clearTimeout(showMessage._t);
  showMessage._t = setTimeout(() => el.classList.remove("show"), 2600);
}
function isWmoUrl(url) { return Boolean(window.WmoMediaEngine && WmoMediaEngine.isWmoUrl(url)); }
function isHlsUrl(url) { return /\.m3u8(\?|#|$)/i.test(String(url || "")); }

async function ensureAuth() {
  if (auth.currentUser) return auth.currentUser;
  try {
    const cred = await auth.signInAnonymously();
    return cred.user;
  } catch (error) {
    console.warn("Anonymous auth failed. tvSessions rules or anonymous auth may need to be enabled.", error);
    throw error;
  }
}

async function createSession() {
  await ensureAuth();
  const code = makeCode();
  const now = Date.now();
  const payload = {
    code,
    status: "waiting",
    createdAt: now,
    expiresAt: now + SESSION_TTL_MS,
    lastSeenAt: now,
    tvUserAgent: navigator.userAgent || "",
    currentCommand: null,
    playerState: { status: "waiting", updatedAt: now },
    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
  };
  sessionRef = await db.collection("tvSessions").add(payload);
  $("tvCode").textContent = code;
  setStatus("Esperando vinculación desde tu celular...");
  listenSession();
  setInterval(() => {
    if (!sessionRef) return;
    sessionRef.set({ lastSeenAt: Date.now() }, { merge: true }).catch(() => {});
  }, 20000);
}

function listenSession() {
  if (!sessionRef) return;
  if (unsubscribeSession) unsubscribeSession();
  unsubscribeSession = sessionRef.onSnapshot(snapshot => {
    const data = snapshot.data() || {};
    if (data.status === "paired") {
      setStatus("TV vinculada. Elige un título desde tu celular.", true);
    } else if (data.status === "disconnected") {
      setStatus("Sesión desvinculada. Recarga para generar otro código.");
    }
    const cmd = data.currentCommand || null;
    if (cmd && cmd.id && cmd.id !== lastCommandId) {
      lastCommandId = cmd.id;
      handleCommand(cmd).catch(error => {
        console.error("TV command failed", error);
        showMessage("No se pudo reproducir el título");
      });
    }
  }, error => {
    console.error("Session listener failed", error);
    setStatus("No se pudo escuchar la sesión. Revisa Firebase.");
  });
}

async function handleCommand(cmd) {
  if (!cmd || !cmd.type) return;
  const video = $("tvPlayer");
  if (cmd.type === "play") return playMedia(cmd.media || {});
  if (cmd.type === "pause") return video?.pause();
  if (cmd.type === "resume") return video?.play().catch(() => {});
  if (cmd.type === "seek" && video) {
    video.currentTime = Math.max(0, Number(cmd.time || 0));
    return;
  }
  if (cmd.type === "stop") {
    video?.pause();
    $("playerScreen").hidden = true;
    $("pairScreen").hidden = false;
  }
}

async function playMedia(media) {
  const url = media.url || media.episode?.url || "";
  if (!url) throw new Error("Missing media URL");
  const video = $("tvPlayer");
  const playerScreen = $("playerScreen");
  const pairScreen = $("pairScreen");
  const title = media.episode ? `${media.title || "Serie"}` : (media.title || "Womo TV");
  const subtitle = media.episode ? `T${media.episode.season} E${media.episode.episodeNumber} · ${media.episode.title || "Episodio"}` : "Reproduciendo en TV";
  $("tvPlayerTitle").textContent = title;
  $("tvPlayerSubtitle").textContent = subtitle;
  pairScreen.hidden = true;
  playerScreen.hidden = false;
  showMessage("Cargando...");

  try { if (currentHls) { currentHls.destroy(); currentHls = null; } } catch (_) {}
  try { if (window.WmoMediaEngine) WmoMediaEngine.destroy(); } catch (_) {}
  video.pause();
  video.removeAttribute("src");
  video.load();

  const startAt = Math.max(0, Number(media.startAt || 0));
  if (isWmoUrl(url)) {
    await WmoMediaEngine.load(url, video, { startTime: startAt });
    await video.play().catch(() => {});
  } else if (window.Hls && Hls.isSupported() && isHlsUrl(url)) {
    currentHls = new Hls();
    currentHls.loadSource(url);
    currentHls.attachMedia(video);
    currentHls.on(Hls.Events.MANIFEST_PARSED, () => {
      if (startAt) video.currentTime = startAt;
      video.play().catch(() => {});
    });
  } else {
    video.src = url;
    video.onloadedmetadata = () => {
      if (startAt && video.duration) video.currentTime = Math.min(startAt, Math.max(0, video.duration - 0.25));
      video.play().catch(() => {});
    };
    video.load();
  }

  if (sessionRef) {
    sessionRef.set({
      playerState: {
        status: "playing",
        title,
        subtitle,
        mediaId: media.id || "",
        mediaType: media.type || "",
        updatedAt: Date.now()
      }
    }, { merge: true }).catch(() => {});
  }
}

document.addEventListener("DOMContentLoaded", () => {
  createSession().catch(error => {
    console.error(error);
    setStatus("No se pudo crear la sesión. Activa Anonymous Auth o ajusta reglas de tvSessions.");
  });
});
