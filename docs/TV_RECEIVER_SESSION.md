# Womo TV Receiver - PIN desde celular con login en TV

## Flujo actual

1. El usuario abre Womo normal en celular/desktop e inicia sesión.
2. En **Configuración > Iniciar sesión TV** toca **Generar código**.
3. Womo crea `tvSessions/{codigo}` desde el usuario autenticado.
4. La TV abre `/tvapp/`.
5. La TV primero muestra login. El usuario inicia sesión con la misma cuenta Womo.
6. Después la TV pide el código generado desde el celular.
7. La TV valida que el código exista, no haya expirado y pertenezca a la misma cuenta.
8. El celular ya puede enviar títulos con **Reproducir en TV**.

Este flujo no requiere Anonymous Auth y no necesita reglas públicas para `tvSessions`.

## Reglas Firestore recomendadas para esta versión

Con la TV autenticada, las reglas pueden mantenerse privadas:

```js
match /tvSessions/{sessionId} {
  allow read, write: if isSignedIn();
}
```

Más adelante se pueden endurecer para validar `createdBy == request.auth.uid`, pero esta versión usa la misma política privada que el resto de Womo mientras se valida el receiver.

## Compatibilidad

La pantalla TV conserva soporte para:

- MP4
- HLS / `.m3u8`
- WMO mediante `src/core/wmoMediaEngine.js`

## Notas

- La TV debe iniciar sesión con la misma cuenta que generó el código en el celular.
- Si la TV inicia sesión con otra cuenta, mostrará: `Ese código pertenece a otra cuenta`.
- El PIN sigue siendo temporal y expira según `WOMO_TV_SESSION_TTL_MS`.
