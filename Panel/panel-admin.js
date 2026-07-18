import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import {
  getFirestore, collection, getDocs, doc, getDoc, setDoc, deleteDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";


window.addEventListener("error", (event) => {
  const box = document.getElementById("status");
  if (box) {
    box.textContent = `Error JS: ${event.message}`;
    box.classList.remove("hidden");
  }
  console.error("Womo Admin JS error:", event.error || event.message);
});

window.addEventListener("unhandledrejection", (event) => {
  const box = document.getElementById("status");
  const reason = event.reason;
  const message = reason?.message || String(reason);
  if (box) {
    box.textContent = `Error promesa: ${message}`;
    box.classList.remove("hidden");
  }
  console.error("Womo Admin promise error:", reason);
});

const firebaseConfig = {
  apiKey: "AIzaSyBGUUoYmYNcQk_T7QvDUKwZmNh-nHOwENY",
  authDomain: "womo-5d922.firebaseapp.com",
  projectId: "womo-5d922",
  storageBucket: "womo-5d922.firebasestorage.app",
  messagingSenderId: "760499593073",
  appId: "1:760499593073:web:c1a8605da3f0892e53a0d0",
  measurementId: "G-7VP6S1N7S7"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

const HOME_SECTION_KEYS = ["new", "movies", "series", "concerts"];
const DYNAMIC_HOME_SECTION_KEYS = ["movies", "series", "concerts"];

const defaultHomeConfig = {
  sections: {
    new: { mode: "recent", limit: 10, selectedItems: [] },
    movies: { mode: "recent", limit: 10, selectedItems: [], visible: true, order: 10 },
    series: { mode: "recent", limit: 10, selectedItems: [], visible: true, order: 20 },
    concerts: { mode: "recent", limit: 10, selectedItems: [], visible: true, order: 90 }
  },
  genreSections: {},
  collectionSections: {}
};

const clone = (value) => JSON.parse(JSON.stringify(value));

const state = {
  view: "home",
  movies: [],
  series: [],
  concerts: [],
  homeConfig: clone(defaultHomeConfig),
  editingType: "movie",
  editingId: null,
  editingSeriesId: null,
  editingEpisodeId: null,
  currentEpisodes: [],
  selectedSeason: null,
  drag: null,
  analyticsTab: "titles",
  analyticsLoaded: false,
  analyticsLoading: false,
  analyticsUsers: [],
  analyticsTitles: []
};

const $ = (id) => document.getElementById(id);
const views = { home: $("homeView"), movies: $("moviesView"), series: $("seriesView"), concerts: $("concertsView"), analytics: $("analyticsView") };
const pageTitle = $("pageTitle");
const primaryAction = $("primaryAction");
const statusBox = $("status");

function showStatus(message) {
  statusBox.textContent = message;
  statusBox.classList.remove("hidden");
  setTimeout(() => statusBox.classList.add("hidden"), 2600);
}

function slugify(text) {
  return String(text || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function splitGenres(value) {
  return String(value || "").split(",").map(g => g.trim()).filter(Boolean);
}

function formatGenresForInput(value) {
  if (Array.isArray(value)) return value.map(g => String(g).trim()).filter(Boolean).join(", ");
  if (typeof value === "string") return value;
  return "";
}

function splitList(value) {
  return String(value || "").split(",").map(v => v.trim()).filter(Boolean);
}

function formatListForInput(value) {
  if (Array.isArray(value)) return value.map(v => String(v).trim()).filter(Boolean).join(", ");
  if (typeof value === "string") return value;
  return "";
}

function getAllContent() {
  return [...state.movies, ...state.series, ...state.concerts];
}

function genreDisplayName(value) {
  return String(value || "").trim().replace(/\s+/g, " ");
}

function genreSlug(value) {
  return genreDisplayName(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "") || "genre";
}

function itemGenres(item) {
  const raw = Array.isArray(item?.genres) ? item.genres : splitGenres(item?.genre || item?.genres || "");
  return raw.map(genreDisplayName).filter(Boolean);
}

function itemCollections(item) {
  const raw = Array.isArray(item?.collections) ? item.collections : splitList(item?.collection || item?.collections || "");
  return raw.map(genreDisplayName).filter(Boolean);
}

function getDetectedHomeGenres() {
  const bySlug = new Map();
  state.movies.forEach(item => {
    itemGenres(item).forEach(name => {
      const slug = genreSlug(name);
      if (!bySlug.has(slug)) bySlug.set(slug, name);
    });
  });
  return Array.from(bySlug.values()).sort((a, b) => a.localeCompare(b, "es"));
}

function getGenreSectionState(name) {
  if (!state.homeConfig.genreSections) state.homeConfig.genreSections = {};
  const existing = state.homeConfig.genreSections[name];
  if (existing === true) return { visible: true, order: getDefaultGenreOrder(name) };
  if (existing && typeof existing === "object") {
    return {
      visible: Boolean(existing.visible ?? existing.enabled ?? existing.showInHome),
      order: Number.isFinite(Number(existing.order)) ? Number(existing.order) : getDefaultGenreOrder(name)
    };
  }
  return { visible: false, order: getDefaultGenreOrder(name) };
}

function getDefaultGenreOrder(name) {
  const index = getDetectedHomeGenres().findIndex(genre => genreSlug(genre) === genreSlug(name));
  return 30 + Math.max(index, 0);
}

function setGenreSectionVisible(name, visible) {
  if (!state.homeConfig.genreSections) state.homeConfig.genreSections = {};
  const current = getGenreSectionState(name);
  state.homeConfig.genreSections[name] = { ...current, visible: Boolean(visible) };
}

function setGenreSectionOrder(name, order) {
  if (!state.homeConfig.genreSections) state.homeConfig.genreSections = {};
  const current = getGenreSectionState(name);
  state.homeConfig.genreSections[name] = { ...current, order: Number(order) || getDefaultGenreOrder(name) };
}

function getDetectedHomeCollections() {
  const bySlug = new Map();
  getAllContent().forEach(item => {
    itemCollections(item).forEach(name => {
      const slug = genreSlug(name);
      if (!bySlug.has(slug)) bySlug.set(slug, name);
    });
  });
  return Array.from(bySlug.values()).sort((a, b) => a.localeCompare(b, "es"));
}

function getDefaultCollectionOrder(name) {
  const index = getDetectedHomeCollections().findIndex(collection => genreSlug(collection) === genreSlug(name));
  return 60 + Math.max(index, 0);
}

function getCollectionSectionState(name) {
  if (!state.homeConfig.collectionSections) state.homeConfig.collectionSections = {};
  const existing = state.homeConfig.collectionSections[name];
  if (existing === true) return { visible: true, order: getDefaultCollectionOrder(name) };
  if (existing && typeof existing === "object") {
    return {
      visible: Boolean(existing.visible ?? existing.enabled ?? existing.showInHome),
      order: Number.isFinite(Number(existing.order)) ? Number(existing.order) : getDefaultCollectionOrder(name)
    };
  }
  return { visible: false, order: getDefaultCollectionOrder(name) };
}

function setCollectionSectionVisible(name, visible) {
  if (!state.homeConfig.collectionSections) state.homeConfig.collectionSections = {};
  const current = getCollectionSectionState(name);
  state.homeConfig.collectionSections[name] = { ...current, visible: Boolean(visible) };
}

function setCollectionSectionOrder(name, order) {
  if (!state.homeConfig.collectionSections) state.homeConfig.collectionSections = {};
  const current = getCollectionSectionState(name);
  state.homeConfig.collectionSections[name] = { ...current, order: Number(order) || getDefaultCollectionOrder(name) };
}

function getDynamicSectionConfig(sectionKey) {
  const cfg = getSectionConfig(sectionKey);
  const defaults = defaultHomeConfig.sections[sectionKey] || { visible: true, order: 50 };
  cfg.visible = cfg.visible !== false;
  cfg.order = Number.isFinite(Number(cfg.order)) ? Number(cfg.order) : Number(defaults.order || 50);
  return cfg;
}

function setDynamicSectionVisible(sectionKey, visible) {
  getDynamicSectionConfig(sectionKey).visible = Boolean(visible);
}

function setDynamicSectionOrder(sectionKey, order) {
  getDynamicSectionConfig(sectionKey).order = Number(order) || Number(defaultHomeConfig.sections[sectionKey]?.order || 50);
}

function refKey(ref) {
  return `${ref.type}:${ref.id}`;
}

function normalizeSelectedItem(item) {
  const type = item.type === "series" ? "series" : item.type === "concert" ? "concert" : "movie";
  return { id: item.id, type };
}

function typeLabel(type) {
  if (type === "series") return "Serie";
  if (type === "concert") return "Concierto";
  return "Película";
}

function collectionForType(type) {
  if (type === "series") return "series";
  if (type === "concert") return "concerts";
  return "movies";
}

function listForType(type) {
  if (type === "series") return state.series;
  if (type === "concert") return state.concerts;
  return state.movies;
}

function findContentItem(ref) {
  const list = listForType(ref.type);
  return list.find(item => item.id === ref.id);
}

function getSectionConfig(sectionKey) {
  if (!state.homeConfig.sections) state.homeConfig.sections = {};
  if (!state.homeConfig.sections[sectionKey]) {
    state.homeConfig.sections[sectionKey] = clone(defaultHomeConfig.sections[sectionKey]);
  }
  const config = state.homeConfig.sections[sectionKey];
  config.limit = getSectionLimit(sectionKey);
  config.selectedItems = Array.isArray(config.selectedItems) ? config.selectedItems.map(normalizeSelectedItem).slice(0, getSectionLimit(sectionKey)) : [];
  config.mode = config.mode || "recent";
  if (DYNAMIC_HOME_SECTION_KEYS.includes(sectionKey)) {
    config.visible = config.visible !== false;
    config.order = Number.isFinite(Number(config.order)) ? Number(config.order) : Number(defaultHomeConfig.sections[sectionKey]?.order || 50);
  }
  return config;
}

function sortByRecent(items) {
  return [...items].sort((a, b) => {
    const aTime = a.createdAt?.seconds ?? 0;
    const bTime = b.createdAt?.seconds ?? 0;
    return bTime - aTime;
  });
}

function sortByPopularity(items) {
  return [...items].sort((a, b) => {
    const aPop = Number(a.popularity ?? a.views ?? 0);
    const bPop = Number(b.popularity ?? b.views ?? 0);
    if (bPop !== aPop) return bPop - aPop;
    return (b.createdAt?.seconds ?? 0) - (a.createdAt?.seconds ?? 0);
  });
}

function getSectionLimit(sectionKey) {
  return sectionKey === "new" ? 5 : 10;
}

function buildNewSectionPreview() {
  const newestMovies = sortByRecent(state.movies).slice(0, 2);
  const newestSeries = sortByRecent(state.series).slice(0, 2);
  const newestConcerts = sortByRecent(state.concerts).slice(0, 1);
  const ordered = [newestMovies[0], newestSeries[0], newestConcerts[0], newestMovies[1], newestSeries[1]].filter(Boolean);
  const used = new Set(ordered.map(item => `${item.type}:${item.id}`));
  const fillers = sortByRecent(getAllContent()).filter(item => !used.has(`${item.type}:${item.id}`));
  return [...ordered, ...fillers].slice(0, 5);
}

function getRawContentForSection(sectionKey) {
  if (sectionKey === "movies") return state.movies;
  if (sectionKey === "series") return state.series;
  if (sectionKey === "concerts") return state.concerts;
  return getAllContent();
}

function getNewSectionKeys() {
  const items = getPreviewItems("new", { ignoreExclusion: true });
  return new Set(items.map(item => `${item.type}:${item.id}`));
}

function getContentForSection(sectionKey, options = {}) {
  let source = getRawContentForSection(sectionKey);
  return source;
}

function getPreviewItems(sectionKey, options = {}) {
  const config = getSectionConfig(sectionKey);
  const source = getContentForSection(sectionKey, options);
  const limit = getSectionLimit(sectionKey);

  if (sectionKey === "new" && config.mode === "recent") {
    return buildNewSectionPreview();
  }

  if (config.mode === "manual") {
    const allowedKeys = new Set(source.map(item => `${item.type}:${item.id}`));
    return config.selectedItems
      .filter(ref => allowedKeys.has(refKey(ref)))
      .map(findContentItem)
      .filter(Boolean)
      .slice(0, limit);
  }
  if (config.mode === "popular") return sortByPopularity(source).slice(0, limit);
  return sortByRecent(source).slice(0, limit);
}

function normalizeMovieFromJson(rawMovie, index = 0) {
  const title = String(rawMovie.title || rawMovie.name || "").trim();
  const idSource = rawMovie.id || rawMovie.docId || rawMovie.slug || title || `movie-${Date.now()}-${index}`;
  const id = slugify(String(idSource));

  let genres = [];
  if (Array.isArray(rawMovie.genres)) genres = rawMovie.genres.map(g => String(g).trim()).filter(Boolean);
  else if (typeof rawMovie.genres === "string") genres = splitGenres(rawMovie.genres);
  else if (typeof rawMovie.genre === "string") genres = splitGenres(rawMovie.genre);

  const collections = Array.isArray(rawMovie.collections) ? rawMovie.collections.map(g => String(g).trim()).filter(Boolean) : splitList(rawMovie.collection || rawMovie.collections || rawMovie.saga || rawMovie.franchise || "");
  const actors = Array.isArray(rawMovie.actors) ? rawMovie.actors.map(g => String(g).trim()).filter(Boolean) : splitList(rawMovie.actors || rawMovie.cast || "");

  return {
    id,
    data: {
      title,
      year: Number(rawMovie.year) || null,
      genres,
      collection: collections.join(", "),
      collections,
      director: String(rawMovie.director || "").trim(),
      actors,
      duration: Number(rawMovie.duration) || 0,
      synopsis: String(rawMovie.synopsis || rawMovie.overview || rawMovie.description || "").trim(),
      posterUrl: String(rawMovie.posterUrl || rawMovie.posterURL || rawMovie.poster || "").trim(),
      backdropUrl: String(rawMovie.backdropUrl || rawMovie.backdropURL || rawMovie.backdrop || rawMovie.horizontalPoster || rawMovie.landscapePoster || rawMovie.bannerUrl || rawMovie.banner || "").trim(),
      hlsUrl: String(rawMovie.hlsUrl || rawMovie.movieURL || rawMovie.videoUrl || rawMovie.url || "").trim(),
      type: "movie",
      isFavorite: Boolean(rawMovie.isFavorite),
      popularity: Number(rawMovie.popularity) || 0,
      updatedAt: serverTimestamp(),
      createdAt: serverTimestamp(),
    }
  };
}

function normalizeSeriesFromJson(rawSeries, index = 0) {
  const title = String(rawSeries.title || rawSeries.name || "").trim();
  const idSource = rawSeries.id || rawSeries.docId || rawSeries.slug || title || `series-${Date.now()}-${index}`;
  const id = slugify(String(idSource));

  let genres = [];
  if (Array.isArray(rawSeries.genres)) genres = rawSeries.genres.map(g => String(g).trim()).filter(Boolean);
  else if (typeof rawSeries.genres === "string") genres = splitGenres(rawSeries.genres);
  else if (typeof rawSeries.genre === "string") genres = splitGenres(rawSeries.genre);

  const collections = Array.isArray(rawSeries.collections) ? rawSeries.collections.map(g => String(g).trim()).filter(Boolean) : splitList(rawSeries.collection || rawSeries.collections || rawSeries.saga || rawSeries.franchise || "");
  const actors = Array.isArray(rawSeries.actors) ? rawSeries.actors.map(g => String(g).trim()).filter(Boolean) : splitList(rawSeries.actors || rawSeries.cast || "");

  const episodes = Array.isArray(rawSeries.episodes) ? rawSeries.episodes : [];

  return {
    id,
    episodes,
    data: {
      title,
      year: Number(rawSeries.year) || null,
      genres,
      collection: collections.join(", "),
      collections,
      director: String(rawSeries.director || "").trim(),
      actors,
      synopsis: String(rawSeries.synopsis || rawSeries.overview || rawSeries.description || "").trim(),
      posterUrl: String(rawSeries.posterUrl || rawSeries.posterURL || rawSeries.poster || "").trim(),
      backdropUrl: String(rawSeries.backdropUrl || rawSeries.backdropURL || rawSeries.backdrop || rawSeries.horizontalPoster || rawSeries.landscapePoster || rawSeries.bannerUrl || rawSeries.banner || "").trim(),
      type: "series",
      isFavorite: Boolean(rawSeries.isFavorite),
      popularity: Number(rawSeries.popularity) || 0,
      updatedAt: serverTimestamp(),
      createdAt: serverTimestamp(),
    }
  };
}

function normalizeEpisodeFromJson(rawEpisode, index = 0, sourceFileName = "") {
  const seasonNumber = Number(rawEpisode.seasonNumber || rawEpisode.season || 1);
  const episodeNumber = Number(rawEpisode.episodeNumber || rawEpisode.episode || index + 1);
  const sourceFileId = String(sourceFileName || "").replace(/\.json$/i, "");
  const explicitId = rawEpisode.id || rawEpisode.docId || rawEpisode.slug;
  const fallbackId = sourceFileId || `s${String(seasonNumber).padStart(2, "0")}e${String(episodeNumber).padStart(2, "0")}`;
  const id = slugify(explicitId || fallbackId);
  return {
    id,
    data: {
      title: String(rawEpisode.title || rawEpisode.name || `Episodio ${episodeNumber}`).trim(),
      seasonNumber,
      episodeNumber,
      duration: Number(rawEpisode.duration) || 0,
      synopsis: String(rawEpisode.synopsis || rawEpisode.overview || rawEpisode.description || "").trim(),
      hlsUrl: String(rawEpisode.hlsUrl || rawEpisode.videoUrl || rawEpisode.url || "").trim(),
      updatedAt: serverTimestamp(),
      createdAt: serverTimestamp(),
    }
  };
}


function normalizeConcertFromJson(rawConcert, index = 0) {
  const normalized = normalizeMovieFromJson(rawConcert, index);
  const idSource = rawConcert.id || rawConcert.docId || rawConcert.slug || rawConcert.title || rawConcert.name || `concert-${Date.now()}-${index}`;
  normalized.id = slugify(String(idSource));
  normalized.data.type = "concert";
  normalized.data.isFavorite = false;
  return normalized;
}

async function importConcertsFromJson(file) {
  try {
    const text = await file.text();
    await importConcertsFromJsonValue(JSON.parse(text));
  } catch (error) {
    console.error(error);
    alert("No se pudo importar el JSON. Revisa que el archivo sea válido.");
  } finally {
    $("importConcertInput").value = "";
  }
}

async function importConcertsFromJsonFiles(files) {
  try {
    const { parsed, failed } = await parseJsonFiles(files);
    if (!parsed.length) return alert("No se pudo importar ningún JSON válido.");
    const items = parsed.flatMap(({ json }) => Array.isArray(json) ? json : Array.isArray(json.concerts) ? json.concerts : [json]);
    await importConcertsFromJsonValue(items);
    if (failed.length) alert(`Se importaron los JSON válidos, pero fallaron: ${failed.join(", ")}`);
  } finally {
    $("importConcertInput").value = "";
  }
}

async function importMoviesFromJson(file) {
  try {
    const text = await file.text();
    await importMoviesFromJsonValue(JSON.parse(text));
  } catch (error) {
    console.error(error);
    alert("No se pudo importar el JSON. Revisa que el archivo sea válido.");
  } finally {
    $("importMovieInput").value = "";
  }
}

async function importMoviesFromJsonFiles(files) {
  try {
    const { parsed, failed } = await parseJsonFiles(files);
    if (!parsed.length) return alert("No se pudo importar ningún JSON válido.");
    const items = parsed.flatMap(({ json }) => Array.isArray(json) ? json : Array.isArray(json.movies) ? json.movies : [json]);
    await importMoviesFromJsonValue(items);
    if (failed.length) alert(`Se importaron los JSON válidos, pero fallaron: ${failed.join(", ")}`);
  } finally {
    $("importMovieInput").value = "";
  }
}

async function importSeriesFromJson(file) {
  try {
    const text = await file.text();
    await importSeriesFromJsonValue(JSON.parse(text));
  } catch (error) {
    console.error(error);
    alert("No se pudo importar el JSON. Revisa que el archivo sea válido.");
  } finally {
    $("importSeriesInput").value = "";
  }
}

async function importSeriesFromJsonFiles(files) {
  try {
    const { parsed, failed } = await parseJsonFiles(files);
    if (!parsed.length) return alert("No se pudo importar ningún JSON válido.");
    const items = parsed.flatMap(({ json }) => Array.isArray(json) ? json : Array.isArray(json.series) ? json.series : [json]);
    await importSeriesFromJsonValue(items);
    if (failed.length) alert(`Se importaron los JSON válidos, pero fallaron: ${failed.join(", ")}`);
  } finally {
    $("importSeriesInput").value = "";
  }
}



function parseJsonCode(text) {
  const value = String(text || "").trim();
  if (!value) throw new Error("empty-json-code");
  return JSON.parse(value);
}

async function importConcertsFromJsonValue(json) {
  const items = Array.isArray(json) ? json : Array.isArray(json.concerts) ? json.concerts : [json];
  if (!items.length) return showStatus("El JSON no contiene conciertos");

  const normalized = items.map(normalizeConcertFromJson);
  const invalid = normalized.find(item => !item.data.title);
  if (invalid) return alert("El JSON debe incluir al menos title en cada concierto. Poster URL y HLS URL se pueden agregar después desde el editor.");

  await Promise.all(normalized.map(item => setDoc(doc(db, "concerts", item.id), item.data, { merge: true })));
  showStatus(`${normalized.length} concierto${normalized.length === 1 ? "" : "s"} importado${normalized.length === 1 ? "" : "s"}`);
  await loadAll();
  setView("concerts");
}

async function importMoviesFromJsonValue(json) {
  const items = Array.isArray(json) ? json : Array.isArray(json.movies) ? json.movies : [json];
  if (!items.length) return showStatus("El JSON no contiene películas");

  const normalized = items.map(normalizeMovieFromJson);
  const invalid = normalized.find(item => !item.data.title);
  if (invalid) return alert("El JSON debe incluir al menos title en cada película. Poster URL y HLS URL se pueden agregar después desde el editor.");

  await Promise.all(normalized.map(item => setDoc(doc(db, "movies", item.id), item.data, { merge: true })));
  showStatus(`${normalized.length} película${normalized.length === 1 ? "" : "s"} importada${normalized.length === 1 ? "" : "s"}`);
  await loadAll();
  setView("movies");
}

async function importSeriesFromJsonValue(json) {
  const items = Array.isArray(json) ? json : Array.isArray(json.series) ? json.series : [json];
  if (!items.length) return showStatus("El JSON no contiene series");

  const normalized = items.map(normalizeSeriesFromJson);
  const invalid = normalized.find(item => !item.data.title);
  if (invalid) return alert("El JSON debe incluir al menos title en cada serie. Poster URL se puede agregar después desde el editor.");

  await Promise.all(normalized.map(async item => {
    await setDoc(doc(db, "series", item.id), item.data, { merge: true });
    if (item.episodes.length) {
      const episodes = item.episodes.map(normalizeEpisodeFromJson);
      await Promise.all(episodes.map(ep => setDoc(doc(db, "series", item.id, "episodes", ep.id), ep.data, { merge: true })));
    }
  }));

  showStatus(`${normalized.length} serie${normalized.length === 1 ? "" : "s"} importada${normalized.length === 1 ? "" : "s"}`);
  await loadAll();
  setView("series");
}

function getEpisodeRawFromJsonValue(json) {
  return Array.isArray(json) ? json[0] : Array.isArray(json.episodes) ? json.episodes[0] : json;
}

function getEpisodeItemsFromJsonValue(json) {
  const items = Array.isArray(json) ? json : Array.isArray(json.episodes) ? json.episodes : [json];
  return items.filter(Boolean);
}

async function parseJsonFiles(files) {
  const list = Array.from(files || []);
  const parsed = [];
  const failed = [];

  for (const file of list) {
    try {
      const text = await file.text();
      parsed.push({ file, json: JSON.parse(text) });
    } catch (error) {
      console.error(error);
      failed.push(file?.name || "archivo");
    }
  }

  return { parsed, failed };
}

async function importMovieCode(text) {
  try {
    await importMoviesFromJsonValue(parseJsonCode(text));
  } catch (error) {
    console.error(error);
    alert("No se pudo importar el código. Revisa que sea JSON válido.");
  }
}

async function importSeriesCode(text) {
  try {
    await importSeriesFromJsonValue(parseJsonCode(text));
  } catch (error) {
    console.error(error);
    alert("No se pudo importar el código. Revisa que sea JSON válido.");
  }
}

async function importConcertCode(text) {
  try {
    await importConcertsFromJsonValue(parseJsonCode(text));
  } catch (error) {
    console.error(error);
    alert("No se pudo importar el código. Revisa que sea JSON válido.");
  }
}

async function importEpisodeCode(text) {
  try {
    const raw = getEpisodeRawFromJsonValue(parseJsonCode(text));
    if (!raw) return alert("El JSON no contiene episodio.");
    fillEpisodeForm(raw);
    showStatus("Campos del episodio importados. Revisa y guarda.");
  } catch (error) {
    console.error(error);
    alert("No se pudo importar el código del episodio. Revisa que sea JSON válido.");
  }
}

let jsonCodeMode = null;

function openJsonCodeDialog(mode) {
  jsonCodeMode = mode;
  const labels = {
    movie: { type: "Película", title: "Ingresar código de película", help: "Pega un objeto JSON de película o un arreglo de películas." },
    series: { type: "Serie", title: "Ingresar código de serie", help: "Pega un objeto JSON de serie, un arreglo de series o un objeto con la propiedad series." },
    concert: { type: "Concierto", title: "Ingresar código de concierto", help: "Pega un objeto JSON de concierto o un arreglo de conciertos." },
    episode: { type: "Episodio", title: "Ingresar código de episodio", help: "Pega un objeto JSON de episodio. Se llenarán los campos y después podrás guardar." }
  };

  const config = labels[mode] || labels.movie;
  $("jsonCodeType").textContent = config.type;
  $("jsonCodeTitle").textContent = config.title;
  $("jsonCodeHelp").textContent = config.help;
  $("jsonCodeText").value = "";
  $("jsonCodeDialog").showModal();
  setTimeout(() => $("jsonCodeText").focus(), 40);
}

async function submitJsonCode(e) {
  e.preventDefault();
  const text = $("jsonCodeText").value;

  if (jsonCodeMode === "series") await importSeriesCode(text);
  else if (jsonCodeMode === "concert") await importConcertCode(text);
  else if (jsonCodeMode === "episode") await importEpisodeCode(text);
  else await importMovieCode(text);

  $("jsonCodeDialog").close();
  $("jsonCodeText").value = "";
  jsonCodeMode = null;
}


function isPublished(item) {
  return item?.published !== false;
}

function contentKey(type, id) {
  return `${type}:${id}`;
}


function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function normalizeAnalyticsType(value) {
  const raw = String(value || "").toLowerCase();
  if (["series", "serie", "show", "tv"].includes(raw)) return "series";
  if (["concert", "concerts", "concierto"].includes(raw)) return "concert";
  return "movie";
}

function getDateValue(value) {
  if (!value) return 0;
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : Number(value) || 0;
  }
  if (typeof value.toMillis === "function") return value.toMillis();
  if (typeof value.seconds === "number") return value.seconds * 1000;
  return 0;
}

function formatAnalyticsDate(value) {
  const millis = getDateValue(value);
  if (!millis) return "—";
  try {
    return new Intl.DateTimeFormat("es-MX", {
      day: "2-digit",
      month: "2-digit",
      year: "2-digit",
      hour: "2-digit",
      minute: "2-digit"
    }).format(new Date(millis));
  } catch (_) {
    return "—";
  }
}

function sortByRecentDate(list) {
  return [...(list || [])].sort((a, b) => getDateValue(b.lastPlayedAt || b.lastWatchedAt || b.addedAt || b.updatedAt) - getDateValue(a.lastPlayedAt || a.lastWatchedAt || a.addedAt || a.updatedAt));
}

function titleForAnalytics(ref) {
  const item = findContentItem(ref);
  return item?.title || ref.title || ref.id || "Sin título";
}

function getAllAnalyticsTitles() {
  return getAllContent().map(item => ({
    id: item.id,
    type: item.type,
    title: item.title || item.id,
    posterUrl: item.posterUrl || "",
    year: item.year || "",
    published: item.published !== false
  }));
}

async function readUserSubcollection(userId, subcollectionName) {
  try {
    const snap = await getDocs(collection(db, "users", userId, subcollectionName));
    return snap.docs.map(d => ({ docId: d.id, ...d.data() }));
  } catch (error) {
    console.warn(`No se pudo leer users/${userId}/${subcollectionName}`, error);
    return [];
  }
}

function normalizeAnalyticsEntry(entry) {
  const type = normalizeAnalyticsType(entry.type || entry.contentType || entry.kind);
  return {
    ...entry,
    type,
    id: entry.id || entry.contentId || entry.titleId || entry.movieId || entry.seriesId || entry.concertId || "",
    title: entry.title || entry.name || entry.contentTitle || "",
    playCount: Number(entry.playCount || entry.count || entry.plays || 1),
    lastPlayedAt: entry.lastPlayedAt || entry.playedAt || entry.updatedAt || entry.lastWatchedAt || 0,
    lastWatchedAt: entry.lastWatchedAt || entry.updatedAt || entry.lastPlayedAt || 0,
    addedAt: entry.addedAt || entry.createdAt || entry.updatedAt || 0
  };
}

async function loadAnalytics() {
  state.analyticsLoading = true;
  state.analyticsLoaded = false;
  renderAnalytics();

  try {
    const usersSnap = await getDocs(collection(db, "users"));
    const users = [];

    for (const userDoc of usersSnap.docs) {
      const data = userDoc.data() || {};
      const [favoritesRaw, continueRaw, completedRaw, progressRaw, historyRaw] = await Promise.all([
        readUserSubcollection(userDoc.id, "favorites"),
        readUserSubcollection(userDoc.id, "continueWatching"),
        readUserSubcollection(userDoc.id, "completed"),
        readUserSubcollection(userDoc.id, "episodeProgress"),
        readUserSubcollection(userDoc.id, "playHistory")
      ]);

      const favorites = sortByRecentDate(favoritesRaw.map(normalizeAnalyticsEntry).filter(entry => entry.id));
      const completed = sortByRecentDate(completedRaw.map(normalizeAnalyticsEntry).filter(entry => entry.id));
      const continueWatching = sortByRecentDate(continueRaw.map(normalizeAnalyticsEntry).filter(entry => entry.id));
      const history = sortByRecentDate(historyRaw.map(normalizeAnalyticsEntry).filter(entry => entry.id));

      // Backward compatibility: if playHistory does not exist yet, use continue/completed as at least one play.
      const historyMap = new Map();
      [...history, ...continueWatching, ...completed].forEach(entry => {
        const key = contentKey(entry.type, entry.id);
        const prev = historyMap.get(key) || { ...entry, playCount: 0 };
        prev.playCount += Number(entry.playCount || 1);
        prev.lastPlayedAt = Math.max(getDateValue(prev.lastPlayedAt), getDateValue(entry.lastPlayedAt || entry.lastWatchedAt || entry.updatedAt));
        prev.lastWatchedAt = Math.max(getDateValue(prev.lastWatchedAt), getDateValue(entry.lastWatchedAt || entry.updatedAt || entry.lastPlayedAt));
        historyMap.set(key, prev);
      });

      const userEmail = data.email || data.userEmail || data.displayName || data.activeEmail || userDoc.id;
      users.push({
        uid: userDoc.id,
        email: userEmail,
        lastLoginAt: data.lastLoginAt || 0,
        updatedAt: data.updatedAt || 0,
        activeSessionId: data.activeSessionId || "",
        favorites,
        completed,
        continueWatching,
        episodeProgress: progressRaw,
        history: sortByRecentDate(Array.from(historyMap.values()))
      });
    }

    const titleMap = new Map();
    getAllAnalyticsTitles().forEach(item => {
      titleMap.set(contentKey(item.type, item.id), {
        ...item,
        plays: 0,
        playUsers: new Set(),
        completedUsers: new Set(),
        favoriteUsers: new Set()
      });
    });

    users.forEach(user => {
      user.history.forEach(entry => {
        const key = contentKey(entry.type, entry.id);
        if (!titleMap.has(key)) {
          titleMap.set(key, {
            id: entry.id,
            type: entry.type,
            title: titleForAnalytics(entry),
            posterUrl: "",
            published: true,
            plays: 0,
            playUsers: new Set(),
            completedUsers: new Set(),
            favoriteUsers: new Set()
          });
        }
        const item = titleMap.get(key);
        item.plays += Number(entry.playCount || 1);
        item.playUsers.add(user.uid);
      });

      user.completed.forEach(entry => {
        const key = contentKey(entry.type, entry.id);
        if (!titleMap.has(key)) {
          titleMap.set(key, {
            id: entry.id,
            type: entry.type,
            title: titleForAnalytics(entry),
            posterUrl: "",
            published: true,
            plays: 0,
            playUsers: new Set(),
            completedUsers: new Set(),
            favoriteUsers: new Set()
          });
        }
        titleMap.get(key).completedUsers.add(user.uid);
      });

      user.favorites.forEach(entry => {
        const key = contentKey(entry.type, entry.id);
        if (!titleMap.has(key)) {
          titleMap.set(key, {
            id: entry.id,
            type: entry.type,
            title: titleForAnalytics(entry),
            posterUrl: "",
            published: true,
            plays: 0,
            playUsers: new Set(),
            completedUsers: new Set(),
            favoriteUsers: new Set()
          });
        }
        titleMap.get(key).favoriteUsers.add(user.uid);
      });
    });

    state.analyticsUsers = users.sort((a, b) => getDateValue(b.updatedAt || b.lastLoginAt) - getDateValue(a.updatedAt || a.lastLoginAt));
    state.analyticsTitles = Array.from(titleMap.values())
      .map(item => ({
        ...item,
        playUsersCount: item.playUsers.size,
        completedUsersCount: item.completedUsers.size,
        favoriteUsersCount: item.favoriteUsers.size
      }))
      .sort((a, b) => (b.plays - a.plays) || a.title.localeCompare(b.title));

    state.analyticsLoaded = true;
  } catch (error) {
    console.error("No se pudieron cargar Analytics/Usuarios", error);
    showStatus("No se pudieron cargar usuarios. Revisa permisos de Firestore.");
    state.analyticsUsers = [];
    state.analyticsTitles = [];
    state.analyticsLoaded = true;
  } finally {
    state.analyticsLoading = false;
    renderAnalytics();
  }
}

function renderAnalytics() {
  if (!$("analyticsView")) return;

  document.querySelectorAll("[data-analytics-tab]").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.analyticsTab === state.analyticsTab);
  });
  $("analyticsTitlesPanel")?.classList.toggle("active", state.analyticsTab === "titles");
  $("analyticsUsersPanel")?.classList.toggle("active", state.analyticsTab === "users");

  renderAnalyticsTitles();
  renderAnalyticsUsers();
}

function renderAnalyticsTitles() {
  const container = $("analyticsTitlesList");
  if (!container) return;

  container.classList.add("grid-list");
  container.classList.remove("analytics-list");

  if (state.analyticsLoading) {
    container.innerHTML = `<p class="helper">Cargando métricas...</p>`;
    return;
  }

  if (!state.analyticsLoaded) {
    container.innerHTML = `<p class="helper">Carga Analytics para ver métricas.</p>`;
    return;
  }

  container.innerHTML = state.analyticsTitles.map(item => `
    <article class="card analytics-title-card ${item.published === false ? "unpublished" : ""}" data-analytics-title="${item.type}:${item.id}" role="button" tabindex="0" title="Ver analytics">
      <img class="poster" src="${item.posterUrl || ""}" alt="" />
      <h3>${item.title || item.id}</h3>
      <p>${typeLabel(item.type)} · ${item.published === false ? "Oculto" : "Publicado"}</p>
      <div class="badge-row">
        <span class="badge on">${item.plays} plays</span>
        <span class="badge">${item.playUsersCount} usuarios</span>
        <span class="badge">${item.completedUsersCount} fin.</span>
        <span class="badge">${item.favoriteUsersCount} fav.</span>
      </div>
    </article>
  `).join("") || `<p class="helper">No hay datos de títulos todavía.</p>`;
}

function renderAnalyticsUsers() {
  const container = $("analyticsUsersList");
  if (!container) return;
  container.classList.remove("grid-list");
  container.classList.add("analytics-list");

  if (state.analyticsLoading) {
    container.innerHTML = `<p class="helper">Cargando usuarios...</p>`;
    return;
  }

  if (!state.analyticsLoaded) {
    container.innerHTML = `<p class="helper">Carga Analytics para ver usuarios.</p>`;
    return;
  }

  container.innerHTML = state.analyticsUsers.map(user => `
    <article class="analytics-row user-row" data-analytics-user="${escapeHtml(user.uid)}" role="button" tabindex="0" title="Ver usuario">
      <div class="analytics-avatar">${escapeHtml(String(user.email || "?").slice(0, 1).toUpperCase())}</div>
      <div>
        <strong>${escapeHtml(user.email)}</strong>
        <span>${user.favorites.length} favoritos · ${user.history.length} títulos vistos · ${user.continueWatching.length} en progreso</span>
      </div>
      <div class="analytics-mini-stats">
        <span>${user.history.reduce((sum, item) => sum + Number(item.playCount || 1), 0)} plays</span>
        <span>${formatAnalyticsDate(user.updatedAt || user.lastLoginAt)}</span>
      </div>
    </article>
  `).join("") || `<p class="helper">No hay usuarios todavía. Cuando alguien inicie sesión, marque favoritos o vea títulos, aparecerá aquí.</p>`;
}

function openAnalyticsTitle(key) {
  const item = state.analyticsTitles.find(title => contentKey(title.type, title.id) === key);
  if (!item) return;

  $("analyticsTitleName").textContent = item.title;
  $("analyticsTitleBody").innerHTML = `
    <div class="analytics-kpi-grid">
      <div class="analytics-kpi"><strong>${item.plays}</strong><span>Veces reproducido</span></div>
      <div class="analytics-kpi"><strong>${item.playUsersCount}</strong><span>Usuarios que dieron play</span></div>
      <div class="analytics-kpi"><strong>${item.completedUsersCount}</strong><span>Usuarios que finalizaron</span></div>
      <div class="analytics-kpi"><strong>${item.favoriteUsersCount}</strong><span>Agregado a favoritos</span></div>
    </div>
    <p class="helper">Estado: ${item.published === false ? "Oculto / no publicado" : "Publicado"}</p>
  `;
  $("analyticsTitleDialog").showModal();
}

function analyticsEntryLabel(entry) {
  const item = findContentItem(entry);
  const title = item?.title || entry.title || entry.id || "Sin título";
  return `${escapeHtml(title)} <small>${typeLabel(entry.type)}</small>`;
}

function openAnalyticsUser(uid) {
  const user = state.analyticsUsers.find(item => item.uid === uid);
  if (!user) return;

  const favoriteHtml = user.favorites
    .map(entry => `<li><span>${analyticsEntryLabel(entry)}</span><em>${formatAnalyticsDate(entry.addedAt || entry.updatedAt)}</em></li>`)
    .join("") || `<li><span>Sin favoritos</span><em>—</em></li>`;
  const continueHtml = user.continueWatching
    .map(entry => `<li><span>${analyticsEntryLabel(entry)}</span><em>${Math.round(Number(entry.progress || 0))}% · ${formatAnalyticsDate(entry.lastWatchedAt || entry.updatedAt)}</em></li>`)
    .join("") || `<li><span>Sin contenido en progreso</span><em>—</em></li>`;
  const historyHtml = sortByRecentDate(user.history)
    .map(entry => `<li><span>${analyticsEntryLabel(entry)}</span><strong>${Number(entry.playCount || 1)} play${Number(entry.playCount || 1) === 1 ? "" : "s"}</strong><em>${formatAnalyticsDate(entry.lastPlayedAt || entry.lastWatchedAt || entry.updatedAt)}</em></li>`)
    .join("") || `<li><span>Sin historial</span><strong>0</strong><em>—</em></li>`;

  $("analyticsUserName").textContent = user.email;
  $("analyticsUserBody").innerHTML = `
    <div class="analytics-user-meta">
      <p><strong>Email:</strong> ${escapeHtml(user.email)}</p>
      <p><strong>UID:</strong> ${escapeHtml(user.uid)}</p>
      <p><strong>Última actividad:</strong> ${formatAnalyticsDate(user.updatedAt || user.lastLoginAt)}</p>
    </div>
    <div class="analytics-kpi-grid">
      <div class="analytics-kpi"><strong>${user.history.reduce((sum, item) => sum + Number(item.playCount || 1), 0)}</strong><span>Plays</span></div>
      <div class="analytics-kpi"><strong>${user.favorites.length}</strong><span>Favoritos</span></div>
      <div class="analytics-kpi"><strong>${user.continueWatching.length}</strong><span>En progreso</span></div>
      <div class="analytics-kpi"><strong>${user.completed.length}</strong><span>Finalizados</span></div>
    </div>
    <div class="analytics-user-tabs" role="tablist" aria-label="Actividad del usuario">
      <button class="analytics-user-tab active" type="button" data-user-detail-tab="history" role="tab" aria-selected="true">Historial</button>
      <button class="analytics-user-tab" type="button" data-user-detail-tab="favorites" role="tab" aria-selected="false">Favoritos</button>
      <button class="analytics-user-tab" type="button" data-user-detail-tab="continue" role="tab" aria-selected="false">Continuar viendo</button>
    </div>
    <section class="analytics-user-tab-panel active" data-user-detail-panel="history" role="tabpanel">
      <h3>Historial</h3>
      <ul class="analytics-history analytics-user-list">${historyHtml}</ul>
    </section>
    <section class="analytics-user-tab-panel" data-user-detail-panel="favorites" role="tabpanel">
      <h3>Favoritos</h3>
      <ul class="analytics-list-plain analytics-user-list">${favoriteHtml}</ul>
    </section>
    <section class="analytics-user-tab-panel" data-user-detail-panel="continue" role="tabpanel">
      <h3>Continuar viendo</h3>
      <ul class="analytics-list-plain analytics-user-list">${continueHtml}</ul>
    </section>
  `;
  $("analyticsUserDialog").showModal();
}

async function loadAll() {
  const [moviesSnap, seriesSnap, concertsSnap, homeSnap] = await Promise.all([
    getDocs(collection(db, "movies")),
    getDocs(collection(db, "series")),
    getDocs(collection(db, "concerts")),
    getDoc(doc(db, "homeConfig", "main"))
  ]);

  state.movies = moviesSnap.docs.map(d => ({ id: d.id, ...d.data(), type: "movie", published: d.data().published !== false }));
  state.series = seriesSnap.docs.map(d => ({ id: d.id, ...d.data(), type: "series", published: d.data().published !== false }));
  state.concerts = concertsSnap.docs.map(d => ({ id: d.id, ...d.data(), type: "concert", published: d.data().published !== false }));

  if (homeSnap.exists()) {
    state.homeConfig = {
      ...clone(defaultHomeConfig),
      ...homeSnap.data(),
      sections: {
        ...clone(defaultHomeConfig.sections),
        ...(homeSnap.data().sections || {})
      },
      genreSections: {
        ...clone(defaultHomeConfig.genreSections),
        ...(homeSnap.data().genreSections || homeSnap.data().homeGenres || {})
      },
      collectionSections: {
        ...clone(defaultHomeConfig.collectionSections),
        ...(homeSnap.data().collectionSections || homeSnap.data().homeCollections || {})
      }
    };
  } else {
    state.homeConfig = clone(defaultHomeConfig);
  }
  render();
}

function setView(view) {
  state.view = view;
  Object.entries(views).forEach(([key, el]) => el.classList.toggle("active", key === view));
  document.querySelectorAll(".nav-btn").forEach(btn => btn.classList.toggle("active", btn.dataset.view === view));

  const titles = { home: "Home", movies: "Películas", series: "Series", concerts: "Conciertos", analytics: "Analytics" };
  pageTitle.textContent = titles[view] || "Home";

  if (view === "series") primaryAction.textContent = "Agregar serie";
  else if (view === "concerts") primaryAction.textContent = "Agregar concierto";
  else primaryAction.textContent = "Agregar película";

  primaryAction.style.visibility = (view === "home" || view === "analytics") ? "hidden" : "visible";
  $("importMovieBtn").classList.toggle("hidden", view !== "movies");
  $("pasteMovieCodeBtn").classList.toggle("hidden", view !== "movies");
  $("importSeriesBtn").classList.toggle("hidden", view !== "series");
  $("pasteSeriesCodeBtn").classList.toggle("hidden", view !== "series");
  $("importConcertBtn").classList.toggle("hidden", view !== "concerts");
  $("pasteConcertCodeBtn").classList.toggle("hidden", view !== "concerts");
  if (view === "analytics" && !state.analyticsLoaded) loadAnalytics();
  render();
}

function render() {
  renderHome();
  renderCards("moviesList", state.movies, "movie");
  renderCards("seriesList", state.series, "series");
  renderCards("concertsList", state.concerts, "concert");
  renderAnalytics();
}

function renderHome() {
  renderHomeSectionControls();
  HOME_SECTION_KEYS.forEach(sectionKey => {
    const config = getSectionConfig(sectionKey);
    const modeSelect = document.querySelector(`[data-home-mode="${sectionKey}"]`);
    const picker = document.querySelector(`[data-picker="${sectionKey}"]`);
    if (modeSelect) modeSelect.value = config.mode;
    if (picker) picker.classList.toggle("active", config.mode === "manual");
    renderSearchResults(sectionKey);
    renderSelectedItems(sectionKey);
  });
}


function getSortableHomeSectionEntries() {
  const labels = { movies: "Películas", series: "Series", concerts: "Conciertos" };
  const baseSections = DYNAMIC_HOME_SECTION_KEYS.map(sectionKey => {
    const config = getDynamicSectionConfig(sectionKey);
    return {
      id: `section:${sectionKey}`,
      type: "section",
      key: sectionKey,
      title: labels[sectionKey],
      subtitle: "Máximo 10 títulos",
      visible: config.visible,
      order: config.order
    };
  });

  const genreSections = getDetectedHomeGenres().map(name => {
    const genreState = getGenreSectionState(name);
    const count = [...state.movies, ...state.series].filter(item => itemGenres(item).some(g => genreSlug(g) === genreSlug(name))).length;
    return {
      id: `genre:${genreSlug(name)}`,
      type: "genre",
      key: name,
      title: name,
      subtitle: `${count} título${count === 1 ? "" : "s"} · Género`,
      visible: genreState.visible,
      order: genreState.order
    };
  });

  const collectionSections = getDetectedHomeCollections().map(name => {
    const collectionState = getCollectionSectionState(name);
    const count = getAllContent().filter(item => itemCollections(item).some(c => genreSlug(c) === genreSlug(name))).length;
    return {
      id: `collection:${genreSlug(name)}`,
      type: "collection",
      key: name,
      title: name,
      subtitle: `${count} título${count === 1 ? "" : "s"} · Colección`,
      visible: collectionState.visible,
      order: collectionState.order
    };
  });

  return [...baseSections, ...genreSections, ...collectionSections].sort((a, b) => {
    const byOrder = Number(a.order || 999) - Number(b.order || 999);
    if (byOrder) return byOrder;
    return a.title.localeCompare(b.title, "es");
  });
}

function renderHomeSectionControls() {
  const box = $("homeSectionControls");
  if (!box) return;
  const entries = getSortableHomeSectionEntries();
  if (!entries.length) {
    box.innerHTML = `<p class="helper">Todavía no hay secciones dinámicas detectadas.</p>`;
    return;
  }
  box.innerHTML = entries.map(entry => `
    <div class="home-order-card ${entry.visible ? "is-visible" : "is-hidden"}" draggable="true" data-home-order-card="${entry.id}" data-home-order-type="${entry.type}" data-home-order-key="${String(entry.key).replace(/"/g, '&quot;')}">
      <span class="drag-handle" aria-hidden="true">☰</span>
      <label class="mini-toggle" title="Mostrar en Home">
        <input type="checkbox" ${entry.type === "section" ? `data-home-section-visible="${entry.key}"` : entry.type === "collection" ? `data-home-collection="${String(entry.key).replace(/"/g, '&quot;')}"` : `data-home-genre="${String(entry.key).replace(/"/g, '&quot;')}"`} ${entry.visible ? "checked" : ""} />
        <span class="toggle-ui"></span>
      </label>
      <div class="home-order-copy">
        <strong>${entry.title}</strong>
        <em>${entry.subtitle}</em>
      </div>
    </div>
  `).join("");
}

function applyHomeSectionDragOrder() {
  const cards = Array.from(document.querySelectorAll("[data-home-order-card]"));
  cards.forEach((card, index) => {
    const order = (index + 1) * 10;
    if (card.dataset.homeOrderType === "section") {
      setDynamicSectionOrder(card.dataset.homeOrderKey, order);
    } else if (card.dataset.homeOrderType === "genre") {
      setGenreSectionOrder(card.dataset.homeOrderKey, order);
    } else if (card.dataset.homeOrderType === "collection") {
      setCollectionSectionOrder(card.dataset.homeOrderKey, order);
    }
  });
}

function getDragAfterElement(container, y) {
  const draggableElements = [...container.querySelectorAll("[data-home-order-card]:not(.dragging)")];
  return draggableElements.reduce((closest, child) => {
    const box = child.getBoundingClientRect();
    const offset = y - box.top - box.height / 2;
    if (offset < 0 && offset > closest.offset) {
      return { offset, element: child };
    }
    return closest;
  }, { offset: Number.NEGATIVE_INFINITY }).element;
}

function renderGenreToggles() {
  const box = $("homeGenreToggles");
  if (!box) return;
  const genres = getDetectedHomeGenres();
  if (!genres.length) {
    box.innerHTML = `<p class="helper">Todavía no hay géneros detectados en Películas o Series.</p>`;
    return;
  }
  box.innerHTML = genres.map(name => {
    const stateForGenre = getGenreSectionState(name);
    const count = state.movies.filter(item => itemGenres(item).some(g => genreSlug(g) === genreSlug(name))).length;
    return `
      <label class="genre-toggle">
        <input type="checkbox" data-home-genre="${name.replace(/"/g, '&quot;')}" ${stateForGenre.visible ? "checked" : ""} />
        <span class="toggle-ui"></span>
        <strong>${name}</strong>
        <em>${count} película${count === 1 ? "" : "s"}</em>
      </label>
    `;
  }).join("");
}

function renderSearchResults(sectionKey) {
  const resultsEl = document.querySelector(`[data-results="${sectionKey}"]`);
  const searchInput = document.querySelector(`[data-home-search="${sectionKey}"]`);
  if (!resultsEl || !searchInput) return;

  const query = searchInput.value.trim().toLowerCase();
  if (!query) {
    resultsEl.innerHTML = `<p class="helper">Busca contenido para agregarlo manualmente.</p>`;
    return;
  }

  const config = getSectionConfig(sectionKey);
  const selectedKeys = new Set(config.selectedItems.map(refKey));
  const limit = getSectionLimit(sectionKey);
  const source = getContentForSection(sectionKey)
    .filter(item => [
      item.title,
      item.id,
      item.year,
      item.genres,
      item.collection,
      item.collections,
      item.director,
      item.actors
    ].filter(Boolean).join(" ").toLowerCase().includes(query))
    .slice(0, 8);

  resultsEl.innerHTML = source.map(item => {
    const key = `${item.type}:${item.id}`;
    const disabled = selectedKeys.has(key) || config.selectedItems.length >= limit;
    const reason = selectedKeys.has(key) ? "Ya agregado" : config.selectedItems.length >= limit ? `Límite ${limit}` : "+";
    return `
      <div class="search-result ${disabled ? "is-disabled" : ""}">
        <img src="${item.posterUrl || ""}" alt="" />
        <div>
          <strong>${item.title || item.id}</strong>
          <span>${typeLabel(item.type)} · ${item.year || "Sin año"}</span>
        </div>
        <button class="add-mini" data-add-home="${sectionKey}" data-id="${item.id}" data-type="${item.type}" ${disabled ? "disabled" : ""}>${reason}</button>
      </div>
    `;
  }).join("") || `<p class="helper">No encontré resultados.</p>`;
}

function renderSelectedItems(sectionKey) {
  const selectedEl = document.querySelector(`[data-selected="${sectionKey}"]`);
  if (!selectedEl) return;

  const config = getSectionConfig(sectionKey);
  const previewItems = getPreviewItems(sectionKey);
  const label = config.mode === "manual" ? "Manual" : config.mode === "popular" ? "Preview por popularidad" : "Preview por recientes";
  const limit = getSectionLimit(sectionKey);
  const help = sectionKey === "new" ? `<div class="selection-note">Lo nuevo muestra 5: película más reciente, serie más reciente, concierto reciente, segunda película y segunda serie. Estos títulos también pueden aparecer en otras secciones.</div>` : "";

  selectedEl.innerHTML = `
    <div class="selected-summary">${label} · ${previewItems.length}/${limit} elementos</div>
    ${help}
    ${previewItems.length ? `<div class="selected-list" data-sort-list="${sectionKey}">${previewItems.map((item, index) => `
      <div class="selected-item" ${config.mode === "manual" ? `draggable="true" data-drag-section="${sectionKey}" data-index="${index}" data-id="${item.id}" data-type="${item.type}"` : ""}>
        <img src="${item.posterUrl || ""}" alt="" />
        <div>
          <strong>${item.title || item.id}</strong>
          <span>${typeLabel(item.type)} · ${item.year || "Sin año"}</span>
        </div>
        ${config.mode === "manual" ? `<div class="selected-actions"><span class="drag-handle" title="Arrastrar">⋮⋮</span><button class="remove-mini" data-remove-home="${sectionKey}" data-id="${item.id}" data-type="${item.type}">×</button></div>` : ""}
      </div>
    `).join("")}</div>` : `<div class="empty-selection">No hay contenido para esta sección.</div>`}
  `;
}

function renderCards(containerId, items, type) {
  $(containerId).innerHTML = items.map(item => `
    <article class="card ${item.published === false ? "unpublished" : ""}" data-id="${item.id}" data-type="${type}" data-edit-content="true" role="button" tabindex="0" title="Abrir editor">
      <img class="poster" src="${item.posterUrl || ""}" alt="" />
      <h3>${item.title || item.id}</h3>
      <p>${item.year || "Sin año"}</p>
      <div class="badge-row">
        <span class="badge ${item.published === false ? "" : "on"}">${item.published === false ? "Oculto" : "Publicado"}</span>
      </div>
    </article>
  `).join("") || `<p class="helper">No hay ${type === "movie" ? "películas" : type === "series" ? "series" : "conciertos"} todavía.</p>`;
}

function openEditor(type, item = null) {
  state.editingType = type;
  state.editingId = item?.id ?? null;
  state.editingSeriesId = type === "series" && item ? item.id : null;
  state.editingEpisodeId = null;

  $("editorType").textContent = typeLabel(type);
  $("editorTitle").textContent = item ? `Editar ${item.title || item.id}` : `Agregar ${type === "movie" ? "película" : type === "series" ? "serie" : "concierto"}`;
  $("docId").disabled = Boolean(item);
  $("docId").value = item?.id ?? "";
  $("title").value = item?.title ?? "";
  $("year").value = item?.year ?? "";
  $("duration").value = item?.duration ?? "";
  $("genres").value = formatGenresForInput(item?.genres);
  if ($("collections")) $("collections").value = formatListForInput(item?.collections || item?.collection);
  if ($("director")) $("director").value = item?.director ?? "";
  if ($("actors")) $("actors").value = formatListForInput(item?.actors);
  $("posterUrl").value = item?.posterUrl ?? "";
  if ($("backdropUrl")) $("backdropUrl").value = item?.backdropUrl ?? item?.backdrop ?? "";
  $("hlsUrl").value = item?.hlsUrl ?? "";
  $("synopsis").value = item?.synopsis ?? "";
  $("showInNew").checked = false;
  $("showInHome").checked = true;
  if ($("published")) $("published").checked = item?.published !== false;
  $("deleteBtn").classList.toggle("hidden", !item);
  document.querySelectorAll(".movie-only").forEach(el => el.classList.toggle("hidden", !(type === "movie" || type === "concert")));
  $("durationField").classList.toggle("hidden", !(type === "movie" || type === "concert"));

  const showEpisodes = type === "series" && Boolean(item);
  $("episodesPanel").classList.toggle("hidden", !showEpisodes);
  if (showEpisodes) loadEpisodes(item.id);
  else $("episodesList").innerHTML = "";

  $("editorDialog").showModal();
}

async function saveEditor(e) {
  e.preventDefault();
  const type = state.editingType;
  const id = state.editingId || slugify($("docId").value || $("title").value);
  const baseData = {
    title: $("title").value.trim(),
    year: Number($("year").value) || null,
    genres: splitGenres($("genres").value),
    collection: splitList($("collections")?.value || "").join(", "),
    collections: splitList($("collections")?.value || ""),
    director: ($("director")?.value || "").trim(),
    actors: splitList($("actors")?.value || ""),
    synopsis: $("synopsis").value.trim(),
    posterUrl: $("posterUrl").value.trim(),
    backdropUrl: ($("backdropUrl")?.value || "").trim(),
    type,
    published: $("published") ? $("published").checked : true,
    updatedAt: serverTimestamp(),
  };
  if (!state.editingId) baseData.createdAt = serverTimestamp();
  if (type === "movie" || type === "concert") {
    baseData.duration = Number($("duration").value) || 0;
    baseData.hlsUrl = $("hlsUrl").value.trim();
  }
  await setDoc(doc(db, collectionForType(type), id), baseData, { merge: true });
  $("editorDialog").close();
  showStatus("Guardado correctamente");
  await loadAll();
}

async function deleteCurrent() {
  if (!state.editingId) return;
  if (!confirm("¿Eliminar este contenido?")) return;
  await deleteDoc(doc(db, collectionForType(state.editingType), state.editingId));
  $("editorDialog").close();
  showStatus("Eliminado");
  await loadAll();
}

async function saveHome() {
  const cleanSections = {};
  HOME_SECTION_KEYS.forEach(sectionKey => {
    const config = getSectionConfig(sectionKey);
    cleanSections[sectionKey] = {
      mode: config.mode,
      limit: getSectionLimit(sectionKey),
      selectedItems: getPreviewItems(sectionKey).map(normalizeSelectedItem).slice(0, getSectionLimit(sectionKey))
    };
    if (DYNAMIC_HOME_SECTION_KEYS.includes(sectionKey)) {
      const dynamicConfig = getDynamicSectionConfig(sectionKey);
      cleanSections[sectionKey].visible = dynamicConfig.visible;
      cleanSections[sectionKey].order = dynamicConfig.order;
    }
  });

  const cleanGenreSections = {};
  getDetectedHomeGenres().forEach(name => {
    const genreState = getGenreSectionState(name);
    cleanGenreSections[name] = { visible: genreState.visible, order: genreState.order };
  });

  const cleanCollectionSections = {};
  getDetectedHomeCollections().forEach(name => {
    const collectionState = getCollectionSectionState(name);
    cleanCollectionSections[name] = { visible: collectionState.visible, order: collectionState.order };
  });

  await setDoc(doc(db, "homeConfig", "main"), {
    sections: cleanSections,
    genreSections: cleanGenreSections,
    collectionSections: cleanCollectionSections,
    updatedAt: serverTimestamp()
  }, { merge: true });

  showStatus("Home actualizado");
  await loadAll();
}

async function loadEpisodes(seriesId, preferredSeason = null) {
  state.editingSeriesId = seriesId;
  const snap = await getDocs(collection(db, "series", seriesId, "episodes"));
  state.currentEpisodes = snap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .sort((a, b) => (Number(a.seasonNumber || 0) - Number(b.seasonNumber || 0)) || (Number(a.episodeNumber || 0) - Number(b.episodeNumber || 0)));

  const seasons = [...new Set(state.currentEpisodes.map(ep => Number(ep.seasonNumber || 1)))].sort((a, b) => a - b);

  if (preferredSeason) {
    state.selectedSeason = Number(preferredSeason);
  } else if (!state.selectedSeason || !seasons.includes(Number(state.selectedSeason))) {
    state.selectedSeason = seasons[0] || 1;
  }

  renderSeasonFilter(seasons);
  renderEpisodesList();
}

function renderSeasonFilter(seasons) {
  const filter = $("seasonFilter");
  if (!filter) return;

  const allSeasons = seasons.length ? seasons : [Number(state.selectedSeason || 1)];
  filter.innerHTML = allSeasons
    .map(season => `<option value="${season}">Temporada ${season}</option>`)
    .join("");
  filter.value = String(state.selectedSeason || allSeasons[0] || 1);
}

function renderEpisodesList() {
  const season = Number(state.selectedSeason || 1);
  const episodes = state.currentEpisodes.filter(ep => Number(ep.seasonNumber || 1) === season);

  $("episodesList").innerHTML = episodes.map(ep => `
    <div class="episode-item" data-id="${ep.id}">
      <div><strong>${ep.title || ep.id}</strong><br><span>T${ep.seasonNumber} · E${ep.episodeNumber}</span></div>
      <span>${ep.duration || 0} min</span>
    </div>
  `).join("") || `<p class="helper">No hay episodios en la temporada ${season}. Usa “Agregar episodio” para crear el primero.</p>`;
}

function nextEpisodeNumberForSeason(season) {
  const nums = state.currentEpisodes
    .filter(ep => Number(ep.seasonNumber || 1) === Number(season))
    .map(ep => Number(ep.episodeNumber || 0));
  return nums.length ? Math.max(...nums) + 1 : 1;
}

function episodeDocId(season, episode) {
  return `s${String(season || 1).padStart(2, "0")}e${String(episode || 1).padStart(2, "0")}`;
}

function fillEpisodeForm(data = {}) {
  const season = Number(data.seasonNumber || data.season || state.selectedSeason || 1);
  const episode = Number(data.episodeNumber || data.episode || nextEpisodeNumberForSeason(season));

  $("episodeDocId").value = data.id || data.docId || data.slug || episodeDocId(season, episode);
  $("episodeTitle").value = data.title || data.name || `Episodio ${episode}`;
  $("seasonNumber").value = season;
  $("episodeNumber").value = episode;
  $("episodeDuration").value = data.duration || "";
  $("episodeHlsUrl").value = data.hlsUrl || data.videoUrl || data.url || "";
  $("episodeSynopsis").value = data.synopsis || data.overview || data.description || "";
}

function openEpisodeEditor(ep = null) {
  state.editingEpisodeId = ep?.id ?? null;
  $("episodeEditorTitle").textContent = ep ? `Editar ${ep.title || ep.id}` : "Agregar episodio";
  $("episodeDocId").disabled = Boolean(ep);

  if (ep) {
    fillEpisodeForm(ep);
  } else {
    const season = Number(state.selectedSeason || 1);
    const nextEpisode = nextEpisodeNumberForSeason(season);
    fillEpisodeForm({ seasonNumber: season, episodeNumber: nextEpisode, title: "" });
    $("episodeTitle").value = "";
  }

  $("deleteEpisodeBtn").classList.toggle("hidden", !ep);
  $("episodeDialog").showModal();
}

async function importEpisodeFromJson(file) {
  try {
    const text = await file.text();
    const raw = getEpisodeRawFromJsonValue(JSON.parse(text));
    if (!raw) return alert("El JSON no contiene episodio.");
    fillEpisodeForm(raw);
    showStatus("Campos del episodio importados. Revisa y guarda.");
  } catch (error) {
    console.error(error);
    alert("No se pudo importar el episodio. Revisa que sea JSON válido.");
  } finally {
    $("importEpisodeInput").value = "";
  }
}

async function importEpisodesFromJsonFiles(files) {
  const seriesId = state.editingSeriesId;
  if (!seriesId) {
    $("importEpisodeInput").value = "";
    return alert("Primero guarda o abre una serie para importar episodios.");
  }

  try {
    const selectedFiles = Array.from(files || []);
    const { parsed, failed } = await parseJsonFiles(selectedFiles);
    const rawEpisodes = parsed.flatMap(({ json, file }) =>
      getEpisodeItemsFromJsonValue(json).map(raw => ({ raw, fileName: file?.name || "" }))
    );
    if (!rawEpisodes.length) return alert("Los JSON seleccionados no contienen episodios.");

    const usedIds = new Set();
    const normalized = rawEpisodes.map(({ raw, fileName }, index) => {
      const item = normalizeEpisodeFromJson(raw, index, fileName);
      let uniqueId = item.id || slugify(fileName || `episode-${index + 1}`);
      if (usedIds.has(uniqueId)) {
        const season = Number(item.data.seasonNumber || 1);
        const episode = Number(item.data.episodeNumber || index + 1);
        const episodeKey = `s${String(season).padStart(2, "0")}e${String(episode).padStart(2, "0")}`;
        const fileKey = String(fileName || `archivo-${index + 1}`).replace(/\.json$/i, "");
        uniqueId = slugify(`${episodeKey}-${fileKey}-${index + 1}`);
      }
      usedIds.add(uniqueId);
      item.id = uniqueId;
      return item;
    });
    await Promise.all(normalized.map(ep => setDoc(doc(db, "series", seriesId, "episodes", ep.id), ep.data, { merge: true })));

    const importedSeasons = normalized.map(ep => Number(ep.data.seasonNumber || 1));
    const preferredSeason = importedSeasons[0] || state.selectedSeason || 1;
    if ($("episodeDialog")?.open) $("episodeDialog").close();
    await loadEpisodes(seriesId, preferredSeason);

    const suffix = failed.length ? ` (${failed.length} archivo${failed.length === 1 ? "" : "s"} falló${failed.length === 1 ? "" : "n"})` : "";
    showStatus(`${normalized.length} episodio${normalized.length === 1 ? "" : "s"} importado${normalized.length === 1 ? "" : "s"} automáticamente${suffix}`);
  } catch (error) {
    console.error(error);
    alert("No se pudieron importar los episodios. Revisa que los archivos sean JSON válidos.");
  } finally {
    $("importEpisodeInput").value = "";
  }
}

async function saveEpisode(e) {
  e.preventDefault();
  const seriesId = state.editingSeriesId;
  if (!seriesId) return alert("Primero guarda o abre una serie.");
  const id = state.editingEpisodeId || slugify($("episodeDocId").value || `s${$("seasonNumber").value}e${$("episodeNumber").value}`);
  const data = {
    title: $("episodeTitle").value.trim(),
    seasonNumber: Number($("seasonNumber").value),
    episodeNumber: Number($("episodeNumber").value),
    duration: Number($("episodeDuration").value) || 0,
    synopsis: $("episodeSynopsis").value.trim(),
    hlsUrl: $("episodeHlsUrl").value.trim(),
    updatedAt: serverTimestamp(),
  };
  if (!state.editingEpisodeId) data.createdAt = serverTimestamp();
  await setDoc(doc(db, "series", seriesId, "episodes", id), data, { merge: true });
  $("episodeDialog").close();
  showStatus("Episodio guardado");
  await loadEpisodes(seriesId, data.seasonNumber);
}

async function deleteEpisode() {
  if (!state.editingEpisodeId || !state.editingSeriesId) return;
  if (!confirm("¿Eliminar episodio?")) return;
  const season = Number($("seasonNumber").value || state.selectedSeason || 1);
  await deleteDoc(doc(db, "series", state.editingSeriesId, "episodes", state.editingEpisodeId));
  $("episodeDialog").close();
  await loadEpisodes(state.editingSeriesId, season);
}

function addHomeItem(sectionKey, id, type) {
  const config = getSectionConfig(sectionKey);
  const key = `${type}:${id}`;
  const limit = getSectionLimit(sectionKey);
  if (config.selectedItems.length >= limit) return showStatus(`Máximo ${limit} elementos por sección`);
  const exists = config.selectedItems.some(item => item.id === id && item.type === type);
  if (!exists) config.selectedItems.push({ id, type });
  renderHome();
}

function removeHomeItem(sectionKey, id, type) {
  const config = getSectionConfig(sectionKey);
  config.selectedItems = config.selectedItems.filter(item => !(item.id === id && item.type === type));
  renderHome();
}

function reorderHomeItem(sectionKey, fromIndex, toIndex) {
  const config = getSectionConfig(sectionKey);
  if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0) return;
  const [item] = config.selectedItems.splice(fromIndex, 1);
  config.selectedItems.splice(toIndex, 0, item);
  renderHome();
}

function handleCardActivation(target) {
  const trigger = target.closest("[data-edit-content]");
  const card = trigger?.closest(".card") || target.closest(".card");
  if (!card) return false;

  const contentType = trigger?.dataset.type || card.dataset.type;
  const contentId = trigger?.dataset.id || card.dataset.id;
  if (!contentType || !contentId) return false;

  const list = listForType(contentType);
  const item = list.find(i => i.id === contentId);
  if (!item) {
    showStatus("No encontré ese contenido en memoria. Refresca la página.");
    return true;
  }

  try {
    openEditor(contentType, item);
  } catch (error) {
    console.error("Error abriendo editor:", error);
    showStatus("Error abriendo editor. Revisa la consola.");
  }
  return true;
}

document.querySelectorAll(".nav-btn").forEach(btn => btn.addEventListener("click", () => setView(btn.dataset.view)));
primaryAction.addEventListener("click", () => openEditor(state.view === "series" ? "series" : state.view === "concerts" ? "concert" : "movie"));
$("importMovieBtn").addEventListener("click", () => $("importMovieInput").click());
$("importMovieInput").addEventListener("change", (e) => { const files = e.target.files; if (files?.length) importMoviesFromJsonFiles(files); });
$("importSeriesBtn").addEventListener("click", () => $("importSeriesInput").click());
$("importSeriesInput").addEventListener("change", (e) => { const files = e.target.files; if (files?.length) importSeriesFromJsonFiles(files); });
$("importConcertBtn").addEventListener("click", () => $("importConcertInput").click());
$("importConcertInput").addEventListener("change", (e) => { const files = e.target.files; if (files?.length) importConcertsFromJsonFiles(files); });

$("pasteMovieCodeBtn").addEventListener("click", () => openJsonCodeDialog("movie"));
$("pasteSeriesCodeBtn").addEventListener("click", () => openJsonCodeDialog("series"));
$("pasteConcertCodeBtn").addEventListener("click", () => openJsonCodeDialog("concert"));
$("pasteEpisodeCodeBtn").addEventListener("click", () => openJsonCodeDialog("episode"));
$("jsonCodeForm").addEventListener("submit", submitJsonCode);
$("closeJsonCodeDialog").addEventListener("click", () => $("jsonCodeDialog").close());
$("cancelJsonCodeBtn").addEventListener("click", () => $("jsonCodeDialog").close());


// Extra direct listeners for the Películas and Series grids.
// This makes the entire card open the same editor used by the manual add flow.
$("moviesList").addEventListener("click", (e) => handleCardActivation(e.target));
$("seriesList").addEventListener("click", (e) => handleCardActivation(e.target));
$("concertsList").addEventListener("click", (e) => handleCardActivation(e.target));
$("editorForm").addEventListener("submit", saveEditor);
$("closeEditor").addEventListener("click", () => $("editorDialog").close());
$("cancelBtn").addEventListener("click", () => $("editorDialog").close());
$("deleteBtn").addEventListener("click", deleteCurrent);
$("saveHomeBtn").addEventListener("click", saveHome);
$("addEpisodeBtn").addEventListener("click", () => openEpisodeEditor());
$("seasonFilter").addEventListener("change", () => {
  state.selectedSeason = Number($("seasonFilter").value || 1);
  renderEpisodesList();
});
$("importEpisodeBtn").addEventListener("click", () => $("importEpisodeInput").click());
$("importEpisodeInput").addEventListener("change", (e) => { const files = e.target.files; if (files?.length) importEpisodesFromJsonFiles(files); });
$("episodeForm").addEventListener("submit", saveEpisode);
$("closeEpisodeEditor").addEventListener("click", () => $("episodeDialog").close());
$("cancelEpisodeBtn").addEventListener("click", () => $("episodeDialog").close());
$("deleteEpisodeBtn").addEventListener("click", deleteEpisode);

document.querySelectorAll("[data-home-mode]").forEach(select => {
  select.addEventListener("change", () => {
    const sectionKey = select.dataset.homeMode;
    getSectionConfig(sectionKey).mode = select.value;
    renderHome();
  });
});

document.querySelectorAll("[data-home-search]").forEach(input => {
  input.addEventListener("input", () => renderSearchResults(input.dataset.homeSearch));
});


document.addEventListener("change", (e) => {
  const sectionVisible = e.target.closest("[data-home-section-visible]");
  if (sectionVisible) {
    setDynamicSectionVisible(sectionVisible.dataset.homeSectionVisible, sectionVisible.checked);
    renderHomeSectionControls();
    return;
  }

  const genreInput = e.target.closest("[data-home-genre]");
  if (genreInput) {
    setGenreSectionVisible(genreInput.dataset.homeGenre, genreInput.checked);
    renderHomeSectionControls();
    return;
  }

  const collectionInput = e.target.closest("[data-home-collection]");
  if (collectionInput) {
    setCollectionSectionVisible(collectionInput.dataset.homeCollection, collectionInput.checked);
    renderHomeSectionControls();
  }
});

document.addEventListener("input", (e) => {
  const sectionOrder = e.target.closest("[data-home-section-order]");
  if (sectionOrder) {
    setDynamicSectionOrder(sectionOrder.dataset.homeSectionOrder, sectionOrder.value);
    return;
  }

  const genreOrder = e.target.closest("[data-home-genre-order]");
  if (genreOrder) {
    setGenreSectionOrder(genreOrder.dataset.homeGenreOrder, genreOrder.value);
    return;
  }

  const collectionOrder = e.target.closest("[data-home-collection-order]");
  if (collectionOrder) {
    setCollectionSectionOrder(collectionOrder.dataset.homeCollectionOrder, collectionOrder.value);
  }
});

document.addEventListener("dragstart", (e) => {
  const card = e.target.closest("[data-home-order-card]");
  if (!card) return;
  card.classList.add("dragging");
  e.dataTransfer.effectAllowed = "move";
  e.dataTransfer.setData("text/plain", card.dataset.homeOrderCard || "");
});

document.addEventListener("dragover", (e) => {
  const list = e.target.closest("#homeSectionControls");
  if (!list) return;
  e.preventDefault();
  const dragging = list.querySelector(".dragging");
  if (!dragging) return;
  const afterElement = getDragAfterElement(list, e.clientY);
  if (!afterElement) {
    list.appendChild(dragging);
  } else {
    list.insertBefore(dragging, afterElement);
  }
});

document.addEventListener("drop", (e) => {
  const list = e.target.closest("#homeSectionControls");
  if (!list) return;
  e.preventDefault();
  applyHomeSectionDragOrder();
});

document.addEventListener("dragend", (e) => {
  const card = e.target.closest("[data-home-order-card]");
  if (!card) return;
  card.classList.remove("dragging");
  applyHomeSectionDragOrder();
  renderHomeSectionControls();
});


document.querySelectorAll("[data-analytics-tab]").forEach(btn => {
  btn.addEventListener("click", () => {
    state.analyticsTab = btn.dataset.analyticsTab || "titles";
    renderAnalytics();
    if (!state.analyticsLoaded && !state.analyticsLoading) loadAnalytics();
  });
});

$("refreshAnalyticsBtn")?.addEventListener("click", () => loadAnalytics());
$("analyticsTitlesList")?.addEventListener("click", (e) => {
  const card = e.target.closest("[data-analytics-title]");
  if (card) openAnalyticsTitle(card.dataset.analyticsTitle);
});
$("analyticsUsersList")?.addEventListener("click", (e) => {
  const row = e.target.closest("[data-analytics-user]");
  if (row) openAnalyticsUser(row.dataset.analyticsUser);
});
$("closeAnalyticsTitle")?.addEventListener("click", () => $("analyticsTitleDialog")?.close());
$("closeAnalyticsUser")?.addEventListener("click", () => $("analyticsUserDialog")?.close());

document.addEventListener("click", async (e) => {
  const detailTab = e.target.closest("[data-user-detail-tab]");
  if (detailTab) {
    const tabName = detailTab.dataset.userDetailTab;
    const body = $("analyticsUserBody");
    body?.querySelectorAll("[data-user-detail-tab]").forEach(btn => {
      const isActive = btn.dataset.userDetailTab === tabName;
      btn.classList.toggle("active", isActive);
      btn.setAttribute("aria-selected", isActive ? "true" : "false");
    });
    body?.querySelectorAll("[data-user-detail-panel]").forEach(panel => {
      panel.classList.toggle("active", panel.dataset.userDetailPanel === tabName);
    });
    return;
  }

  const addBtn = e.target.closest("[data-add-home]");
  if (addBtn) return addHomeItem(addBtn.dataset.addHome, addBtn.dataset.id, addBtn.dataset.type);

  const removeBtn = e.target.closest("[data-remove-home]");
  if (removeBtn) return removeHomeItem(removeBtn.dataset.removeHome, removeBtn.dataset.id, removeBtn.dataset.type);

  if (handleCardActivation(e.target)) return;

  const epItem = e.target.closest(".episode-item");
  if (epItem) {
    const snap = await getDoc(doc(db, "series", state.editingSeriesId, "episodes", epItem.dataset.id));
    return openEpisodeEditor({ id: snap.id, ...snap.data() });
  }
});

document.addEventListener("keydown", (e) => {
  if (e.key !== "Enter" && e.key !== " ") return;

  const analyticsTitle = e.target.closest?.("[data-analytics-title]");
  if (analyticsTitle) {
    e.preventDefault();
    openAnalyticsTitle(analyticsTitle.dataset.analyticsTitle);
    return;
  }

  const analyticsUser = e.target.closest?.("[data-analytics-user]");
  if (analyticsUser) {
    e.preventDefault();
    openAnalyticsUser(analyticsUser.dataset.analyticsUser);
    return;
  }

  if (handleCardActivation(e.target)) e.preventDefault();
});

document.addEventListener("dragstart", (e) => {
  const item = e.target.closest("[data-drag-section]");
  if (!item) return;
  state.drag = { section: item.dataset.dragSection, index: Number(item.dataset.index) };
  item.classList.add("dragging");
  e.dataTransfer.effectAllowed = "move";
});

document.addEventListener("dragend", (e) => {
  const item = e.target.closest("[data-drag-section]");
  if (item) item.classList.remove("dragging");
  state.drag = null;
});

document.addEventListener("dragover", (e) => {
  const item = e.target.closest("[data-drag-section]");
  if (!item || !state.drag || item.dataset.dragSection !== state.drag.section) return;
  e.preventDefault();
});

document.addEventListener("drop", (e) => {
  const item = e.target.closest("[data-drag-section]");
  if (!item || !state.drag || item.dataset.dragSection !== state.drag.section) return;
  e.preventDefault();
  reorderHomeItem(state.drag.section, state.drag.index, Number(item.dataset.index));
});

$("title").addEventListener("blur", () => {
  if (!state.editingId && !$("docId").value) $("docId").value = slugify($("title").value);
});
$("seasonNumber").addEventListener("input", updateEpisodeIdHint);
$("episodeNumber").addEventListener("input", updateEpisodeIdHint);
function updateEpisodeIdHint() {
  if (state.editingEpisodeId) return;
  $("episodeDocId").value = episodeDocId(Number($("seasonNumber").value || 1), Number($("episodeNumber").value || 1));
}

$("loginForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = $("loginEmail").value.trim();
  const password = $("loginPassword").value;
  $("loginError").textContent = "";
  try {
    await signInWithEmailAndPassword(auth, email, password);
  } catch (error) {
    console.error(error);
    $("loginError").textContent = error.message || "No se pudo iniciar sesión.";
  }
});

$("logoutBtn").addEventListener("click", () => signOut(auth));

onAuthStateChanged(auth, async (user) => {
  const isLoggedIn = Boolean(user);
  $("loginScreen").classList.toggle("hidden", isLoggedIn);
  document.querySelector(".sidebar").classList.toggle("hidden", !isLoggedIn);
  document.querySelector(".app").classList.toggle("hidden", !isLoggedIn);

  if (!isLoggedIn) return;

  $("userEmail").textContent = user.email || "Admin";
  setView("home");
  await loadAll().catch(err => {
    console.error(err);
    showStatus(`Error Firebase: ${err.code || ""} ${err.message || err}`);
  });
});
