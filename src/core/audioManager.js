(function setupWomoAudioManager(){
  const DEFAULT_LANGUAGE = "es";
  const VALID_LANGUAGES = new Set(["es", "en"]);
  const LANGUAGE_ALIASES = {
    es: ["es", "spa", "es-mx", "es-es", "spanish", "espanol", "español", "castellano"],
    en: ["en", "eng", "en-us", "en-gb", "english", "ingles", "inglés"]
  };
  const LANGUAGE_LABELS = {
    es: "Español",
    en: "English"
  };

  let preferredAudioLanguage = DEFAULT_LANGUAGE;
  let preferenceLoaded = false;
  let preferencePromise = null;
  let currentApplyToken = 0;
  let activeSetter = null;
  let activeTracks = [];

  function getFirebase(){
    return window.firebase || null;
  }

  function getDb(){
    const fb = getFirebase();
    try { return fb && typeof fb.firestore === "function" ? fb.firestore() : null; } catch (_) { return null; }
  }

  function getCurrentUser(){
    const fb = getFirebase();
    try { return fb?.auth?.().currentUser || null; } catch (_) { return null; }
  }

  function normalizeLanguage(value){
    return String(value || "")
      .trim()
      .toLowerCase()
      .replace(/_/g, "-");
  }

  function getTrackText(track){
    return [
      track?.lang,
      track?.language,
      track?.name,
      track?.label,
      track?.id,
      track?.attrs?.LANGUAGE,
      track?.attrs?.NAME
    ].filter(Boolean).join(" ");
  }

  function inferCanonicalLanguage(track){
    const text = normalizeLanguage(getTrackText(track));
    if (!text) return "";

    for (const [canonical, aliases] of Object.entries(LANGUAGE_ALIASES)) {
      if (aliases.some(alias => {
        const cleanAlias = normalizeLanguage(alias);
        return text === cleanAlias
          || text.split(/[\s,;/|]+/).includes(cleanAlias)
          || text.includes(cleanAlias);
      })) {
        return canonical;
      }
    }

    const first = text.slice(0, 2);
    return VALID_LANGUAGES.has(first) ? first : "";
  }

  function getTrackLabel(track, index){
    const canonical = inferCanonicalLanguage(track);
    if (LANGUAGE_LABELS[canonical]) return LANGUAGE_LABELS[canonical];

    const raw = track?.name || track?.label || track?.lang || track?.language || track?.attrs?.NAME || track?.attrs?.LANGUAGE || "";
    return raw || `Audio ${index + 1}`;
  }

  function getUserDocRef(){
    const user = getCurrentUser();
    const db = getDb();
    return user && db ? db.collection("users").doc(user.uid) : null;
  }

  async function loadPreference(){
    if (preferenceLoaded) return preferredAudioLanguage;
    if (preferencePromise) return preferencePromise;

    preferencePromise = (async function(){
      const ref = getUserDocRef();
      if (!ref) {
        preferredAudioLanguage = DEFAULT_LANGUAGE;
        preferenceLoaded = true;
        return preferredAudioLanguage;
      }

      try {
        const doc = await ref.get();
        const saved = doc.exists ? doc.data()?.playbackPreferences?.preferredAudioLanguage : "";
        preferredAudioLanguage = VALID_LANGUAGES.has(saved) ? saved : DEFAULT_LANGUAGE;
      } catch (error) {
        console.warn("Womo Audio: no se pudo cargar la preferencia de idioma.", error);
        preferredAudioLanguage = DEFAULT_LANGUAGE;
      }

      preferenceLoaded = true;
      return preferredAudioLanguage;
    })();

    try {
      return await preferencePromise;
    } finally {
      preferencePromise = null;
    }
  }

  async function savePreference(language){
    const normalized = normalizeLanguage(language).slice(0, 2);
    if (!VALID_LANGUAGES.has(normalized)) return;

    preferredAudioLanguage = normalized;
    preferenceLoaded = true;

    const ref = getUserDocRef();
    if (!ref) return;

    try {
      const fb = getFirebase();
      await ref.set({
        email: getCurrentUser()?.email || "",
        updatedAt: fb?.firestore?.FieldValue?.serverTimestamp ? fb.firestore.FieldValue.serverTimestamp() : Date.now(),
        playbackPreferences: {
          preferredAudioLanguage: normalized
        }
      }, { merge: true });
    } catch (error) {
      console.warn("Womo Audio: no se pudo guardar la preferencia de idioma.", error);
    }
  }

  function findPreferredIndex(tracks, language){
    const list = Array.from(tracks || []);
    if (!list.length) return -1;

    const preferred = VALID_LANGUAGES.has(language) ? language : DEFAULT_LANGUAGE;
    const matchIndex = list.findIndex(track => inferCanonicalLanguage(track) === preferred);
    if (matchIndex >= 0) return matchIndex;

    const defaultIndex = list.findIndex(track => Boolean(track?.default || track?.enabled));
    return defaultIndex >= 0 ? defaultIndex : 0;
  }

  function getControlElements(){
    return {
      control: document.getElementById("playerAudioControl"),
      button: document.getElementById("playerAudioButton"),
      menu: document.getElementById("playerAudioMenu")
    };
  }

  function reset(){
    const { control, button, menu } = getControlElements();
    activeSetter = null;
    activeTracks = [];
    if (control) control.hidden = true;
    if (button) button.setAttribute("aria-expanded", "false");
    if (menu) {
      menu.classList.remove("open");
      menu.replaceChildren();
    }
  }

  function render(tracks, activeIndex, setter){
    const list = Array.from(tracks || []);
    const { control, menu, button } = getControlElements();

    if (!control || !menu || !button || list.length < 2) {
      reset();
      return;
    }

    activeTracks = list;
    activeSetter = setter;
    menu.replaceChildren();

    list.forEach((track, index) => {
      const canonical = inferCanonicalLanguage(track);
      const option = document.createElement("button");
      option.type = "button";
      option.className = "player-audio-option";
      option.setAttribute("role", "menuitemradio");
      option.setAttribute("aria-checked", index === activeIndex ? "true" : "false");
      option.classList.toggle("active", index === activeIndex);
      option.textContent = `${index === activeIndex ? "✓ " : ""}${getTrackLabel(track, index)}`;
      option.addEventListener("click", async event => {
        event.stopPropagation();
        if (typeof activeSetter === "function") activeSetter(index);
        render(activeTracks, index, setter);
        menu.classList.remove("open");
        button.setAttribute("aria-expanded", "false");
        if (VALID_LANGUAGES.has(canonical)) await savePreference(canonical);
      });
      menu.appendChild(option);
    });

    control.hidden = false;
    if (window.lucide) window.lucide.createIcons();
  }

  function applyNativeTrack(video, index){
    const tracks = video?.audioTracks;
    if (!tracks || index < 0 || index >= tracks.length) return;
    for (let i = 0; i < tracks.length; i += 1) {
      try { tracks[i].enabled = i === index; } catch (_) {}
    }
  }

  async function setupNative(video){
    const token = ++currentApplyToken;
    const tracks = video?.audioTracks;
    if (!tracks || tracks.length < 2) {
      reset();
      return;
    }

    const list = Array.from({ length: tracks.length }, (_, index) => tracks[index]);
    const preferred = await loadPreference();
    if (token !== currentApplyToken) return;

    const preferredIndex = findPreferredIndex(list, preferred);
    applyNativeTrack(video, preferredIndex);
    const activeIndex = Math.max(0, list.findIndex(track => track.enabled));

    render(list, activeIndex >= 0 ? activeIndex : preferredIndex, index => {
      applyNativeTrack(video, index);
    });
  }

  function applyHlsTrack(hls, index){
    if (!hls || index < 0) return;
    try { hls.audioTrack = index; } catch (_) {}
  }

  async function setupHls(hls){
    const token = ++currentApplyToken;
    if (!hls || !Array.isArray(hls.audioTracks) || hls.audioTracks.length < 2) {
      reset();
      return;
    }

    const tracks = hls.audioTracks;
    const preferred = await loadPreference();
    if (token !== currentApplyToken) return;

    const preferredIndex = findPreferredIndex(tracks, preferred);
    applyHlsTrack(hls, preferredIndex);
    const activeIndex = Number.isInteger(hls.audioTrack) && hls.audioTrack >= 0 ? hls.audioTrack : preferredIndex;

    render(tracks, activeIndex, index => {
      applyHlsTrack(hls, index);
    });
  }

  function bindMenuEvents(){
    if (window.__womoAudioManagerMenuBound) return;
    window.__womoAudioManagerMenuBound = true;

    document.addEventListener("click", event => {
      const button = event.target.closest?.("#playerAudioButton");
      const menu = document.getElementById("playerAudioMenu");
      if (button && menu) {
        event.stopPropagation();
        const open = menu.classList.toggle("open");
        button.setAttribute("aria-expanded", String(open));
        return;
      }
      if (!event.target.closest?.("#playerAudioControl")) {
        menu?.classList.remove("open");
        document.getElementById("playerAudioButton")?.setAttribute("aria-expanded", "false");
      }
    });
  }

  bindMenuEvents();

  window.WomoAudioManager = {
    loadPreference,
    savePreference,
    setupNative,
    setupHls,
    reset,
    getPreferredLanguage: () => preferredAudioLanguage,
    inferCanonicalLanguage,
    getTrackLabel
  };
})();
