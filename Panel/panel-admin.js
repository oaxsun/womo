import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import {
  getFirestore, collection, getDocs, doc, getDoc, setDoc, deleteDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";


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

const defaultHomeConfig = {
  sections: {
    new: { mode: "recent", limit: 10, selectedItems: [] },
    movies: { mode: "recent", limit: 10, selectedItems: [] },
    series: { mode: "recent", limit: 10, selectedItems: [] }
  }
};

const clone = (value) => JSON.parse(JSON.stringify(value));

const state = {
  view: "home",
  movies: [],
  series: [],
  homeConfig: clone(defaultHomeConfig),
  editingType: "movie",
  editingId: null,
  editingSeriesId: null,
  editingEpisodeId: null,
  currentEpisodes: [],
  selectedSeason: null,
  drag: null
};

const $ = (id) => document.getElementById(id);
const views = { home: $("homeView"), movies: $("moviesView"), series: $("seriesView") };
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

function getAllContent() {
  return [...state.movies, ...state.series];
}

function refKey(ref) {
  return `${ref.type}:${ref.id}`;
}

function normalizeSelectedItem(item) {
  return { id: item.id, type: item.type === "series" ? "series" : "movie" };
}

function findContentItem(ref) {
  const list = ref.type === "series" ? state.series : state.movies;
  return list.find(item => item.id === ref.id);
}

function getSectionConfig(sectionKey) {
  if (!state.homeConfig.sections) state.homeConfig.sections = {};
  if (!state.homeConfig.sections[sectionKey]) {
    state.homeConfig.sections[sectionKey] = clone(defaultHomeConfig.sections[sectionKey]);
  }
  const config = state.homeConfig.sections[sectionKey];
  config.limit = 10;
  config.selectedItems = Array.isArray(config.selectedItems) ? config.selectedItems.map(normalizeSelectedItem) : [];
  config.mode = config.mode || "recent";
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

function getRawContentForSection(sectionKey) {
  if (sectionKey === "movies") return state.movies;
  if (sectionKey === "series") return state.series;
  return getAllContent();
}

function getNewSectionKeys() {
  const items = getPreviewItems("new", { ignoreExclusion: true });
  return new Set(items.map(item => `${item.type}:${item.id}`));
}

function getContentForSection(sectionKey, options = {}) {
  let source = getRawContentForSection(sectionKey);
  if (!options.ignoreExclusion && sectionKey !== "new") {
    const newKeys = getNewSectionKeys();
    source = source.filter(item => !newKeys.has(`${item.type}:${item.id}`));
  }
  return source;
}

function getPreviewItems(sectionKey, options = {}) {
  const config = getSectionConfig(sectionKey);
  const source = getContentForSection(sectionKey, options);
  if (config.mode === "manual") {
    const allowedKeys = new Set(source.map(item => `${item.type}:${item.id}`));
    return config.selectedItems
      .filter(ref => allowedKeys.has(refKey(ref)))
      .map(findContentItem)
      .filter(Boolean)
      .slice(0, 10);
  }
  if (config.mode === "popular") return sortByPopularity(source).slice(0, 10);
  return sortByRecent(source).slice(0, 10);
}

function normalizeMovieFromJson(rawMovie, index = 0) {
  const title = String(rawMovie.title || rawMovie.name || "").trim();
  const idSource = rawMovie.id || rawMovie.docId || rawMovie.slug || title || `movie-${Date.now()}-${index}`;
  const id = slugify(String(idSource));

  let genres = [];
  if (Array.isArray(rawMovie.genres)) genres = rawMovie.genres.map(g => String(g).trim()).filter(Boolean);
  else if (typeof rawMovie.genres === "string") genres = splitGenres(rawMovie.genres);
  else if (typeof rawMovie.genre === "string") genres = splitGenres(rawMovie.genre);

  return {
    id,
    data: {
      title,
      year: Number(rawMovie.year) || null,
      genres,
      duration: Number(rawMovie.duration) || 0,
      synopsis: String(rawMovie.synopsis || rawMovie.overview || rawMovie.description || "").trim(),
      posterUrl: String(rawMovie.posterUrl || rawMovie.posterURL || rawMovie.poster || "").trim(),
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

  const episodes = Array.isArray(rawSeries.episodes) ? rawSeries.episodes : [];

  return {
    id,
    episodes,
    data: {
      title,
      year: Number(rawSeries.year) || null,
      genres,
      synopsis: String(rawSeries.synopsis || rawSeries.overview || rawSeries.description || "").trim(),
      posterUrl: String(rawSeries.posterUrl || rawSeries.posterURL || rawSeries.poster || "").trim(),
      type: "series",
      isFavorite: Boolean(rawSeries.isFavorite),
      popularity: Number(rawSeries.popularity) || 0,
      updatedAt: serverTimestamp(),
      createdAt: serverTimestamp(),
    }
  };
}

function normalizeEpisodeFromJson(rawEpisode, index = 0) {
  const seasonNumber = Number(rawEpisode.seasonNumber || rawEpisode.season || 1);
  const episodeNumber = Number(rawEpisode.episodeNumber || rawEpisode.episode || index + 1);
  const id = slugify(rawEpisode.id || rawEpisode.docId || rawEpisode.slug || `s${String(seasonNumber).padStart(2, "0")}e${String(episodeNumber).padStart(2, "0")}`);
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

async function importMoviesFromJson(file) {
  try {
    const text = await file.text();
    const json = JSON.parse(text);
    const items = Array.isArray(json) ? json : Array.isArray(json.movies) ? json.movies : [json];
    if (!items.length) return showStatus("El JSON no contiene películas");

    const normalized = items.map(normalizeMovieFromJson);
    const invalid = normalized.find(item => !item.data.title);
    if (invalid) return alert("El JSON debe incluir al menos title en cada película. Poster URL y HLS URL se pueden agregar después desde el editor.");

    await Promise.all(normalized.map(item => setDoc(doc(db, "movies", item.id), item.data, { merge: true })));
    showStatus(`${normalized.length} película${normalized.length === 1 ? "" : "s"} importada${normalized.length === 1 ? "" : "s"}`);
    await loadAll();
    setView("movies");
  } catch (error) {
    console.error(error);
    alert("No se pudo importar el JSON. Revisa que el archivo sea válido.");
  } finally {
    $("importMovieInput").value = "";
  }
}

async function importSeriesFromJson(file) {
  try {
    const text = await file.text();
    const json = JSON.parse(text);
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
  } catch (error) {
    console.error(error);
    alert("No se pudo importar el JSON. Revisa que el archivo sea válido.");
  } finally {
    $("importSeriesInput").value = "";
  }
}

async function loadAll() {
  const [moviesSnap, seriesSnap, homeSnap] = await Promise.all([
    getDocs(collection(db, "movies")),
    getDocs(collection(db, "series")),
    getDoc(doc(db, "homeConfig", "main"))
  ]);

  state.movies = moviesSnap.docs.map(d => ({ id: d.id, ...d.data(), type: "movie" }));
  state.series = seriesSnap.docs.map(d => ({ id: d.id, ...d.data(), type: "series" }));

  if (homeSnap.exists()) {
    state.homeConfig = {
      ...clone(defaultHomeConfig),
      ...homeSnap.data(),
      sections: {
        ...clone(defaultHomeConfig.sections),
        ...(homeSnap.data().sections || {})
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
  pageTitle.textContent = view === "home" ? "Home" : view === "movies" ? "Películas" : "Series";
  primaryAction.textContent = view === "series" ? "Agregar serie" : "Agregar película";
  primaryAction.style.visibility = view === "home" ? "hidden" : "visible";
  $("importMovieBtn").classList.toggle("hidden", view !== "movies");
  $("importSeriesBtn").classList.toggle("hidden", view !== "series");
  render();
}

function render() {
  renderHome();
  renderCards("moviesList", state.movies, "movie");
  renderCards("seriesList", state.series, "series");
}

function renderHome() {
  ["new", "movies", "series"].forEach(sectionKey => {
    const config = getSectionConfig(sectionKey);
    const modeSelect = document.querySelector(`[data-home-mode="${sectionKey}"]`);
    const picker = document.querySelector(`[data-picker="${sectionKey}"]`);
    if (modeSelect) modeSelect.value = config.mode;
    if (picker) picker.classList.toggle("active", config.mode === "manual");
    renderSearchResults(sectionKey);
    renderSelectedItems(sectionKey);
  });
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
  const newKeys = sectionKey !== "new" ? getNewSectionKeys() : new Set();
  const source = getContentForSection(sectionKey)
    .filter(item => (item.title || item.id).toLowerCase().includes(query))
    .slice(0, 8);

  resultsEl.innerHTML = source.map(item => {
    const key = `${item.type}:${item.id}`;
    const inNew = newKeys.has(key);
    const disabled = selectedKeys.has(key) || config.selectedItems.length >= 10 || inNew;
    const reason = inNew ? "Ya está en Lo nuevo" : selectedKeys.has(key) ? "Ya agregado" : config.selectedItems.length >= 10 ? "Límite 10" : "+";
    return `
      <div class="search-result ${disabled ? "is-disabled" : ""}">
        <img src="${item.posterUrl || ""}" alt="" />
        <div>
          <strong>${item.title || item.id}</strong>
          <span>${item.type === "movie" ? "Película" : "Serie"} · ${item.year || "Sin año"}</span>
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
  const help = sectionKey !== "new" ? `<div class="selection-note">El contenido que ya está en Lo nuevo se excluye automáticamente para evitar repetidos.</div>` : "";

  selectedEl.innerHTML = `
    <div class="selected-summary">${label} · ${previewItems.length}/10 elementos</div>
    ${help}
    ${previewItems.length ? `<div class="selected-list" data-sort-list="${sectionKey}">${previewItems.map((item, index) => `
      <div class="selected-item" ${config.mode === "manual" ? `draggable="true" data-drag-section="${sectionKey}" data-index="${index}" data-id="${item.id}" data-type="${item.type}"` : ""}>
        <img src="${item.posterUrl || ""}" alt="" />
        <div>
          <strong>${item.title || item.id}</strong>
          <span>${item.type === "movie" ? "Película" : "Serie"} · ${item.year || "Sin año"}</span>
        </div>
        ${config.mode === "manual" ? `<div class="selected-actions"><span class="drag-handle" title="Arrastrar">⋮⋮</span><button class="remove-mini" data-remove-home="${sectionKey}" data-id="${item.id}" data-type="${item.type}">×</button></div>` : ""}
      </div>
    `).join("")}</div>` : `<div class="empty-selection">No hay contenido para esta sección.</div>`}
  `;
}

function renderCards(containerId, items, type) {
  $(containerId).innerHTML = items.map(item => `
    <article class="card" data-id="${item.id}" data-type="${type}" data-edit-content="true" role="button" tabindex="0" title="Abrir editor">
      <img class="poster" src="${item.posterUrl || ""}" alt="" />
      <h3>${item.title || item.id}</h3>
      <p>${item.year || "Sin año"}</p>
    </article>
  `).join("") || `<p class="helper">No hay ${type === "movie" ? "películas" : "series"} todavía.</p>`;
}

function openEditor(type, item = null) {
  state.editingType = type;
  state.editingId = item?.id ?? null;
  state.editingSeriesId = type === "series" && item ? item.id : null;
  state.editingEpisodeId = null;

  $("editorType").textContent = type === "movie" ? "Película" : "Serie";
  $("editorTitle").textContent = item ? `Editar ${item.title || item.id}` : `Agregar ${type === "movie" ? "película" : "serie"}`;
  $("docId").disabled = Boolean(item);
  $("docId").value = item?.id ?? "";
  $("title").value = item?.title ?? "";
  $("year").value = item?.year ?? "";
  $("duration").value = item?.duration ?? "";
  $("genres").value = formatGenresForInput(item?.genres);
  $("posterUrl").value = item?.posterUrl ?? "";
  $("hlsUrl").value = item?.hlsUrl ?? "";
  $("synopsis").value = item?.synopsis ?? "";
  $("showInNew").checked = false;
  $("showInHome").checked = true;
  $("deleteBtn").classList.toggle("hidden", !item);
  document.querySelectorAll(".movie-only").forEach(el => el.classList.toggle("hidden", type !== "movie"));
  $("durationField").classList.toggle("hidden", type !== "movie");

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
    synopsis: $("synopsis").value.trim(),
    posterUrl: $("posterUrl").value.trim(),
    type,
    updatedAt: serverTimestamp(),
  };
  if (!state.editingId) baseData.createdAt = serverTimestamp();
  if (type === "movie") {
    baseData.duration = Number($("duration").value) || 0;
    baseData.hlsUrl = $("hlsUrl").value.trim();
  }
  await setDoc(doc(db, type === "movie" ? "movies" : "series", id), baseData, { merge: true });
  $("editorDialog").close();
  showStatus("Guardado correctamente");
  await loadAll();
}

async function deleteCurrent() {
  if (!state.editingId) return;
  if (!confirm("¿Eliminar este contenido?")) return;
  await deleteDoc(doc(db, state.editingType === "movie" ? "movies" : "series", state.editingId));
  $("editorDialog").close();
  showStatus("Eliminado");
  await loadAll();
}

async function saveHome() {
  const cleanSections = {};
  ["new", "movies", "series"].forEach(sectionKey => {
    const config = getSectionConfig(sectionKey);
    cleanSections[sectionKey] = {
      mode: config.mode,
      limit: 10,
      selectedItems: getPreviewItems(sectionKey).map(normalizeSelectedItem).slice(0, 10)
    };
  });

  await setDoc(doc(db, "homeConfig", "main"), {
    sections: cleanSections,
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
    const json = JSON.parse(text);
    const raw = Array.isArray(json) ? json[0] : Array.isArray(json.episodes) ? json.episodes[0] : json;
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
  if (sectionKey !== "new" && getNewSectionKeys().has(key)) {
    showStatus("Ese contenido ya está en Lo nuevo");
    return;
  }
  if (config.selectedItems.length >= 10) return showStatus("Máximo 10 elementos por sección");
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

  const list = contentType === "movie" ? state.movies : state.series;
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
primaryAction.addEventListener("click", () => openEditor(state.view === "series" ? "series" : "movie"));
$("importMovieBtn").addEventListener("click", () => $("importMovieInput").click());
$("importMovieInput").addEventListener("change", (e) => { const file = e.target.files?.[0]; if (file) importMoviesFromJson(file); });
$("importSeriesBtn").addEventListener("click", () => $("importSeriesInput").click());
$("importSeriesInput").addEventListener("change", (e) => { const file = e.target.files?.[0]; if (file) importSeriesFromJson(file); });

// Extra direct listeners for the Películas and Series grids.
// This makes the entire card open the same editor used by the manual add flow.
$("moviesList").addEventListener("click", (e) => handleCardActivation(e.target));
$("seriesList").addEventListener("click", (e) => handleCardActivation(e.target));
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
$("importEpisodeInput").addEventListener("change", (e) => { const file = e.target.files?.[0]; if (file) importEpisodeFromJson(file); });
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

document.addEventListener("click", async (e) => {
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

setView("home");
loadAll().catch(err => {
  console.error(err);
  showStatus(`Error Firebase: ${err.code || ""} ${err.message || err}`);
});
