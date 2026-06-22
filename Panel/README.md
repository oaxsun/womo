# Womo Admin Panel

Panel web para administrar Womo en `/Panel`.

## Incluye

- Login con Firebase Auth Email/Password
- Home Config: Lo nuevo, Películas y Series
- Películas
- Series y episodios
- Conciertos
- Importación JSON

## Reglas Firestore recomendadas para panel con login

Para pruebas con cualquier usuario autenticado:

```js
rules_version = '2';

service cloud.firestore {
  match /databases/{database}/documents {
    match /movies/{movieId} { allow read, write: if request.auth != null; }
    match /concerts/{concertId} { allow read, write: if request.auth != null; }
    match /series/{seriesId} {
      allow read, write: if request.auth != null;
      match /episodes/{episodeId} { allow read, write: if request.auth != null; }
    }
    match /homeConfig/{docId} { allow read, write: if request.auth != null; }
    match /users/{userId} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
      match /{document=**} { allow read, write: if request.auth != null && request.auth.uid == userId; }
    }
  }
}
```

Después se puede limitar por correo/UID de admin.
