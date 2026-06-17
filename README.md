# Womo Admin v1

Panel web simple para administrar películas y series de Womo.

## Configuración

1. Abre `app.js`.
2. Reemplaza `firebaseConfig` con la configuración web de Firebase:
   Firebase Console > Project settings > General > Your apps > Web app.
3. Abre `index.html` con Live Server o súbelo a GitHub Pages.

## Colecciones usadas

- `movies`
- `series`
- `series/{seriesId}/episodes`

## Reglas temporales para desarrollo

```js
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} {
      allow read, write: if true;
    }
  }
}
```

No uses esas reglas en producción.
