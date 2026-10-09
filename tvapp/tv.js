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

let sessionRef = null;
let unsubscribeSession = null;
let currentHls = null;
let lastCommandId = "";
let heartbeatTimer = null;
let authReady = false;

function $(id) { return document.getElementById(id); }
function cleanCode(value) { return String(value || "").replace(/\D/g, "").slice(0, 6); }
function setStatus(text, paired = false) {
  const el = $("tvStatus");
  if (!el) return;
  el.textContent = text;
  el.classList.toggle("is-paired", Boolean(paired));
}
function setLoginStatus(text, isError = false) {
  const el = $("tvLoginStatus");
  if (!el) return;
  el.textContent = text || "";
  el.classList.toggle("is-error", Boolean(isError));
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

function stopSessionWatchers() {
  try { if (unsubscribeSession) unsubscribeSession(); } catch (_) {}
  unsubscribeSession = null;
  sessionRef = null;
  clearInterval(heartbeatTimer);
  heartbeatTimer = null;
}

function showLoginScreen(message = "Inicia sesión con tu cuenta Womo para conectar esta pantalla.") {
  stopSessionWatchers();
  $("loginScreen").hidden = false;
  $("pairScreen").hidden = true;
  $("playerScreen").hidden = true;
  setLoginStatus(message, false);
  setTimeout(() => $("tvEmailInput")?.focus(), 250);
}

function showPairScreen() {
  $("loginScreen").hidden = true;
  $("pairScreen").hidden = false;
  $("playerScreen").hidden = true;
  const user = auth.currentUser;
  const label = user?.email ? `Sesión iniciada como ${user.email}.` : "Sesión iniciada.";
  const account = $("tvAccountLabel");
  if (account) account.textContent = label;
  setStatus("Escribe el código generado desde Womo en tu celular.");
  setTimeout(() => $("tvCodeInput")?.focus(), 250);
}

function firebaseAuthMessage(error) {
  const code = error?.code || "";
  if (code.includes("invalid-credential") || code.includes("wrong-password") || code.includes("user-not-found")) {
    return "Correo o contraseña incorrectos.";
  }
  if (code.includes("invalid-email")) return "Revisa el formato del correo.";
  if (code.includes("too-many-requests")) return "Demasiados intentos. Espera un momento e intenta de nuevo.";
  if (code.includes("network")) return "Error de red. Revisa la conexión de la TV.";
  return "No se pudo iniciar sesión. Intenta de nuevo.";
}

async function connectWithCode(rawCode) {
  const user = auth.currentUser;
  if (!user) {
    showLoginScreen("Primero inicia sesión para conectar esta pantalla.");
    return;
  }

  const code = cleanCode(rawCode);
  if (code.length !== 6) {
    setStatus("Escribe el código de 6 dígitos que aparece en tu celular.");
    return;
  }

  const btn = $("tvPairBtn");
  const input = $("tvCodeInput");
  const original = btn ? btn.textContent : "";
  try {
    if (btn) { btn.disabled = true; btn.textContent = "Conectando..."; }
    setStatus("Buscando sesión...");

    const ref = db.collection("tvSessions").doc(code);
    const snap = await ref.get();
    if (!snap.exists) {
      setStatus("No encontramos ese código. Genera uno nuevo desde tu celular.");
      return;
    }

    const data = snap.data() || {};
    const expiresAt = Number(data.expiresAt || 0);
    if (expiresAt && expiresAt < Date.now()) {
      setStatus("Ese código expiró. Genera uno nuevo desde tu celular.");
      return;
    }
    if (!data.createdBy) {
      setStatus("Ese código no está vinculado a un usuario válido.");
      return;
    }
    if (data.createdBy !== user.uid) {
      setStatus("Ese código pertenece a otra cuenta. Inicia sesión con la misma cuenta del celular.");
      return;
    }

    sessionRef = ref;
    await sessionRef.set({
      status: "paired",
      tvConnectedAt: Date.now(),
      tvLastSeenAt: Date.now(),
      tvUserId: user.uid,
      tvUserEmail: user.email || "",
      playerState: { status: "connected", updatedAt: Date.now() },
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    }, { merge: true });

    localStorage.setItem("womo_tv_receiver_code", code);
    if (input) input.blur();
    setStatus("TV vinculada. Elige un título desde tu celular.", true);
    startHeartbeat();
    listenSession();
  } catch (error) {
    console.error("No se pudo conectar Womo TV.", error);
    setStatus("No se pudo conectar. Revisa que la TV haya iniciado sesión y que existan reglas para tvSessions.");
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = original || "Conectar"; }
  }
}

function startHeartbeat() {
  clearInterval(heartbeatTimer);
  heartbeatTimer = setInterval(() => {
    if (!sessionRef || !auth.currentUser) return;
    sessionRef.set({ tvLastSeenAt: Date.now() }, { merge: true }).catch(() => {});
  }, 20000);
}

function listenSession() {
  if (!sessionRef) return;
  if (unsubscribeSession) unsubscribeSession();
  unsubscribeSession = sessionRef.onSnapshot(snapshot => {
    const data = snapshot.data() || {};
    if (data.status === "paired" || data.status === "tv_connected") {
      setStatus("TV vinculada. Elige un título desde tu celular.", true);
    } else if (data.status === "disconnected") {
      setStatus("Sesión desvinculada. Genera otro código desde tu celular.");
      stopSessionWatchers();
      localStorage.removeItem("womo_tv_receiver_code");
      $("playerScreen").hidden = true;
      $("pairScreen").hidden = false;
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
    setStatus("No se pudo escuchar la sesión. Revisa reglas de Firebase.");
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

function setupLoginForm() {
  const form = $("tvLoginForm");
  if (!form) return;
  form.addEventListener("submit", async event => {
    event.preventDefault();
    const email = String($("tvEmailInput")?.value || "").trim();
    const password = String($("tvPasswordInput")?.value || "");
    const btn = $("tvLoginBtn");
    const original = btn ? btn.textContent : "";
    if (!email || !password) {
      setLoginStatus("Escribe correo y contraseña.", true);
      return;
    }
    try {
      if (btn) { btn.disabled = true; btn.textContent = "Entrando..."; }
      setLoginStatus("Iniciando sesión...", false);
      await auth.signInWithEmailAndPassword(email, password);
      setLoginStatus("", false);
    } catch (error) {
      console.error("TV login failed", error);
      setLoginStatus(firebaseAuthMessage(error), true);
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = original || "Entrar"; }
    }
  });
}

function setupPairForm() {
  const form = $("tvPairForm");
  const input = $("tvCodeInput");
  const logoutBtn = $("tvLogoutBtn");
  if (form && input) {
    form.addEventListener("submit", event => {
      event.preventDefault();
      connectWithCode(input.value);
    });
    input.addEventListener("input", () => {
      input.value = cleanCode(input.value);
      if (auth.currentUser && input.value.length === 6) connectWithCode(input.value);
    });
  }
  if (logoutBtn) {
    logoutBtn.addEventListener("click", async () => {
      localStorage.removeItem("womo_tv_receiver_code");
      stopSessionWatchers();
      try { await auth.signOut(); } catch (_) {}
    });
  }
}

function setupAuthFlow() {
  auth.onAuthStateChanged(user => {
    authReady = true;
    if (!user) {
      localStorage.removeItem("womo_tv_receiver_code");
      showLoginScreen();
      return;
    }
    showPairScreen();
    const saved = cleanCode(localStorage.getItem("womo_tv_receiver_code"));
    const input = $("tvCodeInput");
    if (saved.length === 6) {
      if (input) input.value = saved;
      connectWithCode(saved);
    }
  });
}

document.addEventListener("DOMContentLoaded", () => {
  setupLoginForm();
  setupPairForm();
  setupAuthFlow();
});
