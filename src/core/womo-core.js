
(function setupWomoSkeletonLifecycle(){
  const hideSkeleton = () => {
    const skeleton = document.getElementById("womoSkeleton");
    if (!skeleton) return;
    skeleton.classList.add("is-hidden");
    setTimeout(() => skeleton.remove(), 320);
  };

  window.womoHideSkeleton = hideSkeleton;

  window.addEventListener("load", () => {
    setTimeout(hideSkeleton, 900);
  });

  document.addEventListener("womo:ready", hideSkeleton);
})();


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
const db = firebase.firestore();

const fallbackItems = [
  {
    id: "american-psycho",
    title: "American Psycho",
    duration: "117 min",
    genre: "Slasher",
    description: "En la década de 1980, Patrick Bateman es un hombre exitoso y obsesionado por la competencia y la perfección material.",
    poster: "https://oaxsun.github.io/media/widdo/1.jpg",
    progress: 62,
    type: "movie"
  }
];

const CONTINUE_KEY = "womo_continue_watching";
const MEMORY_CLEARED_KEY = "womo_memory_cleared";
const MEMORY_CLEAR_SEEN_KEY = "womo_memory_clear_seen";

const FAVORITES_KEY = "womo_favorites";

function loadFavoriteState() {
  try {
    const value = JSON.parse(localStorage.getItem(FAVORITES_KEY) || "[]");
    return Array.isArray(value) ? value : [];
  } catch (_) {
    return [];
  }
}

function saveFavoriteState(items) {
  localStorage.setItem(FAVORITES_KEY, JSON.stringify(items));
}

function favoriteKey(item) {
  return `${item.type}:${item.id}`;
}

function isFavoriteItem(item) {
  return loadFavoriteState().some(entry => entry.id === item.id && entry.type === item.type);
}

function toggleFavoriteItem(item) {
  if (!item) return false;
  const current = loadFavoriteState();
  const exists = current.some(entry => entry.id === item.id && entry.type === item.type);
  const entry = { id: item.id, type: item.type, addedAt: Date.now() };
  const next = exists
    ? current.filter(value => !(value.id === item.id && value.type === item.type))
    : [entry, ...current];

  saveFavoriteState(next);
  if (exists) deleteFavoriteFromCloud(entry);
  else saveFavoriteToCloud(entry);

  item.isFavorite = !exists;
  syncFavoriteUI();
  renderFavorites();
  return !exists;
}

function getAllCatalogItems() {
  return [...allItemsByContinueKey.values()];
}

function syncFavoriteUI() {
  getAllCatalogItems().forEach(item => {
    item.isFavorite = isFavoriteItem(item);
  });

  document.querySelectorAll('[data-fav-key]').forEach(button => {
    const item = allItemsByContinueKey.get(button.dataset.favKey);
    button.classList.toggle('active', Boolean(item && isFavoriteItem(item)));
  });
}


function loadContinueState() {
  try {
    const value = JSON.parse(localStorage.getItem(CONTINUE_KEY) || "[]");
    return Array.isArray(value) ? value : [];
  } catch (_) {
    return [];
  }
}

function saveContinueState(items) {
  localStorage.setItem(CONTINUE_KEY, JSON.stringify(items.slice(0, 30)));
}

let womoLastContinueCloudSaveAt = 0;
let womoContinueRefreshPending = false;
let womoLastPlaybackUiSyncAt = 0;

function womoShouldDeferPlaybackUiWork() {
  return typeof womoIsPlayerCurrentlyOpen === "function" && womoIsPlayerCurrentlyOpen();
}

function womoRequestContinueRefresh() {
  if (womoShouldDeferPlaybackUiWork()) {
    womoContinueRefreshPending = true;
    return;
  }
  refreshContinueRow();
}

function womoFlushDeferredPlaybackUiWork() {
  if (!womoContinueRefreshPending) return;
  womoContinueRefreshPending = false;
  try { refreshContinueRow(); } catch (_) {}
  try { refreshContinueWatchingRow(); } catch (_) {}
  try { refreshCurrentPreviewEpisodes(); } catch (_) {}
}

function upsertContinueItem(item, progress = null) {
  if (window.__womoShuffleNoProgress || window.womoGlobalShuffleNoProgress) return;
  if (item && (isItemCompleted(item) || Number(progress || item.progress || 0) >= 98)) {
    markPlayableCompleted(item);
    return;
  }
  if (!item) return;
  localStorage.removeItem(MEMORY_CLEARED_KEY);
  const newEntry = {
    id: item.id,
    type: item.type,
    progress: progress ?? item.progress ?? 5,
    lastWatchedAt: Date.now()
  };
  const state = loadContinueState().filter(entry => !(entry.id === item.id && entry.type === item.type));
  state.unshift(newEntry);
  saveContinueState(state);
  const now = Date.now();
  const progressNumber = Number(newEntry.progress || 0);
  if (!womoShouldDeferPlaybackUiWork() || progressNumber >= 98 || now - womoLastContinueCloudSaveAt > 15000) {
    womoLastContinueCloudSaveAt = now;
    saveContinueEntryToCloud(newEntry);
  }
  womoRequestContinueRefresh();
  try {
    if (currentPlayerItem?.type === "series" && currentPlayerEpisode && currentPreviewItem?.id === currentPlayerItem.id) {
      setSeriesPreviewButtonForEpisode(currentPlayerEpisode);
    }
  } catch (_) {}
}

let allItemsByContinueKey = new Map();
let viewAllCollections = { continue: [], movies: [], series: [], concerts: [], all: [] };
let currentViewAllKey = "movies";

function buildContinueItems(fallbackList = []) {
  const state = loadContinueState();
  if (!state.length) return [];

  return state
    .sort((a, b) => (b.lastWatchedAt || 0) - (a.lastWatchedAt || 0))
    .map(entry => {
      const item = allItemsByContinueKey.get(`${entry.type}:${entry.id}`);
      return item ? { ...item, progress: entry.progress || item.progress || 5 } : null;
    })
    .filter(Boolean);
}

function refreshContinueRow() {
  const items = allItemsByContinueKey.size ? buildContinueItems([...allItemsByContinueKey.values()]) : [];
  viewAllCollections.continue = items;
  fillRow("continueRow", items, true, true, { loop: true });
  if (currentViewAllKey === "continue") renderViewAll();
  setupRowEdgeScroll();
}


let heroItems = [];
let heroIndex = 0;
let heroDragStartX = 0;
let heroTimerFrame = null;
let heroTimerStartedAt = 0;
const HERO_TIMER_DURATION = 7000;
let heroDragDeltaX = 0;
let heroIsDragging = false;

function buildDefaultNewItems(allItems) {
  const sortedByType = type => (allItems || [])
    .filter(item => item?.type === type)
    .sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));

  const movies = sortedByType("movie");
  const series = sortedByType("series");
  const concerts = sortedByType("concert");
  const ordered = [movies[0], series[0], concerts[0], movies[1], series[1]].filter(Boolean);
  const used = new Set(ordered.map(item => `${item.type}:${item.id}`));
  const fillers = [...(allItems || [])]
    .filter(item => !used.has(`${item.type}:${item.id}`))
    .sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));

  return [...ordered, ...fillers].slice(0, 5);
}

const DEFAULT_HOME_SECTION_CONFIG = {
  movies: { visible: true, order: 10 },
  series: { visible: true, order: 20 },
  concerts: { visible: true, order: 90 }
};
let dynamicViewAllMeta = {};

function womoSectionVisible(value, fallback = true) {
  if (value === false) return false;
  if (value === true) return true;
  if (value && typeof value === "object") {
    return Boolean(value.visible ?? value.enabled ?? value.showInHome ?? fallback);
  }
  return fallback;
}

function womoSectionOrder(value, fallback = 50) {
  if (value && typeof value === "object" && Number.isFinite(Number(value.order))) return Number(value.order);
  return fallback;
}

async function readHomeConfigMain(allByKey) {
  const allItems = Array.from(allByKey.values());
  const fallback = {
    newItems: buildDefaultNewItems(allItems),
    visibleGenres: [],
    visibleCollections: [],
    dynamicSections: cloneHomeDynamicSections(DEFAULT_HOME_SECTION_CONFIG)
  };
  try {
    const doc = await db.collection("homeConfig").doc("main").get();
    if (!doc.exists) return fallback;

    const data = doc.data() || {};
    const sections = data.sections || {};
    const newSection = sections.new || sections.news || sections.hero || {};
    const selectedItems = Array.isArray(newSection.selectedItems) ? newSection.selectedItems : [];
    const newMode = newSection.mode || "recent";
    const newItems = newMode === "manual"
      ? selectedItems
          .map(ref => allByKey.get(`${ref.type}:${ref.id}`))
          .filter(Boolean)
          .slice(0, 5)
      : buildDefaultNewItems(allItems);

    const dynamicSections = {};
    Object.entries(DEFAULT_HOME_SECTION_CONFIG).forEach(([key, defaults]) => {
      const cfg = sections[key] || {};
      dynamicSections[key] = {
        visible: womoSectionVisible(cfg, defaults.visible),
        order: womoSectionOrder(cfg, defaults.order)
      };
    });

    const rawGenreSections = data.genreSections || data.homeGenres || {};
    const visibleGenres = Object.entries(rawGenreSections)
      .filter(([, value]) => womoSectionVisible(value, false))
      .map(([name, value]) => ({
        name: String(name || "").trim(),
        order: womoSectionOrder(value, 50)
      }))
      .filter(entry => entry.name);

    const rawCollectionSections = data.collectionSections || data.homeCollections || {};
    const visibleCollections = Object.entries(rawCollectionSections)
      .filter(([, value]) => womoSectionVisible(value, false))
      .map(([name, value]) => ({
        name: String(name || "").trim(),
        order: womoSectionOrder(value, 60)
      }))
      .filter(entry => entry.name);

    return { newItems, visibleGenres, visibleCollections, dynamicSections };
  } catch (error) {
    console.warn("No se pudo leer homeConfig/main.", error);
    return fallback;
  }
}

function cloneHomeDynamicSections(value) {
  return JSON.parse(JSON.stringify(value || {}));
}

function womoGenreDisplayName(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ");
}

function womoGenreSlug(value) {
  return womoGenreDisplayName(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "") || "genre";
}

function womoGenreList(item) {
  const raw = Array.isArray(item?.genres) ? item.genres : String(item?.genre || item?.genres || "").split(",");
  return raw
    .map(womoGenreDisplayName)
    .filter(Boolean);
}

function womoCollectionList(item) {
  const raw = Array.isArray(item?.collections)
    ? item.collections
    : String(item?.collection || item?.collections || "").split(",");
  return raw
    .map(womoGenreDisplayName)
    .filter(Boolean);
}

function womoBuildHomeGenreSections(items, visibleGenres, visibleCollections = []) {
  const container = document.getElementById("genreHomeSections");
  if (!container) return { genres: [], collections: [] };

  const allowedGenres = Array.isArray(visibleGenres) ? visibleGenres : [];
  const allowedCollections = Array.isArray(visibleCollections) ? visibleCollections : [];
  if (!allowedGenres.length && !allowedCollections.length) {
    container.innerHTML = "";
    return { genres: [], collections: [] };
  }

  // Genre rows intentionally use movies only. Series stay only in the Series row.
  // Keep this guard strict because collections can mix content types, but genres cannot.
  const genrePool = (items || []).filter(item => {
    if (!item || !item.poster) return false;
    const type = String(item.type || "").toLowerCase();
    return type === "movie";
  });
  const collectionPool = (items || []).filter(item => item && item.poster);

  const genreEntries = allowedGenres
    .map(entry => {
      const name = womoGenreDisplayName(typeof entry === "string" ? entry : entry.name);
      const order = Number.isFinite(Number(entry?.order)) ? Number(entry.order) : 50;
      const slug = womoGenreSlug(name);
      const list = genrePool
        .filter(item => womoGenreList(item).some(genre => womoGenreSlug(genre) === slug))
        .sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));
      return { name, slug, order, list, kind: "genre" };
    })
    .filter(entry => entry.name && entry.list.length);

  const collectionEntries = allowedCollections
    .map(entry => {
      const name = womoGenreDisplayName(typeof entry === "string" ? entry : entry.name);
      const order = Number.isFinite(Number(entry?.order)) ? Number(entry.order) : 60;
      const slug = womoGenreSlug(name);
      const list = collectionPool
        .filter(item => womoCollectionList(item).some(collection => womoGenreSlug(collection) === slug))
        .sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));
      return { name, slug, order, list, kind: "collection" };
    })
    .filter(entry => entry.name && entry.list.length);

  const allEntries = [...genreEntries, ...collectionEntries];

  container.innerHTML = allEntries.map(entry => {
    const key = entry.kind === "collection" ? `collection-${entry.slug}` : `genre-${entry.slug}`;
    const attr = entry.kind === "collection" ? `data-collection-section="${entry.slug}"` : `data-genre-section="${entry.slug}"`;
    return `
      <section class="content-row ${entry.kind}-content-row" data-home-section-key="${entry.kind}:${entry.slug}" ${attr}>
        <div class="row-header">
          <h2>${entry.name}</h2>
          <button type="button" data-view-all="${key}">Ver más</button>
        </div>
        <div class="poster-row" id="${entry.kind}Row-${entry.slug}"></div>
      </section>
    `;
  }).join("");

  allEntries.forEach(entry => {
    const key = entry.kind === "collection" ? `collection-${entry.slug}` : `genre-${entry.slug}`;
    viewAllCollections[key] = entry.list;
    dynamicViewAllMeta[key] = { title: entry.name, eyebrow: entry.kind === "collection" ? "Colección" : "Sección", empty: `No hay títulos en ${entry.name}.` };
    fillRow(`${entry.kind}Row-${entry.slug}`, entry.list, false, true);
  });

  bindViewAllButtons(container);
  return { genres: genreEntries, collections: collectionEntries };
}

function applyDynamicHomeSectionOrder(homeConfig, genreEntries = [], collectionEntries = []) {
  const root = document.getElementById("dynamicHomeSections");
  if (!root) return;
  const entries = [];
  const dynamic = homeConfig?.dynamicSections || DEFAULT_HOME_SECTION_CONFIG;
  const coreMap = {
    movies: document.getElementById("moviesHomeSection"),
    series: document.getElementById("seriesHomeSection"),
    concerts: document.getElementById("concertsHomeSection")
  };

  Object.entries(coreMap).forEach(([key, el]) => {
    if (!el) return;
    const defaults = DEFAULT_HOME_SECTION_CONFIG[key] || { visible: true, order: 50 };
    const cfg = dynamic[key] || defaults;
    const visible = womoSectionVisible(cfg, defaults.visible);
    el.classList.toggle("hidden", !visible);
    if (visible) entries.push({ el, order: womoSectionOrder(cfg, defaults.order) });
  });

  genreEntries.forEach(entry => {
    const el = root.querySelector(`[data-genre-section="${entry.slug}"]`);
    if (el) entries.push({ el, order: Number(entry.order || 50) });
  });

  collectionEntries.forEach(entry => {
    const el = root.querySelector(`[data-collection-section="${entry.slug}"]`);
    if (el) entries.push({ el, order: Number(entry.order || 60) });
  });

  entries.sort((a, b) => a.order - b.order).forEach(entry => root.appendChild(entry.el));
}

function stopHeroTimer() {
  if (heroTimerFrame) {
    cancelAnimationFrame(heroTimerFrame);
    heroTimerFrame = null;
  }
}

function updateHeroTimer() {
  if (!heroItems.length || heroItems.length < 2) return;

  const elapsed = Date.now() - heroTimerStartedAt;
  const progress = Math.min(100, (elapsed / HERO_TIMER_DURATION) * 100);
  const activeDot = document.querySelector(`.hero-dots [data-hero-dot="${heroIndex}"]`);

  if (activeDot) activeDot.style.setProperty("--progress", `${progress}%`);

  if (elapsed >= HERO_TIMER_DURATION) {
    setHero(heroIndex + 1);
    return;
  }

  heroTimerFrame = requestAnimationFrame(updateHeroTimer);
}

function startHeroTimer() {
  stopHeroTimer();
  document.querySelectorAll(".hero-dots span").forEach(dot => {
    dot.style.setProperty("--progress", "0%");
  });

  if (!heroItems.length || heroItems.length < 2) return;
  heroTimerStartedAt = Date.now();
  heroTimerFrame = requestAnimationFrame(updateHeroTimer);
}

function setHero(index) {
  if (!heroItems.length) return;
  heroIndex = (index + heroItems.length) % heroItems.length;
  renderHero(heroItems[heroIndex]);
  startHeroTimer();
}

function setupHeroDrag() {
  const hero = document.getElementById("hero");
  if (!hero || hero.dataset.dragReady === "true") return;
  hero.dataset.dragReady = "true";

  hero.addEventListener("pointerdown", event => {
    if (event.target.closest("button, a, input, textarea, select")) return;
    if (heroItems.length < 2) return;
    heroIsDragging = true;
    stopHeroTimer();
    heroDragStartX = event.clientX;
    heroDragDeltaX = 0;
    hero.classList.add("is-dragging");
    hero.setPointerCapture(event.pointerId);
  });

  hero.addEventListener("pointermove", event => {
    if (!heroIsDragging) return;
    heroDragDeltaX = event.clientX - heroDragStartX;
  });

  function finishDrag(event) {
    if (!heroIsDragging) return;
    heroIsDragging = false;
    hero.classList.remove("is-dragging");

    if (Math.abs(heroDragDeltaX) > 70) {
      setHero(heroDragDeltaX < 0 ? heroIndex + 1 : heroIndex - 1);
    } else {
      startHeroTimer();
    }
  }

  hero.addEventListener("pointerup", finishDrag);
  hero.addEventListener("pointercancel", finishDrag);
}

function cleanTitleFromId(id) {
  return id
    .split("-")
    .filter(Boolean)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function normalizeGenres(value) {
  if (Array.isArray(value)) return value.join(", ");
  if (typeof value === "string") return value;
  return "";
}

function toMillis(value) {
  if (!value) return 0;
  if (typeof value.toMillis === "function") return value.toMillis();
  if (value.seconds) return value.seconds * 1000;
  return 0;
}

function normalizeMovie(docSnap) {
  const data = docSnap.data();
  const title = data.title || data.name || cleanTitleFromId(docSnap.id);
  const genre = normalizeGenres(data.genres || data.genre);
  const genres = Array.isArray(data.genres) ? data.genres : String(data.genre || data.genres || "").split(",").map(value => value.trim()).filter(Boolean);
  const collections = Array.isArray(data.collections) ? data.collections : String(data.collection || data.collections || "").split(",").map(value => value.trim()).filter(Boolean);
  const actors = Array.isArray(data.actors) ? data.actors : String(data.actors || data.cast || "").split(",").map(value => value.trim()).filter(Boolean);
  const duration = data.duration ? `${data.duration} min` : (data.runtime ? `${data.runtime} min` : "");

  return {
    id: docSnap.id,
    title,
    duration,
    year: data.year || "",
    genre,
    genres,
    collection: collections.join(", "),
    collections,
    director: data.director || "",
    actors,
    description: data.synopsis || data.description || "",
    poster: data.posterUrl || data.poster || data.imageUrl || "",
    hlsUrl: data.hlsUrl || data.videoUrl || data.videoURL || data.streamUrl || data.playbackUrl || data.mp4Url || data.m3u8 || data.file || data.link || data.url || "",
    isFavorite: Boolean(data.isFavorite),
    createdAt: toMillis(data.createdAt),
    progress: data.progress || 0,
    completed: Boolean(data.completed || data.isCompleted || Number(data.progress || 0) >= 98),
    published: data.published !== false,
    type: genre.toLowerCase().includes("concierto") ? "concert" : "movie"
  };
}

function normalizeConcert(docSnap) {
  return {
    ...normalizeMovie(docSnap),
    type: "concert"
  };
}

function normalizeSeries(docSnap) {
  const data = docSnap.data();
  const title = data.title || data.name || cleanTitleFromId(docSnap.id);
  const genre = normalizeGenres(data.genres || data.genre);
  const genres = Array.isArray(data.genres) ? data.genres : String(data.genre || data.genres || "").split(",").map(value => value.trim()).filter(Boolean);
  const collections = Array.isArray(data.collections) ? data.collections : String(data.collection || data.collections || "").split(",").map(value => value.trim()).filter(Boolean);
  const actors = Array.isArray(data.actors) ? data.actors : String(data.actors || data.cast || "").split(",").map(value => value.trim()).filter(Boolean);

  return {
    id: docSnap.id,
    title,
    duration: data.seasons ? `${data.seasons} temporada${data.seasons === 1 ? "" : "s"}` : "Serie",
    year: data.year || "",
    genre,
    genres,
    collection: collections.join(", "),
    collections,
    director: data.director || "",
    actors,
    description: data.synopsis || data.description || "",
    poster: data.posterUrl || data.poster || data.imageUrl || "",
    isFavorite: Boolean(data.isFavorite),
    createdAt: toMillis(data.createdAt),
    progress: data.progress || 0,
    completed: Boolean(data.completed || data.isCompleted || Number(data.progress || 0) >= 98),
    completed: Boolean(data.completed || data.isCompleted || Number(data.progress || 0) >= 98),
    published: data.published !== false,
    type: "series"
  };
}

async function readCollection(name, normalizer) {
  const user = firebase.auth().currentUser;
  if (user) await user.getIdToken();

  try {
    // Read the complete collection. Ordering in memory also keeps documents
    // without createdAt available instead of silently excluding them.
    const snapshot = await db.collection(name).get();
    return snapshot.docs.map(normalizer).sort((a, b) => b.createdAt - a.createdAt);
  } catch (error) {
    console.error(`No se pudo leer ${name}.`, error);
    return [];
  }
}

async function getSeriesLatestEpisodeAt(seriesId) {
  try {
    const snapshot = await db.collection("series").doc(seriesId)
      .collection("episodes").orderBy("createdAt", "desc").limit(1).get();
    if (snapshot.empty) return 0;
    return toMillis(snapshot.docs[0].data()?.createdAt);
  } catch (error) {
    console.warn(`No se pudo leer la fecha del episodio más reciente de ${seriesId}.`, error);
    return 0;
  }
}

async function sortSeriesByLatestEpisode(seriesItems) {
  const enriched = await Promise.all((seriesItems || []).map(async item => ({
    item,
    activityAt: Math.max(Number(item.createdAt || 0), await getSeriesLatestEpisodeAt(item.id))
  })));
  return enriched.sort((a, b) => b.activityAt - a.activityAt).map(entry => entry.item);
}



function renderHero(item) {
  const hero = document.getElementById("hero");
  if (!item) {
    hero.innerHTML = `<div class="hero-empty">No hay contenido destacado disponible.</div>`;
    return;
  }

  const meta = [item.duration, item.year, item.genre].filter(Boolean);
  const dots = heroItems.length
    ? heroItems.map((_, index) => `<span class="${index === heroIndex ? "active" : ""}" data-hero-dot="${index}"></span>`).join("")
    : `<span class="active"></span>`;

  hero.innerHTML = `
    <div class="hero-poster-wrap">
      <img class="hero-poster" src="${item.poster}" alt="${item.title}" loading="eager" draggable="false">
    </div>
    <div class="hero-info">
      <div class="hero-dots" aria-hidden="true">${dots}</div>
      <h1>${item.title}</h1>
      <div class="meta">${meta.map(text => `<span>${text}</span>`).join("")}</div>
      <p>${item.description}</p>
      <div class="hero-actions">
        <button type="button" class="primary-btn" data-hero-preview="${item.type}:${item.id}">Reproducir</button>
        <button type="button" class="favorite-btn ${isFavoriteItem(item) ? "active" : ""}" data-hero-favorite="${item.type}:${item.id}" data-fav-key="${item.type}:${item.id}" aria-label="Agregar a favoritas"><i data-lucide="heart"></i></button>
      </div>
    </div>
  `;

  hero.querySelectorAll("[data-hero-dot]").forEach(dot => {
    dot.addEventListener("click", () => setHero(Number(dot.dataset.heroDot)));
  });


  const heroPreviewButton = hero.querySelector("[data-hero-preview]");
  if (heroPreviewButton) {
    heroPreviewButton.addEventListener("pointerdown", event => event.stopPropagation());
    heroPreviewButton.addEventListener("click", event => {
      event.preventDefault();
      event.stopPropagation();
      openPreview(item);
    });
  }

  const heroFavoriteButton = hero.querySelector("[data-hero-favorite]");
  if (heroFavoriteButton) {
    heroFavoriteButton.addEventListener("pointerdown", event => event.stopPropagation());
    heroFavoriteButton.addEventListener("click", event => {
      event.preventDefault();
      event.stopPropagation();
      const active = toggleFavoriteItem(item);
      heroFavoriteButton.classList.toggle("active", active);
    });
  }

  setupHeroDrag();
  womoDecorateShuffleButtons();
  if (window.lucide) lucide.createIcons();
}

function posterCard(item, showProgress = false) {
  const progress = Math.max(0, Math.min(100, Number(item.progress || 0)));
  const poster = item.poster || "https://placehold.co/500x750/2a2a2a/d7ff00?text=WOMO";

  return `
    <article class="poster-card ${showProgress ? "continue-card" : ""}" title="${item.title}" data-id="${item.id}" data-type="${item.type}">
      <img src="${poster}" alt="${item.title}" loading="lazy">
      ${showProgress ? `<div class="progress"><span style="--value:${progress}%"></span></div>` : ""}
    </article>
  `;
}


function updateViewAllButtonsVisibility(sectionId, count) {
  const selectors = [
    `[data-view-all="${sectionId}"]`,
    `[data-section="${sectionId}"][data-action="view-all"]`,
    `button[data-view="${sectionId}"]`,
    `#${sectionId}ViewAll`,
    `#viewAll${sectionId.charAt(0).toUpperCase() + sectionId.slice(1)}`
  ];

  selectors.forEach(selector => {
    document.querySelectorAll(selector).forEach(button => {
      if (sectionId === "continue" || sectionId === "continueRow") {
        button.classList.add("hidden");
        button.style.display = "none";
        return;
      }

      const show = Number(count || 0) > 5;
      button.classList.toggle("hidden", !show);
      button.style.display = show ? "" : "none";
    });
  });
}

function hideContinueViewAllButtons() {
  document.querySelectorAll('[data-view-all="continue"], [data-view-all="continueRow"], #continueViewAll, #continueRowViewAll').forEach(button => {
    button.classList.add("hidden");
    button.style.display = "none";
  });
}

function womoIsTouchCarouselDevice() {
  const hasTouch = Boolean(
    (navigator && Number(navigator.maxTouchPoints || 0) > 0) ||
    (typeof window !== "undefined" && "ontouchstart" in window)
  );

  const isNarrow = Boolean(window.matchMedia && window.matchMedia("(max-width: 768px)").matches);
  const isTabletTouch = Boolean(hasTouch && window.matchMedia && window.matchMedia("(max-width: 1180px)").matches);
  const coarsePointer = Boolean(window.matchMedia && window.matchMedia("(pointer: coarse)").matches);
  const noHover = Boolean(window.matchMedia && window.matchMedia("(hover: none)").matches);

  // Mobile/tablet must use native horizontal scrolling. Loop cloning can feel
  // sticky on touch devices and was especially noticeable in Películas.
  return Boolean(isNarrow || isTabletTouch || coarsePointer || noHover);
}

function fillRow(id, data, progress = false, hideWhenEmpty = false, options = {}) {
  updateViewAllButtonsVisibility(id, Array.isArray(data) ? data.length : 0);
  const row = document.getElementById(id);
  if (!row) return;

  const section = row.closest(".content-row");
  if (section && hideWhenEmpty) {
    section.classList.toggle("hidden", !data.length);
  }

  const sourceData = Array.isArray(data) ? data : [];
  const requestedLimit = Number(options.limit);
  const visibleData = Number.isFinite(requestedLimit) && requestedLimit > 0
    ? sourceData.slice(0, requestedLimit)
    : sourceData;
  const allowLoop = !womoIsTouchCarouselDevice();
  // Desktop loop rule: every Home carousel with more than 6 real titles loops.
  // Touch/mobile keeps native horizontal scroll to avoid jank.
  const shouldLoop = options.loop !== false && allowLoop && visibleData.length > 6;
  const renderData = shouldLoop ? [...visibleData, ...visibleData, ...visibleData] : visibleData;

  row.dataset.loop = shouldLoop ? "true" : "false";
  row.dataset.loopReady = "false";
  row.dataset.loopDisabledForTouch = !allowLoop ? "true" : "false";
  row.innerHTML = renderData.length
    ? renderData.map(item => posterCard(item, progress)).join("")
    : `<div class="row-empty">Sin contenido por ahora.</div>`;

  row.querySelectorAll(".poster-card").forEach(card => {
    card.addEventListener("click", () => {
      if (Number(row.dataset.suppressClickUntil || 0) > Date.now()) return;
      const key = `${card.dataset.type}:${card.dataset.id}`;
      const item = allItemsByContinueKey.get(key);
      if (item) openPreview(item);
    });
  });
}

let edgeScrollFrame = null;
let activeScrollRow = null;
let scrollDirection = 0;

function stopEdgeScroll() {
  scrollDirection = 0;
  activeScrollRow = null;
  if (edgeScrollFrame) {
    cancelAnimationFrame(edgeScrollFrame);
    edgeScrollFrame = null;
  }
}

function womoPrepareLoopingRow(row) {
  // Do not move the row on page load. Looping must only be felt after
  // real user interaction, otherwise desktop/mobile can look like autoplay.
  if (!row || row.dataset.loop !== "true") return;
  row.dataset.loopReady = "true";
}

function womoMaintainLoopingRow(row) {
  if (!row || row.dataset.loop !== "true") return;
  const third = row.scrollWidth / 3;
  if (!third) return;

  const previousBehavior = row.style.scrollBehavior;
  row.style.scrollBehavior = "auto";

  if (row.scrollLeft < third * 0.15 && row.dataset.loopTouched === "true") {
    row.scrollLeft += third;
  } else if (row.scrollLeft > third * 1.85) {
    row.scrollLeft -= third;
  }

  row.style.scrollBehavior = previousBehavior;
}

function womoMarkRowInteraction(row) {
  if (!row) return;
  row.dataset.loopTouched = "true";
  womoPrepareLoopingRow(row);
}

function runEdgeScroll() {
  if (!activeScrollRow || scrollDirection === 0) {
    stopEdgeScroll();
    return;
  }

  womoMarkRowInteraction(activeScrollRow);
  activeScrollRow.scrollLeft += scrollDirection * 2;
  womoMaintainLoopingRow(activeScrollRow);
  edgeScrollFrame = requestAnimationFrame(runEdgeScroll);
}

function setupRowEdgeScroll() {
  const touchCarouselDevice = womoIsTouchCarouselDevice();
  document.querySelectorAll(".poster-row").forEach(row => {
    if (row.dataset.edgeScrollReady === "true") return;
    row.dataset.edgeScrollReady = "true";

    row.classList.toggle("native-touch-scroll", touchCarouselDevice);

    row.addEventListener("scroll", () => {
      if (!touchCarouselDevice) womoMaintainLoopingRow(row);
    }, { passive: true });

    if (touchCarouselDevice) {
      // iPad/tablet keeps the desktop layout, but the interaction must be native touch.
      // Do not capture pointers or manually set scrollLeft: Safari's inertial scroll is smoother.
      let touchStart = null;

      row.addEventListener("pointerdown", event => {
        if (event.pointerType !== "touch" && event.pointerType !== "pen") return;
        touchStart = {
          id: event.pointerId,
          x: event.clientX,
          y: event.clientY,
          moved: false
        };
      }, { passive: true });

      row.addEventListener("pointermove", event => {
        if (!touchStart || touchStart.id !== event.pointerId) return;
        const dx = event.clientX - touchStart.x;
        const dy = event.clientY - touchStart.y;
        if (Math.abs(dx) > 10 || Math.abs(dy) > 10) {
          touchStart.moved = true;
          row.dataset.suppressClickUntil = String(Date.now() + 350);
        }
      }, { passive: true });

      const endNativeTouch = event => {
        if (!touchStart || touchStart.id !== event.pointerId) return;
        if (touchStart.moved) row.dataset.suppressClickUntil = String(Date.now() + 350);
        touchStart = null;
      };

      row.addEventListener("pointerup", endNativeTouch, { passive: true });
      row.addEventListener("pointercancel", endNativeTouch, { passive: true });
      return;
    }

    row.addEventListener("mousemove", event => {
      const rect = row.getBoundingClientRect();
      const edgeSize = 120;
      const x = event.clientX - rect.left;
      const maxScroll = row.scrollWidth - row.clientWidth;

      let nextDirection = 0;

      if (x > rect.width - edgeSize && row.scrollLeft < maxScroll - 2) {
        nextDirection = 1;
      } else if (x < edgeSize && row.scrollLeft > 2) {
        nextDirection = -1;
      }

      if (nextDirection === 0) {
        if (activeScrollRow === row) stopEdgeScroll();
        return;
      }

      womoMarkRowInteraction(row);
      activeScrollRow = row;
      scrollDirection = nextDirection;

      if (!edgeScrollFrame) {
        edgeScrollFrame = requestAnimationFrame(runEdgeScroll);
      }
    });

    row.addEventListener("mouseleave", () => {
      if (activeScrollRow === row) stopEdgeScroll();
    });
  });
}


function fillGrid(id, data, emptyText = "Sin contenido por ahora.") {
  const grid = document.getElementById(id);
  if (!grid) return;

  if (!data.length) {
    grid.innerHTML = `<div class="grid-empty">${emptyText}</div>`;
    return;
  }

  grid.innerHTML = data.map(item => posterCard(item, false)).join("");

  grid.querySelectorAll(".poster-card").forEach(card => {
    card.addEventListener("click", () => {
      const item = allItemsByContinueKey.get(`${card.dataset.type}:${card.dataset.id}`);
      if (item) openPreview(item);
    });
  });

  if (window.lucide) lucide.createIcons();
}


function normalizeViewAllItems(key) {
  if (key === "continue") return buildContinueItems([...allItemsByContinueKey.values()]);
  return viewAllCollections[key] || [];
}

function viewAllMeta(key) {
  if (dynamicViewAllMeta[key]) return dynamicViewAllMeta[key];
  const meta = {
    continue: { title: "Continuar viendo", eyebrow: "Tu actividad", empty: "No tienes contenido en progreso." },
    movies: { title: "Películas", eyebrow: "Catálogo", empty: "No hay películas disponibles por ahora." },
    series: { title: "Series", eyebrow: "Catálogo", empty: "No hay series disponibles por ahora." },
    concerts: { title: "Conciertos", eyebrow: "Catálogo", empty: "No hay conciertos disponibles por ahora." },
    all: { title: "Todo el catálogo", eyebrow: "Womo", empty: "No hay contenido disponible por ahora." }
  };
  return meta[key] || meta.all;
}

function getViewAllFilteredItems() {
  const input = document.getElementById("viewAllSearch");
  const sort = document.getElementById("viewAllSort");
  const query = (input?.value || "").trim().toLowerCase();
  const sortMode = sort?.value || "recent";

  let items = normalizeViewAllItems(currentViewAllKey)
    .filter(item => searchMatches(item, query));

  if (sortMode === "title") {
    items = items.sort((a, b) => String(a.title || "").localeCompare(String(b.title || ""), "es"));
  } else if (sortMode === "year") {
    items = items.sort((a, b) => Number(b.year || 0) - Number(a.year || 0));
  } else {
    items = items.sort((a, b) => Number(b.createdAt || b.lastWatchedAt || 0) - Number(a.createdAt || a.lastWatchedAt || 0));
  }

  return items;
}

function renderViewAll() {
  const meta = viewAllMeta(currentViewAllKey);
  const title = document.getElementById("viewAllTitle");
  const eyebrow = document.getElementById("viewAllEyebrow");
  const count = document.getElementById("viewAllCount");
  const input = document.getElementById("viewAllSearch");
  const items = getViewAllFilteredItems();

  if (title) title.textContent = meta.title;
  if (eyebrow) eyebrow.textContent = meta.eyebrow;
  if (count) count.textContent = `${items.length} ${items.length === 1 ? "título" : "títulos"}`;
  if (input) input.placeholder = `Buscar en ${meta.title.toLowerCase()}`;

  fillGrid("viewAllGrid", items, meta.empty);
}

function openViewAll(key) {
  currentViewAllKey = key || "all";
  const input = document.getElementById("viewAllSearch");
  const sort = document.getElementById("viewAllSort");
  if (input) input.value = "";
  if (sort) sort.value = "recent";
  changePage("viewAll");
  renderViewAll();
  try { setTimeout(() => womoPrepareViewAllMockupFixed(normalizeViewAllItems(currentViewAllKey)), 0); } catch (_) {}
  if (window.lucide) lucide.createIcons();
}

function searchMatches(item, query) {
  if (!query) return true;
  const haystack = [
    item.title,
    item.genre,
    item.genres,
    item.collection,
    item.collections,
    item.director,
    item.actors,
    item.year,
    item.type === "series" ? "series serie" : item.type === "concert" ? "concierto concert" : "pelicula movie"
  ].filter(Boolean).join(" ").toLowerCase();

  return haystack.includes(query);
}

function renderSearchResults() {
  const input = document.getElementById("searchInput");
  const title = document.getElementById("searchResultsTitle");
  const query = (input?.value || "").trim().toLowerCase();
  const grid = document.getElementById("searchResults");

  if (!query) {
    if (title) {
      title.textContent = "";
      title.classList.add("search-title-hidden");
    }
    if (grid) grid.innerHTML = "";
    return;
  }

  if (title) title.classList.remove("search-title-hidden");

  const items = getAllCatalogItems()
    .filter(item => searchMatches(item, query))
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

  if (title) title.textContent = `Resultados para “${input.value.trim()}”`;
  fillGrid("searchResults", items, "No encontramos resultados para tu búsqueda.");
}

function renderFavorites() {
  const favs = loadFavoriteState()
    .map(entry => allItemsByContinueKey.get(`${entry.type}:${entry.id}`))
    .filter(Boolean);

  fillGrid("favoritesGrid", favs, "Aún no tienes favoritas. Guarda una película, serie o concierto desde el preview.");
}

function changePage(page) {
  document.querySelectorAll(".nav-btn").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.page === page);
  });

  document.querySelectorAll(".page").forEach(section => {
    section.classList.remove("active");
  });

  document.getElementById(`${page}Page`).classList.add("active");
}


function decorateViewAllButtons(scope = document) {
  scope.querySelectorAll("[data-view-all]").forEach(button => {
    button.textContent = "Ver más";
  });
}

function bindViewAllButtons(scope = document) {
  decorateViewAllButtons(scope);
  scope.querySelectorAll("[data-view-all]").forEach(button => {
    if (button.dataset.ready === "true") return;
    button.dataset.ready = "true";
    button.addEventListener("click", () => openViewAll(button.dataset.viewAll));
  });
}

function setupNavigation() {
  bindViewAllButtons();
  document.querySelectorAll(".nav-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      changePage(btn.dataset.page);
      if (btn.dataset.page === "search") renderSearchResults();
      if (btn.dataset.page === "favorites") renderFavorites();
      if (btn.dataset.page === "settings") setupSettings();
    });
  });

  const searchInput = document.getElementById("searchInput");
  if (searchInput && searchInput.dataset.ready !== "true") {
    searchInput.dataset.ready = "true";
    searchInput.addEventListener("input", renderSearchResults);
  }

  const viewAllSearch = document.getElementById("viewAllSearch");
  if (viewAllSearch && viewAllSearch.dataset.ready !== "true") {
    viewAllSearch.dataset.ready = "true";
    viewAllSearch.addEventListener("input", renderViewAll);
  }

  const viewAllSort = document.getElementById("viewAllSort");
  if (viewAllSort && viewAllSort.dataset.ready !== "true") {
    viewAllSort.dataset.ready = "true";
    viewAllSort.addEventListener("change", renderViewAll);
  }

  const viewAllBack = document.getElementById("viewAllBack");
  if (viewAllBack && viewAllBack.dataset.ready !== "true") {
    viewAllBack.dataset.ready = "true";
    viewAllBack.addEventListener("click", () => changePage("home"));
  }

  bindViewAllButtons();

  document.addEventListener("click", event => {
    const favoriteButton = event.target.closest('[data-action="favorite"]');
    if (favoriteButton) {
      const key = favoriteButton.dataset.favKey;
      const item = allItemsByContinueKey.get(key);
      if (item) {
        const active = toggleFavoriteItem(item);
        favoriteButton.classList.toggle("active", active);
      }
      return;
    }

    const playButton = event.target.closest('[data-action="play"]');
    if (!playButton) return;
    const key = `${playButton.dataset.type}:${playButton.dataset.id}`;
    const item = allItemsByContinueKey.get(key);
    if (item) openPlayer(item);
  });
}


document.addEventListener("click", event => {
  const previewButton = event.target.closest("[data-hero-preview]");
  if (previewButton) {
    event.preventDefault();
    event.stopPropagation();
    const item = allItemsByContinueKey.get(previewButton.dataset.heroPreview);
    if (item) openPreview(item);
    return;
  }

  const favButton = event.target.closest("[data-hero-favorite]");
  if (favButton) {
    event.preventDefault();
    event.stopPropagation();
    const item = allItemsByContinueKey.get(favButton.dataset.heroFavorite || favButton.dataset.favKey);
    if (item) {
      const active = toggleFavoriteItem(item);
      favButton.classList.toggle("active", active);
    }
  }
}, true);



const SESSION_KEY = "womo_session_id";
const SESSION_STARTED_KEY = "womo_session_started_at";

function getSessionId() {
  let id = localStorage.getItem(SESSION_KEY);
  if (!id) {
    id = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
    localStorage.setItem(SESSION_KEY, id);
  }
  return id;
}

function getSessionStartedAt() {
  let value = Number(localStorage.getItem(SESSION_STARTED_KEY) || 0);
  if (!value) {
    value = Date.now();
    localStorage.setItem(SESSION_STARTED_KEY, String(value));
  }
  return value;
}

function resetLocalSession() {
  localStorage.removeItem(SESSION_KEY);
  localStorage.removeItem(SESSION_STARTED_KEY);
}

let forceLogoutUnsubscribe = null;

async function registerSessionWatch() {
  const userRef = getUserDocRef();
  if (!userRef) return;

  const sessionId = getSessionId();
  const sessionStartedAt = getSessionStartedAt();

  await userRef.set({
    email: firebase.auth().currentUser?.email || "",
    activeSessionId: sessionId,
    lastLoginAt: Date.now(),
    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
  }, { merge: true });

  if (forceLogoutUnsubscribe) forceLogoutUnsubscribe();

  forceLogoutUnsubscribe = userRef.onSnapshot(doc => {
    const data = doc.data() || {};

    if (data.logoutAllAt && Number(data.logoutAllAt) > sessionStartedAt) {
      firebase.auth().signOut();
      return;
    }

    const memoryClearedAt = Number(data.memoryClearedAt || 0);
    const seenMemoryClear = Number(localStorage.getItem(MEMORY_CLEAR_SEEN_KEY) || 0);

    if (memoryClearedAt && memoryClearedAt > seenMemoryClear) {
      localStorage.setItem(MEMORY_CLEAR_SEEN_KEY, String(memoryClearedAt));
      clearLocalMemoryState();
    }
  });
}

async function deleteCollectionDocs(collectionRef) {
  const snapshot = await collectionRef.get();
  if (snapshot.empty) return;
  const batch = db.batch();
  snapshot.docs.forEach(doc => batch.delete(doc.ref));
  await batch.commit();
}



async function clearUserMetaDocs(userRef) {
  try {
    await Promise.all([
      userRef.collection("meta").doc("favorites").delete(),
      userRef.collection("meta").doc("continueWatching").delete()
    ]);
  } catch (error) {
    console.warn("No se pudieron borrar meta docs anteriores.", error);
  }
}


function clearLocalMemoryState() {
  localStorage.removeItem(FAVORITES_KEY);
  localStorage.removeItem(CONTINUE_KEY);
  localStorage.removeItem(EPISODE_PROGRESS_KEY);
  localStorage.setItem(MEMORY_CLEARED_KEY, "true");

  getAllCatalogItems().forEach(item => {
    item.isFavorite = false;
    item.progress = 0;
  });

  syncFavoriteUI();
  renderFavorites();
  fillRow("continueRow", [], true, true, { loop: true });

  document.querySelectorAll(".progress span, .episode-progress span").forEach(span => {
    span.style.setProperty("--value", "0%");
  });
}

async function clearUserMemory() {
  const ok = confirm("¿Restablecer historial? Esto eliminará tus películas vistas, episodios vistos, progreso y continuar viendo. Tus favoritos se conservarán.");
  if (!ok) return;

  try {
    // Local playback history/progress only. Favorites are intentionally preserved.
    localStorage.removeItem(CONTINUE_KEY);
    localStorage.removeItem(EPISODE_PROGRESS_KEY);

    if (typeof COMPLETED_KEY !== "undefined") {
      localStorage.removeItem(COMPLETED_KEY);
    }

    localStorage.removeItem(MEMORY_CLEARED_KEY);
    localStorage.removeItem(MEMORY_CLEAR_SEEN_KEY);

    // Reset in-memory playback state without touching favorites.
    try {
      getAllCatalogItems().forEach(item => {
        item.progress = 0;
        item.completed = false;
        item.lastWatchedAt = null;
      });
    } catch (_) {}

    // Cloud cleanup for viewed/progress state only.
    const userRef = typeof getUserDocRef === "function" ? getUserDocRef() : null;
    if (userRef) {
      const subcollections = [
        "continueWatching",
        "episodeProgress",
        "completed",
        "playHistory"
      ];

      for (const name of subcollections) {
        try {
          const snap = await userRef.collection(name).get();
          await Promise.all(snap.docs.map(doc => doc.ref.delete()));
        } catch (error) {
          console.warn(`No se pudo restablecer ${name}.`, error);
        }
      }

      try {
        await userRef.set({
          historyResetAt: Date.now(),
          updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
      } catch (_) {}
    }

    // Refresh UI as if this user had never watched anything.
    fillRow("continueRow", [], true, true, { loop: true });
    refreshContinueRow();
    renderSearchResults();
    renderFavorites();
    syncFavoriteUI();

    document.querySelectorAll(".progress span, .episode-progress span, [class*='progress'] span").forEach(span => {
      span.style.setProperty("--value", "0%");
    });

    if (currentPreviewItem) {
      try {
        if (currentPreviewItem.type === "series") {
          refreshCurrentPreviewEpisodes();
        } else {
          setPreviewButtonModeForItem(currentPreviewItem);
        }
      } catch (_) {}
    }

    alert("Historial restablecido. Tus favoritos se conservaron.");
  } catch (error) {
    console.error(error);
    alert("No se pudo restablecer el historial. Intenta de nuevo.");
  }
}

async function logoutCurrentDevice() {
  try {
    if (forceLogoutUnsubscribe) {
      forceLogoutUnsubscribe();
      forceLogoutUnsubscribe = null;
    }
    resetLocalSession();
    await firebase.auth().signOut();
  } catch (error) {
    console.warn("No se pudo cerrar sesión.", error);
  }
}

async function logoutEverywhere() {
  const confirmed = confirm("¿Cerrar sesión en todos lados? Tendrás que iniciar sesión de nuevo en tus dispositivos.");
  if (!confirmed) return;

  try {
    const userRef = getUserDocRef();
    if (userRef) {
      await userRef.set({ logoutAllAt: Date.now() }, { merge: true });
    }
    resetLocalSession();
    await firebase.auth().signOut();
  } catch (error) {
    console.warn("No se pudo cerrar en todos lados.", error);
    await logoutCurrentDevice();
  }
}


async function sendPasswordResetEmail() {
  const user = firebase.auth().currentUser;
  const email = user?.email;

  if (!email) {
    alert("No se encontró el correo de tu sesión actual.");
    return;
  }

  const confirmed = confirm(`¿Enviar correo para restablecer contraseña a ${email}?`);
  if (!confirmed) return;

  const button = document.getElementById("resetPasswordBtn");
  const originalText = button ? button.textContent : "";

  try {
    if (button) {
      button.disabled = true;
      button.textContent = "Enviando...";
    }

    await firebase.auth().sendPasswordResetEmail(email);
    alert("Correo enviado. Revisa tu bandeja de entrada, spam o promociones para restablecer tu contraseña.");
  } catch (error) {
    console.error("No se pudo enviar el correo de restablecimiento.", error);
    alert("No se pudo enviar el correo. Intenta de nuevo más tarde.");
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = originalText || "Restablecer";
    }
  }
}

function setupSettings() {
  const resetPasswordBtn = document.getElementById("resetPasswordBtn");
  const clearBtn = document.getElementById("clearMemoryBtn");
  const logoutEverywhereBtn = document.getElementById("logoutEverywhereBtn");
  const logoutBtn = document.getElementById("logoutBtn");

  if (resetPasswordBtn && resetPasswordBtn.dataset.ready !== "true") {
    resetPasswordBtn.dataset.ready = "true";
    resetPasswordBtn.addEventListener("click", sendPasswordResetEmail);
  }

  if (clearBtn && clearBtn.dataset.ready !== "true") {
    clearBtn.dataset.ready = "true";
    clearBtn.addEventListener("click", clearUserMemory);
  }

  if (logoutEverywhereBtn && logoutEverywhereBtn.dataset.ready !== "true") {
    logoutEverywhereBtn.dataset.ready = "true";
    logoutEverywhereBtn.addEventListener("click", logoutEverywhere);
  }

  if (logoutBtn && logoutBtn.dataset.ready !== "true") {
    logoutBtn.dataset.ready = "true";
    logoutBtn.addEventListener("click", logoutCurrentDevice);
  }
}


/* Womo app skeleton loading - global safe overlay */
function womoSkeletonCard() {
  return '<div class="womo-skeleton-card shimmer"></div>';
}

function womoBuildSkeletonHTML() {
  const cards = Array.from({ length: 5 }).map(() => '<div class="womo-skeleton-card"></div>').join("");
  const section = `
    <section class="womo-skeleton-section">
      <div class="womo-skeleton-row-head">
        <div class="womo-skeleton-heading"></div>
        <div class="womo-skeleton-more"></div>
      </div>
      <div class="womo-skeleton-row">${cards}</div>
    </section>`;

  return `
    <div id="womoSkeleton" class="womo-skeleton-screen" aria-hidden="true">
      <div class="womo-skeleton-shell">
        <section class="womo-skeleton-hero">
          <div class="womo-skeleton-hero-poster"></div>
          <div class="womo-skeleton-hero-info">
            <div class="womo-skeleton-dots"></div>
            <div class="womo-skeleton-title"></div>
            <div class="womo-skeleton-meta"></div>
            <div class="womo-skeleton-copy short"></div>
            <div class="womo-skeleton-copy"></div>
            <div class="womo-skeleton-button"></div>
          </div>
        </section>
        ${section}
        ${section}
      </div>
      <div class="womo-skeleton-mobile-nav"><span></span><span></span><span></span></div>
    </div>
  `;
}

function womoShowSkeleton() {
  if (document.getElementById("womoSkeleton")) return;

  const login = document.getElementById("loginScreen");
  if (login && !login.classList.contains("hidden")) return;

  document.body.insertAdjacentHTML("beforeend", womoBuildSkeletonHTML());
}

function womoHideSkeleton() {
  const skeleton = document.getElementById("womoSkeleton");
  if (!skeleton) return;

  skeleton.classList.add("womo-skeleton-exit");
  setTimeout(() => {
    const current = document.getElementById("womoSkeleton");
    if (current) current.remove();
  }, 240);
}

function womoHasVisibleCatalog() {
  return Boolean(
    document.querySelector("#hero .hero-poster, #hero img, .poster-card, .poster-row img")
  );
}

function womoAutoHideSkeleton() {
  if (womoHasVisibleCatalog()) {
    womoHideSkeleton();
    return true;
  }
  return false;
}


async function init() {
  womoShowSkeleton();
  setupNavigation();
  setupSettings();

  const [moviesRaw, series, concertsRaw] = await Promise.all([
    readCollection("movies", normalizeMovie),
    readCollection("series", normalizeSeries),
    readCollection("concerts", normalizeConcert)
  ]);

  const publishedMoviesRaw = moviesRaw.filter(item => item.published !== false);
  const publishedSeries = series.filter(item => item.published !== false);
  const publishedConcertsRaw = concertsRaw.filter(item => item.published !== false);

  const movies = publishedMoviesRaw.filter(item => item.type !== "concert");
  const concerts = [...publishedMoviesRaw.filter(item => item.type === "concert"), ...publishedConcertsRaw];
  const allItems = [...movies, ...publishedSeries, ...concerts].filter(item => item.poster);
  const sortedItems = allItems.sort((a, b) => b.createdAt - a.createdAt);
  allItemsByContinueKey = new Map(allItems.map(item => [`${item.type}:${item.id}`, item]));
  syncFavoriteUI();
  const allByKey = new Map(allItems.map(item => [`${item.type === "series" ? "series" : item.type === "concert" ? "concert" : "movie"}:${item.id}`, item]));
  const homeConfig = await readHomeConfigMain(allByKey);
  heroItems = homeConfig.newItems.length ? homeConfig.newItems : buildDefaultNewItems(sortedItems);
  heroIndex = 0;

  const movieItems = movies.filter(item => item.type === "movie");
  const noveltyItems = [...movieItems]
    .sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0))
    .slice(0, 20);
  const seriesItems = await sortSeriesByLatestEpisode(publishedSeries);
  const concertItems = concerts;
  const continueItems = buildContinueItems(sortedItems);

  dynamicViewAllMeta = {};
  viewAllCollections = {
    continue: continueItems,
    movies: noveltyItems,
    series: seriesItems,
    concerts: concertItems,
    all: sortedItems
  };

  setHero(0);
  fillRow("continueRow", continueItems, true, true, { loop: true });
  fillRow("moviesRow", noveltyItems, false, true, { loop: true, limit: 20 });
  fillRow("seriesRow", seriesItems, false, true);
  const taxonomyEntries = womoBuildHomeGenreSections(sortedItems, homeConfig.visibleGenres, homeConfig.visibleCollections);
  fillRow("concertsRow", concertItems, false, true);
  applyDynamicHomeSectionOrder(homeConfig, taxonomyEntries.genres || taxonomyEntries || [], taxonomyEntries.collections || []);
  womoHideSkeleton();
  setupRowEdgeScroll();
  renderSearchResults();
  renderFavorites();
  syncFavoriteUI();

  if (window.lucide) lucide.createIcons();
}

// init is started after Firebase Auth resolves.


function genreTokens(item) {
  const source = Array.isArray(item.genres) ? item.genres.join(',') : (item.genre || item.genres || '');
  return String(source)
    .toLowerCase()
    .split(',')
    .map(value => value.trim())
    .filter(Boolean);
}

function getPreviewRecommendations(item) {
  // Series previews must reserve the lower panel for seasons/episodes.
  // Do not render recommendations for series, even when they belong to a collection.
  if (item && item.type === 'series') return [];

  const all = [...allItemsByContinueKey.values()]
    .filter(x => x && x.id !== item.id && x.poster);

  const currentCollections = womoCollectionList(item).map(womoGenreSlug);
  if (currentCollections.length) {
    const sameCollection = all
      .filter(x => womoCollectionList(x).some(collection => currentCollections.includes(womoGenreSlug(collection))))
      .sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0))
      .slice(0, 8);
    if (sameCollection.length) {
      sameCollection.womoTitle = womoCollectionList(item)[0] || 'Colección';
      return sameCollection;
    }
  }

  if (item.type === 'concert') {
    const concerts = all
      .filter(x => x.type === 'concert')
      .sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0))
      .slice(0, 3);
    if (concerts.length) {
      concerts.womoTitle = 'Recomendaciones';
      return concerts;
    }
  }

  const currentGenres = genreTokens(item);
  const sameGenre = currentGenres.length
    ? all
        .filter(x => item.type === 'series' ? x.type === 'series' : x.type === 'movie')
        .filter(x => genreTokens(x).some(genre => currentGenres.includes(genre)))
        .sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0))
        .slice(0, 8)
    : [];

  if (sameGenre.length >= 1) {
    sameGenre.womoTitle = 'Recomendaciones';
    return sameGenre;
  }

  const recent = all
    .filter(x => item.type === 'series' ? x.type === 'series' : item.type === 'concert' ? x.type === 'concert' : x.type === 'movie')
    .sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0))
    .slice(0, 3);

  recent.womoTitle = 'Recientes';
  return recent;
}

function renderPreviewRecommendationsForItem(item) {
  const extra = document.getElementById('previewExtra');
  const extraTitle = document.getElementById('previewExtraTitle');
  const recs = document.getElementById('previewRecs');
  if (!extra || !extraTitle || !recs || !item) return;
  recs.innerHTML = '';
  const recommendations = getPreviewRecommendations(item);
  if (!recommendations.length) {
    extra.classList.add('hidden');
    return;
  }
  extra.classList.remove('hidden');
  extraTitle.textContent = recommendations.womoTitle || 'Recomendaciones';
  recommendations.forEach(r => {
    const img = document.createElement('img');
    img.src = r.poster || r.posterUrl;
    img.alt = r.title || 'Recomendación';
    img.addEventListener('click', () => openPreview(r));
    recs.appendChild(img);
  });
}


const COMPLETED_KEY = "womo_completed_items";
const EPISODE_PROGRESS_KEY = "womo_episode_progress";
let currentPreviewSeriesIdForEpisodes = null;
let currentPreviewEpisodesCache = [];
let currentPlayerItem = null;
let currentPlayerEpisode = null;

let currentPreviewItem = null;

function setCurrentPreviewItem(item) {
  currentPreviewItem = item || null;

  // Critical: if the preview is not a series, clear the series state so the
  // series click handler cannot hijack movie/concert buttons.
  if (!item || item.type !== "series") {
    currentPreviewSeriesIdForEpisodes = null;
    currentPreviewEpisodesCache = [];
  }
}

function isCurrentPreviewSeries() {
  return currentPreviewItem && currentPreviewItem.type === "series";
}


function loadEpisodeProgress() {
  try {
    const value = JSON.parse(localStorage.getItem(EPISODE_PROGRESS_KEY) || "{}");
    return value && typeof value === "object" ? value : {};
  } catch (_) {
    return {};
  }
}

function episodeKey(seriesId, season, episodeNumber, episodeId = "") {
  return `${seriesId}:S${season}:E${episodeNumber}:${episodeId}`;
}

async function readSeriesEpisodes(seriesId) {
  try {
    const snapshot = await db.collection("series").doc(seriesId).collection("episodes").get();
    return snapshot.docs.map((doc, index) => {
      const data = doc.data() || {};
      const season = Number(data.season || data.seasonNumber || data.temporada || 1);
      const episodeNumber = Number(data.episode || data.episodeNumber || data.number || data.episodio || index + 1);
      const durationRaw = data.duration || data.runtime || data.durationMinutes || "";
      return {
        id: doc.id,
        title: data.title || data.name || data.episodeTitle || cleanTitleFromId(doc.id),
        duration: durationRaw ? `${durationRaw} min`.replace(" min min", " min") : "",
        season,
        episodeNumber,
        progress: Number(data.progress || 0),
        hlsUrl: data.hlsUrl || data.videoUrl || data.videoURL || data.streamUrl || data.playbackUrl || data.mp4Url || data.m3u8 || data.file || data.link || data.url || ""
      };
    }).sort((a, b) => (a.season - b.season) || (a.episodeNumber - b.episodeNumber));
  } catch (error) {
    console.warn("No se pudieron leer episodios de la serie.", error);
    return [];
  }
}

function getSeriesContinueLabel(item, episodes) {
  const state = loadContinueState().find(x => x.id === item.id && x.type === item.type);
  const progressMap = loadEpisodeProgress();

  const sorted = [...(episodes || [])].sort((a, b) =>
    (Number(a.season || 1) - Number(b.season || 1)) ||
    (Number(a.episodeNumber || a.episode || 1) - Number(b.episodeNumber || b.episode || 1))
  );

  let target = null;

  if (state) {
    target = sorted.find(ep =>
      Number(ep.season || 1) === Number(state.season || 1) &&
      Number(ep.episodeNumber || ep.episode || 1) === Number(state.episode || 1)
    );
  }

  if (!target) {
    target = sorted.find(ep => {
      const key = episodeKey(item.id, ep.season, ep.episodeNumber, ep.id);
      const progress = Number(progressMap[key] ?? ep.progress ?? 0);
      return progress > 0 && progress < 98;
    });
  }

  if (!target) {
    target = sorted.find(ep => {
      const key = episodeKey(item.id, ep.season, ep.episodeNumber, ep.id);
      const progress = Number(progressMap[key] ?? ep.progress ?? 0);
      return progress < 98;
    }) || sorted[0];
  }

  const season = target?.season || 1;
  const episode = target?.episodeNumber || target?.episode || 1;
  const key = target ? episodeKey(item.id, target.season, target.episodeNumber, target.id) : "";
  const progress = target ? Number(progressMap[key] ?? target.progress ?? 0) : 0;
  const started = Boolean(state) || (progress > 0 && progress < 98) || Number(item.progress || 0) > 0;

  return `${started ? "Continuar" : "Reproducir"} T${season} E${episode}`;
}












function getPreviewPrimaryButton() {
  return document.getElementById("previewPlay")
    || document.querySelector("[data-preview-play]")
    || document.querySelector(".preview-play")
    || document.querySelector(".preview-actions .primary-btn");
}

function getPreviewRestartButton() {
  return document.getElementById("previewRestart")
    || document.querySelector("[data-preview-restart]")
    || document.querySelector(".preview-restart")
    || document.querySelector(".preview-actions .secondary-btn");
}


function getContinueProgressForItem(item) {
  if (!item) return 0;
  const entry = getContinueStorageList().find(x => x.id === item.id && x.type === item.type);
  return Math.max(Number(entry?.progress || 0), Number(item.progress || 0), 0);
}

function setPreviewButtonModeForItem(item) {
  if (!item) return;

  const primary = getPreviewPrimaryButton();
  const restart = getPreviewRestartButton();
  if (!primary) return;

  if (item.type === "series") {
    syncSeriesPreviewPrimaryButton();
    return;
  }

  const completed = isItemCompleted(item);
  const progress = getContinueProgressForItem(item);

  primary.dataset.previewType = item.type;
  primary.dataset.previewId = item.id;
  primary.dataset.seriesMode = "";

  if (completed || progress >= 98) {
    primary.textContent = "Volver a ver";
    primary.dataset.completed = "true";
    if (restart) {
      restart.classList.add("hidden");
      restart.style.display = "none";
    }
    return;
  }

  if (progress > 0 && progress < 98) {
    primary.textContent = "Continuar";
    primary.dataset.completed = "false";
    if (restart) {
      restart.classList.remove("hidden");
      restart.style.display = "";
    }
    return;
  }

  primary.textContent = "Reproducir";
  primary.dataset.completed = "false";
  if (restart) {
    restart.classList.add("hidden");
    restart.style.display = "none";
  }
}

function setMovieConcertPreviewCompletedState(item) {
  if (!item || item.type === "series") return;
  setItemCompleted(item, true);
  item.progress = 0;
  setPreviewButtonModeForItem(item);
}

function setMovieConcertPreviewPlayableState(item) {
  if (!item || item.type === "series") return;
  setPreviewButtonModeForItem(item);
}

function syncPreviewButtonsForCompletion(item) {
  try {
    if (!item || item.type === "series") return;
    setMovieConcertPreviewCompletedState(item);
  } catch (_) {}
}

function applyCompletedPreviewState(item) {
  try {
    if (!item) return;
    setPreviewButtonModeForItem(item);
  } catch (_) {}
}

function forcePreviewButtonRefresh(item) {
  try {
    setPreviewButtonModeForItem(item || currentPreviewItem);
  } catch (_) {}
}

function getSortedPreviewEpisodes() {
  return [...(currentPreviewEpisodesCache || [])].sort((a, b) =>
    (Number(a.season || a.seasonNumber || 1) - Number(b.season || b.seasonNumber || 1)) ||
    (Number(a.episodeNumber || a.episode || 1) - Number(b.episodeNumber || b.episode || 1))
  );
}

function getEpisodeStoredProgress(seriesId, ep) {
  const progressMap = loadEpisodeProgress();
  const season = Number(ep.season || ep.seasonNumber || 1);
  const episodeNumber = Number(ep.episodeNumber || ep.episode || 1);
  const id = ep.id || "";

  const keys = [
    episodeKey(seriesId, season, episodeNumber, id),
    `${seriesId}:S${season}:E${episodeNumber}:${id}`,
    `${seriesId}:S${season}:E${episodeNumber}:`
  ];

  const storedValues = keys
    .map(key => Number(progressMap[key]))
    .filter(value => Number.isFinite(value));

  return Math.max(Number(ep.progress || 0), ...storedValues, 0);
}

function getEpisodeAfter(seriesId, episode) {
  const sorted = getSortedPreviewEpisodes();
  if (!episode || !sorted.length) return null;

  const currentSeason = Number(episode.season || episode.seasonNumber || 1);
  const currentEpisode = Number(episode.episodeNumber || episode.episode || 1);

  const index = sorted.findIndex(ep =>
    Number(ep.season || ep.seasonNumber || 1) === currentSeason &&
    Number(ep.episodeNumber || ep.episode || 1) === currentEpisode
  );

  return index >= 0 ? (sorted[index + 1] || null) : null;
}

function getFirstUnfinishedEpisode() {
  if (!currentPreviewSeriesIdForEpisodes || !Array.isArray(currentPreviewEpisodesCache)) return null;

  return getSortedPreviewEpisodes().find(ep =>
    getEpisodeStoredProgress(currentPreviewSeriesIdForEpisodes, ep) < 98
  ) || null;
}




function setSeriesPreviewButtonForEpisode(episode) {
  const primary = getPreviewPrimaryButton();
  const restart = getPreviewRestartButton();
  if (!primary || !episode) return;

  const progressMap = loadEpisodeProgress();
  const key = currentPreviewItem ? episodeKey(currentPreviewItem.id, episode.season, episode.episodeNumber, episode.id) : "";
  const progress = Number(progressMap[key] ?? episode.progress ?? 0);
  const started = progress > 0 && progress < 98;

  primary.textContent = `${started ? "Continuar" : "Reproducir"} T${episode.season || 1} E${episode.episodeNumber || episode.episode || 1}`;
  primary.dataset.seriesMode = "true";
  primary.dataset.season = String(episode.season || 1);
  primary.dataset.episode = String(episode.episodeNumber || episode.episode || 1);
  primary.dataset.episodeId = episode.id || "";

  if (restart) {
    restart.classList.add("hidden");
    restart.style.display = "none";
  }
}

function syncSeriesPreviewPrimaryButton(preferredEpisode = null) {
  try {
    if (!currentPreviewSeriesIdForEpisodes || !currentPreviewEpisodesCache.length) return;
    const nextEpisode = preferredEpisode || getFirstUnfinishedEpisode();
    setSeriesPreviewButtonForEpisode(nextEpisode);
  } catch (error) {
    console.warn("No se pudo sincronizar el botón del preview.", error);
  }
}

function renderEpisodes(seriesId, episodes) {
  currentPreviewSeriesIdForEpisodes = seriesId;
  currentPreviewEpisodesCache = Array.isArray(episodes) ? episodes : [];
const extra = document.getElementById('previewExtra');
  const extraTitle = document.getElementById('previewExtraTitle');
  const recs = document.getElementById('previewRecs');
  recs.innerHTML = '';

  if (!episodes.length) {
    extra.classList.add('hidden');
    return;
  }

  extra.classList.remove('hidden');
  extraTitle.textContent = 'Episodios';

  const seasons = [...new Set(episodes.map(ep => ep.season))].sort((a, b) => a - b);
  const progressMap = loadEpisodeProgress();

  const block = document.createElement('div');
  block.className = 'season-block';
  block.style.cssText = 'width:100%;max-width:none;box-sizing:border-box;';

  const tabs = document.createElement('div');
  tabs.className = 'season-tabs';
  seasons.forEach(season => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'season-tab';
    button.textContent = String(season);
    button.dataset.season = String(season);
    tabs.appendChild(button);
  });

  const list = document.createElement('div');
  list.className = 'episode-list';
  list.style.cssText = 'width:100%;max-width:none;display:flex;flex-direction:column;align-items:stretch;box-sizing:border-box;';

  function drawSeason(season) {
    list.innerHTML = '';
    episodes.filter(ep => ep.season === Number(season)).forEach(ep => {
      const key = episodeKey(seriesId, ep.season, ep.episodeNumber, ep.id);
      const progress = Math.max(0, Math.min(100, Number(progressMap[key] ?? ep.progress ?? 0)));
      const item = document.createElement('article');
      item.className = 'episode-item';
      if (isWomoComplete(progress)) item.classList.add('completed');
      if (progress > 0 && !isWomoComplete(progress)) item.classList.add('started');
      if (progress <= 0) item.classList.add('not-started');
      item.style.cssText = 'width:100%;max-width:none;box-sizing:border-box;align-self:stretch;';

      const durationNumber = Number(String(ep.duration || '').replace(/[^0-9.]/g, '')) || 0;
      const remainingMinutes = durationNumber ? Math.max(1, Math.round(durationNumber * (1 - progress / 100))) : 0;
      const rightLabel = isWomoComplete(progress)
        ? '✓'
        : progress > 0 && remainingMinutes
          ? `-${remainingMinutes} min`
          : (ep.duration || '');

      item.innerHTML = `
        <div class="episode-main">
          <div class="episode-title">${ep.title}</div>
          <div class="episode-meta">T${ep.season} E${ep.episodeNumber}</div>
          <div class="episode-side">${rightLabel}</div>
          ${progress > 0 && !isWomoComplete(progress) ? `
            <div class="episode-progress-row visible">
              <div class="episode-progress"><span style="--value:${progress}%"></span></div>
            </div>
          ` : ''}
        </div>
      `;
      const seriesItem = allItemsByContinueKey.get(`series:${seriesId}`);
      if (seriesItem) item.addEventListener('click', () => openPlayer(seriesItem, { episode: ep }));
      list.appendChild(item);
    });
    syncSeriesPreviewPrimaryButton();
  }

  function activateSeason(season) {
    tabs.querySelectorAll('.season-tab').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.season === String(season));
    });
    drawSeason(season);
    syncSeriesPreviewPrimaryButton();
  }

  tabs.addEventListener('click', (event) => {
    const button = event.target.closest('.season-tab');
    if (!button) return;
    activateSeason(button.dataset.season);
  });

  block.appendChild(tabs);
  block.appendChild(list);
  recs.appendChild(block);
  activateSeason(seasons[0]);
  syncSeriesPreviewPrimaryButton();
}


function getWomoPreviewPosterUrl(item) {
  if (!item) return "";
  const direct = item.poster || item.posterUrl || item.imageUrl || item.image || item.cover || item.coverUrl || item.backdrop || item.backdropUrl || item.thumbnail || item.thumb || "";
  if (direct) return String(direct).trim();
  try {
    const key = `${item.type}:${item.id}`;
    const catalogItem = allItemsByContinueKey && allItemsByContinueKey.get ? allItemsByContinueKey.get(key) : null;
    if (catalogItem) {
      return String(catalogItem.poster || catalogItem.posterUrl || catalogItem.imageUrl || catalogItem.image || catalogItem.cover || catalogItem.coverUrl || catalogItem.backdrop || catalogItem.backdropUrl || "").trim();
    }
  } catch (_) {}
  return "";
}

function womoBindPreviewPosterFallback() {
  const poster = document.getElementById('previewPoster');
  const hero = document.querySelector('#previewModal .preview-hero');
  if (!poster || poster.dataset.womoPosterFallbackBound === 'true') return;
  poster.dataset.womoPosterFallbackBound = 'true';
  poster.addEventListener('error', function(){
    const bg = hero ? getComputedStyle(hero).getPropertyValue('--preview-poster-bg') : '';
    if (!bg || bg.trim() === 'none') {
      poster.style.display = 'none';
      poster.classList.add('womo-preview-poster-missing');
    }
  });
  poster.addEventListener('load', function(){
    if (poster.naturalWidth > 0) {
      poster.style.display = 'block';
      poster.classList.remove('womo-preview-poster-missing');
    }
  });
}

async function openPreview(item) {
  womoBindPreviewPosterFallback();
  setCurrentPreviewItem(item || arguments[0]);
  setCurrentPreviewItem(item || arguments[0]);
  setTimeout(() => applyCompletedPreviewState(item), 0);
  setTimeout(() => applyCompletedPreviewState(item), 0);
  const modal = document.getElementById('previewModal');
  const poster = document.getElementById('previewPoster');
  const posterUrl = getWomoPreviewPosterUrl(item);
  if (poster) {
    poster.alt = item.title || 'Poster';
    if (posterUrl) {
      poster.src = posterUrl;
      poster.style.display = 'block';
      poster.classList.remove('womo-preview-poster-missing');
    } else {
      poster.removeAttribute('src');
      poster.style.display = 'none';
      poster.classList.add('womo-preview-poster-missing');
    }
  }

  const previewHero = modal?.querySelector('.preview-hero');
  if (previewHero) {
    previewHero.style.setProperty('--preview-poster-bg', posterUrl ? `url("${String(posterUrl).replace(/"/g, '\"')}")` : 'none');
    previewHero.classList.toggle('womo-preview-hero-has-poster', Boolean(posterUrl));
  }

  const previewCard = modal?.querySelector('.preview-card');
  if (previewCard) {
    previewCard.style.setProperty('--preview-bg', posterUrl ? `url("${String(posterUrl).replace(/"/g, '\"')}")` : 'none');
    previewCard.scrollTop = 0;
  }


  document.getElementById('previewTitle').textContent = item.title;
  const previewFavorite = document.getElementById('previewFavorite');
  if (previewFavorite) {
    previewFavorite.dataset.favKey = `${item.type}:${item.id}`;
    previewFavorite.classList.toggle('active', isFavoriteItem(item));
    previewFavorite.onclick = () => {
      const active = toggleFavoriteItem(item);
      previewFavorite.classList.toggle('active', active);
    };
  }
  const meta = [item.duration, item.year, item.genre || item.genres].filter(Boolean).join(' • ');
  document.getElementById('previewMeta').textContent = meta;
  document.getElementById('previewDesc').textContent = item.description || item.synopsis || '';

  const state = loadContinueState().find(x => x.id === item.id && x.type === item.type);
  const actions = document.getElementById('previewActions');
  const extra = document.getElementById('previewExtra');
  const extraTitle = document.getElementById('previewExtraTitle');
  const recs = document.getElementById('previewRecs');
  recs.innerHTML = '';

  if (item.type === 'series') {
    const episodes = await readSeriesEpisodes(item.id);
    actions.innerHTML = `<button class="primary" data-preview-play>${getSeriesContinueLabel(item, episodes)}</button><button class="secondary" data-preview-shuffle>SHUFFLE</button>`;
    const currentSeason = state?.season || episodes[0]?.season || 1;
    const currentEpisodeNumber = state?.episode || episodes[0]?.episodeNumber || 1;
    const currentEpisode = episodes.find(ep => ep.season === Number(currentSeason) && ep.episodeNumber === Number(currentEpisodeNumber)) || episodes[0] || null;
    const playBtn = actions.querySelector('[data-preview-play]');
    const shuffleBtn = actions.querySelector('[data-preview-shuffle]');
    if (playBtn) playBtn.onclick = () => openPlayer(item, { episode: currentEpisode });
    if (shuffleBtn) {
      shuffleBtn.setAttribute('type', 'button');
      shuffleBtn.onclick = async (event) => {
        if (event) {
          event.preventDefault();
          event.stopPropagation();
        }
        try {
          if (typeof womoStartShuffleSession === 'function') {
            womoStartShuffleSession('series', item.id);
          }
          window.__womoNextShuffleScope = 'series';
          const picked = typeof womoPickRandomShuffleEpisode === 'function'
            ? await womoPickRandomShuffleEpisode()
            : null;
          const episodeToPlay = picked?.episode || (episodes.length ? episodes[Math.floor(Math.random() * episodes.length)] : null);
          if (!episodeToPlay) return;
          if (typeof womoSetShuffleNoProgress === 'function') womoSetShuffleNoProgress(true);
          openPlayer(picked?.seriesItem || item, {
            episode: episodeToPlay,
            shuffleMode: true,
            fromShuffle: true,
            noProgress: true,
            saveProgress: false,
            shuffleScope: 'series',
            shuffleSeriesId: item.id,
            startAt: 0
          });
        } catch (error) {
          console.warn('No se pudo iniciar shuffle de serie.', error);
        }
      };
    }
    renderEpisodes(item.id, episodes);
  } else {
    actions.innerHTML = state
      ? '<button class="primary" data-preview-play>Continuar</button><button class="secondary" data-preview-restart>Reiniciar</button>'
      : '<button class="primary" data-preview-play>Reproducir</button>';

    const playBtn = actions.querySelector('[data-preview-play]');
    const restartBtn = actions.querySelector('[data-preview-restart]');
    if (playBtn) playBtn.onclick = () => openPlayer(item);
    if (restartBtn) restartBtn.onclick = () => {
      upsertContinueItem(item, 0);
      openPlayer(item);
    };

    renderPreviewRecommendationsForItem(item);
  }

  modal.classList.add('open');
  if (window.lucide) lucide.createIcons();
}
document.addEventListener('click', e => {
  if (e.target.closest('.preview-close') || e.target.classList.contains('preview-backdrop')) {
    document.getElementById('previewModal').classList.remove('open');
  }
});

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    document.getElementById('previewModal').classList.remove('open');
  }
});


let currentHls = null;
let playerSaveTimer = null;
let currentPlayerContext = null;

let womoAudioTrackSetter = null;

function womoAudioTrackLabel(track, index) {
  const raw = track?.name || track?.label || track?.lang || track?.language || "";
  const languageNames = {
    es: "Español", spa: "Español", en: "English", eng: "English",
    fr: "Français", fra: "Français", fre: "Français",
    de: "Deutsch", deu: "Deutsch", ger: "Deutsch",
    it: "Italiano", ita: "Italiano", pt: "Português", por: "Português",
    ja: "日本語", jpn: "日本語", ko: "한국어", kor: "한국어"
  };
  return languageNames[String(raw).toLowerCase()] || raw || `Audio ${index + 1}`;
}

function womoResetAudioSelector() {
  const control = document.getElementById("playerAudioControl");
  const button = document.getElementById("playerAudioButton");
  const menu = document.getElementById("playerAudioMenu");
  womoAudioTrackSetter = null;
  if (control) control.hidden = true;
  if (button) button.setAttribute("aria-expanded", "false");
  if (menu) {
    menu.classList.remove("open");
    menu.replaceChildren();
  }
}

function womoRenderAudioSelector(tracks, activeIndex, setter) {
  const list = Array.from(tracks || []);
  if (list.length < 2) {
    womoResetAudioSelector();
    return;
  }

  const control = document.getElementById("playerAudioControl");
  const menu = document.getElementById("playerAudioMenu");
  if (!control || !menu) return;

  womoAudioTrackSetter = setter;
  menu.replaceChildren();
  list.forEach((track, index) => {
    const option = document.createElement("button");
    option.type = "button";
    option.className = "player-audio-option";
    option.setAttribute("role", "menuitemradio");
    option.setAttribute("aria-checked", index === activeIndex ? "true" : "false");
    option.classList.toggle("active", index === activeIndex);
    option.textContent = womoAudioTrackLabel(track, index);
    option.addEventListener("click", event => {
      event.stopPropagation();
      if (typeof womoAudioTrackSetter === "function") womoAudioTrackSetter(index);
      womoRenderAudioSelector(list, index, setter);
      menu.classList.remove("open");
      document.getElementById("playerAudioButton")?.setAttribute("aria-expanded", "false");
    });
    menu.appendChild(option);
  });
  control.hidden = false;
  if (window.lucide) lucide.createIcons();
}

function womoRefreshHlsAudioTracks() {
  if (!currentHls) return;
  womoRenderAudioSelector(currentHls.audioTracks, currentHls.audioTrack, index => {
    if (currentHls) currentHls.audioTrack = index;
  });
}

function womoRefreshNativeAudioTracks(video) {
  const tracks = video?.audioTracks;
  if (!tracks || tracks.length < 2) return;
  const list = Array.from({ length: tracks.length }, (_, index) => tracks[index]);
  const active = Math.max(0, list.findIndex(track => track.enabled));
  womoRenderAudioSelector(list, active, index => {
    list.forEach((track, trackIndex) => { track.enabled = trackIndex === index; });
  });
}

document.addEventListener("click", event => {
  const button = event.target.closest("#playerAudioButton");
  const menu = document.getElementById("playerAudioMenu");
  if (button && menu) {
    event.stopPropagation();
    const open = menu.classList.toggle("open");
    button.setAttribute("aria-expanded", String(open));
    return;
  }
  if (!event.target.closest("#playerAudioControl")) {
    menu?.classList.remove("open");
    document.getElementById("playerAudioButton")?.setAttribute("aria-expanded", "false");
  }
});

function getContinueEntry(item) {
  return loadContinueState().find(x => x.id === item.id && x.type === item.type);
}

function getItemProgress(item) {
  const entry = getContinueEntry(item);
  return Number(entry?.progress ?? item.progress ?? 0);
}

function savePlayerProgress() {
  if (typeof womoIsShuffleNoProgressPlayback === "function" && womoIsShuffleNoProgressPlayback()) return;
  if (window.__womoShuffleNoProgress || womoGlobalShuffleNoProgress) return;
  if (currentPlayerContext?.saveProgress === false || currentPlayerContext?.shuffleMode || currentPlayerContext?.fromShuffle || currentPlayerContext?.noProgress) return;
  const video = document.getElementById('womoPlayer');
  if (!video || !currentPlayerContext || !video.duration || !isFinite(video.duration)) return;

  const progress = Math.max(0, Math.min(100, (video.currentTime / video.duration) * 100));
  const { item, episode } = currentPlayerContext;

  if (item.type === 'series' && episode) {
    currentPlayerEpisode.progress = progress;
    currentPlayerItem.progress = progress;
    const entry = {
      id: item.id,
      type: item.type,
      progress,
      season: episode.season,
      episode: episode.episodeNumber,
      episodeId: episode.id,
      lastWatchedAt: Date.now()
    };
    const state = loadContinueState().filter(value => !(value.id === item.id && value.type === item.type));
    state.unshift(entry);
    saveContinueState(state);
    saveContinueEntryToCloud(entry);

    const map = loadEpisodeProgress();
    map[episodeKey(item.id, episode.season, episode.episodeNumber, episode.id)] = progress;
    localStorage.setItem(EPISODE_PROGRESS_KEY, JSON.stringify(map));
    saveEpisodeProgressToCloud(item.id, episode, progress);
  } else {
    upsertContinueItem(item, progress);
  }
}

function getPlayableUrl(item, episode = null) {
  return episode?.hlsUrl || item.hlsUrl || item.videoUrl || item.url || "";
}







function getContinueStorageList() {
  try {
    const value = JSON.parse(localStorage.getItem(CONTINUE_KEY) || "[]");
    return Array.isArray(value) ? value : [];
  } catch (_) {
    return [];
  }
}

function setContinueStorageList(list) {
  localStorage.setItem(CONTINUE_KEY, JSON.stringify(Array.isArray(list) ? list : []));
}

function refreshContinueWatchingRow() {
  try {
    const items = getContinueStorageList().map(entry => {
      const catalogItem = allItemsByContinueKey.get(`${entry.type}:${entry.id}`);
      return catalogItem ? { ...catalogItem, progress: entry.progress || catalogItem.progress || 0 } : null;
    }).filter(Boolean);
    fillRow("continueRow", items, true, true, { loop: true });
  } catch (_) {}
}

function removeContinueEverywhere(item) {
  if (!item) return;

  const filtered = getContinueStorageList().filter(entry =>
    !(entry.id === item.id && entry.type === item.type)
  );
  setContinueStorageList(filtered);

  try {
    const legacyKey = `${item.type}_${item.id}`;
    const userRef = getUserDocRef && getUserDocRef();
    if (userRef) {
      userRef.collection("continueWatching").doc(legacyKey).delete().catch(() => {});
      userRef.collection("continueWatching").doc(`${item.type}:${item.id}`).delete().catch(() => {});
      userRef.collection("continueWatching").doc(item.id).delete().catch(() => {});
    }
  } catch (_) {}

  item.progress = 0;
  refreshContinueWatchingRow();
}


/* Completed state cloud sync */
async function saveCompletedItemToCloud(item) {
  if (!item || !item.id || !item.type) return;
  try {
    const userRef = getUserDocRef && getUserDocRef();
    if (!userRef) return;

    const collectionName = item.type === "concert" ? "concerts" : item.type === "series" ? "series" : "movies";
    await db.collection(collectionName).doc(item.id).set({
      completed: true,
      progress: 100,
      completedAt: Date.now()
    }, { merge: true });

    await userRef.collection("completed").doc(`${item.type}:${item.id}`).set({
      id: item.id,
      type: item.type,
      completed: true,
      progress: 100,
      completedAt: Date.now()
    }, { merge: true });
  } catch (error) {
    console.warn("No se pudo sincronizar completado en cloud.", error);
  }
}

function markPlayableCompleted(item) {
  if (!item) return;
  setItemCompleted(item, true);
  item.progress = 0;
  removeContinueEverywhere(item);
  setMovieConcertPreviewCompletedState(item);

  try {
    saveCompletedItemToCloud(item);
  } catch (_) {}
}

function getCompletedFirstEpisodeForReplay() {
  const sorted = getSortedPreviewEpisodes && getSortedPreviewEpisodes();
  return sorted && sorted.length ? sorted[0] : null;
}

function loadCompletedItems() {
  try {
    const value = JSON.parse(localStorage.getItem(COMPLETED_KEY) || "{}");
    return value && typeof value === "object" ? value : {};
  } catch (_) {
    return {};
  }
}

function completedKeyForItem(item) {
  return item ? `${item.type}:${item.id}` : "";
}

function isItemCompleted(item) {
  if (!item) return false;
  if (item.completed === true || Number(item.progress || 0) >= 98) return true;
  const map = loadCompletedItems();
  return Boolean(map[completedKeyForItem(item)]);
}

function setItemCompleted(item, completed = true) {
  if (!item) return;
  const map = loadCompletedItems();
  const key = completedKeyForItem(item);
  if (!key) return;
  if (completed) map[key] = true;
  else delete map[key];
  localStorage.setItem(COMPLETED_KEY, JSON.stringify(map));
  item.completed = completed;
}

function isWomoComplete(progress) {
  return Number(progress || 0) >= 98;
}

function removeContinueItemFor(item) {
  removeContinueEverywhere(item);
}

function markItemAsCompleted(item) {
  markPlayableCompleted(item);
}














function getWomoPlayerVideo() {
  return document.getElementById("playerVideo")
    || document.querySelector("#playerOverlay video")
    || document.querySelector(".player-overlay video")
    || document.querySelector("video");
}

function getWomoPlayerOverlay() {
  return document.getElementById("playerOverlay")
    || document.querySelector(".player-overlay")
    || document.querySelector("[data-player-overlay]");
}

function hideWomoPlayerOverlay() {
  womoHideShuffleSkipOverlay();
  womoResetShuffleSession();
  womoHideShuffleNextOverlay();
  womoUnlockMobileOrientation();
  womoClearForcedPlayerVisibleState();
  const overlay = getWomoPlayerOverlay();
  const video = getWomoPlayerVideo();
  if (video) {
    try { video.pause(); } catch (_) {}
    resetTsPlayback(video);
    try { video.removeAttribute("src"); video.load(); } catch (_) {}
  }
  if (overlay) {
    overlay.classList.add("hidden");
    overlay.classList.remove("active", "open", "show");
    overlay.style.display = "none";
  }
  document.body.classList.remove("player-open");
}

function refreshCurrentPreviewEpisodes() {
  if (currentPreviewSeriesIdForEpisodes && currentPreviewEpisodesCache.length) {
    renderEpisodes(currentPreviewSeriesIdForEpisodes, currentPreviewEpisodesCache);
    syncSeriesPreviewPrimaryButton();
  }
}

function saveActiveEpisodeProgress(forceCompleted = false) {
  if (typeof womoIsShuffleNoProgressPlayback === "function" && womoIsShuffleNoProgressPlayback()) return;
  if (window.__womoShuffleNoProgress || womoGlobalShuffleNoProgress) return;
  if (currentPlayerContext?.saveProgress === false || currentPlayerContext?.shuffleMode || currentPlayerContext?.fromShuffle || currentPlayerContext?.noProgress) return;
  try {
    const video = getWomoPlayerVideo();
    if (!video || !currentPlayerItem) return;

    const isEpisodePlayback = Boolean(currentPlayerEpisode);
    const duration = Number(video.duration || 0);
    const current = Number(video.currentTime || 0);

    if (!forceCompleted) {
      if (!duration || !Number.isFinite(duration) || duration <= 0) return;
      if (!current || !Number.isFinite(current) || current <= 0) return;
    }

    const calculated = forceCompleted
      ? 100
      : Math.max(0, Math.min(100, Math.round((current / duration) * 100)));

    const progress = calculated >= 98 ? 100 : calculated;

    if (isEpisodePlayback) {
      const key = episodeKey(
        currentPlayerItem.id,
        currentPlayerEpisode.season,
        currentPlayerEpisode.episodeNumber,
        currentPlayerEpisode.id
      );

      const map = loadEpisodeProgress();
      const previousProgress = Number(map[key] ?? currentPlayerEpisode.progress ?? 0) || 0;
      const finalProgress = Math.max(previousProgress, progress);

      if (finalProgress < 1) return;

      map[key] = finalProgress >= 98 ? 100 : finalProgress;
      localStorage.setItem(EPISODE_PROGRESS_KEY, JSON.stringify(map));

      currentPlayerEpisode.progress = map[key];

      const cached = currentPreviewEpisodesCache.find(ep =>
        ep.id === currentPlayerEpisode.id ||
        (Number(ep.season || ep.seasonNumber || 1) === Number(currentPlayerEpisode.season || currentPlayerEpisode.seasonNumber || 1) &&
         Number(ep.episodeNumber || ep.episode || 1) === Number(currentPlayerEpisode.episodeNumber || currentPlayerEpisode.episode || 1))
      );
      if (cached) cached.progress = map[key];

      const nextEpisode = map[key] >= 98
        ? getEpisodeAfter(currentPlayerItem.id, currentPlayerEpisode)
        : getFirstUnfinishedEpisode();

      if (forceCompleted || !womoShouldDeferPlaybackUiWork()) {
        refreshCurrentPreviewEpisodes();
        setSeriesPreviewButtonForEpisode(nextEpisode);
      } else {
        womoContinueRefreshPending = true;
      }

      return;
    }

    // Movies / concerts
    if (progress >= 98) {
      markPlayableCompleted(currentPlayerItem);
      return;
    }

    setItemCompleted(currentPlayerItem, false);
    currentPlayerItem.completed = false;
    currentPlayerItem.progress = progress;
    upsertContinueItem(currentPlayerItem, progress);
    if (forceCompleted || !womoShouldDeferPlaybackUiWork()) {
      refreshContinueWatchingRow();
      setMovieConcertPreviewPlayableState(currentPlayerItem);
    } else {
      womoContinueRefreshPending = true;
    }
  } catch (error) {
    console.warn("No se pudo guardar el progreso.", error);
  }
}


function womoIsPlayerCurrentlyOpen() {
  const overlay = getWomoPlayerOverlay && getWomoPlayerOverlay();
  return Boolean(overlay && (overlay.classList.contains("open") || document.body.classList.contains("player-open")));
}

function womoIsRealVideoEnded(video) {
  if (!video) return false;
  const duration = Number(video.duration || 0);
  const current = Number(video.currentTime || 0);
  const openedAt = Number(window.__womoPlayerOpenedAt || 0);
  const elapsed = openedAt ? Date.now() - openedAt : 999999;

  // Some HLS/native players can emit a transient ended event shortly after playback starts.
  // Only treat it as a real ending when the playhead is actually at the end.
  if (!duration || !Number.isFinite(duration) || duration <= 0) return false;
  if (!current || !Number.isFinite(current) || current <= 0) return false;
  if (elapsed < 2500 && current < Math.max(8, duration - 2)) return false;

  const endTolerance = Math.max(2, Math.min(8, duration * 0.015));
  return current >= duration - endTolerance;
}

function bindWomoPlayerProgressEvents() {
  const video = getWomoPlayerVideo();
  if (!video || video.dataset.womoProgressBound === "true") return;

  video.dataset.womoProgressBound = "true";

  video.addEventListener("timeupdate", () => {
    if (typeof womoIsShuffleNoProgressPlayback === "function" && womoIsShuffleNoProgressPlayback()) return;
    saveActiveEpisodeProgress(false);
  });

  video.addEventListener("pause", () => {
    if (typeof womoIsShuffleNoProgressPlayback === "function" && womoIsShuffleNoProgressPlayback()) return;
    saveActiveEpisodeProgress(false);
  });

  video.addEventListener("ended", () => {
    if (!womoIsRealVideoEnded(video)) {
      console.warn("Womo ignoró un ended temprano del video.", { currentTime: video.currentTime, duration: video.duration });
      return;
    }
    if (typeof womoIsShuffleNoProgressPlayback === "function" && womoIsShuffleNoProgressPlayback()) {
      hideWomoPlayerOverlay();
      refreshCurrentPreviewEpisodes();
      return;
    }
    saveActiveEpisodeProgress(true);
    hideWomoPlayerOverlay();
    refreshCurrentPreviewEpisodes();
  });
}


/* Experimental .ts playback support */
let currentTsMediaSource = null;
let currentTsObjectUrl = null;
let currentTsAbortController = null;

function isTsVideoUrl(url = "") {
  try {
    const clean = String(url || "").split("?")[0].split("#")[0].toLowerCase();
    return clean.endsWith(".ts") || clean.includes(".ts/");
  } catch (_) {
    return false;
  }
}

function resetTsPlayback(video) {
  try {
    if (currentTsAbortController) currentTsAbortController.abort();
  } catch (_) {}

  currentTsAbortController = null;
  currentTsMediaSource = null;

  if (currentTsObjectUrl) {
    try { URL.revokeObjectURL(currentTsObjectUrl); } catch (_) {}
    currentTsObjectUrl = null;
  }

  if (video) {
    try { video.removeAttribute("src"); } catch (_) {}
  }
}

function loadMuxJsForTs() {
  return new Promise((resolve, reject) => {
    if (window.muxjs?.mp4?.Transmuxer) {
      resolve();
      return;
    }

    const existing = document.querySelector('script[data-womo-muxjs="true"]');
    if (existing) {
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener("error", reject, { once: true });
      return;
    }

    const script = document.createElement("script");
    script.src = "https://cdn.jsdelivr.net/npm/mux.js@7.0.0/dist/mux.min.js";
    script.async = true;
    script.dataset.womoMuxjs = "true";
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("No se pudo cargar mux.js"));
    document.head.appendChild(script);
  });
}

async function playTsWithMux(video, url) {
  if (!video || !url || !window.MediaSource) return false;

  await loadMuxJsForTs();
  resetTsPlayback(video);

  currentTsAbortController = new AbortController();

  const response = await fetch(url, {
    mode: "cors",
    signal: currentTsAbortController.signal
  });

  if (!response.ok) {
    throw new Error(`No se pudo descargar TS: ${response.status}`);
  }

  const buffer = await response.arrayBuffer();

  return await new Promise((resolve, reject) => {
    const mediaSource = new MediaSource();
    currentTsMediaSource = mediaSource;
    currentTsObjectUrl = URL.createObjectURL(mediaSource);
    video.src = currentTsObjectUrl;

    mediaSource.addEventListener("sourceopen", () => {
      try {
        const transmuxer = new muxjs.mp4.Transmuxer({ keepOriginalTimestamps: false });
        let sourceBuffer = null;
        let segmentReceived = false;

        transmuxer.on("data", segment => {
          segmentReceived = true;

          const initSegment = segment.initSegment;
          const data = segment.data;
          const combined = new Uint8Array(initSegment.byteLength + data.byteLength);
          combined.set(initSegment, 0);
          combined.set(data, initSegment.byteLength);

          const mime = 'video/mp4; codecs="' + segment.type + '"';

          if (!sourceBuffer) {
            if (!MediaSource.isTypeSupported(mime)) {
              throw new Error(`Codec no soportado por el navegador: ${mime}`);
            }
            sourceBuffer = mediaSource.addSourceBuffer(mime);
          }

          sourceBuffer.addEventListener("updateend", () => {
            try {
              if (mediaSource.readyState === "open") mediaSource.endOfStream();
            } catch (_) {}
            resolve(true);
          }, { once: true });

          sourceBuffer.appendBuffer(combined);
        });

        transmuxer.on("done", () => {
          if (!segmentReceived) {
            reject(new Error("El archivo TS no produjo segmentos reproducibles."));
          }
        });

        transmuxer.push(new Uint8Array(buffer));
        transmuxer.flush();
      } catch (error) {
        reject(error);
      }
    }, { once: true });

    mediaSource.addEventListener("error", () => {
      reject(new Error("MediaSource falló al reproducir el TS."));
    }, { once: true });
  });
}


/* TS seek guard: prevent native TS seeking from locking the player */
let womoCurrentPlaybackUrl = "";
let womoTsSeekTimer = null;
let womoTsLastSafeTime = 0;
let womoTsIsRecovering = false;

function womoIsCurrentTsPlayback() {
  return typeof isTsVideoUrl === "function" && isTsVideoUrl(womoCurrentPlaybackUrl);
}

function womoKeepPlayerClosable() {
  const overlay = document.getElementById("playerOverlay");
  if (!overlay) return;
  overlay.classList.add("controls-visible", "show-controls", "open");
  overlay.style.pointerEvents = "auto";
  const back = document.getElementById("playerBack")
    || document.getElementById("playerClose")
    || document.querySelector(".player-back")
    || document.querySelector(".player-close");
  if (back) {
    back.style.pointerEvents = "auto";
    back.style.zIndex = "99999";
  }
}

function womoClearTsSeekTimer() {
  if (womoTsSeekTimer) {
    clearTimeout(womoTsSeekTimer);
    womoTsSeekTimer = null;
  }
}

function womoRecoverFrozenTsSeek(video) {
  if (!video || !womoIsCurrentTsPlayback() || womoTsIsRecovering) return;
  womoTsIsRecovering = true;
  womoKeepPlayerClosable();

  try { video.pause(); } catch (_) {}

  const url = womoCurrentPlaybackUrl;
  const fallbackTime = Math.max(0, Number(womoTsLastSafeTime || 0));

  try {
    video.removeAttribute("src");
    video.load();
  } catch (_) {}

  setTimeout(() => {
    try {
      video.src = url;
      video.setAttribute("type", "video/mp2t");
      video.load();

      video.onloadedmetadata = () => {
        try {
          if (fallbackTime > 0 && Number.isFinite(video.duration) && fallbackTime < video.duration - 2) {
            video.currentTime = fallbackTime;
          }
        } catch (_) {}
        video.play().catch(() => {});
        womoTsIsRecovering = false;
      };
    } catch (_) {
      womoTsIsRecovering = false;
    }
  }, 80);
}

function bindTsSeekGuard(video) {
  if (!video || video.dataset.womoTsSeekGuard === "true") return;
  video.dataset.womoTsSeekGuard = "true";

  video.addEventListener("timeupdate", () => {
    if (!womoIsCurrentTsPlayback()) return;
    if (!video.seeking && !video.paused && Number.isFinite(video.currentTime)) {
      womoTsLastSafeTime = video.currentTime;
    }
  });

  video.addEventListener("seeking", () => {
    if (!womoIsCurrentTsPlayback()) return;
    womoKeepPlayerClosable();
    womoClearTsSeekTimer();
    womoTsSeekTimer = setTimeout(() => {
      if (video.seeking || video.readyState < 2) {
        console.warn("TS seek parece congelado. Recuperando reproducción.");
        womoRecoverFrozenTsSeek(video);
      }
    }, 3500);
  });

  ["seeked", "playing", "canplay", "canplaythrough"].forEach(eventName => {
    video.addEventListener(eventName, () => {
      if (!womoIsCurrentTsPlayback()) return;
      womoClearTsSeekTimer();
      womoTsIsRecovering = false;
      womoKeepPlayerClosable();
    });
  });

  ["waiting", "stalled", "suspend"].forEach(eventName => {
    video.addEventListener(eventName, () => {
      if (!womoIsCurrentTsPlayback()) return;
      womoKeepPlayerClosable();
      womoClearTsSeekTimer();
      womoTsSeekTimer = setTimeout(() => {
        if (video.readyState < 2) {
          console.warn("TS playback quedó en espera. Recuperando.");
          womoRecoverFrozenTsSeek(video);
        }
      }, 4500);
    });
  });
}


/* Mobile native fullscreen on play */
function womoIsMobileViewport() {
  try {
    return window.matchMedia("(max-width: 760px), (pointer: coarse)").matches;
  } catch (_) {
    return window.innerWidth <= 760;
  }
}


/* Mobile landscape orientation helper */
async function womoLockMobileLandscape() {
  if (!womoIsMobileViewport()) return;

  try {
    if (screen.orientation && typeof screen.orientation.lock === "function") {
      await screen.orientation.lock("landscape");
    }
  } catch (error) {
    console.warn("El navegador no permitió bloquear orientación horizontal.", error);
  }
}

function womoUnlockMobileOrientation() {
  try {
    if (screen.orientation && typeof screen.orientation.unlock === "function") {
      screen.orientation.unlock();
    }
  } catch (_) {}
}

function womoPrepareVideoForLandscape(video) {
  if (!video) return;
  try {
    video.style.objectFit = "contain";
    video.style.backgroundColor = "#000";
  } catch (_) {}
}

function womoTryMobileNativeFullscreen(video) {
  if (!video || !womoIsMobileViewport()) return;

  // Avoid looping fullscreen requests for the same playback open.
  if (video.dataset.womoTriedMobileFullscreen === "true") return;
  video.dataset.womoTriedMobileFullscreen = "true";

  womoPrepareVideoForLandscape(video);

  // Best effort: Android/Chrome can usually honor this. iOS Safari may ignore it.
  womoLockMobileLandscape();

  try {
    // iPhone/iPad Safari video-native fullscreen.
    if (typeof video.webkitEnterFullscreen === "function") {
      video.webkitEnterFullscreen();
      setTimeout(womoLockMobileLandscape, 120);
      setTimeout(womoLockMobileLandscape, 520);
      return;
    }

    // Modern mobile browsers: fullscreen the whole player so custom controls
    // such as the audio-language selector remain visible.
    const fullscreenTarget = video.closest("#playerOverlay") || video;
    if (typeof fullscreenTarget.requestFullscreen === "function") {
      fullscreenTarget.requestFullscreen()
        .then(() => womoLockMobileLandscape())
        // If metadata is not ready yet, let the later media hooks try again.
        .catch(() => womoResetMobileFullscreenAttempt(video));
      setTimeout(womoLockMobileLandscape, 120);
      return;
    }

    if (typeof fullscreenTarget.webkitRequestFullscreen === "function") {
      fullscreenTarget.webkitRequestFullscreen();
      setTimeout(womoLockMobileLandscape, 120);
    }
  } catch (error) {
    womoResetMobileFullscreenAttempt(video);
    console.warn("No se pudo activar fullscreen móvil automático.", error);
  }
}

function womoResetMobileFullscreenAttempt(video) {
  if (!video) return;
  try { delete video.dataset.womoTriedMobileFullscreen; } catch (_) {
    try { video.removeAttribute("data-womo-tried-mobile-fullscreen"); } catch (__) {}
  }
}


function womoBindMobileFullscreenLandscapeEvents(video) {
  if (!video || video.dataset.womoLandscapeEventsBound === "true") return;
  video.dataset.womoLandscapeEventsBound = "true";

  video.addEventListener("webkitbeginfullscreen", function() {
    womoPrepareVideoForLandscape(video);
    womoLockMobileLandscape();
    setTimeout(womoLockMobileLandscape, 300);
  });

  video.addEventListener("webkitendfullscreen", function() {
    womoUnlockMobileOrientation();
  });

  document.addEventListener("fullscreenchange", function() {
    if (document.fullscreenElement) {
      womoLockMobileLandscape();
    } else {
      womoUnlockMobileOrientation();
    }
  });
}

function womoBindMobileNativeFullscreen(video) {
  womoBindMobileFullscreenLandscapeEvents(video);
  if (!video || video.dataset.womoMobileFullscreenBound === "true") return;
  video.dataset.womoMobileFullscreenBound = "true";

  // If browser requires a user gesture, the first tap/play event is the best moment.
  video.addEventListener("play", function() {
    womoTryMobileNativeFullscreen(video);
  }, { passive: true });

  video.addEventListener("click", function() {
    womoTryMobileNativeFullscreen(video);
  }, { passive: true });

  video.addEventListener("touchend", function() {
    womoTryMobileNativeFullscreen(video);
  }, { passive: true });
}




/* Universal Shuffle early skip overlay */
let womoShuffleSkipTimer = null;
let womoShuffleSkipSeconds = 10;
let womoShuffleSkipShownKey = "";
let womoShuffleSkipSwitching = false;

function womoIsUniversalShufflePlaybackActive() {
  return womoIsShufflePlaybackActive() && (womoShuffleSessionScope === "universal" || womoShuffleSessionScope === "series");
}

function womoClearShuffleSkipTimer() {
  if (womoShuffleSkipTimer) {
    clearInterval(womoShuffleSkipTimer);
    womoShuffleSkipTimer = null;
  }
}

function womoHideShuffleSkipOverlay() {
  womoClearShuffleSkipTimer();
  const overlay = document.getElementById("womoShuffleSkipOverlay");
  if (overlay) {
    overlay.classList.remove("womo-shuffle-fade-out");
    overlay.classList.add("hidden");
    overlay.style.display = "none";
  }
  womoShuffleSkipSwitching = false;
}

function womoEnsureShuffleSkipOverlay() {
  const playerOverlay = document.getElementById("playerOverlay") || document.querySelector(".player-overlay");
  if (!playerOverlay) return null;

  let overlay = document.getElementById("womoShuffleSkipOverlay");
  if (overlay) return overlay;

  overlay = document.createElement("div");
  overlay.id = "womoShuffleSkipOverlay";
  overlay.className = "womo-auto-next-overlay hidden womo-shuffle-skip-overlay";
  overlay.innerHTML = ''
    + '<button type="button" id="womoShuffleSkipPlay" class="womo-shuffle-simple-button"><span>Siguiente</span><i data-lucide="shuffle"></i></button>';

  playerOverlay.appendChild(overlay);

  const playBtn = overlay.querySelector("#womoShuffleSkipPlay");
  const cancelBtn = overlay.querySelector("#womoShuffleSkipCancel");

  if (playBtn) {
    const triggerShuffleSkip = function(event) {
      if (event) {
        event.preventDefault();
        event.stopPropagation();
        if (event.stopImmediatePropagation) event.stopImmediatePropagation();
      }
      womoPlayUniversalShuffleSkip();
    };
    playBtn.addEventListener("pointerdown", triggerShuffleSkip, { passive:false });
    playBtn.addEventListener("touchstart", triggerShuffleSkip, { passive:false });
    playBtn.addEventListener("click", triggerShuffleSkip);
  }

  if (cancelBtn) {
    cancelBtn.addEventListener("click", function(event) {
      event.preventDefault();
      event.stopPropagation();
      if (event.stopImmediatePropagation) event.stopImmediatePropagation();
      womoShuffleSkipShownKey = womoShuffleCurrentPlaybackKey();
      womoHideShuffleSkipOverlay();
    });
  }

  return overlay;
}


(function womoInstallShuffleSkipDelegatedTapFix(){
  if (window.__womoShuffleSkipDelegatedTapFix) return;
  window.__womoShuffleSkipDelegatedTapFix = true;
  ["pointerdown", "touchstart", "click"].forEach(function(type){
    document.addEventListener(type, function(event){
      const target = event.target && event.target.closest ? event.target.closest("#womoShuffleSkipPlay") : null;
      if (!target) return;
      event.preventDefault();
      event.stopPropagation();
      if (event.stopImmediatePropagation) event.stopImmediatePropagation();
      if (typeof womoPlayUniversalShuffleSkip === "function") womoPlayUniversalShuffleSkip();
    }, { passive:false, capture:true });
  });
})();

function womoUpdateShuffleSkipButtonText() {
  const playBtn = document.getElementById("womoShuffleSkipPlay");
  if (playBtn && !playBtn.querySelector("span")) {
    playBtn.innerHTML = '<span>Siguiente</span><i data-lucide="shuffle"></i>';
    if (window.lucide) lucide.createIcons();
  }
}

function womoStartShuffleSkipButtonFill() {
  const playBtn = document.getElementById("womoShuffleSkipPlay");
  if (playBtn) {
    playBtn.classList.remove("womo-next-progressing");
    playBtn.innerHTML = '<span>Siguiente</span><i data-lucide="shuffle"></i>';
    if (window.lucide) lucide.createIcons();
  }
}

async function womoPlayUniversalShuffleSkip() {
  if (womoShuffleSkipSwitching) return;
  if (!womoIsUniversalShufflePlaybackActive()) return;

  womoShuffleSkipSwitching = true;
  womoHideShuffleSkipOverlay();
  womoHideShuffleNextOverlay();

  const result = await womoPickRandomShuffleEpisode();

  if (!result) {
    console.warn("No se encontró otro episodio para Shuffle.");
    womoShuffleSkipSwitching = false;
    return;
  }

  const { seriesItem, episode } = result;

  try {
    womoMarkShuffleEpisodeSeen(seriesItem, episode);
    if (typeof openPlayer === "function") {
      openPlayer(seriesItem, {
        episode,
        startAt: 0,
        saveProgress: false,
        shuffleMode: true,
        fromShuffle: true,
        noProgress: true,
        shuffleScope: womoShuffleSessionScope || "universal",
        shuffleSeriesId: womoShuffleSessionSeriesId || ""
      });
    }
  } finally {
    setTimeout(function() {
      womoShuffleSkipSwitching = false;
    }, 400);
  }
}

function womoShowShuffleSkipOverlay() {
  if (!womoIsUniversalShufflePlaybackActive()) return;

  const currentKey = womoShuffleCurrentPlaybackKey();
  if (currentKey && womoShuffleSkipShownKey === currentKey) return;

  const overlay = womoEnsureShuffleSkipOverlay();
  if (!overlay) return;

  womoShuffleSkipSeconds = 10;
  womoShuffleSkipShownKey = currentKey;

  overlay.classList.remove("hidden");
  overlay.classList.remove("womo-shuffle-fade-out");
  overlay.style.display = "";
  void overlay.offsetWidth;
  overlay.classList.add("womo-shuffle-fade-out");

  womoStartShuffleSkipButtonFill();

  womoClearShuffleSkipTimer();
  womoShuffleSkipTimer = setInterval(function() {
    womoShuffleSkipSeconds -= 1;
    womoUpdateShuffleSkipButtonText();

    if (womoShuffleSkipSeconds <= 0) {
      womoHideShuffleSkipOverlay();
    }
  }, 1000);
}

function womoMaybeShowShuffleSkipOverlay() {
  if (!womoIsUniversalShufflePlaybackActive()) {
    womoHideShuffleSkipOverlay();
    return;
  }

  const video = document.getElementById("womoPlayer") || document.querySelector("#playerOverlay video") || document.querySelector(".player-overlay video");
  if (!video || !video.duration || !Number.isFinite(video.duration) || video.duration <= 0) return;

  const currentKey = womoShuffleCurrentPlaybackKey();
  if (currentKey && womoShuffleSkipShownKey === currentKey) return;

  const nextOverlay = document.getElementById("womoShuffleNextOverlay");
  const nextActive = nextOverlay && !nextOverlay.classList.contains("hidden") && nextOverlay.style.display !== "none";
  if (nextActive) return;

  const skipOverlay = document.getElementById("womoShuffleSkipOverlay");
  const skipActive = skipOverlay && !skipOverlay.classList.contains("hidden") && skipOverlay.style.display !== "none";
  if (skipActive || womoShuffleSkipSwitching) return;

  // Show it 3 seconds after the episode starts.
  if (video.currentTime >= 3 && video.currentTime <= 13) {
    womoShowShuffleSkipOverlay();
  }
}

function womoBindShuffleSkipVideo() {
  const video = document.getElementById("womoPlayer") || document.querySelector("#playerOverlay video") || document.querySelector(".player-overlay video");
  if (!video || video.dataset.womoShuffleSkipBound === "true") return;

  video.dataset.womoShuffleSkipBound = "true";

  video.addEventListener("timeupdate", function() {
    womoMaybeShowShuffleSkipOverlay();
  });

  video.addEventListener("seeking", function() {
    womoHideShuffleSkipOverlay();
  });

  video.addEventListener("ended", function() {
    womoHideShuffleSkipOverlay();
  });
}

/* Shuffle sessions and scope */
let womoShuffleSessionId = "";
let womoShuffleSessionScope = "universal"; // "universal" | "series"
let womoShuffleSessionSeriesId = "";
let womoShuffleSessionSeen = new Set();

function womoEpisodeSessionKey(seriesItem, episode) {
  if (!seriesItem || !episode) return "";
  const season = Number(episode.season || episode.seasonNumber || 1);
  const number = Number(episode.episodeNumber || episode.episode || episode.number || episode.ep || 1);
  return [
    seriesItem.id || "",
    "S" + season,
    "E" + number,
    episode.id || ""
  ].join(":");
}

function womoStartShuffleSession(scope = "universal", seriesId = "") {
  womoShuffleSessionId = String(Date.now()) + ":" + Math.random().toString(36).slice(2);
  womoShuffleSessionScope = scope === "series" ? "series" : "universal";
  womoShuffleSessionSeriesId = seriesId || "";
  womoShuffleSessionSeen = new Set();
  womoShuffleSkipShownKey = "";
}

function womoEnsureShuffleSession(options = {}, item = null, episode = null) {
  const explicitScope = options.shuffleScope || options.scope || "";
  const isLocal = explicitScope === "series" || options.localShuffle === true || options.seriesShuffle === true;
  const scope = isLocal ? "series" : "universal";
  const seriesId = scope === "series" ? (options.shuffleSeriesId || item?.id || "") : "";

  if (!womoShuffleSessionId || womoShuffleSessionScope !== scope || (scope === "series" && womoShuffleSessionSeriesId !== seriesId)) {
    womoStartShuffleSession(scope, seriesId);
  }

  if (item && episode) {
    const key = womoEpisodeSessionKey(item, episode);
    if (key) womoShuffleSessionSeen.add(key);
  }
}

function womoMarkShuffleEpisodeSeen(seriesItem, episode) {
  const key = womoEpisodeSessionKey(seriesItem, episode);
  if (key) womoShuffleSessionSeen.add(key);
}

function womoIsShuffleEpisodeSeen(seriesItem, episode) {
  const key = womoEpisodeSessionKey(seriesItem, episode);
  return Boolean(key && womoShuffleSessionSeen.has(key));
}

function womoResetShuffleSession() {
  womoShuffleSessionId = "";
  womoShuffleSessionScope = "universal";
  womoShuffleSessionSeriesId = "";
  womoShuffleSessionSeen = new Set();
}

function womoDetectLocalShuffleClick(event) {
  const target = event.target && event.target.closest ? event.target.closest("button, [role='button'], .shuffle-play-btn, .shuffle-btn") : null;
  if (!target) return;

  const text = (target.textContent || "").toLowerCase();
  const id = (target.id || "").toLowerCase();
  const cls = (target.className || "").toString().toLowerCase();

  if (!text.includes("shuffle") && !id.includes("shuffle") && !cls.includes("shuffle")) return;

  const preview = target.closest(".preview-modal, #previewModal, .preview, .content-preview, .details-modal, #detailsModal");
  const searchPage = target.closest("#searchPage");

  if ((preview && !searchPage) || (typeof currentPreviewItem !== "undefined" && currentPreviewItem && currentPreviewItem.type === "series" && !searchPage)) {
    window.__womoNextShuffleScope = "series";
  } else {
    window.__womoNextShuffleScope = "universal";
  }
}

/* Shuffle auto-next episode */
let womoShuffleNextTimer = null;
let womoShuffleNextSeconds = 15;
let womoShuffleNextSwitching = false;
let womoShuffleNextPendingResult = null;
let womoShuffleNextPicking = false;
let womoShuffleNextDismissedKey = "";


function womoShuffleCurrentPlaybackKey() {
  try {
    if (!currentPlayerItem || !currentPlayerEpisode) return "";
    return [
      currentPlayerItem.id || "",
      "S" + Number(currentPlayerEpisode.season || 1),
      "E" + Number(currentPlayerEpisode.episodeNumber || currentPlayerEpisode.episode || currentPlayerEpisode.number || 1),
      currentPlayerEpisode.id || ""
    ].join(":");
  } catch (_) {
    return "";
  }
}

function womoIsShufflePlaybackActive() {
  try {
    const contextLooksLikeShuffle = Boolean(
      currentPlayerContext?.shuffleMode ||
      currentPlayerContext?.fromShuffle ||
      currentPlayerContext?.noProgress ||
      currentPlayerContext?.saveProgress === false
    );

    // Shuffle overlays only make sense for episode playback.
    // If a stale global flag survived from a previous shuffle session, this prevents it from affecting movies/concerts.
    if (!currentPlayerEpisode) return false;

    return Boolean(contextLooksLikeShuffle);
  } catch (_) {
    return false;
  }
}

function womoClearShuffleNextTimer() {
  if (womoShuffleNextTimer) {
    clearInterval(womoShuffleNextTimer);
    womoShuffleNextTimer = null;
  }
}

function womoHideShuffleNextOverlay() {
  womoClearShuffleNextTimer();
  const overlay = document.getElementById("womoShuffleNextOverlay");
  if (overlay) {
    overlay.classList.add("hidden");
    overlay.style.display = "none";
  }
  womoShuffleNextSwitching = false;
  womoShuffleNextPendingResult = null;
}

function womoEnsureShuffleNextOverlay() {
  const playerOverlay = document.getElementById("playerOverlay") || document.querySelector(".player-overlay");
  if (!playerOverlay) return null;

  let overlay = document.getElementById("womoShuffleNextOverlay");
  if (overlay) return overlay;

  overlay = document.createElement("div");
  overlay.id = "womoShuffleNextOverlay";
  overlay.className = "womo-auto-next-overlay hidden womo-shuffle-next-overlay";
  overlay.innerHTML = ''
    + '<div class="womo-auto-next-text">'
    + '  <div class="womo-auto-next-kicker">A continuación</div>'
    + '  <div class="womo-auto-next-title" id="womoShuffleNextTitle">Serie</div>'
    + '  <div class="womo-auto-next-count" id="womoShuffleNextMeta">T1 E1</div>'
    + '</div>'
    + '<div class="womo-auto-next-actions">'
    + '  <button type="button" id="womoShuffleNextPlay">Siguiente en 15s</button>'
    + '  <button type="button" id="womoShuffleNextCancel">Cancelar</button>'
    + '</div>';

  playerOverlay.appendChild(overlay);

  const playBtn = overlay.querySelector("#womoShuffleNextPlay");
  const cancelBtn = overlay.querySelector("#womoShuffleNextCancel");

  if (playBtn) {
    playBtn.addEventListener("click", function(event) {
      event.preventDefault();
      event.stopPropagation();
      womoPlayNextShuffleEpisode();
    });
  }

  if (cancelBtn) {
    cancelBtn.addEventListener("click", function(event) {
      event.preventDefault();
      event.stopPropagation();
      if (event.stopImmediatePropagation) event.stopImmediatePropagation();
      womoShuffleNextDismissedKey = womoShuffleCurrentPlaybackKey();
      womoHideShuffleNextOverlay();
    });
  }

  return overlay;
}

function womoUpdateShuffleNextButtonText() {
  const playBtn = document.getElementById("womoShuffleNextPlay");
  if (!playBtn) return;
  playBtn.textContent = "Siguiente en " + Math.max(0, Number(womoShuffleNextSeconds || 0)) + "s";
}

function womoStartShuffleNextButtonFill() {
  const playBtn = document.getElementById("womoShuffleNextPlay");
  if (!playBtn) return;
  playBtn.classList.remove("womo-next-progressing");
  playBtn.style.setProperty("--womo-next-duration", "15s");
  void playBtn.offsetWidth;
  playBtn.classList.add("womo-next-progressing");
  womoUpdateShuffleNextButtonText();
}

async function womoReadShuffleEpisodesFromSeries(seriesItem) {
  if (!seriesItem) return [];

  try {
    if (typeof readSeriesEpisodes === "function") {
      const episodes = await readSeriesEpisodes(seriesItem.id);
      if (Array.isArray(episodes)) return episodes;
    }
  } catch (error) {
    console.warn("No se pudieron leer episodios shuffle para", seriesItem?.title || seriesItem?.id, error);
  }

  if (Array.isArray(seriesItem.episodes)) return seriesItem.episodes;

  return [];
}

function womoShufflePickRandom(list) {
  if (!Array.isArray(list) || !list.length) return null;
  return list[Math.floor(Math.random() * list.length)];
}

async function womoPickRandomShuffleEpisode() {
  const allItems = Array.from(
    (typeof allItemsByContinueKey !== "undefined" && allItemsByContinueKey?.values)
      ? allItemsByContinueKey.values()
      : []
  );

  let seriesList = allItems.filter(item => item && item.type === "series");

  if (!seriesList.length && typeof items !== "undefined" && Array.isArray(items)) {
    seriesList = items.filter(item => item && item.type === "series");
  }

  if (!seriesList.length && typeof contentItems !== "undefined" && Array.isArray(contentItems)) {
    seriesList = contentItems.filter(item => item && item.type === "series");
  }

  if (!seriesList.length) return null;

  if (!womoShuffleSessionId) {
    const scope = currentPlayerItem && currentPlayerItem.type === "series" ? "series" : "universal";
    womoStartShuffleSession(scope, scope === "series" ? currentPlayerItem.id : "");
  }

  if (womoShuffleSessionScope === "series") {
    const seriesId = womoShuffleSessionSeriesId || currentPlayerItem?.id || "";
    seriesList = seriesList.filter(item => item.id === seriesId);

    // If the series isn't in the loaded list, fall back to currentPlayerItem.
    if (!seriesList.length && currentPlayerItem && currentPlayerItem.type === "series") {
      seriesList = [currentPlayerItem];
    }
  } else {
    // Universal shuffle intentionally uses all available series.
    seriesList = seriesList.slice().sort(() => Math.random() - 0.5);
  }

  const candidatePool = [];

  for (const seriesItem of seriesList) {
    const episodes = await womoReadShuffleEpisodesFromSeries(seriesItem);
    const playableEpisodes = (episodes || []).filter(ep => {
      const url = ep?.hlsUrl || ep?.videoUrl || ep?.url || ep?.src || ep?.streamUrl || ep?.m3u8 || ep?.file || ep?.link || "";
      return Boolean(url);
    });

    playableEpisodes.forEach(ep => {
      candidatePool.push({ seriesItem, episode: ep });
    });
  }

  if (!candidatePool.length) return null;

  let unseen = candidatePool.filter(entry => !womoIsShuffleEpisodeSeen(entry.seriesItem, entry.episode));

  // If the session exhausted every episode, start a fresh session for the same scope.
  if (!unseen.length) {
    const scope = womoShuffleSessionScope;
    const seriesId = womoShuffleSessionSeriesId;
    womoStartShuffleSession(scope, seriesId);
    unseen = candidatePool.slice();
  }

  const result = womoShufflePickRandom(unseen);
  if (result) womoMarkShuffleEpisodeSeen(result.seriesItem, result.episode);

  return result || null;
}

async function womoPlayNextShuffleEpisode() {
  if (womoShuffleNextSwitching) return;
  womoShuffleNextSwitching = true;

  womoClearShuffleNextTimer();

  const overlay = document.getElementById("womoShuffleNextOverlay");
  if (overlay) {
    overlay.classList.add("hidden");
    overlay.style.display = "none";
  }

  const result = womoShuffleNextPendingResult || await womoPickRandomShuffleEpisode();
  womoShuffleNextPendingResult = null;

  if (!result) {
    console.warn("No se encontró otro episodio para Shuffle.");
    womoShuffleNextSwitching = false;
    return;
  }

  const { seriesItem, episode } = result;
  womoShuffleNextDismissedKey = "";

  try {
    if (typeof openPlayer === "function") {
      openPlayer(seriesItem, {
        episode,
        startAt: 0,
        saveProgress: false,
        shuffleMode: true,
        fromShuffle: true,
        noProgress: true,
        shuffleScope: womoShuffleSessionScope || window.__womoNextShuffleScope || "universal",
        shuffleSeriesId: womoShuffleSessionSeriesId || ""
      });
    }
  } finally {
    setTimeout(function() {
      womoShuffleNextSwitching = false;
    }, 400);
  }
}

async function womoShowShuffleNextOverlay() {
  womoHideShuffleSkipOverlay();
  if (!womoIsShufflePlaybackActive()) return;

  const overlay = womoEnsureShuffleNextOverlay();
  if (!overlay) return;

  // Pick the next random episode before showing the overlay so we can show its info.
  const result = await womoPickRandomShuffleEpisode();
  if (!result) return;

  womoShuffleNextPendingResult = result;
  womoShuffleNextSeconds = 15;

  const title = overlay.querySelector("#womoShuffleNextTitle");
  const meta = overlay.querySelector("#womoShuffleNextMeta");

  const seriesName = result.seriesItem?.title || result.seriesItem?.name || "Serie";
  const ep = result.episode || {};
  const episodeName = ep.title || ep.name || "";
  const episodeLabel = "T" + (ep.season || 1) + " E" + (ep.episodeNumber || ep.episode || ep.number || 1);

  if (title) title.textContent = seriesName;
  if (meta) meta.textContent = episodeName ? womoEllipsisText(episodeLabel + " - " + episodeName, 32) : episodeLabel;

  overlay.classList.remove("hidden");
  overlay.style.display = "";

  womoStartShuffleNextButtonFill();

  womoClearShuffleNextTimer();
  womoShuffleNextTimer = setInterval(function() {
    womoShuffleNextSeconds -= 1;
    womoUpdateShuffleNextButtonText();

    if (womoShuffleNextSeconds <= 0) {
      womoClearShuffleNextTimer();
      const playBtn = document.getElementById("womoShuffleNextPlay");
      if (playBtn) playBtn.click();
      else womoPlayNextShuffleEpisode();
    }
  }, 1000);
}

function womoMaybeShowShuffleNextOverlay() {
  if (!womoIsShufflePlaybackActive()) {
    womoHideShuffleNextOverlay();
    return;
  }

  const video = document.getElementById("womoPlayer") || document.querySelector("#playerOverlay video") || document.querySelector(".player-overlay video");
  if (!video || !video.duration || !Number.isFinite(video.duration) || video.duration <= 0) return;

  const currentKey = womoShuffleCurrentPlaybackKey();
  if (currentKey && womoShuffleNextDismissedKey === currentKey) return;

  const remaining = video.duration - video.currentTime;
  const overlay = document.getElementById("womoShuffleNextOverlay");
  const isActive = overlay && !overlay.classList.contains("hidden") && overlay.style.display !== "none";

  // Same safe margin as normal auto-next: appears with 17s left and timer is 15s.
  if (remaining <= 17 && remaining >= 0 && !isActive && !womoShuffleNextSwitching && !womoShuffleNextPicking) {
    womoShuffleNextPicking = true;
    womoShowShuffleNextOverlay().finally(function() {
      womoShuffleNextPicking = false;
    });
  }
}

function womoBindShuffleNextVideo() {
  const video = document.getElementById("womoPlayer") || document.querySelector("#playerOverlay video") || document.querySelector(".player-overlay video");
  if (!video || video.dataset.womoShuffleNextBound === "true") return;

  video.dataset.womoShuffleNextBound = "true";

  video.addEventListener("timeupdate", function() {
    womoMaybeShowShuffleNextOverlay();
  });

  video.addEventListener("seeking", function() {
    womoHideShuffleNextOverlay();
  });

  video.addEventListener("ended", function(event) {
    const currentKey = womoShuffleCurrentPlaybackKey();
    if (currentKey && womoShuffleNextDismissedKey === currentKey) {
      womoHideShuffleNextOverlay();
      return;
    }

    const overlay = document.getElementById("womoShuffleNextOverlay");
    const isActive = overlay && !overlay.classList.contains("hidden") && overlay.style.display !== "none";

    if (womoIsShufflePlaybackActive() && isActive) {
      event.preventDefault();
      event.stopPropagation();
      if (event.stopImmediatePropagation) event.stopImmediatePropagation();
      const playBtn = document.getElementById("womoShuffleNextPlay");
      if (playBtn) playBtn.click();
      else womoPlayNextShuffleEpisode();
    }
  }, true);
}


/* Shuffle button icon polish */
function womoDecorateShuffleButtons() {
  const buttons = Array.from(document.querySelectorAll("button, [role='button'], .shuffle-btn, .shuffle-play-btn"));

  buttons.forEach(btn => {
    if (!btn) return;

    const btnId = (btn.id || "").toLowerCase();
    const btnClass = (btn.className || "").toString().toLowerCase();
    const text = (btn.textContent || "").trim();

    // Never touch internal player/auto-next/skip overlay buttons.
    if (
      btn.closest("#playerOverlay") ||
      btn.closest(".player-overlay") ||
      btnId.startsWith("womoshuffle") ||
      btnId.startsWith("womoautonext") ||
      btnId.includes("cancel") ||
      btnId.includes("skip") ||
      btnId.includes("nextplay") ||
      text.toLowerCase() === "cancelar" ||
      text.toLowerCase() === "quedarse" ||
      text.toLowerCase() === "siguiente"
    ) {
      return;
    }

    const plainText = text.toLowerCase();
    const looksLikeShuffle =
      plainText === "shuffle" ||
      plainText === "shuffle" ||
      btnClass.includes("shuffle-btn") ||
      btnClass.includes("shuffle-play-btn") ||
      (btnId.includes("shuffle") && !btnId.includes("cancel") && !btnId.includes("skip") && !btnId.includes("next"));

    if (!looksLikeShuffle) return;

    const searchPage = btn.closest("#searchPage, .search-page, [data-page='search']");
    const preview = btn.closest(".preview-modal, #previewModal, .preview, .content-preview, .details-modal, #detailsModal");

    // Universal launcher usually lives in Search. Local launcher lives inside a series preview.
    const isLocalShuffle = Boolean(preview && !searchPage);
    const label = isLocalShuffle ? "Shuffle" : "SHUFFLE";

    if (btn.dataset.womoShuffleIconDecorated === "true" && btn.querySelector(".womo-shuffle-btn-icon")) {
      const labelEl = btn.querySelector(".womo-shuffle-btn-label");
      if (labelEl) labelEl.textContent = label;
      return;
    }

    btn.dataset.womoShuffleIconDecorated = "true";
    btn.innerHTML = '<span class="womo-shuffle-btn-label">' + label + '</span><i data-lucide="shuffle" class="womo-shuffle-btn-icon"></i>';

    if (window.lucide) {
      try { lucide.createIcons(); } catch (_) {}
    }
  });
}

(function(){
  if (window.__womoShuffleIconDecoratorBound) return;
  window.__womoShuffleIconDecoratorBound = true;

  document.addEventListener("DOMContentLoaded", function() {
    setTimeout(womoDecorateShuffleButtons, 80);
    setTimeout(womoDecorateShuffleButtons, 400);
  });

  document.addEventListener("click", function() {
    setTimeout(womoDecorateShuffleButtons, 80);
    setTimeout(womoDecorateShuffleButtons, 350);
  }, true);

  const observer = new MutationObserver(function() {
    clearTimeout(window.__womoShuffleIconDecorateTimer);
    window.__womoShuffleIconDecorateTimer = setTimeout(womoDecorateShuffleButtons, 80);
  });

  try {
    observer.observe(document.documentElement, { childList:true, subtree:true });
  } catch (_) {}
})();

function openPlayer(item, options = {}) {
  window.__womoPlayerOpenedAt = Date.now();
  womoResetAudioSelector();
  currentPlayerItem = item;
  currentPlayerEpisode = options?.episode || null;
  if (options && (options.shuffleMode || options.fromShuffle || options.noProgress || options.saveProgress === false)) {
    if (!options.shuffleScope) {
      options.shuffleScope = window.__womoNextShuffleScope || "universal";
    }
    if (options.shuffleScope === "series" && !options.shuffleSeriesId) {
      options.shuffleSeriesId = item?.id || "";
    }
    womoEnsureShuffleSession(options, item, options?.episode || null);
    window.__womoNextShuffleScope = "";
  }
  setTimeout(bindWomoPlayerProgressEvents, 0);
  const episode = options.episode || null;
  const url = getPlayableUrl(item, episode);
  womoCurrentPlaybackUrl = url;

  if (!url) {
    alert("Este título todavía no tiene video configurado.");
    return;
  }

  const overlay = document.getElementById('playerOverlay');
  const video = document.getElementById('womoPlayer');
  document.body.classList.add('player-open');
  overlay.classList.add('is-video-loading');
  womoResetMobileFullscreenAttempt(video);
  womoBindMobileNativeFullscreen(video);
  bindTsSeekGuard(video);
  video.setAttribute('controlsList', 'nodownload noplaybackrate');
  video.disablePictureInPicture = true;
  const title = document.getElementById('playerTitle');
  const subtitle = document.getElementById('playerSubtitle');

  const setPlayerLoading = (loading, reason = "direct") => {
    if (typeof window.womoSetSmartPlayerLoading === "function") {
      window.womoSetSmartPlayerLoading(Boolean(loading), reason);
      return;
    }
    if (overlay) overlay.classList.toggle('is-video-loading', Boolean(loading));
  };
  video.onwaiting = () => setPlayerLoading(true, "waiting");
  video.onloadstart = () => setPlayerLoading(true, "loadstart");
  video.onstalled = () => setPlayerLoading(true, "stalled");
  video.oncanplay = () => setPlayerLoading(false, "canplay");
  video.onplaying = () => setPlayerLoading(false, "playing");

  video.onerror = () => {
    console.warn("Womo video playback error detail", {
      url,
      isTs: isTsVideoUrl(url),
      error: video.error
    });
  };

  const isShufflePlayback = Boolean(options.shuffleMode || options.fromShuffle || options.noProgress || options.saveProgress === false);

  currentPlayerContext = {
    item,
    episode,
    saveProgress: options.saveProgress !== false,
    shuffleMode: Boolean(options.shuffleMode),
    fromShuffle: Boolean(options.fromShuffle),
    noProgress: Boolean(options.noProgress)
  };

  try {
    if (overlay) overlay.dataset.shuffleNoProgress = isShufflePlayback ? "true" : "false";

    if (isShufflePlayback) {
      if (typeof womoSetShuffleNoProgress === "function") womoSetShuffleNoProgress(true);
    } else {
      // Hard reset any previous shuffle state before normal playback.
      // This prevents the early "Siguiente" shuffle button from leaking into movies/concerts.
      if (typeof womoSetShuffleNoProgress === "function") womoSetShuffleNoProgress(false);
      if (typeof womoHideShuffleSkipOverlay === "function") womoHideShuffleSkipOverlay();
      if (typeof womoHideShuffleNextOverlay === "function") womoHideShuffleNextOverlay();
      if (typeof womoResetShuffleSession === "function") womoResetShuffleSession();
      womoShuffleSkipShownKey = "";
      womoShuffleNextDismissedKey = "";
      womoShuffleNextPendingResult = null;
      womoShuffleSkipSwitching = false;
      womoShuffleNextSwitching = false;
    }
  } catch (_) {}
  savePlayEventToCloud(item, episode);
  title.textContent = item.title || "";
  subtitle.textContent = episode
    ? `${options.shuffleMode ? "Shuffle Mode · " : ""}T${episode.season} E${episode.episodeNumber} · ${episode.title}`
    : "";

  if (currentHls) {
    currentHls.destroy();
    currentHls = null;
  }

  video.pause();
  video.removeAttribute('src');
  resetTsPlayback(video);
  video.load();

  if (window.Hls && Hls.isSupported() && url.includes(".m3u8")) {
    currentHls = new Hls();
    currentHls.loadSource(url);
    currentHls.attachMedia(video);
    currentHls.on(Hls.Events.MANIFEST_PARSED, () => {
      if (overlay) overlay.classList.remove('is-video-loading');
      womoRefreshHlsAudioTracks();
      video.play().catch(() => {});
    });
    if (Hls.Events.AUDIO_TRACKS_UPDATED) {
      currentHls.on(Hls.Events.AUDIO_TRACKS_UPDATED, womoRefreshHlsAudioTracks);
    }
    if (Hls.Events.AUDIO_TRACK_SWITCHED) {
      currentHls.on(Hls.Events.AUDIO_TRACK_SWITCHED, womoRefreshHlsAudioTracks);
    }
    currentHls.on(Hls.Events.ERROR, (event, data) => {
      if (!data || !data.fatal) return;
      console.warn("Womo HLS fatal error; intentando recuperar sin recargar la página.", data);
      try {
        if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
          currentHls.startLoad();
        } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
          currentHls.recoverMediaError();
        } else {
          currentHls.destroy();
          currentHls = null;
          video.src = url;
          video.load();
          video.play().catch(() => {});
        }
      } catch (error) {
        console.warn("No se pudo recuperar HLS automáticamente.", error);
      }
    });
  } else if (isTsVideoUrl(url)) {
    // Safari can play MPEG-TS directly. Do not fetch/transmux first, because Archive links may fail CORS.
    video.src = url;
    video.setAttribute("type", "video/mp2t");
    video.load();
    womoKeepPlayerClosable();
  } else {
    video.src = url;
  }

  overlay.classList.add('open', 'controls-visible');
  overlay.setAttribute('aria-hidden', 'false');

  // Run from the original Play-button gesture. Mobile browsers commonly
  // reject fullscreen when it is first requested by a later async event.
  womoTryMobileNativeFullscreen(video);

  const hasExplicitStartAt = Object.prototype.hasOwnProperty.call(options, "startAt");
  const shouldIgnoreSavedProgress = Boolean(options.shuffleMode || options.noProgress || options.fromShuffle || options.saveProgress === false);
  const savedProgress = shouldIgnoreSavedProgress
    ? 0
    : (episode
      ? Number(loadEpisodeProgress()[episodeKey(item.id, episode.season, episode.episodeNumber, episode.id)] || episode.progress || 0)
      : getItemProgress(item));

  video.onloadedmetadata = () => {
    if (!currentHls) womoRefreshNativeAudioTracks(video);
    if (hasExplicitStartAt && Number.isFinite(Number(options.startAt)) && Number(options.startAt) >= 0) {
      video.currentTime = Number(options.startAt);
    } else if (savedProgress > 0 && savedProgress < 98 && video.duration && isFinite(video.duration)) {
      video.currentTime = (savedProgress / 100) * video.duration;
    } else if (shouldIgnoreSavedProgress) {
      video.currentTime = 0;
    }
    womoTryMobileNativeFullscreen(video);
    video.play().catch(() => {});
  };

  clearInterval(playerSaveTimer);
  playerSaveTimer = setInterval(savePlayerProgress, 5000);

  womoClearAutoNextOverlayVisualOnly();
  womoForcePlayerVisibleOnOpen();
  setTimeout(womoForcePlayerVisibleOnOpen, 40);
  setTimeout(womoForcePlayerVisibleOnOpen, 180);
  setTimeout(womoBindShuffleNextVideo, 130);
      setTimeout(womoBindShuffleSkipVideo, 135);
  if (window.lucide) lucide.createIcons();
}

function closePlayer() {
  womoResetAudioSelector();
  try {
    const videoFs = document.getElementById('womoPlayer');
    if (videoFs && typeof videoFs.webkitExitFullscreen === 'function') videoFs.webkitExitFullscreen();
    if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(() => {});
    if (document.webkitFullscreenElement && document.webkitExitFullscreen) document.webkitExitFullscreen();
  } catch (_) {}
  womoHideShuffleSkipOverlay();
  womoResetShuffleSession();
  womoHideShuffleNextOverlay();
  womoUnlockMobileOrientation();
  womoClearForcedPlayerVisibleState();
  womoClearTsSeekTimer();
  womoCurrentPlaybackUrl = "";
  window.__womoPlayerOpenedAt = 0;
  womoTsIsRecovering = false;
  const isShuffleNoProgress = typeof womoIsShuffleNoProgressPlayback === "function" && womoIsShuffleNoProgressPlayback();
  if (!isShuffleNoProgress) {
    saveActiveEpisodeProgress(false);
    saveActiveEpisodeProgress(false);
  }
  const overlay = document.getElementById('playerOverlay');
  const video = document.getElementById('womoPlayer');

  if (!isShuffleNoProgress) savePlayerProgress();
  try { if (overlay) overlay.dataset.shuffleNoProgress = "false"; } catch (_) {}
  clearInterval(playerSaveTimer);
  playerSaveTimer = null;

  video.pause();
  resetTsPlayback(video);
  if (currentHls) {
    currentHls.destroy();
    currentHls = null;
  }
  video.removeAttribute('src');
  video.load();

  overlay.classList.remove('open', 'show-controls', 'controls-visible', 'is-video-loading');
  document.body.classList.remove('player-open');
  overlay.setAttribute('aria-hidden', 'true');
  currentPlayerContext = null;

  refreshContinueRow();
  womoFlushDeferredPlaybackUiWork();
}

function setupPlayerControls() {
  const back = document.getElementById('playerBack');
  const overlay = document.getElementById('playerOverlay');
  const video = document.getElementById('womoPlayer');
  if (!back || back.dataset.ready === "true") return;
  back.dataset.ready = "true";

  video.setAttribute('controlsList', 'nodownload noplaybackrate');
  video.disablePictureInPicture = true;

  back.addEventListener('click', closePlayer);

  video.addEventListener('timeupdate', () => {
    if (!currentPlayerContext) return;
    const now = Date.now();
    if (!video.dataset.lastAutoSave || now - Number(video.dataset.lastAutoSave) > 6000) {
      video.dataset.lastAutoSave = String(now);
      savePlayerProgress();
    }
  });

  video.addEventListener('pause', savePlayerProgress);

  video.addEventListener('ended', () => {
    if (typeof womoIsShuffleNoProgressPlayback === "function" && womoIsShuffleNoProgressPlayback()) return;
    if (!currentPlayerContext || currentPlayerContext.saveProgress === false || currentPlayerContext.shuffleMode || currentPlayerContext.fromShuffle || currentPlayerContext.noProgress) return;
    const { item, episode } = currentPlayerContext;
    if (item.type === 'series' && episode) {
      const map = loadEpisodeProgress();
      map[episodeKey(item.id, episode.season, episode.episodeNumber, episode.id)] = 100;
      localStorage.setItem(EPISODE_PROGRESS_KEY, JSON.stringify(map));
      saveEpisodeProgressToCloud(item.id, episode, 100);
    } else {
      upsertContinueItem(item, 100);
    }
  });

  let hideTimer = null;
  const showTopbar = () => {
    overlay.classList.add('controls-visible');
    overlay.classList.add('show-controls');
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => {
      if (!video.paused) {
        overlay.classList.remove('controls-visible');
        overlay.classList.remove('show-controls');
      }
    }, 1800);
  };

  const hideTopbar = () => {
    if (!video.paused) {
      overlay.classList.remove('controls-visible');
      overlay.classList.remove('show-controls');
    }
  };

  overlay.addEventListener('mousemove', showTopbar);
  overlay.addEventListener('touchstart', showTopbar, { passive: true });
  video.addEventListener('play', () => {
    showTopbar();
    setTimeout(hideTopbar, 1800);
  });
  video.addEventListener('pause', () => overlay.classList.add('controls-visible'));
}

setupPlayerControls();




let womoAppStarted = false;

async function bootWomoAppAfterLogin() {
  womoShowSkeleton();
  if (womoAppStarted) return;
  womoAppStarted = true;

  const user = firebase.auth().currentUser;
  if (user) await user.getIdToken();

  localStorage.removeItem(FAVORITES_KEY);
  localStorage.removeItem(CONTINUE_KEY);
  localStorage.removeItem(EPISODE_PROGRESS_KEY);
  localStorage.setItem(MEMORY_CLEARED_KEY, "true");

  await Promise.all([
    loadFavoritesFromCloud(),
    loadContinueFromCloud(),
    loadEpisodeProgressFromCloud()
  ]);

  await init();

  syncFavoriteUI();
  renderFavorites();
  refreshContinueRow();
  renderSearchResults();
  await registerSessionWatch();
}

const auth = firebase.auth();

function getLoginErrorMessage(error) {
  const code = error?.code || "";
  if (code.includes("auth/invalid-email")) return "El correo no es válido.";
  if (code.includes("auth/user-disabled")) return "Esta cuenta está deshabilitada.";
  if (code.includes("auth/user-not-found")) return "No existe una cuenta con ese correo.";
  if (code.includes("auth/wrong-password") || code.includes("auth/invalid-credential")) return "Correo o contraseña incorrectos.";
  if (code.includes("auth/too-many-requests")) return "Demasiados intentos. Intenta más tarde.";
  return "No se pudo iniciar sesión. Revisa tus datos.";
}

function setupLogin() {
  const screen = document.getElementById("loginScreen");
  const form = document.getElementById("loginForm");
  const emailInput = document.getElementById("loginEmail");
  const passwordInput = document.getElementById("loginPassword");
  const errorBox = document.getElementById("loginError");

  if (!screen || !form) return;

  auth.onAuthStateChanged(async user => {
    if (user) {
      screen.classList.add("hidden");
      localStorage.setItem("womoUser", user.email || user.uid);
      await bootWomoAppAfterLogin();
    } else {
      screen.classList.remove("hidden");
      localStorage.removeItem("womoUser");
      localStorage.removeItem(FAVORITES_KEY);
      localStorage.removeItem(CONTINUE_KEY);
      localStorage.removeItem(EPISODE_PROGRESS_KEY);
      resetLocalSession();
      womoAppStarted = false;
    }
  });

  form.addEventListener("submit", async event => {
    event.preventDefault();
    if (errorBox) errorBox.textContent = "";

    const email = emailInput.value.trim();
    const password = passwordInput.value;

    const submitButton = form.querySelector("button");
    if (submitButton) {
      submitButton.disabled = true;
      submitButton.textContent = "Iniciando...";
    }

    try {
      await auth.signInWithEmailAndPassword(email, password);
    } catch (error) {
      if (errorBox) errorBox.textContent = getLoginErrorMessage(error);
    } finally {
      if (submitButton) {
        submitButton.disabled = false;
        submitButton.textContent = "Iniciar sesión";
      }
    }
  });
}

setupLogin();



function getUserDocRef() {
  const user = firebase.auth().currentUser;
  return user ? db.collection("users").doc(user.uid) : null;
}

function safeDocId(value) {
  return String(value || "")
    .replace(/[\/#?\[\]]/g, "_")
    .slice(0, 140);
}

function userItemDocId(entry) {
  return safeDocId(`${entry.type}_${entry.id}`);
}

function userEpisodeDocId(seriesId, season, episodeNumber, episodeId = "") {
  return safeDocId(`${seriesId}_S${season}_E${episodeNumber}_${episodeId}`);
}

async function saveFavoriteToCloud(entry) {
  const ref = getUserDocRef();
  if (!ref || !entry) return;

  await ref.set({
    email: firebase.auth().currentUser?.email || "",
    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
  }, { merge: true });
  await ref.collection("favorites").doc(userItemDocId(entry)).set({
    id: entry.id,
    type: entry.type,
    addedAt: entry.addedAt || Date.now(),
    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
  }, { merge: true });
}

async function deleteFavoriteFromCloud(entry) {
  const ref = getUserDocRef();
  if (!ref || !entry) return;
  await ref.collection("favorites").doc(userItemDocId(entry)).delete();
}

async function loadFavoritesFromCloud() {
  const ref = getUserDocRef();
  if (!ref) return;

  const snapshot = await ref.collection("favorites").orderBy("addedAt", "desc").get();
  const items = snapshot.docs.map(doc => {
    const data = doc.data() || {};
    return {
      id: data.id,
      type: data.type,
      addedAt: data.addedAt || 0
    };
  }).filter(entry => entry.id && entry.type);

  saveFavoriteState(items);
}

async function saveContinueEntryToCloud(entry) {
  const ref = getUserDocRef();
  if (!ref || !entry) return;

  await ref.set({
    email: firebase.auth().currentUser?.email || "",
    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
  }, { merge: true });
  await ref.collection("continueWatching").doc(userItemDocId(entry)).set({
    ...entry,
    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
  }, { merge: true });
}


async function savePlayEventToCloud(item, episode = null) {
  const ref = getUserDocRef();
  if (!ref || !item || !item.id || !item.type) return;

  try {
    const key = userItemDocId({ id: item.id, type: item.type });
    const payload = {
      id: item.id,
      type: item.type,
      title: item.title || "",
      playCount: firebase.firestore.FieldValue.increment(1),
      lastPlayedAt: Date.now(),
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    };

    if (episode) {
      payload.lastEpisodeId = episode.id || "";
      payload.lastSeason = episode.season || episode.seasonNumber || 1;
      payload.lastEpisodeNumber = episode.episodeNumber || episode.episode || episode.number || 1;
      payload.lastEpisodeTitle = episode.title || episode.name || "";
    }

    await ref.set({
      email: firebase.auth().currentUser?.email || "",
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    }, { merge: true });

    await ref.collection("playHistory").doc(key).set(payload, { merge: true });
  } catch (error) {
    console.warn("No se pudo guardar playHistory.", error);
  }
}

async function loadContinueFromCloud() {
  const ref = getUserDocRef();
  if (!ref) return;

  const snapshot = await ref.collection("continueWatching").orderBy("lastWatchedAt", "desc").get();
  const items = snapshot.docs.map(doc => doc.data()).filter(entry => entry.id && entry.type);
  saveContinueState(items);

  if (items.length) localStorage.removeItem(MEMORY_CLEARED_KEY);
  else localStorage.setItem(MEMORY_CLEARED_KEY, "true");
}

async function saveEpisodeProgressToCloud(seriesId, episode, progress) {
  const ref = getUserDocRef();
  if (!ref || !seriesId || !episode) return;

  await ref.set({
    email: firebase.auth().currentUser?.email || "",
    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
  }, { merge: true });

  await ref.collection("episodeProgress")
    .doc(userEpisodeDocId(seriesId, episode.season, episode.episodeNumber, episode.id))
    .set({
      seriesId,
      episodeId: episode.id,
      season: episode.season,
      episodeNumber: episode.episodeNumber,
      progress,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
}

async function loadEpisodeProgressFromCloud() {
  const ref = getUserDocRef();
  if (!ref) return;

  const snapshot = await ref.collection("episodeProgress").get();
  const map = {};
  snapshot.docs.forEach(doc => {
    const data = doc.data() || {};
    if (!data.seriesId) return;
    map[episodeKey(data.seriesId, data.season, data.episodeNumber, data.episodeId)] = Number(data.progress || 0);
  });
  localStorage.setItem(EPISODE_PROGRESS_KEY, JSON.stringify(map));
}





document.addEventListener("DOMContentLoaded", () => {
  bindWomoPlayerProgressEvents();
});

window.addEventListener("beforeunload", () => {
  if (typeof womoIsShuffleNoProgressPlayback === "function" && womoIsShuffleNoProgressPlayback()) return;
  saveActiveEpisodeProgress(false);
});


document.addEventListener("ended", (event) => {
  if (!event.target || event.target.tagName !== "VIDEO") return;
  const video = event.target;
  if (womoIsPlayerCurrentlyOpen() && !womoIsRealVideoEnded(video)) {
    console.warn("Womo bloqueó un ended temprano de iOS/Safari.", { currentTime: video.currentTime, duration: video.duration });
    event.stopPropagation();
    if (event.stopImmediatePropagation) event.stopImmediatePropagation();
    return;
  }
}, true);

document.addEventListener("DOMContentLoaded", () => {
  document.body.dataset.womoEndedCaptureBound = "true";
});



document.addEventListener("timeupdate", (event) => {
  if (typeof womoIsShuffleNoProgressPlayback === "function" && womoIsShuffleNoProgressPlayback()) return;
  const video = event.target;
  if (!video || video.tagName !== "VIDEO") return;
  const duration = Number(video.duration || 0);
  const current = Number(video.currentTime || 0);
  if (!duration || !current) return;
  const pct = (current / duration) * 100;
  if (pct >= 98) {
    saveActiveEpisodeProgress(true);
  }
}, true);

document.addEventListener("DOMContentLoaded", () => {
  document.body.dataset.womoMarkCompleteAt98NoCloseBound = "true";
});


document.addEventListener("ended", (event) => {
  if (!event.target || event.target.tagName !== "VIDEO") return;
  const video = event.target;
  if (womoIsPlayerCurrentlyOpen() && !womoIsRealVideoEnded(video)) {
    console.warn("Womo bloqueó un ended temprano de iOS/Safari.", { currentTime: video.currentTime, duration: video.duration });
    event.stopPropagation();
    if (event.stopImmediatePropagation) event.stopImmediatePropagation();
    return;
  }
}, true);

document.addEventListener("DOMContentLoaded", () => {
  document.body.dataset.womoCloseOnlyOnEndedBound = "true";
});



document.addEventListener("DOMContentLoaded", () => {
  try {
    const filtered = getContinueStorageList().filter(entry => {
      const item = allItemsByContinueKey.get(`${entry.type}:${entry.id}`);
      return item && !isItemCompleted(item) && Number(entry.progress || item.progress || 0) < 98;
    });
    setContinueStorageList(filtered);
    refreshContinueWatchingRow();
    document.body.dataset.womoFilterCompletedContinueOnLoad = "true";
  } catch (_) {}
});



document.addEventListener("click", (event) => {
  const btn = event.target.closest("#playerClose, .player-close, [data-close-player]");
  if (!btn) return;
  setTimeout(() => forcePreviewButtonRefresh(currentPlayerItem), 0);
}, true);

document.addEventListener("DOMContentLoaded", () => {
  document.body.dataset.womoRefreshPreviewButtonsAfterPlayerClose = "true";
});


document.addEventListener("click", (event) => {
  const btn = event.target.closest("#previewPlay, [data-preview-play], .preview-play, .preview-actions .primary-btn");
  if (!btn) return;

  // Do not hijack movie or concert buttons.
  if (!isCurrentPreviewSeries()) return;
  if (!currentPreviewSeriesIdForEpisodes || !currentPreviewEpisodesCache.length) return;

  const season = Number(btn.dataset.nextSeason || 0);
  const episodeNumber = Number(btn.dataset.nextEpisode || 0);
  const episodeId = String(btn.dataset.nextEpisodeId || "");

  let targetEpisode = null;

  if (season && episodeNumber) {
    targetEpisode = getSortedPreviewEpisodes().find(ep =>
      Number(ep.season || ep.seasonNumber || 1) === season &&
      Number(ep.episodeNumber || ep.episode || 1) === episodeNumber &&
      (!episodeId || String(ep.id || "") === episodeId)
    ) || getSortedPreviewEpisodes().find(ep =>
      Number(ep.season || ep.seasonNumber || 1) === season &&
      Number(ep.episodeNumber || ep.episode || 1) === episodeNumber
    ) || null;
  }

  if (!targetEpisode) {
    targetEpisode = getFirstUnfinishedEpisode() || getSortedPreviewEpisodes()[0] || null;
  }

  if (!targetEpisode) return;

  const seriesItem = currentPreviewItem && currentPreviewItem.type === "series"
    ? currentPreviewItem
    : allItemsByContinueKey.get(`series:${currentPreviewSeriesIdForEpisodes}`);

  if (!seriesItem) return;

  event.preventDefault();
  event.stopImmediatePropagation();
  openPlayer(seriesItem, { episode: targetEpisode });
}, true);

document.addEventListener("DOMContentLoaded", () => {
  document.body.dataset.womoSeriesPreviewButtonBound = "true";
});


document.addEventListener("click", () => {
  setTimeout(() => {
    if (currentPreviewItem) forcePreviewButtonRefresh(currentPreviewItem);
  }, 80);
}, true);

document.addEventListener("DOMContentLoaded", () => {
  document.body.dataset.womoPreviewOpenStateRefreshBound = "true";
});


document.addEventListener("click", (event) => {
  const closeBtn = event.target.closest("#playerClose, .player-close, [data-close-player]");
  if (!closeBtn) return;
  setTimeout(() => {
    if (currentPreviewItem && currentPreviewItem.type !== "series") {
      setPreviewButtonModeForItem(currentPreviewItem);
    }
  }, 80);
}, true);

document.addEventListener("DOMContentLoaded", () => {
  document.body.dataset.womoStartedContinueRefreshBound = "true";
});


document.addEventListener("click", () => {
  setTimeout(() => {
    if (currentPreviewItem && currentPreviewItem.type !== "series") {
      setPreviewButtonModeForItem(currentPreviewItem);
    }
  }, 120);
}, true);

document.addEventListener("DOMContentLoaded", () => {
  document.body.dataset.womoStartedPreviewRefreshBound = "true";
});


document.addEventListener("DOMContentLoaded", () => {
  hideContinueViewAllButtons();
});


function applyPreviewTopButtonsLayout() {
  const closeBtn = document.getElementById("previewClose") || document.querySelector(".preview-close");
  if (closeBtn) {
    closeBtn.textContent = "‹";
    closeBtn.setAttribute("aria-label", "Volver");
    closeBtn.style.left = "16px";
    closeBtn.style.right = "auto";
  }

  const favBtn = document.getElementById("previewFavorite")
    || document.getElementById("previewFav")
    || document.querySelector(".preview-favorite")
    || document.querySelector(".preview-fav")
    || document.querySelector(".preview-card .favorite-btn")
    || document.querySelector(".preview-modal .favorite-btn");

  if (favBtn) {
    favBtn.style.right = "16px";
    favBtn.style.left = "auto";
  }
}

document.addEventListener("DOMContentLoaded", () => {
  applyPreviewTopButtonsLayout();
  document.body.dataset.womoPreviewTopButtonsSwapped = "true";
});

document.addEventListener("click", () => {
  setTimeout(applyPreviewTopButtonsLayout, 30);
}, true);



/* Safe View All mockup behavior - no global click hijack */
let womoViewAllCategory = "All";
let womoViewAllItems = [];

function womoGenreTokens(item) {
  const raw = item?.genre || item?.genres || item?.category || item?.categories || "";
  const values = Array.isArray(raw) ? raw : String(raw).split(/[,/|·]+/);
  return values
    .map(value => String(value).trim())
    .filter(Boolean)
    .map(value => value.charAt(0).toUpperCase() + value.slice(1));
}

function womoGetViewAllCategories(items) {
  const set = new Set();
  (items || []).forEach(item => womoGenreTokens(item).forEach(genre => set.add(genre)));
  return ["All", ...Array.from(set).sort((a, b) => a.localeCompare(b))];
}

function womoRenderViewAllCategories(items) {
  const wrap = document.getElementById("viewAllCategories");
  if (!wrap) return;

  const categories = womoGetViewAllCategories(items);
  if (!categories.includes(womoViewAllCategory)) womoViewAllCategory = "All";

  wrap.innerHTML = categories.map(category => `
    <button type="button" class="view-all-category ${category === womoViewAllCategory ? "active" : ""}" data-category="${category}">
      ${category}
    </button>
  `).join("");
}

function womoFilterViewAllItems(items) {
  let output = [...(items || [])];

  if (womoViewAllCategory && womoViewAllCategory !== "All") {
    output = output.filter(item => womoGenreTokens(item).includes(womoViewAllCategory));
  }

  const sort = document.getElementById("viewAllSort")?.value || "new";
  if (sort === "az") output.sort((a, b) => String(a.title || "").localeCompare(String(b.title || "")));
  else if (sort === "year") output.sort((a, b) => Number(b.year || 0) - Number(a.year || 0));
  else output.sort((a, b) => Number(b.createdAt || b.year || 0) - Number(a.createdAt || a.year || 0));

  return output;
}

function womoRenderViewAllFilteredGrid() {
  const grid = document.getElementById("viewAllGrid");
  const count = document.getElementById("viewAllCount");
  if (!grid) return;

  const items = womoFilterViewAllItems(womoViewAllItems);
  if (count) count.textContent = `${items.length} ${items.length === 1 ? "título" : "títulos"}`;

  grid.innerHTML = items.map(item => posterCard(item, false)).join("");
  grid.querySelectorAll(".poster-card").forEach(card => {
    card.addEventListener("click", () => {
      const item = allItemsByContinueKey.get(`${card.dataset.type}:${card.dataset.id}`);
      if (item) openPreview(item);
    });
  });
}

function womoPrepareViewAllMockupFixed(items) {
  womoViewAllItems = Array.isArray(items) ? items : [];
  womoViewAllCategory = "All";
  
  womoViewAllCleanModeRender();
}

document.addEventListener("click", (event) => {
  const btn = event.target.closest(".view-all-category");
  if (!btn) return;
  event.preventDefault();
  womoViewAllCategory = btn.dataset.category || "All";
  
  womoViewAllCleanModeRender();
});

document.addEventListener("change", (event) => {
  if (event.target?.id !== "viewAllSort") return;
  womoViewAllCleanModeRender();
});




/* View All dynamic category repair */
function womoGenreTokensFixed(item) {
  const rawValues = [
    item?.genre,
    item?.genres,
    item?.category,
    item?.categories,
    item?.genero,
    item?.género,
    item?.typeGenre
  ].flatMap(value => Array.isArray(value) ? value : String(value || "").split(/[,/|·]+/));

  return rawValues
    .map(value => String(value).trim())
    .filter(Boolean)
    .filter(value => !["movie", "series", "concert", "concierto", "pelicula", "película"].includes(value.toLowerCase()))
    .map(value => value.charAt(0).toUpperCase() + value.slice(1));
}

function womoRenderCategoriesNow() {
  const wrap = document.getElementById("viewAllCategories");
  if (!wrap) return;

  const items = Array.isArray(womoViewAllItems) ? womoViewAllItems : [];
  const genres = new Set();

  items.forEach(item => {
    womoGenreTokensFixed(item).forEach(genre => genres.add(genre));
  });

  const categories = ["All", ...Array.from(genres).sort((a, b) => a.localeCompare(b))];

  wrap.innerHTML = categories.map(category => `
    <button type="button" class="view-all-category ${category === womoViewAllCategory ? "active" : ""}" data-category="${category}">
      ${category}
    </button>
  `).join("");
}

function womoFilterViewAllItemsFixed(items) {
  let output = [...(items || [])];

  if (womoViewAllCategory && womoViewAllCategory !== "All") {
    output = output.filter(item => womoGenreTokensFixed(item).includes(womoViewAllCategory));
  }

  const sort = document.getElementById("viewAllSort")?.value || "new";
  if (sort === "az") output.sort((a, b) => String(a.title || "").localeCompare(String(b.title || "")));
  else if (sort === "year") output.sort((a, b) => Number(b.year || 0) - Number(a.year || 0));
  else output.sort((a, b) => Number(b.createdAt || b.year || 0) - Number(a.createdAt || a.year || 0));

  return output;
}

function womoRenderViewAllFilteredGridFixed() {
  const grid = document.getElementById("viewAllGrid");
  const count = document.getElementById("viewAllCount");
  if (!grid) return;

  const items = womoFilterViewAllItemsFixed(womoViewAllItems);
  if (count) count.textContent = `${items.length} ${items.length === 1 ? "título" : "títulos"}`;

  grid.innerHTML = items.map(item => posterCard(item, false)).join("");
  grid.querySelectorAll(".poster-card").forEach(card => {
    card.addEventListener("click", () => {
      const item = allItemsByContinueKey.get(`${card.dataset.type}:${card.dataset.id}`);
      if (item) openPreview(item);
    });
  });
}

function womoPrepareViewAllMockupFixed(items) {
  womoViewAllItems = Array.isArray(items) ? items : [];
  womoViewAllCategory = "All";
  
  womoViewAllCleanModeRender();
}

document.addEventListener("click", (event) => {
  const btn = event.target.closest(".view-all-category");
  if (!btn) return;
  event.preventDefault();
  womoViewAllCategory = btn.dataset.category || "All";
  
  womoViewAllCleanModeRender();
}, true);

document.addEventListener("change", (event) => {
  if (event.target?.id !== "viewAllSort") return;
  womoViewAllCleanModeRender();
}, true);


function womoEnsureViewAllCategoriesContainer() {
  if (document.getElementById("viewAllCategories")) return;
  const grid = document.getElementById("viewAllGrid");
  if (!grid) return;
  const controls = document.createElement("div");
  controls.className = "view-all-controls";
  controls.innerHTML = `<div id="viewAllCategories" class="view-all-categories"></div>`;
  const sort = document.getElementById("viewAllSort");
  if (sort) {
    const wrap = document.createElement("div");
    wrap.className = "view-all-sort-wrap";
    sort.parentNode.insertBefore(controls, sort);
    wrap.appendChild(sort);
    controls.appendChild(wrap);
  } else {
    grid.parentNode.insertBefore(controls, grid);
  }
}

document.addEventListener("DOMContentLoaded", () => {
  womoEnsureViewAllCategoriesContainer();
});




/* View All clean mode: always show all items */
function womoViewAllCleanModeRender() {
  try {
    womoViewAllCategory = "All";
    const grid = document.getElementById("viewAllGrid");
    const count = document.getElementById("viewAllCount");
    if (!grid || !Array.isArray(womoViewAllItems)) return;

    const items = [...womoViewAllItems];
    if (count) count.textContent = `${items.length} ${items.length === 1 ? "título" : "títulos"}`;

    grid.innerHTML = items.map(item => posterCard(item, false)).join("");
    grid.querySelectorAll(".poster-card").forEach(card => {
      card.addEventListener("click", () => {
        const item = allItemsByContinueKey.get(`${card.dataset.type}:${card.dataset.id}`);
        if (item) openPreview(item);
      });
    });
  } catch (_) {}
}




/* Search centered empty state + Shuffle */
function womoGetSearchInput() {
  const page = document.getElementById("searchPage");
  if (!page) return null;
  return page.querySelector("#searchInput")
    || page.querySelector(".search-input")
    || page.querySelector("input[type='search']")
    || page.querySelector("input[type='text']");
}

function womoGetSearchPage() {
  return document.getElementById("searchPage");
}

function womoSetSearchState() {
  const page = womoGetSearchPage();
  const input = womoGetSearchInput();
  if (!page || !input) return;

  const value = input.value.trim();
  page.classList.toggle("search-empty-state", value.length === 0);
  page.classList.toggle("search-has-query", value.length > 0);

  const empty = document.getElementById("searchShuffleEmpty");
  if (empty) empty.style.display = value.length === 0 ? "" : "none";
}

function womoGetRandomSeriesEpisode() {
  const items = typeof getAllCatalogItems === "function"
    ? getAllCatalogItems()
    : Array.from(allItemsByContinueKey?.values?.() || []);

  const series = items.filter(item => item && item.type === "series");
  const candidates = [];

  series.forEach(show => {
    let episodes = [];
    try {
      if (typeof readSeriesEpisodes === "function") {
        episodes = readSeriesEpisodes(show.id) || [];
      }
    } catch (_) {}

    if (!episodes.length && Array.isArray(show.episodes)) episodes = show.episodes;
    if (!episodes.length && Array.isArray(show.seasons)) {
      show.seasons.forEach(season => {
        if (Array.isArray(season.episodes)) {
          season.episodes.forEach(ep => candidates.push({ show, episode: { ...ep, season: ep.season || season.season || season.number || 1 } }));
        }
      });
      return;
    }

    episodes.forEach(ep => {
      candidates.push({ show, episode: ep });
    });
  });

  if (!candidates.length) return null;
  return candidates[Math.floor(Math.random() * candidates.length)];
}

function womoPlayShuffleEpisode() {
  return womoPlayGlobalShuffleEpisodeFinal();
}

function womoBindSearchShuffle() {
  const input = womoGetSearchInput();
  if (input && !input.dataset.womoSearchStateBound) {
    input.dataset.womoSearchStateBound = "true";
    input.addEventListener("input", womoSetSearchState);
    input.addEventListener("change", womoSetSearchState);
  }

  const btn = document.getElementById("shufflePlayBtn");
  if (btn && !btn.dataset.womoShuffleBound) {
    btn.dataset.womoShuffleBound = "true";
    btn.addEventListener("click", (event) => {
      event.preventDefault();
      womoPlayShuffleEpisode();
    });
  }

  womoSetSearchState();
}

document.addEventListener("DOMContentLoaded", () => {
  womoBindSearchShuffle();
});

document.addEventListener("click", () => {
  setTimeout(womoBindSearchShuffle, 60);
}, true);

/* Search real title cleanup */
function womoHideEmptySearchTitle() {
  const input = document.getElementById("searchInput");
  const title = document.getElementById("searchResultsTitle");
  if (!title || !input) return;
  if (!input.value.trim()) {
    title.textContent = "";
    title.classList.add("search-title-hidden");
  }
}
document.addEventListener("DOMContentLoaded", womoHideEmptySearchTitle);
document.addEventListener("input", (event) => {
  if (event.target?.id === "searchInput") setTimeout(womoHideEmptySearchTitle, 0);
}, true);
document.addEventListener("click", () => setTimeout(womoHideEmptySearchTitle, 60), true);




/* Search Shuffle async Firebase fix */
window.__womoShuffleNoProgress = false;
window.womoGlobalShuffleNoProgress = false;

function womoSetShuffleNoProgress(active) {
  window.__womoShuffleNoProgress = Boolean(active);
  window.womoGlobalShuffleNoProgress = Boolean(active);
  try { womoGlobalShuffleNoProgress = Boolean(active); } catch (_) {}
}

function womoIsShuffleNoProgressPlayback() {
  try {
    if (window.__womoShuffleNoProgress || window.womoGlobalShuffleNoProgress) return true;
    if (typeof womoGlobalShuffleNoProgress !== "undefined" && womoGlobalShuffleNoProgress) return true;
    if (currentPlayerContext && (
      currentPlayerContext.shuffleMode ||
      currentPlayerContext.fromShuffle ||
      currentPlayerContext.noProgress ||
      currentPlayerContext.saveProgress === false
    )) return true;
    const overlay = document.getElementById("playerOverlay") || document.querySelector(".player-overlay");
    if (overlay && overlay.dataset && overlay.dataset.shuffleNoProgress === "true") return true;
  } catch (_) {}
  return false;
}

function womoGetAllCatalogItemsForShuffle() {
  try {
    if (typeof getAllCatalogItems === "function") return getAllCatalogItems();
  } catch (_) {}

  try {
    return Array.from(allItemsByContinueKey?.values?.() || []);
  } catch (_) {
    return [];
  }
}

async function womoGetEpisodesForShuffle(show) {
  let episodes = [];

  try {
    if (typeof readSeriesEpisodes === "function") {
      episodes = await readSeriesEpisodes(show.id);
    }
  } catch (error) {
    console.warn("Shuffle no pudo leer episodios de Firebase.", error);
  }

  if (!Array.isArray(episodes)) episodes = [];

  if (!episodes.length && Array.isArray(show.episodes)) {
    episodes = show.episodes;
  }

  if (!episodes.length && Array.isArray(show.seasons)) {
    show.seasons.forEach(season => {
      const seasonNumber = Number(season.season || season.number || season.seasonNumber || 1);
      if (Array.isArray(season.episodes)) {
        season.episodes.forEach((ep, index) => {
          episodes.push({
            ...ep,
            season: Number(ep.season || ep.seasonNumber || seasonNumber),
            episodeNumber: Number(ep.episodeNumber || ep.number || ep.episode || ep.ep || index + 1)
          });
        });
      }
    });
  }

  return episodes
    .map((ep, index) => ({
      ...ep,
      season: Number(ep.season || ep.seasonNumber || 1),
      episodeNumber: Number(ep.episodeNumber || ep.number || ep.episode || ep.ep || index + 1),
      hlsUrl: ep.hlsUrl || ep.videoUrl || ep.url || ep.src || ep.streamUrl || ep.m3u8 || ep.file || ep.link || ""
    }))
    .filter(ep => ep.hlsUrl);
}

async function womoPickRandomSeriesEpisode() {
  const all = womoGetAllCatalogItemsForShuffle();
  const series = all.filter(item => item && item.type === "series");

  const candidates = [];

  for (const show of series) {
    const episodes = await womoGetEpisodesForShuffle(show);
    episodes.forEach(episode => candidates.push({ show, episode }));
  }

  if (!candidates.length) return null;
  return candidates[Math.floor(Math.random() * candidates.length)];
}

async function womoPlaySearchShuffle() {
  const button = document.getElementById("shufflePlayBtn");
  if (button) {
    button.disabled = true;
    button.dataset.originalText = button.textContent || "SHUFFLE";
    button.innerHTML = '<span class="shuffle-loader" aria-hidden="true"></span>';
    button.classList.add("loading");
    button.setAttribute("aria-label", "Cargando");
  }

  try {
    const pick = await womoPickRandomSeriesEpisode();

    if (!pick) {
      alert("No hay episodios disponibles para Shuffle.");
      return;
    }

    const { show, episode } = pick;

    if (typeof womoStartShuffleSession === "function") womoStartShuffleSession("universal", "");
    womoSetShuffleNoProgress(true);

    if (typeof openPlayer === "function") {
      openPlayer(show, {
        episode,
        startAt: 0,
        saveProgress: false,
        noProgress: true,
        shuffleMode: true,
        fromShuffle: true,
        noProgress: true,
        shuffleScope: womoShuffleSessionScope || window.__womoNextShuffleScope || "universal",
        shuffleSeriesId: womoShuffleSessionSeriesId || ""
      });
    }
  } finally {
    if (button) {
      button.disabled = false;
      button.classList.remove("loading");
      button.textContent = button.dataset.originalText || "SHUFFLE";
      button.removeAttribute("aria-label");
    }
  }
}

function womoBindSearchShuffleButton() {
  const button = document.getElementById("shufflePlayBtn");
  if (!button || button.dataset.womoShuffleAsyncBound === "true") return;

  button.dataset.womoShuffleAsyncBound = "true";
  button.addEventListener("click", event => {
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    womoPlaySearchShuffle();
  }, true);
}

document.addEventListener("DOMContentLoaded", womoBindSearchShuffleButton);
document.addEventListener("click", () => setTimeout(womoBindSearchShuffleButton, 40), true);

document.addEventListener("click", event => {
  if (event.target.closest("#playerBack, #playerClose, .player-close, [data-close-player]")) {
    setTimeout(() => womoSetShuffleNoProgress(false), 200);
  }
}, true);

function womoPlayShuffleEpisode() {
  return womoPlaySearchShuffle();
}

function womoPlayGlobalShuffleEpisode() {
  return womoPlaySearchShuffle();
}

function womoPlayGlobalShuffleEpisodeFinal() {
  return womoPlaySearchShuffle();
}




/* Shuffle playback should always start from zero without changing saved progress */
(function(){
  if (window.__womoOpenPlayerStartZeroPatched) return;
  window.__womoOpenPlayerStartZeroPatched = true;
  const originalOpenPlayer = window.openPlayer;
  if (typeof originalOpenPlayer !== "function") return;

  window.openPlayer = function(item, options = {}) {
    const isShuffle = Boolean(options && (options.shuffleMode || options.fromShuffle || options.noProgress || options.saveProgress === false));
    if (isShuffle) {
      options = {
        ...options,
        startAt: 0,
        saveProgress: false,
        noProgress: true,
        fromShuffle: true,
        shuffleMode: true
      };
    }
    return originalOpenPlayer.call(this, item, options);
  };
})();





/* Search scroll class sync - only when content overflows */
function womoSyncSearchScrollClass() {
  const searchPage = document.getElementById("searchPage");
  const input = document.getElementById("searchInput");
  const results = document.getElementById("searchResults");
  const section = document.querySelector("#searchPage .search-results-section");
  const isSearchVisible = searchPage && !searchPage.classList.contains("hidden") && getComputedStyle(searchPage).display !== "none";

  let needsScroll = false;

  if (isSearchVisible && input && input.value.trim() && results) {
    const target = section || results;
    const rect = target.getBoundingClientRect();
    const bottom = rect.bottom + 80;
    needsScroll = bottom > window.innerHeight && results.children.length > 0;
  }

  document.body.classList.toggle("search-scroll-enabled", Boolean(needsScroll));
  document.documentElement.classList.toggle("search-scroll-enabled", Boolean(needsScroll));
}

document.addEventListener("DOMContentLoaded", womoSyncSearchScrollClass);
document.addEventListener("click", () => setTimeout(womoSyncSearchScrollClass, 120), true);
document.addEventListener("input", event => {
  if (event.target?.id === "searchInput") {
    setTimeout(womoSyncSearchScrollClass, 80);
    setTimeout(womoSyncSearchScrollClass, 250);
  }
}, true);
window.addEventListener("resize", womoSyncSearchScrollClass);



console.info("Womo TS support active: .ts URLs play directly in the native video element.");





/* Cleanup forced player visibility state */
function womoClearForcedPlayerVisibleState() {
  const overlay = document.getElementById("playerOverlay") || document.querySelector(".player-overlay");
  const video = document.getElementById("womoPlayer") || document.querySelector("#playerOverlay video") || document.querySelector(".player-overlay video");

  if (overlay) {
    overlay.classList.remove("open", "active", "visible");
    overlay.style.removeProperty("display");
    overlay.style.removeProperty("visibility");
    overlay.style.removeProperty("opacity");
    overlay.style.removeProperty("pointer-events");
  }

  if (video) {
    video.style.removeProperty("display");
    video.style.removeProperty("visibility");
    video.style.removeProperty("opacity");
    video.style.removeProperty("pointer-events");
  }
}

/* Fix hidden player after canceled auto-next */
function womoForcePlayerVisibleOnOpen() {
  const overlay = document.getElementById("playerOverlay") || document.querySelector(".player-overlay");
  const video = document.getElementById("womoPlayer") || document.querySelector("#playerOverlay video") || document.querySelector(".player-overlay video");

  if (overlay) {
    overlay.classList.remove("hidden", "is-hidden", "closed", "closing");
    overlay.classList.add("open", "active", "visible");
    overlay.style.display = "";
    overlay.style.visibility = "visible";
    overlay.style.opacity = "1";
    overlay.style.pointerEvents = "auto";
    overlay.setAttribute("aria-hidden", "false");
  }

  if (video) {
    video.style.display = "";
    video.style.visibility = "visible";
    video.style.opacity = "1";
    video.style.pointerEvents = "auto";
  }
}

function womoClearAutoNextOverlayVisualOnly() {
  const autoOverlay = document.getElementById("womoAutoNextOverlay");
  if (autoOverlay) {
    autoOverlay.classList.add("hidden");
    autoOverlay.style.display = "none";
  }

  const playBtn = document.getElementById("womoAutoNextPlay");
  if (playBtn) {
    playBtn.classList.remove("womo-next-progressing");
  }
}

/* Safe Netflix-style next episode overlay */
let womoAutoNextTimer = null;
let womoAutoNextSeconds = 15;
let womoAutoNextEpisode = null;
let womoAutoNextDismissedKey = "";
let womoAutoNextActiveKey = "";

function womoAutoNextKey() {
  if (!currentPlayerItem || !currentPlayerEpisode) return "";
  return [
    currentPlayerItem.id,
    "S" + Number(currentPlayerEpisode.season || 1),
    "E" + Number(currentPlayerEpisode.episodeNumber || currentPlayerEpisode.episode || 1),
    currentPlayerEpisode.id || ""
  ].join(":");
}

function womoAutoNextIsShuffle() {
  try {
    return Boolean(
      window.__womoShuffleNoProgress ||
      window.womoGlobalShuffleNoProgress ||
      (typeof currentPlayerContext !== "undefined" && currentPlayerContext && currentPlayerContext.shuffleMode) ||
      (typeof currentPlayerContext !== "undefined" && currentPlayerContext && currentPlayerContext.saveProgress === false)
    );
  } catch (_) {
    return Boolean(window.__womoShuffleNoProgress || window.womoGlobalShuffleNoProgress);
  }
}

function womoAutoNextClearTimer() {
  if (womoAutoNextTimer) {
    clearInterval(womoAutoNextTimer);
    womoAutoNextTimer = null;
  }
}

function womoAutoNextHide() {
  womoAutoNextStopButtonFill();
  womoAutoNextClearTimer();
  const overlay = document.getElementById("womoAutoNextOverlay");
  if (overlay) {
    overlay.classList.add("hidden");
    overlay.style.display = "none";
  }
  womoAutoNextEpisode = null;
  womoAutoNextActiveKey = "";
}

function womoAutoNextEnsureOverlay() {
  const playerOverlay = document.getElementById("playerOverlay") || document.querySelector(".player-overlay");
  if (!playerOverlay) return null;

  let overlay = document.getElementById("womoAutoNextOverlay");
  if (overlay) return overlay;

  overlay = document.createElement("div");
  overlay.id = "womoAutoNextOverlay";
  overlay.className = "womo-auto-next-overlay hidden";
  overlay.innerHTML = ''
    + '<div class="womo-auto-next-text">'
    + '  <div class="womo-auto-next-kicker">A continuación</div>'
    + '  <div class="womo-auto-next-title" id="womoAutoNextTitle">Siguiente episodio</div>'
    + '  <div class="womo-auto-next-count" id="womoAutoNextMeta">T1 E1</div>'
    + '</div>'
    + '<div class="womo-auto-next-actions">'
    + '  <button type="button" id="womoAutoNextPlay">Siguiente en 15s</button>'
    + '  <button type="button" id="womoAutoNextCancel">Cancelar</button>'
    + '</div>';

  playerOverlay.appendChild(overlay);

  const playBtn = overlay.querySelector("#womoAutoNextPlay");
  const cancelBtn = overlay.querySelector("#womoAutoNextCancel");

  if (playBtn) {
    playBtn.addEventListener("click", function(event) {
      event.preventDefault();
      event.stopPropagation();
      womoAutoNextPlayNow();
    });
  }

  if (cancelBtn) {
    cancelBtn.addEventListener("click", function(event) {
      event.preventDefault();
      event.stopPropagation();
      womoAutoNextDismissedKey = womoAutoNextKey();
      womoAutoNextHide();
      womoClearAutoNextOverlayVisualOnly();
    });
  }

  return overlay;
}

async function womoAutoNextGetEpisodes(seriesItem) {
  let episodes = [];

  try {
    if (typeof currentPreviewItem !== "undefined" && currentPreviewItem && currentPreviewItem.id === seriesItem.id && Array.isArray(currentPreviewEpisodesCache) && currentPreviewEpisodesCache.length) {
      episodes = currentPreviewEpisodesCache;
    }
  } catch (_) {}

  if (!episodes.length) {
    try {
      if (typeof readSeriesEpisodes === "function") {
        episodes = await readSeriesEpisodes(seriesItem.id);
      }
    } catch (error) {
      console.warn("No se pudieron leer episodios para autoplay.", error);
    }
  }

  if (!Array.isArray(episodes)) episodes = [];

  return episodes.map(function(ep, index) {
    return {
      ...ep,
      season: Number(ep.season || ep.seasonNumber || 1),
      episodeNumber: Number(ep.episodeNumber || ep.number || ep.episode || ep.ep || index + 1),
      hlsUrl: ep.hlsUrl || ep.videoUrl || ep.url || ep.src || ep.streamUrl || ep.m3u8 || ep.file || ep.link || ""
    };
  }).sort(function(a, b) {
    return (a.season - b.season) || (a.episodeNumber - b.episodeNumber);
  });
}

async function womoAutoNextFindNextEpisode() {
  if (!currentPlayerItem || currentPlayerItem.type !== "series" || !currentPlayerEpisode) return null;

  const episodes = await womoAutoNextGetEpisodes(currentPlayerItem);
  if (!episodes.length) return null;

  const currentSeason = Number(currentPlayerEpisode.season || currentPlayerEpisode.seasonNumber || 1);
  const currentNumber = Number(currentPlayerEpisode.episodeNumber || currentPlayerEpisode.number || currentPlayerEpisode.episode || 1);
  const currentId = currentPlayerEpisode.id || "";

  const index = episodes.findIndex(function(ep) {
    return (currentId && ep.id === currentId) || (Number(ep.season) === currentSeason && Number(ep.episodeNumber) === currentNumber);
  });

  if (index < 0) return null;
  return episodes[index + 1] || null;
}

async function womoAutoNextPlayNow() {
  const nextEpisode = womoAutoNextEpisode;
  if (!nextEpisode || !currentPlayerItem || currentPlayerItem.type !== "series") return;

  womoAutoNextHide();

  try {
    if (!womoAutoNextIsShuffle()) {
      if (typeof saveActiveEpisodeProgress === "function") saveActiveEpisodeProgress(true);
      if (typeof savePlayerProgress === "function") savePlayerProgress();
    }
  } catch (_) {}

  if (typeof openPlayer === "function") {
    openPlayer(currentPlayerItem, { episode: nextEpisode });
  }
}



function womoEllipsisText(text, maxLength = 28) {
  text = String(text || "");
  if (text.length <= maxLength) return text;
  return text.slice(0, Math.max(0, maxLength - 3)).trimEnd() + "...";
}

function womoAutoNextUpdateButtonText() {
  const playBtn = document.getElementById("womoAutoNextPlay");
  if (!playBtn) return;
  const seconds = Math.max(0, Number(womoAutoNextSeconds || 0));
  playBtn.textContent = "Siguiente en " + seconds + "s";
}

function womoAutoNextStartButtonFill() {
  const playBtn = document.getElementById("womoAutoNextPlay");
  if (!playBtn) return;
  playBtn.classList.remove("womo-next-progressing");
  playBtn.style.setProperty("--womo-next-duration", "15s");
  void playBtn.offsetWidth;
  playBtn.classList.add("womo-next-progressing");
  womoAutoNextUpdateButtonText();
}

function womoAutoNextStopButtonFill() {
  const playBtn = document.getElementById("womoAutoNextPlay");
  if (!playBtn) return;
  playBtn.classList.remove("womo-next-progressing");
}

function womoAutoNextStartCountdown(nextEpisode) {
  const key = womoAutoNextKey();
  if (!key || womoAutoNextDismissedKey === key) return;

  const overlay = womoAutoNextEnsureOverlay();
  if (!overlay) return;

  womoAutoNextEpisode = nextEpisode;
  womoAutoNextActiveKey = key;
  womoAutoNextSeconds = 15;

  const title = overlay.querySelector("#womoAutoNextTitle");
  const count = overlay.querySelector("#womoAutoNextCount");
  const meta = overlay.querySelector("#womoAutoNextMeta");

  if (title) {
    title.textContent = currentPlayerItem?.title || currentPlayerItem?.name || "Serie";
  }
  if (meta) {
    const episodeName = nextEpisode.title || nextEpisode.name || "";
    const episodeLabel = "T" + (nextEpisode.season || 1) + " E" + (nextEpisode.episodeNumber || nextEpisode.episode || 1);
    meta.textContent = episodeName ? womoEllipsisText(episodeLabel + " - " + episodeName, 32) : episodeLabel;
  }
  if (count) count.textContent = String(womoAutoNextSeconds);
  womoAutoNextUpdateButtonText();

  womoAutoNextStartButtonFill();
  overlay.classList.remove("hidden");
  overlay.style.display = "";

  womoAutoNextClearTimer();
  womoAutoNextTimer = setInterval(function() {
    womoAutoNextSeconds -= 1;
    if (count) count.textContent = String(Math.max(0, womoAutoNextSeconds));
    womoAutoNextUpdateButtonText();
    if (womoAutoNextSeconds <= 0) {
      womoAutoNextClearTimer();
      womoAutoNextPlayNow();
    }
  }, 1000);
}

async function womoAutoNextCheck() {
  const video = document.getElementById("womoPlayer") || document.querySelector("#playerOverlay video") || document.querySelector(".player-overlay video");
  if (!video) return;

  if (!currentPlayerItem || currentPlayerItem.type !== "series" || !currentPlayerEpisode || womoAutoNextIsShuffle()) {
    womoAutoNextHide();
    return;
  }

  if (!video.duration || !Number.isFinite(video.duration) || video.duration <= 0) return;

  const remaining = video.duration - video.currentTime;
  const key = womoAutoNextKey();

  if (remaining > 19) return;
  if (remaining <= 17 && !womoAutoNextActiveKey && womoAutoNextDismissedKey !== key) {
    const nextEpisode = await womoAutoNextFindNextEpisode();
    if (nextEpisode) womoAutoNextStartCountdown(nextEpisode);
  }
}

function womoAutoNextBindVideo() {
  const video = document.getElementById("womoPlayer") || document.querySelector("#playerOverlay video") || document.querySelector(".player-overlay video");
  if (!video || video.dataset.womoAutoNextBound === "true") return;

  video.dataset.womoAutoNextBound = "true";

  video.addEventListener("timeupdate", function() {
    womoAutoNextCheck();
  });

  video.addEventListener("seeking", function() {
    womoAutoNextHide();
  });

  video.addEventListener("ended", async function() {
    if (!currentPlayerItem || currentPlayerItem.type !== "series" || womoAutoNextIsShuffle()) {
      womoAutoNextHide();
      return;
    }

    const nextEpisode = womoAutoNextEpisode || await womoAutoNextFindNextEpisode();
    if (!nextEpisode) {
      womoAutoNextHide();
      return;
    }

    womoAutoNextEpisode = nextEpisode;
    womoAutoNextClearTimer();
    womoAutoNextPlayNow();
  });

  video.addEventListener("pause", function() {
    if (!video.ended && womoAutoNextActiveKey) {
      womoAutoNextClearTimer();
    }
  });

  video.addEventListener("play", function() {
    if (womoAutoNextActiveKey && !womoAutoNextTimer) {
      womoAutoNextTimer = setInterval(function() {
        womoAutoNextSeconds -= 1;
        const count = document.getElementById("womoAutoNextCount");
        if (count) count.textContent = String(Math.max(0, womoAutoNextSeconds));
        womoAutoNextUpdateButtonText();
        if (womoAutoNextSeconds <= 0) {
          womoAutoNextClearTimer();
          womoAutoNextPlayNow();
        }
      }, 1000);
    }
  });
}

(function(){
  if (window.__womoAutoNextOpenPlayerPatched) return;
  window.__womoAutoNextOpenPlayerPatched = true;

  const originalOpenPlayer = typeof openPlayer === "function" ? openPlayer : null;
  if (originalOpenPlayer) {
    openPlayer = function(item, options = {}) {
      womoAutoNextHide();
      womoAutoNextDismissedKey = "";
      womoClearAutoNextOverlayVisualOnly();
      const result = originalOpenPlayer.call(this, item, options);
      womoForcePlayerVisibleOnOpen();
      setTimeout(womoForcePlayerVisibleOnOpen, 40);
      setTimeout(womoForcePlayerVisibleOnOpen, 180);
      setTimeout(womoAutoNextBindVideo, 120);
      setTimeout(womoBindShuffleNextVideo, 130);
      setTimeout(function(){ const v = document.getElementById('womoPlayer'); womoBindMobileNativeFullscreen(v); }, 140);
      return result;
    };
  }

  const originalClosePlayer = typeof closePlayer === "function" ? closePlayer : null;
  if (originalClosePlayer) {
    closePlayer = function() {
      womoAutoNextHide();
      womoClearForcedPlayerVisibleState();
      return originalClosePlayer.apply(this, arguments);
    };
  }

  const originalHidePlayer = typeof hideWomoPlayerOverlay === "function" ? hideWomoPlayerOverlay : null;
  if (originalHidePlayer) {
    hideWomoPlayerOverlay = function() {
      womoAutoNextHide();
      womoClearForcedPlayerVisibleState();
      return originalHidePlayer.apply(this, arguments);
    };
  }
})();



(function(){
  if (window.__womoShuffleClickDetectorBound) return;
  window.__womoShuffleClickDetectorBound = true;
  document.addEventListener("click", womoDetectLocalShuffleClick, true);
})();



function womoRestoreOverlayActionLabels() {
  const nextCancel = document.getElementById("womoShuffleNextCancel");
  if (nextCancel) nextCancel.textContent = "Cancelar";

  const skipCancel = document.getElementById("womoShuffleSkipCancel");
  if (skipCancel) skipCancel.textContent = "Quedarse";
}
(function(){
  if (window.__womoOverlayLabelFixBound) return;
  window.__womoOverlayLabelFixBound = true;
  document.addEventListener("DOMContentLoaded", function(){ setTimeout(womoRestoreOverlayActionLabels, 120); });
  document.addEventListener("click", function(){ setTimeout(womoRestoreOverlayActionLabels, 120); }, true);
})();




/* Preview bottom fill when there are no recommendations */
function womoFixPreviewBottomWhenNoRecommendations() {
  const previews = Array.from(document.querySelectorAll("#previewModal, .preview-modal, .content-preview, .details-modal, #detailsModal"));
  previews.forEach(preview => {
    const previewRecs = preview.querySelector("#previewRecs, .preview-recs");
    const hasPreviewRecs = Boolean(
      previewRecs &&
      Array.from(previewRecs.children || []).some(child => child.offsetHeight > 0 || child.tagName === "IMG")
    );

    if (hasPreviewRecs) {
      preview.classList.remove("womo-no-preview-recommendations");
      return;
    }

    const recommendations = preview.querySelector(
      ".recommendations, .recommended, .related, .more-like-this, .preview-recommendations, .preview-related, [data-recommendations], [data-related]"
    );

    const hasVisibleRecommendations = Boolean(
      recommendations &&
      recommendations.children &&
      Array.from(recommendations.children).some(child => {
        const style = window.getComputedStyle(child);
        return style.display !== "none" && style.visibility !== "hidden" && child.offsetHeight > 0;
      })
    );

    preview.classList.toggle("womo-no-preview-recommendations", !hasVisibleRecommendations);
  });
}

(function(){
  if (window.__womoPreviewBottomFixBound) return;
  window.__womoPreviewBottomFixBound = true;

  document.addEventListener("click", () => {
    setTimeout(womoFixPreviewBottomWhenNoRecommendations, 80);
    setTimeout(womoFixPreviewBottomWhenNoRecommendations, 350);
  }, true);

  const observer = new MutationObserver(() => {
    clearTimeout(window.__womoPreviewBottomFixTimer);
    window.__womoPreviewBottomFixTimer = setTimeout(womoFixPreviewBottomWhenNoRecommendations, 80);
  });

  try {
    observer.observe(document.documentElement, { childList:true, subtree:true, attributes:true, attributeFilter:["class", "style"] });
  } catch (_) {}

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", womoFixPreviewBottomWhenNoRecommendations);
  } else {
    womoFixPreviewBottomWhenNoRecommendations();
  }
})();




/* Womo skeleton safety cleanup */
(function(){
  if (window.__womoSkeletonCleanupBound) return;
  window.__womoSkeletonCleanupBound = true;

  const tryHide = () => {
    if (typeof womoAutoHideSkeleton === "function") womoAutoHideSkeleton();
  };

  window.addEventListener("load", () => {
    setTimeout(tryHide, 250);
    setTimeout(tryHide, 900);
    setTimeout(womoHideSkeleton, 3500);
  });

  const observer = new MutationObserver(() => {
    clearTimeout(window.__womoSkeletonCleanupTimer);
    window.__womoSkeletonCleanupTimer = setTimeout(tryHide, 80);
  });

  try {
    observer.observe(document.documentElement, { childList:true, subtree:true });
  } catch (_) {}
})();



setTimeout(() => window.womoHideSkeleton?.(), 1200);



/* Final UX/player safety fixes */
(function womoFinalInteractionFixes(){
  function closePreviewSafely(){
    const modal = document.getElementById("previewModal");
    if (!modal) return;
    modal.classList.remove("open", "dragging");
    modal.style.setProperty("--sheet-y", "0px");
    document.body.classList.remove("preview-open");
  }

  function setupFinalPreviewGuards(){
    const modal = document.getElementById("previewModal");
    if (!modal || modal.dataset.finalGuards === "true") return;
    modal.dataset.finalGuards = "true";

    // Desktop: click outside card closes preview.
    modal.addEventListener("pointerdown", (event) => {
      if (window.matchMedia("(max-width: 760px)").matches) return;
      const card = event.target.closest(".preview-card");
      if (!card && modal.classList.contains("open")) {
        event.preventDefault();
        closePreviewSafely();
      }
    });

    // Mobile: sheet drag down to close.
    const card = modal.querySelector(".preview-card");
    if (!card) return;

    let startY = 0;
    let currentY = 0;
    let dragging = false;

    card.addEventListener("pointerdown", (event) => {
      if (!window.matchMedia("(max-width: 760px)").matches) return;
      // Allow normal interaction with controls.
      if (event.target.closest("button, input, select, textarea, video, a")) return;
      startY = event.clientY;
      currentY = 0;
      dragging = true;
      card.setPointerCapture?.(event.pointerId);
      modal.classList.add("dragging");
    });

    card.addEventListener("pointermove", (event) => {
      if (!dragging) return;
      currentY = Math.max(0, event.clientY - startY);
      modal.style.setProperty("--sheet-y", `${currentY}px`);
    });

    function endDrag(){
      if (!dragging) return;
      dragging = false;
      modal.classList.remove("dragging");
      if (currentY > 110) {
        closePreviewSafely();
      } else {
        modal.style.setProperty("--sheet-y", "0px");
      }
    }

    card.addEventListener("pointerup", endDrag);
    card.addEventListener("pointercancel", endDrag);
  }

  function setupPlayerReloadGuard(){
    // Many mobile browsers reload when an untyped button inside an implicit form submits.
    document.addEventListener("click", (event) => {
      const btn = event.target.closest("button");
      if (!btn) return;
      if (!btn.getAttribute("type")) btn.setAttribute("type", "button");
    }, true);

    // If a form submit sneaks in from app controls, block it.
    document.addEventListener("submit", (event) => {
      const target = event.target;
      if (target && !target.closest("#loginForm")) {
        event.preventDefault();
        event.stopPropagation();
      }
    }, true);

    const playerOverlay = document.getElementById("playerOverlay");
    if (playerOverlay && playerOverlay.dataset.reloadGuard !== "true") {
      playerOverlay.dataset.reloadGuard = "true";
      playerOverlay.addEventListener("click", (event) => {
        event.stopPropagation();
      }, true);
    }
  }

  function setupTopSettings(){
    document.querySelectorAll(".top-settings-btn").forEach(btn => {
      if (btn.dataset.finalReady === "true") return;
      btn.dataset.finalReady = "true";
      btn.setAttribute("type", "button");
      btn.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (typeof changePage === "function") {
          changePage("settings");
          if (typeof setupSettings === "function") setupSettings();
        }
      });
    });
  }

  document.addEventListener("DOMContentLoaded", () => {
    setupFinalPreviewGuards();
    setupPlayerReloadGuard();
    setupTopSettings();
  });

  setTimeout(() => {
    setupFinalPreviewGuards();
    setupPlayerReloadGuard();
    setupTopSettings();
  }, 500);

  const originalPushState = history.pushState;
  history.pushState = function(){
    return originalPushState.apply(this, arguments);
  };
})();




/* Final mobile preview sheet controls */
(function womoPreviewSheetFinal(){
  function getPreviewModal(){
    return document.getElementById("previewModal");
  }

  function closePreviewFinal(){
    const modal = getPreviewModal();
    if (!modal) return;
    modal.classList.remove("open", "dragging");
    modal.style.setProperty("--sheet-y", "0px");
    document.body.classList.remove("preview-open");
  }

  function setupPreviewSheetFinal(){
    const modal = getPreviewModal();
    if (!modal || modal.dataset.sheetFinal === "true") return;
    modal.dataset.sheetFinal = "true";

    modal.addEventListener("pointerdown", (event) => {
      if (!modal.classList.contains("open")) return;
      const card = event.target.closest(".preview-card");
      if (!card) {
        event.preventDefault();
        closePreviewFinal();
      }
    });

    const closeBtn = modal.querySelector("#previewClose, .preview-close");
    if (closeBtn) {
      closeBtn.setAttribute("type", "button");
      closeBtn.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        closePreviewFinal();
      });
    }

    const card = modal.querySelector(".preview-card");
    if (!card) return;

    let startY = 0;
    let currentY = 0;
    let dragging = false;

    card.addEventListener("pointerdown", (event) => {
      if (!window.matchMedia("(max-width: 760px)").matches) return;
      if (event.target.closest("button, input, select, textarea, video, a")) return;
      startY = event.clientY;
      currentY = 0;
      dragging = true;
      modal.classList.add("dragging");
      card.setPointerCapture?.(event.pointerId);
    });

    card.addEventListener("pointermove", (event) => {
      if (!dragging) return;
      currentY = Math.max(0, event.clientY - startY);
      modal.style.setProperty("--sheet-y", `${currentY}px`);
    });

    function finishDrag(){
      if (!dragging) return;
      dragging = false;
      modal.classList.remove("dragging");
      if (currentY > 110) {
        closePreviewFinal();
      } else {
        modal.style.setProperty("--sheet-y", "0px");
      }
    }

    card.addEventListener("pointerup", finishDrag);
    card.addEventListener("pointercancel", finishDrag);
  }

  function setupSettingsTopFinal(){
    document.querySelectorAll(".top-settings-btn").forEach(btn => {
      if (btn.dataset.sheetFinal === "true") return;
      btn.dataset.sheetFinal = "true";
      btn.setAttribute("type", "button");
      btn.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (typeof changePage === "function") changePage("settings");
        if (typeof setupSettings === "function") setupSettings();
      });
    });
  }

  document.addEventListener("DOMContentLoaded", () => {
    setupPreviewSheetFinal();
    setupSettingsTopFinal();
  });
  setTimeout(() => {
    setupPreviewSheetFinal();
    setupSettingsTopFinal();
  }, 500);
  window.womoClosePreviewFinal = closePreviewFinal;
})();




/* Final preview buttons + sheet interaction repair */
(function womoModalButtonsRepair(){
  function modal(){ return document.getElementById("previewModal"); }
  function card(){ return modal()?.querySelector(".preview-card"); }

  function closePreview(){
    const m = modal();
    if (!m) return;
    m.classList.remove("open", "dragging");
    m.style.setProperty("--sheet-y", "0px");
    document.body.classList.remove("preview-open");
  }

  function bindPreviewControls(){
    const m = modal();
    if (!m || m.dataset.buttonsRepair === "true") return;
    m.dataset.buttonsRepair = "true";

    // Outside tap closes, but taps inside do not block the app's existing button listeners.
    m.addEventListener("pointerdown", (event) => {
      if (!m.classList.contains("open")) return;
      if (!event.target.closest(".preview-card")) {
        event.preventDefault();
        closePreview();
      }
    });

    // Volver/cerrar
    m.querySelectorAll("#previewClose, .preview-close").forEach(btn => {
      btn.setAttribute("type", "button");
      btn.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        closePreview();
      });
    });

    // Favorito fallback
    m.querySelectorAll("#previewFavorite, #previewFav, .preview-fav, .preview-favorite, .preview-fav-btn").forEach(btn => {
      btn.setAttribute("type", "button");
      btn.addEventListener("click", (event) => {
        if (btn.dataset.womoFavoriteFallback === "true") return;
        // Let original handler run first when present.
        setTimeout(() => {
          const item = window.currentPreviewItem || window.womoCurrentPreviewItem || null;
          if (!item || typeof toggleFavoriteItem !== "function") return;
          // If original did nothing, fallback toggle.
          if (!event.defaultPrevented) {
            const active = toggleFavoriteItem(item);
            btn.classList.toggle("active", active);
          }
        }, 0);
      });
    });

    // Safety: all modal buttons are button type, never submit.
    m.querySelectorAll("button").forEach(btn => btn.setAttribute("type", "button"));

    // Drag down to close, but never starts on interactive controls.
    const c = card();
    if (!c) return;
    let startY = 0;
    let currentY = 0;
    let dragging = false;

    c.addEventListener("pointerdown", (event) => {
      if (!window.matchMedia("(max-width: 760px)").matches) return;
      if (event.target.closest("button, input, select, textarea, video, a")) return;
      startY = event.clientY;
      currentY = 0;
      dragging = true;
      m.classList.add("dragging");
      c.setPointerCapture?.(event.pointerId);
    });

    c.addEventListener("pointermove", (event) => {
      if (!dragging) return;
      currentY = Math.max(0, event.clientY - startY);
      m.style.setProperty("--sheet-y", `${currentY}px`);
    });

    const end = () => {
      if (!dragging) return;
      dragging = false;
      m.classList.remove("dragging");
      if (currentY > 110) closePreview();
      else m.style.setProperty("--sheet-y", "0px");
    };
    c.addEventListener("pointerup", end);
    c.addEventListener("pointercancel", end);
  }

  // Re-bind whenever preview opens because the app may rewrite modal buttons.
  document.addEventListener("click", () => setTimeout(bindPreviewControls, 0), true);
  document.addEventListener("DOMContentLoaded", bindPreviewControls);
  setTimeout(bindPreviewControls, 500);
  window.womoClosePreview = closePreview;
})();



/* Final player close + loader + mobile landscape guard */
(function(){
  if (window.__womoPlayerCloseFinalBound) return;
  window.__womoPlayerCloseFinalBound = true;

  document.addEventListener('click', function(event){
    const close = event.target && event.target.closest && event.target.closest('#playerBack, .player-back, .player-close, [data-player-close]');
    if (!close) return;
    event.preventDefault();
    event.stopPropagation();
    if (typeof closePlayer === 'function') closePlayer();
  }, true);

  window.addEventListener('orientationchange', function(){
    const overlay = document.getElementById('playerOverlay');
    const video = document.getElementById('womoPlayer');
    if (overlay && overlay.classList.contains('open') && video) {
      setTimeout(function(){
        try { womoTryMobileNativeFullscreen(video); } catch (_) {}
        try { womoLockMobileLandscape(); } catch (_) {}
      }, 180);
    }
  });
})();


/* 2026-06-29 strict player loader, reliable close, mobile landscape force */
(function(){
  if (window.__womoStrictPlayerPatch2706) return;
  window.__womoStrictPlayerPatch2706 = true;

  function overlay(){ return document.getElementById('playerOverlay') || document.querySelector('.player-overlay'); }
  function video(){ return document.getElementById('womoPlayer') || document.querySelector('#playerOverlay video, .player-overlay video'); }

  let womoLoaderShowTimer = null;
  let womoLoaderHideTimer = null;
  let womoLoaderHasStarted = false;
  let womoLoaderVisibleSince = 0;
  let womoLoaderLastHideAt = 0;

  function clearLoaderTimers(){
    if (womoLoaderShowTimer) clearTimeout(womoLoaderShowTimer);
    if (womoLoaderHideTimer) clearTimeout(womoLoaderHideTimer);
    womoLoaderShowTimer = null;
    womoLoaderHideTimer = null;
  }

  function resetSmoothLoaderState(){
    clearLoaderTimers();
    womoLoaderHasStarted = false;
    womoLoaderVisibleSince = 0;
    womoLoaderLastHideAt = 0;
    const o = overlay();
    if (o) {
      o.classList.remove('womo-player-buffering-smooth');
      o.classList.remove('womo-player-initial-loading');
    }
  }

  function applyLoaderVisible(mode){
    const o = overlay();
    const v = video();
    if (o) {
      o.classList.add('womo-strict-video-loading');
      o.classList.add('is-video-loading');
      o.classList.toggle('womo-player-initial-loading', mode === 'initial');
      o.classList.toggle('womo-player-buffering-smooth', mode !== 'initial');
    }
    if (v) {
      if (mode === 'initial') {
        try { v.controls = false; } catch (_) {}
      }
      try { v.setAttribute('controlsList', 'nodownload noplaybackrate'); } catch (_) {}
      try { v.setAttribute('playsinline', ''); v.setAttribute('webkit-playsinline', ''); } catch (_) {}
    }
    womoLoaderVisibleSince = Date.now();
  }

  function showStrictLoader(reason){
    const v = video();
    const o = overlay();
    if (!o) return;

    const currentTime = v ? Number(v.currentTime || 0) : 0;
    const readyState = v ? Number(v.readyState || 0) : 0;
    const isInitial = !womoLoaderHasStarted && currentTime < 0.35 && readyState < 3;
    const isPausedBuffer = v && v.paused && !v.seeking && reason !== 'loadstart' && reason !== 'initial';
    if (isPausedBuffer) return;

    if (womoLoaderShowTimer) clearTimeout(womoLoaderShowTimer);
    if (womoLoaderHideTimer) clearTimeout(womoLoaderHideTimer);
    womoLoaderShowTimer = null;
    womoLoaderHideTimer = null;

    if (isInitial || reason === 'initial' || reason === 'loadstart') {
      applyLoaderVisible('initial');
      return;
    }

    // During active playback, wait before showing the spinner. This prevents
    // Safari/iOS micro-buffer events from looking like player flicker.
    const sinceLastHide = Date.now() - womoLoaderLastHideAt;
    const delay = reason === 'seeking' ? 520 : (sinceLastHide < 700 ? 1100 : 850);
    womoLoaderShowTimer = setTimeout(function(){
      const vv = video();
      if (!vv || vv.ended) return;
      if (vv.readyState >= 3 && !vv.seeking) return;
      if (vv.paused && !vv.seeking) return;
      applyLoaderVisible('buffering');
    }, delay);
  }

  function hideStrictLoader(){
    const o = overlay();
    const v = video();
    if (v && (Number(v.currentTime || 0) > 0 || v.readyState >= 3)) womoLoaderHasStarted = true;
    if (womoLoaderShowTimer) clearTimeout(womoLoaderShowTimer);
    womoLoaderShowTimer = null;

    const visibleFor = womoLoaderVisibleSince ? Date.now() - womoLoaderVisibleSince : 0;
    const delay = visibleFor > 0 && visibleFor < 180 ? 180 - visibleFor : 80;
    if (womoLoaderHideTimer) clearTimeout(womoLoaderHideTimer);
    womoLoaderHideTimer = setTimeout(function(){
      const oo = overlay();
      const vv = video();
      if (oo) {
        oo.classList.remove('womo-strict-video-loading');
        oo.classList.remove('is-video-loading');
        oo.classList.remove('womo-player-buffering-smooth');
        oo.classList.remove('womo-player-initial-loading');
      }
      if (vv) {
        try { vv.controls = true; } catch (_) {}
      }
      womoLoaderVisibleSince = 0;
      womoLoaderLastHideAt = Date.now();
    }, delay);
  }

  window.womoSetSmartPlayerLoading = function(loading, reason){
    if (loading) showStrictLoader(reason || 'direct');
    else hideStrictLoader();
  };

  function forceMobileLandscapeShell(){
    const o = overlay();
    const v = video();
    if (!o || !v) return;
    if (typeof womoIsMobileViewport === 'function' && !womoIsMobileViewport()) return;
    document.body.classList.add('womo-mobile-landscape-player');
    try { v.setAttribute('playsinline', ''); v.setAttribute('webkit-playsinline', ''); } catch (_) {}
    try { if (typeof womoLockMobileLandscape === 'function') womoLockMobileLandscape(); } catch (_) {}
  }

  // Do not enter native iOS fullscreen automatically. It can stay portrait and ignores our UI.
  // We keep the custom player shell and rotate the video visually when the device is portrait.
  window.womoTryMobileNativeFullscreen = function(v){
    forceMobileLandscapeShell();
    try { if (typeof womoPrepareVideoForLandscape === 'function') womoPrepareVideoForLandscape(v || video()); } catch (_) {}
    try { if (typeof womoLockMobileLandscape === 'function') womoLockMobileLandscape(); } catch (_) {}
  };

  function reallyClosePlayer(){
    try { hideStrictLoader(); } catch (_) {}
    try { document.body.classList.remove('womo-mobile-landscape-player'); } catch (_) {}
    try { if (typeof womoUnlockMobileOrientation === 'function') womoUnlockMobileOrientation(); } catch (_) {}

    const v = video();
    try { if (v && typeof v.webkitExitFullscreen === 'function') v.webkitExitFullscreen(); } catch (_) {}
    try { if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen(); } catch (_) {}
    try { if (document.webkitFullscreenElement && document.webkitExitFullscreen) document.webkitExitFullscreen(); } catch (_) {}

    if (typeof closePlayer === 'function') {
      try { closePlayer(); } catch (error) { console.warn('Womo closePlayer fallback used.', error); }
    }

    const o = overlay();
    if (v) {
      try { v.pause(); } catch (_) {}
      try { v.removeAttribute('src'); v.load(); } catch (_) {}
    }
    if (o) {
      o.classList.remove('open','active','show','show-controls','controls-visible','is-video-loading','womo-strict-video-loading','womo-player-buffering-smooth','womo-player-initial-loading');
      o.classList.add('hidden');
      o.setAttribute('aria-hidden','true');
      o.style.display = 'none';
    }
    document.body.classList.remove('player-open','womo-mobile-landscape-player');
  }

  function bindCloseButton(){
    const btn = document.getElementById('playerBack') || document.querySelector('.player-back, .player-close, [data-player-close]');
    if (!btn || btn.dataset.womoStrictCloseBound === 'true') return;
    btn.dataset.womoStrictCloseBound = 'true';
    btn.setAttribute('type','button');
    btn.setAttribute('data-player-close','true');
    ['pointerdown','touchstart','click'].forEach(function(eventName){
      btn.addEventListener(eventName, function(event){
        event.preventDefault();
        event.stopPropagation();
        reallyClosePlayer();
      }, { capture:true });
    });
  }

  function bindStrictVideoEvents(){
    const v = video();
    if (!v) return;
    bindCloseButton();
    forceMobileLandscapeShell();
    showStrictLoader('initial');

    if (v.dataset.womoStrictLoaderBound !== 'true') {
      v.dataset.womoStrictLoaderBound = 'true';
      v.addEventListener('loadstart', function(){ showStrictLoader('loadstart'); });
      v.addEventListener('waiting', function(){ showStrictLoader('waiting'); });
      v.addEventListener('stalled', function(){ showStrictLoader('stalled'); });
      v.addEventListener('seeking', function(){ showStrictLoader('seeking'); });
      v.addEventListener('playing', hideStrictLoader);
      v.addEventListener('timeupdate', function(){
        if (Number(v.currentTime || 0) > 0 || v.readyState >= 3) hideStrictLoader();
      });
      v.addEventListener('canplay', function(){
        // Keep loader until actual playback starts. Enable controls only if autoplay was blocked.
        setTimeout(function(){
          if (v.paused && !v.ended) {
            try { v.controls = true; } catch (_) {}
          }
        }, 1600);
      });
      v.addEventListener('error', function(){
        const o = overlay();
        if (o) o.classList.remove('womo-strict-video-loading','is-video-loading','womo-player-buffering-smooth','womo-player-initial-loading');
        try { v.controls = true; } catch (_) {}
      });
    }
  }

  const originalOpenPlayer = typeof openPlayer === 'function' ? openPlayer : null;
  if (originalOpenPlayer) {
    openPlayer = function(item, options){
      const result = originalOpenPlayer.apply(this, arguments);
      resetSmoothLoaderState();
      showStrictLoader('initial');
      bindStrictVideoEvents();
      forceMobileLandscapeShell();
      setTimeout(function(){ showStrictLoader('initial'); bindStrictVideoEvents(); forceMobileLandscapeShell(); }, 30);
      setTimeout(function(){ bindStrictVideoEvents(); forceMobileLandscapeShell(); }, 180);
      return result;
    };
  }

  document.addEventListener('click', function(event){
    const target = event.target && event.target.closest ? event.target.closest('#playerBack, .player-back, .player-close, [data-player-close]') : null;
    if (!target) return;
    event.preventDefault();
    event.stopPropagation();
    reallyClosePlayer();
  }, true);

  document.addEventListener('keydown', function(event){
    if (event.key !== 'Escape') return;
    const o = overlay();
    if (o && (o.classList.contains('open') || document.body.classList.contains('player-open'))) {
      event.preventDefault();
      reallyClosePlayer();
    }
  }, true);

  document.addEventListener('DOMContentLoaded', function(){
    bindCloseButton();
    setTimeout(bindCloseButton, 500);
  });

  window.addEventListener('orientationchange', function(){
    setTimeout(function(){
      const o = overlay();
      if (o && o.classList.contains('open')) forceMobileLandscapeShell();
    }, 120);
  });
})();


/* 2026-06-29 preview series shuffle hard fix */
(function(){
  if (window.__womoPreviewSeriesShuffleHardFix) return;
  window.__womoPreviewSeriesShuffleHardFix = true;

  document.addEventListener('click', async function(event){
    const btn = event.target && event.target.closest ? event.target.closest('[data-preview-shuffle]') : null;
    if (!btn) return;
    event.preventDefault();
    event.stopPropagation();

    const item = window.currentPreviewItem || currentPreviewItem || null;
    if (!item || item.type !== 'series') return;

    try {
      if (typeof womoStartShuffleSession === 'function') womoStartShuffleSession('series', item.id);
      window.__womoNextShuffleScope = 'series';

      let picked = null;
      if (typeof womoPickRandomShuffleEpisode === 'function') picked = await womoPickRandomShuffleEpisode();
      let episode = picked && picked.episode ? picked.episode : null;

      if (!episode && typeof readSeriesEpisodes === 'function') {
        const episodes = await readSeriesEpisodes(item.id);
        const playable = (episodes || []).filter(function(ep){
          return Boolean(ep && (ep.hlsUrl || ep.videoUrl || ep.videoURL || ep.url || ep.streamUrl || ep.playbackUrl));
        });
        episode = playable.length ? playable[Math.floor(Math.random() * playable.length)] : null;
      }

      if (!episode) return;
      openPlayer((picked && picked.seriesItem) || item, {
        episode: episode,
        startAt: 0,
        saveProgress: false,
        shuffleMode: true,
        fromShuffle: true,
        noProgress: true,
        shuffleScope: 'series',
        shuffleSeriesId: item.id
      });
    } catch (error) {
      console.warn('Womo preview series shuffle failed.', error);
    }
  }, true);
})();

/* 2026-06-29 shuffle next hard fix: robust next-button handling for universal/local shuffle */
(function(){
  if (window.__womoShuffleNextHardFixBound) return;
  window.__womoShuffleNextHardFixBound = true;

  function isShuffleNextButton(target) {
    if (!target || !target.closest) return false;
    return Boolean(target.closest('#womoShuffleNextPlay, #womoShuffleSkipPlay'));
  }

  function runShuffleNextFromButton(target) {
    const btn = target && target.closest ? target.closest('#womoShuffleNextPlay, #womoShuffleSkipPlay') : null;
    if (!btn) return;

    if (btn.id === 'womoShuffleSkipPlay') {
      if (typeof womoPlayUniversalShuffleSkip === 'function') womoPlayUniversalShuffleSkip();
      return;
    }

    if (btn.id === 'womoShuffleNextPlay') {
      if (typeof womoPlayNextShuffleEpisode === 'function') womoPlayNextShuffleEpisode();
    }
  }

  ['pointerdown', 'touchstart', 'click'].forEach(function(type){
    document.addEventListener(type, function(event){
      if (!isShuffleNextButton(event.target)) return;
      event.preventDefault();
      event.stopPropagation();
      if (event.stopImmediatePropagation) event.stopImmediatePropagation();
      runShuffleNextFromButton(event.target);
    }, true);
  });

  // Keep the buttons above the rotated mobile player and native video layer.
  function reinforceShuffleNextLayer() {
    ['womoShuffleNextOverlay', 'womoShuffleSkipOverlay'].forEach(function(id){
      const overlay = document.getElementById(id);
      if (!overlay) return;
      overlay.style.pointerEvents = 'auto';
      overlay.style.zIndex = '2147483030';
      const btn = overlay.querySelector('button');
      if (btn) {
        btn.style.pointerEvents = 'auto';
        btn.style.touchAction = 'manipulation';
      }
    });
  }

  setInterval(reinforceShuffleNextLayer, 600);
})();


/* 2026-06-29 final fixes: preview poster fallback + shuffle button lower-right + seek resume */
(function(){
  if (window.__womoFinalDeskMobilePlayerFixes) return;
  window.__womoFinalDeskMobilePlayerFixes = true;

  function getPlayerVideo(){
    return document.getElementById('womoPlayer') || document.querySelector('#playerOverlay video, .player-overlay video');
  }
  function getPlayerOverlay(){
    return document.getElementById('playerOverlay') || document.querySelector('.player-overlay');
  }

  function bindSeekResume(){
    const video = getPlayerVideo();
    if (!video || video.dataset.womoSeekResumeBound === 'true') return;
    video.dataset.womoSeekResumeBound = 'true';

    let shouldResumeAfterSeek = false;
    let seekWatchdog = null;

    function playerIsOpen(){
      const overlay = getPlayerOverlay();
      return Boolean(overlay && (overlay.classList.contains('open') || document.body.classList.contains('player-open')));
    }

    function clearWatchdog(){
      if (seekWatchdog) {
        clearTimeout(seekWatchdog);
        seekWatchdog = null;
      }
    }

    function tryResume(reason){
      if (!playerIsOpen()) return;
      if (!shouldResumeAfterSeek) return;
      if (!video.src && !video.currentSrc) return;
      if (video.ended) return;
      try {
        const playPromise = video.play();
        if (playPromise && typeof playPromise.catch === 'function') {
          playPromise.catch(function(error){
            // If autoplay is blocked, leave native controls enabled instead of freezing behind the loader.
            try { video.controls = true; } catch (_) {}
            console.warn('Womo seek resume blocked:', reason, error);
          });
        }
      } catch (error) {
        try { video.controls = true; } catch (_) {}
      }
    }

    video.addEventListener('seeking', function(){
      shouldResumeAfterSeek = !video.paused && !video.ended;
      clearWatchdog();
      seekWatchdog = setTimeout(function(){
        if (shouldResumeAfterSeek && playerIsOpen() && (video.paused || video.readyState < 2)) {
          tryResume('seek-watchdog');
        }
      }, 1200);
    });

    video.addEventListener('seeked', function(){
      clearWatchdog();
      setTimeout(function(){ tryResume('seeked'); }, 80);
      setTimeout(function(){ tryResume('seeked-late'); }, 420);
    });

    ['canplay','canplaythrough','loadeddata'].forEach(function(eventName){
      video.addEventListener(eventName, function(){
        setTimeout(function(){ tryResume(eventName); }, 60);
      });
    });

    video.addEventListener('playing', function(){
      clearWatchdog();
      shouldResumeAfterSeek = false;
    });

    video.addEventListener('pause', function(){
      // A real user pause after the seek should cancel auto-resume.
      setTimeout(function(){
        if (!video.seeking) shouldResumeAfterSeek = false;
      }, 500);
    });
  }

  const originalOpenPlayer = typeof openPlayer === 'function' ? openPlayer : null;
  if (originalOpenPlayer) {
    openPlayer = function(){
      const result = originalOpenPlayer.apply(this, arguments);
      setTimeout(bindSeekResume, 0);
      setTimeout(bindSeekResume, 200);
      return result;
    };
  }

  document.addEventListener('DOMContentLoaded', function(){
    try { womoBindPreviewPosterFallback(); } catch (_) {}
    bindSeekResume();
  });
})();
