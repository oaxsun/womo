# Womo Web TV Receiver - Phone PIN Session

Esta versión usa un flujo sin Anonymous Auth.

## Flujo

1. El usuario abre Womo Web normal en celular/desktop con su cuenta real.
2. En Configuración toca **Iniciar sesión TV / Generar código**.
3. Womo crea `tvSessions/{codigo}` desde el usuario autenticado.
4. La Smart TV entra a `/tvapp/` y muestra un input de PIN.
5. El usuario escribe el código generado desde el celular.
6. La TV escucha esa sesión y reproduce los comandos enviados desde el celular.

La TV no navega contenido. Solo funciona como receiver/reproductor.

## Firestore

Colección nueva:

```txt
tvSessions/{code}
```

Campos principales:

```json
{
  "code": "123456",
  "status": "waiting_tv",
  "createdBy": "uid-del-usuario",
  "createdAt": 0,
  "expiresAt": 0,
  "currentCommand": null,
  "playerState": {
    "status": "waiting_tv"
  }
}
```

## Reglas iniciales para pruebas privadas

Como la TV entra sin Firebase Auth, necesita leer/actualizar `tvSessions` por código. Para la primera versión privada se puede usar:

```js
match /tvSessions/{sessionId} {
  allow read: if true;
  allow create: if isSignedIn();
  allow update: if true;
  allow delete: if isSignedIn();
}
```

Esto evita Anonymous Auth, pero deja `tvSessions` accesible por PIN. El PIN es temporal y no contiene catálogo ni datos sensibles. Más adelante se puede mover esta validación a PHP para endurecer seguridad.

## Notas

- No se usa Anonymous Auth.
- No se activa login desde TV.
- El usuario real es el que genera el PIN desde Womo Web.
- El receiver conserva compatibilidad con `.wmo`, `.mp4` y `.m3u8`.
