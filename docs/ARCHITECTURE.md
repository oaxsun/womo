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
