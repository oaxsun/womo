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
  const state = loadContinueState().filter(entry => !(entry.id === item.id && entry.type === item.type));
  state.unshift({
    id: item.id,
    type: item.type,
    progress: progress ?? item.progress ?? 5,
    lastWatchedAt: Date.now()
  });
  saveContinueState(state);
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
        <button class="primary-btn" data-action="play" data-id="${item.id}" data-type="${item.type}">Ver película</button>
        <button class="favorite-btn ${item.isFavorite ? "active" : ""}" data-action="favorite" aria-label="Agregar a favoritas"><i data-lucide="heart"></i></button>
      </div>
    </div>
  `;

  hero.querySelectorAll("[data-hero-dot]").forEach(dot => {
    dot.addEventListener("click", () => setHero(Number(dot.dataset.heroDot)));
  });

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
      upsertContinueItem(item, item?.progress || 5);
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
    btn.addEventListener("click", () => changePage(btn.dataset.page));
  });

  document.addEventListener("click", event => {
    const playButton = event.target.closest('[data-action="play"]');
    if (!playButton) return;
    const key = `${playButton.dataset.type}:${playButton.dataset.id}`;
    upsertContinueItem(allItemsByContinueKey.get(key), 5);
  });
}

async function init() {
  setupNavigation();

  const [movies, series] = await Promise.all([
    readCollection("movies", normalizeMovie),
    readCollection("series", normalizeSeries)
  ]);

  const allItems = [...movies, ...series].filter(item => item.poster);
  const sortedItems = allItems.sort((a, b) => b.createdAt - a.createdAt);
  allItemsByContinueKey = new Map(allItems.map(item => [`${item.type}:${item.id}`, item]));
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

  if (window.lucide) lucide.createIcons();
}

init();

function openPreview(item){
 const modal=document.getElementById('previewModal');
 document.getElementById('previewPoster').src=item.poster||item.posterUrl;
 document.getElementById('previewTitle').textContent=item.title;
 document.getElementById('previewMeta').textContent=`${item.duration||''} • ${item.genre||item.genres||''}`;
 document.getElementById('previewDesc').textContent=item.description||item.synopsis||'';
 const state=loadContinueState().find(x=>x.id===item.id&&x.type===item.type);
 const actions=document.getElementById('previewActions');
 actions.innerHTML= state ? '<button class="primary">Continuar</button><button class="secondary">Reiniciar</button>' : '<button class="primary">Ver película</button>';
 const recs=document.getElementById('previewRecs');
 recs.innerHTML='';
 [...allItemsByContinueKey.values()].filter(x=>x.id!==item.id).slice(0,3).forEach(r=>{const i=document.createElement('img');i.src=r.poster||r.posterUrl;recs.appendChild(i);});
 modal.classList.add('open');
}
document.addEventListener('click',e=>{
 if(e.target.closest('.preview-close')||e.target.classList.contains('preview-backdrop')) document.getElementById('previewModal').classList.remove('open');
 const card=e.target.closest('.poster-card');
 if(card && card.dataset.item){ try{openPreview(JSON.parse(card.dataset.item));}catch{} }
});
