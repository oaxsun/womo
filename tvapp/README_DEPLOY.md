# Womo TV Stable v1 - Proyecto Tizen

Esta carpeta ya esta preparada como proyecto Tizen Web para Samsung TV.

## Archivos principales

- `config.xml` - manifiesto Tizen.
- `index.html` - entrada de Womo TV.
- `tv.js` - logica de Womo TV.
- `tv.css` - estilos de Womo TV.
- `assets/logo.svg` - logo.
- `icon.png` - icono de app.

## TV de prueba

- Samsung UN50DU7010FXZX
- DUID registrado: SHCDNTGI2GWQE
- IP detectada: 192.168.0.15:26101

## Siguiente paso

Abre esta carpeta en VS Code y ejecuta `Tizen: Run Project`.

Si falla el empaquetado desde VS Code, usa los scripts incluidos:

1. `build-wgt.bat`
2. `install-tv.bat`
3. `launch-tv.bat`

Ajusta las rutas si tu extension de Tizen esta instalada en otra carpeta.
