import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import {
  getFirestore, collection, getDocs, doc, getDoc, setDoc, deleteDoc,
  serverTimestamp, updateDoc
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

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

const state = {
  view: "home",
  movies: [],
  series: [],
  homeConfig: structuredClone(defaultHomeConfig),
  editingType: "movie",
  editingId: null,
  editingSeriesId: null,
  editingEpisodeId: null,
};

const $ = (id) => document.getElementById(id);
const views = { home: $("homeView"), movies: $("moviesView"), series: $("seriesView") };
const pageTitle = $("pageTitle");
const primaryAction = $("primaryAction");
const statusBox = $("status");

function showStatus(message) {
  statusBox.textContent = message;
  statusBox.classList.remove("hidden");
  setTimeout(() => statusBox.classList.add("hidden"), 2500);
}

function slugify(text) {
  return text.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

function splitGenres(value) {
  return value.split(",").map(g => g.trim()).filter(Boolean);
}

function getAllContent() {
  return [...state.movies, ...state.series];
}

function getContentForSection(sectionKey) {
  if (sectionKey === "movies") return state.movies;
  if (sectionKey === "series") return state.series;
  return getAllContent();
}

function normalizeSelectedItem(item) {
  return {
    id: item.id,
    type: item.type === "series" ? "series" : "movie"
  };
}

function findContentItem(ref) {
  const list = ref.type === "series" ? state.series : state.movies;
  return list.find(item => item.id === ref.id);
}

function getSectionConfig(sectionKey) {
  if (!state.homeConfig.sections) state.homeConfig.sections = {};
  if (!state.homeConfig.sections[sectionKey]) {
    state.homeConfig.sections[sectionKey] = structuredClone(defaultHomeConfig.sections[sectionKey]);
  }
  const config = state.homeConfig.sections[sectionKey];
  config.limit = 10;
  config.selectedItems = Array.isArray(config.selectedItems) ? config.selectedItems : [];
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

function getPreviewItems(sectionKey) {
  const config = getSectionConfig(sectionKey);
  const source = getContentForSection(sectionKey);
  if (config.mode === "manual") {
    return config.selectedItems.map(findContentItem).filter(Boolean).slice(0, 10);
  }
  if (config.mode === "popular") return sortByPopularity(source).slice(0, 10);
  return sortByRecent(source).slice(0, 10);
}

function normalizeMovieFromJson(rawMovie, index = 0) {
  const title = String(rawMovie.title || rawMovie.name || "").trim();
  const idSource = rawMovie.id || rawMovie.docId || rawMovie.slug || title || `movie-${Date.now()}-${index}`;
  const id = slugify(String(idSource));

  let genres = [];
  if (Array.isArray(rawMovie.genres)) {
    genres = rawMovie.genres.map(g => String(g).trim()).filter(Boolean);
  } else if (typeof rawMovie.genres === "string") {
    genres = splitGenres(rawMovie.genres);
  } else if (typeof rawMovie.genre === "string") {
    genres = splitGenres(rawMovie.genre);
  }

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

async function importMoviesFromJson(file) {
  try {
    const text = await file.text();
    const json = JSON.parse(text);
    const items = Array.isArray(json) ? json : Array.isArray(json.movies) ? json.movies : [json];

    if (!items.length) {
      showStatus("El JSON no contiene películas");
      return;
    }

    const normalized = items.map(normalizeMovieFromJson);
    const invalid = normalized.find(item => !item.data.title || !item.data.posterUrl || !item.data.hlsUrl);
    if (invalid) {
      alert("El JSON debe incluir al menos title, posterUrl y hlsUrl en cada película.");
      return;
    }

    await Promise.all(normalized.map(item =>
      setDoc(doc(db, "movies", item.id), item.data, { merge: true })
    ));

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
      ...structuredClone(defaultHomeConfig),
      ...homeSnap.data(),
      sections: {
        ...structuredClone(defaultHomeConfig.sections),
        ...(homeSnap.data().sections || {})
      }
    };
  } else {
    state.homeConfig = structuredClone(defaultHomeConfig);
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
  const selectedKeys = new Set(config.selectedItems.map(item => `${item.type}:${item.id}`));
  const source = getContentForSection(sectionKey)
    .filter(item => (item.title || item.id).toLowerCase().includes(query))
    .slice(0, 8);

  resultsEl.innerHTML = source.map(item => {
    const key = `${item.type}:${item.id}`;
    const disabled = selectedKeys.has(key) || config.selectedItems.length >= 10;
    return `
      <div class="search-result">
        <img src="${item.posterUrl || ""}" alt="" />
        <div>
          <strong>${item.title || item.id}</strong>
          <span>${item.type === "movie" ? "Película" : "Serie"} · ${item.year || "Sin año"}</span>
        </div>
        <button class="add-mini" data-add-home="${sectionKey}" data-id="${item.id}" data-type="${item.type}" ${disabled ? "disabled" : ""}>+</button>
      </div>
    `;
  }).join("") || `<p class="helper">No encontré resultados.</p>`;
}

function renderSelectedItems(sectionKey) {
  const selectedEl = document.querySelector(`[data-selected="${sectionKey}"]`);
  if (!selectedEl) return;

  const config = getSectionConfig(sectionKey);
  const previewItems = getPreviewItems(sectionKey);
  const label = config.mode === "manual" ? "Selección manual" : config.mode === "popular" ? "Preview por popularidad" : "Preview por recientes";

  selectedEl.innerHTML = `
    <div class="selected-summary">${label} · ${previewItems.length}/10 elementos</div>
    ${previewItems.length ? `<div class="selected-list">${previewItems.map(item => `
      <div class="selected-item">
        <img src="${item.posterUrl || ""}" alt="" />
        <div>
          <strong>${item.title || item.id}</strong>
          <span>${item.type === "movie" ? "Película" : "Serie"} · ${item.year || "Sin año"}</span>
        </div>
        ${config.mode === "manual" ? `<button class="remove-mini" data-remove-home="${sectionKey}" data-id="${item.id}" data-type="${item.type}">×</button>` : ""}
      </div>
    `).join("")}</div>` : `<div class="empty-selection">No hay contenido para esta sección.</div>`}
  `;
}

function renderCards(containerId, items, type) {
  $(containerId).innerHTML = items.map(item => `
    <article class="card" data-id="${item.id}" data-type="${type}">
      <img class="poster" src="${item.posterUrl || ""}" alt="" />
      <h3>${item.title || item.id}</h3>
      <p>${item.year || "Sin año"}</p>
      <div class="badge-row">
        ${item.isFavorite ? '<span class="badge on">Favorita</span>' : ''}
        ${Number(item.popularity ?? 0) ? `<span class="badge">Popularidad ${Number(item.popularity ?? 0)}</span>` : ''}
      </div>
    </article>
  `).join("") || `<p class="helper">No hay ${type === "movie" ? "películas" : "series"} todavía.</p>`;
}

function openEditor(type, item = null) {
  state.editingType = type;
  state.editingId = item?.id ?? null;
  $("editorType").textContent = type === "movie" ? "Película" : "Serie";
  $("editorTitle").textContent = item ? `Editar ${item.title}` : `Agregar ${type === "movie" ? "película" : "serie"}`;
  $("docId").disabled = Boolean(item);
  $("docId").value = item?.id ?? "";
  $("title").value = item?.title ?? "";
  $("year").value = item?.year ?? "";
  $("duration").value = item?.duration ?? "";
  $("genres").value = (item?.genres ?? []).join(", ");
  $("posterUrl").value = item?.posterUrl ?? "";
  $("hlsUrl").value = item?.hlsUrl ?? "";
  $("synopsis").value = item?.synopsis ?? "";
  $("isFavorite").checked = Boolean(item?.isFavorite);
  $("showInNew").checked = false;
  $("showInHome").checked = true;
  $("deleteBtn").classList.toggle("hidden", !item);
  document.querySelectorAll(".movie-only").forEach(el => el.classList.toggle("hidden", type !== "movie"));
  $("durationField").classList.toggle("hidden", type !== "movie");
  $("episodesPanel").classList.toggle("hidden", type !== "series" || !item);
  if (type === "series" && item) loadEpisodes(item.id);
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
    isFavorite: $("isFavorite").checked,
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
      selectedItems: config.selectedItems.slice(0, 10)
    };
  });

  await setDoc(doc(db, "homeConfig", "main"), {
    sections: cleanSections,
    updatedAt: serverTimestamp()
  }, { merge: true });

  showStatus("Home actualizado");
  await loadAll();
}

async function loadEpisodes(seriesId) {
  state.editingSeriesId = seriesId;
  const snap = await getDocs(collection(db, "series", seriesId, "episodes"));
  const episodes = snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a,b) => (a.seasonNumber - b.seasonNumber) || (a.episodeNumber - b.episodeNumber));
  $("episodesList").innerHTML = episodes.map(ep => `
    <div class="episode-item" data-id="${ep.id}">
      <div><strong>${ep.title}</strong><br><span>T${ep.seasonNumber} · E${ep.episodeNumber}</span></div>
      <span>${ep.duration || 0} min</span>
    </div>
  `).join("") || `<p class="helper">Aún no hay episodios.</p>`;
}

function openEpisodeEditor(ep = null) {
  state.editingEpisodeId = ep?.id ?? null;
  $("episodeEditorTitle").textContent = ep ? `Editar ${ep.title}` : "Agregar episodio";
  $("episodeDocId").disabled = Boolean(ep);
  $("episodeDocId").value = ep?.id ?? "";
  $("episodeTitle").value = ep?.title ?? "";
  $("seasonNumber").value = ep?.seasonNumber ?? "";
  $("episodeNumber").value = ep?.episodeNumber ?? "";
  $("episodeDuration").value = ep?.duration ?? "";
  $("episodeHlsUrl").value = ep?.hlsUrl ?? "";
  $("episodeSynopsis").value = ep?.synopsis ?? "";
  $("deleteEpisodeBtn").classList.toggle("hidden", !ep);
  $("episodeDialog").showModal();
}

async function saveEpisode(e) {
  e.preventDefault();
  const seriesId = state.editingSeriesId;
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
  await loadEpisodes(seriesId);
}

async function deleteEpisode() {
  if (!state.editingEpisodeId || !state.editingSeriesId) return;
  if (!confirm("¿Eliminar episodio?")) return;
  await deleteDoc(doc(db, "series", state.editingSeriesId, "episodes", state.editingEpisodeId));
  $("episodeDialog").close();
  await loadEpisodes(state.editingSeriesId);
}

function addHomeItem(sectionKey, id, type) {
  const config = getSectionConfig(sectionKey);
  if (config.selectedItems.length >= 10) {
    showStatus("Máximo 10 elementos por sección");
    return;
  }
  const exists = config.selectedItems.some(item => item.id === id && item.type === type);
  if (!exists) config.selectedItems.push({ id, type });
  renderHome();
}

function removeHomeItem(sectionKey, id, type) {
  const config = getSectionConfig(sectionKey);
  config.selectedItems = config.selectedItems.filter(item => !(item.id === id && item.type === type));
  renderHome();
}

document.querySelectorAll(".nav-btn").forEach(btn => btn.addEventListener("click", () => setView(btn.dataset.view)));
primaryAction.addEventListener("click", () => openEditor(state.view === "series" ? "series" : "movie"));
$("importMovieBtn").addEventListener("click", () => $("importMovieInput").click());
$("importMovieInput").addEventListener("change", (e) => {
  const file = e.target.files?.[0];
  if (file) importMoviesFromJson(file);
});
$("editorForm").addEventListener("submit", saveEditor);
$("closeEditor").addEventListener("click", () => $("editorDialog").close());
$("cancelBtn").addEventListener("click", () => $("editorDialog").close());
$("deleteBtn").addEventListener("click", deleteCurrent);
$("saveHomeBtn").addEventListener("click", saveHome);
$("addEpisodeBtn").addEventListener("click", () => openEpisodeEditor());
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
  if (addBtn) {
    addHomeItem(addBtn.dataset.addHome, addBtn.dataset.id, addBtn.dataset.type);
    return;
  }

  const removeBtn = e.target.closest("[data-remove-home]");
  if (removeBtn) {
    removeHomeItem(removeBtn.dataset.removeHome, removeBtn.dataset.id, removeBtn.dataset.type);
    return;
  }

  const card = e.target.closest(".card");
  if (card) {
    const list = card.dataset.type === "movie" ? state.movies : state.series;
    openEditor(card.dataset.type, list.find(i => i.id === card.dataset.id));
    return;
  }

  const epItem = e.target.closest(".episode-item");
  if (epItem) {
    const snap = await getDoc(doc(db, "series", state.editingSeriesId, "episodes", epItem.dataset.id));
    openEpisodeEditor({ id: snap.id, ...snap.data() });
  }
});

$("title").addEventListener("blur", () => {
  if (!state.editingId && !$("docId").value) $("docId").value = slugify($("title").value);
});
$("seasonNumber").addEventListener("input", updateEpisodeIdHint);
$("episodeNumber").addEventListener("input", updateEpisodeIdHint);
function updateEpisodeIdHint() {
  if (state.editingEpisodeId) return;
  const s = String($("seasonNumber").value || "1").padStart(2,"0");
  const e = String($("episodeNumber").value || "1").padStart(2,"0");
  $("episodeDocId").value = `s${s}e${e}`;
}

setView("home");
loadAll().catch(err => {
  console.error(err);
  showStatus("Error conectando Firebase. Revisa app.js");
});
