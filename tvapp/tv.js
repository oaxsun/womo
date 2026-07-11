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

const state = {
  items: [], movies: [], series: [], concerts: [], continueItems: [], rows: [], homeSections: null,
  focus: { row: 0, col: 0 }, rowVisuals: {}, navFocus: 1, activeNav: 'home', focusArea: 'content', mode: 'home', heroFocus: 0, previewItem: null, previewEpisodes: [], previewFocus: 0, episodesBySeries: {}, shuffleSession: null, settingsFocus: 0, loginFocus: 0, favoritesPreviewFromHero: false, searchQuery: '', searchFormFocus: 0,
  hls: null, currentPlaying: null, playerChromeTimer: null, playerNextOverlayTimer: null, playerNextCountdownTimer: null, shuffleQuickTimer: null, shuffleQuickHideTimer: null, playerNextFocus: 0, playerShuffleFocus: false
};

const $ = (selector) => document.querySelector(selector);
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

function toMillis(value) {
  if (!value) return 0;
  if (typeof value === 'number') return value;
  if (typeof value.toMillis === 'function') return value.toMillis();
  if (value.seconds) return value.seconds * 1000;
  return 0;
}

function cleanTitleFromId(id) {
  return String(id || '').replace(/[-_]/g, ' ').replace(/\b\w/g, letter => letter.toUpperCase());
}

function genresToText(value) {
  if (Array.isArray(value)) return value.filter(Boolean).join(', ');
  return value || '';
}

function deepVideoUrl(value) {
  if (!value) return '';
  if (typeof value === 'string') return value.trim();
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = deepVideoUrl(item);
      if (found) return found;
    }
    return '';
  }
  if (typeof value === 'object') {
    const keys = ['hlsUrl','hlsURL','hls','videoUrl','videoURL','video','streamUrl','streamURL','playbackUrl','playbackURL','mp4Url','mp4URL','m3u8','src','source','file','fileUrl','link','url','bunnyUrl','bunnyHlsUrl'];
    for (const key of keys) {
      const found = deepVideoUrl(value[key]);
      if (found) return found;
    }
  }
  return '';
}
function getDataVideoUrl(data) {
  return deepVideoUrl(data?.hlsUrl || data?.hlsURL || data?.hls || data?.videoUrl || data?.videoURL || data?.video || data?.streamUrl || data?.streamURL || data?.playbackUrl || data?.playbackURL || data?.mp4Url || data?.mp4URL || data?.m3u8 || data?.src || data?.source || data?.file || data?.fileUrl || data?.link || data?.url || data?.bunnyUrl || data?.bunnyHlsUrl || data?.sources || data?.media || data?.asset || data?.videoData);
}
function getPlayableUrl(item, episode = null) {
  return getDataVideoUrl(episode || {}) || getDataVideoUrl(item || {}) || episode?.hlsUrl || item?.hlsUrl || item?.videoUrl || item?.url || '';
}


function normalizeMovie(doc) {
  const data = doc.data() || {};
  const type = data.type === 'concert' ? 'concert' : 'movie';
  return {
    id: doc.id,
    type,
    title: data.title || data.name || cleanTitleFromId(doc.id),
    year: data.year || '',
    genre: genresToText(data.genres || data.genre),
    genres: Array.isArray(data.genres) ? data.genres : genresToText(data.genres || data.genre).split(/[,/|·]+/).map(g => g.trim()).filter(Boolean),
    duration: data.duration ? `${data.duration} min` : (data.runtime ? `${data.runtime} min` : ''),
    description: data.synopsis || data.description || '',
    poster: data.posterUrl || data.poster || data.imageUrl || '',
    hlsUrl: getDataVideoUrl(data),
    createdAt: toMillis(data.createdAt),
    published: data.published !== false
  };
}

function normalizeConcert(doc) {
  const data = doc.data() || {};
  return { ...normalizeMovie(doc), type: 'concert', hlsUrl: getDataVideoUrl(data) };
}

function normalizeSeries(doc) {
  const data = doc.data() || {};
  return {
    id: doc.id,
    type: 'series',
    title: data.title || data.name || cleanTitleFromId(doc.id),
    year: data.year || '',
    genre: genresToText(data.genres || data.genre),
    genres: Array.isArray(data.genres) ? data.genres : genresToText(data.genres || data.genre).split(/[,/|·]+/).map(g => g.trim()).filter(Boolean),
    duration: data.seasons ? `${data.seasons} temporada${Number(data.seasons) === 1 ? '' : 's'}` : 'Serie',
    description: data.synopsis || data.description || '',
    poster: data.posterUrl || data.poster || data.imageUrl || '',
    createdAt: toMillis(data.createdAt),
    published: data.published !== false
  };
}

async function readCollection(name, normalizer) {
  try {
    const snap = await db.collection(name).orderBy('createdAt', 'desc').limit(80).get();
    return snap.docs.map(normalizer).filter(item => item.published && item.poster);
  } catch (error) {
    console.warn(`Fallback leyendo ${name}`, error);
    const snap = await db.collection(name).get();
    return snap.docs.map(normalizer).filter(item => item.published && item.poster).sort((a, b) => b.createdAt - a.createdAt);
  }
}

function continueKey(item) { return `${item.type}:${item.id}`; }
function loadContinue() {
  try { return JSON.parse(localStorage.getItem('womo_continue_watching') || '[]'); } catch { return []; }
}
function saveContinue(items) { localStorage.setItem('womo_continue_watching', JSON.stringify(items.slice(0, 60))); }
function completedStorageKey() { return 'womo_completed_items'; }
function loadCompletedMap() {
  try { return JSON.parse(localStorage.getItem(completedStorageKey()) || '{}'); } catch { return {}; }
}
function saveCompletedMap(map) { localStorage.setItem(completedStorageKey(), JSON.stringify(map || {})); }
function completedKey(item) { return item ? `${item.type}:${item.id}` : ''; }
function isItemCompleted(item) {
  if (!item) return false;
  if (item.completed === true || Number(item.progress || 0) >= 98) return true;
  return Boolean(loadCompletedMap()[completedKey(item)]);
}
function setItemCompleted(item, completed = true) {
  if (!item) return;
  const map = loadCompletedMap();
  if (completed) map[completedKey(item)] = true;
  else delete map[completedKey(item)];
  saveCompletedMap(map);
  item.completed = completed;
  if (completed) saveCompletedItemToCloud(item);
}
function loadFavorites() {
  try { return JSON.parse(localStorage.getItem('womo_favorites') || '[]'); } catch { return []; }
}
function saveFavorites(items) { localStorage.setItem('womo_favorites', JSON.stringify(items)); }
async function loadFavoritesFromCloud() {
  const ref = getUserDocRef();
  if (!ref) return;
  try {
    const snapshot = await ref.collection('favorites').orderBy('addedAt', 'desc').get();
    const items = snapshot.docs.map(doc => {
      const data = doc.data() || {};
      return { id: data.id, type: data.type, addedAt: data.addedAt || 0 };
    }).filter(entry => entry.id && entry.type);
    if (items.length) saveFavorites(items);
  } catch (error) { console.warn('No se pudo leer favoritos desde cloud.', error); }
}
async function saveFavoriteToCloud(entry) {
  const ref = getUserDocRef();
  if (!ref || !entry) return;
  try {
    await ref.set({ updatedAt: firebase.firestore.FieldValue.serverTimestamp() }, { merge: true });
    await ref.collection('favorites').doc(userItemDocId(entry)).set({ ...entry, updatedAt: firebase.firestore.FieldValue.serverTimestamp() }, { merge: true });
  } catch (error) { console.warn('No se pudo guardar favorito en cloud.', error); }
}
async function deleteFavoriteFromCloud(entry) {
  const ref = getUserDocRef();
  if (!ref || !entry) return;
  try { await ref.collection('favorites').doc(userItemDocId(entry)).delete(); }
  catch (error) { console.warn('No se pudo borrar favorito en cloud.', error); }
}

function getUserDocRef() {
  const user = firebase.auth().currentUser;
  return user ? db.collection('users').doc(user.uid) : null;
}
function safeDocId(value) {
  return String(value || '').replace(/[\/#?\[\]]/g, '_').slice(0, 140);
}
function userItemDocId(entry) { return safeDocId(`${entry.type}_${entry.id}`); }
function userEpisodeDocId(seriesId, season, episodeNumber, episodeId = '') { return safeDocId(`${seriesId}_S${season}_E${episodeNumber}_${episodeId}`); }
async function loadContinueFromCloud() {
  const ref = getUserDocRef();
  if (!ref) return;
  try {
    const snapshot = await ref.collection('continueWatching').orderBy('lastWatchedAt', 'desc').get();
    const entries = snapshot.docs.map(doc => doc.data()).filter(entry => entry && entry.id && entry.type);
    if (entries.length) saveContinue(entries);
  } catch (error) {
    console.warn('No se pudo leer Continuar viendo desde cloud.', error);
  }
}
async function saveContinueEntryToCloud(entry) {
  const ref = getUserDocRef();
  if (!ref || !entry) return;
  try {
    await ref.set({ updatedAt: firebase.firestore.FieldValue.serverTimestamp() }, { merge: true });
    await ref.collection('continueWatching').doc(userItemDocId(entry)).set({ ...entry, updatedAt: firebase.firestore.FieldValue.serverTimestamp() }, { merge: true });
  } catch (error) { console.warn('No se pudo guardar Continuar viendo en cloud.', error); }
}
async function removeContinueFromCloud(item) {
  const ref = getUserDocRef();
  if (!ref || !item) return;
  try {
    await Promise.all([
      ref.collection('continueWatching').doc(userItemDocId(item)).delete().catch(() => {}),
      ref.collection('continueWatching').doc(`${item.type}:${item.id}`).delete().catch(() => {}),
      ref.collection('continueWatching').doc(item.id).delete().catch(() => {})
    ]);
  } catch (error) { console.warn('No se pudo borrar Continuar viendo en cloud.', error); }
}
async function saveCompletedItemToCloud(item) {
  const ref = getUserDocRef();
  if (!ref || !item) return;
  try {
    await ref.collection('completed').doc(`${item.type}:${item.id}`).set({ id: item.id, type: item.type, completed: true, progress: 100, completedAt: Date.now(), updatedAt: firebase.firestore.FieldValue.serverTimestamp() }, { merge: true });
  } catch (error) { console.warn('No se pudo guardar completado en cloud.', error); }
}
async function loadCompletedFromCloud() {
  const ref = getUserDocRef();
  if (!ref) return;
  try {
    const snapshot = await ref.collection('completed').get();
    const map = loadCompletedMap();
    snapshot.docs.forEach(doc => {
      const data = doc.data() || {};
      if (data.id && data.type && (data.completed || Number(data.progress || 0) >= 98)) map[`${data.type}:${data.id}`] = true;
    });
    saveCompletedMap(map);
  } catch (error) { console.warn('No se pudo leer completados desde cloud.', error); }
}
async function saveEpisodeProgressToCloud(seriesId, episode, progress) {
  const ref = getUserDocRef();
  if (!ref || !seriesId || !episode) return;
  try {
    await ref.collection('episodeProgress').doc(userEpisodeDocId(seriesId, episode.season, episode.episode, episode.id)).set({ seriesId, episodeId: episode.id, season: episode.season, episodeNumber: episode.episode, progress, updatedAt: firebase.firestore.FieldValue.serverTimestamp() }, { merge: true });
  } catch (error) { console.warn('No se pudo guardar progreso de episodio en cloud.', error); }
}
async function loadEpisodeProgressFromCloud() {
  const ref = getUserDocRef();
  if (!ref) return;
  try {
    const snapshot = await ref.collection('episodeProgress').get();
    const map = loadSeriesProgress();
    snapshot.docs.forEach(doc => {
      const data = doc.data() || {};
      if (!data.seriesId) return;
      const key = `${data.seriesId}:${data.episodeId || `${data.season || 1}-${data.episodeNumber || data.episode || 1}`}`;
      map[key] = { progress: clamp(Number(data.progress || 0), 0, 100), completed: Number(data.progress || 0) >= 98, lastWatchedAt: Date.now() };
    });
    saveSeriesProgress(map);
  } catch (error) { console.warn('No se pudo leer progreso de episodios desde cloud.', error); }
}
function isFavorite(item) { return loadFavorites().some(entry => entry.id === item.id && entry.type === item.type); }
function toggleFavorite(item) {
  if (!item) return;
  const favs = loadFavorites();
  const exists = favs.some(entry => entry.id === item.id && entry.type === item.type);
  const entry = { id: item.id, type: item.type, addedAt: Date.now() };
  const next = exists ? favs.filter(value => !(value.id === item.id && value.type === item.type)) : [entry, ...favs];
  saveFavorites(next);
  if (exists) deleteFavoriteFromCloud(entry); else saveFavoriteToCloud(entry);
  if (state.mode === 'preview') renderPreviewActions(item);
  if (state.activeNav === 'favorites') renderFavorites();
  if (state.activeNav === 'search') renderSearch();
}
function buildContinueItems() {
  const map = new Map(state.items.map(item => [continueKey(item), item]));
  const raw = loadContinue();
  const valid = raw
    .map(entry => ({ ...map.get(`${entry.type}:${entry.id}`), ...entry }))
    .filter(item => item && item.poster && !isItemCompleted(item) && Number(item.progress || 0) > 0 && Number(item.progress || 0) < 98);
  const validKeys = new Set(valid.map(item => `${item.type}:${item.id}`));
  const cleaned = raw.filter(entry => validKeys.has(`${entry.type}:${entry.id}`));
  if (cleaned.length !== raw.length) saveContinue(cleaned);
  return valid;
}
function removeContinue(item) {
  if (!item) return;
  saveContinue(loadContinue().filter(x => !(x.id === item.id && x.type === item.type)));
  removeContinueFromCloud(item);
}
function upsertContinue(item, progress = 0) {
  if (!item || item.type === 'series') return;
  const pct = Number(progress || 0);
  if (pct >= 98) {
    setItemCompleted(item, true);
    removeContinue(item);
    return;
  }
  if (pct <= 0) {
    removeContinue(item);
    setItemCompleted(item, false);
    return;
  }
  setItemCompleted(item, false);
  const entry = { id: item.id, type: item.type, progress: pct, lastWatchedAt: Date.now() };
  saveContinue([entry, ...loadContinue().filter(x => !(x.id === item.id && x.type === item.type))]);
  saveContinueEntryToCloud(entry);
}


function getContinueEntry(item) {
  if (!item) return null;
  return loadContinue().find(entry => entry.id === item.id && entry.type === item.type) || null;
}

function getItemProgress(item) {
  const entry = getContinueEntry(item);
  const raw = Number(entry?.progress || item?.progress || 0);
  if (!Number.isFinite(raw)) return 0;
  return raw > 1 ? clamp(raw, 0, 100) : clamp(raw * 100, 0, 100);
}



function loadSeriesProgress() {
  try { return JSON.parse(localStorage.getItem('womo_series_progress') || '{}'); } catch { return {}; }
}
function saveSeriesProgress(map) { localStorage.setItem('womo_series_progress', JSON.stringify(map || {})); }
function epKey(seriesId, episode) { return `${seriesId}:${episode?.id || `${episode?.season || 1}-${episode?.episode || 1}`}`; }
function getEpisodeProgress(seriesId, episode) {
  const entry = loadSeriesProgress()[epKey(seriesId, episode)] || {};
  return clamp(Number(entry.progress || 0), 0, 100);
}
function setEpisodeProgress(seriesId, episode, progress, options = {}) {
  if (!seriesId || !episode) return;
  const pct = clamp(Number(progress || 0), 0, 100);
  const map = loadSeriesProgress();
  const key = epKey(seriesId, episode);
  if (pct <= 0 && !options.keep) delete map[key];
  else map[key] = { progress: pct >= 98 ? 100 : pct, completed: pct >= 98, lastWatchedAt: Date.now() };
  saveSeriesProgress(map);
  saveEpisodeProgressToCloud(seriesId, episode, pct >= 98 ? 100 : pct);
}
function isEpisodeCompleted(seriesId, episode) { return getEpisodeProgress(seriesId, episode) >= 98; }
function getCachedEpisodes(seriesId) { return state.episodesBySeries[seriesId] || []; }
async function ensureSeriesEpisodes(series) {
  if (!series || series.type !== 'series') return [];
  if (state.episodesBySeries[series.id]) return state.episodesBySeries[series.id];
  const episodes = await readSeriesEpisodes(series.id);
  state.episodesBySeries[series.id] = episodes;
  return episodes;
}
function getSeriesPlaybackState(series) {
  const episodes = getCachedEpisodes(series?.id);
  if (!series || series.type !== 'series') return { label: 'Reproducir', episode: null, allCompleted: false, started: false };
  if (!episodes.length) return { label: 'Reproducir T1E1', episode: null, allCompleted: false, started: false };
  const sorted = [...episodes].sort((a, b) => (a.season - b.season) || (a.episode - b.episode));
  const inProgress = sorted.find(ep => getEpisodeProgress(series.id, ep) > 0 && getEpisodeProgress(series.id, ep) < 98);
  if (inProgress) return { label: `Continuar T${inProgress.season}E${inProgress.episode}`, episode: inProgress, allCompleted: false, started: true };
  const next = sorted.find(ep => !isEpisodeCompleted(series.id, ep));
  if (next) return { label: `Reproducir T${next.season}E${next.episode}`, episode: next, allCompleted: false, started: false };
  return { label: 'Volver a ver', episode: sorted[0], allCompleted: true, started: false };
}
function getVisibleCardCapacity() {
  const root = getComputedStyle(document.documentElement);
  const card = parseFloat(root.getPropertyValue('--card-w')) || 150;
  const gap = parseFloat(root.getPropertyValue('--row-gap')) || 16;
  const appPad = parseFloat(root.getPropertyValue('--app-pad')) || 120;
  const width = Math.max(320, window.innerWidth - appPad - 40);
  return Math.max(1, Math.floor((width + gap) / (card + gap)));
}
function getGridColumnCount() {
  const track = document.querySelector('.tv-row-grid .tv-row-track');
  if (track) {
    const cards = [...track.querySelectorAll('.tv-card')];
    if (cards.length > 1) {
      const firstTop = cards[0].offsetTop;
      const cols = cards.filter(card => Math.abs(card.offsetTop - firstTop) < 4).length;
      if (cols) return cols;
    }
  }
  return getVisibleCardCapacity();
}

function rowShouldLoop(row) {
  return (row?.items?.length || 0) > getVisibleCardCapacity();
}

function icon(name) {
  const icons = {
    play: '<svg viewBox="0 0 24 24" aria-hidden="true"><polygon points="6 3 20 12 6 21 6 3"></polygon></svg>',
    rotate: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7"></path><path d="M3 3v6h6"></path></svg>',
    list: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 6h13"></path><path d="M8 12h13"></path><path d="M8 18h13"></path><path d="M3 6h.01"></path><path d="M3 12h.01"></path><path d="M3 18h.01"></path></svg>',
    shuffle: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m18 14 4 4-4 4"></path><path d="m18 2 4 4-4 4"></path><path d="M2 18h1.4c1.5 0 2.9-.8 3.7-2.1l4.7-7.8C12.6 6.8 14 6 15.5 6H22"></path><path d="M2 6h1.9c1.2 0 2.3.6 3 1.6l1 1.5"></path><path d="M13.5 15.5c.7 1.5 2.1 2.5 3.7 2.5H22"></path></svg>',
    heart: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.6l-1-1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 21l7.8-7.6 1-1a5.5 5.5 0 0 0 0-7.8Z"></path></svg>'
  };
  return icons[name] || '';
}

function getHeroPrimaryLabel(item) {
  if (!item) return 'Reproducir';
  if (item.type === 'series') return getSeriesPlaybackState(item).label;
  const progress = getItemProgress(item);
  if (isItemCompleted(item) || progress >= 98) return 'Volver a ver';
  if (progress > 1) return 'Continuar';
  return 'Reproducir';
}

function heroHTML(item) {
  if (!item) return '<div class="tv-hero-info"><h1>Womo TV</h1><p>No hay contenido disponible.</p></div>';
  const meta = [item.duration, item.year, item.genre].filter(Boolean).map(x => `<span>${x}</span>`).join('');
  const primaryLabel = getHeroPrimaryLabel(item);
  const progress = getItemProgress(item);
  const showRestart = item.type !== 'series' && progress > 1 && progress < 98 && !isItemCompleted(item);
  const favActive = isFavorite(item) ? ' active' : '';
  const favLabel = isFavorite(item) ? 'Quitar de favoritos' : 'Agregar a favoritos';
  const seriesActions = item.type === 'series' ? `
        <button class="tv-hero-action primary" data-hero-action="play" type="button"><span>${icon('play')}</span><b>${primaryLabel}</b></button>
        <button class="tv-hero-action icon${favActive}" data-hero-action="favorite" type="button" aria-label="${favLabel}"><span>${icon('heart')}</span></button>
        <button class="tv-hero-action icon" data-hero-action="shuffle" type="button" aria-label="Shuffle"><span>${icon('shuffle')}</span></button>` : `
        <button class="tv-hero-action primary" data-hero-action="play" type="button"><span>${icon('play')}</span><b>${primaryLabel}</b></button>
        <button class="tv-hero-action icon${favActive}" data-hero-action="favorite" type="button" aria-label="${favLabel}"><span>${icon('heart')}</span></button>
        ${showRestart ? `<button class="tv-hero-action icon" data-hero-action="restart" type="button" aria-label="Reiniciar"><span>${icon('rotate')}</span></button>` : ''}`;
  return `
    <div class="tv-hero-bg" style="background-image:url('${item.poster}')"></div>
    <img class="tv-hero-poster" src="${item.poster}" alt="${item.title}">
    <div class="tv-hero-info">
      <div class="tv-hero-kicker">Womo TV</div>
      <h1>${item.title}</h1>
      <div class="tv-hero-meta">${meta}</div>
      <p>${item.description || ''}</p>
      <div class="tv-hero-actions">${seriesActions}</div>
    </div>`;
}


async function readTVHomeSections() {
  const bundle = { sections: {}, rows: [], sectionOrder: [] };

  async function mergeConfigDoc(collectionName, docId) {
    try {
      const snap = await db.collection(collectionName).doc(docId).get();
      if (!snap.exists) return;
      const data = snap.data() || {};
      mergeHomeConfig(bundle, data, `${collectionName}/${docId}`);
    } catch (error) {
      console.warn(`No se pudo leer ${collectionName}/${docId} para TV.`, error);
    }
  }

  async function mergeConfigCollection(collectionName) {
    try {
      const snap = await db.collection(collectionName).get();
      snap.docs.forEach((docSnap, index) => {
        const data = docSnap.data() || {};
        if (data.enabled === false || data.visible === false || data.hidden === true) return;
        bundle.rows.push({ id: docSnap.id, key: docSnap.id, order: data.order ?? data.position ?? index, ...data });
      });
    } catch (error) {
      // Not every Womo install has these collections. Silent warning only for debugging.
      console.warn(`No se pudo leer colección ${collectionName} para TV.`, error);
    }
  }

  await mergeConfigDoc('homeConfig', 'main');
  await mergeConfigDoc('homeConfig', 'tv');
  await mergeConfigDoc('homeConfig', 'dynamicSections');
  await mergeConfigDoc('homeConfig', 'sections');

  await Promise.all([
    mergeConfigCollection('homeSections'),
    mergeConfigCollection('dynamicSections'),
    mergeConfigCollection('carouselSections'),
    mergeConfigCollection('homeRows'),
    mergeConfigCollection('adminSections')
  ]);

  bundle.rows.sort((a, b) => Number(a.order ?? a.position ?? 999) - Number(b.order ?? b.position ?? 999));

  if (!Object.keys(bundle.sections).length && !bundle.rows.length && !bundle.sectionOrder.length) return null;
  console.info('Womo TV home config resolved:', bundle);
  return bundle;
}

function mergeHomeConfig(target, data = {}, source = '') {
  if (!data || typeof data !== 'object') return target;

  const orderKeys = ['sectionOrder', 'order', 'homeOrder', 'rowsOrder', 'carouselOrder'];
  orderKeys.forEach(key => {
    if (Array.isArray(data[key])) target.sectionOrder.push(...data[key].map(String));
  });

  const arrayKeys = ['rows', 'homeRows', 'carousels', 'carouselRows', 'dynamicSections', 'genreSections', 'customSections', 'categories', 'genres'];
  arrayKeys.forEach(key => {
    if (Array.isArray(data[key])) {
      data[key].forEach((row, index) => {
        if (typeof row === 'string') target.rows.push({ id: row, key: row, title: row, type: 'genre', genre: row, order: index, source });
        else if (row && typeof row === 'object') target.rows.push({ source, order: row.order ?? row.position ?? index, ...row });
      });
    }
  });

  const objectKeys = ['sections', 'homeSections', 'sectionsConfig', 'dynamicSections', 'genreSections', 'customSections', 'categories', 'genres'];
  objectKeys.forEach(key => {
    const obj = data[key];
    if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
      Object.entries(obj).forEach(([sectionKey, value]) => {
        if (value === false || value == null) return;
        if (typeof value === 'string') target.sections[sectionKey] = { id: sectionKey, title: value, type: 'genre', genre: value, source };
        else target.sections[sectionKey] = { id: sectionKey, key: sectionKey, source, ...(value === true ? { enabled: true } : value) };
      });
    }
  });

  // Some admin versions save a single row document directly.
  const looksLikeSingleRow = data.title || data.label || data.genre || data.genreKey || data.filter || data.selectedItems || data.items;
  if (looksLikeSingleRow && !data.sections && !data.rows && !data.homeRows) {
    target.rows.push({ source, ...data });
  }

  return target;
}

function slugify(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

function normalizeSectionTitle(key, config = {}) {
  const known = { continue: 'Continuar viendo', continueRow: 'Continuar viendo', movies: 'Películas', series: 'Series', concerts: 'Conciertos', new: 'Lo nuevo', news: 'Lo nuevo', hero: 'Lo nuevo' };
  return config.title || config.label || config.name || config.displayName || known[key] || String(key || '').replace(/[-_]/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
}

function getItemGenreTokens(item) {
  const raw = [item?.genre, item?.genres, item?.category, item?.categories, item?.genero, item?.género, item?.typeGenre, item?.tags]
    .flatMap(value => Array.isArray(value) ? value : String(value || '').split(/[,/|·]+/));
  return raw.map(slugify).filter(Boolean).filter(value => !['movie','movies','pelicula','peliculas','series','serie','concert','concerts','concierto','conciertos'].includes(value));
}

function itemMatchesGenre(item, genreKey) {
  const key = slugify(genreKey);
  if (!key) return false;
  const tokens = getItemGenreTokens(item);
  // Strict match only. Avoid leaking Action titles into Comedy/Horror/etc.
  return tokens.includes(key);
}

function getExplicitGenreFromConfig(key, config = {}) {
  const values = [
    config.genre, config.genreKey, config.category, config.categoryKey,
    config.filterValue, config.value, config.slug
  ].flatMap(normalizeFilterCandidates);
  if (values.length) return values[0];

  const typeSlug = slugify(config.sectionType || config.type || config.kind || config.collection || config.sourceType || '');
  const keySlug = slugify(key);
  const reserved = new Set(['continue','continue-row','continuerow','movies','movie','peliculas','series','serie','concerts','concert','conciertos','new','news','hero','featured']);
  if (!reserved.has(typeSlug) && typeSlug && ['genre','genres','category','categories','custom','section','row'].includes(typeSlug) === false) return config.sectionType || config.type || config.kind;
  if (!reserved.has(keySlug)) return config.name || config.title || config.label || key;
  return '';
}

function addItemAliases(map, item) {
  if (!item) return;
  const type = item.type === 'concert' ? 'concert' : item.type === 'series' ? 'series' : 'movie';
  const aliases = new Set([type, `${type}s`, 'content', 'items']);
  if (type === 'movie') aliases.add('movies');
  if (type === 'series') aliases.add('serie');
  if (type === 'concert') { aliases.add('concerts'); aliases.add('movie'); aliases.add('movies'); }
  aliases.forEach(alias => map.set(`${alias}:${item.id}`, item));
  map.set(String(item.id), item);
}

function normalizeSelectedRef(ref) {
  if (!ref) return null;
  if (typeof ref === 'string') {
    if (ref.includes(':')) {
      const [type, ...rest] = ref.split(':');
      return { type, id: rest.join(':') };
    }
    return { id: ref };
  }
  return {
    id: ref.id || ref.docId || ref.itemId || ref.contentId || ref.value || ref.uid,
    type: ref.type || ref.collection || ref.collectionName || ref.kind || ref.contentType || ref.categoryType
  };
}

function getManualRefs(config = {}) {
  const keys = ['selectedItems','items','titles','manualItems','itemRefs','content','contentItems','ids','selected','manual'];
  for (const key of keys) {
    if (Array.isArray(config[key]) && config[key].length) return config[key];
  }
  return [];
}

function resolveManualItems(config = {}, allByKey) {
  return getManualRefs(config).map(normalizeSelectedRef).map(ref => {
    if (!ref?.id) return null;
    const type = ref.type ? String(ref.type).replace(/s$/, '') : '';
    return (ref.type ? (allByKey.get(`${ref.type}:${ref.id}`) || allByKey.get(`${type}:${ref.id}`)) : null) || allByKey.get(ref.id) || null;
  }).filter(Boolean);
}

function sectionIsEnabled(config) {
  if (config === false || config == null) return false;
  if (typeof config !== 'object') return true;
  if (config.enabled === false || config.visible === false || config.show === false || config.hidden === true) return false;
  return true;
}

function sortSectionItems(items, mode) {
  const output = [...(items || [])];
  if (mode === 'az' || mode === 'alphabetical') output.sort((a, b) => String(a.title || '').localeCompare(String(b.title || '')));
  else if (mode === 'year') output.sort((a, b) => Number(b.year || 0) - Number(a.year || 0));
  else output.sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));
  return output;
}

function normalizeFilterCandidates(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.flatMap(normalizeFilterCandidates);
  if (typeof value === 'object') return normalizeFilterCandidates(value.value || value.genre || value.category || value.key || value.slug || value.id || value.name);
  return String(value).split(/[,/|·]+/).map(v => v.trim()).filter(Boolean);
}

function itemsFromSectionConfig(key, rawConfig = {}, allByKey) {
  const config = (rawConfig && typeof rawConfig === 'object') ? rawConfig : { enabled: Boolean(rawConfig) };
  const limit = Number(config.limit || config.max || config.count || 20);
  const manualItems = resolveManualItems(config, allByKey);
  if (manualItems.length) return manualItems.slice(0, limit);

  const sectionType = slugify(config.sectionType || config.type || config.kind || config.collection || config.sourceType || key);
  const mode = config.mode || config.sortMode || config.orderBy || config.sortBy || 'recent';
  const keySlug = slugify(key);

  if (sectionType === 'continue' || sectionType === 'continue-row' || keySlug === 'continue' || key === 'continueRow') return state.continueItems;
  if (sectionType === 'movies' || sectionType === 'movie' || keySlug === 'movies' || keySlug === 'peliculas') return sortSectionItems(state.movies, mode).slice(0, limit);
  if (sectionType === 'series' || sectionType === 'serie' || keySlug === 'series') return sortSectionItems(state.series, mode).slice(0, limit);
  if (sectionType === 'concerts' || sectionType === 'concert' || keySlug === 'concerts' || keySlug === 'conciertos') return sortSectionItems(state.concerts, mode).slice(0, limit);

  const exactGenre = getExplicitGenreFromConfig(key, config);
  if (exactGenre) {
    const genreItems = state.items
      .filter(item => item.type !== 'series' && itemMatchesGenre(item, exactGenre));
    return sortSectionItems(genreItems, mode).slice(0, limit);
  }

  // Do not fall back to all recent items for admin-defined genre rows.
  // If the section has no explicit filter or manual items, keep it empty instead of mixing titles.
  return [];
}

function getSortIndex(config = {}, fallback = 9999) {
  const candidates = [config.order, config.position, config.index, config.sort, config.sortOrder, config.rank, config.priority];
  for (const value of candidates) {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return fallback;
}

function getConfiguredSectionEntries(homeConfig) {
  const config = homeConfig || {};
  const entries = [];

  if (Array.isArray(config.rows)) {
    config.rows.forEach((row, index) => {
      if (!row) return;
      if (typeof row === 'string') entries.push([row, { id: row, key: row, title: row, type: 'genre', genre: row, order: index }]);
      else entries.push([row.id || row.key || row.slug || row.title || `row-${index}`, { order: getSortIndex(row, index), ...row }]);
    });
  }

  const sections = config.sections || config.homeSections || {};
  const order = config.sectionOrder || config.order || config.homeOrder || config.rowsOrder || config.carouselOrder;
  if (sections && typeof sections === 'object' && !Array.isArray(sections)) {
    if (Array.isArray(order) && order.length) {
      const used = new Set(order.map(String));
      order.forEach((key, index) => entries.push([key, { order: index, ...(sections[key] || { id: key, enabled: true, type: 'genre', genre: key }) }]));
      Object.entries(sections)
        .filter(([key]) => !used.has(String(key)))
        .forEach(([key, value], index) => entries.push([key, { order: getSortIndex(value, 1000 + index), ...(value === true ? { enabled: true } : value) }]));
    } else {
      Object.entries(sections).forEach(([key, value], index) => entries.push([key, { order: getSortIndex(value, index), ...(value === true ? { enabled: true } : value) }]));
    }
  }

  const seen = new Set();
  return entries
    .filter(([key, config]) => sectionIsEnabled(config))
    .sort((a, b) => getSortIndex(a[1]) - getSortIndex(b[1]))
    .filter(([key, config]) => {
      const id = slugify(config?.id || config?.key || key);
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    });
}

function buildRowsFromHomeConfig() {
  state.continueItems = buildContinueItems();
  const allByKey = new Map();
  state.items.forEach(item => addItemAliases(allByKey, item));
  const configuredRows = getConfiguredSectionEntries(state.homeSections)
    .filter(([key]) => !['new', 'news', 'hero', 'featured'].includes(slugify(key)))
    .map(([key, config]) => ({ id: config?.id || config?.key || key, title: normalizeSectionTitle(key, config || {}), items: itemsFromSectionConfig(key, config || {}, allByKey) }))
    .filter(row => row.items && row.items.length);

  if (configuredRows.length) {
    const hasContinue = configuredRows.some(row => ['continue','continuerow','continue-row'].includes(slugify(row.id)) || row.title === 'Continuar viendo');
    return [
      ...(!hasContinue && state.continueItems.length ? [{ id: 'continue', title: 'Continuar viendo', items: state.continueItems }] : []),
      ...configuredRows
    ];
  }

  return [
    { id: 'continue', title: 'Continuar viendo', items: state.continueItems },
    { id: 'movies', title: 'Películas', items: state.movies },
    { id: 'series', title: 'Series', items: state.series },
    { id: 'concerts', title: 'Conciertos', items: state.concerts }
  ].filter(row => row.items.length);
}

function modulo(value, length) {
  if (!length) return 0;
  return ((value % length) + length) % length;
}

function rowVisual(rowIndex) {
  const row = state.rows[rowIndex];
  if (!row) return 0;
  return Number(state.rowVisuals[row.id] || 0);
}

function setRowVisual(rowIndex, value) {
  const row = state.rows[rowIndex];
  if (!row) return;
  const len = row.items.length || 1;
  let next = Number(value || 0);
  if (rowShouldLoop(row)) {
    if (next > len * 2) next = len + modulo(next, len);
    if (next < 0) next = len + modulo(next, len);
  } else {
    next = clamp(next, 0, Math.max(0, len - 1));
  }
  state.rowVisuals[row.id] = next;
  state.focus.col = modulo(next, len);
}

function renderHome() {
  hideSearch();
  state.activeNav = 'home';
  state.rows = buildRowsFromHomeConfig();
  renderRowsFromState();
}
function navButtons() {
  return [...document.querySelectorAll('.tv-side-icon')]
    .sort((a, b) => Number(a.dataset.navIndex || 0) - Number(b.dataset.navIndex || 0));
}
function navMaxIndex() { return Math.max(0, navButtons().length - 1); }
function renderFavorites() {
  hideSearch();
  state.activeNav = 'favorites';
  const favIds = new Set(loadFavorites().map(f => `${f.type}:${f.id}`));
  const favItems = state.items.filter(item => favIds.has(`${item.type}:${item.id}`));
  state.rows = [{ id: 'favorites', title: 'Favoritos', items: favItems, layout: 'grid' }];
  state.focus.row = 0;
  state.focus.col = 0;
  state.heroFocus = 0;
  state.favoritesPreviewFromHero = false;
  setRowVisual(0, 0);
  renderRowsFromState();
}

function focusedItem() {
  const row = state.rows[state.focus.row];
  if (!row || !row.items.length) return state.rows[0]?.items[0] || null;
  return row.items[modulo(rowVisual(state.focus.row), row.items.length)] || row.items[0] || null;
}


function applyNavFocus() {
  document.querySelectorAll('.tv-side-icon').forEach((el, index) => {
    el.classList.toggle('active', el.dataset.navAction === state.activeNav);
    el.classList.toggle('focused', state.focusArea === 'nav' && index === state.navFocus);
  });
  if (state.focusArea === 'nav') {
    const navEl = document.querySelector(`.tv-side-icon[data-nav-index="${state.navFocus}"]`);
    navEl?.focus({ preventScroll: true });
  }
}



function renderHero(item) {
  const hero = $('#tvHero');
  if (!hero) return;
  hero.innerHTML = heroHTML(item);
}

function normalizeSearchText(value) {
  return String(value || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}
function itemMatchesSearch(item, query) {
  const q = normalizeSearchText(query).trim();
  if (!q) return false;
  const haystack = normalizeSearchText([
    item.title, item.year, item.genre, item.genres, item.description, item.type
  ].flatMap(v => Array.isArray(v) ? v : [v]).join(' '));
  return q.split(/\s+/).every(part => haystack.includes(part));
}
function buildSearchResults(query = state.searchQuery) {
  const q = String(query || '').trim();
  if (!q) return [];
  return state.items.filter(item => itemMatchesSearch(item, q)).slice(0, 40);
}
function renderSearch() {
  state.activeNav = 'search';
  state.mode = 'home';
  const activeEl = document.activeElement;
  const typingInSearch = activeEl && activeEl.id === 'tvSearchInput';
  state.focusArea = state.focusArea === 'nav' ? 'nav' : ((state.focusArea === 'searchForm' || typingInSearch) ? 'searchForm' : 'content');
  document.body.classList.remove('tv-favorites-view');
  document.body.classList.add('tv-search-view');
  $('#tvSearch')?.classList.remove('hidden');
  $('#tvSearch')?.setAttribute('aria-hidden', 'false');
  $('#tvSettings')?.classList.add('hidden');
  $('#tvSettings')?.setAttribute('aria-hidden', 'true');
  const input = $('#tvSearchInput');
  if (input && input.value !== state.searchQuery) input.value = state.searchQuery;
  const clearBtn = $('#tvSearchClear');
  clearBtn?.classList.toggle('hidden', !String(state.searchQuery || '').trim());
  const results = buildSearchResults();
  $('#tvSearchEmpty')?.classList.toggle('hidden', Boolean(results.length));
  state.rows = results.length ? [{ id: 'search-results', title: 'Resultados', items: results }] : [];
  state.focus.row = 0;
  const len = results.length || 1;
  state.focus.col = modulo(rowVisual(0), len);
  $('#tvHero').classList.toggle('hidden', !results.length);
  $('#tvRows').classList.toggle('hidden', !results.length);
  if (results.length) renderRowsFromState();
  else {
    $('#tvRows').innerHTML = '';
    $('#tvHero').innerHTML = '';
    applySearchFocus();
  }
}
function hideSearch() {
  document.body.classList.remove('tv-search-view');
  $('#tvSearch')?.classList.add('hidden');
  $('#tvSearch')?.setAttribute('aria-hidden', 'true');
  $('#tvHero')?.classList.remove('hidden');
  $('#tvRows')?.classList.remove('hidden');
}
function searchFormElements() {
  const clear = $('#tvSearchClear');
  return [$('#tvSearchInput'), (clear && !clear.classList.contains('hidden') ? clear : null), $('#tvSearchShuffle')].filter(Boolean);
}
function applySearchFocus() {
  applyNavFocus();
  const els = searchFormElements();
  state.searchFormFocus = clamp(state.searchFormFocus, 0, Math.max(0, els.length - 1));
  els.forEach((el, idx) => el.classList.toggle('focused', state.focusArea === 'searchForm' && idx === state.searchFormFocus));
  if (state.focusArea === 'searchForm') els[state.searchFormFocus]?.focus({ preventScroll: true });
}
function moveSearchForm(delta) {
  state.searchFormFocus = clamp(state.searchFormFocus + delta, 0, searchFormElements().length - 1);
  applySearchFocus();
}
function activateSearchForm() {
  const el = searchFormElements()[state.searchFormFocus];
  if (!el) return;
  if (el.id === 'tvSearchShuffle') return startUniversalShuffle();
  if (el.id === 'tvSearchClear') {
    state.searchQuery = '';
    const input = $('#tvSearchInput');
    if (input) input.value = '';
    state.searchFormFocus = 0;
    renderSearch();
    setTimeout(() => $('#tvSearchInput')?.focus({ preventScroll: true }), 0);
    return;
  }
  el.focus({ preventScroll: true });
}
async function startUniversalShuffle() {
  const seriesList = [...state.series];
  if (!seriesList.length) return alert('No hay series disponibles para shuffle.');
  const shuffledSeries = seriesList.sort(() => Math.random() - 0.5);
  for (const series of shuffledSeries) {
    const episodes = await ensureSeriesEpisodes(series);
    if (episodes.length) {
      const episode = episodes[Math.floor(Math.random() * episodes.length)];
      state.shuffleSession = { universal: true, seriesId: series.id, startedAt: Date.now() };
      return openPlayer(series, episode, { shuffle: true, universalShuffle: true });
    }
  }
  alert('No se encontraron episodios para shuffle.');
}

function activateNav() {
  const el = document.querySelector(`.tv-side-icon[data-nav-index="${state.navFocus}"]`);
  const action = el?.dataset.navAction || 'home';
  state.activeNav = action;
  applyNavFocus();
  if (action === 'home') {
    state.focusArea = 'content';
    renderHome();
    return;
  }
  if (action === 'favorites') {
    state.mode = 'home';
    state.focusArea = 'content';
    renderFavorites();
    return;
  }
  if (action === 'search') { return renderSearch(); }
  if (action === 'settings') { return openSettings(); }
}
function renderRowsFromState() {
  $('#tvRows').classList.toggle('favorites-mode', state.activeNav === 'favorites');
  document.body.classList.toggle('tv-favorites-view', state.activeNav === 'favorites');
  document.body.classList.toggle('tv-search-view', state.activeNav === 'search');
  $('#tvSettings')?.classList.add('hidden');
  $('#tvSettings')?.setAttribute('aria-hidden', 'true');
  $('#tvRows').innerHTML = state.rows.map((row, rowIndex) => {
    const sourceItems = row.items || [];
    const isGrid = row.layout === 'grid';
    const loop = !isGrid && rowShouldLoop(row);
    const renderItems = loop ? [...sourceItems, ...sourceItems, ...sourceItems] : sourceItems;
    return `
    <section class="tv-row ${row.layout === 'grid' ? 'tv-row-grid' : ''}" data-row="${rowIndex}">
      <h2>${row.title}</h2>
      <div class="tv-row-track">
        ${renderItems.slice(0, 60).map((item, visualIndex) => {
          const logicalCol = sourceItems.length ? visualIndex % sourceItems.length : 0;
          return `
          <button class="tv-card" data-focus-group="home" data-row="${rowIndex}" data-col="${logicalCol}" data-visual-col="${visualIndex}" type="button" style="--progress:${getItemProgress(item)}%">
            <img src="${item.poster}" alt="${item.title}">
            <div class="tv-card-title">${item.title}</div>
            ${getItemProgress(item) > 1 && !isItemCompleted(item) ? '<div class="tv-card-progress"><span></span></div>' : ''}
          </button>`;
        }).join('')}
      </div>
    </section>`;
  }).join('');

  state.focus.row = clamp(state.focus.row, 0, Math.max(0, state.rows.length - 1));
  const activeLen = state.rows[state.focus.row]?.items.length || 1;
  setRowVisual(state.focus.row, rowVisual(state.focus.row));
  state.focus.col = modulo(rowVisual(state.focus.row), activeLen);
  applyHomeFocus();
}
function applyHomeFocus() {
  document.querySelectorAll('.tv-card').forEach(card => card.classList.remove('focused'));
  const activeVisual = rowVisual(state.focus.row);
  const card = document.querySelector(`.tv-card[data-row="${state.focus.row}"][data-visual-col="${activeVisual}"]`);
  applyNavFocus();
  if (state.activeNav === 'search') applySearchFocus();
  if (!card) {
    $('#tvHero').innerHTML = '<div class="tv-hero-info"><h1>No hay contenido</h1><p>Esta sección todavía no tiene títulos.</p></div>';
    return;
  }
  if (state.focusArea === 'content') {
    card.classList.add('focused');
    card.focus({ preventScroll: true });
  }

  const item = focusedItem();
  $('#tvHero').innerHTML = heroHTML(item);
  if (item?.type === 'series' && !state.episodesBySeries[item.id]) {
    const expectedId = item.id;
    ensureSeriesEpisodes(item).then(() => {
      const current = focusedItem();
      if (state.mode === 'home' && current?.id === expectedId) applyHomeFocus();
    });
  }

  const rowsEl = $('#tvRows');
  const activeRow = document.querySelector(`.tv-row[data-row="${state.focus.row}"]`);
  const activeVisualForScroll = rowVisual(state.focus.row);
  const activeCardForScroll = activeRow?.querySelector(`.tv-card[data-visual-col="${activeVisualForScroll}"]`);
  if (rowsEl) {
    if (state.activeNav === 'favorites') {
      rowsEl.style.transform = 'translateY(0px)';
      const cardTop = activeCardForScroll ? activeCardForScroll.offsetTop : 0;
      const safeTop = state.activeNav === 'favorites' ? 0 : Math.max(18, Math.round(rowsEl.clientHeight * 0.03));
      const maxShift = Math.max(0, (activeRow?.scrollHeight || 0) - rowsEl.clientHeight + 28);
      const favShift = Math.min(Math.max(0, cardTop - safeTop), maxShift);
      const favTrack = activeRow?.querySelector('.tv-row-track');
      if (favTrack) favTrack.style.setProperty('--fav-shift', `${-favShift}px`);
    } else {
      rowsEl.style.removeProperty('transform');
      document.querySelectorAll('.tv-row-grid .tv-row-track').forEach(track => track.style.removeProperty('--fav-shift'));
      const rowOffset = activeRow ? activeRow.offsetTop : 0;
      rowsEl.style.transform = `translateY(${-rowOffset}px)`;
    }
  }

  document.querySelectorAll('.tv-row').forEach(row => {
    const rowIndex = Number(row.dataset.row);
    row.style.opacity = state.activeNav === 'favorites' ? '1' : (rowIndex < state.focus.row ? '0' : '1');
    const track = row.querySelector('.tv-row-track');
    const visual = rowVisual(rowIndex);
    const activeCard = row.querySelector(`.tv-card[data-visual-col="${visual}"]`);
    const x = activeCard ? Math.max(0, activeCard.offsetLeft - 46) : 0;
    if (track && !row.classList.contains('tv-row-grid')) track.style.transform = `translateX(${-x}px)`;
  });
}

function heroFocusables() {
  return [...document.querySelectorAll('[data-hero-action]')];
}

function applyHeroFocus() {
  document.querySelectorAll('.tv-card').forEach(card => card.classList.remove('focused'));
  const buttons = heroFocusables();
  state.heroFocus = clamp(state.heroFocus, 0, Math.max(0, buttons.length - 1));
  buttons.forEach(button => button.classList.remove('focused'));
  const button = buttons[state.heroFocus];
  if (button) {
    button.classList.add('focused');
    button.focus({ preventScroll: true });
  }
  applyNavFocus();
}

function enterHeroMode() {
  if (!focusedItem()) return;
  state.previewItem = null;
  state.mode = 'hero';
  state.heroFocus = 0;
  state.favoritesPreviewFromHero = state.activeNav === 'favorites';
  applyHeroFocus();
}


function settingsOptions() {
  return [...document.querySelectorAll('.tv-settings-option')]
    .sort((a, b) => Number(a.dataset.settingsIndex || 0) - Number(b.dataset.settingsIndex || 0));
}
function openSettings() {
  state.mode = 'settings';
  state.activeNav = 'settings';
  state.focusArea = 'settings';
  state.settingsFocus = 0;
  $('#tvSettings')?.classList.remove('hidden');
  $('#tvSettings')?.setAttribute('aria-hidden', 'false');
  $('#tvRows')?.classList.remove('favorites-mode');
  applyNavFocus();
  applySettingsFocus();
}
function closeSettings() {
  $('#tvSettings')?.classList.add('hidden');
  $('#tvSettings')?.setAttribute('aria-hidden', 'true');
  state.mode = 'home';
  state.focusArea = 'nav';
  applyHomeFocus();
}
function applySettingsFocus() {
  const options = settingsOptions();
  state.settingsFocus = clamp(state.settingsFocus, 0, Math.max(0, options.length - 1));
  options.forEach((option, index) => option.classList.toggle('focused', index === state.settingsFocus));
  options[state.settingsFocus]?.focus({ preventScroll: true });
}
function moveSettings(delta) {
  state.settingsFocus = clamp(state.settingsFocus + delta, 0, settingsOptions().length - 1);
  applySettingsFocus();
}
async function clearTVHistory() {
  const ok = confirm('¿Restablecer historial? Esto eliminará progreso, continuar viendo y episodios vistos. Tus favoritos se conservan.');
  if (!ok) return;
  localStorage.removeItem('womo_continue_watching');
  localStorage.removeItem('womo_series_progress');
  localStorage.removeItem(completedStorageKey());
  state.items.forEach(item => { item.progress = 0; item.completed = false; });
  const ref = getUserDocRef();
  if (ref) {
    for (const name of ['continueWatching', 'episodeProgress', 'completed', 'playHistory']) {
      try {
        const snap = await ref.collection(name).get();
        await Promise.all(snap.docs.map(doc => doc.ref.delete()));
      } catch (error) { console.warn(`No se pudo limpiar ${name}`, error); }
    }
    try { await ref.set({ historyResetAt: Date.now(), updatedAt: firebase.firestore.FieldValue.serverTimestamp() }, { merge: true }); } catch (_) {}
  }
  state.continueItems = [];
  if (state.activeNav === 'favorites') renderFavorites();
  else if (state.activeNav === 'search') renderSearch();
  else renderHome();
  alert('Historial restablecido.');
}
async function logoutCurrentDeviceTV() {
  try { await firebase.auth().signOut(); } catch (error) { console.warn('No se pudo cerrar sesión.', error); }
}
async function logoutEverywhereTV() {
  const ok = confirm('¿Cerrar sesión en todos lados? Tendrás que iniciar sesión de nuevo en tus dispositivos.');
  if (!ok) return;
  try {
    const ref = getUserDocRef();
    if (ref) await ref.set({ logoutAllAt: Date.now() }, { merge: true });
    await firebase.auth().signOut();
  } catch (error) {
    console.warn('No se pudo cerrar en todos lados.', error);
    await logoutCurrentDeviceTV();
  }
}
function activateSettings() {
  const option = settingsOptions()[state.settingsFocus];
  const action = option?.dataset.settingsAction;
  if (action === 'history') return clearTVHistory();
  if (action === 'logoutAll') return logoutEverywhereTV();
  if (action === 'logout') return logoutCurrentDeviceTV();
}

function exitHeroMode() {
  state.mode = 'home';
  state.focusArea = 'content';
  state.favoritesPreviewFromHero = false;
  applyHomeFocus();
}

function moveHero(dx) {
  const buttons = heroFocusables();
  if (!buttons.length) return;
  state.heroFocus = clamp(state.heroFocus + dx, 0, buttons.length - 1);
  applyHeroFocus();
}

function activateHero() {
  const item = focusedItem();
  const button = heroFocusables()[state.heroFocus];
  if (!item || !button) return;
  const action = button.dataset.heroAction;
  if (action === 'favorite') {
    toggleFavorite(item);
    renderHero(item);
    applyHeroFocus();
    return;
  }
  if (action === 'restart') {
    upsertContinue(item, 0);
    setItemCompleted(item, false);
    return openPlayer(item, null);
  }
  if (item.type === 'series') {
    if (action === 'shuffle') return startSeriesShuffle(item);
    return playSeriesPrimary(item);
  }
  if (isItemCompleted(item)) setItemCompleted(item, false);
  return openPlayer(item, null);
}

function moveHome(dx, dy) {
  if (state.focusArea === 'nav') {
    if (dy) state.navFocus = clamp(state.navFocus + dy, 0, navMaxIndex());
    if (dx > 0) state.focusArea = state.activeNav === 'search' && !buildSearchResults().length ? 'searchForm' : 'content';
    if (state.activeNav === 'search' && state.focusArea === 'searchForm') return applySearchFocus();
    applyHomeFocus();
    return;
  }
  if (state.activeNav === 'favorites') {
    const row = state.rows[0];
    const len = row?.items.length || 0;
    if (!len) return applyHomeFocus();
    const columns = getGridColumnCount();
    const visual = rowVisual(0);
    if (dy) {
      const target = visual + (dy * columns);
      if (target >= 0 && target < len) {
        setRowVisual(0, target);
      } else if (dy > 0) {
        const nextRowStart = Math.floor(visual / columns + 1) * columns;
        if (nextRowStart < len) {
          setRowVisual(0, len - 1);
        }
      } else if (dy < 0) {
        const prevRowStart = Math.floor(visual / columns - 1) * columns;
        if (prevRowStart >= 0) {
          setRowVisual(0, Math.min(prevRowStart + columns - 1, len - 1));
        }
      }
    }
    if (dx) {
      if (dx < 0 && visual <= 0) {
        state.focusArea = 'nav';
        applyHomeFocus();
        return;
      }
      const target = visual + dx;
      if (target >= 0 && target < len) setRowVisual(0, target);
    }
    applyHomeFocus();
    return;
  }
  if (dy) {
    const currentRowId = state.rows[state.focus.row]?.id;
    if (currentRowId) state.rowVisuals[currentRowId] = rowVisual(state.focus.row);
    state.focus.row = clamp(state.focus.row + dy, 0, state.rows.length - 1);
    const len = state.rows[state.focus.row]?.items.length || 1;
    state.focus.col = modulo(rowVisual(state.focus.row), len);
  }
  if (dx) {
    const row = state.rows[state.focus.row];
    const visual = rowVisual(state.focus.row);
    const len = row?.items.length || 1;
    if (dx < 0 && !rowShouldLoop(row) && visual <= 0) {
      state.focusArea = state.activeNav === 'search' ? 'searchForm' : 'nav';
      applyHomeFocus();
      return;
    }
    if (dx < 0 && rowShouldLoop(row) && modulo(visual, len) === 0 && visual === 0) {
      state.focusArea = 'nav';
      applyHomeFocus();
      return;
    }
    setRowVisual(state.focus.row, visual + dx);
  }
  applyHomeFocus();
}
async function readSeriesEpisodes(seriesId) {
  try {
    const snap = await db.collection('series').doc(seriesId).collection('episodes').get();
    return snap.docs.map((doc, index) => {
      const data = doc.data() || {};
      const season = Number(data.season || data.seasonNumber || data.temporada || 1);
      const episodeNumber = Number(data.episode || data.episodeNumber || data.number || data.episodio || index + 1);
      const durationRaw = data.duration || data.runtime || data.durationMinutes || '';
      return {
        id: doc.id,
        type: 'episode',
        title: data.title || data.name || data.episodeTitle || cleanTitleFromId(doc.id),
        season,
        episode: episodeNumber,
        episodeNumber,
        duration: durationRaw ? `${durationRaw} min`.replace(' min min', ' min') : '',
        hlsUrl: getDataVideoUrl(data),
        videoUrl: getDataVideoUrl(data)
      };
    }).sort((a, b) => (a.season - b.season) || (a.episodeNumber - b.episodeNumber));
  } catch (error) {
    console.warn('No se pudieron leer episodios', error);
    return [];
  }
}

async function openPreview(item) {
  if (!item) return;
  state.mode = 'preview';
  state.previewItem = item;
  state.previewFocus = 0;
  state.previewEpisodes = item.type === 'series' ? await readSeriesEpisodes(item.id) : [];
  document.querySelector('.tv-preview-backdrop').style.backgroundImage = `linear-gradient(90deg, rgba(0,0,0,.88), rgba(0,0,0,.78)), url('${item.poster}')`;
  $('#tvPreviewPoster').src = item.poster;
  $('#tvPreviewTitle').textContent = item.title;
  $('#tvPreviewMeta').innerHTML = [item.duration, item.year, item.genre].filter(Boolean).map(x => `<span>${x}</span>`).join('');
  $('#tvPreviewDescription').textContent = item.description || '';
  renderPreviewActions(item);
  $('#tvPreviewEpisodes').innerHTML = state.previewEpisodes.slice(0, 8).map((ep, index) => `
    <button class="tv-episode focusable" data-focus-group="preview" data-preview-index="${index + 3}" data-episode-index="${index}" type="button">
      <div class="tv-episode-number">${String(ep.episode).padStart(2, '0')}</div>
      <div><div class="tv-episode-title">${ep.title}</div><div class="tv-episode-meta">Temporada ${ep.season}${ep.duration ? ` · ${ep.duration}` : ''}</div></div>
    </button>`).join('');
  $('#tvPreview').classList.remove('hidden');
  $('#tvPreview').setAttribute('aria-hidden', 'false');
  applyPreviewFocus();
}

function renderPreviewActions(item) {
  const primaryLabel = getHeroPrimaryLabel(item);
  const favLabel = isFavorite(item) ? 'Quitar favorito' : 'Favorito';
  if (item?.type === 'series') {
    $('#tvPreviewActions').innerHTML = `
      <button class="tv-action primary focusable" data-focus-group="preview" data-preview-index="1" data-action="play" type="button">${primaryLabel}</button>
      <button class="tv-action focusable" data-focus-group="preview" data-preview-index="2" data-action="shuffle" type="button"><span>${icon('shuffle')}</span> Shuffle</button>
    `;
    return;
  }
  $('#tvPreviewActions').innerHTML = `
    <button class="tv-action primary focusable" data-focus-group="preview" data-preview-index="1" data-action="play" type="button">${primaryLabel}</button>
    <button class="tv-action focusable" data-focus-group="preview" data-preview-index="2" data-action="favorite" type="button">${favLabel}</button>
  `;
}

function previewFocusables() {
  return [...document.querySelectorAll('[data-focus-group="preview"]')].filter(el => !el.closest('.hidden'));
}
function applyPreviewFocus() {
  const els = previewFocusables();
  state.previewFocus = clamp(state.previewFocus, 0, els.length - 1);
  els.forEach(el => el.classList.remove('focused'));
  const el = els[state.previewFocus];
  if (el) { el.classList.add('focused'); el.focus({ preventScroll: true }); }
}
function movePreview(delta) { state.previewFocus += delta; applyPreviewFocus(); }
function closePreview() {
  $('#tvPreview').classList.add('hidden');
  $('#tvPreview').setAttribute('aria-hidden', 'true');
  state.mode = 'home';
  applyHomeFocus();
}
function activatePreview() {
  const el = previewFocusables()[state.previewFocus];
  if (!el) return;
  if (el.id === 'tvPreviewBack') return closePreview();
  if (el.dataset.action === 'favorite') return toggleFavorite(state.previewItem);
  if (el.dataset.action === 'play') return playPreviewPrimary();
  if (el.dataset.action === 'shuffle') return startSeriesShuffle(state.previewItem);
  if (el.classList.contains('tv-episode')) {
    const ep = state.previewEpisodes[Number(el.dataset.episodeIndex)];
    return openPlayer(state.previewItem, ep);
  }
}
async function playSeriesPrimary(series) {
  const episodes = await ensureSeriesEpisodes(series);
  const playback = getSeriesPlaybackState(series);
  const episode = playback.episode || episodes[0];
  if (playback.allCompleted) {
    episodes.forEach(ep => setEpisodeProgress(series.id, ep, 0));
  }
  return openPlayer(series, episode, { shuffle: false });
}
function playPreviewPrimary() {
  if (state.previewItem.type === 'series') return playSeriesPrimary(state.previewItem);
  return openPlayer(state.previewItem, null);
}
async function startSeriesShuffle(series) {
  const episodes = await ensureSeriesEpisodes(series);
  if (!episodes.length) return alert('Esta serie no tiene episodios disponibles.');
  const episode = episodes[Math.floor(Math.random() * episodes.length)];
  state.shuffleSession = { seriesId: series.id, startedAt: Date.now() };
  return openPlayer(series, episode, { shuffle: true });
}


function setPlayerNativeControls(visible) {
  const video = $('#tvPlayer');
  const overlay = $('#tvPlayerOverlay');
  if (!video) return;
  if (visible) video.setAttribute('controls', '');
  else video.removeAttribute('controls');
  overlay?.classList.toggle('chrome-hidden', !visible);
}
function showPlayerChrome(autoHide = true) {
  const topbar = $('#tvPlayerTopbar');
  if (!topbar) return;
  topbar.classList.remove('hidden-chrome');
  setPlayerNativeControls(true);
  clearTimeout(state.playerChromeTimer);
  if (autoHide) {
    state.playerChromeTimer = setTimeout(() => {
      if (state.mode === 'player') hidePlayerChrome();
    }, 2600);
  }
}
function hidePlayerChrome() {
  clearTimeout(state.playerChromeTimer);
  const topbar = $('#tvPlayerTopbar');
  if (topbar) topbar.classList.add('hidden-chrome');
  setPlayerNativeControls(false);
}
function seekToSavedProgress(video, savedProgress) {
  const pct = clamp(Number(savedProgress || 0), 0, 97);
  if (!pct || !video || !video.duration || !Number.isFinite(video.duration)) return;
  try {
    video.currentTime = Math.max(0, Math.min(video.duration - 2, video.duration * (pct / 100)));
  } catch (error) {
    console.warn('[Womo TV] No se pudo continuar desde progreso guardado.', error);
  }
}
function getPlayableStartProgress(item, episode) {
  return episode ? getEpisodeProgress(item.id, episode) : getItemProgress(item);
}


function clearPlayerTimers() {
  clearTimeout(state.playerChromeTimer);
  clearTimeout(state.playerNextOverlayTimer);
  state.playerNextFocus = 0;
  state.playerShuffleFocus = false;
  applyPlayerNextFocus();
  $('#tvShuffleNextBtn')?.classList.remove('focused');
  clearInterval(state.playerNextCountdownTimer);
  clearTimeout(state.shuffleQuickTimer);
  clearTimeout(state.shuffleQuickHideTimer);
  state.playerChromeTimer = null;
  state.playerNextOverlayTimer = null;
  state.playerNextCountdownTimer = null;
  state.shuffleQuickTimer = null;
  state.shuffleQuickHideTimer = null;
}
function ensurePlayerOverlays() {
  const overlay = $('#tvPlayerOverlay');
  if (!overlay || $('#tvNextOverlay')) return;
  overlay.insertAdjacentHTML('beforeend', `
    <div id="tvShuffleNext" class="tv-shuffle-next hidden" aria-hidden="true">
      <button id="tvShuffleNextBtn" class="tv-shuffle-next-btn" type="button"><span>${icon('shuffle')}</span><b>Siguiente</b></button>
    </div>
    <div id="tvNextOverlay" class="tv-next-overlay hidden" aria-hidden="true">
      <div class="tv-next-card">
        <div class="tv-next-eyebrow">Siguiente episodio</div>
        <h3 id="tvNextSeries"></h3>
        <p id="tvNextEpisode"></p>
        <div class="tv-next-actions">
          <button id="tvNextPlay" class="tv-next-button primary" type="button">Siguiente en 15</button>
          <button id="tvNextCancel" class="tv-next-button" type="button">Cancelar</button>
        </div>
      </div>
    </div>`);
  $('#tvShuffleNextBtn')?.addEventListener('click', () => playRandomShuffleEpisode());
  $('#tvNextPlay')?.addEventListener('click', () => playPreparedNextEpisode());
  $('#tvNextCancel')?.addEventListener('click', () => cancelNextEpisodeOverlay());
}
function hideNextOverlay() {
  clearInterval(state.playerNextCountdownTimer);
  state.playerNextCountdownTimer = null;
  const el = $('#tvNextOverlay');
  if (el) {
    el.classList.add('hidden');
    el.setAttribute('aria-hidden', 'true');
  }
}
function hideShuffleQuickButton() {
  const el = $('#tvShuffleNext');
  if (!el) return;
  state.playerShuffleFocus = false;
  $('#tvShuffleNextBtn')?.classList.remove('focused');
  el.classList.add('is-fading');
  clearTimeout(state.shuffleQuickHideTimer);
  state.shuffleQuickHideTimer = setTimeout(() => {
    el.classList.add('hidden');
    el.classList.remove('is-fading');
    el.setAttribute('aria-hidden', 'true');
  }, 450);
}
function shuffleQuickVisible() {
  const el = $('#tvShuffleNext');
  return Boolean(el && !el.classList.contains('hidden') && el.getAttribute('aria-hidden') !== 'true');
}
function focusShuffleQuickButton() {
  if (!shuffleQuickVisible()) return false;
  state.playerShuffleFocus = true;
  const btn = $('#tvShuffleNextBtn');
  btn?.classList.add('focused');
  btn?.focus({ preventScroll: true });
  showPlayerChrome(false);
  clearTimeout(state.shuffleQuickHideTimer);
  return true;
}
function unfocusShuffleQuickButton() {
  state.playerShuffleFocus = false;
  $('#tvShuffleNextBtn')?.classList.remove('focused');
  showPlayerChrome(true);
  if (shuffleQuickVisible()) {
    clearTimeout(state.shuffleQuickHideTimer);
    state.shuffleQuickHideTimer = setTimeout(hideShuffleQuickButton, 10000);
  }
}
function showShuffleQuickButton() {
  if (!state.currentPlaying?.shuffle || state.mode !== 'player') return;
  ensurePlayerOverlays();
  const el = $('#tvShuffleNext');
  if (!el) return;
  state.playerShuffleFocus = false;
  $('#tvShuffleNextBtn')?.classList.remove('focused');
  el.classList.remove('hidden', 'is-fading');
  el.setAttribute('aria-hidden', 'false');
  clearTimeout(state.shuffleQuickHideTimer);
  state.shuffleQuickHideTimer = setTimeout(hideShuffleQuickButton, 10000);
}
function scheduleShuffleQuickButton() {
  clearTimeout(state.shuffleQuickTimer);
  if (!state.currentPlaying?.shuffle) return;
  state.shuffleQuickTimer = setTimeout(showShuffleQuickButton, 3000);
}
function getSortedEpisodes(seriesId) {
  return [...getCachedEpisodes(seriesId)].sort((a, b) => (a.season - b.season) || ((a.episodeNumber || a.episode) - (b.episodeNumber || b.episode)));
}
function getNextLinearEpisode(series, episode) {
  if (!series || !episode) return null;
  const episodes = getSortedEpisodes(series.id);
  const currentIndex = episodes.findIndex(ep => (ep.id && ep.id === episode.id) || (ep.season === episode.season && (ep.episodeNumber || ep.episode) === (episode.episodeNumber || episode.episode)));
  if (currentIndex < 0) return episodes[0] || null;
  return episodes[currentIndex + 1] || null;
}
function getRandomShuffleEpisode(series, currentEpisode = null) {
  if (state.shuffleSession?.universal) return null;
  const episodes = getSortedEpisodes(series?.id);
  if (!episodes.length) return null;
  if (episodes.length === 1) return episodes[0];
  const currentKey = currentEpisode ? `${currentEpisode.season}:${currentEpisode.episodeNumber || currentEpisode.episode}:${currentEpisode.id || ''}` : '';
  const candidates = episodes.filter(ep => `${ep.season}:${ep.episodeNumber || ep.episode}:${ep.id || ''}` !== currentKey);
  return candidates[Math.floor(Math.random() * candidates.length)] || episodes[Math.floor(Math.random() * episodes.length)];
}
function prepareNextEpisode() {
  const playing = state.currentPlaying;
  if (!playing || !playing.episode || playing.nextCanceled) return null;
  if (playing.shuffle) { if (state.shuffleSession?.universal) return null; return getRandomShuffleEpisode(playing.item, playing.episode); }
  return getNextLinearEpisode(playing.item, playing.episode);
}
function showNextEpisodeOverlay(nextEpisode) {
  const playing = state.currentPlaying;
  if (!playing || !nextEpisode || playing.nextOverlayShown || playing.nextCanceled) return;
  ensurePlayerOverlays();
  playing.preparedNextEpisode = nextEpisode;
  playing.nextOverlayShown = true;
  playing.nextCountdown = 15;
  $('#tvNextSeries').textContent = playing.item?.title || 'Siguiente episodio';
  $('#tvNextEpisode').textContent = `T${nextEpisode.season} E${nextEpisode.episodeNumber || nextEpisode.episode} · ${nextEpisode.title || ''}`;
  $('#tvNextPlay').textContent = 'Siguiente en 15';
  const el = $('#tvNextOverlay');
  el?.classList.remove('hidden');
  el?.setAttribute('aria-hidden', 'false');
  state.playerNextFocus = 0;
  state.playerShuffleFocus = false;
  applyPlayerNextFocus();
  $('#tvShuffleNextBtn')?.classList.remove('focused');
  clearInterval(state.playerNextCountdownTimer);
  state.playerNextCountdownTimer = setInterval(() => {
    if (!state.currentPlaying || state.currentPlaying !== playing) return hideNextOverlay();
    playing.nextCountdown -= 1;
    $('#tvNextPlay').textContent = `Siguiente en ${Math.max(0, playing.nextCountdown)}`;
    if (playing.nextCountdown <= 0) playPreparedNextEpisode();
  }, 1000);
}
function maybeShowNextEpisodeOverlay() {
  const playing = state.currentPlaying;
  const video = $('#tvPlayer');
  if (!playing || !playing.episode || !video?.duration || !Number.isFinite(video.duration)) return;
  if (playing.nextOverlayShown || playing.nextCanceled) return;
  const remaining = video.duration - video.currentTime;
  if (remaining <= 18) {
    const next = prepareNextEpisode();
    if (next) showNextEpisodeOverlay(next);
  }
}
function playPreparedNextEpisode() {
  const playing = state.currentPlaying;
  if (!playing || !playing.episode) return;
  const next = playing.preparedNextEpisode || prepareNextEpisode();
  if (!next) return closePlayer();
  const item = playing.item;
  const shuffle = Boolean(playing.shuffle);
  if (!shuffle) setEpisodeProgress(item.id, playing.episode, 100);
  hideNextOverlay();
  openPlayer(item, next, { shuffle });
}
async function playRandomShuffleEpisode() {
  const playing = state.currentPlaying;
  if (!playing || !playing.shuffle) return;
  if (state.shuffleSession?.universal) return startUniversalShuffle();
  const next = getRandomShuffleEpisode(playing.item, playing.episode);
  if (!next) return;
  state.playerShuffleFocus = false;
  hideNextOverlay();
  hideShuffleQuickButton();
  openPlayer(playing.item, next, { shuffle: true });
}
function cancelNextEpisodeOverlay() {
  if (!state.currentPlaying) return;
  state.currentPlaying.nextCanceled = true;
  state.currentPlaying.closeWhenEnded = true;
  hideNextOverlay();
}
function nextOverlayVisible() {
  return !$('#tvNextOverlay')?.classList.contains('hidden');
}
function applyPlayerNextFocus() {
  const buttons = [$('#tvNextPlay'), $('#tvNextCancel')].filter(Boolean);
  state.playerNextFocus = clamp(state.playerNextFocus || 0, 0, buttons.length - 1);
  buttons.forEach((button, index) => button.classList.toggle('focused', index === state.playerNextFocus));
  buttons[state.playerNextFocus]?.focus({ preventScroll: true });
}
function movePlayerNextFocus(dx) {
  const buttons = [$('#tvNextPlay'), $('#tvNextCancel')].filter(Boolean);
  if (!buttons.length) return;
  state.playerNextFocus = clamp((state.playerNextFocus || 0) + dx, 0, buttons.length - 1);
  applyPlayerNextFocus();
}
function activatePlayerNextFocus() {
  if ((state.playerNextFocus || 0) === 0) return playPreparedNextEpisode();
  return cancelNextEpisodeOverlay();
}
async function handlePlaybackEnded() {
  const playing = state.currentPlaying;
  if (!playing) return;
  if (playing.shuffle) {
    const next = playing.nextCanceled ? null : (playing.preparedNextEpisode || getRandomShuffleEpisode(playing.item, playing.episode));
    if (next) return openPlayer(playing.item, next, { shuffle: true });
    return closePlayer();
  }
  if (playing.episode) {
    setEpisodeProgress(playing.item.id, playing.episode, 100);
    if (playing.closeWhenEnded || playing.nextCanceled) return closePlayer();
    const next = playing.preparedNextEpisode || getNextLinearEpisode(playing.item, playing.episode);
    if (next) return openPlayer(playing.item, next, { shuffle: false });
    return closePlayer();
  }
  persistCurrentPlaybackProgress(true);
  closePlayer();
}

function openPlayer(item, episode, options = {}) {
  clearPlayerTimers();
  ensurePlayerOverlays();
  hideNextOverlay();
  hideShuffleQuickButton();
  const url = getPlayableUrl(item, episode);
  console.log('[Womo TV] openPlayer', { title: item?.title, episode: episode?.title, url, item, episode });
  if (!url) {
    const detail = episode ? `Episodio sin URL: T${episode.season}E${episode.episodeNumber || episode.episode}` : 'Título sin URL.';
    return alert(`${detail}\n\nTV sí está conectada a la BD, pero este registro no trae un campo de video legible para TV.`);
  }
  state.mode = 'player';
  const isShufflePlayback = Boolean(options.shuffle);
  const startProgress = isShufflePlayback ? 0 : getPlayableStartProgress(item, episode);
  state.currentPlaying = { item, episode, shuffle: isShufflePlayback, lastProgress: startProgress || 0, didSeek: false, lastSavedAt: 0, nextOverlayShown: false, nextCanceled: false, closeWhenEnded: false, preparedNextEpisode: null, nextCountdown: 15 };
  $('#tvPlayerTitle').textContent = item.title;
  $('#tvPlayerSubtitle').textContent = episode ? `T${episode.season} E${episode.episodeNumber || episode.episode} · ${episode.title}` : '';
  $('#tvPlayerOverlay').classList.remove('hidden');
  $('#tvPlayerOverlay').setAttribute('aria-hidden', 'false');
  showPlayerChrome(true);
  const video = $('#tvPlayer');
  if (state.hls) { state.hls.destroy(); state.hls = null; }
  video.pause();
  video.removeAttribute('src');
  video.load();
  video.onerror = () => console.warn('[Womo TV] video error', { url, error: video.error });
  video.onloadedmetadata = () => {
    if (state.currentPlaying && !state.currentPlaying.didSeek) {
      seekToSavedProgress(video, state.currentPlaying.lastProgress);
      state.currentPlaying.didSeek = true;
    }
  };
  video.oncanplay = () => {
    if (state.currentPlaying && !state.currentPlaying.didSeek) {
      seekToSavedProgress(video, state.currentPlaying.lastProgress);
      state.currentPlaying.didSeek = true;
    }
    video.play().catch(error => console.warn('[Womo TV] play blocked/canplay', error));
  };

  const isHlsUrl = String(url).includes('.m3u8') || String(url).includes('playlist');
  if (window.Hls && Hls.isSupported() && isHlsUrl) {
    state.hls = new Hls({ maxBufferLength: 40, enableWorker: true });
    state.hls.loadSource(url);
    state.hls.attachMedia(video);
    state.hls.on(Hls.Events.MANIFEST_PARSED, () => video.play().catch(error => console.warn('[Womo TV] play blocked/manifest', error)));
    state.hls.on(Hls.Events.ERROR, (event, data) => {
      console.warn('[Womo TV] HLS error', data);
      if (!data || !data.fatal || !state.hls) return;
      try {
        if (data.type === Hls.ErrorTypes.NETWORK_ERROR) state.hls.startLoad();
        else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) state.hls.recoverMediaError();
        else {
          state.hls.destroy();
          state.hls = null;
          video.src = url;
          video.load();
          video.play().catch(() => {});
        }
      } catch (error) {
        console.warn('[Womo TV] no se pudo recuperar HLS', error);
      }
    });
  } else {
    video.src = url;
    video.load();
    video.play().catch(error => console.warn('[Womo TV] play blocked/direct', error));
  }
  if (!episode && !isItemCompleted(item)) upsertContinue(item, Math.max(1, getItemProgress(item) || 1));
  scheduleShuffleQuickButton();
}

function persistCurrentPlaybackProgress(forceComplete = false) {
  const playing = state.currentPlaying;
  if (!playing) return;
  if (playing.shuffle) return;
  const video = $('#tvPlayer');
  let progress = playing.lastProgress || 0;
  if (forceComplete) progress = 100;
  else if (video.duration && Number.isFinite(video.duration) && video.duration > 0) {
    progress = Math.max(progress, (video.currentTime / video.duration) * 100);
  }
  if (playing.episode) setEpisodeProgress(playing.item.id, playing.episode, progress >= 98 ? 100 : progress);
  else upsertContinue(playing.item, progress >= 98 ? 100 : progress);
}
function closePlayer() {
  clearPlayerTimers();
  hideNextOverlay();
  hideShuffleQuickButton();
  persistCurrentPlaybackProgress(false);
  const video = $('#tvPlayer');
  video.pause();
  if (state.hls) { state.hls.destroy(); state.hls = null; }
  $('#tvPlayerOverlay').classList.add('hidden');
  $('#tvPlayerOverlay').setAttribute('aria-hidden', 'true');
  hidePlayerChrome();
  state.currentPlaying = null;
  state.mode = state.previewItem ? 'preview' : 'home';
  if (state.mode === 'preview') applyPreviewFocus();
  else {
    if (state.activeNav === 'favorites') renderFavorites();
    else if (state.activeNav === 'search') renderSearch();
    else renderHome();
    applyHomeFocus();
  }
}

function normalizeRemoteKey(event) {
  const key = event?.key || '';
  const code = Number(event?.keyCode || event?.which || 0);
  const byCode = {
    13: 'Enter',
    27: 'Escape',
    8: 'Backspace',
    37: 'ArrowLeft',
    38: 'ArrowUp',
    39: 'ArrowRight',
    40: 'ArrowDown',
    10009: 'BrowserBack',
    415: 'MediaPlayPause',
    19: 'MediaPlayPause',
    179: 'MediaPlayPause'
  };
  if (byCode[code]) return byCode[code];
  return key;
}

const remoteBridge = {
  locked: false,
  lastX: null,
  lastY: null,
  accX: 0,
  accY: 0,
  lastActionAt: 0,
  pointerThreshold: 34,
  actionCooldown: 210
};

function lockTVRemoteMode() {
  remoteBridge.locked = true;
  document.body.classList.add('tv-remote-locked');
  if (!document.body.hasAttribute('tabindex')) document.body.setAttribute('tabindex', '-1');
  const active = document.activeElement;
  const typing = active && ['INPUT', 'TEXTAREA'].includes(active.tagName);
  if (!typing) document.body.focus({ preventScroll: true });
}

function resetRemotePointerBridge() {
  remoteBridge.lastX = null;
  remoteBridge.lastY = null;
  remoteBridge.accX = 0;
  remoteBridge.accY = 0;
}

function sendSyntheticRemoteKey(key) {
  handleKey({
    key,
    keyCode: key === 'Enter' ? 13 : key === 'ArrowLeft' ? 37 : key === 'ArrowUp' ? 38 : key === 'ArrowRight' ? 39 : key === 'ArrowDown' ? 40 : 0,
    preventDefault() {},
    stopPropagation() {},
    stopImmediatePropagation() {}
  });
}

function handleRemotePointerMove(event) {
  if (!remoteBridge.locked) return;
  if (state.mode === 'player') return;
  const target = event.target;
  if (target && ['INPUT', 'TEXTAREA'].includes(target.tagName)) return;
  const x = Number(event.clientX || 0);
  const y = Number(event.clientY || 0);
  if (!remoteBridge.lastX && !remoteBridge.lastY) {
    remoteBridge.lastX = x;
    remoteBridge.lastY = y;
    return;
  }
  remoteBridge.accX += x - remoteBridge.lastX;
  remoteBridge.accY += y - remoteBridge.lastY;
  remoteBridge.lastX = x;
  remoteBridge.lastY = y;
  const now = Date.now();
  if (now - remoteBridge.lastActionAt < remoteBridge.actionCooldown) return;
  const absX = Math.abs(remoteBridge.accX);
  const absY = Math.abs(remoteBridge.accY);
  if (Math.max(absX, absY) < remoteBridge.pointerThreshold) return;
  const key = absX >= absY
    ? (remoteBridge.accX > 0 ? 'ArrowRight' : 'ArrowLeft')
    : (remoteBridge.accY > 0 ? 'ArrowDown' : 'ArrowUp');
  remoteBridge.accX = 0;
  remoteBridge.accY = 0;
  remoteBridge.lastActionAt = now;
  sendSyntheticRemoteKey(key);
}

function keepTVFocusInsideApp() {
  if (!remoteBridge.locked) return;
  const active = document.activeElement;
  const typing = active && ['INPUT', 'TEXTAREA'].includes(active.tagName);
  if (!typing && document.hasFocus()) document.body.focus({ preventScroll: true });
}

function handleKey(event) {
  lockTVRemoteMode();
  const key = normalizeRemoteKey(event);
  const enter = key === 'Enter' || key === 'NumpadEnter';
  const back = key === 'Escape' || key === 'Backspace' || key === 'BrowserBack' || Number(event.keyCode || 0) === 10009;
  const arrows = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];
  if (enter || back || arrows.includes(key) || key === 'MediaPlayPause') {
    event.preventDefault?.();
    event.stopPropagation?.();
    event.stopImmediatePropagation?.();
  }

  if (isLoginVisible()) {
    if (key === 'ArrowDown') return moveLogin(1);
    if (key === 'ArrowUp') return moveLogin(-1);
    if (enter) return activateLoginFocus();
    return;
  }

  if (state.mode === 'settings') {
    if (key === 'ArrowDown') return moveSettings(1);
    if (key === 'ArrowUp') return moveSettings(-1);
    if (key === 'ArrowLeft' || back) return closeSettings();
    if (enter) return activateSettings();
  }
  if (state.mode === 'home') {
    if (state.activeNav === 'search') {
      if (back) { state.focusArea = state.focusArea === 'nav' ? (buildSearchResults().length ? 'content' : 'searchForm') : 'nav'; return buildSearchResults().length ? applyHomeFocus() : applySearchFocus(); }
      if (state.focusArea === 'searchForm') {
        if (key === 'ArrowDown') { state.searchFormFocus = searchFormElements().length - 1; return applySearchFocus(); }
        if (key === 'ArrowUp') { state.searchFormFocus = 0; return applySearchFocus(); }
        if (key === 'ArrowRight') {
          const els = searchFormElements();
          if (state.searchFormFocus < els.length - 1 && els[state.searchFormFocus + 1]?.id === 'tvSearchClear') { state.searchFormFocus += 1; return applySearchFocus(); }
          state.focusArea = buildSearchResults().length ? 'content' : 'searchForm';
          return buildSearchResults().length ? applyHomeFocus() : applySearchFocus();
        }
        if (key === 'ArrowLeft') {
          const els = searchFormElements();
          if (els[state.searchFormFocus]?.id === 'tvSearchClear') { state.searchFormFocus = 0; return applySearchFocus(); }
          state.focusArea = 'nav'; return applySearchFocus();
        }
        if (enter) return activateSearchForm();
      }
    }
    if (back) {
      state.focusArea = state.focusArea === 'nav' ? 'content' : 'nav';
      return applyHomeFocus();
    }
    if (key === 'ArrowRight') return moveHome(1, 0);
    if (key === 'ArrowLeft') return moveHome(-1, 0);
    if (key === 'ArrowDown') return moveHome(0, 1);
    if (key === 'ArrowUp') return moveHome(0, -1);
    if (enter) { if (state.focusArea === 'nav') return activateNav(); return enterHeroMode(); }
  }
  if (state.mode === 'hero') {
    if ((back || key === 'ArrowDown') && state.activeNav === 'favorites') return exitHeroMode();
    if (key === 'ArrowRight') return moveHero(1);
    if (key === 'ArrowLeft') {
      if (state.activeNav === 'favorites' && state.heroFocus <= 0) return exitHeroMode();
      return moveHero(-1);
    }
    if (key === 'ArrowDown' || back) return exitHeroMode();
    if (enter) return activateHero();
  }
  if (state.mode === 'preview') {
    if (key === 'ArrowDown' || key === 'ArrowRight') return movePreview(1);
    if (key === 'ArrowUp' || key === 'ArrowLeft') return movePreview(-1);
    if (enter) return activatePreview();
    if (back) return closePreview();
  }
  if (state.mode === 'player') {
    showPlayerChrome(true);
    if (back) return closePlayer();
    if (nextOverlayVisible()) {
      if (key === 'ArrowRight') return movePlayerNextFocus(1);
      if (key === 'ArrowLeft') return movePlayerNextFocus(-1);
      if (enter) return activatePlayerNextFocus();
    }
    if (state.currentPlaying?.shuffle && shuffleQuickVisible()) {
      if (key === 'ArrowUp') return focusShuffleQuickButton();
      if (key === 'ArrowDown') return unfocusShuffleQuickButton();
      if (enter && state.playerShuffleFocus) return playRandomShuffleEpisode();
    }
    if (enter || key === 'MediaPlayPause') {
      const video = $('#tvPlayer');
      if (video.paused) video.play().catch(() => {}); else video.pause();
      return;
    }
  }
}

async function initTV() {
  $('#tvLoader').classList.remove('hidden');
  await Promise.all([loadContinueFromCloud(), loadCompletedFromCloud(), loadEpisodeProgressFromCloud(), loadFavoritesFromCloud()]);
  const [moviesRaw, series, concertsRaw] = await Promise.all([
    readCollection('movies', normalizeMovie),
    readCollection('series', normalizeSeries),
    readCollection('concerts', normalizeConcert)
  ]);
  state.movies = moviesRaw.filter(item => item.type === 'movie');
  state.concerts = [...moviesRaw.filter(item => item.type === 'concert'), ...concertsRaw];
  state.series = series;
  state.items = [...state.movies, ...state.series, ...state.concerts].sort((a, b) => b.createdAt - a.createdAt);
  state.homeSections = await readTVHomeSections();
  renderHome();
  $('#tvLoader').classList.add('hidden');
}


function loginFocusables() {
  return [$('#tvEmail'), $('#tvPassword'), $('#tvLoginForm button')].filter(Boolean);
}
function applyLoginFocus() {
  const fields = loginFocusables();
  state.loginFocus = clamp(state.loginFocus, 0, Math.max(0, fields.length - 1));
  fields.forEach((field, index) => field.classList.toggle('tv-login-focused', index === state.loginFocus));
  fields[state.loginFocus]?.focus({ preventScroll: true });
}
function moveLogin(delta) {
  state.loginFocus = clamp(state.loginFocus + delta, 0, loginFocusables().length - 1);
  applyLoginFocus();
}
function activateLoginFocus() {
  const fields = loginFocusables();
  const el = fields[state.loginFocus];
  if (!el) return;
  if (el.tagName === 'BUTTON') {
    $('#tvLoginForm')?.requestSubmit();
    return;
  }
  el.focus({ preventScroll: true });
}
function isLoginVisible() {
  return !$('#tvLogin')?.classList.contains('hidden');
}

function getLoginErrorMessage(error) {
  const code = error?.code || '';
  if (code.includes('auth/invalid-email')) return 'El correo no es válido.';
  if (code.includes('auth/user-disabled')) return 'Esta cuenta está deshabilitada.';
  if (code.includes('auth/user-not-found')) return 'No existe una cuenta con ese correo.';
  if (code.includes('auth/wrong-password') || code.includes('auth/invalid-credential')) return 'Correo o contraseña incorrectos.';
  if (code.includes('auth/too-many-requests')) return 'Demasiados intentos. Intenta más tarde.';
  if (code.includes('auth/network-request-failed')) return 'No hay conexión con Firebase. Revisa internet o el servidor local.';
  if (code.includes('auth/unauthorized-domain')) return 'Este dominio no está autorizado en Firebase Auth. Usa Go Live/localhost o agrega el dominio.';
  return `No se pudo iniciar sesión (${code || 'error desconocido'}).`;
}

function showLogin(show) {
  $('#tvLogin').classList.toggle('hidden', !show);
  $('#tvApp').classList.toggle('hidden', show);
  if (show) {
    state.mode = 'login';
    state.focusArea = 'login';
    setTimeout(applyLoginFocus, 0);
  } else if (state.mode === 'login') {
    state.mode = 'home';
    state.focusArea = 'content';
  }
}


function refreshContinueAfterProgress() {
  const rowIndex = state.rows.findIndex(row => row.id === 'continue' || row.title === 'Continuar viendo');
  if (rowIndex < 0) return;
  state.continueItems = buildContinueItems();
  state.rows[rowIndex] = { ...state.rows[rowIndex], items: state.continueItems };
}

function setupLogin() {
  $('#tvLoginForm').addEventListener('submit', async event => {
    event.preventDefault();
    $('#tvLoginError').textContent = '';
    try {
      await auth.signInWithEmailAndPassword($('#tvEmail').value.trim(), $('#tvPassword').value);
    } catch (error) {
      $('#tvLoginError').textContent = getLoginErrorMessage(error);
    }
  });
}

document.addEventListener('keydown', handleKey, true);
document.addEventListener('keyup', event => {
  const key = normalizeRemoteKey(event);
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter', 'BrowserBack', 'Backspace', 'Escape'].includes(key)) {
    event.preventDefault?.();
    event.stopPropagation?.();
  }
}, true);
document.addEventListener('mousemove', handleRemotePointerMove, true);
document.addEventListener('pointermove', handleRemotePointerMove, true);
document.addEventListener('wheel', event => {
  if (!remoteBridge.locked || state.mode === 'player') return;
  event.preventDefault?.();
  const absX = Math.abs(event.deltaX || 0);
  const absY = Math.abs(event.deltaY || 0);
  if (Math.max(absX, absY) < 8) return;
  sendSyntheticRemoteKey(absX > absY ? (event.deltaX > 0 ? 'ArrowRight' : 'ArrowLeft') : (event.deltaY > 0 ? 'ArrowDown' : 'ArrowUp'));
}, { capture: true, passive: false });
window.addEventListener('focus', () => { lockTVRemoteMode(); setTimeout(keepTVFocusInsideApp, 30); });
document.addEventListener('visibilitychange', () => { if (!document.hidden) setTimeout(() => { lockTVRemoteMode(); keepTVFocusInsideApp(); }, 80); });
document.addEventListener('focusin', event => {
  if (!event.target?.closest?.('input, textarea')) setTimeout(keepTVFocusInsideApp, 0);
}, true);
document.addEventListener('click', event => {
  lockTVRemoteMode();
  resetRemotePointerBridge();
  const nav = event.target.closest('.tv-side-icon');
  if (nav) { state.navFocus = Number(nav.dataset.navIndex || 0); state.focusArea = 'nav'; activateNav(); return; }
  const card = event.target.closest('.tv-card');
  if (card) { state.focus.row = Number(card.dataset.row); setRowVisual(state.focus.row, Number(card.dataset.visualCol || card.dataset.col || 0)); applyHomeFocus(); enterHeroMode(); }
  if (event.target.closest('#tvPreviewBack')) closePreview();
  if (event.target.closest('#tvPlayerBack')) closePlayer();
  const action = event.target.closest('[data-action]');
  const heroAction = event.target.closest('[data-hero-action]');
  if (heroAction) { state.mode = 'hero'; state.heroFocus = heroFocusables().indexOf(heroAction); activateHero(); return; }
  if (action && state.mode === 'preview') { state.previewFocus = previewFocusables().indexOf(action); activatePreview(); }
  const setting = event.target.closest('.tv-settings-option');
  if (setting) { state.settingsFocus = Number(setting.dataset.settingsIndex || 0); applySettingsFocus(); activateSettings(); return; }
  const ep = event.target.closest('.tv-episode');
  if (ep) { const episode = state.previewEpisodes[Number(ep.dataset.episodeIndex)]; openPlayer(state.previewItem, episode); }
});

const tvPlayerEl = $('#tvPlayer');
tvPlayerEl?.addEventListener('timeupdate', () => {
  if (!state.currentPlaying) return;
  maybeShowNextEpisodeOverlay();
  if (state.currentPlaying.shuffle) return;
  const video = $('#tvPlayer');
  if (!video.duration || !Number.isFinite(video.duration)) return;
  const progress = clamp((video.currentTime / video.duration) * 100, 0, 100);
  state.currentPlaying.lastProgress = progress;
  const now = Date.now();
  if (progress >= 98) {
    persistCurrentPlaybackProgress(true);
  } else if (!state.currentPlaying.lastSavedAt || now - state.currentPlaying.lastSavedAt > 5000) {
    persistCurrentPlaybackProgress(false);
    state.currentPlaying.lastSavedAt = now;
    refreshContinueAfterProgress();
  }
});
tvPlayerEl?.addEventListener('ended', () => handlePlaybackEnded());

$('#tvPlayerOverlay')?.addEventListener('mousemove', () => {
  if (state.mode === 'player') showPlayerChrome(true);
});
$('#tvPlayerOverlay')?.addEventListener('click', () => {
  if (state.mode === 'player') showPlayerChrome(true);
});


function setupSearch() {
  const input = $('#tvSearchInput');
  input?.addEventListener('input', event => {
    state.searchQuery = event.target.value || '';
    if (state.activeNav === 'search') {
      state.focusArea = 'searchForm';
      state.searchFormFocus = 0;
      renderSearch();
      input.focus({ preventScroll: true });
    }
  });
  input?.addEventListener('keydown', event => {
    if (event.key === 'Enter') {
      event.preventDefault();
      state.searchQuery = input.value || '';
      state.focusArea = 'searchForm';
      state.searchFormFocus = 0;
      renderSearch();
      input.focus({ preventScroll: true });
    }
  });
  $('#tvSearchShuffle')?.addEventListener('click', startUniversalShuffle);
  $('#tvSearchClear')?.addEventListener('click', () => {
    state.searchQuery = '';
    if (input) input.value = '';
    state.focusArea = 'searchForm';
    state.searchFormFocus = 0;
    renderSearch();
    setTimeout(() => input?.focus({ preventScroll: true }), 0);
  });
}


setupLogin();
setupSearch();
lockTVRemoteMode();
auth.onAuthStateChanged(async user => {
  $('#tvLoader').classList.add('hidden');
  if (!user) { $('#tvSettings')?.classList.add('hidden'); showLogin(true); return; }
  showLogin(false);
  await initTV();
});
