# Womo TV Receiver Session v1

Primera versión del modo Womo Web TV como receiver.

## Flujo

1. La Smart TV entra automáticamente a `/tvapp/` cuando el navegador parece ser TV, o manualmente con `?tv=1`.
2. `/tvapp/` crea una sesión temporal en `tvSessions` y muestra un código numérico de 6 dígitos.
3. En Womo Web normal, el usuario abre Configuración -> Iniciar sesión TV e ingresa el código.
4. El teléfono queda vinculado como controlador.
5. En el preview de películas, conciertos o episodios aparece `Reproducir en TV` si existe una sesión activa.
6. La TV recibe el comando y reproduce el media URL enviado por el teléfono.

## Firestore

Colección nueva:

```txt
tvSessions/{sessionId}
```

Campos principales:

```json
{
  "code": "123456",
  "status": "waiting|paired|disconnected",
  "pairedBy": "uid",
  "pairedEmail": "email",
  "currentCommand": {
    "id": "timestamp_random",
    "type": "play",
    "media": {
      "id": "mediaId",
      "type": "movie|series|concert",
      "title": "Titulo",
      "url": "https://...",
      "startAt": 0,
      "episode": null
    }
  }
}
```

## Reglas requeridas

Esta primera versión espera que la TV pueda crear y escuchar una sesión. Lo más práctico es activar Anonymous Auth en Firebase para la TV y permitir operaciones sobre `tvSessions`.

Ejemplo básico para Womo privado:

```js
match /tvSessions/{sessionId} {
  allow create: if request.auth != null;
  allow read: if request.auth != null;
  allow update: if request.auth != null;
  allow delete: if false;
}
```

En una versión futura se pueden endurecer reglas por `pairedBy`, expiración y ownership del documento.

## Limitaciones v1

- Sin QR todavía.
- La TV no navega contenido; solo recibe comandos.
- La sesión se vincula por código numérico.
- El teléfono selecciona contenido y manda reproducción.
- Progreso global en TV se deja para una fase posterior, para no abrir escrituras cross-user desde una sesión anónima.
