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

function upsertContinueItem(item, progress = null) {
  if (!item) return;
  const newEntry = {
    id: item.id,
    type: item.type,
    progress: progress ?? item.progress ?? 5,
    lastWatchedAt: Date.now()
  };
  const state = loadContinueState().filter(entry => !(entry.id === item.id && entry.type === item.type));
  state.unshift(newEntry);
  saveContinueState(state);
  saveContinueEntryToCloud(newEntry);
  refreshContinueRow();
}

let allItemsByContinueKey = new Map();

function buildContinueItems(fallbackList = []) {
  const state = loadContinueState();
  if (state.length) {
    return state
      .sort((a, b) => (b.lastWatchedAt || 0) - (a.lastWatchedAt || 0))
      .map(entry => {
        const item = allItemsByContinueKey.get(`${entry.type}:${entry.id}`);
        return item ? { ...item, progress: entry.progress || item.progress || 5 } : null;
      })
      .filter(Boolean);
  }

  return fallbackList.slice(0, 10).map((item, index) => ({
    ...item,
    progress: item.progress || [62, 18, 44, 75, 28, 53, 36, 81, 12, 67][index % 10]
  }));
}

function refreshContinueRow() {
  if (!allItemsByContinueKey.size) return;
  const items = buildContinueItems([...allItemsByContinueKey.values()]);
  fillRow("continueRow", items, true, true);
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

async function readHomeConfigNewItems(allByKey) {
  try {
    const doc = await db.collection("homeConfig").doc("main").get();
    if (!doc.exists) return [];

    const sections = doc.data().sections || {};
    const newSection = sections.new || sections.news || sections.hero || {};
    const selectedItems = Array.isArray(newSection.selectedItems) ? newSection.selectedItems : [];

    return selectedItems
      .map(ref => allByKey.get(`${ref.type}:${ref.id}`))
      .filter(Boolean)
      .slice(0, Number(newSection.limit || 5));
  } catch (error) {
    console.warn("No se pudo leer homeConfig/main.", error);
    return [];
  }
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
  const duration = data.duration ? `${data.duration} min` : (data.runtime ? `${data.runtime} min` : "");

  return {
    id: docSnap.id,
    title,
    duration,
    year: data.year || "",
    genre,
    description: data.synopsis || data.description || "",
    poster: data.posterUrl || data.poster || data.imageUrl || "",
    hlsUrl: data.hlsUrl || data.videoUrl || data.url || "",
    isFavorite: Boolean(data.isFavorite),
    createdAt: toMillis(data.createdAt),
    progress: data.progress || 0,
    type: genre.toLowerCase().includes("concierto") ? "concert" : "movie"
  };
}

function normalizeSeries(docSnap) {
  const data = docSnap.data();
  const title = data.title || data.name || cleanTitleFromId(docSnap.id);
  const genre = normalizeGenres(data.genres || data.genre);

  return {
    id: docSnap.id,
    title,
    duration: data.seasons ? `${data.seasons} temporada${data.seasons === 1 ? "" : "s"}` : "Serie",
    year: data.year || "",
    genre,
    description: data.synopsis || data.description || "",
    poster: data.posterUrl || data.poster || data.imageUrl || "",
    isFavorite: Boolean(data.isFavorite),
    createdAt: toMillis(data.createdAt),
    progress: data.progress || 0,
    type: "series"
  };
}

async function readCollection(name, normalizer) {
  try {
    const snapshot = await db.collection(name).orderBy("createdAt", "desc").limit(60).get();
    return snapshot.docs.map(normalizer);
  } catch (error) {
    console.warn(`No se pudo leer ${name} con orden. Intentando sin orden.`, error);
    try {
      const snapshot = await db.collection(name).get();
      return snapshot.docs.map(normalizer).sort((a, b) => b.createdAt - a.createdAt);
    } catch (fallbackError) {
      console.error(`No se pudo leer ${name}.`, fallbackError);
      return [];
    }
  }
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

function fillRow(id, data, progress = false, hideWhenEmpty = false) {
  const row = document.getElementById(id);
  if (!row) return;

  const section = row.closest(".content-row");
  if (section && hideWhenEmpty) {
    section.classList.toggle("hidden", !data.length);
  }

  row.innerHTML = data.length
    ? data.map(item => posterCard(item, progress)).join("")
    : `<div class="row-empty">Sin contenido por ahora.</div>`;

  row.querySelectorAll(".poster-card").forEach(card => {
    card.addEventListener("click", () => {
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

function runEdgeScroll() {
  if (!activeScrollRow || scrollDirection === 0) {
    stopEdgeScroll();
    return;
  }

  activeScrollRow.scrollLeft += scrollDirection * 8;
  edgeScrollFrame = requestAnimationFrame(runEdgeScroll);
}

function setupRowEdgeScroll() {
  document.querySelectorAll(".poster-row").forEach(row => {
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

function searchMatches(item, query) {
  if (!query) return true;
  const haystack = [
    item.title,
    item.genre,
    item.genres,
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
    if (title) title.textContent = "Buscar";
    if (grid) grid.innerHTML = "";
    return;
  }

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

function setupNavigation() {
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


async function deleteCollectionDocs(collectionRef) {
  const snapshot = await collectionRef.get();
  if (snapshot.empty) return;
  const batch = db.batch();
  snapshot.docs.forEach(doc => batch.delete(doc.ref));
  await batch.commit();
}

async function clearUserMemory() {
  const userRef = getUserDocRef();
  if (!userRef) return;

  const confirmed = confirm("¿Seguro que quieres borrar toda tu memoria de Womo? Se eliminarán favoritos, progreso y episodios vistos.");
  if (!confirmed) return;

  try {
    await Promise.all([
      deleteCollectionDocs(userRef.collection("favorites")),
      deleteCollectionDocs(userRef.collection("continueWatching")),
      deleteCollectionDocs(userRef.collection("episodeProgress"))
    ]);
  } catch (error) {
    console.warn("No se pudo borrar toda la memoria en Firebase.", error);
  }

  localStorage.removeItem(FAVORITES_KEY);
  localStorage.removeItem(CONTINUE_KEY);
  localStorage.removeItem(EPISODE_PROGRESS_KEY);

  getAllCatalogItems().forEach(item => {
    item.isFavorite = false;
    item.progress = 0;
  });

  syncFavoriteUI();
  renderFavorites();
  refreshContinueRow();

  alert("Memoria borrada.");
}

async function logoutCurrentDevice() {
  try {
    await firebase.auth().signOut();
  } catch (error) {
    console.warn("No se pudo cerrar sesión.", error);
  }
}

async function logoutEverywhere() {
  const confirmed = confirm("¿Cerrar sesión en todos lados? Tendrás que iniciar sesión de nuevo en tus dispositivos.");
  if (!confirmed) return;

  try {
    const user = firebase.auth().currentUser;
    if (user) {
      await user.getIdToken(true);
    }
    await firebase.auth().signOut();
  } catch (error) {
    console.warn("No se pudo cerrar en todos lados.", error);
    await logoutCurrentDevice();
  }
}

function setupSettings() {
  const clearBtn = document.getElementById("clearMemoryBtn");
  const logoutEverywhereBtn = document.getElementById("logoutEverywhereBtn");
  const logoutBtn = document.getElementById("logoutBtn");

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

async function init() {
  setupNavigation();
  setupSettings();

  const [movies, series] = await Promise.all([
    readCollection("movies", normalizeMovie),
    readCollection("series", normalizeSeries)
  ]);

  const allItems = [...movies, ...series].filter(item => item.poster);
  const sortedItems = allItems.sort((a, b) => b.createdAt - a.createdAt);
  allItemsByContinueKey = new Map(allItems.map(item => [`${item.type}:${item.id}`, item]));
  syncFavoriteUI();
  const allByKey = new Map(allItems.map(item => [`${item.type === "series" ? "series" : "movie"}:${item.id}`, item]));
  const configuredNewItems = await readHomeConfigNewItems(allByKey);
  heroItems = configuredNewItems.length ? configuredNewItems : sortedItems.slice(0, 5);
  if (!heroItems.length) heroItems = fallbackItems;
  heroIndex = 0;

  const movieItems = movies.filter(item => item.type === "movie");
  const concertItems = movies.filter(item => item.type === "concert");
  const continueItems = buildContinueItems(sortedItems);

  setHero(0);
  fillRow("continueRow", continueItems, true, true);
  fillRow("moviesRow", movieItems, false, true);
  fillRow("seriesRow", series, false, true);
  fillRow("concertsRow", concertItems, false, true);
  setupRowEdgeScroll();
  renderSearchResults();
  renderFavorites();
  syncFavoriteUI();

  if (window.lucide) lucide.createIcons();
}

init();

function genreTokens(item) {
  const source = Array.isArray(item.genres) ? item.genres.join(',') : (item.genre || item.genres || '');
  return String(source)
    .toLowerCase()
    .split(',')
    .map(value => value.trim())
    .filter(Boolean);
}

function getPreviewRecommendations(item) {
  const all = [...allItemsByContinueKey.values()].filter(x => x.id !== item.id);

  if (item.type === 'series') return [];

  if (item.type === 'concert') {
    return all.filter(x => x.type === 'concert').slice(0, 8);
  }

  const currentGenres = genreTokens(item);
  if (!currentGenres.length) return [];

  return all
    .filter(x => x.type === 'movie')
    .filter(x => genreTokens(x).some(genre => currentGenres.includes(genre)))
    .slice(0, 8);
}


const EPISODE_PROGRESS_KEY = "womo_episode_progress";

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
        hlsUrl: data.hlsUrl || data.videoUrl || data.url || ""
      };
    }).sort((a, b) => (a.season - b.season) || (a.episodeNumber - b.episodeNumber));
  } catch (error) {
    console.warn("No se pudieron leer episodios de la serie.", error);
    return [];
  }
}

function getSeriesContinueLabel(item, episodes) {
  const state = loadContinueState().find(x => x.id === item.id && x.type === item.type);
  const season = state?.season || episodes[0]?.season || 1;
  const episode = state?.episode || episodes[0]?.episodeNumber || 1;
  const started = Boolean(state || Number(item.progress || 0) > 0);
  return `${started ? "Continuar" : "Reproducir"} T${season} E${episode}`;
}

function renderEpisodes(seriesId, episodes) {
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

  function drawSeason(season) {
    list.innerHTML = '';
    episodes.filter(ep => ep.season === Number(season)).forEach(ep => {
      const key = episodeKey(seriesId, ep.season, ep.episodeNumber, ep.id);
      const progress = Math.max(0, Math.min(100, Number(progressMap[key] ?? ep.progress ?? 0)));
      const item = document.createElement('article');
      item.className = 'episode-item';
      item.innerHTML = `
        <div>
          <div class="episode-title">${ep.title}</div>
          <div class="episode-duration">${ep.duration || ''}</div>
          ${progress > 0 ? `<div class="episode-progress"><span style="--value:${progress}%"></span></div>` : ''}
        </div>
        ${progress >= 98 ? `<div class="episode-check">✓</div>` : ''}
      `;
      const seriesItem = allItemsByContinueKey.get(`series:${seriesId}`);
      if (seriesItem) item.addEventListener('click', () => openPlayer(seriesItem, { episode: ep }));
      list.appendChild(item);
    });
  }

  function activateSeason(season) {
    tabs.querySelectorAll('.season-tab').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.season === String(season));
    });
    drawSeason(season);
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
}

async function openPreview(item) {
  const modal = document.getElementById('previewModal');
  const poster = document.getElementById('previewPoster');
  poster.src = item.poster || item.posterUrl || '';
  poster.alt = item.title || 'Poster';

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
    actions.innerHTML = state
      ? `<button class="primary" data-preview-play>${getSeriesContinueLabel(item, episodes)}</button><button class="secondary" data-preview-restart>Reiniciar Episodio</button>`
      : `<button class="primary" data-preview-play>${getSeriesContinueLabel(item, episodes)}</button>`;
    const currentSeason = state?.season || episodes[0]?.season || 1;
    const currentEpisodeNumber = state?.episode || episodes[0]?.episodeNumber || 1;
    const currentEpisode = episodes.find(ep => ep.season === Number(currentSeason) && ep.episodeNumber === Number(currentEpisodeNumber)) || episodes[0] || null;
    const playBtn = actions.querySelector('[data-preview-play]');
    const restartBtn = actions.querySelector('[data-preview-restart]');
    if (playBtn) playBtn.onclick = () => openPlayer(item, { episode: currentEpisode });
    if (restartBtn) restartBtn.onclick = () => {
      if (currentEpisode) {
        const map = loadEpisodeProgress();
        map[episodeKey(item.id, currentEpisode.season, currentEpisode.episodeNumber, currentEpisode.id)] = 0;
        localStorage.setItem(EPISODE_PROGRESS_KEY, JSON.stringify(map));
        saveEpisodeProgressToCloud(item.id, currentEpisode, 0);
      }
      openPlayer(item, { episode: currentEpisode });
    };
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

    const recommendations = getPreviewRecommendations(item);
    if (!recommendations.length) {
      extra.classList.add('hidden');
    } else {
      extra.classList.remove('hidden');
      extraTitle.textContent = item.type === 'concert' ? 'Más conciertos' : 'Recomendaciones';
      recommendations.forEach(r => {
        const img = document.createElement('img');
        img.src = r.poster || r.posterUrl;
        img.alt = r.title || 'Recomendación';
        img.addEventListener('click', () => openPreview(r));
        recs.appendChild(img);
      });
    }
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

function getContinueEntry(item) {
  return loadContinueState().find(x => x.id === item.id && x.type === item.type);
}

function getItemProgress(item) {
  const entry = getContinueEntry(item);
  return Number(entry?.progress ?? item.progress ?? 0);
}

function savePlayerProgress() {
  const video = document.getElementById('womoPlayer');
  if (!video || !currentPlayerContext || !video.duration || !isFinite(video.duration)) return;

  const progress = Math.max(0, Math.min(100, (video.currentTime / video.duration) * 100));
  const { item, episode } = currentPlayerContext;

  if (item.type === 'series' && episode) {
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

function openPlayer(item, options = {}) {
  const episode = options.episode || null;
  const url = getPlayableUrl(item, episode);

  if (!url) {
    alert("Este título todavía no tiene video configurado.");
    return;
  }

  const overlay = document.getElementById('playerOverlay');
  const video = document.getElementById('womoPlayer');
  video.setAttribute('controlsList', 'nodownload noplaybackrate');
  video.disablePictureInPicture = true;
  const title = document.getElementById('playerTitle');
  const subtitle = document.getElementById('playerSubtitle');

  currentPlayerContext = { item, episode };
  title.textContent = item.title || "";
  subtitle.textContent = episode ? `T${episode.season} E${episode.episodeNumber} · ${episode.title}` : "";

  if (currentHls) {
    currentHls.destroy();
    currentHls = null;
  }

  video.pause();
  video.removeAttribute('src');
  video.load();

  if (window.Hls && Hls.isSupported() && url.includes(".m3u8")) {
    currentHls = new Hls();
    currentHls.loadSource(url);
    currentHls.attachMedia(video);
  } else {
    video.src = url;
  }

  overlay.classList.add('open', 'controls-visible');
  overlay.setAttribute('aria-hidden', 'false');

  const savedProgress = episode
    ? Number(loadEpisodeProgress()[episodeKey(item.id, episode.season, episode.episodeNumber, episode.id)] || episode.progress || 0)
    : getItemProgress(item);

  video.onloadedmetadata = () => {
    if (savedProgress > 0 && savedProgress < 98 && video.duration && isFinite(video.duration)) {
      video.currentTime = (savedProgress / 100) * video.duration;
    }
    video.play().catch(() => {});
  };

  clearInterval(playerSaveTimer);
  playerSaveTimer = setInterval(savePlayerProgress, 5000);

  if (window.lucide) lucide.createIcons();
}

function closePlayer() {
  const overlay = document.getElementById('playerOverlay');
  const video = document.getElementById('womoPlayer');

  savePlayerProgress();
  clearInterval(playerSaveTimer);
  playerSaveTimer = null;

  video.pause();
  if (currentHls) {
    currentHls.destroy();
    currentHls = null;
  }
  video.removeAttribute('src');
  video.load();

  overlay.classList.remove('open', 'show-controls', 'controls-visible');
  overlay.setAttribute('aria-hidden', 'true');
  currentPlayerContext = null;

  refreshContinueRow();
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
    if (!currentPlayerContext) return;
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
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => {
      if (!video.paused) overlay.classList.remove('controls-visible');
    }, 1800);
  };

  const hideTopbar = () => {
    if (!video.paused) overlay.classList.remove('controls-visible');
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

  auth.onAuthStateChanged(user => {
    if (user) {
      screen.classList.add("hidden");
      localStorage.setItem("womoUser", user.email || user.uid);
      Promise.all([loadFavoritesFromCloud(), loadContinueFromCloud(), loadEpisodeProgressFromCloud()]).then(()=>{ if(typeof renderFavorites==="function") renderFavorites(); if(typeof refreshContinueRow==="function") refreshContinueRow(); if(typeof syncFavoriteUI==="function") syncFavoriteUI(); });
    } else {
      screen.classList.remove("hidden");
      localStorage.removeItem("womoUser");
      localStorage.removeItem(FAVORITES_KEY);
      localStorage.removeItem(CONTINUE_KEY);
      localStorage.removeItem(EPISODE_PROGRESS_KEY);
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

  await ref.set({ updatedAt: firebase.firestore.FieldValue.serverTimestamp() }, { merge: true });
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

  await ref.set({ updatedAt: firebase.firestore.FieldValue.serverTimestamp() }, { merge: true });
  await ref.collection("continueWatching").doc(userItemDocId(entry)).set({
    ...entry,
    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
  }, { merge: true });
}

async function loadContinueFromCloud() {
  const ref = getUserDocRef();
  if (!ref) return;

  const snapshot = await ref.collection("continueWatching").orderBy("lastWatchedAt", "desc").get();
  const items = snapshot.docs.map(doc => doc.data()).filter(entry => entry.id && entry.type);
  saveContinueState(items);
}

async function saveEpisodeProgressToCloud(seriesId, episode, progress) {
  const ref = getUserDocRef();
  if (!ref || !seriesId || !episode) return;

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

