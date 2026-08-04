# Arquitectura

## Flujo General

La PWA carga `index.html`, estilos desde `css/styles.css` y modulos desde `js/`. `js/app.js` inicializa la pantalla, abre IndexedDB mediante `js/db.js`, carga tropas y movimientos, calcula vistas con `js/calculations.js` y mantiene la cola de sincronizacion.

## Compra

La compra crea la tropa y registra un movimiento `COMPRA`. La formula calcula peso neto origen, kg pagados, costo hacienda, IVA, comision, flete y costo total compra.

## Recepcion

La recepcion registra un movimiento `RECEPCION`. Solo se permite una recepcion activa por tropa. La formula calcula peso neto llegada, merma transporte fisica y kg reconocidos Feedlot. Los dias en feedlot se calculan desde la fecha de esta recepcion, sin guardar un valor fijo.

## Muertes

La muerte registra un movimiento `MUERTE`. En modo automatico calcula kg descontados como:

```text
kg reconocidos Feedlot / animales comprados * cantidad muerta
```

No usa kg pagados ni animales restantes como base.

## Ventas

La venta registra un movimiento `VENTA`. Calcula kg vendidos, importe sin IVA, IVA, total facturado, ingreso economico neto, costo asignado y resultado. El IVA no forma parte de la ganancia.

## Pagos

El pago registra un movimiento `PAGO`. Se usa para calcular pagos acumulados y saldo proveedor.

## Resumen Por Tropa

`calcularResumenTropa()` recorre los movimientos de una tropa y reconstruye el estado: comprados, vendidos, muertos, restantes, kg disponibles, pagos, saldos, resultados y estado operativo.

## IndexedDB

`js/db.js` centraliza apertura de base, creacion de tropas, movimientos, config, importacion/exportacion y cola `sync_queue`.

## sync_queue

Cada creacion, edicion o eliminacion genera una tarea local. La cola se mantiene offline y se reintenta cuando hay conexion.

## Google Apps Script

`apps-script/Code.gs` recibe las filas enviadas por la PWA y las respalda en Google Sheets. La PWA no lee Google Sheets para operar.

## Google Sheets

Google Sheets es respaldo y centro de consulta. IndexedDB sigue siendo la fuente operativa principal.

## Service Worker

`service-worker.js` precachea la app shell y borra caches anteriores durante `activate`. Debe permanecer en la raiz para sostener el alcance de la PWA.
