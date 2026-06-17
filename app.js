import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import {
  getFirestore, collection, getDocs, doc, getDoc, setDoc, deleteDoc,
  serverTimestamp, updateDoc
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

// 1) Pega aquí la configuración web de Firebase.
// Firebase Console > Project settings > General > Your apps > Web app.
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

const state = {
  view: "home",
  movies: [],
  series: [],
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

async function loadAll() {
  const [moviesSnap, seriesSnap] = await Promise.all([
    getDocs(collection(db, "movies")),
    getDocs(collection(db, "series"))
  ]);
  state.movies = moviesSnap.docs.map(d => ({ id: d.id, ...d.data(), type: "movie" }));
  state.series = seriesSnap.docs.map(d => ({ id: d.id, ...d.data(), type: "series" }));
  render();
}

function setView(view) {
  state.view = view;
  Object.entries(views).forEach(([key, el]) => el.classList.toggle("active", key === view));
  document.querySelectorAll(".nav-btn").forEach(btn => btn.classList.toggle("active", btn.dataset.view === view));
  pageTitle.textContent = view === "home" ? "Home" : view === "movies" ? "Películas" : "Series";
  primaryAction.textContent = view === "series" ? "Agregar serie" : "Agregar película";
  primaryAction.style.visibility = view === "home" ? "hidden" : "visible";
  render();
}

function render() {
  renderHome();
  renderCards("moviesList", state.movies, "movie");
  renderCards("seriesList", state.series, "series");
}

function renderHome() {
  const all = [...state.movies, ...state.series].sort((a,b) => (a.homeOrder ?? 999) - (b.homeOrder ?? 999));
  $("homeContentList").innerHTML = all.map(item => `
    <div class="admin-row" data-id="${item.id}" data-type="${item.type}">
      <img src="${item.posterUrl || ""}" alt="" />
      <div>
        <strong>${item.title || item.id}</strong>
        <span>${item.type === "movie" ? "Película" : "Serie"} · ${item.year || "Sin año"}</span>
      </div>
      <div class="toggles">
        <label><input type="checkbox" data-field="showInNew" ${item.showInNew ? "checked" : ""}> Lo nuevo</label>
        <label><input type="checkbox" data-field="showInHome" ${item.showInHome !== false ? "checked" : ""}> Sección principal</label>
        <label><input type="checkbox" data-field="isFavorite" ${item.isFavorite ? "checked" : ""}> Favorita</label>
      </div>
    </div>
  `).join("") || `<p class="helper">Aún no hay contenido.</p>`;
}

function renderCards(containerId, items, type) {
  $(containerId).innerHTML = items.map(item => `
    <article class="card" data-id="${item.id}" data-type="${type}">
      <img class="poster" src="${item.posterUrl || ""}" alt="" />
      <h3>${item.title || item.id}</h3>
      <p>${item.year || "Sin año"}</p>
      <div class="badge-row">
        ${item.showInNew ? '<span class="badge on">Lo nuevo</span>' : ''}
        ${item.isFavorite ? '<span class="badge on">Favorita</span>' : ''}
        ${item.showInHome === false ? '<span class="badge">Oculta</span>' : ''}
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
  $("showInNew").checked = Boolean(item?.showInNew);
  $("showInHome").checked = item?.showInHome !== false;
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
    showInNew: $("showInNew").checked,
    showInHome: $("showInHome").checked,
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
  const rows = [...document.querySelectorAll(".admin-row")];
  await Promise.all(rows.map((row, index) => {
    const id = row.dataset.id;
    const type = row.dataset.type;
    const data = { homeOrder: index + 1 };
    row.querySelectorAll("input[type='checkbox']").forEach(input => data[input.dataset.field] = input.checked);
    return updateDoc(doc(db, type === "movie" ? "movies" : "series", id), data);
  }));
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

document.querySelectorAll(".nav-btn").forEach(btn => btn.addEventListener("click", () => setView(btn.dataset.view)));
primaryAction.addEventListener("click", () => openEditor(state.view === "series" ? "series" : "movie"));
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

document.addEventListener("click", async (e) => {
  const card = e.target.closest(".card");
  if (card) {
    const list = card.dataset.type === "movie" ? state.movies : state.series;
    openEditor(card.dataset.type, list.find(i => i.id === card.dataset.id));
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
