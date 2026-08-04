# Cuaderno Digital Ganadero

PWA offline para registrar tropas ganaderas, movimientos por tropa y respaldos de sincronizacion con Google Sheets. La fuente operativa principal es IndexedDB; Google Sheets funciona como respaldo.

## Estructura

- `index.html`: pantalla principal y carga de la PWA.
- `manifest.json`: configuracion instalable de la PWA.
- `service-worker.js`: cache offline y actualizacion de versiones.
- `assets/icons/`: iconos usados por favicon, manifest y PWA instalada.
- `css/styles.css`: estilos visuales de la interfaz.
- `js/app.js`: coordinacion de UI, formularios, historial, exportaciones y sincronizacion.
- `js/db.js`: IndexedDB, migraciones, movimientos, tropas, config y `sync_queue`.
- `js/calculations.js`: formulas puras de compra, recepcion, venta, muerte, resumen y dias en feedlot.
- `apps-script/Code.gs`: backend de Google Apps Script para el respaldo en Google Sheets.
- `tests/calculations.test.mjs`: pruebas matematicas y de fechas.
- `docs/ARCHITECTURE.md`: organizacion tecnica.
- `docs/DATA_MODEL.md`: campos reales guardados y sincronizados.

## Pruebas

Ejecutar validacion de sintaxis:

```bash
node --check js/app.js
node --check js/db.js
node --check js/calculations.js
node --check service-worker.js
```

Ejecutar pruebas matematicas:

```bash
node tests/calculations.test.mjs
```

## Publicacion

La app se publica desde la rama `main` en GitHub Pages, carpeta raiz. Antes de publicar:

1. Ejecutar pruebas.
2. Confirmar que las rutas del `service-worker.js` existen.
3. Incrementar `CACHE_NAME` a una version nueva.
4. Confirmar que `index.html`, `manifest.json` y `service-worker.js` usan rutas relativas.
5. Hacer commit y push solo despues de aprobacion.

## Service Worker

`service-worker.js` debe quedarse en la raiz para conservar el alcance completo de la PWA. Al mover archivos, actualizar `APP_SHELL` y subir `CACHE_NAME`. La version actual de desarrollo es `cuaderno-ganadero-v18`.

## IndexedDB

IndexedDB guarda:

- `tropas`
- `movimientos`
- `config`
- `sync_queue`

No se guarda el valor calculado de dias en feedlot. Se calcula dinamicamente a partir de la fecha de recepcion.

## Sincronizacion

Cada cambio operativo crea una tarea en `sync_queue`. La PWA elimina tareas solo cuando Apps Script responde con confirmacion valida. No modificar el formato enviado a Google Apps Script sin una migracion compatible.

## Advertencia

No cambiar nombres de campos de movimientos, tropas o cola de sincronizacion sin una migracion. Los datos existentes de IndexedDB dependen de esos nombres.
