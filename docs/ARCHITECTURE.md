# Womo Web - separación Core / UI

Base usada: `womo-main-early-ended-reload-fix.zip`.

## Objetivo

Separar el proyecto en dos capas para poder evolucionar el diseño sin romper la funcionalidad estable.

## Capas

### Core funcional

Ubicación actual:

```txt
src/core/womo-core.js
```

Contiene el motor funcional de Womo:

- Firebase Auth
- Firestore
- Catálogo
- Favoritos
- Progreso
- Continuar viendo
- Player
- HLS
- Shuffle
- Overlay de siguiente episodio
- Guardas contra cierres/reloads prematuros del player

Regla recomendada: no tocar para cambios visuales.

### UI / estilos

Ubicación actual:

```txt
src/styles/womo-ui.css
```

Contiene la capa visual:

- Layout general
- Home
- Hero
- Carruseles
- Modal preview
- Player overlay
- Responsive/mobile
- Botones, colores, spacing, animaciones

Regla recomendada: los rediseños deben empezar aquí.

### Folders preparados para la siguiente fase

```txt
src/ui/
src/config/
```

Todavía no se extrajeron módulos JS visuales ni configuración Firebase para evitar tocar demasiadas dependencias de golpe. Esta versión es una separación segura de primera fase.

## Compatibilidad

- `index.html` ahora carga `src/core/womo-core.js` directamente.
- `styles.css` queda como entrypoint visual e importa `src/styles/womo-ui.css`.
- `app.js` queda como bootstrap de compatibilidad por si alguna referencia antigua todavía lo carga.

## Siguiente fase sugerida

Cuando esta versión quede validada en navegador:

1. Extraer `firebaseConfig` a `src/config/app-config.js`.
2. Extraer funciones visuales a `src/ui/` por grupos pequeños:
   - `home.js`
   - `hero.js`
   - `preview-modal.js`
   - `player-ui.js`
3. Dejar `src/core/` solo con datos, estado, player y persistencia.

## Home genre sections

Version `home-genre-sections-v1` keeps playback in `src/core/womo-core.js` unchanged and adds only Home rendering/admin configuration behavior:

- `homeConfig/main.genreSections` stores detected genre toggles as `{ "Horror": { "visible": true } }`.
- The Admin detects genres from Movies and Series automatically.
- Enabled genres render in Home after Series and before Conciertos.
- Each genre row is limited to 10 titles.
- The main Películas row remains limited to 10 real titles but repeats visually for an infinite carousel effect.

Playback, HLS, progress, favorites, shuffle, and auto-next should not be modified for visual Home experiments.


## Versionado visible

La versión visible de Womo Web aparece al final de Configuración.
Formato: `L.DDMM.HHMM`, donde `L` es la versión de lanzamiento, `DDMM` es la fecha de actualización y `HHMM` es la hora de actualización.
Versión inicial visible: `1.0207.1828`. Versión actual de este paquete: `1.1007.2331`.

Cada ZIP nuevo generado para Womo Web debe actualizar este valor cuando incluya cambios en la app.


## Orden visual de Home en Admin

El orden de Películas, Series, Conciertos y géneros dinámicos se controla desde el Admin arrastrando bloques. El Admin guarda ese orden como valores numéricos internos en `homeConfig/main`, pero el usuario ya no necesita escribir números manualmente.


## Cambio Admin 1.0207.1918

Bloque duplicado de géneros en Admin eliminado. La activación y orden de Películas, Series, Conciertos y géneros dinámicos queda centralizada en `Orden de Home / Secciones dinámicas`.


## Cambio iOS Playback Stability 1.0207.1918

- Se redujo trabajo de DOM durante reproduccion activa en iPhone/iPad.
- El progreso se sigue guardando, pero el refresco de Continuar viendo, episodios y botones se difiere hasta cerrar o terminar el player.
- Los eventos `ended` tempranos de Safari/iOS ya no ejecutan cierres globales duplicados.
- Se mantiene intacta la logica de reproduccion, HLS, favoritos, shuffle y auto-next.


## Cambio Admin User Tabs 1.1007.2331
- El detalle de usuario en Analytics ahora usa tabs para separar Historial, Favoritos y Continuar viendo.
- La lectura de datos se mantiene igual; solo cambia la presentación para evitar listas amontonadas.


## Cambio Player Buffer Loader 1.1007.2331
- Loader inicial separado del loader de buffering durante reproducción.
- Buffering durante reproducción usa delay y spinner sutil para evitar parpadeos por microcortes de red/Safari.
- Se evita tapar el frame actual del video cuando el contenido ya empezó.


## TV Browser Mode


Esta capa se mantiene aislada de la UI web normal para evitar romper Home, móvil, Admin o el player web existente.


## TV Browser Remote Focus v1.1107.0006
- The normal desktop/mobile web app remains unchanged.

## 2026-07-13 — Colecciones y metadata extendida

- Admin agrega metadata `collection` / `collections`, `director` y `actors` en películas, series y conciertos.
- Home soporta secciones dinámicas de colecciones en `homeConfig/main.collectionSections`, activables y ordenables desde el bloque **Orden de Home** junto a Películas, Series, Conciertos y géneros.
- Las secciones de género en Home muestran únicamente películas. Las series permanecen exclusivamente en la sección Series.
- Las recomendaciones del preview ahora priorizan títulos de la misma colección. Si el título no tiene colección o no hay coincidencias, usan género; si tampoco aplica, usan títulos recientes.
- Search de la app incluye título, género, colección, director y actores.


## Fix 1.1407.0010

- Series previews keep the episodes/seasons panel and no longer render recommendations.
- Dynamic genre sections are strictly movie-only; series remain only in the Series section.
- Collection sections and collection-based recommendations remain enabled for movies/concerts.
