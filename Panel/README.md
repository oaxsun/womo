# Womo Panel v2

Sube esta carpeta `Panel` completa a la raiz del repositorio para entrar en:

`https://womo.oaxsun.tech/Panel/`

Archivos incluidos:

- `index.html`
- `panel-admin.js`
- `panel-admin.css`

## Requisitos Firebase

1. En Firebase Auth activa **Email/Password**.
2. Crea tu usuario admin.
3. En Authentication > Settings > Authorized domains agrega `womo.oaxsun.tech`.
4. Reglas sugeridas para permitir escritura solo a usuarios autenticados:

```js
rules_version = '2';

service cloud.firestore {
  match /databases/{database}/documents {

    match /movies/{movieId} {
      allow read: if request.auth != null;
      allow write: if request.auth != null;
    }

    match /concerts/{concertId} {
      allow read: if request.auth != null;
      allow write: if request.auth != null;
    }

    match /series/{seriesId} {
      allow read: if request.auth != null;
      allow write: if request.auth != null;

      match /episodes/{episodeId} {
        allow read: if request.auth != null;
        allow write: if request.auth != null;
      }
    }

    match /homeConfig/{docId} {
      allow read: if request.auth != null;
      allow write: if request.auth != null;
    }

    match /users/{userId} {
      allow read, write: if request.auth != null && request.auth.uid == userId;

      match /favorites/{itemId} {
        allow read, write: if request.auth != null && request.auth.uid == userId;
      }

      match /continueWatching/{itemId} {
        allow read, write: if request.auth != null && request.auth.uid == userId;
      }

      match /episodeProgress/{episodeId} {
        allow read, write: if request.auth != null && request.auth.uid == userId;
      }
    }
  }
}
```
